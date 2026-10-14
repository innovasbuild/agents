import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	admin: true,
	tenants: [] as unknown[],
	ledger: [] as unknown[],
	error: null as { message: string } | null,
	rpc: [] as unknown[],
};

vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { userId: "u1", supabase: {} } : null,
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: () => ({
				order: async () => ({ data: state.tenants, error: null }),
			}),
		}),
		rpc: async (name: string, args: unknown) => {
			state.rpc.push([name, args]);
			return { data: state.error ? null : state.ledger, error: state.error };
		},
	}),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));
vi.mock("@/app/plataforma/gasto/reconcile-panel", () => ({
	ReconcilePanel: () => null,
}));

const { default: GastoPlataformaPage } = await import(
	"@/app/plataforma/gasto/page"
);
const render = async () => renderToStaticMarkup(await GastoPlataformaPage());

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
	state.admin = true;
	state.error = null;
	state.rpc = [];
	state.tenants = [
		{ id: "id-a", slug: "acme", display_name: "Acme" },
		{ id: "id-b", slug: "beta", display_name: "Beta" },
	];
	state.ledger = [
		{ tenant_id: "id-a", day: "2026-10-13", amount: "1.500000" },
		{ tenant_id: "id-a", day: "2026-10-02", amount: "2.000000" },
		{ tenant_id: "id-a", day: "2026-09-30", amount: "4.000000" },
	];
});

describe("gasto por empresa en plataforma", () => {
	it("sin permiso de plataforma, 404 y ninguna lectura", async () => {
		state.admin = false;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(state.rpc).toEqual([]);
	});

	it("pide desde el 1 del mes anterior y muestra hoy, mes y mes anterior", async () => {
		const html = await render();
		expect(state.rpc[0]).toEqual([
			"platform_spend_report",
			{
				p_from: "2026-09-01T00:00:00.000Z",
				p_to: "2026-11-01T00:00:00.000Z",
			},
		]);
		expect(html).toContain("Acme");
		expect(html).toContain("US$ 1,50");
		expect(html).toContain("US$ 3,50");
		expect(html).toContain("US$ 4,00");
		expect(html).toContain('href="/plataforma/acme"');
	});

	it("una empresa sin gasto aparece en cero", async () => {
		const html = await render();
		expect(html).toContain("Beta");
		expect(html).toContain("US$ 0,00");
	});

	it("muestra la fila de total", async () => {
		expect(await render()).toContain("Total");
	});

	it("si la lectura falla, lo dice y no muestra ceros", async () => {
		state.error = { message: "roto" };
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const html = await render();
		expect(html).toContain("No pude leer el gasto");
		expect(html).not.toContain("US$ 0,00");
		spy.mockRestore();
	});
});
