// Integración contra la Supabase local (npm run db:start). No corre en
// `npm test`: se dispara con `npm run test:it:workflows`. Es la prueba del
// criterio de cierre 6 de la spec: dos pasadas a la vez no procesan lo mismo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLocalSupabaseUrl } from "@/lib/agents/eval-auth";
import { createSupabaseOutreachStore } from "@/lib/outreach/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseWorkflowStore } from "@/lib/workflows/store";

const enabled =
	process.env.WORKFLOWS_IT === "1" &&
	isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const TENANT = "aaaaaaaa-0000-0000-0000-0000000000f1";

describe.skipIf(!enabled)("WorkflowStore contra Postgres", () => {
	// vitest ejecuta el cuerpo de un describe salteado: el cliente se crea en
	// beforeAll para que `npm test` sin variables de Supabase no tire.
	let admin: SupabaseClient;
	let store: ReturnType<typeof createSupabaseWorkflowStore>;

	beforeAll(async () => {
		admin = createAdminClient();
		store = createSupabaseWorkflowStore(admin);
		await admin.from("tenants").delete().eq("id", TENANT);
		const { error } = await admin
			.from("tenants")
			.insert({ id: TENANT, slug: "it-workflows", display_name: "IT" });
		if (error) throw new Error(error.message);
	});

	afterAll(async () => {
		await admin.from("tenants").delete().eq("id", TENANT);
	});

	it("insertWorkItem deduplica por huella", async () => {
		const row = {
			tenantId: TENANT,
			workflow: "refresh-fichas",
			subjectType: "account",
			subjectId: "cccccccc-0000-0000-0000-000000000001",
			inputHash: "h1",
		};
		expect(await store.insertWorkItem(row)).toBe("inserted");
		expect(await store.insertWorkItem(row)).toBe("ya_visto");
	});

	it("dos reclamos simultáneos nunca entregan el mismo ítem", async () => {
		for (let i = 2; i <= 9; i++) {
			await store.insertWorkItem({
				tenantId: TENANT,
				workflow: "refresh-fichas",
				subjectType: "account",
				subjectId: `cccccccc-0000-0000-0000-00000000000${i}`,
				inputHash: "h1",
			});
		}
		const [a, b] = await Promise.all([
			store.claim(TENANT, "refresh-fichas", 5, 60),
			store.claim(TENANT, "refresh-fichas", 5, 60),
		]);
		const ids = [...a, ...b].map((item) => item.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.length).toBe(9);
	});

	it("sin presupuesto cargado el límite es cero", async () => {
		expect(await store.dailyLimit(TENANT, "model_usd")).toBe(0);
	});

	it("abre y cierra una corrida con sus conteos", async () => {
		const runId = await store.openRun({
			tenantId: TENANT,
			agent: "outreach",
			workflow: "refresh-fichas",
			startedAt: new Date(),
		});
		await store.closeRun(runId, {
			status: "ok",
			error: null,
			claimed: 3,
			ok: 2,
			refused: 1,
			failed: 0,
			finishedAt: new Date(),
		});
		const { data } = await admin
			.from("runs")
			.select("workflow, status, items_claimed, items_ok, items_refused")
			.eq("id", runId)
			.single();
		expect(data).toEqual({
			workflow: "refresh-fichas",
			status: "ok",
			items_claimed: 3,
			items_ok: 2,
			items_refused: 1,
		});
	});

	it("listAccountsToRefresh trae una vencida hasta que refresh-fichas la encola", async () => {
		const outreach = createSupabaseOutreachStore(admin);
		const { data: account, error } = await admin
			.from("accounts")
			.insert({
				tenant_id: TENANT,
				domain: "vencida.test",
				name: "Vencida",
				ficha: {},
				researched_at: new Date(Date.now() - 100 * 86_400_000).toISOString(),
				expires_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
			})
			.select("id")
			.single();
		if (error) throw new Error(error.message);

		const antes = await outreach.listAccountsToRefresh(TENANT, new Date(), 10);
		expect(antes).toEqual([
			expect.objectContaining({
				id: account.id,
				domain: "vencida.test",
				name: "Vencida",
			}),
		]);

		await store.insertWorkItem({
			tenantId: TENANT,
			workflow: "refresh-fichas",
			subjectType: "account",
			subjectId: account.id,
			inputHash: `vencida.test:${antes[0].expiresAt}`,
		});
		expect(
			await outreach.listAccountsToRefresh(TENANT, new Date(), 10),
		).toEqual([]);

		expect(await outreach.findAccountById(TENANT, account.id)).toMatchObject({
			domain: "vencida.test",
			name: "Vencida",
		});
		expect(
			await outreach.findAccountById(
				TENANT,
				"cccccccc-0000-0000-0000-0000000000ff",
			),
		).toBeNull();
	});

	it("closeAbandonedRuns cierra como failed solo las pasadas viejas", async () => {
		const vieja = await store.openRun({
			tenantId: TENANT,
			agent: "outreach",
			workflow: "refresh-fichas",
			startedAt: new Date(Date.now() - 20 * 60_000),
		});
		const reciente = await store.openRun({
			tenantId: TENANT,
			agent: "outreach",
			workflow: "refresh-fichas",
			startedAt: new Date(),
		});

		const cerradas = await store.closeAbandonedRuns(
			new Date(Date.now() - 10 * 60_000),
			new Date(),
		);

		expect(cerradas).toBeGreaterThanOrEqual(1);
		const { data } = await admin
			.from("runs")
			.select("id, status, error, finished_at")
			.in("id", [vieja, reciente]);
		const byId = new Map((data ?? []).map((r) => [r.id, r]));
		expect(byId.get(vieja)).toMatchObject({ status: "failed" });
		expect(byId.get(vieja)?.error).toContain("abandonada");
		expect(byId.get(vieja)?.finished_at).not.toBeNull();
		expect(byId.get(reciente)).toMatchObject({ status: "running" });
	});

	it("workflowHealth junta los avisos del tenant", async () => {
		const since = new Date(Date.now() - 60_000);
		const agotada = await store.openRun({
			tenantId: TENANT,
			agent: "outreach",
			workflow: "refresh-fichas",
			startedAt: new Date(),
		});
		await store.closeRun(agotada, {
			status: "budget_exhausted",
			error: "model_usd: gastado 0 de 0",
			claimed: 0,
			ok: 0,
			refused: 0,
			failed: 0,
			finishedAt: new Date(),
		});
		const { error } = await admin.from("tenant_workflows").insert({
			tenant_id: TENANT,
			workflow: "refresh-fichas",
			enabled: true,
			created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
		});
		if (error) throw new Error(error.message);

		expect(await store.workflowHealth(TENANT, since)).toEqual({
			budgetExhausted: ["refresh-fichas"],
			failedRuns: 0,
			unbalancedRuns: 0,
			failedItems: 0,
			silent: ["refresh-fichas"],
		});
	});
});
