import { describe, expect, it, vi } from "vitest";
import { budgetStatus } from "@/lib/workflows/budget";

const TZ = "America/Argentina/Buenos_Aires";
// 01:30 UTC del 22 = 22:30 del 21 en Buenos Aires: todavía es "hoy 21" allá.
const now = () => new Date("2026-09-22T01:30:00Z");

describe("budgetStatus", () => {
	it("suma desde la medianoche del tenant, no desde la de UTC", async () => {
		const usageSince = vi.fn(async () => 1.25);
		const dailyLimit = vi.fn(async () => 5);

		const [status] = await budgetStatus(
			{ tenantId: "t1", resources: ["model_usd"], timezone: TZ },
			{ store: { usageSince, dailyLimit }, now },
		);

		// Medianoche del 21 en Buenos Aires (UTC-3) = 03:00 UTC del 21.
		expect(usageSince).toHaveBeenCalledWith(
			"t1",
			"model_usd",
			new Date("2026-09-21T03:00:00Z"),
		);
		expect(status).toEqual({
			resource: "model_usd",
			spent: 1.25,
			limit: 5,
			exhausted: false,
		});
	});

	it("gastado igual al límite ya es agotado", async () => {
		const [status] = await budgetStatus(
			{ tenantId: "t1", resources: ["model_usd"], timezone: TZ },
			{
				store: { usageSince: async () => 5, dailyLimit: async () => 5 },
				now,
			},
		);
		expect(status.exhausted).toBe(true);
	});

	it("sin presupuesto cargado el límite es cero: nada desatendido gasta sin permiso", async () => {
		const [status] = await budgetStatus(
			{ tenantId: "t1", resources: ["model_usd"], timezone: TZ },
			{
				store: { usageSince: async () => 0, dailyLimit: async () => 0 },
				now,
			},
		);
		expect(status).toMatchObject({ limit: 0, exhausted: true });
	});

	it("revisa cada recurso que el workflow gasta", async () => {
		const statuses = await budgetStatus(
			{
				tenantId: "t1",
				resources: ["model_usd", "apollo_credits"],
				timezone: TZ,
			},
			{
				store: {
					usageSince: async (_t, resource) =>
						resource === "apollo_credits" ? 100 : 0,
					dailyLimit: async () => 50,
				},
				now,
			},
		);
		expect(statuses.map((s) => [s.resource, s.exhausted])).toEqual([
			["model_usd", false],
			["apollo_credits", true],
		]);
	});
});
