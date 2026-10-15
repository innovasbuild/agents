// lib/brain/core/rules.ts
// Instrucciones y reglas del brain (spec etapa 26 §4.1, §4.2). Puro: lo usan el
// proveedor wiki, el MCP, las tools del agente y un script con Node directo.
import { createHash } from "node:crypto";
import { ancestorChain, parentPath } from "./access/resolve-access.ts";
import { ROOT_PATH } from "./access/types.ts";
import { BrainValidation } from "./errors.ts";
import {
	type BrainStatus,
	MAX_CASCADE_CHARS,
	MAX_FOLDER_RULES_CHARS,
	MAX_ROOT_RULES_CHARS,
	RESERVED_LEAVES,
	RULES_LEAF,
} from "./types.ts";

export interface RuleEntry {
	/** Carpeta que gobierna; "" es la raíz. */
	path: string;
	slug: string;
	revision: number;
	body: string;
}

// Campos obligatorios y plantilla: los llena la 26.3. En la 26.2 van vacíos.
export interface FieldSpec {
	key: string;
	type: "texto" | "fecha" | "numero" | "ruta" | "opciones";
	options?: string[];
}

export interface RulesCascade {
	revision: string;
	chain: RuleEntry[];
	fields: FieldSpec[];
	template: {
		slug: string;
		body: string;
		frontmatter: Record<string, unknown>;
	} | null;
}

/** Lo mínimo de una 00-reglas para armar la cascada. */
export interface RulePage {
	slug: string;
	status: BrainStatus;
	revision: number;
	body: string;
}

export function leafOf(slug: string): string {
	return slug.slice(slug.lastIndexOf("/") + 1);
}

export function isReservedSlug(slug: string): boolean {
	return (RESERVED_LEAVES as readonly string[]).includes(leafOf(slug));
}

export function isRulesSlug(slug: string): boolean {
	return leafOf(slug) === RULES_LEAF;
}

export function rulesSlugFor(folder: string): string {
	return folder === ROOT_PATH ? RULES_LEAF : `${folder}/${RULES_LEAF}`;
}

/** Carpeta en la que vive una página; "" para una de la raíz. */
export function folderOfPage(slug: string): string {
	return parentPath(slug) ?? ROOT_PATH;
}

// Raíz primero. Una 00-reglas no se gobierna a sí misma: su propia revisión ya
// la cubre baseRevision, y quien la escribe tiene que conocer las de arriba.
export function governingFolders(slug: string): string[] {
	const chain = ancestorChain(folderOfPage(slug));
	return isRulesSlug(slug) ? chain.slice(0, -1) : chain;
}

export function cascadeRevision(chain: readonly RuleEntry[]): string {
	if (chain.length === 0) return "";
	return createHash("sha256")
		.update(chain.map((entry) => `${entry.slug}:${entry.revision}`).join("\n"))
		.digest("hex")
		.slice(0, 16);
}

function activeRules(pages: readonly RulePage[]): Map<string, RulePage> {
	return new Map(
		pages
			.filter((page) => page.status === "activo" && isRulesSlug(page.slug))
			.map((page) => [page.slug, page]),
	);
}

export function rulesFor(
	slug: string,
	pages: readonly RulePage[],
): RulesCascade {
	const active = activeRules(pages);
	const chain: RuleEntry[] = [];
	for (const folder of governingFolders(slug)) {
		const page = active.get(rulesSlugFor(folder));
		if (page)
			chain.push({
				path: folder,
				slug: page.slug,
				revision: page.revision,
				body: page.body,
			});
	}
	return {
		revision: cascadeRevision(chain),
		chain,
		fields: [],
		template: null,
	};
}

// brain_read no repite la raíz: llegó al arrancar la sesión. La revisión es la
// de la cascada completa, la que pide brain_upsert.
export function withoutRoot(cascade: RulesCascade): {
	revision: string;
	chain: RuleEntry[];
} {
	return {
		revision: cascade.revision,
		chain: cascade.chain.filter((entry) => entry.path !== ROOT_PATH),
	};
}

function within(path: string, folder: string): boolean {
	return (
		folder === ROOT_PATH || path === folder || path.startsWith(`${folder}/`)
	);
}

// Topes de una 00-reglas activa (spec etapa 26 §4.1): la propia y cada cascada
// que la incluye, con la página ya cambiada.
export function checkRulesWrite(
	write: { slug: string; status: BrainStatus; body: string },
	pages: readonly RulePage[],
): void {
	if (!isRulesSlug(write.slug) || write.status !== "activo") return;
	const folder = folderOfPage(write.slug);
	const limit =
		folder === ROOT_PATH ? MAX_ROOT_RULES_CHARS : MAX_FOLDER_RULES_CHARS;
	if (write.body.length > limit) {
		throw new BrainValidation(
			["body"],
			folder === ROOT_PATH
				? `Las instrucciones del brain pueden tener hasta ${limit} caracteres y estas tienen ${write.body.length}. Entran en cada sesión: dejá lo esencial.`
				: `Las reglas de ${folder} pueden tener hasta ${limit} caracteres y estas tienen ${write.body.length}.`,
		);
	}
	const sizes = new Map(
		[...activeRules(pages)].map(([slug, page]) => [slug, page.body.length]),
	);
	sizes.set(write.slug, write.body.length);
	for (const slug of sizes.keys()) {
		const ruleFolder = folderOfPage(slug);
		if (!within(ruleFolder, folder)) continue;
		const total = ancestorChain(ruleFolder).reduce(
			(sum, node) => sum + (sizes.get(rulesSlugFor(node)) ?? 0),
			0,
		);
		if (total > MAX_CASCADE_CHARS) {
			throw new BrainValidation(
				["body"],
				`Con este cambio, las reglas que aplican en ${ruleFolder === ROOT_PATH ? "la raíz" : ruleFolder} suman ${total} caracteres y el máximo es ${MAX_CASCADE_CHARS}. Acortá esta página o alguna de las carpetas de arriba.`,
			);
		}
	}
}
