// Crédito de IA por plan (spec etapa 27 §3). free y pago con tope cortan por
// gasto del mes; enterprise conserva el presupuesto diario de budgetStatus.
import { dayStart } from "../outreach/time";
import {
	monthStartUtc,
	PLAN_LIMITS,
	type SuspendedReason,
	suspendedReasonOf,
} from "./limits";
import type { PlanStore } from "./store";

/** Lo que lee aiAllowance: el runner de workflows no necesita `counts`. */
export type AllowanceStore = Pick<
	PlanStore,
	"tenantPlan" | "monthSpendUsd" | "usageSince" | "dailyLimit"
>;

export type AiAllowance =
	| { ok: true; spent: number; limit: number | null }
	| {
			ok: false;
			reason: "limit:ai_credit" | `suspended:${SuspendedReason}`;
			spent: number;
			limit: number | null;
	  };

export async function aiAllowance(
	input: { tenantId: string; timezone: string },
	deps: { store: AllowanceStore; now: () => Date },
): Promise<AiAllowance> {
	const { store } = deps;
	const plan = await store.tenantPlan(input.tenantId);
	if (!plan) return { ok: true, spent: 0, limit: null };

	const suspended = suspendedReasonOf(plan);
	if (suspended) {
		return {
			ok: false,
			reason: suspended as `suspended:${SuspendedReason}`,
			spent: 0,
			limit: null,
		};
	}

	const now = deps.now();

	if (plan.plan === "enterprise") {
		const [spent, limit] = await Promise.all([
			store.usageSince(
				input.tenantId,
				"model_usd",
				dayStart(input.timezone, now),
			),
			store.dailyLimit(input.tenantId, "model_usd"),
		]);
		return spent >= limit
			? { ok: false, reason: "limit:ai_credit", spent, limit }
			: { ok: true, spent, limit };
	}

	const limit =
		plan.plan === "free"
			? PLAN_LIMITS.free.aiUsdPerMonth
			: plan.aiMonthlyLimitUsd;
	if (limit === null) return { ok: true, spent: 0, limit: null };

	const spent = await store.monthSpendUsd(input.tenantId, monthStartUtc(now));
	return spent >= limit
		? { ok: false, reason: "limit:ai_credit", spent, limit }
		: { ok: true, spent, limit };
}

/**
 * Corte del CHAT (spec etapa 27 §5.5, ruling R12): solo por suspensión (todo
 * plan) y por el crédito Free / tope Pago. Enterprise nunca se corta por
 * tenant_budgets (G4 de la 21.5): ese presupuesto es solo del runner, así que
 * acá no se lee ni gasto diario ni zona horaria.
 */
export async function aiAllowanceForChat(
	input: { tenantId: string },
	deps: { store: AllowanceStore; now: () => Date },
): Promise<AiAllowance> {
	const plan = await deps.store.tenantPlan(input.tenantId);
	if (!plan) return { ok: true, spent: 0, limit: null };
	const suspended = suspendedReasonOf(plan);
	if (suspended) {
		return {
			ok: false,
			reason: suspended as `suspended:${SuspendedReason}`,
			spent: 0,
			limit: null,
		};
	}
	if (plan.plan !== "free" && plan.plan !== "pago") {
		return { ok: true, spent: 0, limit: null };
	}
	// timezone solo importa para enterprise, que no llega hasta acá.
	return aiAllowance({ ...input, timezone: "UTC" }, deps);
}
