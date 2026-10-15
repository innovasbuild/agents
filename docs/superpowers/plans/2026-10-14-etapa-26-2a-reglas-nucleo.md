# Etapa 26.2a · Instrucciones y reglas del brain (núcleo) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las páginas `00-reglas` (instrucciones del brain en la raíz, reglas de una carpeta) forman una cascada que le llega sola al chat y al MCP, `brain_rules` la entrega para cualquier ruta, y `brain_upsert` por MCP y por las tools del agente no escribe en una ruta con reglas sin un `rulesRevision` vigente.

**Architecture:** Un núcleo puro (`lib/brain/core/rules.ts`) arma la cascada y su revisión desde las `00-reglas` del tenant. Una fuente de reglas (`RulesSource`, `lib/brain/core/rules-source.ts`) las lee del store wiki, se filtra por permisos con `withRulesAccess` y se exige con `requireRules` **en las dos superficies que escriben por un modelo** (servidor MCP y tools del agente), no en el proveedor: así el editor web, el import y los seeds quedan exentos sin una sola bandera. El proveedor wiki aplica los topes de tamaño y crea la `00-reglas` de la raíz con la categoría `brain`; `withAccess` exige administrar la carpeta para escribir una reservada. Sin SQL nuevo.

**Tech Stack:** TypeScript, Vitest, `@modelcontextprotocol/sdk` 1.30.1, eve (tools e instrucciones dinámicas), Supabase (solo lectura nueva por PostgREST), Biome.

**Spec:** `docs/superpowers/specs/2026-10-14-etapa-26-carpetas-y-reglas-brain-design.md` (§2 D6–D10, D14, D15; §4; §6; §7; §8). La 26.3 (§5) no entra: la cascada deja `fields: []` y `template: null` como ganchos.

**Por qué se parte en 26.2a y 26.2b:** la 26.2 completa son dos superficies independientes (núcleo y canales por un lado, pantallas del editor por el otro) y el núcleo solo ya son once tareas. La 26.2a deja cumplido el criterio de cierre 2 de la spec (§1.2), que no depende de ninguna pantalla. La 26.2b se enumera al final.

## Decisiones que la spec dejaba abiertas o que el código obligó a tomar

1. **`rulesRevision` se exige en las superficies, no en el proveedor.** `requireRules(source, write)` corre en el servidor MCP y en `brain_upsert` del agente. Resuelve la compatibilidad (b) y (c): el import (`scripts/brain-import.mts`, autor `import`), los seeds (`lib/outreach/canon-seed.ts`) y el editor web (`savePage`, spec §4.3 "no exige nada a las personas") llaman al proveedor directo y no lo exigen.
2. **Compatibilidad (a):** en una ruta sin cadena de reglas (`revision === ""`) `brain_upsert` escribe con o sin `rulesRevision`, y un valor espurio se ignora. Los clientes MCP existentes solo ven `rules_required` donde una persona ya escribió una `00-reglas` activa.
3. **Compatibilidad (d):** una `00-reglas` no se gobierna a sí misma. Escribirla pide el `rulesRevision` de los niveles de **arriba** (la de la raíz, ninguno); su propia revisión ya la cubre `baseRevision`. Lo calcula `governingFolders`.
4. **Compatibilidad (e):** las páginas ya existentes llamadas `00-reglas` pasan a ser reglas en el deploy, sin migración. Los topes de tamaño se chequean al **escribir**, nunca al leer: una existente más larga que el tope se sigue leyendo y entregando, y su próxima escritura tiene que acortarla. `operacion/agent` y `operacion/brain` no tienen nombre reservado y no cambian. Un reporte en seco (Task 10) lista lo que hay, antes del deploy. Los topes valen también para el import: un `00-reglas` de más falla solo, como cualquier página que el import no puede escribir.
5. **Un rechazo `rules_required` cuenta como lectura en `brain_mcp_usage`** (entrega las reglas, como `brain_rules`) y no se loguea (`run` solo loguea errores no tipados). Sale con `isError: true` porque para el protocolo la escritura no ocurrió y el modelo tiene que reintentar.
6. **Solo cuentan las `00-reglas` con status `activo`.** Archivadas y borradores no entran en la cadena ni en los topes de la cascada.
7. **`rules_too_large` sale como `validation` con `fields: ["body"]` y un mensaje con la ruta y el tope**, igual que la 26.1a entregó `folder_not_found` como `validation` con `fields: ["folder"]`. `invalid_rules` nace en la 26.3 con `parseFieldBlock` (spec §5.1): en la 26.2 no hay nada que pueda volver inválida una `00-reglas`. `rules_required` y `reserved_slug` sí son códigos nuevos, porque traen datos o un camino distinto.
8. **Permisos de la cascada:** `brain_rules` y las reglas de `brain_read` se filtran por la ruta **pedida** (si la persona no la ve, `not_found`), no por la `00-reglas`: una que la persona no puede leer igual le llega si gobierna una ruta que ve (spec §4.2). La tabla de carpetas del arranque muestra solo las que la persona ve, por eso `brainSessionInstructions` recibe el actor además del tenant.

### Desajustes entre la spec y el código

- La spec dice que `validateWrite` chequea el permiso de las reservadas "en todas las superficies". `validateWrite` es puro y no conoce a quien escribe: los permisos viven en `withAccess` (Etapa 17). El chequeo de administrador va ahí (Task 5) y cubre MCP, editor web y tools del agente; los administradores del tenant, el import y la plataforma no pasan por `withAccess` y escriben como hoy.
- `brain_upsert` del agente pide aprobación (`always()`) **antes** de ejecutar: un `rules_required` llega después de que un administrador aprobó, y el reintento pide otra aprobación. Se mitiga en las descripciones y en `agents/asistente/instructions.md` (leer con `brain_rules` o `brain_read` antes de escribir); no se cambia el flujo de aprobación.
- `TOOL_LABELS` tiene la clave `brain` (el nombre del archivo), pero eve nombra las tools por su clave (`brain_search`, `brain_read`, `brain_upsert`), así que hoy el indicador muestra "Trabajando…" para las tres. `brain_rules` entra con su etiqueta (spec §4.3); arreglar las otras tres queda fuera de esta entrega.

## Global Constraints

- Nombres reservados: `RESERVED_LEAVES = ["00-reglas", "00-plantilla"]` en `lib/brain/core/types.ts`. La `00-reglas` de la raíz tiene categoría `brain` (`BRAIN_CATEGORY`).
- Topes en caracteres (`String.length`): raíz 12 000, carpeta 20 000, cascada 40 000.
- `revision` de la cascada: sha-256 de los pares `slug:revision` de la cadena unidos por `\n`, primeros 16 caracteres en hex. Sin cadena, `""`.
- Escribir una reservada exige `administrador` de su carpeta (de la raíz, para la de la raíz). El agente del chat no las escribe nunca (`reserved_slug`).
- Solo el proveedor `wiki` tiene reglas. Un brain `mcp` responde la cascada vacía y no tiene bloque de arranque (D15).
- `lib/brain/core/` no importa fuera de sí mismo: imports relativos con extensión `.ts`, solo `zod`, `yaml`, el SDK de MCP y `node:*` (`tests/brain/boundary.test.ts`).
- Nada de lo que carga `lib/brain/adapters/mcp-production.ts` importa `next/*` (lo carga el canal MCP de eve; ver memoria del repo).
- Antes de escribir código de eve: leer `node_modules/eve/docs/README.md`, `node_modules/eve/docs/guides/dynamic-capabilities.md` (secciones "Dynamic tools", "Author replayable callbacks" y "Dynamic instructions") y `node_modules/eve/docs/instructions.mdx` ("Split instructions across a directory"). Los `execute` de `defineTool` solo cierran sobre datos JSON y llamadas a imports estables; los schemas van inline.
- Antes de tocar SQL (solo el seed de evals de la Task 9): cargar el skill `supabase-postgres-best-practices`. Esta entrega no tiene migraciones.
- UI, mensajes e instrucciones en español rioplatense; código e identificadores en inglés. Nada específico de un tenant en código.
- Tests de lógica como `.test.ts` (sin JSX en esta entrega).
- Comandos: `npm run typecheck` · `npm test` · `npm run lint:fix` (después, `git status` y revertir con `git checkout -- <archivo>` todo archivo que el comando reformateó y la tarea no tocaba) · `npm run docs:sync` · `npm run docs:check`.
- Commits con prefijo (`feat:`, `fix:`, `docs:`, `test:`) y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identidad git `innovasbuild` / `matias@innov.as`.

## Review Focus

1. **Un `rulesRevision` espurio en una ruta sin reglas** (un cliente que lo copió de otra ruta) escribe igual y no le llega al proveedor. Lo fija el test "una ruta sin reglas escribe con un rulesRevision espurio" de la Task 3.
2. **Un miembro que no ve la carpeta intenta crear una página ahí** y recibe `forbidden`, nunca `rules_required` con el cuerpo de las reglas. Lo fija el test "un miembro que no ve la carpeta recibe forbidden, nunca las reglas" de la Task 7.
3. **Se archiva una `00-reglas` mientras otro cliente tiene un `rulesRevision` viejo:** si queda cadena, el reintento recibe `rules_required` con la cascada nueva; si la cadena quedó vacía, escribe. Lo fijan los dos tests "una 00-reglas archivada…" de la Task 3.
4. **`brain_read` de una `00-reglas` y su escritura por MCP:** la cadena no la incluye a ella y escribirla pide solo la revisión de los niveles de arriba. Lo fijan el test "una 00-reglas no se gobierna a sí misma" de la Task 1 y el test "una 00-reglas se lee sin traerse a sí misma y se escribe con la revisión de arriba" de la Task 7.
5. **El agente del chat intenta escribir `comercial/00-plantilla`** (no solo `00-reglas`): `reserved_slug` sin armar el proveedor ni las reglas. Lo fija el test "el agente no escribe una 00-plantilla ni una 00-reglas, sin armar el proveedor" de la Task 8.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/brain/core/types.ts` | Constantes de reservadas y topes; `BrainWrite.rulesRevision` |
| `lib/brain/core/rules.ts` (nuevo) | Puro: reservadas, carpetas que gobiernan, `rulesFor`, revisión, topes |
| `lib/brain/core/folders.ts` | Una carpeta no se puede llamar como una reservada |
| `lib/brain/core/errors.ts` | `BrainRulesRequired`, `BrainReservedSlug`, `agentReservedSlug` |
| `lib/brain/core/wiki-store.ts` | `WikiStore.listRulePages` |
| `lib/brain/core/rules-source.ts` (nuevo) | `RulesSource`, `createWikiRules`, `EMPTY_RULES`, `withRulesAccess`, `requireRules` |
| `lib/brain/core/wiki.ts` | La `00-reglas` de la raíz se crea con categoría `brain`; topes |
| `lib/brain/core/access/with-access.ts` | Reservadas exigen administrador de la carpeta |
| `lib/brain/core/editor/save.ts` | `reserved_slug` se muestra con su mensaje |
| `lib/brain/core/contract.ts` | `brain_rules`, `rulesRevision`, descripciones |
| `lib/brain/core/session.ts` (nuevo) | Puro: bloque de arranque (instrucciones y carpetas) |
| `lib/brain/core/mcp-server/server.ts`, `handler.ts` | `brain_rules`, reglas en `brain_read`, exigencia en `brain_upsert`, `instructions` |
| `lib/brain/adapters/rules.ts` (nuevo) | `getBrainRules(binding)` sobre Supabase |
| `lib/brain/adapters/mcp-production.ts` | Cablea `brainRules` |
| `lib/brain/adapters/acting-provider.ts` | `resolveActingBrain`, `resolveActingRules` |
| `lib/brain/adapters/tools.ts` | `brain_rules`, reglas en `brain_read`, exigencia y reservadas en `brain_upsert` |
| `lib/agents/running-tool.ts` | Etiqueta de `brain_rules` |
| `agents/asistente/instructions.md`, `agents/outreach/instructions.md` | Reintento ante `rules_required` |
| `lib/brain/adapters/session-instructions.ts` (nuevo) | `brainSessionInstructions(tenantId, actor)` |
| `lib/agents/eve/brain-instructions.ts` (nuevo), `agents/asistente/instructions/brain.ts` (nuevo), `agents/outreach/instructions/brain.ts` (nuevo) | Instrucciones dinámicas del brain en `session.started` |
| `supabase/seed-evals.sql`, `agents/asistente/evals/instrucciones-brain.eval.ts` (nuevo) | Eval del criterio 2 en el chat |
| `lib/brain/core/rules-report.ts` (nuevo), `scripts/brain-rules-report.mts` (nuevo), `package.json` | Reporte en seco previo al deploy |
| `docs/dominios/brain.md`, `lib/brain/README.md`, `docs/producto/roadmap.md` | Documentación |

---

### Task 1: Páginas reservadas y cascada pura

**Files:**
- Modify: `lib/brain/core/types.ts` (después de `MAX_BODY_BYTES`)
- Create: `lib/brain/core/rules.ts`
- Modify: `lib/brain/core/folders.ts` (`validateFolderPath`)
- Test: `tests/brain/rules.test.ts` (nuevo), `tests/brain/folders.test.ts`

**Interfaces:**
- Consumes: `ancestorChain(path: string): string[]` y `parentPath(path: string): string | null` de `lib/brain/core/access/resolve-access.ts` (`parentPath("a") === ""`, `parentPath("") === null`); `ROOT_PATH = ""` de `lib/brain/core/access/types.ts`; `BrainValidation` de `lib/brain/core/errors.ts`.
- Produces:
  - En `types.ts`: `RULES_LEAF = "00-reglas"`, `TEMPLATE_LEAF = "00-plantilla"`, `RESERVED_LEAVES = [RULES_LEAF, TEMPLATE_LEAF] as const`, `BRAIN_CATEGORY = "brain"`, `MAX_ROOT_RULES_CHARS = 12_000`, `MAX_FOLDER_RULES_CHARS = 20_000`, `MAX_CASCADE_CHARS = 40_000`.
  - En `rules.ts`: `interface RuleEntry { path: string; slug: string; revision: number; body: string }`, `interface FieldSpec { key: string; type: "texto" | "fecha" | "numero" | "ruta" | "opciones"; options?: string[] }`, `interface RulesCascade { revision: string; chain: RuleEntry[]; fields: FieldSpec[]; template: { slug: string; body: string; frontmatter: Record<string, unknown> } | null }`, `interface RulePage { slug: string; status: BrainStatus; revision: number; body: string }`, `leafOf(slug: string): string`, `isReservedSlug(slug: string): boolean`, `isRulesSlug(slug: string): boolean`, `rulesSlugFor(folder: string): string`, `folderOfPage(slug: string): string`, `governingFolders(slug: string): string[]`, `cascadeRevision(chain: readonly RuleEntry[]): string`, `rulesFor(slug: string, pages: readonly RulePage[]): RulesCascade`, `withoutRoot(cascade: RulesCascade): { revision: string; chain: RuleEntry[] }`, `checkRulesWrite(write: { slug: string; status: BrainStatus; body: string }, pages: readonly RulePage[]): void` (tira `BrainValidation(["body"], mensaje)`).

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/rules.test.ts
import { describe, expect, it } from "vitest";
import { BrainValidation } from "@/lib/brain/core/errors";
import {
	checkRulesWrite,
	folderOfPage,
	governingFolders,
	isReservedSlug,
	isRulesSlug,
	type RulePage,
	rulesFor,
	rulesSlugFor,
	withoutRoot,
} from "@/lib/brain/core/rules";

const rule = (
	slug: string,
	revision = 1,
	body = `reglas de ${slug}`,
	status: RulePage["status"] = "activo",
): RulePage => ({ slug, status, revision, body });

describe("reservadas", () => {
	it("00-reglas y 00-plantilla son reservadas en cualquier nivel", () => {
		expect(isReservedSlug("00-reglas")).toBe(true);
		expect(isReservedSlug("talento/personal/00-reglas")).toBe(true);
		expect(isReservedSlug("comercial/00-plantilla")).toBe(true);
		expect(isReservedSlug("talento/00-reglas-viejas")).toBe(false);
		expect(isReservedSlug("00-reglas/x")).toBe(false);
		expect(isRulesSlug("comercial/00-plantilla")).toBe(false);
	});

	it("la página de reglas de una carpeta y de la raíz", () => {
		expect(rulesSlugFor("")).toBe("00-reglas");
		expect(rulesSlugFor("talento/personal")).toBe("talento/personal/00-reglas");
		expect(folderOfPage("00-reglas")).toBe("");
		expect(folderOfPage("talento/personal/leo")).toBe("talento/personal");
	});

	it("una 00-reglas no se gobierna a sí misma", () => {
		expect(governingFolders("talento/personal/leo")).toEqual([
			"",
			"talento",
			"talento/personal",
		]);
		expect(governingFolders("talento/personal/00-reglas")).toEqual([
			"",
			"talento",
		]);
		expect(governingFolders("00-reglas")).toEqual([]);
		const pages = [rule("00-reglas"), rule("talento/personal/00-reglas")];
		expect(rulesFor("talento/personal/00-reglas", pages).chain.map((e) => e.path)).toEqual([""]);
		expect(rulesFor("00-reglas", pages)).toMatchObject({ revision: "", chain: [] });
	});
});

describe("rulesFor", () => {
	const pages = [
		rule("00-reglas", 2, "raíz"),
		rule("talento/personal/00-reglas", 5, "personal"),
		rule("comercial/00-reglas", 1, "comercial"),
	];

	it("arma la cadena de la raíz a la carpeta y saltea los niveles sin reglas", () => {
		const cascade = rulesFor("talento/personal/leo", pages);
		expect(cascade.chain).toEqual([
			{ path: "", slug: "00-reglas", revision: 2, body: "raíz" },
			{ path: "talento/personal", slug: "talento/personal/00-reglas", revision: 5, body: "personal" },
		]);
		expect(cascade.revision).toMatch(/^[0-9a-f]{16}$/);
		expect(cascade.fields).toEqual([]);
		expect(cascade.template).toBeNull();
	});

	it("sirve para una ruta que todavía no existe y para la raíz", () => {
		expect(rulesFor("talento/personal/nueva/x", pages).chain.map((e) => e.path)).toEqual([
			"",
			"talento/personal",
		]);
		expect(rulesFor("", pages).chain.map((e) => e.path)).toEqual([""]);
	});

	it("una página homónima de una carpeta la gobierna su carpeta padre", () => {
		expect(rulesFor("talento/personal", pages).chain.map((e) => e.path)).toEqual([""]);
	});

	it("archivadas y borradores no cuentan", () => {
		const cascade = rulesFor("talento/personal/leo", [
			rule("00-reglas", 2, "raíz", "archivado"),
			rule("talento/personal/00-reglas", 5, "personal", "borrador"),
		]);
		expect(cascade).toEqual({ revision: "", chain: [], fields: [], template: null });
	});

	it("sin reglas en la raíz la cadena es solo la de la carpeta", () => {
		const cascade = rulesFor("talento/personal/leo", [rule("talento/personal/00-reglas")]);
		expect(cascade.chain.map((e) => e.path)).toEqual(["talento/personal"]);
		expect(cascade.revision).not.toBe("");
	});

	it("la revisión es estable, no depende del orden y cambia si cambia una revisión", () => {
		const a = rulesFor("talento/personal/leo", pages).revision;
		const b = rulesFor("talento/personal/leo", [...pages].reverse()).revision;
		expect(a).toBe(b);
		const bumped = pages.map((p) => (p.slug === "00-reglas" ? { ...p, revision: 3 } : p));
		expect(rulesFor("talento/personal/leo", bumped).revision).not.toBe(a);
	});

	it("withoutRoot saca la raíz de la cadena y conserva la revisión completa", () => {
		const cascade = rulesFor("talento/personal/leo", pages);
		expect(withoutRoot(cascade)).toEqual({
			revision: cascade.revision,
			chain: [cascade.chain[1]],
		});
	});
});

describe("checkRulesWrite", () => {
	const write = (slug: string, length: number, status: RulePage["status"] = "activo") => ({
		slug,
		status,
		body: "x".repeat(length),
	});

	it("las instrucciones de la raíz llegan hasta 12 000 caracteres", () => {
		expect(() => checkRulesWrite(write("00-reglas", 12_000), [])).not.toThrow();
		expect(() => checkRulesWrite(write("00-reglas", 12_001), [])).toThrow(
			/instrucciones del brain pueden tener hasta 12000/,
		);
	});

	it("las reglas de una carpeta llegan hasta 20 000 caracteres", () => {
		expect(() => checkRulesWrite(write("talento/00-reglas", 20_000), [])).not.toThrow();
		const error = (() => {
			try {
				checkRulesWrite(write("talento/00-reglas", 20_001), []);
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(BrainValidation);
		expect((error as BrainValidation).fields).toEqual(["body"]);
		expect((error as BrainValidation).message).toContain("talento");
	});

	it("rechaza una cascada de más de 40 000 caracteres y nombra la carpeta", () => {
		const pages = [rule("00-reglas", 1, "x".repeat(12_000)), rule("talento/00-reglas", 1, "x".repeat(20_000))];
		expect(() => checkRulesWrite(write("talento/personal/00-reglas", 8_000), pages)).not.toThrow();
		expect(() => checkRulesWrite(write("talento/personal/00-reglas", 8_001), pages)).toThrow(
			/talento\/personal suman 40001/,
		);
	});

	it("también la rechaza si la que crece está arriba", () => {
		const pages = [rule("talento/00-reglas", 1, "x".repeat(20_000)), rule("talento/personal/00-reglas", 1, "x".repeat(8_001))];
		expect(() => checkRulesWrite(write("00-reglas", 12_000), pages)).toThrow(/talento\/personal/);
	});

	it("no mira páginas que no son 00-reglas, ni una archivada", () => {
		expect(() => checkRulesWrite(write("talento/leo", 99_999), [])).not.toThrow();
		expect(() => checkRulesWrite(write("talento/00-plantilla", 99_999), [])).not.toThrow();
		expect(() => checkRulesWrite(write("00-reglas", 99_999, "archivado"), [])).not.toThrow();
		const archived = [rule("talento/00-reglas", 1, "x".repeat(39_000), "archivado")];
		expect(() => checkRulesWrite(write("00-reglas", 12_000), archived)).not.toThrow();
	});
});
```

