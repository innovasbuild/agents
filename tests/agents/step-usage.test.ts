import { describe, expect, it } from "vitest";
import { stepUsageEntry } from "@/lib/agents/step-usage";

const base = {
	tenantId: "t1",
	runId: "r1",
	agent: "outreach",
	modelId: "anthropic/claude-sonnet-5",
	stepIndex: 2,
};

describe("stepUsageEntry", () => {
	it("con costo informado, asienta ese monto con fuente gateway", () => {
		expect(
			stepUsageEntry({
				...base,
				usage: {
					costUsd: 0.0123,
					inputTokens: 1000,
					outputTokens: 200,
					cacheReadTokens: 800,
					cacheWriteTokens: 0,
				},
			}),
		).toEqual({
			tenantId: "t1",
			runId: "r1",
			workflow: null,
			node: "agent/step",
			resource: "model_usd",
			amount: 0.0123,
			unit: "usd",
			meta: {
				agent: "outreach",
				model: "anthropic/claude-sonnet-5",
				source: "gateway",
				inputTokens: 1000,
				outputTokens: 200,
				cacheReadTokens: 800,
				cacheWriteTokens: 0,
				stepIndex: 2,
			},
		});
	});

	it("sin costo, usa la tabla de precios", () => {
		const entry = stepUsageEntry({
			...base,
			usage: { inputTokens: 1_000_000, outputTokens: 0 },
		});
		expect(entry?.amount).toBe(2);
		expect(entry?.meta.source).toBe("tabla");
	});

	it("sin costo y sin modelo, asienta cero con fuente sin_precio", () => {
		const entry = stepUsageEntry({
			...base,
			modelId: null,
			usage: { inputTokens: 500, outputTokens: 10 },
		});
		expect(entry?.amount).toBe(0);
		expect(entry?.meta).toMatchObject({ source: "sin_precio", model: null });
	});

	it("sin corrida, asienta igual con run_id nulo", () => {
		const entry = stepUsageEntry({
			...base,
			runId: null,
			usage: { costUsd: 0.5 },
		});
		expect(entry).toMatchObject({ runId: null, amount: 0.5 });
	});

	it("sin usage, no hay asiento", () => {
		expect(stepUsageEntry({ ...base, usage: undefined })).toBeNull();
	});

	it("un costo negativo o no finito no se toma como informado", () => {
		const entry = stepUsageEntry({
			...base,
			usage: { costUsd: Number.NaN, inputTokens: 1_000_000 },
		});
		expect(entry?.meta.source).toBe("tabla");
	});

	it("con generationId, lo guarda en meta", () => {
		const entry = stepUsageEntry({
			...base,
			usage: { costUsd: 0.5 },
			generationId: "gen_abc",
		});
		expect(entry?.meta.generationId).toBe("gen_abc");
	});

	it("sin generationId (ausente, nulo o vacío), meta no lleva la clave", () => {
		for (const generationId of [undefined, null, ""]) {
			const entry = stepUsageEntry({
				...base,
				usage: { costUsd: 0.5 },
				generationId,
			});
			expect(entry?.meta).not.toHaveProperty("generationId");
		}
	});
});
