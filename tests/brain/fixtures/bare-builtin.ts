import { createHash } from "crypto";

export const digest = (text: string) =>
	createHash("sha256").update(text).digest("hex");
