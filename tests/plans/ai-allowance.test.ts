import { describe, expect, it } from "vitest";
import { aiAllowance } from "@/lib/plans/ai-allowance";
import type { TenantPlan } from "@/lib/plans/limits";
import type { PlanStore } from "@/lib/plans/store";

const now = () => new Date("2026-10-22T15:00:00Z");
const base: TenantPlan = {
	plan: "free",
	suspendedReason: null,
	trialEndsAt: null,
	aiMonthlyLimitUsd: null,
};

function store(
	plan: TenantPlan | null,
	spent: number,
	dailyLimit = 0,
): PlanStore {
	return {
		tenantPlan: async () => plan,
		counts: async () => ({
			users: 0,
			pendingInvitations: 0,
			publishedSkills: 0,
		}),
		monthSpendUsd: async () => spent,
		dailyLimit: async () => dailyLimit,
		usageSince: async () => spent,
	};
}
const run = (s: PlanStore) =>
	aiAllowance(
		{ tenantId: "t", timezone: "America/Argentina/Buenos_Aires" },
		{ store: s, now },
	);

describe("aiAllowance", () => {
	it("plan inexistente pasa", async () => {
		expect((await run(store(null, 999))).ok).toBe(true);
	});
	it("suspendida corta", async () => {
		const r = await run(store({ ...base, suspendedReason: "cancelado" }, 0));
		expect(r).toMatchObject({ ok: false, reason: "suspended:cancelado" });
	});
	it("free con 4.99 pasa", async () => {
		expect(await run(store(base, 4.99))).toEqual({
			ok: true,
			spent: 4.99,
			limit: 5,
		});
	});
	it("free con 5.00 corta", async () => {
		expect(await run(store(base, 5))).toMatchObject({
			ok: false,
			reason: "limit:ai_credit",
		});
	});
	it("pago sin tope pasa", async () => {
		expect((await run(store({ ...base, plan: "pago" }, 900))).ok).toBe(true);
	});
	it("pago con tope 50 y gasto 50 corta", async () => {
		expect(
			await run(store({ ...base, plan: "pago", aiMonthlyLimitUsd: 50 }, 50)),
		).toMatchObject({ ok: false, reason: "limit:ai_credit", limit: 50 });
	});
	it("enterprise con dailyLimit 0 corta", async () => {
		expect(
			await run(store({ ...base, plan: "enterprise" }, 0, 0)),
		).toMatchObject({ ok: false, reason: "limit:ai_credit" });
	});
	it("enterprise con 10 y gasto 3 pasa", async () => {
		expect(await run(store({ ...base, plan: "enterprise" }, 3, 10))).toEqual({
			ok: true,
			spent: 3,
			limit: 10,
		});
	});
});
