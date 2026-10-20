import { describe, expect, it } from "vitest";
import {
	parseMergeLog,
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

	it("parseTable tolera pipes escapados, CRLF y filas cortas", () => {
		const text =
			"| a | b |\r\n| --- | --- |\r\n| x \\| y | z |\r\n| solo |\r\n";
		expect(parseTable(text)).toEqual([["x | y", "z"], ["solo"]]);
	});

	it("parsePrTable salta filas sin número y parseSpecTable deja vacío un link externo", () => {
		const prs =
			"| # | f | t | p |\n| --- | --- | --- | --- |\n| sin número | 2026 | x | y |\n";
		expect(parsePrTable(prs)).toEqual([]);
		const specs =
			"| f | e | s | p | estado | pg |\n| --- | --- | --- | --- | --- | --- |\n| 2026 | x | [s](https://e.com/a.md) |  | en curso |  |\n";
		expect(parseSpecTable(specs, "docs/decisiones/README.md")[0].spec).toBe("");
	});
});

describe("parseMergeLog", () => {
	const sep = "\x1f";
	const end = "\x1e";

	it("toma el número del asunto y el título del cuerpo del merge de GitHub", () => {
		const log = [
			`Merge pull request #127 from innovasbuild/docs/filas${sep}docs: filas de los PR 114 a 125\n${end}`,
			`\nMerge pull request #126 from innovasbuild/feat/x${sep}v0.5.0 feat: subir una skill desde un zip\n${end}`,
		].join("");
		expect(parseMergeLog(log)).toEqual([
			{ number: 127, title: "docs: filas de los PR 114 a 125" },
			{ number: 126, title: "v0.5.0 feat: subir una skill desde un zip" },
		]);
	});

	it("ignora los merges que no son de un PR y los cuerpos largos", () => {
		const log = [
			`Merge branch 'main' into feat/x${sep}${end}`,
			`merge: main en docs/x${sep}Conflictos resueltos: algo.\n${end}`,
			`Merge remote-tracking branch 'origin/main' into feat/y${sep}# Conflicts:\n#\tlib/a.ts\n${end}`,
			`Merge pull request #9 from a/b${sep}fix: un arreglo\n\nCuerpo largo que no es el título.\n${end}`,
		].join("");
		expect(parseMergeLog(log)).toEqual([
			{ number: 9, title: "fix: un arreglo" },
		]);
	});

	it("sin cuerpo, el título queda vacío y el número igual cuenta", () => {
		expect(parseMergeLog(`Merge pull request #5 from a/b${sep}${end}`)).toEqual(
			[{ number: 5, title: "" }],
		);
	});

	it("un log vacío no devuelve nada", () => {
		expect(parseMergeLog("")).toEqual([]);
	});
});
