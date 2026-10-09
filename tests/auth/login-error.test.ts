import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "@/lib/auth/login-error";

describe("loginErrorMessage", () => {
	it("metodo", () => {
		expect(loginErrorMessage("metodo")).toBe(
			"Tu empresa no permite entrar con ese método. Usá una de estas opciones.",
		);
	});

	it("auth_failed", () => {
		expect(loginErrorMessage("auth_failed")).toBe(
			"No pudimos abrir tu sesión. Probá de nuevo.",
		);
	});

	it.each([undefined, "", "otro", "<script>", "toString", "__proto__"])(
		"un código que no conocemos (%s) no muestra nada",
		(code) => {
			expect(loginErrorMessage(code)).toBeNull();
		},
	);
});
