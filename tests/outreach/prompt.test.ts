import { describe, expect, it } from "vitest";
import { buildDraftPrompt } from "@/lib/outreach/prompt";

const input = {
	contact: {
		name: "Laura Gómez",
		company: "Acme",
		segment: "mid_market_ar",
		vector: "v1",
		hook: null,
		idioma: "es_ar",
	},
	ficha: {
		name: "Acme",
		domain: "acme.test",
		produce: "Envases",
		gana: null,
		compra: null,
		rompe_si_crece: "Coordinación",
		gap_declarado: null,
		gap_demostrable: null,
		hechos: [
			{
				hecho: "Abrió planta en Rafaela",
				url: "https://acme.test/n",
				fecha: "2026-03-01",
			},
		],
		creditos_usados: 0,
	},
	canon: [
		{
			tag: "canon:icp",
			slug: "comercial/icp",
			title: "ICP",
			body: "Industria mediana",
		},
	],
	voice: [
		{
			tag: "canon:voz",
			slug: "marketing/voz-ana",
			title: "Voz de Ana",
			body: "Frases cortas",
		},
	],
	allowed: { hooks: ["h1", "h2"], vectors: ["v1"], idiomas: ["es_ar"] },
	defaultHook: "h1",
	previousViolations: [
		{
			kind: "formula" as const,
			piece: "cuerpo" as const,
			what: 'fórmula vetada: "quedo a disposicion"',
			fix: "un ask con fecha",
		},
	],
};

describe("buildDraftPrompt", () => {
	it("incluye ficha con fuentes, canon, voz, listas cerradas y las violaciones a corregir", () => {
		const prompt = buildDraftPrompt(input);
		for (const fragment of [
			"Laura Gómez",
			"Abrió planta en Rafaela",
			"https://acme.test/n",
			"Industria mediana",
			"Frases cortas",
			"h1, h2",
			"hook por defecto del vector: h1",
			"quedo a disposicion",
			"es_ar",
		]) {
			expect(prompt).toContain(fragment);
		}
	});

	it("corta páginas largas del canon para no inflar el prompt", () => {
		const long = buildDraftPrompt({
			...input,
			canon: [
				{ tag: "canon:icp", slug: "x", title: "X", body: "a".repeat(10_000) },
			],
		});
		expect(long.length).toBeLessThan(9_000);
	});
});
