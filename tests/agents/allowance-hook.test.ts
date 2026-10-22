import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
