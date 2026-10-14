import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	admin: true,
	tenants: [] as unknown[],
	ledgers: {} as Record<string, unknown[]>,
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
			const from = (args as { p_from: string }).p_from;
			return {
				data: state.error ? null : (state.ledgers[from] ?? []),
				error: state.error,
			};
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
	// Cada rango trae una fila por empresa; el monto llega como texto.
	state.ledgers = {
		"2026-10-13T00:00:00.000Z": [{ tenant_id: "id-a", amount: "1.500000" }],
		"2026-10-01T00:00:00.000Z": [{ tenant_id: "id-a", amount: "3.500000" }],
		"2026-09-01T00:00:00.000Z": [
			{ tenant_id: "id-a", amount: "4.000000" },
			{ tenant_id: "id-b", amount: "0.250000" },
		],
	};
});

describe("gasto por empresa en plataforma", () => {
	it("sin permiso de plataforma, 404 y ninguna lectura", async () => {
		state.admin = false;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(state.rpc).toEqual([]);
	});

	it("pide hoy, el mes en curso y el mes anterior, un rango cada uno", async () => {
		const html = await render();
		expect(state.rpc).toEqual([
			[
				"platform_spend_report",
				{
					p_from: "2026-10-13T00:00:00.000Z",
					p_to: "2026-10-14T00:00:00.000Z",
				},
			],
			[
				"platform_spend_report",
				{
					p_from: "2026-10-01T00:00:00.000Z",
					p_to: "2026-11-01T00:00:00.000Z",
				},
			],
			[
				"platform_spend_report",
				{
					p_from: "2026-09-01T00:00:00.000Z",
					p_to: "2026-10-01T00:00:00.000Z",
				},
			],
		]);
		expect(html).toContain("Acme");
		expect(html).toContain("US$ 1,50");
		expect(html).toContain("US$ 3,50");
		expect(html).toContain("US$ 4,00");
		expect(html).toContain('href="/plataforma/acme"');
	});

	it("los meses se rotulan con mayúscula solo en la primera letra", async () => {
		const html = await render();
		expect(html).toContain("Octubre de 2026");
		expect(html).toContain("Septiembre de 2026");
		expect(html).not.toContain("capitalize");
	});

	it("una empresa sin gasto aparece en cero", async () => {
		const html = await render();
		expect(html).toContain("Beta");
		expect(html).toContain("US$ 0,00");
	});

	it("la fila de total suma las empresas", async () => {
		const html = await render();
		const footer = html.match(/<tfoot.*<\/tfoot>/)?.[0] ?? "";
		expect(footer).toContain(
			'<th class="px-4 py-2 text-left font-medium" scope="row">',
		);
		const text = footer
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		expect(text).toBe("Total US$ 1,50 US$ 3,50 US$ 4,25");
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
