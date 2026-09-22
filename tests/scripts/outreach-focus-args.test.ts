import { describe, expect, it } from "vitest";
import { parseFocusArgs } from "@/scripts/outreach-focus-args";

describe("parseFocusArgs", () => {
	it("por default solo muestra el plan", () => {
		expect(
			parseFocusArgs([
				"--tenant",
				"innovas",
				"--owner",
				"mati",
				"--file",
				"foco.json",
			]),
		).toEqual({
			tenant: "innovas",
			owner: "mati",
			file: "foco.json",
			apply: false,
		});
	});

	it("--apply escribe", () => {
		expect(
			parseFocusArgs([
				"--tenant",
				"innovas",
				"--owner",
				"mati",
				"--file",
				"foco.json",
				"--apply",
			]),
		).toEqual({
			tenant: "innovas",
			owner: "mati",
			file: "foco.json",
			apply: true,
		});
	});

	it("exige un slug de tenant válido", () => {
		expect(() =>
			parseFocusArgs(["--owner", "mati", "--file", "foco.json"]),
		).toThrow("falta --tenant <slug>");
		expect(() =>
			parseFocusArgs([
				"--tenant",
				"../etc",
				"--owner",
				"mati",
				"--file",
				"foco.json",
			]),
		).toThrow('slug de tenant inválido: "../etc"');
	});

	it("exige --owner", () => {
		expect(() =>
			parseFocusArgs(["--tenant", "innovas", "--file", "foco.json"]),
		).toThrow("falta --owner <slug>");
	});

	it("exige --file", () => {
		expect(() =>
			parseFocusArgs(["--tenant", "innovas", "--owner", "mati"]),
		).toThrow("falta --file <ruta al JSON del foco>");
	});
});
