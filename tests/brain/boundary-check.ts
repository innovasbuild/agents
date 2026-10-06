import { dirname, resolve, sep } from "node:path";

// import x from "a" · import { x } from "a" · import type { x } from "a" ·
// import "a" · export { x } from "a" (también en varias líneas).
const IMPORT_PATTERN =
	/\b(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;

const ALLOWED_PACKAGES = [
	/^zod$/,
	/^yaml$/,
	/^@modelcontextprotocol\/sdk\//,
	/^node:/,
];
const TYPE_ONLY_PACKAGES = [/^@supabase\/supabase-js$/];

// import("a") · require("a"): formas dinámicas que el patrón estático no ve.
const DYNAMIC_PATTERN = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
// import(x) · import(`a${b}`): el especificador no es un literal y no se puede
// verificar, así que cuenta como violación.
const NON_LITERAL_DYNAMIC_PATTERN =
	/\b(?:import|require)\s*\(\s*(?!["'\s])[^)\s]/g;

// Límite conocido: el guardia mira imports, no globals de Node (Buffer,
// process.env) ni el uso en runtime de módulos permitidos.

function violation(
	file: string,
	specifier: string,
	typeOnly: boolean,
	coreDir: string,
): string | null {
	if (specifier.startsWith(".")) {
		const target = resolve(dirname(file), specifier);
		return target === coreDir || target.startsWith(coreDir + sep)
			? null
			: `${specifier}: sale de lib/brain/core`;
	}
	if (TYPE_ONLY_PACKAGES.some((p) => p.test(specifier))) {
		return typeOnly ? null : `${specifier}: solo se admite con import type`;
	}
	return ALLOWED_PACKAGES.some((p) => p.test(specifier))
		? null
		: `${specifier}: no está entre las dependencias de core`;
}

// Los comentarios pueden mencionar "import (" sin ser código. Se descartan antes
// de escanear (el `[^:]` evita cortar una URL dentro de un string).
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function findViolations(
	file: string,
	source: string,
	coreDir: string,
): string[] {
	const found: string[] = [];
	const code = stripComments(source);
	for (const match of code.matchAll(IMPORT_PATTERN)) {
		const result = violation(file, match[2], match[1] !== undefined, coreDir);
		if (result) found.push(result);
	}
	for (const match of code.matchAll(DYNAMIC_PATTERN)) {
		const result = violation(file, match[1], false, coreDir);
		if (result) found.push(result);
	}
	for (const _ of code.matchAll(NON_LITERAL_DYNAMIC_PATTERN)) {
		found.push("import dinámico con especificador no literal");
	}
	return found;
}
