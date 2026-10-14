# Etapa 24.2b · Paquete completo por MCP y skills en `/conectar` — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un asistente conectado al brain por MCP obtenga con `skill_package` un link firmado de 10 minutos al zip publicado de una skill (binarios incluidos), que la descarga web redirija a ese mismo zip, y que `/conectar` muestre las skills de cada persona.

**Architecture:** Una función pura, `issuePackageLink` en `lib/brain/core/skills/package-link.ts`, recibe una skill ya autorizada (su slug y su copia publicada), arma y sube el zip solo si no está guardado por digest, firma el link según el canal y registra el evento. El catálogo de la 24.2a suma `package(name)`, que autoriza y delega en esa función por una dependencia `issue`. El adaptador `lib/brain/adapters/skill-packages.ts` implementa el almacén sobre el bucket privado `skill-packages`. La ruta web autoriza con `publishedSkillFor` (reemplaza a `exportSkillPackage`) y redirige. `/conectar` lista con `visibleSkills`, la misma función que filtra el catálogo.

**Tech Stack:** Next.js 16 App Router (route handler, server component), `@modelcontextprotocol/sdk`, zod, Supabase (service role, Storage `exists`, `upload`, `createSignedUrl`), pgTAP, Vitest en entorno `node`.

**Spec:** `docs/superpowers/specs/2026-10-14-etapa-24-2b-paquete-por-mcp-design.md`

## Global Constraints

- **Rama:** `feat/etapa-24-2a-skills-por-mcp`, sobre los commits de la 24.2a. No hacer push ni abrir PR sin que lo pida la persona.
- **Una sola migración:** crea el bucket `skill-packages` (privado, `file_size_limit` 27262976, sin políticas en `storage.objects`). Nada más de SQL. El bucket `skills` no se toca.
- Objeto del zip: `<tenant_id>/<digest>.zip`, con el `digest` de la copia publicada.
- Vencimiento del link: **600 segundos por MCP, 60 por web.** Nombre de descarga: `<name>-v<version>.zip`.
- Evento: `type = 'brain.skill_package_issued'`, `channel = 'mcp'` o `'web'`, `summary = <slug>`, `payload = { name, version, digest }`, `actor_user_id` y `tenant_id`. Solo insert: `events` es append-only. Si falla, se registra en consola y el link se entrega igual.
- Nombre exacto de la tool: `skill_package`. Mensaje genérico de falla: `No pude preparar el paquete. Probá de nuevo.` El detalle va solo al log.
- `issuePackageLink` no decide permisos: recibe la skill ya autorizada. Los permisos los deciden el catálogo (MCP) y `publishedSkillFor` (web), con el criterio de la 24.2a: lectura sobre la ruta y publicación vigente. Inexistente y ajena responden igual.
- Por MCP y por web sale siempre la copia publicada vigente, nunca el borrador.
- `lib/brain/core/` no importa nada fuera de `core` salvo `zod`, `yaml`, `@modelcontextprotocol/sdk`, `node:*` y, como tipo, `@supabase/supabase-js`. Lo vigila `tests/brain/boundary.test.ts`. Los imports relativos dentro de `core` llevan extensión `.ts`. `zipPackage` vive en `adapters` y le llega a `core` como dependencia.
- **`withoutSkills` no se toca.** Sin tool de agente ni nodo nuevos: no se toca `TOOL_LABELS` ni `lib/workflows/registry.ts`.
- Español rioplatense en UI, descripciones de tools y mensajes; código e identificadores en inglés. Nada específico de un tenant en código.
- Tests: `tests/**/*.test.ts`, entorno `node`, componentes con `renderToStaticMarkup`.
- Lint: **no** correr `npm run lint:fix`. Usar `npx biome check --write <archivos de la tarea>` y después `npx biome check <los mismos>` limpio.
- Después de cada tarea: `npm run typecheck` limpio y `npm test -- tests/brain tests/connect` verde. Cada commit termina con la línea `Co-Authored-By` del modelo que lo escribe. Identidad de git: `innovasbuild` / `matias@innov.as`. `git add` solo de los archivos de la tarea.
- **No** aplicar nada en producción.

## Review Focus

1. **`exists` del storage falla por algo que no es "no está"** (red, permisos): no puede convertirse en un error para la persona si subir sí funciona. Se trata como ausente, se rearma y se sube con `upsert`, que es idempotente porque el zip es reproducible. Tarea 4 (`exists` devuelve `data === true`) y Tarea 2 (rearma cuando `exists` da false).
2. **Republicar sin cambios** (versión 3 con el mismo digest que la 2): comparte el objeto guardado, pero el nombre de descarga tiene que decir `-v3`. Tarea 2.
3. **Skill retirada con su zip todavía en el bucket:** no se emite link, ni por MCP ni por web. Tareas 3 y 5.
4. **Un tenant nunca firma el objeto de otro:** la ruta del objeto sale del `tenantId` del pedido, no de nada que mande el cliente. Tarea 4.
5. **Falla del almacén o del evento:** la falla del evento no frena el link; la del almacén responde el mensaje genérico (MCP) o 500 sin detalle (web), sin filtrar rutas, hashes ni mensajes de Supabase. Tareas 2, 3 y 5.

---

### Task 1: Bucket `skill-packages`

**Files:**
- Create: `supabase/migrations/20261022120000_skill_packages_bucket.sql`
- Create: `supabase/tests/35_skill_packages.test.sql`

**Interfaces:**
- Produces: bucket `skill-packages` que usa la Tarea 4.

- [ ] **Step 1: Escribir el test pgTAP**

`supabase/tests/35_skill_packages.test.sql`:

```sql
-- supabase/tests/35_skill_packages.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select is(
  (select public from storage.buckets where id = 'skill-packages'),
  false, 'el bucket skill-packages es privado');
select is(
  (select file_size_limit from storage.buckets where id = 'skill-packages'),
  27262976::bigint, 'el zip de una skill puede pesar hasta 26 MB');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%skill-packages%'),
  0, 'ninguna política de storage abre el bucket skill-packages');

select * from finish();
rollback;
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npm run db:test` (necesita Docker abierto).
Expected: FAIL en `35_skill_packages.test.sql` (el bucket no existe: el primer `is` compara `NULL` con `false`).

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20261022120000_skill_packages_bucket.sql`:

```sql
-- Zips publicados de las skills (spec etapa 24.2b §5). Privado y sin
-- políticas en storage.objects: solo el servidor sube y firma links.
-- Objeto en <tenant_id>/<digest>.zip. 26 MB: el paquete llega a 20 MB y un
-- zip de archivos que no comprimen pesa apenas más.
insert into storage.buckets (id, name, public, file_size_limit)
values ('skill-packages', 'skill-packages', false, 27262976)
on conflict (id) do nothing;
```

- [ ] **Step 4: Correr de nuevo**

Run: `npm run db:test`
Expected: PASS, todos los archivos de `supabase/tests/`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261022120000_skill_packages_bucket.sql supabase/tests/35_skill_packages.test.sql
git commit -m "feat: bucket privado para los zips publicados de las skills"
```

---

### Task 2: `issuePackageLink` (core)

**Files:**
- Create: `lib/brain/core/skills/package-link.ts`
- Modify: `lib/brain/core/skills/files.ts` (`exportSkillPackage` pasa a usar `publishedEntries`; se quita el import de `renderSkillMd`)
- Test: `tests/brain/skills-package-link.test.ts`

**Interfaces:**
- Consumes: `PackageEntry` (tipo, de `files.ts`), `skillName` (`package.ts`), `renderSkillMd` (`skill-md.ts`), `SkillSnapshot` (`store.ts`).
- Produces (las usan las Tareas 3, 4 y 5):

```ts
export const PACKAGE_LINK_SECONDS: { readonly mcp: 600; readonly web: 60 };
export type PackageChannel = "mcp" | "web";
export interface PackageLink { name: string; version: number; filename: string; url: string; expiresIn: number }
export interface PackageObjects {
	exists(tenantId: string, digest: string): Promise<boolean>;
	put(tenantId: string, digest: string, zip: Uint8Array): Promise<void>;
	sign(tenantId: string, digest: string, options: { expiresIn: number; filename: string }): Promise<string>;
}
export interface PackageIssueRecord { tenantId: string; userId: string; channel: PackageChannel; slug: string; name: string; version: number; digest: string }
export interface PackageLinkDeps {
	objects: PackageObjects;
	blob(tenantId: string, sha256: string): Promise<Uint8Array | null>;
	zip(entries: PackageEntry[]): Uint8Array;
	record(entry: PackageIssueRecord): Promise<void>;
}
export interface PackageRequest { tenantId: string; userId: string; channel: PackageChannel; slug: string; snapshot: SkillSnapshot }
export function packageFilename(name: string, version: number): string;
export function publishedEntries(name: string, snapshot: SkillSnapshot, blob: (sha256: string) => Promise<Uint8Array | null>): Promise<PackageEntry[]>;
export function issuePackageLink(request: PackageRequest, deps: PackageLinkDeps): Promise<PackageLink>;
```

