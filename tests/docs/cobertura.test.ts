import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SIN_DOCUMENTAR } from "../../docs/_meta/cobertura.ts";
import { inventory, type Surface } from "../../scripts/docs/inventory.ts";
import {
	parsePrTable,
	parseSpecTable,
	splitPagesAndReason,
} from "../../scripts/docs/prs.ts";
import { listPages, mentions } from "../../scripts/docs/wiki.ts";

const ROOT = ".";
const inv = await inventory(ROOT);
const pages = await listPages(ROOT);

const MIN_MOTIVO = 10;
const ESTADOS = ["en curso", "cerrada", "descartada"];

const SPECS_TABLE = "docs/decisiones/README.md";
const PRS_TABLE = "docs/decisiones/prs.md";

const prose = pages
	.filter((p) => /^docs\/(arquitectura|dominios|guias)\//.test(p.path))
	.map((p) => p.text)
	.join("\n");

type Entry = { id: string; surface: Surface; needle: string };

function entries(): Entry[] {
	const afterAgent = (key: string) => key.slice(key.indexOf("/") + 1);
	const groups: [string, Surface[], (s: Surface) => string][] = [
		["tool", inv.tools, (s) => afterAgent(s.key)],
		["schedule", inv.schedules, (s) => afterAgent(s.key)],
		["node", inv.nodes, (s) => s.key],
		["workflow", inv.workflows, (s) => s.key],
		["table", inv.tables, (s) => s.key],
		["route", inv.routes, (s) => s.key],
		["provider", inv.providers, (s) => s.key],
		["env", inv.envVars, (s) => s.key],
	];
	return groups.flatMap(([kind, list, needle]) =>
		list.map((surface) => ({
			id: `${kind}:${surface.key}`,
			surface,
			needle: needle(surface),
		})),
	);
}

describe("cobertura de la wiki", () => {
	it("6 · toda spec tiene fila en decisiones/README.md y las cerradas nombran páginas", async () => {
		const rows = parseSpecTable(
			await readFile(SPECS_TABLE, "utf8"),
			SPECS_TABLE,
		);
		const bySpec = new Map(rows.map((row) => [row.spec, row]));
		const problems: string[] = [];
		for (const spec of inv.specs) {
			if (!bySpec.has(spec.path)) {
				problems.push(`${spec.path}: falta su fila en ${SPECS_TABLE}`);
			}
		}
		for (const row of rows) {
			if (!ESTADOS.includes(row.state)) {
				problems.push(
					`${row.spec}: estado "${row.state}" inválido (${ESTADOS.join(" · ")})`,
				);
			}
			if (row.state === "cerrada") {
				if (row.pages.length === 0) {
					problems.push(
						`${row.spec}: está cerrada pero no nombra páginas de la wiki`,
					);
				}
				for (const page of row.pages) {
					if (!existsSync(page))
						problems.push(`${row.spec}: la página ${page} no existe`);
				}
			}
		}
		expect(problems, problems.join("\n")).toEqual([]);
	});

	it("7 · todo PR del snapshot tiene fila y los feat: nombran páginas o un motivo", async () => {
		const snapshot: { number: number; title: string }[] = JSON.parse(
			await readFile("docs/_meta/prs.json", "utf8"),
		);
		const rows = parsePrTable(await readFile(PRS_TABLE, "utf8"));
		const byNumber = new Map(rows.map((row) => [row.number, row]));
		const problems: string[] = [];
		for (const pr of snapshot) {
			const row = byNumber.get(pr.number);
			if (!row) {
				problems.push(
					`PR ${pr.number} (${pr.title}): falta su fila en ${PRS_TABLE}`,
				);
				continue;
			}
			const { pages: named, reason } = splitPagesAndReason(
				row.pagesOrReason,
				PRS_TABLE,
			);
			for (const page of named) {
				if (!existsSync(page))
					problems.push(`PR ${pr.number}: la página ${page} no existe`);
			}
			const isFeat = /^feat(\(.+\))?:/i.test(pr.title);
			if (
				isFeat &&
				!named.some((p) => existsSync(p)) &&
				reason.length < MIN_MOTIVO
			) {
				problems.push(
					`PR ${pr.number} (${pr.title}): es feat: y necesita una página que exista o un motivo de ${MIN_MOTIVO} caracteres o más`,
				);
			}
		}
		expect(problems, problems.join("\n")).toEqual([]);
	});

	it("8 · toda superficie está mencionada en arquitectura/, dominios/ o guias/, o excluida con motivo", () => {
		const missing = entries()
			.filter((e) => !mentions(prose, e.needle) && !(e.id in SIN_DOCUMENTAR))
			.map(
				(e) =>
					`${e.id}: no aparece en la wiki. Documentala en la página que corresponde o agregala a docs/_meta/cobertura.ts con un motivo`,
			);
		expect(missing, missing.join("\n")).toEqual([]);
	});

	it("9 · SIN_DOCUMENTAR no guarda nada que ya no exista y todo tiene motivo", () => {
		const existing = new Set(entries().map((e) => e.id));
		const problems: string[] = [];
		for (const [id, motivo] of Object.entries(SIN_DOCUMENTAR)) {
			if (!existing.has(id))
				problems.push(
					`${id}: ya no existe en el disco, sacalo de cobertura.ts`,
				);
			if (motivo.trim().length < MIN_MOTIVO) {
				problems.push(
					`${id}: el motivo tiene que tener ${MIN_MOTIVO} caracteres o más`,
				);
			}
		}
		expect(problems, problems.join("\n")).toEqual([]);
	});
});
