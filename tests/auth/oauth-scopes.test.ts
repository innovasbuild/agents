import { describe, expect, it } from "vitest";
import { describeScopes } from "@/lib/auth/oauth-scopes";

describe("describeScopes", () => {
	it("traduce los scopes conocidos", () => {
		expect(describeScopes("openid email profile")).toEqual([
			"Saber quién sos",
			"Ver tu mail",
			"Ver tu nombre y tu foto",
		]);
	});

	it("muestra tal cual un scope desconocido, sin duplicar ni dejar vacíos", () => {
		expect(describeScopes("  openid  otro openid ")).toEqual([
			"Saber quién sos",
			"otro",
		]);
	});
});
