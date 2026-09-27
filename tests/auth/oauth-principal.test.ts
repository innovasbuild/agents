import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
	createClient: () => ({ auth: { getClaims } }),
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

const { createOAuthClaimsVerifier, loadMemberships, loadTenantBySlug } =
	await import("@/lib/auth/oauth-principal");

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
