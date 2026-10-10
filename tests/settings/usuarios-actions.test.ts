import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
	user: { id: "u1" } as { id: string } | null,
	/** La fila que la RLS le deja ver a quien llama; null = no la ve. */
	row: { tenant_id: "11111111-1111-4111-8111-111111111111" } as {
		tenant_id: string;
	} | null,
	readError: null as { message: string } | null,
	writeError: null as { code?: string; message: string } | null,
	/** Las filas que la escritura llegó a tocar; [] = la RLS la filtró. */
	writeRows: [{ id: "33333333-3333-4333-8333-333333333333" }] as {
		id: string;
	}[],
	reads: [] as { table: string; column: string; value: unknown }[],
	writes: [] as {
		table: string;
		kind: "delete" | "update";
		values?: unknown;
		column: string;
		value: unknown;
	}[],
	revalidated: [] as string[],
}));

const gate = vi.hoisted(() => ({
	allows: true,
	calls: [] as { userId: string; tenantId: string }[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
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
/**
 * Lo que sigue a `delete().eq()` o `update().eq()`: se puede esperar tal cual o
 * encadenar `.select("id")`, que devuelve las filas que se escribieron.
 */
const written = () => ({
	select: async () => ({
		data: state.writeError ? null : state.writeRows,
		error: state.writeError,
	}),
	then: (resolve: (value: { error: unknown }) => unknown) =>
		resolve({ error: state.writeError }),
});

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: { getUser: async () => ({ data: { user: state.user } }) },
		from(table: string) {
			return {
				select: () => ({
					eq: (column: string, value: unknown) => ({
						maybeSingle: async () => {
							state.reads.push({ table, column, value });
							return { data: state.row, error: state.readError };
						},
					}),
				}),
				delete: () => ({
					eq: (column: string, value: unknown) => {
						state.writes.push({ table, kind: "delete", column, value });
						return written();
					},
				}),
				update: (values: unknown) => ({
					eq: (column: string, value: unknown) => {
						state.writes.push({ table, kind: "update", values, column, value });
						return written();
					},
				}),
			};
		},
	}),
}));

const { revokeMembership, revokeInvitation } = await import(
	"@/app/[tenant]/settings/usuarios/actions"
);

beforeEach(() => {
	state.user = { id: "u1" };
	state.row = { tenant_id: TENANT_ID };
	state.readError = null;
	state.writeError = null;
	state.writeRows = [{ id: ROW_ID }];
	state.reads = [];
	state.writes = [];
	state.revalidated = [];
	gate.allows = true;
	gate.calls = [];
});

const cases = [
	{
		name: "revokeMembership",
		run: () => revokeMembership(ROW_ID, "acme"),
		table: "memberships",
		write: {
			table: "memberships",
			kind: "delete",
			column: "id",
			value: ROW_ID,
		},
	},
	{
		name: "revokeInvitation",
		run: () => revokeInvitation(ROW_ID, "acme"),
		table: "invitations",
		write: {
			table: "invitations",
			kind: "update",
			values: { status: "revoked" },
			column: "id",
			value: ROW_ID,
		},
	},
] as const;

describe.each(cases)("$name", ({ run, table, write }) => {
	it("con el método permitido chequea contra la empresa de la fila y escribe", async () => {
		await run();

		expect(state.reads).toEqual([{ table, column: "id", value: ROW_ID }]);
		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(state.writes).toEqual([write]);
		expect(state.revalidated).toEqual(["/acme/settings/usuarios"]);
	});

	it("no escribe si la empresa de la fila no permite el método de la sesión", async () => {
		gate.allows = false;

		await run();

		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(state.writes).toHaveLength(0);
		expect(state.revalidated).toEqual(["/acme/settings/usuarios"]);
	});

	it("si la fila no se ve no escribe ni pregunta por el método", async () => {
		state.row = null;

		await run();

		expect(gate.calls).toHaveLength(0);
		expect(state.writes).toHaveLength(0);
		expect(state.revalidated).toEqual(["/acme/settings/usuarios"]);
	});

	it("si la lectura de la fila falla no escribe", async () => {
		state.readError = { message: "boom" };

		await run();

		expect(state.writes).toHaveLength(0);
	});

	it("sin sesión no escribe", async () => {
		state.user = null;

		await run();

		expect(state.reads).toHaveLength(0);
		expect(state.writes).toHaveLength(0);
		expect(state.revalidated).toEqual(["/acme/settings/usuarios"]);
	});
});

describe("resultado de las bajas", () => {
	it("cuando sale bien devuelven ok", async () => {
		expect(await revokeMembership(ROW_ID, "acme")).toEqual({ ok: true });
		expect(await revokeInvitation(ROW_ID, "acme")).toEqual({ ok: true });
	});

	it("sacar al único administrador explica por qué no se pudo", async () => {
		state.writeError = { code: "23514", message: "check" };

		expect(await revokeMembership(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "La empresa no puede quedar sin administrador.",
		});
	});

	it("sin permiso, sin fila o con el método no permitido dicen que no hay permiso", async () => {
		gate.allows = false;
		expect(await revokeMembership(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});

		gate.allows = true;
		state.row = null;
		expect(await revokeInvitation(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});
	});

	it("otro error de la base no se filtra al mensaje", async () => {
		state.writeError = { code: "XX000", message: "detalle interno" };
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await revokeMembership(ROW_ID, "acme");

		expect(result).toEqual({
			ok: false,
			message: "No se pudo completar. Probá de nuevo.",
		});
		error.mockRestore();
	});
});

describe("una baja que la RLS filtra", () => {
	it("sin filas escritas no dice ok y revalida igual", async () => {
		state.writeRows = [];

		expect(await revokeMembership(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});
		expect(await revokeInvitation(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});
		expect(state.revalidated).toEqual([
			"/acme/settings/usuarios",
			"/acme/settings/usuarios",
		]);
	});

	it("con una fila escrita dice ok", async () => {
		expect(await revokeMembership(ROW_ID, "acme")).toEqual({ ok: true });
		expect(await revokeInvitation(ROW_ID, "acme")).toEqual({ ok: true });
	});
});
