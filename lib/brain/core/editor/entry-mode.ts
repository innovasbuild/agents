// Cómo se entra a una página (spec 18.2 V1): quien puede editar abre directo en
// edición; quien solo puede leer ve la hoja de lectura.
import { atLeast, type Level } from "../access/types.ts";

export type EntryMode = "hidden" | "read" | "edit";

export function entryMode(level: Level | null): EntryMode {
	if (level === null) return "hidden";
	return atLeast(level, "editor") ? "edit" : "read";
}
