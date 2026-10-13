import { describe, expect, it } from "vitest";
import {
	extractLinks,
	parseFrontmatter,
	reachableFrom,
	resolveLink,
} from "../../scripts/docs/wiki.ts";

describe("helpers de la wiki", () => {
	it("parseFrontmatter separa el yaml del cuerpo", () => {
		const parsed = parseFrontmatter(
			"---\ntitle: X\nupdated: 2026-10-13\n---\n# Hola",
		);
		expect(parsed?.data).toEqual({ title: "X", updated: "2026-10-13" });
		expect(parsed?.body).toBe("# Hola");
		expect(parseFrontmatter("# sin frontmatter")).toBeNull();
	});

	it("extractLinks ignora el código", () => {
		const text =
			"[a](x.md#ancla) y `[b](no.md)`\n```\n[c](tampoco.md)\n```\n[d](https://e.com)";
		expect(extractLinks(text)).toEqual(["x.md#ancla", "https://e.com"]);
	});

	it("resolveLink resuelve relativo al archivo", () => {
		expect(resolveLink("docs/guias/a.md", "../arquitectura/b.md#x")).toBe(
			"docs/arquitectura/b.md",
		);
		expect(resolveLink("docs/README.md", "guias/a.md")).toBe("docs/guias/a.md");
	});

	it("reachableFrom sigue los links desde el índice", () => {
		const pages = [
			{ path: "docs/README.md", text: "[a](a.md)" },
			{ path: "docs/a.md", text: "[b](b.md)" },
			{ path: "docs/b.md", text: "" },
			{ path: "docs/huerfana.md", text: "" },
		];
		expect([...reachableFrom("docs/README.md", pages)].sort()).toEqual([
			"docs/README.md",
			"docs/a.md",
			"docs/b.md",
		]);
	});
});
