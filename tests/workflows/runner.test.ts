import { describe, expect, it, vi } from "vitest";

// El registry real (Task 10, ya cerrada) solo tiene "refresh-fichas" con un
// nodo de nivel 1: no alcanza para ejercitar las reglas de nivel 2 y 3, ni un
// downstream real. Se extiende acá, solo para este archivo de test, con nodos
// y workflows sintéticos — nunca se toca lib/workflows/registry.ts.
vi.mock("@/lib/workflows/registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/workflows/registry")>();
	const NODES: typeof actual.NODES = {
		...actual.NODES,
		"test/nivel-2": { effect: 2, tier: null },
		"test/nivel-3": { effect: 3, tier: null },
	};
	const WORKFLOWS: typeof actual.WORKFLOWS = {
		...actual.WORKFLOWS,
		"wf-a": {
			agent: "test",
			subjectType: "account",
			claims: "algo_a",
			produces: "resultado_a",
			nodes: ["test/nivel-2", "test/nivel-3"],
			optionalNodes: [],
			resources: [],
			caps: { itemsPerTick: 5, costUsdPerRun: 0 },
			entry: "seed",
		},
		"wf-b": {
			agent: "test",
			subjectType: "account",
			claims: "resultado_a",
			produces: null,
			nodes: [],
			optionalNodes: [],
			resources: [],
			caps: { itemsPerTick: 5, costUsdPerRun: 0 },
			entry: "upstream",
		},
		// "refresh-fichas" (real) produce "ficha_vigente"; este doble solo existe
		// para ejercitar el downstream de varios sujetos (Task 5, spec etapa 13
		// §4.1): un foco deja N contactos.
		"icp-scoring": {
			agent: "test",
			subjectType: "contact",
			claims: "ficha_vigente",
			produces: null,
			nodes: [],
			optionalNodes: [],
			resources: [],
			caps: { itemsPerTick: 5, costUsdPerRun: 0 },
			entry: "upstream",
		},
	};
	return {
		...actual,
		NODES,
		WORKFLOWS,
		isWorkflow: (name: string) => Object.hasOwn(WORKFLOWS, name),
		downstreamOf: (produces: string | null) =>
			produces === null
				? []
				: Object.entries(WORKFLOWS)
						.filter(([, wf]) => wf.claims === produces)
						.map(([name]) => name),
	};
});

import type { TenantWorkflowConfig } from "@/lib/workflows/config";
import {
	RETRY_DELAYS_MINUTES,
	runWorkflowPass,
	type WorkflowImpl,
} from "@/lib/workflows/runner";
import { createFakeWorkflowStore } from "./fake-workflow-store";

const NOW = new Date("2026-09-21T12:00:00Z");
const now = () => NOW;
const tenant = { id: "t1", timezone: "America/Argentina/Buenos_Aires" };
const config: TenantWorkflowConfig = {
	cadenceMinutes: 60,
	itemsPerTick: 5,
	optionalNodes: new Set(),
	params: {},
};
const okImpl: WorkflowImpl = { runItem: async () => ({ ok: true }) };

function pass(
	store: ReturnType<typeof createFakeWorkflowStore>,
	impl: WorkflowImpl,
	overrides: Partial<{
		config: TenantWorkflowConfig;
		nodes: Record<string, unknown>;
		now: () => Date;
		clockBudgetMs: number;
	}> = {},
) {
	return runWorkflowPass(
		{
			tenant,
			workflow: "refresh-fichas",
			config: overrides.config ?? config,
		},
		{
			store,
			impl,
			nodes: overrides.nodes ?? {},
			now: overrides.now ?? now,
			clockBudgetMs: overrides.clockBudgetMs ?? 200_000,
			leaseSeconds: 600,
		},
	);
}

