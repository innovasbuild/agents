import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	exchange: { data: { session: unknown; user: unknown }; error: unknown };
	gate: unknown;
	signOutThrows: boolean;
	signOutError: unknown;
	signOutArgs: unknown[];
	calls: string[];
	exchangedCodes: string[];
} = {
	exchange: { data: { session: {}, user: {} }, error: null },
	gate: { allowed: true, landing: null },
	signOutThrows: false,
	signOutError: null,
	signOutArgs: [],
	calls: [],
	exchangedCodes: [],
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			exchangeCodeForSession: async (code: string) => {
				state.exchangedCodes.push(code);
				return state.exchange;
			},
			signOut: async (options?: unknown) => {
				state.calls.push("signOut");
				state.signOutArgs.push(options);
				if (state.signOutThrows) throw new Error("boom");
				return { error: state.signOutError };
			},
		},
		rpc: async (fn: string) => {
			state.calls.push(fn);
			return { data: fn === "login_gate" ? state.gate : 1, error: null };
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
		state.gate = { allowed: true, landing: null };
		state.signOutThrows = false;
		state.signOutError = null;
		state.signOutArgs = [];
		state.calls = [];
		state.exchangedCodes = [];
	});

	it("con code válido acepta las invitaciones, une por dominio y va al next", async () => {
		const response = await call("?code=abc&next=%2Facme%2Fchat");

		expect(location(response)).toBe("https://app.test/acme/chat");
		expect(state.exchangedCodes).toEqual(["abc"]);
		expect(state.calls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
			"login_gate",
		]);
	});

	it("con code que no canjea manda al login con el error", async () => {
		state.exchange = { data: { session: null, user: null }, error: {} };

		expect(location(await call("?code=mala"))).toBe(
			"https://app.test/login?error=auth_failed",
		);
		expect(state.calls).toEqual([]);
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

	it("si el método no está permitido cierra la sesión y manda a la landing, no al next", async () => {
		state.gate = { allowed: false, landing: "acme" };

		const response = await call("?code=abc&next=%2Facme%2Fchat");

		expect(location(response)).toBe("https://app.test/login/acme?error=metodo");
		expect(state.calls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
			"login_gate",
			"signOut",
		]);
	});

	it("el corte cierra solo la sesión recién abierta (scope local), no las de otros dispositivos", async () => {
		state.gate = { allowed: false, landing: "acme" };

		await call("?code=abc&next=%2Facme%2Fchat");

		expect(state.signOutArgs).toEqual([{ scope: "local" }]);
	});

	it("si signOut devuelve un error lo deja en el log e igual manda a la landing", async () => {
		state.gate = { allowed: false, landing: "acme" };
		state.signOutError = { message: "no se pudo revocar" };
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await call("?code=abc&next=%2Facme%2Fchat");

		expect(location(response)).toBe("https://app.test/login/acme?error=metodo");
		expect(error).toHaveBeenCalledTimes(1);
		expect(error.mock.calls[0]).toContain(state.signOutError);
		error.mockRestore();
	});

	it("si cerrar la sesión falla, igual manda a la landing", async () => {
		state.gate = { allowed: false, landing: "acme" };
		state.signOutThrows = true;
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(location(await call("?code=abc&next=%2Facme%2Fchat"))).toBe(
			"https://app.test/login/acme?error=metodo",
		);
		error.mockRestore();
	});
});
