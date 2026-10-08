import { describe, expect, it } from "vitest";
import {
	historyHref,
	pageHref,
	slugFromParams,
} from "@/lib/brain/core/editor/slug";

describe("slugFromParams", () => {
	it("une segmentos válidos", () => {
		expect(slugFromParams(["comercial", "icp"])).toBe("comercial/icp");
	});

	it("decodifica segmentos codificados", () => {
		expect(slugFromParams(["comercial%2Ficp"])).toBe("comercial/icp");
	});

	it("rechaza vacío, mayúsculas, puntos, segmentos vacíos y codificación rota", () => {
		for (const bad of [
			undefined,
			[],
			["Comercial"],
			[".."],
			["a", ""],
			["a b"],
			["%E0%A4%A"],
		])
			expect(slugFromParams(bad)).toBeNull();
	});

	it("rechaza slugs de más de 200 caracteres", () => {
		expect(slugFromParams(["a".repeat(201)])).toBeNull();
	});
});

describe("pageHref", () => {
	it("arma las rutas de vista e historial", () => {
		expect(pageHref("innovas", "comercial/icp")).toBe(
			"/innovas/brain/p/comercial/icp",
		);
		expect(historyHref("innovas", "comercial/icp")).toBe(
			"/innovas/brain/historial/comercial/icp",
		);
	});
});
