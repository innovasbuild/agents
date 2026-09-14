import { describe, expect, it } from "vitest";
import {
	buildDraft,
	buildSlugIndex,
	parseDocument,
	rewriteWikilinks,
	slugFromPath,
} from "@/lib/brain/import/document";

describe("slugFromPath", () => {
	it("usa la ruta sin extensión, en minúsculas y sin acentos", () => {
		expect(slugFromPath("comercial/outreach/00-constitucion.md")).toBe(
			"comercial/outreach/00-constitucion",
		);
		expect(slugFromPath("marketing/LinkedIn institucional — INNOV.AS.md")).toBe(
			"marketing/linkedin-institucional-innov-as",
		);
		expect(slugFromPath("producto/Línea Educación IA.md")).toBe(
			"producto/linea-educacion-ia",
		);
	});

	it("rechaza segmentos que quedan vacíos", () => {
		expect(() => slugFromPath("marketing/—.md")).toThrow(/slug/);
	});
});

describe("parseDocument", () => {
	it("separa frontmatter y cuerpo", () => {
		expect(
			parseDocument("---\ntitle: ICP\ntags: [a, b]\n---\n# ICP\n"),
		).toEqual({
			data: { title: "ICP", tags: ["a", "b"] },
			body: "# ICP\n",
		});
	});

	it("sin frontmatter devuelve el cuerpo entero", () => {
		expect(parseDocument("# Hola\n")).toEqual({ data: {}, body: "# Hola\n" });
	});

	it("un frontmatter que no es objeto es error", () => {
		expect(() => parseDocument("---\n- a\n- b\n---\ncuerpo")).toThrow(
			/frontmatter/,
		);
	});
});

describe("buildDraft", () => {
	it("toma título del frontmatter, suma tags del manifiesto y deja el resto en frontmatter", () => {
		const draft = buildDraft(
			{
				path: "marketing/mensajes-innovas.md",
				raw: "---\ntitle: Mensajes\ncategory: marketing\ntags: [posicionamiento]\nstatus: borrador\nupdated: 2026-08-27\n---\nCuerpo",
			},
			["canon:mensajes", "posicionamiento"],
		);
		expect(draft).toMatchObject({
			slug: "marketing/mensajes-innovas",
			sourcePath: "marketing/mensajes-innovas.md",
			title: "Mensajes",
			category: "marketing",
			status: "borrador",
			tags: ["posicionamiento", "canon:mensajes"],
			frontmatter: { updated: "2026-08-27" },
			body: "Cuerpo",
		});
		expect(draft.sourceHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("sin frontmatter usa el primer título, la carpeta y activo", () => {
		expect(
			buildDraft(
				{
					path: "producto/linea-proyectos.md",
					raw: "# Línea de proyectos\n\nTexto",
				},
				[],
			),
		).toMatchObject({
			title: "Línea de proyectos",
			category: "producto",
			status: "activo",
			tags: [],
		});
	});

	it("acepta tags separados por coma", () => {
		expect(
			buildDraft({ path: "marketing/x.md", raw: "---\ntags: a, b\n---\nx" }, [])
				.tags,
		).toEqual(["a", "b"]);
	});

	it("rechaza una categoría que no coincide con la carpeta", () => {
		expect(() =>
			buildDraft(
				{ path: "proyectos/x.md", raw: "---\ncategory: marketing\n---\nx" },
				[],
			),
		).toThrow(/carpeta/);
	});

	it("rechaza un estado desconocido", () => {
		expect(() =>
			buildDraft(
				{ path: "company/x.md", raw: "---\nstatus: vigente\n---\nx" },
				[],
			),
		).toThrow(/estado/);
	});
});

describe("rewriteWikilinks", () => {
	const resolve = buildSlugIndex([
		"company/innov-overview",
		"producto/linea-proyectos",
		"comercial/icp",
		"marketing/icp",
	]);

	it("resuelve por nombre suelto y deja el texto visible", () => {
		expect(rewriteWikilinks("Ver [[innov-overview]].", resolve)).toEqual({
			body: "Ver [[company/innov-overview|innov-overview]].",
			unresolved: [],
		});
	});

	it("respeta ruta completa, alias y ancla", () => {
		expect(
			rewriteWikilinks(
				"[[company/innov-overview|overview]] y [[linea-proyectos#ICP|icp]]",
				resolve,
			).body,
		).toBe(
			"[[company/innov-overview|overview]] y [[producto/linea-proyectos#ICP|icp]]",
		);
	});

	it("deja como están los que no resuelven o son ambiguos y los informa", () => {
		expect(rewriteWikilinks("[[AGENT|AGENT]] y [[icp]]", resolve)).toEqual({
			body: "[[AGENT|AGENT]] y [[icp]]",
			unresolved: ["AGENT", "icp"],
		});
	});
});
