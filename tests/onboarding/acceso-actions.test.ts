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
	step: "acceso" as string | null,
	method: null as string | null,
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
			if (fn === "current_login_method")
				return { data: state.method, error: null };
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
	state.method = null;
	state.access = {
		id: TENANT,
		slug: "lagomarsino",
		displayName: "Lagomarsino",
		role: "tenant_admin",
		userId: "me",
		defaultModel: "anthropic/claude-sonnet-5",
	};
	state.step = "acceso";
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

const actions = await import("@/app/empezar/[slug]/acceso/actions");

describe("saveAccessStep", () => {
	it("guarda los métodos, avanza a equipo y redirige", async () => {
		const to = await redirects(() =>
			actions.saveAccessStep("lagomarsino", {
				methods: ["microsoft"]
			}),
		);
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_tenant_auth_methods",
				args: { p_tenant: TENANT, p_methods: ["microsoft"] },
			},
			{
				fn: "set_onboarding_step",
				args: { p_tenant: TENANT, p_step: "equipo" },
			},
		]);
		expect(to).toBe("/empezar/lagomarsino/equipo");
	});

	it("sin métodos devuelve el mensaje y no avanza", async () => {
		state.rpcError = {
			code: "23514",
			message: "dejá al menos una forma de entrar",
			hint: "settings",
		};
		const r = await actions.saveAccessStep("lagomarsino", {
			methods: []
		});
		expect(r).toEqual({
			ok: false,
			message: "dejá al menos una forma de entrar",
		});
		expect(stepCalls()).toHaveLength(0);
	});

	it("en otro paso redirige al paso real", async () => {
		state.step = "logo";
		const to = await redirects(() =>
			actions.saveAccessStep("lagomarsino", {
				methods: ["email"]
			}),
		);
		expect(to).toBe("/empezar/lagomarsino/logo");
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un miembro no cambia nada", async () => {
		state.access = { ...state.access, role: "tenant_member" };
		const r = await actions.saveAccessStep("lagomarsino", {
			methods: ["email"]
		});
		expect(r.ok).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("no deja sacar el método con el que entró la persona", async () => {
		state.method = "email";
		const r = await actions.saveAccessStep("lagomarsino", { methods: ["microsoft"] });
		expect(r).toEqual({
			ok: false,
			message: "No podés sacar la forma de entrar con la que estás usando ahora.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("con el método propio en la lista sigue", async () => {
		state.method = "email";
		await redirects(() =>
			actions.saveAccessStep("lagomarsino", { methods: ["microsoft", "email"] }),
		);
		expect(state.rpcCalls[0]?.fn).toBe("set_tenant_auth_methods");
	});
});
