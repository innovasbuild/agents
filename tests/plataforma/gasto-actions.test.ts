import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	admin: true,
	tenants: [{ id: "id-a", slug: "acme", display_name: "Acme" }] as unknown[],
	ledger: [{ tenant_id: "id-a", amount: "10.000000" }] as unknown[],
	dbError: null as { message: string } | null,
	gatewayError: null as Error | null,
	reports: [] as unknown[],
	rpc: [] as unknown[],
};

vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { userId: "u1", supabase: {} } : null,
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: async () => ({ data: state.tenants, error: state.dbError }),
		}),
		rpc: async (name: string, args: unknown) => {
			state.rpc.push([name, args]);
			return { data: state.ledger, error: state.dbError };
		},
	}),
}));
vi.mock("ai", () => ({
	gateway: {
		getSpendReport: async (params: { groupBy: string }) => {
			state.reports.push(params);
			if (state.gatewayError) throw state.gatewayError;
			return params.groupBy === "tag"
				? { results: [{ tag: "tenant:acme", totalCost: 10 }] }
				: { results: [{ day: "2026-10-05", totalCost: 12 }] };
		},
	},
}));

const { reconcileSpend } = await import("@/app/plataforma/gasto/actions");

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
	state.admin = true;
	state.dbError = null;
	state.gatewayError = null;
	state.reports = [];
	state.rpc = [];
});

describe("reconcileSpend", () => {
	it("sin permiso de plataforma no consulta nada", async () => {
		state.admin = false;
		expect(await reconcileSpend("actual")).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});
		expect(state.reports).toEqual([]);
		expect(state.rpc).toEqual([]);
	});

	it("pide el mismo rango al libro y al gateway, y arma las líneas", async () => {
		const result = await reconcileSpend("actual");
		expect(state.rpc).toEqual([
			[
				"platform_spend_report",
				{
					p_from: "2026-10-01T00:00:00.000Z",
					p_to: "2026-10-13T00:00:00.000Z",
				},
			],
		]);
		expect(state.reports).toEqual([
			{ startDate: "2026-10-01", endDate: "2026-10-12", groupBy: "tag" },
			{ startDate: "2026-10-01", endDate: "2026-10-12", groupBy: "day" },
		]);
		expect(result).toMatchObject({
			ok: true,
			startDate: "2026-10-01",
			endDate: "2026-10-12",
		});
		if (!result.ok) throw new Error("esperaba ok");
		expect(result.lines).toEqual([
			expect.objectContaining({ label: "Acme", ledger: 10, gateway: 10 }),
			expect.objectContaining({ kind: "sin_etiqueta", gateway: 2 }),
		]);
	});

	it("el día 1, el mes en curso responde con un mensaje y no consulta", async () => {
		vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
		const result = await reconcileSpend("actual");
		expect(result.ok).toBe(false);
		expect(state.reports).toEqual([]);
		expect(state.rpc).toEqual([]);
	});

	it("si el gateway rechaza, muestra el motivo", async () => {
		state.gatewayError = new Error("Custom Reporting requires a Pro plan");
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await reconcileSpend("anterior")).toEqual({
			ok: false,
			message:
				"El gateway rechazó la consulta: Custom Reporting requires a Pro plan",
		});
		spy.mockRestore();
	});

	it("si falla la base, no consulta al gateway", async () => {
		state.dbError = { message: "roto" };
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await reconcileSpend("actual");
		expect(result).toEqual({
			ok: false,
			message: "No pude leer el libro de consumo. Probá de nuevo.",
		});
		expect(state.reports).toEqual([]);
		spy.mockRestore();
	});

	it("un período inválido se toma como el mes en curso", async () => {
		await reconcileSpend("cualquiera");
		expect(state.reports[0]).toMatchObject({ startDate: "2026-10-01" });
	});
});
