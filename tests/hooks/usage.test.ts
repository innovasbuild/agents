import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	entries: [] as unknown[],
	runId: "run-1" as string | null,
	resolved: 0,
	runLookups: 0,
	failRecord: false,
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({}),
}));
vi.mock("../../lib/workflows/usage", () => ({
	createUsageRecorder: () => async (entry: unknown) => {
		if (calls.failRecord) throw new Error("db caída");
		calls.entries.push(entry);
	},
	resolveRunId: async () => {
		calls.runLookups++;
		return calls.runId;
	},
}));
vi.mock("../../lib/agents/model", () => ({
	resolveModelForTenant: async () => {
		calls.resolved++;
		return "anthropic/claude-sonnet-5";
	},
}));

const { default: hook } = await import("@/agents/outreach/hooks/usage");
// biome-ignore lint/suspicious/noExplicitAny: evento y ctx de eve simulados.
const events = (hook as any).events;

function ctx(tenantId: string | undefined, sessionId = "wrun_A") {
	return {
		agent: { name: "outreach" },
		session: {
			id: sessionId,
			auth: {
				current: { attributes: { tenantId, conversationId: "c1" } },
			},
		},
	};
}

const completed = (usage: unknown, stepIndex = 0) => ({
	data: { turnId: "turn-1", stepIndex, usage },
});

beforeEach(() => {
	calls.entries = [];
	calls.runId = "run-1";
	calls.resolved = 0;
	calls.runLookups = 0;
	calls.failRecord = false;
});

