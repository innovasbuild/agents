import { describe, expect, it } from "vitest";
import { parseWikiConfig } from "@/lib/brain/config";

const valid = {
	categories: ["company", "comercial"],
	requiredFrontmatter: ["updated"],
	search: "fts",
};

describe("parseWikiConfig", () => {
	it("acepta una configuración completa", () => {
		expect(parseWikiConfig(valid)).toEqual({
			...valid,
			mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
		});
	});

	it("completa requiredFrontmatter y search por defecto", () => {
		expect(parseWikiConfig({ categories: ["company"] })).toEqual({
			categories: ["company"],
			requiredFrontmatter: [],
			search: "fts",
			mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
		});
	});

	it("acepta mcpLimits", () => {
		expect(
			parseWikiConfig({
				categories: ["comercial"],
				mcpLimits: { writesPerMinute: 5 },
			}).mcpLimits,
		).toEqual({ readsPerMinute: 60, writesPerMinute: 5 });
	});

	it("rechaza algo que no es objeto", () => {
		expect(() => parseWikiConfig([])).toThrow(/objeto/);
		expect(() => parseWikiConfig(null)).toThrow(/objeto/);
	});

	it("rechaza categorías vacías, inválidas o repetidas", () => {
		expect(() => parseWikiConfig({ categories: [] })).toThrow(/categories/);
		expect(() => parseWikiConfig({ categories: ["Comercial"] })).toThrow(
			/categories/,
		);
		expect(() => parseWikiConfig({ categories: ["a", "a"] })).toThrow(
			/repetidos/,
		);
	});

	it("rechaza búsqueda no construida", () => {
		expect(() => parseWikiConfig({ ...valid, search: "hybrid" })).toThrow(
			/fts/,
		);
	});

	it("rechaza claves desconocidas, incluidas las que parecen secretos", () => {
		expect(() => parseWikiConfig({ ...valid, apiKey: "x" })).toThrow(/apiKey/);
	});
});
