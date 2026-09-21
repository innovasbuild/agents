import { describe, expect, it } from "vitest";
import { DEFAULT_OUTREACH_MODELS } from "@/lib/outreach/config";
import { MODEL_PRICES, modelCostUsd } from "@/lib/workflows/pricing";

const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };

describe("modelCostUsd", () => {
	it("usa el costo que informa el Gateway cuando viene", () => {
		const cost = modelCostUsd({
			model: "anthropic/claude-opus-5",
			usage,
			providerMetadata: { gateway: { cost: 0.0421 } },
		});
		expect(cost).toEqual({
			usd: 0.0421,
			source: "gateway",
			inputTokens: 1_000_000,
			outputTokens: 100_000,
		});
	});

	it("acepta el costo del Gateway como string numérico, que es como viene de verdad", () => {
		// Spike S1: el Gateway devuelve "0.000033", no 0.000033.
		const cost = modelCostUsd({
			model: "anthropic/claude-haiku-4.5",
			usage: { inputTokens: 13, outputTokens: 4 },
			providerMetadata: { gateway: { cost: "0.000033" } },
		});
		expect(cost.usd).toBe(0.000033);
		expect(cost.source).toBe("gateway");
	});

	it("sin costo del Gateway calcula con la tabla de precios", () => {
		// Opus 5: 5 USD por millón de entrada, 25 por millón de salida.
		const cost = modelCostUsd({
			model: "anthropic/claude-opus-5",
			usage,
			providerMetadata: undefined,
		});
		expect(cost.usd).toBeCloseTo(5 + 2.5, 6);
		expect(cost.source).toBe("tabla");
	});

	it("la tabla coincide con lo que cobró el Gateway en el spike", () => {
		// 13 de entrada y 4 de salida con Haiku 4.5 costaron 0.000033 (S1).
		const cost = modelCostUsd({
			model: "anthropic/claude-haiku-4.5",
			usage: { inputTokens: 13, outputTokens: 4 },
			providerMetadata: undefined,
		});
		expect(cost.usd).toBeCloseTo(0.000033, 9);
	});

	it.each([-1, Number.NaN, "abc", null, {}])(
		"ignora un costo del Gateway inválido (%s) y cae en la tabla",
		(bad) => {
			const cost = modelCostUsd({
				model: "anthropic/claude-haiku-4.5",
				usage,
				providerMetadata: { gateway: { cost: bad } },
			});
			expect(cost.source).toBe("tabla");
		},
	);

	it("un modelo sin precio cuesta 0 y lo dice", () => {
		const cost = modelCostUsd({
			model: "otro/modelo-raro",
			usage,
			providerMetadata: undefined,
		});
		expect(cost).toMatchObject({ usd: 0, source: "sin_precio" });
	});

	it("un usage roto no rompe: cuenta cero tokens", () => {
		const cost = modelCostUsd({
			model: "anthropic/claude-haiku-4.5",
			usage: null,
			providerMetadata: undefined,
		});
		expect(cost).toMatchObject({ usd: 0, inputTokens: 0, outputTokens: 0 });
	});

	it("todo modelo default de outreach tiene precio", () => {
		// Spec §13 S1: si un modelo en uso no tiene precio y el Gateway no
		// informa, el consumo se asienta en cero y el presupuesto deja de
		// proteger. Esto tiene que fallar antes.
		const sinPrecio = Object.values(DEFAULT_OUTREACH_MODELS).filter(
			(model) => !Object.hasOwn(MODEL_PRICES, model),
		);
		expect(sinPrecio).toEqual([]);
	});
});
