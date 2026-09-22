import { describe, expect, it } from "vitest";
import { DEFAULT_ICP_THRESHOLDS, decideIcp } from "@/lib/outreach/icp";

const alto = { score: 1.8, confidence: 0.9, probabilities: {} };
const bajo = { score: 0.4, confidence: 0.9, probabilities: {} };
const inseguro = { score: 1.9, confidence: 0.4, probabilities: {} };
const sinExcluir = { probability: 0.05 };

describe("decideIcp", () => {
	it("puntaje alto, rol alto y confianza alta: califica", () => {
		expect(
			decideIcp(
				{ encaje: alto, rol: alto, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "calificado" });
	});

	it("puntaje bajo con confianza alta: descarta sin gastar", () => {
		expect(
			decideIcp(
				{ encaje: bajo, rol: alto, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "descartado", reason: "encaje_bajo" });
	});

	it("excluir alto gana sobre cualquier puntaje", () => {
		expect(
			decideIcp(
				{ encaje: alto, rol: alto, excluir: { probability: 0.95 } },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "descartado", reason: "excluido" });
	});

	it("confianza baja en la dimensión que decide: va a revisión, no descarta", () => {
		expect(
			decideIcp(
				{ encaje: inseguro, rol: alto, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "para_revisar", reason: "confianza_baja" });
	});

	it("la confianza que manda es la mínima de las dimensiones que se usaron", () => {
		// Encaje seguro pero rol inseguro: la decisión usa las dos, así que revisa.
		expect(
			decideIcp(
				{ encaje: alto, rol: { score: 1.5, confidence: 0.3, probabilities: {} }, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "para_revisar" });
	});

	it("un excluir inseguro no descarta: revisa", () => {
		expect(
			decideIcp(
				{ encaje: alto, rol: alto, excluir: { probability: 0.6 } },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "para_revisar" });
	});

	it("un juicio que no vino va a revisión, nunca a calificado", () => {
		expect(
			decideIcp(
				{ encaje: null, rol: alto, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "para_revisar", reason: "juicio_incompleto" });
	});

	it("rol bajo con confianza alta descarta", () => {
		expect(
			decideIcp(
				{ encaje: alto, rol: { score: 0.2, confidence: 0.95, probabilities: {} }, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "descartado", reason: "rol_bajo" });
	});
});
