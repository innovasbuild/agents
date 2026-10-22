import { describe, expect, it, vi } from "vitest";
import { aiAllowanceForChat } from "../../lib/plans/ai-allowance";
import type { Plan, SuspendedReason } from "../../lib/plans/limits";

const now = () => new Date("2026-10-22T12:00:00Z");

function storeOf(
	plan: null | {
		plan: Plan;
		suspendedReason?: SuspendedReason;
		cap?: number;
	},
	monthSpend = 0,
) {
	const dailyLimit = vi.fn(async () => 0);
	const usageSince = vi.fn(async () => 999);
	return {
		dailyLimit,
		usageSince,
		store: {
			tenantPlan: async () =>
				plan && {
					plan: plan.plan,
					suspendedReason: plan.suspendedReason ?? null,
					trialEndsAt: null,
					aiMonthlyLimitUsd: plan.cap ?? null,
				},
			monthSpendUsd: async () => monthSpend,
			dailyLimit,
			usageSince,
		},
	};
}

const run = (s: ReturnType<typeof storeOf>) =>
	aiAllowanceForChat({ tenantId: "t1" }, { store: s.store, now });

describe("aiAllowanceForChat", () => {
	it("sin plan: ok", async () => {
		expect((await run(storeOf(null))).ok).toBe(true);
	});

	it("enterprise sin fila de presupuesto o con el diario agotado: ok, sin leer tenant_budgets", async () => {
		const s = storeOf({ plan: "enterprise" });
		expect((await run(s)).ok).toBe(true);
		expect(s.dailyLimit).not.toHaveBeenCalled();
		expect(s.usageSince).not.toHaveBeenCalled();
	});

	it("enterprise suspendido: corta", async () => {
		const r = await run(
			storeOf({ plan: "enterprise", suspendedReason: "cancelado" }),
		);
		expect(r).toMatchObject({ ok: false, reason: "suspended:cancelado" });
	});

	it("free agotado: corta", async () => {
		expect(await run(storeOf({ plan: "free" }, 5))).toMatchObject({
			ok: false,
			reason: "limit:ai_credit",
		});
	});

	it("free con crédito: ok", async () => {
		expect((await run(storeOf({ plan: "free" }, 1))).ok).toBe(true);
	});

	it("pago pasado de su tope: corta; sin tope: ok", async () => {
		expect((await run(storeOf({ plan: "pago", cap: 10 }, 10))).ok).toBe(false);
		expect((await run(storeOf({ plan: "pago" }, 999))).ok).toBe(true);
	});
});
