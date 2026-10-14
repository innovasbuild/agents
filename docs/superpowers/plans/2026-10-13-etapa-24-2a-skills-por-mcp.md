# Etapa 24.2a · Skills de empresa por MCP — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una persona conectada al brain por MCP reciba las skills publicadas que puede ver (`skill_list`, `skill_load`, `skill_file`) y pueda bajar el paquete publicado como zip desde la web.

**Architecture:** Un catálogo puro en `lib/brain/core/skills/catalog.ts` se arma una vez por request con el `overview` de skills, el nivel de la persona por ruta y un lector de blobs; filtra por permiso y publicación vigente y resuelve las tres operaciones siempre contra la copia publicada. `server.ts` registra las tools si recibe un catálogo; `handler.ts` lo construye. La descarga reusa el contexto de permisos de `files.ts`, arma `SKILL.md` desde la copia publicada y escribe el zip con `node:zlib`.

**Tech Stack:** Next.js 16 App Router (route handler), `@modelcontextprotocol/sdk`, zod, `yaml`, `node:zlib`, Supabase (service role, Storage), Vitest en entorno `node`. Sin migración.

**Spec:** `docs/superpowers/specs/2026-10-13-etapa-24-2a-skills-por-mcp-design.md`

## Global Constraints

- **Rama:** `feat/etapa-24-2a-skills-por-mcp`, sale de `feat/etapa-24-1-skills-paquete` (PR 96). No hacer push ni abrir PR sin que lo pida la persona. Cuando el 96 entre a `main`, se rebasea.
- **Sin migración y sin SQL nuevo.** `events.type` es texto libre. Si una tarea parece necesitar una migración, frenar y avisar.
- `lib/brain/core/` no importa nada fuera de `core` salvo `zod`, `yaml`, `@modelcontextprotocol/sdk`, `node:*` y, como tipo, `@supabase/supabase-js`. Lo vigila `tests/brain/boundary.test.ts`. Los imports relativos dentro de `core` llevan extensión `.ts`. `node:zlib` solo en `lib/brain/adapters/skill-zip.ts`.
- **`withoutSkills` no se toca.** `brain_search`, `brain_read` y `brain_upsert` siguen sin ver `skills/`.
- Por MCP nunca sale el borrador: ni `brain_skill_files` ni la página del brain. Solo `SkillSnapshot` (copia publicada) y blobs por el `sha256` de su `manifest`.
- Una skill que no existe y una que la persona no ve responden con el mismo error y el mismo texto.
- Límites, copiados de la spec: 30 skills y 300 caracteres por descripción en la descripción de `skill_load`; 262.144 bytes por archivo en `skill_file`.
- Nombres exactos: tools `skill_list`, `skill_load`, `skill_file`; evento `brain.skill_loaded` con `channel = 'mcp'`; ruta `/[tenant]/brain/skills/package`.
- Sin tool de agente ni nodo nuevos: no se toca `TOOL_LABELS` ni `lib/workflows/registry.ts`.
- Español rioplatense en UI, descripciones de tools y mensajes; código e identificadores en inglés. Nada específico de un tenant en código.
- Tests: `tests/**/*.test.ts`, entorno `node`, componentes con `createElement` y `renderToStaticMarkup`.
- Lint: **no** correr `npm run lint:fix`. Usar `npx biome check --write <archivos de la tarea>` y después `npx biome check <los mismos>` limpio.
- Después de cada tarea: `npm run typecheck` limpio y `npm test -- tests/brain` verde. Cada commit termina con la línea `Co-Authored-By` del modelo que lo escribe. Identidad de git: `innovasbuild` / `matias@innov.as`. `git add` solo de los archivos de la tarea.
- **No** aplicar nada en producción.

## Review Focus

1. **Editor que carga por MCP una skill con borrador distinto:** mismo archivo `a.md` con otro contenido en el borrador. `skill_file` tiene que devolver el de la versión publicada (por el `sha256` del manifiesto). Tarea 1.
2. **Nombre de una skill ajena:** alguien sin lectura sobre `skills/rrhh/` pide `skill_load("sueldos")`. Mismo error y mismo texto que un nombre inventado, y no aparece en la descripción ni en `skill_list`. Tareas 1 y 2.
3. **Descripción con saltos de línea o muy larga:** no puede romper la lista ni empujar texto que parezca una instrucción aparte en la descripción de la tool. Se normaliza a una línea y se corta a 300. Tarea 1.
4. **La lectura de skills falla (base caída, RPC con error):** las tres tools del brain tienen que seguir andando; no hay 500. Tarea 3.
5. **Zip exportado que no vuelve a entrar:** descripción con `:` o comillas, archivo vacío, subcarpetas. Lo exportado se reimporta con `unzipPackage` + `planImport` y da los mismos archivos y la misma descripción. Tarea 4.

---

### Task 1: Catálogo de skills publicadas (core)

**Files:**
- Create: `lib/brain/core/skills/catalog.ts`
- Modify: `lib/brain/core/skills/http.ts` (exportar `looksLikeText`)
- Test: `tests/brain/skills-catalog.test.ts`

**Interfaces:**
- Consumes: `SkillOverviewRow`, `SkillSnapshot` de `./store.ts`; `publishedSnapshot` de `./state.ts`; `skillName` de `./package.ts`; `Level` de `../access/types.ts`; `BrainError` de `../errors.ts`.
- Produces:

```ts
export const MAX_LISTED_SKILLS = 30;
export const MAX_LISTED_DESCRIPTION = 300;
export const MAX_READABLE_BYTES = 262_144;

export interface SkillSummary { name: string; description: string; version: number; publishedAt: string }
export interface LoadedSkill extends SkillSummary {
	digest: string;
	instructions: string;
	compatibility?: string;
	files: { path: string; size: number; readable: boolean }[];
}
export interface SkillFileContent { name: string; version: number; path: string; size: number; content: string }
export interface SkillLoadRecord { slug: string; name: string; version: number; digest: string }
export interface SkillCatalogDeps {
	overview(): Promise<SkillOverviewRow[]>;
	levelOf(slug: string): Level | null;
	blob(sha256: string): Promise<Uint8Array | null>;
	record(entry: SkillLoadRecord): Promise<void>;
}
export interface SkillCatalog {
	list(): SkillSummary[];
	load(name: string): Promise<LoadedSkill>;
	file(name: string, path: string): Promise<SkillFileContent>;
}
export function describeSkills(skills: SkillSummary[]): string;
// null cuando la persona no ve ninguna skill.
export function loadSkillCatalog(deps: SkillCatalogDeps): Promise<SkillCatalog | null>;
```

- [ ] **Step 1: Exportar `looksLikeText`**

En `lib/brain/core/skills/http.ts`, cambiar `function looksLikeText(` por `export function looksLikeText(`. Nada más.

- [ ] **Step 2: Escribir los tests que fallan**

