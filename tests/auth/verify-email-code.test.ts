import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	verify: { data: { session: unknown }; error: unknown };
	gate: unknown;
	verified: unknown[];
	calls: string[];
} = {
	verify: { data: { session: {} }, error: null },
	gate: { allowed: true, landing: null },
	verified: [],
	calls: [],
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			verifyOtp: async (args: unknown) => {
				state.verified.push(args);
				return state.verify;
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

const { verifyEmailCode } = await import("@/app/(auth)/login/actions");

const WRONG = {
	ok: false,
	message: "El código no es correcto o ya venció. Pedí otro.",
};

beforeEach(() => {
	state.verify = { data: { session: {} }, error: null };
	state.gate = { allowed: true, landing: null };
	state.verified = [];
	state.calls = [];
});

describe("verifyEmailCode", () => {
	it("con un código válido redirige a next", async () => {
		await expect(
			verifyEmailCode(" Ana@Acme.com ", "123 456", "/acme"),
		).rejects.toThrow("REDIRECT /acme");
		expect(state.verified).toEqual([
			{ email: "ana@acme.com", token: "123456", type: "email" },
		]);
	});

	it("un next de otro origen cae en /", async () => {
		await expect(
			verifyEmailCode("ana@acme.com", "123456", "//evil.test"),
		).rejects.toThrow("REDIRECT /");
	});

	it("un código que no son 6 dígitos no llega a Supabase", async () => {
		expect(await verifyEmailCode("ana@acme.com", "12345", null)).toEqual(WRONG);
		expect(await verifyEmailCode("ana@acme.com", "abcdef", null)).toEqual(
			WRONG,
		);
		expect(state.verified).toEqual([]);
	});

	it("un correo inválido responde lo mismo", async () => {
		expect(await verifyEmailCode("no-es-mail", "123456", null)).toEqual(WRONG);
		expect(state.verified).toEqual([]);
	});

	it("código equivocado o vencido: un solo mensaje", async () => {
		state.verify = { data: { session: null }, error: { message: "expired" } };
		expect(await verifyEmailCode("ana@acme.com", "123456", null)).toEqual(
			WRONG,
		);
	});

	it("si la empresa no acepta correo, cierra la sesión y va a la landing", async () => {
		state.gate = { allowed: false, landing: "acme" };
		await expect(
			verifyEmailCode("ana@acme.com", "123456", "/acme"),
		).rejects.toThrow("REDIRECT /login/acme?error=metodo");
		expect(state.calls).toContain("signOut");
	});
});
