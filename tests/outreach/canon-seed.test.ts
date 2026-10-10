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

	it("sin brain devuelve false", async () => {
		expect(await seedCanonPages(null, "u1")).toBe(false);
	});
});
