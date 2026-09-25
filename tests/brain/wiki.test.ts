import { describe, expect, it, vi } from "vitest";
import type { WikiConfig } from "@/lib/brain/config";
import {
	BrainConflict,
	BrainNotFound,
	BrainValidation,
} from "@/lib/brain/errors";
import type { BrainWrite } from "@/lib/brain/types";
import { createWikiProvider, validateWrite } from "@/lib/brain/wiki";
import { type WikiStore, WikiStoreError } from "@/lib/brain/wiki-store";

const config: WikiConfig = {
	categories: ["comercial", "marketing"],
	requiredFrontmatter: ["title", "category", "status", "updated"],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

const write: BrainWrite = {
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo",
	tags: ["canon:icp"],
	frontmatter: { title: "viejo", owner: "mati" },
	body: "Decisión de compra",
	reason: "ajuste del ICP",
};

function fakeStore(overrides: Partial<WikiStore> = {}): WikiStore {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(async () => null),
		upsert: vi.fn(async (params) => ({ slug: params.slug, revision: 1 })),
		...overrides,
	};
}

function provider(store: WikiStore) {
	return createWikiProvider({
		tenantId: "tenant-a",
		bindingId: "binding-a",
		config,
		store,
		today: () => "2026-09-13",
	});
}

describe("validateWrite", () => {
	it("saca del frontmatter las claves que son columnas y completa updated", () => {
		expect(validateWrite(write, config, "2026-09-13")).toEqual({
			owner: "mati",
			updated: "2026-09-13",
		});
	});

	it("respeta un updated que ya viene", () => {
		expect(
			validateWrite(
				{ ...write, frontmatter: { updated: "2026-01-01" } },
				config,
				"2026-09-13",
			),
		).toEqual({ updated: "2026-01-01" });
	});

	it("junta todos los campos inválidos", () => {
		try {
			validateWrite(
				{
					...write,
					slug: "Comercial/ICP",
					category: "finanzas",
					reason: " ",
					body: "x".repeat(204801),
				},
				config,
				"2026-09-13",
			);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(BrainValidation);
			expect((error as BrainValidation).fields).toEqual([
				"slug",
				"category",
				"body",
				"reason",
			]);
		}
	});

	it("exige el frontmatter requerido que no es columna", () => {
		const strict: WikiConfig = { ...config, requiredFrontmatter: ["owner"] };
		expect(() =>
			validateWrite({ ...write, frontmatter: {} }, strict, "2026-09-13"),
		).toThrow(BrainValidation);
	});
});

describe("createWikiProvider", () => {
	it("escribe como agente con tenant, binding y sesión", async () => {
		const store = fakeStore();
		await provider(store).upsert(
			{ ...write, baseRevision: 3 },
			{ kind: "agent", userId: "user-1", sessionId: "wrun_1" },
		);
		expect(store.upsert).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			slug: "comercial/icp",
			title: "ICP",
			category: "comercial",
			status: "activo",
			tags: ["canon:icp"],
			frontmatter: { owner: "mati", updated: "2026-09-13" },
			body: "Decisión de compra",
			reason: "ajuste del ICP",
			baseRevision: 3,
			authorKind: "agent",
			authorUserId: "user-1",
			sessionId: "wrun_1",
			bindingId: "binding-a",
			sourcePath: null,
			sourceHash: null,
		});
	});

	it("escribe como import con el origen", async () => {
		const store = fakeStore();
		await provider(store).upsert(write, {
			kind: "import",
			userId: null,
			sourcePath: "comercial/icp.md",
			sourceHash: "abc",
		});
		expect(store.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				authorKind: "import",
				baseRevision: null,
				sourcePath: "comercial/icp.md",
				sourceHash: "abc",
			}),
		);
	});

	it("no llama a la base si la validación falla", async () => {
		const store = fakeStore();
		await expect(
			provider(store).upsert(
				{ ...write, category: "finanzas" },
				{ kind: "user", userId: "u" },
			),
		).rejects.toBeInstanceOf(BrainValidation);
		expect(store.upsert).not.toHaveBeenCalled();
	});

	it("traduce los errores de la función SQL", async () => {
		const conflict = fakeStore({
			upsert: vi.fn(async () => {
				throw new WikiStoreError("BR409", "BRAIN_CONFLICT", "4");
			}),
		});
		await expect(
			provider(conflict).upsert(write, { kind: "user", userId: "u" }),
		).rejects.toMatchObject({ code: "conflict", currentRevision: 4 });

		const race = fakeStore({
			upsert: vi.fn(async () => {
				throw new WikiStoreError("23505", "duplicate key", "");
			}),
		});
		await expect(
			provider(race).upsert(write, { kind: "user", userId: "u" }),
		).rejects.toBeInstanceOf(BrainConflict);

		const missing = fakeStore({
			upsert: vi.fn(async () => {
				throw new WikiStoreError("BR404", "BRAIN_NOT_FOUND", "comercial/icp");
			}),
		});
		await expect(
			provider(missing).upsert(
				{ ...write, baseRevision: 2 },
				{ kind: "user", userId: "u" },
			),
		).rejects.toBeInstanceOf(BrainNotFound);
	});

	it("deja pasar errores desconocidos de la base", async () => {
		const store = fakeStore({
			upsert: vi.fn(async () => {
				throw new WikiStoreError("08006", "connection failure", "");
			}),
		});
		await expect(
			provider(store).upsert(write, { kind: "user", userId: "u" }),
		).rejects.toBeInstanceOf(WikiStoreError);
	});

	it("una página inexistente trae sugerencias de la búsqueda", async () => {
		const store = fakeStore({
			search: vi.fn(async () => [
				{
					slug: "comercial/criterios-calificacion",
					title: "Criterios",
					category: "comercial",
					status: "activo" as const,
					tags: [],
					snippet: "",
					updatedAt: "2026-09-13T00:00:00Z",
				},
			]),
		});
		await expect(
			provider(store).read("comercial/criterios-de-calificacion"),
		).rejects.toMatchObject({
			code: "not_found",
			suggestions: ["comercial/criterios-calificacion"],
		});
		expect(store.search).toHaveBeenCalledWith("tenant-a", {
			query: "criterios de calificacion",
			includeArchived: true,
			limit: 3,
		});
	});

	it("un slug inválido en la lectura es validación, sin ir a la base", async () => {
		const store = fakeStore();
		await expect(provider(store).read("../otro-tenant")).rejects.toBeInstanceOf(
			BrainValidation,
		);
		expect(store.read).not.toHaveBeenCalled();
	});

	it("la búsqueda acota el límite y va al tenant del binding", async () => {
		const store = fakeStore();
		await provider(store).search({ query: "icp", limit: 50 });
		expect(store.search).toHaveBeenCalledWith("tenant-a", {
			query: "icp",
			limit: 20,
		});
	});
});
