// Carpetas del brain (spec etapa 26 §3.1). Puro y sin imports de Next: lo usan
// el proveedor wiki, el editor y scripts con Node directo.
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "./types.ts";

export const MAX_TOP_FOLDERS = 20;
export const MAX_FOLDER_DESCRIPTION = 300;
// skills existe solo si el brain ya tenía la categoría skill; brain es la
// categoría de las instrucciones de la raíz (26.2).
export const RESERVED_TOP_FOLDERS = ["skills", "brain"] as const;

// Mismo patrón que el check de brain_pages.category.
const CATEGORY = /^[a-z][a-z0-9-]{0,40}$/;

export interface BrainFolder {
	path: string;
	description: string;
}

export function categoryForPath(slug: string): string {
	const first = slug.split("/")[0];
	return first === "skills" ? "skill" : first;
}

export function parentPath(slug: string): string | null {
	const cut = slug.lastIndexOf("/");
	return cut === -1 ? null : slug.slice(0, cut);
}

export function nearestFolder(
	path: string,
	folders: ReadonlySet<string>,
): string | null {
	for (let node: string | null = path; node !== null; node = parentPath(node)) {
		if (folders.has(node)) return node;
	}
	return null;
}

export function validateFolderPath(
	path: string,
): { ok: true } | { ok: false; message: string } {
	if (
		path.length === 0 ||
		path.length > MAX_SLUG_LENGTH ||
		!SLUG_PATTERN.test(path)
	)
		return {
			ok: false,
			message:
				"Usá minúsculas, números y guiones, con / entre carpetas y sin espacios.",
		};
	const top = path.split("/")[0];
	if (!path.includes("/") && !CATEGORY.test(top))
		return {
			ok: false,
			message:
				"Una carpeta de primer nivel empieza con una letra y tiene hasta 41 caracteres.",
		};
	if (
		!path.includes("/") &&
		(RESERVED_TOP_FOLDERS as readonly string[]).includes(top)
	)
		return { ok: false, message: `«${top}» es un nombre reservado del brain.` };
	return { ok: true };
}
