import { describe, expect, it, vi } from "vitest";
import type { BrainBinding } from "@/lib/brain/resolve";
import { createBrainTools } from "@/lib/brain/tools";
import type { BrainProvider } from "@/lib/brain/types";

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

	it("la descripción de brain_upsert del agente avisa que la aprueba un administrador", () => {
		const tools = createBrainTools(binding, "read_write", {
			provider: fakeProvider,
		});
		const description =
			"brain_upsert" in tools ? String(tools.brain_upsert.description) : "";
		expect(description).toMatch(/aprueba un administrador/);
	});
});