describe("hook de consumo del agente", () => {
	it("asienta el paso con el modelo que vio en step.started", async () => {
		await events["step.started"](
			{
				data: {
					turnId: "turn-1",
					stepIndex: 0,
					modelId: "anthropic/claude-opus-5",
				},
			},
			ctx("tenant-1"),
		);
		await events["step.completed"](
			completed({ costUsd: 0.2 }),
			ctx("tenant-1"),
		);
		expect(calls.entries).toEqual([
			expect.objectContaining({
				tenantId: "tenant-1",
				runId: "run-1",
				node: "agent/step",
				resource: "model_usd",
				amount: 0.2,
				meta: expect.objectContaining({
					agent: "outreach",
					model: "anthropic/claude-opus-5",
					source: "gateway",
				}),
			}),
		]);
		expect(calls.resolved).toBe(0);
	});

	it("sin modelo recordado y sin costo, lo resuelve para usar la tabla", async () => {
		await events["step.completed"](
			completed({ inputTokens: 1_000_000 }, 7),
			ctx("tenant-1"),
		);
		expect(calls.resolved).toBe(1);
		expect(calls.entries).toEqual([
			expect.objectContaining({
				amount: 2,
				meta: expect.objectContaining({ source: "tabla" }),
			}),
		]);
	});

	it("sin corrida encontrada, asienta igual", async () => {
		calls.runId = null;
		await events["step.completed"](
			completed({ costUsd: 0.1 }, 8),
			ctx("tenant-1", "wrun_sin_corrida"),
		);
		expect(calls.entries).toEqual([
			expect.objectContaining({ runId: null, amount: 0.1 }),
		]);
	});

	it("sin tenant no asienta", async () => {
		await events["step.completed"](
			completed({ costUsd: 0.1 }, 9),
			ctx(undefined),
		);
		expect(calls.entries).toEqual([]);
	});

	it("sin usage no asienta", async () => {
		await events["step.completed"](completed(undefined, 10), ctx("tenant-1"));
		expect(calls.entries).toEqual([]);
	});

	it("si asentar tira, el hook no tira", async () => {
		calls.failRecord = true;
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			events["step.completed"](
				completed({ costUsd: 0.1 }, 11),
				ctx("tenant-1"),
			),
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("pasa el id de generación del gateway al asiento", async () => {
		await events["step.completed"](
			{
				data: {
					turnId: "turn-gen",
					stepIndex: 0,
					usage: { costUsd: 0.1 },
					providerMetadata: { gateway: { generationId: "gen_123" } },
				},
			},
			ctx("tenant-1", "wrun_gen"),
		);
		expect(calls.entries).toEqual([
			expect.objectContaining({
				meta: expect.objectContaining({ generationId: "gen_123" }),
			}),
		]);
	});

	it("sin metadata del gateway, el asiento no lleva generationId", async () => {
		await events["step.completed"](
			{
				data: {
					turnId: "turn-nogen",
					stepIndex: 0,
					usage: { costUsd: 0.1 },
				},
			},
			ctx("tenant-1", "wrun_nogen"),
		);
		expect(calls.entries).toHaveLength(1);
		expect(
			(calls.entries[0] as { meta: Record<string, unknown> }).meta,
		).not.toHaveProperty("generationId");
	});

	it("busca la corrida una sola vez por turno", async () => {
		const c = ctx("tenant-1", "wrun_cache");
		const step = (turnId: string, stepIndex: number) => ({
			data: { turnId, stepIndex, usage: { costUsd: 0.1 } },
		});
		await events["step.completed"](step("turn-c1", 0), c);
		await events["step.completed"](step("turn-c1", 1), c);
		expect(calls.runLookups).toBe(1);
		expect(calls.entries).toEqual([
			expect.objectContaining({ runId: "run-1" }),
			expect.objectContaining({ runId: "run-1" }),
		]);
		await events["step.completed"](step("turn-c2", 0), c);
		expect(calls.runLookups).toBe(2);
	});

	it("una corrida no encontrada no se recuerda: el paso siguiente la busca otra vez", async () => {
		const c = ctx("tenant-1", "wrun_nullrun");
		const step = (stepIndex: number) => ({
			data: { turnId: "turn-n1", stepIndex, usage: { costUsd: 0.1 } },
		});
		calls.runId = null;
		await events["step.completed"](step(0), c);
		calls.runId = "run-late";
		await events["step.completed"](step(1), c);
		await events["step.completed"](step(2), c);
		expect(calls.runLookups).toBe(2);
		expect(calls.entries).toEqual([
			expect.objectContaining({ runId: null }),
			expect.objectContaining({ runId: "run-late" }),
			expect.objectContaining({ runId: "run-late" }),
		]);
	});

	it("al llegar al tope descarta el paso más viejo y conserva el resto", async () => {
		const c = ctx("tenant-1", "wrun_evict");
		const started = (stepIndex: number) => ({
			data: { turnId: "turn-e1", stepIndex, modelId: `modelo-${stepIndex}` },
		});
		const completed = (stepIndex: number) => ({
			data: {
				turnId: "turn-e1",
				stepIndex,
				usage: { inputTokens: 1_000_000 },
			},
		});
		for (let i = 0; i <= 500; i++) await events["step.started"](started(i), c);

		// El más viejo (0) se fue: sin modelo recordado se resuelve de nuevo.
		await events["step.completed"](completed(0), c);
		expect(calls.resolved).toBe(1);
		// El último (500) sigue: se asienta con el modelo que recordó.
		await events["step.completed"](completed(500), c);
		expect(calls.resolved).toBe(1);
		expect(calls.entries[1]).toMatchObject({
			meta: { model: "modelo-500" },
		});
		// Uno del medio también sobrevivió.
		await events["step.completed"](completed(250), c);
		expect(calls.resolved).toBe(1);
		expect(calls.entries[2]).toMatchObject({
			meta: { model: "modelo-250" },
		});
	});

	it("step.failed olvida el modelo recordado y no tira", async () => {
		const c = ctx("tenant-1", "wrun_failed");
		await events["step.started"](
			{ data: { turnId: "turn-f1", stepIndex: 0, modelId: "modelo-f" } },
			c,
		);
		await expect(
			events["step.failed"]({ data: { turnId: "turn-f1", stepIndex: 0 } }, c),
		).resolves.toBeUndefined();
		await events["step.completed"](
			{
				data: {
					turnId: "turn-f1",
					stepIndex: 0,
					usage: { inputTokens: 1_000_000 },
				},
			},
			c,
		);
		expect(calls.resolved).toBe(1);
	});
});
