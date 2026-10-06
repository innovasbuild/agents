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

export function findViolations(
	file: string,
	source: string,
	coreDir: string,
): string[] {
	const found: string[] = [];
	for (const match of source.matchAll(IMPORT_PATTERN)) {
		const result = violation(file, match[2], match[1] !== undefined, coreDir);
		if (result) found.push(result);
	}
	for (const match of source.matchAll(DYNAMIC_PATTERN)) {
		const result = violation(file, match[1], false, coreDir);
		if (result) found.push(result);
	}
	return found;
}
