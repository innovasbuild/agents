// tests/scripts/connections-bind-args.test.ts
import { describe, expect, it } from "vitest";
import { parseBindArgs } from "@/scripts/connections-bind-args";

describe("parseBindArgs", () => {
	it("acepta un binding de API key con conector", () => {
		expect(
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"leads",
				"--provider",
				"coldiq",
				"--connector",
				"innovas-coldiq",
			]),
		).toEqual({
			tenant: "innovas",
			capability: "leads",
			provider: "coldiq",
			connector: "innovas-coldiq",
			configPath: null,
		});
	});

	it("acepta un binding OAuth sin conector", () => {
		expect(
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"crm",
				"--provider",
				"hubspot",
			]),
		).toMatchObject({ provider: "hubspot", connector: null, configPath: null });
	});

	it("acepta un wiki con --config, con o sin @", () => {
		const base = [
			"--tenant",
			"innovas",
			"--capability",
			"brain",
			"--provider",
			"wiki",
		];
		expect(
			parseBindArgs([...base, "--config", "tenants/innovas/brain.json"]),
		).toEqual({
			tenant: "innovas",
			capability: "brain",
			provider: "wiki",
			connector: null,
			configPath: "tenants/innovas/brain.json",
		});
		expect(
			parseBindArgs([...base, "--config", "@tenants/innovas/brain.json"])
				.configPath,
		).toBe("tenants/innovas/brain.json");
	});

	it("exige --config para el wiki", () => {
		expect(() =>
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"brain",
				"--provider",
				"wiki",
			]),
		).toThrow(/--config/);
	});

	it("rechaza conector en un proveedor sin llave", () => {
		expect(() =>
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"brain",
				"--provider",
				"wiki",
				"--config",
				"x.json",
				"--connector",
				"algo",
			]),
		).toThrow(/sin llave/);
	});

	it("rechaza --config en proveedores que no lo usan", () => {
		expect(() =>
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"crm",
				"--provider",
				"hubspot",
				"--config",
				"x.json",
			]),
		).toThrow(/--config/);
	});

	it("rechaza un proveedor fuera del catálogo", () => {
		expect(() =>
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"crm",
				"--provider",
				"salesforce",
			]),
		).toThrow(/proveedor/);
		expect(() =>
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"brain",
				"--provider",
				"innovas-brains",
			]),
		).toThrow(/proveedor/);
	});

	it("rechaza capacidad que no corresponde al proveedor", () => {
		expect(() =>
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"leads",
				"--provider",
				"hubspot",
			]),
		).toThrow(/capacidad/);
	});

	it("exige conector para proveedores de API key", () => {
		expect(() =>
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"leads",
				"--provider",
				"coldiq",
			]),
		).toThrow(/--connector/);
	});

	it("rechaza conector en proveedores OAuth de plataforma", () => {
		expect(() =>
			parseBindArgs([
				"--tenant",
				"innovas",
				"--capability",
				"crm",
				"--provider",
				"hubspot",
				"--connector",
				"algo",
			]),
		).toThrow(/plataforma/);
	});

	it("exige tenant", () => {
		expect(() =>
			parseBindArgs(["--capability", "crm", "--provider", "hubspot"]),
		).toThrow(/--tenant/);
	});
});
