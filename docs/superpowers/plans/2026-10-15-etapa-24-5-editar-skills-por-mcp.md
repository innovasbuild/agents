# Etapa 24.5 · Crear y editar skills de empresa por MCP — plan de implementación

> **Para quien ejecute:** SUB-SKILL REQUERIDO: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que un editor de skills cree y cambie el borrador de sus skills desde Claude, ChatGPT o cualquier cliente conectado al brain por MCP, con cuatro tools nuevas; publicar sigue solo en la web.

**Arquitectura:** un módulo puro nuevo, `lib/brain/core/skills/draft.ts`, que recibe las dependencias de `files.ts` ya armadas con la persona del pedido y delega en `putSkillFile` y `readSkillFile` (permiso de editor, hash, tope de paquete y errores de base). `server.ts` registra las cuatro tools si le llega `skillDrafts`. `handler.ts` decide si la persona puede editar algo bajo `skills/` y arma el módulo con el proveedor **sin** `withoutSkills`, que solo ve `draft.ts`. Sin migración.

**Stack:** TypeScript, zod, `@modelcontextprotocol/sdk` 1.30.1, `yaml`, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-10-15-etapa-24-5-editar-skills-por-mcp-design.md`

## Restricciones globales

- Publicar, retirar y borrar skills o archivos quedan solo en la web (spec D2). Todo cambio por MCP va al borrador.
- Por MCP solo texto: archivos de hasta 256 KB (`MAX_READABLE_BYTES` = 262144). Paquete: 50 archivos y 20 MB (lo hace cumplir la base).
- Cuerpo del `SKILL.md` de hasta 100 KB (102400 bytes), igual que `brain_upsert`.
- `description` de hasta 1024 caracteres, `compatibility` de hasta 500, nombre de skill de hasta 64.
- `lib/brain/core` no importa Next ni Supabase (`tests/brain/boundary.test.ts`). Los imports relativos de `core` llevan extensión `.ts`.
- Quien no puede editar una skill recibe el mismo error que si no existiera (spec D4).
- Mensajes al usuario y a la IA en español rioplatense; identificadores en inglés.
- No correr `npm run lint:fix` (reformatea 4 archivos ajenos). Usar `npx biome check --write <archivos>` solo sobre los archivos de la tarea.
- Commits con prefijo `feat:`, `fix:`, `docs:` o `refactor:`, y el trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Rama: `docs/etapa-24-5-editar-skills-mcp` (ya creada desde `main`, con la spec commiteada). Los commits de código van en esa misma rama.

## Foco de revisión

Entradas que la spec implica y ninguna tarea cubriría por sí sola; cada línea tiene su test en la tarea dueña:

1. Un nombre de skill repetido en dos carpetas del mismo editor: el error lista las rutas y no elige una al azar (Tarea 1).
2. Un fragmento con `$&`, `$1` o `$$` en el texto nuevo: se escribe literal, no como patrón de `String.replace` (Tarea 2).
3. Un cambio que rompe el encabezado del `SKILL.md` o toca `name`: se rechaza y no se guarda nada (Tarea 2).
4. Dos personas editan a la vez: la segunda recibe un conflicto que dice qué hacer y no pisa nada (Tarea 2).
5. Crear en una carpeta que no existe, o en una donde solo se es lector: error claro y nada guardado (Tarea 3).

---

## Estructura de archivos

| Archivo | Qué hace |
|---|---|
| `lib/brain/core/skills/skill-md.ts` (modifica) | Suma `skillMdName(text)`: lee el campo `name` del encabezado |
| `lib/brain/core/skills/draft.ts` (nuevo) | `createSkillDrafts(deps)` con `read`, `edit`, `writeFile` y `create`; `canEditSkills(rules, principal, rows)` |
| `lib/brain/core/mcp-server/server.ts` (modifica) | Registra las cuatro tools si llega `skillDrafts`, con anotaciones y `instructions` |
| `lib/brain/core/mcp-server/handler.ts` (modifica) | `McpSkillsDeps.edit`; decide y arma `skillDrafts` |
| `lib/brain/core/skills/view.ts` (modifica) | Mensaje de rechazo de `upsert` sobre `skills/` |
| `lib/brain/adapters/mcp-production.ts` (modifica) | Cablea `edit: { store, blobs }` |
| `tests/brain/skills-draft.test.ts` (nuevo) | Pruebas de `draft.ts` |
| `tests/brain/skills-skill-md.test.ts` (modifica) | Pruebas de `skillMdName` |
| `tests/brain/mcp-server/tools.test.ts` (modifica) | Pruebas del registro de tools |
| `tests/brain/mcp-server/handler.test.ts` (modifica) | Pruebas de punta a punta por HTTP |
| `docs/guias/conectar-brain-por-mcp.md`, `docs/dominios/brain.md`, `docs/producto/roadmap.md`, `docs/decisiones/README.md` (modifican) | Documentación |

---

### Tarea 1: Resolver la skill, leer el borrador y decidir quién puede editar

**Archivos:**
- Crear: `lib/brain/core/skills/draft.ts`
- Crear: `tests/brain/skills-draft.test.ts`

**Interfaces:**
- Consume: `FilesDeps`, `readSkillFile` (de `files.ts`); `renderSkillMd` (de `skill-md.ts`); `skillState` (de `state.ts`); `resolveAccess`; `MAX_READABLE_BYTES` (de `catalog.ts`).
- Produce:
  - `createSkillDrafts(deps: SkillDraftDeps): SkillDrafts`, con `SkillDraftDeps = { tenantSlug: string; files: FilesDeps; levelOf(path: string): Level | null; reviewUrl(slug: string): string }`.
  - `SkillDrafts.read(input: { skill: string; path?: string }): Promise<Record<string, unknown>>` (en esta tarea; `edit`, `writeFile` y `create` se agregan en las siguientes).
  - `canEditSkills(rules: AccessRule[], principal: Principal, rows: SkillOverviewRow[]): boolean`.
  - `DraftState = "sin_publicar" | "con_cambios" | "al_dia" | "retirada"`, `DraftChange`.

> La spec ya incorpora cuatro ajustes que salieron de leer el código al escribir este plan (la `description` vacía en un borrador, el motivo que solo se guarda en el `SKILL.md`, `skill_draft_write_file` sin `reason` y la creación exclusiva ya resuelta por el guardado del brain). El plan sigue la spec tal como está.

- [ ] **Paso 1: Escribir las pruebas que fallan**

Crear `tests/brain/skills-draft.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/brain/core/access/resolve-access";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";
import { BrainConflict } from "@/lib/brain/core/errors";
import {
	canEditSkills,
	createSkillDrafts,
} from "@/lib/brain/core/skills/draft";
import type { FilesDeps } from "@/lib/brain/core/skills/files";
import type { SkillFile } from "@/lib/brain/core/skills/package";
import type { SkillOverviewRow } from "@/lib/brain/core/skills/store";
import type { BrainPage, BrainRole, BrainWrite } from "@/lib/brain/core/types";

export const SLUG = "skills/admin/facturacion";
export const TENANT = "t1";
export const enc = (text: string) => new TextEncoder().encode(text);
export const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export const members = (
	path: string,
	level: AccessRule["level"],
): AccessRule => ({ path, principal: "members", userId: null, level });
export const EDITOR = [members("", "editor")];
export const LECTOR = [members("", "lector")];

const BODY = "# Facturación\n\nPaso uno.\nPaso dos.\n";

function published(): NonNullable<SkillOverviewRow["current"]> {
	return {
		action: "publicar",
		version: 2,
		pageRevision: 4,
		filesDigest: "fd",
		title: "Facturación",
		description: "pub",
		body: "pub",
		frontmatter: {},
		manifest: [],
		digest: "dg",
		publishedAt: "2026-10-10T00:00:00Z",
	};
}

function skillPage(slug: string, title: string): BrainPage {
	return {
		slug,
		title,
		category: "skill",
		status: "activo",
		tags: ["finanzas"],
		frontmatter: {
			description: "Usar para emitir y validar facturas.",
			compatibility: "Python 3",
			updated: "2026-10-01",
		},
		body: BODY,
		revision: 4,
		updatedAt: "2026-10-11T00:00:00Z",
	};
}

export function setup(
	opts: {
		role?: BrainRole;
		rules?: AccessRule[];
		current?: SkillOverviewRow["current"];
		saveError?: unknown;
		twin?: boolean;
	} = {},
) {
	const rules = opts.rules ?? EDITOR;
	const role = opts.role ?? "tenant_member";
	const principal: Principal = { kind: "user", userId: "ana", role };
	const blobs = new Map<string, Uint8Array>([
		[`${TENANT}/h-calc`, enc("print('hola')")],
		[`${TENANT}/h-logo`, new Uint8Array([137, 0, 1])],
	]);
	let files: SkillFile[] = [
		{ path: "scripts/calc.py", sha256: "h-calc", size: 13 },
		{ path: "assets/logo.png", sha256: "h-logo", size: 3 },
	];
	const pages = new Map<string, BrainPage>([
		[SLUG, skillPage(SLUG, "Facturación")],
	]);
	const rows: SkillOverviewRow[] = [
		{
			pageId: "p1",
			slug: SLUG,
			revision: 4,
			draftFilesDigest: "fd",
			current: opts.current === undefined ? published() : opts.current,
		},
	];
	if (opts.twin) {
		const twin = "skills/ventas/facturacion";
		pages.set(twin, skillPage(twin, "Facturación ventas"));
		rows.push({
			pageId: "p2",
			slug: twin,
			revision: 4,
			draftFilesDigest: "fd",
			current: null,
		});
	}

	const save = vi.fn(async (_actor: unknown, write: BrainWrite) => {
		if (opts.saveError) throw opts.saveError;
		const existing = pages.get(write.slug);
		if (write.baseRevision === undefined) {
			if (existing) throw new BrainConflict(write.slug, null);
			pages.set(write.slug, {
				slug: write.slug,
				title: write.title,
				category: write.category,
				status: write.status,
				tags: write.tags,
				frontmatter: write.frontmatter ?? {},
				body: write.body,
				revision: 1,
				updatedAt: "2026-10-15T00:00:00Z",
			});
			rows.push({
				pageId: `p-${write.slug}`,
				slug: write.slug,
				revision: 1,
				draftFilesDigest: "fd0",
				current: null,
			});
			return { revision: 1 };
		}
		if (!existing || existing.revision !== write.baseRevision) {
			throw new BrainConflict(write.slug, existing?.revision ?? null);
		}
		const revision = existing.revision + 1;
		pages.set(write.slug, {
			...existing,
			body: write.body,
			frontmatter: write.frontmatter ?? {},
			revision,
		});
		const row = rows.find((item) => item.slug === write.slug);
		if (row) row.revision = revision;
		return { revision };
	});

	const putFile = vi.fn(
		async (p: { path: string; sha256: string; size: number }) => {
			files = [
				...files.filter((file) => file.path !== p.path),
				{ path: p.path, sha256: p.sha256, size: p.size },
			];
			rows[0].draftFilesDigest = "fd-nuevo";
			return "fd-nuevo";
		},
	);

	const filesDeps: FilesDeps = {
		actor: async () => ({ tenantId: TENANT, userId: "ana", role }),
		binding: async () => ({ provider: "wiki" }),
		rules: { load: async () => rules },
		page: async (_tenantId, slug) => pages.get(slug) ?? null,
		save,
		store: {
			overview: async () => rows,
			files: async () => files,
			acts: async () => [],
			putFile,
			removeFile: vi.fn(),
			publish: vi.fn(),
			withdraw: vi.fn(),
		},
		blobs: {
			put: vi.fn(async (tenantId, sha, bytes) => {
				blobs.set(`${tenantId}/${sha}`, bytes);
			}),
			get: async (tenantId, sha) => blobs.get(`${tenantId}/${sha}`) ?? null,
		},
	};
	const drafts = createSkillDrafts({
		tenantSlug: "acme",
		files: filesDeps,
		levelOf: (path) => resolveAccess(rules, principal, path),
		reviewUrl: (slug) => `https://agents.test/acme/brain/p/${slug}`,
	});
	return {
		drafts,
		save,
		putFile,
		blobs,
		pages,
		rows,
		principal,
		files: () => files,
	};
}

