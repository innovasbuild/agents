import { describe, expect, it } from "vitest";
import { parseContactsCsv } from "@/lib/outreach/csv";
import { domainFromEmail, normalizeDomain } from "@/lib/outreach/domain";

describe("domain", () => {
	it("normaliza dominios y URLs", () => {
		expect(normalizeDomain("https://www.Acme.com.ar/contacto")).toBe(
			"acme.com.ar",
		);
		expect(normalizeDomain("acme")).toBeNull();
		expect(normalizeDomain("")).toBeNull();
	});
	it("saca el dominio de un email corporativo, no de una casilla gratuita", () => {
		expect(domainFromEmail("laura@acme.com.ar")).toBe("acme.com.ar");
		expect(domainFromEmail("laura@gmail.com")).toBeNull();
	});
});

describe("parseContactsCsv", () => {
	it("lee columnas conocidas, comillas y deriva el dominio del email", () => {
		const csv = [
			"name,email,company,linkedin_url,segment,vector,columna_extra",
			'"Gómez, Laura",Laura@Acme.com.ar,"Acme, SA",,mid_market_ar,v7_seller_meli_ar,x',
			"Beto,,Fabrica,https://linkedin.com/in/beto-r,,,",
		].join("\n");
		expect(parseContactsCsv(csv)).toEqual({
			rows: [
				{
					line: 2,
					name: "Gómez, Laura",
					email: "laura@acme.com.ar",
					company: "Acme, SA",
					linkedinUrl: null,
					domain: "acme.com.ar",
					segment: "mid_market_ar",
					vector: "v7_seller_meli_ar",
				},
				{
					line: 3,
					name: "Beto",
					email: null,
					company: "Fabrica",
					linkedinUrl: "https://linkedin.com/in/beto-r",
					domain: null,
					segment: null,
					vector: null,
				},
			],
			errors: [],
		});
	});

	it("reporta filas con email inválido y comillas sin cerrar sin frenar las demás", () => {
		const csv = [
			"name,email",
			"Laura,no-es-mail",
			'Beto,"beto@acme.test',
			"Caro,caro@acme.test",
		].join("\n");
		const result = parseContactsCsv(csv);
		expect(result.rows.map((r) => r.name)).toEqual(["Laura", "Caro"]);
		expect(result.rows[0].email).toBeNull();
		expect(result.errors).toEqual([
			{ line: 2, reason: 'email inválido: "no-es-mail"' },
			{ line: 3, reason: "comillas sin cerrar" },
		]);
	});

	it("exige encabezado con al menos una columna conocida y como mucho 50 filas", () => {
		expect(parseContactsCsv("a,b\n1,2").errors).toEqual([
			{
				line: 1,
				reason:
					"el encabezado no tiene ninguna columna conocida (name, email, linkedin_url, company, domain, segment, vector)",
			},
		]);
		const many = [
			"email",
			...Array.from({ length: 51 }, (_, i) => `p${i}@acme.test`),
		].join("\n");
		expect(parseContactsCsv(many).errors).toEqual([
			{ line: 1, reason: "el CSV tiene 51 filas; el máximo por carga es 50" },
		]);
	});

	it("si el encabezado no matchea por coma pero sí por punto y coma, avisa que exporten con comas", () => {
		const csv = ["name;email;company", "Laura;laura@acme.test;Acme"].join("\n");
		expect(parseContactsCsv(csv).errors).toEqual([
			{
				line: 1,
				reason: "el CSV usa ';' como separador: exportalo con comas",
			},
		]);
	});

	it("un email de más de 320 caracteres es inválido sin correr la regex, y se reporta truncado", () => {
		const longEmail = `${"a".repeat(315)}@acme.test`;
		expect(longEmail.length).toBeGreaterThan(320);
		const csv = ["name,email", `Laura,${longEmail}`].join("\n");
		const result = parseContactsCsv(csv);
		expect(result.rows[0].email).toBeNull();
		expect(result.errors).toEqual([
			{
				line: 2,
				reason: `email inválido: "${longEmail.slice(0, 40)}…"`,
			},
		]);
	});
});
