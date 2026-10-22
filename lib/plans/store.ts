// PlanStore sobre Supabase con el cliente admin (tenant_counts y usage_sum
// son solo del service role). Mismo patrón que lib/workflows/store.ts.

import type { Plan, SuspendedReason, TenantCounts, TenantPlan } from "./limits";

export interface PlanStore {
	tenantPlan(tenantId: string): Promise<TenantPlan | null>;
	counts(tenantId: string): Promise<TenantCounts>;
	monthSpendUsd(tenantId: string, since: Date): Promise<number>;
	/** Sin fila en tenant_budgets devuelve 0. */
	dailyLimit(tenantId: string, resource: string): Promise<number>;
	usageSince(tenantId: string, resource: string, since: Date): Promise<number>;
}

// Lo mínimo del cliente de Supabase que se usa acá.
export interface PlanAdminLike {
	// biome-ignore lint/suspicious/noExplicitAny: forma del query builder de supabase-js
	from(table: string): any;
	// biome-ignore lint/suspicious/noExplicitAny: forma de rpc de supabase-js
	rpc(fn: string, args?: Record<string, unknown>): any;
}

function must(error: { message: string } | null, what: string): void {
	if (error) throw new Error(`${what}: ${error.message}`);
}

export function createPlanStore(admin: PlanAdminLike): PlanStore {
	const usageSince = async (
		tenantId: string,
		resource: string,
		since: Date,
	): Promise<number> => {
		const { data, error } = await admin.rpc("usage_sum", {
			p_tenant: tenantId,
			p_resource: resource,
			p_since: since.toISOString(),
			p_run: null,
		});
		must(error, "usage_sum");
		return Number(data ?? 0);
	};

	return {
		async tenantPlan(tenantId) {
			const { data, error } = await admin
				.from("tenants")
				.select("plan, suspended_reason, trial_ends_at, ai_monthly_limit_usd")
				.eq("id", tenantId)
				.maybeSingle();
			must(error, "tenantPlan");
			if (!data) return null;
			return {
				plan: data.plan as Plan,
				suspendedReason: (data.suspended_reason ??
					null) as SuspendedReason | null,
				trialEndsAt: (data.trial_ends_at ?? null) as string | null,
				aiMonthlyLimitUsd:
					data.ai_monthly_limit_usd == null
						? null
						: Number(data.ai_monthly_limit_usd),
			};
		},

		async counts(tenantId) {
			const { data, error } = await admin.rpc("tenant_counts", {
				p_tenant: tenantId,
			});
			must(error, "tenant_counts");
			const c = (data ?? {}) as Record<string, unknown>;
			return {
				users: Number(c.users ?? 0),
				pendingInvitations: Number(c.pending_invitations ?? 0),
				publishedSkills: Number(c.published_skills ?? 0),
			};
		},

		monthSpendUsd: (tenantId, since) =>
			usageSince(tenantId, "model_usd", since),

		async dailyLimit(tenantId, resource) {
			const { data, error } = await admin
				.from("tenant_budgets")
				.select("daily_limit")
				.eq("tenant_id", tenantId)
				.eq("resource", resource)
				.maybeSingle();
			must(error, "dailyLimit");
			return Number(data?.daily_limit ?? 0);
		},

		usageSince,
	};
}
