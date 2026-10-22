import { beforeEach, describe, expect, it, vi } from "vitest";
import { GENERIC_FOLDERS } from "@/lib/onboarding/folder-template";
import {
	decideCarpetasView,
	effectiveResearchStatus,
} from "@/lib/onboarding/research-status";

const state: {
	access: {
		id: string;
		slug: string;
		displayName: string;
		role: string;
		userId: string;
		defaultModel: string;
	} | null;
	tenantRow: {
		onboarding_step: string | null;
		allowed_domains: string[];
		default_model: string;
	} | null;
	tenantReadFails: boolean;
	row: unknown;
	claimRows: unknown[];
	setup: { ok: true } | { ok: false; step: string; message: string };
	rpcCalls: [string, unknown][];
	rpcError: { message: string } | null;
	redirected: string | null;
	aiBlock: string | null;
	researchRuns: number;
	usageFilters: [string, unknown][];
} = {
	access: null,
	tenantRow: null,
	tenantReadFails: false,
	row: null,
	claimRows: [],
	setup: { ok: true },
	rpcCalls: [],
	rpcError: null,
	redirected: null,
	aiBlock: null,
	researchRuns: 0,
	usageFilters: [],
};

const store = {
	start: vi.fn(async () => undefined),
	finish: vi.fn(async () => undefined),
	fail: vi.fn(async () => undefined),
	read: vi.fn(async () => state.row),
};
const runFolderResearch = vi.fn(async () => undefined);
const setupBrainFolders = vi.fn(async () => state.setup);
const upsertClaim = vi.fn();

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		state.redirected = path;
		throw new Error("NEXT_REDIRECT");
	},
}));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.access,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		rpc: async (fn: string, args: unknown) => {
			state.rpcCalls.push([fn, args]);
			return { error: state.rpcError };
		},
	}),
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		rpc: async () => ({ error: null }),
		from: (table: string) =>
			table === "tenants"
				? {
						select: () => ({
							eq: () => ({
								single: async () =>
									state.tenantReadFails
										? { data: null, error: { message: "x" } }
										: { data: state.tenantRow, error: null },
							}),
						}),
					}
				: table === "usage_entries"
					? {
							select: (_cols: string, opts: unknown) => {
								state.usageFilters.push(["select", opts]);
								const q = {
									eq: (col: string, val: unknown) => {
										state.usageFilters.push([col, val]);
										return q;
									},
									// biome-ignore lint/suspicious/noThenProperty: imita el builder de PostgREST
									then: (
										resolve: (v: { count: number; error: null }) => void,
									) => resolve({ count: state.researchRuns, error: null }),
								};
								return q;
							},
						}
					: table === "brain_folders"
						? {
								select: () => ({
									eq: async () => ({
										data: [{ path: "a" }, { path: "a/b" }],
										error: null,
									}),
								}),
							}
						: {
								upsert: (...args: unknown[]) => {
									upsertClaim(...args);
									return {
										select: async () => ({
											data: state.claimRows,
											error: null,
										}),
									};
								},
							},
	}),
}));
vi.mock("@/lib/onboarding/research-store", () => ({
	createResearchStore: () => store,
}));
vi.mock("@/lib/onboarding/research-run", () => ({ runFolderResearch }));
vi.mock("@/lib/onboarding/research-deps", () => ({
	folderResearchDeps: () => ({}),
}));
vi.mock("@/lib/onboarding/folders-setup", async (orig) => ({
	...(await orig<typeof import("@/lib/onboarding/folders-setup")>()),
	setupBrainFolders,
}));
vi.mock("@/lib/outreach/canon", () => ({ brainForTenant: async () => null }));
vi.mock("@/lib/plans/chat-allowance", () => ({
	chatAiBlock: async () => state.aiBlock,
}));

const {
	confirmFolders,
	ensureResearch,
	readResearch,
	retryResearch,
	useGenericFolders: genericFolders,
} = await import("@/app/empezar/[slug]/carpetas/actions");

const ok = [
	{
		slug: "direccion",
		name: "Dirección",
		description: "Estrategia.",
		restricted: true,
	},
	{
		slug: "comercial",
		name: "Comercial",
		description: "Ventas.",
		restricted: false,
	},
];
const doneRow = (summary = "Hacemos harina.") => ({
	status: "done",
	hint: null,
	error: null,
	updatedAt: new Date().toISOString(),
	result: { found: true, company: { summary }, brand: {}, folders: ok },
});