`tests/brain/skills-catalog.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Level } from "@/lib/brain/core/access/types";
import { BrainError } from "@/lib/brain/core/errors";
import {
	describeSkills,
	loadSkillCatalog,
	MAX_READABLE_BYTES,
	type SkillCatalogDeps,
} from "@/lib/brain/core/skills/catalog";
import type {
	SkillOverviewRow,
	SkillSnapshot,
} from "@/lib/brain/core/skills/store";

const bytes = (text: string) => new TextEncoder().encode(text);

function snapshot(over: Partial<SkillSnapshot> = {}): SkillSnapshot {
	return {
		action: "publicar",
		version: 2,
		pageRevision: 5,
		filesDigest: "fd",
		title: "Reporte",
		description: "Arma el reporte mensual.",
		body: "# Pasos\n1. Uno",
		frontmatter: { description: "Arma el reporte mensual." },
		manifest: [
			{ path: "references/guia.md", sha256: "pub-guia", size: 4 },
			{ path: "assets/logo.png", sha256: "pub-logo", size: 3 },
		],
		digest: "dg",
		publishedAt: "2026-10-13T12:00:00Z",
		...over,
	};
}

function row(slug: string, current: SkillSnapshot | null): SkillOverviewRow {
	return {
		pageId: `page-${slug}`,
		slug,
		revision: 9,
		draftFilesDigest: "draft",
		current,
	};
}

function deps(
	rows: SkillOverviewRow[],
	over: Partial<SkillCatalogDeps> = {},
): SkillCatalogDeps {
	const blobs: Record<string, Uint8Array> = {
		"pub-guia": bytes("guía"),
		"pub-logo": new Uint8Array([0x89, 0x00, 0x01]),
	};
	return {
		overview: async () => rows,
		levelOf: (): Level | null => "lector",
		blob: vi.fn(async (sha: string) => blobs[sha] ?? null),
		record: vi.fn(async () => {}),
		...over,
	};
}

async function expectBrainError(promise: Promise<unknown>, code: string) {
	const error = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(BrainError);
	expect((error as BrainError).code).toBe(code);
	return (error as BrainError).message;
}

describe("loadSkillCatalog", () => {
	it("lista las skills con publicación vigente que la persona puede leer, por nombre", async () => {
		const catalog = await loadSkillCatalog(
			deps([
				row("skills/ventas/reporte", snapshot()),
				row("skills/alta", snapshot({ version: 1, description: "Alta." })),
				row("skills/borrador", null),
				row("skills/retirada", snapshot({ action: "retirar" })),
			]),
		);
		expect(catalog?.list()).toEqual([
			{
				name: "alta",
				description: "Alta.",
				version: 1,
				publishedAt: "2026-10-13T12:00:00Z",
			},
			{
				name: "reporte",
				description: "Arma el reporte mensual.",
				version: 2,
				publishedAt: "2026-10-13T12:00:00Z",
			},
		]);
	});

	it("devuelve null si la persona no ve ninguna", async () => {
		expect(await loadSkillCatalog(deps([row("skills/x", null)]))).toBeNull();
		expect(
			await loadSkillCatalog(
				deps([row("skills/x", snapshot())], { levelOf: () => null }),
			),
		).toBeNull();
	});

	it("carga la copia publicada también para un editor, y registra la carga", async () => {
		const d = deps([row("skills/ventas/reporte", snapshot())], {
			levelOf: () => "editor",
		});
		const catalog = await loadSkillCatalog(d);
		expect(await catalog?.load("reporte")).toEqual({
			name: "reporte",
			description: "Arma el reporte mensual.",
			version: 2,
			publishedAt: "2026-10-13T12:00:00Z",
			digest: "dg",
			instructions: "# Pasos\n1. Uno",
			files: [
				{ path: "references/guia.md", size: 4, readable: true },
				{ path: "assets/logo.png", size: 3, readable: true },
			],
		});
		expect(d.record).toHaveBeenCalledWith({
			slug: "skills/ventas/reporte",
			name: "reporte",
			version: 2,
			digest: "dg",
		});
	});

	it("incluye compatibility si la versión lo trae y marca no legible lo que pasa el tope", async () => {
		const catalog = await loadSkillCatalog(
			deps([
				row(
					"skills/a",
					snapshot({
						frontmatter: { compatibility: "Requiere Python 3" },
						manifest: [
							{ path: "big.csv", sha256: "x", size: MAX_READABLE_BYTES + 1 },
						],
					}),
				),
			]),
		);
		const loaded = await catalog?.load("a");
		expect(loaded?.compatibility).toBe("Requiere Python 3");
		expect(loaded?.files).toEqual([
			{ path: "big.csv", size: MAX_READABLE_BYTES + 1, readable: false },
		]);
	});

	it("una skill ajena responde igual que una que no existe", async () => {
		const catalog = await loadSkillCatalog(
			deps(
				[
					row("skills/rrhh/sueldos", snapshot()),
					row("skills/ventas/reporte", snapshot()),
				],
				{ levelOf: (slug) => (slug.startsWith("skills/rrhh") ? null : "lector") },
			),
		);
		expect(catalog?.list().map((s) => s.name)).toEqual(["reporte"]);
		const ajena = await expectBrainError(
			catalog?.load("sueldos") as Promise<unknown>,
			"not_found",
		);
		const inventada = await expectBrainError(
			catalog?.load("inventada") as Promise<unknown>,
			"not_found",
		);
		expect(ajena.replace("sueldos", "X")).toBe(inventada.replace("inventada", "X"));
		await expectBrainError(
			catalog?.file("sueldos", "references/guia.md") as Promise<unknown>,
			"not_found",
		);
	});

	it("una falla del registro no rompe la carga", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const catalog = await loadSkillCatalog(
			deps([row("skills/a", snapshot())], {
				record: async () => {
					throw new Error("sin base");
				},
			}),
		);
		expect((await catalog?.load("a"))?.version).toBe(2);
		spy.mockRestore();
	});
});

describe("catalog.file", () => {
	it("lee por el sha256 del manifiesto publicado", async () => {
		const d = deps([row("skills/a", snapshot())]);
		const catalog = await loadSkillCatalog(d);
		expect(await catalog?.file("a", "references/guia.md")).toEqual({
			name: "a",
			version: 2,
			path: "references/guia.md",
			size: 4,
			content: "guía",
		});
		expect(d.blob).toHaveBeenCalledWith("pub-guia");
		expect(d.record).not.toHaveBeenCalled();
	});

	it("rechaza una ruta fuera del manifiesto sin leer nada", async () => {
		const d = deps([row("skills/a", snapshot())]);
		const catalog = await loadSkillCatalog(d);
		await expectBrainError(
			catalog?.file("a", "scripts/otro.py") as Promise<unknown>,
			"not_found",
		);
		expect(d.blob).not.toHaveBeenCalled();
	});

	it("rechaza un binario y un archivo que pasa el tope, nombrando la descarga", async () => {
		const d = deps([
			row(
				"skills/a",
				snapshot({
					manifest: [
						{ path: "assets/logo.png", sha256: "pub-logo", size: 3 },
						{ path: "big.csv", sha256: "x", size: MAX_READABLE_BYTES + 1 },
					],
				}),
			),
		]);
		const catalog = await loadSkillCatalog(d);
		const binario = await expectBrainError(
			catalog?.file("a", "assets/logo.png") as Promise<unknown>,
			"validation",
		);
		expect(binario).toContain("descarga del paquete");
		await expectBrainError(
			catalog?.file("a", "big.csv") as Promise<unknown>,
			"validation",
		);
		// El grande se rechaza por el tamaño del manifiesto, sin bajarlo.
		expect(d.blob).toHaveBeenCalledTimes(1);
	});

	it("un blob ausente es un error interno, no un not_found", async () => {
		const catalog = await loadSkillCatalog(
			deps([
				row(
					"skills/a",
					snapshot({ manifest: [{ path: "a.md", sha256: "perdido", size: 1 }] }),
				),
			]),
		);
		const error = await catalog?.file("a", "a.md").then(
			() => null,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(BrainError);
	});
});

describe("describeSkills", () => {
	const summary = (name: string, description = "Hace algo.") => ({
		name,
		description,
		version: 1,
		publishedAt: "2026-10-13T12:00:00Z",
	});

	it("una línea por skill", () => {
		expect(describeSkills([summary("a"), summary("b", "Otra.")])).toBe(
			"- a: Hace algo.\n- b: Otra.",
		);
	});

	it("normaliza saltos de línea y corta a 300 caracteres", () => {
		const text = describeSkills([
			summary("a", `uno\n\n  dos\r\ntres ${"x".repeat(400)}`),
		]);
		expect(text.split("\n")).toHaveLength(1);
		expect(text.startsWith("- a: uno dos tres x")).toBe(true);
		// "- a: " + 300 caracteres, el último es la elipsis.
		expect(text).toHaveLength(5 + 300);
		expect(text.endsWith("…")).toBe(true);
	});

	it("con más de 30 lista 30 y dice cuántas faltan", () => {
		const many = Array.from({ length: 33 }, (_, i) =>
			summary(`s${String(i).padStart(2, "0")}`),
		);
		const lines = describeSkills(many).split("\n");
		expect(lines).toHaveLength(31);
		expect(lines[30]).toBe("Hay 3 más: se ven con skill_list.");
	});
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npm test -- tests/brain/skills-catalog.test.ts`
Expected: FAIL, no existe `@/lib/brain/core/skills/catalog`.

- [ ] **Step 4: Implementar**

`lib/brain/core/skills/catalog.ts`:

