import { afterEach, describe, expect, it, vi } from "vitest";

const issuePackageLink = vi.fn();
const deps = { marker: "package-link-deps" };

vi.mock("@/lib/brain/core/skills/package-link", () => ({
	issuePackageLink: (...args: unknown[]) => issuePackageLink(...args),
}));
vi.mock("@/lib/brain/adapters/skill-packages", () => ({
	packageLinkDeps: () => deps,
}));
vi.mock("@/lib/brain/adapters/mcp-supabase", () => ({
	supabaseClaimsVerifier: vi.fn(),
	supabaseAccessStore: vi.fn(),
	supabaseHit: vi.fn(),
}));
vi.mock("@/lib/brain/adapters/access-rules", () => ({
	accessRulesStore: vi.fn(),
}));
vi.mock("@/lib/brain/adapters/skill-storage", () => ({
	skillStore: vi.fn(),
	blobStore: vi.fn(),
}));
vi.mock("@/lib/brain/adapters/provider", () => ({ getBrainProvider: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
	productionDeps,
	publicSettings,
	skillLoadEvent,
} from "@/lib/brain/adapters/mcp-production";

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

	it("con un origen por request lo usa en vez del fijo", () => {
		vi.stubEnv("PUBLIC_APP_URL", "https://agentes.innov.as");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
		expect(publicSettings("https://ai.okeefe.com.ar")).toEqual({
			publicUrl: "https://ai.okeefe.com.ar",
			issuer: "https://ref.supabase.co/auth/v1",
		});
	});

	it("con un origen por request no exige PUBLIC_APP_URL", () => {
		vi.stubEnv("PUBLIC_APP_URL", undefined);
		vi.stubEnv("VERCEL_URL", undefined);
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
		expect(publicSettings("https://ai.okeefe.com.ar").publicUrl).toBe(
			"https://ai.okeefe.com.ar",
		);
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

describe("skillLoadEvent", () => {
	it("arma la fila de events de una carga por MCP", () => {
		expect(
			skillLoadEvent({
				tenantId: "t1",
				userId: "u1",
				slug: "skills/ventas/reporte",
				name: "reporte",
				version: 2,
				digest: "dg",
			}),
		).toEqual({
			tenant_id: "t1",
			actor_user_id: "u1",
			channel: "mcp",
			type: "brain.skill_loaded",
			summary: "skills/ventas/reporte",
			payload: { name: "reporte", version: 2, digest: "dg" },
		});
	});
});

describe("productionDeps().skills.issue", () => {
	it("emite el paquete con canal mcp y los campos del pedido", async () => {
		vi.stubEnv("PUBLIC_APP_URL", "https://agentes.innov.as");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
		issuePackageLink.mockResolvedValue({ ok: true });
		const request = {
			tenantId: "t1",
			userId: "u1",
			name: "reporte",
			slug: "skills/ventas/reporte",
		};
		await productionDeps().skills.issue(request as never);
		expect(issuePackageLink).toHaveBeenCalledWith(
			{ ...request, channel: "mcp" },
			deps,
		);
	});
});
