import { describe, expect, it } from "vitest";
import { checkAuthServerMetadata } from "@/scripts/oauth-probe-check";

const issuer = "https://ref.supabase.co/auth/v1";
const complete = {
	issuer,
	authorization_endpoint: `${issuer}/oauth/authorize`,
	token_endpoint: `${issuer}/oauth/token`,
	registration_endpoint: `${issuer}/oauth/clients/register`,
	jwks_uri: `${issuer}/.well-known/jwks.json`,
	code_challenge_methods_supported: ["S256"],
};

describe("checkAuthServerMetadata", () => {
	it("una metadata completa pasa", () => {
		expect(checkAuthServerMetadata(complete, issuer)).toEqual({
			ok: true,
			problems: [],
		});
	});

	it("sin registration_endpoint falla con V2", () => {
		const { registration_endpoint: _omit, ...rest } = complete;
		const result = checkAuthServerMetadata(rest, issuer);
		expect(result.ok).toBe(false);
		expect(result.problems).toContain(
			"falta registration_endpoint (V2): los clientes no se pueden registrar solos",
		);
	});

	it("otro issuer o sin S256 falla", () => {
		const result = checkAuthServerMetadata(
			{
				...complete,
				issuer: "https://otro",
				code_challenge_methods_supported: ["plain"],
			},
			issuer,
		);
		expect(result.problems).toEqual([
			`issuer es https://otro, se esperaba ${issuer}`,
			"no anuncia PKCE S256",
		]);
	});

	it("algo que no es un objeto falla", () => {
		expect(checkAuthServerMetadata("<html>", issuer).ok).toBe(false);
	});
});