```ts
// Skills publicadas para un asistente (spec etapa 24.2a §3 y §4). Puro: se
// arma una vez por request. Solo conoce la copia publicada: nunca la página
// del brain ni los archivos del borrador. Una skill que la persona no ve
// responde igual que una que no existe.
import type { Level } from "../access/types.ts";
import { BrainError } from "../errors.ts";
import { looksLikeText } from "./http.ts";
import { skillName } from "./package.ts";
import { publishedSnapshot } from "./state.ts";
import type { SkillOverviewRow, SkillSnapshot } from "./store.ts";

export const MAX_LISTED_SKILLS = 30;
export const MAX_LISTED_DESCRIPTION = 300;
export const MAX_READABLE_BYTES = 262_144;

export interface SkillSummary {
	name: string;
	description: string;
	version: number;
	publishedAt: string;
}

export interface LoadedSkill extends SkillSummary {
	digest: string;
	instructions: string;
	compatibility?: string;
	files: { path: string; size: number; readable: boolean }[];
}

export interface SkillFileContent {
	name: string;
	version: number;
	path: string;
	size: number;
	content: string;
}

export interface SkillLoadRecord {
	slug: string;
	name: string;
	version: number;
	digest: string;
}

export interface SkillCatalogDeps {
	overview(): Promise<SkillOverviewRow[]>;
	levelOf(slug: string): Level | null;
	blob(sha256: string): Promise<Uint8Array | null>;
	record(entry: SkillLoadRecord): Promise<void>;
}

export interface SkillCatalog {
	list(): SkillSummary[];
	load(name: string): Promise<LoadedSkill>;
	file(name: string, path: string): Promise<SkillFileContent>;
}

const IN_PACKAGE =
	"Está en la descarga del paquete, desde la página de la skill en la plataforma.";

function notFound(name: string): BrainError {
	return new BrainError(
		"not_found",
		`No existe la skill "${name}" entre las que podés usar.`,
	);
}

function summarize(name: string, snapshot: SkillSnapshot): SkillSummary {
	return {
		name,
		description: snapshot.description,
		version: snapshot.version,
		publishedAt: snapshot.publishedAt,
	};
}

export function describeSkills(skills: SkillSummary[]): string {
	const lines = skills.slice(0, MAX_LISTED_SKILLS).map((skill) => {
		const flat = skill.description.replace(/\s+/g, " ").trim();
		const short =
			flat.length > MAX_LISTED_DESCRIPTION
				? `${flat.slice(0, MAX_LISTED_DESCRIPTION - 1)}…`
				: flat;
		return `- ${skill.name}: ${short}`;
	});
	const rest = skills.length - MAX_LISTED_SKILLS;
	if (rest > 0) lines.push(`Hay ${rest} más: se ven con skill_list.`);
	return lines.join("\n");
}

export async function loadSkillCatalog(
	deps: SkillCatalogDeps,
): Promise<SkillCatalog | null> {
	const visible = new Map<string, { slug: string; snapshot: SkillSnapshot }>();
	for (const row of await deps.overview()) {
		const snapshot = publishedSnapshot(row);
		if (!snapshot || deps.levelOf(row.slug) === null) continue;
		// El nombre es único por empresa entre las publicadas (brain_publish_skill).
		visible.set(skillName(row.slug), { slug: row.slug, snapshot });
	}
	if (visible.size === 0) return null;

	const find = (name: string) => {
		const found = visible.get(name);
		if (!found) throw notFound(name);
		return found;
	};

	return {
		list() {
			return [...visible.entries()]
				.map(([name, { snapshot }]) => summarize(name, snapshot))
				.sort((a, b) => (a.name < b.name ? -1 : 1));
		},

		async load(name) {
			const { slug, snapshot } = find(name);
			try {
				await deps.record({
					slug,
					name,
					version: snapshot.version,
					digest: snapshot.digest,
				});
			} catch (error) {
				// El registro no puede tirar una carga.
				console.error("skills: no pude registrar la carga", error);
			}
			const compatibility = snapshot.frontmatter.compatibility;
			return {
				...summarize(name, snapshot),
				digest: snapshot.digest,
				instructions: snapshot.body,
				...(typeof compatibility === "string" && compatibility.trim()
					? { compatibility: compatibility.trim() }
					: {}),
				files: snapshot.manifest.map((file) => ({
					path: file.path,
					size: file.size,
					readable: file.size <= MAX_READABLE_BYTES,
				})),
			};
		},

		async file(name, path) {
			const { snapshot } = find(name);
			const entry = snapshot.manifest.find((file) => file.path === path);
			if (!entry) {
				throw new BrainError(
					"not_found",
					`La skill "${name}" no tiene el archivo "${path}" en la versión ${snapshot.version}.`,
				);
			}
			if (entry.size > MAX_READABLE_BYTES) {
				throw new BrainError(
					"validation",
					`"${path}" pesa más de 256 KB y no se lee desde acá. ${IN_PACKAGE}`,
				);
			}
			const bytes = await deps.blob(entry.sha256);
			if (!bytes) throw new Error(`skills: falta el contenido de ${path}`);
			if (!looksLikeText(bytes)) {
				throw new BrainError(
					"validation",
					`"${path}" no es un archivo de texto y no se lee desde acá. ${IN_PACKAGE}`,
				);
			}
			return {
				name,
				version: snapshot.version,
				path,
				size: entry.size,
				content: new TextDecoder().decode(bytes),
			};
		},
	};
}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm test -- tests/brain/skills-catalog.test.ts tests/brain/boundary.test.ts tests/brain/skills-http.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/skills/catalog.ts lib/brain/core/skills/http.ts tests/brain/skills-catalog.test.ts
npm run typecheck
git add lib/brain/core/skills/catalog.ts lib/brain/core/skills/http.ts tests/brain/skills-catalog.test.ts
git commit -m "feat: catálogo de skills publicadas para asistentes"
```

---

### Task 2: Tools de skills en el servidor MCP

**Files:**
- Modify: `lib/brain/core/mcp-server/server.ts`
- Test: `tests/brain/mcp-server/tools.test.ts` (agregar un `describe`)

**Interfaces:**
- Consumes: `SkillCatalog`, `describeSkills` de `../skills/catalog.ts` (Tarea 1).
- Produces: `buildBrainMcpServer(ctx)` acepta `skills?: SkillCatalog | null`. Exporta `SKILL_TOOL_NAMES = { list: "skill_list", load: "skill_load", file: "skill_file" } as const`.

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `tests/brain/mcp-server/tools.test.ts`, agregar (y sumar a los imports `BrainError` de `@/lib/brain/core/errors` y `type SkillCatalog` de `@/lib/brain/core/skills/catalog`):

```ts
function fakeCatalog(over: Partial<SkillCatalog> = {}): SkillCatalog {
	return {
		list: () => [
			{
				name: "reporte",
				description: "Arma el reporte mensual.",
				version: 2,
				publishedAt: "2026-10-13T12:00:00Z",
			},
		],
		load: vi.fn(async (name: string) => ({
			name,
			description: "Arma el reporte mensual.",
			version: 2,
			publishedAt: "2026-10-13T12:00:00Z",
			digest: "dg",
			instructions: "# Pasos",
			files: [],
		})),
		file: vi.fn(async (name: string, path: string) => ({
			name,
			version: 2,
			path,
			size: 4,
			content: "hola",
		})),
		...over,
	};
}

function build(skills: SkillCatalog | null, limiter = fakeLimiter()) {
	return buildBrainMcpServer({
		userId: "ana",
		categories: ["comercial"],
		canon: false,
		provider: fakeProvider(),
		limiter,
		skills,
	});
}

describe("tools de skills", () => {
	it("sin catálogo no hay tools de skills ni instrucciones", async () => {
		const client = await connect(build(null));
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
		]);
		expect(client.getInstructions()).toBeUndefined();
	});

	it("con catálogo aparecen las tres, las instrucciones y la lista en skill_load", async () => {
		const client = await connect(build(fakeCatalog()));
		const tools = (await client.listTools()).tools;
		expect(tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
			"skill_file",
			"skill_list",
			"skill_load",
		]);
		expect(tools.find((t) => t.name === "skill_load")?.description).toContain(
			"- reporte: Arma el reporte mensual.",
		);
		expect(client.getInstructions()).toContain("skill_load");
	});

	it("skill_list, skill_load y skill_file devuelven el resultado del catálogo y cuentan como lectura", async () => {
		const limiter = fakeLimiter();
		const catalog = fakeCatalog();
		const client = await connect(build(catalog, limiter));
		const list = await client.callTool({ name: "skill_list", arguments: {} });
		expect(list.structuredContent).toEqual({ ok: true, skills: catalog.list() });
		const load = await client.callTool({
			name: "skill_load",
			arguments: { name: "reporte" },
		});
		expect(load.structuredContent).toMatchObject({
			ok: true,
			name: "reporte",
			instructions: "# Pasos",
		});
		const file = await client.callTool({
			name: "skill_file",
			arguments: { name: "reporte", path: "a.md" },
		});
		expect(file.structuredContent).toEqual({
			ok: true,
			name: "reporte",
			version: 2,
			path: "a.md",
			size: 4,
			content: "hola",
		});
		expect(limiter.check.mock.calls.map((call) => call[0])).toEqual([
			"read",
			"read",
			"read",
		]);
	});

	it("un error del catálogo sale con el formato de las tools del brain", async () => {
		const client = await connect(
			build(
				fakeCatalog({
					load: async () => {
						throw new BrainError("not_found", "No existe la skill.");
					},
				}),
			),
		);
		const result = await client.callTool({
			name: "skill_load",
			arguments: { name: "x" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toEqual({
			ok: false,
			error: "not_found",
			message: "No existe la skill.",
		});
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/brain/mcp-server/tools.test.ts`
Expected: FAIL en los cuatro tests nuevos (`skills` no existe en el contexto; faltan las tools).

