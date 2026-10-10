import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONN = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
	admin: true,
	rpc: {
		data: "22222222-2222-4222-8222-222222222222" as string | null,
		error: null as { code?: string; message: string; hint?: string } | null,
	},
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	row: {
		id: "22222222-2222-4222-8222-222222222222",
		tenant_id: "11111111-1111-4111-8111-111111111111",
		connector_uid: "acme-coldiq",
		config: {} as Record<string, unknown>,
		provider: "coldiq",
	} as Record<string, unknown> | null,
	revalidated: [] as string[],
	inVercel: true,
	describe: {} as Record<
		string,
		{ name: string; service: string } | null | Error
	>,
	describeCalls: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));
vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { supabase: {}, userId: "u1" } : null,
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		rpc: async (fn: string, args: Record<string, unknown>) => {
			state.rpcCalls.push({ fn, args });
			return state.rpc;
		},
		from: () => ({
			select: () => ({
				eq: () => ({
					maybeSingle: async () => ({ data: state.row, error: null }),
				}),
			}),
		}),
	}),
}));
vi.mock("@/lib/connectors/auth", () => ({
	describeConnector: async (uid: string) => {
		state.describeCalls.push(uid);
		const answer = state.describe[uid];
		if (answer instanceof Error) throw answer;
		return answer ?? null;
	},
}));
vi.mock("@/lib/connectors/env", () => ({ inVercel: () => state.inVercel }));

const actions = await import("@/app/plataforma/[slug]/console-actions");

const SIN_PERMISO = { ok: false, message: "No tenés permiso." };
const GENERICO = { ok: false, message: "No se pudo guardar. Probá de nuevo." };

beforeEach(() => {
	state.admin = true;
	state.rpc = { data: CONN, error: null };
	state.rpcCalls = [];
	state.row = {
		id: CONN,
		tenant_id: TENANT,
		connector_uid: "acme-coldiq",
		config: {},
		provider: "coldiq",
	};
	state.revalidated = [];
	state.inVercel = true;
	state.describe = {
		"acme-coldiq": { name: "Acme ColdIQ", service: "coldiq" },
	};
	state.describeCalls = [];
});

describe("gate común", () => {
	it("sin plataforma, ninguna acción toca la base", async () => {
		state.admin = false;
		expect(
			await actions.setAgent("acme", TENANT, "outreach", true, "read"),
		).toEqual(SIN_PERMISO);
		expect(await actions.createBrain("acme", TENANT)).toEqual(SIN_PERMISO);
		expect(
			await actions.bindConnection("acme", TENANT, "coldiq", ["x"]),
		).toEqual(SIN_PERMISO);
		expect(await actions.setConnectionEnabled("acme", CONN, false)).toEqual(
			SIN_PERMISO,
		);
		expect(await actions.removeConnection("acme", CONN)).toEqual(SIN_PERMISO);
		expect(await actions.verifyConnection("acme", CONN)).toEqual(SIN_PERMISO);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un mensaje con hint consola se devuelve tal cual; otro error es genérico", async () => {
		state.rpc = {
			data: null,
			error: {
				code: "23514",
				message: "la empresa ya tiene un brain",
				hint: "consola",
			},
		};
		expect(await actions.createBrain("acme", TENANT)).toEqual({
			ok: false,
			message: "la empresa ya tiene un brain",
		});

		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		state.rpc = {
			data: null,
			error: { code: "XX000", message: "detalle interno" },
		};
		expect(await actions.createBrain("acme", TENANT)).toEqual(GENERICO);
		log.mockRestore();
	});

	it("revalida el listado y el detalle de la empresa", async () => {
		await actions.setAgent("acme", TENANT, "outreach", true, "read");
		expect(state.revalidated).toEqual(["/plataforma", "/plataforma/acme"]);
	});
});

