import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
	access: {
		id: "11111111-1111-4111-8111-111111111111",
		slug: "lagomarsino",
		displayName: "Lagomarsino",
		role: "tenant_admin",
		userId: "me",
		defaultModel: "anthropic/claude-sonnet-5",
	} as Record<string, string> | null,
	step: "logo" as string | null,
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	rpcError: null as { code?: string; message: string; hint?: string } | null,
	uploads: [] as string[],
	redirected: null as string | null,
	invites: [] as Record<string, unknown>[],
	inviteOutcome: {} as Record<string, string>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		state.redirected = path;
		throw new Error("NEXT_REDIRECT");
	},
}));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.access,
}));
vi.mock("@/lib/tenants/login-check-server", () => ({
	actionAllowsLogin: async () => true,
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					single: async () => ({
						data: {
							onboarding_step: state.step,
							allowed_domains: ["lagomarsino.com"],
							default_model: "anthropic/claude-sonnet-5",
						},
						error: null,
					}),
				}),
			}),
		}),
	}),
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
		rpc: async (fn: string, args: Record<string, unknown>) => {
			state.rpcCalls.push({ fn, args });
			return { data: null, error: state.rpcError };
		},
		from: () => ({
			select: () => ({
				eq: () => ({
					single: async () => ({
						data: { display_name: "Lagomarsino", brand: {} },
						error: null,
					}),
				}),
			}),
		}),
		storage: {
			from: () => ({
				upload: async (path: string) => {
					state.uploads.push(path);
					return { error: null };
				},
			}),
		},
	}),
}));
vi.mock("@/lib/domains/origin", () => ({
	invitationOrigin: async (_t: string, fallback: string) =>
		`origin:${fallback}`,
}));
vi.mock("next/headers", () => ({
	headers: async () =>
		new Headers({ host: "app.test", "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/invitations/invite", () => ({
	inviteToTenant: async (params: Record<string, unknown>) => {
		state.invites.push(params);
		return { kind: state.inviteOutcome[String(params.email)] ?? "ok" };
	},
}));

beforeEach(() => {
	state.access = {
		id: TENANT,
		slug: "lagomarsino",
		displayName: "Lagomarsino",
		role: "tenant_admin",
		userId: "me",
		defaultModel: "anthropic/claude-sonnet-5",
	};
	state.step = "logo";
	state.rpcCalls = [];
	state.rpcError = null;
	state.uploads = [];
	state.redirected = null;
	state.invites = [];
	state.inviteOutcome = {};
});

const file = (type: string, size: number) =>
	new File([new Uint8Array(size)], "logo", { type });
const form = (f: File) => {
	const fd = new FormData();
	fd.set("logo", f);
	return fd;
};
const redirects = async (fn: () => Promise<unknown>) => {
	await expect(fn()).rejects.toThrow("NEXT_REDIRECT");
	return state.redirected;
};
const stepCalls = () =>
	state.rpcCalls.filter((c) => c.fn === "set_onboarding_step");

const actions = await import("@/app/empezar/[slug]/logo/actions");

describe("uploadLogoStep", () => {
	it("un PNG de 2 MB devuelve ok:false sin subir ni avanzar", async () => {
		const r = await actions.uploadLogoStep(
			"lagomarsino",
			form(file("image/png", 2_000_000)),
		);
		expect(r.ok).toBe(false);
		expect(state.uploads).toHaveLength(0);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un SVG de 10 KB se sube, guarda logo_url, avanza a acceso y redirige", async () => {
		const to = await redirects(() =>
			actions.uploadLogoStep(
				"lagomarsino",
				form(file("image/svg+xml", 10_000)),
			),
		);
		expect(state.uploads[0]).toMatch(/^lagomarsino\/logo-\d+\.svg$/);
		const profile = state.rpcCalls.find((c) => c.fn === "set_tenant_profile");
		expect(profile?.args.p_brand).toEqual({ logo_url: state.uploads[0] });
		expect(stepCalls()).toEqual([
			{
				fn: "set_onboarding_step",
				args: { p_tenant: TENANT, p_step: "acceso" },
			},
		]);
		expect(to).toBe("/empezar/lagomarsino/acceso");
	});

	it("en otro paso redirige al paso real y no sube nada", async () => {
		state.step = "equipo";
		const to = await redirects(() =>
			actions.uploadLogoStep("lagomarsino", form(file("image/png", 100))),
		);
		expect(to).toBe("/empezar/lagomarsino/equipo");
		expect(state.uploads).toHaveLength(0);
	});

	it("un miembro no sube nada", async () => {
		state.access = { ...state.access, role: "tenant_member" };
		const r = await actions.uploadLogoStep(
			"lagomarsino",
			form(file("image/png", 100)),
		);
		expect(r.ok).toBe(false);
		expect(state.uploads).toHaveLength(0);
	});
});

describe("skipLogoStep", () => {
	it("avanza a acceso y redirige", async () => {
		const to = await redirects(() => actions.skipLogoStep("lagomarsino"));
		expect(stepCalls()[0]?.args).toEqual({
			p_tenant: TENANT,
			p_step: "acceso",
		});
		expect(to).toBe("/empezar/lagomarsino/acceso");
	});

	it("con el alta terminada redirige al chat", async () => {
		state.step = null;
		const to = await redirects(() => actions.skipLogoStep("lagomarsino"));
		expect(to).toBe("/lagomarsino/chat");
		expect(stepCalls()).toHaveLength(0);
	});
});
