import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type McpChannelAuthDeps,
	resolveMcpChannelAuth,
} from "@/lib/agents/mcp-channel-auth";

function deps(overrides: Partial<McpChannelAuthDeps> = {}): McpChannelAuthDeps {
	return {
		verify: async (token) =>
			token === "vencido" ? null : { sub: token, email: `${token}@a.test` },
		tenantBySlug: async (slug) =>
			slug === "a"
				? { id: "tenant-a", active: true }
				: slug === "inactivo"
					? { id: "tenant-inactivo", active: false }
					: null,
		membershipsOf: async (userId) =>
			userId === "ana"
				? [{ tenantId: "tenant-a", role: "tenant_member" }]
				: userId === "admin"
					? [{ tenantId: "tenant-a", role: "tenant_admin" }]
					: userId === "root"
						? [{ tenantId: "tenant-x", role: "platform_admin" }]
						: userId === "falso"
							? [{ tenantId: "tenant-b", role: "platform_admin" }]
							: [],
		// tenant-x es el dueño de la plataforma en estas pruebas.
		platformOwnerTenantId: async () => "tenant-x",
		...overrides,
	};
}

function request(bearer: string | null, tenant: string | null) {
	const url = new URL("https://agentes.innov.as/eve/v1/mcp");
	if (tenant !== null) url.searchParams.set("tenant", tenant);
	const headers = new Headers();
	if (bearer !== null) headers.set("authorization", `Bearer ${bearer}`);
	return new Request(url, { headers });
}

