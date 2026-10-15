import { describe, expect, it, vi } from "vitest";
import type { WikiConfig } from "@/lib/brain/core/config";
import { BrainValidation } from "@/lib/brain/core/errors";
import type { BrainWrite } from "@/lib/brain/core/types";
import { createWikiProvider } from "@/lib/brain/core/wiki";
import type { WikiStore } from "@/lib/brain/core/wiki-store";

const config: WikiConfig = {
	categories: ["comercial", "talento"],
	requiredFrontmatter: [],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

function store(folders: string[]): WikiStore {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(async () => null),
		list: async () => [],
		listRevisions: async () => null,
		listFolders: async () => folders.map((path) => ({ path, description: "" })),
		listRulePages: async () => [],
		upsert: vi.fn(async (params) => ({ slug: params.slug, revision: 1 })),
	};
}

const write = (slug: string, category = "otra"): BrainWrite => ({
	slug,
	title: "T",
	category,
	status: "activo",
	tags: [],
	body: "x",
	reason: "alta",
});

function provider(s: WikiStore) {
	return createWikiProvider({
		tenantId: "t",
		bindingId: "b",
		config,
		store: s,
		today: () => "2026-10-14",
	});
}

describe("carpetas en el proveedor wiki", () => {
	it("calcula la categoría desde la ruta, ignore lo que venga", async () => {
		const s = store(["talento", "talento/personal"]);
		await provider(s).upsert(write("talento/personal/leo", "empresa"), {
			kind: "user",
			userId: "u",
		});
		expect(s.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ category: "talento" }),
		);
	});

	it("rechaza una página nueva en una subcarpeta que no existe y nombra la más cercana", async () => {
		const s = store(["comercial"]);
		const result = provider(s).upsert(write("comercial/sucursales/centro"), {
			kind: "agent",
			userId: null,
			sessionId: "s",
		});
		await expect(result).rejects.toBeInstanceOf(BrainValidation);
		await expect(result).rejects.toThrow(
			/comercial\/sucursales[\s\S]*comercial/,
		);
		expect(s.upsert).not.toHaveBeenCalled();
	});

	it("una carpeta de primer nivel que no existe falla como categoría", async () => {
		const s = store(["comercial"]);
		await expect(
			provider(s).upsert(write("marketing/pauta"), {
				kind: "user",
				userId: "u",
			}),
		).rejects.toMatchObject({ fields: expect.arrayContaining(["category"]) });
	});

	it("rechaza una página nueva en la raíz", async () => {
		const s = store([]);
		await expect(
			provider(s).upsert(write("suelta"), { kind: "user", userId: "u" }),
		).rejects.toMatchObject({ fields: ["slug"] });
	});

	it("deja editar una página suelta que ya existía, con su categoría", async () => {
		const s = store([]);
		await provider(s).upsert(
			{ ...write("suelta", "comercial"), baseRevision: 3 },
			{ kind: "user", userId: "u" },
		);
		expect(s.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ category: "comercial" }),
		);
	});

	it("el import no chequea subcarpetas: las crea la base", async () => {
		const s = store([]);
		await provider(s).upsert(write("comercial/nueva/x"), {
			kind: "import",
			userId: null,
			sourcePath: "a.md",
			sourceHash: "h",
		});
		expect(s.upsert).toHaveBeenCalled();
	});

	it("una edición no relee las carpetas", async () => {
		const s = store([]);
		const listFolders = vi.spyOn(s, "listFolders");
		await provider(s).upsert(
			{ ...write("comercial/sin-carpeta/x"), baseRevision: 2 },
			{ kind: "user", userId: "u" },
		);
		expect(listFolders).not.toHaveBeenCalled();
	});
});
