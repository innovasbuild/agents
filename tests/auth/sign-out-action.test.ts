import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { scopes: unknown[]; signOutThrows: boolean } = {
	scopes: [],
	signOutThrows: false,
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			signOut: async (options: unknown) => {
				state.scopes.push(options);
				if (state.signOutThrows) throw new Error("red");
				return { error: null };
			},
		},
	}),
}));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		throw new Error(`REDIRECT ${path}`);
	},
}));

const { signOut } = await import("@/app/[tenant]/session-actions");

describe("signOut", () => {
	beforeEach(() => {
		state.scopes = [];
		state.signOutThrows = false;
	});

	it("cierra solo la sesión de este dispositivo y vuelve al login de la empresa", async () => {
		await expect(signOut("okeefe")).rejects.toThrow("REDIRECT /login/okeefe");
		expect(state.scopes).toEqual([{ scope: "local" }]);
	});

	it("si signOut falla, igual manda al login", async () => {
		state.signOutThrows = true;
		await expect(signOut("okeefe")).rejects.toThrow("REDIRECT /login/okeefe");
	});

	it("un slug inválido va al login general", async () => {
		await expect(signOut("../plataforma")).rejects.toThrow(
			/^REDIRECT \/login$/,
		);
		await expect(signOut(42 as unknown as string)).rejects.toThrow(
			/^REDIRECT \/login$/,
		);
	});
});