- [ ] **Step 1: Escribir los tests**

`tests/brain/skills-package-link.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { type PackageEntry, parseSkillMd, planImport } from "@/lib/brain/core/skills/files";
import {
	issuePackageLink,
	type PackageLinkDeps,
	type PackageRequest,
	publishedEntries,
} from "@/lib/brain/core/skills/package-link";
import type { SkillSnapshot } from "@/lib/brain/core/skills/store";

const bytes = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

function snapshot(over: Partial<SkillSnapshot> = {}): SkillSnapshot {
	return {
		action: "publicar",
		version: 3,
		pageRevision: 5,
		filesDigest: "fd",
		title: "Propuesta",
		description: "Arma la propuesta comercial.",
		body: "# Pasos",
		frontmatter: { description: "Arma la propuesta comercial." },
		manifest: [
			{ path: "scripts/armar.py", sha256: "sha-script", size: 6 },
			{ path: "assets/plantilla.pptx", sha256: "sha-plantilla", size: 3 },
		],
		digest: "dg",
		publishedAt: "2026-10-14T12:00:00Z",
		...over,
	};
}

function request(over: Partial<PackageRequest> = {}): PackageRequest {
	return {
		tenantId: "t1",
		userId: "ana",
		channel: "mcp",
		slug: "skills/ventas/propuesta",
		snapshot: snapshot(),
		...over,
	};
}

function deps(over: Partial<PackageLinkDeps> = {}) {
	const blobs: Record<string, Uint8Array> = {
		"t1/sha-script": bytes("print()"),
		"t1/sha-plantilla": new Uint8Array([0x50, 0x4b, 0x03]),
	};
	const objects = {
		exists: vi.fn(async () => false),
		put: vi.fn(async () => {}),
		sign: vi.fn(async () => "https://storage.test/firmado"),
	};
	const d = {
		objects,
		blob: vi.fn(async (tenantId: string, sha: string) => blobs[`${tenantId}/${sha}`] ?? null),
		zip: vi.fn((_entries: PackageEntry[]) => new Uint8Array([1, 2, 3])),
		record: vi.fn(async () => {}),
		...over,
	};
	return d;
}

describe("publishedEntries", () => {
	it("arma la carpeta con SKILL.md y los archivos publicados, binarios incluidos", async () => {
		const d = deps();
		const entries = await publishedEntries("propuesta", snapshot(), (sha) => d.blob("t1", sha));
		expect(entries.map((entry) => entry.path)).toEqual([
			"propuesta/SKILL.md",
			"propuesta/scripts/armar.py",
			"propuesta/assets/plantilla.pptx",
		]);
		expect(parseSkillMd(decode(entries[0].bytes))).toMatchObject({
			description: "Arma la propuesta comercial.",
			body: "# Pasos",
		});
		expect([...entries[2].bytes]).toEqual([0x50, 0x4b, 0x03]);
	});

	it("lo armado se puede volver a importar", async () => {
		const d = deps();
		const entries = await publishedEntries("propuesta", snapshot(), (sha) => d.blob("t1", sha));
		const plan = planImport(entries);
		if (!plan.ok) throw new Error(plan.problems.join(" "));
		expect(plan.skill.description).toBe("Arma la propuesta comercial.");
		expect(plan.files.map((file) => file.path)).toEqual([
			"scripts/armar.py",
			"assets/plantilla.pptx",
		]);
	});

	it("si falta un blob, lanza: no entrega un paquete incompleto", async () => {
		await expect(
			publishedEntries("propuesta", snapshot(), async () => null),
		).rejects.toThrow();
	});
});

describe("issuePackageLink", () => {
	it("la primera vez arma el zip, lo sube por digest y devuelve el link de 10 minutos por MCP", async () => {
		const d = deps();
		const link = await issuePackageLink(request(), d);
		expect(link).toEqual({
			name: "propuesta",
			version: 3,
			filename: "propuesta-v3.zip",
			url: "https://storage.test/firmado",
			expiresIn: 600,
		});
		expect(d.objects.exists).toHaveBeenCalledWith("t1", "dg");
		expect(d.zip).toHaveBeenCalledOnce();
		expect(d.objects.put).toHaveBeenCalledWith("t1", "dg", new Uint8Array([1, 2, 3]));
		expect(d.objects.sign).toHaveBeenCalledWith("t1", "dg", {
			expiresIn: 600,
			filename: "propuesta-v3.zip",
		});
	});

	it("si el zip ya está guardado no lee ningún archivo ni vuelve a subir", async () => {
		const d = deps();
		d.objects.exists.mockResolvedValue(true);
		await issuePackageLink(request(), d);
		expect(d.blob).not.toHaveBeenCalled();
		expect(d.zip).not.toHaveBeenCalled();
		expect(d.objects.put).not.toHaveBeenCalled();
	});

	it("una versión republicada con el mismo contenido comparte el zip pero se descarga con su número", async () => {
		const d = deps();
		d.objects.exists.mockResolvedValue(true);
		const link = await issuePackageLink(
			request({ snapshot: snapshot({ version: 4 }) }),
			d,
		);
		expect(d.objects.sign).toHaveBeenCalledWith("t1", "dg", {
			expiresIn: 600,
			filename: "propuesta-v4.zip",
		});
		expect(link.filename).toBe("propuesta-v4.zip");
	});

	it("por web el link dura 60 segundos", async () => {
		const d = deps();
		const link = await issuePackageLink(request({ channel: "web" }), d);
		expect(link.expiresIn).toBe(60);
		expect(d.objects.sign).toHaveBeenCalledWith("t1", "dg", {
			expiresIn: 60,
			filename: "propuesta-v3.zip",
		});
	});

	it("registra quién pidió el link, por qué canal y qué versión", async () => {
		const d = deps();
		await issuePackageLink(request({ channel: "web" }), d);
		expect(d.record).toHaveBeenCalledWith({
			tenantId: "t1",
			userId: "ana",
			channel: "web",
			slug: "skills/ventas/propuesta",
			name: "propuesta",
			version: 3,
			digest: "dg",
		});
	});

	it("si el registro falla, el link se entrega igual", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const d = deps({ record: vi.fn(async () => { throw new Error("events caída"); }) });
		const link = await issuePackageLink(request(), d);
		expect(link.url).toBe("https://storage.test/firmado");
		spy.mockRestore();
	});

	it("si el almacén falla, lanza y no firma", async () => {
		const d = deps();
		d.objects.put.mockRejectedValue(new Error("storage caído"));
		await expect(issuePackageLink(request(), d)).rejects.toThrow("storage caído");
		expect(d.objects.sign).not.toHaveBeenCalled();
		expect(d.record).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npm test -- tests/brain/skills-package-link.test.ts`
Expected: FAIL, no se puede resolver `@/lib/brain/core/skills/package-link`.

- [ ] **Step 3: Escribir `package-link.ts`**

`lib/brain/core/skills/package-link.ts`:

```ts
// Link de descarga del paquete publicado de una skill (spec etapa 24.2b §5).
// Puro: recibe la skill ya autorizada por quien llama (el catálogo por MCP,
// los controles de la ruta por web) y no decide permisos. El zip se guarda
// por digest y se arma solo la primera vez que alguien lo pide.
import type { PackageEntry } from "./files.ts";
import { skillName } from "./package.ts";
import { renderSkillMd } from "./skill-md.ts";
import type { SkillSnapshot } from "./store.ts";

export const PACKAGE_LINK_SECONDS = { mcp: 600, web: 60 } as const;

export type PackageChannel = keyof typeof PACKAGE_LINK_SECONDS;

export interface PackageLink {
	name: string;
	version: number;
	filename: string;
	url: string;
	expiresIn: number;
}

export interface PackageObjects {
	exists(tenantId: string, digest: string): Promise<boolean>;
	put(tenantId: string, digest: string, zip: Uint8Array): Promise<void>;
	sign(
		tenantId: string,
		digest: string,
		options: { expiresIn: number; filename: string },
	): Promise<string>;
}

export interface PackageIssueRecord {
	tenantId: string;
	userId: string;
	channel: PackageChannel;
	slug: string;
	name: string;
	version: number;
	digest: string;
}

export interface PackageLinkDeps {
	objects: PackageObjects;
	blob(tenantId: string, sha256: string): Promise<Uint8Array | null>;
	zip(entries: PackageEntry[]): Uint8Array;
	record(entry: PackageIssueRecord): Promise<void>;
}

export interface PackageRequest {
	tenantId: string;
	userId: string;
	channel: PackageChannel;
	slug: string;
	snapshot: SkillSnapshot;
}

export function packageFilename(name: string, version: number): string {
	return `${name}-v${version}.zip`;
}

// Carpeta <name>/ con el SKILL.md armado desde la copia y los archivos del
// manifiesto. Si falta un blob, lanza: nunca un paquete incompleto.
export async function publishedEntries(
	name: string,
	snapshot: SkillSnapshot,
	blob: (sha256: string) => Promise<Uint8Array | null>,
): Promise<PackageEntry[]> {
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
		const bytes = await blob(file.sha256);
		if (!bytes) throw new Error(`skills: falta el contenido de ${file.path}`);
		entries.push({ path: `${name}/${file.path}`, bytes });
	}
	return entries;
}

export async function issuePackageLink(
	request: PackageRequest,
	deps: PackageLinkDeps,
): Promise<PackageLink> {
	const { tenantId, snapshot } = request;
	const name = skillName(request.slug);

	// El digest identifica el contenido publicado y el zip es reproducible:
	// dos pedidos simultáneos suben los mismos bytes.
	if (!(await deps.objects.exists(tenantId, snapshot.digest))) {
		const entries = await publishedEntries(name, snapshot, (sha256) =>
			deps.blob(tenantId, sha256),
		);
		await deps.objects.put(tenantId, snapshot.digest, deps.zip(entries));
	}

	const filename = packageFilename(name, snapshot.version);
	const expiresIn = PACKAGE_LINK_SECONDS[request.channel];
	const url = await deps.objects.sign(tenantId, snapshot.digest, {
		expiresIn,
		filename,
	});

	try {
		await deps.record({
			tenantId,
			userId: request.userId,
			channel: request.channel,
			slug: request.slug,
			name,
			version: snapshot.version,
			digest: snapshot.digest,
		});
	} catch (error) {
		// El registro no puede frenar la entrega del link.
		console.error("skills: no pude registrar el link del paquete", error);
	}

	return { name, version: snapshot.version, filename, url, expiresIn };
}
```

