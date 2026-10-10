import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ROW_ID = "33333333-3333-4333-8333-333333333333";

type Reply = {
	data: unknown;
	error: { code?: string; message: string } | null;
};
type Call = {
	table: string;
	op: "read" | "update";
	values?: Record<string, unknown>;
	filters: [string, unknown][];
};

const db = vi.hoisted(() => ({
	user: { id: "u1" } as { id: string } | null,
	/** Qué devuelve la lectura de cada tabla. */
	read: {} as Record<string, { data: unknown; error: unknown }>,
	update: { data: [{ id: "x" }], error: null } as {
		data: unknown;
		error: { code?: string; message: string } | null;
	},
	rpc: { data: null, error: null } as {
		data: unknown;
		error: { code?: string; message: string } | null;
	},
	calls: [] as unknown[],
	rpcCalls: [] as { fn: string; args: unknown }[],
	revalidated: [] as string[],
}));

const gate = vi.hoisted(() => ({
	allows: true,
	calls: [] as { userId: string; tenantId: string }[],
}));

const mail = vi.hoisted(() => ({
	outcome: "ok" as "ok" | "ya_existe" | "mail_fallo",
	sent: [] as { email: string; origin: string; next?: string }[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		db.revalidated.push(path);
	},
}));
vi.mock("next/headers", () => ({
	headers: async () => new Headers({ origin: "https://app.test" }),
}));
vi.mock("@/lib/tenants/login-check-server", () => ({
	actionAllowsLogin: async (_s: unknown, userId: string, tenantId: string) => {
		gate.calls.push({ userId, tenantId });
		return gate.allows;
	},
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ admin: true }),
}));
vi.mock("@/lib/invitations/invite", () => ({
	sendInvitationMail: async (params: {
		email: string;
		origin: string;
		next?: string;
	}) => {
		mail.sent.push({
			email: params.email,
			origin: params.origin,
			next: params.next,
		});
		return mail.outcome;
	},
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: { getUser: async () => ({ data: { user: db.user } }) },
		rpc: async (fn: string, args: unknown) => {
			db.rpcCalls.push({ fn, args });
			return db.rpc;
		},
		from(table: string) {
			const call: Call = { table, op: "read", filters: [] };
			const chain = {
				// select() abre una lectura, o cierra un update().eq().select().
				select: () => {
					if (call.op === "update") {
						db.calls.push(call);
						return Promise.resolve(db.update as Reply);
					}
					return chain;
				},
				update: (values: Record<string, unknown>) => {
					call.op = "update";
					call.values = values;
					return chain;
				},
				eq: (column: string, value: unknown) => {
					call.filters.push([column, value]);
					return chain;
				},
				maybeSingle: async () => {
					db.calls.push(call);
					return db.read[table] ?? { data: null, error: null };
				},
			};
			return chain;
		},
	}),
}));

const { blockMember, changeMemberRole, resendInvitation, unblockMember } =
	await import("@/app/[tenant]/settings/usuarios/actions");

const SIN_PERMISO = { ok: false, message: "No tenés permiso." };
const updates = () =>
	(db.calls as Call[]).filter((call) => call.op === "update");

beforeEach(() => {
	db.user = { id: "u1" };
	db.read = {};
	db.update = { data: [{ id: "x" }], error: null };
	db.rpc = { data: null, error: null };
	db.calls = [];
	db.rpcCalls = [];
	db.revalidated = [];
	gate.allows = true;
	gate.calls = [];
	mail.outcome = "ok";
	mail.sent = [];
});

describe("changeMemberRole", () => {
	beforeEach(() => {
		db.read.memberships = {
			data: { tenant_id: TENANT_ID, user_id: USER_ID, role: "tenant_member" },
			error: null,
		};
	});

	it("cambia el rol de la fila y revalida", async () => {
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual({
			ok: true,
		});
		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(updates()).toEqual([
			{
				table: "memberships",
				op: "update",
				values: { role: "tenant_admin" },
				filters: [["id", ROW_ID]],
			},
		]);
		expect(db.revalidated).toEqual(["/acme/settings/usuarios"]);
	});

	it.each(["platform_admin", "owner", ""])(
		"rechaza el rol %s sin tocar la base",
		async (role) => {
			expect(await changeMemberRole(ROW_ID, role, "acme")).toEqual(SIN_PERMISO);
			expect(db.calls).toHaveLength(0);
		},
	);

	it("no cambia el rol de un administrador de la plataforma", async () => {
		db.read.memberships = {
			data: { tenant_id: TENANT_ID, user_id: USER_ID, role: "platform_admin" },
			error: null,
		};

		expect(await changeMemberRole(ROW_ID, "tenant_member", "acme")).toEqual({
			ok: false,
			message:
				"No se puede cambiar el rol de un administrador de la plataforma.",
		});
		expect(updates()).toHaveLength(0);
	});

	it("el último administrador no se degrada", async () => {
		db.update = { data: null, error: { code: "23514", message: "check" } };

		expect(await changeMemberRole(ROW_ID, "tenant_member", "acme")).toEqual({
			ok: false,
			message: "La empresa no puede quedar sin administrador.",
		});
	});

	it("si la RLS no deja escribir (cero filas) no hay permiso", async () => {
		db.update = { data: [], error: null };
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual(
			SIN_PERMISO,
		);
	});

	it("sin sesión, sin fila o con el método no permitido no escribe", async () => {
		gate.allows = false;
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual(
			SIN_PERMISO,
		);

		gate.allows = true;
		db.read.memberships = { data: null, error: null };
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual(
			SIN_PERMISO,
		);

		db.user = null;
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual(
			SIN_PERMISO,
		);
		expect(updates()).toHaveLength(0);
	});
});

