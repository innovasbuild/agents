import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	session: {
		caller: {
			tenantId: "t1",
			userId: "u1",
			role: "tenant_member",
			email: "ana@acme.test",
		},
		tenant: { id: "t1", slug: "acme" },
	} as {
		caller: { tenantId: string; userId: string; role: string; email: string };
		tenant: { id: string; slug: string };
	} | null,
	connections: [
		{ capability: "crm", provider: "hubspot", enabled: true },
		{ capability: "mail", provider: "gmail", enabled: true },
	] as { capability: string; provider: string; enabled: boolean }[],
	executor: { user_id: "u1" } as { user_id: string } | null,
	startCalls: [] as { connector: string; who: unknown; scopes: unknown }[],
	startThrows: null as Error | null,
}));

vi.mock("@/lib/outreach/web-session", () => ({
	webSession: async () => state.session,
}));
vi.mock("@/lib/outreach/web-context", () => ({
	connectSubjectIssuer: () => "https://sb.test",
}));
vi.mock("@/lib/gmail/send", () => ({
	GMAIL_SCOPES: ["gmail.send", "gmail.readonly"],
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) => {
			const q = {
				select: () => q,
				eq: () => q,
				maybeSingle: async () => ({ data: state.executor, error: null }),
				// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
				then: (resolve: (v: unknown) => unknown) =>
					Promise.resolve({
						data: table === "tenant_connections" ? state.connections : [],
						error: null,
					}).then(resolve),
			};
			return q;
		},
	}),
}));
vi.mock("@/lib/connectors/auth", () => ({
	startAuthorizationForSubject: async (
		connector: string,
		who: unknown,
		scopes: unknown,
	) => {
		state.startCalls.push({ connector, who, scopes });
		if (state.startThrows) throw state.startThrows;
		return { url: "https://connect.test/autorizar", expiresAt: null };
	},
}));

const { startAccountAuthorization } = await import(
	"@/app/[tenant]/mis-cuentas/actions"
);

beforeEach(() => {
	state.session = {
		caller: {
			tenantId: "t1",
			userId: "u1",
			role: "tenant_member",
			email: "ana@acme.test",
		},
		tenant: { id: "t1", slug: "acme" },
	};
	state.connections = [
		{ capability: "crm", provider: "hubspot", enabled: true },
		{ capability: "mail", provider: "gmail", enabled: true },
	];
	state.executor = { user_id: "u1" };
	state.startCalls = [];
	state.startThrows = null;
});

describe("startAccountAuthorization", () => {
	it("Gmail: pide la autorización para el sujeto de la sesión con los scopes completos", async () => {
		expect(await startAccountAuthorization("acme", "gmail")).toEqual({
			ok: true,
			url: "https://connect.test/autorizar",
		});
		expect(state.startCalls).toEqual([
			{
				connector: "google/google",
				who: { tenantId: "t1", userId: "u1", issuer: "https://sb.test" },
				scopes: ["gmail.send", "gmail.readonly"],
			},
		]);
	});

	it("HubSpot: sin scopes", async () => {
		await startAccountAuthorization("acme", "hubspot");
		expect(state.startCalls[0]).toMatchObject({
			connector: "mcp.hubspot.com/hubspot",
			scopes: undefined,
		});
	});

	it("sin sesión no llama a Connect", async () => {
		state.session = null;
		expect(await startAccountAuthorization("acme", "gmail")).toEqual({
			ok: false,
			message: "Volvé a entrar: no hay sesión.",
		});
		expect(state.startCalls).toHaveLength(0);
	});

	it.each(["outlook", "", "__proto__", "toString"])(
		"la cuenta %s no existe y no llama a Connect",
		async (key) => {
			expect((await startAccountAuthorization("acme", key)).ok).toBe(false);
			expect(state.startCalls).toHaveLength(0);
		},
	);

	it("Gmail para quien no es ejecutor no llama a Connect", async () => {
		state.executor = null;
		expect(await startAccountAuthorization("acme", "gmail")).toEqual({
			ok: false,
			message: "Esa cuenta no está disponible para vos.",
		});
		expect(state.startCalls).toHaveLength(0);
	});

	it("una cuenta que la empresa no tiene habilitada no llama a Connect", async () => {
		state.connections = [];
		expect((await startAccountAuthorization("acme", "hubspot")).ok).toBe(false);
		expect(state.startCalls).toHaveLength(0);
	});

	it("si Connect falla, lo dice sin detalle y lo registra", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.startThrows = new Error("connect caído");
			expect(await startAccountAuthorization("acme", "hubspot")).toEqual({
				ok: false,
				message: "No pude arrancar la autorización. Probá de nuevo.",
			});
			expect(log).toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});
});
