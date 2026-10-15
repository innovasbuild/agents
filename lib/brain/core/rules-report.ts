// Qué páginas reservadas ya existen antes de desplegar la 26.2 (spec etapa 26
// §4.1). Puro: lo usa scripts/brain-rules-report.mts. Nada bloquea el deploy:
// una 00-reglas de más se sigue leyendo y falla recién al escribirla.
import { ancestorChain } from "./access/resolve-access.ts";
import { ROOT_PATH } from "./access/types.ts";
import {
	folderOfPage,
	isReservedSlug,
	isRulesSlug,
	rulesSlugFor,
} from "./rules.ts";
import {
	type BrainStatus,
	MAX_CASCADE_CHARS,
	MAX_FOLDER_RULES_CHARS,
	MAX_ROOT_RULES_CHARS,
	RESERVED_LEAVES,
} from "./types.ts";

export interface ReportPage {
	slug: string;
	status: BrainStatus;
	body: string;
}

export interface TenantReservedPages {
	tenant: string;
	pages: ReportPage[];
}

const label = (folder: string) => (folder === ROOT_PATH ? "(raíz)" : folder);

export function rulesReport(pages: readonly ReportPage[]) {
	const reserved = pages.filter((p) => isReservedSlug(p.slug));
	const active = reserved.filter(
		(p) => p.status === "activo" && isRulesSlug(p.slug),
	);
	const sizes = new Map(active.map((p) => [p.slug, p.body.length]));
	const limitOf = (slug: string) =>
		folderOfPage(slug) === ROOT_PATH
			? MAX_ROOT_RULES_CHARS
			: MAX_FOLDER_RULES_CHARS;
	return {
		reserved: reserved.map((p) => ({
			slug: p.slug,
			status: p.status,
			chars: p.body.length,
		})),
		// Desde el deploy, brain_upsert por MCP y del agente pide rulesRevision
		// en estas carpetas y en todo lo que cuelga.
		gated: active.map((p) => label(folderOfPage(p.slug))),
		overLimit: active
			.filter((p) => p.body.length > limitOf(p.slug))
			.map((p) => ({
				slug: p.slug,
				chars: p.body.length,
				limit: limitOf(p.slug),
			})),
		cascadeOver: active
			.map((p) => {
				const folder = folderOfPage(p.slug);
				const chars = ancestorChain(folder).reduce(
					(sum, node) => sum + (sizes.get(rulesSlugFor(node)) ?? 0),
					0,
				);
				return { path: label(folder), chars };
			})
			.filter((c) => c.chars > MAX_CASCADE_CHARS),
		// x/00-reglas/y: el árbol trata a la reservada como carpeta.
		underReserved: pages
			.filter((p) =>
				p.slug
					.split("/")
					.slice(0, -1)
					.some((segment) =>
						(RESERVED_LEAVES as readonly string[]).includes(segment),
					),
			)
			.map((p) => p.slug),
	};
}

function section(title: string, items: string[]) {
	return [`  ${title} (${items.length}):`, ...items.map((i) => `    ${i}`)];
}

export function renderRulesReport(tenants: TenantReservedPages[]): {
	text: string;
	warnings: boolean;
} {
	const out: string[] = [];
	let warnings = false;
	for (const t of tenants) {
		const r = rulesReport(t.pages);
		const flagged =
			r.overLimit.length + r.cascadeOver.length + r.underReserved.length;
		if (flagged > 0) warnings = true;
		out.push(
			`== ${t.tenant} ==`,
			...section(
				"Páginas reservadas",
				r.reserved.map(
					(p) => `${p.slug} · ${p.status} · ${p.chars} caracteres`,
				),
			),
			...section("Carpetas que van a pedir rulesRevision", r.gated),
			...section(
				"ATENCIÓN: pasan su tope (se leen igual; la próxima escritura tiene que acortarlas)",
				r.overLimit.map((p) => `${p.slug}: ${p.chars} de ${p.limit}`),
			),
			...section(
				"ATENCIÓN: cascadas de más de 40000 caracteres",
				r.cascadeOver.map((c) => `${c.path}: ${c.chars}`),
			),
			...section(
				"ATENCIÓN: páginas que cuelgan de una reservada",
				r.underReserved,
			),
			"",
		);
	}
	out.push(
		warnings
			? "RESULTADO: hay páginas reservadas para revisar antes del deploy. No bloquean."
			: "RESULTADO: nada para revisar.",
	);
	return { text: out.join("\n"), warnings };
}
