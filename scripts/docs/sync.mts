// `npm run docs:sync`: regenera docs/referencia/ desde el disco (spec etapa 25 §4.2).
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	TOOL_LABELS,
	TOOLS_SIN_ETIQUETA,
} from "../../lib/agents/running-tool.ts";
import { SERVICES_EXCLUIDOS } from "../../lib/workflows/registry.ts";
import { inventory } from "./inventory.ts";
import { renderReference } from "./sync.ts";

// Raíz del repo relativa a este script, no a process.cwd().
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function main(): Promise<void> {
	const inv = await inventory(REPO_ROOT);
	const pages = renderReference(inv, {
		toolLabels: TOOL_LABELS,
		toolsSinEtiqueta: [...TOOLS_SIN_ETIQUETA],
		servicesExcluidos: SERVICES_EXCLUIDOS,
	});
	const dir = join(REPO_ROOT, "docs/referencia");
	await mkdir(dir, { recursive: true });
	for (const [name, content] of Object.entries(pages)) {
		await writeFile(join(dir, name), content);
	}
	for (const name of await readdir(dir)) {
		if (name.endsWith(".md") && !(name in pages)) await rm(join(dir, name));
	}
	console.log(`docs/referencia: ${Object.keys(pages).length} páginas`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