- [ ] **Step 4: `exportSkillPackage` usa `publishedEntries`**

En `lib/brain/core/skills/files.ts`, reemplazar en `exportSkillPackage` desde `const name = skillName(slug);` hasta el `return` por:

```ts
	const name = skillName(slug);
	const entries = await publishedEntries(name, snapshot, (sha256) =>
		deps.blobs.get(ctx.actor.tenantId, sha256),
	);
	return { ok: true, name, version: snapshot.version, entries };
```

Agregar `import { publishedEntries } from "./package-link.ts";` y quitar `import { renderSkillMd } from "./skill-md.ts";` si queda sin uso. `package-link.ts` importa de `files.ts` solo un tipo, así que no hay ciclo en tiempo de ejecución.

- [ ] **Step 5: Correr los tests**

Run: `npm test -- tests/brain/skills-package-link.test.ts tests/brain/skills-files.test.ts tests/brain/boundary.test.ts`
Expected: PASS. Los tests de `exportSkillPackage` siguen verdes sin cambios.

- [ ] **Step 6: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/skills/package-link.ts lib/brain/core/skills/files.ts tests/brain/skills-package-link.test.ts
npx biome check lib/brain/core/skills/package-link.ts lib/brain/core/skills/files.ts tests/brain/skills-package-link.test.ts
npm run typecheck
git add lib/brain/core/skills/package-link.ts lib/brain/core/skills/files.ts tests/brain/skills-package-link.test.ts
git commit -m "feat: link firmado al zip publicado de una skill, guardado por digest"
```

---

### Task 3: `visibleSkills` y `package(name)` en el catálogo

**Files:**
- Modify: `lib/brain/core/skills/catalog.ts`
- Test: `tests/brain/skills-catalog.test.ts`

**Interfaces:**
- Consumes: `PackageLink` (Tarea 2).
- Produces:

```ts
export interface VisibleSkill { slug: string; name: string; snapshot: SkillSnapshot }
export function visibleSkills(rows: SkillOverviewRow[], levelOf: (slug: string) => Level | null): VisibleSkill[]; // ordenadas por nombre
// SkillCatalogDeps suma:
issue(entry: { slug: string; snapshot: SkillSnapshot }): Promise<PackageLink>;
// SkillCatalog suma:
package(name: string): Promise<PackageLink>;
export const PACKAGE_FAILED = "No pude preparar el paquete. Probá de nuevo.";
```

- [ ] **Step 1: Escribir los tests**

En `tests/brain/skills-catalog.test.ts`:

1. Sumar al import de `@/lib/brain/core/skills/catalog` los nombres `PACKAGE_FAILED` y `visibleSkills`.
2. En el helper `deps(...)`, sumar antes de `...over`:

```ts
		issue: vi.fn(async (entry: { slug: string; snapshot: SkillSnapshot }) => ({
			name: entry.slug.split("/").at(-1) ?? "",
			version: entry.snapshot.version,
			filename: "x.zip",
			url: "https://storage.test/firmado",
			expiresIn: 600,
		})),
```

3. En el test que hoy hace `expect(binario).toContain("descarga del paquete");`, cambiar por `expect(binario).toContain("skill_package");`.
4. Agregar al final:

```ts
describe("visibleSkills", () => {
	it("deja solo las publicadas vigentes que la persona lee, ordenadas por nombre, con su slug", () => {
		const rows = [
			row("skills/ventas/reporte", snapshot()),
			row("skills/alta", snapshot({ version: 1 })),
			row("skills/borrador", null),
			row("skills/retirada", snapshot({ action: "retirar" })),
			row("skills/rrhh/sueldos", snapshot()),
		];
		const visible = visibleSkills(rows, (slug) =>
			slug.startsWith("skills/rrhh") ? null : "lector",
		);
		expect(visible.map((skill) => [skill.name, skill.slug])).toEqual([
			["alta", "skills/alta"],
			["reporte", "skills/ventas/reporte"],
		]);
		expect(visible[0].snapshot.version).toBe(1);
	});
});

