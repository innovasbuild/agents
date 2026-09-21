import type { RunnerStore } from "@/lib/workflows/runner";
import type { WorkItem } from "@/lib/workflows/types";

export interface FakeItem extends WorkItem {
	status: "pending" | "running" | "done" | "refused" | "failed";
	nextAttemptAt: Date;
	lastError: string | null;
	resultReason: string | null;
}

export interface FakeWorkflowRow {
	tenantId: string;
	workflow: string;
	config: unknown;
	lastRunAt: string | null;
}

export interface FakeWorkflowStore extends RunnerStore {
	items: FakeItem[];
	runs: Array<Record<string, unknown>>;
	rows: FakeWorkflowRow[];
	spent: Map<string, number>;
	limits: Map<string, number>;
	runSpent: number;
	enabled: Set<string>;
	policies: Map<string, "always" | "once" | "auto">;
	lastRun: Date | null;
	add(subjectId: string, workflow?: string, inputHash?: string): FakeItem;
	listEnabled(
		tenantId: string,
	): Promise<{ workflow: string; config: unknown; lastRunAt: string | null }[]>;
	closeAbandonedRuns(before: Date, at: Date): Promise<number>;
}

export function createFakeWorkflowStore(now: () => Date): FakeWorkflowStore {
	let nextId = 0;
	const store: FakeWorkflowStore = {
		items: [],
		runs: [],
		rows: [],
		spent: new Map(),
		limits: new Map([["model_usd", 100]]),
		runSpent: 0,
		enabled: new Set(["refresh-fichas"]),
		policies: new Map(),
		lastRun: null,

		add(subjectId, workflow = "refresh-fichas", inputHash = "h1") {
			const item: FakeItem = {
				id: ++nextId,
				tenantId: "t1",
				workflow,
				subjectType: "account",
				subjectId,
				inputHash,
				attempts: 0,
				status: "pending",
				nextAttemptAt: now(),
				lastError: null,
				resultReason: null,
			};
			store.items.push(item);
			return item;
		},

		async insertWorkItem(row) {
			const dup = store.items.some(
				(i) =>
					i.tenantId === row.tenantId &&
					i.workflow === row.workflow &&
					i.subjectId === row.subjectId &&
					i.inputHash === row.inputHash,
			);
			if (dup) return "ya_visto";
			const item = store.add(row.subjectId, row.workflow, row.inputHash);
			item.tenantId = row.tenantId;
			return "inserted";
		},

		async usageSince(_tenantId, resource, _since, runId) {
			return runId ? store.runSpent : (store.spent.get(resource) ?? 0);
		},
		async dailyLimit(_tenantId, resource) {
			return store.limits.get(resource) ?? 0;
		},

		async openRun(row) {
			store.runs.push({ ...row, id: `run-${store.runs.length + 1}` });
			return `run-${store.runs.length}`;
		},
		async closeRun(runId, patch) {
			const run = store.runs.find((r) => r.id === runId);
			if (run) Object.assign(run, patch);
		},

		async claim(tenantId, workflow, limit) {
			const due = store.items
				.filter(
					(i) =>
						i.tenantId === tenantId &&
						i.workflow === workflow &&
						i.status === "pending" &&
						i.attempts < 3 &&
						i.nextAttemptAt.getTime() <= now().getTime(),
				)
				.slice(0, limit);
			for (const item of due) {
				item.status = "running";
				item.attempts += 1;
			}
			return due.map((i) => ({ ...i }));
		},
		async finishItem(id, patch) {
			const item = store.items.find((i) => i.id === id);
			if (!item) return;
			item.status = patch.status;
			item.resultReason = patch.resultReason;
		},
		async retryItem(id, patch) {
			const item = store.items.find((i) => i.id === id);
			if (!item) return;
			item.status = "pending";
			item.nextAttemptAt = patch.nextAttemptAt;
			item.lastError = patch.lastError;
		},
		async failItem(id, patch) {
			const item = store.items.find((i) => i.id === id);
			if (!item) return;
			item.status = "failed";
			item.lastError = patch.lastError;
		},
		async touchLastRun(tenantId, workflow, at) {
			store.lastRun = at;
			for (const row of store.rows) {
				if (row.tenantId === tenantId && row.workflow === workflow)
					row.lastRunAt = at.toISOString();
			}
		},
		async listEnabled(tenantId) {
			return store.rows
				.filter((row) => row.tenantId === tenantId)
				.map(({ workflow, config, lastRunAt }) => ({
					workflow,
					config,
					lastRunAt,
				}));
		},
		// Una pasada abierta y nunca cerrada es una fila sin `status` (openRun no
		// lo pone; closeRun sí).
		async closeAbandonedRuns(before, at) {
			let closed = 0;
			for (const run of store.runs) {
				if (
					run.status === undefined &&
					(run.startedAt as Date).getTime() < before.getTime()
				) {
					Object.assign(run, {
						status: "failed",
						error: "corrida abandonada: la función murió sin cerrarla",
						finishedAt: at,
					});
					closed++;
				}
			}
			return closed;
		},
		async enabledWorkflows() {
			return store.enabled;
		},
		async nodePolicy(_tenantId, node) {
			return store.policies.get(node) ?? "always";
		},
	};
	return store;
}
