// Inventario determinístico de las superficies del repo (spec etapa 25 §4.1).
// Funciones puras que reciben la raíz: se testean contra tests/fixtures/docs/.
// Sin modelo, sin red. Todo sale ordenado por `key` para que `docs:sync`
// produzca los mismos bytes dos veces seguidas.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { PROVIDERS } from "../../lib/connectors/providers.ts";
import { NODES, WORKFLOWS } from "../../lib/workflows/registry.ts";

export interface Surface {
	key: string;
	path: string;
	meta?: Record<string, string>;
}

export interface Inventory {
	tools: Surface[];
	schedules: Surface[];
	nodes: Surface[];
	workflows: Surface[];
	tables: Surface[];
	migrations: Surface[];
	routes: Surface[];
	providers: Surface[];
	scripts: Surface[];
	envVars: Surface[];
	evals: Surface[];
	specs: Surface[];
}

/** Lo que no se puede leer del disco del fixture: se inyecta en los tests. */
export interface InventoryDeps {
	nodes: Record<
		string,
		{ effect: number; tier: string | null; model?: string }
	>;
	workflows: Record<
		string,
		{
			agent: string;
			claims: string;
			produces: string | null;
			nodes?: readonly string[];
			optionalNodes?: readonly string[];
			caps?: { itemsPerTick: number; costUsdPerRun: number };
		}
	>;
	providers: Record<
		string,
		{
			capability: string;
			multiple: boolean;
			kind: string;
			authKind: string;
		}
	>;
}

const REAL_DEPS: InventoryDeps = {
	nodes: NODES,
	workflows: WORKFLOWS,
	providers: PROVIDERS,
};

/**
 * Variables que pone la plataforma o el sistema, no el proyecto. Cada patrón
 * es un nombre exacto o un prefijo terminado en `*`.
 */
export const PLATFORM_ENV_VARS = [
	"NODE_ENV",
	"VERCEL",
	"VERCEL_*",
	"XDG_*",
	"PATH",
	"PATHEXT",
	"OSTYPE",
	"APPDATA",
	"LOCALAPPDATA",
	"WINDIR",
	"CI",
	"HOME",
];

const SKIP_DIRS = new Set([".eve", "node_modules", ".next", ".git"]);

export function isPlatformEnvVar(name: string): boolean {
	return PLATFORM_ENV_VARS.some((pattern) =>
		pattern.endsWith("*")
			? name.startsWith(pattern.slice(0, -1))
			: name === pattern,
	);
}

async function walk(root: string, dir: string): Promise<string[]> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(join(root, dir), { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const rel = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...(await walk(root, rel)));
		else files.push(rel);
	}
	return files;
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

function byKey(list: Surface[]): Surface[] {
	return [...list].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** `agents/<agente>/<carpeta>/<archivo>.ts` → `<agente>/<archivo>`. */
function agentSurfaces(
	files: string[],
	folder: string,
	suffix: RegExp,
): Surface[] {
	const out: Surface[] = [];
	for (const file of files) {
		const match = new RegExp(`^agents/([^/]+)/${folder}/([^/]+)$`).exec(file);
		if (!match) continue;
		const [, agent, name] = match;
		if (!suffix.test(name)) continue;
		out.push({ key: `${agent}/${name.replace(suffix, "")}`, path: file });
	}
	return byKey(out);
}

export function routeFromFile(file: string): string | null {
	const match = /^app\/(.*?)(?:^|\/)?(page\.tsx|route\.ts)$/.exec(file);
	if (!match) return null;
	const segments = match[1]
		.split("/")
		.filter((segment) => segment && !/^\(.*\)$/.test(segment));
	return `/${segments.join("/")}`;
}

async function readTables(
	root: string,
	migrations: string[],
): Promise<Surface[]> {
	const seen = new Map<string, string>();
	for (const file of migrations) {
		const text = await readFile(join(root, file), "utf8");
		for (const match of text.matchAll(
			/create table (?:if not exists )?public\.([a-z_0-9]+)/gi,
		)) {
			const name = match[1].toLowerCase();
			if (!seen.has(name)) seen.set(name, file);
		}
	}
	return byKey([...seen].map(([key, path]) => ({ key, path })));
}

async function readEnvVars(root: string): Promise<Surface[]> {
	const readers = new Map<string, Set<string>>();
	const scan = async (file: string) => {
		if (!/\.(ts|tsx|mts|js|mjs)$/.test(file)) return;
		const text = await readFile(join(root, file), "utf8");
		for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
			const name = match[1];
			if (isPlatformEnvVar(name)) continue;
			if (!readers.has(name)) readers.set(name, new Set());
			readers.get(name)?.add(file);
		}
	};
	for (const dir of ["lib", "app", "agents", "scripts"]) {
		for (const file of await walk(root, dir)) await scan(file);
	}
	try {
		await scan("proxy.ts");
	} catch {
		// el fixture y los repos sin proxy no lo tienen
	}
	return byKey(
		[...readers].map(([key, files]) => {
			const sorted = [...files].sort();
			return { key, path: sorted[0], meta: { files: sorted.join(",") } };
		}),
	);
}

