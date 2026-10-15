// lib/brain/core/editor/reserved.ts
// Cómo se muestran las páginas reservadas en el editor web (spec etapa 26
// §4.1, §4.3). Puro y sin node:crypto ni rules.ts: lo importan componentes
// de cliente (árbol, menú, editor). Los permisos son solo experiencia: el
// servidor los exige igual (withAccess, delete.ts).
import { type Level, ROOT_PATH } from "../access/types.ts";
import {
	folderOfPage,
	isReservedSlug,
	isRulesSlug,
	isTemplateSlug,
	rulesCharLimit,
	rulesSlugFor,
} from "../reserved-slugs.ts";
import { SKILLS_PREFIX } from "../skills/package.ts";
import { MAX_SLUG_LENGTH, RULES_LEAF, SLUG_PATTERN } from "../types.ts";
import { pageHref } from "./slug.ts";

export const RULES_LOAD_ERROR =
	"No se pudieron leer las reglas de esta carpeta. Guardar no depende de ellas.";

// Una carpeta deja lugar para "/00-reglas" dentro del largo máximo de un slug.
const MAX_FOLDER_PATH = MAX_SLUG_LENGTH - RULES_LEAF.length - 1;

export function rulesTitle(folder: string): string {
	return folder === ROOT_PATH
		? "Instrucciones del brain"
		: `Reglas de ${folder}`;
}

export interface ReservedNotice {
	title: string;
	text: string;
	/** Tope de caracteres de una 00-reglas; null para la plantilla. */
	limit: number | null;
}

const ROOT_TEXT =
	"Le llegan a todo asistente al arrancar una sesión, en el chat y por MCP, y valen para todo el brain. Solo las edita quien administra la raíz, y el asistente del chat nunca las escribe. Aplican cuando el estado es Activo.";
const TEMPLATE_TEXT =
	"Es una página reservada de la carpeta: solo la edita quien la administra, y el asistente del chat nunca la escribe.";

function folderText(folder: string): string {
	return `Gobiernan a quien escribe en ${folder} y en sus subcarpetas: por MCP, nadie escribe ahí sin haberlas leído. Solo las edita quien administra la carpeta, y el asistente del chat nunca las escribe. Aplican cuando el estado es Activo.`;
}

export function reservedNotice(slug: string): ReservedNotice | null {
	if (!isReservedSlug(slug)) return null;
	const folder = folderOfPage(slug);
	if (isRulesSlug(slug))
		return {
			title: rulesTitle(folder),
			text: folder === ROOT_PATH ? ROOT_TEXT : folderText(folder),
			limit: rulesCharLimit(slug),
		};
	return {
		title:
			folder === ROOT_PATH ? "Plantilla del brain" : `Plantilla de ${folder}`,
		text: TEMPLATE_TEXT,
		limit: null,
	};
}

export function reservedBadge(slug: string): "Reglas" | "Plantilla" | null {
	if (isRulesSlug(slug)) return "Reglas";
	if (isTemplateSlug(slug)) return "Plantilla";
	return null;
}

// Una skills/00-reglas sería una página de categoría skill (spec 24.1 S3): las
// carpetas de skills no ofrecen reglas propias desde la web.
export function isSkillsFolder(folder: string): boolean {
	return `${folder}/`.startsWith(SKILLS_PREFIX);
}

export function newRulesHref(tenantSlug: string, folder: string): string {
	return folder === ROOT_PATH
		? `/${tenantSlug}/brain/nueva?reglas=1`
		: `/${tenantSlug}/brain/nueva?reglas=1&en=${folder}`;
}

// Abre la 00-reglas si existe en cualquier estado (una archivada se reactiva
// desde el editor); si no, la crea. Crear una que ya existe chocaría.
export function rulesEntryHref(
	tenantSlug: string,
	node: { path: string; rules: { slug: string } | null },
): string {
	return node.rules
		? pageHref(tenantSlug, node.rules.slug)
		: newRulesHref(tenantSlug, node.path);
}

// ?reglas=1&en=<carpeta> de "Nueva página": sin en, la raíz.
export function resolveNewRulesPage(
	en: string | undefined,
	levelOf: (path: string) => Level | null,
): { slug: string; title: string } | null {
	const folder = en ?? ROOT_PATH;
	if (
		folder !== ROOT_PATH &&
		(folder.length > MAX_FOLDER_PATH || !SLUG_PATTERN.test(folder))
	)
		return null;
	if (isSkillsFolder(folder) || levelOf(folder) !== "administrador")
		return null;
	return { slug: rulesSlugFor(folder), title: rulesTitle(folder) };
}

// Carpeta del slug que se está escribiendo en "Nueva página"; null mientras no
// es una ruta válida.
export function typedFolder(slug: string): string | null {
	const cut = slug.lastIndexOf("/");
	if (cut === -1) return ROOT_PATH;
	const folder = slug.slice(0, cut);
	return folder.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(folder)
		? folder
		: null;
}

// El índice no mezcla las reservadas con las páginas comunes; la búsqueda sí
// las encuentra (spec etapa 26 §4.1).
export function listedInIndex<T extends { slug: string }>(
	pages: readonly T[],
	searching: boolean,
): T[] {
	return searching
		? [...pages]
		: pages.filter((page) => !isReservedSlug(page.slug));
}

// Con qué nivel se entra a una página: una reservada se edita solo
// administrando su carpeta; si no, se lee (no se ofrece un editor que no
// puede guardar).
export function entryLevel(
	slug: string,
	levelOf: (path: string) => Level | null,
): Level | null {
	const level = levelOf(slug);
	if (level === null || !isReservedSlug(slug)) return level;
	return levelOf(folderOfPage(slug)) === "administrador" ? level : "lector";
}
