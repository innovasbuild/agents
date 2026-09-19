import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { updates: unknown[]; eqArgs: unknown[]; result: unknown } = {
	updates: [],
	eqArgs: [],
	result: { data: { id: "t1" }, error: null },
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateDefaultModel } = await import("@/app/[tenant]/settings/actions");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("updateDefaultModel", () => {
	beforeEach(() => {
		calls.updates = [];
		calls.eqArgs = [];
		calls.result = { data: { id: TENANT_ID }, error: null };
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
