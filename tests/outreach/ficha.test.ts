import { describe, expect, it } from "vitest";
import {
	type Ficha,
	fichaExpiresAt,
	fichaSchema,
	isFichaVigente,
	sanitizeFicha,
} from "@/lib/outreach/ficha";

const ficha: Ficha = {
	name: "Acme",
	domain: "https://www.acme.test/",
	produce: "Envases",
	gana: null,
	compra: null,
	rompe_si_crece: null,
	gap_declarado: null,
	gap_demostrable: null,
	hechos: [
		{
			hecho: "Abrió planta en Rafaela",
			url: "https://acme.test/noticias",
			fecha: "2026-03-01",
		},
		{ hecho: "Sin fuente", url: "", fecha: null },
		{ hecho: "Fuente no web", url: "javascript:alert(1)", fecha: null },
	],
	creditos_usados: 2,
};

describe("ficha", () => {
	it("el esquema acepta una ficha completa", () => {
		expect(fichaSchema.parse(ficha)).toEqual(ficha);
	});
	it("sanitizeFicha descarta hechos sin URL http(s) y normaliza el dominio", () => {
		const clean = sanitizeFicha(ficha);
		expect(clean?.domain).toBe("acme.test");
		expect(clean?.hechos.map((h) => h.hecho)).toEqual([
			"Abrió planta en Rafaela",
		]);
	});
	it("sanitizeFicha devuelve null si el dominio no normaliza: nunca pasa un dominio crudo", () => {
		expect(sanitizeFicha({ ...ficha, domain: "no es un dominio" })).toBeNull();
	});
	it("vence a los 90 días", () => {
		const researched = new Date("2026-09-01T00:00:00Z");
		const expires = fichaExpiresAt(researched);
		expect(expires.toISOString()).toBe("2026-11-30T00:00:00.000Z");
		expect(isFichaVigente(expires, new Date("2026-11-29T23:59:59Z"))).toBe(
			true,
		);
		expect(isFichaVigente(expires, expires)).toBe(false);
	});
});
