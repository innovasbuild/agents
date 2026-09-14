import { describe, expect, it } from "vitest";
import {
	compileVeto,
	emptyGateRules,
	mergeGateRules,
	parseGateBlocks,
} from "@/lib/outreach/gate-blocks";

const TEMPLATE = [
	"# Voz",
	"",
	"```gate",
	"# veto_literal: <frase que no dice nunca>        # alta YYYY-MM-DD",
	"# veto: <expresion regular>                      # alta YYYY-MM-DD",
	"# max_chars: <maximo propio, si difiere del canal>",
	"```",
].join("\n");

describe("parseGateBlocks", () => {
	it("la plantilla comentada de las bibliotecas de voz no aporta reglas ni errores", () => {
		expect(parseGateBlocks(TEMPLATE, "voz/ana")).toEqual(emptyGateRules());
	});

	it("lee vetos, max_chars, formal y comentarios de alta al final de la línea", () => {
		const md = [
			"```gate",
			"veto: clientes ... (banco mundial|bid|fao)   # alta 2026-09-15",
			"veto_literal: llave en mano",
			"max_chars: 900",
			"max_chars: email=700",
			"formal: true",
			"```",
			"texto fuera del bloque: veto: nada",
		].join("\n");
		expect(parseGateBlocks(md, "canon-gate")).toEqual({
			vetos: [
				{
					phrase: "clientes ... (banco mundial|bid|fao)",
					literal: false,
					source: "canon-gate",
				},
				{ phrase: "llave en mano", literal: true, source: "canon-gate" },
			],
			maxChars: { all: 900, byChannel: { email: 700 } },
			formal: true,
			errors: [],
		});
	});

	it("una directiva desconocida o mal escrita queda como error", () => {
		const rules = parseGateBlocks(
			"```gate\nprohibir: algo\nmax_chars: mucho\n```",
			"voz/ana",
		);
		expect(rules.errors).toEqual([
			'voz/ana: directiva del gate no reconocida: "prohibir: algo"',
			'voz/ana: directiva del gate no reconocida: "max_chars: mucho"',
		]);
	});
});

describe("mergeGateRules", () => {
	it("suma vetos y errores, se queda con el límite menor y con formal si alguno lo pide", () => {
		const tenant = parseGateBlocks(
			"```gate\nveto: bid\nmax_chars: email=900\n```",
			"canon-gate",
		);
		const executor = parseGateBlocks(
			"```gate\nveto_literal: sinergia\nmax_chars: email=600\nformal: true\n```",
			"voz/ana",
		);
		const merged = mergeGateRules(tenant, executor);
		expect(merged.vetos.map((v) => v.phrase)).toEqual(["bid", "sinergia"]);
		expect(merged.maxChars).toEqual({ all: null, byChannel: { email: 600 } });
		expect(merged.formal).toBe(true);
	});
});

describe("compileVeto", () => {
	const veto = (phrase: string, literal = false) => ({
		phrase,
		literal,
		source: "t",
	});

	it("compila alternativas y busca con límites de palabra sobre texto normalizado", () => {
		const re = compileVeto(veto("ejecutamos para (el Banco Mundial|BID|FAO)"));
		expect(re).not.toBeNull();
		expect(
			"ejecutamos para el banco mundial".match(re as RegExp),
		).not.toBeNull();
		expect("ejecutamos para bidones".match(re as RegExp)).toBeNull();
	});

	it("el hueco ... admite hasta 40 caracteres sin punto", () => {
		const re = compileVeto(veto("clientes ... (bid|fao)")) as RegExp;
		expect("clientes como el bid".match(re)).not.toBeNull();
		expect(`clientes ${"x".repeat(45)} bid`.match(re)).toBeNull();
		expect("clientes. el bid".match(re)).toBeNull();
	});

	it("un veto literal es un substring sin sintaxis", () => {
		const re = compileVeto(veto("(no) tan rápido", true)) as RegExp;
		expect("dijo (no) tan rapido".match(re)).not.toBeNull();
	});

	it("una frase mal formada devuelve null", () => {
		expect(compileVeto(veto("(bid"))).toBeNull();
		expect(compileVeto(veto("bid|fao"))).toBeNull();
		expect(compileVeto(veto("()"))).toBeNull();
		expect(compileVeto(veto("   "))).toBeNull();
	});
});
