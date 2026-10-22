import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	spent: 0,
	plan: "free" as "free" | "pago" | "enterprise" | null,
	suspended: null as string | null,
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from(table: string) {
			const b = {
				select: () => b,
				eq: () => b,
				maybeSingle: async () =>
					table === "tenants"
						? {
								data: state.plan && {
									plan: state.plan,
									suspended_reason: state.suspended,
									trial_ends_at: null,
									ai_monthly_limit_usd: null,
								},
								error: null,
							}
						: { data: null, error: null },
			};
			return b;
		},
		rpc: async () => ({ data: state.spent, error: null }),
	}),
}));

import { chatAiBlock } from "../../lib/plans/chat-allowance";

describe("chatAiBlock", () => {
	beforeEach(() => {
		state.plan = "free";
		state.suspended = null;
	});

	it("devuelve limit:ai_credit cuando el Free gastó los USD 5", async () => {
		state.spent = 5;
		expect(await chatAiBlock("t1")).toBe("limit:ai_credit");
	});

	it("devuelve null con crédito", async () => {
		state.spent = 1;
		expect(await chatAiBlock("t1")).toBeNull();
	});

	it("pago sin tope no se bloquea", async () => {
		state.plan = "pago";
		state.spent = 999;
		expect(await chatAiBlock("t1")).toBeNull();
	});

	it("enterprise nunca se corta por presupuesto, aunque el gasto sea enorme", async () => {
		state.plan = "enterprise";
		state.spent = 999;
		expect(await chatAiBlock("t1")).toBeNull();
	});

	it("enterprise suspendido se corta", async () => {
		state.plan = "enterprise";
		state.suspended = "trial_vencido";
		expect(await chatAiBlock("t1")).toBe("suspended:trial_vencido");
	});

	it("sin plan no se bloquea", async () => {
		state.plan = null;
		state.spent = 999;
		expect(await chatAiBlock("t1")).toBeNull();
	});
});