beforeEach(() => {
	state.access = {
		id: "t1",
		slug: "acme",
		displayName: "Acme",
		role: "tenant_admin",
		userId: "u1",
		defaultModel: "m1",
	};
	state.tenantRow = {
		onboarding_step: "carpetas",
		allowed_domains: ["acme.com"],
		default_model: "m1",
	};
	state.tenantReadFails = false;
	state.row = doneRow();
	state.claimRows = [{ tenant_id: "t1" }];
	state.setup = { ok: true };
	state.rpcCalls = [];
	state.rpcError = null;
	state.redirected = null;
	state.aiBlock = null;
	state.researchRuns = 0;
	state.usageFilters = [];
	for (const fn of [
		store.start,
		store.finish,
		store.fail,
		store.read,
		runFolderResearch,
		setupBrainFolders,
		upsertClaim,
	])
		fn.mockClear();
});

async function redirectOf(p: Promise<unknown>) {
	await expect(p).rejects.toThrow("NEXT_REDIRECT");
	return state.redirected;
}

describe("confirmFolders", () => {
	it("con todo bien arma el brain, avanza a logo y redirige", async () => {
		expect(await redirectOf(confirmFolders("acme", ok))).toBe(
			"/empezar/acme/logo",
		);
		expect(setupBrainFolders).toHaveBeenCalledTimes(1);
		expect(setupBrainFolders.mock.calls[0]).toBeDefined();
		expect(state.rpcCalls).toEqual([
			["set_onboarding_step", { p_tenant: "t1", p_step: "logo" }],
		]);
	});

	it.each([
		["slug skills", [{ ...ok[0], slug: "skills" }]],
		["slug brain", [{ ...ok[0], slug: "brain" }]],
		["slug con mayúsculas", [{ ...ok[0], slug: "Direccion" }]],
		["cero carpetas", []],
		[
			"20 carpetas",
			Array.from({ length: 20 }, (_, i) => ({ ...ok[0], slug: `c${i}` })),
		],
		["slugs duplicados", [ok[0], { ...ok[1], slug: "DIRECCION" }]],
		["nombre vacío", [{ ...ok[0], name: " " }]],
		["nombre largo", [{ ...ok[0], name: "x".repeat(61) }]],
		["descripción larga", [{ ...ok[0], description: "x".repeat(301) }]],
	])("rechaza %s", async (_label, folders) => {
		const result = await confirmFolders("acme", folders);
		expect(result).toMatchObject({ ok: false });
		expect(setupBrainFolders).not.toHaveBeenCalled();
	});

	it("acepta 19 carpetas", async () => {
		const nineteen = Array.from({ length: 19 }, (_, i) => ({
			...ok[0],
			slug: `c${i}`,
		}));
		expect(await redirectOf(confirmFolders("acme", nineteen))).toBe(
			"/empezar/acme/logo",
		);
	});

	it("rechaza a quien no es administrador", async () => {
		state.access = { ...state.access!, role: "tenant_member" };
		expect(await confirmFolders("acme", ok)).toMatchObject({ ok: false });
		state.access = null;
		expect(await confirmFolders("acme", ok)).toMatchObject({ ok: false });
		expect(setupBrainFolders).not.toHaveBeenCalled();
	});

	it("rechaza si onboarding_step no es carpetas", async () => {
		state.tenantRow = { ...state.tenantRow!, onboarding_step: "logo" };
		expect(await confirmFolders("acme", ok)).toMatchObject({ ok: false });
		expect(setupBrainFolders).not.toHaveBeenCalled();
		expect(state.rpcCalls).toEqual([]);
	});

	it("si el armado falla devuelve el mensaje y no avanza", async () => {
		state.setup = { ok: false, step: "skills", message: "no" };
		expect(await confirmFolders("acme", ok)).toMatchObject({ ok: false });
		expect(state.rpcCalls).toEqual([]);
	});

	it("si set_onboarding_step falla no redirige", async () => {
		state.rpcError = { message: "x" };
		expect(await confirmFolders("acme", ok)).toMatchObject({ ok: false });
		expect(state.redirected).toBeNull();
	});

	it("la página inicial usa el resumen del research", async () => {
		await redirectOf(confirmFolders("acme", ok));
		const arg = setupBrainFolders.mock.calls[0] as unknown as [
			{ companySummary: string | null; tenantId: string; actorUserId: string },
		];
		expect(arg[0]).toMatchObject({
			companySummary: "Hacemos harina.",
			tenantId: "t1",
			actorUserId: "u1",
		});
	});
});

