import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	plan: "free" as string,
	spent: 5,
	throwOnCreate: false,
}));
vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => {
		if (db.throwOnCreate) throw new Error("falta la service key");
		return {
			from: () => {
				const b = {
					select: () => b,
					eq: () => b,
					maybeSingle: async () => ({
						data: {
							plan: db.plan,
							suspended_reason: null,
							trial_ends_at: null,
							ai_monthly_limit_usd: null,
						},
						error: null,
					}),
				};
				return b;
			},
			rpc: async () => ({ data: db.spent, error: null }),
		};
	},
}));

// Todo agente que contesta turnos de chat corta por crédito de IA: el hook
// vive en hooks/allowance.ts de cada uno (eve lo toma por convención de
// carpeta, no hay registro en agent.ts).
describe("hook de crédito de IA", () => {
	for (const agent of ["asistente", "outreach"]) {
		it(`${agent} tiene hooks/allowance.ts con allowanceHook()`, () => {
			const file = `agents/${agent}/hooks/allowance.ts`;
			expect(existsSync(file)).toBe(true);
			const source = readFileSync(file, "utf8");
			expect(source).toContain("allowanceHook()");
			expect(source).not.toMatch(/from "@\//);
		});
	}

	it("allowanceHook corta en turn.started", async () => {
		const { allowanceHook } = await import("../../lib/agents/eve/hooks");
		const hook = allowanceHook() as unknown as {
			events: Record<string, unknown>;
		};
		expect(typeof hook.events["turn.started"]).toBe("function");
	});

	describe("comportamiento de turn.started", () => {
		type Handler = (event: unknown, ctx: unknown) => Promise<void>;
		const handler = async () => {
			const { allowanceHook } = await import("../../lib/agents/eve/hooks");
			return (allowanceHook() as unknown as { events: Record<string, Handler> })
				.events["turn.started"];
		};
		const ctx = (attributes: Record<string, unknown> | null) => ({
			session: {
				auth: {
					current: null,
					initiator: attributes ? { attributes } : undefined,
				},
			},
		});

		beforeEach(() => {
			db.plan = "free";
			db.spent = 5;
			db.throwOnCreate = false;
		});

		it("free agotado: tira ai_allowance:limit:ai_credit", async () => {
			await expect(
				(await handler())({}, ctx({ tenantId: "t1" })),
			).rejects.toThrow("ai_allowance:limit:ai_credit");
		});

		it("enterprise: resuelve aunque el gasto sea enorme", async () => {
			db.plan = "enterprise";
			db.spent = 999;
			await expect(
				(await handler())({}, ctx({ tenantId: "t1" })),
			).resolves.toBeUndefined();
		});

		it("sin empresa: resuelve", async () => {
			await expect((await handler())({}, ctx(null))).resolves.toBeUndefined();
		});

		it("si crear el cliente admin tira: el turno pasa", async () => {
			db.throwOnCreate = true;
			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			await expect(
				(await handler())({}, ctx({ tenantId: "t1" })),
			).resolves.toBeUndefined();
			expect(spy).toHaveBeenCalled();
			spy.mockRestore();
		});
	});
});
