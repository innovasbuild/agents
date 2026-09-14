import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connectors/catalog", () => ({
	buildTenantConnections: (bindings: { provider: string }[]) =>
		Object.fromEntries(bindings.map((b) => [b.provider, { built: true }])),
}));

const { resolveTenantConnections } = await import("@/lib/connectors/resolve");

describe("resolveTenantConnections", () => {
	it("sin tenant devuelve null y no consulta la base", async () => {
		const load = vi.fn();
		expect(await resolveTenantConnections("", load)).toBeNull();
		expect(load).not.toHaveBeenCalled();
	});

	it("consulta solo el tenant de la sesión", async () => {
		const load = vi.fn(async () => []);
		await resolveTenantConnections("tenant-a", load);
		expect(load).toHaveBeenCalledWith("tenant-a");
	});

	it("tenant sin bindings devuelve null", async () => {
		expect(
			await resolveTenantConnections("tenant-a", async () => []),
		).toBeNull();
	});

	it("devuelve el mapa armado por el catálogo", async () => {
		const result = await resolveTenantConnections("tenant-a", async () => [
			{
				id: "1",
				tenantId: "tenant-a",
				capability: "leads",
				provider: "coldiq",
				connectorUid: "x",
				config: {},
			},
		]);
		expect(result).toEqual({ coldiq: { built: true } });
	});

	it("si falla la consulta, propaga para que la sesión no arranque", async () => {
		await expect(
			resolveTenantConnections("tenant-a", async () => {
				throw new Error("base caída");
			}),
		).rejects.toThrow("base caída");
	});
});