describe("runWorkflowPass", () => {
	it("procesa lo pendiente, deja la cuenta cerrada y marca la última corrida", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		store.add("acc-2");

		const result = await pass(store, okImpl);

		expect(result).toEqual({
			status: "ok",
			claimed: 2,
			ok: 2,
			refused: 0,
			failed: 0,
			stoppedBy: "sin_trabajo",
		});
		expect(store.items.map((i) => i.status)).toEqual(["done", "done"]);
		expect(store.runs[0]).toMatchObject({
			workflow: "refresh-fichas",
			status: "ok",
			claimed: 2,
			ok: 2,
		});
		expect(store.lastRun).toEqual(NOW);
	});

	it("un rechazo es respuesta de negocio: queda refused y no se reintenta", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");

		const result = await pass(store, {
			runItem: async () => ({
				ok: false,
				reason: "sin_ancla",
				message: "no hay hechos con fuente",
			}),
		});

		expect(result).toMatchObject({ refused: 1, ok: 0, failed: 0 });
		expect(store.items[0]).toMatchObject({
			status: "refused",
			resultReason: "sin_ancla",
		});
	});

	it("un ítem que explota no frena al resto, y vuelve a pending con espera", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-rota");
		store.add("acc-sana");

		const result = await pass(store, {
			runItem: async (item) => {
				if (item.subjectId === "acc-rota") throw new Error("gateway caído");
				return { ok: true };
			},
		});

		expect(result).toMatchObject({ claimed: 2, ok: 1, failed: 1 });
		const rota = store.items[0];
		expect(rota.status).toBe("pending");
		expect(rota.lastError).toBe("gateway caído");
		expect(rota.nextAttemptAt.getTime()).toBe(
			NOW.getTime() + RETRY_DELAYS_MINUTES[0] * 60_000,
		);
		expect(store.items[1].status).toBe("done");
	});

	it("al tercer intento fallido queda failed, visible, y no vuelve a la cola", async () => {
		const store = createFakeWorkflowStore(now);
		const item = store.add("acc-rota");
		item.attempts = 2;

		await pass(store, {
			runItem: async () => {
				throw new Error("sigue caído");
			},
		});

		expect(store.items[0]).toMatchObject({
			status: "failed",
			lastError: "sigue caído",
			attempts: 3,
		});
	});

	it("con el presupuesto agotado no reclama nada y no pierde ningún ítem", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		store.limits.set("model_usd", 0);
		const runItem = vi.fn(async () => ({ ok: true as const }));

		const result = await pass(store, { runItem });

		expect(result).toMatchObject({
			status: "budget_exhausted",
			claimed: 0,
			stoppedBy: "presupuesto",
		});
		expect(runItem).not.toHaveBeenCalled();
		expect(store.items[0]).toMatchObject({ status: "pending", attempts: 0 });
		expect(store.runs[0]).toMatchObject({ status: "budget_exhausted" });
	});

	it("corta al llegar al tope de ítems por tick", async () => {
		const store = createFakeWorkflowStore(now);
		for (let i = 0; i < 4; i++) store.add(`acc-${i}`);

		const result = await pass(store, okImpl, {
			config: { ...config, itemsPerTick: 2 },
		});

		expect(result).toMatchObject({ claimed: 2, stoppedBy: "tope_items" });
		expect(store.items.filter((i) => i.status === "pending")).toHaveLength(2);
	});

	it("corta cuando la pasada supera su tope de costo", async () => {
		const store = createFakeWorkflowStore(now);
		for (let i = 0; i < 3; i++) store.add(`acc-${i}`);

		const result = await pass(store, {
			runItem: async () => {
				store.runSpent += 0.6; // tope de refresh-fichas: 1 USD por pasada
				return { ok: true };
			},
		});

		expect(result).toMatchObject({ claimed: 2, stoppedBy: "tope_costo" });
		expect(store.items[2].status).toBe("pending");
	});

	it("corta cuando se le acaba el reloj, sin dejar ítems tomados", async () => {
		const store = createFakeWorkflowStore(now);
		for (let i = 0; i < 3; i++) store.add(`acc-${i}`);
		let t = NOW.getTime();
		const clock = () => new Date(t);

		const result = await pass(
			store,
			{
				runItem: async () => {
					t += 150_000;
					return { ok: true };
				},
			},
			{ now: clock, clockBudgetMs: 200_000 },
		);

		expect(result).toMatchObject({ claimed: 2, stoppedBy: "reloj" });
		expect(store.items.filter((i) => i.status === "running")).toHaveLength(0);
	});

	it("siembra antes de reclamar, y sembrar lo ya visto no duplica", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1", "refresh-fichas", "h-vencida");
		const seed = vi.fn(async () => [
			{ subjectId: "acc-1", inputHash: "h-vencida" },
			{ subjectId: "acc-2", inputHash: "h-vencida" },
		]);

		const result = await pass(store, { ...okImpl, seed });

		expect(seed).toHaveBeenCalledWith("t1", NOW);
		expect(store.items).toHaveLength(2);
		expect(result.claimed).toBe(2);
	});

	it("un sujeto que no se puede sembrar no tumba la siembra entera", async () => {
		const store = createFakeWorkflowStore(now);
		const seed = vi.fn(async () => [
			{ subjectId: "acc-envenenada", inputHash: "h-mala" },
			{ subjectId: "acc-sana", inputHash: "h-buena" },
		]);
		store.insertWorkItem = async (row) => {
			if (row.subjectId === "acc-envenenada") {
				throw new Error("input_hash viola el check de largo");
			}
			store.add(row.subjectId, row.workflow, row.inputHash);
			return "inserted";
		};
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await pass(store, { ...okImpl, seed });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("acc-envenenada"),
		);
		expect(store.items).toHaveLength(1);
		expect(store.items[0].subjectId).toBe("acc-sana");
		expect(result).toMatchObject({ claimed: 1, ok: 1 });
		errorSpy.mockRestore();
	});

	it("useNode entrega un nodo que el workflow declara", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		const research = vi.fn();

		await pass(
			store,
			{
				runItem: async (_item, ctx) => {
					const node = await ctx.useNode<typeof research>("outreach/research");
					node();
					return { ok: true };
				},
			},
			{ nodes: { "outreach/research": research } },
		);

		expect(research).toHaveBeenCalled();
	});

	it("useNode se niega a entregar un nodo que el workflow no declara", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");

		await pass(
			store,
			{
				runItem: async (_item, ctx) => {
					await ctx.useNode("outreach/send");
					return { ok: true };
				},
			},
			{ nodes: { "outreach/send": vi.fn() } },
		);

		expect(store.items[0].status).toBe("pending");
		expect(store.items[0].lastError).toContain("no declara el nodo");
	});

	it("si falla abrir la corrida, tira: sin fila en runs no hay pasada", async () => {
		const store = createFakeWorkflowStore(now);
		store.openRun = async () => {
			throw new Error("db caída");
		};
		await expect(pass(store, okImpl)).rejects.toThrow("db caída");
	});

	it("si la pasada explota después de abrir la corrida, cierra la fila como failed y relanza", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		store.enabledWorkflows = async () => {
			throw new Error("no se pudo leer enabledWorkflows");
		};

		await expect(pass(store, okImpl)).rejects.toThrow(
			"no se pudo leer enabledWorkflows",
		);

		expect(store.runs[0]).toMatchObject({
			workflow: "refresh-fichas",
			status: "failed",
			error: "no se pudo leer enabledWorkflows",
		});
	});

	it("un ítem puede dejar varios ítems aguas abajo", async () => {
		// Un foco deja N contactos: la arista de esta etapa es 1 a N.
		const store = createFakeWorkflowStore(now);
		store.add("foco-1");
		store.enabled.add("icp-scoring");

		await pass(store, {
			runItem: async () => ({
				ok: true,
				downstream: [
					{ subjectId: "contacto-1", inputHash: "h-icp" },
					{ subjectId: "contacto-2", inputHash: "h-icp" },
				],
			}),
		});

		const encolados = store.items.filter((i) => i.workflow === "icp-scoring");
		expect(encolados.map((i) => i.subjectId).sort()).toEqual([
			"contacto-1",
			"contacto-2",
		]);
	});

	it("sin downstream no encola nada aguas abajo", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		store.enabled.add("icp-scoring");

		await pass(store, { runItem: async () => ({ ok: true }) });

		expect(store.items.filter((i) => i.workflow === "icp-scoring")).toHaveLength(0);
	});
});

