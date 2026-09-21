// Llamadas a Jev por el AI Gateway (spec etapa 13 §7.1). Se lee defensivo:
// la doc de Vercel y la de TypeSafe difieren en dónde vive `confidence` (S1).
//
// Import de tipo solamente: acá no se llama a `evaluate` como valor, se
// inyecta desde afuera vía `deps.evaluate` (igual que `generateDraft` con
// `generateText`). Por eso este archivo no necesita `metered`: la medición
// se engancha en la puerta que arma esas deps.
// @ts-expect-error "ai"@7.0.98 (la instalada en este worktree) todavía no
// expone `experimental_evaluate` en sus tipos — ver scripts/spike-jev.mts.
// Cuando la versión instalada lo incluya, este import deja de necesitar el
// supresor y hay que sacarlo.
import type { experimental_evaluate as evaluate } from "ai";

export interface JevScore {
	score: number;
	confidence: number;
	probabilities: Record<string, number>;
}

export interface JevNoul {
	probability: number;
}

type Row = Record<string, unknown>;

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

function confidenceFromMeta(
	providerMetadata: unknown,
	key: string,
): number | null {
	const typesafe = (providerMetadata as Row | undefined)?.typesafe as
		| Row
		| undefined;
	const confidence = typesafe?.confidence;
	if (typeof confidence === "number") return confidence;
	const byKey = (confidence as Row | undefined)?.[key];
	return typeof byKey === "number" ? byKey : null;
}

export function readScore(
	answers: Row,
	providerMetadata: unknown,
	key: string,
): JevScore | null {
	const answer = answers[key] as Row | undefined;
	if (!answer || answer.type !== "score") return null;
	if (typeof answer.score !== "number") return null;
	return {
		score: answer.score,
		// Sin confianza en ningún lado vale 0: se trata como baja y va al carril
		// humano. Nunca al revés.
		confidence: numberOr(
			answer.confidence ?? confidenceFromMeta(providerMetadata, key),
			0,
		),
		probabilities: (answer.probabilities as Record<string, number>) ?? {},
	};
}

export function readNoul(answers: Row, key: string): JevNoul | null {
	const answer = answers[key] as Row | undefined;
	if (!answer || answer.type !== "noul") return null;
	const probability = answer.noul ?? answer.probability;
	return typeof probability === "number" ? { probability } : null;
}

export interface EvaluationArgs {
	model: string;
	state: unknown;
	questions: Record<string, unknown>;
}

/**
 * `evaluate` inyectado para poder probar sin llamar al modelo. `usage` y
 * `providerMetadata` viajan para que la puerta los asiente con `metered`.
 */
export async function runEvaluation(
	args: EvaluationArgs,
	deps: { evaluate: typeof evaluate; abortSignal?: AbortSignal },
): Promise<{ answers: Row; usage: unknown; providerMetadata: unknown }> {
	const result = await deps.evaluate({
		model: args.model,
		state: args.state,
		questions: args.questions,
		abortSignal: deps.abortSignal,
		// Datos personales de terceros pasando por un modelo.
		providerOptions: { gateway: { zeroDataRetention: true } },
	} as Parameters<typeof evaluate>[0]);

	return {
		answers: (result.answers ?? {}) as Row,
		usage: result.usage,
		providerMetadata: result.providerMetadata,
	};
}
