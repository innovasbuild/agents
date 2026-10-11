import { describe, expect, it, vi } from "vitest";
import {
	EMAIL_CODE_ERROR,
	enterWithEmailCode,
	LOGIN_INCOMPLETE_ERROR,
	verifyEmailCode,
} from "@/lib/auth/email-code";

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

describe("enterWithEmailCode (navegador)", () => {
	function steps(opts: {
		verified: boolean;
		complete: () => Promise<{ ok: false; message: string } | undefined>;
	}) {
		const calls: string[] = [];
		return {
			calls,
			run: () =>
				enterWithEmailCode({
					email: "ana@acme.com",
					code: "123456",
					verifyOtp: async () => {
						calls.push("verifyOtp");
						return opts.verified
							? OK
							: { data: { session: null }, error: { message: "expired" } };
					},
					completeLogin: async () => {
						calls.push("completeLogin");
						return opts.complete();
					},
					closeSession: async () => {
						calls.push("closeSession");
					},
				}),
		};
	}

	it("código mal: el mensaje único, sin completar ni cerrar nada", async () => {
		const s = steps({ verified: false, complete: async () => undefined });
		expect(await s.run()).toBe(EMAIL_CODE_ERROR);
		expect(s.calls).toEqual(["verifyOtp"]);
	});

	it("código bien y la acción redirige: sin mensaje y sin cerrar", async () => {
		const s = steps({ verified: true, complete: async () => undefined });
		expect(await s.run()).toBeNull();
		expect(s.calls).toEqual(["verifyOtp", "completeLogin"]);
	});

	it("código bien pero la acción falla: cierra la sesión y avisa otra cosa", async () => {
		const s = steps({
			verified: true,
			complete: async () => ({ ok: false, message: "x" }),
		});
		expect(await s.run()).toBe(LOGIN_INCOMPLETE_ERROR);
		expect(s.calls).toEqual(["verifyOtp", "completeLogin", "closeSession"]);
	});

	it("código bien pero la llamada tira: cierra la sesión y avisa otra cosa", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const s = steps({
			verified: true,
			complete: async () => {
				throw new Error("red");
			},
		});
		expect(await s.run()).toBe(LOGIN_INCOMPLETE_ERROR);
		expect(s.calls).toEqual(["verifyOtp", "completeLogin", "closeSession"]);
		error.mockRestore();
	});

	it("si cerrar la sesión también tira, igual devuelve el aviso", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await enterWithEmailCode({
			email: "ana@acme.com",
			code: "123456",
			verifyOtp: async () => OK,
			completeLogin: async () => ({ ok: false, message: "x" }),
			closeSession: async () => {
				throw new Error("red");
			},
		});
		expect(result).toBe(LOGIN_INCOMPLETE_ERROR);
		error.mockRestore();
	});

	it("los dos mensajes son distintos", () => {
		expect(LOGIN_INCOMPLETE_ERROR).not.toBe(EMAIL_CODE_ERROR);
	});
});
