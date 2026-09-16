import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	getToken: [] as unknown[][],
	connect: [] as Record<string, unknown>[],
}));

// vi.fn (no una función suelta) porque un test de startAuthorizationForSubject
// necesita pisar su resolución una sola vez (el caso sin expiresAt).
const startAuthorization = vi.hoisted(() =>
	vi.fn(
		async (
			..._args: unknown[]
		): Promise<{
			request: string;
			verifier: string;
			url: string;
			expiresAt?: number;
		}> => ({
			request: "req_1",
			verifier: "ver_1",
			url: "https://vercel.com/connect/authorize/req_1",
			expiresAt: 1_789_325_386_769,
		}),
	),
);

// Dobles de las dos clases que isConnectAuthError distingue (ver
// dist/token.js de @vercel/connect: `no_token` y
// `user_authorization_required`), más una tercera para probar que un
// ConnectError que no es ninguna de esas dos no se confunde con un pedido
// de reautorización.
const { NoValidTokenError, UserAuthorizationRequiredError, ConnectError } =
	vi.hoisted(() => {
		class ConnectError extends Error {}
		class NoValidTokenError extends ConnectError {}
		class UserAuthorizationRequiredError extends ConnectError {}
		return { ConnectError, NoValidTokenError, UserAuthorizationRequiredError };
	});

vi.mock("@vercel/connect", () => ({
	getToken: async (...args: unknown[]) => {
		calls.getToken.push(args);
		return "llave-simulada";
	},
	getTokenResponse: async (...args: unknown[]) => {
		calls.getToken.push(args);
		return { token: "llave-simulada", expiresAt: 1_789_325_386_769 };
	},
	startAuthorization,
	ConnectError,
	NoValidTokenError,
	UserAuthorizationRequiredError,
}));

vi.mock("@vercel/connect/eve", () => ({
	connect: (options: Record<string, unknown>) => {
		calls.connect.push(options);
		return { principalType: "user", options };
	},
}));

const {
	apiKeyBearer,
	apiKeyHeaders,
	isConnectAuthError,
	startAuthorizationForSubject,
	tenantScopedConnect,
	tenantSubjectId,
	tokenForSubject,
} = await import("@/lib/connectors/auth");

type CreateSubject = (principal: {
	type: "user" | "app";
	id?: string;
	issuer?: string;
}) => { type: string; id: string; issuer?: string };

beforeEach(() => {
	calls.getToken = [];
	calls.connect = [];
	startAuthorization.mockClear();
});

describe("apiKeyHeaders", () => {
	it("pide la llave al conector del binding como app y la pone en el header", async () => {
		const headers = apiKeyHeaders("innovas-brain", "x-api-key");
		expect(await headers()).toEqual({ "x-api-key": "llave-simulada" });
		expect(calls.getToken[0]).toEqual([
			"innovas-brain",
			{ subject: { type: "app" } },
		]);
	});

	it("suma headers fijos sin pisar la llave", async () => {
		const headers = apiKeyHeaders("innovas-places", "X-Goog-Api-Key", {
			"X-Goog-FieldMask": "places.id",
		});
		expect(await headers()).toEqual({
			"X-Goog-Api-Key": "llave-simulada",
			"X-Goog-FieldMask": "places.id",
		});
	});
});

describe("apiKeyBearer", () => {
	it("devuelve la llave como token con el vencimiento de Connect", async () => {
		expect(await apiKeyBearer("innovas-coldiq").getToken()).toEqual({
			token: "llave-simulada",
			expiresAt: 1_789_325_386_769,
		});
		expect(calls.getToken[0]).toEqual([
			"innovas-coldiq",
			{ subject: { type: "app" } },
		]);
	});
});

describe("tenantScopedConnect", () => {
	it("ata el grant a tenant:usuario", () => {
		tenantScopedConnect("hubspot-mcp", "tenant-a");
		const createSubject = calls.connect[0].createSubject as CreateSubject;
		expect(
			createSubject({ type: "user", id: "user-1", issuer: "https://sb" }),
		).toEqual({ type: "user", id: "tenant-a:user-1", issuer: "https://sb" });
	});

	it("el mismo usuario en dos tenants da dos subjects distintos", () => {
		tenantScopedConnect("hubspot-mcp", "tenant-a");
		tenantScopedConnect("hubspot-mcp", "tenant-b");
		const principal = { type: "user" as const, id: "user-1" };
		const a = (calls.connect[0].createSubject as CreateSubject)(principal);
		const b = (calls.connect[1].createSubject as CreateSubject)(principal);
		expect(a.id).not.toBe(b.id);
	});

	it("rechaza un principal app", () => {
		tenantScopedConnect("hubspot-mcp", "tenant-a");
		const createSubject = calls.connect[0].createSubject as CreateSubject;
		expect(() => createSubject({ type: "app" })).toThrow();
	});

	it("rechaza tenant vacío", () => {
		expect(() => tenantScopedConnect("hubspot-mcp", "")).toThrow();
	});

	it("pasa los scopes a Connect", () => {
		tenantScopedConnect("google", "tenant-a", ["https://mail.google.com/x"]);
		expect(calls.connect[0].tokenParams).toEqual({
			scopes: ["https://mail.google.com/x"],
		});
	});

	it("arma el id del subject con separador fijo", () => {
		expect(tenantSubjectId("t", "u")).toBe("t:u");
	});
});

