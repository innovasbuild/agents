import { describe, expect, it } from "vitest";
import { toMarkdownLinks } from "@/lib/brain/core/editor/markdown-links";

const titles: Record<string, string> = { "comercial/icp": "ICP" };
const titleFor = (slug: string) => titles[slug];

describe("toMarkdownLinks", () => {
	it("usa el alias, o el título, o el slug como texto", () => {
		expect(toMarkdownLinks("[[comercial/icp|el ICP]]", titleFor)).toBe(
			"[el ICP](<wiki:comercial/icp>)",
		);
		expect(toMarkdownLinks("[[comercial/icp]]", titleFor)).toBe(
			"[ICP](<wiki:comercial/icp>)",
		);
		expect(toMarkdownLinks("[[no/existe]]", titleFor)).toBe(
			"[no/existe](<wiki:no/existe>)",
		);
	});

	it("conserva el ancla", () => {
		expect(toMarkdownLinks("[[comercial/icp#tamaño|x]]", titleFor)).toBe(
			"[x](<wiki:comercial/icp#tamaño>)",
		);
	});

	it("no toca wikilinks dentro de bloques de código ni de código inline", () => {
		const body =
			"```\n[[comercial/icp]]\n```\ny `[[comercial/icp]]` y [[comercial/icp]]";
		expect(toMarkdownLinks(body, titleFor)).toBe(
			"```\n[[comercial/icp]]\n```\ny `[[comercial/icp]]` y [ICP](<wiki:comercial/icp>)",
		);
	});

	it("escapa corchetes del texto visible", () => {
		expect(toMarkdownLinks("[[x]]", () => "Título [beta]")).toBe(
			"[Título \\[beta\\]](<wiki:x>)",
		);
	});

	it("un target con espacios (wikilink a mano, sin resolver) queda como un link parseable, no como texto plano", () => {
		// Un wikilink escrito a mano con un nombre que no es slug (spec editor
		// §4.1) tiene que llegar a <BrainMarkdown> como link roto, no como texto
		// literal: sin < > alrededor del destino, un espacio corta el link para
		// el parser de markdown.
		expect(toMarkdownLinks("[[Pagina Vieja]]", titleFor)).toBe(
			"[Pagina Vieja](<wiki:Pagina Vieja>)",
		);
	});

	it("escapa < > y barra dentro del destino, y la barra también en el texto visible", () => {
		expect(toMarkdownLinks("[[a<b>c\\d]]", titleFor)).toBe(
			"[a<b>c\\\\d](<wiki:a\\<b\\>c\\\\d>)",
		);
	});
});
