import { describe, expect, it } from "vitest";
import {
	isPublicEmailDomain,
	PUBLIC_EMAIL_DOMAINS,
} from "@/lib/tenants/public-email-domains";

describe("isPublicEmailDomain", () => {
	it("reconoce los dominios públicos sin importar mayúsculas ni arroba", () => {
		expect(isPublicEmailDomain("gmail.com")).toBe(true);
		expect(isPublicEmailDomain("Gmail.COM")).toBe(true);
		expect(isPublicEmailDomain("@outlook.com")).toBe(true);
		expect(isPublicEmailDomain("  yahoo.com.ar ")).toBe(true);
	});

	it("deja pasar el dominio de una empresa", () => {
		expect(isPublicEmailDomain("innov.as")).toBe(false);
		expect(isPublicEmailDomain("mail.gmail.com.empresa.com")).toBe(false);
	});

	it("la lista está en minúsculas y sin repetidos", () => {
		expect(PUBLIC_EMAIL_DOMAINS.every((d) => d === d.toLowerCase())).toBe(true);
		expect(new Set(PUBLIC_EMAIL_DOMAINS).size).toBe(
			PUBLIC_EMAIL_DOMAINS.length,
		);
	});
});
