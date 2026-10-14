import { describe, expect, it } from "vitest";
import { reconcile, reconcileRange } from "@/lib/usage/reconcile";

const tenants = [
	{ id: "id-a", slug: "acme", name: "Acme" },
	{ id: "id-b", slug: "beta", name: "Beta" },
];

describe("reconcileRange", () => {
	it("mes en curso: del 1 hasta ayer, en UTC", () => {
		const range = reconcileRange("actual", new Date("2026-10-13T15:00:00Z"));
		expect(range).toEqual({
			startDate: "2026-10-01",
			endDate: "2026-10-12",
			from: new Date("2026-10-01T00:00:00Z"),
			to: new Date("2026-10-13T00:00:00Z"),
		});
	});

	it("mes anterior: el mes completo", () => {
		const range = reconcileRange("anterior", new Date("2026-10-13T15:00:00Z"));
		expect(range).toMatchObject({
			startDate: "2026-09-01",
			endDate: "2026-09-30",
		});
		expect(range?.to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
	});

	it("el día 1 no hay día cerrado en el mes en curso", () => {
		expect(
			reconcileRange("actual", new Date("2026-10-01T10:00:00Z")),
		).toBeNull();
	});

	it("el día 1, el mes anterior sí se puede conciliar", () => {
		expect(
			reconcileRange("anterior", new Date("2026-10-01T10:00:00Z")),
		).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-30" });
	});
});

describe("reconcile", () => {
	it("una empresa que cierra dentro de la tolerancia no se marca", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 10.4 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 10 }],
			gatewayTotal: 10,
		});
		expect(lines[0]).toMatchObject({
			kind: "empresa",
			label: "Acme",
			ledger: 10.4,
			gateway: 10,
			flagged: false,
		});
		expect(lines[0].diff).toBeCloseTo(0.4, 6);
		expect(lines[0].diffPct).toBeCloseTo(0.04, 6);
	});

	it("marca la diferencia que supera el mayor entre US$ 1 y el 5 %", () => {
		const big = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 106 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 100 }],
			gatewayTotal: 100,
		});
		expect(big[0].flagged).toBe(true);

		// 6 % pero 60 centavos: por debajo de US$ 1 no se marca.
		const small = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 10.6 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 10 }],
			gatewayTotal: 10,
		});
		expect(small[0].flagged).toBe(false);
	});

	it("empresa en el libro sin tag en el gateway: gateway cero y sin porcentaje", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-b", amount: 3 }],
			gatewayByTag: [],
			gatewayTotal: 0,
		});
		const beta = lines.find((line) => line.label === "Beta");
		expect(beta).toMatchObject({
			ledger: 3,
			gateway: 0,
			diffPct: null,
			flagged: true,
		});
	});

	it("un tag con el id de la empresa se le atribuye igual que el del slug", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 5 }],
			gatewayByTag: [
				{ tag: "tenant:acme", totalCost: 4 },
				{ tag: "tenant:id-a", totalCost: 1 },
			],
			gatewayTotal: 5,
		});
		expect(lines.find((line) => line.label === "Acme")).toMatchObject({
			gateway: 5,
			flagged: false,
		});
		expect(lines.some((line) => line.kind === "tag_sin_empresa")).toBe(false);
	});

	it("un tag de una empresa que no existe queda en su propia fila", () => {
		const lines = reconcile({
			tenants,
			ledger: [],
			gatewayByTag: [{ tag: "tenant:fantasma", totalCost: 2 }],
			gatewayTotal: 2,
		});
		expect(lines.find((line) => line.kind === "tag_sin_empresa")).toMatchObject(
			{ label: "tenant:fantasma", ledger: 0, gateway: 2, flagged: true },
		);
	});

	it("la fila sin etiqueta es el total menos los tags de empresa", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 10 }],
			gatewayByTag: [
				{ tag: "tenant:acme", totalCost: 10 },
				{ tag: "otra-cosa", totalCost: 99 },
			],
			gatewayTotal: 12.5,
		});
		expect(lines.at(-1)).toMatchObject({
			kind: "sin_etiqueta",
			label: "Sin etiqueta",
			gateway: 2.5,
			flagged: true,
		});
	});

	it("sin gasto sin etiqueta, la fila está y no se marca", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 10 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 10 }],
			gatewayTotal: 10,
		});
		expect(lines.at(-1)).toMatchObject({
			kind: "sin_etiqueta",
			gateway: 0,
			flagged: false,
		});
	});

	it("una empresa sin gasto en ningún lado no aparece", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 1 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 1 }],
			gatewayTotal: 1,
		});
		expect(lines.some((line) => line.label === "Beta")).toBe(false);
	});
});
