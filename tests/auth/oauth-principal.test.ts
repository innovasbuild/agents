import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const rpc = vi.fn();
const createClientCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("@supabase/supabase-js", () => ({
	createClient: (...args: unknown[]) => {
		createClientCalls.push(args);
		return { auth: { getClaims }, rpc };
	},
}));

const membershipsRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
const tenantRow = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from(table: string) {
			if (table === "memberships") {
				return {
					select: () => ({
						eq: async () => ({ data: membershipsRows.rows, error: null }),
					}),
				};
			}
			if (table === "tenants") {
				return {
					select: () => ({
						eq: () => ({
							maybeSingle: async () => ({ data: tenantRow.value, error: null }),
						}),
					}),
				};
			}
			throw new Error(`tabla inesperada en el mock: ${table}`);
		},
	}),
}));

const {
	createOAuthClaimsVerifier,
	loadMemberships,
	loadTenantBySlug,
	tokenAllowsLogin,
} = await import("@/lib/auth/oauth-principal");

beforeEach(() => {
	getClaims.mockReset();
	membershipsRows.rows = [];
	tenantRow.value = null;
});

describe("createOAuthClaimsVerifier", () => {
	it("devuelve los claims cuando el token es válido", async () => {
		getClaims.mockResolvedValue({
			data: { claims: { sub: "user-1", client_id: "claude" } },
			error: null,
		});
		const verify = createOAuthClaimsVerifier();
		expect(await verify("token")).toEqual({
			sub: "user-1",
			client_id: "claude",
		});
	});

	it("devuelve null si getClaims falla", async () => {
		getClaims.mockResolvedValue({ data: null, error: new Error("vencido") });
		const verify = createOAuthClaimsVerifier();
		expect(await verify("token")).toBeNull();
	});
});

describe("loadMemberships", () => {
	it("mapea tenant_id y role de cada fila", async () => {
		membershipsRows.rows = [
			{ tenant_id: "tenant-a", role: "tenant_admin" },
			{ tenant_id: "tenant-b", role: "platform_admin" },
		];
		expect(await loadMemberships("user-1")).toEqual([
			{ tenantId: "tenant-a", role: "tenant_admin" },
			{ tenantId: "tenant-b", role: "platform_admin" },
		]);
	});

	it("sin filas, lista vacía", async () => {
		expect(await loadMemberships("user-1")).toEqual([]);
	});
});

describe("loadTenantBySlug", () => {
	it("devuelve id y active cuando existe", async () => {
		tenantRow.value = { id: "tenant-a", active: true };
		expect(await loadTenantBySlug("a")).toEqual({
			id: "tenant-a",
			active: true,
		});
	});

	it("null cuando no existe", async () => {
		expect(await loadTenantBySlug("zzz")).toBeNull();
	});
});

describe("tokenAllowsLogin", () => {
	beforeEach(() => {
		rpc.mockReset();
		createClientCalls.length = 0;
	});

	it("pregunta a la base con el token de la persona, no con service role", async () => {
		rpc.mockResolvedValue({ data: true, error: null });
		expect(await tokenAllowsLogin("tok-1", "t-1")).toBe(true);
		expect(rpc).toHaveBeenCalledWith("tenant_allows_login", {
			p_tenant: "t-1",
		});
		expect(createClientCalls.at(-1)?.[2]).toMatchObject({
			global: { headers: { Authorization: "Bearer tok-1" } },
		});
	});

	it("si la base dice que no o el RPC falla, es falso", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		rpc.mockResolvedValue({ data: false, error: null });
		expect(await tokenAllowsLogin("tok-1", "t-1")).toBe(false);
		rpc.mockResolvedValue({ data: true, error: { message: "boom" } });
		expect(await tokenAllowsLogin("tok-1", "t-1")).toBe(false);
		error.mockRestore();
	});
});
