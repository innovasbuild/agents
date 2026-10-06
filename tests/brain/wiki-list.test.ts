import { describe, expect, it, vi } from "vitest";
import type { WikiConfig } from "@/lib/brain/core/config";
import { BrainNotFound, BrainValidation } from "@/lib/brain/core/errors";
import { createWikiProvider } from "@/lib/brain/core/wiki";
import type { WikiStore } from "@/lib/brain/core/wiki-store";

const config: WikiConfig = {
	categories: ["comercial"],
	requiredFrontmatter: [],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

function provider(store: Partial<WikiStore>) {
	return createWikiProvider({
		tenantId: "tenant-a",
		bindingId: "binding-1",
		config,
		store: store as WikiStore,
	});
}

describe("wiki provider · list", () => {
	it("pide al store las páginas del tenant del closure", async () => {
		const list = vi.fn(async () => []);
		await provider({ list }).list();
		expect(list).toHaveBeenCalledWith("tenant-a");
	});
});

describe("wiki provider · history", () => {
	it("pide las revisiones del tenant del closure", async () => {
		const listRevisions = vi.fn(async () => []);
		await provider({ listRevisions }).history("comercial/icp");
		expect(listRevisions).toHaveBeenCalledWith("tenant-a", "comercial/icp");
	});

	it("devuelve null si la página no existe", async () => {
		const listRevisions = vi.fn(async () => null);
		expect(
			await provider({ listRevisions }).history("comercial/nada"),
		).toBeNull();
	});

	it("rechaza un slug inválido sin tocar la base", async () => {
		const listRevisions = vi.fn();
		await expect(
			provider({ listRevisions }).history("../etc"),
		).rejects.toBeInstanceOf(BrainValidation);
		expect(listRevisions).not.toHaveBeenCalled();
	});
});

// Value: protects=read({suggestions:false}) no dispara la busqueda de paginas parecidas cuando la pagina no existe;
//   sin la opcion sigue sugiriendo.
// fails_when=se ignora la opcion y la ruta raw vuelve a pagar una busqueda full-text por cada 404.
// why_new=los tests de read no distinguen con y sin sugerencias; seam=none
describe("wiki provider · read sin sugerencias", () => {
	it("no busca sugerencias si se pide suggestions: false", async () => {
		const search = vi.fn(async () => []);
		const read = vi.fn(async () => null);
		await expect(
			provider({ read, search }).read("comercial/nada", { suggestions: false }),
		).rejects.toMatchObject({ suggestions: [] });
		expect(search).not.toHaveBeenCalled();
	});

	it("sin la opcion busca sugerencias como siempre", async () => {
		const search = vi.fn(async () => []);
		const read = vi.fn(async () => null);
		await expect(
			provider({ read, search }).read("comercial/nada"),
		).rejects.toBeInstanceOf(BrainNotFound);
		expect(search).toHaveBeenCalledTimes(1);
	});
});