describe("setAgent", () => {
	it("llama platform_set_agent con el actor", async () => {
		expect(
			await actions.setAgent("acme", TENANT, "outreach", false, "none"),
		).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "platform_set_agent",
				args: {
					p_actor: "u1",
					p_tenant: TENANT,
					p_agent: "outreach",
					p_enabled: false,
					p_brain: "none",
				},
			},
		]);
	});

	it.each(["soporte", "", "toString"])(
		"rechaza el agente %s fuera del catálogo",
		async (agent) => {
			expect(
				await actions.setAgent("acme", TENANT, agent, true, "read"),
			).toEqual({ ok: false, message: "Ese agente no existe en el catálogo." });
			expect(state.rpcCalls).toHaveLength(0);
		},
	);

	it("rechaza un acceso al brain desconocido y un id que no es guid", async () => {
		expect(
			(await actions.setAgent("acme", TENANT, "outreach", true, "todo")).ok,
		).toBe(false);
		expect(
			(await actions.setAgent("acme", "no-es-id", "outreach", true, "read")).ok,
		).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("createBrain", () => {
	it("asocia wiki con la configuración por defecto", async () => {
		expect(await actions.createBrain("acme", TENANT)).toEqual({ ok: true });
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_bind_connection",
			args: {
				p_actor: "u1",
				p_tenant: TENANT,
				p_capability: "brain",
				p_provider: "wiki",
				p_connector_uids: [],
				p_config: {
					categories: ["empresa", "producto", "comercial", "operacion"],
					requiredFrontmatter: ["title", "category", "status", "updated"],
					search: "fts",
				},
				p_verified_name: null,
			},
		});
	});
});

describe("bindConnection", () => {
	it("verifica en Vercel y asocia con el nombre del conector", async () => {
		expect(
			await actions.bindConnection("acme", TENANT, "coldiq", [" acme-coldiq "]),
		).toEqual({ ok: true });
		expect(state.describeCalls).toEqual(["acme-coldiq"]);
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_bind_connection",
			args: {
				p_actor: "u1",
				p_tenant: TENANT,
				p_capability: "leads",
				p_provider: "coldiq",
				p_connector_uids: ["acme-coldiq"],
				p_config: {},
				p_verified_name: "Acme ColdIQ",
			},
		});
	});

	it("si Vercel no conoce el conector, no escribe nada", async () => {
		state.describe = {};
		expect(
			await actions.bindConnection("acme", TENANT, "coldiq", ["nada"]),
		).toEqual({
			ok: false,
			message:
				"El conector `nada` no existe o no está adjunto a este proyecto en Vercel.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("si consultar a Vercel falla, no escribe nada", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		state.describe = { "acme-coldiq": new Error("red") };
		expect(
			await actions.bindConnection("acme", TENANT, "coldiq", ["acme-coldiq"]),
		).toEqual({
			ok: false,
			message: "No pude verificar el conector en Vercel. Probá de nuevo.",
		});
		expect(state.rpcCalls).toHaveLength(0);
		log.mockRestore();
	});

	it("fuera de Vercel asocia sin verificar", async () => {
		state.inVercel = false;
		await actions.bindConnection("acme", TENANT, "coldiq", ["acme-coldiq"]);
		expect(state.describeCalls).toHaveLength(0);
		expect(state.rpcCalls[0]?.args.p_verified_name).toBeNull();
	});

	it("un proveedor con llave exige exactamente un identificador; Apollo acepta varios", async () => {
		expect(
			(await actions.bindConnection("acme", TENANT, "coldiq", [])).ok,
		).toBe(false);
		expect(
			(await actions.bindConnection("acme", TENANT, "coldiq", ["a", "b"])).ok,
		).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);

		state.describe = {
			a: { name: "A", service: "apollo" },
			b: { name: "B", service: "apollo" },
		};
		expect(
			await actions.bindConnection("acme", TENANT, "apollo", ["a", "b"]),
		).toEqual({ ok: true });
		expect(state.rpcCalls[0]?.args).toMatchObject({
			p_capability: "leads",
			p_connector_uids: ["a", "b"],
			p_verified_name: "A, B",
		});
	});

	it("hubspot no lleva identificador: es el conector de plataforma", async () => {
		expect(await actions.bindConnection("acme", TENANT, "hubspot", [])).toEqual(
			{ ok: true },
		);
		expect(state.rpcCalls[0]?.args).toMatchObject({
			p_capability: "crm",
			p_provider: "hubspot",
			p_connector_uids: [],
		});
		expect(
			(await actions.bindConnection("acme", TENANT, "hubspot", ["x"])).ok,
		).toBe(false);
	});

	it.each(["wiki", "nada", "mcp"])(
		"el proveedor %s no se asocia desde este formulario",
		async (provider) => {
			expect(
				(await actions.bindConnection("acme", TENANT, provider, ["x"])).ok,
			).toBe(false);
			expect(state.rpcCalls).toHaveLength(0);
		},
	);

	it("un identificador con espacios o comillas no pasa", async () => {
		expect(
			(await actions.bindConnection("acme", TENANT, "coldiq", ["a b"])).ok,
		).toBe(false);
		expect(
			(await actions.bindConnection("acme", TENANT, "coldiq", ['a"b'])).ok,
		).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un conector de otra empresa se informa con su identificador", async () => {
		state.rpc = {
			data: null,
			error: {
				code: "23505",
				message: "el conector acme-coldiq ya está asociado a otra empresa",
				hint: "consola",
			},
		};
		expect(
			await actions.bindConnection("acme", TENANT, "coldiq", ["acme-coldiq"]),
		).toEqual({
			ok: false,
			message: "el conector acme-coldiq ya está asociado a otra empresa",
		});
	});
});

