import { describe, expect, it, vi } from "vitest";
import { allowsLogin, methodLanding } from "@/lib/tenants/login-check";

const client = (result: unknown) => ({
	rpc: vi.fn(
		async (_fn: string, _args: { p_tenant: string }) => result as never,
	),
});

describe("allowsLogin", () => {
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

describe("methodLanding", () => {
	it("arma la landing de la empresa con el aviso", () => {
		expect(methodLanding("acme")).toBe("/login/acme?error=metodo");
	});
});
