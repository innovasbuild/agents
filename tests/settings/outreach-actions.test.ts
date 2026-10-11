import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOWS } from "@/lib/workflows/registry";

const TENANT = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
	access: null as {
		id: string;
		slug: string;
		role: string;
		userId: string;
		allowedModels: string[];
	} | null,
	allows: true,
	rpc: { data: null, error: null } as {
		data: unknown;
		error: { code?: string; message: string; hint?: string } | null;
	},
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	revalidated: [] as string[],
	reflect: { ok: true, upserts: 2, deactivated: 1, unchanged: 3 } as Record<
		string,
		unknown
	>,
	reflectCalls: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.access,
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
vi.mock("@/lib/outreach/marco-reflect", () => ({
	reflectMarcoForTenant: async (tenantId: string) => {
		state.reflectCalls.push(tenantId);
		return state.reflect;
	},
}));

const actions = await import("@/app/[tenant]/settings/outreach/actions");

const SIN_PERMISO = { ok: false, message: "No tenés permiso." };
const INVALIDO = { ok: false, message: "No se pudo procesar el pedido." };
const CONFIG = {
	timezone: "America/Montevideo",
	bcc: "",
	dealPipeline: "",
	dealStage: "",
	companyName: "",
	companyUrl: "",
	models: {} as Record<string, string>,
};
const WF = { enabled: true, cadenceMinutes: 60, itemsPerTick: 2 };

beforeEach(() => {
	state.access = {
		id: TENANT,
		slug: "acme",
		role: "tenant_admin",
		userId: "me",
		allowedModels: ["anthropic/claude-sonnet-5"],
	};
	state.allows = true;
	state.rpc = { data: null, error: null };
	state.rpcCalls = [];
	state.revalidated = [];
	state.reflect = { ok: true, upserts: 2, deactivated: 1, unchanged: 3 };
	state.reflectCalls = [];
});

describe("permisos", () => {
	it("un miembro no llama a la base ni relee el brain", async () => {
		state.access = {
			...(state.access as NonNullable<typeof state.access>),
			role: "tenant_member",
		};
		expect(
			await actions.saveListValue("acme", "segmento", "seg", "Seg", true),
		).toEqual(SIN_PERMISO);
		expect(await actions.saveOutreachConfig("acme", CONFIG)).toEqual(
			SIN_PERMISO,
		);
		expect(await actions.saveWorkflow("acme", "refresh-fichas", WF)).toEqual(
			SIN_PERMISO,
		);
		expect(await actions.rereadMarco("acme")).toEqual(SIN_PERMISO);
		expect(state.rpcCalls).toHaveLength(0);
		expect(state.reflectCalls).toHaveLength(0);
	});
});

