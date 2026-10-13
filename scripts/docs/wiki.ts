// Helpers puros para verificar la forma de la wiki (spec etapa 25 §4.3).
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { parse } from "yaml";

export interface Page {
	/** Path relativo a la raíz del repo, con `/`. */
	path: string;
	text: string;
}

/** Carpetas de docs/ que no son páginas de la wiki. */
const NOT_WIKI = ["docs/superpowers/", "docs/diagramas/", "docs/_meta/"];

export async function listPages(root: string): Promise<Page[]> {
	const pages: Page[] = [];
	const walk = async (dir: string): Promise<void> => {
		for (const entry of await readdir(join(root, dir), {
			withFileTypes: true,
		})) {
			const path = `${dir}/${entry.name}`;
			if (entry.isDirectory()) {
				if (!NOT_WIKI.some((prefix) => `${path}/`.startsWith(prefix))) {
					await walk(path);
				}
			} else if (entry.name.endsWith(".md")) {
				pages.push({ path, text: await readFile(join(root, path), "utf8") });
			}
		}
	};
	await walk("docs");
	return pages.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Parte `---\n...\n---\n` del resto. `null` si la página no arranca con frontmatter. */
export function parseFrontmatter(
	text: string,
): { data: unknown; body: string } | null {
	const lines = text.split("\n");
	if (lines[0] !== "---") return null;
	const end = lines.indexOf("---", 1);
	if (end === -1) return null;
	return {
		data: parse(lines.slice(1, end).join("\n")),
		body: lines.slice(end + 1).join("\n"),
	};
}

/** Saca los bloques de código: lo que está adentro no cuenta como link ni como mención. */
export function stripCode(text: string): string {
	return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** Targets de los links markdown (`](x)`), sin ancla ni título. */
export function extractLinks(text: string): string[] {
	const links: string[] = [];
	for (const match of stripCode(text).matchAll(
		/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
	)) {
		links.push(match[1]);
	}
	return links;
}

export function isExternal(link: string): boolean {
	return /^(https?:|mailto:|#)/.test(link);
}

/** Path del repo al que apunta un link relativo desde `from`, sin ancla. */
export function resolveLink(from: string, link: string): string {
	const target = decodeURI(link.split("#")[0]);
	return normalize(join(dirname(from), target))
		.split("\\")
		.join("/");
}

/** BFS por links markdown desde el índice. Devuelve los paths de páginas alcanzadas. */
export function reachableFrom(index: string, pages: Page[]): Set<string> {
	const byPath = new Map(pages.map((p) => [p.path, p]));
	const seen = new Set<string>([index]);
	const queue = [index];
	while (queue.length > 0) {
		const current = byPath.get(queue.shift() as string);
		if (!current) continue;
		for (const link of extractLinks(current.text)) {
			if (isExternal(link)) continue;
			const target = resolveLink(current.path, link);
			if (!seen.has(target) && byPath.has(target)) {
				seen.add(target);
				queue.push(target);
			}
		}
	}
	return seen;
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mención literal de `needle` en `text`, sin pegarse a otro identificador
 * (`cosas` no cuenta dentro de `cosas_x`). La raíz `/` solo cuenta entre
 * backticks, si no coincidiría con cualquier texto.
 */
export function mentions(text: string, needle: string): boolean {
	if (needle === "/") return text.includes("`/`");
	return new RegExp(
		`(?<![A-Za-z0-9_])${escapeRegex(needle)}(?![A-Za-z0-9_])`,
	).test(text);
}