describe("package", () => {
	it("pide el link con el slug y la copia publicada de la skill", async () => {
		const d = deps([row("skills/ventas/reporte", snapshot())]);
		const catalog = await loadSkillCatalog(d);
		const link = await catalog?.package("reporte");
		expect(link).toMatchObject({ url: "https://storage.test/firmado", version: 2 });
		expect(d.issue).toHaveBeenCalledWith({
			slug: "skills/ventas/reporte",
			snapshot: expect.objectContaining({ version: 2, digest: "dg" }),
		});
	});

	it("una skill ajena o inexistente responde igual y no pide link", async () => {
		const d = deps([row("skills/rrhh/sueldos", snapshot()), row("skills/ventas/reporte", snapshot())], {
			levelOf: (slug) => (slug.startsWith("skills/rrhh") ? null : "lector"),
		});
		const catalog = await loadSkillCatalog(d);
		const ajena = await expectBrainError(catalog?.package("sueldos") as Promise<unknown>, "not_found");
		const inventada = await expectBrainError(catalog?.package("nada") as Promise<unknown>, "not_found");
		expect(ajena.replace("sueldos", "X")).toBe(inventada.replace("nada", "X"));
		expect(d.issue).not.toHaveBeenCalled();
	});

	it("una skill retirada no da link aunque su zip siga guardado", async () => {
		const d = deps([
			row("skills/ventas/reporte", snapshot()),
			row("skills/vieja", snapshot({ action: "retirar" })),
		]);
		const catalog = await loadSkillCatalog(d);
		await expectBrainError(catalog?.package("vieja") as Promise<unknown>, "not_found");
		expect(d.issue).not.toHaveBeenCalled();
	});

	it("si falla el armado o el storage, responde el mensaje genérico sin el detalle", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const d = deps([row("skills/ventas/reporte", snapshot())], {
			issue: vi.fn(async () => {
				throw new Error("storage: bucket t1/dg.zip no responde");
			}),
		});
		const catalog = await loadSkillCatalog(d);
		const message = await expectBrainError(
			catalog?.package("reporte") as Promise<unknown>,
			"provider_unavailable",
		);
		expect(message).toBe(PACKAGE_FAILED);
		expect(message).not.toContain("t1/dg");
		spy.mockRestore();
	});
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npm test -- tests/brain/skills-catalog.test.ts`
Expected: FAIL (`visibleSkills` no existe, `catalog.package` no es función, el mensaje de binarios todavía dice "descarga del paquete").

- [ ] **Step 3: Implementar en `catalog.ts`**

1. Imports: sumar `import type { PackageLink } from "./package-link.ts";`.
2. Reemplazar la constante `IN_PACKAGE` por:

```ts
const IN_PACKAGE =
	"Se obtiene con skill_package, que devuelve el paquete completo de la skill.";

export const PACKAGE_FAILED = "No pude preparar el paquete. Probá de nuevo.";
```

3. En `SkillCatalogDeps` sumar:

```ts
	/** Emite el link al zip publicado; la skill ya está autorizada. */
	issue(entry: { slug: string; snapshot: SkillSnapshot }): Promise<PackageLink>;
```

4. En `SkillCatalog` sumar `package(name: string): Promise<PackageLink>;`.
5. Agregar, antes de `loadSkillCatalog`:

```ts
export interface VisibleSkill {
	slug: string;
	name: string;
	snapshot: SkillSnapshot;
}

// Las skills que una persona puede usar: publicación vigente y al menos
// lectura sobre la ruta. La comparten el catálogo de MCP y /conectar, así las
// dos listas no pueden diferir.
export function visibleSkills(
	rows: SkillOverviewRow[],
	levelOf: (slug: string) => Level | null,
): VisibleSkill[] {
	const visible: VisibleSkill[] = [];
	for (const row of rows) {
		const snapshot = publishedSnapshot(row);
		if (!snapshot || levelOf(row.slug) === null) continue;
		visible.push({ slug: row.slug, name: skillName(row.slug), snapshot });
	}
	return visible.sort((a, b) => (a.name < b.name ? -1 : 1));
}
```

6. En `loadSkillCatalog`, reemplazar el `for` que llena `visible` por:

```ts
	const visible = new Map<string, { slug: string; snapshot: SkillSnapshot }>();
	// El nombre es único por empresa entre las publicadas (brain_publish_skill).
	for (const skill of visibleSkills(await deps.overview(), deps.levelOf)) {
		visible.set(skill.name, { slug: skill.slug, snapshot: skill.snapshot });
	}
```

7. Agregar el método al objeto que devuelve, después de `file`:

```ts
		async package(name) {
			const { slug, snapshot } = find(name);
			try {
				return await deps.issue({ slug, snapshot });
			} catch (error) {
				console.error("skills: no pude preparar el paquete", error);
				throw new BrainError("provider_unavailable", PACKAGE_FAILED);
			}
		},
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- tests/brain/skills-catalog.test.ts tests/brain/boundary.test.ts`
Expected: PASS.

`npm run typecheck` va a fallar en `tests/brain/mcp-server/tools.test.ts` y `lib/brain/core/mcp-server/handler.ts` hasta la Tarea 4 si no se completan ahí. Para que esta tarea cierre limpia, hacer ya estos dos ajustes mínimos:
- `lib/brain/core/mcp-server/handler.ts`: en el objeto que se pasa a `loadSkillCatalog`, sumar `issue: (entry) => deps.skills.issue({ tenantId: access.tenantId, userId: access.userId, slug: entry.slug, snapshot: entry.snapshot }),` y en `McpSkillsDeps` sumar `issue(request: Omit<PackageRequest, "channel">): Promise<PackageLink>;` con `import type { PackageLink, PackageRequest } from "../skills/package-link.ts";`.
- `lib/brain/adapters/mcp-production.ts`, en `skillsDeps()`: `issue: async () => { throw new Error("skill_package: sin cablear todavía"); },` (la Tarea 4 lo reemplaza).
- `tests/brain/mcp-server/tools.test.ts`, en `fakeCatalog`: sumar `package: vi.fn(async (name: string) => ({ name, version: 2, filename: \`${name}-v2.zip\`, url: "https://storage.test/firmado", expiresIn: 600 })),`.
- `tests/brain/mcp-server/handler.test.ts`: en el helper `deps()` y en **cada** objeto literal `skills: { overview, blob, record }` del archivo, sumar `issue: vi.fn(),`.

- [ ] **Step 5: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/skills/catalog.ts lib/brain/core/mcp-server/handler.ts lib/brain/adapters/mcp-production.ts tests/brain/skills-catalog.test.ts tests/brain/mcp-server/tools.test.ts tests/brain/mcp-server/handler.test.ts
npx biome check lib/brain/core/skills/catalog.ts lib/brain/core/mcp-server/handler.ts lib/brain/adapters/mcp-production.ts tests/brain/skills-catalog.test.ts tests/brain/mcp-server/tools.test.ts tests/brain/mcp-server/handler.test.ts
npm run typecheck
npm test -- tests/brain
git add lib/brain/core/skills/catalog.ts lib/brain/core/mcp-server/handler.ts lib/brain/adapters/mcp-production.ts tests/brain/skills-catalog.test.ts tests/brain/mcp-server/tools.test.ts tests/brain/mcp-server/handler.test.ts
git commit -m "feat: el catálogo de skills emite el link al paquete publicado"
```

---

### Task 4: Tool `skill_package`, almacén en Storage y cableado

**Files:**
- Create: `lib/brain/adapters/skill-packages.ts`
- Modify: `lib/brain/core/mcp-server/server.ts`
- Modify: `lib/brain/adapters/mcp-production.ts`
- Test: `tests/brain/skill-packages-adapter.test.ts` (nuevo), `tests/brain/mcp-server/tools.test.ts`, `tests/brain/mcp-server/handler.test.ts`

**Interfaces:**
- Consumes: `issuePackageLink`, `PackageObjects`, `PackageLinkDeps`, `PackageIssueRecord` (Tarea 2); `catalog.package` y `McpSkillsDeps.issue` (Tarea 3); `zipPackage` (`adapters/skill-zip.ts`); `blobStore` (`adapters/skills.ts`).
- Produces (las usa la Tarea 5):

```ts
// lib/brain/adapters/skill-packages.ts
export function packageObjects(): PackageObjects;
export function packageIssueEvent(entry: PackageIssueRecord): Record<string, unknown>;
export function packageLinkDeps(): PackageLinkDeps;
// lib/brain/core/mcp-server/server.ts
SKILL_TOOL_NAMES.package === "skill_package"
```

- [ ] **Step 1: Test del adaptador**

`tests/brain/skill-packages-adapter.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
	exists: vi.fn(),
	upload: vi.fn(),
	createSignedUrl: vi.fn(),
	from: vi.fn(),
	insert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		storage: {
			from: (bucket: string) => {
				storage.from(bucket);
				return {
					exists: storage.exists,
					upload: storage.upload,
					createSignedUrl: storage.createSignedUrl,
				};
			},
		},
		from: () => ({ insert: storage.insert }),
	}),
}));
vi.mock("@/lib/brain/adapters/skills", () => ({
	blobStore: () => ({ get: vi.fn(async () => null), put: vi.fn() }),
}));

import {
	packageIssueEvent,
	packageLinkDeps,
	packageObjects,
} from "@/lib/brain/adapters/skill-packages";

beforeEach(() => vi.clearAllMocks());

describe("packageObjects", () => {
	it("busca, sube y firma en skill-packages bajo <tenant>/<digest>.zip", async () => {
		storage.exists.mockResolvedValue({ data: true, error: null });
		storage.upload.mockResolvedValue({ data: {}, error: null });
		storage.createSignedUrl.mockResolvedValue({
			data: { signedUrl: "https://storage.test/firmado" },
			error: null,
		});
		const objects = packageObjects();
		expect(await objects.exists("t1", "dg")).toBe(true);
		await objects.put("t1", "dg", new Uint8Array([1]));
		const url = await objects.sign("t1", "dg", { expiresIn: 600, filename: "reporte-v2.zip" });

		expect(url).toBe("https://storage.test/firmado");
		expect(storage.from.mock.calls.every(([bucket]) => bucket === "skill-packages")).toBe(true);
		expect(storage.exists).toHaveBeenCalledWith("t1/dg.zip");
		expect(storage.upload).toHaveBeenCalledWith("t1/dg.zip", new Uint8Array([1]), {
			contentType: "application/zip",
			upsert: true,
		});
		expect(storage.createSignedUrl).toHaveBeenCalledWith("t1/dg.zip", 600, {
			download: "reporte-v2.zip",
		});
	});

	it("un tenant firma solo su propio objeto", async () => {
		storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "u" }, error: null });
		await packageObjects().sign("t2", "dg", { expiresIn: 60, filename: "a-v1.zip" });
		expect(storage.createSignedUrl).toHaveBeenCalledWith("t2/dg.zip", 60, { download: "a-v1.zip" });
	});

	it("si exists da error, lo trata como ausente: se rearma y se sube", async () => {
		storage.exists.mockResolvedValue({ data: false, error: { message: "timeout" } });
		expect(await packageObjects().exists("t1", "dg")).toBe(false);
	});

	it("si subir o firmar falla, lanza", async () => {
		storage.upload.mockResolvedValue({ data: null, error: { message: "lleno" } });
		storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: "no" } });
		await expect(packageObjects().put("t1", "dg", new Uint8Array())).rejects.toThrow();
		await expect(
			packageObjects().sign("t1", "dg", { expiresIn: 60, filename: "a.zip" }),
		).rejects.toThrow();
	});
});

describe("packageIssueEvent", () => {
	it("arma el evento con canal, slug y versión", () => {
		expect(
			packageIssueEvent({
				tenantId: "t1",
				userId: "ana",
				channel: "web",
				slug: "skills/ventas/reporte",
				name: "reporte",
				version: 2,
				digest: "dg",
			}),
		).toEqual({
			tenant_id: "t1",
			actor_user_id: "ana",
			channel: "web",
			type: "brain.skill_package_issued",
			summary: "skills/ventas/reporte",
			payload: { name: "reporte", version: 2, digest: "dg" },
		});
	});
});

