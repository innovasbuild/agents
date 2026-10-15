import { describe, expect, it } from "vitest";
import {
	categoryForPath,
	nearestFolder,
	parentPath,
	validateFolderPath,
} from "@/lib/brain/core/folders";

describe("categoryForPath", () => {
	it("es el primer segmento", () => {
		expect(categoryForPath("talento/personal/leo")).toBe("talento");
		expect(categoryForPath("comercial")).toBe("comercial");
	});
	it("skills es la categoría skill", () => {
		expect(categoryForPath("skills/outreach")).toBe("skill");
	});
});

describe("parentPath", () => {
	it("saca el último segmento", () => {
		expect(parentPath("a/b/c")).toBe("a/b");
		expect(parentPath("a")).toBeNull();
	});
});

describe("nearestFolder", () => {
	const folders = new Set(["comercial", "comercial/icp"]);
	it("devuelve la carpeta más profunda que existe en el camino", () => {
		expect(nearestFolder("comercial/icp/x/y", folders)).toBe("comercial/icp");
		expect(nearestFolder("comercial/sucursales", folders)).toBe("comercial");
		expect(nearestFolder("marketing/x", folders)).toBeNull();
	});
});

describe("validateFolderPath", () => {
	it("acepta rutas válidas", () => {
		expect(validateFolderPath("comercial")).toEqual({ ok: true });
		expect(validateFolderPath("comercial/sucursales-norte")).toEqual({
			ok: true,
		});
	});
	it("rechaza mayúsculas, espacios y barras de más", () => {
		for (const bad of [
			"Comercial",
			"com ercial",
			"comercial/",
			"/x",
			"a//b",
			"",
		])
			expect(validateFolderPath(bad).ok).toBe(false);
	});
	it("una de primer nivel empieza con letra", () => {
		expect(validateFolderPath("2026").ok).toBe(false);
		expect(validateFolderPath("proyectos/2026")).toEqual({ ok: true });
	});
	it("rechaza las reservadas de primer nivel", () => {
		expect(validateFolderPath("skills")).toMatchObject({ ok: false });
		expect(validateFolderPath("brain")).toMatchObject({ ok: false });
		expect(validateFolderPath("comercial/brain")).toEqual({ ok: true });
	});
	it("skill (singular) es reservada: duplicaría la categoría de skills", () => {
		expect(validateFolderPath("skill")).toMatchObject({ ok: false });
		expect(validateFolderPath("comercial/skill")).toEqual({ ok: true });
	});
	it("rechaza rutas de más de 200 caracteres", () => {
		expect(validateFolderPath(`a/${"b".repeat(199)}`).ok).toBe(false);
	});
});

describe("validateFolderPath y las páginas reservadas", () => {
	it("una carpeta no se puede llamar como una página reservada", () => {
		expect(validateFolderPath("comercial/00-reglas").ok).toBe(false);
		expect(validateFolderPath("comercial/00-plantilla").ok).toBe(false);
		expect(validateFolderPath("comercial/00-reglas-viejas")).toEqual({
			ok: true,
		});
	});
});
