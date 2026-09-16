import { describe, expect, it } from "vitest";
import { evalAuthFromEnv, isLocalSupabaseUrl } from "@/lib/agents/eval-auth";

const env = {
	NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
	EVE_EVAL_USER_ID: "e7a1e7a1-0000-0000-0000-000000000001",
	EVE_EVAL_USER_EMAIL: "eval@outreach.test",
	EVE_EVAL_TENANT_ID: "e7a1e7a1-0000-0000-0000-0000000000aa",
	EVE_EVAL_TENANT_SLUG: "eval-outreach",
	EVE_EVAL_CONVERSATION_ID: "e7a1e7a1-0000-0000-0000-0000000000c1",
	EVE_EVAL_ROLE: "tenant_admin",
};

describe("isLocalSupabaseUrl", () => {
	it("acepta solo la Supabase local", () => {
		expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
		expect(isLocalSupabaseUrl("http://localhost:54321/")).toBe(true);
		expect(isLocalSupabaseUrl("https://x.supabase.co")).toBe(false);
		expect(isLocalSupabaseUrl("http://127.0.0.1.evil.test")).toBe(false);
		expect(isLocalSupabaseUrl(undefined)).toBe(false);
	});
});

describe("evalAuthFromEnv", () => {
	it("arma el principal del tenant de eval con los mismos atributos que el canal real", () => {
		expect(evalAuthFromEnv(env)).toEqual({
			authenticator: "app",
			issuer: "http://127.0.0.1:54321",
			principalId: env.EVE_EVAL_USER_ID,
			principalType: "user",
			subject: env.EVE_EVAL_USER_ID,
			attributes: {
				email: "eval@outreach.test",
				tenantId: env.EVE_EVAL_TENANT_ID,
				tenantSlug: "eval-outreach",
				conversationId: env.EVE_EVAL_CONVERSATION_ID,
				role: "tenant_admin",
			},
		});
	});

	it("nunca autentica en un deploy de Vercel", () => {
		expect(evalAuthFromEnv({ ...env, VERCEL_ENV: "production" })).toBeNull();
		expect(evalAuthFromEnv({ ...env, VERCEL_ENV: "preview" })).toBeNull();
	});

	it("nunca autentica contra una base que no sea local", () => {
		expect(
			evalAuthFromEnv({
				...env,
				NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
			}),
		).toBeNull();
	});

	it("sin cualquiera de las variables de eval, no autentica", () => {
		const { EVE_EVAL_CONVERSATION_ID: _, ...incomplete } = env;
		expect(evalAuthFromEnv(incomplete)).toBeNull();
	});
});