describe("packageLinkDeps", () => {
	it("el registro inserta en events y lanza con el mensaje de la base si falla", async () => {
		storage.insert.mockResolvedValue({ error: { message: "rls" } });
		const record = {
			tenantId: "t1",
			userId: "ana",
			channel: "mcp" as const,
			slug: "skills/a",
			name: "a",
			version: 1,
			digest: "dg",
		};
		await expect(packageLinkDeps().record(record)).rejects.toThrow("rls");
		expect(storage.insert).toHaveBeenCalledWith(packageIssueEvent(record));
	});
});
```

- [ ] **Step 2: Tests del servidor y del handler**

En `tests/brain/mcp-server/tools.test.ts`, dentro de `describe("tools de skills")`:

1. En el test "con catálogo aparecen las tres…", cambiar el nombre a "con catálogo aparecen las cuatro, las instrucciones y la lista en skill_load", y la lista esperada a:

```ts
			"brain_read",
			"brain_search",
			"brain_upsert",
			"skill_file",
			"skill_list",
			"skill_load",
			"skill_package",
```

y sumar `expect(client.getInstructions()).toContain("skill_package");`.

2. Agregar:

```ts
	it("skill_package devuelve el link del catálogo y cuenta como lectura", async () => {
		const limiter = fakeLimiter();
		const catalog = fakeCatalog();
		const client = await connect(build(catalog, limiter));
		const result = await client.callTool({
			name: "skill_package",
			arguments: { name: "reporte" },
		});
		expect(result.structuredContent).toEqual({
			ok: true,
			name: "reporte",
			version: 2,
			filename: "reporte-v2.zip",
			url: "https://storage.test/firmado",
			expiresIn: 600,
		});
		expect(catalog.package).toHaveBeenCalledWith("reporte");
		expect(limiter.check).toHaveBeenCalledWith("read");
	});

	it("la descripción de skill_package dice que se baja a una carpeta temporal y no se instala", async () => {
		const client = await connect(build(fakeCatalog()));
		const description =
			(await client.listTools()).tools.find((t) => t.name === "skill_package")
				?.description ?? "";
		expect(description).toContain("10 minutos");
		expect(description).toContain("carpeta temporal");
		expect(description).toContain("no lo instales");
	});
```

En `tests/brain/mcp-server/handler.test.ts`, dentro de `describe("handleBrainMcp · skills")`, agregar:

```ts
	it("skill_package pide el link con el tenant, la persona y la copia publicada", async () => {
		const issue = vi.fn(async () => ({
			name: "reporte",
			version: 2,
			filename: "reporte-v2.zip",
			url: "https://storage.test/firmado",
			expiresIn: 600,
		}));
		const client = await connect(
			"ana",
			deps({
				skills: {
					overview: async () => [publishedRow("skills/ventas/reporte")],
					blob: async () => null,
					record: async () => {},
					issue,
				},
			}),
		);
		const result = await client.callTool({
			name: "skill_package",
			arguments: { name: "reporte" },
		});
		expect(result.structuredContent).toMatchObject({
			ok: true,
			url: "https://storage.test/firmado",
		});
		expect(issue).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			userId: "ana",
			slug: "skills/ventas/reporte",
			snapshot: expect.objectContaining({ version: 2, digest: "dg" }),
		});
	});
```

- [ ] **Step 3: Correrlos y ver que fallan**

Run: `npm test -- tests/brain/skill-packages-adapter.test.ts tests/brain/mcp-server`
Expected: FAIL (no existe `skill-packages.ts`; no hay tool `skill_package`).

- [ ] **Step 4: Escribir el adaptador**

`lib/brain/adapters/skill-packages.ts`:

```ts
// Zips publicados de las skills en Storage (spec etapa 24.2b §5): bucket
// privado skill-packages, objeto <tenant_id>/<digest>.zip, links firmados.
// La ruta del objeto sale siempre del tenant del pedido.
import { createAdminClient } from "@/lib/supabase/admin";
import type {
	PackageIssueRecord,
	PackageLinkDeps,
	PackageObjects,
} from "../core/skills/package-link";
import { zipPackage } from "./skill-zip";
import { blobStore } from "./skills";

const BUCKET = "skill-packages";

function objectPath(tenantId: string, digest: string): string {
	return `${tenantId}/${digest}.zip`;
}

export function packageObjects(): PackageObjects {
	const bucket = () => createAdminClient().storage.from(BUCKET);
	return {
		async exists(tenantId, digest) {
			// Cualquier duda cuenta como "no está": se rearma y se sube con
			// upsert, que es inocuo porque el zip es reproducible.
			const { data } = await bucket().exists(objectPath(tenantId, digest));
			return data === true;
		},
		async put(tenantId, digest, zip) {
			const { error } = await bucket().upload(objectPath(tenantId, digest), zip, {
				contentType: "application/zip",
				upsert: true,
			});
			if (error) {
				throw new Error(`skills: no pude guardar el paquete: ${error.message}`);
			}
		},
		async sign(tenantId, digest, { expiresIn, filename }) {
			const { data, error } = await bucket().createSignedUrl(
				objectPath(tenantId, digest),
				expiresIn,
				{ download: filename },
			);
			if (error || !data) {
				throw new Error(
					`skills: no pude firmar el paquete: ${error?.message ?? "sin datos"}`,
				);
			}
			return data.signedUrl;
		},
	};
}

export function packageIssueEvent(
	entry: PackageIssueRecord,
): Record<string, unknown> {
	return {
		tenant_id: entry.tenantId,
		actor_user_id: entry.userId,
		channel: entry.channel,
		type: "brain.skill_package_issued",
		summary: entry.slug,
		payload: { name: entry.name, version: entry.version, digest: entry.digest },
	};
}

export function packageLinkDeps(): PackageLinkDeps {
	return {
		objects: packageObjects(),
		blob: (tenantId, sha256) => blobStore().get(tenantId, sha256),
		zip: zipPackage,
		// events es append-only: solo insert. Se tira solo el mensaje de la base.
		async record(entry) {
			const { error } = await createAdminClient()
				.from("events")
				.insert(packageIssueEvent(entry));
			if (error) throw new Error(error.message);
		},
	};
}
```

- [ ] **Step 5: Registrar la tool y cambiar las instrucciones**

En `lib/brain/core/mcp-server/server.ts`:

1. `SKILL_TOOL_NAMES` suma `package: "skill_package",`.
2. Reemplazar `SKILL_INSTRUCTIONS` por:

```ts
const SKILL_INSTRUCTIONS =
	"Esta empresa publica skills: procedimientos revisados para hacer una tarea a su manera. Antes de una tarea que coincida con una skill de la lista de skill_load, cargala con skill_load y seguí sus instrucciones. Los archivos de texto de una skill se leen con skill_file. Si la skill trae scripts y tu entorno puede ejecutar código y bajar archivos, pedí el paquete completo con skill_package. Si no puede, seguí las instrucciones con lo que tengas y avisale a la persona que hay un script que no pudiste correr.";

const SKILL_PACKAGE_DESCRIPTION =
	"Devuelve un link de descarga que vence en 10 minutos con el paquete completo de una skill (zip con SKILL.md, scripts y binarios), siempre en su última versión publicada. Bajalo a una carpeta temporal, descomprimilo y corré los scripts desde ahí. No lo instales en tu carpeta de skills: esa copia queda vieja cuando la empresa publica una versión nueva; pedilo de nuevo en cada sesión. Si el link venció, pedí otro. Si tu entorno no puede bajar archivos, seguí con skill_load y skill_file y avisale a la persona.";
```

3. Dentro de `if (skills) { ... }`, después de registrar `skill_file`:

```ts
		server.registerTool(
			SKILL_TOOL_NAMES.package,
			{
				description: SKILL_PACKAGE_DESCRIPTION,
				inputSchema: { name: z.string().min(1).max(64) },
			},
			async ({ name }) =>
				run("read", async () => ({
					ok: true,
					...(await skills.package(name)),
				})),
		);
```

4. En la descripción de `skill_file`, reemplazar "Los binarios y los archivos de más de 256 KB no se leen desde acá." por "Los binarios y los archivos de más de 256 KB no se leen desde acá: vienen en el paquete de skill_package.".

- [ ] **Step 6: Cablear en producción**

En `lib/brain/adapters/mcp-production.ts`:
- Sumar imports `import { issuePackageLink } from "../core/skills/package-link.ts";` y `import { packageLinkDeps } from "./skill-packages.ts";`.
- En `skillsDeps()`, reemplazar el `issue` provisorio de la Tarea 3 por:

```ts
		issue: (request) =>
			issuePackageLink({ ...request, channel: "mcp" }, packageLinkDeps()),
