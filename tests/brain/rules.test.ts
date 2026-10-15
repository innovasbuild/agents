// tests/brain/rules.test.ts
import { describe, expect, it } from "vitest";
import { BrainValidation } from "@/lib/brain/core/errors";
import {
	checkRulesWrite,
	folderOfPage,
	governingFolders,
	isReservedSlug,
	isRulesSlug,
	type RulePage,
	rulesFor,
	rulesSlugFor,
	withoutRoot,
} from "@/lib/brain/core/rules";

const rule = (
	slug: string,
	revision = 1,
	body = `reglas de ${slug}`,
	status: RulePage["status"] = "activo",
): RulePage => ({ slug, status, revision, body });

describe("reservadas", () => {
	it("00-reglas y 00-plantilla son reservadas en cualquier nivel", () => {
		expect(isReservedSlug("00-reglas")).toBe(true);
		expect(isReservedSlug("talento/personal/00-reglas")).toBe(true);
		expect(isReservedSlug("comercial/00-plantilla")).toBe(true);
		expect(isReservedSlug("talento/00-reglas-viejas")).toBe(false);
		expect(isReservedSlug("00-reglas/x")).toBe(false);
		expect(isRulesSlug("comercial/00-plantilla")).toBe(false);
	});

	it("la página de reglas de una carpeta y de la raíz", () => {
		expect(rulesSlugFor("")).toBe("00-reglas");
		expect(rulesSlugFor("talento/personal")).toBe("talento/personal/00-reglas");
		expect(folderOfPage("00-reglas")).toBe("");
		expect(folderOfPage("talento/personal/leo")).toBe("talento/personal");
	});

	it("una 00-reglas no se gobierna a sí misma", () => {
		expect(governingFolders("talento/personal/leo")).toEqual([
			"",
			"talento",
			"talento/personal",
		]);
		expect(governingFolders("talento/personal/00-reglas")).toEqual([
			"",
			"talento",
		]);
		expect(governingFolders("00-reglas")).toEqual([]);
		const pages = [rule("00-reglas"), rule("talento/personal/00-reglas")];
		expect(
			rulesFor("talento/personal/00-reglas", pages).chain.map((e) => e.path),
		).toEqual([""]);
		expect(rulesFor("00-reglas", pages)).toMatchObject({
			revision: "",
			chain: [],
		});
	});
});

describe("rulesFor", () => {
	const pages = [
		rule("00-reglas", 2, "raíz"),
		rule("talento/personal/00-reglas", 5, "personal"),
		rule("comercial/00-reglas", 1, "comercial"),
	];

	it("arma la cadena de la raíz a la carpeta y saltea los niveles sin reglas", () => {
		const cascade = rulesFor("talento/personal/leo", pages);
		expect(cascade.chain).toEqual([
			{ path: "", slug: "00-reglas", revision: 2, body: "raíz" },
			{
				path: "talento/personal",
				slug: "talento/personal/00-reglas",
				revision: 5,
				body: "personal",
			},
		]);
		expect(cascade.revision).toMatch(/^[0-9a-f]{16}$/);
		expect(cascade.fields).toEqual([]);
		expect(cascade.template).toBeNull();
	});

	it("sirve para una ruta que todavía no existe y para la raíz", () => {
		expect(
			rulesFor("talento/personal/nueva/x", pages).chain.map((e) => e.path),
		).toEqual(["", "talento/personal"]);
		expect(rulesFor("", pages).chain.map((e) => e.path)).toEqual([""]);
	});

	it("una página homónima de una carpeta la gobierna su carpeta padre", () => {
		expect(
			rulesFor("talento/personal", pages).chain.map((e) => e.path),
		).toEqual([""]);
	});

	it("archivadas y borradores no cuentan", () => {
		const cascade = rulesFor("talento/personal/leo", [
			rule("00-reglas", 2, "raíz", "archivado"),
			rule("talento/personal/00-reglas", 5, "personal", "borrador"),
		]);
		expect(cascade).toEqual({
			revision: "",
			chain: [],
			fields: [],
			template: null,
		});
	});

	it("sin reglas en la raíz la cadena es solo la de la carpeta", () => {
		const cascade = rulesFor("talento/personal/leo", [
			rule("talento/personal/00-reglas"),
		]);
		expect(cascade.chain.map((e) => e.path)).toEqual(["talento/personal"]);
		expect(cascade.revision).not.toBe("");
	});

	it("la revisión es estable, no depende del orden y cambia si cambia una revisión", () => {
		const a = rulesFor("talento/personal/leo", pages).revision;
		const b = rulesFor("talento/personal/leo", [...pages].reverse()).revision;
		expect(a).toBe(b);
		const bumped = pages.map((p) =>
			p.slug === "00-reglas" ? { ...p, revision: 3 } : p,
		);
		expect(rulesFor("talento/personal/leo", bumped).revision).not.toBe(a);
	});

	it("withoutRoot saca la raíz de la cadena y conserva la revisión completa", () => {
		const cascade = rulesFor("talento/personal/leo", pages);
		expect(withoutRoot(cascade)).toEqual({
			revision: cascade.revision,
			chain: [cascade.chain[1]],
		});
	});
});

