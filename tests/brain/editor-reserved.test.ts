// tests/brain/editor-reserved.test.ts
import { describe, expect, it } from "vitest";
import type { Level } from "@/lib/brain/core/access/types";
import {
	categoryToSave,
	entryLevel,
	isSkillsFolder,
	listedInIndex,
	newRulesHref,
	reservedBadge,
	reservedNotice,
	resolveNewRulesPage,
	rulesEntryHref,
	rulesTitle,
	typedFolder,
} from "@/lib/brain/core/editor/reserved";
import * as reservedSlugs from "@/lib/brain/core/reserved-slugs";
import * as rules from "@/lib/brain/core/rules";
import { nodeBuiltins, runtimePackages } from "./client-safe";

const every =
	(level: Level | null) =>
	(_path: string): Level | null =>
		level;

describe("reserved-slugs", () => {
	it("el tope de caracteres: 12 000 la raíz, 20 000 una carpeta, ninguno lo demás", () => {
		expect(reservedSlugs.rulesCharLimit("00-reglas")).toBe(12_000);
		expect(reservedSlugs.rulesCharLimit("talento/personal/00-reglas")).toBe(
			20_000,
		);
		expect(reservedSlugs.rulesCharLimit("comercial/00-plantilla")).toBeNull();
		expect(reservedSlugs.rulesCharLimit("comercial/icp")).toBeNull();
	});

	it("reconoce la plantilla", () => {
		expect(reservedSlugs.isTemplateSlug("comercial/00-plantilla")).toBe(true);
		expect(reservedSlugs.isTemplateSlug("comercial/00-reglas")).toBe(false);
	});

	it("rules.ts re-exporta las mismas funciones", () => {
		expect(rules.isReservedSlug).toBe(reservedSlugs.isReservedSlug);
		expect(rules.isRulesSlug).toBe(reservedSlugs.isRulesSlug);
		expect(rules.folderOfPage).toBe(reservedSlugs.folderOfPage);
		expect(rules.rulesSlugFor).toBe(reservedSlugs.rulesSlugFor);
		expect(rules.leafOf).toBe(reservedSlugs.leafOf);
		expect(rules.isTemplateSlug).toBe(reservedSlugs.isTemplateSlug);
		expect(rules.rulesCharLimit).toBe(reservedSlugs.rulesCharLimit);
	});
});

describe("lo que importa el cliente no llega a node:*", () => {
	it.each([
		"lib/brain/core/reserved-slugs.ts",
		"lib/brain/core/editor/reserved.ts",
	])("%s", (entry) => {
		expect(nodeBuiltins(entry)).toEqual([]);
	});

	it("el detector ve un builtin sin prefijo node:", () => {
		expect(runtimePackages("tests/brain/fixtures/bare-builtin.ts")).toContain(
			"crypto",
		);
		expect(nodeBuiltins("tests/brain/fixtures/bare-builtin.ts")).toEqual([
			"crypto",
		]);
	});

	it("el detector ve el node:crypto de rules.ts", () => {
		expect(runtimePackages("lib/brain/core/rules.ts")).toContain("node:crypto");
	});
});

describe("títulos y avisos", () => {
	it("nombra las instrucciones del brain y las reglas de una carpeta", () => {
		expect(rulesTitle("")).toBe("Instrucciones del brain");
		expect(rulesTitle("talento/personal")).toBe("Reglas de talento/personal");
	});

	it("avisa qué gobierna cada reservada y con qué tope", () => {
		expect(reservedNotice("00-reglas")).toMatchObject({
			title: "Instrucciones del brain",
			limit: 12_000,
		});
		expect(reservedNotice("00-reglas")?.text).toContain("todo el brain");
		const folder = reservedNotice("talento/personal/00-reglas");
		expect(folder).toMatchObject({
			title: "Reglas de talento/personal",
			limit: 20_000,
		});
		expect(folder?.text).toContain("talento/personal");
		expect(folder?.text).toContain("el asistente del chat nunca las escribe");
		expect(reservedNotice("comercial/00-plantilla")).toMatchObject({
			title: "Plantilla de comercial",
			limit: null,
		});
	});

	it("una página común no tiene aviso ni insignia", () => {
		expect(reservedNotice("comercial/icp")).toBeNull();
		expect(reservedNotice("talento/00-reglas-viejas")).toBeNull();
		expect(reservedBadge("comercial/icp")).toBeNull();
	});

	it("la insignia de la búsqueda", () => {
		expect(reservedBadge("00-reglas")).toBe("Reglas");
		expect(reservedBadge("talento/personal/00-reglas")).toBe("Reglas");
		expect(reservedBadge("comercial/00-plantilla")).toBe("Plantilla");
	});
});

