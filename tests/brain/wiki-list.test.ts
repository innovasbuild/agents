import { describe, expect, it, vi } from "vitest";
import type { WikiConfig } from "@/lib/brain/core/config";
import { BrainValidation } from "@/lib/brain/core/errors";
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
