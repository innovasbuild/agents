import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AccessStore,
	resolveMcpAccess,
} from "@/lib/brain/mcp-server/access";
import type { BrainBinding } from "@/lib/brain/resolve";

const binding: BrainBinding = {
	id: "b1",
	tenantId: "tenant-a",
	provider: "wiki",
	config: {
		categories: ["comercial"],
		requiredFrontmatter: [],
		search: "fts",
		mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
	},
};

function store(overrides: Partial<AccessStore> = {}): AccessStore {
	return {
		tenantBySlug: async (slug) =>
			slug === "a"
				? { id: "tenant-a", active: true }
				: slug === "b"
					? { id: "tenant-b", active: true }
					: null,
		rolesOf: async (userId) =>
			userId === "ana"
				? [{ tenantId: "tenant-a", role: "tenant_member" }]
				: userId === "admin"
					? [{ tenantId: "tenant-a", role: "tenant_admin" }]
					: userId === "root"
						? [{ tenantId: "tenant-x", role: "platform_admin" }]
						: [],
		brainBinding: async (tenantId) =>
			tenantId === "tenant-a" ? binding : null,
		...overrides,
	};
}

const verify = vi.fn(async (token: string) =>
	token === "vencido"
		? null
		: { sub: token, client_id: "claude", role: "authenticated" },
);

function access(authorization: string | null, slug = "a", deps = {}) {
	return resolveMcpAccess(
		{ authorization, slug },
		{ verify, store: store(), ...deps },
	);
}

describe("resolveMcpAccess", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	afterEach(() => warn.mockClear());

	it("un miembro lee su tenant", async () => {
		expect(await access("Bearer ana")).toEqual({
			ok: true,
			tenantId: "tenant-a",
			userId: "ana",
			access: "read",
			binding,
		});
	});

	it("un tenant_admin escribe", async () => {
		expect(await access("Bearer admin")).toMatchObject({
			ok: true,
			access: "read_write",
		});
	});

	it("un platform_admin entra a un tenant donde no tiene membresía, y escribe", async () => {
		expect(await access("Bearer root")).toMatchObject({
			ok: true,
			tenantId: "tenant-a",
			access: "read_write",
		});
	});

	it("un miembro de a contra la URL de b recibe 403", async () => {
		expect(await access("Bearer ana", "b")).toMatchObject({
			ok: false,
			status: 403,
			code: "forbidden",
		});
	});

	it("sin token es 401 unauthorized, token inválido es 401 invalid_token", async () => {
		expect(await access(null)).toMatchObject({
			ok: false,
			status: 401,
			code: "unauthorized",
		});
		expect(await access("Basic abc")).toMatchObject({
			ok: false,
			status: 401,
			code: "unauthorized",
		});
		expect(await access("Bearer vencido")).toMatchObject({
			ok: false,
			status: 401,
			code: "invalid_token",
		});
	});

	it("un token sin client_id no entra, y el aviso nombra los claims sin sus valores", async () => {
		const result = await resolveMcpAccess(
			{ authorization: "Bearer ana", slug: "a" },
			{
				verify: async () => ({
					sub: "ana",
					role: "authenticated",
					email: "ana@a.test",
				}),
				store: store(),
			},
		);
		expect(result).toMatchObject({
			ok: false,
			status: 401,
			code: "invalid_token",
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("sub, role, email"),
		);
		expect(warn).not.toHaveBeenCalledWith(
			expect.stringContaining("ana@a.test"),
		);
	});

	it("para quien no es platform_admin, un tenant inexistente o inactivo es 403 como uno ajeno", async () => {
		const ajeno = await access("Bearer ana", "b");
		const inexistente = await access("Bearer ana", "zzz");
		expect(inexistente).toMatchObject({ status: 403, code: "forbidden" });
		expect(inexistente).toEqual(ajeno);
		const inactive = store({
			tenantBySlug: async () => ({ id: "tenant-a", active: false }),
		});
		expect(await access("Bearer ana", "a", { store: inactive })).toEqual(ajeno);
	});

	it("para un platform_admin, un tenant inexistente o inactivo es 404", async () => {
		expect(await access("Bearer root", "zzz")).toMatchObject({
			status: 404,
			code: "tenant_not_found",
		});
		const inactive = store({
			tenantBySlug: async () => ({ id: "tenant-a", active: false }),
		});
		expect(await access("Bearer root", "a", { store: inactive })).toMatchObject({
			status: 404,
			code: "tenant_not_found",
		});
	});

	it("un tenant sin brain es 404 brain_not_configured, después de chequear acceso", async () => {
		const sinBrain = store({ brainBinding: async () => null });
		expect(await access("Bearer ana", "a", { store: sinBrain })).toMatchObject({
			status: 404,
			code: "brain_not_configured",
		});
		expect(await access("Bearer ana", "b", { store: sinBrain })).toMatchObject({
			status: 403,
		});
	});

	it("un token malformado que hace explotar al verificador es 401, no una excepción", async () => {
		const throwing = async () => {
			throw new SyntaxError("Unexpected token");
		};
		const result = await resolveMcpAccess(
			{ authorization: "Bearer YQ.YQ.YQ", slug: "a" },
			{ verify: throwing, store: store() },
		);
		expect(result).toMatchObject({
			ok: false,
			status: 401,
			code: "invalid_token",
		});
		expect(warn).toHaveBeenCalledWith(expect.any(String));
		for (const [message] of warn.mock.calls) {
			expect(message).not.toContain("Unexpected token");
			expect(message).not.toContain("YQ.YQ.YQ");
		}
	});
});
