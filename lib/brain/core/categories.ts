// Lee la lista de categorías que escribe una persona en la consola (spec 21.4
// §4.2). El patrón es el del check de brain_pages.category; la base lo repite.
const CATEGORY = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_CATEGORIES = 20;

export type ParsedCategories =
	| { ok: true; categories: string[] }
	| { ok: false; message: string };

export function parseCategories(raw: string): ParsedCategories {
	const categories = [
		...new Set(
			raw
				.split(/[,\n]/)
				.map((item) => item.trim().toLowerCase())
				.filter((item) => item.length > 0),
		),
	];
	if (categories.length === 0) {
		return { ok: false, message: "El brain necesita al menos una categoría." };
	}
	if (categories.length > MAX_CATEGORIES) {
		return {
			ok: false,
			message: `Son demasiadas categorías: el máximo es ${MAX_CATEGORIES}.`,
		};
	}
	const bad = categories.find((item) => !CATEGORY.test(item));
	if (bad) {
		return {
			ok: false,
			message: `«${bad}» no es válida: usá minúsculas, números y guiones, empezando con una letra.`,
		};
	}
	return { ok: true, categories };
}
