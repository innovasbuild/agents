import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	user: { id: "user-1" } as { id: string } | null,
	deleteError: null as { message: string } | null,
	/** Filas que el DELETE dice haber borrado. Cero = RLS filtró la fila. */
	deletedRows: [{ id: "row" }] as { id: string }[],
	table: null as string | null,
	filters: [] as { column: string; value: unknown }[],
	deletes: 0,
	selected: null as string | null,
	revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));

// Doble genérico: `eq` se devuelve a sí mismo y acumula filtros, así que un
// filtro más o un `select` distinto no rompen el mock con un TypeError.
vi.mock("../../lib/supabase/server", () => {
	const chain = {
		eq(column: string, value: unknown) {
			state.filters.push({ column, value });
			return chain;
		},
		async select(columns: string) {
			state.selected = columns;
			return { data: state.deletedRows, error: state.deleteError };
		},
	};
	return {
		createServerSupabase: async () => ({
			auth: { getUser: async () => ({ data: { user: state.user } }) },
			from(table: string) {
				state.table = table;
				return {
					delete() {
						state.deletes += 1;
						return chain;
					},
				};
			},
		}),
	};
});

const { deleteConversation } = await import("@/app/[tenant]/chat/actions");

// La action valida uuid: un id de fantasía se rechaza antes de la base.
const CONV = "6f1f1e2a-9b3c-4d5e-8f70-1a2b3c4d5e6f";

beforeEach(() => {
	state.user = { id: "user-1" };
	state.deleteError = null;
	state.deletedRows = [{ id: "row" }];
	state.table = null;
	state.filters = [];
	state.deletes = 0;
	state.selected = null;
	state.revalidated = [];
});

describe("deleteConversation", () => {
	it("borra el hilo propio y revalida la pantalla del tenant", async () => {
		const result = await deleteConversation(CONV, "lagomarcino");

		expect(result).toEqual({ ok: true });
		expect(state.table).toBe("conversations");
		expect(state.deletes).toBe(1);
		expect(state.revalidated).toEqual(["/lagomarcino/chat"]);
	});

	it("acota el borrado al id y al dueño, no solo al id", async () => {
		// Sin el eq de user_id, el delete se apoyaría solo en conversations_delete,
		// que también deja borrar a un tenant_admin las de su gente.
		await deleteConversation(CONV, "lagomarcino");

		expect(state.filters).toEqual([
			{ column: "id", value: CONV },
			{ column: "user_id", value: "user-1" },
		]);
	});

	it("no festeja un borrado que no tocó ninguna fila", async () => {
		// Así niega RLS de verdad: un DELETE filtrado entero NO devuelve error,
		// devuelve cero filas. Sin el select la action contestaba ok:true y la
		// pantalla navegaba como si hubiera borrado el hilo de otro.
		state.deletedRows = [];

		const result = await deleteConversation(CONV, "lagomarcino");

		expect(state.selected).toBe("id");
		expect(result).toEqual({ ok: false, error: "Ese hilo ya no está." });
		expect(state.revalidated).toEqual([]);
	});

	it("sin sesión no toca la tabla ni revalida", async () => {
		state.user = null;

		const result = await deleteConversation(CONV, "lagomarcino");

		expect(result).toEqual({
			ok: false,
			error: "Volvé a entrar: no hay sesión.",
		});
		expect(state.deletes).toBe(0);
		expect(state.revalidated).toEqual([]);
	});

	it("con error del borrado devuelve el mensaje y no revalida", async () => {
		state.deleteError = { message: "permission denied" };
		state.deletedRows = [];

		const result = await deleteConversation(CONV, "lagomarcino");

		expect(result).toEqual({ ok: false, error: "No se pudo borrar el hilo." });
		expect(state.revalidated).toEqual([]);
	});

	it("rechaza un id que no es uuid antes de llegar a la base", async () => {
		const result = await deleteConversation("conv-1", "lagomarcino");

		expect(result).toEqual({ ok: false, error: "No se pudo borrar el hilo." });
		expect(state.deletes).toBe(0);
	});

	it("rechaza un slug que no tiene forma de slug", async () => {
		// El slug entra sin validar a revalidatePath, que interpreta el path.
		const result = await deleteConversation(CONV, "../../otro-tenant");

		expect(result).toEqual({ ok: false, error: "No se pudo borrar el hilo." });
		expect(state.deletes).toBe(0);
		expect(state.revalidated).toEqual([]);
	});
});
