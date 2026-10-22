import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	rpc: { data: unknown; error: { code?: string; hint?: string } | null };
	rpcCalls: [string, unknown][];
	user: { id: string } | null;
	redirected: string | null;
} = {
	rpc: { data: null, error: null },
	rpcCalls: [],
	user: { id: "u1" },
	redirected: null,
};

const after = vi.fn((fn: () => unknown) => {
	void fn();
});
const runFolderResearch = vi.fn(async () => undefined);

vi.mock("next/server", () => ({ after: (fn: () => unknown) => after(fn) }));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		state.redirected = path;
		throw new Error("NEXT_REDIRECT");
	},
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: { getUser: async () => ({ data: { user: state.user } }) },
		rpc: async (fn: string, args: unknown) => {
			state.rpcCalls.push([fn, args]);
			return state.rpc;
		},
	}),
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					single: async () => ({
						data: { default_model: "anthropic/claude-sonnet" },
						error: null,
					}),
				}),
			}),
		}),
	}),
}));
vi.mock("@/lib/onboarding/research-run", () => ({ runFolderResearch }));
vi.mock("@/lib/onboarding/research-deps", () => ({
	folderResearchDeps: () => ({}),
}));

const { createCompany } = await import("@/app/empezar/empresa/actions");

function form(values: Record<string, string>) {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
}

describe("createCompany", () => {
	beforeEach(() => {
		state.rpc = { data: { id: "t1", slug: "acme" }, error: null };
		state.rpcCalls = [];
		state.user = { id: "u1" };
		state.redirected = null;
		after.mockClear();
		runFolderResearch.mockClear();
	});

	it("rpc ok: encola el research y redirige a carpetas", async () => {
		await expect(
			createCompany(form({ display_name: "Acme", domain: "acme.com" })),
		).rejects.toThrow("NEXT_REDIRECT");

		expect(state.rpcCalls).toEqual([
			[
				"self_serve_create_tenant",
				{ p_display_name: "Acme", p_domain: "acme.com" },
			],
		]);
		expect(after).toHaveBeenCalledTimes(1);
		expect(runFolderResearch).toHaveBeenCalledWith(
			{
				tenantId: "t1",
				domain: "acme.com",
				displayName: "Acme",
				hint: null,
				model: "anthropic/claude-sonnet",
			},
			{},
		);
		expect(state.redirected).toBe("/empezar/acme/carpetas");
	});

	it("hint domain_taken → code domain_taken", async () => {
		state.rpc = { data: null, error: { code: "23514", hint: "domain_taken" } };
		const result = await createCompany(
			form({ display_name: "Acme", domain: "acme.com" }),
		);
		expect(result).toMatchObject({ ok: false, code: "domain_taken" });
		expect(after).not.toHaveBeenCalled();
	});

	it("hint desconocido → generic", async () => {
		state.rpc = { data: null, error: { code: "XX000" } };
		const result = await createCompany(
			form({ display_name: "Acme", domain: "acme.com" }),
		);
		expect(result).toMatchObject({ ok: false, code: "generic" });
	});

	it("dominio público no llega a la rpc", async () => {
		const result = await createCompany(
			form({ display_name: "Acme", domain: "gmail.com" }),
		);
		expect(result).toMatchObject({ ok: false, code: "public_domain" });
		expect(state.rpcCalls).toEqual([]);
	});

	it("nombre vacío → invalid", async () => {
		const result = await createCompany(
			form({ display_name: "  ", domain: "acme.com" }),
		);
		expect(result).toMatchObject({ ok: false, code: "invalid" });
		expect(state.rpcCalls).toEqual([]);
	});
});
