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
		listMeta: async () => [],
		listLinks: async () => [],
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

	it("el agente crea una página en una subcarpeta que no existe: la base la crea", async () => {
		const s = store(["comercial"]);
		await provider(s).upsert(write("comercial/sucursales/centro"), {
			kind: "agent",
			userId: null,
			sessionId: "s",
		});
		expect(s.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "comercial/sucursales/centro" }),
		);
	});

	it("una persona sigue sin poder crear una página en una subcarpeta que no existe y nombra la más cercana", async () => {
		const s = store(["comercial"]);
		const result = provider(s).upsert(write("comercial/sucursales/centro"), {
			kind: "user",
			userId: "u",
		});
		await expect(result).rejects.toBeInstanceOf(BrainValidation);
		await expect(result).rejects.toThrow(
			/comercial\/sucursales[\s\S]*comercial/,
		);
		expect(s.upsert).not.toHaveBeenCalled();
	});

	it("una carpeta de primer nivel que no existe falla como carpeta y la nombra", async () => {
		const s = store(["comercial"]);
		const result = provider(s).upsert(write("marketing/pauta"), {
			kind: "user",
			userId: "u",
		});
		await expect(result).rejects.toMatchObject({
			fields: ["folder"],
			message:
				"No existe la carpeta marketing. Pedile a un administrador que la cree.",
		});
		expect(s.upsert).not.toHaveBeenCalled();
	});

	it("el agente recibe el mismo mensaje por una carpeta de primer nivel que no existe", async () => {
		const s = store([]);
		await expect(
			provider(s).upsert(write("foo/x"), {
				kind: "agent",
				userId: null,
				sessionId: "s",
			}),
		).rejects.toMatchObject({
			fields: ["folder"],
			message: expect.stringContaining("No existe la carpeta foo."),
		});
	});

	it("una carpeta de primer nivel que existe sigue entrando", async () => {
		const s = store(["comercial"]);
		await provider(s).upsert(write("comercial/x"), {
			kind: "user",
			userId: "u",
		});
		expect(s.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "comercial/x", category: "comercial" }),
		);
	});

	it("una subcarpeta que no existe bajo una carpeta inexistente sigue nombrando la subcarpeta", async () => {
		const s = store([]);
		await expect(
			provider(s).upsert(write("marketing/pauta/x"), {
				kind: "user",
				userId: "u",
			}),
		).rejects.toMatchObject({
			fields: ["folder"],
			message: expect.stringContaining("No existe la carpeta marketing/pauta."),
		});
	});

	it("una edición en una carpeta de primer nivel desconocida sigue fallando como categoría", async () => {
		const s = store([]);
		await expect(
			provider(s).upsert(
				{ ...write("marketing/pauta"), baseRevision: 2 },
				{ kind: "user", userId: "u" },
			),
		).rejects.toMatchObject({ fields: expect.arrayContaining(["category"]) });
	});

	it("el import con una carpeta de primer nivel desconocida sigue fallando como categoría", async () => {
		const s = store([]);
		await expect(
			provider(s).upsert(write("marketing/pauta"), {
				kind: "import",
				userId: null,
				sourcePath: "a.md",
				sourceHash: "h",
			}),
		).rejects.toMatchObject({ fields: expect.arrayContaining(["category"]) });
	});

	it("skills/ sin la categoría skill en la config sigue fallando como categoría", async () => {
		const s = store([]);
		await expect(
			provider(s).upsert(write("skills/x"), { kind: "user", userId: "u" }),
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
