import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Next exige que un archivo "use server" exporte solo funciones async (los
// tipos se borran). Vitest no lo verifica y el error aparece recién en runtime.
function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return walk(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

const USE_SERVER =
	/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/;
const VALUE_EXPORT =
	/^export\s+(?!type\b|interface\b|async\s+function\b)(\S+(?:\s+\S+)?)/gm;
const ASYNC_CONST = /^export\s+const\s+\w+\s*(?::[^=]+)?=\s*async\b/;

describe("archivos use server", () => {
	it("solo exportan funciones async", () => {
		const bad: string[] = [];
		for (const file of walk("app/plataforma")) {
			const src = readFileSync(file, "utf8");
			if (!USE_SERVER.test(src)) continue;
			for (const m of src.matchAll(VALUE_EXPORT)) {
				const line = src.slice(m.index).split("\n")[0] ?? "";
				if (ASYNC_CONST.test(line)) continue;
				bad.push(`${file}: ${line.trim()}`);
			}
		}
		expect(bad).toEqual([]);
	});
});
