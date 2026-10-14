import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	role: "tenant_admin" as string | null,
	rows: [] as unknown[],
	error: null as { message: string } | null,
	rpc: [] as unknown[],
};

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () =>
		state.role === null
			? null
			: { id: "t1", slug: "acme", displayName: "Acme", role: state.role },
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		rpc: async (name: string, args: unknown) => {
			state.rpc.push([name, args]);
			return { data: state.error ? null : state.rows, error: state.error };
		},
	}),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: GastoPage } = await import(
	"@/app/[tenant]/settings/gasto/page"
);

const render = async (periodo?: string) =>
	renderToStaticMarkup(
		await GastoPage({
			params: Promise.resolve({ tenant: "acme" }),
			searchParams: Promise.resolve(periodo ? { periodo } : {}),
		}),
	);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
	state.role = "tenant_admin";
	state.error = null;
	state.rpc = [];
	state.rows = [
		{ day: "2026-10-05", origin: "chat", amount: "0.100000" },
		{ day: "2026-10-06", origin: "draft-queue", amount: "1.400000" },
	];
});

describe("pantalla de gasto del cliente", () => {
	it("un miembro recibe 404", async () => {
		state.role = "tenant_member";
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(state.rpc).toEqual([]);
	});

	it("sin acceso a la empresa, 404", async () => {
		state.role = null;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("pide el mes en curso en UTC y muestra total, días y orígenes", async () => {
		const html = await render();
		expect(state.rpc).toEqual([
			[
				"tenant_spend_report",
				{
					p_tenant: "t1",
					p_from: "2026-10-01T00:00:00.000Z",
					p_to: "2026-11-01T00:00:00.000Z",
				},
			],
		]);
		expect(html).toContain("octubre de 2026");
		expect(html).toContain("US$ 1,50");
		expect(html).toContain("05/10/2026");
		expect(html).toContain("Chat");
		expect(html).toContain("draft-queue");
		expect(html).toContain("UTC");
	});

	it("con periodo=anterior pide el mes anterior", async () => {
		const html = await render("anterior");
		expect(state.rpc[0]).toEqual([
			"tenant_spend_report",
			expect.objectContaining({ p_from: "2026-09-01T00:00:00.000Z" }),
		]);
		expect(html).toContain("septiembre de 2026");
	});

	it("sin gasto, estado vacío y no una tabla en cero", async () => {
		state.rows = [];
		const html = await render();
		expect(html).toContain("No hay gasto registrado");
		expect(html).not.toContain("<table");
	});

	it("si la lectura falla, lo dice y no muestra cero", async () => {
		state.error = { message: "roto" };
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const html = await render();
		expect(html).toContain("No pude leer el gasto");
		expect(html).not.toContain("US$ 0,00");
		spy.mockRestore();
	});
});