- [ ] **Step 3: Implementar**

En `lib/brain/core/mcp-server/server.ts`:

1. Imports nuevos:

```ts
import { z } from "zod";
import { describeSkills, type SkillCatalog } from "../skills/catalog.ts";
```

2. Constantes, debajo de `MCP_MAX_UPSERT_BODY_BYTES`:

```ts
export const SKILL_TOOL_NAMES = {
	list: "skill_list",
	load: "skill_load",
	file: "skill_file",
} as const;

const SKILL_INSTRUCTIONS =
	"Esta empresa publica skills: procedimientos revisados para hacer una tarea a su manera. Antes de una tarea que coincida con una skill de la lista de skill_load, cargala con skill_load y seguí sus instrucciones. Los archivos de texto de una skill se leen con skill_file. Los scripts de una skill todavía no se pueden ejecutar desde este servidor: leelos si sirven de referencia.";

const SKILL_LOAD_INTRO =
	"Carga una skill de la empresa: devuelve sus instrucciones y la lista de sus archivos. Usala antes de empezar una tarea que coincida con alguna de estas skills, sin esperar a que te lo pidan. Skills disponibles:";
```

3. En el tipo de `ctx`, agregar:

```ts
	/** Skills publicadas que ve la persona; sin ninguna, no hay tools de skills. */
	skills?: SkillCatalog | null;
```

4. Reemplazar la construcción del servidor:

```ts
	const skills = ctx.skills ?? null;
	const server = new McpServer(
		{ name: "innovas-brain", version: "1.0.0" },
		skills ? { instructions: SKILL_INSTRUCTIONS } : undefined,
	);
```

5. Antes de `return server;`:

```ts
	if (skills) {
		server.registerTool(
			SKILL_TOOL_NAMES.list,
			{
				description:
					"Lista las skills de la empresa que podés usar, con su descripción y versión publicada.",
			},
			async () => run("read", async () => ({ ok: true, skills: skills.list() })),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.load,
			{
				description: `${SKILL_LOAD_INTRO}\n${describeSkills(skills.list())}`,
				inputSchema: { name: z.string().min(1).max(64) },
			},
			async ({ name }) =>
				run("read", async () => ({ ok: true, ...(await skills.load(name)) })),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.file,
			{
				description:
					"Lee un archivo de texto de una skill ya cargada, por la ruta que figura en la lista de archivos de skill_load. Los binarios y los archivos de más de 256 KB no se leen desde acá.",
				inputSchema: {
					name: z.string().min(1).max(64),
					path: z.string().min(1).max(200),
				},
			},
			async ({ name, path }) =>
				run("read", async () => ({
					ok: true,
					...(await skills.file(name, path)),
				})),
		);
	}
```

Si `registerTool` sin `inputSchema` no tipa el callback sin argumentos, usar `inputSchema: {}` y `async () => ...`.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/brain/mcp-server tests/brain/boundary.test.ts`
Expected: PASS (los tests viejos no cambian: `skills` es opcional).

- [ ] **Step 5: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/mcp-server/server.ts tests/brain/mcp-server/tools.test.ts
npm run typecheck
git add lib/brain/core/mcp-server/server.ts tests/brain/mcp-server/tools.test.ts
git commit -m "feat: tools skill_list, skill_load y skill_file en el MCP del brain"
```

---

### Task 3: Cablear el catálogo en el handler y en producción

**Files:**
- Modify: `lib/brain/core/mcp-server/handler.ts`
- Modify: `lib/brain/adapters/mcp-production.ts`
- Test: `tests/brain/mcp-server/handler.test.ts` (helper `deps` y un `describe` nuevo)
- Test: `tests/brain/mcp-server/production.test.ts` (un `describe` nuevo)

**Interfaces:**
- Consumes: `loadSkillCatalog`, `SkillLoadRecord` (Tarea 1); `skills` en `buildBrainMcpServer` (Tarea 2); `resolveAccess` de `../access/resolve-access.ts`; `skillStore()` y `blobStore()` de `lib/brain/adapters/skills.ts`.
- Produces: `BrainMcpDeps.skills`:

```ts
export interface McpSkillsDeps {
	overview(tenantId: string): Promise<SkillOverviewRow[]>;
	blob(tenantId: string, sha256: string): Promise<Uint8Array | null>;
	record(entry: SkillLoadRecord & { tenantId: string; userId: string }): Promise<void>;
}
```

y en `mcp-production.ts`: `export function skillLoadEvent(entry): Record<string, unknown>` (la fila de `events`).

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/brain/mcp-server/handler.test.ts`:

1. Al helper `deps`, agregarle antes de `providerInstance,`:

```ts
		skills: {
			overview: async () => [],
			blob: async () => null,
			record: async () => {},
		},
```

2. Sumar el import `import type { SkillOverviewRow } from "@/lib/brain/core/skills/store";` y, al final del archivo:

```ts
function publishedRow(slug: string): SkillOverviewRow {
	return {
		pageId: `page-${slug}`,
		slug,
		revision: 9,
		draftFilesDigest: "draft",
		current: {
			action: "publicar",
			version: 2,
			pageRevision: 5,
			filesDigest: "fd",
			title: "T",
			description: "Describe la skill.",
			body: "# Pasos",
			frontmatter: {},
			manifest: [{ path: "a.md", sha256: "sha-a", size: 4 }],
			digest: "dg",
			publishedAt: "2026-10-13T12:00:00Z",
		},
	};
}

const BRAIN_TOOLS = ["brain_read", "brain_search", "brain_upsert"];

