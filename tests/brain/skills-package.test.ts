import { describe, expect, it } from "vitest";
import { parseWikiConfig } from "@/lib/brain/core/config";
import { BrainValidation } from "@/lib/brain/core/errors";
import {
	assistantCategories,
	checkPublishable,
	isSkillSlug,
	isValidFilePath,
	isValidSkillFolder,
	isValidSkillName,
	MAX_FILE_BYTES,
	MAX_ZIP_BYTES,
	normalizeSkillFolder,
	skillName,
	skillPlacementOk,
} from "@/lib/brain/core/skills/package";
import type { BrainWrite } from "@/lib/brain/core/types";
import { validateWrite } from "@/lib/brain/core/wiki";

const config = parseWikiConfig({ categories: ["comercial", "skill"] });
const write = (over: Partial<BrainWrite>): BrainWrite => ({
	slug: "skills/facturacion",
	title: "Facturación",
	category: "skill",
	status: "activo",
	tags: [],
	body: "cuerpo",
	reason: "alta",
	...over,
});

describe("rutas de archivo", () => {
	it.each([
		"scripts/calc.py",
		"assets/logo.png",
		"README.md",
		"a/b/c/d/e/f.txt",
		"references/guia_v2.final.md",
	])("acepta %s", (path) => {
		expect(isValidFilePath(path)).toBe(true);
	});

	it.each([
		"../afuera.txt",
		"scripts/../../x",
		"/abs.txt",
		"scripts/.oculto",
		".env",
		"SKILL.md",
		"skill.md",
		"a/b/c/d/e/f/g.txt",
		"con espacio.txt",
		"scripts/",
		"",
		`${"a".repeat(201)}`,
	])("rechaza %s", (path) => {
		expect(isValidFilePath(path)).toBe(false);
	});
});

describe("categoría y ruta van juntas", () => {
	it("una skill está bajo skills/ y tiene categoría skill", () => {
		expect(isSkillSlug("skills/admin/facturacion")).toBe(true);
		expect(isSkillSlug("skills")).toBe(false);
		expect(isSkillSlug("comercial/skills/x")).toBe(false);
		expect(skillName("skills/admin/facturacion")).toBe("facturacion");
		expect(skillPlacementOk("skills/x", "skill")).toBe(true);
		expect(skillPlacementOk("skills/x", "comercial")).toBe(false);
		expect(skillPlacementOk("comercial/x", "skill")).toBe(false);
		expect(skillPlacementOk("comercial/x", "comercial")).toBe(true);
	});

	it("validateWrite rechaza una skill fuera de skills/ y al revés", () => {
		expect(() => validateWrite(write({}), config, "2026-10-11")).not.toThrow();
		for (const bad of [
			write({ slug: "comercial/facturacion" }),
			write({ category: "comercial" }),
		]) {
			try {
				validateWrite(bad, config, "2026-10-11");
				throw new Error("tenía que fallar");
			} catch (error) {
				expect(error).toBeInstanceOf(BrainValidation);
				expect((error as BrainValidation).fields).toContain("category");
			}
		}
	});
});

describe("categorías que ve un asistente", () => {
	it("saca skill y deja el resto", () => {
		expect(assistantCategories(["comercial", "skill"])).toEqual(["comercial"]);
	});
	it("si skill es la única, no devuelve una lista vacía", () => {
		expect(assistantCategories(["skill"])).toEqual(["skill"]);
	});
});

describe("checkPublishable", () => {
	const base = {
		slug: "skills/facturacion",
		frontmatter: { description: "Usar para facturar." },
		body: "cuerpo",
		files: [],
	};

	it("un paquete correcto no tiene problemas", () => {
		expect(checkPublishable(base)).toEqual({ problems: [], warnings: [] });
	});

	it("exige descripción y respeta sus topes", () => {
		expect(checkPublishable({ ...base, frontmatter: {} }).problems).toEqual([
			"description_missing",
		]);
		expect(
			checkPublishable({ ...base, frontmatter: { description: "   " } })
				.problems,
		).toEqual(["description_missing"]);
		expect(
			checkPublishable({
				...base,
				frontmatter: { description: "x".repeat(1025) },
			}).problems,
		).toEqual(["description_too_long"]);
		expect(
			checkPublishable({
				...base,
				frontmatter: { description: "ok", compatibility: "x".repeat(501) },
			}).problems,
		).toEqual(["compatibility_too_long"]);
	});

	it("nombre largo, demasiados archivos y paquete pesado", () => {
		expect(
			checkPublishable({ ...base, slug: `skills/${"a".repeat(65)}` }).problems,
		).toEqual(["name_too_long"]);
		const many = Array.from({ length: 51 }, (_, i) => ({
			path: `f${i}.txt`,
			sha256: "a".repeat(64),
			size: 1,
		}));
		expect(checkPublishable({ ...base, files: many }).problems).toEqual([
			"too_many_files",
		]);
		const heavy = Array.from({ length: 6 }, (_, i) => ({
			path: `f${i}.bin`,
			sha256: "a".repeat(64),
			size: MAX_FILE_BYTES,
		}));
		expect(checkPublishable({ ...base, files: heavy }).problems).toEqual([
			"package_too_big",
		]);
	});

	it("un cuerpo de más de 500 líneas avisa y no frena", () => {
		const result = checkPublishable({
			...base,
			body: Array.from({ length: 501 }, () => "x").join("\n"),
		});
		expect(result.problems).toEqual([]);
		expect(result.warnings).toEqual(["long_body"]);
	});
});

describe("nombre y carpeta de una skill", () => {
	it.each(["facturacion", "a-1", "x".repeat(64)])(
		"acepta el nombre %s",
		(name) => {
			expect(isValidSkillName(name)).toBe(true);
		},
	);

	it.each(["", "Ventas", "a b", "a/b", "..", "-a", "a--b", "x".repeat(65)])(
		"rechaza el nombre %j",
		(name) => {
			expect(isValidSkillName(name)).toBe(false);
		},
	);

	it("normaliza la carpeta: recorta espacios y barras y descarta skills/", () => {
		expect(normalizeSkillFolder("/skills/ventas/")).toBe("ventas");
		expect(normalizeSkillFolder("  ventas/q1  ")).toBe("ventas/q1");
		expect(normalizeSkillFolder("skills")).toBe("");
		expect(normalizeSkillFolder(undefined)).toBe("");
	});

	it("valida la carpeta: vacía o tramos de nombre válido", () => {
		expect(isValidSkillFolder("")).toBe(true);
		expect(isValidSkillFolder("ventas/q1")).toBe(true);
		expect(isValidSkillFolder("Ventas")).toBe(false);
		expect(isValidSkillFolder("ventas//q1")).toBe(false);
	});

	it("el tope del zip es el del archivo: 4 MB", () => {
		expect(MAX_ZIP_BYTES).toBe(4_194_304);
		expect(MAX_ZIP_BYTES).toBe(MAX_FILE_BYTES);
	});
});