describe("resolver la skill", () => {
	it("se encuentra por nombre y por ruta completa", async () => {
		const { drafts } = setup();
		const byName = await drafts.read({ skill: "facturacion" });
		const bySlug = await drafts.read({ skill: SLUG });
		expect(byName.slug).toBe(SLUG);
		expect(bySlug.slug).toBe(SLUG);
	});

	it("un lector recibe el mismo error que si la skill no existiera", async () => {
		const { drafts } = setup({ rules: LECTOR });
		const hidden = await drafts
			.read({ skill: "facturacion" })
			.catch((error: Error) => error);
		const missing = await drafts
			.read({ skill: "inexistente" })
			.catch((error: Error) => error);
		expect(hidden).toMatchObject({ code: "not_found" });
		expect(missing).toMatchObject({ code: "not_found" });
		expect((hidden as Error).message.replace("facturacion", "X")).toBe(
			(missing as Error).message.replace("inexistente", "X"),
		);
	});

	it("un editor de otra carpeta no ve esta skill", async () => {
		const { drafts } = setup({
			rules: [members("", "lector"), members("skills/ventas", "editor")],
		});
		await expect(drafts.read({ skill: "facturacion" })).rejects.toMatchObject({
			code: "not_found",
		});
	});

	it("con el mismo nombre en dos carpetas pide la ruta completa y las lista", async () => {
		const { drafts } = setup({ twin: true });
		await expect(drafts.read({ skill: "facturacion" })).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("skills/ventas/facturacion"),
		});
		const exact = await drafts.read({ skill: "skills/ventas/facturacion" });
		expect(exact.slug).toBe("skills/ventas/facturacion");
	});
});

describe("skill_draft_read", () => {
	it("sin ruta devuelve el SKILL.md del borrador, la revisión, el estado y los archivos", async () => {
		const { drafts } = setup();
		const result = await drafts.read({ skill: "facturacion" });
		expect(result).toMatchObject({
			slug: SLUG,
			name: "facturacion",
			revision: 4,
			state: "al_dia",
			publishedVersion: 2,
			reviewUrl: `https://agents.test/acme/brain/p/${SLUG}`,
			files: [
				{ path: "scripts/calc.py", size: 13, readable: true },
				{ path: "assets/logo.png", size: 3, readable: true },
			],
		});
		const skillMd = result.skillMd as string;
		expect(skillMd.startsWith("---\nname: facturacion\n")).toBe(true);
		expect(skillMd).toContain("description: Usar para emitir y validar facturas.");
		expect(skillMd).toContain("compatibility: Python 3");
		expect(skillMd.endsWith(BODY)).toBe(true);
	});

	it("el estado distingue sin publicar, con cambios, al día y retirada", async () => {
		const sin = await setup({ current: null }).drafts.read({ skill: "facturacion" });
		const cambios = await setup({
			current: { ...published(), pageRevision: 3 },
		}).drafts.read({ skill: "facturacion" });
		const retirada = await setup({
			current: { ...published(), action: "retirar" },
		}).drafts.read({ skill: "facturacion" });
		expect(sin).toMatchObject({ state: "sin_publicar", publishedVersion: null });
		expect(cambios).toMatchObject({ state: "con_cambios", publishedVersion: 2 });
		expect(retirada).toMatchObject({ state: "retirada", publishedVersion: null });
	});

	it("con ruta devuelve el archivo de texto del borrador", async () => {
		const { drafts } = setup();
		const result = await drafts.read({
			skill: "facturacion",
			path: "scripts/calc.py",
		});
		expect(result).toMatchObject({
			path: "scripts/calc.py",
			size: 13,
			content: "print('hola')",
		});
	});

	it("un binario, una ruta que no está y un archivo de más de 256 KB no se leen", async () => {
		const { drafts, files, blobs } = setup();
		await expect(
			drafts.read({ skill: "facturacion", path: "assets/logo.png" }),
		).rejects.toMatchObject({ code: "validation" });
		await expect(
			drafts.read({ skill: "facturacion", path: "no/esta.md" }),
		).rejects.toMatchObject({ code: "not_found" });
		blobs.set(`${TENANT}/h-big`, new Uint8Array(262_145).fill(97));
		files().push({ path: "references/big.md", sha256: "h-big", size: 262_145 });
		await expect(
			drafts.read({ skill: "facturacion", path: "references/big.md" }),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("256 KB"),
		});
	});

	it("pedir SKILL.md como ruta devuelve lo mismo que no pasar ruta", async () => {
		const { drafts } = setup();
		const sin = await drafts.read({ skill: "facturacion" });
		const con = await drafts.read({ skill: "facturacion", path: "SKILL.md" });
		expect(con).toEqual(sin);
	});
});

describe("canEditSkills", () => {
	it("un administrador siempre", () => {
		const principal: Principal = { kind: "user", userId: "x", role: "tenant_admin" };
		expect(canEditSkills([], principal, [])).toBe(true);
	});

	it("un editor general edita bajo skills/, aunque no haya ninguna skill", () => {
		const principal: Principal = { kind: "user", userId: "x", role: "tenant_member" };
		expect(canEditSkills(EDITOR, principal, [])).toBe(true);
	});

	it("un lector no", () => {
		const principal: Principal = { kind: "user", userId: "x", role: "tenant_member" };
		expect(canEditSkills(LECTOR, principal, [])).toBe(false);
	});

	it("un lector con una regla personal de editor en una carpeta de skills sí", () => {
		const principal: Principal = { kind: "user", userId: "x", role: "tenant_member" };
		const rules: AccessRule[] = [
			members("", "lector"),
			{ path: "skills/ventas", principal: "user", userId: "x", level: "editor" },
		];
		expect(canEditSkills(rules, principal, [])).toBe(true);
	});

	it("la regla personal de otra persona no cuenta", () => {
		const principal: Principal = { kind: "user", userId: "x", role: "tenant_member" };
		const rules: AccessRule[] = [
			members("", "lector"),
			{ path: "skills/ventas", principal: "user", userId: "otro", level: "editor" },
		];
		expect(canEditSkills(rules, principal, [])).toBe(false);
	});

	it("editor de una skill existente alcanza", () => {
		const principal: Principal = { kind: "user", userId: "x", role: "tenant_member" };
		const rules: AccessRule[] = [
			members("", "lector"),
			{ path: SLUG, principal: "user", userId: "x", level: "editor" },
		];
		const row: SkillOverviewRow = {
			pageId: "p1",
			slug: SLUG,
			revision: 1,
			draftFilesDigest: "fd",
			current: null,
		};
		expect(canEditSkills(rules, principal, [row])).toBe(true);
	});
});
```

- [ ] **Paso 2: Correr las pruebas y ver que fallan**

Run: `npx vitest run tests/brain/skills-draft.test.ts`
Esperado: FAIL, porque `@/lib/brain/core/skills/draft` no existe.

- [ ] **Paso 3: Implementar `draft.ts` con `read` y `canEditSkills`**

Crear `lib/brain/core/skills/draft.ts`:

```ts
// Crear y editar skills desde un asistente (spec etapa 24.5). Puro: recibe sus
// dependencias. El permiso de editor, el hash y los topes de archivos los
// decide files.ts; acá se resuelve la skill, se arma el texto y se valida.
// Todo cambio va al borrador: publicar y retirar son de la web (24.1 S5). Una
// skill que la persona no puede editar responde igual que una inexistente.
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRule,
	atLeast,
	type Level,
	type Principal,
} from "../access/types.ts";
import { BrainError } from "../errors.ts";
import type { BrainPage } from "../types.ts";
import { MAX_READABLE_BYTES } from "./catalog.ts";
import { type FilesDeps, readSkillFile } from "./files.ts";
import { looksLikeText } from "./http.ts";
import { isSkillSlug, SKILLS_PREFIX, skillName } from "./package.ts";
import type { SkillActor, SkillFailure } from "./publish.ts";
import { renderSkillMd } from "./skill-md.ts";
import { skillState } from "./state.ts";
import type { SkillOverviewRow } from "./store.ts";

export type DraftState =
	| "sin_publicar"
	| "con_cambios"
	| "al_dia"
	| "retirada";

export interface DraftChange {
	slug: string;
	name: string;
	path: string;
	revision?: number;
	state: DraftState;
	reviewUrl: string;
	message: string;
}

export interface SkillDraftDeps {
	tenantSlug: string;
	/** Las dependencias de files.ts ya armadas con la persona del pedido. */
	files: FilesDeps;
	levelOf(path: string): Level | null;
	reviewUrl(slug: string): string;
}

export interface SkillDrafts {
	read(input: { skill: string; path?: string }): Promise<Record<string, unknown>>;
}

export const SKILL_MD = "SKILL.md";

const decoder = new TextDecoder();

export const notFound = (skill: string) =>
	new BrainError(
		"not_found",
		`No existe la skill "${skill}" entre las que podés editar.`,
	);

export function failure(result: SkillFailure): never {
	const code =
		result.code === "not_found" ||
		result.code === "forbidden" ||
		result.code === "conflict"
			? result.code
			: "validation";
	throw new BrainError(code, result.message);
}

function draftState(row: SkillOverviewRow): DraftState {
	const state = skillState(row);
	if (state.kind === "publicada") return state.dirty ? "con_cambios" : "al_dia";
	return state.kind;
}

export function skillMdOf(slug: string, page: BrainPage): string {
	const description = page.frontmatter.description;
	return renderSkillMd({
		name: skillName(slug),
		description: typeof description === "string" ? description : "",
		frontmatter: page.frontmatter,
		body: page.body,
	});
}

