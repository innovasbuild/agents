import { describe, expect, it } from "vitest";
import { domainsPhrase } from "@/lib/tenants/domains-phrase";

describe("domainsPhrase", () => {
	it("arma la frase según la cantidad", () => {
		expect(domainsPhrase(["a.com"])).toBe("@a.com");
		expect(domainsPhrase(["a.com", "b.com"])).toBe("@a.com o @b.com");
		expect(domainsPhrase(["a.com", "b.com", "c.com"])).toBe(
			"@a.com, @b.com o @c.com",
		);
	});

	it("con la lista vacía devuelve vacío", () => {
		expect(domainsPhrase([])).toBe("");
	});
});
