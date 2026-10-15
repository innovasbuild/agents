// tests/brain/rules-report.test.ts
import { describe, expect, it } from "vitest";
import { renderRulesReport, rulesReport } from "@/lib/brain/core/rules-report";

const page = (
	slug: string,
	chars = 10,
	status: "activo" | "archivado" = "activo",
) => ({
	slug,
	status,
	body: "x".repeat(chars),
});

describe("rulesReport", () => {
	it("lista las reservadas y las carpetas que van a pedir rulesRevision", () => {
		const r = rulesReport([
			page("talento/personal/00-reglas"),
			page("talento/personal/00-plantilla"),
			page("comercial/00-reglas", 10, "archivado"),
		]);
		expect(r.reserved.map((p) => p.slug)).toEqual([
			"talento/personal/00-reglas",
			"talento/personal/00-plantilla",
			"comercial/00-reglas",
		]);
		expect(r.gated).toEqual(["talento/personal"]);
	});

	it("marca las que pasan su tope y las cascadas de más de 40 000", () => {
		const r = rulesReport([
			page("00-reglas", 12_001),
			page("talento/00-reglas", 20_000),
			page("talento/personal/00-reglas", 9_000),
		]);
		expect(r.overLimit).toEqual([
			{ slug: "00-reglas", chars: 12_001, limit: 12_000 },
		]);
		expect(r.cascadeOver).toEqual([
			{ path: "talento/personal", chars: 41_001 },
		]);
	});

	it("nombra las páginas que cuelgan de una reservada", () => {
		expect(rulesReport([page("x/00-reglas/y")]).underReserved).toEqual([
			"x/00-reglas/y",
		]);
		expect(rulesReport([page("x/00-plantilla/y")]).underReserved).toEqual([
			"x/00-plantilla/y",
		]);
	});

	it("la raíz se nombra (raíz) y tiene tope propio de 12 000", () => {
		const r = rulesReport([
			page("00-reglas", 12_000),
			page("a/00-reglas", 20_000),
		]);
		expect(r.gated).toEqual(["(raíz)", "a"]);
		expect(r.overLimit).toEqual([]);
		expect(r.cascadeOver).toEqual([]);
	});

	it("tope de carpeta: 20 000 pasa, 20 001 no", () => {
		expect(rulesReport([page("a/00-reglas", 20_000)]).overLimit).toEqual([]);
		expect(rulesReport([page("a/00-reglas", 20_001)]).overLimit).toEqual([
			{ slug: "a/00-reglas", chars: 20_001, limit: 20_000 },
		]);
	});

	it("una cascada de exactamente 40 000 no se marca", () => {
		const r = rulesReport([
			page("00-reglas", 12_000),
			page("a/00-reglas", 18_000),
			page("a/b/00-reglas", 10_000),
		]);
		expect(r.cascadeOver).toEqual([]);
	});

	it("las archivadas se listan pero no gobiernan, no pasan tope ni suman a la cascada", () => {
		const r = rulesReport([
			page("00-reglas", 30_000, "archivado"),
			page("a/00-reglas", 20_000, "archivado"),
			page("a/b/00-reglas", 20_000),
		]);
		expect(r.reserved).toHaveLength(3);
		expect(r.gated).toEqual(["a/b"]);
		expect(r.overLimit).toEqual([]);
		expect(r.cascadeOver).toEqual([]);
	});

	it("una 00-plantilla no gobierna ni cuenta para topes", () => {
		const r = rulesReport([page("a/00-plantilla", 99_999)]);
		expect(r.reserved).toHaveLength(1);
		expect(r.gated).toEqual([]);
		expect(r.overLimit).toEqual([]);
		expect(r.cascadeOver).toEqual([]);
	});

	it("ignora las páginas comunes y los nombres parecidos", () => {
		const r = rulesReport([
			page("a/00-reglas-viejas"),
			page("a/mi-00-reglas"),
			page("a/normal"),
		]);
		expect(r.reserved).toEqual([]);
		expect(r.underReserved).toEqual([]);
	});

	it("una cascada pasada se marca en cada carpeta que la sufre", () => {
		const r = rulesReport([
			page("00-reglas", 12_000),
			page("a/00-reglas", 20_000),
			page("a/b/00-reglas", 9_000),
			page("a/c/00-reglas", 10),
		]);
		expect(r.cascadeOver).toEqual([{ path: "a/b", chars: 41_000 }]);
	});

	it("sin páginas no hay nada", () => {
		expect(rulesReport([])).toEqual({
			reserved: [],
			gated: [],
			overLimit: [],
			cascadeOver: [],
			underReserved: [],
		});
	});
});

describe("renderRulesReport", () => {
	it("avisa cuando hay algo para mirar antes del deploy", () => {
		const quiet = renderRulesReport([
			{ tenant: "a", pages: [page("t/00-reglas")] },
		]);
		expect(quiet.warnings).toBe(false);
		expect(quiet.text).toContain("== a ==");
		expect(quiet.text).toContain("t");
		const loud = renderRulesReport([
			{ tenant: "b", pages: [page("00-reglas", 12_001)] },
		]);
		expect(loud.warnings).toBe(true);
		expect(loud.text).toContain("ATENCIÓN");
	});

	it("avisa por cada clase: tope, cascada y colgadas", () => {
		const cascade = renderRulesReport([
			{
				tenant: "c",
				pages: [
					page("00-reglas", 12_000),
					page("a/00-reglas", 20_000),
					page("a/b/00-reglas", 9_000),
				],
			},
		]);
		expect(cascade.warnings).toBe(true);
		expect(cascade.text).toContain("a/b: 41000");
		const under = renderRulesReport([
			{ tenant: "d", pages: [page("x/00-reglas/y")] },
		]);
		expect(under.warnings).toBe(true);
		expect(under.text).toContain("x/00-reglas/y");
	});

	it("un tenant sin reservadas no avisa", () => {
		const r = renderRulesReport([{ tenant: "e", pages: [page("a/normal")] }]);
		expect(r.warnings).toBe(false);
		expect(r.text).toContain("RESULTADO: nada para revisar.");
	});
});
