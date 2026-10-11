// Lo que muestran las pantallas de workflows y presupuestos (spec 21.3 §4 y
// §6.1). Puro: recibe las filas crudas y el registry.
import { DEFAULT_CADENCE_MINUTES } from "./config";
import { WORKFLOWS } from "./registry";

export interface BudgetRow {
	resource: string;
	dailyLimit: number;
	spent: number;
}

export interface WorkflowRow {
	workflow: string;
	enabled: boolean;
	cadenceMinutes: number;
	itemsPerTick: number;
	maxItemsPerTick: number;
	lastRunAt: string | null;
	resources: string[];
	/** Recursos que usa y tienen límite 0: con uno solo, el workflow no corre. */
	unfunded: string[];
}

const RESOURCE_LABELS: Record<string, string> = {
	model_usd: "Modelos de IA (USD)",
	apollo_credits: "Créditos de búsqueda",
};

export function resourceLabel(resource: string): string {
	return Object.hasOwn(RESOURCE_LABELS, resource)
		? RESOURCE_LABELS[resource]
		: resource;
}

export function budgetResources(agent = "outreach"): string[] {
	return [
		...new Set(
			Object.values(WORKFLOWS)
				.filter((wf) => wf.agent === agent)
				.flatMap((wf) => wf.resources),
		),
	].sort();
}

const num = (value: unknown): number => {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
};

export function toBudgetRows(raw: readonly unknown[]): BudgetRow[] {
	return raw.flatMap((entry) => {
		const row = entry as Record<string, unknown>;
		return typeof row.resource === "string"
			? [
					{
						resource: row.resource,
						dailyLimit: num(row.daily_limit),
						spent: num(row.spent),
					},
				]
			: [];
	});
}

const positiveInt = (value: unknown): number | null =>
	typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: null;

export function workflowRows(
	tenantWorkflows: readonly unknown[],
	budgets: readonly BudgetRow[],
	agent = "outreach",
): WorkflowRow[] {
	const byName = new Map(
		tenantWorkflows.map((entry) => {
			const row = entry as Record<string, unknown>;
			return [String(row.workflow), row] as const;
		}),
	);
	const limits = new Map(budgets.map((b) => [b.resource, b.dailyLimit]));

	return Object.entries(WORKFLOWS)
		.filter(([, info]) => info.agent === agent)
		.map(([workflow, info]) => {
			const row = byName.get(workflow);
			const config = (row?.config ?? {}) as Record<string, unknown>;
			const max = info.caps.itemsPerTick;
			return {
				workflow,
				enabled: row?.enabled === true,
				cadenceMinutes:
					positiveInt(config.cadence_minutes) ?? DEFAULT_CADENCE_MINUTES,
				itemsPerTick: Math.min(positiveInt(config.items_per_tick) ?? max, max),
				maxItemsPerTick: max,
				lastRunAt:
					typeof row?.last_run_at === "string" ? row.last_run_at : null,
				resources: [...info.resources],
				unfunded: info.resources.filter(
					(resource) => (limits.get(resource) ?? 0) <= 0,
				),
			};
		});
}
