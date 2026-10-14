import { describe, expect, it } from "vitest";
import { validateTenantHostname } from "@/lib/domains/hostname";
import { rootHostsFromEnv } from "@/lib/tenants/host";

const prod = rootHostsFromEnv({
	PUBLIC_APP_URL: "https://agentes.innov.as",
	NODE_ENV: "production",
});
const dev = rootHostsFromEnv({
	PUBLIC_APP_URL: "http://localhost:3000",
	NODE_ENV: "development",
});

const check = (raw: string, roots = prod, production = true) =>
	validateTenantHostname(raw, { roots, production });

describe("validateTenantHostname", () => {
	it("acepta un subdominio propio y lo normaliza", () => {
		expect(check("  AI.Okeefe.com.ar. ")).toEqual({
			ok: true,
			hostname: "ai.okeefe.com.ar",
		});
	});

	it("acepta un nombre internacional como punycode", () => {
		expect(check("ía.okeefe.com.ar")).toEqual({
			ok: true,
			hostname: "xn--a-iga.okeefe.com.ar",
		});
	});

	it.each([
		"",
		"okeefe",
		"https://ai.okeefe.com.ar",
		"ai.okeefe.com.ar/chat",
		"ai.okeefe.com.ar:3000",
		"*.okeefe.com.ar",
		"user@ai.okeefe.com.ar",
		"10.0.0.1",
		"ai okeefe.com.ar",
	])("rechaza %j como dominio inválido", (raw) => {
		const result = check(raw);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/dominio/i);
	});

	it("rechaza el host de la plataforma y cualquier subdominio de INNOV.AS", () => {
		for (const raw of [
			"agentes.innov.as",
			"otro.innov.as",
			"ai.innov.as",
			"x.y.innov.as",
		]) {
			const result = check(raw);
			expect(result, raw).toMatchObject({ ok: false });
		}
	});

	it("rechaza los deploys de Vercel", () => {
		expect(check("agents-abc.vercel.app")).toMatchObject({ ok: false });
	});

	it("rechaza localhost, y *.localhost solo se acepta fuera de producción", () => {
		expect(check("localhost")).toMatchObject({ ok: false });
		expect(check("okeefe.localhost")).toMatchObject({ ok: false });
		expect(check("okeefe.localhost", dev, false)).toEqual({
			ok: true,
			hostname: "okeefe.localhost",
		});
	});
});
