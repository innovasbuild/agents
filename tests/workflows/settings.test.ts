import { describe, expect, it } from "vitest";
import { WORKFLOWS } from "@/lib/workflows/registry";
import {
	budgetResources,
	resourceLabel,
	toBudgetRows,
	workflowRows,
} from "@/lib/workflows/settings";

describe("budgetResources", () => {
	it("los recursos que usan los workflows del agente, sin repetir y ordenados", () => {
		const expected = [
			...new Set(
				Object.values(WORKFLOWS)
					.filter((wf) => wf.agent === "outreach")
					.flatMap((wf) => wf.resources),
			),
		].sort();
		expect(budgetResources()).toEqual(expected);
		expect(budgetResources("no-existe")).toEqual([]);
	});
});

describe("toBudgetRows", () => {
	it("normaliza números que llegan como texto y descarta filas sin recurso", () => {
		expect(
			toBudgetRows([
				{ resource: "model_usd", daily_limit: "2.500000", spent: "0.4" },
				{ resource: "apollo_credits", daily_limit: 0, spent: null },
				{ daily_limit: 1 },
			]),
		).toEqual([
			{ resource: "model_usd", dailyLimit: 2.5, spent: 0.4 },
			{ resource: "apollo_credits", dailyLimit: 0, spent: 0 },
		]);
	});
});

describe("workflowRows", () => {
	const budgets = [
		{ resource: "model_usd", dailyLimit: 2, spent: 0 },
		{ resource: "apollo_credits", dailyLimit: 0, spent: 0 },
	];

	it("una fila por workflow del registry, con defaults si la empresa no tiene fila", () => {
		const rows = workflowRows([], budgets);
		expect(rows.map((row) => row.workflow)).toEqual(
			Object.keys(WORKFLOWS).filter(
				(name) => WORKFLOWS[name].agent === "outreach",
			),
		);
		const refresh = rows.find((row) => row.workflow === "refresh-fichas");
		expect(refresh).toEqual({
			workflow: "refresh-fichas",
			enabled: false,
			cadenceMinutes: 60,
			itemsPerTick: WORKFLOWS["refresh-fichas"].caps.itemsPerTick,
			maxItemsPerTick: WORKFLOWS["refresh-fichas"].caps.itemsPerTick,
			lastRunAt: null,
			resources: ["model_usd"],
			unfunded: [],
		});
	});

	it("lee la fila de la empresa y recorta los ítems al tope del registry", () => {
		const [row] = workflowRows(
			[
				{
					workflow: "refresh-fichas",
					enabled: true,
					config: { cadence_minutes: 120, items_per_tick: 999 },
					last_run_at: "2026-10-10T12:00:00Z",
				},
			],
			budgets,
		).filter((r) => r.workflow === "refresh-fichas");
		expect(row).toMatchObject({
			enabled: true,
			cadenceMinutes: 120,
			itemsPerTick: WORKFLOWS["refresh-fichas"].caps.itemsPerTick,
			lastRunAt: "2026-10-10T12:00:00Z",
		});
	});

	it("marca los recursos sin presupuesto: con límite 0 o sin fila", () => {
		const rows = workflowRows(
			[],
			[{ resource: "model_usd", dailyLimit: 2, spent: 0 }],
		);
		const search = rows.find((row) => row.workflow === "target-search");
		expect(search?.unfunded).toEqual(["apollo_credits"]);
	});

	it("ignora filas de workflows que ya no están en el registry", () => {
		expect(
			workflowRows(
				[{ workflow: "viejo", enabled: true, config: {} }],
				budgets,
			).some((row) => row.workflow === "viejo"),
		).toBe(false);
	});
});

describe("resourceLabel", () => {
	it("rotula los conocidos y deja el identificador de los demás", () => {
		expect(resourceLabel("model_usd")).toBe("Modelos de IA (USD)");
		expect(resourceLabel("apollo_credits")).toBe("Créditos de búsqueda");
		expect(resourceLabel("otro")).toBe("otro");
	});
});
