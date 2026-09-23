import { describe, expect, it } from "vitest";
import { composeMail } from "@/lib/gmail/signature";

const SIGNER = {
	displayName: "Matías O'Keefe",
	title: "CTO y Producto",
	linkedinUrl: "https://www.linkedin.com/in/matiasokeefe/",
};
const COMPANY = { name: "INNOV.AS", url: "https://innov.as" };

describe("composeMail", () => {
	it("sin displayName no arma firma: mismo body, sin html", () => {
		const result = composeMail(
			"Hola Laura,\n\nTe escribo por...",
			{
				displayName: null,
				title: null,
				linkedinUrl: null,
			},
			COMPANY,
		);
		expect(result).toEqual({
			text: "Hola Laura,\n\nTe escribo por...",
			html: null,
		});
	});

	it("con displayName arma texto y html con nombre, puesto, empresa y LinkedIn", () => {
		const result = composeMail(
			"Hola Laura,\n\nTe escribo por...",
			SIGNER,
			COMPANY,
		);
		expect(result.text).toBe(
			[
				"Hola Laura,",
				"",
				"Te escribo por...",
				"",
				"--",
				"Matías O'Keefe",
				"CTO y Producto",
				"INNOV.AS — https://innov.as",
				"LinkedIn: https://www.linkedin.com/in/matiasokeefe/",
			].join("\n"),
		);
		expect(result.html).toContain("Matías O&#39;Keefe");
		expect(result.html).toContain("CTO y Producto");
		expect(result.html).toContain('href="https://innov.as"');
		expect(result.html).toContain(
			'href="https://www.linkedin.com/in/matiasokeefe/"',
		);
		expect(result.html).toContain(">in<");
	});

	it("sin empresa configurada no linkea ninguna, pero sí firma con LinkedIn", () => {
		const result = composeMail("x", SIGNER, null);
		expect(result.text).not.toContain("INNOV.AS");
		expect(result.html).not.toContain("innov.as");
		expect(result.html).toContain("linkedin.com/in/matiasokeefe");
	});

	it("sin linkedin cargado no arma el badge, pero sí el resto", () => {
		const result = composeMail("x", { ...SIGNER, linkedinUrl: null }, COMPANY);
		expect(result.text).not.toContain("LinkedIn:");
		expect(result.html).not.toContain(">in<");
		expect(result.html).toContain("INNOV.AS");
	});

	it("escapa HTML del cuerpo: un body con < o & no rompe el mail", () => {
		const result = composeMail("Precio < 100 & sin vuelto", SIGNER, COMPANY);
		expect(result.html).toContain("Precio &lt; 100 &amp; sin vuelto");
		expect(result.html).not.toContain("Precio < 100");
	});

	it("respeta párrafos: doble salto de línea es <p>, uno simple es <br>", () => {
		const result = composeMail(
			"Primero\nSegunda línea\n\nOtro párrafo",
			SIGNER,
			COMPANY,
		);
		expect(result.html).toContain("Primero<br>Segunda línea");
		expect(result.html).toMatch(/<p[^>]*>Primero<br>Segunda línea<\/p>/);
		expect(result.html).toContain("Otro párrafo");
	});
});