// ¿Alguna tool de edición le sirve a esta persona? Un administrador, un editor
// general, el editor de alguna skill o de alguna carpeta bajo skills/.
export function canEditSkills(
	rules: AccessRule[],
	principal: Principal,
	rows: SkillOverviewRow[],
): boolean {
	const edits = (path: string) =>
		atLeast(resolveAccess(rules, principal, path), "editor");
	if (edits(`${SKILLS_PREFIX}x`)) return true;
	if (rows.some((row) => edits(row.slug))) return true;
	return rules.some(
		(rule) => rule.path.startsWith(SKILLS_PREFIX) && edits(rule.path),
	);
}

export function createSkillDrafts(deps: SkillDraftDeps): SkillDrafts {
	const { files, tenantSlug } = deps;

	// La skill editable que nombra la persona. Lo que no puede editar responde
	// not_found, igual que lo que no existe.
	async function resolve(skill: string) {
		const actor = await files.actor(tenantSlug);
		if (!actor) throw notFound(skill);
		const rows = await files.store.overview(actor.tenantId);
		const editable = rows.filter(
			(row) =>
				isSkillSlug(row.slug) && atLeast(deps.levelOf(row.slug), "editor"),
		);
		const exact = editable.find((row) => row.slug === skill);
		const byName = editable.filter((row) => skillName(row.slug) === skill);
		if (!exact && byName.length > 1) {
			throw new BrainError(
				"validation",
				`Hay más de una skill que podés editar llamada "${skill}": ${byName.map((row) => row.slug).join(", ")}. Usá la ruta completa.`,
			);
		}
		const row = exact ?? byName[0];
		if (!row) throw notFound(skill);
		return { actor, row };
	}

	async function draftPage(actor: SkillActor, slug: string) {
		const page = await files.page(actor.tenantId, slug);
		if (!page) throw notFound(slug);
		return page;
	}

	return {
		async read({ skill, path }) {
			const { actor, row } = await resolve(skill);
			const base = {
				slug: row.slug,
				name: skillName(row.slug),
				reviewUrl: deps.reviewUrl(row.slug),
			};
			if (path !== undefined && path !== SKILL_MD) {
				const read = await readSkillFile(tenantSlug, row.slug, { path }, files);
				if (!read.ok) failure(read);
				if (read.bytes.length > MAX_READABLE_BYTES) {
					throw new BrainError(
						"validation",
						`"${path}" pesa más de 256 KB y no se lee desde acá: está en la plataforma.`,
					);
				}
				if (!looksLikeText(read.bytes)) {
					throw new BrainError(
						"validation",
						`"${path}" no es un archivo de texto y no se lee desde acá: está en la plataforma.`,
					);
				}
				return {
					...base,
					path,
					size: read.bytes.length,
					content: decoder.decode(read.bytes),
				};
			}
			const page = await draftPage(actor, row.slug);
			const manifest = await files.store.files(actor.tenantId, row.pageId);
			const state = skillState(row);
			return {
				...base,
				revision: page.revision,
				state: draftState(row),
				publishedVersion: state.kind === "publicada" ? state.version : null,
				skillMd: skillMdOf(row.slug, page),
				files: manifest.map((file) => ({
					path: file.path,
					size: file.size,
					readable: file.size <= MAX_READABLE_BYTES,
				})),
			};
		},
	};
}
```

- [ ] **Paso 4: Correr las pruebas y ver que pasan**

Run: `npx vitest run tests/brain/skills-draft.test.ts`
Esperado: PASS (todas las de `resolver la skill`, `skill_draft_read` y `canEditSkills`).

- [ ] **Paso 5: Formatear, chequear tipos y commitear**

```bash
npx biome check --write lib/brain/core/skills/draft.ts tests/brain/skills-draft.test.ts
npm run typecheck
git add lib/brain/core/skills/draft.ts tests/brain/skills-draft.test.ts
git commit -m "feat: resolver y leer el borrador de una skill desde un asistente (24.5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Esperado: typecheck sin errores. `SkillDrafts` solo tiene `read` por ahora; las tareas 2 y 3 le suman el resto.

---

### Tarea 2: Editar el borrador (`skill_draft_edit`)

**Archivos:**
- Modificar: `lib/brain/core/skills/skill-md.ts`
- Modificar: `lib/brain/core/skills/draft.ts`
- Modificar: `tests/brain/skills-skill-md.test.ts`
- Modificar: `tests/brain/skills-draft.test.ts`

**Interfaces:**
- Consume: de la Tarea 1, `createSkillDrafts`, `SKILL_MD`, `notFound`, `failure`, `skillMdOf`, `DraftChange`, y el `setup()` del test; de `files.ts`, `parseSkillMd`, `putSkillFile`, `readSkillFile`, `ParsedSkillMd`.
- Produce: `skillMdName(text: string): string | null` (de `skill-md.ts`); `SkillDrafts.edit(input: { skill: string; path?: string; old: string; new: string; reason: string }): Promise<DraftChange>`; `MAX_DRAFT_BODY_BYTES = 102_400`.

- [ ] **Paso 1: Escribir las pruebas de `skillMdName`**

Agregar al final de `tests/brain/skills-skill-md.test.ts`, y sumar `skillMdName` al import de `@/lib/brain/core/skills/skill-md`:

```ts
describe("skillMdName", () => {
	it("lee el campo name del encabezado", () => {
		expect(skillMdName("---\nname: reporte\ndescription: d\n---\n\ncuerpo")).toBe(
			"reporte",
		);
	});

	it("devuelve null sin encabezado, sin name o con YAML roto", () => {
		expect(skillMdName("# Solo texto")).toBeNull();
		expect(skillMdName("---\ndescription: d\n---\n\ncuerpo")).toBeNull();
		expect(skillMdName("---\nname: [1, 2\n---\ncuerpo")).toBeNull();
		expect(skillMdName("---\n- lista\n---\ncuerpo")).toBeNull();
	});
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/skills-skill-md.test.ts`
Esperado: FAIL, `skillMdName` no está exportada.

- [ ] **Paso 3: Implementar `skillMdName`**

En `lib/brain/core/skills/skill-md.ts` cambiar el import a `import { parse, stringify } from "yaml";` y agregar al final:

```ts
const HEADER = /^---\r?\n([\s\S]*?)\r?\n---/;

// El campo name del encabezado de un SKILL.md, o null si no hay o no se lee.
export function skillMdName(text: string): string | null {
	const match = HEADER.exec(text);
	if (!match) return null;
	try {
		const data: unknown = parse(match[1]);
		if (typeof data !== "object" || data === null || Array.isArray(data))
			return null;
		const name = (data as Record<string, unknown>).name;
		return typeof name === "string" ? name.trim() : null;
	} catch {
		return null;
	}
}
```

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run tests/brain/skills-skill-md.test.ts`
Esperado: PASS.

- [ ] **Paso 5: Escribir las pruebas de `edit`**

Agregar al final de `tests/brain/skills-draft.test.ts`:

```ts
describe("skill_draft_edit · SKILL.md", () => {
	it("cambia el cuerpo, guarda con la revisión leída y deja el motivo", async () => {
		const { drafts, save, pages } = setup();
		const result = await drafts.edit({
			skill: "facturacion",
			old: "Paso dos.",
			new: "Paso dos y tres.",
			reason: "sumo un paso",
		});
		expect(save).toHaveBeenCalledTimes(1);
		const write = save.mock.calls[0][1];
		expect(write).toMatchObject({
			slug: SLUG,
			title: "Facturación",
			category: "skill",
			status: "activo",
			tags: ["finanzas"],
			body: "# Facturación\n\nPaso uno.\nPaso dos y tres.\n",
			reason: "Edición por MCP: sumo un paso",
			baseRevision: 4,
		});
		expect(write.frontmatter).toMatchObject({
			description: "Usar para emitir y validar facturas.",
			compatibility: "Python 3",
			updated: "2026-10-01",
		});
		expect(pages.get(SLUG)?.revision).toBe(5);
		expect(result).toMatchObject({
			slug: SLUG,
			path: "SKILL.md",
			revision: 5,
			state: "con_cambios",
			reviewUrl: `https://agents.test/acme/brain/p/${SLUG}`,
		});
		expect(result.message).toContain("borrador");
	});

	it("cambia la description desde el encabezado", async () => {
		const { drafts, save } = setup();
		await drafts.edit({
			skill: "facturacion",
			old: "Usar para emitir y validar facturas.",
			new: "Usar para facturar.",
			reason: "más corta",
		});
		expect(save.mock.calls[0][1].frontmatter).toMatchObject({
			description: "Usar para facturar.",
		});
	});

	it("quita compatibility si se borra la línea", async () => {
		const { drafts, save } = setup();
		await drafts.edit({
			skill: "facturacion",
			old: "compatibility: Python 3\n",
			new: "",
			reason: "ya no hace falta",
		});
		expect(save.mock.calls[0][1].frontmatter).not.toHaveProperty(
			"compatibility",
		);
	});

	it("escribe literal un texto con $& o $1", async () => {
		const { drafts, save } = setup();
		await drafts.edit({
			skill: "facturacion",
			old: "Paso dos.",
			new: "Cobrar $& más $1 y $$.",
			reason: "precio",
		});
		expect(save.mock.calls[0][1].body).toContain("Cobrar $& más $1 y $$.");
	});

	it("rechaza un fragmento vacío, ausente o repetido sin guardar", async () => {
		const { drafts, save } = setup();
		const base = { skill: "facturacion", new: "x", reason: "r" };
		await expect(drafts.edit({ ...base, old: "" })).rejects.toMatchObject({
			code: "validation",
		});
		await expect(
			drafts.edit({ ...base, old: "no está en el texto" }),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("no aparece"),
		});
		await expect(drafts.edit({ ...base, old: "Paso" })).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("2 veces"),
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("rechaza dejar la skill sin description o con una de más de 1024", async () => {
		const { drafts, save } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "description: Usar para emitir y validar facturas.\n",
				new: "",
				reason: "r",
			}),
		).rejects.toMatchObject({ code: "validation" });
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "Usar para emitir y validar facturas.",
				new: "x".repeat(1025),
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("1024"),
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("rechaza romper el encabezado o cambiar name", async () => {
		const { drafts, save } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "---\nname: facturacion",
				new: "name: facturacion",
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("encabezado"),
		});
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "name: facturacion",
				new: "name: otra",
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("name"),
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("rechaza un cuerpo de más de 100 KB", async () => {
		const { drafts, save } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "Paso uno.",
				new: "x".repeat(102_401),
				reason: "r",
			}),
		).rejects.toMatchObject({ code: "validation" });
		expect(save).not.toHaveBeenCalled();
	});

	it("un borrador que venía sin description se puede seguir editando", async () => {
		const { drafts, pages, save } = setup();
		const page = pages.get(SLUG);
		if (page) page.frontmatter = { updated: "2026-10-01" };
		await drafts.edit({
			skill: "facturacion",
			old: "Paso uno.",
			new: "Primero.",
			reason: "r",
		});
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("si alguien guardó en el medio devuelve un conflicto que dice qué hacer", async () => {
		const { drafts } = setup({ saveError: new BrainConflict(SLUG, 5) });
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "Paso uno.",
				new: "Primero.",
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "conflict",
			message: expect.stringContaining("skill_draft_read"),
		});
	});

	it("un lector y el editor de otra carpeta reciben not_found", async () => {
		const input = {
			skill: "facturacion",
			old: "Paso uno.",
			new: "x",
			reason: "r",
		};
		const lector = setup({ rules: LECTOR });
		await expect(lector.drafts.edit(input)).rejects.toMatchObject({
			code: "not_found",
		});
		expect(lector.save).not.toHaveBeenCalled();
		const otro = setup({
			rules: [members("", "lector"), members("skills/ventas", "editor")],
		});
		await expect(otro.drafts.edit(input)).rejects.toMatchObject({
			code: "not_found",
		});
	});
});

