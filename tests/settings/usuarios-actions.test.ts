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
					eq: async (column: string, value: unknown) => {
						state.writes.push({ table, kind: "delete", column, value });
						return { error: null };
					},
				}),
				update: (values: unknown) => ({
					eq: async (column: string, value: unknown) => {
						state.writes.push({ table, kind: "update", values, column, value });
						return { error: null };
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
