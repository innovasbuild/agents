import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOfferedMethods, loadPublicTenant } from "@/lib/tenants/public";

const admin: {
	result: { data: unknown; error: unknown };
	throws: boolean;
	filters: [string, unknown][];
	columns: string[];
} = {
	result: { data: [], error: null },
	throws: false,
	filters: [],
	columns: [],
};

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: (table: string) => {
			if (admin.throws) throw new Error("sin conexión");
			admin.columns.push(table);
			const builder = {
				select: (columns: string) => {
					admin.columns.push(columns);
					return builder;
				},
				eq(column: string, value: unknown) {
					admin.filters.push([column, value]);
					return Promise.resolve(admin.result);
				},
			};
			return builder;
		},
	}),
}));

const withRows = (rows: unknown) => {
	admin.result = { data: rows, error: null };
	admin.throws = false;
	admin.filters = [];
	admin.columns = [];
};

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
			self_signup_by_domain: false,
			allowed_domains: ["acme.com"],
		});

		expect(await loadPublicTenant("acme", fake.client)).toEqual({
			slug: "acme",
			displayName: "Acme",
			brand: { primary: "#112233", logoUrl: "acme/logo-1.png" },
			authMethods: ["email"],
			logoUrl: "https://sb.test/storage/v1/object/public/brand/acme/logo-1.png",
			openDomains: [],
		});
	});

	it("con el ingreso abierto expone los dominios", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: {},
			auth_methods: ["email"],
			self_signup_by_domain: true,
			allowed_domains: ["acme.com", "acme.com.ar"],
		});

		expect((await loadPublicTenant("acme", fake.client))?.openDomains).toEqual([
			"acme.com",
			"acme.com.ar",
		]);
	});

	it("con el ingreso cerrado no expone los dominios", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: {},
			auth_methods: ["email"],
			self_signup_by_domain: false,
			allowed_domains: ["acme.com"],
		});

		expect((await loadPublicTenant("acme", fake.client))?.openDomains).toEqual(
			[],
		);
	});

	it("descarta métodos desconocidos y cae a email si no queda ninguno", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: {},
			auth_methods: ["saml"],
		});

		expect((await loadPublicTenant("acme", fake.client))?.authMethods).toEqual([
			"email",
		]);
	});
});

describe("loadOfferedMethods", () => {
	beforeEach(() => withRows([]));

	it("consulta solo auth_methods de las empresas activas", async () => {
		withRows([{ auth_methods: ["email"] }]);

		await loadOfferedMethods();

		expect(admin.columns).toEqual(["tenants", "auth_methods"]);
		expect(admin.filters).toEqual([["active", true]]);
	});

	it("une los métodos de las empresas activas en el orden de AUTH_METHODS", async () => {
		withRows([
			{ auth_methods: ["google"] },
			{ auth_methods: ["microsoft", "email"] },
		]);

		expect(await loadOfferedMethods()).toEqual([
			"email",
			"google",
			"microsoft",
		]);
	});

	it("no ofrece Microsoft si ninguna empresa lo tiene", async () => {
		withRows([{ auth_methods: ["email", "google"] }]);

		expect(await loadOfferedMethods()).toEqual(["email", "google"]);
	});

	it("ignora valores desconocidos", async () => {
		withRows([{ auth_methods: ["saml", "google"] }]);

		expect(await loadOfferedMethods()).toEqual(["google"]);
	});

	it("sin empresas, con error o si la consulta tira, ofrece solo correo", async () => {
		withRows([]);
		expect(await loadOfferedMethods()).toEqual(["email"]);

		withRows(null);
		admin.result = { data: null, error: { message: "x" } };
		expect(await loadOfferedMethods()).toEqual(["email"]);

		withRows([{ auth_methods: ["google"] }]);
		admin.throws = true;
		expect(await loadOfferedMethods()).toEqual(["email"]);
	});
});
