import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	user: unknown;
	userError: unknown;
	gate: unknown;
	getUserThrows: boolean;
	calls: string[];
} = {
	user: { id: "u1" },
	userError: null,
	gate: null,
	getUserThrows: false,
	calls: [],
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			getUser: async () => {
				state.calls.push("getUser");
				if (state.getUserThrows) throw new Error("red");
				return { data: { user: state.user }, error: state.userError };
			},
			signOut: async () => {
				state.calls.push("signOut");
				return { error: null };
			},
		},
		rpc: async (fn: string) => {
			state.calls.push(fn);
			return { data: fn === "login_gate" ? state.gate : 1, error: null };
		},
	}),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/headers", () => ({
	headers: async () =>
		new Headers({ host: "app.test", "x-forwarded-proto": "https" }),
}));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		throw new Error(`REDIRECT ${path}`);
	},
}));

const { completeLogin } = await import("@/app/(auth)/login/actions");

// El código ya se verificó en el navegador: si lo que sigue falla, el
// mensaje no es el del código (que sí vale para cualquier mail).
const INCOMPLETE = {
	ok: false,
	message: "No pudimos terminar de entrar. Probá de nuevo.",
};

beforeEach(() => {
	state.user = { id: "u1" };
	state.userError = null;
	state.gate = { allowed: true, landing: null };
	state.getUserThrows = false;
	state.calls = [];
});

describe("completeLogin (server action del código)", () => {
	// En Next 16 un redirect() dentro de una server action rechaza la promesa
	// del lado del navegador: la acción devuelve el destino y navega el cliente.
	it("con sesión une, pasa la compuerta y devuelve next sin redirigir", async () => {
		expect(await completeLogin("/acme")).toEqual({ ok: true, target: "/acme" });
		expect(state.calls).toEqual([
			"getUser",
			"accept_pending_invitations",
			"join_tenants_by_domain",
			"login_gate",
		]);
	});

	it("sin sesión responde que no se pudo terminar y no toca nada", async () => {
		state.user = null;
		expect(await completeLogin("/acme")).toEqual(INCOMPLETE);
		expect(state.calls).toEqual(["getUser"]);
	});

	it("si getUser falla, el mismo aviso", async () => {
		state.user = null;
		state.userError = { message: "jwt expired" };
		expect(await completeLogin(null)).toEqual(INCOMPLETE);
	});

	it("si completar tira, el mismo aviso y no redirige", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		state.getUserThrows = true;
		expect(await completeLogin("/acme")).toEqual(INCOMPLETE);
		error.mockRestore();
	});

	it("un next de otro origen cae en /", async () => {
		expect(await completeLogin("//evil.test")).toEqual({
			ok: true,
			target: "/",
		});
		expect(await completeLogin("https://evil.test/x")).toEqual({
			ok: true,
			target: "/",
		});
	});

	it("un next que no es string cae en /", async () => {
		expect(await completeLogin(42 as unknown as string)).toEqual({
			ok: true,
			target: "/",
		});
	});

	it("si la empresa no acepta correo, cierra la sesión y va a la landing", async () => {
		state.gate = { allowed: false, landing: "acme" };
		expect(await completeLogin("/acme")).toEqual({
			ok: true,
			target: "/login/acme?error=metodo",
		});
		expect(state.calls.at(-1)).toBe("signOut");
	});
});
