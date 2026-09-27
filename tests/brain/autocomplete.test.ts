import { describe, expect, it } from "vitest";
import {
	insertWikilink,
	sanitizeAlias,
	wikilinkQueryAt,
} from "@/lib/brain/editor/autocomplete";

describe("wikilinkQueryAt", () => {
	it("detecta un [[ abierto antes del cursor", () => {
		const text = "ver [[comer";
		expect(wikilinkQueryAt(text, text.length)).toEqual({
			start: 4,
			query: "comer",
		});
	});

	it("no detecta si el [[ ya se cerró o hay salto de línea", () => {
		expect(wikilinkQueryAt("[[a]] b", 7)).toBeNull();
		expect(wikilinkQueryAt("[[a\nb", 5)).toBeNull();
		expect(wikilinkQueryAt("sin nada", 8)).toBeNull();
	});
});

describe("sanitizeAlias", () => {
	it("saca corchetes y barras que romperían el wikilink", () => {
		expect(sanitizeAlias("Radar [beta] | v2")).toBe("Radar beta v2");
	});
});

describe("insertWikilink", () => {
	it("reemplaza el [[consulta por el wikilink completo y deja el cursor después", () => {
		const text = "ver [[comer y más";
		const result = insertWikilink(text, 4, 11, "comercial/icp", "ICP [v2]");
		expect(result.text).toBe("ver [[comercial/icp|ICP v2]] y más");
		expect(result.cursor).toBe("ver [[comercial/icp|ICP v2]]".length);
	});
});
