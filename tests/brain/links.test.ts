import { describe, expect, it } from "vitest";
import {
	buildLinkIndex,
	buildLinkIndexFromLinks,
	type LinkPage,
} from "@/lib/brain/core/links";
import { parseWikilinks } from "@/lib/brain/core/wikilinks";

const page = (
	slug: string,
	body: string,
	status: LinkPage["status"] = "activo",
): LinkPage => ({
	slug,
	title: slug,
	category: slug.split("/")[0],
	status,
	body,
});

describe("buildLinkIndex", () => {
	it("arma salientes en orden y entrantes ordenados", () => {
		const index = buildLinkIndex([
			page("a/uno", "[[b/dos]] y [[c/tres|tres]]"),
			page("b/dos", "[[c/tres]]"),
			page("c/tres", ""),
		]);
		expect(index.outgoing.get("a/uno")?.map((l) => l.target)).toEqual([
			"b/dos",
			"c/tres",
		]);
		expect(index.incoming.get("c/tres")).toEqual(["a/uno", "b/dos"]);
		expect(index.incoming.get("a/uno")).toEqual([]);
	});

	it("marca rotos y los junta con su origen", () => {
		const index = buildLinkIndex([page("a/uno", "[[no/existe]]")]);
		expect(index.outgoing.get("a/uno")?.[0]).toMatchObject({
			target: "no/existe",
			broken: true,
		});
		expect(index.broken).toEqual([{ source: "a/uno", target: "no/existe" }]);
	});

	it("un autolink no cuenta como entrante ni saca de huérfana", () => {
		const index = buildLinkIndex([page("a/uno", "[[a/uno]]")]);
		expect(index.incoming.get("a/uno")).toEqual([]);
		expect(index.orphans).toEqual(["a/uno"]);
	});

	it("un target repetido cuenta una vez", () => {
		const index = buildLinkIndex([
			page("a/uno", "[[b/dos]] [[b/dos|otra vez]]"),
			page("b/dos", ""),
		]);
		expect(index.outgoing.get("a/uno")).toHaveLength(1);
		expect(index.incoming.get("b/dos")).toEqual(["a/uno"]);
	});

	it("link a archivada no es roto; link desde archivada no cuenta; archivadas no son huérfanas", () => {
		const index = buildLinkIndex([
			page("a/uno", "[[b/vieja]]"),
			page("b/vieja", "[[c/sola]]", "archivado"),
			page("c/sola", ""),
		]);
		expect(index.outgoing.get("a/uno")?.[0]).toMatchObject({
			broken: false,
			archived: true,
		});
		expect(index.incoming.get("c/sola")).toEqual([]);
		expect(index.orphans).toEqual(["a/uno", "c/sola"]);
		expect(index.broken).toEqual([]);
	});
});

describe("buildLinkIndexFromLinks", () => {
	it("da lo mismo que buildLinkIndex con los links ya extraídos", () => {
		const pages = [
			page("a/uno", "[[b/dos]] y [[b/dos#x|otra vez]] y [[c/rota]]"),
			page("b/dos", "[[a/uno|vuelve]] [[c/tres]]"),
			page("c/tres", "sin links"),
			page("d/vieja", "[[c/tres]]", "archivado"),
			page("e/sola", ""),
		];
		const extracted = pages
			.map((p) => ({ slug: p.slug, links: parseWikilinks(p.body) }))
			.filter((p) => p.links.length > 0);
		// Sin cuerpo: solo slug y estado, y sin las páginas que no tienen links.
		expect(
			buildLinkIndexFromLinks(
				pages.map(({ slug, status }) => ({ slug, status })),
				extracted,
			),
		).toEqual(buildLinkIndex(pages));
	});
});
