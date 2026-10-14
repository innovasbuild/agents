// Convierte un `step.completed` de eve en un asiento de consumo (spec 21.5
// §3). Es lo que mete en el libro los pasos del propio agente, que `metered`
// no ve. Imports relativos: lo usa un hook de eve.
import { modelCostUsd } from "../workflows/pricing";
import type { UsageEntry } from "../workflows/usage";

export interface StepUsage {
	costUsd?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}

const count = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function stepUsageEntry(input: {
	tenantId: string;
	runId: string | null;
	agent: string;
	modelId: string | null;
	stepIndex: number;
	usage: StepUsage | undefined;
	// Id de la generación en el gateway (providerMetadata.gateway.generationId
	// del step.completed). Distingue un evento reentregado de una llamada
	// reintentada de verdad, y deja conciliar por generación.
	generationId?: string | null;
}): UsageEntry | null {
	const { usage } = input;
	if (!usage) return null;

	const informed =
		typeof usage.costUsd === "number" &&
		Number.isFinite(usage.costUsd) &&
		usage.costUsd >= 0
			? usage.costUsd
			: null;
	// El costo de eve sale de providerMetadata.gateway.cost. Sin él, la tabla
	// (que sobreestima porque no descuenta caché) es el lado seguro.
	const table = modelCostUsd({
		model: input.modelId ?? "",
		usage,
		providerMetadata: undefined,
	});

	return {
		tenantId: input.tenantId,
		runId: input.runId,
		workflow: null,
		node: "agent/step",
		resource: "model_usd",
		amount: informed ?? table.usd,
		unit: "usd",
		meta: {
			agent: input.agent,
			model: input.modelId,
			source: informed === null ? table.source : "gateway",
			inputTokens: count(usage.inputTokens),
			outputTokens: count(usage.outputTokens),
			cacheReadTokens: count(usage.cacheReadTokens),
			cacheWriteTokens: count(usage.cacheWriteTokens),
			stepIndex: input.stepIndex,
			...(input.generationId ? { generationId: input.generationId } : {}),
		},
	};
}
