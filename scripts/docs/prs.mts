// `npm run docs:prs`: guarda en docs/_meta/prs.json el snapshot de los PR
// mergeados (spec etapa 25 §4.1b). Se versiona para que los tests de la wiki
// corran en CI sin credenciales de GitHub.
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

// Raíz del repo relativa a este script, no a process.cwd().
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

interface RawPr {
	number: number;
	title: string;
	mergedAt: string;
	headRefName: string;
	body: string;
	files: { path: string }[];
}

async function main(): Promise<void> {
	const { stdout } = await run(
		"gh",
		[
			"pr",
			"list",
			"--state",
			"merged",
			"--limit",
			"500",
			"--json",
			"number,title,mergedAt,headRefName,body,files",
		],
		{ cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 },
	);
	const prs = (JSON.parse(stdout) as RawPr[])
		.map((pr) => ({
			number: pr.number,
			title: pr.title,
			mergedAt: pr.mergedAt,
			headRefName: pr.headRefName,
			body: pr.body,
			files: pr.files.map((file) => file.path),
		}))
		.sort((a, b) => a.number - b.number);
	await writeFile(
		join(REPO_ROOT, "docs/_meta/prs.json"),
		`${JSON.stringify(prs, null, "\t")}\n`,
	);
	console.log(`docs/_meta/prs.json: ${prs.length} PR mergeados`);
}

main().catch((error) => {
	console.error("docs:prs falló; no se tocó docs/_meta/prs.json.");
	console.error(error);
	process.exit(1);
});