describe("retryResearch", () => {
	it("valida el hint", async () => {
		expect(await retryResearch("acme", "   ")).toEqual({ ok: false });
		expect(await retryResearch("acme", "x".repeat(2001))).toEqual({
			ok: false,
		});
		expect(store.start).not.toHaveBeenCalled();
	});
	it("guarda el hint y corre el research con él", async () => {
		expect(await retryResearch("acme", "  Molino de trigo.  ")).toEqual({
			ok: true,
		});
		expect(store.start).toHaveBeenCalledWith("t1", "Molino de trigo.");
		expect(runFolderResearch).toHaveBeenCalledWith(
			{
				tenantId: "t1",
				domain: "acme.com",
				displayName: "Acme",
				hint: "Molino de trigo.",
				model: "m1",
			},
			{},
		);
	});
	it("no corre si no es administrador", async () => {
		state.access = { ...state.access!, role: "tenant_member" };
		expect(await retryResearch("acme", "algo")).toEqual({ ok: false });
		expect(runFolderResearch).not.toHaveBeenCalled();
	});
});

describe("corrida en curso", () => {
	const fresh = () => ({
		status: "running",
		hint: null,
		result: null,
		error: null,
		updatedAt: new Date().toISOString(),
	});
	const stale = () => ({
		...fresh(),
		updatedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
	});
	it("retryResearch y useGenericFolders se niegan con un running fresco", async () => {
		state.row = fresh();
		expect(await retryResearch("acme", "algo")).toMatchObject({
			ok: false,
			message: expect.any(String),
		});
		expect(await genericFolders("acme")).toMatchObject({
			ok: false,
			message: expect.any(String),
		});
		expect(store.start).not.toHaveBeenCalled();
		expect(store.finish).not.toHaveBeenCalled();
		expect(runFolderResearch).not.toHaveBeenCalled();
	});
	it("con running viejo o error se permiten", async () => {
		for (const row of [stale(), { ...fresh(), status: "error" }]) {
			state.row = row;
			expect(await retryResearch("acme", "algo")).toEqual({ ok: true });
			expect(await genericFolders("acme")).toEqual({ ok: true });
		}
	});
});

describe("useGenericFolders", () => {
	it("termina con las carpetas genéricas", async () => {
		expect(await genericFolders("acme")).toEqual({ ok: true });
		expect(store.finish).toHaveBeenCalledWith(
			"t1",
			expect.objectContaining({ found: true, folders: GENERIC_FOLDERS }),
		);
	});
});

describe("ensureResearch", () => {
	it("si ya hay fila no hace nada", async () => {
		expect(await ensureResearch("acme")).toEqual({ ok: true });
		expect(upsertClaim).not.toHaveBeenCalled();
		expect(runFolderResearch).not.toHaveBeenCalled();
	});
	it("sin fila la reclama y corre una vez", async () => {
		state.row = null;
		await ensureResearch("acme");
		expect(upsertClaim).toHaveBeenCalledTimes(1);
		expect(runFolderResearch).toHaveBeenCalledTimes(1);
		expect(runFolderResearch).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "t1",
				domain: "acme.com",
				hint: null,
				model: "m1",
			}),
			{},
		);
	});
	it("si otro ya la reclamó no corre una segunda vez", async () => {
		state.row = null;
		state.claimRows = [];
		await ensureResearch("acme");
		expect(runFolderResearch).not.toHaveBeenCalled();
	});
	it("si no puede leer el tenant no corre", async () => {
		state.row = null;
		state.tenantReadFails = true;
		await ensureResearch("acme");
		expect(runFolderResearch).not.toHaveBeenCalled();
	});
	it("usa el modelo de la sesión si la fila del tenant no trae uno", async () => {
		state.row = null;
		state.tenantRow = { ...state.tenantRow!, default_model: "" };
		state.access = { ...state.access!, defaultModel: "" };
		await ensureResearch("acme");
		expect(runFolderResearch).toHaveBeenCalledWith(
			expect.objectContaining({ model: "anthropic/claude-sonnet-5" }),
			{},
		);
	});
});

describe("readResearch", () => {
	it("devuelve la fila", async () => {
		expect(await readResearch("acme")).toMatchObject({ status: "done" });
	});
	it("un running de más de 3 minutos se lee como error", async () => {
		state.row = {
			status: "running",
			hint: null,
			result: null,
			error: null,
			updatedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
		};
		expect(await readResearch("acme")).toMatchObject({ status: "error" });
	});
	it("null si no es administrador", async () => {
		state.access = null;
		expect(await readResearch("acme")).toBeNull();
	});
});