describe("abrir o crear", () => {
	it("skills/ y lo que cuelga no tienen reglas propias desde la web", () => {
		expect(isSkillsFolder("skills")).toBe(true);
		expect(isSkillsFolder("skills/facturacion")).toBe(true);
		expect(isSkillsFolder("skillset")).toBe(false);
		expect(isSkillsFolder("")).toBe(false);
	});

	it("sin reglas, el link crea; con reglas en cualquier estado, abre", () => {
		expect(newRulesHref("acme", "")).toBe("/acme/brain/nueva?reglas=1");
		expect(newRulesHref("acme", "comercial")).toBe(
			"/acme/brain/nueva?reglas=1&en=comercial",
		);
		expect(rulesEntryHref("acme", { path: "comercial", rules: null })).toBe(
			"/acme/brain/nueva?reglas=1&en=comercial",
		);
		expect(
			rulesEntryHref("acme", {
				path: "comercial",
				rules: { slug: "comercial/00-reglas" },
			}),
		).toBe("/acme/brain/p/comercial/00-reglas");
	});

	it("la página nueva de reglas la arma solo quien administra la carpeta", () => {
		expect(resolveNewRulesPage(undefined, every("administrador"))).toEqual({
			slug: "00-reglas",
			title: "Instrucciones del brain",
		});
		expect(resolveNewRulesPage("", every("administrador"))).toEqual({
			slug: "00-reglas",
			title: "Instrucciones del brain",
		});
		expect(
			resolveNewRulesPage("talento/personal", every("administrador")),
		).toEqual({
			slug: "talento/personal/00-reglas",
			title: "Reglas de talento/personal",
		});
		expect(resolveNewRulesPage("comercial", every("editor"))).toBeNull();
		expect(resolveNewRulesPage("comercial", every(null))).toBeNull();
		expect(resolveNewRulesPage("../x", every("administrador"))).toBeNull();
		expect(resolveNewRulesPage("skills", every("administrador"))).toBeNull();
	});
});

describe("typedFolder", () => {
	it("devuelve la carpeta de lo que se está escribiendo", () => {
		expect(typedFolder("comercial/")).toBe("comercial");
		expect(typedFolder("comercial/sub/x")).toBe("comercial/sub");
		expect(typedFolder("suelta")).toBe("");
		expect(typedFolder("")).toBe("");
	});

	it("null mientras la carpeta no es una ruta válida", () => {
		expect(typedFolder("Comercial/x")).toBeNull();
		expect(typedFolder("comercial//x")).toBeNull();
		expect(typedFolder("-x/y")).toBeNull();
	});
});

describe("listedInIndex", () => {
	const pages = [
		{ slug: "00-reglas" },
		{ slug: "comercial/icp" },
		{ slug: "comercial/00-reglas" },
		{ slug: "comercial/00-plantilla" },
	];

	it("sin búsqueda saca las reservadas", () => {
		expect(listedInIndex(pages, false).map((p) => p.slug)).toEqual([
			"comercial/icp",
		]);
	});

	it("con búsqueda las deja", () => {
		expect(listedInIndex(pages, true)).toHaveLength(4);
	});
});

describe("entryLevel", () => {
	it("una reservada se edita solo administrando su carpeta; si no, se lee", () => {
		expect(entryLevel("comercial/00-reglas", every("editor"))).toBe("lector");
		expect(entryLevel("comercial/00-reglas", every("administrador"))).toBe(
			"administrador",
		);
		expect(entryLevel("comercial/icp", every("editor"))).toBe("editor");
		expect(entryLevel("comercial/00-reglas", every(null))).toBeNull();
	});

	it("mira la carpeta, no la página", () => {
		const levelOf = (path: string): Level | null =>
			path === "comercial/00-reglas" ? "administrador" : "editor";
		expect(entryLevel("comercial/00-reglas", levelOf)).toBe("lector");
	});
});

describe("resolveNewRulesPage con las carpetas que existen", () => {
	it("una carpeta que no existe no arma la página (fallaría al guardar)", () => {
		const folders = ["", "comercial", "talento", "talento/personal"];
		expect(
			resolveNewRulesPage("inexistente", every("administrador"), folders),
		).toBeNull();
		expect(
			resolveNewRulesPage("talento/otra", every("administrador"), folders),
		).toBeNull();
		expect(
			resolveNewRulesPage("comercial", every("administrador"), folders),
		).toEqual({ slug: "comercial/00-reglas", title: "Reglas de comercial" });
		// La raíz siempre existe.
		expect(resolveNewRulesPage(undefined, every("administrador"), [])).toEqual({
			slug: "00-reglas",
			title: "Instrucciones del brain",
		});
	});
});

describe("categoryToSave", () => {
	it("una reservada guarda la categoría de su ruta, no la elegida", () => {
		// Elegir skill y después escribir una 00-reglas no la fuerza a Activo.
		expect(categoryToSave("comercial/00-reglas", "skill")).toBe("comercial");
		expect(categoryToSave("talento/personal/00-reglas", "skill")).toBe(
			"talento",
		);
		expect(categoryToSave("comercial/00-plantilla", "skill")).toBe("comercial");
		expect(categoryToSave("00-reglas", "comercial")).toBe("brain");
	});

	it("una página común guarda la elegida", () => {
		expect(categoryToSave("comercial/nota", "skill")).toBe("skill");
		expect(categoryToSave("skills/x", "skill")).toBe("skill");
	});
});
