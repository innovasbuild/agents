import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	spent: 0,
	plan: "free" as "free" | "pago",
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
								data: {
									plan: state.plan,
									suspended_reason: null,
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
});