describe("saveListValue", () => {
	it("llama set_list_value con la empresa de la sesión y revalida", async () => {
		expect(
			await actions.saveListValue(
				"acme",
				"segmento",
				"mid_market",
				" Mid market ",
				true,
			),
		).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_list_value",
				args: {
					p_tenant: TENANT,
					p_kind: "segmento",
					p_value: "mid_market",
					p_label: "Mid market",
					p_active: true,
				},
			},
		]);
		expect(state.revalidated).toEqual(["/acme/settings/outreach"]);
	});

	it("hooks y vectores se rechazan sin llamar a la base", async () => {
		expect(
			await actions.saveListValue("acme", "hook", "h_uno", "Uno", true),
		).toEqual({
			ok: false,
			message: "Los hooks y vectores se editan en el brain.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un idioma que la plataforma no soporta se rechaza", async () => {
		expect(
			await actions.saveListValue("acme", "idioma", "pt_br", "Portugués", true),
		).toEqual({
			ok: false,
			message: "Ese idioma todavía no está disponible.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("muestra el mensaje de la base cuando trae hint settings", async () => {
		state.rpc = {
			data: null,
			error: {
				code: "23514",
				message: "tiene que quedar al menos uno activo",
				hint: "settings",
			},
		};
		expect(
			await actions.saveListValue(
				"acme",
				"idioma",
				"es_ar",
				"Rioplatense",
				false,
			),
		).toEqual({
			ok: false,
			message: "tiene que quedar al menos uno activo",
		});
	});
});

describe("saveOutreachConfig", () => {
	it("los campos vacíos viajan como null, no como cadena vacía", async () => {
		expect(await actions.saveOutreachConfig("acme", CONFIG)).toEqual({
			ok: true,
		});
		expect(state.rpcCalls[0]).toEqual({
			fn: "set_outreach_config",
			args: {
				p_tenant: TENANT,
				p_config: {
					timezone: "America/Montevideo",
					bcc: null,
					deal: null,
					company: null,
					models: {},
				},
			},
		});
	});

	it("arma deal, empresa y modelos cuando vienen completos", async () => {
		await actions.saveOutreachConfig("acme", {
			timezone: "America/Montevideo",
			bcc: "bcc@acme.test",
			dealPipeline: "default",
			dealStage: "123",
			companyName: "Acme",
			companyUrl: "https://acme.test",
			models: { draft_msg1: "anthropic/claude-sonnet-5", classify: "" },
		});
		expect(state.rpcCalls[0].args.p_config).toEqual({
			timezone: "America/Montevideo",
			bcc: "bcc@acme.test",
			deal: { pipeline: "default", stage: "123" },
			company: { name: "Acme", url: "https://acme.test" },
			models: { draft_msg1: "anthropic/claude-sonnet-5" },
		});
	});

	it.each([
		[
			"zona horaria inválida",
			{ ...CONFIG, timezone: "Marte/Olympus" },
			"Revisá la zona horaria.",
		],
		[
			"BCC que no es un mail",
			{ ...CONFIG, bcc: "no-es-mail" },
			"Revisá el mail de BCC.",
		],
		[
			"deal a medias",
			{ ...CONFIG, dealPipeline: "default" },
			"El deal necesita pipeline y etapa, o ninguno de los dos.",
		],
		[
			"empresa a medias",
			{ ...CONFIG, companyName: "Acme" },
			"La empresa que firma necesita nombre y URL, o ninguno de los dos.",
		],
		[
			"URL inválida",
			{ ...CONFIG, companyName: "Acme", companyUrl: "acme" },
			"Revisá la URL de la empresa.",
		],
		[
			"modelo fuera de los permitidos",
			{ ...CONFIG, models: { draft_msg1: "otro/modelo" } },
			"Ese modelo no está entre los permitidos de la empresa.",
		],
		[
			"rol de modelo desconocido",
			{ ...CONFIG, models: { inventado: "anthropic/claude-sonnet-5" } },
			"No se pudo procesar el pedido.",
		],
	])("%s: no llama a la base", async (_name, input, message) => {
		expect(await actions.saveOutreachConfig("acme", input)).toEqual({
			ok: false,
			message,
		});
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("saveWorkflow", () => {
	it("llama set_workflow", async () => {
		expect(await actions.saveWorkflow("acme", "refresh-fichas", WF)).toEqual({
			ok: true,
		});
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_workflow",
				args: {
					p_tenant: TENANT,
					p_workflow: "refresh-fichas",
					p_enabled: true,
					p_cadence_minutes: 60,
					p_items_per_tick: 2,
				},
			},
		]);
	});

	it("un workflow que no está en el registry no llega a la base", async () => {
		expect(await actions.saveWorkflow("acme", "inventado", WF)).toEqual({
			ok: false,
			message: "Ese proceso no existe.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("los ítems no pasan el tope del workflow", async () => {
		const max = WORKFLOWS["refresh-fichas"].caps.itemsPerTick;
		expect(
			await actions.saveWorkflow("acme", "refresh-fichas", {
				...WF,
				itemsPerTick: max + 1,
			}),
		).toEqual({
			ok: false,
			message: `Ese proceso admite hasta ${max} por pasada.`,
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("números que no son enteros se rechazan con un mensaje legible", async () => {
		const out = { ok: false, message: "Poné un número entero." };
		expect(
			await actions.saveWorkflow("acme", "refresh-fichas", {
				...WF,
				cadenceMinutes: 60.5,
			}),
		).toEqual(out);
		expect(
			await actions.saveWorkflow("acme", "refresh-fichas", {
				...WF,
				itemsPerTick: 2.5,
			}),
		).toEqual(out);
		expect(
			await actions.saveWorkflow("acme", "refresh-fichas", {
				...WF,
				cadenceMinutes: Number.NaN,
			}),
		).toEqual(out);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it.each([
		[{ cadenceMinutes: 4 }, "La cadencia va de 5 a 10080 minutos."],
		[{ cadenceMinutes: 10081 }, "La cadencia va de 5 a 10080 minutos."],
		[{ itemsPerTick: 0 }, "Los ítems por pasada van de 1 a 1000."],
		[{ itemsPerTick: 1001 }, "Los ítems por pasada van de 1 a 1000."],
	])("fuera de rango %j", async (patch, message) => {
		expect(
			await actions.saveWorkflow("acme", "refresh-fichas", { ...WF, ...patch }),
		).toEqual({ ok: false, message });
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("rereadMarco", () => {
	it("relee el brain de la empresa de la sesión y cuenta lo que cambió", async () => {
		expect(await actions.rereadMarco("acme")).toEqual({
			ok: true,
			message: "Listo: 2 altas o cambios, 1 baja, 3 sin cambios.",
		});
		expect(state.reflectCalls).toEqual([TENANT]);
		expect(state.revalidated).toEqual(["/acme/settings/outreach"]);
	});

	it("los contadores en singular y en cero", async () => {
		state.reflect = { ok: true, upserts: 1, deactivated: 0, unchanged: 1 };
		expect(await actions.rereadMarco("acme")).toEqual({
			ok: true,
			message: "Listo: 1 alta o cambio, 0 bajas, 1 sin cambios.",
		});
	});

	it.each([
		["sin_brain", [], "La empresa no tiene brain habilitado."],
		["brain_caido", [], "No pude leer el brain. Probá de nuevo."],
		[
			"falta",
			[],
			"No encontré bloques hooks y vectores en páginas activas con el tag canon:hooks.",
		],
		[
			"invalido",
			["a, línea 2: x", "b, línea 3: y"],
			"Los bloques no son válidos: a, línea 2: x · b, línea 3: y",
		],
	])("%s", async (reason, errors, message) => {
		state.reflect = { ok: false, reason, errors };
		expect(await actions.rereadMarco("acme")).toEqual({ ok: false, message });
	});
});