```

- [ ] **Step 7: Correr los tests**

Run: `npm test -- tests/brain`
Expected: PASS.

- [ ] **Step 8: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/adapters/skill-packages.ts lib/brain/core/mcp-server/server.ts lib/brain/adapters/mcp-production.ts tests/brain/skill-packages-adapter.test.ts tests/brain/mcp-server/tools.test.ts tests/brain/mcp-server/handler.test.ts
npx biome check lib/brain/adapters/skill-packages.ts lib/brain/core/mcp-server/server.ts lib/brain/adapters/mcp-production.ts tests/brain/skill-packages-adapter.test.ts tests/brain/mcp-server/tools.test.ts tests/brain/mcp-server/handler.test.ts
npm run typecheck
git add lib/brain/adapters/skill-packages.ts lib/brain/core/mcp-server/server.ts lib/brain/adapters/mcp-production.ts tests/brain/skill-packages-adapter.test.ts tests/brain/mcp-server/tools.test.ts tests/brain/mcp-server/handler.test.ts
git commit -m "feat: tool skill_package en el MCP del brain"
```

---

### Task 5: La descarga web redirige al zip guardado

**Files:**
- Modify: `lib/brain/core/skills/files.ts` (`publishedSkillFor` reemplaza a `exportSkillPackage`)
- Modify: `app/[tenant]/brain/skills/package/route.ts`
- Test: `tests/brain/skills-files.test.ts`, `tests/brain/skills-package-route.test.ts`

**Interfaces:**
- Consumes: `issuePackageLink` (Tarea 2), `packageLinkDeps` (Tarea 4), `filesDeps` (`adapters/skills.ts`).
- Produces:

```ts
export function publishedSkillFor(
	tenantSlug: string,
	slug: string,
	deps: FilesDeps,
): Promise<
	| { ok: true; tenantId: string; userId: string; slug: string; snapshot: SkillSnapshot }
	| SkillFailure
>;
```

- [ ] **Step 1: Tests de `publishedSkillFor`**

En `tests/brain/skills-files.test.ts`, reemplazar el bloque entero `describe("exportSkillPackage", ...)` por el de abajo, y en el import cambiar `exportSkillPackage` por `publishedSkillFor`. Los casos de "se puede volver a importar" y "falta un blob" ya están cubiertos por `publishedEntries` en `tests/brain/skills-package-link.test.ts`.

```ts
describe("publishedSkillFor", () => {
	it("un lector recibe la copia publicada con su tenant y su persona", async () => {
		const { deps } = setup(LECTOR);
		const result = await publishedSkillFor("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		expect(result.slug).toBe(SLUG);
		expect(result.tenantId).toBe("t1");
		expect(result.snapshot.version).toBe(2);
		expect(result.snapshot.manifest).toEqual(published);
	});

	it("un editor también recibe la publicada, no el borrador", async () => {
		const { deps } = setup();
		const result = await publishedSkillFor("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		expect(result.snapshot.manifest).toEqual(published);
	});

	it("sin publicación vigente, sin lectura o sin ser miembro: not_found", async () => {
		const noMember = setup().deps;
		for (const deps of [
			setup({ current: null }).deps,
			setup(HIDDEN).deps,
			{ ...noMember, actor: async () => null },
		]) {
			expect(await publishedSkillFor("acme", SLUG, deps)).toMatchObject({
				ok: false,
				code: "not_found",
			});
		}
	});
});
```

Antes de correr, confirmar en el helper `setup(...)` del archivo cuál es el `tenantId` del actor (el bloque viejo usaba `blobs.delete("t1/pub")`, así que es `t1`) y que `userId` existe en el actor; si el nombre difiere, ajustar la aserción, no el helper.

- [ ] **Step 2: Test de la ruta**

Reemplazar `tests/brain/skills-package-route.test.ts` entero por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	filesDeps: vi.fn(() => ({})),
	packageLinkDeps: vi.fn(() => ({})),
	publishedSkillFor: vi.fn(),
	issuePackageLink: vi.fn(),
}));

vi.mock("@/lib/brain/adapters/skills", () => ({ filesDeps: state.filesDeps }));
vi.mock("@/lib/brain/adapters/skill-packages", () => ({
	packageLinkDeps: state.packageLinkDeps,
}));
vi.mock("@/lib/brain/core/skills/files", () => ({
	publishedSkillFor: state.publishedSkillFor,
}));
vi.mock("@/lib/brain/core/skills/package-link", () => ({
	issuePackageLink: state.issuePackageLink,
}));

import { GET } from "@/app/[tenant]/brain/skills/package/route";

const params = (tenant = "acme") => ({ params: Promise.resolve({ tenant }) });
const get = (query: string) =>
	new Request(`https://agentes.innov.as/acme/brain/skills/package${query}`);

const snapshot = { version: 3, digest: "dg" };

beforeEach(() => vi.clearAllMocks());

describe("GET /brain/skills/package", () => {
	it("redirige al link firmado por web, sin caché", async () => {
		state.publishedSkillFor.mockResolvedValue({
			ok: true,
			tenantId: "t1",
			userId: "ana",
			slug: "skills/ventas/reporte",
			snapshot,
		});
		state.issuePackageLink.mockResolvedValue({
			name: "reporte",
			version: 3,
			filename: "reporte-v3.zip",
			url: "https://storage.test/firmado",
			expiresIn: 60,
		});
		const response = await GET(get("?slug=skills/ventas/reporte"), params());
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://storage.test/firmado");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(state.publishedSkillFor).toHaveBeenCalledWith(
			"acme",
			"skills/ventas/reporte",
			expect.anything(),
		);
		expect(state.issuePackageLink).toHaveBeenCalledWith(
			{
				tenantId: "t1",
				userId: "ana",
				channel: "web",
				slug: "skills/ventas/reporte",
				snapshot,
			},
			expect.anything(),
		);
	});

	it("404 sin slug, con tenant inválido o cuando la persona no ve la skill publicada", async () => {
		expect((await GET(get(""), params())).status).toBe(404);
		expect((await GET(get("?slug=skills/a"), params("Acme_malo"))).status).toBe(404);
		expect(state.publishedSkillFor).not.toHaveBeenCalled();
		state.publishedSkillFor.mockResolvedValue({
			ok: false,
			code: "not_found",
			message: "No encontrado.",
		});
		expect((await GET(get("?slug=skills/a"), params())).status).toBe(404);
		expect(state.issuePackageLink).not.toHaveBeenCalled();
	});

	it("500 sin detalles si falla el storage", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		state.publishedSkillFor.mockResolvedValue({
			ok: true,
			tenantId: "t1",
			userId: "ana",
			slug: "skills/a",
			snapshot,
		});
		state.issuePackageLink.mockRejectedValue(new Error("bucket t1/dg.zip caído"));
		const response = await GET(get("?slug=skills/a"), params());
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain("t1/dg");
		spy.mockRestore();
	});
});
```

- [ ] **Step 3: Correrlos y ver que fallan**

Run: `npm test -- tests/brain/skills-files.test.ts tests/brain/skills-package-route.test.ts`
Expected: FAIL (`publishedSkillFor` no existe; la ruta todavía responde 200 con el zip).

- [ ] **Step 4: `publishedSkillFor` en `files.ts`**

Reemplazar la función `exportSkillPackage` entera (y su comentario) por:

```ts
// La skill que se distribuye: siempre la copia publicada vigente, también
// para quien edita (spec etapa 24.2a M7). Sin ella, no existe. El zip lo arma
// y lo firma core/skills/package-link.ts (spec etapa 24.2b §6).
export async function publishedSkillFor(
	tenantSlug: string,
	slug: string,
	deps: FilesDeps,
): Promise<
	| {
			ok: true;
			tenantId: string;
			userId: string;
			slug: string;
			snapshot: SkillSnapshot;
	  }
	| SkillFailure
> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return skillFail("not_found", NOT_FOUND);
	const snapshot = publishedSnapshot(ctx.row);
	if (!snapshot) return skillFail("not_found", NOT_FOUND);
	return {
		ok: true,
		tenantId: ctx.actor.tenantId,
		userId: ctx.actor.userId,
		slug,
		snapshot,
	};
}
```

Ajustar imports: sumar `SkillSnapshot` al `import type { ... } from "./store.ts"`; quitar `import { publishedEntries } from "./package-link.ts";` (lo sumó la Tarea 2 y queda sin uso). Si `skillName` queda sin uso en `files.ts`, quitarlo del import. Correr `grep -rn exportSkillPackage lib app tests` y confirmar que no queda ninguna referencia.

- [ ] **Step 5: La ruta**

Reemplazar `app/[tenant]/brain/skills/package/route.ts` entero por:

```ts
import { packageLinkDeps } from "@/lib/brain/adapters/skill-packages";
import { filesDeps } from "@/lib/brain/adapters/skills";
import { publishedSkillFor } from "@/lib/brain/core/skills/files";
import { issuePackageLink } from "@/lib/brain/core/skills/package-link";

