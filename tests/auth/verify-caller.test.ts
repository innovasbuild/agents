import { describe, expect, it } from "vitest";
import { verifyCaller } from "../../lib/auth/verify-caller";

describe("verifyCaller", () => {
	it("devuelve null cuando el request no trae cookies", async () => {
		const caller = await verifyCaller(
			new Request("https://app.test/eve/v1/info"),
		);
		expect(caller).toBeNull();
	});

	it("devuelve null cuando la cookie de sesión es inválida", async () => {
		const request = new Request("https://app.test/eve/v1/info", {
			headers: { cookie: "sb-access-token=basura" },
		});
		expect(await verifyCaller(request)).toBeNull();
	});
});
