import { describe, expect, it, vi } from "vitest";
import { createBrainTools } from "@/lib/brain/adapters/tools";
import type { BrainBinding } from "@/lib/brain/core/resolve";
import type { BrainProvider } from "@/lib/brain/core/types";

const binding: BrainBinding = {
	id: "b1",
	tenantId: "tenant-a",
	provider: "wiki",
	config: {
		categories: ["comercial"],
		requiredFrontmatter: [],
		search: "fts",
		mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
	},
};

function fakeProvider(): BrainProvider {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(),
		list: async () => [],
		history: async () => null,
		upsert: vi.fn(async () => ({ slug: "a", revision: 1 })),
	};
}

describe("createBrainTools", () => {
	it("con acceso de lectura devuelve solo búsqueda y lectura", () => {
		const tools = createBrainTools(binding, "read", { provider: fakeProvider });
		expect(Object.keys(tools).sort()).toEqual(["brain_read", "brain_search"]);
	});

	it("con lectura y escritura suma brain_upsert, con aprobación", () => {
		const tools = createBrainTools(binding, "read_write", {
			provider: fakeProvider,
		});
		expect(Object.keys(tools).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
		]);
		expect("brain_upsert" in tools && tools.brain_upsert.approval).toBeTruthy();
		expect(tools.brain_search.approval).toBeUndefined();
	});

	it("brain_search y brain_read siguen llamando al provider inyectado al ejecutar", async () => {
		const summary = {
			slug: "a",
			title: "A",
			category: "comercial",
			status: "activo" as const,
			tags: [],
			snippet: "",
			updatedAt: "2026-01-01",
		};
		const page = {
			slug: "a",
			title: "A",
			category: "comercial",
			status: "activo" as const,
			tags: [],
			frontmatter: {},
			body: "",
			revision: 1,
			updatedAt: "2026-01-01",
		};
		const search = vi.fn(async () => [summary]);
		const read = vi.fn(async () => page);
		const providerFactory = vi.fn(() => ({
			search,
			read,
			list: async () => [],
			history: async () => null,
			upsert: vi.fn(async () => ({ slug: "a", revision: 1 })),
		}));
		const tools = createBrainTools(binding, "read", { provider: providerFactory });

		const searchResult = await tools.brain_search.execute({ query: "hola" }, {} as never);
		const readResult = await tools.brain_read.execute({ slug: "a" }, {} as never);

		expect(providerFactory).toHaveBeenCalledWith(binding);
		expect(search).toHaveBeenCalledWith({ query: "hola" });
		expect(read).toHaveBeenCalledWith("a");
		expect(searchResult).toMatchObject({ ok: true });
		expect(readResult).toMatchObject({ ok: true });
	});

	it("la descripción de brain_upsert del agente avisa que la aprueba un administrador", () => {
		const tools = createBrainTools(binding, "read_write", {
			provider: fakeProvider,
		});
		const description =
			"brain_upsert" in tools ? String(tools.brain_upsert.description) : "";
		expect(description).toMatch(/aprueba un administrador/);
	});
});
