import { describe, expect, it } from "vitest";
import { parseCategories } from "@/lib/brain/core/categories";

describe("parseCategories", () => {
	it("separa por coma, recorta, pasa a minúsculas y saca repetidas", () => {
		expect(parseCategories(" Empresa, trigo ,trigo,\ncomercial ")).toEqual({
			ok: true,
			categories: ["empresa", "trigo", "comercial"],
		});
	});

	it("rechaza la lista vacía", () => {
		expect(parseCategories(" , ")).toEqual({
			ok: false,
			message: "El brain necesita al menos una categoría.",
		});
	});

	it("rechaza espacios, acentos y símbolos, y dice cuál", () => {
		expect(parseCategories("empresa, compras de trigo")).toEqual({
			ok: false,
			message:
				"«compras de trigo» no es válida: usá minúsculas, números y guiones, empezando con una letra.",
		});
		expect(parseCategories("operación").ok).toBe(false);
		expect(parseCategories("2026").ok).toBe(false);
	});

	it("rechaza más de 20", () => {
		const many = Array.from({ length: 21 }, (_, i) => `c${i}`).join(",");
		expect(parseCategories(many)).toEqual({
			ok: false,
			message: "Son demasiadas categorías: el máximo es 20.",
		});
	});
});
