// Configuración del proveedor wiki en tenant_connections.config (spec brain
// §4.3). Sin imports: la usa scripts/connections-bind.mts con Node directo.

export interface WikiConfig {
	categories: string[];
	requiredFrontmatter: string[];
	search: "fts";
}

const CATEGORY = /^[a-z][a-z0-9-]{0,40}$/;
const FRONTMATTER_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const KNOWN_KEYS = new Set(["categories", "requiredFrontmatter", "search"]);

export function parseWikiConfig(value: unknown): WikiConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("la configuración del wiki tiene que ser un objeto JSON");
	}
	const raw = value as Record<string, unknown>;

	const unknownKeys = Object.keys(raw).filter((key) => !KNOWN_KEYS.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(
			`claves desconocidas en la configuración del wiki: ${unknownKeys.join(", ")}`,
		);
	}

	const categories = raw.categories;
	if (
		!Array.isArray(categories) ||
		categories.length === 0 ||
		!categories.every((item) => typeof item === "string" && CATEGORY.test(item))
	) {
		throw new Error(
			"categories tiene que ser una lista no vacía de categorías en minúsculas (a-z, 0-9, guiones)",
		);
	}
	if (new Set(categories).size !== categories.length) {
		throw new Error("categories tiene valores repetidos");
	}

	const required = raw.requiredFrontmatter ?? [];
	if (
		!Array.isArray(required) ||
		!required.every(
			(item) => typeof item === "string" && FRONTMATTER_KEY.test(item),
		)
	) {
		throw new Error(
			"requiredFrontmatter tiene que ser una lista de claves (a-z, 0-9, _)",
		);
	}

	const search = raw.search ?? "fts";
	if (search !== "fts") {
		throw new Error(
			`search "${String(search)}" no está construido: por ahora solo "fts"`,
		);
	}

	return {
		categories: [...categories] as string[],
		requiredFrontmatter: [...required] as string[],
		search: "fts",
	};
}
