import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["agents", "app", "lib", "scripts"];
const SKIP = new Set(["node_modules", ".eve", ".next"]);
const ALLOWED = "lib/connectors/auth.ts";

function walk(dir: string, out: string[]): string[] {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.(ts|tsx|mts)$/.test(name)) out.push(path);
	}
	return out;
}

describe("regla de import de Vercel Connect", () => {
	it("solo lib/connectors/auth.ts importa @vercel/connect", () => {
		// Algunos directorios de SCAN todavía no existen en las primeras etapas
		// del repo (ej. scripts/); se saltean en vez de romper el test.
		const offenders = SCAN.filter((dir) => existsSync(join(ROOT, dir)))
			.flatMap((dir) => walk(join(ROOT, dir), []))
			.filter((file) =>
				/from\s+["']@vercel\/connect(\/[^"']*)?["']/.test(
					readFileSync(file, "utf8"),
				),
			)
			.map((file) => relative(ROOT, file))
			.filter((file) => file !== ALLOWED);
		expect(offenders).toEqual([]);
	});
});
