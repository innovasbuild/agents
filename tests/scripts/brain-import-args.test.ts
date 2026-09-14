import { describe, expect, it } from "vitest";
import { parseImportArgs } from "@/scripts/brain-import-args";

describe("parseImportArgs", () => {
	it("por defecto es dry-run", () => {
		expect(
			parseImportArgs(["--tenant", "innovas", "--from", "/boveda"]),
		).toEqual({
			tenant: "innovas",
			from: "/boveda",
			apply: false,
			force: [],
		});
	});

	it("acepta --apply y varios --force", () => {
		expect(
			parseImportArgs([
				"--tenant",
				"innovas",
				"--from",
				"/boveda",
				"--apply",
				"--force",
				"comercial/icp",
				"--force",
				"marketing/mensajes-innovas",
			]),
		).toMatchObject({
			apply: true,
			force: ["comercial/icp", "marketing/mensajes-innovas"],
		});
	});

	it("exige tenant y carpeta", () => {
		expect(() => parseImportArgs(["--from", "/boveda"])).toThrow(/--tenant/);
		expect(() => parseImportArgs(["--tenant", "innovas"])).toThrow(/--from/);
	});

	it("rechaza --force sin slug", () => {
		expect(() =>
			parseImportArgs(["--tenant", "innovas", "--from", "/b", "--force"]),
		).toThrow(/--force/);
	});
});
