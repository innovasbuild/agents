import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { rows: { agent: string }[] | null; error: unknown } = {
	rows: [],
	error: null,
};

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	cache: <T>(fn: T) => fn,
}));

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					eq: async () => ({ data: state.rows, error: state.error }),
				}),
			}),
		}),
	}),
}));

const notFound = vi.fn(() => {
	throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));

const { loadEnabledAgents, requireAgent } = await import(
	"@/lib/tenants/enabled-agents"
);

beforeEach(() => {
	state.rows = [];
	state.error = null;
	notFound.mockClear();
});

describe("loadEnabledAgents", () => {
	it("devuelve los agentes habilitados", async () => {
		state.rows = [{ agent: "outreach" }];
		expect(await loadEnabledAgents("t1")).toEqual(["outreach"]);
	});

	it("si la consulta falla devuelve null", async () => {
		state.rows = null;
		state.error = { message: "boom" };
		expect(await loadEnabledAgents("t1")).toBeNull();
	});
});

describe("requireAgent", () => {
	it("deja pasar si el agente está habilitado", async () => {
		state.rows = [{ agent: "outreach" }];
		await expect(requireAgent("t1", "outreach")).resolves.toBeUndefined();
	});

	it("da 404 si el agente no está", async () => {
		await expect(requireAgent("t1", "outreach")).rejects.toThrow("NOT_FOUND");
	});

	it("si no se pudo leer, deja pasar", async () => {
		state.rows = null;
		state.error = { message: "boom" };
		await expect(requireAgent("t1", "outreach")).resolves.toBeUndefined();
		expect(notFound).not.toHaveBeenCalled();
	});
});
