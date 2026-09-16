import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const resolveTenantAccess = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/tenants/resolve", () => ({ resolveTenantAccess }));

const { webSession } = await import("@/lib/outreach/web-session");

const TENANT = {
	id: "t1",
	slug: "innovas",
	displayName: "INNOV.AS",
	role: "tenant_member" as const,
	defaultModel: "anthropic/claude-sonnet-5",
	allowedModels: [],
	brand: {},
};

describe("webSession", () => {
	beforeEach(() => {
		getUser.mockReset();
		resolveTenantAccess.mockReset();
	});

	it("arma el caller con el tenant del slug y el usuario de la sesión", async () => {
		getUser.mockResolvedValue({
			data: { user: { id: "u1", email: "mati@innov.as" } },
		});
		resolveTenantAccess.mockResolvedValue(TENANT);

		const result = await webSession("innovas");

		expect(result?.caller).toEqual({
			tenantId: "t1",
			userId: "u1",
			role: "tenant_member",
			email: "mati@innov.as",
		});
	});

	it("devuelve null si el usuario no es miembro del tenant", async () => {
		getUser.mockResolvedValue({ data: { user: { id: "u1", email: "x@y.z" } } });
		resolveTenantAccess.mockResolvedValue(null);

		expect(await webSession("ajeno")).toBeNull();
	});

	it("devuelve null sin sesión, sin llegar a mirar el tenant", async () => {
		getUser.mockResolvedValue({ data: { user: null } });

		expect(await webSession("innovas")).toBeNull();
		expect(resolveTenantAccess).not.toHaveBeenCalled();
	});
});
