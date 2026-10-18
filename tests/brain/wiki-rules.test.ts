// tests/brain/wiki-rules.test.ts
import { describe, expect, it, vi } from "vitest";
import type { WikiConfig } from "@/lib/brain/core/config";
import { BrainValidation } from "@/lib/brain/core/errors";
import type { RulePage } from "@/lib/brain/core/rules";
import type { BrainAuthor, BrainWrite } from "@/lib/brain/core/types";
import { createWikiProvider } from "@/lib/brain/core/wiki";
import type { WikiStore } from "@/lib/brain/core/wiki-store";

const config: WikiConfig = {
	categories: ["talento", "comercial"],
	requiredFrontmatter: ["owner"],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

function store(rules: RulePage[] = []): WikiStore {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(async () => null),
		list: async () => [],
		listMeta: async () => [],
		listLinks: async () => [],
		listRevisions: async () => null,
		listFolders: async () => [
			{ path: "talento", description: "" },
			{ path: "talento/personal", description: "" },
		],
		listRulePages: vi.fn(async () => rules),
		upsert: vi.fn(async (params) => ({ slug: params.slug, revision: 1 })),
	};
}

const write = (
	slug: string,
	body = "reglas",
	extra: Partial<BrainWrite> = {},
): BrainWrite => ({
	slug,
	title: "Reglas",
	category: "comercial",
	status: "activo",
	tags: [],
	body,
	reason: "alta",
	...extra,
});

const user: BrainAuthor = { kind: "user", userId: "u" };

function provider(s: WikiStore) {
	return createWikiProvider({
		tenantId: "t",
		bindingId: "b",
		config,
		store: s,
		today: () => "2026-10-14",
	});
}

describe("páginas reservadas en el proveedor wiki", () => {
	it("crea las instrucciones del brain en la raíz con la categoría brain y sin campos obligatorios", async () => {
		const s = store();
		await provider(s).upsert(write("00-reglas"), user);
		expect(s.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "00-reglas", category: "brain" }),
		);
	});

	it("una 00-plantilla en la raíz sigue siendo una página suelta nueva: folder_required", async () => {
		await expect(
			provider(store()).upsert(write("00-plantilla"), user),
		).rejects.toMatchObject({
			fields: ["slug"],
		});
	});

	it("las reglas de una carpeta toman la categoría de su ruta y no piden campos obligatorios", async () => {
		const s = store();
		await provider(s).upsert(write("talento/personal/00-reglas"), user);
		expect(s.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ category: "talento" }),
		);
	});

	it("una 00-reglas de más de 20 000 caracteres no se escribe", async () => {
		const s = store();
		await expect(
			provider(s).upsert(
				write("talento/personal/00-reglas", "x".repeat(20_001)),
				user,
			),
		).rejects.toBeInstanceOf(BrainValidation);
		expect(s.upsert).not.toHaveBeenCalled();
	});

	it("rechaza una cascada de más de 40 000 caracteres nombrando la carpeta", async () => {
		const s = store([
			{
				slug: "00-reglas",
				status: "activo",
				revision: 1,
				body: "x".repeat(12_000),
			},
			{
				slug: "talento/00-reglas",
				status: "activo",
				revision: 1,
				body: "x".repeat(20_000),
			},
		]);
		await expect(
			provider(s).upsert(
				write("talento/personal/00-reglas", "x".repeat(8_001)),
				user,
			),
		).rejects.toThrow(/talento\/personal/);
	});

	it("archivar una 00-reglas larga pasa", async () => {
		const s = store();
		await provider(s).upsert(
			write("talento/personal/00-reglas", "x".repeat(30_000), {
				status: "archivado",
				baseRevision: 2,
			}),
			user,
		);
		expect(s.upsert).toHaveBeenCalled();
	});

	it("los topes valen también para el import", async () => {
		const s = store();
		await expect(
			provider(s).upsert(write("00-reglas", "x".repeat(12_001)), {
				kind: "import",
				userId: null,
				sourcePath: "00-reglas.md",
				sourceHash: "h",
			}),
		).rejects.toBeInstanceOf(BrainValidation);
	});

	it("una página común no lee las reglas", async () => {
		const s = store();
		await provider(s).upsert(
			write("talento/personal/leo", "b", { frontmatter: { owner: "ana" } }),
			user,
		);
		expect(s.listRulePages).not.toHaveBeenCalled();
	});
});
