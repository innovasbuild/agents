import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	entries: [] as unknown[],
	runId: "run-1" as string | null,
	resolved: 0,
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
	resolveRunId: async () => calls.runId,
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

function ctx(tenantId: string | undefined) {
	return {
		agent: { name: "outreach" },
		session: {
			id: "wrun_A",
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
			ctx("tenant-1"),
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
});
