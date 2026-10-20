// Id de una subida por MCP (spec etapa 24.6 §3 "MCP"). Puro. Lleva la hora de
// emisión, un valor aleatorio y la carpeta destino, así skill_import solo
// recibe el id. No autoriza nada: el objeto se busca con el tenant y la persona
// del pedido, y el permiso se vuelve a mirar al importar.
import { isValidSkillFolder } from "./package.ts";

export const UPLOAD_LINK_SECONDS = 600;

// <hora en base 36>.<aleatorio>.<carpeta con ~ en lugar de />. Todo dentro de
// [A-Za-z0-9._~-]: entra tal cual en una URL y en la clave de Storage.
const ID_PATTERN = /^([0-9a-z]+)\.([A-Za-z0-9_-]+)\.([a-z0-9~-]*)$/;
const RANDOM_PATTERN = /^[A-Za-z0-9_-]+$/;

export function makeUploadId(
	folder: string,
	nowMs: number,
	random: string,
): string {
	if (!RANDOM_PATTERN.test(random)) {
		throw new Error("uploadId: el valor aleatorio usa [A-Za-z0-9_-].");
	}
	return `${nowMs.toString(36)}.${random}.${folder.replaceAll("/", "~")}`;
}

export function parseUploadId(
	id: string,
	nowMs: number,
): { folder: string } | "expired" | null {
	const match = ID_PATTERN.exec(id);
	if (!match) return null;
	const issuedMs = Number.parseInt(match[1], 36);
	const folder = match[3].replaceAll("~", "/");
	if (!Number.isSafeInteger(issuedMs) || !isValidSkillFolder(folder)) {
		return null;
	}
	if (nowMs - issuedMs > UPLOAD_LINK_SECONDS * 1000) return "expired";
	return { folder };
}
