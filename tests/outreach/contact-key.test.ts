import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	ContactKeyError,
	contactKey,
	linkedinSlug,
	normalizeEmail,
} from "@/lib/outreach/contact-key";
import { normalizeText } from "@/lib/outreach/text";

describe("normalizeText", () => {
	it("pasa a minúsculas y saca acentos, como normalizar() de gate.py", () => {
		expect(normalizeText("Estés BIEN, Ñandú")).toBe("estes bien, nandu");
	});
});

describe("normalizeEmail", () => {
	it("recorta y pasa a minúsculas", () => {
		expect(normalizeEmail("  Laura@Metalurgica.COM ")).toBe(
			"laura@metalurgica.com",
		);
	});
	it("devuelve null si no es un email", () => {
		expect(normalizeEmail("laura arroba x")).toBeNull();
		expect(normalizeEmail("")).toBeNull();
		expect(normalizeEmail(null)).toBeNull();
	});
});

describe("linkedinSlug", () => {
	it("saca el slug de una URL completa, sin query ni barra final", () => {
		expect(
			linkedinSlug("https://www.linkedin.com/in/Laura-Gomez-12ab/?utm=x"),
		).toBe("laura-gomez-12ab");
		expect(linkedinSlug("ar.linkedin.com/in/laura-gomez/")).toBe("laura-gomez");
	});
	it("acepta un slug suelto", () => {
		expect(linkedinSlug("laura-gomez")).toBe("laura-gomez");
	});
	it("rechaza URLs que no son de perfil y textos con espacios", () => {
		expect(linkedinSlug("https://www.linkedin.com/company/acme")).toBeNull();
		expect(linkedinSlug("laura gomez")).toBeNull();
		expect(linkedinSlug(undefined)).toBeNull();
	});
});

describe("contactKey", () => {
	it("usa el email primero", () => {
		expect(
			contactKey({
				email: "Laura@Acme.com",
				linkedinUrl: "laura-gomez",
				name: "Laura",
				company: "Acme",
			}),
		).toBe("em:laura@acme.com");
	});
	it("sin email usa LinkedIn", () => {
		expect(
			contactKey({
				email: "no-es-mail",
				linkedinUrl: "https://linkedin.com/in/laura-gomez",
			}),
		).toBe("li:laura-gomez");
	});
	it("sin email ni LinkedIn usa el hash de nombre y empresa normalizados", () => {
		const expected = createHash("sha1")
			.update("laura gomez|metalurgica sur sa")
			.digest("hex");
		expect(
			contactKey({ name: "  Laura   Gómez ", company: "Metalúrgica Sur SA" }),
		).toBe(`h:${expected}`);
	});
	it("sin datos suficientes tira ContactKeyError", () => {
		expect(() => contactKey({ name: "Laura" })).toThrow(ContactKeyError);
	});
});
