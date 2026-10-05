import { describe, expect, it } from "vitest";
import { parseWikilinks } from "@/lib/brain/core/wikilinks";

describe("parseWikilinks", () => {
	it("lee slug solo, con alias y con ancla", () => {
		const body =
			"Ver [[comercial/icp]], [[marketing/voz|la voz]] y [[producto/radar#precio|precio del Radar]].";
		expect(
			parseWikilinks(body).map(({ target, anchor, alias }) => ({
				target,
				anchor,
				alias,
			})),
		).toEqual([
			{ target: "comercial/icp", anchor: null, alias: null },
			{ target: "marketing/voz", anchor: null, alias: "la voz" },
			{ target: "producto/radar", anchor: "precio", alias: "precio del Radar" },
		]);
	});

	it("devuelve posiciones que recortan el wikilink exacto", () => {
		const body = "a [[x|y]] b";
		const [link] = parseWikilinks(body);
		expect(body.slice(link.start, link.end)).toBe("[[x|y]]");
	});

	it("recorta espacios del target y del alias", () => {
		expect(parseWikilinks("[[ x | y ]]")[0]).toMatchObject({
			target: "x",
			alias: "y",
		});
	});

	it("sin wikilinks devuelve lista vacía y se puede llamar dos veces seguidas", () => {
		expect(parseWikilinks("texto [simple](http://a.b)")).toEqual([]);
		expect(parseWikilinks("[[a]]")).toHaveLength(1);
		expect(parseWikilinks("[[a]]")).toHaveLength(1);
	});
});