Y al final de `tests/brain/folders.test.ts`:

```ts
describe("validateFolderPath y las páginas reservadas", () => {
	it("una carpeta no se puede llamar como una página reservada", () => {
		expect(validateFolderPath("comercial/00-reglas").ok).toBe(false);
		expect(validateFolderPath("comercial/00-plantilla").ok).toBe(false);
		expect(validateFolderPath("comercial/00-reglas-viejas")).toEqual({ ok: true });
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/rules.test.ts tests/brain/folders.test.ts`
Expected: FAIL, no se puede resolver `@/lib/brain/core/rules` y `validateFolderPath("comercial/00-reglas")` devuelve `ok: true`.

- [ ] **Step 3: Implementar**

En `lib/brain/core/types.ts`, debajo de `export const MAX_BODY_BYTES = 204800;`:

```ts
// Páginas con nombre reservado (spec etapa 26 §4.1). 00-reglas en la raíz son
// las instrucciones del brain; en una carpeta, sus reglas. 00-plantilla es la
// plantilla de una carpeta (26.3).
export const RULES_LEAF = "00-reglas";
export const TEMPLATE_LEAF = "00-plantilla";
export const RESERVED_LEAVES = [RULES_LEAF, TEMPLATE_LEAF] as const;
// Categoría de las instrucciones del brain: la carpeta brain está reservada.
export const BRAIN_CATEGORY = "brain";
// En caracteres. La de la raíz entra en cada sesión.
export const MAX_ROOT_RULES_CHARS = 12_000;
export const MAX_FOLDER_RULES_CHARS = 20_000;
export const MAX_CASCADE_CHARS = 40_000;
```

```ts
// lib/brain/core/rules.ts
// Instrucciones y reglas del brain (spec etapa 26 §4.1, §4.2). Puro: lo usan el
// proveedor wiki, el MCP, las tools del agente y un script con Node directo.
import { createHash } from "node:crypto";
import { ancestorChain, parentPath } from "./access/resolve-access.ts";
import { ROOT_PATH } from "./access/types.ts";
import { BrainValidation } from "./errors.ts";
import {
	type BrainStatus,
	MAX_CASCADE_CHARS,
	MAX_FOLDER_RULES_CHARS,
	MAX_ROOT_RULES_CHARS,
	RESERVED_LEAVES,
	RULES_LEAF,
} from "./types.ts";

export interface RuleEntry {
	/** Carpeta que gobierna; "" es la raíz. */
	path: string;
	slug: string;
	revision: number;
	body: string;
}

// Campos obligatorios y plantilla: los llena la 26.3. En la 26.2 van vacíos.
export interface FieldSpec {
	key: string;
	type: "texto" | "fecha" | "numero" | "ruta" | "opciones";
	options?: string[];
}

export interface RulesCascade {
	revision: string;
	chain: RuleEntry[];
	fields: FieldSpec[];
	template: {
		slug: string;
		body: string;
		frontmatter: Record<string, unknown>;
	} | null;
}

/** Lo mínimo de una 00-reglas para armar la cascada. */
export interface RulePage {
	slug: string;
	status: BrainStatus;
	revision: number;
	body: string;
}

export function leafOf(slug: string): string {
	return slug.slice(slug.lastIndexOf("/") + 1);
}

export function isReservedSlug(slug: string): boolean {
	return (RESERVED_LEAVES as readonly string[]).includes(leafOf(slug));
}

export function isRulesSlug(slug: string): boolean {
	return leafOf(slug) === RULES_LEAF;
}

export function rulesSlugFor(folder: string): string {
	return folder === ROOT_PATH ? RULES_LEAF : `${folder}/${RULES_LEAF}`;
}

/** Carpeta en la que vive una página; "" para una de la raíz. */
export function folderOfPage(slug: string): string {
	return parentPath(slug) ?? ROOT_PATH;
}

// Raíz primero. Una 00-reglas no se gobierna a sí misma: su propia revisión ya
// la cubre baseRevision, y quien la escribe tiene que conocer las de arriba.
export function governingFolders(slug: string): string[] {
	const chain = ancestorChain(folderOfPage(slug));
	return isRulesSlug(slug) ? chain.slice(0, -1) : chain;
}

export function cascadeRevision(chain: readonly RuleEntry[]): string {
	if (chain.length === 0) return "";
	return createHash("sha256")
		.update(chain.map((entry) => `${entry.slug}:${entry.revision}`).join("\n"))
		.digest("hex")
		.slice(0, 16);
}

function activeRules(pages: readonly RulePage[]): Map<string, RulePage> {
	return new Map(
		pages
			.filter((page) => page.status === "activo" && isRulesSlug(page.slug))
			.map((page) => [page.slug, page]),
	);
}

export function rulesFor(
	slug: string,
	pages: readonly RulePage[],
): RulesCascade {
	const active = activeRules(pages);
	const chain: RuleEntry[] = [];
	for (const folder of governingFolders(slug)) {
		const page = active.get(rulesSlugFor(folder));
		if (page)
			chain.push({
				path: folder,
				slug: page.slug,
				revision: page.revision,
				body: page.body,
			});
	}
	return { revision: cascadeRevision(chain), chain, fields: [], template: null };
}

// brain_read no repite la raíz: llegó al arrancar la sesión. La revisión es la
// de la cascada completa, la que pide brain_upsert.
export function withoutRoot(cascade: RulesCascade): {
	revision: string;
	chain: RuleEntry[];
} {
	return {
		revision: cascade.revision,
		chain: cascade.chain.filter((entry) => entry.path !== ROOT_PATH),
	};
}

function within(path: string, folder: string): boolean {
	return folder === ROOT_PATH || path === folder || path.startsWith(`${folder}/`);
}

// Topes de una 00-reglas activa (spec etapa 26 §4.1): la propia y cada cascada
// que la incluye, con la página ya cambiada.
export function checkRulesWrite(
	write: { slug: string; status: BrainStatus; body: string },
	pages: readonly RulePage[],
): void {
	if (!isRulesSlug(write.slug) || write.status !== "activo") return;
	const folder = folderOfPage(write.slug);
	const limit =
		folder === ROOT_PATH ? MAX_ROOT_RULES_CHARS : MAX_FOLDER_RULES_CHARS;
	if (write.body.length > limit) {
		throw new BrainValidation(
			["body"],
			folder === ROOT_PATH
				? `Las instrucciones del brain pueden tener hasta ${limit} caracteres y estas tienen ${write.body.length}. Entran en cada sesión: dejá lo esencial.`
				: `Las reglas de ${folder} pueden tener hasta ${limit} caracteres y estas tienen ${write.body.length}.`,
		);
	}
	const sizes = new Map(
		[...activeRules(pages)].map(([slug, page]) => [slug, page.body.length]),
	);
	sizes.set(write.slug, write.body.length);
	for (const slug of sizes.keys()) {
		const ruleFolder = folderOfPage(slug);
		if (!within(ruleFolder, folder)) continue;
		const total = ancestorChain(ruleFolder).reduce(
			(sum, node) => sum + (sizes.get(rulesSlugFor(node)) ?? 0),
			0,
		);
		if (total > MAX_CASCADE_CHARS) {
			throw new BrainValidation(
				["body"],
				`Con este cambio, las reglas que aplican en ${ruleFolder === ROOT_PATH ? "la raíz" : ruleFolder} suman ${total} caracteres y el máximo es ${MAX_CASCADE_CHARS}. Acortá esta página o alguna de las carpetas de arriba.`,
			);
		}
	}
}
```

En `lib/brain/core/folders.ts`, cambiar el import de `./types.ts` por:

```ts
import { MAX_SLUG_LENGTH, RESERVED_LEAVES, SLUG_PATTERN } from "./types.ts";
```

y en `validateFolderPath`, justo antes del `return { ok: true };` final:

```ts
	// Una carpeta x/00-reglas confundiría las reglas de x con una carpeta (26.2).
	const last = path.slice(path.lastIndexOf("/") + 1);
	if ((RESERVED_LEAVES as readonly string[]).includes(last))
		return {
			ok: false,
			message: `«${last}» es un nombre reservado del brain: lo usan las reglas y la plantilla de cada carpeta.`,
		};
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run tests/brain/rules.test.ts tests/brain/folders.test.ts tests/brain/boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/types.ts lib/brain/core/rules.ts lib/brain/core/folders.ts tests/brain/rules.test.ts tests/brain/folders.test.ts
git commit -m "feat: páginas reservadas y cascada de reglas del brain (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Errores de reglas

**Files:**
- Modify: `lib/brain/core/errors.ts`
- Test: `tests/brain/errors.test.ts`

**Interfaces:**
- Consumes: `type RulesCascade` de `lib/brain/core/rules.ts` (Task 1), solo como tipo.
- Produces:
  - `BrainErrorCode` suma `"rules_required" | "reserved_slug"`.
  - `class BrainRulesRequired extends BrainError { readonly rules: RulesCascade; constructor(slug: string, rules: RulesCascade, stale: boolean) }`, code `rules_required`.
  - `class BrainReservedSlug extends BrainError { constructor(message: string) }`, code `reserved_slug`.
  - `agentReservedSlug(slug: string): BrainReservedSlug` (mensaje para el agente del chat, spec D10).
  - `BrainToolError.rules?: RulesCascade`; `toToolError` la llena para `BrainRulesRequired`.

- [ ] **Step 1: Escribir el test que falla**

Sumar al import de `tests/brain/errors.test.ts` `agentReservedSlug`, `BrainReservedSlug` y `BrainRulesRequired`, y dentro de `describe("toToolError", ...)`:

```ts
	it("traduce rules_required con la cascada completa para reintentar", () => {
		const rules = {
			revision: "0123456789abcdef",
			chain: [{ path: "", slug: "00-reglas", revision: 2, body: "raíz" }],
			fields: [],
			template: null,
		};
		const fresh = toToolError(new BrainRulesRequired("talento/leo", rules, false));
		expect(fresh).toEqual({
			ok: false,
			error: "rules_required",
			message: expect.stringContaining('rulesRevision "0123456789abcdef"'),
			rules,
		});
		expect(fresh.message).toContain("talento/leo tiene reglas");
		expect(
			toToolError(new BrainRulesRequired("talento/leo", rules, true)).message,
		).toContain("cambiaron desde que las leíste");
	});

	it("traduce reserved_slug con su mensaje", () => {
		expect(toToolError(new BrainReservedSlug("pedíselo a quien administra"))).toEqual({
			ok: false,
			error: "reserved_slug",
			message: "pedíselo a quien administra",
		});
		expect(agentReservedSlug("comercial/00-plantilla").message).toMatch(
			/comercial\/00-plantilla.*proponé el cambio en la conversación/,
		);
	});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/errors.test.ts`
Expected: FAIL, `BrainRulesRequired` no existe.

- [ ] **Step 3: Implementar**

En `lib/brain/core/errors.ts`, debajo del comentario de cabecera:

```ts
import type { RulesCascade } from "./rules.ts";
```

En `BrainErrorCode`, sumar al final:

```ts
	| "rules_required"
	| "reserved_slug";
```

Debajo de `BrainRateLimited`:

```ts
// Escritura en una ruta con reglas sin rulesRevision o con uno viejo (spec
// etapa 26 D9). Trae la cascada completa: quien reintenta no necesita otra lectura.
export class BrainRulesRequired extends BrainError {
	readonly rules: RulesCascade;

	constructor(slug: string, rules: RulesCascade, stale: boolean) {
		super(
			"rules_required",
			`${stale ? `Las reglas que aplican a ${slug} cambiaron desde que las leíste.` : `${slug} tiene reglas que tenés que leer antes de escribir.`} Vienen en rules: leelas, ajustá la página si hace falta y reintentá brain_upsert con rulesRevision "${rules.revision}".`,
		);
		this.rules = rules;
	}
}

// 00-reglas y 00-plantilla las escribe quien administra su carpeta (spec etapa
// 26 D10, §4.1).
export class BrainReservedSlug extends BrainError {
	constructor(message: string) {
		super("reserved_slug", message);
	}
}

