// lib/brain/core/reserved-slugs.ts
// Nombres reservados del brain (spec etapa 26 §4.1). Sin node:crypto: los
// importan también componentes de cliente (árbol, editor). rules.ts los
// re-exporta para los que ya los usaban desde ahí.
import { parentPath } from "./access/resolve-access.ts";
import { ROOT_PATH } from "./access/types.ts";
import {
	MAX_FOLDER_RULES_CHARS,
	MAX_ROOT_RULES_CHARS,
	RESERVED_LEAVES,
	RULES_LEAF,
	TEMPLATE_LEAF,
} from "./types.ts";

export function leafOf(slug: string): string {
	return slug.slice(slug.lastIndexOf("/") + 1);
}

export function isReservedSlug(slug: string): boolean {
	return (RESERVED_LEAVES as readonly string[]).includes(leafOf(slug));
}

export function isRulesSlug(slug: string): boolean {
	return leafOf(slug) === RULES_LEAF;
}

export function isTemplateSlug(slug: string): boolean {
	return leafOf(slug) === TEMPLATE_LEAF;
}

export function rulesSlugFor(folder: string): string {
	return folder === ROOT_PATH ? RULES_LEAF : `${folder}/${RULES_LEAF}`;
}

/** Carpeta en la que vive una página; "" para una de la raíz. */
export function folderOfPage(slug: string): string {
	return parentPath(slug) ?? ROOT_PATH;
}

/** Tope de una 00-reglas activa; null si la página no es una 00-reglas. */
export function rulesCharLimit(slug: string): number | null {
	if (!isRulesSlug(slug)) return null;
	return folderOfPage(slug) === ROOT_PATH
		? MAX_ROOT_RULES_CHARS
		: MAX_FOLDER_RULES_CHARS;
}
