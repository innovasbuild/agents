import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isPlatformOwnerAdmin,
	platformOwnerAdminTenantId,
	platformOwnerSlug,
	type ServerSupabase,
} from "@/lib/tenants/platform";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function fakeSupabase(row: unknown) {
	const filters: [string, unknown][] = [];
	let queried = false;
	const builder = {
		select() {
			queried = true;
			return builder;
		},
		eq(column: string, value: unknown) {
			filters.push([column, value]);
			return builder;
		},
		maybeSingle: async () => ({ data: row, error: null }),
	};
	return {
		client: { from: () => builder } as unknown as ServerSupabase,
		filters,
		wasQueried: () => queried,
	};
}

describe("platformOwnerSlug", () => {
	const original = process.env.PLATFORM_OWNER_TENANT_SLUG;
	afterEach(() => {
		if (original === undefined) delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		else process.env.PLATFORM_OWNER_TENANT_SLUG = original;
	});

	it("devuelve el slug configurado", () => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = " innovas ";
		expect(platformOwnerSlug()).toBe("innovas");
	});

	it("devuelve null sin la variable", () => {
		delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		expect(platformOwnerSlug()).toBeNull();
	});

	it("devuelve null con la variable vacía", () => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = "  ";
		expect(platformOwnerSlug()).toBeNull();
	});
});

describe("isPlatformOwnerAdmin", () => {
	const original = process.env.PLATFORM_OWNER_TENANT_SLUG;
	beforeEach(() => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = "innovas";
	});
	afterEach(() => {
		if (original === undefined) delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		else process.env.PLATFORM_OWNER_TENANT_SLUG = original;
	});

	it("falla cerrado sin la variable, sin consultar la base", async () => {
		delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		const fake = fakeSupabase({
			tenant_id: "owner-1",
			tenants: { slug: "innovas" },
		});

		expect(await isPlatformOwnerAdmin(fake.client, USER_ID)).toBe(false);
		expect(fake.wasQueried()).toBe(false);
	});

	it("busca una membership platform_admin del usuario en el tenant dueño", async () => {
		const fake = fakeSupabase({
			tenant_id: "owner-1",
			tenants: { slug: "innovas" },
		});

		expect(await isPlatformOwnerAdmin(fake.client, USER_ID)).toBe(true);
		expect(fake.filters).toEqual([
			["user_id", USER_ID],
			["role", "platform_admin"],
			["tenants.slug", "innovas"],
		]);
	});

	it("da falso cuando esa membership no existe", async () => {
		const fake = fakeSupabase(null);

		expect(await isPlatformOwnerAdmin(fake.client, USER_ID)).toBe(false);
	});

	it("platformOwnerAdminTenantId devuelve el id del tenant dueño", async () => {
		const fake = fakeSupabase({
			tenant_id: "owner-1",
			tenants: { slug: "innovas" },
		});

		expect(await platformOwnerAdminTenantId(fake.client, USER_ID)).toBe(
			"owner-1",
		);
	});

	it("platformOwnerAdminTenantId da null sin esa membership o sin la variable", async () => {
		expect(
			await platformOwnerAdminTenantId(fakeSupabase(null).client, USER_ID),
		).toBeNull();

		delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		expect(
			await platformOwnerAdminTenantId(
				fakeSupabase({ tenant_id: "owner-1" }).client,
				USER_ID,
			),
		).toBeNull();
	});
});

describe("requirePlatformAdmin", () => {
	async function requireWith(opts: { owner: boolean; allows: boolean }) {
		vi.resetModules();
		process.env.PLATFORM_OWNER_TENANT_SLUG = "innovas";
		vi.doMock("next/navigation", () => ({
			redirect: (url: string) => {
				throw new Error(`NEXT_REDIRECT:${url}`);
			},
		}));
		vi.doMock("@/lib/supabase/server", () => ({
			createServerSupabase: async () => {
				const builder = {
					select: () => builder,
					eq: () => builder,
					maybeSingle: async () => ({
						data: opts.owner ? { tenant_id: "owner-1" } : null,
						error: null,
					}),
				};
				return {
					auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
					from: () => builder,
					rpc: async () => ({ data: opts.allows, error: null }),
				};
			},
		}));
		const { requirePlatformAdmin } = await import("@/lib/tenants/platform");
		return requirePlatformAdmin();
	}

	it("con método permitido en el tenant dueño, entra", async () => {
		expect((await requireWith({ owner: true, allows: true }))?.userId).toBe(
			USER_ID,
		);
	});

	it("con método no permitido, va a la landing del dueño", async () => {
		await expect(requireWith({ owner: true, allows: false })).rejects.toThrow(
			"NEXT_REDIRECT:/login/innovas?error=metodo",
		);
	});

	it("quien no es administrador de plataforma recibe null, sin redirect", async () => {
		expect(await requireWith({ owner: false, allows: false })).toBeNull();
	});
});