describe("effectiveResearchStatus", () => {
	const now = new Date("2026-10-22T12:00:00Z");
	const at = (minutes: number) =>
		new Date(now.getTime() - minutes * 60_000).toISOString();
	it("running reciente sigue running", () => {
		expect(
			effectiveResearchStatus({ status: "running", updatedAt: at(2) }, now),
		).toBe("running");
	});
	it("running de más de 3 minutos es error", () => {
		expect(
			effectiveResearchStatus({ status: "running", updatedAt: at(3.5) }, now),
		).toBe("error");
	});
	it("done y error no cambian", () => {
		expect(
			effectiveResearchStatus({ status: "done", updatedAt: at(60) }, now),
		).toBe("done");
		expect(
			effectiveResearchStatus({ status: "error", updatedAt: at(60) }, now),
		).toBe("error");
	});
});

describe("decideCarpetasView", () => {
	const now = new Date("2026-10-22T12:00:00Z");
	const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
	const row = (over: Record<string, unknown>) =>
		({
			status: "done",
			hint: null,
			result: null,
			error: null,
			updatedAt: ago(0),
			...over,
		}) as never;
	const base = { ensureFailed: false, nullSince: now.getTime() - 60_000, now };
	it("sin fila y ensure falló: sin sitio con nota", () => {
		expect(
			decideCarpetasView({ ...base, research: null, ensureFailed: true }),
		).toEqual({ view: "sin-sitio", note: true });
	});
	it("sin fila por más de 3 minutos: sin sitio", () => {
		expect(
			decideCarpetasView({
				...base,
				research: null,
				nullSince: now.getTime() - 4 * 60_000,
			}).view,
		).toBe("sin-sitio");
		expect(decideCarpetasView({ ...base, research: null }).view).toBe(
			"investigando",
		);
	});
	it("running fresco investiga; running viejo pide el dato", () => {
		expect(
			decideCarpetasView({
				...base,
				research: row({ status: "running", updatedAt: ago(1) }),
			}).view,
		).toBe("investigando");
		expect(
			decideCarpetasView({
				...base,
				research: row({ status: "running", updatedAt: ago(4) }),
			}),
		).toEqual({ view: "sin-sitio", note: true });
	});
	it("done con found propone; sin found y sin hint pide el dato", () => {
		const result = (found: boolean) => ({
			found,
			company: {},
			brand: {},
			folders: [],
		});
		expect(
			decideCarpetasView({ ...base, research: row({ result: result(true) }) })
				.view,
		).toBe("propuesta");
		expect(
			decideCarpetasView({ ...base, research: row({ result: result(false) }) }),
		).toEqual({ view: "sin-sitio", note: false });
	});
});

describe("tope de gasto del research (R13 F2)", () => {
	it("retryResearch se niega sin crédito de IA y no arranca nada", async () => {
		state.row = { ...doneRow(), status: "error" };
		state.aiBlock = "limit:ai_credit";
		const r = await retryResearch("acme", "Molino de trigo.");
		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/carpetas genéricas/);
		expect(store.start).not.toHaveBeenCalled();
		expect(runFolderResearch).not.toHaveBeenCalled();
	});

	it("retryResearch se niega con 6 corridas asentadas", async () => {
		state.row = { ...doneRow(), status: "error" };
		state.researchRuns = 6;
		const r = await retryResearch("acme", "Molino de trigo.");
		expect(r).toEqual({
			ok: false,
			message:
				"Ya intentamos varias veces. Usá las carpetas genéricas y las ajustás después.",
		});
		expect(store.start).not.toHaveBeenCalled();
		expect(runFolderResearch).not.toHaveBeenCalled();
		expect(state.usageFilters).toEqual(
			expect.arrayContaining([
				["tenant_id", "t1"],
				["node", "onboarding/propose-folders"],
			]),
		);
	});

	it("con 5 corridas y crédito el reintento sigue", async () => {
		state.row = { ...doneRow(), status: "error" };
		state.researchRuns = 5;
		expect(await retryResearch("acme", "Molino de trigo.")).toEqual({
			ok: true,
		});
		expect(runFolderResearch).toHaveBeenCalledTimes(1);
	});

	it("ensureResearch no reclama ni corre sin crédito", async () => {
		state.row = null;
		state.aiBlock = "limit:ai_credit";
		expect(await ensureResearch("acme")).toEqual({ ok: false });
		expect(upsertClaim).not.toHaveBeenCalled();
		expect(runFolderResearch).not.toHaveBeenCalled();
	});

	it("ensureResearch no reclama ni corre con 6 corridas", async () => {
		state.row = null;
		state.researchRuns = 6;
		expect(await ensureResearch("acme")).toEqual({ ok: false });
		expect(upsertClaim).not.toHaveBeenCalled();
		expect(runFolderResearch).not.toHaveBeenCalled();
	});
});
