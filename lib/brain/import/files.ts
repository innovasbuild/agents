// Lee una carpeta local de markdown. Los archivos que no son .md vuelven con
// raw vacío para que el reporte los liste como excluidos.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { VaultFile } from "./document.ts";

export async function readVaultFiles(root: string): Promise<VaultFile[]> {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	const files: VaultFile[] = [];

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const absolute = join(entry.parentPath, entry.name);
		const path = relative(root, absolute).split(sep).join("/");
		if (path.split("/").some((segment) => segment.startsWith("."))) continue;

		const isMarkdown = path.toLowerCase().endsWith(".md");
		files.push({
			path,
			raw: isMarkdown ? await readFile(absolute, "utf8") : "",
		});
	}

	return files.sort((a, b) => a.path.localeCompare(b.path));
}