// Descarga del paquete publicado de una skill (spec etapa 24.2b §6). Siempre
// la versión vigente. El permiso lo decide core/skills/files.ts; lo que no se
// ve responde igual que lo que no existe. El zip no pasa por la función:
// redirige a un link firmado de 60 segundos, así no hay tope de respuesta.

const TENANT = /^[a-z0-9-]{1,63}$/;

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

	try {
		const skill = await publishedSkillFor(tenant, slug, filesDeps());
		if (!skill.ok) return notFound();
		const link = await issuePackageLink(
			{
				tenantId: skill.tenantId,
				userId: skill.userId,
				channel: "web",
				slug: skill.slug,
				snapshot: skill.snapshot,
			},
			packageLinkDeps(),
		);
		return new Response(null, {
			status: 302,
			headers: { location: link.url, "cache-control": "no-store" },
		});
	} catch (error) {
		console.error("skills: falló la descarga del paquete", error);
		return new Response("No pude armar el paquete. Probá de nuevo.", {
			status: 500,
		});
	}
}
```

- [ ] **Step 6: Correr los tests**

Run: `npm test -- tests/brain`
Expected: PASS.

- [ ] **Step 7: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/skills/files.ts "app/[tenant]/brain/skills/package/route.ts" tests/brain/skills-files.test.ts tests/brain/skills-package-route.test.ts
npx biome check lib/brain/core/skills/files.ts "app/[tenant]/brain/skills/package/route.ts" tests/brain/skills-files.test.ts tests/brain/skills-package-route.test.ts
npm run typecheck
git add lib/brain/core/skills/files.ts "app/[tenant]/brain/skills/package/route.ts" tests/brain/skills-files.test.ts tests/brain/skills-package-route.test.ts
git commit -m "feat: la descarga web del paquete redirige al zip guardado"
```

---

### Task 6: Sección "Tus skills" en `/conectar`

**Files:**
- Modify: `lib/brain/adapters/skills.ts` (`memberSkills`)
- Create: `app/[tenant]/conectar/skills-section.tsx`
- Modify: `app/[tenant]/conectar/page.tsx`
- Test: `tests/connect/skills-section.test.ts` (nuevo), `tests/connect/conectar-page.test.ts`

**Interfaces:**
- Consumes: `visibleSkills` (Tarea 3), `skillPackageHref` (`core/skills/http.ts`), `pageHref` (`core/editor/slug.ts`).
- Produces:

```ts
// lib/brain/adapters/skills.ts
export interface MemberSkill { slug: string; name: string; description: string; version: number }
export function memberSkills(member: { tenantId: string; userId: string; role: BrainRole }): Promise<MemberSkill[]>;
// app/[tenant]/conectar/skills-section.tsx
export function SkillsSection(props: { tenantSlug: string; skills: MemberSkill[] | null }): JSX.Element;
```

- [ ] **Step 1: Test del componente**

`tests/connect/skills-section.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillsSection } from "@/app/[tenant]/conectar/skills-section";

const skills = [
	{
		slug: "skills/ventas/propuesta",
		name: "propuesta",
		description: "Arma la propuesta comercial.",
		version: 3,
	},
];

const render = (list: typeof skills | null) =>
	renderToStaticMarkup(createElement(SkillsSection, { tenantSlug: "acme", skills: list }));

describe("SkillsSection", () => {
	it("lista cada skill con su versión, su página y la descarga del paquete", () => {
		const html = render(skills);
		expect(html).toContain("Tus skills");
		expect(html).toContain("propuesta");
		expect(html).toContain("Arma la propuesta comercial.");
		expect(html).toContain("/acme/brain/p/skills/ventas/propuesta");
		expect(html).toContain("/acme/brain/skills/package?slug=skills%2Fventas%2Fpropuesta");
		expect(html).toContain("Descargar paquete (v3)");
	});

	it("explica qué pasa en cada cliente", () => {
		const html = render(skills);
		expect(html).toContain("Claude Code, Codex y Cursor");
		expect(html).toContain("usa siempre la última versión");
		expect(html).toContain("claude.ai y ChatGPT");
		expect(html).toContain("subirlo de nuevo");
	});

	it("si la lectura falló, lo dice en vez de mostrar una lista vacía", () => {
		const html = render(null);
		expect(html).toContain("No se pudieron leer tus skills. Recargá la página.");
		expect(html).not.toContain("Descargar paquete");
	});
});
```

- [ ] **Step 2: Tests de la página**

En `tests/connect/conectar-page.test.ts`:

1. Sumar al tipo y al valor de `state` un campo `skills: unknown` con valor inicial `[]`.
2. Sumar el mock, junto a los otros `vi.mock`:

```ts
vi.mock("@/lib/brain/adapters/skills", () => ({
	memberSkills: async () => {
		if (state.skills instanceof Error) throw state.skills;
		return state.skills;
	},
}));
```

3. En `beforeEach`, sumar `state.skills = [];`.
4. Agregar al `describe("página Conectar")`:

```ts
	it("con brain y skills visibles muestra la sección de skills", async () => {
		state.skills = [
			{ slug: "skills/ventas/propuesta", name: "propuesta", description: "Arma la propuesta.", version: 3 },
		];
		const html = await render();
		expect(html).toContain("Tus skills");
		expect(html).toContain("Descargar paquete (v3)");
	});

	it("sin skills visibles no hay sección de skills", async () => {
		const html = await render();
		expect(html).not.toContain("Tus skills");
	});

	it("sin brain no hay sección de skills aunque la lectura devuelva alguna", async () => {
		state.brain = { data: [], error: null };
		state.skills = [
			{ slug: "skills/a", name: "a", description: "d", version: 1 },
		];
		expect(await render()).not.toContain("Tus skills");
	});

	it("si falla la lectura de skills avisa sin mostrar el error", async () => {
		state.skills = new Error("rpc caída");
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const html = await render();
		expect(html).toContain("No se pudieron leer tus skills. Recargá la página.");
		expect(html).not.toContain("rpc caída");
		expect(html).toContain("https://app.test/brain/acme/mcp");
		error.mockRestore();
	});
```

- [ ] **Step 3: Correrlos y ver que fallan**

Run: `npm test -- tests/connect`
Expected: FAIL (no existe `skills-section.tsx`; la página no muestra skills).

- [ ] **Step 4: `memberSkills` en el adaptador**

En `lib/brain/adapters/skills.ts`, sumar imports:

```ts
import { resolveAccess } from "../core/access/resolve-access";
import { isAdminRole, type Principal } from "../core/access/types";
import { visibleSkills } from "../core/skills/catalog";
import type { BrainRole } from "../core/types";
```

y al final:

```ts
export interface MemberSkill {
	slug: string;
	name: string;
	description: string;
	version: number;
}

// Las skills que una persona ve en /conectar (spec etapa 24.2b §8): las
// mismas que skill_list le daría por MCP. Con un brain externo no hay skills.
export async function memberSkills(member: {
	tenantId: string;
	userId: string;
	role: BrainRole;
}): Promise<MemberSkill[]> {
	if (!(await wikiBinding(member.tenantId))) return [];
	// Como en el handler MCP: un administrador no depende de reglas, y si no se
	// pueden cargar, esto lanza (falla cerrada).
	const rules = isAdminRole(member.role)
		? []
		: await accessRulesStore().load(member.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: member.userId,
		role: member.role,
	};
	const rows = await skillStore().overview(member.tenantId);
	return visibleSkills(rows, (slug) => resolveAccess(rules, principal, slug)).map(
		({ slug, name, snapshot }) => ({
			slug,
			name,
			description: snapshot.description,
			version: snapshot.version,
		}),
	);
}
```

- [ ] **Step 5: El componente**

`app/[tenant]/conectar/skills-section.tsx`:

```tsx
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { MemberSkill } from "@/lib/brain/adapters/skills";
import { pageHref } from "@/lib/brain/core/editor/slug";
import { skillPackageHref } from "@/lib/brain/core/skills/http";

// Skills publicadas que la persona puede usar (spec etapa 24.2b §8). null es
// "no se pudieron leer": nunca se muestra como una lista vacía.
export function SkillsSection({
	tenantSlug,
	skills,
}: {
	tenantSlug: string;
	skills: MemberSkill[] | null;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Tus skills</CardTitle>
				<CardDescription>
					Procedimientos que publicó tu empresa. Tu asistente los usa a través
					del brain.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				{skills === null ? (
					<p className="text-muted-foreground">
						No se pudieron leer tus skills. Recargá la página.
					</p>
				) : (
					<>
						<ul className="divide-y rounded-lg border">
							{skills.map((skill) => (
								<li key={skill.slug} className="space-y-1 px-3 py-2">
									<div className="flex flex-wrap items-center gap-3">
										<a
											className="mr-auto font-medium underline"
											href={pageHref(tenantSlug, skill.slug)}
										>
											{skill.name}
										</a>
										<a
											className="underline"
											href={skillPackageHref(tenantSlug, skill.slug)}
											download
										>
											Descargar paquete (v{skill.version})
										</a>
									</div>
									<p className="text-muted-foreground">{skill.description}</p>
								</li>
							))}
						</ul>
						<div className="space-y-2 text-muted-foreground">
							<p>
								<strong>Claude Code, Codex y Cursor:</strong> con el brain
								conectado, tu asistente carga estas skills solo y usa siempre la
								última versión.
							</p>
							<p>
								<strong>claude.ai y ChatGPT:</strong> tu asistente lee las
								instrucciones de cada skill. Para que además corra sus scripts,
								descargá el paquete y subilo como skill. Cuando se publique una
								versión nueva vas a tener que subirlo de nuevo.
							</p>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
```

