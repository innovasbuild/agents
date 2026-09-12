import { describe, expect, it } from "vitest";
import { isAllowedDomain } from "@/lib/invitations/domain";

describe("isAllowedDomain", () => {
	it("acepta cualquier mail cuando el tenant no declara dominios", () => {
		expect(isAllowedDomain("quien@sea.com", [])).toBe(true);
	});

	it("acepta un mail del dominio del cliente", () => {
		expect(isAllowedDomain("Ana@Lagomarcino.com", ["lagomarcino.com"])).toBe(
			true,
		);
	});

	it("rechaza un mail de afuera", () => {
		expect(isAllowedDomain("ana@gmail.com", ["lagomarcino.com"])).toBe(false);
	});

	it("rechaza una cadena que no es mail", () => {
		expect(isAllowedDomain("ana-arroba-nada", ["lagomarcino.com"])).toBe(false);
	});
});
