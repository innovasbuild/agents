import { describe, expect, it } from "vitest";
import { parseExecutorsSetArgs } from "@/scripts/executors-set-args";

describe("parseExecutorsSetArgs", () => {
	it("lee tenant, email, slug y owner del CRM", () => {
		expect(
			parseExecutorsSetArgs([
				"--tenant",
				"innovas",
				"--email",
				"Ana@Acme.test",
				"--slug",
				"ana",
				"--crm-owner-id",
				"123",
			]),
		).toEqual({
			tenant: "innovas",
			email: "ana@acme.test",
			slug: "ana",
			crmOwnerId: "123",
		});
	});
	it("el owner del CRM es opcional", () => {
		expect(
			parseExecutorsSetArgs([
				"--tenant",
				"innovas",
				"--email",
				"ana@acme.test",
				"--slug",
				"ana",
			]).crmOwnerId,
		).toBeNull();
	});
	it("valida cada campo", () => {
		expect(() =>
			parseExecutorsSetArgs(["--email", "ana@acme.test", "--slug", "ana"]),
		).toThrow("falta --tenant <slug>");
		expect(() =>
			parseExecutorsSetArgs([
				"--tenant",
				"innovas",
				"--email",
				"ana",
				"--slug",
				"ana",
			]),
		).toThrow('email inválido: "ana"');
		expect(() =>
			parseExecutorsSetArgs([
				"--tenant",
				"innovas",
				"--email",
				"ana@acme.test",
				"--slug",
				"Ana López",
			]),
		).toThrow('slug de ejecutor inválido: "Ana López"');
	});
});
