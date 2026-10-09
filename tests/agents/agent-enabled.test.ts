import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	result: {
		data: { enabled: boolean } | null;
		error: { message: string } | null;
	};
	calls: unknown[][];
} = { result: { data: null, error: null }, calls: [] };

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: (table: string) => {
			state.calls.push(["from", table]);
			const query = {
				select: (columns: string) => {
					state.calls.push(["select", columns]);
					return query;
				},
				eq: (column: string, value: unknown) => {
					state.calls.push(["eq", column, value]);
					return query;
				},
				maybeSingle: async () => state.result,
			};
			return query;
		},
	}),
}));

const { loadAgentEnabled } = await import("@/lib/agents/agent-enabled");

describe("loadAgentEnabled", () => {
	beforeEach(() => {
		state.calls = [];
		state.result = { data: null, error: null };
	});

	it("prendido devuelve true y filtra por tenant y agente", async () => {
		state.result = { data: { enabled: true }, error: null };

		expect(await loadAgentEnabled("tenant-a", "outreach")).toBe(true);
		expect(state.calls).toEqual([
			["from", "tenant_agents"],
			["select", "enabled"],
			["eq", "tenant_id", "tenant-a"],
			["eq", "agent", "outreach"],
		]);
	});

	it("apagado devuelve false", async () => {
		state.result = { data: { enabled: false }, error: null };
		expect(await loadAgentEnabled("tenant-a", "outreach")).toBe(false);
	});

	it("sin fila devuelve false: un agente no dado de alta no está habilitado", async () => {
		expect(await loadAgentEnabled("tenant-a", "outreach")).toBe(false);
	});

	it("un error de la base tira: quien llama decide fallar cerrado", async () => {
		state.result = { data: null, error: { message: "timeout" } };
		await expect(loadAgentEnabled("tenant-a", "outreach")).rejects.toThrow(
			"timeout",
		);
	});
});