describe("checkRulesWrite", () => {
	const write = (
		slug: string,
		length: number,
		status: RulePage["status"] = "activo",
	) => ({
		slug,
		status,
		body: "x".repeat(length),
	});

	it("las instrucciones de la raíz llegan hasta 12 000 caracteres", () => {
		expect(() => checkRulesWrite(write("00-reglas", 12_000), [])).not.toThrow();
		expect(() => checkRulesWrite(write("00-reglas", 12_001), [])).toThrow(
			/instrucciones del brain pueden tener hasta 12000/,
		);
	});

	it("las reglas de una carpeta llegan hasta 20 000 caracteres", () => {
		expect(() =>
			checkRulesWrite(write("talento/00-reglas", 20_000), []),
		).not.toThrow();
		const error = (() => {
			try {
				checkRulesWrite(write("talento/00-reglas", 20_001), []);
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(BrainValidation);
		expect((error as BrainValidation).fields).toEqual(["body"]);
		expect((error as BrainValidation).message).toContain("talento");
	});

	it("rechaza una cascada de más de 40 000 caracteres y nombra la carpeta", () => {
		const pages = [
			rule("00-reglas", 1, "x".repeat(12_000)),
			rule("talento/00-reglas", 1, "x".repeat(20_000)),
		];
		expect(() =>
			checkRulesWrite(write("talento/personal/00-reglas", 8_000), pages),
		).not.toThrow();
		expect(() =>
			checkRulesWrite(write("talento/personal/00-reglas", 8_001), pages),
		).toThrow(/talento\/personal suman 40001/);
	});

	it("también la rechaza si la que crece está arriba", () => {
		const pages = [
			rule("talento/00-reglas", 1, "x".repeat(20_000)),
			rule("talento/personal/00-reglas", 1, "x".repeat(8_001)),
		];
		expect(() => checkRulesWrite(write("00-reglas", 12_000), pages)).toThrow(
			/talento\/personal/,
		);
	});

	it("no mira páginas que no son 00-reglas, ni una archivada", () => {
		expect(() =>
			checkRulesWrite(write("talento/leo", 99_999), []),
		).not.toThrow();
		expect(() =>
			checkRulesWrite(write("talento/00-plantilla", 99_999), []),
		).not.toThrow();
		expect(() =>
			checkRulesWrite(write("00-reglas", 99_999, "archivado"), []),
		).not.toThrow();
		const archived = [
			rule("talento/00-reglas", 1, "x".repeat(39_000), "archivado"),
		];
		expect(() =>
			checkRulesWrite(write("00-reglas", 12_000), archived),
		).not.toThrow();
	});
});
