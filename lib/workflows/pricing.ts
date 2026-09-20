// Costo en USD de una llamada al modelo (spec orquestación §7.2 y §13 S1).
// Fuente primaria: lo que informa el AI Gateway en providerMetadata (viene
// como string, confirmado en S1). Respaldo: esta tabla, en USD por millón de
// tokens (kickoff §3). La tabla no descuenta tokens cacheados: si se usa,
// sobreestima, que es el lado seguro para un tope.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
	"anthropic/claude-haiku-4.5": { input: 1, output: 5 },
	"anthropic/claude-sonnet-5": { input: 2, output: 10 },
	"anthropic/claude-opus-5": { input: 5, output: 25 },
	"anthropic/claude-fable-5.1": { input: 10, output: 50 },
};

export interface ModelCost {
	usd: number;
	source: "gateway" | "tabla" | "sin_precio";
	inputTokens: number;
	outputTokens: number;
}

function tokens(usage: unknown, key: "inputTokens" | "outputTokens"): number {
	if (typeof usage !== "object" || usage === null) return 0;
	const value = (usage as Record<string, unknown>)[key];
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: 0;
}

function gatewayCost(providerMetadata: unknown): number | null {
	if (typeof providerMetadata !== "object" || providerMetadata === null)
		return null;
	const gateway = (providerMetadata as Record<string, unknown>).gateway;
	if (typeof gateway !== "object" || gateway === null) return null;
	const raw = (gateway as Record<string, unknown>).cost;
	if (typeof raw !== "number" && typeof raw !== "string") return null;
	const cost = Number(raw);
	return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function modelCostUsd(args: {
	model: string;
	usage: unknown;
	providerMetadata: unknown;
}): ModelCost {
	const inputTokens = tokens(args.usage, "inputTokens");
	const outputTokens = tokens(args.usage, "outputTokens");
	const informed = gatewayCost(args.providerMetadata);
	if (informed !== null) {
		return { usd: informed, source: "gateway", inputTokens, outputTokens };
	}
	if (!Object.hasOwn(MODEL_PRICES, args.model)) {
		return { usd: 0, source: "sin_precio", inputTokens, outputTokens };
	}
	const price = MODEL_PRICES[args.model];
	return {
		usd: (inputTokens * price.input + outputTokens * price.output) / 1_000_000,
		source: "tabla",
		inputTokens,
		outputTokens,
	};
}
