import { describe, expect, it, vi } from "vitest";
import { withCanonReflection } from "@/lib/brain/adapters/canon-reflection";
import type {
	BrainPage,
	BrainProvider,
	BrainWrite,
} from "@/lib/brain/core/types";

const write = (tags: string[]): BrainWrite => ({
	slug: "comercial/hooks",
	title: "Hooks",
	category: "comercial",
	status: "activo",
	tags,
	body: "x",
	reason: "prueba",
});
const author = { kind: "user", userId: "u1" } as const;

function provider(previousTags: string[] | null): BrainProvider {
	return {
		search: async () => [],
		read: async () => {
			if (previousTags === null) throw new Error("no existe");
			return { tags: previousTags } as BrainPage;
		},
		list: async () => [],
		history: async () => null,
		upsert: vi.fn(async () => ({ slug: "comercial/hooks", revision: 2 })),
	};
}

describe("withCanonReflection", () => {
	it("refleja después de guardar una página canon:hooks", async () => {
		const order: string[] = [];
		const base = provider(null);
		(base.upsert as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			order.push("upsert");
			return { slug: "comercial/hooks", revision: 2 };
		});
		const wrapped = withCanonReflection(base, async () => {
			order.push("reflect");
		});

		expect(await wrapped.upsert(write(["canon:hooks"]), author)).toEqual({
			slug: "comercial/hooks",
			revision: 2,
		});
		expect(order).toEqual(["upsert", "reflect"]);
	});

	it("refleja si la página tenía el tag y se lo quitaron", async () => {
		const reflect = vi.fn(async () => {});
		await withCanonReflection(provider(["canon:hooks"]), reflect).upsert(
			write(["otro"]),
			author,
		);
		expect(reflect).toHaveBeenCalledTimes(1);
	});

	it("no refleja una página que no tiene ni tenía el tag, ni una nueva", async () => {
		const reflect = vi.fn(async () => {});
		await withCanonReflection(provider(["canon:icp"]), reflect).upsert(
			write(["canon:icp"]),
			author,
		);
		await withCanonReflection(provider(null), reflect).upsert(
			write([]),
			author,
		);
		expect(reflect).not.toHaveBeenCalled();
	});

	it("un reflejo que tira no hace fallar el guardado", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const wrapped = withCanonReflection(provider(null), async () => {
			throw new Error("base caída");
		});
		expect(await wrapped.upsert(write(["canon:hooks"]), author)).toEqual({
			slug: "comercial/hooks",
			revision: 2,
		});
		log.mockRestore();
	});

	it("si el guardado falla, no refleja y propaga el error", async () => {
		const base = provider(null);
		(base.upsert as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("conflicto"),
		);
		const reflect = vi.fn(async () => {});
		await expect(
			withCanonReflection(base, reflect).upsert(write(["canon:hooks"]), author),
		).rejects.toThrow("conflicto");
		expect(reflect).not.toHaveBeenCalled();
	});
});
