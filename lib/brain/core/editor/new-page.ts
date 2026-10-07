// Prefijo con el que se precarga el slug de una página nueva (spec etapa 17
// §7.2, "Nueva página acá"). El valor viene de la URL: solo se acepta una
// carpeta con slug válido donde la persona puede escribir.
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types.ts";

export function resolveNewPagePrefix(
	en: string | undefined,
	editableFolders: string[],
): string {
	if (!en || en.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(en)) return "";
	return editableFolders.includes(en) ? `${en}/` : "";
}
