import { afterEach, describe, expect, it, vi } from "vitest";
import { publicSettings } from "@/lib/brain/adapters/mcp-production";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("publicSettings", () => {
	it("usa PUBLIC_APP_URL cuando está, sin importar VERCEL_URL", () => {
		vi.stubEnv("PUBLIC_APP_URL", "https://agentes.innov.as/");
		vi.stubEnv("VERCEL_URL", "agents-abc123.vercel.app");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
		expect(publicSettings()).toEqual({
			publicUrl: "https://agentes.innov.as",
			issuer: "https://ref.supabase.co/auth/v1",
		});
	});

	it("sin PUBLIC_APP_URL, cae a VERCEL_URL (así no revienta un build de preview)", () => {
		vi.stubEnv("PUBLIC_APP_URL", undefined);
		vi.stubEnv("VERCEL_URL", "agents-abc123.vercel.app");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
		expect(publicSettings().publicUrl).toBe("https://agents-abc123.vercel.app");
	});

	it("sin ninguna de las dos, tira", () => {
		vi.stubEnv("PUBLIC_APP_URL", undefined);
		vi.stubEnv("VERCEL_URL", undefined);
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
		expect(() => publicSettings()).toThrow("PUBLIC_APP_URL");
	});

	it("sin NEXT_PUBLIC_SUPABASE_URL, tira aunque haya URL pública", () => {
		vi.stubEnv("PUBLIC_APP_URL", "https://agentes.innov.as");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
		expect(() => publicSettings()).toThrow("NEXT_PUBLIC_SUPABASE_URL");
	});
});
