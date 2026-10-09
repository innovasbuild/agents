import { describe, expect, it, vi } from "vitest";
import { gateLogin } from "@/lib/auth/login-gate";

const client = (result: unknown) => ({
	rpc: vi.fn(async (_fn: string) => result as never),
});

const FAILED = { ok: false, landing: "/login?error=auth_failed" };

describe("gateLogin", () => {
	it("permitido", async () => {
		const supabase = client({
			data: { allowed: true, landing: null },
			error: null,
		});

		expect(await gateLogin(supabase)).toEqual({ ok: true });
		expect(supabase.rpc).toHaveBeenCalledWith("login_gate");
	});

	it("cortado: manda a la landing de la empresa con el aviso", async () => {
		const supabase = client({
			data: { allowed: false, landing: "acme" },
			error: null,
		});

		expect(await gateLogin(supabase)).toEqual({
			ok: false,
			landing: "/login/acme?error=metodo",
		});
	});

	it("si el RPC devuelve error, corta", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(
			await gateLogin(client({ data: null, error: { message: "boom" } })),
		).toEqual(FAILED);
		error.mockRestore();
	});

	it("si el RPC tira, corta", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const supabase = {
			rpc: async () => {
				throw new Error("red caída");
			},
		};
		expect(await gateLogin(supabase)).toEqual(FAILED);
		error.mockRestore();
	});

	it.each([
		["null", null],
		["un string", "ok"],
		["sin allowed", { landing: "acme" }],
		["allowed que no es booleano", { allowed: "true", landing: null }],
		["cortado sin landing", { allowed: false, landing: null }],
	])("una respuesta sin la forma esperada (%s) corta", async (_name, data) => {
		expect(await gateLogin(client({ data, error: null }))).toEqual(FAILED);
	});

	it.each(["../x", "a/b", "//evil.test", "Acme", "a", ""])(
		"un landing que no es un slug (%s) no arma una URL",
		async (landing) => {
			expect(
				await gateLogin(
					client({ data: { allowed: false, landing }, error: null }),
				),
			).toEqual(FAILED);
		},
	);
});
