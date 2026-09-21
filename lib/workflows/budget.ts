// Presupuesto diario por tenant y por recurso (spec orquestación §7.2). La
// suma incluye todo el consumo del día, venga del chat o de un workflow; pero
// solo el runner se corta con esto.
import { dayStart } from "../outreach/time";

export interface BudgetStore {
	usageSince(
		tenantId: string,
		resource: string,
		since: Date,
		runId?: string,
	): Promise<number>;
	/** Sin fila en tenant_budgets devuelve 0. */
	dailyLimit(tenantId: string, resource: string): Promise<number>;
}

export interface BudgetStatus {
	resource: string;
	spent: number;
	limit: number;
	exhausted: boolean;
}

export async function budgetStatus(
	input: { tenantId: string; resources: readonly string[]; timezone: string },
	deps: { store: BudgetStore; now: () => Date },
): Promise<BudgetStatus[]> {
	const since = dayStart(input.timezone, deps.now());
	return Promise.all(
		input.resources.map(async (resource) => {
			const [spent, limit] = await Promise.all([
				deps.store.usageSince(input.tenantId, resource, since),
				deps.store.dailyLimit(input.tenantId, resource),
			]);
			return { resource, spent, limit, exhausted: spent >= limit };
		}),
	);
}
