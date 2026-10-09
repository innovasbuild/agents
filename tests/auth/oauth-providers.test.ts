import { describe, expect, it } from "vitest";
import { OAUTH_PROVIDERS } from "@/lib/auth/oauth-providers";

describe("OAUTH_PROVIDERS", () => {
	it("Microsoft entra por el proveedor azure de Supabase, con el scope email", () => {
		expect(OAUTH_PROVIDERS.microsoft).toEqual({
			provider: "azure",
			scopes: "email",
			label: "Entrar con Microsoft",
		});
	});

	it("Google conserva sus scopes", () => {
		expect(OAUTH_PROVIDERS.google).toEqual({
			provider: "google",
			scopes: "openid email profile",
			label: "Entrar con Google",
		});
	});
});
