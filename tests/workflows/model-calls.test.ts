import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (name === "node_modules" || name.startsWith(".")) return [];
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

// Importa el VALOR de generateText o experimental_evaluate de "ai" (no
// `type generateText`/`type experimental_evaluate`): son quienes efectivamente
// disparan llamadas al modelo.
const IMPORTS_MODEL_CALL =
	/import\s*\{[^}]*(?<!type\s)\b(generateText|experimental_evaluate)\b[^}]*\}\s*from\s*"ai"/;

describe("llamadas al modelo", () => {
	it("todo archivo que importa generateText o experimental_evaluate usa metered", () => {
		// Spec orquestación §5.1 punto 9: si gasta, asienta. La medición se
		// engancha en la puerta, así que es fácil olvidarla en una puerta nueva.
		// Esto falla hasta que alguien decida.
		const sinMedir = [...walk("agents"), ...walk("lib"), ...walk("app")]
			.filter((file) => /\.(ts|tsx|mts)$/.test(file))
			.filter((file) => IMPORTS_MODEL_CALL.test(readFileSync(file, "utf8")))
			.filter((file) => !/\bmetered\(/.test(readFileSync(file, "utf8")));

		expect(sinMedir).toEqual([]);
	});
});
