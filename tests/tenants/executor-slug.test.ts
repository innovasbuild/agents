import { describe, expect, it } from "vitest";
import { suggestExecutorSlug } from "@/lib/tenants/executor-slug";

describe("suggestExecutorSlug", () => {
	it.each([
		["ana@acme.test", "ana"],
		["Ana.Lopez@acme.test", "ana-lopez"],
		["juan_perez+ventas@acme.test", "juan-perez-ventas"],
		["99problems@acme.test", "e-99problems"],
		["ñandú@acme.test", "and"],
		[`${"a".repeat(60)}@acme.test`, "a".repeat(31)],
		["--@acme.test", ""],
		[undefined, ""],
	])("%s → %s", (email, slug) => {
		expect(suggestExecutorSlug(email)).toBe(slug);
	});

	it("lo que sugiere siempre cumple el formato de la base, o es vacío", () => {
		for (const email of [
			"ana@x.test",
			"A.B-C@x.test",
			"1@x.test",
			"..@x.test",
		]) {
			expect(suggestExecutorSlug(email)).toMatch(/^([a-z][a-z0-9-]{0,30})?$/);
		}
	});
});
