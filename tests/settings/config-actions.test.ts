// tests/settings/config-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CONN = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
	access: {
		id: "11111111-1111-4111-8111-111111111111",
		slug: "acme",
		role: "tenant_admin",
		userId: "me",
	} as { id: string; slug: string; role: string; userId: string } | null,
	allows: true,
	rpc: { data: null, error: null } as {
		data: unknown;
		error: { code?: string; message: string; hint?: string } | null;
	},
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	resolved: [] as string[],
	revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async (slug: string) => {
		state.resolved.push(slug);
		return state.access;
	},
}));
vi.mock("@/lib/tenants/login-check-server", () => ({
	actionAllowsLogin: async () => state.allows,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		rpc: async (fn: string, args: Record<string, unknown>) => {
			state.rpcCalls.push({ fn, args });
			return state.rpc;
		},
	}),
}));

const actions = await import("@/app/[tenant]/settings/config-actions");

const SIN_PERMISO = { ok: false, message: "No tenés permiso." };
const INVALIDO = { ok: false, message: "No se pudo procesar el pedido." };
const GENERICO = { ok: false, message: "No se pudo guardar. Probá de nuevo." };
const INPUT = {
	slug: "ana",
	displayName: "Ana López",
	title: "AE",
	linkedinUrl: "https://www.linkedin.com/in/ana",
	dailyQuota: 40,
};

beforeEach(() => {
	state.access = {
		id: TENANT,
		slug: "acme",
		role: "tenant_admin",
		userId: "me",
	};
	state.allows = true;
	state.rpc = { data: null, error: null };
	state.rpcCalls = [];
	state.resolved = [];
	state.revalidated = [];
});

const all = () => [
	actions.saveExecutor("acme", USER, INPUT),
	actions.removeExecutor("acme", USER),
	actions.saveApproval("acme", "outreach", "outreach/crm-record", "auto"),
	actions.toggleConnection("acme", CONN, false),
];

