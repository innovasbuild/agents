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
	step: "equipo" as string | null,
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	rpcError: null as { code?: string; message: string; hint?: string } | null,
	uploads: [] as string[],
	redirected: null as string | null,
	invites: [] as Record<string, unknown>[],
	inviteOutcome: {} as Record<string, string>,
	inviteReason: "limit:users" as string,
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
vi.mock("@/lib/plans/store", () => ({
	createPlanStore: () => ({ fake: "plans" }),
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
		const kind = state.inviteOutcome[String(params.email)] ?? "ok";
		return kind === "limite" ? { kind, reason: state.inviteReason } : { kind };
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
	state.step = "equipo";
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

const actions = await import("@/app/empezar/[slug]/equipo/actions");

const two = [
	{ email: "ana@lagomarsino.com", role: "tenant_member" as const },
	{ email: "beto@lagomarsino.com", role: "tenant_admin" as const },
];

describe("finishWithInvites", () => {
	it("invita a las dos personas con su rol, cierra el alta y va al chat", async () => {
		const to = await redirects(() =>
			actions.finishWithInvites("lagomarsino", two),
		);
		expect(state.invites).toHaveLength(2);
		expect(state.invites[0]).toMatchObject({
			tenantId: TENANT,
			email: "ana@lagomarsino.com",
			role: "tenant_member",
			invitedBy: "me",
			allowExternal: false,
		});
		expect(state.invites[1]).toMatchObject({
			email: "beto@lagomarsino.com",
			role: "tenant_admin",
		});
		expect(String(state.invites[0]?.origin)).toMatch(/^origin:/);
		expect(stepCalls()[0]?.args).toEqual({ p_tenant: TENANT, p_step: null });
		expect(to).toBe("/lagomarsino/chat");
	});

	it("una que falla no frena a la otra: igual cierra el alta, y avisa cuál falló", async () => {
		state.inviteOutcome = { "ana@lagomarsino.com": "mail_fallo" };
		const r = await actions.finishWithInvites("lagomarsino", two);
		expect(state.invites).toHaveLength(2);
		expect(r).toEqual({
			ok: true,
			failed: ["ana@lagomarsino.com"],
			outside: [],
			limited: null,
		});
		expect(stepCalls()).toHaveLength(1);
		expect(state.redirected).toBeNull();
	});

	it("un correo de afuera del dominio va aparte, no como falla de envío", async () => {
		state.inviteOutcome = { "ana@lagomarsino.com": "dominio_no_permitido" };
		const r = await actions.finishWithInvites("lagomarsino", two);
		expect(r).toEqual({
			ok: true,
			failed: [],
			outside: ["ana@lagomarsino.com"],
			limited: null,
		});
		expect(state.redirected).toBeNull();
	});

	it("le pasa el store de planes a la invitación", async () => {
		await actions.finishWithInvites("lagomarsino", [two[0]]).catch(() => null);
		expect(state.invites[0]).toMatchObject({ plans: { fake: "plans" } });
	});

	it("un limite no rompe: se avisa con su mensaje, no como falla de envío, y se cierra el alta", async () => {
		state.inviteOutcome = { "ana@lagomarsino.com": "limite" };
		const r = await actions.finishWithInvites("lagomarsino", two);
		expect(r).toEqual({
			ok: true,
			failed: [],
			outside: [],
			limited: {
				emails: ["ana@lagomarsino.com"],
				message: expect.stringContaining("Tu equipo creció"),
			},
		});
		expect(stepCalls()).toHaveLength(1);
		expect(state.redirected).toBeNull();
	});

	it("tres correos devuelve ok:false y no invita", async () => {
		const r = await actions.finishWithInvites("lagomarsino", [
			...two,
			{ email: "caro@lagomarsino.com", role: "tenant_member" },
		]);
		expect(r.ok).toBe(false);
		expect(state.invites).toHaveLength(0);
	});

	it("un correo inválido devuelve ok:false", async () => {
		const r = await actions.finishWithInvites("lagomarsino", [
			{ email: "nada", role: "tenant_member" },
		]);
		expect(r.ok).toBe(false);
		expect(state.invites).toHaveLength(0);
	});

	it("en otro paso redirige al paso real", async () => {
		state.step = "acceso";
		const to = await redirects(() =>
			actions.finishWithInvites("lagomarsino", two),
		);
		expect(to).toBe("/empezar/lagomarsino/acceso");
		expect(state.invites).toHaveLength(0);
	});

	it("un miembro no invita", async () => {
		state.access = { ...state.access, role: "tenant_member" };
		const r = await actions.finishWithInvites("lagomarsino", two);
		expect(r.ok).toBe(false);
		expect(state.invites).toHaveLength(0);
	});
});

describe("finishWithoutInvites", () => {
	it("cierra el alta y va al chat", async () => {
		const to = await redirects(() =>
			actions.finishWithoutInvites("lagomarsino"),
		);
		expect(stepCalls()[0]?.args).toEqual({ p_tenant: TENANT, p_step: null });
		expect(to).toBe("/lagomarsino/chat");
	});
});
