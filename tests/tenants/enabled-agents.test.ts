import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { rows: { agent: string }[] | null; error: unknown } = {
	rows: [],
	error: null,
};

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	cache: <T>(fn: T) => fn,
}));

// Cada eq() se puede encadenar o esperar: los agentes cortan en el segundo
// eq y el brain sigue hasta limit().
function chain(): Promise<unknown> & {
	eq: typeof chain;
	limit: () => unknown;
} {
	const result = Promise.resolve({ data: state.rows, error: state.error });
	return Object.assign(result, { eq: chain, limit: () => result });
}

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: () => ({ select: () => ({ eq: chain }) }),
	}),
}));

const notFound = vi.fn(() => {
	throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));

const { loadBrainEnabled, loadEnabledAgents, requireAgent, requireChatAgent } =
	await import("@/lib/tenants/enabled-agents");

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

describe("loadBrainEnabled", () => {
	it("true si hay una conexión de brain habilitada", async () => {
		state.rows = [{ agent: "x" }];
		expect(await loadBrainEnabled("t1")).toBe(true);
	});

	it("false si no hay ninguna", async () => {
		expect(await loadBrainEnabled("t1")).toBe(false);
	});

	it("si la consulta falla devuelve null y no false", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		state.rows = null;
		state.error = { message: "boom" };
		expect(await loadBrainEnabled("t1")).toBeNull();
		error.mockRestore();
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

describe("requireChatAgent (la pantalla de chat, con la misma regla que tenantHome)", () => {
	it("deja pasar si algún agente habilitado se usa desde el chat", async () => {
		state.rows = [{ agent: "desconocido" }, { agent: "outreach" }];
		await expect(requireChatAgent("t1")).resolves.toBeUndefined();
	});

	it("da 404 si ningún agente habilitado se usa desde el chat", async () => {
		state.rows = [{ agent: "desconocido" }];
		await expect(requireChatAgent("t1")).rejects.toThrow("NOT_FOUND");
		state.rows = [];
		await expect(requireChatAgent("t1")).rejects.toThrow("NOT_FOUND");
	});

	it("si no se pudo leer, deja pasar", async () => {
		state.rows = null;
		state.error = { message: "boom" };
		await expect(requireChatAgent("t1")).resolves.toBeUndefined();
		expect(notFound).not.toHaveBeenCalled();
	});
});
