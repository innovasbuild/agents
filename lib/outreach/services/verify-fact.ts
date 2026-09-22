// Nodo outreach/verify-fact (spec etapa 13 §5.2): una pregunta boolean a Jev
// sobre si el texto de la fuente respalda el hecho que draft_message citó
// como ancla. Corre después de draft_message, sobre su ancla — nunca sobre
// la ficha entera (verificar lo que nunca sale es pagar de más).
import { readNoul } from "./evaluate";

export const JEV_MODEL = "typesafe-ai/jev";

export interface VerifyFactDeps {
	evaluate: (args: {
		model: string;
		state: unknown;
		questions: Record<string, unknown>;
	}) => Promise<{ answers: Record<string, unknown>; usage: unknown; providerMetadata: unknown }>;
	/** Relee la fuente citada; null si no se pudo (offline, 404, bloqueada). */
	readPage: (url: string) => Promise<string | null>;
}

export async function verifyFact(
	ancla: { hecho: string; fuente: string },
	deps: VerifyFactDeps,
): Promise<{ verified: boolean; confidence: number }> {
	const texto = await deps.readPage(ancla.fuente);
	if (!texto) return { verified: false, confidence: 0 };

	const { answers } = await deps.evaluate({
		model: JEV_MODEL,
		state: { hecho: ancla.hecho, texto_de_la_fuente: texto.slice(0, 4000) },
		questions: {
			verificado: {
				type: "boolean",
				instructions: "¿El texto de la fuente respalda, de forma directa, el hecho descrito?",
			},
		},
	});
	const noul = readNoul(answers, "verificado");
	if (!noul) return { verified: false, confidence: 0 };
	return { verified: noul.probability >= 0.5, confidence: noul.probability };
}
