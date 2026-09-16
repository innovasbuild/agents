import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dobles de las clases de @vercel/connect que isConnectAuthError e
// isConnectorNotInstalledError distinguen. No se puede usar las reales: solo
// lib/connectors/auth.ts puede importar @vercel/connect
// (tests/connectors/import-rule.test.ts lo hace cumplir), y acá se mockea el
// módulo entero.
class FakeConnectAuthError extends Error {}
class FakeConnectorNotInstalledError extends Error {}

const hasEnabledBinding = vi.fn(async () => true);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/outreach/store", () => ({
	createSupabaseOutreachStore: () => ({ kind: "store" }),
}));
vi.mock("@/lib/connectors/bindings", () => ({ hasEnabledBinding }));
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
	isConnectAuthError: (error: unknown) => error instanceof FakeConnectAuthError,
	isConnectorNotInstalledError: (error: unknown) =>
		error instanceof FakeConnectorNotInstalledError,
}));
vi.mock("@/lib/outreach/crm-session", () => ({
	crmForSession: async (ctx: {
		getToken: () => Promise<{ token: string }>;
		requireAuth: () => never;
	}) => {
		// El contexto web tiene que lanzar, no pausar: se prueba invocándolo.
		expect(() => ctx.requireAuth()).toThrow();
		// Ejercita tokenOrReauth del lado de HubSpot, igual que crmForSession
		// real (llama ctx.getToken antes de armar el adapter).
		await ctx.getToken();
		return { adapter: { kind: "crm" }, raw: { kind: "raw" } };
	},
	HUBSPOT_AUTH_OPTIONS: { authKey: "hubspot", displayName: "HubSpot" },
}));

const { webSendDeps, WebBindingMissing, WebReauthRequired } = await import(
	"@/lib/outreach/web-context"
);

const caller = {
	tenantId: "t1",
	userId: "u1",
	role: "tenant_member",
	email: "mati@innov.as",
};

describe("webSendDeps", () => {
	const envAntes = process.env.NEXT_PUBLIC_SUPABASE_URL;

	beforeEach(() => {
		tokenForSubject.mockClear();
		hasEnabledBinding.mockReset().mockResolvedValue(true);
	});

	afterEach(() => {
		// Asignar undefined acá no borra la variable: process.env coacciona
		// cualquier valor asignado a string, así que process.env.X = undefined
		// deja la STRING "undefined" (4 caracteres, truthy) en vez de vaciarla.
		if (envAntes === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
		else process.env.NEXT_PUBLIC_SUPABASE_URL = envAntes;
	});

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

	it("traduce un grant de Gmail vencido en WebReauthRequired('google')", async () => {
		// Fix round 1, hallazgo 1: hasEnabledBinding solo mira si el tenant
		// configuró el binding; esto cubre el caso normal de OAuth, el grant
		// que se configuró pero venció (tokenForSubject pega directo contra
		// Connect y tira su propio error, que antes nadie traducía).
		tokenForSubject.mockRejectedValueOnce(new FakeConnectAuthError("vencido"));

		const error = await webSendDeps(caller).catch((e) => e);

		expect(error).toBeInstanceOf(WebReauthRequired);
		expect(error.provider).toBe("google");
	});

	it("traduce un grant de HubSpot vencido en WebReauthRequired('hubspot')", async () => {
		// La primera llamada a tokenForSubject es la de Gmail (webSendDeps la
		// pide antes de armar el CRM, y tiene que salir bien acá); la segunda
		// es la que hace webCrmContext.getToken dentro de crmForSession, y es
		// la que se hace fallar para aislar el camino de HubSpot.
		tokenForSubject.mockResolvedValueOnce({ token: "tok-gmail", expiresAt: 0 });
		tokenForSubject.mockRejectedValueOnce(new FakeConnectAuthError("vencido"));

		const error = await webSendDeps(caller).catch((e) => e);

		expect(error).toBeInstanceOf(WebReauthRequired);
		expect(error.provider).toBe("hubspot");
	});

	it("no traduce un error de Connect que no es de autorización: no tapa un 500 o un problema de red", async () => {
		const boom = new Error("Connect devolvió 500");
		tokenForSubject.mockRejectedValueOnce(boom);

		await expect(webSendDeps(caller)).rejects.toBe(boom);
	});

	it("propaga el issuer del canal de eve al pedir el token, no un subject distinto (hallazgo 2)", async () => {
		process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";

		await webSendDeps(caller);

		expect(tokenForSubject.mock.calls[0]?.[1]).toMatchObject({
			tenantId: "t1",
			userId: "u1",
			issuer: "http://127.0.0.1:54321",
		});
	});

	it("sin binding de Gmail habilitado, tira WebBindingMissing('google') sin pedir token (hallazgo 3)", async () => {
		hasEnabledBinding.mockResolvedValue(false);

		const error = await webSendDeps(caller).catch((e) => e);

		expect(error).toBeInstanceOf(WebBindingMissing);
		expect(error.provider).toBe("google");
		expect(tokenForSubject).not.toHaveBeenCalled();
	});

	it("un conector no instalado en Connect tira WebBindingMissing, no WebReauthRequired (hallazgo 3)", async () => {
		// A diferencia del binding apagado (arriba), acá el tenant sí tiene la
		// fila habilitada pero Connect nunca tuvo el conector instalado:
		// mismo resultado — no se arregla autorizando — por eso comparte clase.
		tokenForSubject.mockRejectedValueOnce(
			new FakeConnectorNotInstalledError("no instalado"),
		);

		const error = await webSendDeps(caller).catch((e) => e);

		expect(error).toBeInstanceOf(WebBindingMissing);
		expect(error.provider).toBe("google");
	});
});
