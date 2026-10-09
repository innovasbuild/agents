import { describe, expect, it, vi } from "vitest";
import { requestMagicLink } from "@/lib/auth/magic-link";

const base = {
	email: "  Ana@Demo.test ",
	redirectTo: "https://app.test/auth/callback?next=%2Fdemo%2Fchat",
};

describe("requestMagicLink", () => {
	it("manda el correo normalizado y el redirect", async () => {
		const signInWithOtp = vi.fn(async () => ({ error: null }));

		await requestMagicLink({
			...base,
			canSignUpByDomain: async () => false,
			signInWithOtp,
		});

		expect(signInWithOtp).toHaveBeenCalledWith({
			email: "ana@demo.test",
			options: { emailRedirectTo: base.redirectTo, shouldCreateUser: false },
		});
	});

	it("pasa a shouldCreateUser lo que decide la action de dominio", async () => {
		const signInWithOtp = vi.fn(async () => ({ error: null }));

		await requestMagicLink({
			...base,
			canSignUpByDomain: async () => true,
			signInWithOtp,
		});

		expect(signInWithOtp).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({ shouldCreateUser: true }),
			}),
		);
	});

	it("si la action de dominio falla, no se crea cuenta y el pedido sigue", async () => {
		const signInWithOtp = vi.fn(async () => ({ error: null }));

		await requestMagicLink({
			...base,
			canSignUpByDomain: async () => {
				throw new Error("sin red");
			},
			signInWithOtp,
		});

		expect(signInWithOtp).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({ shouldCreateUser: false }),
			}),
		);
	});

	it("resuelve igual con un correo que tiene acceso, uno que no (422) y una caída de red", async () => {
		const casos = [
			async () => ({ error: null }),
			async () => ({ error: { status: 422, message: "Signups not allowed" } }),
			async () => {
				throw new Error("sin red");
			},
		];

		for (const signInWithOtp of casos) {
			await expect(
				requestMagicLink({
					...base,
					canSignUpByDomain: async () => false,
					signInWithOtp,
				}),
			).resolves.toBeUndefined();
		}
	});
});
