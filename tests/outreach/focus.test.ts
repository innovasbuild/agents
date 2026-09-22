import { describe, expect, it } from "vitest";
import { focusPageHash, parseTargetCriteria } from "@/lib/outreach/focus";

describe("parseTargetCriteria", () => {
	it("acepta los cuatro filtros y normaliza los vacíos", () => {
		expect(
			parseTargetCriteria({
				employeeRanges: ["50,200"],
				locations: ["Buenos Aires, Argentina"],
			}),
		).toEqual({
			employeeRanges: ["50,200"],
			locations: ["Buenos Aires, Argentina"],
			keywords: [],
			titles: [],
		});
	});

	it("rechaza un rango de empleados con formato ajeno a Apollo", () => {
		expect(() =>
			parseTargetCriteria({ employeeRanges: ["entre 50 y 200"] }),
		).toThrow();
	});

	it("rechaza un criterio vacío: buscar sin filtros trae el universo entero", () => {
		expect(() => parseTargetCriteria({})).toThrow();
	});
});

describe("focusPageHash", () => {
	it("la huella cambia con la página y es estable con la misma", () => {
		expect(focusPageHash("f1", 1)).toBe(focusPageHash("f1", 1));
		expect(focusPageHash("f1", 2)).not.toBe(focusPageHash("f1", 1));
	});
});
