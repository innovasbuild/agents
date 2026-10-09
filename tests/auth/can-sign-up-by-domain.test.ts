import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	rows: { allowed_domains: string[] }[];
	error: unknown;
	filters: [string, unknown][];
	throws: boolean;
} = { rows: [], error: null, filters: [], throws: false };

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from() {
			if (state.throws) throw new Error("sin red");
			const builder = {
				select: () => builder,
				eq(column: string, value: unknown) {
					state.filters.push([column, value]);
					return builder;
				},
				// biome-ignore lint/suspicious/noThenProperty: el builder de supabase es thenable
				then: (resolve: (value: unknown) => void) =>
					resolve({ data: state.rows, error: state.error }),
			};
			return builder;
		},
	}),
}));

const { canSignUpByDomain } = await import("@/app/(auth)/login/actions");

describe("canSignUpByDomain", () => {
	beforeEach(() => {
		state.rows = [{ allowed_domains: ["empresa.com"] }];
		state.error = null;
		state.filters = [];
		state.throws = false;
	});

	it("true si el dominio está abierto en alguna empresa", async () => {
		expect(await canSignUpByDomain("ana@empresa.com")).toBe(true);
	});

	it("filtra por empresas activas con el ingreso abierto", async () => {
		await canSignUpByDomain("ana@empresa.com");

		expect(state.filters).toEqual([
			["active", true],
			["self_signup_by_domain", true],
		]);
	});

	it("no distingue mayúsculas en el correo ni en la tabla", async () => {
		state.rows = [{ allowed_domains: ["Empresa.COM"] }];

		expect(await canSignUpByDomain("  ANA@empresa.com ")).toBe(true);
	});

	it("false para un subdominio", async () => {
		expect(await canSignUpByDomain("ana@ventas.empresa.com")).toBe(false);
	});

	it("false para un dominio que no está abierto", async () => {
		expect(await canSignUpByDomain("ana@otra.com")).toBe(false);
	});

	it("false para algo que no es un correo, sin consultar", async () => {
		for (const value of [
			"",
			"ana",
			"@empresa.com",
			"a@b@empresa.com",
			"ana@empre\nsa.com",
		]) {
			expect(await canSignUpByDomain(value)).toBe(false);
		}
		expect(state.filters).toEqual([]);
	});

	it("false si el valor no es un string", async () => {
		expect(await canSignUpByDomain(undefined as unknown as string)).toBe(false);
	});

	it("false si la consulta devuelve error o lanza", async () => {
		state.error = { message: "falló" };
		expect(await canSignUpByDomain("ana@empresa.com")).toBe(false);

		state.error = null;
		state.throws = true;
		expect(await canSignUpByDomain("ana@empresa.com")).toBe(false);
	});
});
