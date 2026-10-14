import { describe, expect, it } from "vitest";
import {
	fetchAllRows,
	folderReport,
	renderFolderReport,
} from "@/lib/brain/core/folders-report";

describe("folderReport", () => {
	it("lista carpetas, categorías que no coinciden y páginas sueltas", () => {
		const report = folderReport(
			["empresa", "talento", "skill"],
			[
				{ slug: "talento/personal/leo", category: "talento" },
				{ slug: "talento/x", category: "empresa" },
				{ slug: "skills/outreach", category: "skill" },
				{ slug: "suelta", category: "empresa" },
			],
		);
		expect(report.folders).toEqual([
			"empresa",
			"skills",
			"talento",
			"talento/personal",
		]);
		expect(report.mismatched).toEqual([
			{ slug: "talento/x", category: "empresa", expected: "talento" },
		]);
		expect(report.loose).toEqual(["suelta"]);
	});

	it("(a) marca como bloqueantes las rutas cuyo primer tramo no es una categoría válida", () => {
		const longTop = `a${"b".repeat(41)}`;
		const report = folderReport(
			["empresa"],
			[
				{ slug: "2024/informe", category: "2024" },
				{ slug: `${longTop}/x`, category: longTop },
				{ slug: "empresa/ok", category: "empresa" },
				{ slug: "9suelta", category: "empresa" },
			],
		);
		expect(report.blockers).toEqual(["2024/informe", `${longTop}/x`]);
	});

	it("(b) avisa de las categorías que la migración agregaría", () => {
		const report = folderReport(
			["empresa"],
			[
				{ slug: "empresa/a", category: "empresa" },
				{ slug: "ventas/b", category: "ventas" },
				{ slug: "ventas/c/d", category: "ventas" },
				{ slug: "2024/x", category: "2024" },
			],
		);
		expect(report.newCategories).toEqual(["ventas"]);
	});

	it("(c) lista lo que cuelga de brain/", () => {
		const report = folderReport(
			["empresa"],
			[
				{ slug: "brain/reglas", category: "brain" },
				{ slug: "empresa/a", category: "empresa" },
			],
		);
		expect(report.underBrain).toEqual(["brain/reglas"]);
		expect(report.newCategories).toEqual([]);
	});

	it("(d) lista lo que cuelga de skills/ si el tenant no tiene la categoría skill", () => {
		const pages = [{ slug: "skills/outreach", category: "skill" }];
		expect(folderReport(["empresa"], pages).skillsWithoutCategory).toEqual([
			"skills/outreach",
		]);
		expect(
			folderReport(["empresa", "skill"], pages).skillsWithoutCategory,
		).toEqual([]);
		expect(folderReport(["empresa"], pages).newCategories).toEqual([]);
	});
});

describe("primer tramo skill (singular)", () => {
	it("es bloqueante: la carpeta duplicaría la categoría skill", () => {
		const report = folderReport(
			["empresa", "skill"],
			[
				{ slug: "skill/outreach", category: "skill" },
				{ slug: "skills/outreach", category: "skill" },
			],
		);
		expect(report.blockers).toEqual(["skill/outreach"]);
		expect(report.folders).toEqual(["empresa", "skills"]);
	});
});

describe("renderFolderReport", () => {
	it("imprime el estado de cada empresa y avisa si hay bloqueantes", () => {
		const text = renderFolderReport([
			{
				tenant: "okeefe",
				categories: ["empresa"],
				pages: [{ slug: "2024/informe", category: "2024" }],
			},
			{
				tenant: "innovas",
				categories: ["empresa"],
				pages: [{ slug: "empresa/a", category: "empresa" }],
			},
		]);
		expect(text.blocked).toBe(true);
		expect(text.text).toContain("okeefe");
		expect(text.text).toContain("2024/informe");
		expect(text.text).toContain("BLOQUEA");
		expect(text.text).toContain("innovas");
	});

	it("sin bloqueantes no frena la migración", () => {
		const text = renderFolderReport([
			{ tenant: "innovas", categories: ["empresa"], pages: [] },
		]);
		expect(text.blocked).toBe(false);
	});
});

describe("config.categories inválidas", () => {
	it("son bloqueantes, con el prefijo config:", () => {
		const report = folderReport(["empresa", "skill", "2024", "Ventas"], []);
		expect(report.blockers).toEqual(["config:2024", "config:Ventas"]);
	});
});

describe("fetchAllRows", () => {
	const make = (n: number) => async (from: number, to: number) =>
		Array.from({ length: n }, (_, i) => i).slice(from, to + 1);

	it("junta 2500 filas en tres páginas", async () => {
		const rows = await fetchAllRows(make(2500));
		expect(rows).toHaveLength(2500);
	});

	it("en el borde exacto de 1000 pide una página más y termina", async () => {
		const calls: number[] = [];
		const load = make(1000);
		const rows = await fetchAllRows(async (from, to) => {
			calls.push(from);
			return load(from, to);
		});
		expect(rows).toHaveLength(1000);
		expect(calls).toEqual([0, 1000]);
	});
});
