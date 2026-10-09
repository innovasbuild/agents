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
		allows?: boolean | "error" | "throws";
	}) {
		const rpc = vi.fn(async (_fn: string, _args: { p_tenant: string }) => {
			if (opts.allows === "throws") throw new Error("red");
			if (opts.allows === "error") {
				return { data: null, error: { message: "x" } };
			}
			return { data: opts.allows ?? true, error: null };
		});
		vi.resetModules();
		vi.doMock("next/navigation", () => ({
			redirect: (url: string) => {
				throw new Error(`NEXT_REDIRECT:${url}`);
			},
		}));
		vi.doMock("@/lib/supabase/server", () => ({
			createServerSupabase: async () => ({
				auth: {
					getUser: async () => ({
						data: { user: opts.user === false ? null : { id: "u1" } },
					}),
				},
				rpc,
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
			platformOwnerAdminTenantId: async () =>
				opts.ownerAdmin ? "owner-1" : null,
			platformOwnerSlug: () => "innovas",
		}));
		const { resolveTenantAccess } = await import("@/lib/tenants/resolve");
		return { access: resolveTenantAccess("demo"), rpc };
	}

	it("deja entrar al platform_admin del dueño a un tenant sin membership local", async () => {
		const access = await (
			await resolveWith({ ownerAdmin: true, localRole: null })
		).access;

		expect(access?.role).toBe("platform_admin");
	});

	it("platform_admin del dueño gana sobre una membership local de tenant_member", async () => {
		const access = await (
			await resolveWith({
				ownerAdmin: true,
				localRole: "tenant_member",
			})
		).access;

		expect(access?.role).toBe("platform_admin");
	});

	it("una fila platform_admin fuera del tenant dueño vale como tenant_admin", async () => {
		const access = await (
			await resolveWith({
				ownerAdmin: false,
				localRole: "platform_admin",
			})
		).access;

		expect(access?.role).toBe("tenant_admin");
	});

	it("sin ser dueño, el rol local es el que manda", async () => {
		const access = await (
			await resolveWith({
				ownerAdmin: false,
				localRole: "tenant_member",
			})
		).access;

		expect(access?.role).toBe("tenant_member");
	});

	it("sin ser dueño ni miembro no hay acceso", async () => {
		const access = await (
			await resolveWith({ ownerAdmin: false, localRole: null })
		).access;

		expect(access).toBeNull();
	});

	it("sin sesión no hay acceso", async () => {
		const access = await (
			await resolveWith({
				ownerAdmin: true,
				localRole: null,
				user: false,
			})
		).access;

		expect(access).toBeNull();
	});

	it("un miembro se chequea contra la empresa de la URL", async () => {
		const { access, rpc } = await resolveWith({
			ownerAdmin: false,
			localRole: "tenant_member",
		});

		expect((await access)?.role).toBe("tenant_member");
		expect(rpc).toHaveBeenCalledWith("tenant_allows_login", { p_tenant: "t1" });
	});

	it("método no permitido: redirige a la landing de esa empresa", async () => {
		const { access } = await resolveWith({
			ownerAdmin: false,
			localRole: "tenant_member",
			allows: false,
		});

		await expect(access).rejects.toThrow(
			"NEXT_REDIRECT:/login/demo?error=metodo",
		);
	});

	it.each(["error", "throws"] as const)(
		"si el chequeo falla (%s), redirige",
		async (allows) => {
			const { access } = await resolveWith({
				ownerAdmin: false,
				localRole: "tenant_member",
				allows,
			});

			await expect(access).rejects.toThrow("NEXT_REDIRECT:/login/demo");
		},
	);

	it("un administrador de plataforma se chequea contra el tenant dueño, no contra el que visita", async () => {
		const { access, rpc } = await resolveWith({
			ownerAdmin: true,
			localRole: null,
		});

		expect((await access)?.role).toBe("platform_admin");
		expect(rpc).toHaveBeenCalledWith("tenant_allows_login", {
			p_tenant: "owner-1",
		});
	});

	it("un administrador de plataforma con método no permitido va a la landing del dueño", async () => {
		const { access } = await resolveWith({
			ownerAdmin: true,
			localRole: null,
			allows: false,
		});

		await expect(access).rejects.toThrow(
			"NEXT_REDIRECT:/login/innovas?error=metodo",
		);
	});

	it("sin sesión o sin rol no se llama al chequeo", async () => {
		const sinSesion = await resolveWith({
			ownerAdmin: false,
			localRole: "tenant_member",
			user: false,
		});
		expect(await sinSesion.access).toBeNull();
		expect(sinSesion.rpc).not.toHaveBeenCalled();

		const sinRol = await resolveWith({ ownerAdmin: false, localRole: null });
		expect(await sinRol.access).toBeNull();
		expect(sinRol.rpc).not.toHaveBeenCalled();
	});
});
