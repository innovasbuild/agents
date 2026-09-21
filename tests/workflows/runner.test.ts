import { describe, expect, it, vi } from "vitest";
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
});
