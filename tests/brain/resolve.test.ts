import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBrainBinding } from "@/lib/brain/resolve";
import type { Binding } from "@/lib/connectors/providers";

const wikiConfig = {
	categories: ["comercial"],
	requiredFrontmatter: [],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

function binding(overrides: Partial<Binding>): Binding {
	return {
		id: "binding-1",
		tenantId: "tenant-a",
		capability: "brain",
		provider: "wiki",
		connectorUid: null,
		config: wikiConfig,
		...overrides,
	};
}

describe("resolveBrainBinding", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	afterEach(() => warn.mockClear());

	it("sin tenant no consulta y devuelve null", async () => {
		const load = vi.fn();
		expect(await resolveBrainBinding("", load)).toBeNull();
		expect(load).not.toHaveBeenCalled();
	});

	it("sin binding de brain devuelve null", async () => {
		const load = vi.fn(async () => [
			binding({ capability: "crm", provider: "hubspot" }),
		]);
		expect(await resolveBrainBinding("tenant-a", load)).toBeNull();
	});

	it("con wiki devuelve el binding con la configuración parseada", async () => {
		const load = vi.fn(async () => [binding({})]);
		expect(await resolveBrainBinding("tenant-a", load)).toEqual({
			id: "binding-1",
			tenantId: "tenant-a",
			provider: "wiki",
			config: wikiConfig,
		});
	});

	it("un proveedor de brain no construido se omite con aviso", async () => {
		const load = vi.fn(async () => [binding({ provider: "gbrain" })]);
		expect(await resolveBrainBinding("tenant-a", load)).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("gbrain"));
	});

	it("con mcp devuelve el binding con conector y configuración parseada", async () => {
		const load = vi.fn(async () => [
			binding({
				provider: "mcp",
				connectorUid: "cliente-brain",
				config: {
					url: "https://brain.cliente.test/mcp",
					categories: ["comercial"],
				},
			}),
		]);
		expect(await resolveBrainBinding("tenant-a", load)).toMatchObject({
			provider: "mcp",
			connectorUid: "cliente-brain",
			config: { url: "https://brain.cliente.test/mcp", timeoutMs: 10000 },
		});
	});

	it("un mcp sin conector se omite con aviso", async () => {
		const load = vi.fn(async () => [
			binding({
				provider: "mcp",
				connectorUid: null,
				config: {
					url: "https://brain.cliente.test/mcp",
					categories: ["comercial"],
				},
			}),
		]);
		expect(await resolveBrainBinding("tenant-a", load)).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("conector"));
	});

	it("una configuración inválida se omite con aviso", async () => {
		const load = vi.fn(async () => [binding({ config: { categories: [] } })]);
		expect(await resolveBrainBinding("tenant-a", load)).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("configuración"));
	});

	it("propaga el error de la consulta", async () => {
		const load = vi.fn(async () => {
			throw new Error("base caída");
		});
		await expect(resolveBrainBinding("tenant-a", load)).rejects.toThrow(
			"base caída",
		);
	});
});
