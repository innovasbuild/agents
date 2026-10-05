import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	isPlatformOwnerAdmin,
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
		const fake = fakeSupabase({ id: "m1" });

		expect(await isPlatformOwnerAdmin(fake.client, USER_ID)).toBe(false);
		expect(fake.wasQueried()).toBe(false);
	});

	it("busca una membership platform_admin del usuario en el tenant dueño", async () => {
		const fake = fakeSupabase({ id: "m1" });

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
});
