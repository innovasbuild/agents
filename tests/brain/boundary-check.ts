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

export function findViolations(
	file: string,
	source: string,
	coreDir: string,
): string[] {
	const found: string[] = [];
	for (const match of source.matchAll(IMPORT_PATTERN)) {
		const typeOnly = match[1] !== undefined;
		const specifier = match[2];
		if (specifier.startsWith(".")) {
			const target = resolve(dirname(file), specifier);
			if (target !== coreDir && !target.startsWith(coreDir + sep)) {
				found.push(`${specifier}: sale de lib/brain/core`);
			}
		} else if (TYPE_ONLY_PACKAGES.some((p) => p.test(specifier))) {
			if (!typeOnly) found.push(`${specifier}: solo se admite con import type`);
		} else if (!ALLOWED_PACKAGES.some((p) => p.test(specifier))) {
			found.push(`${specifier}: no está entre las dependencias de core`);
		}
	}
	return found;
}
