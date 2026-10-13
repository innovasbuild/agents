import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { renderRealReference } from "../../scripts/docs/real.ts";
import { extraProblems, frontmatterSchema } from "../../scripts/docs/schema.ts";
import {
	extractLinks,
	isExternal,
	listPages,
	parseFrontmatter,
	reachableFrom,
	resolveLink,
} from "../../scripts/docs/wiki.ts";

const ROOT = ".";
const pages = await listPages(ROOT);

describe("la forma de la wiki", () => {
	it("hay páginas que verificar", () => {
		expect(pages.length).toBeGreaterThan(5);
	});

	it("1 · toda página tiene frontmatter válido", () => {
		const problems: string[] = [];
		for (const page of pages) {
			const parsed = parseFrontmatter(page.text);
			if (!parsed) {
				problems.push(
					`${page.path}: no arranca con frontmatter (---). Ver docs/guias/documentar.md`,
				);
				continue;
			}
			const result = frontmatterSchema.safeParse(parsed.data);
			if (!result.success) {
				problems.push(
					`${page.path}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
				);
				continue;
			}
			for (const problem of extraProblems(result.data)) {
				problems.push(`${page.path}: ${problem}`);
			}
		}
		expect(problems, problems.join("\n")).toEqual([]);
	});

	it("2 · todo link relativo apunta a un archivo que existe", () => {
		const problems: string[] = [];
		for (const page of pages) {
			for (const link of extractLinks(page.text)) {
				if (isExternal(link)) continue;
				const target = resolveLink(page.path, link);
				if (!existsSync(target)) {
					problems.push(
						`${page.path}: el link ${link} no resuelve (${target} no existe)`,
					);
				}
			}
		}
		expect(problems, problems.join("\n")).toEqual([]);
	});

	it("3 · toda página es alcanzable desde docs/README.md", () => {
		const reached = reachableFrom("docs/README.md", pages);
		const lost = pages
			.map((p) => p.path)
			.filter((path) => !reached.has(path))
			.map(
				(path) =>
					`${path}: no la enlaza nadie. Agregá una línea en docs/README.md`,
			);
		expect(lost, lost.join("\n")).toEqual([]);
	});

	it("4 · toda ruta de sources existe", () => {
		const problems: string[] = [];
		for (const page of pages) {
			const parsed = parseFrontmatter(page.text);
			const sources = (parsed?.data as { sources?: unknown })?.sources;
			if (!Array.isArray(sources)) continue;
			for (const source of sources) {
				if (typeof source === "string" && !existsSync(source)) {
					problems.push(
						`${page.path}: la fuente ${source} ya no existe. Actualizá sources`,
					);
				}
			}
		}
		expect(problems, problems.join("\n")).toEqual([]);
	});

	it("5 · docs/referencia coincide con lo que genera docs:sync", async () => {
		const expected = await renderRealReference(ROOT);
		const stale: string[] = [];
		for (const [name, content] of Object.entries(expected)) {
			const path = `docs/referencia/${name}`;
			const actual = existsSync(path) ? await readFile(path, "utf8") : null;
			if (actual !== content) stale.push(path);
		}
		for (const page of pages) {
			const name = page.path.replace("docs/referencia/", "");
			if (page.path.startsWith("docs/referencia/") && !(name in expected)) {
				stale.push(page.path);
			}
		}
		expect(
			stale,
			`docs/referencia está desactualizada: npm run docs:sync\n${stale.join("\n")}`,
		).toEqual([]);
	});
});
