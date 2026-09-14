import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	hasBinding: true,
	ensureError: null as Error | null,
	requireAuthCalls: 0,
}));

vi.mock("../../lib/connectors/bindings", () => ({
	hasEnabledBinding: async () => state.hasBinding,
}));
vi.mock("../../lib/connectors/auth", () => ({
	tenantScopedConnect: (connector: string, tenantId: string) => ({
		connector,
		tenantId,
	}),
}));
vi.mock("../../lib/connectors/crm/hubspot", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/lib/connectors/crm/hubspot")>();
	return {
		...original,
		ensureOutreachProperties: async () => {
			if (state.ensureError) throw state.ensureError;
			return { created: ["contact_key"], existing: [] };
		},
	};
});

const { default: tool } = await import(
	"@/agents/outreach/tools/crm_setup_outreach_properties"
);
const { HubSpotUnauthorizedError } = await import(
	"@/lib/connectors/crm/hubspot"
);

function ctx(role: string, principalType = "user") {
	return {
		session: {
			auth: {
				current: {
					principalType,
					principalId: "user-1",
					attributes: { tenantId: "tenant-a", role },
				},
			},
		},
		getToken: async () => ({ token: "tok" }),
		requireAuth: () => {
			state.requireAuthCalls += 1;
			throw new Error("auth requerida");
		},
	};
}

// biome-ignore lint/suspicious/noExplicitAny: el ctx de eve se simula parcialmente.
const run = (context: any) => (tool as any).execute({}, context);

beforeEach(() => {
	state.hasBinding = true;
	state.ensureError = null;
	state.requireAuthCalls = 0;
});

describe("crm_setup_outreach_properties", () => {
	it("pide aprobación siempre", () => {
		expect((tool as { approval?: unknown }).approval).toBeDefined();
	});

	it("un tenant_admin crea las propiedades", async () => {
		expect(await run(ctx("tenant_admin"))).toEqual({
			created: ["contact_key"],
			existing: [],
		});
	});

	it("rechaza a un tenant_member", async () => {
		await expect(run(ctx("tenant_member"))).rejects.toThrow(/tenant_admin/);
	});

	it("rechaza un tenant sin HubSpot", async () => {
		state.hasBinding = false;
		await expect(run(ctx("platform_admin"))).rejects.toThrow(/HubSpot/);
	});

	it("un 401 dispara requireAuth", async () => {
		state.ensureError = new HubSpotUnauthorizedError();
		await expect(run(ctx("tenant_admin"))).rejects.toThrow();
		expect(state.requireAuthCalls).toBe(1);
	});
});
