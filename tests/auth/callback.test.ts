import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	exchange: { data: { session: unknown; user: unknown }; error: unknown };
	rpcCalls: string[];
	exchangedCodes: string[];
} = {
	exchange: { data: { session: {}, user: {} }, error: null },
	rpcCalls: [],
	exchangedCodes: [],
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			exchangeCodeForSession: async (code: string) => {
				state.exchangedCodes.push(code);
				return state.exchange;
			},
		},
		rpc: async (fn: string) => {
			state.rpcCalls.push(fn);
			return { error: null };
		},
	}),
}));

const { GET } = await import("@/app/auth/callback/route");

const call = (query: string) =>
	GET(new Request(`https://app.test/auth/callback${query}`));

const location = (response: Response) => response.headers.get("location");

describe("GET /auth/callback", () => {
	beforeEach(() => {
		state.exchange = { data: { session: {}, user: {} }, error: null };
		state.rpcCalls = [];
		state.exchangedCodes = [];
	});

	it("con code válido acepta las invitaciones, une por dominio y va al next", async () => {
		const response = await call("?code=abc&next=%2Facme%2Fchat");

		expect(location(response)).toBe("https://app.test/acme/chat");
		expect(state.exchangedCodes).toEqual(["abc"]);
		expect(state.rpcCalls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
		]);
	});

	it("con code que no canjea manda al login con el error", async () => {
		state.exchange = { data: { session: null, user: null }, error: {} };

		expect(location(await call("?code=mala"))).toBe(
			"https://app.test/login?error=auth_failed",
		);
		expect(state.rpcCalls).toEqual([]);
	});

	it("sin code (link de invitación: la sesión viaja en el fragmento) va a la confirmación con el next", async () => {
		const response = await call("?next=%2Facme%2Fchat");

		// Sin fragmento propio en el Location, el navegador conserva el #access_token.
		expect(location(response)).toBe(
			"https://app.test/auth/confirmar?next=%2Facme%2Fchat",
		);
		expect(state.exchangedCodes).toHaveLength(0);
	});

	it("sin code y sin next va a la confirmación sin next", async () => {
		expect(location(await call(""))).toBe("https://app.test/auth/confirmar");
	});

	it("sin code, un next peligroso no llega a la confirmación", async () => {
		expect(location(await call("?next=%2F%2Fevil.test"))).toBe(
			"https://app.test/auth/confirmar",
		);
	});
});
