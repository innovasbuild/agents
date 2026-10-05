import { describe, expect, it, vi } from "vitest";
import { brandFromRow, type TenantRow } from "@/lib/tenants/resolve";

describe("brandFromRow", () => {
	it("lee los colores del jsonb", () => {
		const row = {
			brand: {
				primary: "#1D4ED8",
				secondary: "#0F172A",
				logo_url: "innovas/logo.png",
			},
		} as unknown as TenantRow;

		expect(brandFromRow(row)).toEqual({
			primary: "#1D4ED8",
			secondary: "#0F172A",
			logoUrl: "innovas/logo.png",
		});
	});

	it("tolera una marca vacía", () => {
		expect(brandFromRow({ brand: {} } as unknown as TenantRow)).toEqual({});
	});

	it("ignora valores que no son string", () => {
		const row = {
			brand: { primary: 42, secondary: null },
		} as unknown as TenantRow;
		expect(brandFromRow(row)).toEqual({});
	});
});

describe("resolveTenantAccess", () => {
	const TENANT = {
		id: "t1",
		slug: "demo",
		display_name: "Demo",
		default_model: "anthropic/claude-sonnet-5",
		allowed_models: ["anthropic/claude-sonnet-5"],
		brand: {},
	};

	async function resolveWith(opts: {
		ownerAdmin: boolean;
		localRole: string | null;
		user?: boolean;
	}) {
		vi.resetModules();
		vi.doMock("@/lib/supabase/server", () => ({
			createServerSupabase: async () => ({
				auth: {
					getUser: async () => ({
						data: { user: opts.user === false ? null : { id: "u1" } },
					}),
				},
				from: (table: string) => {
					const builder = {
						select: () => builder,
						eq: () => builder,
						maybeSingle: async () => ({
							data:
								table === "tenants"
									? TENANT
									: opts.localRole
										? { role: opts.localRole }
										: null,
						}),
					};
					return builder;
				},
			}),
		}));
		vi.doMock("@/lib/tenants/platform", () => ({
			isPlatformOwnerAdmin: async () => opts.ownerAdmin,
		}));
		const { resolveTenantAccess } = await import("@/lib/tenants/resolve");
		return resolveTenantAccess("demo");
	}

	it("deja entrar al platform_admin del dueño a un tenant sin membership local", async () => {
		const access = await resolveWith({ ownerAdmin: true, localRole: null });

		expect(access?.role).toBe("platform_admin");
	});

	it("platform_admin del dueño gana sobre una membership local de tenant_member", async () => {
		const access = await resolveWith({
			ownerAdmin: true,
			localRole: "tenant_member",
		});

		expect(access?.role).toBe("platform_admin");
	});

	it("una fila platform_admin fuera del tenant dueño vale como tenant_admin", async () => {
		const access = await resolveWith({
			ownerAdmin: false,
			localRole: "platform_admin",
		});

		expect(access?.role).toBe("tenant_admin");
	});

	it("sin ser dueño, el rol local es el que manda", async () => {
		const access = await resolveWith({
			ownerAdmin: false,
			localRole: "tenant_member",
		});

		expect(access?.role).toBe("tenant_member");
	});

	it("sin ser dueño ni miembro no hay acceso", async () => {
		const access = await resolveWith({ ownerAdmin: false, localRole: null });

		expect(access).toBeNull();
	});

	it("sin sesión no hay acceso", async () => {
		const access = await resolveWith({
			ownerAdmin: true,
			localRole: null,
			user: false,
		});

		expect(access).toBeNull();
	});
});
