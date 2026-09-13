import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["agents", "app", "components", "lib", "scripts"];
const SKIP = new Set(["node_modules", ".eve", ".next"]);
const ALLOWED = "lib/connectors/auth.ts";
// Cubre `from "@vercel/connect..."`, `require("@vercel/connect...")` y el
// import de solo efecto `import "@vercel/connect..."`.
const IMPORT_PATTERN =
	/(?:from|require\(|import)\s*\(?\s*["']@vercel\/connect(\/[^"']*)?["']/;

function walk(dir: string, out: string[]): string[] {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.(ts|tsx|mts)$/.test(name)) out.push(path);
	}
	return out;
}

function rootFiles(): string[] {
	// Archivos sueltos en la raíz del repo (proxy.ts, vitest.config.ts, etc.),
	// como el middleware que corre en cada navegación. No recursa en
	// subdirectorios: esos ya los cubre SCAN o SKIP.
	return readdirSync(ROOT)
		.filter((name) => /\.(ts|mts)$/.test(name))
		.map((name) => join(ROOT, name))
		.filter((path) => statSync(path).isFile());
}

describe("regla de import de Vercel Connect", () => {
	it("solo lib/connectors/auth.ts importa @vercel/connect", () => {
		// Algunos directorios de SCAN todavía no existen en las primeras etapas
		// del repo (ej. scripts/); se saltean en vez de romper el test.
		const files = [
			...SCAN.filter((dir) => existsSync(join(ROOT, dir))).flatMap((dir) =>
				walk(join(ROOT, dir), []),
			),
			...rootFiles(),
		];
		const offenders = files
			.filter((file) => IMPORT_PATTERN.test(readFileSync(file, "utf8")))
			.map((file) => relative(ROOT, file))
			.filter((file) => file !== ALLOWED);
		expect(offenders).toEqual([]);
	});
});