export function agentReservedSlug(slug: string): BrainReservedSlug {
	return new BrainReservedSlug(
		`${slug} es una página reservada: las instrucciones y reglas del brain (00-reglas) y las plantillas (00-plantilla) las escribe una persona que administra esa carpeta. No la escribas vos: proponé el cambio en la conversación, con el texto completo.`,
	);
}
```

En `BrainToolError`, sumar `rules?: RulesCascade;`. En `toToolError`, antes de `return base;`:

```ts
	if (error instanceof BrainRulesRequired)
		return { ...base, rules: error.rules };
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run tests/brain/errors.test.ts tests/brain/rules.test.ts tests/brain/boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/errors.ts tests/brain/errors.test.ts
git commit -m "feat: errores rules_required y reserved_slug del brain (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Fuente de reglas y exigencia de `rulesRevision`

**Files:**
- Modify: `lib/brain/core/types.ts` (`BrainWrite`)
- Modify: `lib/brain/core/wiki-store.ts` (interfaz `WikiStore` y `createSupabaseWikiStore`)
- Create: `lib/brain/core/rules-source.ts`
- Modify: `tests/brain/wiki.test.ts` (fake `fakeStore`), `tests/brain/wiki-folders.test.ts` (fake `store`)
- Test: `tests/brain/wiki-store-rules.test.ts` (nuevo), `tests/brain/rules-source.test.ts` (nuevo)

**Interfaces:**
- Consumes: `rulesFor`, `isRulesSlug`, `type RulePage`, `type RuleEntry`, `type RulesCascade` (Task 1); `BrainRulesRequired` (Task 2); `BrainNotFound`, `BrainForbidden`, `BrainValidation`; `type Level`, `ROOT_PATH` de `access/types.ts`; `type BrainFolder` de `folders.ts`.
- Produces:
  - `BrainWrite.rulesRevision?: string`.
  - `WikiStore.listRulePages(tenantId: string): Promise<RulePage[]>` (todas las `00-reglas` del tenant, cualquier status, paginado de a 1000).
  - En `rules-source.ts`: `interface BrainSessionContext { root: RuleEntry | null; folders: BrainFolder[] }` (`folders`: solo las de primer nivel, sin `skills`), `interface RulesSource { cascade(slug: string): Promise<RulesCascade>; session(): Promise<BrainSessionContext> }`, `emptyCascade(): RulesCascade`, `EMPTY_RULES: RulesSource`, `createWikiRules(options: { tenantId: string; store: Pick<WikiStore, "listRulePages" | "listFolders"> }): RulesSource`, `withRulesAccess(source: RulesSource, levelOf: (path: string) => Level | null): RulesSource`, `requireRules(source: RulesSource, write: BrainWrite): Promise<BrainWrite>` (devuelve la escritura **sin** `rulesRevision`).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/brain/wiki-store-rules.test.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseWikiStore, WikiStoreError } from "@/lib/brain/core/wiki-store";

type State = {
	table: string;
	eq: Record<string, unknown>;
	like?: [string, string];
	range?: [number, number];
};

// select → eq → like → order → range: range es la última y devuelve la promesa.
function fakeClient(
	batches: Array<Array<Record<string, unknown>>>,
	error: { code: string; message: string; details: string } | null = null,
) {
	const calls: State[] = [];
	let call = 0;
	const client = {
		from(table: string) {
			const state: State = { table, eq: {} };
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					state.eq[column] = value;
					return chain;
				},
				like: (column: string, pattern: string) => {
					state.like = [column, pattern];
					return chain;
				},
				order: () => chain,
				range: async (from: number, to: number) => {
					state.range = [from, to];
					calls.push(state);
					return { data: error ? null : (batches[call++] ?? []), error };
				},
			};
			return chain;
		},
	};
	return { client: client as unknown as SupabaseClient, calls };
}

const row = (slug: string) => ({ slug, status: "activo", revision: 3, body: `b ${slug}` });

describe("listRulePages", () => {
	it("lee solo las 00-reglas del tenant", async () => {
		const { client, calls } = fakeClient([
			[row("00-reglas"), row("talento/personal/00-reglas"), row("comercial/x00-reglas")],
		]);
		const pages = await createSupabaseWikiStore(client).listRulePages("t1");
		expect(pages).toEqual([
			{ slug: "00-reglas", status: "activo", revision: 3, body: "b 00-reglas" },
			{
				slug: "talento/personal/00-reglas",
				status: "activo",
				revision: 3,
				body: "b talento/personal/00-reglas",
			},
		]);
		expect(calls[0]).toMatchObject({
			table: "brain_pages",
			eq: { tenant_id: "t1" },
			like: ["slug", "%00-reglas"],
			range: [0, 999],
		});
	});

	it("pagina de a 1000 hasta que una tanda viene corta", async () => {
		const full = Array.from({ length: 1000 }, (_, i) => row(`c${i}/00-reglas`));
		const { client, calls } = fakeClient([full, [row("z/00-reglas")]]);
		const pages = await createSupabaseWikiStore(client).listRulePages("t1");
		expect(pages).toHaveLength(1001);
		expect(calls.map((c) => c.range)).toEqual([
			[0, 999],
			[1000, 1999],
		]);
	});

	it("un error de la base sale como WikiStoreError", async () => {
		const { client } = fakeClient([], { code: "42P01", message: "boom", details: "" });
		await expect(createSupabaseWikiStore(client).listRulePages("t1")).rejects.toBeInstanceOf(
			WikiStoreError,
		);
	});
});
```

```ts
// tests/brain/rules-source.test.ts
import { describe, expect, it } from "vitest";
import { BrainForbidden, BrainNotFound, BrainRulesRequired } from "@/lib/brain/core/errors";
import type { RulePage } from "@/lib/brain/core/rules";
import {
	createWikiRules,
	EMPTY_RULES,
	requireRules,
	withRulesAccess,
} from "@/lib/brain/core/rules-source";
import type { BrainWrite } from "@/lib/brain/core/types";

const rule = (slug: string, revision = 1, status: RulePage["status"] = "activo"): RulePage => ({
	slug,
	status,
	revision,
	body: `reglas de ${slug}`,
});

function source(pages: RulePage[]) {
	return createWikiRules({
		tenantId: "t1",
		store: {
			listRulePages: async (tenantId) => (tenantId === "t1" ? pages : []),
			listFolders: async () => [
				{ path: "talento", description: "Personas" },
				{ path: "talento/personal", description: "" },
				{ path: "direccion", description: "Presupuesto" },
				{ path: "skills", description: "" },
			],
		},
	});
}

const write = (slug: string, extra: Partial<BrainWrite> = {}): BrainWrite => ({
	slug,
	title: "T",
	category: "talento",
	status: "activo",
	tags: [],
	body: "b",
	reason: "alta",
	...extra,
});

describe("createWikiRules", () => {
	it("arma la cascada de una ruta con las 00-reglas del tenant", async () => {
		const cascade = await source([rule("00-reglas"), rule("talento/personal/00-reglas")]).cascade(
			"talento/personal/leo",
		);
		expect(cascade.chain.map((e) => e.path)).toEqual(["", "talento/personal"]);
	});

	it("rechaza una ruta inválida y acepta la raíz", async () => {
		await expect(source([]).cascade("Talento/x")).rejects.toMatchObject({ fields: ["path"] });
		expect((await source([rule("00-reglas")]).cascade("")).chain).toHaveLength(1);
	});

	it("el arranque trae la raíz activa y las carpetas de primer nivel sin skills", async () => {
		const context = await source([rule("00-reglas", 4)]).session();
		expect(context.root).toEqual({ path: "", slug: "00-reglas", revision: 4, body: "reglas de 00-reglas" });
		expect(context.folders.map((f) => f.path)).toEqual(["talento", "direccion"]);
		expect((await source([rule("00-reglas", 4, "archivado")]).session()).root).toBeNull();
	});

	it("EMPTY_RULES no tiene reglas ni arranque", async () => {
		expect(await EMPTY_RULES.cascade("x/y")).toEqual({ revision: "", chain: [], fields: [], template: null });
		expect(await EMPTY_RULES.session()).toEqual({ root: null, folders: [] });
	});
});

describe("withRulesAccess", () => {
	const levelOf = (path: string) =>
		path === "direccion" || path.startsWith("direccion/") ? null : ("lector" as const);

	it("una ruta que la persona no ve responde not_found", async () => {
		const guarded = withRulesAccess(source([rule("direccion/00-reglas")]), levelOf);
		await expect(guarded.cascade("direccion/x")).rejects.toBeInstanceOf(BrainNotFound);
	});

	it("una 00-reglas que gobierna una ruta visible llega aunque la persona no la pueda leer", async () => {
		const onlyFolder = (path: string) => (path === "talento/personal/00-reglas" ? null : ("lector" as const));
		const guarded = withRulesAccess(source([rule("talento/personal/00-reglas")]), onlyFolder);
		expect((await guarded.cascade("talento/personal/leo")).chain).toHaveLength(1);
	});

	it("el arranque solo nombra las carpetas que la persona ve", async () => {
		const guarded = withRulesAccess(source([rule("00-reglas")]), levelOf);
		const context = await guarded.session();
		expect(context.root).not.toBeNull();
		expect(context.folders.map((f) => f.path)).toEqual(["talento"]);
	});
});

