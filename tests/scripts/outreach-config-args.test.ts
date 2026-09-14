import { describe, expect, it } from "vitest";
import { parseOutreachConfigArgs } from "@/scripts/outreach-config-args";

describe("parseOutreachConfigArgs", () => {
	it("por default solo muestra el plan", () => {
		expect(parseOutreachConfigArgs(["--tenant", "innovas"])).toEqual({
			tenant: "innovas",
			apply: false,
		});
	});
	it("--apply escribe", () => {
		expect(parseOutreachConfigArgs(["--tenant", "innovas", "--apply"])).toEqual(
			{ tenant: "innovas", apply: true },
		);
	});
	it("exige un slug válido", () => {
		expect(() => parseOutreachConfigArgs([])).toThrow("falta --tenant <slug>");
		expect(() => parseOutreachConfigArgs(["--tenant", "../etc"])).toThrow(
			'slug de tenant inválido: "../etc"',
		);
	});
});
