import { describe, expect, it } from "vitest";
import { verifyFact } from "@/lib/outreach/services/verify-fact";

function deps(answer: unknown) {
	return {
		evaluate: async () => ({
			answers: { verificado: answer },
			usage: { inputTokens: 300, outputTokens: 10 },
			providerMetadata: {},
		}),
		readPage: async () => "Acme abrió una segunda planta en Rosario este año, según su propio comunicado.",
	};
}

describe("verifyFact", () => {
	it("un hecho que la fuente respalda queda verificado", async () => {
		const result = await verifyFact(
			{ hecho: "Acme abrió una segunda planta", fuente: "https://acme.test/news" },
			deps({ type: "boolean", probability: 0.92 }),
		);
		expect(result).toEqual({ verified: true, confidence: 0.92 });
	});

	it("un hecho que la fuente no respalda queda sin verificar", async () => {
		const result = await verifyFact(
			{ hecho: "Acme cotiza en bolsa", fuente: "https://acme.test/news" },
			deps({ type: "boolean", probability: 0.1 }),
		);
		expect(result).toEqual({ verified: false, confidence: 0.1 });
	});

	it("sin poder releer la fuente, no verificado — nunca a ciegas", async () => {
		const result = await verifyFact(
			{ hecho: "Acme abrió una planta", fuente: "https://acme.test/news" },
			{ ...deps({ type: "boolean", probability: 0.9 }), readPage: async () => null },
		);
		expect(result).toEqual({ verified: false, confidence: 0 });
	});

	it("una respuesta con forma inesperada no verifica", async () => {
		const result = await verifyFact(
			{ hecho: "x", fuente: "https://acme.test/news" },
			deps({ type: "score", score: 1 }),
		);
		expect(result).toEqual({ verified: false, confidence: 0 });
	});
});
