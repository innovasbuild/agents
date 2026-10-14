// Guardias estructurales del barrido de dominios: corre cada 10 minutos, no
// hace nada sin las APIs de Vercel y de Supabase, y no arrastra next/*.
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
		"domain-sweep.ts",
	),
	"utf8",
);

describe("schedule domain-sweep", () => {
	it("corre cada 10 minutos", () => {
		expect(SOURCE).toMatch(/cron:\s*"\*\/10 \* \* \* \*"/);
	});

	it("sin la API de Vercel o la de Supabase sale sin hacer nada", () => {
		expect(SOURCE).toMatch(/!deps\.vercel \|\| !deps\.redirects/);
	});

	it("usa imports relativos: eve no resuelve los paths de tsconfig", () => {
		expect(SOURCE).not.toMatch(/from "@\//);
	});

	it("no importa nada de next", () => {
		expect(SOURCE).not.toMatch(/from "next/);
	});
});
