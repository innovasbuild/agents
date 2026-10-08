import { describe, expect, it } from "vitest";
import { removeWikilinks } from "@/lib/brain/core/wikilinks";

const T = "comercial/icp";
const remove = (body: string) => removeWikilinks(body, T, "ICP");

describe("removeWikilinks", () => {
	it("deja el alias cuando lo hay", () => {
		expect(remove("Ver [[comercial/icp|el perfil]] hoy.")).toBe(
			"Ver el perfil hoy.",
		);
	});

	it("sin alias deja el título de la página borrada", () => {
		expect(remove("Ver [[comercial/icp]].")).toBe("Ver ICP.");
	});

	it("con ancla y sin alias deja el título; con ancla y alias deja el alias", () => {
		expect(remove("[[comercial/icp#objeciones]]")).toBe("ICP");
		expect(remove("[[comercial/icp#objeciones|ver objeciones]]")).toBe(
			"ver objeciones",
		);
	});

	it("reemplaza todos los links al destino en el mismo texto", () => {
		expect(remove("[[comercial/icp]] y [[comercial/icp|otra vez]]")).toBe(
			"ICP y otra vez",
		);
	});

	it("no toca los links a otros destinos, ni a destinos que empiezan igual", () => {
		const body =
			"[[otra]] y [[comercial/icp-viejo]] y [[comercial/icp/objeciones]]";
		expect(remove(body)).toBe(body);
	});

	it("no toca los wikilinks dentro de código en línea ni de bloques de código", () => {
		const body =
			"Mirá `[[comercial/icp]]` y\n```\n[[comercial/icp|x]]\n```\ny [[comercial/icp]]";
		expect(remove(body)).toBe(
			"Mirá `[[comercial/icp]]` y\n```\n[[comercial/icp|x]]\n```\ny ICP",
		);
	});

	it("un bloque de código sin cerrar protege el resto del texto, como en la vista de lectura", () => {
		const body = "[[comercial/icp]]\n```\n[[comercial/icp]]";
		expect(remove(body)).toBe("ICP\n```\n[[comercial/icp]]");
	});

	it("devuelve el cuerpo idéntico si no había links al destino", () => {
		const body = "Texto con [[otra|link]] y  espacios\n\ny saltos.\n";
		expect(remove(body)).toBe(body);
	});

	it("un título con corchetes o barras no rompe el reemplazo", () => {
		expect(removeWikilinks("[[comercial/icp]]", T, "A [b] | c")).toBe(
			"A [b] | c",
		);
	});
});
