// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Editor, generateJSON } from "@tiptap/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { buildExtensions } from "@/components/brain/editor/extensions";
import { toMarkdownLinks } from "@/lib/brain/core/editor/markdown-links";
import { parseWikilinks } from "@/lib/brain/core/wikilinks";
import { CORPUS, type CorpusCase, HOSTILE } from "../fixtures/markdown-corpus";

const REAL_DIR = new URL("../fixtures/brain-real/", import.meta.url);
const REAL: CorpusCase[] = existsSync(REAL_DIR)
	? readdirSync(REAL_DIR)
			.filter((file) => file.endsWith(".md"))
			.map((file) => ({
				name: `real: ${file}`,
				md: readFileSync(new URL(file, REAL_DIR), "utf8"),
				exact: false,
			}))
	: [];

function roundtrip(md: string): { markdown: string; html: string } {
	const editor = new Editor({
		extensions: buildExtensions({
			titleFor: () => undefined,
			exists: () => true,
		}),
		content: md,
		contentType: "markdown",
	});
	const result = { markdown: editor.getMarkdown(), html: editor.getHTML() };
	editor.destroy();
	return result;
}

// Lo que ve quien lee la página: el mismo camino de <BrainMarkdown> (wikilinks a
// links wiki: y react-markdown + GFM). Los [[...]] además se comparan aparte,
// byte a byte.
function rendered(md: string): string {
	return renderToStaticMarkup(
		createElement(
			ReactMarkdown,
			{ remarkPlugins: [remarkGfm], urlTransform: (url: string) => url },
			toMarkdownLinks(md, () => undefined),
		),
	);
}

const links = (md: string) =>
	parseWikilinks(md).map((link) => md.slice(link.start, link.end));

describe.each([...CORPUS, ...REAL])("ida y vuelta: $name", (testCase) => {
	const { markdown } = roundtrip(testCase.md);

	it("no pierde contenido: la vista de lectura es la misma", () => {
		expect(rendered(markdown)).toBe(rendered(testCase.md));
	});

	it("los links del brain salen byte a byte iguales", () => {
		expect(links(markdown)).toEqual(links(testCase.md));
	});

	it("es estable: una segunda pasada no cambia nada", () => {
		expect(roundtrip(markdown).markdown).toBe(markdown);
	});

	if (testCase.exact) {
		it("sale idéntico, carácter por carácter", () => {
			expect(markdown).toBe(testCase.md);
		});
	}
});

describe("un [[...]] dentro de código no es un nodo", () => {
	it("no genera elementos de link del brain", () => {
		for (const name of [
			"wikilink en codigo en linea",
			"codigo con markdown y wikilink adentro",
		]) {
			const found = CORPUS.find((c) => c.name === name);
			expect(found, name).toBeDefined();
			expect(roundtrip(found?.md ?? "").html).not.toContain("data-wikilink");
		}
	});
});

describe("HTML crudo: nunca se vuelve elemento (spec V10)", () => {
	it.each(HOSTILE)("$name", ({ md }) => {
		const { html, markdown } = roundtrip(md);
		expect(html).not.toMatch(/<script/i);
		expect(html).not.toMatch(/<img/i);
		expect(html).not.toMatch(/<div/i);
		// ningún atributo de evento dentro de una etiqueta (el texto escapado no cuenta)
		expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i);
		expect(html.toLowerCase()).not.toContain('href="javascript:');
		expect(markdown).toBe(md);
		// y el texto no se pierde: lo que escribió el agente sigue estando
		expect(markdown.replace(/\\/g, "")).toContain(
			md.replace(/\\/g, "").split("\n")[0].slice(0, 12),
		);
	});
});

describe("HTML crudo: sobrevive a releer el HTML del editor (copiar, pegar)", () => {
	const extensions = buildExtensions({
		titleFor: () => undefined,
		exists: () => true,
	});
	const reread = (html: string) => {
		const again = new Editor({
			extensions,
			content: generateJSON(html, extensions),
		});
		const result = { markdown: again.getMarkdown(), html: again.getHTML() };
		again.destroy();
		return result;
	};
	it.each(HOSTILE.filter(({ md }) => md.includes("<")))("$name", ({ md }) => {
		const { html, markdown } = roundtrip(md);
		expect(html).toContain("&lt;");
		expect(markdown).toBe(md);
		expect(reread(html).markdown).toBe(md);
	});
	it("el link javascript: nunca vuelve con href, ni al releer", () => {
		const { html } = roundtrip("[clic](javascript:alert(1))");
		expect(reread(html).html.toLowerCase()).not.toContain("javascript:");
	});
});
