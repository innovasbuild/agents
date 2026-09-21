import { describe, expect, it } from "vitest";
import { readNoul, readScore } from "@/lib/outreach/services/evaluate";

describe("readScore", () => {
	it("lee confidence de adentro de la answer", () => {
		const answers = {
			encaje: {
				type: "score",
				score: 1.8,
				confidence: 0.91,
				probabilities: { "0": 0, "1": 0.2, "2": 0.8 },
			},
		};
		expect(readScore(answers, undefined, "encaje")).toEqual({
			score: 1.8,
			confidence: 0.91,
			probabilities: { "0": 0, "1": 0.2, "2": 0.8 },
		});
	});

	it("lee confidence de providerMetadata.typesafe cuando no viene en la answer", () => {
		// Las dos docs difieren en dónde vive: se lee de los dos lados (S1).
		const answers = {
			encaje: {
				type: "score",
				score: 1.8,
				probabilities: { "1": 0.2, "2": 0.8 },
			},
		};
		const meta = { typesafe: { confidence: { encaje: 0.77 } } };
		expect(readScore(answers, meta, "encaje")?.confidence).toBe(0.77);
	});

	it("sin confianza en ningún lado devuelve 0: se trata como baja, no como alta", () => {
		const answers = { encaje: { type: "score", score: 2, probabilities: {} } };
		expect(readScore(answers, undefined, "encaje")?.confidence).toBe(0);
	});

	it("una answer que no está o no es score devuelve null", () => {
		expect(readScore({}, undefined, "encaje")).toBeNull();
		expect(
			readScore({ encaje: { type: "noul", noul: 0.9 } }, undefined, "encaje"),
		).toBeNull();
	});
});

describe("readNoul", () => {
	it("lee la probabilidad, venga como noul o como probability", () => {
		expect(
			readNoul({ excluir: { type: "noul", noul: 0.93 } }, "excluir"),
		).toEqual({
			probability: 0.93,
		});
		expect(
			readNoul({ excluir: { type: "noul", probability: 0.4 } }, "excluir"),
		).toEqual({ probability: 0.4 });
	});

	it("una forma inesperada devuelve null en vez de inventar un número", () => {
		expect(readNoul({ excluir: { type: "noul" } }, "excluir")).toBeNull();
	});
});
