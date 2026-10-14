// Qué hace la migración de carpetas en un tenant, antes de aplicarla (spec
// etapa 26 §3.4). Puro: lo usa scripts/brain-folders-report.mts.
import { categoryForPath, parentPath } from "./folders.ts";

// Mismo patrón que el check de brain_folders para una carpeta de primer nivel.
const CATEGORY = /^[a-z][a-z0-9-]{0,40}$/;

const top = (slug: string) => slug.split("/")[0];

export function folderReport(
	categories: string[],
	pages: Array<{ slug: string; category: string }>,
) {
	const nested = pages.filter((p) => p.slug.includes("/"));
	// La migración inserta cada categoría de la config como carpeta (skill → skills).
	const badConfig = categories
		.filter((c) => !CATEGORY.test(c === "skill" ? "skills" : c))
		.map((c) => `config:${c}`);
	// skill/ (singular) lo rechaza brain_ensure_folders: duplicaría la categoría skill.
	const blocks = (p: { slug: string }) =>
		!CATEGORY.test(top(p.slug)) || top(p.slug) === "skill";
	const blockers = [...badConfig, ...nested.filter(blocks).map((p) => p.slug)];
	const valid = nested.filter((p) => !blocks(p));

	const folders = new Set(
		categories.map((c) => (c === "skill" ? "skills" : c)),
	);
	for (const page of valid) {
		for (
			let node = parentPath(page.slug);
			node !== null;
			node = parentPath(node)
		)
			folders.add(node);
	}
	const known = new Set(categories);
	const newCategories = new Set<string>();
	for (const page of valid) {
		const first = top(page.slug);
		if (first === "skills" || first === "brain") continue;
		if (!known.has(first)) newCategories.add(first);
	}
	return {
		folders: [...folders].sort(),
		mismatched: nested
			.filter((p) => categoryForPath(p.slug) !== p.category)
			.map((p) => ({
				slug: p.slug,
				category: p.category,
				expected: categoryForPath(p.slug),
			})),
		loose: pages.filter((p) => !p.slug.includes("/")).map((p) => p.slug),
		// Abortan la migración (check de brain_folders): renombrar antes del db push.
		blockers,
		// Primeros tramos que la migración sumaría a config.categories.
		newCategories: [...newCategories].sort(),
		// brain es una carpeta reservada, pero el backfill la crea igual si hay páginas.
		underBrain: valid.filter((p) => top(p.slug) === "brain").map((p) => p.slug),
		// skills/ sin la categoría skill en la config: el backfill crea la carpeta igual.
		skillsWithoutCategory: known.has("skill")
			? []
			: valid.filter((p) => top(p.slug) === "skills").map((p) => p.slug),
	};
}

// Lee de a páginas de `size` (PostgREST corta en 1000) hasta que una viene corta.
export async function fetchAllRows<T>(
	load: (from: number, to: number) => Promise<T[]>,
	size = 1000,
): Promise<T[]> {
	const all: T[] = [];
	for (let from = 0; ; from += size) {
		const rows = await load(from, from + size - 1);
		all.push(...rows);
		if (rows.length < size) return all;
	}
}

export interface TenantPages {
	tenant: string;
	categories: string[];
	pages: Array<{ slug: string; category: string }>;
}

function section(title: string, items: string[], line: (s: string) => string) {
	return [
		`  ${title} (${items.length}):`,
		...items.map((i) => `    ${line(i)}`),
	];
}

export function renderFolderReport(tenants: TenantPages[]): {
	text: string;
	blocked: boolean;
} {
	const out: string[] = [];
	let blocked = false;
	for (const t of tenants) {
		const r = folderReport(t.categories, t.pages);
		if (r.blockers.length > 0) blocked = true;
		out.push(`== ${t.tenant} ==`);
		out.push(
			...section(
				"BLOQUEA la migración: primer tramo inválido o skill/, renombrar antes de db push",
				r.blockers,
				(s) => s,
			),
			...section("Carpetas que quedarían", r.folders, (s) => s),
			...section(
				"Categorías nuevas que sumaría a la config",
				r.newCategories,
				(s) => s,
			),
			...section(
				"Páginas bajo brain/ (carpeta reservada)",
				r.underBrain,
				(s) => s,
			),
			...section(
				"Páginas bajo skills/ sin categoría skill en la config",
				r.skillsWithoutCategory,
				(s) => s,
			),
			...section(
				"Categoría que no coincide con su ruta",
				r.mismatched.map(
					(m) =>
						`${m.slug}: ${m.category} → quedaría ${m.expected} en su próxima edición`,
				),
				(s) => s,
			),
			...section("Páginas sueltas en la raíz", r.loose, (s) => s),
			"",
		);
	}
	out.push(
		blocked
			? "RESULTADO: hay slugs que abortan la migración. No hagas db push hasta renombrarlos."
			: "RESULTADO: ningún slug bloquea la migración.",
	);
	return { text: out.join("\n"), blocked };
}
