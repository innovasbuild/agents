import { describe, expect, it } from "vitest";
import {
	parsePrTable,
	parseSpecTable,
	parseTable,
	splitPagesAndReason,
} from "../../scripts/docs/prs.ts";

const specs = `
| fecha | etapa | spec | plan | estado | páginas |
| --- | --- | --- | --- | --- | --- |
| 2026-09-13 | brain | [brain](../superpowers/specs/a.md) | [plan](../superpowers/plans/a.md) | cerrada | [Brain](../dominios/brain.md) · [Datos](../arquitectura/datos.md) |
| 2026-10-13 | wiki | [wiki](../superpowers/specs/b.md) |  | en curso |  |
`;

describe("parsers de las tablas de decisiones", () => {
	it("parseTable salta encabezado y separador", () => {
		expect(parseTable(specs)).toHaveLength(2);
	});

	it("parseSpecTable resuelve links desde la tabla", () => {
		const rows = parseSpecTable(specs, "docs/decisiones/README.md");
		expect(rows[0].spec).toBe("docs/superpowers/specs/a.md");
		expect(rows[0].state).toBe("cerrada");
		expect(rows[0].pages).toEqual([
			"docs/dominios/brain.md",
			"docs/arquitectura/datos.md",
		]);
		expect(rows[1].plan).toBe("");
		expect(rows[1].pages).toEqual([]);
	});

	it("parsePrTable toma el número del link", () => {
		const text = `| # | fecha | título | páginas o motivo |
| --- | --- | --- | --- |
| [92](https://github.com/o/r/pull/92) | 2026-10-13 | docs: wiki | chore de documentación |`;
		expect(parsePrTable(text)).toEqual([
			{
				number: 92,
				date: "2026-10-13",
				title: "docs: wiki",
				pagesOrReason: "chore de documentación",
			},
		]);
	});

	it("splitPagesAndReason separa links del motivo", () => {
		expect(
			splitPagesAndReason(
				"[Brain](../dominios/brain.md) · fix menor",
				"docs/decisiones/prs.md",
			),
		).toEqual({
			pages: ["docs/dominios/brain.md"],
			reason: "fix menor",
		});
	});
});
