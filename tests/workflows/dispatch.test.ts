import { describe, expect, it } from "vitest";
import {
	type DispatchTenant,
	FUNCTION_TIMEOUT_MS,
	ITEM_TIMEOUT_MS,
	LEASE_SECONDS,
	runDispatch,
	TICK_BUDGET_MS,
} from "@/lib/workflows/dispatch";
import type { WorkflowImpl } from "@/lib/workflows/runner";
import { createFakeWorkflowStore } from "./fake-workflow-store";

const NOW = new Date("2026-09-21T12:00:00Z");
const now = () => NOW;
const okImpl: WorkflowImpl = { runItem: async () => ({ ok: true }) };
const uno: DispatchTenant = {
	id: "t1",
	slug: "uno",
	timezone: "America/Argentina/Buenos_Aires",
};
const dos: DispatchTenant = { ...uno, id: "t2", slug: "dos" };

function dispatch(
	store: ReturnType<typeof createFakeWorkflowStore>,
	overrides: Partial<{
		agent: string;
		tenants: DispatchTenant[];
		impls: Record<string, WorkflowImpl>;
		now: () => Date;
	}> = {},
) {
	return runDispatch({
		agent: overrides.agent ?? "outreach",
		store,
		listTenants: async () => overrides.tenants ?? [uno],
		impls: overrides.impls ?? { "refresh-fichas": okImpl },
		nodes: {},
		now: overrides.now ?? now,
	});
}

function prendido(
	tenantId: string,
	config: unknown = {},
	lastRunAt: string | null = null,
) {
	return { tenantId, workflow: "refresh-fichas", config, lastRunAt };
}

