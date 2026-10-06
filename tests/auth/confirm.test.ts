import { describe, expect, it, vi } from "vitest";
import { resolveConfirmation } from "@/lib/auth/confirm";

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