describe("skill_draft_edit · archivos", () => {
	it("cambia un archivo de texto y lo sube con su hash", async () => {
		const { drafts, putFile, blobs } = setup();
		const result = await drafts.edit({
			skill: "facturacion",
			path: "scripts/calc.py",
			old: "hola",
			new: "chau",
			reason: "saludo",
		});
		expect(putFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "scripts/calc.py", size: 13 }),
		);
		const sha = putFile.mock.calls[0][0].sha256;
		expect(dec(blobs.get(`${TENANT}/${sha}`) as Uint8Array)).toBe(
			"print('chau')",
		);
		expect(result).toMatchObject({
			path: "scripts/calc.py",
			state: "con_cambios",
		});
		expect(result.revision).toBeUndefined();
	});

	it("rechaza un binario, un archivo que no está y un fragmento ausente", async () => {
		const { drafts, putFile } = setup();
		const base = { skill: "facturacion", old: "a", new: "b", reason: "r" };
		await expect(
			drafts.edit({ ...base, path: "assets/logo.png" }),
		).rejects.toMatchObject({ code: "validation" });
		await expect(
			drafts.edit({ ...base, path: "no/esta.md" }),
		).rejects.toMatchObject({ code: "not_found" });
		await expect(
			drafts.edit({ ...base, path: "scripts/calc.py", old: "zzz" }),
		).rejects.toMatchObject({ code: "validation" });
		expect(putFile).not.toHaveBeenCalled();
	});

	it("rechaza un resultado de más de 256 KB", async () => {
		const { drafts, putFile } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				path: "scripts/calc.py",
				old: "hola",
				new: "x".repeat(262_144),
				reason: "r",
			}),
		).rejects.toMatchObject({ code: "validation" });
		expect(putFile).not.toHaveBeenCalled();
	});
});
```

- [ ] **Paso 6: Correr y ver que fallan**

Run: `npx vitest run tests/brain/skills-draft.test.ts -t "skill_draft_edit"`
Esperado: FAIL, `drafts.edit is not a function`.

- [ ] **Paso 7: Implementar `edit`**

En `lib/brain/core/skills/draft.ts`:

1. Reemplazar los imports de `../errors.ts`, `./files.ts` y `./package.ts`, y agregar `skillMdName`:

```ts
import { BrainConflict, BrainError, BrainNotFound } from "../errors.ts";
```
```ts
import {
	type FilesDeps,
	type ParsedSkillMd,
	parseSkillMd,
	putSkillFile,
	readSkillFile,
} from "./files.ts";
```
```ts
import {
	isSkillSlug,
	isValidFilePath,
	MAX_COMPATIBILITY,
	MAX_DESCRIPTION,
	SKILLS_PREFIX,
	skillName,
} from "./package.ts";
```
```ts
import { renderSkillMd, skillMdName } from "./skill-md.ts";
```

2. Debajo de `const decoder = new TextDecoder();` agregar:

```ts
const encoder = new TextEncoder();

// Igual que MCP_MAX_UPSERT_BODY_BYTES de server.ts.
export const MAX_DRAFT_BODY_BYTES = 102_400;

const DRAFT_NOTE =
	"El cambio quedó en el borrador: todavía no lo ven los demás. Un administrador lo publica desde la plataforma.";

const invalid = (message: string) => new BrainError("validation", message);

function occurrences(text: string, fragment: string): number {
	let count = 0;
	for (
		let at = text.indexOf(fragment);
		at !== -1;
		at = text.indexOf(fragment, at + fragment.length)
	) {
		count += 1;
	}
	return count;
}

// Sin String.replace: un "$&" en el texto nuevo se escribe tal cual.
function replaceOnce(text: string, old: string, replacement: string): string {
	const at = text.indexOf(old);
	return text.slice(0, at) + replacement + text.slice(at + old.length);
}

// El fragmento tiene que aparecer exactamente una vez.
function applyEdit(
	text: string,
	old: string,
	replacement: string,
	where: string,
): string {
	if (old.length === 0) throw invalid("old no puede estar vacío.");
	const count = occurrences(text, old);
	if (count === 0) {
		throw invalid(
			`El fragmento no aparece en ${where}. Leelo con skill_draft_read y copiá el texto exacto.`,
		);
	}
	if (count > 1) {
		throw invalid(
			`El fragmento aparece ${count} veces en ${where}. Sumá texto alrededor para que sea único.`,
		);
	}
	return replaceOnce(text, old, replacement);
}

function checkedSkillMd(
	text: string,
	slug: string,
	descriptionBefore: string,
): ParsedSkillMd {
	const parsed = parseSkillMd(text);
	if (!parsed) {
		throw invalid(
			"El SKILL.md quedó sin un encabezado YAML válido (entre dos líneas ---).",
		);
	}
	if (skillMdName(text) !== skillName(slug)) {
		throw invalid(
			"El campo name del encabezado es la ruta de la skill y no se cambia.",
		);
	}
	if (parsed.description.length > MAX_DESCRIPTION) {
		throw invalid("La description supera los 1024 caracteres.");
	}
	if (parsed.description.length === 0 && descriptionBefore.length > 0) {
		throw invalid(
			"No se puede dejar la skill sin description: el asistente la usa para saber cuándo cargarla.",
		);
	}
	if (parsed.compatibility.length > MAX_COMPATIBILITY) {
		throw invalid("El campo compatibility supera los 500 caracteres.");
	}
	if (encoder.encode(parsed.body).length > MAX_DRAFT_BODY_BYTES) {
		throw invalid("El cuerpo del SKILL.md supera los 100 KB.");
	}
	return parsed;
}

function translateSave(error: unknown, slug: string): unknown {
	if (error instanceof BrainConflict) {
		return new BrainError(
			"conflict",
			"Alguien guardó la skill mientras la editabas. Leela de nuevo con skill_draft_read y repetí el cambio.",
		);
	}
	if (error instanceof BrainNotFound) return notFound(slug);
	return error;
}
```

3. En la interfaz `SkillDrafts` agregar:

```ts
	edit(input: {
		skill: string;
		path?: string;
		old: string;
		new: string;
		reason: string;
	}): Promise<DraftChange>;
