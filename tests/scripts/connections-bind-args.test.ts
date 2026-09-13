import { describe, expect, it } from "vitest";
import { parseBindArgs } from "@/scripts/connections-bind-args";

describe("parseBindArgs", () => {
	it("acepta un binding de API key con conector y URL", () => {
		expect(
			parseBindArgs([
				"--tenant", "innovas",
				"--capability", "brain",
				"--provider", "innovas-brains",
				"--connector", "innovas-brain",
				"--url", "https://brain.test/mcp",
			]),
		).toEqual({
			tenant: "innovas",
			capability: "brain",
			provider: "innovas-brains",
			connector: "innovas-brain",
			url: "https://brain.test/mcp",
		});
	});

	it("acepta un binding OAuth sin conector", () => {
		expect(
			parseBindArgs(["--tenant", "innovas", "--capability", "crm", "--provider", "hubspot"]),
		).toMatchObject({ provider: "hubspot", connector: null });
	});

	it("rechaza un proveedor fuera del catálogo", () => {
		expect(() =>
			parseBindArgs(["--tenant", "innovas", "--capability", "crm", "--provider", "salesforce"]),
		).toThrow(/proveedor/);
	});

	it("rechaza capacidad que no corresponde al proveedor", () => {
		expect(() =>
			parseBindArgs(["--tenant", "innovas", "--capability", "leads", "--provider", "hubspot"]),
		).toThrow(/capacidad/);
	});

	it("exige conector para proveedores de API key", () => {
		expect(() =>
			parseBindArgs(["--tenant", "innovas", "--capability", "leads", "--provider", "coldiq"]),
		).toThrow(/--connector/);
	});

	it("rechaza conector en proveedores OAuth de plataforma", () => {
		expect(() =>
			parseBindArgs([
				"--tenant", "innovas", "--capability", "crm", "--provider", "hubspot",
				"--connector", "algo",
			]),
		).toThrow(/plataforma/);
	});

	it("exige URL https para el brain", () => {
		expect(() =>
			parseBindArgs([
				"--tenant", "innovas", "--capability", "brain", "--provider", "innovas-brains",
				"--connector", "innovas-brain",
			]),
		).toThrow(/--url/);
		expect(() =>
			parseBindArgs([
				"--tenant", "innovas", "--capability", "brain", "--provider", "innovas-brains",
				"--connector", "innovas-brain", "--url", "http://brain.test",
			]),
		).toThrow(/https/);
	});

	it("exige tenant", () => {
		expect(() => parseBindArgs(["--capability", "crm", "--provider", "hubspot"])).toThrow(/--tenant/);
	});
});
