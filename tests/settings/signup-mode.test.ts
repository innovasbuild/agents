import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	current: { allowed_domains: string[] } | null;
	updates: unknown[];
	updateResult: { data: unknown; error: unknown };
} = { current: null, updates: [], updateResult: { data: null, error: null } };

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from() {
			return {
				select: () => ({
					eq: () => ({ maybeSingle: async () => ({ data: state.current }) }),
				}),
				update(values: unknown) {
					state.updates.push(values);
					return {
						eq: () => ({
							select: () => ({ maybeSingle: async () => state.updateResult }),
						}),
					};
				},
			};
		},
	}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateSignupMode } = await import("@/app/[tenant]/settings/actions");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("updateSignupMode", () => {
	beforeEach(() => {
		state.current = { allowed_domains: ["empresa.com"] };
		state.updates = [];
		state.updateResult = { data: { id: TENANT_ID }, error: null };
	});

	it("rechaza argumentos inválidos sin tocar la base", async () => {
		expect((await updateSignupMode("no-es-uuid", true, "acme")).ok).toBe(false);
		expect(
			(await updateSignupMode(TENANT_ID, "si" as unknown as boolean, "acme"))
				.ok,
		).toBe(false);
		expect((await updateSignupMode(TENANT_ID, true, "Acme!")).ok).toBe(false);
		expect(state.updates).toHaveLength(0);
	});

	it("abre el ingreso cuando hay dominios propios", async () => {
		const result = await updateSignupMode(TENANT_ID, true, "acme");

		expect(result).toEqual({ ok: true });
		expect(state.updates).toEqual([{ self_signup_by_domain: true }]);
	});

	it("rechaza abrirlo sin dominios cargados", async () => {
		state.current = { allowed_domains: [] };

		const result = await updateSignupMode(TENANT_ID, true, "acme");

		expect(result.ok).toBe(false);
		expect(state.updates).toHaveLength(0);
	});

	it("rechaza abrirlo si hay un dominio público cargado", async () => {
		state.current = { allowed_domains: ["empresa.com", "Gmail.com"] };

		const result = await updateSignupMode(TENANT_ID, true, "acme");

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain("Gmail.com");
		expect(state.updates).toHaveLength(0);
	});

	it("cerrarlo no mira los dominios", async () => {
		state.current = { allowed_domains: [] };

		const result = await updateSignupMode(TENANT_ID, false, "acme");

		expect(result).toEqual({ ok: true });
		expect(state.updates).toEqual([{ self_signup_by_domain: false }]);
	});

	it("sin permiso (la RLS filtró todo) devuelve el mensaje de permiso", async () => {
		state.current = null;

		const result = await updateSignupMode(TENANT_ID, true, "acme");

		expect(result.ok).toBe(false);
		expect(state.updates).toHaveLength(0);
	});

	it("un update que no devuelve fila es falta de permiso", async () => {
		state.updateResult = { data: null, error: null };

		const result = await updateSignupMode(TENANT_ID, false, "acme");

		expect(result.ok).toBe(false);
	});

	it("un error de la base no se pasa como éxito", async () => {
		state.updateResult = { data: null, error: { message: "falló" } };

		const result = await updateSignupMode(TENANT_ID, false, "acme");

		expect(result.ok).toBe(false);
	});
});
