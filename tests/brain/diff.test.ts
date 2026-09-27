import { describe, expect, it } from "vitest";
import { diffLines, diffMeta } from "@/lib/brain/diff";

describe("diffLines", () => {
	it("textos iguales dan un solo bloque equal", () => {
		expect(diffLines("a\nb", "a\nb")).toEqual([
			{ kind: "equal", lines: ["a", "b"] },
		]);
	});

	it("detecta agregado y quitado en su lugar", () => {
		expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
			{ kind: "equal", lines: ["a"] },
			{ kind: "removed", lines: ["b"] },
			{ kind: "added", lines: ["x"] },
			{ kind: "equal", lines: ["c"] },
		]);
	});

	it("de vacío a texto es todo agregado", () => {
		expect(diffLines("", "a\nb")).toEqual([
			{ kind: "added", lines: ["a", "b"] },
		]);
	});

	it("\\r\\n y \\n se tratan igual", () => {
		expect(diffLines("a\r\nb\r\n", "a\nb\n")).toEqual([
			{ kind: "equal", lines: ["a", "b", ""] },
		]);
	});
});

describe("diffMeta", () => {
	it("lista cambios de campos y de tags", () => {
		const a = {
			title: "ICP",
			category: "comercial",
			status: "activo",
			tags: ["canon:icp", "viejo"],
		};
		const b = {
			title: "ICP 2",
			category: "comercial",
			status: "borrador",
			tags: ["canon:icp", "nuevo"],
		};
		expect(diffMeta(a, b)).toEqual({
			changes: [
				{ field: "title", from: "ICP", to: "ICP 2" },
				{ field: "status", from: "activo", to: "borrador" },
			],
			tagsAdded: ["nuevo"],
			tagsRemoved: ["viejo"],
		});
	});
});
