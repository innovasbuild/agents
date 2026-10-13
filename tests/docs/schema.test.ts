import { describe, expect, it } from "vitest";
import { extraProblems, frontmatterSchema } from "../../scripts/docs/schema.ts";

const base = {
	title: "X",
	category: "dominios",
	status: "activo",
	updated: "2026-10-13",
	sources: ["README.md"],
};

describe("frontmatterSchema", () => {
	it("acepta una página completa", () => {
		const parsed = frontmatterSchema.parse(base);
		expect(extraProblems(parsed)).toEqual([]);
	});

	it("rechaza categoría, estado o fecha inválidos", () => {
		expect(
			frontmatterSchema.safeParse({ ...base, category: "otra" }).success,
		).toBe(false);
		expect(
			frontmatterSchema.safeParse({ ...base, status: "listo" }).success,
		).toBe(false);
		expect(
			frontmatterSchema.safeParse({ ...base, updated: "13/10/2026" }).success,
		).toBe(false);
		expect(frontmatterSchema.safeParse({ ...base, title: "" }).success).toBe(
			false,
		);
	});
});

describe("extraProblems", () => {
	const parse = (extra: object) =>
		frontmatterSchema.parse({ ...base, ...extra });

	it("pide updated", () => {
		const { updated: _omit, ...rest } = base;
		expect(extraProblems(frontmatterSchema.parse(rest))).toEqual([
			"falta `updated`",
		]);
	});

	it("pide sources fuera de producto, decisiones e índice", () => {
		expect(extraProblems(parse({ sources: undefined }))[0]).toContain(
			"sources",
		);
		for (const category of ["producto", "decisiones", "indice"]) {
			expect(extraProblems(parse({ category, sources: undefined }))).toEqual(
				[],
			);
		}
	});

	it("una página generada no pide updated ni sources", () => {
		const generated = frontmatterSchema.parse({
			title: "G",
			category: "referencia",
			status: "activo",
			generated: true,
		});
		expect(extraProblems(generated)).toEqual([]);
	});
});