```

4. Dentro de `createSkillDrafts`, antes del `return {`, agregar el armado del resultado:

```ts
	// El estado se vuelve a leer: el guardado cambió la revisión o los archivos.
	async function changed(
		actor: SkillActor,
		row: SkillOverviewRow,
		path: string,
		revision?: number,
	): Promise<DraftChange> {
		const fresh = (await files.store.overview(actor.tenantId)).find(
			(item) => item.slug === row.slug,
		);
		return {
			slug: row.slug,
			name: skillName(row.slug),
			path,
			...(revision !== undefined ? { revision } : {}),
			state: draftState(fresh ?? row),
			reviewUrl: deps.reviewUrl(row.slug),
			message: DRAFT_NOTE,
		};
	}
```

5. Dentro del objeto devuelto, después de `read`, agregar:

```ts
		async edit({ skill, path, old, new: replacement, reason }) {
			const { actor, row } = await resolve(skill);

			if (path === undefined || path === "" || path === SKILL_MD) {
				const page = await draftPage(actor, row.slug);
				const previous = page.frontmatter.description;
				const before = typeof previous === "string" ? previous.trim() : "";
				const text = applyEdit(
					skillMdOf(row.slug, page),
					old,
					replacement,
					"el SKILL.md del borrador",
				);
				const parsed = checkedSkillMd(text, row.slug, before);
				const frontmatter: Record<string, unknown> = {
					...page.frontmatter,
					description: parsed.description,
				};
				for (const key of ["compatibility", "license"] as const) {
					if (parsed[key]) frontmatter[key] = parsed[key];
					else delete frontmatter[key];
				}
				let saved: { revision: number };
				try {
					saved = await files.save(actor, {
						slug: row.slug,
						title: page.title,
						category: page.category,
						status: page.status,
						tags: page.tags,
						frontmatter,
						body: parsed.body,
						reason: `Edición por MCP: ${reason}`,
						baseRevision: page.revision,
					});
				} catch (error) {
					throw translateSave(error, row.slug);
				}
				return changed(actor, row, SKILL_MD, saved.revision);
			}

			if (!isValidFilePath(path)) throw invalid("Ruta de archivo inválida.");
			const read = await readSkillFile(tenantSlug, row.slug, { path }, files);
			if (!read.ok) failure(read);
			if (read.bytes.length > MAX_READABLE_BYTES || !looksLikeText(read.bytes)) {
				throw invalid(
					`"${path}" no es un archivo de texto de hasta 256 KB: se edita desde la plataforma.`,
				);
			}
			const next = encoder.encode(
				applyEdit(decoder.decode(read.bytes), old, replacement, `"${path}"`),
			);
			if (next.length > MAX_READABLE_BYTES) {
				throw invalid(`"${path}" quedaría de más de 256 KB.`);
			}
			const put = await putSkillFile(
				tenantSlug,
				row.slug,
				{ path, bytes: next },
				files,
			);
			if (!put.ok) failure(put);
			return changed(actor, row, path);
		},
```

- [ ] **Paso 8: Correr y ver que pasan**

Run: `npx vitest run tests/brain/skills-draft.test.ts tests/brain/skills-skill-md.test.ts`
Esperado: PASS.

- [ ] **Paso 9: Formatear, chequear tipos y commitear**

```bash
npx biome check --write lib/brain/core/skills/draft.ts lib/brain/core/skills/skill-md.ts tests/brain/skills-draft.test.ts tests/brain/skills-skill-md.test.ts
npm run typecheck
git add lib/brain/core/skills tests/brain/skills-draft.test.ts tests/brain/skills-skill-md.test.ts
git commit -m "feat: editar el borrador de una skill con reemplazo de un fragmento (24.5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 3: Escribir archivos y crear skills

**Archivos:**
- Modificar: `lib/brain/core/skills/draft.ts`
- Modificar: `tests/brain/skills-draft.test.ts`

**Interfaces:**
- Consume: de las tareas 1 y 2, `createSkillDrafts`, `changed()`, `resolve()`, `invalid`, `failure`, `MAX_DRAFT_BODY_BYTES`, `DRAFT_NOTE`; de `package.ts`, `MAX_SKILL_NAME`; de `../types.ts`, `SLUG_PATTERN` y `MAX_SLUG_LENGTH`.
- Produce: `SkillDrafts.writeFile(input: { skill: string; path: string; content: string }): Promise<DraftChange>` y `SkillDrafts.create(input: { name: string; folder?: string; title?: string; description: string; instructions: string; compatibility?: string; reason: string }): Promise<DraftChange>`.

- [ ] **Paso 1: Escribir las pruebas**

Agregar al final de `tests/brain/skills-draft.test.ts`, y sumar `WikiStoreError` (`import { WikiStoreError } from "@/lib/brain/core/wiki-store";`) y `BrainValidation` (al import de `@/lib/brain/core/errors`):

```ts
describe("skill_draft_write_file", () => {
	it("crea un archivo de texto del paquete", async () => {
		const { drafts, putFile, blobs } = setup();
		const result = await drafts.writeFile({
			skill: "facturacion",
			path: "references/guia.md",
			content: "# Guía\n",
		});
		expect(putFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "references/guia.md", size: 7 }),
		);
		const sha = putFile.mock.calls[0][0].sha256;
		expect(dec(blobs.get(`${TENANT}/${sha}`) as Uint8Array)).toBe("# Guía\n");
		expect(result).toMatchObject({
			path: "references/guia.md",
			state: "con_cambios",
		});
	});

	it("reemplaza un archivo que ya estaba", async () => {
		const { drafts, files } = setup();
		await drafts.writeFile({
			skill: "facturacion",
			path: "scripts/calc.py",
			content: "print('nuevo')",
		});
		expect(files().filter((f) => f.path === "scripts/calc.py")).toHaveLength(1);
	});

	it("SKILL.md no es un archivo del paquete y manda a skill_draft_edit", async () => {
		const { drafts, putFile } = setup();
		await expect(
			drafts.writeFile({ skill: "facturacion", path: "SKILL.md", content: "x" }),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("skill_draft_edit"),
		});
		expect(putFile).not.toHaveBeenCalled();
	});

	it("rechaza rutas inválidas y contenido de más de 256 KB", async () => {
		const { drafts, putFile } = setup();
		await expect(
			drafts.writeFile({ skill: "facturacion", path: "../x.md", content: "x" }),
		).rejects.toMatchObject({ code: "validation" });
		await expect(
			drafts.writeFile({
				skill: "facturacion",
				path: "references/big.md",
				content: "x".repeat(262_145),
			}),
		).rejects.toMatchObject({ code: "validation" });
		expect(putFile).not.toHaveBeenCalled();
	});

	it("el tope de archivos de la base se traduce a un error de validación", async () => {
		const { drafts, putFile } = setup();
		putFile.mockRejectedValueOnce(
			new WikiStoreError("BR422", "x", "package_limit"),
		);
		await expect(
			drafts.writeFile({
				skill: "facturacion",
				path: "references/uno.md",
				content: "x",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("50 archivos"),
		});
	});

	it("un lector recibe not_found", async () => {
		const { drafts, putFile } = setup({ rules: LECTOR });
		await expect(
			drafts.writeFile({
				skill: "facturacion",
				path: "references/guia.md",
				content: "x",
			}),
		).rejects.toMatchObject({ code: "not_found" });
		expect(putFile).not.toHaveBeenCalled();
	});
});

describe("skill_create", () => {
	const input = {
		name: "reporte-mensual",
		folder: "admin",
		description: "Armar el reporte mensual.",
		instructions: "# Reporte\n\nPasos.\n",
		reason: "primer borrador",
	};

	it("crea el borrador sin pisar nada: sin baseRevision, categoría skill, título por defecto", async () => {
		const { drafts, save } = setup();
		const result = await drafts.create(input);
		const write = save.mock.calls[0][1];
		expect(write).toMatchObject({
			slug: "skills/admin/reporte-mensual",
			title: "reporte-mensual",
			category: "skill",
			status: "activo",
			tags: [],
			body: "# Reporte\n\nPasos.\n",
			frontmatter: { description: "Armar el reporte mensual." },
			reason: "Alta por MCP: primer borrador",
		});
		expect(write.baseRevision).toBeUndefined();
		expect(result).toMatchObject({
			slug: "skills/admin/reporte-mensual",
			name: "reporte-mensual",
			path: "SKILL.md",
			revision: 1,
			state: "sin_publicar",
			reviewUrl: "https://agents.test/acme/brain/p/skills/admin/reporte-mensual",
		});
	});

	it("la skill creada se puede leer y editar enseguida, y los demás no la ven publicada", async () => {
		const { drafts, rows } = setup();
		await drafts.create(input);
		const read = await drafts.read({ skill: "reporte-mensual" });
		expect(read).toMatchObject({ state: "sin_publicar", revision: 1 });
		expect(rows.find((r) => r.slug === "skills/admin/reporte-mensual")?.current)
			.toBeNull();
	});

	it("sin carpeta cae directo bajo skills/, con compatibility y título propio", async () => {
		const { drafts, save } = setup();
		await drafts.create({
			...input,
			folder: undefined,
			title: "Reporte mensual",
			compatibility: "Python 3",
		});
		expect(save.mock.calls[0][1]).toMatchObject({
			slug: "skills/reporte-mensual",
			title: "Reporte mensual",
			frontmatter: {
				description: "Armar el reporte mensual.",
				compatibility: "Python 3",
			},
		});
	});

	it("rechaza nombres, carpetas, textos y largos inválidos sin guardar", async () => {
		const { drafts, save } = setup();
		for (const bad of [
			{ name: "Reporte Mensual" },
			{ name: "a/b" },
			{ name: "x".repeat(65) },
			{ folder: "Admin" },
			{ description: "   " },
			{ description: "x".repeat(1025) },
			{ compatibility: "x".repeat(501) },
			{ instructions: "   " },
			{ instructions: "x".repeat(102_401) },
		]) {
			await expect(drafts.create({ ...input, ...bad })).rejects.toMatchObject({
				code: "validation",
			});
		}
		expect(save).not.toHaveBeenCalled();
	});

	it("un lector no crea, y un editor solo crea en su carpeta", async () => {
		const lector = setup({ rules: LECTOR });
		await expect(lector.drafts.create(input)).rejects.toMatchObject({
			code: "forbidden",
		});
		expect(lector.save).not.toHaveBeenCalled();

		const ventas = setup({
			rules: [members("", "lector"), members("skills/ventas", "editor")],
		});
		await expect(ventas.drafts.create(input)).rejects.toMatchObject({
			code: "forbidden",
		});
		await ventas.drafts.create({ ...input, folder: "ventas" });
		expect(ventas.save).toHaveBeenCalledTimes(1);
	});

	it("si la ruta ya existe, conflicto que manda a skill_draft_edit", async () => {
		const { drafts } = setup();
		await expect(
			drafts.create({ ...input, name: "facturacion" }),
		).rejects.toMatchObject({
			code: "conflict",
			message: expect.stringContaining("skill_draft_edit"),
		});
	});

	it("si la carpeta no existe, el error del guardado llega tal cual", async () => {
		const { drafts } = setup({
			saveError: new BrainValidation(
				["folder"],
				"No existe la carpeta skills/nueva. Pedile a un administrador que la cree.",
			),
		});
		await expect(
			drafts.create({ ...input, folder: "nueva" }),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("No existe la carpeta"),
		});
	});
});
```

- [ ] **Paso 2: Correr y ver que fallan**

Run: `npx vitest run tests/brain/skills-draft.test.ts -t "skill_create|skill_draft_write_file"`
Esperado: FAIL, `drafts.writeFile is not a function`.

- [ ] **Paso 3: Implementar `writeFile` y `create`**

En `lib/brain/core/skills/draft.ts`:

1. Ampliar imports: `import { MAX_SLUG_LENGTH, SLUG_PATTERN, type BrainPage } from "../types.ts";` y sumar `MAX_SKILL_NAME` al import de `./package.ts`.

2. En la interfaz `SkillDrafts` agregar:

```ts
	writeFile(input: {
		skill: string;
		path: string;
		content: string;
	}): Promise<DraftChange>;
	create(input: {
		name: string;
		folder?: string;
		title?: string;
		description: string;
		instructions: string;
		compatibility?: string;
		reason: string;
	}): Promise<DraftChange>;
```

3. Dentro del objeto devuelto, después de `edit`, agregar:

```ts
		async writeFile({ skill, path, content }) {
			const { actor, row } = await resolve(skill);
			if (path === SKILL_MD) {
				throw invalid(
					"SKILL.md no es un archivo del paquete: cambialo con skill_draft_edit.",
				);
			}
			if (!isValidFilePath(path)) {
				throw invalid(
					"Ruta inválida. Usá letras, números, guiones y puntos, sin espacios ni «..», hasta seis niveles.",
				);
			}
			const bytes = encoder.encode(content);
			if (bytes.length > MAX_READABLE_BYTES) {
				throw invalid(
					"Por acá entran archivos de texto de hasta 256 KB; los más grandes se suben desde la plataforma.",
				);
			}
			const put = await putSkillFile(
				tenantSlug,
				row.slug,
				{ path, bytes },
				files,
			);
			if (!put.ok) failure(put);
			return changed(actor, row, path);
		},

		async create(input) {
			const actor = await files.actor(tenantSlug);
			if (!actor) throw notFound(input.name);
			const name = input.name.trim();
			const folder = input.folder?.trim().replace(/^\/+|\/+$/g, "");
			const slug = folder
				? `${SKILLS_PREFIX}${folder}/${name}`
				: `${SKILLS_PREFIX}${name}`;
			if (
				name.length === 0 ||
				name.length > MAX_SKILL_NAME ||
				name.includes("/") ||
				slug.length > MAX_SLUG_LENGTH ||
				!SLUG_PATTERN.test(slug)
			) {
				throw invalid(
					"El nombre y la carpeta usan minúsculas, dígitos y guiones (la carpeta puede tener subniveles separados por /). El nombre llega a 64 caracteres.",
				);
			}
			const description = input.description.trim();
			if (description.length === 0 || description.length > MAX_DESCRIPTION) {
				throw invalid(
					"La description es obligatoria y llega a 1024 caracteres: dice cuándo conviene usar la skill.",
				);
			}
			const compatibility = input.compatibility?.trim() ?? "";
			if (compatibility.length > MAX_COMPATIBILITY) {
				throw invalid("El campo compatibility supera los 500 caracteres.");
			}
			if (
				input.instructions.trim().length === 0 ||
				encoder.encode(input.instructions).length > MAX_DRAFT_BODY_BYTES
			) {
				throw invalid(
					"Las instrucciones son obligatorias y llegan a 100 KB.",
				);
			}
			if (!atLeast(deps.levelOf(slug), "editor")) {
				throw new BrainError(
					"forbidden",
					"Necesitás ser editor de esa carpeta para crear una skill ahí.",
				);
			}
			let saved: { revision: number };
			try {
				saved = await files.save(actor, {
					slug,
					title: input.title?.trim() || name,
					category: "skill",
					status: "activo",
					tags: [],
					frontmatter: {
						description,
						...(compatibility ? { compatibility } : {}),
					},
					body: input.instructions,
					reason: `Alta por MCP: ${input.reason}`,
				});
			} catch (error) {
				if (error instanceof BrainConflict) {
					throw new BrainError(
						"conflict",
						`Ya existe una página en ${slug}. Para cambiarla usá skill_draft_edit.`,
					);
				}
				throw error;
			}
			return {
				slug,
				name,
				path: SKILL_MD,
				revision: saved.revision,
				state: "sin_publicar",
				reviewUrl: deps.reviewUrl(slug),
				message: DRAFT_NOTE,
			};
		},
```

- [ ] **Paso 4: Correr y ver que pasan**

Run: `npx vitest run tests/brain/skills-draft.test.ts`
Esperado: PASS, todo el archivo.

- [ ] **Paso 5: Formatear, chequear tipos y commitear**

```bash
npx biome check --write lib/brain/core/skills/draft.ts tests/brain/skills-draft.test.ts
npm run typecheck
npx vitest run tests/brain/boundary.test.ts
git add lib/brain/core/skills/draft.ts tests/brain/skills-draft.test.ts
git commit -m "feat: crear skills y escribir archivos del borrador desde un asistente (24.5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Esperado: typecheck y frontera sin errores (`draft.ts` no importa nada de Next ni Supabase).

---

### Tarea 4: Registrar las tools en el servidor MCP

**Archivos:**
- Modificar: `lib/brain/core/mcp-server/server.ts`
- Modificar: `tests/brain/mcp-server/tools.test.ts`

**Interfaces:**
- Consume: `SkillDrafts` y `DraftChange` (de `draft.ts`).
- Produce: `buildBrainMcpServer(ctx)` acepta `skillDrafts?: SkillDrafts | null`; `SKILL_TOOL_NAMES` suma `draftRead: "skill_draft_read"`, `draftEdit: "skill_draft_edit"`, `draftWriteFile: "skill_draft_write_file"` y `create: "skill_create"`.

- [ ] **Paso 1: Escribir las pruebas que fallan**

En `tests/brain/mcp-server/tools.test.ts` sumar al import de tipos `import type { DraftChange, SkillDrafts } from "@/lib/brain/core/skills/draft";` y agregar al final del archivo:

```ts
const change: DraftChange = {
	slug: "skills/ventas/reporte",
	name: "reporte",
	path: "SKILL.md",
	revision: 5,
	state: "con_cambios",
	reviewUrl: "https://agents.test/acme/brain/p/skills/ventas/reporte",
	message: "El cambio quedó en el borrador.",
};

function fakeDrafts(): SkillDrafts {
	return {
		read: vi.fn(async () => ({ slug: change.slug, skillMd: "---\n---\n" })),
		edit: vi.fn(async () => change),
		writeFile: vi.fn(async () => change),
		create: vi.fn(async () => change),
	};
}

describe("buildBrainMcpServer · edición de skills", () => {
	function build(
		skillDrafts: SkillDrafts | null,
		limiter = fakeLimiter(),
	) {
		return {
			limiter,
			server: buildBrainMcpServer({
				userId: "ana",
				categories: ["comercial"],
				canon: false,
				provider: fakeProvider(),
				limiter,
				skillDrafts,
			}),
		};
	}

	it("sin skillDrafts no hay tools de edición", async () => {
		const client = await connect(build(null).server);
		const names = (await client.listTools()).tools.map((t) => t.name);
		expect(names.some((name) => name.startsWith("skill_"))).toBe(false);
		expect(client.getInstructions()).toBeUndefined();
	});

	it("con skillDrafts aparecen las cuatro, con sus anotaciones y las instrucciones", async () => {
		const client = await connect(build(fakeDrafts()).server);
		const tools = (await client.listTools()).tools;
		expect(tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
			"skill_create",
			"skill_draft_edit",
			"skill_draft_read",
			"skill_draft_write_file",
		]);
		const byName = (name: string) => tools.find((t) => t.name === name);
		expect(byName("skill_draft_read")?.annotations?.readOnlyHint).toBe(true);
		for (const name of [
			"skill_draft_edit",
			"skill_draft_write_file",
			"skill_create",
		]) {
			expect(byName(name)?.annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(byName(name)?.description).toContain("borrador");
		}
		expect(client.getInstructions()).toContain("borrador");
	});

	it("leer cuenta como lectura y escribir, como escritura; los argumentos llegan intactos", async () => {
		const drafts = fakeDrafts();
		const { server, limiter } = build(drafts);
		const client = await connect(server);

		const read = await client.callTool({
			name: "skill_draft_read",
			arguments: { skill: "reporte" },
		});
		expect(read.structuredContent).toMatchObject({ ok: true, slug: change.slug });
		expect(limiter.check).toHaveBeenLastCalledWith("read");

		const edit = await client.callTool({
			name: "skill_draft_edit",
			arguments: { skill: "reporte", old: "a", new: "b", reason: "r" },
		});
		expect(edit.structuredContent).toMatchObject({ ok: true, revision: 5 });
		expect(drafts.edit).toHaveBeenCalledWith({
			skill: "reporte",
			old: "a",
			new: "b",
			reason: "r",
		});
		expect(limiter.check).toHaveBeenLastCalledWith("write");

		await client.callTool({
			name: "skill_draft_write_file",
			arguments: { skill: "reporte", path: "references/x.md", content: "x" },
		});
		await client.callTool({
			name: "skill_create",
			arguments: {
				name: "nueva",
				description: "d",
				instructions: "i",
				reason: "r",
			},
		});
		expect(drafts.writeFile).toHaveBeenCalledTimes(1);
		expect(drafts.create).toHaveBeenCalledTimes(1);
	});

	it("un error de BrainError sale con el formato de siempre y como error", async () => {
		const drafts = fakeDrafts();
		drafts.edit = vi.fn(async () => {
			throw new BrainError("validation", "El fragmento no aparece.");
		});
		const client = await connect(build(drafts).server);
		const result = await client.callTool({
			name: "skill_draft_edit",
			arguments: { skill: "reporte", old: "a", new: "b", reason: "r" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "validation",
			message: "El fragmento no aparece.",
		});
	});
});
```

- [ ] **Paso 2: Correr y ver que fallan**

Run: `npx vitest run tests/brain/mcp-server/tools.test.ts -t "edición de skills"`
Esperado: FAIL (las tools no están registradas, `skillDrafts` no existe en el contexto).

- [ ] **Paso 3: Implementar el registro**

En `lib/brain/core/mcp-server/server.ts`:

1. Agregar el import `import type { SkillDrafts } from "../skills/draft.ts";`.

2. Ampliar `SKILL_TOOL_NAMES`:

```ts
export const SKILL_TOOL_NAMES = {
	list: "skill_list",
	load: "skill_load",
	file: "skill_file",
	package: "skill_package",
	draftRead: "skill_draft_read",
	draftEdit: "skill_draft_edit",
	draftWriteFile: "skill_draft_write_file",
	create: "skill_create",
} as const;
```

3. Debajo de `SKILL_LOAD_INTRO` agregar las instrucciones:

```ts
const DRAFT_INSTRUCTIONS =
	"Podés crear y editar skills de esta empresa con skill_create, skill_draft_edit y skill_draft_write_file. Esas tools cambian el BORRADOR, no lo que usan los demás: un administrador revisa y publica desde la plataforma. Para ver tu cambio leé el borrador con skill_draft_read (skill_load y skill_file siguen devolviendo lo publicado). Antes de editar, leé el texto con skill_draft_read y copiá el fragmento exacto. Después de cambiar algo, avisale a la persona que quedó en borrador y pasale el reviewUrl.";
```

4. Agregar `skillDrafts` al contexto de `buildBrainMcpServer`:

```ts
	/** Tools para crear y editar el borrador de skills; solo para quien edita. */
	skillDrafts?: SkillDrafts | null;
```

5. Reemplazar la creación del servidor:

```ts
	const skills = ctx.skills ?? null;
	const drafts = ctx.skillDrafts ?? null;
	const instructions = [
		skills ? SKILL_INSTRUCTIONS : null,
		drafts ? DRAFT_INSTRUCTIONS : null,
	]
		.filter((text): text is string => text !== null)
		.join("\n\n");
	const server = new McpServer(
		{ name: "innovas-brain", version: "1.0.0" },
		instructions ? { instructions } : undefined,
	);
```

6. Antes del `return server;` final agregar:

```ts
	if (drafts) {
		const SKILL_REF = z.string().min(1).max(200);
		const WRITES = {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
		};

		server.registerTool(
			SKILL_TOOL_NAMES.draftRead,
			{
				description:
					"Lee el BORRADOR de una skill que podés editar (no la versión publicada): sin path devuelve el SKILL.md completo con su encabezado, la revisión, el estado de publicación y la lista de archivos; con path, un archivo de texto. La skill se nombra por nombre o por ruta completa (skills/…).",
				inputSchema: {
					skill: SKILL_REF,
					path: z.string().min(1).max(200).optional(),
				},
				annotations: { readOnlyHint: true },
			},
			async (input) =>
				run("read", async () => ({ ok: true, ...(await drafts.read(input)) })),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.draftEdit,
			{
				description:
					"Cambia el BORRADOR de una skill reemplazando un fragmento: `old` tiene que aparecer exactamente una vez y se cambia por `new`. Sin path edita el SKILL.md (encabezado o cuerpo); con path, un archivo de texto del paquete. No publica: un administrador lo hace desde la plataforma. El motivo queda en el historial cuando el cambio es en el SKILL.md.",
				inputSchema: {
					skill: SKILL_REF,
					path: z.string().min(1).max(200).optional(),
					old: z.string().min(1).max(102_400),
					new: z.string().max(102_400),
					reason: z.string().min(1).max(200),
				},
				annotations: WRITES,
			},
			async (input) =>
				run("write", async () => ({ ok: true, ...(await drafts.edit(input)) })),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.draftWriteFile,
			{
				description:
					"Crea o reemplaza un archivo de texto (script, referencia, plantilla) en el BORRADOR de una skill, de hasta 256 KB. No sirve para el SKILL.md: ese se cambia con skill_draft_edit. No publica.",
				inputSchema: {
					skill: SKILL_REF,
					path: z.string().min(1).max(200),
					content: z.string().max(262_144),
				},
				annotations: WRITES,
			},
			async (input) =>
				run("write", async () => ({
					ok: true,
					...(await drafts.writeFile(input)),
				})),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.create,
			{
				description:
					"Crea una skill nueva como BORRADOR en skills/<folder>/<name> (la carpeta tiene que existir; sin folder queda directo en skills/). `description` dice cuándo conviene usarla; `instructions` es el cuerpo del SKILL.md. Nadie más la ve hasta que un administrador la publique desde la plataforma. Los archivos se agregan después con skill_draft_write_file.",
				inputSchema: {
					name: z.string().min(1).max(64),
					folder: z.string().min(1).max(150).optional(),
					title: z.string().min(1).max(300).optional(),
					description: z.string().min(1).max(1024),
					instructions: z.string().min(1).max(102_400),
					compatibility: z.string().max(500).optional(),
					reason: z.string().min(1).max(200),
				},
				annotations: WRITES,
			},
			async (input) =>
				run("write", async () => ({ ok: true, ...(await drafts.create(input)) })),
		);
	}
```

- [ ] **Paso 4: Correr y ver que pasan**

Run: `npx vitest run tests/brain/mcp-server/tools.test.ts`
Esperado: PASS, incluidas las existentes.

- [ ] **Paso 5: Formatear, chequear tipos y commitear**

```bash
npx biome check --write lib/brain/core/mcp-server/server.ts tests/brain/mcp-server/tools.test.ts
npm run typecheck
git add lib/brain/core/mcp-server/server.ts tests/brain/mcp-server/tools.test.ts
git commit -m "feat: registrar skill_create y skill_draft_* en el servidor MCP del brain (24.5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: Cablear el handler, producción y el mensaje de rechazo

**Archivos:**
- Modificar: `lib/brain/core/mcp-server/handler.ts`
- Modificar: `lib/brain/adapters/mcp-production.ts`
- Modificar: `lib/brain/core/skills/view.ts`
- Modificar: `tests/brain/mcp-server/handler.test.ts`

**Interfaces:**
- Consume: `createSkillDrafts`, `canEditSkills`, `SkillDrafts` (de `draft.ts`); `BlobStore` (de `files.ts`); `SkillStore` (de `store.ts`); `SKILL_CATEGORY` (de `package.ts`).
- Produce: `McpSkillsDeps.edit?: { store: SkillStore; blobs: BlobStore }`; el handler pasa `skillDrafts` a `buildBrainMcpServer`; `skillReviewUrl(publicUrl, tenantSlug, slug, tenantHost?)`.

- [ ] **Paso 1: Escribir las pruebas que fallan**

En `tests/brain/mcp-server/handler.test.ts` sumar los imports que falten (`BrainPage` de `@/lib/brain/core/types`, `SkillStore` de `@/lib/brain/core/skills/store`) y agregar al final:

```ts
describe("handleBrainMcp · edición de skills", () => {
	const SKILL_SLUG = "skills/ventas/reporte";
	const withSkillCategory: Partial<BrainMcpDeps> = {
		store: {
			...store,
			brainBinding: async () => ({
				...binding,
				config: { ...binding.config, categories: ["comercial", "skill"] },
			}),
		},
	};
	const row: SkillOverviewRow = {
		pageId: "p1",
		slug: SKILL_SLUG,
		revision: 3,
		draftFilesDigest: "fd",
		current: null,
	};
	const skillPage: BrainPage = {
		slug: SKILL_SLUG,
		title: "Reporte",
		category: "skill",
		status: "activo",
		tags: [],
		frontmatter: { description: "Describe la skill." },
		body: "# Pasos\n\nUno.\n",
		revision: 3,
		updatedAt: "2026-10-15T00:00:00Z",
	};
	const editStore: SkillStore = {
		overview: async () => [row],
		files: async () => [],
		acts: async () => [],
		putFile: vi.fn(async () => "fd2"),
		removeFile: vi.fn(),
		publish: vi.fn(),
		withdraw: vi.fn(),
	};
	const edit = {
		store: editStore,
		blobs: { put: vi.fn(async () => {}), get: async () => null },
	};
	const DRAFT_TOOLS = [
		"skill_create",
		"skill_draft_edit",
		"skill_draft_read",
		"skill_draft_write_file",
	];
	const skillsDeps = (extra: Partial<BrainMcpDeps["skills"]> = {}) => ({
		overview: async () => [row],
		blob: async () => null,
		record: async () => {},
		issue: vi.fn(),
		edit,
		...extra,
	});
	const names = async (client: Awaited<ReturnType<typeof connect>>) =>
		(await client.listTools()).tools.map((t) => t.name).sort();

	it("un administrador ve las cuatro tools aunque no haya skills publicadas", async () => {
		const client = await connect(
			"admin",
			deps({ ...withSkillCategory, skills: skillsDeps() }),
		);
		expect(await names(client)).toEqual([...BRAIN_TOOLS, ...DRAFT_TOOLS]);
	});

	it("un lector no las ve", async () => {
		const client = await connect(
			"ana",
			deps({ ...withSkillCategory, skills: skillsDeps() }),
		);
		expect(await names(client)).toEqual(BRAIN_TOOLS);
	});

	it("un miembro con regla de editor sobre una carpeta de skills las ve", async () => {
		const client = await connect(
			"ana",
			deps({
				...withSkillCategory,
				skills: skillsDeps({ overview: async () => [] }),
				rules: {
					load: async () => [
						{
							path: "skills/ventas",
							principal: "user",
							userId: "ana",
							level: "editor",
						},
					],
				},
			}),
		);
		expect(await names(client)).toEqual([...BRAIN_TOOLS, ...DRAFT_TOOLS]);
	});

	it("sin la categoría skill habilitada, o sin dependencias de edición, no hay tools", async () => {
		const sinCategoria = await connect("admin", deps({ skills: skillsDeps() }));
		expect(await names(sinCategoria)).toEqual(BRAIN_TOOLS);
		const sinEdit = await connect(
			"admin",
			deps({
				...withSkillCategory,
				skills: skillsDeps({ edit: undefined }),
			}),
		);
		expect(await names(sinEdit)).toEqual(BRAIN_TOOLS);
	});

	it("con un brain externo no hay tools de edición", async () => {
		const client = await connect(
			"admin",
			deps({
				skills: skillsDeps(),
				store: {
					...store,
					brainBinding: async () => ({ ...binding, provider: "mcp" }),
				},
			}),
		);
		expect(await names(client)).toEqual(BRAIN_TOOLS);
	});

	it("skill_create guarda con la persona como autora y devuelve el link con el slug de la empresa", async () => {
		const d = deps({ ...withSkillCategory, skills: skillsDeps() });
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "skill_create",
			arguments: {
				name: "nueva",
				folder: "ventas",
				description: "Armar algo.",
				instructions: "# Pasos\n",
				reason: "primer borrador",
			},
		});
		expect(result.structuredContent).toMatchObject({
			ok: true,
			slug: "skills/ventas/nueva",
			state: "sin_publicar",
			reviewUrl: "https://agents.test/a/brain/p/skills/ventas/nueva",
		});
		expect(d.providerInstance.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				slug: "skills/ventas/nueva",
				category: "skill",
			}),
			{ kind: "user", userId: "admin" },
		);
	});

	it("con el dominio de la empresa el link sale sin slug", async () => {
		const client = await connect(
			"admin",
			deps({ ...withSkillCategory, skills: skillsDeps(), tenantHost: true }),
		);
		const result = await client.callTool({
			name: "skill_create",
			arguments: {
				name: "nueva",
				description: "Armar algo.",
				instructions: "# Pasos\n",
				reason: "r",
			},
		});
		expect(result.structuredContent).toMatchObject({
			reviewUrl: "https://agents.test/brain/p/skills/nueva",
		});
	});

	it("skill_draft_edit lee el borrador y guarda con la revisión leída", async () => {
		const provider = fakeProvider();
		provider.read = vi.fn(async () => skillPage);
		provider.upsert = vi.fn(async () => ({ slug: SKILL_SLUG, revision: 4 }));
		const client = await connect(
			"admin",
			deps({
				...withSkillCategory,
				skills: skillsDeps(),
				provider: () => provider,
			}),
		);
		const result = await client.callTool({
			name: "skill_draft_edit",
			arguments: { skill: "reporte", old: "Uno.", new: "Uno y dos.", reason: "r" },
		});
		expect(result.structuredContent).toMatchObject({
			ok: true,
			slug: SKILL_SLUG,
			revision: 4,
		});
		expect(provider.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				slug: SKILL_SLUG,
				body: "# Pasos\n\nUno y dos.\n",
				baseRevision: 3,
				reason: "Edición por MCP: r",
			}),
			{ kind: "user", userId: "admin" },
		);
	});

	it("brain_upsert sobre skills/ sigue rechazado y el mensaje manda a las tools de skills", async () => {
		const d = deps({ ...withSkillCategory, skills: skillsDeps() });
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: {
				slug: SKILL_SLUG,
				title: "Reporte",
				// La categoría skill no se anuncia a los asistentes (assistantCategories):
				// el rechazo sale de la ruta bajo skills/, no de la categoría.
				category: "comercial",
				status: "activo",
				tags: [],
				body: "x",
				reason: "r",
			},
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			error: "forbidden",
			message: expect.stringContaining("skill_draft_edit"),
		});
		expect(d.providerInstance.upsert).not.toHaveBeenCalled();
	});

	it("brain_read sobre skills/ sigue sin existir para quien edita", async () => {
		const client = await connect(
			"admin",
			deps({ ...withSkillCategory, skills: skillsDeps() }),
		);
		const result = await client.callTool({
			name: "brain_read",
			arguments: { slug: SKILL_SLUG },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ error: "not_found" });
	});
});
```

- [ ] **Paso 2: Correr y ver que fallan**

Run: `npx vitest run tests/brain/mcp-server/handler.test.ts -t "edición de skills"`
Esperado: FAIL (no hay tools de edición; `edit` no existe en `McpSkillsDeps`, el mensaje de `brain_upsert` no menciona las tools).

- [ ] **Paso 3: Implementar el cableado en `handler.ts`**

1. Imports (después de los existentes de skills):

```ts
import { BrainNotFound } from "../errors.ts";
import { canEditSkills, createSkillDrafts, type SkillDrafts } from "../skills/draft.ts";
import type { BlobStore } from "../skills/files.ts";
import { assistantCategories, SKILL_CATEGORY } from "../skills/package.ts";
import type { SkillOverviewRow, SkillStore } from "../skills/store.ts";
```
(reemplazan los imports de `assistantCategories` y `SkillOverviewRow` que ya hay).

2. En `McpSkillsDeps` agregar:

```ts
	/** Para crear y editar el borrador (spec 24.5). Sin esto no hay esas tools. */
	edit?: { store: SkillStore; blobs: BlobStore };
```

3. Debajo de `resourceUrl` agregar:

```ts
// A dónde mandar a la persona a revisar el borrador: la pantalla de la skill.
function skillReviewUrl(
	publicUrl: string,
	tenantSlug: string,
	skillSlug: string,
	tenantHost?: boolean,
) {
	return tenantHost
		? `${publicUrl}/brain/p/${skillSlug}`
		: `${publicUrl}/${tenantSlug}/brain/p/${skillSlug}`;
}
```

4. En `handleBrainMcpInner`, reemplazar el bloque del proveedor y del catálogo por:

```ts
	// withoutSkills por fuera de withAccess: ni un administrador ve skills por
	// las tools del brain (spec 24.1 S6). Las skills salen por su catálogo y, para
	// quien las edita, por skill_draft_* (spec 24.5), que usa el proveedor sin
	// esa guardia y solo adentro de draft.ts.
	const accessProvider = withAccess(
		deps.provider(access.binding),
		principal,
		rules,
	);
	const provider = withoutSkills(accessProvider);

	// El overview se pide una sola vez por request.
	let overviewRows: Promise<SkillOverviewRow[]> | null = null;
	const overview = () => {
		overviewRows ??= deps.skills.overview(access.tenantId);
		return overviewRows;
	};
```
y dentro de `loadSkillCatalog({ overview: () => deps.skills.overview(access.tenantId), …` cambiar esa línea por `overview,`.

5. Después del bloque `let skills … catch`, agregar:

```ts
	// Solo quien puede editar algo bajo skills/, con la categoría habilitada.
	let skillDrafts: SkillDrafts | null = null;
	const editDeps = deps.skills.edit;
	if (
		editDeps &&
		access.binding.provider === "wiki" &&
		access.binding.config.categories.includes(SKILL_CATEGORY)
	) {
		try {
			if (canEditSkills(rules, principal, await overview())) {
				skillDrafts = createSkillDrafts({
					tenantSlug: slug,
					levelOf: (path) => resolveAccess(rules, principal, path),
					reviewUrl: (skillSlug) =>
						skillReviewUrl(deps.publicUrl, slug, skillSlug, deps.tenantHost),
					files: {
						actor: async () => ({
							tenantId: access.tenantId,
							userId: access.userId,
							role: access.role,
						}),
						binding: async () => ({ provider: "wiki" }),
						rules: { load: async () => rules },
						page: async (_tenantId, skillSlug) => {
							try {
								return await accessProvider.read(skillSlug, {
									suggestions: false,
								});
							} catch (error) {
								if (error instanceof BrainNotFound) return null;
								throw error;
							}
						},
						save: (_actor, write) =>
							accessProvider.upsert(write, {
								kind: "user",
								userId: access.userId,
							}),
						store: editDeps.store,
						blobs: editDeps.blobs,
					},
				});
			}
		} catch (error) {
			console.error("brain mcp: no pude armar la edición de skills", error);
		}
	}
```

6. En la llamada a `buildBrainMcpServer({ … skills, … })` agregar `skillDrafts,`.

- [ ] **Paso 4: Cablear producción**

En `lib/brain/adapters/mcp-production.ts`, dentro de `skillsDeps()` agregar, después de `issue`:

```ts
		// Para crear y editar el borrador desde un asistente (spec 24.5).
		edit: { store: skillStore(), blobs: blobStore() },
```

- [ ] **Paso 5: Actualizar el mensaje de rechazo**

En `lib/brain/core/skills/view.ts`, en `upsert`, reemplazar el texto del `BrainForbidden`:

```ts
				throw new BrainForbidden(
					"Las skills no se editan con brain_upsert: si tu cliente ofrece skill_create y skill_draft_edit, usalas; publicar se hace desde la plataforma.",
				);
```

- [ ] **Paso 6: Correr y ver que pasan**

Run: `npx vitest run tests/brain/mcp-server tests/brain/skills-view.test.ts`
Esperado: PASS. Si `production.test.ts` falla por la forma de `skills`, ajustar su aserción para incluir `edit` (los mocks devuelven `undefined` en `skillStore()` y `blobStore()`, y eso no rompe).

- [ ] **Paso 7: Formatear, chequear tipos y commitear**

```bash
npx biome check --write lib/brain/core/mcp-server/handler.ts lib/brain/adapters/mcp-production.ts lib/brain/core/skills/view.ts tests/brain/mcp-server/handler.test.ts
npm run typecheck
git add lib/brain tests/brain/mcp-server/handler.test.ts
git commit -m "feat: armar las tools de edición de skills en el endpoint MCP, solo para quien edita (24.5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Documentación y verificación final

**Archivos:**
- Modificar: `docs/guias/conectar-brain-por-mcp.md`
- Modificar: `docs/dominios/brain.md`
- Modificar: `docs/producto/roadmap.md`
- Modificar: `docs/decisiones/README.md`

**Interfaces:** ninguna nueva.

- [ ] **Paso 1: Guía de conexión**

En `docs/guias/conectar-brain-por-mcp.md`:

1. En el bloque `sources` del encabezado, debajo de `lib/brain/core/skills/catalog.ts`, agregar `  - lib/brain/core/skills/draft.ts`.
2. Reemplazar la última línea de la sección «Skills de la empresa» («Las skills se arman y se publican desde la plataforma; cómo, está en [el dominio brain](../dominios/brain.md).») por:

```markdown
Las skills se publican desde la plataforma; cómo, está en [el dominio brain](../dominios/brain.md).

### Crear y editar skills desde tu asistente

Si sos editor de una carpeta de skills (o de una skill), tu asistente tiene cuatro tools más. Aparecen solo para quien puede editar algo bajo `skills/`, y solo si la empresa tiene habilitada la categoría `skill`:

- `skill_create`: crea una skill nueva como **borrador**, en `skills/<carpeta>/<nombre>`. La carpeta tiene que existir.
- `skill_draft_read`: lee el borrador (el `SKILL.md` completo, su revisión, su estado y sus archivos) o un archivo de texto.
- `skill_draft_edit`: cambia el borrador reemplazando un fragmento que aparece una sola vez, en el `SKILL.md` o en un archivo de texto.
- `skill_draft_write_file`: crea o reemplaza un archivo de texto del paquete.

Cosas a saber:

- **Todo va al borrador.** Lo que usan los demás no cambia hasta que un administrador publica desde la plataforma; `skill_load` y `skill_file` siguen devolviendo la versión publicada. Para probar tu cambio, pedile a tu asistente que lea el borrador.
- Cada respuesta trae un link a la pantalla de la skill, donde un administrador revisa y publica.
- Por MCP entran archivos de texto de hasta 256 KB (el `SKILL.md` hasta 100 KB). Los binarios, borrar archivos, publicar y retirar son de la plataforma.
- Si otra persona guardó la skill mientras editabas, el asistente recibe un conflicto y tiene que leer el borrador de nuevo. Una skill que no podés editar responde igual que una que no existe.
- Los cambios al `SKILL.md` quedan en el historial de la página con tu nombre y `Edición por MCP: <motivo>`. Las escrituras cuentan como escrituras en el límite por minuto.
```

- [ ] **Paso 2: Dominio brain**

En `docs/dominios/brain.md`:

1. En el encabezado, debajo de la línea de la spec de la 24.5 ya agregada, sumar `  - docs/superpowers/plans/2026-10-15-etapa-24-5-editar-skills-por-mcp.md` y, junto a los archivos de código de skills (si hay una lista, cerca de `lib/brain/core/folders.ts`), `  - lib/brain/core/skills/draft.ts`.
2. Reemplazar el final de la línea de enlaces de la 24.5 por: `[etapa 24.5, crear y editar skills por MCP](../superpowers/specs/2026-10-15-etapa-24-5-editar-skills-por-mcp-design.md) y [plan](../superpowers/plans/2026-10-15-etapa-24-5-editar-skills-por-mcp.md).`
3. Insertar una sección nueva justo antes de `### Frontera core/adapters` (después de «Paquete completo por MCP (etapa 24.2b)»):

```markdown
### Crear y editar skills por MCP (etapa 24.5)

`lib/brain/core/skills/draft.ts` es el único lugar que ve el borrador de una skill desde un asistente. El handler le pasa el proveedor con `withAccess` pero **sin** `withoutSkills`; las tres tools del brain siguen recibiendo el envuelto con la guardia. Las tools (`skill_create`, `skill_draft_read`, `skill_draft_edit`, `skill_draft_write_file`) se registran solo si la categoría `skill` está habilitada y la persona puede editar algo bajo `skills/`, y todo cambio va al borrador: publicar es solo de la web (24.1 S5). Reusan `putSkillFile` y `readSkillFile` para el permiso de editor y los topes del paquete, y el guardado del brain para el `SKILL.md` (con `baseRevision`, o sin él para crear: el guardado sin `baseRevision` solo crea páginas nuevas, así que `skill_create` nunca pisa una página).
```

- [ ] **Paso 3: Roadmap y decisiones**

En `docs/producto/roadmap.md`, Etapa 24:

1. En la línea **Spec/Plan:** reemplazar «24.2c, 24.3 y 24.4: a escribir.» por «24.2c, 24.3 y 24.4: a escribir. 24.5: `docs/superpowers/specs/2026-10-15-etapa-24-5-editar-skills-por-mcp-design.md` · Plan: `docs/superpowers/plans/2026-10-15-etapa-24-5-editar-skills-por-mcp.md`.»
2. Cambiar «Seis entregas» por «Siete entregas».
3. Debajo del ítem 24.4 agregar:

```markdown
- [ ] **24.5 · Crear y editar skills por MCP.** Un editor crea y cambia el borrador de sus skills desde Claude, ChatGPT o cualquier cliente MCP (`skill_create`, `skill_draft_read`, `skill_draft_edit`, `skill_draft_write_file`); publicar sigue solo en la web (decidido el 2026-10-15: el texto de una skill llega a todos los asistentes de la empresa, y un cliente MCP lee contenido ajeno). Sin migración. Pedido por Matías.
```

En `docs/decisiones/README.md`, en la fila de la 24.5, reemplazar la columna del plan `—` por `[plan](../superpowers/plans/2026-10-15-etapa-24-5-editar-skills-por-mcp.md)`.

- [ ] **Paso 4: Verificación completa**

```bash
npm run typecheck
npx vitest run tests/brain tests/docs
npx biome check lib/brain tests/brain docs
git status --short
```
Esperado: typecheck sin errores; todas las pruebas de `tests/brain` y `tests/docs` en verde; biome sin errores en lo tocado. `git status` solo muestra los archivos de esta tarea. Si `tests/docs` se queja de `docs/referencia/`, correr `npm run docs:sync` y sumar lo que cambie al commit (esa carpeta no se edita a mano).

Si `npx eve build` está disponible en el repo (lo usa el despliegue), correrlo también: `lib/brain/core` no debe haber arrastrado `next/*` al canal MCP.

- [ ] **Paso 5: Commit**

```bash
git add docs
git commit -m "docs: guía, dominio brain y roadmap de la etapa 24.5" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Verificación manual al cerrar (fuera del código)

Con la rama desplegada en un preview o en producción, y la categoría `skill` habilitada en `innovas`:

1. Conectar Claude y ChatGPT al brain de `innovas` con una cuenta que edite `skills/` y recorrer el criterio de §1 de la spec.
2. Con una cuenta lectora, comprobar que las cuatro tools no aparecen.
3. Anotar en `docs/producto/roadmap.md` el resultado y marcar la casilla de la 24.5.
