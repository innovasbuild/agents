// WorkflowStore sobre Supabase, con el cliente admin (las tablas de
// orquestación no aceptan escritura de authenticated). Imports relativos.

import type { WorkflowHealth } from "./alerts";
import type { RunnerStore } from "./runner";
import type { WorkItem } from "./types";
import type { AdminLike } from "./usage";

type Row = Record<string, unknown>;
const UNIQUE_VIOLATION = "23505";

const toWorkItem = (r: Row): WorkItem => ({
	id: Number(r.id),
	tenantId: r.tenant_id as string,
	workflow: r.workflow as string,
	subjectType: r.subject_type as string,
	subjectId: r.subject_id as string,
	inputHash: r.input_hash as string,
	attempts: r.attempts as number,
});

function must(error: { message: string } | null, what: string): void {
	if (error) throw new Error(`${what}: ${error.message}`);
}

export interface EnabledWorkflowRow {
	workflow: string;
	config: unknown;
	lastRunAt: string | null;
}

export function createSupabaseWorkflowStore(
	// biome-ignore lint/suspicious/noExplicitAny: cliente de supabase-js; rpc no está en AdminLike
	admin: AdminLike & { rpc: (fn: string, args: Row) => any },
): RunnerStore & {
	listEnabled(tenantId: string): Promise<EnabledWorkflowRow[]>;
	closeAbandonedRuns(before: Date, at: Date): Promise<number>;
	workflowHealth(tenantId: string, since: Date): Promise<WorkflowHealth>;
} {
	return {
		async insertWorkItem(row) {
			const { error } = await admin.from("work_items").insert({
				tenant_id: row.tenantId,
				workflow: row.workflow,
				subject_type: row.subjectType,
				subject_id: row.subjectId,
				input_hash: row.inputHash,
			});
			if (!error) return "inserted";
			if (error.code === UNIQUE_VIOLATION) return "ya_visto";
			throw new Error(`insertWorkItem: ${error.message}`);
		},

		async claim(tenantId, workflow, limit, leaseSeconds) {
			const { data, error } = await admin.rpc("claim_work_items", {
				p_tenant: tenantId,
				p_workflow: workflow,
				p_limit: limit,
				p_lease_seconds: leaseSeconds,
			});
			must(error, "claim_work_items");
			return ((data as Row[] | null) ?? []).map(toWorkItem);
		},

		async finishItem(id, patch) {
			const { error } = await admin
				.from("work_items")
				.update({
					status: patch.status,
					result_reason: patch.resultReason,
					run_id: patch.runId,
					lease_until: null,
					updated_at: new Date().toISOString(),
				})
				.eq("id", id);
			must(error, "finishItem");
		},

		async retryItem(id, patch) {
			const { error } = await admin
				.from("work_items")
				.update({
					status: "pending",
					next_attempt_at: patch.nextAttemptAt.toISOString(),
					last_error: patch.lastError,
					run_id: patch.runId,
					lease_until: null,
					updated_at: new Date().toISOString(),
				})
				.eq("id", id);
			must(error, "retryItem");
		},

		async failItem(id, patch) {
			const { error } = await admin
				.from("work_items")
				.update({
					status: "failed",
					last_error: patch.lastError,
					run_id: patch.runId,
					lease_until: null,
					updated_at: new Date().toISOString(),
				})
				.eq("id", id);
			must(error, "failItem");
		},

		async openRun(row) {
			const { data, error } = await admin
				.from("runs")
				.insert({
					tenant_id: row.tenantId,
					agent: row.agent,
					trigger: "schedule",
					// runs.eve_session_id es NOT NULL y una pasada no tiene sesión de
					// eve. Mismo recurso que el lock de la Etapa 5: un identificador propio.
					eve_session_id: `wf:${row.workflow}:${row.startedAt.toISOString()}:${crypto.randomUUID()}`,
					workflow: row.workflow,
					status: "running",
					started_at: row.startedAt.toISOString(),
				})
				.select("id")
				.single();
			must(error, "openRun");
			return (data as { id: string }).id;
		},

		async closeRun(runId, patch) {
			const { error } = await admin
				.from("runs")
				.update({
					status: patch.status,
					error: patch.error,
					items_claimed: patch.claimed,
					items_ok: patch.ok,
					items_refused: patch.refused,
					items_failed: patch.failed,
					finished_at: patch.finishedAt.toISOString(),
				})
				.eq("id", runId);
			must(error, "closeRun");
			const { error: costError } = await admin.rpc("set_run_cost", {
				p_run: runId,
			});
			if (costError) console.error("closeRun (costo):", costError.message);
		},

		async touchLastRun(tenantId, workflow, at) {
			const { error } = await admin
				.from("tenant_workflows")
				.update({ last_run_at: at.toISOString() })
				.eq("tenant_id", tenantId)
				.eq("workflow", workflow);
			must(error, "touchLastRun");
		},

		async usageSince(tenantId, resource, since, runId) {
			const { data, error } = await admin.rpc("usage_sum", {
				p_tenant: tenantId,
				p_resource: resource,
				p_since: since.toISOString(),
				p_run: runId ?? null,
			});
			must(error, "usage_sum");
			return Number(data ?? 0);
		},

		async dailyLimit(tenantId, resource) {
			const { data, error } = await admin
				.from("tenant_budgets")
				.select("daily_limit")
				.eq("tenant_id", tenantId)
				.eq("resource", resource)
				.maybeSingle();
			must(error, "dailyLimit");
			return Number(
				(data as { daily_limit: unknown } | null)?.daily_limit ?? 0,
			);
		},

		async enabledWorkflows(tenantId) {
			const rows = await this.listEnabled(tenantId);
			return new Set(rows.map((row) => row.workflow));
		},

		async nodePolicy(tenantId, node) {
			// Spec §7.3: tenant_agents.config.approvals, mapa nodo → política.
			// El agente dueño del nodo es su prefijo de dominio.
			const agent = node.split("/")[0];
			const { data, error } = await admin
				.from("tenant_agents")
				.select("config")
				.eq("tenant_id", tenantId)
				.eq("agent", agent)
				.maybeSingle();
			must(error, "nodePolicy");
			const approvals = (data as { config?: { approvals?: Row } } | null)
				?.config?.approvals;
			const policy = approvals?.[node];
			return policy === "auto" || policy === "once" ? policy : "always";
		},

		async listEnabled(tenantId) {
			const { data, error } = await admin
				.from("tenant_workflows")
				.select("workflow, config, last_run_at")
				.eq("tenant_id", tenantId)
				.eq("enabled", true);
			must(error, "listEnabled");
			return ((data as Row[] | null) ?? []).map((r) => ({
				workflow: r.workflow as string,
				config: r.config,
				lastRunAt: (r.last_run_at as string | null) ?? null,
			}));
		},

		async closeAbandonedRuns(before, at) {
			// Global a propósito: el dispatcher es uno solo para todos los tenants.
			const { data, error } = await admin
				.from("runs")
				.update({
					status: "failed",
					error: "corrida abandonada: la función murió sin cerrarla",
					finished_at: at.toISOString(),
				})
				.eq("status", "running")
				.not("workflow", "is", null)
				.lt("started_at", before.toISOString())
				.select("id");
			must(error, "closeAbandonedRuns");
			return ((data as Row[] | null) ?? []).length;
		},

		async workflowHealth(tenantId, since) {
			const sinceIso = since.toISOString();
			const [runs, items, enabled] = await Promise.all([
				admin
					.from("runs")
					.select("workflow, status, error")
					.eq("tenant_id", tenantId)
					.not("workflow", "is", null)
					.gte("started_at", sinceIso)
					.in("status", ["budget_exhausted", "failed", "ok"]),
				admin
					.from("work_items")
					.select("id", { count: "exact", head: true })
					.eq("tenant_id", tenantId)
					.eq("status", "failed")
					.gte("updated_at", sinceIso),
				admin
					.from("tenant_workflows")
					.select("workflow, last_run_at, created_at")
					.eq("tenant_id", tenantId)
					.eq("enabled", true),
			]);
			must(runs.error, "workflowHealth (runs)");
			must(items.error, "workflowHealth (work_items)");
			must(enabled.error, "workflowHealth (tenant_workflows)");
			const runRows = (runs.data as Row[] | null) ?? [];
			return {
				budgetExhausted: [
					...new Set(
						runRows
							.filter((r) => r.status === "budget_exhausted")
							.map((r) => r.workflow as string),
					),
				],
				failedRuns: runRows.filter((r) => r.status === "failed").length,
				unbalancedRuns: runRows.filter(
					(r) => r.status === "ok" && r.error !== null,
				).length,
				failedItems: items.count ?? 0,
				// Fechas comparadas como fechas: PostgREST y toISOString no escriben
				// igual la zona horaria.
				silent: ((enabled.data as Row[] | null) ?? [])
					.filter(
						(r) =>
							new Date(
								(r.last_run_at as string | null) ?? (r.created_at as string),
							).getTime() < since.getTime(),
					)
					.map((r) => r.workflow as string),
			};
		},
	};
}
