import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: {
	user: { id: string } | null;
	updates: unknown[];
	eqArgs: unknown[];
	result: unknown;
} = {
	user: { id: "u1" },
	updates: [],
	eqArgs: [],
	result: { data: { id: "t1" }, error: null },
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: { getUser: async () => ({ data: { user: calls.user } }) },
		from(_table: string) {
			return {
				update(values: unknown) {
					calls.updates.push(values);
					return {
						eq(column: string, value: unknown) {
							calls.eqArgs.push([column, value]);
							return {
								select: () => ({
									maybeSingle: async () => calls.result,
								}),
							};
						},
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

const { updateDefaultModel } = await import("@/app/[tenant]/settings/actions");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("updateDefaultModel", () => {
	beforeEach(() => {
		calls.user = { id: "u1" };
		calls.updates = [];
		calls.eqArgs = [];
		calls.result = { data: { id: TENANT_ID }, error: null };
		gate.allows = true;
		gate.calls = [];
	});

	it("no guarda si la empresa no permite el método de la sesión", async () => {
		gate.allows = false;

		const result = await updateDefaultModel(
			TENANT_ID,
			"anthropic/claude-sonnet-5",
			"innovas",
		);

		expect(result).toEqual({
			ok: false,
			message: "No tenés permiso para cambiar el modelo.",
		});
		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(calls.updates).toHaveLength(0);
	});

	it("sin sesión no guarda ni pregunta por el método", async () => {
		calls.user = null;

		const result = await updateDefaultModel(
			TENANT_ID,
			"anthropic/claude-sonnet-5",
			"innovas",
		);

		expect(result).toEqual({
			ok: false,
			message: "No tenés permiso para cambiar el modelo.",
		});
		expect(gate.calls).toHaveLength(0);
		expect(calls.updates).toHaveLength(0);
	});

	it("con el método permitido chequea contra el tenant de la acción", async () => {
		await updateDefaultModel(TENANT_ID, "anthropic/claude-sonnet-5", "innovas");

		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(calls.updates).toHaveLength(1);
	});

	it("rechaza un tenantId que no es uuid sin tocar la base", async () => {
		const result = await updateDefaultModel(
			"no-es-uuid",
			"anthropic/claude-sonnet-5",
			"innovas",
		);

		expect(result.ok).toBe(false);
		expect(calls.updates).toHaveLength(0);
	});

	it("manda el modelo nuevo en el update", async () => {
		await updateDefaultModel(
			TENANT_ID,
			"anthropic/claude-haiku-4-5",
			"innovas",
		);

		expect(calls.updates[0]).toEqual({
			default_model: "anthropic/claude-haiku-4-5",
		});
	});

	it("filtra el update por el id del tenant", async () => {
		await updateDefaultModel(TENANT_ID, "anthropic/claude-sonnet-5", "innovas");

		expect(calls.eqArgs[0]).toEqual(["id", TENANT_ID]);
	});

	it("contesta ok cuando la fila vuelve actualizada", async () => {
		const result = await updateDefaultModel(
			TENANT_ID,
			"anthropic/claude-sonnet-5",
			"innovas",
		);

		expect(result).toEqual({ ok: true });
	});

	it("no contesta ok si la RLS filtró la fila entera (sin error, sin data)", async () => {
		calls.result = { data: null, error: null };

		const result = await updateDefaultModel(
			TENANT_ID,
			"anthropic/claude-sonnet-5",
			"innovas",
		);

		expect(result.ok).toBe(false);
	});

	it("avisa cuando el modelo no está permitido para este tenant", async () => {
		calls.result = {
			data: null,
			error: { message: "violates check constraint" },
		};

		const result = await updateDefaultModel(
			TENANT_ID,
			"modelo-inventado",
			"innovas",
		);

		expect(result).toEqual({
			ok: false,
			message: "Ese modelo no está permitido para este cliente.",
		});
	});
});