export async function inventory(
	root: string,
	deps: InventoryDeps = REAL_DEPS,
): Promise<Inventory> {
	const files = (
		await Promise.all(
			["agents", "app", "supabase/migrations", "docs/superpowers/specs"].map(
				(dir) => walk(root, dir),
			),
		)
	)
		.flat()
		.map(toPosix);

	const migrationFiles = files
		.filter((f) => /^supabase\/migrations\/[^/]+\.sql$/.test(f))
		.sort();

	let packageScripts: Record<string, string> = {};
	try {
		const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
		packageScripts = pkg.scripts ?? {};
	} catch {
		// sin package.json no hay scripts
	}

	const routes: Surface[] = [];
	for (const file of files) {
		const key = routeFromFile(file);
		if (key === null) continue;
		routes.push({
			key,
			path: file,
			meta: { kind: file.endsWith("route.ts") ? "endpoint" : "página" },
		});
	}

	return {
		tools: agentSurfaces(files, "tools", /\.ts$/),
		schedules: agentSurfaces(files, "schedules", /\.ts$/),
		nodes: byKey(
			Object.entries(deps.nodes).map(([key, info]) => ({
				key,
				path: "lib/workflows/registry.ts",
				meta: {
					effect: String(info.effect),
					tier: info.tier ?? "",
					model: info.model ?? "",
				},
			})),
		),
		workflows: byKey(
			Object.entries(deps.workflows).map(([key, info]) => ({
				key,
				path: "lib/workflows/registry.ts",
				meta: {
					agent: info.agent,
					claims: info.claims,
					produces: info.produces ?? "",
					nodes: [...(info.nodes ?? []), ...(info.optionalNodes ?? [])].join(
						", ",
					),
					caps: info.caps
						? `${info.caps.itemsPerTick} ítems por tick · USD ${info.caps.costUsdPerRun} por corrida`
						: "",
				},
			})),
		),
		tables: await readTables(root, migrationFiles),
		migrations: byKey(
			migrationFiles.map((path) => ({
				key: path.replace(/^supabase\/migrations\//, "").replace(/\.sql$/, ""),
				path,
			})),
		),
		routes: byKey(routes),
		providers: byKey(
			Object.entries(deps.providers).map(([key, info]) => ({
				key,
				path: "lib/connectors/providers.ts",
				meta: {
					capability: info.capability,
					multiple: String(info.multiple),
					kind: info.kind,
					authKind: info.authKind,
				},
			})),
		),
		scripts: byKey(
			Object.entries(packageScripts).map(([key, command]) => ({
				key,
				path: "package.json",
				meta: { command },
			})),
		),
		envVars: await readEnvVars(root),
		evals: agentSurfaces(files, "evals", /\.eval\.ts$/),
		specs: byKey(
			files
				.filter((f) => /^docs\/superpowers\/specs\/[^/]+\.md$/.test(f))
				.map((path) => ({
					key: relative("docs/superpowers/specs", path),
					path,
				})),
		),
	};
}