describe("blockMember", () => {
	beforeEach(() => {
		db.read.memberships = {
			data: { tenant_id: TENANT_ID, user_id: USER_ID, role: "tenant_member" },
			error: null,
		};
	});

	it("bloquea a la persona de la fila, en la empresa de la fila", async () => {
		expect(await blockMember(ROW_ID, "acme")).toEqual({ ok: true });
		expect(db.rpcCalls).toEqual([
			{ fn: "block_member", args: { p_tenant: TENANT_ID, p_user: USER_ID } },
		]);
		expect(db.revalidated).toEqual(["/acme/settings/usuarios"]);
	});

	it("nadie se bloquea a sí mismo", async () => {
		db.read.memberships = {
			data: { tenant_id: TENANT_ID, user_id: "u1", role: "tenant_admin" },
			error: null,
		};

		expect(await blockMember(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No podés bloquearte a vos.",
		});
		expect(db.rpcCalls).toHaveLength(0);
	});

	it.each([
		["42501", "No tenés permiso."],
		["23514", "La empresa no puede quedar sin administrador."],
	])("traduce el error %s de la base", async (code, message) => {
		db.rpc = { data: null, error: { code, message: "x" } };
		expect(await blockMember(ROW_ID, "acme")).toEqual({ ok: false, message });
	});

	it("con el método no permitido o sin fila no llama a la base", async () => {
		gate.allows = false;
		expect(await blockMember(ROW_ID, "acme")).toEqual(SIN_PERMISO);

		gate.allows = true;
		db.read.memberships = { data: null, error: null };
		expect(await blockMember(ROW_ID, "acme")).toEqual(SIN_PERMISO);
		expect(db.rpcCalls).toHaveLength(0);
	});
});

describe("unblockMember", () => {
	beforeEach(() => {
		db.read.membership_blocks = {
			data: { tenant_id: TENANT_ID, user_id: USER_ID },
			error: null,
		};
	});

	it("desbloquea si el bloqueo se ve con la sesión", async () => {
		expect(await unblockMember(TENANT_ID, USER_ID, "acme")).toEqual({
			ok: true,
		});
		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(db.rpcCalls).toEqual([
			{ fn: "unblock_member", args: { p_tenant: TENANT_ID, p_user: USER_ID } },
		]);
	});

	it("si el bloqueo no se ve (otra empresa, o no es administrador) no hay permiso", async () => {
		db.read.membership_blocks = { data: null, error: null };

		expect(await unblockMember(TENANT_ID, USER_ID, "acme")).toEqual(
			SIN_PERMISO,
		);
		expect(db.rpcCalls).toHaveLength(0);
	});

	it("con el método no permitido no llama a la base", async () => {
		gate.allows = false;
		expect(await unblockMember(TENANT_ID, USER_ID, "acme")).toEqual(
			SIN_PERMISO,
		);
		expect(db.rpcCalls).toHaveLength(0);
	});
});

describe("resendInvitation", () => {
	beforeEach(() => {
		db.read.invitations = {
			data: { tenant_id: TENANT_ID, email: "ana@acme.test", status: "pending" },
			error: null,
		};
		db.read.tenants = { data: { slug: "acme-real" }, error: null };
	});

	it("renueva el vencimiento a 14 días y manda el mail hacia el chat de la empresa", async () => {
		const antes = Date.now();

		expect(await resendInvitation(ROW_ID, "lo-que-mande-el-navegador")).toEqual(
			{ ok: true, message: "Invitación reenviada." },
		);

		const [update] = updates();
		expect(update.table).toBe("invitations");
		expect(update.filters).toEqual([
			["id", ROW_ID],
			["status", "pending"],
		]);
		const vence = new Date(update.values?.expires_at as string).getTime();
		const dias = (vence - antes) / 86_400_000;
		expect(dias).toBeGreaterThan(13.99);
		expect(dias).toBeLessThan(14.01);

		// El slug del link sale de la base, no del parámetro.
		expect(mail.sent).toEqual([
			{
				email: "ana@acme.test",
				origin: "https://app.test",
				next: "/acme-real/chat",
			},
		]);
	});

	it("si la persona ya tiene cuenta lo dice, y el vencimiento se renueva igual", async () => {
		mail.outcome = "ya_existe";

		expect(await resendInvitation(ROW_ID, "acme")).toEqual({
			ok: true,
			message:
				"Esa persona ya tiene cuenta. Pasale el link de ingreso de la empresa.",
		});
		expect(updates()).toHaveLength(1);
	});

	it("si el mail falla lo dice", async () => {
		mail.outcome = "mail_fallo";

		expect(await resendInvitation(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No se pudo mandar el mail. Probá de nuevo.",
		});
	});

	it("una invitación que ya no está pendiente no se reenvía", async () => {
		db.read.invitations = {
			data: { tenant_id: TENANT_ID, email: "ana@acme.test", status: "revoked" },
			error: null,
		};

		expect(await resendInvitation(ROW_ID, "acme")).toEqual(SIN_PERMISO);
		expect(updates()).toHaveLength(0);
		expect(mail.sent).toHaveLength(0);
	});

	it("si la RLS no deja renovar (cero filas) no manda el mail", async () => {
		db.update = { data: [], error: null };

		expect(await resendInvitation(ROW_ID, "acme")).toEqual(SIN_PERMISO);
		expect(mail.sent).toHaveLength(0);
	});

	it("con el método no permitido no renueva ni manda nada", async () => {
		gate.allows = false;

		expect(await resendInvitation(ROW_ID, "acme")).toEqual(SIN_PERMISO);
		expect(updates()).toHaveLength(0);
		expect(mail.sent).toHaveLength(0);
	});
});