describe("runDispatch", () => {
	it("los números del reloj dejan margen contra el timeout de la función", () => {
		// Spike S2: el último ítem de un tick puede arrancar con el presupuesto
		// casi agotado y durar ITEM_TIMEOUT_MS; tiene que entrar igual.
		expect(TICK_BUDGET_MS + ITEM_TIMEOUT_MS).toBeLessThan(FUNCTION_TIMEOUT_MS);
		// Un ítem no puede vencer mientras la función que lo tomó sigue viva.
		expect(LEASE_SECONDS * 1000).toBeGreaterThan(FUNCTION_TIMEOUT_MS);
	});

	it("corre una pasada para un workflow prendido al que le toca, y marca la corrida", async () => {
		const store = createFakeWorkflowStore(now);
		store.rows.push(prendido("t1"));
		store.add("acc-1");

		const outcomes = await dispatch(store);

		expect(outcomes).toMatchObject([
			{
				tenant: "uno",
				workflow: "refresh-fichas",
				outcome: "corrida",
				result: { status: "ok", claimed: 1, ok: 1 },
			},
		]);
		expect(store.rows[0].lastRunAt).toBe(NOW.toISOString());
	});

	it("no corre lo que todavía no le toca por cadencia", async () => {
		const store = createFakeWorkflowStore(now);
		store.rows.push(prendido("t1", {}, "2026-09-21T11:30:00Z"));

		expect(await dispatch(store)).toMatchObject([{ outcome: "no_toca" }]);
		expect(store.runs).toEqual([]);
	});

	it("un tenant sin workflows prendidos no corre nada", async () => {
		const store = createFakeWorkflowStore(now);

		expect(await dispatch(store)).toEqual([]);
		expect(store.runs).toEqual([]);
	});

	it("un workflow que ya no está en el registry se saltea sin frenar al resto", async () => {
		const store = createFakeWorkflowStore(now);
		store.rows.push(
			{ tenantId: "t1", workflow: "no-existe", config: {}, lastRunAt: null },
			prendido("t1"),
		);

		const outcomes = await dispatch(store);

		expect(outcomes.map((o) => o.outcome)).toEqual(["desconocido", "corrida"]);
	});

	it("un workflow de otro agente no lo corre este dispatcher", async () => {
		const store = createFakeWorkflowStore(now);
		store.rows.push(prendido("t1"));

		expect(await dispatch(store, { agent: "otro" })).toMatchObject([
			{ outcome: "de_otro_agente" },
		]);
		expect(store.runs).toEqual([]);
	});

	it("un workflow sin implementación en este dispatcher se saltea", async () => {
		const store = createFakeWorkflowStore(now);
		store.rows.push(prendido("t1"));

		expect(await dispatch(store, { impls: {} })).toMatchObject([
			{ outcome: "sin_implementacion" },
		]);
	});

	it("una config inválida deja una pasada failed con el error, y no la repite antes de la cadencia", async () => {
		const store = createFakeWorkflowStore(now);
		store.rows.push(prendido("t1", { cadence_minutes: 0 }));

		expect(await dispatch(store)).toMatchObject([
			{ outcome: "config_invalida" },
		]);
		expect(store.runs).toHaveLength(1);
		expect(store.runs[0]).toMatchObject({
			workflow: "refresh-fichas",
			status: "failed",
		});
		expect(store.runs[0].error).toContain("cadence_minutes");

		expect(await dispatch(store)).toMatchObject([{ outcome: "no_toca" }]);
		expect(store.runs).toHaveLength(1);
	});

	it("un tenant que explota no frena a los demás", async () => {
		const store = createFakeWorkflowStore(now);
		store.rows.push(prendido("t1"), prendido("t2"));
		store.add("acc-2").tenantId = "t2";
		const listEnabled = store.listEnabled;
		store.listEnabled = async (tenantId) => {
			if (tenantId === "t1") throw new Error("db caída");
			return listEnabled(tenantId);
		};

		const outcomes = await dispatch(store, { tenants: [uno, dos] });

		expect(outcomes).toMatchObject([
			{ tenant: "uno", outcome: "error", error: "db caída" },
			{ tenant: "dos", outcome: "corrida", result: { ok: 1 } },
		]);
	});

	it("el reloj es del tick: lo que no entra queda para el próximo, sin marcar la corrida", async () => {
		const store = createFakeWorkflowStore(now);
		store.rows.push(prendido("t1"), prendido("t2"));
		for (let i = 0; i < 3; i++) store.add(`acc-${i}`);
		store.add("acc-t2").tenantId = "t2";
		let t = NOW.getTime();
		const clock = () => new Date(t);
		const lento: WorkflowImpl = {
			runItem: async () => {
				t += 150_000;
				return { ok: true };
			},
		};

		const outcomes = await dispatch(store, {
			tenants: [uno, dos],
			impls: { "refresh-fichas": lento },
			now: clock,
		});

		expect(outcomes).toMatchObject([
			{
				tenant: "uno",
				outcome: "corrida",
				result: { claimed: 2, stoppedBy: "reloj" },
			},
			{ tenant: "dos", outcome: "sin_tiempo" },
		]);
		expect(store.rows[1].lastRunAt).toBeNull();
	});

	it("antes de arrancar cierra como failed las pasadas abandonadas", async () => {
		const store = createFakeWorkflowStore(now);
		store.runs.push(
			{
				id: "vieja",
				tenantId: "t1",
				workflow: "refresh-fichas",
				startedAt: new Date(NOW.getTime() - 20 * 60_000),
			},
			{
				id: "reciente",
				tenantId: "t1",
				workflow: "refresh-fichas",
				startedAt: new Date(NOW.getTime() - 2 * 60_000),
			},
		);

		await dispatch(store);

		expect(store.runs[0]).toMatchObject({ status: "failed" });
		expect(store.runs[0].error).toContain("abandonada");
		expect(store.runs[1].status).toBeUndefined();
	});

	it("si no puede listar los tenants, tira: no hay nada que hacer", async () => {
		const store = createFakeWorkflowStore(now);
		await expect(
			runDispatch({
				agent: "outreach",
				store,
				listTenants: async () => {
					throw new Error("db caída");
				},
				impls: {},
				nodes: {},
				now,
			}),
		).rejects.toThrow("db caída");
	});
});
