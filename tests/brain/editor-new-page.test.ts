import { describe, expect, it } from "vitest";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";

describe("resolveNewPagePrefix", () => {
	it("precarga la carpeta si es editable", () => {
		expect(resolveNewPagePrefix("comercial", ["comercial", "legal"])).toBe(
			"comercial/",
		);
	});
	it("una carpeta que no es editable arranca en la primera editable", () => {
		expect(resolveNewPagePrefix("direccion", ["comercial"])).toBe("comercial/");
	});
	it("ignora lo que no es un slug válido, sin importar si figura en la lista", () => {
		expect(resolveNewPagePrefix("../x", ["../x"])).toBe("");
		expect(resolveNewPagePrefix("A B", ["A B"])).toBe("");
	});
	it("sin parámetro arranca en la primera carpeta editable que no es la raíz ni skills", () => {
		expect(resolveNewPagePrefix(undefined, ["", "comercial", "legal"])).toBe(
			"comercial/",
		);
		expect(resolveNewPagePrefix(undefined, ["", "skills", "talento"])).toBe(
			"talento/",
		);
		expect(
			resolveNewPagePrefix(undefined, ["", "skills", "skills/x", "talento"]),
		).toBe("talento/");
		expect(resolveNewPagePrefix("", ["", "comercial"])).toBe("comercial/");
	});
	it("si solo puede escribir en la raíz o en skills, no precarga nada", () => {
		expect(resolveNewPagePrefix(undefined, [""])).toBe("");
		expect(resolveNewPagePrefix("", [""])).toBe("");
		expect(resolveNewPagePrefix(undefined, ["skills"])).toBe("");
		expect(resolveNewPagePrefix(undefined, [])).toBe("");
	});
	it("skills/ se precarga si se la pide y es editable", () => {
		expect(resolveNewPagePrefix("skills", ["", "skills", "comercial"])).toBe(
			"skills/",
		);
	});
});
