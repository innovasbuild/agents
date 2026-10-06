import { describe, expect, it, vi } from "vitest";
import { parseSessionFragment, resolveConfirmation } from "@/lib/auth/confirm";

const ORIGIN = "https://app.test";

function deps(overrides: {
	hasSession?: boolean;
	acceptThrows?: boolean;
	next?: string | null;
}) {
	const accept = vi.fn(async () => {
		if (overrides.acceptThrows) throw new Error("boom");
	});
	return {
		accept,
		input: {
			hasSession: async () => overrides.hasSession ?? true,
			acceptInvitations: accept,
			next: overrides.next === undefined ? "/acme/chat" : overrides.next,
			origin: ORIGIN,
		},
	};
}

describe("resolveConfirmation", () => {
	it("con sesión acepta las invitaciones y manda al destino", async () => {
		const { input, accept } = deps({});

		expect(await resolveConfirmation(input)).toBe("/acme/chat");
		expect(accept).toHaveBeenCalledTimes(1);
	});

	it("sin sesión no acepta nada y manda al login con el error", async () => {
		const { input, accept } = deps({ hasSession: false });

		expect(await resolveConfirmation(input)).toBe("/login?error=auth_failed");
		expect(accept).not.toHaveBeenCalled();
	});

	it("si aceptar falla igual manda al destino: la sesión ya está abierta", async () => {
		const { input } = deps({ acceptThrows: true });

		expect(await resolveConfirmation(input)).toBe("/acme/chat");
	});

	it("sin next manda a la raíz, que elige empresa", async () => {
		const { input } = deps({ next: null });

		expect(await resolveConfirmation(input)).toBe("/");
	});

	it("un next hacia otro origen se descarta", async () => {
		const { input } = deps({ next: "https://evil.test/robar" });

		expect(await resolveConfirmation(input)).toBe("/");
	});

	it("un next con doble barra se descarta", async () => {
		const { input } = deps({ next: "//evil.test" });

		expect(await resolveConfirmation(input)).toBe("/");
	});
});

describe("parseSessionFragment", () => {
	it("lee los dos tokens del fragmento de un link de invitación", () => {
		expect(
			parseSessionFragment(
				"#access_token=AAA&expires_in=3600&refresh_token=RRR&token_type=bearer&type=invite",
			),
		).toEqual({ accessToken: "AAA", refreshToken: "RRR" });
	});

	it("acepta el fragmento sin el numeral", () => {
		expect(parseSessionFragment("access_token=AAA&refresh_token=RRR")).toEqual({
			accessToken: "AAA",
			refreshToken: "RRR",
		});
	});

	it("devuelve null si falta el refresh_token", () => {
		expect(parseSessionFragment("#access_token=AAA")).toBeNull();
	});

	it("devuelve null con un fragmento de error (link vencido)", () => {
		expect(
			parseSessionFragment(
				"#error=access_denied&error_code=otp_expired&error_description=expirado",
			),
		).toBeNull();
	});

	it("devuelve null con un fragmento vacío", () => {
		expect(parseSessionFragment("")).toBeNull();
		expect(parseSessionFragment("#")).toBeNull();
	});
});