describe("gate común", () => {
	it("sin acceso a la empresa, ninguna acción llama a la base", async () => {
		state.access = null;
		expect(await Promise.all(all())).toEqual([
			SIN_PERMISO,
			SIN_PERMISO,
			SIN_PERMISO,
			SIN_PERMISO,
		]);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un miembro no llama a la base", async () => {
		state.access = {
			id: TENANT,
			slug: "acme",
			role: "tenant_member",
			userId: "me",
		};
		expect(await Promise.all(all())).toEqual([
			SIN_PERMISO,
			SIN_PERMISO,
			SIN_PERMISO,
			SIN_PERMISO,
		]);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("si la empresa no permite el método de la sesión, tampoco", async () => {
		state.allows = false;
		expect(await Promise.all(all())).toEqual([
			SIN_PERMISO,
			SIN_PERMISO,
			SIN_PERMISO,
			SIN_PERMISO,
		]);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("la empresa sale del slug resuelto con la sesión, nunca de un argumento", async () => {
		await actions.toggleConnection("acme", CONN, true);
		expect(state.resolved).toEqual(["acme"]);
		expect(state.rpcCalls[0]?.args.p_tenant).toBe(TENANT);
	});

	it("un slug con forma inválida ni siquiera se resuelve", async () => {
		expect(await actions.removeExecutor("../otra", USER)).toEqual(INVALIDO);
		expect(state.resolved).toHaveLength(0);
	});

	it("un platform_admin pasa", async () => {
		state.access = {
			id: TENANT,
			slug: "acme",
			role: "platform_admin",
			userId: "me",
		};
		expect(await actions.toggleConnection("acme", CONN, true)).toEqual({
			ok: true,
		});
	});

	it("traduce los errores de la base", async () => {
		state.rpc = {
			data: null,
			error: {
				code: "23514",
				message: "el cupo diario va de 0 a 200",
				hint: "settings",
			},
		};
		expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual({
			ok: false,
			message: "el cupo diario va de 0 a 200",
		});

		state.rpc = {
			data: null,
			error: {
				code: "23505",
				message: "ese slug ya lo usa otro ejecutor",
				hint: "settings",
			},
		};
		expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual({
			ok: false,
			message: "ese slug ya lo usa otro ejecutor",
		});

		state.rpc = {
			data: null,
			error: {
				code: "42501",
				message: "solo un administrador puede cambiar esto",
			},
		};
		expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual(
			SIN_PERMISO,
		);

		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// Un 23514 SIN hint es un check de la tabla: su texto no va a la pantalla.
			state.rpc = {
				data: null,
				error: {
					code: "23514",
					message: 'violates check constraint "executors_slug_check"',
				},
			};
			expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual(GENERICO);
			expect(log).toHaveBeenCalledWith(
				"settings:",
				"23514",
				'violates check constraint "executors_slug_check"',
			);
		} finally {
			log.mockRestore();
		}
	});

	it("revalida el settings de la empresa solo cuando salió bien", async () => {
		await actions.toggleConnection("acme", CONN, true);
		expect(state.revalidated).toEqual(["/acme/settings"]);

		state.revalidated = [];
		state.rpc = { data: null, error: { code: "42501", message: "x" } };
		await actions.toggleConnection("acme", CONN, true);
		expect(state.revalidated).toEqual([]);
	});
});

describe("saveExecutor", () => {
	it("llama set_executor con los argumentos exactos", async () => {
		expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual({
			ok: true,
		});
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_executor",
				args: {
					p_tenant: TENANT,
					p_user: USER,
					p_slug: "ana",
					p_display_name: "Ana López",
					p_title: "AE",
					p_linkedin_url: "https://www.linkedin.com/in/ana",
					p_daily_quota: 40,
				},
			},
		]);
	});

	it.each([
		["usuario que no es guid", "no-es-id", INPUT],
		["cupo no entero", USER, { ...INPUT, dailyQuota: 1.5 }],
		[
			"cupo como texto",
			USER,
			{ ...INPUT, dailyQuota: "40" as unknown as number },
		],
		["slug vacío", USER, { ...INPUT, slug: "" }],
		[
			"nombre de 500 caracteres",
			USER,
			{ ...INPUT, displayName: "x".repeat(500) },
		],
	])("rechaza %s sin llamar a la base", async (_name, userId, input) => {
		expect(await actions.saveExecutor("acme", userId, input)).toEqual(INVALIDO);
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("removeExecutor", () => {
	it("llama remove_executor", async () => {
		expect(await actions.removeExecutor("acme", USER)).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{ fn: "remove_executor", args: { p_tenant: TENANT, p_user: USER } },
		]);
	});
});

describe("saveApproval", () => {
	it("llama set_approval para un nodo de nivel 2", async () => {
		expect(
			await actions.saveApproval(
				"acme",
				"outreach",
				"outreach/crm-record",
				"auto",
			),
		).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_approval",
				args: {
					p_tenant: TENANT,
					p_agent: "outreach",
					p_node: "outreach/crm-record",
					p_policy: "auto",
				},
			},
		]);
	});

	it.each([
		["nivel 3", "outreach", "outreach/send"],
		["nivel 1", "outreach", "outreach/research"],
		["nodo inexistente", "outreach", "outreach/nada"],
		["nodo de otro agente", "soporte", "outreach/crm-record"],
	])(
		"un paso de %s no admite política y no llega a la base",
		async (_name, agent, node) => {
			expect(await actions.saveApproval("acme", agent, node, "auto")).toEqual({
				ok: false,
				message: "Ese paso no admite política.",
			});
			expect(state.rpcCalls).toHaveLength(0);
		},
	);

	it("una política desconocida no llega a la base", async () => {
		expect(
			await actions.saveApproval(
				"acme",
				"outreach",
				"outreach/crm-record",
				"nunca",
			),
		).toEqual(INVALIDO);
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("toggleConnection", () => {
	it("llama set_connection_enabled", async () => {
		expect(await actions.toggleConnection("acme", CONN, false)).toEqual({
			ok: true,
		});
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_connection_enabled",
				args: { p_tenant: TENANT, p_connection: CONN, p_enabled: false },
			},
		]);
	});

	it("rechaza un id o un estado inválidos", async () => {
		expect(await actions.toggleConnection("acme", "x", true)).toEqual(INVALIDO);
		expect(
			await actions.toggleConnection(
				"acme",
				CONN,
				"true" as unknown as boolean,
			),
		).toEqual(INVALIDO);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("una conexión que no es de la empresa se informa sin detalle", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.rpc = {
				data: null,
				error: { code: "P0002", message: "no existe la conexión" },
			};
			expect(await actions.toggleConnection("acme", CONN, true)).toEqual(
				GENERICO,
			);
		} finally {
			log.mockRestore();
		}
	});
});
