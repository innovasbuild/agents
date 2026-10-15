// tests/brain/client-safe.ts
// Paquetes que alcanza un módulo por imports de runtime (no `import type`),
// siguiendo los relativos y el alias @/. Sirve para verificar que lo que usa
// un componente de cliente no arrastra node:*. Corta en los paquetes y en los
// archivos "use server" (en el cliente son solo referencias).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const IMPORT =
	/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm;

function localFile(from: string, spec: string): string | null {
	const base = spec.startsWith("@/")
		? join(ROOT, spec.slice(2))
		: spec.startsWith(".")
			? resolve(dirname(from), spec)
			: null;
	if (base === null) return null;
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
	])
		if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
	return null;
}

export function runtimePackages(entry: string): string[] {
	const packages = new Set<string>();
	const seen = new Set<string>();
	const walk = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		const source = readFileSync(file, "utf8");
		if (/^\s*["']use server["']/.test(source)) return;
		for (const match of source.matchAll(IMPORT)) {
			const spec = match[1];
			const local = localFile(file, spec);
			if (local) walk(local);
			else if (!spec.startsWith(".") && !spec.startsWith("@/"))
				packages.add(spec);
		}
	};
	walk(join(ROOT, entry));
	return [...packages].sort();
}
