import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	filters: [] as [string, unknown][],
	rows: [] as Record<string, unknown>[],
	error: null as { message: string } | null,
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: () => {
				const chain = {
					eq(column: string, value: unknown) {
						state.filters.push([column, value]);
						return chain;
					},
					then(resolve: (value: unknown) => void) {
						resolve({ data: state.rows, error: state.error });
					},
				};
				return chain;
			},
		}),
	}),
}));

const { hasEnabledBinding, loadTenantBindings } = await import(
	"@/lib/connectors/bindings"
);

describe("loadTenantBindings", () => {
	it("filtra por tenant y enabled y mapea a camelCase", async () => {
		state.filters = [];
		state.error = null;
		state.rows = [
			{
				id: "b1",
				tenant_id: "tenant-a",
				capability: "brain",
				provider: "innovas-brains",
				connector_uid: "tenant-a-brain",
				config: { url: "https://x" },
			},
		];
		const bindings = await loadTenantBindings("tenant-a");
		expect(state.filters).toEqual([
			["tenant_id", "tenant-a"],
			["enabled", true],
		]);
		expect(bindings).toEqual([
			{
				id: "b1",
				tenantId: "tenant-a",
				capability: "brain",
				provider: "innovas-brains",
				connectorUid: "tenant-a-brain",
				config: { url: "https://x" },
			},
		]);
	});

	it("tira con el error de la base", async () => {
		state.error = { message: "timeout" };
		await expect(loadTenantBindings("tenant-a")).rejects.toThrow("timeout");
	});
});

describe("hasEnabledBinding", () => {
	it("encuentra el binding por capacidad y proveedor", async () => {
		state.error = null;
		state.rows = [
			{
				id: "b1",
				tenant_id: "t",
				capability: "mail",
				provider: "gmail",
				connector_uid: null,
				config: {},
			},
		];
		expect(await hasEnabledBinding("t", "mail", "gmail")).toBe(true);
		expect(await hasEnabledBinding("t", "crm", "hubspot")).toBe(false);
	});
});
