import { describe, expect, it, vi } from "vitest";
import { BrainConflict } from "@/lib/brain/core/errors";
import type { BrainProvider } from "@/lib/brain/core/types";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { seedCanonPages } = await import("@/lib/outreach/canon-seed");

function brain(upsert: BrainProvider["upsert"]): BrainProvider {
	return {
		search: async () => [],
		read: async () => {
			throw new Error("no existe");
		},
		list: async () => [],
		history: async () => null,
		upsert,
	};
}

describe("seedCanonPages", () => {
	it("crea las dos páginas en borrador, sin baseRevision, como import", async () => {
		const upsert = vi.fn(async (write: { slug: string }) => ({
			slug: write.slug,
			revision: 1,
		}));
		expect(await seedCanonPages(brain(upsert as never), "u1")).toBe(true);

		expect(upsert).toHaveBeenCalledTimes(2);
		const [write, author] = upsert.mock.calls[0] as unknown as [
			Record<string, unknown>,
			Record<string, unknown>,
		];
		expect(write).toMatchObject({
			slug: "comercial/icp",
			status: "borrador",
			tags: ["canon:icp"],
		});
		expect(write.baseRevision).toBeUndefined();
		expect(author).toMatchObject({
			kind: "import",
			userId: "u1",
			sourcePath: "plantilla:comercial/icp",
		});
		expect(author.sourceHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("una página que ya existe no se pisa y no es un fallo", async () => {
		const upsert = vi.fn(async () => {
			throw new BrainConflict("comercial/icp", 4);
		});
		expect(await seedCanonPages(brain(upsert as never), "u1")).toBe(true);
		expect(upsert).toHaveBeenCalledTimes(2);
	});

	it("otro error devuelve false, sin tirar, y sigue con la otra página", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const upsert = vi.fn(async () => {
			throw new Error("timeout");
		});
		expect(await seedCanonPages(brain(upsert as never), "u1")).toBe(false);
		expect(upsert).toHaveBeenCalledTimes(2);
		log.mockRestore();
	});

	const hit = (tag: string) => ({
		slug: `comercial/otra-${tag}`,
		title: "Otra",
		category: "comercial",
		status: "activo",
		tags: [tag],
		updatedAt: "2026-01-01",
		snippet: "",
	});
	const brainWithTags = (upsert: unknown, present: string[]) => {
		const search = vi.fn(async (input: { tag?: string }) =>
			input.tag && present.includes(input.tag) ? [hit(input.tag)] : [],
		);
		return { ...brain(upsert as never), search: search as never };
	};
	const slugs = (upsert: ReturnType<typeof vi.fn>) =>
		upsert.mock.calls.map((call) => (call[0] as { slug: string }).slug);

	it("con solo canon:icp en el brain, siembra únicamente la plantilla de hooks", async () => {
		const upsert = vi.fn(async (write: { slug: string }) => ({
			slug: write.slug,
			revision: 1,
		}));
		expect(
			await seedCanonPages(brainWithTags(upsert, ["canon:icp"]), "u1"),
		).toBe(true);
		expect(slugs(upsert)).toEqual(["comercial/hooks"]);
	});

	it("con los tags de todas las plantillas en el brain, no siembra nada", async () => {
		const upsert = vi.fn();
		expect(
			await seedCanonPages(
				brainWithTags(upsert, ["canon:icp", "canon:hooks"]),
				"u1",
			),
		).toBe(true);
		expect(upsert).not.toHaveBeenCalled();
	});

	it("sin ningún tag de canon en el brain, siembra todas", async () => {
		const upsert = vi.fn(async (write: { slug: string }) => ({
			slug: write.slug,
			revision: 1,
		}));
		expect(await seedCanonPages(brainWithTags(upsert, []), "u1")).toBe(true);
		expect(slugs(upsert)).toEqual(["comercial/icp", "comercial/hooks"]);
	});

	it("si no puede mirar el tag de una plantilla, no siembra esa, sigue con las otras y devuelve false", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const upsert = vi.fn(async (write: { slug: string }) => ({
			slug: write.slug,
			revision: 1,
		}));
		const b = {
			...brain(upsert as never),
			search: (async (input: { tag?: string }) => {
				if (input.tag === "canon:icp") throw new Error("brain caído");
				return [];
			}) as never,
		};
		expect(await seedCanonPages(b, "u1")).toBe(false);
		expect(slugs(upsert)).toEqual(["comercial/hooks"]);
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});

	it("si no puede mirar el canon existente, no siembra y devuelve false sin tirar", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const upsert = vi.fn();
		const b = {
			...brain(upsert as never),
			search: async () => {
				throw new Error("brain caído");
			},
		};
		expect(await seedCanonPages(b, "u1")).toBe(false);
		expect(upsert).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});

	it("si la categoría comercial no está en el brain, falla suave y loguea", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const upsert = vi.fn(async () => {
			throw new Error('category: "comercial" no está entre las categorías');
		});
		expect(await seedCanonPages(brain(upsert as never), "u1")).toBe(false);
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});

	it("sin brain devuelve false", async () => {
		expect(await seedCanonPages(null, "u1")).toBe(false);
	});
});
