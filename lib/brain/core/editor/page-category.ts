// La categoría la decide el servidor por la ruta (spec etapa 26 D1,
// createWikiProvider.upsert): el editor muestra la misma y la manda igual, para
// que coincidan. Bajo skills/ es skill (savePage la fuerza a Activo); fuera,
// nunca. Apto para el cliente.
import { categoryForPath } from "../folders.ts";
import { BRAIN_CATEGORY, RULES_LEAF } from "../types.ts";

export function pageCategory(slug: string, current: string): string {
	if (slug.includes("/")) return categoryForPath(slug);
	if (slug === RULES_LEAF) return BRAIN_CATEGORY;
	// Una página suelta de la raíz que ya existía conserva la suya.
	return current;
}
