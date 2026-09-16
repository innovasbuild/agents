import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/outreach/store", () => ({
	createSupabaseOutreachStore: () => ({ kind: "store" }),
}));
vi.mock("@/lib/connectors/bindings", () => ({
	hasEnabledBinding: async () => true,
}));
vi.mock("@/lib/outreach/canon", () => ({
	brainForTenant: async () => ({ kind: "brain" }),
	loadCanon: async () => ({ available: true, pages: [], voice: [], rules: {} }),
}));

const tokenForSubject = vi.fn(
	async (
		_connector: string,
		_who: { tenantId: string; userId: string; issuer?: string },
		_scopes?: string[],
	) => ({ token: "tok", expiresAt: 0 }),
);
vi.mock("@/lib/connectors/auth", () => ({
	tokenForSubject,
	tenantScopedConnect: () => ({ kind: "provider" }),
}));
vi.mock("@/lib/outreach/crm-session", () => ({
	crmForSession: async (ctx: { requireAuth: () => never }) => {
		// El contexto web tiene que lanzar, no pausar: se prueba invocándolo.
		expect(() => ctx.requireAuth()).toThrow();
		return { adapter: { kind: "crm" }, raw: { kind: "raw" } };
	},
	HUBSPOT_AUTH_OPTIONS: { authKey: "hubspot", displayName: "HubSpot" },
}));

const { webSendDeps, WebReauthRequired } = await import(
	"@/lib/outreach/web-context"
);

const caller = {
	tenantId: "t1",
	userId: "u1",
	role: "tenant_member",
	email: "mati@innov.as",
};

describe("webSendDeps", () => {
	it("pide el token de Gmail con el conjunto exacto de scopes", async () => {
		await webSendDeps(caller);

		const scopes = tokenForSubject.mock.calls[0]?.[2] as string[];
		expect(scopes).toEqual([
			"https://www.googleapis.com/auth/gmail.send",
			"https://www.googleapis.com/auth/gmail.readonly",
		]);
	});

	it("ata el token al subject tenant:usuario", async () => {
		await webSendDeps(caller);

		expect(tokenForSubject.mock.calls[0]?.[1]).toEqual({
			tenantId: "t1",
			userId: "u1",
		});
	});

	it("WebReauthRequired identifica al proveedor que hay que reautorizar", () => {
		const error = new WebReauthRequired("google");
		expect(error.provider).toBe("google");
		expect(error).toBeInstanceOf(Error);
	});
});
