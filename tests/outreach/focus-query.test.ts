import { describe, expect, it } from "vitest";
import { parseFocusForm } from "@/lib/outreach/focus-query";

describe("parseFocusForm", () => {
	it("acepta un foco completo", () => {
		const parsed = parseFocusForm({
			name: "Envases GBA",
			criteria: { employeeRanges: ["50,200"], locations: ["Buenos Aires, Argentina"] },
			vector: "v1",
			segment: "s1",
			hook: "h1",
			idioma: "es_ar",
			maxAccounts: "20",
			maxContacts: "60",
		});
		expect(parsed).toMatchObject({ name: "Envases GBA", maxAccounts: 20, maxContacts: 60 });
	});

	it("rechaza topes en cero o negativos", () => {
		expect(() =>
			parseFocusForm({
				name: "x",
				criteria: { employeeRanges: ["1,10"] },
				vector: "v1",
				segment: "s1",
				hook: "h1",
				idioma: "es_ar",
				maxAccounts: "0",
				maxContacts: "10",
			}),
		).toThrow();
	});

	it("rechaza un criterio vacío (el mismo chequeo de targetCriteriaSchema)", () => {
		expect(() =>
			parseFocusForm({
				name: "x",
				criteria: {},
				vector: "v1",
				segment: "s1",
				hook: "h1",
				idioma: "es_ar",
				maxAccounts: "10",
				maxContacts: "10",
			}),
		).toThrow();
	});
});
