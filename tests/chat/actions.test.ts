import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	user: { id: "user-1" } as { id: string } | null,
	deleteError: null as { message: string } | null,
	table: null as string | null,
	filters: [] as { column: string; value: unknown }[],
	deletes: 0,
	revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));

vi.mock("../../lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			getUser: async () => ({ data: { user: state.user } }),
		},
		from(table: string) {
			state.table = table;
			return {
				// El borrado encadena dos eq (id y user_id) y cierra en el segundo.
				delete() {
					state.deletes += 1;
					return {
						eq(column: string, value: unknown) {
							state.filters.push({ column, value });
							return {
								eq: async (nextColumn: string, nextValue: unknown) => {
									state.filters.push({ column: nextColumn, value: nextValue });
									return { error: state.deleteError };
								},
							};
						},
					};
				},
			};
		},
	}),
}));

const { deleteConversation } = await import("@/app/[tenant]/chat/actions");

beforeEach(() => {
	state.user = { id: "user-1" };
	state.deleteError = null;
	state.table = null;
	state.filters = [];
	state.deletes = 0;
	state.revalidated = [];
});

describe("deleteConversation", () => {
	it("borra el hilo propio y revalida la pantalla del tenant", async () => {
		const result = await deleteConversation("conv-1", "lagomarcino");

		expect(result).toEqual({ ok: true });
		expect(state.table).toBe("conversations");
		expect(state.deletes).toBe(1);
		expect(state.revalidated).toEqual(["/lagomarcino/chat"]);
	});

	it("acota el borrado al id y al dueño, no solo al id", async () => {
		// Sin el eq de user_id, el delete se apoyaría solo en conversations_delete,
		// que también deja borrar a un tenant_admin las de su gente.
		await deleteConversation("conv-1", "lagomarcino");

		expect(state.filters).toEqual([
			{ column: "id", value: "conv-1" },
			{ column: "user_id", value: "user-1" },
		]);
	});

	it("sin sesión no toca la tabla ni revalida", async () => {
		state.user = null;

		const result = await deleteConversation("conv-1", "lagomarcino");

		expect(result).toEqual({
			ok: false,
			error: "Volvé a entrar: no hay sesión.",
		});
		expect(state.deletes).toBe(0);
		expect(state.revalidated).toEqual([]);
	});

	it("con error del borrado devuelve el mensaje y no revalida", async () => {
		// Es el caso de RLS negando la fila ajena: postgrest no tira, devuelve error.
		state.deleteError = { message: "permission denied" };

		const result = await deleteConversation("conv-1", "lagomarcino");

		expect(result).toEqual({ ok: false, error: "No se pudo borrar el hilo." });
		expect(state.revalidated).toEqual([]);
	});
});
