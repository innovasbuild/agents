import { describe, expect, it } from "vitest";
import {
	type Ficha,
	fichaExpiresAt,
	fichaResearchSchema,
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
	dolores: [
		{
			dolor: "Seguimiento de pedidos entre plantas",
			por_que_a_ellos: "Suma una planta en Rafaela a las que ya tenía",
			beneficio: "Menos pedidos demorados sin sumar coordinadores",
			evidencia: "https://acme.test/noticias",
		},
		{
			dolor: "Cotizaciones que nadie sigue",
			por_que_a_ellos: "Vende a distribuidores de todo el país",
			beneficio: "Más cotizaciones cerradas",
			evidencia: "javascript:alert(1)",
		},
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
	it("una ficha guardada antes de los dolores se sigue leyendo, con dolores vacío", () => {
		const { dolores: _, ...vieja } = ficha;
		expect(fichaSchema.parse(vieja).dolores).toEqual([]);
	});
	it("la salida del research exige dolores: el modelo no puede omitirlos", () => {
		const { dolores: _, ...sinDolores } = ficha;
		expect(fichaResearchSchema.safeParse(sinDolores).success).toBe(false);
		expect(fichaResearchSchema.safeParse(ficha).success).toBe(true);
	});
	it("sanitizeFicha deja la evidencia de un dolor solo si es la URL de un hecho que quedó", () => {
		const clean = sanitizeFicha(ficha);
		expect(clean?.dolores.map((d) => d.evidencia)).toEqual([
			"https://acme.test/noticias",
			null,
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
