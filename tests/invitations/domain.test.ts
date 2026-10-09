import { describe, expect, it } from "vitest";
import { emailDomain, isAllowedDomain } from "@/lib/invitations/domain";

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

describe("emailDomain", () => {
	it("devuelve el dominio en minúsculas", () => {
		expect(emailDomain("Ana@Lagomarcino.COM")).toBe("lagomarcino.com");
		expect(emailDomain("  ana@x.com ")).toBe("x.com");
	});

	it("devuelve null si no es algo@dominio", () => {
		expect(emailDomain("ana")).toBeNull();
		expect(emailDomain("@x.com")).toBeNull();
		expect(emailDomain("ana@")).toBeNull();
		expect(emailDomain("a@b@c.com")).toBeNull();
		expect(emailDomain("")).toBeNull();
	});
});