describe("resolveMcpChannelAuth", () => {
	beforeEach(() => {
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.co");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("un miembro entra a su tenant, con su role", async () => {
		expect(await resolveMcpChannelAuth(request("ana", "a"), deps())).toEqual({
			ok: true,
			sessionAuth: {
				authenticator: "oauth",
				issuer: "https://proyecto.supabase.co",
				principalId: "ana",
				principalType: "user",
				subject: "tenant-a:ana",
				attributes: {
					email: "ana@a.test",
					tenantId: "tenant-a",
					tenantSlug: "a",
					role: "tenant_member",
				},
			},
		});
	});

	it("un platform_admin del tenant dueño, sin fila propia en ese tenant, igual entra, con role platform_admin", async () => {
		const result = await resolveMcpChannelAuth(request("root", "a"), deps());
		expect(result).toMatchObject({
			ok: true,
			sessionAuth: {
				attributes: { tenantId: "tenant-a", role: "platform_admin" },
			},
		});
	});

	it("sin token es unauthenticated", async () => {
		expect(await resolveMcpChannelAuth(request(null, "a"), deps())).toEqual({
			ok: false,
			kind: "unauthenticated",
			message: expect.any(String),
		});
	});

	it("un token que el verificador rechaza es unauthenticated", async () => {
		expect(
			await resolveMcpChannelAuth(request("vencido", "a"), deps()),
		).toMatchObject({
			ok: false,
			kind: "unauthenticated",
		});
	});

	it("un verificador que explota es unauthenticated, no una excepción", async () => {
		const throwing = deps({
			verify: async () => {
				throw new SyntaxError("token roto");
			},
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await resolveMcpChannelAuth(request("roto", "a"), throwing);
		expect(result).toMatchObject({ ok: false, kind: "unauthenticated" });
		expect(JSON.stringify(result)).not.toContain("token roto");
		warn.mockRestore();
	});

	it("sin ?tenant en la URL es forbidden con mensaje propio", async () => {
		expect(await resolveMcpChannelAuth(request("ana", null), deps())).toEqual({
			ok: false,
			kind: "forbidden",
			message: expect.stringContaining("tenant"),
		});
	});

	it("un tenant inexistente o inactivo da el mismo mensaje para quien no es platform_admin", async () => {
		const inexistente = await resolveMcpChannelAuth(
			request("ana", "zzz"),
			deps(),
		);
		const inactivo = await resolveMcpChannelAuth(
			request("ana", "inactivo"),
			deps(),
		);
		expect(inexistente).toMatchObject({ ok: false, kind: "forbidden" });
		expect(inactivo).toMatchObject({ ok: false, kind: "forbidden" });
		expect((inexistente as { message: string }).message).toBe(
			(inactivo as { message: string }).message,
		);
	});

	it("un platform_admin sí distingue el tenant inexistente (oráculo solo para quien ya tiene el máximo acceso)", async () => {
		const noAdmin = await resolveMcpChannelAuth(request("ana", "zzz"), deps());
		const admin = await resolveMcpChannelAuth(request("root", "zzz"), deps());
		expect((noAdmin as { message: string }).message).not.toBe(
			(admin as { message: string }).message,
		);
	});

	it("sin membresía en un tenant que sí existe: mismo mensaje que un tenant inexistente (sin oráculo)", async () => {
		// ana solo tiene membresía en tenant-a (ver deps()); acá se conecta a un
		// tenant-b real donde no tiene ninguna fila. Si alguien cambia el
		// mensaje de una rama sin tocar la otra, esta comparación tiene que
		// fallar: es la propiedad de seguridad de F4, no solo el "kind".
		const sinMembresiaAhi = deps({
			tenantBySlug: async (slug) =>
				slug === "b" ? { id: "tenant-b", active: true } : null,
		});
		const sinMembresia = await resolveMcpChannelAuth(
			request("ana", "b"),
			sinMembresiaAhi,
		);
		const inexistente = await resolveMcpChannelAuth(
			request("ana", "zzz"),
			deps(),
		);
		expect(sinMembresia).toMatchObject({ ok: false, kind: "forbidden" });
		expect((sinMembresia as { message: string }).message).toBe(
			(inexistente as { message: string }).message,
		);
	});

	it("un error de la base al leer membresías o tenant da forbidden, sin filtrar el motivo", async () => {
		const throwing = deps({
			membershipsOf: async () => {
				throw new Error("conexión a postgres perdida");
			},
		});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await resolveMcpChannelAuth(request("ana", "a"), throwing);
		expect(result).toMatchObject({ ok: false, kind: "forbidden" });
		expect(JSON.stringify(result)).not.toContain("conexión a postgres perdida");
		error.mockRestore();
	});

	it("el issuer de la sesión es el mismo que el del canal del dashboard (sin /auth/v1): Connect ve la misma identidad", async () => {
		const result = await resolveMcpChannelAuth(request("ana", "a"), deps());
		expect(result).toMatchObject({
			ok: true,
			sessionAuth: { issuer: process.env.NEXT_PUBLIC_SUPABASE_URL },
		});
		expect(
			(result as { sessionAuth: { issuer: string } }).sessionAuth.issuer,
		).not.toMatch(/\/auth\/v1$/);
	});

	it("el mismo usuario en dos tenants tiene dos subject distintos: sus invocaciones no se cruzan", async () => {
		const dosTenants = deps({
			tenantBySlug: async (slug) =>
				slug === "a"
					? { id: "tenant-a", active: true }
					: slug === "b"
						? { id: "tenant-b", active: true }
						: null,
			membershipsOf: async () => [
				{ tenantId: "tenant-a", role: "tenant_member" },
				{ tenantId: "tenant-b", role: "tenant_member" },
			],
		});
		const enA = await resolveMcpChannelAuth(request("ana", "a"), dosTenants);
		const enB = await resolveMcpChannelAuth(request("ana", "b"), dosTenants);
		const subjectA = (enA as { sessionAuth: { subject: string } }).sessionAuth
			.subject;
		const subjectB = (enB as { sessionAuth: { subject: string } }).sessionAuth
			.subject;
		expect(subjectA).not.toBe(subjectB);
		expect(enA).toMatchObject({ sessionAuth: { principalId: "ana" } });
		expect(enB).toMatchObject({ sessionAuth: { principalId: "ana" } });
	});
	describe("el rol de plataforma solo vale en el tenant dueño (spec consola §3)", () => {
		const conTenantB = (overrides: Partial<McpChannelAuthDeps> = {}) =>
			deps({
				tenantBySlug: async (slug) =>
					slug === "a"
						? { id: "tenant-a", active: true }
						: slug === "b"
							? { id: "tenant-b", active: true }
							: null,
				...overrides,
			});

		it("una fila platform_admin fuera del tenant dueño no abre otros tenants", async () => {
			const result = await resolveMcpChannelAuth(
				request("falso", "a"),
				conTenantB(),
			);
			expect(result).toMatchObject({ ok: false, kind: "forbidden" });
		});

		it("esa fila vale como tenant_admin de su propio tenant, nunca como platform_admin", async () => {
			const result = await resolveMcpChannelAuth(
				request("falso", "b"),
				conTenantB(),
			);
			expect(result).toMatchObject({
				ok: true,
				sessionAuth: {
					attributes: { tenantId: "tenant-b", role: "tenant_admin" },
				},
			});
		});

		it("quien no es de plataforma recibe el mismo mensaje exista o no el cliente (sin oráculo)", async () => {
			const existe = await resolveMcpChannelAuth(
				request("falso", "a"),
				conTenantB(),
			);
			const noExiste = await resolveMcpChannelAuth(
				request("falso", "zzz"),
				conTenantB(),
			);
			expect((existe as { message: string }).message).toBe(
				(noExiste as { message: string }).message,
			);
		});

		it("sin tenant dueño configurado nadie entra como plataforma", async () => {
			const sinDueno = deps({ platformOwnerTenantId: async () => null });
			const entra = await resolveMcpChannelAuth(request("root", "a"), sinDueno);
			const inexistente = await resolveMcpChannelAuth(
				request("root", "zzz"),
				sinDueno,
			);
			const comun = await resolveMcpChannelAuth(
				request("ana", "zzz"),
				sinDueno,
			);

			expect(entra).toMatchObject({ ok: false, kind: "forbidden" });
			expect((inexistente as { message: string }).message).toBe(
				(comun as { message: string }).message,
			);
		});

		it("el tenant dueño solo se consulta si el usuario tiene alguna fila platform_admin", async () => {
			const platformOwnerTenantId = vi.fn(async () => "tenant-x");

			await resolveMcpChannelAuth(
				request("ana", "a"),
				deps({ platformOwnerTenantId }),
			);
			expect(platformOwnerTenantId).not.toHaveBeenCalled();

			await resolveMcpChannelAuth(
				request("root", "a"),
				deps({ platformOwnerTenantId }),
			);
			expect(platformOwnerTenantId).toHaveBeenCalledTimes(1);
		});

		it("un error al leer el tenant dueño da forbidden, sin filtrar el motivo", async () => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			const result = await resolveMcpChannelAuth(
				request("root", "a"),
				deps({
					platformOwnerTenantId: async () => {
						throw new Error("conexión a postgres perdida");
					},
				}),
			);

			expect(result).toMatchObject({ ok: false, kind: "forbidden" });
			expect(JSON.stringify(result)).not.toContain("conexión a postgres");
			error.mockRestore();
		});
	});
});
