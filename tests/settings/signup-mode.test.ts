import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	user: { id: string } | null;
	reads: number;
	current: { allowed_domains: string[] } | null;
	updates: unknown[];
	updateResult: { data: unknown; error: unknown };
} = {
	user: { id: "u1" },
	reads: 0,
	current: null,
	updates: [],
	updateResult: { data: null, error: null },
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: { getUser: async () => ({ data: { user: state.user } }) },
		from() {
			return {
				select: () => {
					state.reads += 1;
					return {
						eq: () => ({ maybeSingle: async () => ({ data: state.current }) }),
					};
				},
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
// El chequeo del método tiene su propio test (tests/tenants/login-check-server);
// acá se controla su respuesta y se mira contra qué empresa se preguntó.
const gate = vi.hoisted(() => ({
	allows: true,
	calls: [] as { userId: string; tenantId: string }[],
}));
vi.mock("@/lib/tenants/login-check-server", () => ({
	actionAllowsLogin: async (
		_supabase: unknown,
		userId: string,
		tenantId: string,
	) => {
		gate.calls.push({ userId, tenantId });
		return gate.allows;
	},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateSignupMode } = await import("@/app/[tenant]/settings/actions");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("updateSignupMode", () => {
	beforeEach(() => {
		state.user = { id: "u1" };
		state.reads = 0;
		state.current = { allowed_domains: ["empresa.com"] };
		state.updates = [];
		state.updateResult = { data: { id: TENANT_ID }, error: null };
		gate.allows = true;
		gate.calls = [];
	});

	it.each([true, false])(
		"no guarda (abrir: %s) si la empresa no permite el método de la sesión",
		async (open) => {
			gate.allows = false;

			const result = await updateSignupMode(TENANT_ID, open, "acme");

			expect(result).toEqual({
				ok: false,
				message: "No tenés permiso para cambiar el ingreso.",
			});
			expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
			// Ni siquiera lee los dominios: el mensaje no puede filtrar datos.
			expect(state.reads).toBe(0);
			expect(state.updates).toHaveLength(0);
		},
	);

	it("sin sesión no guarda ni pregunta por el método", async () => {
		state.user = null;

		const result = await updateSignupMode(TENANT_ID, false, "acme");

		expect(result).toEqual({
			ok: false,
			message: "No tenés permiso para cambiar el ingreso.",
		});
		expect(gate.calls).toHaveLength(0);
		expect(state.updates).toHaveLength(0);
	});

	it("con el método permitido chequea contra el tenant de la acción", async () => {
		await updateSignupMode(TENANT_ID, false, "acme");

		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(state.updates).toEqual([{ self_signup_by_domain: false }]);
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