describe("tokenForSubject", () => {
	it("pide el token del subject tenant:usuario con los scopes, sin sesión", async () => {
		const response = await tokenForSubject(
			"google/google",
			{ tenantId: "tenant-1", userId: "user-1" },
			["https://www.googleapis.com/auth/gmail.readonly"],
		);
		expect(response).toEqual({
			token: "llave-simulada",
			expiresAt: 1_789_325_386_769,
		});
		expect(calls.getToken[0]).toEqual([
			"google/google",
			{
				subject: { type: "user", id: "tenant-1:user-1" },
				scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
			},
		]);
	});

	it("incluye el issuer cuando el grant se guardó con uno", async () => {
		await tokenForSubject("mcp.hubspot.com/hubspot", {
			tenantId: "tenant-1",
			userId: "user-1",
			issuer: "https://issuer.test",
		});
		expect(calls.getToken[0]).toEqual([
			"mcp.hubspot.com/hubspot",
			{
				subject: {
					type: "user",
					id: "tenant-1:user-1",
					issuer: "https://issuer.test",
				},
			},
		]);
	});

	it("rechaza sin tenant o sin usuario: nunca pide un grant sin aislar", async () => {
		await expect(
			tokenForSubject("google/google", { tenantId: "", userId: "user-1" }),
		).rejects.toThrow("tokenForSubject requiere tenant y usuario");
		await expect(
			tokenForSubject("google/google", { tenantId: "tenant-1", userId: "" }),
		).rejects.toThrow("tokenForSubject requiere tenant y usuario");
		expect(calls.getToken).toHaveLength(0);
	});
});

describe("startAuthorizationForSubject", () => {
	it("pide el link de autorización del subject tenant:usuario con los scopes", async () => {
		const response = await startAuthorizationForSubject(
			"google/google",
			{ tenantId: "tenant-1", userId: "user-1" },
			["https://www.googleapis.com/auth/gmail.readonly"],
		);
		expect(response).toEqual({
			url: "https://vercel.com/connect/authorize/req_1",
			expiresAt: 1_789_325_386_769,
		});
		expect(startAuthorization.mock.calls[0]).toEqual([
			"google/google",
			{
				subject: { type: "user", id: "tenant-1:user-1" },
				scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
			},
		]);
	});

	it("incluye el issuer cuando el grant se guardó con uno", async () => {
		await startAuthorizationForSubject("mcp.hubspot.com/hubspot", {
			tenantId: "tenant-1",
			userId: "user-1",
			issuer: "https://issuer.test",
		});
		expect(startAuthorization.mock.calls[0]).toEqual([
			"mcp.hubspot.com/hubspot",
			{
				subject: {
					type: "user",
					id: "tenant-1:user-1",
					issuer: "https://issuer.test",
				},
			},
		]);
	});

	it("rechaza sin tenant o sin usuario: nunca pide un link sin aislar", async () => {
		await expect(
			startAuthorizationForSubject("google/google", {
				tenantId: "",
				userId: "user-1",
			}),
		).rejects.toThrow("startAuthorizationForSubject requiere tenant y usuario");
		await expect(
			startAuthorizationForSubject("google/google", {
				tenantId: "tenant-1",
				userId: "",
			}),
		).rejects.toThrow("startAuthorizationForSubject requiere tenant y usuario");
		expect(startAuthorization).not.toHaveBeenCalled();
	});

	it("cuando Connect no manda expiresAt, devuelve null en vez de undefined", async () => {
		// El mock de arriba siempre manda expiresAt; acá se pisa una vez para
		// el caso real en que Connect no lo manda.
		startAuthorization.mockResolvedValueOnce({
			request: "req_2",
			verifier: "ver_2",
			url: "https://vercel.com/connect/authorize/req_2",
		});

		const response = await startAuthorizationForSubject("google/google", {
			tenantId: "tenant-1",
			userId: "user-1",
		});
		expect(response).toEqual({
			url: "https://vercel.com/connect/authorize/req_2",
			expiresAt: null,
		});
	});
});

describe("isConnectAuthError", () => {
	it("reconoce un grant vencido o revocado (no_token)", () => {
		expect(isConnectAuthError(new NoValidTokenError("no valid token"))).toBe(
			true,
		);
	});

	it("reconoce un grant que nunca se dio (user_authorization_required)", () => {
		expect(
			isConnectAuthError(new UserAuthorizationRequiredError("auth required")),
		).toBe(true);
	});

	it("no confunde otro ConnectError (un 500 de Connect) con un pedido de reautorización", () => {
		expect(isConnectAuthError(new ConnectError("falló Connect"))).toBe(false);
	});

	it("no confunde un error cualquiera (de red, por ejemplo) con un pedido de reautorización", () => {
		expect(isConnectAuthError(new TypeError("fetch failed"))).toBe(false);
		expect(isConnectAuthError("no es ni un Error")).toBe(false);
	});
});