describe("setConnectionEnabled, removeConnection, verifyConnection", () => {
	it("habilitar y quitar llaman a su función", async () => {
		expect(await actions.setConnectionEnabled("acme", CONN, false)).toEqual({
			ok: true,
		});
		expect(await actions.removeConnection("acme", CONN)).toEqual({ ok: true });
		expect(state.rpcCalls.map((c) => c.fn)).toEqual([
			"platform_set_connection_enabled",
			"platform_remove_connection",
		]);
		expect(state.rpcCalls[0]?.args).toEqual({
			p_actor: "u1",
			p_connection: CONN,
			p_enabled: false,
		});
	});

	it("verificar consulta cada identificador de la fila y guarda el nombre", async () => {
		state.row = {
			id: CONN,
			tenant_id: TENANT,
			connector_uid: "a",
			config: { connectorUids: ["a", "b"] },
			provider: "apollo",
		};
		state.describe = {
			a: { name: "A", service: "apollo" },
			b: { name: "B", service: "apollo" },
		};

		expect(await actions.verifyConnection("acme", CONN)).toEqual({ ok: true });
		expect(state.describeCalls).toEqual(["a", "b"]);
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_mark_connection_verified",
			args: { p_actor: "u1", p_connection: CONN, p_verified_name: "A, B" },
		});
	});

	it("verificar un conector que Vercel no conoce lo deja sin verificar y lo dice", async () => {
		state.describe = {};
		expect(await actions.verifyConnection("acme", CONN)).toEqual({
			ok: false,
			message:
				"El conector `acme-coldiq` no existe o no está adjunto a este proyecto en Vercel.",
		});
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_mark_connection_verified",
			args: { p_actor: "u1", p_connection: CONN, p_verified_name: null },
		});
	});

	it("verificar fuera de Vercel no hace nada y lo explica", async () => {
		state.inVercel = false;
		expect(await actions.verifyConnection("acme", CONN)).toEqual({
			ok: false,
			message: "La verificación contra Vercel solo corre en un deploy.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("verificar una fila que no existe o sin identificador no consulta", async () => {
		state.row = null;
		expect((await actions.verifyConnection("acme", CONN)).ok).toBe(false);
		state.row = {
			id: CONN,
			tenant_id: TENANT,
			connector_uid: null,
			config: {},
			provider: "hubspot",
		};
		expect(await actions.verifyConnection("acme", CONN)).toEqual({
			ok: false,
			message: "Este conector no tiene identificador que verificar.",
		});
		expect(state.describeCalls).toHaveLength(0);
	});
});