describe("handleBrainMcp · skills", () => {
	it("sin skills publicadas el servidor queda como antes", async () => {
		const client = await connect("ana", deps());
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(
			BRAIN_TOOLS,
		);
	});

	it("un miembro carga una skill que puede leer; queda registrado con tenant y persona", async () => {
		const record = vi.fn(async () => {});
		const blob = vi.fn(async () => new TextEncoder().encode("hola"));
		const client = await connect(
			"ana",
			deps({
				skills: {
					overview: async () => [publishedRow("skills/ventas/reporte")],
					blob,
					record,
				},
			}),
		);
		const loaded = await client.callTool({
			name: "skill_load",
			arguments: { name: "reporte" },
		});
		expect(loaded.structuredContent).toMatchObject({ ok: true, version: 2 });
		expect(record).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			userId: "ana",
			slug: "skills/ventas/reporte",
			name: "reporte",
			version: 2,
			digest: "dg",
		});
		const file = await client.callTool({
			name: "skill_file",
			arguments: { name: "reporte", path: "a.md" },
		});
		expect(file.structuredContent).toMatchObject({ ok: true, content: "hola" });
		expect(blob).toHaveBeenCalledWith("tenant-a", "sha-a");
	});

	it("las reglas del brain deciden qué skills ve un miembro; un administrador ve todas", async () => {
		const d = () =>
			deps({
				rules: {
					load: async () => [
						{
							path: "skills/rrhh",
							principal: "members" as const,
							userId: null,
							level: "ninguno" as const,
						},
					],
				},
				skills: {
					overview: async () => [
						publishedRow("skills/rrhh/sueldos"),
						publishedRow("skills/ventas/reporte"),
					],
					blob: async () => null,
					record: async () => {},
				},
			});
		const member = await connect("ana", d());
		const memberList = await member.callTool({ name: "skill_list", arguments: {} });
		expect(
			(memberList.structuredContent as { skills: { name: string }[] }).skills.map(
				(s) => s.name,
			),
		).toEqual(["reporte"]);
		const hidden = await member.callTool({
			name: "skill_load",
			arguments: { name: "sueldos" },
		});
		expect(hidden.isError).toBe(true);

		const admin = await connect("admin", d());
		const adminList = await admin.callTool({ name: "skill_list", arguments: {} });
		expect(
			(adminList.structuredContent as { skills: { name: string }[] }).skills.map(
				(s) => s.name,
			),
		).toEqual(["reporte", "sueldos"]);
	});

	it("brain_read sobre skills/ sigue sin existir aunque la skill se pueda cargar", async () => {
		const client = await connect(
			"ana",
			deps({
				skills: {
					overview: async () => [publishedRow("skills/ventas/reporte")],
					blob: async () => null,
					record: async () => {},
				},
			}),
		);
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "skills/ventas/reporte" },
		});
		expect(read.isError).toBe(true);
		expect(read.structuredContent).toMatchObject({ error: "not_found" });
	});

	it("si la lectura de skills falla, las tools del brain siguen andando", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await connect(
			"ana",
			deps({
				skills: {
					overview: async () => {
						throw new Error("rpc caída");
					},
					blob: async () => null,
					record: async () => {},
				},
			}),
		);
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(
			BRAIN_TOOLS,
		);
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/icp" },
		});
		expect(read.structuredContent).toMatchObject({ ok: true });
		spy.mockRestore();
	});

	it("con un brain externo no hay tools de skills ni se consulta el overview", async () => {
		const overview = vi.fn(async () => [publishedRow("skills/a")]);
		const client = await connect(
			"ana",
			deps({
				store: {
					...store,
					brainBinding: async () => ({ ...binding, provider: "mcp" }) as never,
				},
				skills: { overview, blob: async () => null, record: async () => {} },
			}),
		);
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(
			BRAIN_TOOLS,
		);
		expect(overview).not.toHaveBeenCalled();
	});
});
```

En `tests/brain/mcp-server/production.test.ts`, sumar `skillLoadEvent` al import y agregar:

```ts
describe("skillLoadEvent", () => {
	it("arma la fila de events de una carga por MCP", () => {
		expect(
			skillLoadEvent({
				tenantId: "t1",
				userId: "u1",
				slug: "skills/ventas/reporte",
				name: "reporte",
				version: 2,
				digest: "dg",
			}),
		).toEqual({
			tenant_id: "t1",
			actor_user_id: "u1",
			channel: "mcp",
			type: "brain.skill_loaded",
			summary: "skills/ventas/reporte",
			payload: { name: "reporte", version: 2, digest: "dg" },
		});
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/brain/mcp-server/handler.test.ts tests/brain/mcp-server/production.test.ts`
Expected: FAIL (no existe `skills` en `BrainMcpDeps` ni `skillLoadEvent`).

- [ ] **Step 3: Implementar el handler**

En `lib/brain/core/mcp-server/handler.ts`:

1. Imports nuevos:

```ts
import { resolveAccess } from "../access/resolve-access.ts";
import type { Principal } from "../access/types.ts";
import {
	loadSkillCatalog,
	type SkillCatalog,
	type SkillLoadRecord,
} from "../skills/catalog.ts";
import type { SkillOverviewRow } from "../skills/store.ts";
```

2. Antes de `BrainMcpDeps`:

```ts
export interface McpSkillsDeps {
	overview(tenantId: string): Promise<SkillOverviewRow[]>;
	blob(tenantId: string, sha256: string): Promise<Uint8Array | null>;
	record(
		entry: SkillLoadRecord & { tenantId: string; userId: string },
	): Promise<void>;
}
```

y en `BrainMcpDeps`, después de `usesCanon`:

```ts
	/** Skills publicadas de la empresa (spec 24.2a). */
	skills: McpSkillsDeps;
```

3. En `handleBrainMcpInner`, reemplazar la construcción de `provider` para reusar el principal, y armar el catálogo después:

```ts
	const principal: Principal = {
		kind: "user",
		userId: access.userId,
		role: access.role,
	};
	// withoutSkills por fuera de withAccess: ni un administrador ve skills por
	// las tools del brain (spec 24.1 S6). Las skills salen por su catálogo.
	const provider = withoutSkills(
		withAccess(deps.provider(access.binding), principal, rules),
	);

	// Solo el brain propio tiene skills (S13). Si no se pueden leer, el
	// servidor se arma sin ellas: las tools del brain no dependen de las skills.
	let skills: SkillCatalog | null = null;
	if (access.binding.provider === "wiki") {
		try {
			skills = await loadSkillCatalog({
				overview: () => deps.skills.overview(access.tenantId),
				levelOf: (slug) => resolveAccess(rules, principal, slug),
				blob: (sha256) => deps.skills.blob(access.tenantId, sha256),
				record: (entry) =>
					deps.skills.record({
						...entry,
						tenantId: access.tenantId,
						userId: access.userId,
					}),
			});
		} catch (error) {
			console.error("brain mcp: no pude leer las skills", error);
		}
	}
```

y pasar `skills,` a `buildBrainMcpServer({ ... })`.

- [ ] **Step 4: Implementar producción**

En `lib/brain/adapters/mcp-production.ts`:

```ts
import type { McpSkillsDeps } from "../core/mcp-server/handler.ts";
import { blobStore, skillStore } from "./skills.ts";

type SkillLoad = Parameters<McpSkillsDeps["record"]>[0];

export function skillLoadEvent(entry: SkillLoad): Record<string, unknown> {
	return {
		tenant_id: entry.tenantId,
		actor_user_id: entry.userId,
		channel: "mcp",
		type: "brain.skill_loaded",
		summary: entry.slug,
		payload: { name: entry.name, version: entry.version, digest: entry.digest },
	};
}

function skillsDeps(): McpSkillsDeps {
	return {
		overview: (tenantId) => skillStore().overview(tenantId),
		blob: (tenantId, sha256) => blobStore().get(tenantId, sha256),
		// events es append-only: solo insert.
		async record(entry) {
			const { error } = await createAdminClient()
				.from("events")
				.insert(skillLoadEvent(entry));
			if (error) throw new Error(error.message);
		},
	};
}
```

y en `productionDeps()`, agregar `skills: skillsDeps(),` después de `provider: getBrainProvider,`.

Ojo con los imports del archivo: hoy mezcla rutas con y sin extensión (`"../core/mcp-server/handler.ts"`, `"./access-rules.ts"`); seguir el estilo de las líneas vecinas. Si `./skills.ts` arrastra `@/` y rompe `production.test.ts` al importar, revisar cómo resuelve Vitest el alias (ya lo usa `skills.ts` en otros tests) antes de cambiar nada.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm test -- tests/brain`
Expected: PASS completo.

- [ ] **Step 6: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/mcp-server/handler.ts lib/brain/adapters/mcp-production.ts tests/brain/mcp-server/handler.test.ts tests/brain/mcp-server/production.test.ts
npm run typecheck
git add lib/brain/core/mcp-server/handler.ts lib/brain/adapters/mcp-production.ts tests/brain/mcp-server/handler.test.ts tests/brain/mcp-server/production.test.ts
git commit -m "feat: el MCP del brain sirve las skills publicadas de cada persona"
```

---

### Task 4: Armar el paquete publicado (`SKILL.md`, exportación y zip)

**Files:**
- Create: `lib/brain/core/skills/skill-md.ts`
- Modify: `lib/brain/core/skills/files.ts` (agregar `exportSkillPackage`)
- Modify: `lib/brain/adapters/skill-zip.ts` (agregar `zipPackage`)
- Test: `tests/brain/skills-skill-md.test.ts`
- Test: `tests/brain/skills-files.test.ts` y `tests/brain/skills-zip.test.ts` (agregar un `describe` a cada uno)

**Interfaces:**
- Consumes: `context()` (privada) y `PackageEntry`, `FilesDeps`, `parseSkillMd`, `planImport` de `files.ts`; `publishedSnapshot`; `skillName`.
- Produces:

```ts
// skill-md.ts
export function renderSkillMd(input: { name: string; description: string; frontmatter: Record<string, unknown>; body: string }): string;
// files.ts
export async function exportSkillPackage(tenantSlug: string, slug: string, deps: FilesDeps): Promise<{ ok: true; name: string; version: number; entries: PackageEntry[] } | SkillFailure>;
// skill-zip.ts
export function zipPackage(entries: PackageEntry[]): Uint8Array;
```

- [ ] **Step 1: Escribir los tests que fallan**

`tests/brain/skills-skill-md.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSkillMd } from "@/lib/brain/core/skills/files";
import { renderSkillMd } from "@/lib/brain/core/skills/skill-md";

describe("renderSkillMd", () => {
	it("arma frontmatter con name y description, y el cuerpo", () => {
		const md = renderSkillMd({
			name: "reporte",
			description: "Arma el reporte.",
			frontmatter: { description: "Arma el reporte.", otra: "no se exporta" },
			body: "# Pasos\n",
		});
		expect(md.startsWith("---\nname: reporte\n")).toBe(true);
		expect(md).not.toContain("otra");
		expect(parseSkillMd(md)).toEqual({
			description: "Arma el reporte.",
			compatibility: "",
			license: "",
			body: "# Pasos\n",
		});
	});

	it("incluye license y compatibility si están, y sobrevive a caracteres de YAML", () => {
		const description = 'Usar cuando: "x" o #y\nsegunda línea';
		const md = renderSkillMd({
			name: "a",
			description,
			frontmatter: { license: "MIT", compatibility: "Python 3: sí" },
			body: "cuerpo",
		});
		expect(parseSkillMd(md)).toEqual({
			description,
			compatibility: "Python 3: sí",
			license: "MIT",
			body: "cuerpo",
		});
	});
});
```

En `tests/brain/skills-files.test.ts`, sumar `exportSkillPackage` al import y agregar al final un `describe` que reusa el `setup()`, `SLUG`, `LECTOR` y `HIDDEN` que ya tiene el archivo (la versión vigente por defecto es la 2, con `scripts/calc.py` → "publicado", descripción "d" y cuerpo "b"; el borrador tiene ese archivo con "borrador"):

```ts
describe("exportSkillPackage", () => {
	const decode = (data: Uint8Array) => new TextDecoder().decode(data);

	it("un lector recibe la copia publicada dentro de una carpeta con el nombre", async () => {
		const { deps } = setup(LECTOR);
		const result = await exportSkillPackage("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		expect(result.name).toBe("facturacion");
		expect(result.version).toBe(2);
		expect(result.entries.map((entry) => entry.path)).toEqual([
			"facturacion/SKILL.md",
			"facturacion/scripts/calc.py",
		]);
		expect(decode(result.entries[1].bytes)).toBe("publicado");
		expect(parseSkillMd(decode(result.entries[0].bytes))).toMatchObject({
			description: "d",
			body: "b",
		});
	});

	it("un editor también recibe la publicada, no el borrador", async () => {
		const { deps } = setup();
		const result = await exportSkillPackage("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		expect(decode(result.entries[1].bytes)).toBe("publicado");
		expect(result.entries.map((entry) => entry.path)).not.toContain(
			"facturacion/references/nuevo.md",
		);
	});

	it("sin publicación vigente, sin lectura o sin ser miembro: not_found", async () => {
		const noMember = setup().deps;
		for (const deps of [
			setup({ current: null }).deps,
			setup(HIDDEN).deps,
			{ ...noMember, actor: async () => null },
		]) {
			expect(await exportSkillPackage("acme", SLUG, deps)).toMatchObject({
				ok: false,
				code: "not_found",
			});
		}
	});

	it("lo exportado se puede volver a importar", async () => {
		const { deps } = setup(LECTOR);
		const result = await exportSkillPackage("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		const plan = planImport(result.entries);
		if (!plan.ok) throw new Error(plan.problems.join(" "));
		expect(plan.skill.description).toBe("d");
		expect(plan.files.map((file) => file.path)).toEqual(["scripts/calc.py"]);
	});

	it("si falta un blob, lanza: no entrega un paquete incompleto", async () => {
		const { deps, blobs } = setup(LECTOR);
		blobs.delete("t1/pub");
		await expect(exportSkillPackage("acme", SLUG, deps)).rejects.toThrow();
	});
});
```

En `tests/brain/skills-zip.test.ts`, sumar `zipPackage` al import y agregar:

```ts
describe("zipPackage", () => {
	it("lo que escribe lo lee unzipPackage, con subcarpetas y un archivo vacío", () => {
		const entries = [
			{ path: "reporte/SKILL.md", bytes: bytes("---\ndescription: x\n---\ncuerpo") },
			{ path: "reporte/scripts/calc.py", bytes: bytes("print(1)\n".repeat(500)) },
			{ path: "reporte/vacio.txt", bytes: new Uint8Array(0) },
			{ path: "reporte/assets/ñandú.bin", bytes: new Uint8Array([0, 255, 1, 254]) },
		];
		const zip = zipPackage(entries);
		expect(unzipPackage(zip)).toEqual(entries);
	});

	it("comprime lo que se deja comprimir", () => {
		const big = bytes("a".repeat(100_000));
		expect(zipPackage([{ path: "a.txt", bytes: big }]).length).toBeLessThan(5_000);
	});

	it("también lo abre otro lector de zip", () => {
		const zip = zipPackage([{ path: "r/a.txt", bytes: bytes("hola") }]);
		expect(new TextDecoder().decode(unzipSync(zip)["r/a.txt"])).toBe("hola");
	});

	it("el mismo contenido da el mismo zip", () => {
		const entries = [{ path: "a.txt", bytes: bytes("hola") }];
		expect(zipPackage(entries)).toEqual(zipPackage(entries));
	});
});
```

(`unzipSync` se importa de `fflate`, que ya es devDependency.)

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/brain/skills-skill-md.test.ts tests/brain/skills-files.test.ts tests/brain/skills-zip.test.ts`
Expected: FAIL (no existen `skill-md`, `exportSkillPackage` ni `zipPackage`).

- [ ] **Step 3: Implementar `skill-md.ts`**

```ts
// Arma el SKILL.md de una copia publicada (spec etapa 24.2a §5). Puro. Del
// frontmatter del brain solo salen los campos del formato Agent Skills.
import { stringify } from "yaml";

export function renderSkillMd(input: {
	name: string;
	description: string;
	frontmatter: Record<string, unknown>;
	body: string;
}): string {
	const fields: Record<string, string> = {
		name: input.name,
		description: input.description,
	};
	for (const key of ["license", "compatibility"] as const) {
		const value = input.frontmatter[key];
		if (typeof value === "string" && value.trim()) fields[key] = value.trim();
	}
	// lineWidth 0: una descripción larga no se parte en varias líneas.
	return `---\n${stringify(fields, { lineWidth: 0 })}---\n\n${input.body}`;
}
```

Si el test de ida y vuelta falla por el salto de línea inicial del cuerpo, mirar `parseSkillMd`: quita un solo salto después del `---`. No cambiar `parseSkillMd`; ajustar acá.

- [ ] **Step 4: Implementar `exportSkillPackage`**

En `lib/brain/core/skills/files.ts`, importar `skillName` de `./package.ts` y `renderSkillMd` de `./skill-md.ts`, y agregar después de `readSkillFile`:

```ts
// El paquete que se distribuye: siempre la copia publicada vigente, también
// para quien edita (spec etapa 24.2a M7). Sin ella, no existe.
export async function exportSkillPackage(
	tenantSlug: string,
	slug: string,
	deps: FilesDeps,
): Promise<
	| { ok: true; name: string; version: number; entries: PackageEntry[] }
	| SkillFailure
> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return skillFail("not_found", NOT_FOUND);
	const snapshot = publishedSnapshot(ctx.row);
	if (!snapshot) return skillFail("not_found", NOT_FOUND);

	const name = skillName(slug);
	const entries: PackageEntry[] = [
		{
			path: `${name}/SKILL.md`,
			bytes: new TextEncoder().encode(
				renderSkillMd({
					name,
					description: snapshot.description,
					frontmatter: snapshot.frontmatter,
					body: snapshot.body,
				}),
			),
		},
	];
	for (const file of snapshot.manifest) {
		const bytes = await deps.blobs.get(ctx.actor.tenantId, file.sha256);
		if (!bytes) throw new Error(`skills: falta el contenido de ${file.path}`);
		entries.push({ path: `${name}/${file.path}`, bytes });
	}
	return { ok: true, name, version: snapshot.version, entries };
}
```

`context()` devuelve `unsupported` para un brain externo: acá también es `not_found`, por eso el `if (!ctx.ok)` no reenvía el motivo.

- [ ] **Step 5: Implementar `zipPackage`**

En `lib/brain/adapters/skill-zip.ts`, cambiar el import de zlib a `import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";`, actualizar el comentario de cabecera ("Lectura y escritura del zip…") y agregar al final:

```ts
const UTF8_NAMES = 0x0800;
const DOS_DATE = 0x0021; // 1980-01-01: sin fecha real, el zip es reproducible.

// Espejo de unzipPackage (spec etapa 24.2a §5): métodos 0 y 8, sin zip64. Los
// topes del paquete (20 MB, 50 archivos) quedan muy por debajo de sus límites.
export function zipPackage(entries: PackageEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.path);
		const deflated = deflateRawSync(entry.bytes);
		const stored = deflated.length >= entry.bytes.length;
		const data = stored ? entry.bytes : deflated;
		const method = stored ? 0 : 8;
		const crc = crc32(entry.bytes);

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, LOCAL_SIG, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, UTF8_NAMES, true);
		lv.setUint16(8, method, true);
		lv.setUint16(12, DOS_DATE, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, data.length, true);
		lv.setUint32(22, entry.bytes.length, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);

		const header = new Uint8Array(46 + name.length);
		const cv = new DataView(header.buffer);
		cv.setUint32(0, CENTRAL_SIG, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(8, UTF8_NAMES, true);
		cv.setUint16(10, method, true);
		cv.setUint16(14, DOS_DATE, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, data.length, true);
		cv.setUint32(24, entry.bytes.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		header.set(name, 46);

		parts.push(local, data);
		central.push(header);
		offset += local.length + data.length;
	}

	const centralSize = central.reduce((total, part) => total + part.length, 0);
	const end = new Uint8Array(EOCD_MIN);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, EOCD_SIG, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const out = new Uint8Array(offset + centralSize + EOCD_MIN);
	let at = 0;
	for (const part of [...parts, ...central, end]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
```

- [ ] **Step 6: Correr y ver que pasa**

Run: `npm test -- tests/brain`
Expected: PASS completo (incluye `boundary.test.ts`: `skill-md.ts` solo importa `yaml`).

- [ ] **Step 7: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/skills/skill-md.ts lib/brain/core/skills/files.ts lib/brain/adapters/skill-zip.ts tests/brain/skills-skill-md.test.ts tests/brain/skills-files.test.ts tests/brain/skills-zip.test.ts
npm run typecheck
git add lib/brain/core/skills/skill-md.ts lib/brain/core/skills/files.ts lib/brain/adapters/skill-zip.ts tests/brain/skills-skill-md.test.ts tests/brain/skills-files.test.ts tests/brain/skills-zip.test.ts
git commit -m "feat: exportar el paquete publicado de una skill como zip"
```

---

### Task 5: Ruta de descarga y botón

**Files:**
- Create: `app/[tenant]/brain/skills/package/route.ts`
- Modify: `lib/brain/core/skills/http.ts` (agregar `skillPackageHref`)
- Modify: `components/brain/skills/published-files.tsx`
- Modify: `components/brain/skills/skill-panel.tsx`
- Modify: `app/[tenant]/brain/p/[...slug]/page.tsx`
- Test: `tests/brain/skills-package-route.test.ts`
- Test: `tests/brain/skills-components.test.ts`, `tests/brain/skills-http.test.ts`

**Interfaces:**
- Consumes: `exportSkillPackage` y `zipPackage` (Tarea 4); `filesDeps()` de `lib/brain/adapters/skills`.
- Produces: `skillPackageHref(tenantSlug: string, slug: string): string` → `/${tenantSlug}/brain/skills/package?slug=<slug codificado>`. `PublishedFiles` recibe `version: number`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/brain/skills-package-route.test.ts`:

```ts
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	filesDeps: vi.fn(() => ({})),
	exportSkillPackage: vi.fn(),
}));

vi.mock("@/lib/brain/adapters/skills", () => ({ filesDeps: state.filesDeps }));
vi.mock("@/lib/brain/core/skills/files", () => ({
	exportSkillPackage: state.exportSkillPackage,
}));

import { GET } from "@/app/[tenant]/brain/skills/package/route";

const params = (tenant = "acme") => ({ params: Promise.resolve({ tenant }) });
const get = (query: string) =>
	new Request(`https://agentes.innov.as/acme/brain/skills/package${query}`);

beforeEach(() => vi.clearAllMocks());

describe("GET /brain/skills/package", () => {
	it("devuelve el zip como descarga, sin caché y sin sniffing", async () => {
		state.exportSkillPackage.mockResolvedValue({
			ok: true,
			name: "reporte",
			version: 3,
			entries: [
				{ path: "reporte/SKILL.md", bytes: new TextEncoder().encode("hola") },
			],
		});
		const response = await GET(get("?slug=skills/ventas/reporte"), params());
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/zip");
		expect(response.headers.get("content-disposition")).toBe(
			'attachment; filename="reporte-v3.zip"',
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cache-control")).toBe("no-store");
		const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
		expect(new TextDecoder().decode(files["reporte/SKILL.md"])).toBe("hola");
		expect(state.exportSkillPackage).toHaveBeenCalledWith(
			"acme",
			"skills/ventas/reporte",
			expect.anything(),
		);
	});

	it("404 sin slug, con tenant inválido o cuando no se puede exportar", async () => {
		expect((await GET(get(""), params())).status).toBe(404);
		expect(
			(await GET(get("?slug=skills/a"), params("Acme_malo"))).status,
		).toBe(404);
		expect(state.exportSkillPackage).not.toHaveBeenCalled();
		state.exportSkillPackage.mockResolvedValue({
			ok: false,
			code: "not_found",
			message: "No encontrado.",
		});
		expect((await GET(get("?slug=skills/a"), params())).status).toBe(404);
	});

	it("500 sin detalles si falla el armado", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		state.exportSkillPackage.mockRejectedValue(new Error("falta un blob sha-x"));
		const response = await GET(get("?slug=skills/a"), params());
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain("sha-x");
		spy.mockRestore();
	});
});
```

En `tests/brain/skills-http.test.ts`, agregar (sumando `skillPackageHref` al import):

```ts
describe("skillPackageHref", () => {
	it("codifica el slug en la query", () => {
		expect(skillPackageHref("acme", "skills/ventas/reporte")).toBe(
			"/acme/brain/skills/package?slug=skills%2Fventas%2Freporte",
		);
	});
});
```

En `tests/brain/skills-components.test.ts`: pasar `version: 3` en el test existente de `PublishedFiles` y agregar:

```ts
	it("ofrece la descarga del paquete publicado, aunque no tenga archivos", () => {
		const html = renderToStaticMarkup(
			createElement(PublishedFiles, {
				tenantSlug: "acme",
				slug: "skills/facturacion",
				version: 3,
				files: [],
			}),
		);
		expect(html).toContain("Descargar paquete (v3)");
		expect(html).toContain(
			'href="/acme/brain/skills/package?slug=skills%2Ffacturacion"',
		);
	});
```

Y un test de `SkillPanel`: con estado publicada (usar las props del test existente que renderiza una skill publicada) el HTML contiene `Descargar paquete (v` y el `href` de `skillPackageHref`; con estado sin publicar, no lo contiene.

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/brain/skills-package-route.test.ts tests/brain/skills-http.test.ts tests/brain/skills-components.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`lib/brain/core/skills/http.ts`, al final:

```ts
export function skillPackageHref(tenantSlug: string, slug: string): string {
	return `/${tenantSlug}/brain/skills/package?${new URLSearchParams({ slug })}`;
}
```

`app/[tenant]/brain/skills/package/route.ts`:

```ts
import { zipPackage } from "@/lib/brain/adapters/skill-zip";
import { filesDeps } from "@/lib/brain/adapters/skills";
import { exportSkillPackage } from "@/lib/brain/core/skills/files";

// Descarga del paquete publicado de una skill (spec etapa 24.2a §5). Siempre
// la versión vigente. El permiso lo decide core/skills/files.ts; lo que no se
// ve responde igual que lo que no existe.

const TENANT = /^[a-z0-9-]{1,63}$/;
const CHUNK = 65_536;

function notFound(): Response {
	return new Response("No encontrado", { status: 404 });
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ tenant: string }> },
) {
	const { tenant } = await params;
	const slug = new URL(request.url).searchParams.get("slug");
	if (!TENANT.test(tenant) || !slug) return notFound();

	let zip: Uint8Array;
	let filename: string;
	try {
		const result = await exportSkillPackage(tenant, slug, filesDeps());
		if (!result.ok) return notFound();
		zip = zipPackage(result.entries);
		// El nombre sale del slug ya validado: minúsculas, números y guiones.
		filename = `${result.name}-v${result.version}.zip`;
	} catch (error) {
		console.error("skills: falló la descarga del paquete", error);
		return new Response("No pude armar el paquete. Probá de nuevo.", {
			status: 500,
		});
	}

	// Por partes: una respuesta en streaming no queda sujeta al tope de cuerpo
	// de las funciones de Vercel (a verificar en preview, ver plan §cierre).
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let at = 0; at < zip.length; at += CHUNK) {
				controller.enqueue(zip.subarray(at, at + CHUNK));
			}
			controller.close();
		},
	});
	return new Response(body, {
		headers: {
			"content-type": "application/zip",
			"content-disposition": `attachment; filename="${filename}"`,
			"x-content-type-options": "nosniff",
			"cache-control": "no-store",
		},
	});
}
```

`components/brain/skills/published-files.tsx`: sumar `skillPackageHref` al import y `version: number` a las props; quitar el `if (files.length === 0) return null;`; el `<ul>` se renderiza solo si hay archivos; el encabezado pasa a:

```tsx
			<div className="flex flex-wrap items-center gap-3">
				<h2 className="mr-auto font-medium text-sm">Archivos de la skill</h2>
				<a
					className="text-sm underline"
					href={skillPackageHref(tenantSlug, slug)}
					download
				>
					Descargar paquete (v{version})
				</a>
			</div>
```

`app/[tenant]/brain/p/[...slug]/page.tsx`: reemplazar `const publishedFiles = publishedSnapshot(skillRow)?.manifest ?? [];` por `const published = publishedSnapshot(skillRow);` y el bloque final por:

```tsx
			{published && (
				<PublishedFiles
					tenantSlug={tenantSlug}
					slug={slug}
					version={published.version}
					files={published.manifest}
				/>
			)}
```

`components/brain/skills/skill-panel.tsx`: en el bloque que ya se muestra con `state.kind === "publicada"` (línea ~155), agregar el mismo link `Descargar paquete (v{state.version})` con `skillPackageHref(tenantSlug, slug)`, usando los nombres de props que el componente ya tiene para el tenant y el slug. No cambiar nada más del panel.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/brain`
Expected: PASS completo.

- [ ] **Step 5: Lint, typecheck y commit**

```bash
npx biome check --write "app/[tenant]/brain/skills/package/route.ts" lib/brain/core/skills/http.ts components/brain/skills/published-files.tsx components/brain/skills/skill-panel.tsx "app/[tenant]/brain/p/[...slug]/page.tsx" tests/brain/skills-package-route.test.ts tests/brain/skills-http.test.ts tests/brain/skills-components.test.ts
npm run typecheck
git add "app/[tenant]/brain/skills/package/route.ts" lib/brain/core/skills/http.ts components/brain/skills/published-files.tsx components/brain/skills/skill-panel.tsx "app/[tenant]/brain/p/[...slug]/page.tsx" tests/brain/skills-package-route.test.ts tests/brain/skills-http.test.ts tests/brain/skills-components.test.ts
git commit -m "feat: descargar el paquete publicado de una skill desde la web"
```

---

### Task 6: Documentación y wiki

**Files:**
- Modify: `docs/guias/conectar-brain-por-mcp.md`
- Modify: `docs/dominios/brain.md`
- Modify: `lib/brain/README.md`
- Modify: `docs/decisiones/README.md` (link al plan en la fila de la 24.2a)
- Modify: `docs/producto/roadmap.md` (la 24.2a: "código terminado; falta el cierre en producción")
- Regenerar: `docs/referencia/` con `npm run docs:sync`

Leer antes `docs/guias/documentar.md`. Español rioplatense, sin nada específico de un tenant fuera de `producto/`.

- [ ] **Step 1: Guía de MCP**

En `docs/guias/conectar-brain-por-mcp.md`, reemplazar la oración "Las skills de la empresa (todo lo que está bajo `skills/`) no salen por estas tres tools…" por una sección "Skills de la empresa" que diga, con el texto exacto de las descripciones del código cuando las cite:
- No salen por `brain_search`, `brain_read` ni `brain_upsert`. Salen por `skill_list`, `skill_load` y `skill_file`, que aparecen solo si la persona ve alguna skill publicada.
- Siempre se recibe la última versión publicada, también quien edita.
- La descripción de `skill_load` lista hasta 30 skills; una recién publicada aparece cuando el cliente vuelve a pedir las tools (reconectar) y siempre en `skill_list`.
- Por MCP viajan archivos de texto de hasta 256 KB; lo demás está en "Descargar paquete" en la página de la skill.
- Los scripts no se ejecutan desde el servidor todavía (24.2b).

- [ ] **Step 2: Dominio brain**

En `docs/dominios/brain.md`: agregar la fila de `/[tenant]/brain/skills/package` a la tabla de rutas; una subsección "Skills por MCP (etapa 24.2a)" con quién ve qué (tabla de la spec §3), las tres tools, el evento `brain.skill_loaded` y la descarga; sumar a `sources` y a la lista de tests los archivos nuevos; poner `updated: 2026-10-13`. En "Decisiones", anotar M1 a M9 en una línea cada una y que el límite de respuesta de Vercel para el zip queda por verificar en preview.

- [ ] **Step 3: README del brain**

En `lib/brain/README.md`, sección Skills: un párrafo sobre `core/skills/catalog.ts` (qué recibe, que solo conoce la copia publicada), `skill-md.ts`, `zipPackage` y la ruta de descarga.

- [ ] **Step 4: Índices**

En `docs/decisiones/README.md`, completar la columna de plan de la fila 24.2a con `[plan](../superpowers/plans/2026-10-13-etapa-24-2a-skills-por-mcp.md)`. En el roadmap, la 24.2a pasa a empezar con "Código terminado; falta el cierre en producción (spec §10)." y la línea Spec/Plan nombra el plan.

- [ ] **Step 5: Regenerar y verificar**

```bash
npm run docs:sync
npm run docs:check
npm run typecheck
npm test
```

Expected: todo verde. Si `docs:check` pide cobertura para la ruta o los archivos nuevos, se resuelve con la página (`docs/dominios/brain.md`), no con una exclusión.

- [ ] **Step 6: Commit**

```bash
git add docs lib/brain/README.md
git commit -m "docs: skills por MCP y descarga del paquete (etapa 24.2a)"
```

---

## Cierre (lo hace la persona, no un subagente)

1. Con Docker abierto y la base local: publicar una skill, conectarse al MCP local y recorrer el criterio de la spec §1. Probar la descarga del zip y reimportarlo.
2. **Límite de Vercel:** en un deploy de preview, descargar el paquete de una skill con archivos que sumen más de 5 MB. Si la descarga se corta o da error, agregar a la ruta un 413 ("El paquete pesa más de 4 MB y todavía no se puede descargar desde acá.") cuando `zip.length > 4_194_304`, con su test, y anotarlo en `docs/dominios/brain.md`.
3. Producción: sin migración. Va después del cierre de la 24.1 (spec §10).
