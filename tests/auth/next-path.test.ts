import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/next-path";

const origin = "https://agents.innov.as";

describe("safeNextPath", () => {
	it("acepta un path relativo con query", () => {
		expect(safeNextPath("/oauth/consent?authorization_id=abc", origin)).toBe(
			"/oauth/consent?authorization_id=abc",
		);
	});

	it("sin valor vuelve a la raíz", () => {
		expect(safeNextPath(null, origin)).toBe("/");
		expect(safeNextPath("", origin)).toBe("/");
	});

	it.each([
		"//evil.com",
		"/\\evil.com",
		"https://evil.com",
		"javascript:alert(1)",
		"evil.com",
		"/%2F%2Fevil.com",
		"/..//evil.com",
		"/.//evil.com",
		"/a/..//evil.com",
		"/x/../..//evil.com",
		"/..\\evil.com",
	])("rechaza %s", (raw) => {
		const result = safeNextPath(raw, origin);
		expect(new URL(result, origin).origin).toBe(origin);
		expect(result.startsWith("//")).toBe(false);
	});
});