// "wf-a"/"wf-b" y los nodos "test/nivel-2"/"test/nivel-3" solo existen en el
// mock de arriba: el registry real (Task 10) no tiene ni un nodo de nivel 2 o
// 3 declarado por un workflow, ni un segundo workflow downstream, así que
// estas tres reglas no eran alcanzables con los datos de producción.
describe("runWorkflowPass — control de acceso por nivel de efecto y downstream deshabilitado", () => {
	const wfaConfig: TenantWorkflowConfig = {
		cadenceMinutes: 60,
		itemsPerTick: 5,
		optionalNodes: new Set(),
		params: {},
	};

	function runWfA(
		store: ReturnType<typeof createFakeWorkflowStore>,
		impl: WorkflowImpl,
		nodes: Record<string, unknown>,
	) {
		return runWorkflowPass(
			{ tenant, workflow: "wf-a", config: wfaConfig },
			{ store, impl, nodes, now, clockBudgetMs: 200_000, leaseSeconds: 600 },
		);
	}

	it("useNode niega un nodo de nivel 3 aunque el workflow lo declare", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1", "wf-a");
		const nivel3 = vi.fn();

		const result = await runWfA(
			store,
			{
				runItem: async (_item, ctx) => {
					await ctx.useNode("test/nivel-3");
					return { ok: true };
				},
			},
			{ "test/nivel-3": nivel3 },
		);

		expect(nivel3).not.toHaveBeenCalled();
		expect(result).toMatchObject({ ok: 0, failed: 1 });
		expect(store.items[0].status).toBe("pending");
		expect(store.items[0].lastError).toContain("nivel 3");
	});

	it("useNode niega un nodo de nivel 2 cuando la política del tenant no es auto", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1", "wf-a");
		// nodePolicy por defecto del store falso es "always", no "auto".
		const nivel2 = vi.fn();

		const result = await runWfA(
			store,
			{
				runItem: async (_item, ctx) => {
					await ctx.useNode("test/nivel-2");
					return { ok: true };
				},
			},
			{ "test/nivel-2": nivel2 },
		);

		expect(nivel2).not.toHaveBeenCalled();
		expect(result).toMatchObject({ ok: 0, failed: 1 });
		expect(store.items[0].status).toBe("pending");
		expect(store.items[0].lastError).toContain("nivel 2");
	});

	it("useNode entrega un nodo de nivel 2 cuando la política del tenant es auto", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1", "wf-a");
		store.policies.set("test/nivel-2", "auto");
		const nivel2 = vi.fn();

		const result = await runWfA(
			store,
			{
				runItem: async (_item, ctx) => {
					const node = await ctx.useNode<typeof nivel2>("test/nivel-2");
					node();
					return { ok: true };
				},
			},
			{ "test/nivel-2": nivel2 },
		);

		expect(nivel2).toHaveBeenCalled();
		expect(result).toMatchObject({ ok: 1, failed: 0 });
		expect(store.items[0].status).toBe("done");
	});

	it("no encola para un workflow downstream que no está habilitado para el tenant", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1", "wf-a");
		// store.enabled solo trae "refresh-fichas" por default: "wf-b" (el
		// downstream de "wf-a" en el mock) no está habilitado.
		const insertSpy = vi.spyOn(store, "insertWorkItem");

		const result = await runWfA(
			store,
			{ runItem: async () => ({ ok: true }) },
			{},
		);

		expect(result).toMatchObject({ ok: 1 });
		expect(insertSpy).not.toHaveBeenCalled();
		expect(store.items).toHaveLength(1);
		expect(store.items.some((i) => i.workflow === "wf-b")).toBe(false);
	});

	it("un fallo al encolar el downstream no revive el ítem que ya cerró done", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1", "wf-a");
		store.enabled.add("wf-b"); // ahora sí está habilitado: se intenta encolar.
		store.insertWorkItem = async () => {
			throw new Error("db caída al encolar downstream");
		};
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await runWfA(
			store,
			{
				runItem: async (item) => ({
					ok: true,
					downstream: [{ subjectId: item.subjectId, inputHash: item.inputHash }],
				}),
			},
			{},
		);

		expect(result).toMatchObject({ claimed: 1, ok: 1, failed: 0 });
		expect(store.items[0].status).toBe("done");
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("wf-b"));
		errorSpy.mockRestore();
	});
});
