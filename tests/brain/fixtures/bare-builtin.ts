// biome-ignore lint/style/useNodejsImportProtocol: import sin prefijo a propósito
import { createHash } from "crypto";

export const digest = (text: string) =>
	createHash("sha256").update(text).digest("hex");