describe("requireRules", () => {
	const rules = source([rule("00-reglas", 2), rule("talento/personal/00-reglas", 5)]);

	it("una ruta sin reglas escribe con un rulesRevision espurio", async () => {
		const out = await requireRules(source([]), write("talento/leo", { rulesRevision: "ffffffffffffffff" }));
		expect(out).not.toHaveProperty("rulesRevision");
		expect(out.slug).toBe("talento/leo");
	});

	it("sin rulesRevision devuelve la cascada completa, raíz incluida", async () => {
		const error = await requireRules(rules, write("talento/personal/leo")).catch((e) => e);
		expect(error).toBeInstanceOf(BrainRulesRequired);
		expect((error as BrainRulesRequired).rules.chain.map((e) => e.path)).toEqual(["", "talento/personal"]);
		expect((error as BrainRulesRequired).message).toContain("tiene reglas");
	});

	it("con la revisión vigente escribe, sin pasar rulesRevision", async () => {
		const current = (await rules.cascade("talento/personal/leo")).revision;
		const out = await requireRules(rules, write("talento/personal/leo", { rulesRevision: current }));
		expect(out).not.toHaveProperty("rulesRevision");
	});

	it("solo la raíz con reglas también exige", async () => {
		const error = await requireRules(source([rule("00-reglas")]), write("talento/leo")).catch((e) => e);
		expect(error).toBeInstanceOf(BrainRulesRequired);
	});

	it("una 00-reglas archivada cambia la revisión: el valor viejo pide releer", async () => {
		const before = (await rules.cascade("talento/personal/leo")).revision;
		const after = source([rule("00-reglas", 2), rule("talento/personal/00-reglas", 5, "archivado")]);
		const error = await requireRules(after, write("talento/personal/leo", { rulesRevision: before })).catch(
			(e) => e,
		);
		expect(error).toBeInstanceOf(BrainRulesRequired);
		expect((error as BrainRulesRequired).message).toContain("cambiaron");
		expect((error as BrainRulesRequired).rules.chain.map((e) => e.path)).toEqual([""]);
	});

	it("una 00-reglas archivada que deja la cadena vacía deja escribir con el valor viejo", async () => {
		const before = (await source([rule("talento/00-reglas")]).cascade("talento/leo")).revision;
		const after = source([rule("talento/00-reglas", 1, "archivado")]);
		await expect(requireRules(after, write("talento/leo", { rulesRevision: before }))).resolves.toMatchObject({
			slug: "talento/leo",
		});
	});

	it("una ruta oculta se rechaza como withAccess: forbidden al crear, not_found al actualizar", async () => {
		const hidden = withRulesAccess(rules, () => null);
		await expect(requireRules(hidden, write("talento/personal/leo"))).rejects.toBeInstanceOf(BrainForbidden);
		await expect(requireRules(hidden, write("talento/personal/leo", { baseRevision: 2 }))).rejects.toBeInstanceOf(
			BrainNotFound,
		);
	});
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run tests/brain/wiki-store-rules.test.ts tests/brain/rules-source.test.ts`
Expected: FAIL, `listRulePages` no existe y no se puede resolver `@/lib/brain/core/rules-source`.

- [ ] **Step 3: Implementar**

En `lib/brain/core/types.ts`, en `BrainWrite`, debajo de `baseRevision?: number;`:

```ts
	/**
	 * Revisión de la cascada de reglas que leyó quien escribe (spec etapa 26
	 * D9). La exigen el MCP y las tools del agente con requireRules; el
	 * proveedor no la mira.
	 */
	rulesRevision?: string;
```

En `lib/brain/core/wiki-store.ts`, sumar los imports:

```ts
import { isRulesSlug, type RulePage } from "./rules.ts";
import { RULES_LEAF } from "./types.ts";
```

(`RULES_LEAF` va en el mismo `import` de `./types.ts` que ya existe, no en uno nuevo.) En la interfaz `WikiStore`, debajo de `listFolders`:

```ts
	/** Las 00-reglas del tenant, de cualquier status (spec etapa 26 §4.2). */
	listRulePages(tenantId: string): Promise<RulePage[]>;
```

Y en `createSupabaseWikiStore`, debajo de `listFolders`:

```ts
		async listRulePages(tenantId) {
			// PostgREST corta en 1000 filas: se pagina aunque un brain tenga pocas.
			// El like trae también x/a00-reglas; el filtro de abajo deja solo las hojas.
			const pages: RulePage[] = [];
			for (let from = 0; ; from += 1000) {
				const { data, error } = await client
					.from("brain_pages")
					.select("slug, status, revision, body")
					.eq("tenant_id", tenantId)
					.like("slug", `%${RULES_LEAF}`)
					.order("slug")
					.range(from, from + 999);
				if (error) throw storeError(error);
				const rows = (data ?? []) as Array<Record<string, unknown>>;
				for (const row of rows) {
					if (!isRulesSlug(String(row.slug))) continue;
					pages.push({
						slug: String(row.slug),
						status: row.status as BrainStatus,
						revision: row.revision as number,
						body: String(row.body),
					});
				}
				if (rows.length < 1000) return pages;
			}
		},
```

En `tests/brain/wiki.test.ts` (`fakeStore`) y `tests/brain/wiki-folders.test.ts` (`store`), debajo de `listFolders: ...`, sumar:

```ts
		listRulePages: async () => [],
```

```ts
// lib/brain/core/rules-source.ts
// De dónde salen las reglas de un brain y cómo se exigen (spec etapa 26 §4.2,
// §4.3). requireRules corre en las superficies que escriben por un modelo (MCP
// y tools del agente): el editor web, el import y los seeds no la llaman.
import { type Level, ROOT_PATH } from "./access/types.ts";
import {
	BrainForbidden,
	BrainNotFound,
	BrainRulesRequired,
	BrainValidation,
} from "./errors.ts";
import type { BrainFolder } from "./folders.ts";
import { type RuleEntry, type RulesCascade, rulesFor } from "./rules.ts";
import { type BrainWrite, MAX_SLUG_LENGTH, SLUG_PATTERN } from "./types.ts";
import type { WikiStore } from "./wiki-store.ts";

export interface BrainSessionContext {
	/** La 00-reglas activa de la raíz, o null. */
	root: RuleEntry | null;
	/** Carpetas de primer nivel, sin skills. */
	folders: BrainFolder[];
}

export interface RulesSource {
	cascade(slug: string): Promise<RulesCascade>;
	session(): Promise<BrainSessionContext>;
}

export function emptyCascade(): RulesCascade {
	return { revision: "", chain: [], fields: [], template: null };
}

// Un brain externo por MCP no tiene reglas propias (spec etapa 26 D15).
export const EMPTY_RULES: RulesSource = {
	cascade: async () => emptyCascade(),
	session: async () => ({ root: null, folders: [] }),
};

function checkPath(slug: string): void {
	if (
		slug !== ROOT_PATH &&
		(slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug))
	)
		throw new BrainValidation(["path"]);
}

export function createWikiRules(options: {
	tenantId: string;
	store: Pick<WikiStore, "listRulePages" | "listFolders">;
}): RulesSource {
	const { tenantId, store } = options;
	return {
		async cascade(slug) {
			checkPath(slug);
			return rulesFor(slug, await store.listRulePages(tenantId));
		},
		async session() {
			const [pages, folders] = await Promise.all([
				store.listRulePages(tenantId),
				store.listFolders(tenantId),
			]);
			return {
				root: rulesFor(ROOT_PATH, pages).chain[0] ?? null,
				folders: folders.filter(
					(folder) => !folder.path.includes("/") && folder.path !== "skills",
				),
			};
		},
	};
}

// Las reglas se filtran por la ruta pedida, no por la 00-reglas: una que la
// persona no puede leer igual le llega si gobierna lo que ve (spec §4.2).
export function withRulesAccess(
	source: RulesSource,
	levelOf: (path: string) => Level | null,
): RulesSource {
	return {
		async cascade(slug) {
			if (levelOf(slug) === null) throw new BrainNotFound(slug, []);
			return source.cascade(slug);
		},
		async session() {
			const context = await source.session();
			return {
				root: context.root,
				folders: context.folders.filter((folder) => levelOf(folder.path) !== null),
			};
		},
	};
}

export async function requireRules(
	source: RulesSource,
	write: BrainWrite,
): Promise<BrainWrite> {
	const { rulesRevision, ...rest } = write;
	let cascade: RulesCascade;
	try {
		cascade = await source.cascade(write.slug);
	} catch (error) {
		// Lo que no se ve se rechaza como en withAccess, sin confirmar que existe.
		if (error instanceof BrainNotFound)
			throw write.baseRevision === undefined
				? new BrainForbidden("No tenés permiso para escribir en esta parte del brain.")
				: new BrainNotFound(write.slug, []);
		throw error;
	}
	// Sin cadena la ruta no tiene reglas: un valor espurio no frena nada.
	if (cascade.revision !== "" && rulesRevision !== cascade.revision)
		throw new BrainRulesRequired(write.slug, cascade, rulesRevision !== undefined);
	return rest;
}
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run tests/brain/wiki-store-rules.test.ts tests/brain/rules-source.test.ts tests/brain/wiki.test.ts tests/brain/wiki-folders.test.ts tests/brain/wiki-store.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS. Si el typecheck nombra otro fake de `WikiStore` sin `listRulePages`, sumarle la misma línea.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/types.ts lib/brain/core/wiki-store.ts lib/brain/core/rules-source.ts tests/brain/wiki-store-rules.test.ts tests/brain/rules-source.test.ts tests/brain/wiki.test.ts tests/brain/wiki-folders.test.ts
git commit -m "feat: fuente de reglas del brain y exigencia de rulesRevision (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: El proveedor wiki escribe las reservadas

**Files:**
- Modify: `lib/brain/core/wiki.ts` (`validateWrite` y `createWikiProvider.upsert`)
- Test: `tests/brain/wiki-rules.test.ts` (nuevo)

**Interfaces:**
- Consumes: `checkRulesWrite`, `isReservedSlug`, `isRulesSlug` (Task 1); `RULES_LEAF`, `BRAIN_CATEGORY` (Task 1); `WikiStore.listRulePages` (Task 3).
- Produces: `validateWrite` con la misma firma; acepta `slug === "00-reglas"` con `category === "brain"` y no exige `requiredFrontmatter` a una reservada. `upsert` crea la `00-reglas` de la raíz (categoría `brain`, sin `folder_required`) y aplica los topes a toda `00-reglas`, con cualquier autor, incluido `import`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/wiki-rules.test.ts
import { describe, expect, it, vi } from "vitest";
import type { WikiConfig } from "@/lib/brain/core/config";
import { BrainValidation } from "@/lib/brain/core/errors";
import type { RulePage } from "@/lib/brain/core/rules";
import type { BrainAuthor, BrainWrite } from "@/lib/brain/core/types";
import { createWikiProvider } from "@/lib/brain/core/wiki";
import type { WikiStore } from "@/lib/brain/core/wiki-store";

const config: WikiConfig = {
	categories: ["talento", "comercial"],
	requiredFrontmatter: ["owner"],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

function store(rules: RulePage[] = []): WikiStore {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(async () => null),
		list: async () => [],
		listRevisions: async () => null,
		listFolders: async () => [
			{ path: "talento", description: "" },
			{ path: "talento/personal", description: "" },
		],
		listRulePages: vi.fn(async () => rules),
		upsert: vi.fn(async (params) => ({ slug: params.slug, revision: 1 })),
	};
}

const write = (slug: string, body = "reglas", extra: Partial<BrainWrite> = {}): BrainWrite => ({
	slug,
	title: "Reglas",
	category: "comercial",
	status: "activo",
	tags: [],
	body,
	reason: "alta",
	...extra,
});

const user: BrainAuthor = { kind: "user", userId: "u" };

function provider(s: WikiStore) {
	return createWikiProvider({ tenantId: "t", bindingId: "b", config, store: s, today: () => "2026-10-14" });
}

describe("páginas reservadas en el proveedor wiki", () => {
	it("crea las instrucciones del brain en la raíz con la categoría brain y sin campos obligatorios", async () => {
		const s = store();
		await provider(s).upsert(write("00-reglas"), user);
		expect(s.upsert).toHaveBeenCalledWith(expect.objectContaining({ slug: "00-reglas", category: "brain" }));
	});

	it("una 00-plantilla en la raíz sigue siendo una página suelta nueva: folder_required", async () => {
		await expect(provider(store()).upsert(write("00-plantilla"), user)).rejects.toMatchObject({
			fields: ["slug"],
		});
	});

	it("las reglas de una carpeta toman la categoría de su ruta y no piden campos obligatorios", async () => {
		const s = store();
		await provider(s).upsert(write("talento/personal/00-reglas"), user);
		expect(s.upsert).toHaveBeenCalledWith(expect.objectContaining({ category: "talento" }));
	});

	it("una 00-reglas de más de 20 000 caracteres no se escribe", async () => {
		const s = store();
		await expect(
			provider(s).upsert(write("talento/personal/00-reglas", "x".repeat(20_001)), user),
		).rejects.toBeInstanceOf(BrainValidation);
		expect(s.upsert).not.toHaveBeenCalled();
	});

	it("rechaza una cascada de más de 40 000 caracteres nombrando la carpeta", async () => {
		const s = store([
			{ slug: "00-reglas", status: "activo", revision: 1, body: "x".repeat(12_000) },
			{ slug: "talento/00-reglas", status: "activo", revision: 1, body: "x".repeat(20_000) },
		]);
		await expect(
			provider(s).upsert(write("talento/personal/00-reglas", "x".repeat(8_001)), user),
		).rejects.toThrow(/talento\/personal/);
	});

	it("archivar una 00-reglas larga pasa", async () => {
		const s = store();
		await provider(s).upsert(
			write("talento/personal/00-reglas", "x".repeat(30_000), { status: "archivado", baseRevision: 2 }),
			user,
		);
		expect(s.upsert).toHaveBeenCalled();
	});

	it("los topes valen también para el import", async () => {
		const s = store();
		await expect(
			provider(s).upsert(write("00-reglas", "x".repeat(12_001)), {
				kind: "import",
				userId: null,
				sourcePath: "00-reglas.md",
				sourceHash: "h",
			}),
		).rejects.toBeInstanceOf(BrainValidation);
	});

	it("una página común no lee las reglas", async () => {
		const s = store();
		await provider(s).upsert(write("talento/personal/leo", "b", { frontmatter: { owner: "ana" } }), user);
		expect(s.listRulePages).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/wiki-rules.test.ts`
Expected: FAIL: la `00-reglas` de la raíz se rechaza con `slug` y las de carpeta con `frontmatter.owner`.

- [ ] **Step 3: Implementar**

En `lib/brain/core/wiki.ts`, sumar los imports:

```ts
import { checkRulesWrite, isReservedSlug, isRulesSlug } from "./rules.ts";
```

y `BRAIN_CATEGORY` y `RULES_LEAF` al `import { ... } from "./types.ts"` que ya existe.

En `validateWrite`, reemplazar `if (!config.categories.includes(write.category)) fields.push("category");` por:

```ts
	// Las instrucciones del brain viven en la raíz con la categoría brain, que
	// no es una carpeta (spec etapa 26 §4.1).
	const rootRules =
		write.slug === RULES_LEAF && write.category === BRAIN_CATEGORY;
	if (!rootRules && !config.categories.includes(write.category))
		fields.push("category");
```

y envolver el `for (const key of config.requiredFrontmatter) { ... }` así:

```ts
	// Las reservadas no llevan los campos obligatorios (spec etapa 26 §5.2).
	if (!isReservedSlug(write.slug)) {
		for (const key of config.requiredFrontmatter) {
			if (COLUMN_KEYS.has(key)) continue;
			const value = frontmatter[key];
			if (value === undefined || value === null || value === "")
				fields.push(`frontmatter.${key}`);
		}
	}
```

En `upsert`, reemplazar desde `const write = nested` hasta el cierre del `if (isNew && !nested) { ... }` por:

```ts
			// La categoría sale de la ruta (spec etapa 26 D1). Las instrucciones
			// del brain van en la raíz con la categoría brain (§4.1). Una página
			// suelta que ya existía conserva la suya.
			const rootRules = input.slug === RULES_LEAF;
			const write = nested
				? { ...input, category: categoryForPath(input.slug) }
				: rootRules
					? { ...input, category: BRAIN_CATEGORY }
					: input;
			if (isNew && !nested && !rootRules) {
				throw new BrainValidation(
					["slug"],
					"Una página nueva va dentro de una carpeta: usá una ruta como categoria/nombre.",
				);
			}
```

y reemplazar `const frontmatter = validateWrite(write, config, today());` por:

```ts
			const frontmatter = validateWrite(write, config, today());
			// Topes de una 00-reglas (spec etapa 26 §4.1), con cualquier autor.
			if (isRulesSlug(write.slug))
				checkRulesWrite(write, await store.listRulePages(tenantId));
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run tests/brain/wiki-rules.test.ts tests/brain/wiki.test.ts tests/brain/wiki-folders.test.ts tests/brain/import tests/brain/skills-package.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/wiki.ts tests/brain/wiki-rules.test.ts
git commit -m "feat: el proveedor wiki escribe las instrucciones y reglas con sus topes (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Escribir una reservada exige administrar su carpeta

**Files:**
- Modify: `lib/brain/core/access/with-access.ts` (`upsert`)
- Modify: `lib/brain/core/editor/save.ts`
- Test: `tests/brain/access-with-access.test.ts`, `tests/brain/editor-save.test.ts`

**Interfaces:**
- Consumes: `isReservedSlug`, `folderOfPage` (Task 1); `BrainReservedSlug` (Task 2); `resolveAccess`, `atLeast`, `ROOT_PATH`.
- Produces: `withAccess(...).upsert` tira `BrainReservedSlug` cuando quien escribe es editor de la página pero no `administrador` de su carpeta. `savePage` devuelve `{ ok: false, code: "forbidden", message }` con el mensaje de `BrainReservedSlug`. Los administradores del tenant, el agente, la plataforma y el import no pasan por esta regla (`withAccess` no los envuelve).

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `tests/brain/access-with-access.test.ts` (sumar `BrainReservedSlug` al import de `@/lib/brain/core/errors`):

```ts
describe("withAccess · páginas reservadas", () => {
	function inner(): BrainProvider {
		return {
			search: vi.fn(async () => []),
			read: vi.fn(),
			list: async () => [],
			history: async () => null,
			upsert: vi.fn(async () => ({ slug: "x", revision: 1 })),
		};
	}
	const member: Principal = { kind: "user", userId: "ana", role: "tenant_member" };
	const reglas = (slug: string) => ({
		slug,
		title: "Reglas",
		category: "talento",
		status: "activo" as const,
		tags: [],
		body: "b",
		reason: "r",
	});

	it("un editor de la carpeta recibe reserved_slug al escribir sus reglas", async () => {
		const provider = inner();
		const rules: AccessRule[] = [
			{ path: "talento/personal", principal: "user", userId: "ana", level: "editor" },
		];
		await expect(
			withAccess(provider, member, rules).upsert(reglas("talento/personal/00-reglas"), { kind: "user", userId: "ana" }),
		).rejects.toBeInstanceOf(BrainReservedSlug);
		await expect(
			withAccess(provider, member, rules).upsert(reglas("talento/personal/00-plantilla"), { kind: "user", userId: "ana" }),
		).rejects.toThrow(/administra esa carpeta/);
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("quien administra la carpeta las escribe", async () => {
		const provider = inner();
		const rules: AccessRule[] = [
			{ path: "talento/personal", principal: "user", userId: "ana", level: "administrador" },
		];
		await withAccess(provider, member, rules).upsert(reglas("talento/personal/00-reglas"), { kind: "user", userId: "ana" });
		expect(provider.upsert).toHaveBeenCalled();
	});

	it("las instrucciones del brain exigen administrar la raíz", async () => {
		const provider = inner();
		const rules: AccessRule[] = [{ path: "", principal: "user", userId: "ana", level: "editor" }];
		await expect(
			withAccess(provider, member, rules).upsert(reglas("00-reglas"), { kind: "user", userId: "ana" }),
		).rejects.toThrow(/raíz del brain/);
	});

	it("sin permiso de editor sigue siendo forbidden, sin nombrar las reglas", async () => {
		const provider = inner();
		await expect(
			withAccess(provider, member, []).upsert(reglas("talento/00-reglas"), { kind: "user", userId: "ana" }),
		).rejects.toBeInstanceOf(BrainForbidden);
	});
});
```

En `tests/brain/editor-save.test.ts` (sumar `BrainReservedSlug` al import de `@/lib/brain/core/errors`):

```ts
	it("una página reservada sin administrar su carpeta muestra el mensaje de a quién pedírselo", async () => {
		const { deps: d } = deps(
			{},
			vi.fn(async () => {
				throw new BrainReservedSlug("Las reglas de talento las escribe quien administra esa carpeta.");
			}),
		);
		expect(await savePage({ ...input, slug: "talento/00-reglas" }, d)).toEqual({
			ok: false,
			code: "forbidden",
			message: "Las reglas de talento las escribe quien administra esa carpeta.",
		});
	});
```

(dentro de `describe("savePage", ...)`).

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run tests/brain/access-with-access.test.ts tests/brain/editor-save.test.ts`
Expected: FAIL: el editor escribe la `00-reglas` y `savePage` devuelve `internal`.

- [ ] **Step 3: Implementar**

En `lib/brain/core/access/with-access.ts`:

```ts
import { BrainForbidden, BrainNotFound, BrainReservedSlug } from "../errors.ts";
import { folderOfPage, isReservedSlug } from "../rules.ts";
```

sumar `ROOT_PATH` al `import { ... } from "./types.ts"`, y en `upsert`, entre el `throw new BrainForbidden(...)` de "No tenés permiso para escribir…" y `return provider.upsert(write, author);`:

```ts
			// Las reservadas son gobierno: las escribe quien administra su carpeta
			// (spec etapa 26 §4.1). Va después del chequeo de editor: a quien no
			// puede escribir ahí no se le cuenta que es una página de reglas.
			if (isReservedSlug(write.slug)) {
				const folder = folderOfPage(write.slug);
				if (!atLeast(levelOf(folder), "administrador")) {
					throw new BrainReservedSlug(
						folder === ROOT_PATH
							? "Las instrucciones del brain las escribe quien administra la raíz del brain. Pedíselo a un administrador de la empresa."
							: `Las reglas y la plantilla de ${folder} las escribe quien administra esa carpeta. Pedíselo a quien la administra.`,
					);
				}
			}
```

En `lib/brain/core/editor/save.ts`, sumar `BrainReservedSlug` al import de `../errors`, y en el `catch`, antes de `if (error instanceof BrainForbidden || ...)`:

```ts
		// Una reservada sin administrar su carpeta: el mensaje dice a quién pedírselo.
		if (error instanceof BrainReservedSlug)
			return { ok: false, code: "forbidden", message: error.message };
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run tests/brain/access-with-access.test.ts tests/brain/editor-save.test.ts tests/brain/save-action.test.ts tests/brain/boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/access/with-access.ts lib/brain/core/editor/save.ts tests/brain/access-with-access.test.ts tests/brain/editor-save.test.ts
git commit -m "feat: las reglas y plantillas del brain las escribe quien administra su carpeta (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Contrato de `brain_rules` y bloque de arranque

**Files:**
- Modify: `lib/brain/core/contract.ts`
- Create: `lib/brain/core/session.ts`
- Test: `tests/brain/contract.test.ts`, `tests/brain/session.test.ts` (nuevo)

**Interfaces:**
- Consumes: `type BrainSessionContext` (Task 3).
- Produces:
  - `BRAIN_TOOL_NAMES.rules = "brain_rules"`.
  - `brainContract(...).rules = { description: string; input: z.ZodObject<{ path: z.ZodString }> }`.
  - `brainContract(...).upsert.input` suma `rulesRevision: z.string().max(64).optional()`.
  - `RULES_CHANNEL_LINE: string` y `formatBrainSession(context: BrainSessionContext): string` en `session.ts` (nunca vacío: siempre termina con `RULES_CHANNEL_LINE`).

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/brain/contract.test.ts`, cambiar el test "los nombres de las tools son los de siempre" para que espere también `rules: "brain_rules"`, y sumar dentro de `describe("brainContract", ...)`:

```ts
	it("brain_upsert acepta rulesRevision opcional de hasta 64 caracteres", () => {
		const base = {
			slug: "comercial/icp",
			title: "ICP",
			category: "comercial",
			status: "activo",
			tags: [],
			body: "x",
			reason: "r",
		};
		expect(contract.upsert.input.safeParse(base).success).toBe(true);
		expect(contract.upsert.input.safeParse({ ...base, rulesRevision: "0123456789abcdef" }).success).toBe(true);
		expect(contract.upsert.input.safeParse({ ...base, rulesRevision: "x".repeat(65) }).success).toBe(false);
	});

	it("brain_rules recibe una ruta, también vacía para la raíz", () => {
		expect(contract.rules.input.safeParse({ path: "" }).success).toBe(true);
		expect(contract.rules.input.safeParse({ path: "talento/personal/leo" }).success).toBe(true);
		expect(contract.rules.input.safeParse({}).success).toBe(false);
	});

	it("las descripciones enseñan a reintentar con rulesRevision", () => {
		expect(contract.read.description).toContain("rulesRevision");
		expect(contract.upsert.description).toContain("rules_required");
		expect(contract.upsert.description).toContain("00-reglas");
		expect(contract.rules.description).toContain("aunque todavía no exista");
	});
```

```ts
// tests/brain/session.test.ts
import { describe, expect, it } from "vitest";
import { formatBrainSession, RULES_CHANNEL_LINE } from "@/lib/brain/core/session";

describe("formatBrainSession", () => {
	it("trae las instrucciones de la raíz, la tabla de carpetas y la línea de reglas", () => {
		const text = formatBrainSession({
			root: { path: "", slug: "00-reglas", revision: 1, body: "  Escribí en tercera persona.\n" },
			folders: [
				{ path: "talento", description: "Personas | equipos\ny roles" },
				{ path: "comercial", description: "" },
			],
		});
		expect(text).toContain("# Instrucciones del brain");
		expect(text).toContain("Escribí en tercera persona.");
		expect(text).toContain("| talento | Personas \\| equipos y roles |");
		expect(text).toContain("| comercial | — |");
		expect(text.endsWith(RULES_CHANNEL_LINE)).toBe(true);
	});

	it("sin instrucciones ni carpetas queda solo la línea de reglas", () => {
		expect(formatBrainSession({ root: null, folders: [] })).toBe(RULES_CHANNEL_LINE);
	});
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run tests/brain/contract.test.ts tests/brain/session.test.ts`
Expected: FAIL: `contract.rules` no existe y no se puede resolver `@/lib/brain/core/session`.

- [ ] **Step 3: Implementar**

En `lib/brain/core/contract.ts`:

```ts
export const BRAIN_TOOL_NAMES = {
	search: "brain_search",
	read: "brain_read",
	upsert: "brain_upsert",
	rules: "brain_rules",
} as const;
```

Reemplazar la descripción de `read` por:

```ts
			description:
				"Lee una página completa del brain de esta empresa, con su revisión. Necesitás la revisión para actualizarla con brain_upsert. Trae también rules: las reglas de su carpeta (las instrucciones de la raíz ya llegaron al arrancar) y rules.revision, que pasás como rulesRevision si después la actualizás.",
```

Reemplazar la descripción de `upsert` por (la frase nueva va antes de `${valid}`):

```ts
			description: `Crea o actualiza una página del brain de esta empresa. Para actualizar, leé la página y pasá su revisión en baseRevision; sin baseRevision solo crea páginas nuevas. Nunca borres: para retirar una página, poné status archivado. Explicá el cambio en reason. Si la ruta tiene reglas, pasá rulesRevision (viene en brain_read, en brain_rules o en el rechazo): sin él, o con uno viejo, no se escribe nada y la respuesta es rules_required con las reglas completas; leelas, ajustá la página si hace falta y reintentá con ese rulesRevision. Las páginas 00-reglas y 00-plantilla las escribe solo quien administra su carpeta; la 00-reglas de la raíz se guarda con la categoría brain. ${valid}${withCanon ? ` Tags de canon: ${canon}.` : ""}`,
```

En `upsert.input`, debajo de `baseRevision`:

```ts
				rulesRevision: z.string().max(64).optional(),
```

Y debajo de `upsert` (dentro del objeto que devuelve `brainContract`):

```ts
		rules: {
			description:
				"Devuelve las instrucciones del brain y las reglas que aplican a una ruta, de la raíz a su carpeta, con el rulesRevision que pide brain_upsert. Pasá la ruta de la página que vas a crear o editar, aunque todavía no exista. Usalo antes de crear una página nueva.",
			input: z.object({
				path: z
					.string()
					.max(MAX_SLUG_LENGTH)
					.describe(
						"Ruta de la página, por ejemplo equipo/ana-perez. Vacía para las instrucciones de la raíz.",
					),
			}),
		},
```

```ts
// lib/brain/core/session.ts
// Bloque de arranque del brain (spec etapa 26 §4.3): lo reciben el chat en
// session.started y el MCP en instructions. Puro.
import type { BrainSessionContext } from "./rules-source.ts";

export const RULES_CHANNEL_LINE =
	"Cada carpeta puede tener reglas propias: llegan en `brain_read`, en `brain_rules` y en el rechazo de `brain_upsert`.";

function cell(text: string): string {
	return text.replace(/\s+/g, " ").replaceAll("|", "\\|").trim() || "—";
}

export function formatBrainSession(context: BrainSessionContext): string {
	const parts: string[] = [];
	if (context.root) {
		parts.push(
			[
				"# Instrucciones del brain",
				"Son las reglas de esta empresa para su brain: valen para todo lo que leas y escribas en él. Si una carpeta tiene reglas propias, se suman a estas; ante una contradicción, ganan estas.",
				context.root.body.trim(),
			].join("\n\n"),
		);
	}
	if (context.folders.length > 0) {
		parts.push(
			[
				"# Carpetas del brain",
				[
					"| Carpeta | Para qué es |",
					"| --- | --- |",
					...context.folders.map(
						(folder) => `| ${folder.path} | ${cell(folder.description)} |`,
					),
				].join("\n"),
			].join("\n\n"),
		);
	}
	parts.push(RULES_CHANNEL_LINE);
	return parts.join("\n\n");
}
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run tests/brain/contract.test.ts tests/brain/session.test.ts tests/brain/boundary.test.ts`
Expected: PASS, incluido el test existente "sin canon, las descripciones son generales" (las frases nuevas no nombran canon, ICP, hooks ni comercial) y "las descripciones no prometen aprobación".

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/contract.ts lib/brain/core/session.ts tests/brain/contract.test.ts tests/brain/session.test.ts
git commit -m "feat: contrato de brain_rules y bloque de arranque del brain (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Reglas por MCP

**Files:**
- Modify: `lib/brain/core/mcp-server/server.ts`
- Modify: `lib/brain/core/mcp-server/handler.ts`
- Create: `lib/brain/adapters/rules.ts`
- Modify: `lib/brain/adapters/mcp-production.ts`
- Test: `tests/brain/mcp-server/tools.test.ts`, `tests/brain/mcp-server/handler.test.ts`, `tests/brain/rules-adapter.test.ts` (nuevo), `tests/brain/mcp-server/production.test.ts`

**Interfaces:**
- Consumes: `RulesSource`, `EMPTY_RULES`, `createWikiRules`, `withRulesAccess`, `requireRules` (Task 3); `withoutRoot` (Task 1); `BrainRulesRequired` (Task 2); `brainContract(...).rules`, `BRAIN_TOOL_NAMES.rules` (Task 6); `formatBrainSession` (Task 6); `resolveAccess` de `access/resolve-access.ts`.
- Produces:
  - `buildBrainMcpServer(ctx)` acepta `rules?: RulesSource | null` y `brainInstructions?: string | null`. Con `rules`: registra `brain_rules`, `brain_read` devuelve `{ ok: true, page, rules: { revision, chain } }` y `brain_upsert` exige `rulesRevision`, contando un `rules_required` como lectura. Sin `rules`: igual que antes.
  - `BrainMcpDeps.brainRules?: (binding: BrainBinding) => RulesSource` (sin él, `EMPTY_RULES`).
  - `getBrainRules(binding: BrainBinding): RulesSource` en `lib/brain/adapters/rules.ts` (`EMPTY_RULES` para un brain `mcp`; el cliente de Supabase se crea recién al leer).
  - `productionDeps().brainRules === getBrainRules`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/brain/mcp-server/tools.test.ts`, sumar los imports `import { createWikiRules, EMPTY_RULES } from "@/lib/brain/core/rules-source";` y, dentro de `describe("buildBrainMcpServer", ...)`:

```ts
	it("con fuente de reglas suma brain_rules y brain_read trae las reglas sin la raíz", async () => {
		const rules = createWikiRules({
			tenantId: "t",
			store: {
				listRulePages: async () => [
					{ slug: "00-reglas", status: "activo", revision: 1, body: "raíz" },
					{ slug: "comercial/00-reglas", status: "activo", revision: 2, body: "comercial" },
				],
				listFolders: async () => [],
			},
		});
		const server = buildBrainMcpServer({
			userId: "ana",
			categories: ["comercial"],
			canon: false,
			provider: fakeProvider(),
			limiter: fakeLimiter(),
			rules,
		});
		const client = await connect(server);
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_rules",
			"brain_search",
			"brain_upsert",
		]);
		const read = await client.callTool({ name: "brain_read", arguments: { slug: "comercial/icp" } });
		expect(read.structuredContent).toMatchObject({
			ok: true,
			page,
			rules: { chain: [{ path: "comercial", body: "comercial" }] },
		});
		const cascade = await client.callTool({ name: "brain_rules", arguments: { path: "comercial/nueva" } });
		expect(cascade.structuredContent).toMatchObject({
			ok: true,
			rules: { chain: [{ path: "" }, { path: "comercial" }], fields: [], template: null },
		});
	});

	it("un rules_required cuenta como lectura y no llega al proveedor", async () => {
		const provider = fakeProvider();
		const limiter = fakeLimiter();
		const rules = createWikiRules({
			tenantId: "t",
			store: {
				listRulePages: async () => [{ slug: "comercial/00-reglas", status: "activo", revision: 2, body: "b" }],
				listFolders: async () => [],
			},
		});
		const server = buildBrainMcpServer({
			userId: "admin",
			categories: ["comercial"],
			canon: false,
			provider,
			limiter,
			rules,
		});
		const client = await connect(server);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: { slug: "comercial/icp", title: "ICP", category: "comercial", status: "activo", tags: [], body: "x", reason: "r" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ ok: false, error: "rules_required" });
		expect(limiter.check.mock.calls).toEqual([["read"]]);
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("las instrucciones suman el bloque del brain a las de skills", async () => {
		const server = buildBrainMcpServer({
			userId: "ana",
			categories: ["comercial"],
			canon: false,
			provider: fakeProvider(),
			limiter: fakeLimiter(),
			rules: EMPTY_RULES,
			brainInstructions: "# Instrucciones del brain\n\nTercera persona.",
		});
		const client = await connect(server);
		expect(client.getInstructions()).toBe("# Instrucciones del brain\n\nTercera persona.");
	});
```

En `tests/brain/mcp-server/handler.test.ts`, cambiar las dos listas exactas del test "todos ven las tres tools" (renombrarlo "todos ven las tools del brain: el permiso se aplica al llamarlas") y la constante `BRAIN_TOOLS` a `["brain_read", "brain_rules", "brain_search", "brain_upsert"]`. Sumar el import `import { createWikiRules } from "@/lib/brain/core/rules-source";` y al final:

```ts
describe("handleBrainMcp · reglas", () => {
	const rulePages = [
		{ slug: "00-reglas", status: "activo" as const, revision: 2, body: "Escribí en tercera persona." },
		{ slug: "talento/personal/00-reglas", status: "activo" as const, revision: 5, body: "Cada ficha lleva reporta_a." },
	];
	const folders = [
		{ path: "talento", description: "Personas | equipos" },
		{ path: "talento/personal", description: "" },
		{ path: "direccion", description: "Presupuesto" },
		{ path: "skills", description: "" },
	];
	const brainRules = () =>
		createWikiRules({
			tenantId: "tenant-a",
			store: { listRulePages: async () => rulePages, listFolders: async () => folders },
		});
	const newPage = {
		slug: "talento/personal/leo",
		title: "Leo",
		category: "comercial",
		status: "activo",
		tags: [],
		body: "Ficha",
		reason: "alta",
	};

	it("brain_upsert sin rulesRevision devuelve rules_required con la raíz, no escribe y cuenta como lectura", async () => {
		const hit = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 }));
		const d = deps({ brainRules, hit });
		const client = await connect("admin", d);
		const result = await client.callTool({ name: "brain_upsert", arguments: newPage });
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "rules_required",
			rules: { chain: [{ path: "" }, { path: "talento/personal" }] },
		});
		expect(d.providerInstance.upsert).not.toHaveBeenCalled();
		const kinds = hit.mock.calls.map((call) => (call as unknown as [{ kind: string }])[0].kind);
		expect(kinds).toContain("read");
		expect(kinds).not.toContain("write");
	});

	it("el reintento con el rulesRevision devuelto entra, sin pasarle rulesRevision al proveedor", async () => {
		const d = deps({ brainRules });
		const client = await connect("admin", d);
		const first = await client.callTool({ name: "brain_upsert", arguments: newPage });
		const revision = (first.structuredContent as { rules: { revision: string } }).rules.revision;
		const second = await client.callTool({
			name: "brain_upsert",
			arguments: { ...newPage, rulesRevision: revision },
		});
		expect(second.structuredContent).toMatchObject({ ok: true });
		const [written] = vi.mocked(d.providerInstance.upsert).mock.calls[0];
		expect(written).toMatchObject({ slug: "talento/personal/leo" });
		expect(written).not.toHaveProperty("rulesRevision");
	});

	it("un miembro que no ve la carpeta recibe forbidden, nunca las reglas", async () => {
		const d = deps({
			brainRules,
			rules: {
				load: async () => [{ path: "talento", principal: "members", userId: null, level: "ninguno" }],
			},
		});
		const client = await connect("ana", d);
		const result = await client.callTool({ name: "brain_upsert", arguments: newPage });
		expect(result.structuredContent).toMatchObject({ ok: false, error: "forbidden" });
		expect(JSON.stringify(result)).not.toContain("reporta_a");
	});

	it("brain_read trae las reglas de la carpeta sin la raíz", async () => {
		const client = await connect("admin", deps({ brainRules }));
		const result = await client.callTool({ name: "brain_read", arguments: { slug: "talento/personal/leo" } });
		const rules = (result.structuredContent as { rules: { revision: string; chain: Array<{ path: string }> } }).rules;
		expect(rules.chain.map((e) => e.path)).toEqual(["talento/personal"]);
		expect(rules.revision).toMatch(/^[0-9a-f]{16}$/);
	});

	it("una 00-reglas se lee sin traerse a sí misma y se escribe con la revisión de arriba", async () => {
		const d = deps({ brainRules });
		const client = await connect("admin", d);
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "talento/personal/00-reglas" },
		});
		expect((read.structuredContent as { rules: { chain: unknown[] } }).rules.chain).toEqual([]);
		const write = await client.callTool({
			name: "brain_upsert",
			arguments: { ...newPage, slug: "talento/personal/00-reglas", baseRevision: 5 },
		});
		expect(write.structuredContent).toMatchObject({
			error: "rules_required",
			rules: { chain: [{ path: "" }] },
		});
	});

	it("brain_rules de una ruta que no existe devuelve la cascada completa", async () => {
		const client = await connect("ana", deps({ brainRules }));
		const result = await client.callTool({
			name: "brain_rules",
			arguments: { path: "talento/personal/nueva" },
		});
		expect(result.structuredContent).toMatchObject({
			ok: true,
			rules: { chain: [{ path: "" }, { path: "talento/personal" }] },
		});
	});

	it("las instrucciones traen las de la raíz y solo las carpetas que la persona ve", async () => {
		const client = await connect(
			"ana",
			deps({
				brainRules,
				rules: {
					load: async () => [{ path: "direccion", principal: "members", userId: null, level: "ninguno" }],
				},
			}),
		);
		const instructions = client.getInstructions() ?? "";
		expect(instructions).toContain("Escribí en tercera persona.");
		expect(instructions).toContain("| talento | Personas \\| equipos |");
		expect(instructions).toContain("brain_rules");
		expect(instructions).not.toContain("direccion");
		expect(instructions).not.toContain("| skills");
		expect(instructions).not.toContain("| talento/personal");
	});

	it("un brain externo por MCP responde la cascada vacía y no tiene instrucciones del brain", async () => {
		const client = await connect(
			"ana",
			deps({ store: { ...store, brainBinding: async () => ({ ...binding, provider: "mcp" }) as never } }),
		);
		const result = await client.callTool({ name: "brain_rules", arguments: { path: "talento/x" } });
		expect(result.structuredContent).toMatchObject({ ok: true, rules: { revision: "", chain: [] } });
		expect(client.getInstructions()).toBeUndefined();
	});
});
```

```ts
// tests/brain/rules-adapter.test.ts
import { describe, expect, it, vi } from "vitest";

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { getBrainRules } from "@/lib/brain/adapters/rules";
import { EMPTY_RULES } from "@/lib/brain/core/rules-source";

describe("getBrainRules", () => {
	it("un brain externo por MCP no tiene reglas", () => {
		expect(getBrainRules({ provider: "mcp" } as never)).toBe(EMPTY_RULES);
	});

	it("un brain wiki lee de Supabase recién al pedir las reglas", () => {
		const source = getBrainRules({ id: "b", tenantId: "t", provider: "wiki", config: {} } as never);
		expect(source).not.toBe(EMPTY_RULES);
		expect(createAdminClient).not.toHaveBeenCalled();
	});
});
```

En `tests/brain/mcp-server/production.test.ts`, sumar con los demás `vi.mock`:

```ts
vi.mock("@/lib/brain/adapters/rules", () => ({ getBrainRules: vi.fn() }));
```

el import `import { getBrainRules } from "@/lib/brain/adapters/rules";` debajo del de `mcp-production`, y al final:

```ts
describe("productionDeps().brainRules", () => {
	it("usa las reglas del brain de la plataforma", () => {
		vi.stubEnv("PUBLIC_APP_URL", "https://agentes.innov.as");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
		expect(productionDeps().brainRules).toBe(getBrainRules);
	});
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run tests/brain/mcp-server tests/brain/rules-adapter.test.ts`
Expected: FAIL: no hay `brain_rules`, `brain_read` no trae `rules` y no existe `@/lib/brain/adapters/rules`.

- [ ] **Step 3: Implementar el servidor**

En `lib/brain/core/mcp-server/server.ts`, sumar los imports:

```ts
import {
	BrainError,
	BrainRulesRequired,
	BrainValidation,
	toToolError,
} from "../errors.ts";
import { withoutRoot } from "../rules.ts";
import { type RulesSource, requireRules } from "../rules-source.ts";
import type { BrainProvider, BrainWrite } from "../types.ts";
```

(reemplazan los imports de `../errors.ts` y `../types.ts` que ya existen). En el tipo de `ctx`, debajo de `skills?`:

```ts
	/** Reglas que ve la persona (spec etapa 26 §4.3). Sin esto, ni brain_rules ni rules en brain_read. */
	rules?: RulesSource | null;
	/** Instrucciones del brain y carpetas, para el campo instructions. */
	brainInstructions?: string | null;
```

Reemplazar el arranque del servidor y `run` por:

```ts
	const skills = ctx.skills ?? null;
	const rules = ctx.rules ?? null;
	const instructions = [ctx.brainInstructions, skills ? SKILL_INSTRUCTIONS : null]
		.filter((text): text is string => Boolean(text))
		.join("\n\n");
	const server = new McpServer(
		{ name: "innovas-brain", version: "1.0.0" },
		instructions ? { instructions } : undefined,
	);
	const contract = brainContract(ctx.categories, { canon: ctx.canon });

	// kind null: la tool cuenta su uso adentro (brain_upsert).
	async function run(
		kind: "read" | "write" | null,
		work: () => Promise<Record<string, unknown>>,
	) {
		try {
			if (kind) await ctx.limiter.check(kind);
			return result(await work());
		} catch (error) {
```

(el resto de `run` queda igual). Reemplazar el registro de `BRAIN_TOOL_NAMES.read` por:

```ts
	server.registerTool(
		BRAIN_TOOL_NAMES.read,
		{
			description: contract.read.description,
			inputSchema: contract.read.input,
		},
		async ({ slug }) =>
			run("read", async () => {
				const page = await ctx.provider.read(slug);
				if (!rules) return { ok: true, page };
				return { ok: true, page, rules: withoutRoot(await rules.cascade(slug)) };
			}),
	);

	if (rules) {
		server.registerTool(
			BRAIN_TOOL_NAMES.rules,
			{
				description: contract.rules.description,
				inputSchema: contract.rules.input,
			},
			async ({ path }) =>
				run("read", async () => ({ ok: true, rules: await rules.cascade(path) })),
		);
	}
```

y el de `BRAIN_TOOL_NAMES.upsert` por:

```ts
	server.registerTool(
		BRAIN_TOOL_NAMES.upsert,
		{
			description: contract.upsert.description,
			inputSchema: contract.upsert.input,
		},
		async (input) =>
			run(null, async () => {
				let write: BrainWrite = input;
				if (rules) {
					try {
						write = await requireRules(rules, input);
					} catch (error) {
						// Un rechazo por reglas es parte del flujo: entrega las reglas y
						// cuenta como lectura, no como escritura (spec etapa 26 §4.3).
						await ctx.limiter.check(
							error instanceof BrainRulesRequired ? "read" : "write",
						);
						throw error;
					}
				}
				await ctx.limiter.check("write");
				if (
					new TextEncoder().encode(write.body).length >
					MCP_MAX_UPSERT_BODY_BYTES
				) {
					throw new BrainValidation(["body"]);
				}
				const written = await ctx.provider.upsert(write, {
					kind: "user",
					userId: ctx.userId,
				});
				return { ok: true, ...written };
			}),
	);
```

- [ ] **Step 4: Implementar el handler, el adapter y producción**

En `lib/brain/core/mcp-server/handler.ts`, sumar los imports:

```ts
import { EMPTY_RULES, type RulesSource, withRulesAccess } from "../rules-source.ts";
import { formatBrainSession } from "../session.ts";
```

En `BrainMcpDeps`, debajo de `provider`:

```ts
	/** Reglas del brain (spec etapa 26 §4.3). Sin esto, ninguna. */
	brainRules?: (binding: BrainBinding) => RulesSource;
```

Entre la línea `const provider = withoutSkills(...)` y el bloque de skills:

```ts
	// Las reglas se filtran por lo que la persona ve (spec etapa 26 §4.2). Un
	// brain mcp tiene la fuente vacía (D15).
	const visibleRules = withRulesAccess(
		deps.brainRules?.(access.binding) ?? EMPTY_RULES,
		(path) => resolveAccess(rules, principal, path),
	);
	// Si no se pueden leer, el servidor arranca sin el bloque: las reglas igual
	// llegan en brain_read, brain_rules y el rechazo de brain_upsert.
	let brainInstructions: string | null = null;
	if (access.binding.provider === "wiki") {
		try {
			brainInstructions = formatBrainSession(await visibleRules.session());
		} catch (error) {
			console.error("brain mcp: no pude leer las instrucciones del brain", error);
		}
	}
```

y en la llamada a `buildBrainMcpServer`, debajo de `skills,`:

```ts
		rules: visibleRules,
		brainInstructions,
```

```ts
// lib/brain/adapters/rules.ts
// Reglas del brain de la plataforma (spec etapa 26 §4.2). Lo carga el canal MCP
// de eve: sin imports de next/*. El cliente se crea recién al leer.
import { createAdminClient } from "../../supabase/admin";
import type { BrainBinding } from "../core/resolve.ts";
import {
	createWikiRules,
	EMPTY_RULES,
	type RulesSource,
} from "../core/rules-source.ts";
import { createSupabaseWikiStore } from "../core/wiki-store.ts";

export function getBrainRules(binding: BrainBinding): RulesSource {
	// Un brain externo por MCP no tiene reglas propias (spec etapa 26 D15).
	if (binding.provider !== "wiki") return EMPTY_RULES;
	const store = () => createSupabaseWikiStore(createAdminClient());
	return createWikiRules({
		tenantId: binding.tenantId,
		store: {
			listRulePages: (tenantId) => store().listRulePages(tenantId),
			listFolders: (tenantId) => store().listFolders(tenantId),
		},
	});
}
```

En `lib/brain/adapters/mcp-production.ts`, sumar `import { getBrainRules } from "./rules.ts";` y en `productionDeps`, debajo de `provider: getBrainProvider,`:

```ts
		brainRules: getBrainRules,
```

- [ ] **Step 5: Correr los tests y ver que pasan**

Run: `npx vitest run tests/brain/mcp-server tests/brain/rules-adapter.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS. Los tests existentes de `tools.test.ts` siguen viendo tres tools e `instructions` indefinidas: arman el servidor sin `rules`.

- [ ] **Step 6: Verificar el bundle del canal MCP de eve**

`mcp-production.ts` ahora importa `adapters/rules.ts`. Desde `agents/outreach` y después desde `agents/asistente`:

Run: `PUBLIC_APP_URL=https://agentes.innov.as NEXT_PUBLIC_SUPABASE_URL=https://ref.supabase.co node ../../node_modules/eve/bin/eve.js build`
Expected: build sin "Failed to load an installed package: next". Borrar el `.output` que deja en cada carpeta (`rm -rf .output`).

- [ ] **Step 7: Commit**

```bash
git add lib/brain/core/mcp-server/server.ts lib/brain/core/mcp-server/handler.ts lib/brain/adapters/rules.ts lib/brain/adapters/mcp-production.ts tests/brain/mcp-server tests/brain/rules-adapter.test.ts
git commit -m "feat: brain_rules, reglas en brain_read y rulesRevision en brain_upsert por MCP (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Reglas en las tools del agente

**Files:**
- Modify: `lib/brain/adapters/acting-provider.ts`
- Modify: `lib/brain/adapters/tools.ts`
- Modify: `lib/agents/running-tool.ts`
- Modify: `agents/asistente/instructions.md`, `agents/outreach/instructions.md`
- Test: `tests/brain/tools.test.ts`, `tests/brain/acting-provider.test.ts`, `tests/agents/running-tool.test.ts`

**Interfaces:**
- Consumes: `getBrainRules` (Task 7); `RulesSource`, `withRulesAccess`, `requireRules`, `EMPTY_RULES` (Task 3); `isReservedSlug`, `withoutRoot` (Task 1); `agentReservedSlug` (Task 2); `brainContract(...).rules` (Task 6).
- Produces:
  - `resolveActingBrain(binding: BrainBinding, actor: BrainActor | undefined, deps?: { provider?: (binding: BrainBinding) => BrainProvider; rules?: (tenantId: string) => Promise<AccessRule[]>; rulesSource?: (binding: BrainBinding) => RulesSource }): Promise<{ provider: BrainProvider; rules: RulesSource }>`.
  - `resolveActingRules(binding: BrainBinding, actor: BrainActor | undefined, deps?: { rules?: (tenantId: string) => Promise<AccessRule[]>; rulesSource?: (binding: BrainBinding) => RulesSource }): Promise<RulesSource>` (la usa la Task 9).
  - `resolveActingProvider` con la misma firma y comportamiento de hoy.
  - `createBrainTools(binding, access, deps)`: `deps.rulesSource?` nuevo; las tools de lectura son `brain_search`, `brain_read` y `brain_rules`; `brain_upsert` rechaza reservadas con `reserved_slug` y exige `rulesRevision`.
  - `TOOL_LABELS.brain_rules = "Leyendo las reglas del brain"`.

- [ ] **Step 1: Leer las guías de eve**

`node_modules/eve/docs/README.md`, y en `node_modules/eve/docs/guides/dynamic-capabilities.md` las secciones "Dynamic tools", "Author replayable callbacks" y "Naming" (un mapa de tools nombra cada una por su clave: el nombre que ve el indicador es `brain_rules`). Restricción que importa acá: el `execute` de cada `defineTool` solo puede cerrar sobre datos JSON (`binding`, `deps.actor`) y llamar a imports estables; por eso la lógica nueva vive en `acting-provider.ts`, `errors.ts` y `rules-source.ts`, y el schema de `brain_rules` se arma inline con `brainContract(categories).rules.input`.

- [ ] **Step 2: Escribir los tests que fallan**

En `tests/brain/tools.test.ts`:
- sumar los imports `import type { RulePage } from "@/lib/brain/core/rules";` y `import { createWikiRules, EMPTY_RULES } from "@/lib/brain/core/rules-source";`, y debajo de `fakeProvider` la constante `const noRules = () => EMPTY_RULES;`;
- en los dos primeros tests, esperar `["brain_read", "brain_rules", "brain_search"]` y `["brain_read", "brain_rules", "brain_search", "brain_upsert"]`;
- sumar `rulesSource: noRules` a las opciones de `createBrainTools` en el test "brain_search y brain_read siguen llamando al provider inyectado", en el test "brain_upsert de un miembro sin permiso de editor es forbidden…" y en el `setup()` de `describe("skills")`;
- sumar al final:

```ts
describe("reglas en las tools del agente", () => {
	const pageOf = (slug: string) => ({
		slug,
		title: slug,
		category: "comercial",
		status: "activo" as const,
		tags: [],
		frontmatter: {},
		body: "b",
		revision: 1,
		updatedAt: "2026-01-01",
	});
	const pages: RulePage[] = [
		{ slug: "00-reglas", status: "activo", revision: 1, body: "raíz" },
		{ slug: "comercial/00-reglas", status: "activo", revision: 3, body: "comercial" },
	];
	const rulesSource = () =>
		createWikiRules({
			tenantId: "tenant-a",
			store: { listRulePages: async () => pages, listFolders: async () => [] },
		});
	const ctx = { session: { id: "s1", auth: { initiator: null } } } as never;
	const input = {
		slug: "comercial/nueva",
		title: "Nueva",
		category: "comercial",
		status: "activo" as const,
		tags: [],
		body: "b",
		reason: "alta",
	};

	function setup() {
		const upsert = vi.fn(async () => ({ slug: "comercial/nueva", revision: 1 }));
		const providerFactory = vi.fn(() => ({
			search: vi.fn(async () => []),
			read: vi.fn(async (slug: string) => pageOf(slug)),
			list: async () => [],
			history: async () => null,
			upsert,
		}));
		const tools = createBrainTools(binding, "read_write", { provider: providerFactory, rulesSource });
		if (!("brain_upsert" in tools)) throw new Error("falta brain_upsert");
		return { tools, upsert, providerFactory };
	}

	it("brain_rules devuelve la cascada completa de una ruta que no existe", async () => {
		const { tools } = setup();
		const result = await tools.brain_rules.execute({ path: "comercial/nueva" }, {} as never);
		expect(result).toMatchObject({ ok: true, rules: { chain: [{ path: "" }, { path: "comercial" }] } });
	});

	it("brain_read trae las reglas de la carpeta sin la raíz", async () => {
		const { tools } = setup();
		const result = await tools.brain_read.execute({ slug: "comercial/icp" }, {} as never);
		expect(result).toMatchObject({ ok: true, rules: { chain: [{ path: "comercial" }] } });
	});

	it("brain_upsert sin rulesRevision devuelve rules_required y no escribe; el reintento entra", async () => {
		const { tools, upsert } = setup();
		const first = await tools.brain_upsert.execute(input, ctx);
		expect(first).toMatchObject({ ok: false, error: "rules_required" });
		expect(upsert).not.toHaveBeenCalled();
		const revision = (first as { rules: { revision: string } }).rules.revision;
		const second = await tools.brain_upsert.execute({ ...input, rulesRevision: revision }, ctx);
		expect(second).toMatchObject({ ok: true });
		expect((upsert.mock.calls[0] as unknown[])[0]).not.toHaveProperty("rulesRevision");
	});

	it("el agente no escribe una 00-plantilla ni una 00-reglas, sin armar el proveedor", async () => {
		const { tools, upsert, providerFactory } = setup();
		for (const slug of ["comercial/00-plantilla", "comercial/00-reglas", "00-reglas"]) {
			const result = await tools.brain_upsert.execute({ ...input, slug }, ctx);
			expect(result).toMatchObject({ ok: false, error: "reserved_slug" });
			expect((result as { message: string }).message).toContain("proponé el cambio en la conversación");
		}
		expect(providerFactory).not.toHaveBeenCalled();
		expect(upsert).not.toHaveBeenCalled();
	});

	it("un miembro no recibe las reglas de una ruta que no ve", async () => {
		const tools = createBrainTools(binding, "read", {
			actor: { userId: "ana", role: "tenant_member" },
			provider: () => ({
				search: vi.fn(async () => []),
				read: vi.fn(),
				list: async () => [],
				history: async () => null,
				upsert: vi.fn(),
			}),
			rules: async () => [{ path: "comercial", principal: "members", userId: null, level: "ninguno" }],
			rulesSource,
		});
		const result = await tools.brain_rules.execute({ path: "comercial/nueva" }, {} as never);
		expect(result).toMatchObject({ ok: false, error: "not_found" });
	});
});
```

En `tests/brain/acting-provider.test.ts` (sumar `resolveActingBrain` al import de `@/lib/brain/adapters/acting-provider` y `import { EMPTY_RULES } from "@/lib/brain/core/rules-source";`):

```ts
describe("resolveActingBrain", () => {
	it("sin actor devuelve el proveedor y la fuente de reglas tal cual", async () => {
		const provider = raw();
		const acting = await resolveActingBrain(binding, undefined, {
			provider: () => provider,
			rulesSource: () => EMPTY_RULES,
		});
		expect(acting.provider).toBe(provider);
		expect(acting.rules).toBe(EMPTY_RULES);
	});

	it("un miembro recibe las reglas filtradas por lo que ve", async () => {
		const acting = await resolveActingBrain(
			binding,
			{ userId: "ana", role: "tenant_member" },
			{ provider: () => raw(), rules: async () => closeDireccion, rulesSource: () => EMPTY_RULES },
		);
		await expect(acting.rules.cascade("direccion/x")).rejects.toMatchObject({ code: "not_found" });
		await expect(acting.rules.cascade("comercial/x")).resolves.toMatchObject({ revision: "" });
	});
});
```

En `tests/agents/running-tool.test.ts`, dentro del `describe` de `runningToolLabel` (o al final si no hay uno):

```ts
	it("brain_rules tiene su etiqueta en castellano", () => {
		expect(runningToolLabel("brain_rules")).toBe("Leyendo las reglas del brain");
	});
```

- [ ] **Step 3: Correrlos y ver que fallan**

Run: `npx vitest run tests/brain/tools.test.ts tests/brain/acting-provider.test.ts tests/agents/running-tool.test.ts`
Expected: FAIL: no hay `brain_rules`, `resolveActingBrain` no existe y la etiqueta cae en "Trabajando".

- [ ] **Step 4: Implementar `acting-provider.ts`**

Sumar `type Principal` al import que ya existe de `../core/access/types.ts` (queda `import { type AccessRule, isAdminRole, type Principal } from "../core/access/types.ts";`) y los imports nuevos:

```ts
import { resolveAccess } from "../core/access/resolve-access.ts";
import { type RulesSource, withRulesAccess } from "../core/rules-source.ts";
import { getBrainRules } from "./rules.ts";
```

Reemplazar `resolveActingProvider` por:

```ts
interface ActingDeps {
	provider?: (binding: BrainBinding) => BrainProvider;
	rules?: (tenantId: string) => Promise<AccessRule[]>;
	rulesSource?: (binding: BrainBinding) => RulesSource;
}

// Solo un miembro común depende de las reglas. Si no se pueden cargar, la
// excepción sale: se falla cerrado.
async function actingAccess(
	binding: BrainBinding,
	actor: BrainActor,
	deps: ActingDeps,
): Promise<{ principal: Principal; rules: AccessRule[] }> {
	const rules = isAdminRole(actor.role)
		? []
		: await (deps.rules ?? loadAccessRules)(binding.tenantId);
	return {
		principal: { kind: "user", userId: actor.userId, role: actor.role },
		rules,
	};
}

export async function resolveActingProvider(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: ActingDeps = {},
): Promise<BrainProvider> {
	const provider = (deps.provider ?? getBrainProvider)(binding);
	if (!actor) return provider;
	const access = await actingAccess(binding, actor, deps);
	return withAccess(provider, access.principal, access.rules);
}

// Las reglas que le llegan a quien actúa (spec etapa 26 §4.2): filtradas por
// lo que ve. Sin persona, el agente las ve todas.
export async function resolveActingRules(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: Pick<ActingDeps, "rules" | "rulesSource"> = {},
): Promise<RulesSource> {
	const source = (deps.rulesSource ?? getBrainRules)(binding);
	if (!actor) return source;
	const access = await actingAccess(binding, actor, deps);
	return withRulesAccess(source, (path) =>
		resolveAccess(access.rules, access.principal, path),
	);
}

// Proveedor y reglas con una sola carga de las reglas de acceso.
export async function resolveActingBrain(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: ActingDeps = {},
): Promise<{ provider: BrainProvider; rules: RulesSource }> {
	const provider = (deps.provider ?? getBrainProvider)(binding);
	const source = (deps.rulesSource ?? getBrainRules)(binding);
	if (!actor) return { provider, rules: source };
	const access = await actingAccess(binding, actor, deps);
	return {
		provider: withAccess(provider, access.principal, access.rules),
		rules: withRulesAccess(source, (path) =>
			resolveAccess(access.rules, access.principal, path),
		),
	};
}
```

- [ ] **Step 5: Implementar `tools.ts`**

Reemplazar los imports y `BrainToolOptions` por:

```ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import type { AccessRule } from "../core/access/types.ts";
import { decideBrainUpsertResponse } from "../core/approval.ts";
import { brainContract } from "../core/contract.ts";
import { agentReservedSlug, toToolError } from "../core/errors.ts";
import type { BrainBinding } from "../core/resolve.ts";
import { isReservedSlug, withoutRoot } from "../core/rules.ts";
import { type RulesSource, requireRules } from "../core/rules-source.ts";
import { assistantCategories } from "../core/skills/package.ts";
import { withoutSkills } from "../core/skills/view.ts";
import type { BrainProvider } from "../core/types.ts";
import {
	type BrainActor,
	resolveActingBrain,
	resolveActingProvider,
	resolveActingRules,
} from "./acting-provider.ts";

// Inyección para tests más el actor (JSON). En producción solo llega `actor`.
interface BrainToolOptions {
	actor?: BrainActor;
	provider?: (binding: BrainBinding) => BrainProvider;
	rules?: (tenantId: string) => Promise<AccessRule[]>;
	rulesSource?: (binding: BrainBinding) => RulesSource;
}
```

En `buildBrainReadTools`, reemplazar `brain_read` por:

```ts
	const brain_read = defineTool({
		description: contract.read.description,
		inputSchema: brainContract(categories).read.input,
		execute: async ({ slug }) => {
			try {
				const acting = await resolveActingBrain(binding, deps.actor, deps);
				const page = await withoutSkills(acting.provider).read(slug);
				// Después de leer: lo que no se ve ya respondió not_found.
				return {
					ok: true as const,
					page,
					rules: withoutRoot(await acting.rules.cascade(slug)),
				};
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	const brain_rules = defineTool({
		description: contract.rules.description,
		inputSchema: brainContract(categories).rules.input,
		execute: async ({ path }) => {
			try {
				const rules = await resolveActingRules(binding, deps.actor, deps);
				return { ok: true as const, rules: await rules.cascade(path) };
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	return { brain_search, brain_read, brain_rules };
```

En `buildBrainUpsertTool`, la descripción pasa a:

```ts
		description: `${contract.upsert.description} Siempre la aprueba un administrador. Vos no escribís páginas 00-reglas ni 00-plantilla: si hace falta un cambio ahí, proponelo en la conversación.`,
```

y el `try` del `execute` a:

```ts
			try {
				// Las reglas son gobierno: las decide una persona (spec etapa 26 D10).
				if (isReservedSlug(input.slug)) throw agentReservedSlug(input.slug);
				const acting = await resolveActingBrain(binding, deps.actor, deps);
				const write = await requireRules(acting.rules, input);
				const result = await withoutSkills(acting.provider).upsert(write, {
					kind: "agent",
					userId,
					sessionId: toolCtx.session.id,
				});
				return { ok: true as const, ...result };
			} catch (error) {
				return toToolError(error);
			}
```

`brain_search` sigue con `resolveActingProvider` (no necesita reglas).

- [ ] **Step 6: Etiqueta e instrucciones de los agentes**

En `lib/agents/running-tool.ts`, en `TOOL_LABELS`, debajo de `brain: "Leyendo el brain",`:

```ts
	brain_rules: "Leyendo las reglas del brain",
```

En `agents/asistente/instructions.md`, sección "# Escribir en el brain", después del primer párrafo:

```md
Antes de crear una página, llamá a `brain_rules` con su ruta; antes de cambiar una, leela con `brain_read`. Las dos te dan las reglas de esa carpeta y el `rulesRevision` que le pasás a `brain_upsert`, así la aprobación no se pide dos veces. Seguí esas reglas al escribir. Las páginas `00-reglas` y `00-plantilla` no las escribís: si hace falta un cambio ahí, proponelo en la conversación.
```

y reemplazar la línea "Si una herramienta devuelve `ok: false`, citá su `message` y no busques otra vía para lograr lo mismo." por:

```md
Si una herramienta devuelve `ok: false`, citá su `message` y no busques otra vía para lograr lo mismo. La excepción es `rules_required`: leé las reglas que vienen en `rules`, ajustá la página y reintentá una vez con ese `rulesRevision`.
```

En `agents/outreach/instructions.md`, reemplazar la línea 36 ("- Si una herramienta devuelve `ok: false`, …") por:

```md
- Si una herramienta devuelve `ok: false`, citá su `message` y no busques otra vía para lograr lo mismo. La excepción es `rules_required` de `brain_upsert`: leé las reglas que vienen en `rules`, ajustá la página y reintentá una vez con ese `rulesRevision`.
```

- [ ] **Step 7: Correr los tests y ver que pasan**

Run: `npx vitest run tests/brain/tools.test.ts tests/brain/acting-provider.test.ts tests/agents/running-tool.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/brain/adapters/acting-provider.ts lib/brain/adapters/tools.ts lib/agents/running-tool.ts agents/asistente/instructions.md agents/outreach/instructions.md tests/brain/tools.test.ts tests/brain/acting-provider.test.ts tests/agents/running-tool.test.ts
git commit -m "feat: brain_rules y reglas en las tools del brain del agente (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Instrucciones del brain al arrancar el chat

**Files:**
- Create: `lib/brain/adapters/session-instructions.ts`
- Create: `lib/agents/eve/brain-instructions.ts`
- Create: `agents/asistente/instructions/brain.ts`, `agents/outreach/instructions/brain.ts`
- Modify: `supabase/seed-evals.sql`
- Create: `agents/asistente/evals/instrucciones-brain.eval.ts`
- Test: `tests/brain/session-instructions.test.ts` (nuevo)

**Interfaces:**
- Consumes: `resolveActingRules` (Task 8); `formatBrainSession` (Task 6); `resolveBrainBinding(tenantId, load)` y `type BrainConnection` de `lib/brain/core/resolve.ts`; `loadTenantBindings` de `lib/connectors/bindings`; `loadAgentBrainAccess(tenantId, agent): Promise<"none" | "read" | "read_write">` de `lib/brain/adapters/agent-access`; `brainActorFrom(auth)` de `acting-provider.ts`; `attribute(value: unknown): string` de `lib/agents/eve/attribute`.
- Produces:
  - `brainSessionInstructions(tenantId: string, actor: BrainActor | undefined, deps?: { bindings?: (tenantId: string) => Promise<BrainConnection[]>; rulesSource?: (binding: BrainBinding) => RulesSource; rules?: (tenantId: string) => Promise<AccessRule[]> }): Promise<string | null>` (null sin brain o con brain `mcp`).
  - `brainInstructions(agent: string)`: definición `defineDynamic` de instrucciones que corre en `session.started`.

- [ ] **Step 1: Leer las guías de eve**

`node_modules/eve/docs/guides/dynamic-capabilities.md`, sección "Dynamic instructions" (`session.started`, devolver `null` no suma nada, un resolver que tira deja la sesión sin ese bloque), y `node_modules/eve/docs/instructions.mdx`, "Split instructions across a directory" (los archivos de `instructions/` se aplican en orden alfabético: `brain.ts` antes de `tenant.ts`).

- [ ] **Step 2: Escribir el test que falla**

```ts
// tests/brain/session-instructions.test.ts
import { describe, expect, it } from "vitest";
import { brainSessionInstructions } from "@/lib/brain/adapters/session-instructions";
import { createWikiRules } from "@/lib/brain/core/rules-source";

const wikiConnection = {
	id: "b1",
	tenantId: "t1",
	capability: "brain",
	provider: "wiki",
	connectorUid: null,
	config: { categories: ["talento", "direccion"], requiredFrontmatter: [], search: "fts" },
};

const rulesSource = () =>
	createWikiRules({
		tenantId: "t1",
		store: {
			listRulePages: async () => [{ slug: "00-reglas", status: "activo", revision: 1, body: "Tercera persona." }],
			listFolders: async () => [
				{ path: "talento", description: "Personas" },
				{ path: "direccion", description: "Presupuesto" },
			],
		},
	});

describe("brainSessionInstructions", () => {
	it("trae las instrucciones y las carpetas que la persona ve", async () => {
		const text = await brainSessionInstructions(
			"t1",
			{ userId: "ana", role: "tenant_member" },
			{
				bindings: async () => [wikiConnection],
				rulesSource,
				rules: async () => [{ path: "direccion", principal: "members", userId: null, level: "ninguno" }],
			},
		);
		expect(text).toContain("Tercera persona.");
		expect(text).toContain("| talento | Personas |");
		expect(text).not.toContain("direccion");
	});

	it("sin persona (agente desatendido) nombra todas las carpetas", async () => {
		const text = await brainSessionInstructions("t1", undefined, {
			bindings: async () => [wikiConnection],
			rulesSource,
		});
		expect(text).toContain("| direccion | Presupuesto |");
	});

	it("sin brain no hay bloque", async () => {
		expect(await brainSessionInstructions("t1", undefined, { bindings: async () => [], rulesSource })).toBeNull();
	});
});
```

- [ ] **Step 3: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/session-instructions.test.ts`
Expected: FAIL, no se puede resolver `@/lib/brain/adapters/session-instructions`.

- [ ] **Step 4: Implementar**

```ts
// lib/brain/adapters/session-instructions.ts
// Bloque de arranque del brain para el chat (spec etapa 26 §4.3): instrucciones
// de la raíz y carpetas de primer nivel que ve la persona. Lo suman a sus
// instrucciones dinámicas todos los agentes con brain declarado.
import { loadTenantBindings } from "../../connectors/bindings";
import type { AccessRule } from "../core/access/types.ts";
import {
	type BrainBinding,
	type BrainConnection,
	resolveBrainBinding,
} from "../core/resolve.ts";
import type { RulesSource } from "../core/rules-source.ts";
import { formatBrainSession } from "../core/session.ts";
import { type BrainActor, resolveActingRules } from "./acting-provider.ts";

export interface SessionInstructionsDeps {
	bindings?: (tenantId: string) => Promise<BrainConnection[]>;
	rulesSource?: (binding: BrainBinding) => RulesSource;
	rules?: (tenantId: string) => Promise<AccessRule[]>;
}

export async function brainSessionInstructions(
	tenantId: string,
	actor: BrainActor | undefined,
	deps: SessionInstructionsDeps = {},
): Promise<string | null> {
	const binding = await resolveBrainBinding(
		tenantId,
		deps.bindings ?? loadTenantBindings,
	);
	// Un brain externo por MCP no tiene instrucciones ni carpetas propias (D15).
	if (!binding || binding.provider !== "wiki") return null;
	const rules = await resolveActingRules(binding, actor, deps);
	return formatBrainSession(await rules.session());
}
```

```ts
// lib/agents/eve/brain-instructions.ts
// Instrucciones del brain al arrancar la sesión (spec etapa 26 §4.3), para todo
// agente con brain declarado. Cada agente lo monta desde su instructions/brain.ts.
import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { brainActorFrom } from "../../brain/adapters/acting-provider";
import { loadAgentBrainAccess } from "../../brain/adapters/agent-access";
import { brainSessionInstructions } from "../../brain/adapters/session-instructions";
import { attribute } from "./attribute";

export function brainInstructions(agent: string) {
	return defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return null;
				try {
					if ((await loadAgentBrainAccess(tenantId, agent)) === "none")
						return null;
					const content = await brainSessionInstructions(
						tenantId,
						brainActorFrom(auth),
					);
					return content ? defineInstructions({ content }) : null;
				} catch (error) {
					// Es contexto: la sesión arranca igual, y las reglas llegan en
					// brain_read, brain_rules y el rechazo de brain_upsert.
					console.error(`${agent} instructions/brain:`, error);
					return null;
				}
			},
		},
	});
}
```

```ts
// agents/asistente/instructions/brain.ts
// Instrucciones del brain de la empresa, al arrancar (spec etapa 26 §4.3).
import { brainInstructions } from "../../../lib/agents/eve/brain-instructions";

export default brainInstructions("asistente");
```

```ts
// agents/outreach/instructions/brain.ts
// Instrucciones del brain de la empresa, al arrancar (spec etapa 26 §4.3).
import { brainInstructions } from "../../../lib/agents/eve/brain-instructions";

export default brainInstructions("outreach");
```

- [ ] **Step 5: Correr el test y ver que pasa**

Run: `npx vitest run tests/brain/session-instructions.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Seed y eval del criterio de cierre en el chat**

Cargar el skill `supabase-postgres-best-practices`. En `supabase/seed-evals.sql`, en el `insert into public.brain_pages (...) values` del tenant de eval, sumar una fila más antes de `on conflict do nothing;` (separada por coma de la anterior):

```sql
  ('e7a1e7a1-0000-0000-0000-0000000000aa', '00-reglas', 'Instrucciones del brain', 'brain', '{}',
   E'# Instrucciones del brain de eval\n\n- Las páginas se escriben en tercera persona.\n- Las fechas van en formato AAAA-MM-DD.')
```

(la página es de la raíz: el `brain_ensure_folders` de abajo la saltea porque no tiene `/`).

```ts
// agents/asistente/evals/instrucciones-brain.eval.ts
import { defineEval } from "eve/evals";

// Criterio de cierre 2 de la etapa 26 en el chat: las instrucciones del brain
// llegan en session.started, sin que el agente las busque.
export default defineEval({
	description:
		"Nombra las instrucciones del brain sin haber llamado a ninguna tool.",
	async test(t) {
		const run = await t.send(
			"¿Qué instrucciones del brain tenés que seguir al escribir en esta empresa?",
		);
		t.succeeded();
		t.notCalledTool("brain_search");
		t.notCalledTool("brain_read");
		t.notCalledTool("brain_rules");
		t.judge(
			"La respuesta dice que las páginas se escriben en tercera persona y que las fechas van en formato AAAA-MM-DD, o algo equivalente.",
			{ on: run.message },
		).atLeast(0.7);
	},
});
```

La eval no se corre en esta tarea: gasta modelo. Queda para el cierre (paso manual).

- [ ] **Step 7: Verificar el build de los agentes**

Desde `agents/asistente` y después desde `agents/outreach`:

Run: `PUBLIC_APP_URL=https://agentes.innov.as NEXT_PUBLIC_SUPABASE_URL=https://ref.supabase.co node ../../node_modules/eve/bin/eve.js build`
Expected: build sin errores y sin avisos de un resolver de instrucciones descartado. Borrar el `.output` de cada carpeta.

- [ ] **Step 8: Commit**

```bash
git add lib/brain/adapters/session-instructions.ts lib/agents/eve/brain-instructions.ts agents/asistente/instructions/brain.ts agents/outreach/instructions/brain.ts supabase/seed-evals.sql agents/asistente/evals/instrucciones-brain.eval.ts tests/brain/session-instructions.test.ts
git commit -m "feat: las instrucciones del brain llegan al arrancar el chat (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Reporte en seco de las páginas reservadas

**Files:**
- Create: `lib/brain/core/rules-report.ts`
- Create: `scripts/brain-rules-report.mts`
- Modify: `package.json` (scripts)
- Test: `tests/brain/rules-report.test.ts` (nuevo)

**Interfaces:**
- Consumes: `folderOfPage`, `isReservedSlug`, `isRulesSlug`, `rulesSlugFor` (Task 1); topes y `RESERVED_LEAVES` (Task 1); `fetchAllRows(load, size?)` de `lib/brain/core/folders-report.ts`; `ancestorChain`.
- Produces:
  - `interface ReportPage { slug: string; status: BrainStatus; body: string }`, `interface TenantReservedPages { tenant: string; pages: ReportPage[] }`.
  - `rulesReport(pages: readonly ReportPage[]): { reserved: Array<{ slug: string; status: BrainStatus; chars: number }>; gated: string[]; overLimit: Array<{ slug: string; chars: number; limit: number }>; cascadeOver: Array<{ path: string; chars: number }>; underReserved: string[] }`.
  - `renderRulesReport(tenants: TenantReservedPages[]): { text: string; warnings: boolean }`.
  - `npm run brain:rules-report [-- --tenant <slug>]`, solo lectura.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/rules-report.test.ts
import { describe, expect, it } from "vitest";
import { renderRulesReport, rulesReport } from "@/lib/brain/core/rules-report";

const page = (slug: string, chars = 10, status: "activo" | "archivado" = "activo") => ({
	slug,
	status,
	body: "x".repeat(chars),
});

describe("rulesReport", () => {
	it("lista las reservadas y las carpetas que van a pedir rulesRevision", () => {
		const r = rulesReport([
			page("talento/personal/00-reglas"),
			page("talento/personal/00-plantilla"),
			page("comercial/00-reglas", 10, "archivado"),
		]);
		expect(r.reserved.map((p) => p.slug)).toEqual([
			"talento/personal/00-reglas",
			"talento/personal/00-plantilla",
			"comercial/00-reglas",
		]);
		expect(r.gated).toEqual(["talento/personal"]);
	});

	it("marca las que pasan su tope y las cascadas de más de 40 000", () => {
		const r = rulesReport([
			page("00-reglas", 12_001),
			page("talento/00-reglas", 20_000),
			page("talento/personal/00-reglas", 9_000),
		]);
		expect(r.overLimit).toEqual([{ slug: "00-reglas", chars: 12_001, limit: 12_000 }]);
		expect(r.cascadeOver).toEqual([{ path: "talento/personal", chars: 41_001 }]);
	});

	it("nombra las páginas que cuelgan de una reservada", () => {
		expect(rulesReport([page("x/00-reglas/y")]).underReserved).toEqual(["x/00-reglas/y"]);
	});
});

describe("renderRulesReport", () => {
	it("avisa cuando hay algo para mirar antes del deploy", () => {
		const quiet = renderRulesReport([{ tenant: "a", pages: [page("t/00-reglas")] }]);
		expect(quiet.warnings).toBe(false);
		expect(quiet.text).toContain("== a ==");
		expect(quiet.text).toContain("t");
		const loud = renderRulesReport([{ tenant: "b", pages: [page("00-reglas", 12_001)] }]);
		expect(loud.warnings).toBe(true);
		expect(loud.text).toContain("ATENCIÓN");
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/rules-report.test.ts`
Expected: FAIL, no se puede resolver `@/lib/brain/core/rules-report`.

- [ ] **Step 3: Implementar**

```ts
// lib/brain/core/rules-report.ts
// Qué páginas reservadas ya existen antes de desplegar la 26.2 (spec etapa 26
// §4.1). Puro: lo usa scripts/brain-rules-report.mts. Nada bloquea el deploy:
// una 00-reglas de más se sigue leyendo y falla recién al escribirla.
import { ancestorChain } from "./access/resolve-access.ts";
import { ROOT_PATH } from "./access/types.ts";
import {
	folderOfPage,
	isReservedSlug,
	isRulesSlug,
	rulesSlugFor,
} from "./rules.ts";
import {
	type BrainStatus,
	MAX_CASCADE_CHARS,
	MAX_FOLDER_RULES_CHARS,
	MAX_ROOT_RULES_CHARS,
	RESERVED_LEAVES,
} from "./types.ts";

export interface ReportPage {
	slug: string;
	status: BrainStatus;
	body: string;
}

export interface TenantReservedPages {
	tenant: string;
	pages: ReportPage[];
}

const label = (folder: string) => (folder === ROOT_PATH ? "(raíz)" : folder);

export function rulesReport(pages: readonly ReportPage[]) {
	const reserved = pages.filter((p) => isReservedSlug(p.slug));
	const active = reserved.filter(
		(p) => p.status === "activo" && isRulesSlug(p.slug),
	);
	const sizes = new Map(active.map((p) => [p.slug, p.body.length]));
	const limitOf = (slug: string) =>
		folderOfPage(slug) === ROOT_PATH
			? MAX_ROOT_RULES_CHARS
			: MAX_FOLDER_RULES_CHARS;
	return {
		reserved: reserved.map((p) => ({
			slug: p.slug,
			status: p.status,
			chars: p.body.length,
		})),
		// Desde el deploy, brain_upsert por MCP y del agente pide rulesRevision
		// en estas carpetas y en todo lo que cuelga.
		gated: active.map((p) => label(folderOfPage(p.slug))),
		overLimit: active
			.filter((p) => p.body.length > limitOf(p.slug))
			.map((p) => ({
				slug: p.slug,
				chars: p.body.length,
				limit: limitOf(p.slug),
			})),
		cascadeOver: active
			.map((p) => {
				const folder = folderOfPage(p.slug);
				const chars = ancestorChain(folder).reduce(
					(sum, node) => sum + (sizes.get(rulesSlugFor(node)) ?? 0),
					0,
				);
				return { path: label(folder), chars };
			})
			.filter((c) => c.chars > MAX_CASCADE_CHARS),
		// x/00-reglas/y: el árbol trata a la reservada como carpeta.
		underReserved: pages
			.filter((p) =>
				p.slug
					.split("/")
					.slice(0, -1)
					.some((segment) =>
						(RESERVED_LEAVES as readonly string[]).includes(segment),
					),
			)
			.map((p) => p.slug),
	};
}

function section(title: string, items: string[]) {
	return [`  ${title} (${items.length}):`, ...items.map((i) => `    ${i}`)];
}

export function renderRulesReport(tenants: TenantReservedPages[]): {
	text: string;
	warnings: boolean;
} {
	const out: string[] = [];
	let warnings = false;
	for (const t of tenants) {
		const r = rulesReport(t.pages);
		const flagged =
			r.overLimit.length + r.cascadeOver.length + r.underReserved.length;
		if (flagged > 0) warnings = true;
		out.push(
			`== ${t.tenant} ==`,
			...section(
				"Páginas reservadas",
				r.reserved.map((p) => `${p.slug} · ${p.status} · ${p.chars} caracteres`),
			),
			...section("Carpetas que van a pedir rulesRevision", r.gated),
			...section(
				"ATENCIÓN: pasan su tope (se leen igual; la próxima escritura tiene que acortarlas)",
				r.overLimit.map((p) => `${p.slug}: ${p.chars} de ${p.limit}`),
			),
			...section(
				"ATENCIÓN: cascadas de más de 40000 caracteres",
				r.cascadeOver.map((c) => `${c.path}: ${c.chars}`),
			),
			...section(
				"ATENCIÓN: páginas que cuelgan de una reservada",
				r.underReserved,
			),
			"",
		);
	}
	out.push(
		warnings
			? "RESULTADO: hay páginas reservadas para revisar antes del deploy. No bloquean."
			: "RESULTADO: nada para revisar.",
	);
	return { text: out.join("\n"), warnings };
}
```

```ts
// scripts/brain-rules-report.mts
// Reporte en seco de las páginas reservadas antes de desplegar la 26.2 (spec
// etapa 26 §4.1). Solo lee: únicamente SELECT. Sin --tenant recorre todas.
//   npm run brain:rules-report
//   npm run brain:rules-report -- --tenant okeefe
// Contra producción lo corre una persona con un env file de producción:
//   node --env-file=<archivo> scripts/brain-rules-report.mts
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../lib/brain/core/folders-report.ts";
import {
	type ReportPage,
	renderRulesReport,
	type TenantReservedPages,
} from "../lib/brain/core/rules-report.ts";

const flag = process.argv.indexOf("--tenant");
const only = flag === -1 ? null : process.argv[flag + 1];
if (flag !== -1 && !only) {
	console.error("Uso: npm run brain:rules-report [-- --tenant <slug>]");
	process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
	console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
	process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

function fail(what: string, error: { message?: string } | null): never {
	console.error(`No pude ${what}: ${error?.message ?? "error desconocido"}.`);
	process.exit(1);
}

let query = db.from("tenants").select("id, slug").order("slug");
if (only) query = query.eq("slug", only);
const { data: tenants, error: tenantsError } = await query;
if (tenantsError) fail("leer los tenants", tenantsError);
if (!tenants || tenants.length === 0) {
	console.error(only ? `No existe el tenant ${only}.` : "No hay tenants.");
	process.exit(1);
}

const loaded: TenantReservedPages[] = [];
for (const tenant of tenants) {
	const { data: binding, error: bindingError } = await db
		.from("tenant_connections")
		.select("id")
		.eq("tenant_id", tenant.id)
		.eq("capability", "brain")
		.eq("provider", "wiki")
		.maybeSingle();
	if (bindingError) fail(`leer el brain de ${tenant.slug}`, bindingError);
	if (!binding) continue;
	const pages: ReportPage[] = [];
	for (const leaf of ["00-reglas", "00-plantilla"]) {
		// PostgREST corta en 1000 filas: se pagina y se compara con el conteo exacto.
		const rows = await fetchAllRows(async (from, to) => {
			const { data, error } = await db
				.from("brain_pages")
				.select("slug, status, body")
				.eq("tenant_id", tenant.id)
				.like("slug", `%${leaf}%`)
				.order("slug")
				.range(from, to);
			if (error) fail(`leer las páginas ${leaf} de ${tenant.slug}`, error);
			return (data ?? []) as ReportPage[];
		});
		const { count, error: countError } = await db
			.from("brain_pages")
			.select("slug", { count: "exact", head: true })
			.eq("tenant_id", tenant.id)
			.like("slug", `%${leaf}%`);
		if (countError) fail(`contar las páginas ${leaf} de ${tenant.slug}`, countError);
		if (count !== rows.length) {
			console.error(
				`Leí ${rows.length} páginas ${leaf} de ${tenant.slug} pero hay ${count}. El reporte no es confiable; no lo uses.`,
			);
			process.exit(1);
		}
		for (const row of rows)
			if (!pages.some((p) => p.slug === row.slug)) pages.push(row);
	}
	loaded.push({ tenant: tenant.slug, pages });
}

console.log(renderRulesReport(loaded).text);
```

En `package.json`, debajo de `"brain:folders-report"`:

```json
    "brain:rules-report": "node --env-file=.env.local scripts/brain-rules-report.mts",
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run tests/brain/rules-report.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS. Con Docker abierto y la base local levantada, `npm run brain:rules-report` imprime una sección por tenant y termina con `RESULTADO`. No se corre contra producción en esta tarea.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/rules-report.ts scripts/brain-rules-report.mts package.json tests/brain/rules-report.test.ts
git commit -m "feat: reporte en seco de las páginas reservadas del brain (26.2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Documentación y cierre de la rama

**Files:**
- Modify: `docs/dominios/brain.md`, `lib/brain/README.md`, `docs/producto/roadmap.md`, `docs/_meta/cobertura.ts` (solo si el check lo pide)
- Regenerate: `docs/referencia/` con `npm run docs:sync`

- [ ] **Step 1: Regenerar la referencia y ver qué falta**

Run: `npm run docs:sync && npm run docs:check`
Expected: si falla, nombra lo que no tiene página (por ejemplo el script `brain:rules-report`). La regla es escribir la página, no sumar una exclusión.

- [ ] **Step 2: Documentar**

En `docs/dominios/brain.md`, después de "### Carpetas (etapa 26.1a)", una sección "### Instrucciones y reglas (etapa 26.2a)" con:
- las páginas reservadas (`00-reglas` en la raíz y en cada carpeta, `00-plantilla` reservada para la 26.3), la categoría `brain` y los topes 12 000 / 20 000 / 40 000;
- la cascada (`rulesFor`): raíz primero, solo `activo`, una `00-reglas` no se gobierna a sí misma, la revisión de 16 hex;
- por dónde llegan: `instructions` del MCP y `session.started` del chat (`brainSessionInstructions`), `rules` en `brain_read` sin la raíz, `brain_rules` con la cascada completa, `rules_required` en `brain_upsert` (cuenta como lectura en `brain_mcp_usage`);
- quién exige `rulesRevision` (el MCP y las tools del agente) y quién no (editor web, import, seeds);
- los permisos: escribir una reservada exige administrar su carpeta; el agente del chat nunca (`reserved_slug`); las reglas se filtran por la ruta pedida;
- el reporte en seco `npm run brain:rules-report`.

En la tabla de archivos de esa página sumar `core/rules.ts`, `core/rules-source.ts`, `core/session.ts`, `core/rules-report.ts`, `adapters/rules.ts`, `adapters/session-instructions.ts` y `lib/agents/eve/brain-instructions.ts`. En `lib/brain/README.md`, sumar las mismas piezas donde lista los módulos de `core/` y `adapters/`.

En `docs/producto/roadmap.md`, debajo de la entrega 26.2, anotar: la 26.2a no tiene migraciones; antes del deploy, correr `npm run brain:rules-report` sin `--tenant` con el env de producción; después del deploy, verificar la lista real de tools del agente en producción (memoria del repo: una tool nueva puede quedar invisible); la 26.2b (pantallas) queda pendiente.

En `docs/decisiones/README.md`, la fila de la Etapa 26 ya enlaza este plan: dejarla `en curso`.

- [ ] **Step 3: Verificar todo**

Run: `npm run lint:fix && git status --short`
Revertir con `git checkout -- <archivo>` cada archivo que aparezca modificado y que ninguna tarea de este plan tocó.

Run: `npm run docs:check && npm run typecheck && npm test`
Expected: todo en verde.

- [ ] **Step 4: Commit**

```bash
git add docs lib/brain/README.md
git commit -m "docs: instrucciones y reglas del brain en la wiki y orden de despliegue de la 26.2a

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Cierre (lo hace una persona después del merge)

1. Eval local: con Docker abierto, `npm run db:reset` (carga `seed-evals.sql`) y `npm run evals` para `agents/asistente/evals/instrucciones-brain.eval.ts`. Gasta modelo: lo decide una persona.
2. `npm run brain:rules-report` sin `--tenant` con el env de producción. Revisar las secciones ATENCIÓN y anotar qué carpetas van a empezar a pedir `rulesRevision` (en `okeefe`, `talento/personal`).
3. No hay migraciones: se despliega el código. Verificar en un hilo nuevo del asistente y de outreach en producción que `brain_rules` aparece en su lista de tools.
4. Trabajo con O'Keefe (spec §8, D16), por una persona con Claude Code por MCP como administradora de la raíz: fundir `operacion/agent` y `operacion/brain` en la `00-reglas` de la raíz (hasta 12 000 caracteres), sacar lo que ahora hace la plataforma y archivar `operacion/roles-brain`, `operacion/identidad-verificada`, `operacion/instrucciones-proyecto` y `operacion/agent` con un aviso que apunte a `00-reglas`. `talento/personal/00-reglas` queda como está.
5. Criterio de cierre 2 (spec §1.2): por MCP, `brain_upsert` en `talento/personal/<x>` sin `rulesRevision` se rechaza con `rules_required` y trae la raíz más `talento/personal/00-reglas`; el reintento con el valor devuelto entra. En el chat, el asistente nombra las instrucciones del brain sin llamar a ninguna tool.
6. QA en navegador (no la pueden hacer los subagentes): en el editor, un miembro editor que no administra `talento/personal` intenta guardar `talento/personal/00-reglas` y ve el mensaje de a quién pedírselo. Hasta la 26.2b, el árbol muestra `00-reglas` como una página más.

## Planes siguientes

**26.2b · Reglas en el editor (pantallas).** Spec §4.1 y §4.3, la parte web:
- Panel "Reglas que aplican", colapsable, al lado del editor y en "Nueva página": la cascada con un link a cada `00-reglas`, informativo (no exige nada a las personas). Lee de `getBrainRules` con `withRulesAccess`.
- El árbol no lista las reservadas como páginas: arriba del árbol, para el administrador de la raíz, "Instrucciones del brain" (crea o abre la `00-reglas` de la raíz); en el menú de una carpeta, para su administrador, "Reglas de la carpeta"; la carpeta muestra un indicador cuando tiene reglas.
- La búsqueda las encuentra con la insignia "Reglas".
- Crear la `00-reglas` de la raíz desde la web (hoy solo por MCP o con un administrador del tenant).
- QA en navegador a 375 px.

Después: 26.1b (mover y renombrar, spec §3.3) y 26.3 (estructura obligatoria, spec §5), que llena `fields` y `template` en la cascada y suma `invalid_rules` e `invalid_fields`.
