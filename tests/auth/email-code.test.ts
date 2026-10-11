import { describe, expect, it } from "vitest";
import { verifyEmailCode } from "@/lib/auth/email-code";

function verifier(result: { data: { session: unknown }; error: unknown }) {
	const calls: unknown[] = [];
	return {
		calls,
		verifyOtp: async (args: unknown) => {
			calls.push(args);
			return result;
		},
	};
}

const OK = { data: { session: {} }, error: null };

describe("verifyEmailCode (navegador)", () => {
	it("normaliza correo y código antes de verificar", async () => {
		const v = verifier(OK);
		expect(
			await verifyEmailCode({
				email: " Ana@Acme.com ",
				code: "123 456",
				verifyOtp: v.verifyOtp,
			}),
		).toBe(true);
		expect(v.calls).toEqual([
			{ email: "ana@acme.com", token: "123456", type: "email" },
		]);
	});

	it("acepta códigos de 6 a 10 dígitos: el largo es un ajuste del proyecto", async () => {
		const v = verifier(OK);
		for (const code of ["123456", "12345678", "1234 567 890"]) {
			expect(
				await verifyEmailCode({
					email: "ana@acme.com",
					code,
					verifyOtp: v.verifyOtp,
				}),
			).toBe(true);
		}
		expect(v.calls).toHaveLength(3);
	});

	it("un código que no son de 6 a 10 dígitos no llega a Supabase", async () => {
		const v = verifier(OK);
		for (const code of ["12345", "abcdef", "12345678901", "12345a"]) {
			expect(
				await verifyEmailCode({
					email: "ana@acme.com",
					code,
					verifyOtp: v.verifyOtp,
				}),
			).toBe(false);
		}
		expect(v.calls).toEqual([]);
	});

	it("un correo inválido no llega a Supabase", async () => {
		const v = verifier(OK);
		expect(
			await verifyEmailCode({
				email: "no-es-mail",
				code: "123456",
				verifyOtp: v.verifyOtp,
			}),
		).toBe(false);
		expect(v.calls).toEqual([]);
	});

	it("código equivocado o vencido: false", async () => {
		const v = verifier({
			data: { session: null },
			error: { message: "expired" },
		});
		expect(
			await verifyEmailCode({
				email: "ana@acme.com",
				code: "123456",
				verifyOtp: v.verifyOtp,
			}),
		).toBe(false);
	});

	it("si Supabase tira, false", async () => {
		expect(
			await verifyEmailCode({
				email: "ana@acme.com",
				code: "123456",
				verifyOtp: async () => {
					throw new Error("red");
				},
			}),
		).toBe(false);
	});
});
