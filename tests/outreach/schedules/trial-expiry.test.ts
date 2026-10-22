// Guardias estructurales del vencimiento del plan Free: corre una vez por día
// y no arrastra ni el alias "@/" ni next/*.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
	join(
		__dirname,
		"..",
		"..",
		"..",
		"agents",
		"outreach",
		"schedules",
		"trial-expiry.ts",
	),
	"utf8",
);

describe("schedule trial-expiry", () => {
	it("corre una vez por día a las 06:15 UTC", () => {
		expect(SOURCE).toMatch(/cron:\s*"15 6 \* \* \*"/);
	});

	it("usa imports relativos: eve no resuelve los paths de tsconfig", () => {
		expect(SOURCE).not.toMatch(/from "@\//);
	});

	it("no importa nada de next", () => {
		expect(SOURCE).not.toMatch(/from "next/);
	});
});
