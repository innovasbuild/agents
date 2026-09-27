import { describe, expect, it } from "vitest";
import { toMarkdownLinks } from "@/lib/brain/editor/markdown-links";

const titles: Record<string, string> = { "comercial/icp": "ICP" };
const titleFor = (slug: string) => titles[slug];

describe("toMarkdownLinks", () => {
	it("usa el alias, o el título, o el slug como texto", () => {
		expect(toMarkdownLinks("[[comercial/icp|el ICP]]", titleFor)).toBe(
			"[el ICP](wiki:comercial/icp)",
		);
		expect(toMarkdownLinks("[[comercial/icp]]", titleFor)).toBe(
			"[ICP](wiki:comercial/icp)",
		);
		expect(toMarkdownLinks("[[no/existe]]", titleFor)).toBe(
			"[no/existe](wiki:no/existe)",
		);
	});

	it("conserva el ancla", () => {
		expect(toMarkdownLinks("[[comercial/icp#tamaño|x]]", titleFor)).toBe(
			"[x](wiki:comercial/icp#tama%C3%B1o)",
		);
	});

	it("no toca wikilinks dentro de bloques de código ni de código inline", () => {
		const body =
			"```\n[[comercial/icp]]\n```\ny `[[comercial/icp]]` y [[comercial/icp]]";
		expect(toMarkdownLinks(body, titleFor)).toBe(
			"```\n[[comercial/icp]]\n```\ny `[[comercial/icp]]` y [ICP](wiki:comercial/icp)",
		);
	});

	it("escapa corchetes del texto visible", () => {
		expect(toMarkdownLinks("[[x]]", () => "Título [beta]")).toBe(
			"[Título \\[beta\\]](wiki:x)",
		);
	});
});
