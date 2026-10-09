import { afterEach, describe, expect, it, vi } from "vitest";
import { allowsLogin, methodLanding } from "@/lib/tenants/login-check";

const client = (result: unknown) => ({
	rpc: vi.fn(
		async (_fn: string, _args: { p_tenant: string }) => result as never,
	),
});

describe("allowsLogin", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("verdadero solo cuando la base responde true", async () => {
		const supabase = client({ data: true, error: null });

		expect(await allowsLogin(supabase, "t1")).toBe(true);
		expect(supabase.rpc).toHaveBeenCalledWith("tenant_allows_login", {
			p_tenant: "t1",
		});
	});

	it.each([false, null, "true", 1, undefined])(
		"cualquier otra respuesta (%s) es falso",
		async (data) => {
			expect(await allowsLogin(client({ data, error: null }), "t1")).toBe(
				false,
			);
		},
	);

	it("con error es falso", async () => {
		expect(
			await allowsLogin(client({ data: true, error: { message: "x" } }), "t1"),
		).toBe(false);
	});

	it("si tira es falso", async () => {
		const supabase = {
			rpc: async () => {
				throw new Error("red");
			},
		};
		expect(await allowsLogin(supabase, "t1")).toBe(false);
	});
});

describe("allowsLogin deja rastro cuando falla", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("con error del RPC lo deja en el log, nombrando la función", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = { message: "función inexistente" };

		expect(
			await allowsLogin(client({ data: null, error: failure }), "t1"),
		).toBe(false);

		expect(error).toHaveBeenCalledTimes(1);
		expect(String(error.mock.calls[0]?.[0])).toContain("tenant_allows_login");
		expect(error.mock.calls[0]).toContain(failure);
	});

	it("si el RPC tira lo deja en el log, nombrando la función", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = new Error("red");
		const supabase = {
			rpc: async () => {
				throw failure;
			},
		};

		expect(await allowsLogin(supabase, "t1")).toBe(false);

		expect(error).toHaveBeenCalledTimes(1);
		expect(String(error.mock.calls[0]?.[0])).toContain("tenant_allows_login");
		expect(error.mock.calls[0]).toContain(failure);
	});

	it.each([true, false])(
		"una respuesta normal (%s) no escribe en el log",
		async (data) => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});

			expect(await allowsLogin(client({ data, error: null }), "t1")).toBe(data);

			expect(error).not.toHaveBeenCalled();
		},
	);
});

describe("methodLanding", () => {
	it("arma la landing de la empresa con el aviso", () => {
		expect(methodLanding("acme")).toBe("/login/acme?error=metodo");
	});
});
