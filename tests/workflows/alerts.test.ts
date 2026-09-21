import { describe, expect, it } from "vitest";
import {
	type WorkflowHealth,
	workflowAlertLines,
} from "@/lib/workflows/alerts";

const sano: WorkflowHealth = {
	budgetExhausted: [],
	failedRuns: 0,
	unbalancedRuns: 0,
	failedItems: 0,
	silent: [],
};

describe("workflowAlertLines", () => {
	it("sin nada raro no dice nada", () => {
		expect(workflowAlertLines(sano)).toEqual([]);
	});

	it("nombra los workflows frenados por presupuesto", () => {
		const [line] = workflowAlertLines({
			...sano,
			budgetExhausted: ["refresh-fichas"],
		});
		expect(line).toContain("presupuesto");
		expect(line).toContain("refresh-fichas");
	});

	it("cuenta los ítems en failed, con singular y plural", () => {
		expect(workflowAlertLines({ ...sano, failedItems: 1 })[0]).toContain(
			"1 ítem de workflows quedó en failed",
		);
		expect(workflowAlertLines({ ...sano, failedItems: 3 })[0]).toContain(
			"3 ítems de workflows quedaron en failed",
		);
	});

	it("avisa las pasadas fallidas y las que no cierran la cuenta", () => {
		const lines = workflowAlertLines({
			...sano,
			failedRuns: 2,
			unbalancedRuns: 1,
		});
		expect(lines).toHaveLength(2);
		expect(lines.join(" ")).toContain("2 pasadas de workflows fallaron");
		expect(lines.join(" ")).toContain("no cierra");
	});

	it("nombra los workflows prendidos que no corrieron", () => {
		expect(
			workflowAlertLines({ ...sano, silent: ["refresh-fichas"] })[0],
		).toContain("refresh-fichas");
	});
});
