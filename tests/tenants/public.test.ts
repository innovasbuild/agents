import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPublicTenant } from "@/lib/tenants/public";

function clientWith(row: unknown) {
	const filters: [string, unknown][] = [];
	const builder = {
		select: () => builder,
		eq(column: string, value: unknown) {
			filters.push([column, value]);
			return builder;
		},
		maybeSingle: async () => ({ data: row, error: null }),
	};
	// biome-ignore lint/suspicious/noExplicitAny: doble de prueba
	return { client: { from: () => builder } as any, filters };
}

describe("loadPublicTenant", () => {
	const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
	beforeEach(() => {
		process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
	});
	afterEach(() => {
		if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
		else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
	});

	it("filtra por slug y por activo", async () => {
		const fake = clientWith(null);

		await loadPublicTenant("acme", fake.client);

		expect(fake.filters).toEqual([
			["slug", "acme"],
			["active", true],
		]);
	});

	it("devuelve null si no hay fila", async () => {
		expect(await loadPublicTenant("nadie", clientWith(null).client)).toBeNull();
	});

	it("arma marca, métodos y URL del logo", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: { primary: "#112233", logo_url: "acme/logo-1.png" },
			auth_methods: ["email"],
		});

		expect(await loadPublicTenant("acme", fake.client)).toEqual({
			slug: "acme",
			displayName: "Acme",
			brand: { primary: "#112233", logoUrl: "acme/logo-1.png" },
			authMethods: ["email"],
			logoUrl: "https://sb.test/storage/v1/object/public/brand/acme/logo-1.png",
		});
	});

	it("descarta métodos desconocidos y cae a email si no queda ninguno", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: {},
			auth_methods: ["microsoft"],
		});

		expect((await loadPublicTenant("acme", fake.client))?.authMethods).toEqual([
			"email",
		]);
	});
});
