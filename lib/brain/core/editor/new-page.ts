// Prefijo con el que se precarga el slug de una página nueva (spec etapa 17
// §7.2, "Nueva página acá"). El valor viene de la URL: solo se acepta una
// carpeta con slug válido donde la persona puede escribir. Sin él, arranca en
// la primera carpeta editable (una página nueva no va en la raíz, spec etapa 26
// §3.1), salvo skills/, donde lo que se crea es una skill.
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types.ts";
import { isSkillsFolder } from "./reserved.ts";

const isValid = (folder: string) =>
	folder.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(folder);

export function resolveNewPagePrefix(
	en: string | undefined,
	editableFolders: string[],
): string {
	if (en && isValid(en) && editableFolders.includes(en)) return `${en}/`;
	const first = editableFolders.find(
		(folder) => isValid(folder) && !isSkillsFolder(folder),
	);
	return first ? `${first}/` : "";
}
