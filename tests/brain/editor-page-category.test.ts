import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageCategory } from "@/lib/brain/core/editor/page-category";
import { runtimePackages } from "./client-safe";

describe("pageCategory", () => {
	it("una página en una carpeta toma el primer segmento", () => {
		expect(pageCategory("comercial/icp", "x")).toBe("comercial");
		expect(pageCategory("comercial/", "")).toBe("comercial");
		expect(pageCategory("talento/personal/leo", "skill")).toBe("talento");
	});

	it("una página bajo skills/ es una skill, y solo ella", () => {
		expect(pageCategory("skills/facturacion", "")).toBe("skill");
		expect(pageCategory("skills/facturacion", "comercial")).toBe("skill");
		expect(pageCategory("comercial/nota", "skill")).toBe("comercial");
	});

	it("una reservada en una carpeta guarda la categoría de su ruta, no la anterior", () => {
		// Venir de skill y escribir una 00-reglas no la fuerza a Activo.
		expect(pageCategory("comercial/00-reglas", "skill")).toBe("comercial");
		expect(pageCategory("talento/personal/00-reglas", "skill")).toBe("talento");
		expect(pageCategory("comercial/00-plantilla", "skill")).toBe("comercial");
	});

	it("las instrucciones del brain son de la categoría brain", () => {
		expect(pageCategory("00-reglas", "comercial")).toBe("brain");
	});

	it("una página suelta de la raíz conserva la suya", () => {
		expect(pageCategory("suelta", "operacion")).toBe("operacion");
		expect(pageCategory("", "")).toBe("");
	});

	it("no arrastra node:* al cliente", () => {
		for (const entry of [
			"lib/brain/core/editor/page-category.ts",
			"lib/brain/core/editor/new-page.ts",
		])
			expect(
				runtimePackages(entry).filter((p) => p.startsWith("node:")),
			).toEqual([]);
	});
});

// Sin selector de categoría, el slug es el único campo que puede marcar un
// error de categoría o de carpeta, y la miga no queda colgando sin categoría.
describe("el espacio de trabajo sin selector de categoría", () => {
	const source = readFileSync(
		"components/brain/editor/page-workspace.tsx",
		"utf8",
	);

	it("el slug se marca inválido también por categoría o carpeta", () => {
		const slugInput = source.slice(
			source.indexOf("id={slugId}"),
			source.indexOf('placeholder="comercial/nueva-pagina"'),
		);
		for (const field of ["slug", "category", "folder"])
			expect(slugInput).toContain(`fieldError("${field}")`);
	});

	it("la miga muestra un guion si la categoría está vacía", () => {
		expect(source).toMatch(/← Brain · <span[^>]*>\{category \|\| "—"\}/);
	});
});
