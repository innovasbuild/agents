import { describe, expect, it } from "vitest";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";

describe("resolveNewPagePrefix", () => {
	it("precarga la carpeta si es editable", () => {
		expect(resolveNewPagePrefix("comercial", ["comercial", "legal"])).toBe(
			"comercial/",
		);
	});
	it("ignora una carpeta que no es editable", () => {
		expect(resolveNewPagePrefix("direccion", ["comercial"])).toBe("");
	});
	it("ignora lo que no es un slug válido, sin importar si figura en la lista", () => {
		expect(resolveNewPagePrefix("../x", ["../x"])).toBe("");
		expect(resolveNewPagePrefix("A B", ["A B"])).toBe("");
	});
	it("sin parámetro o con la raíz, no precarga nada", () => {
		expect(resolveNewPagePrefix(undefined, ["comercial"])).toBe("");
		expect(resolveNewPagePrefix("", [""])).toBe("");
	});
});
