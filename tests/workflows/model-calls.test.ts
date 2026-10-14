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

	it("todo archivo que importa generateText o experimental_evaluate etiqueta la llamada", () => {
		// Spec 21.5 §4.4: una llamada sin tag no se nota hasta conciliar contra
		// el gateway. La puerta arma las opciones con gatewayOptions o con el
		// resolvedor que devuelve createGatewayOptions.
		const sinEtiqueta = [...walk("agents"), ...walk("lib"), ...walk("app")]
			.filter((file) => /\.(ts|tsx|mts)$/.test(file))
			.filter((file) => IMPORTS_MODEL_CALL.test(readFileSync(file, "utf8")))
			.filter(
				(file) =>
					!/\b(gatewayOptions|createGatewayOptions)\(/.test(
						readFileSync(file, "utf8"),
					),
			);

		expect(sinEtiqueta).toEqual([]);
	});

	it("cada llamada medida de las puertas de los schedules lleva las opciones del gateway", () => {
		// Por sitio de llamada, no por archivo: un `metered(` nuevo sin tag pasaría
		// el chequeo de arriba mientras otro del mismo archivo lo tenga.
		const sinOpciones: string[] = [];
		for (const file of [
			"agents/outreach/schedules/dispatch.ts",
			"agents/outreach/schedules/followups.ts",
		]) {
			const source = readFileSync(file, "utf8");
			const starts = [...source.matchAll(/\bmetered\(/g)].map((m) => m.index);
			expect(starts.length).toBeGreaterThan(0);
			starts.forEach((start, i) => {
				const block = source.slice(start, starts[i + 1] ?? source.length);
				if (!/providerOptions|gatewayOptionsFor\(/.test(block)) {
					sinOpciones.push(
						`${file}:${source.slice(0, start).split("\n").length}`,
					);
				}
			});
		}

		expect(sinOpciones).toEqual([]);
	});
});
