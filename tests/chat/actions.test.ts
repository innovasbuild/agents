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
	/** La fila del hilo que la RLS deja ver; null = no se ve. */
	row: { tenant_id: "11111111-1111-4111-8111-111111111111" } as {
		tenant_id: string;
	} | null,
	readError: null as { message: string } | null,
	reads: [] as { column: string; value: unknown }[],
	inserts: [] as unknown[],
	updates: [] as { values: unknown; column: string; value: unknown }[],
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
					// La lectura previa del tenant del hilo va por su propia cadena:
					// `filters` sigue siendo solo lo que filtra el DELETE.
					select: () => ({
						eq: (column: string, value: unknown) => ({
							maybeSingle: async () => {
								state.reads.push({ column, value });
								return { data: state.row, error: state.readError };
							},
						}),
					}),
					insert(values: unknown) {
						state.inserts.push(values);
						return {
							select: () => ({
								single: async () => ({ data: { id: "nuevo" }, error: null }),
							}),
						};
					},
					update: (values: unknown) => ({
						eq: async (column: string, value: unknown) => {
							state.updates.push({ values, column, value });
							return { error: null };
						},
					}),
					delete() {
						state.deletes += 1;
						return chain;
					},
				};
			},
		}),
	};
});

const { createConversation, deleteConversation, renameConversation } =
	await import("@/app/[tenant]/chat/actions");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

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
	state.row = { tenant_id: TENANT_ID };
	state.readError = null;
	state.reads = [];
	state.inserts = [];
	state.updates = [];
	gate.allows = true;
	gate.calls = [];
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

describe("el método de la sesión en las actions del chat", () => {
	describe("createConversation", () => {
		it("con el método permitido chequea contra el tenant de la acción y crea el hilo", async () => {
			const id = await createConversation(TENANT_ID, "acme", "modelo");

			expect(id).toBe("nuevo");
			expect(gate.calls).toEqual([{ userId: "user-1", tenantId: TENANT_ID }]);
			expect(state.inserts).toEqual([
				{
					tenant_id: TENANT_ID,
					user_id: "user-1",
					agent: "outreach",
					model: "modelo",
				},
			]);
		});

		it("no crea nada si la empresa no permite el método", async () => {
			gate.allows = false;

			expect(await createConversation(TENANT_ID, "acme", "modelo")).toBeNull();
			expect(state.inserts).toHaveLength(0);
			expect(state.revalidated).toEqual([]);
		});
	});

	describe("renameConversation", () => {
		it("con el método permitido chequea contra la empresa del hilo y renombra", async () => {
			await renameConversation(CONV, "Título", "acme");

			expect(state.reads).toEqual([{ column: "id", value: CONV }]);
			expect(gate.calls).toEqual([{ userId: "user-1", tenantId: TENANT_ID }]);
			expect(state.updates).toHaveLength(1);
			expect(state.updates[0]).toMatchObject({
				values: { title: "Título" },
				column: "id",
				value: CONV,
			});
			expect(state.revalidated).toEqual(["/acme/chat"]);
		});

		it("no renombra si la empresa del hilo no permite el método", async () => {
			gate.allows = false;

			await renameConversation(CONV, "Título", "acme");

			expect(gate.calls).toEqual([{ userId: "user-1", tenantId: TENANT_ID }]);
			expect(state.updates).toHaveLength(0);
		});

		it("no renombra un hilo que no se ve, ni sin sesión, ni si la lectura falla", async () => {
			state.row = null;
			await renameConversation(CONV, "Título", "acme");

			state.row = { tenant_id: TENANT_ID };
			state.user = null;
			await renameConversation(CONV, "Título", "acme");

			state.user = { id: "user-1" };
			state.readError = { message: "boom" };
			await renameConversation(CONV, "Título", "acme");

			expect(gate.calls).toHaveLength(0);
			expect(state.updates).toHaveLength(0);
		});
	});

	describe("deleteConversation", () => {
		it("con el método permitido chequea contra la empresa del hilo antes de borrar", async () => {
			const result = await deleteConversation(CONV, "acme");

			expect(result).toEqual({ ok: true });
			expect(state.reads).toEqual([{ column: "id", value: CONV }]);
			expect(gate.calls).toEqual([{ userId: "user-1", tenantId: TENANT_ID }]);
			expect(state.deletes).toBe(1);
		});

		it("no borra si la empresa del hilo no permite el método", async () => {
			gate.allows = false;

			const result = await deleteConversation(CONV, "acme");

			expect(result).toEqual({
				ok: false,
				error: "No se pudo borrar el hilo.",
			});
			expect(state.deletes).toBe(0);
			expect(state.revalidated).toEqual([]);
		});

		it("un hilo que no se ve contesta como hoy y no borra", async () => {
			state.row = null;

			const result = await deleteConversation(CONV, "acme");

			expect(result).toEqual({ ok: false, error: "Ese hilo ya no está." });
			expect(gate.calls).toHaveLength(0);
			expect(state.deletes).toBe(0);
		});

		it("si la lectura del hilo falla no borra", async () => {
			state.readError = { message: "boom" };
			const error = vi.spyOn(console, "error").mockImplementation(() => {});

			const result = await deleteConversation(CONV, "acme");

			expect(result).toEqual({
				ok: false,
				error: "No se pudo borrar el hilo.",
			});
			expect(state.deletes).toBe(0);
			error.mockRestore();
		});
	});
});
