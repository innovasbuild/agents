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
			displayName: null,
			title: null,
			linkedinUrl: null,
		});
	});
	it("el owner del CRM y la firma son opcionales", () => {
		const args = parseExecutorsSetArgs([
			"--tenant",
			"innovas",
			"--email",
			"ana@acme.test",
			"--slug",
			"ana",
		]);
		expect(args.crmOwnerId).toBeNull();
		expect(args.displayName).toBeNull();
		expect(args.title).toBeNull();
		expect(args.linkedinUrl).toBeNull();
	});
	it("lee nombre, puesto y LinkedIn de la firma", () => {
		expect(
			parseExecutorsSetArgs([
				"--tenant",
				"innovas",
				"--email",
				"ana@acme.test",
				"--slug",
				"ana",
				"--display-name",
				"Ana López",
				"--title",
				"Account Executive",
				"--linkedin-url",
				"https://www.linkedin.com/in/analopez/",
			]),
		).toMatchObject({
			displayName: "Ana López",
			title: "Account Executive",
			linkedinUrl: "https://www.linkedin.com/in/analopez/",
		});
	});
	it("rechaza un linkedin-url que no es de LinkedIn", () => {
		expect(() =>
			parseExecutorsSetArgs([
				"--tenant",
				"innovas",
				"--email",
				"ana@acme.test",
				"--slug",
				"ana",
				"--linkedin-url",
				"https://twitter.com/ana",
			]),
		).toThrow('linkedin-url inválida: "https://twitter.com/ana"');
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