Nota para el test: `renderToStaticMarkup` puede partir el texto de los `<strong>` y de los saltos de línea del JSX. Si una aserción de texto corrido falla solo por eso, ajustar la frase del test a un fragmento que quede entero en el HTML; no cambiar el texto visible.

- [ ] **Step 6: La página**

En `app/[tenant]/conectar/page.tsx`:

1. Imports: `import { type MemberSkill, memberSkills } from "@/lib/brain/adapters/skills";`, `import type { TenantAccess } from "@/lib/tenants/resolve";` (junto al import de `resolveTenantAccess`) y `import { SkillsSection } from "./skills-section";`.
2. Agregar, después de `loadConnectables`:

```ts
// Las skills se leen aparte: si fallan, la persona igual ve sus conexiones.
async function loadSkills(tenant: TenantAccess): Promise<MemberSkill[] | null> {
	try {
		return await memberSkills({
			tenantId: tenant.id,
			userId: tenant.userId,
			role: tenant.role,
		});
	} catch (error) {
		console.error("conectar: no pude leer las skills", error);
		return null;
	}
}
```

3. En `ConectarPage`, después de `const connectables = ...`:

```ts
	const hasBrain =
		connectables?.some((connectable) => connectable.kind === "brain") ?? false;
	const skills = hasBrain ? await loadSkills(tenant) : [];
```

4. En el JSX, dentro del fragmento que mapea `connectables`, después del `.map(...)`:

```tsx
					{skills === null || skills.length > 0 ? (
						<SkillsSection tenantSlug={tenant.slug} skills={skills} />
					) : null}
```

- [ ] **Step 7: Correr los tests**

Run: `npm test -- tests/connect tests/brain`
Expected: PASS. El test "un miembro y un administrador ven lo mismo" sigue verde porque el mock devuelve lo mismo para los dos.

- [ ] **Step 8: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/adapters/skills.ts "app/[tenant]/conectar/skills-section.tsx" "app/[tenant]/conectar/page.tsx" tests/connect/skills-section.test.ts tests/connect/conectar-page.test.ts
npx biome check lib/brain/adapters/skills.ts "app/[tenant]/conectar/skills-section.tsx" "app/[tenant]/conectar/page.tsx" tests/connect/skills-section.test.ts tests/connect/conectar-page.test.ts
npm run typecheck
git add lib/brain/adapters/skills.ts "app/[tenant]/conectar/skills-section.tsx" "app/[tenant]/conectar/page.tsx" tests/connect/skills-section.test.ts tests/connect/conectar-page.test.ts
git commit -m "feat: las skills de cada persona en la página Conectar"
```

---

### Task 7: Documentación y wiki

**Files:**
- Modify: `docs/dominios/brain.md`, `docs/guias/conectar-brain-por-mcp.md`, `lib/brain/README.md`, `docs/decisiones/README.md`, `docs/producto/roadmap.md`
- Regenerar: `docs/referencia/` con `npm run docs:sync` (no se edita a mano)

Leer antes `docs/guias/documentar.md`. Toda la prosa en español rioplatense.

- [ ] **Step 1: `docs/dominios/brain.md`**

- Frontmatter: `updated: <fecha del día>`; sumar a `sources` `lib/brain/core/skills/package-link.ts`, `lib/brain/adapters/skill-packages.ts`, `app/[tenant]/conectar/skills-section.tsx`, `supabase/migrations/20261022120000_skill_packages_bucket.sql` y `docs/superpowers/specs/2026-10-14-etapa-24-2b-paquete-por-mcp-design.md`.
- Nueva subsección "Paquete completo por MCP (etapa 24.2b)" después de "Skills por MCP (etapa 24.2a)": la tool `skill_package` (link firmado de 600 s, nombre `<name>-v<n>.zip`, qué dice su descripción), el bucket `skill-packages` con objeto `<tenant_id>/<digest>.zip` armado la primera vez, la redirección de la descarga web con link de 60 s, el evento `brain.skill_package_issued` (canal `mcp` o `web`), y la sección "Tus skills" de `/conectar` que usa `visibleSkills`.
- En la tabla de "Qué ve cada uno" de la 24.2a, la columna "Zip" pasa a decir que es el mismo para web y `skill_package`.
- En las decisiones, sumar P1 a P8 de la spec en una línea cada una. Reemplazar la nota pendiente sobre el límite de respuesta de Vercel (cerca de la línea 250) por: la descarga ya no pasa por la función; queda verificar en preview que un paquete de más de 5 MB baja bien.
- Anotar el límite aceptado (P7) y los pendientes: limpiar zips huérfanos, 24.2c, 24.3, 24.4.

- [ ] **Step 2: `docs/guias/conectar-brain-por-mcp.md`**

- Cambiar "Las tres tools aparecen siempre en la lista." por "Las tres tools del brain aparecen siempre en la lista."
- En "Skills de la empresa": "tres tools propias" pasa a "cuatro tools propias" y se suma el bullet de `skill_package` (link de 10 minutos al zip completo, binarios incluidos; el asistente lo baja a una carpeta temporal y no lo instala).
- Reemplazar el bullet de binarios por: por MCP se leen archivos de texto de hasta 256 KB; el paquete completo, con binarios, sale con `skill_package` o con **Descargar paquete** en la página de la skill o en **Conectar**.
- Reemplazar el bullet "Los scripts de una skill no se ejecutan desde el servidor todavía (etapa 24.2b)…" por: los scripts los corre tu asistente en su propio entorno. Claude Code, Codex y Cursor bajan el paquete solos y usan siempre la última versión. En claude.ai y ChatGPT el entorno no sale a internet por defecto: descargá el zip y subilo como skill, y volvé a subirlo cuando haya una versión nueva.
- Sumar: cada `skill_package` deja un evento `brain.skill_package_issued`. Las cuatro cuentan como lecturas.

- [ ] **Step 3: `lib/brain/README.md`**

En la parte de skills, sumar `core/skills/package-link.ts` (link al zip publicado, puro) y `adapters/skill-packages.ts` (bucket `skill-packages`), y que la descarga web redirige.

- [ ] **Step 4: Decisiones y roadmap**

- `docs/decisiones/README.md`: en la fila de la 24.2b, reemplazar "a escribir" por `[plan](../superpowers/plans/2026-10-14-etapa-24-2b-paquete-por-mcp.md)`. Estado sigue "en curso".
- `docs/producto/roadmap.md`: en la línea **Spec/Plan** de la Etapa 24, reemplazar "24.2b: `…design.md` · plan a escribir." por la spec y `Plan: docs/superpowers/plans/2026-10-14-etapa-24-2b-paquete-por-mcp.md`. En el ítem 24.2b, agregar al principio "Código terminado; falta el cierre en producción (spec §13)." (sin marcar `[x]`).

- [ ] **Step 5: Regenerar y verificar**

Run: `npm run docs:sync && npm run docs:check && npm run typecheck`
Expected: docs:check verde. Si falla por cobertura (la ruta, la migración o una página nueva), resolverlo con una página o una exclusión con motivo en `docs/_meta/cobertura.ts`, nunca debilitando el test.

- [ ] **Step 6: Commit**

```bash
git add docs/dominios/brain.md docs/guias/conectar-brain-por-mcp.md lib/brain/README.md docs/decisiones/README.md docs/producto/roadmap.md docs/referencia
git commit -m "docs: paquete completo por MCP y skills en Conectar"
```

---

## Cierre (lo hace la persona, no un subagente)

Spec §13, en este orden:

1. Local, con Docker: `npm run db:reset`, publicar una skill con un script y una plantilla binaria, conectar Claude Code al brain local por MCP y pedirle la tarea. Tiene que llamar a `skill_package`, bajar el zip, correr el script y producir el archivo.
2. Republicar con un cambio y confirmar que la sesión siguiente usa la versión nueva.
3. Preview de Vercel: bajar desde la web un paquete de más de 5 MB.
4. Producción, después del cierre de la 24.1 y la 24.2a: `npx supabase migration list`, aplicar la migración del bucket, y recién después desplegar el código. Recorrer el criterio de §1 de la spec en `innovas`.
