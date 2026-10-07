# Etapa 17.2 · Permisos del brain — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el acceso al brain lo decidan reglas por carpeta y por página (con herencia hacia abajo), aplicadas en un único punto de control para el editor web, el endpoint MCP y el agente en el chat, y que un miembro ya no pueda leer las tablas del brain por la API de Supabase.

**Architecture:** Funciones puras de resolución de permisos y un envoltorio `withAccess(provider, principal, reglas)` en `lib/brain/core/access/`. Las reglas viven en una tabla nueva `brain_access_rules`, solo legible con service role, y se cargan por operación. Las tres superficies construyen su proveedor envuelto con el principal de la persona. Se revoca el `select` de `authenticated` sobre `brain_pages` y `brain_revisions`.

**Tech Stack:** TypeScript, Next.js (App Router), Supabase (Postgres, pgTAP), Vitest, Biome, `@modelcontextprotocol/sdk`, eve (solo en `adapters`).

**Spec:** `docs/superpowers/specs/2026-10-05-etapa-17-permisos-brain-design.md` §3 (modelo), §4 (base de datos), §5 (punto de control y superficies), §8 (entrega 17.2). La 17.1 (aislamiento) ya está mergeada en `main` (PR 73).

## Global Constraints

- Tres niveles: `lector`, `editor`, `administrador` (spec A1).
- **En el chat, el agente actúa en nombre de la persona** que inició la sesión; en corridas desatendidas usa su propia declaración (A2).
- **La raíz nace abierta:** `todos los miembros → lector` (A3). Un tenant sin la fila de la raíz sigue leyendo: la ausencia se trata como `lector`.
- **Un solo punto de control en código**, `withAccess`. Se revoca el `select` de `authenticated` sobre `brain_pages` y `brain_revisions` (A4).
- Lo invisible responde **`not_found`**, nunca `forbidden`; `forbidden` queda para lo visible sin permiso (A8).
- `platform_admin` y `tenant_admin` son administradores de todo sin mirar reglas (A9).
- Falla cerrada: si no se pueden cargar las reglas, la operación falla; nunca se trata como "sin reglas".
- Toda tabla lleva `tenant_id` y RLS. `events` es append-only. Nada específico de un tenant en código.
- `lib/brain/core` no importa nada fuera de `lib/brain/core`, salvo `zod`, `yaml`, `@modelcontextprotocol/sdk/*`, `node:*` y, solo como `import type`, `@supabase/supabase-js`. Lo vigila `tests/brain/boundary.test.ts`. Los imports relativos dentro de `core/access/` llevan extensión `.ts` (los scripts con Node directo recorren esa cadena).
- Código e identificadores en inglés; mensajes, comentarios y UI en español rioplatense.
- Commits con prefijo `feat:` / `fix:` / `refactor:` / `test:` / `docs:` y el trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No correr `npm run lint:fix` sobre todo el repo (reformatea archivos ajenos). Formatear solo los archivos que se editan, con `npx biome check --write <archivos>`; si Biome reformatea código ajeno al cambio o inserta una línea en blanco entre un comentario de cabecera y los imports, revertir ese hunk.
- Antes de tocar SQL se cargó `supabase-postgres-best-practices`: columnas con clave foránea llevan índice; RLS habilitada sin políticas y `revoke all` a `anon` y `authenticated` para lo que solo escribe el servidor.

## Desvíos respecto de la spec

1. **`visibleTree` y `explainAccess` pasan a la 17.3.** Solo los consume el árbol y el diálogo de compartir; no tienen llamador en esta entrega.
2. **`AccessRulesStore` tiene solo `load` en la 17.2.** `set`, `remove` y el evento `brain.access_changed` llegan con las acciones del diálogo, en la 17.3.
3. **Crear una página exige `editor` sobre el propio slug**, no solo sobre su carpeta. Es lo mismo salvo cuando hay una regla sobre el slug exacto, y evita que un conflicto revele una página oculta.
4. **`withAccess` devuelve el proveedor sin envolver para toda persona que no sea `tenant_member`**, además de agente, plataforma e import. Es la consecuencia de A9 y evita consultas de reglas para administradores.
5. **`read` filtrado nunca devuelve sugerencias:** `not_found` de una página oculta y de una inexistente tienen la misma forma (`suggestions: []`). Un miembro pierde las sugerencias de "quizás quisiste decir"; a cambio no hay forma de distinguir lo oculto de lo que no existe.
6. **`TenantAccess` suma `userId`**, que el editor necesita para armar el principal.
7. **`canEdit` del contexto del editor queda grueso** (`editor` o más sobre la raíz). El permiso por nodo en la interfaz llega con el árbol de la 17.3; mientras tanto la página de edición, el botón "Editar" y el de restaurar se deciden por el slug de la página (`ctx.access(slug)`), y el guardado lo decide el proveedor.
8. **`createSupabaseAccessRulesStore` vive en `core`** (como `wiki-store.ts`, con el cliente inyectado), y `adapters/access-rules.ts` solo lo cablea con el cliente admin.

## Review Focus

Entradas y condiciones que la spec insinúa y ninguna tarea cubriría sola. Cada línea tiene su prueba en la tarea indicada.

1. **No hay oráculo de existencia.** Pedir una página oculta y una inexistente devuelve exactamente la misma respuesta, y una escritura no confirma que un slug oculto existe. Prueba: Tarea 2.
2. **La búsqueda no filtra páginas ocultas** ni siquiera como snippet, y respeta el límite pedido aunque el proveedor devuelva páginas que se descartan. Prueba: Tarea 2.
3. **Un tenant sin fila de raíz sigue leyendo, y si las reglas no se pueden cargar la operación falla** en vez de abrirse. Prueba: Tareas 1 y 3.
4. **En el chat, el permiso es el de quien inició la sesión:** un miembro sin `editor` recibe `forbidden` en `brain_upsert` aunque un administrador apruebe, y el agente desatendido no cambia. Prueba: Tarea 8.
5. **Un administrador conserva el acceso con reglas restrictivas** (raíz `ninguno`) y un `tenant_member` sin membresía no llega a la fila de reglas. Prueba: Tareas 1 y 6.
6. **Ninguna pantalla del editor arma su propio proveedor sin envolver** (índice con búsqueda, 404 con sugerencias): todo pasa por `ctx.provider`. Prueba: Tarea 7, con un chequeo de `grep` y el test de la cadena real.

## Mapa de archivos

Nuevos:

```
lib/brain/core/access/
├── types.ts            Level, RuleLevel, ROOT_PATH, atLeast, maxLevel, Principal, AccessRule, AccessRulesStore, DEFAULT_ROOT_RULE
├── resolve-access.ts   parentPath, ancestorChain, resolveAccess
├── with-access.ts      withAccess
└── rules-store.ts      createSupabaseAccessRulesStore (load)
lib/brain/adapters/access-rules.ts      accessRulesStore(), loadAccessRules()
lib/brain/adapters/acting-provider.ts   BrainActor, brainActorFrom, resolveActingProvider
supabase/migrations/20261007120000_brain_access_rules.sql
supabase/tests/21_brain_access_rules.test.sql
scripts/connections-bind-rule.ts        rootRuleRow
tests/brain/access-resolve.test.ts
tests/brain/access-with-access.test.ts
tests/brain/access-rules-store.test.ts
tests/brain/editor-access.test.ts
tests/brain/acting-provider.test.ts
tests/scripts/connections-bind-rule.test.ts
```

Modificados: `lib/brain/core/mcp-server/{access,handler,server}.ts`, `lib/brain/core/editor/save.ts`, `lib/brain/adapters/{editor,tools,mcp-production}.ts`, `lib/tenants/resolve.ts`, `agents/outreach/tools/brain.ts`, `scripts/connections-bind.mts`, `app/[tenant]/brain/actions.ts`, páginas `app/[tenant]/brain/{page.tsx,p/[...slug]/page.tsx,editar/[...slug]/page.tsx,historial/[...slug]/page.tsx}`, `supabase/tests/08_brain_tables.test.sql`, tests existentes de MCP, tools, guardado y editor, `lib/brain/README.md`, `docs/01-roadmap-etapas.md`.

---

### Tarea 0: Preparar el worktree (sin commit)

**Files:** ninguno.

- [ ] **Step 1: Instalar dependencias**

El worktree no tiene `node_modules`.

Run: `npm ci`
Expected: termina sin errores.

- [ ] **Step 2: Línea base verde**

Run: `npm run typecheck && npx vitest run tests/brain tests/agents tests/outreach/canon.test.ts`
Expected: typecheck limpio y todos los tests en verde. Si algo falla acá, frenar y reportarlo: no es de esta entrega.

- [ ] **Step 3: Ver si hay base local**

Run: `docker ps --format '{{.Names}}' | head -3`
Expected: lista de contenedores. La Tarea 4 corre `npm run db:test`, que necesita Docker y la base local. Si no hay, anotarlo: la Tarea 4 queda pendiente de esa verificación y no se da por terminada.

---

### Tarea 1: Modelo de permisos y `resolveAccess`

**Files:**
- Create: `lib/brain/core/access/types.ts`, `lib/brain/core/access/resolve-access.ts`
- Test: `tests/brain/access-resolve.test.ts`

**Interfaces:**
- Produces, en `types.ts`:

```ts
export type Level = "lector" | "editor" | "administrador";
export type RuleLevel = Level | "ninguno";
export const ROOT_PATH = "";
export function atLeast(level: Level | null, minimum: Level): boolean;
export function maxLevel(a: Level | null, b: Level | null): Level | null;
export type Principal =
  | { kind: "user"; userId: string; role: BrainRole }
  | { kind: "agent"; agent: string }
  | { kind: "platform" }
  | { kind: "import" };
export interface AccessRule { path: string; principal: "user" | "members"; userId: string | null; level: RuleLevel }
export interface AccessRulesStore { load(tenantId: string): Promise<AccessRule[]> }
export const DEFAULT_ROOT_RULE: AccessRule; // { path: "", principal: "members", userId: null, level: "lector" }
```

- Produces, en `resolve-access.ts`:

```ts
export function parentPath(path: string): string | null;          // "a/b" → "a" → "" → null
export function ancestorChain(path: string): string[];            // raíz primero: "a/b" → ["", "a", "a/b"]
export function resolveAccess(rules: AccessRule[], principal: Principal, path: string): Level | null;
```

- [ ] **Step 1: Escribir el test que falla**

`tests/brain/access-resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	ancestorChain,
	parentPath,
	resolveAccess,
} from "@/lib/brain/core/access/resolve-access";
import {
	type AccessRule,
	atLeast,
	DEFAULT_ROOT_RULE,
	type Level,
	maxLevel,
	type Principal,
} from "@/lib/brain/core/access/types";

const member = (userId: string): Principal => ({
	kind: "user",
	userId,
	role: "tenant_member",
});
const general = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const person = (path: string, userId: string, level: Level): AccessRule => ({
	path,
	principal: "user",
	userId,
	level,
});

describe("parentPath y ancestorChain", () => {
	it("sube de a un segmento hasta la raíz", () => {
		expect(parentPath("a/b/c")).toBe("a/b");
		expect(parentPath("a")).toBe("");
		expect(parentPath("")).toBeNull();
	});

	it("la cadena empieza en la raíz y termina en el nodo", () => {
		expect(ancestorChain("a/b/c")).toEqual(["", "a", "a/b", "a/b/c"]);
		expect(ancestorChain("a")).toEqual(["", "a"]);
		expect(ancestorChain("")).toEqual([""]);
	});
});

describe("niveles", () => {
	it("atLeast compara por orden y trata null como sin acceso", () => {
		expect(atLeast("administrador", "editor")).toBe(true);
		expect(atLeast("editor", "editor")).toBe(true);
		expect(atLeast("lector", "editor")).toBe(false);
		expect(atLeast(null, "lector")).toBe(false);
	});

	it("maxLevel elige el mayor y respeta null", () => {
		expect(maxLevel("lector", "editor")).toBe("editor");
		expect(maxLevel(null, "lector")).toBe("lector");
		expect(maxLevel(null, null)).toBeNull();
	});
});

// Los casos de la spec §3.3.
describe("resolveAccess · tabla de la spec", () => {
	const cases: Array<{
		name: string;
		rules: AccessRule[];
		principal: Principal;
		path: string;
		expected: Level | null;
	}> = [
		{
			name: "raíz abierta, miembro sin reglas",
			rules: [general("", "lector")],
			principal: member("ana"),
			path: "comercial/icp",
			expected: "lector",
		},
		{
			name: "carpeta restringida oculta lo de adentro",
			rules: [general("", "lector"), general("direccion", "ninguno")],
			principal: member("ana"),
			path: "direccion/presupuesto",
			expected: null,
		},
		{
			name: "una persona con lectura en la carpeta restringida la ve",
			rules: [
				general("", "lector"),
				general("direccion", "ninguno"),
				person("direccion", "cecilia", "lector"),
			],
			principal: member("cecilia"),
			path: "direccion/presupuesto",
			expected: "lector",
		},
		{
			name: "y ve la carpeta misma",
			rules: [
				general("", "lector"),
				general("direccion", "ninguno"),
				person("direccion", "cecilia", "lector"),
			],
			principal: member("cecilia"),
			path: "direccion",
			expected: "lector",
		},
		{
			name: "lo dado arriba por persona no se quita abajo",
			rules: [
				person("", "marcos", "editor"),
				general("direccion", "ninguno"),
			],
			principal: member("marcos"),
			path: "direccion/presupuesto",
			expected: "editor",
		},
		{
			name: "el acceso general más profundo gana: editor en comercial",
			rules: [general("", "lector"), general("comercial", "editor")],
			principal: member("ana"),
			path: "comercial/icp",
			expected: "editor",
		},
		{
			name: "y una subcarpeta restringida lo vuelve a cerrar",
			rules: [
				general("", "lector"),
				general("comercial", "editor"),
				general("comercial/interno", "ninguno"),
			],
			principal: member("ana"),
			path: "comercial/interno/notas",
			expected: null,
		},
		{
			name: "raíz cerrada y una página suelta dada a una persona",
			rules: [general("", "ninguno"), person("comercial/icp", "cecilia", "lector")],
			principal: member("cecilia"),
			path: "comercial/icp",
			expected: "lector",
		},
		{
			name: "la carpeta de esa página suelta sigue oculta",
			rules: [general("", "ninguno"), person("comercial/icp", "cecilia", "lector")],
			principal: member("cecilia"),
			path: "comercial",
			expected: null,
		},
		{
			name: "un tenant_admin ve todo aunque la raíz esté cerrada",
			rules: [general("", "ninguno"), general("direccion", "ninguno")],
			principal: { kind: "user", userId: "root", role: "tenant_admin" },
			path: "direccion/presupuesto",
			expected: "administrador",
		},
	];

	it.each(cases)("$name", ({ rules, principal, path, expected }) => {
		expect(resolveAccess(rules, principal, path)).toBe(expected);
	});
});

describe("resolveAccess · bordes", () => {
	it("una regla por persona sobre un slug no abre a sus hermanos", () => {
		const rules = [
			general("", "ninguno"),
			person("direccion/presupuesto", "cecilia", "lector"),
		];
		expect(resolveAccess(rules, member("cecilia"), "direccion/presupuesto")).toBe("lector");
		expect(resolveAccess(rules, member("cecilia"), "direccion/otra")).toBeNull();
		expect(resolveAccess(rules, member("cecilia"), "direccion")).toBeNull();
	});

	it("las reglas de otra persona no cuentan", () => {
		const rules = [general("", "ninguno"), person("direccion", "cecilia", "editor")];
		expect(resolveAccess(rules, member("beto"), "direccion/presupuesto")).toBeNull();
	});

	it("sin ninguna regla de acceso general el tenant sigue leyendo (lector)", () => {
		expect(resolveAccess([], member("ana"), "comercial/icp")).toBe("lector");
		expect(resolveAccess([person("x", "otra", "editor")], member("ana"), "comercial/icp")).toBe("lector");
	});

	it("la regla de la raíz por defecto es lector para todos los miembros", () => {
		expect(DEFAULT_ROOT_RULE).toEqual({
			path: "",
			principal: "members",
			userId: null,
			level: "lector",
		});
	});

	it("un platform_admin con rol de usuario, el agente, la plataforma y el import son administradores", () => {
		const rules = [general("", "ninguno")];
		const principals: Principal[] = [
			{ kind: "user", userId: "root", role: "platform_admin" },
			{ kind: "agent", agent: "outreach" },
			{ kind: "platform" },
			{ kind: "import" },
		];
		for (const principal of principals) {
			expect(resolveAccess(rules, principal, "direccion/presupuesto")).toBe("administrador");
		}
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/access-resolve.test.ts`
Expected: FALLA con `Cannot find module '@/lib/brain/core/access/resolve-access'`.

- [ ] **Step 3: Escribir `types.ts`**

`lib/brain/core/access/types.ts`:

```ts
// Modelo de permisos del brain (spec etapa 17 §3). Sin dependencias: lo usan el
// editor web, el endpoint MCP y las tools del agente. Los imports relativos
// llevan extensión .ts porque un script con Node directo recorre esta cadena.
import type { BrainRole } from "../types.ts";

export type Level = "lector" | "editor" | "administrador";
// "ninguno" solo existe en el acceso general de un nodo: lo restringe.
export type RuleLevel = Level | "ninguno";

// La raíz del brain es la ruta vacía; cualquier otra ruta cumple SLUG_PATTERN.
export const ROOT_PATH = "";

const RANK: Record<Level, number> = { lector: 1, editor: 2, administrador: 3 };

export function atLeast(level: Level | null, minimum: Level): boolean {
	return level !== null && RANK[level] >= RANK[minimum];
}

export function maxLevel(a: Level | null, b: Level | null): Level | null {
	if (a === null) return b;
	if (b === null) return a;
	return RANK[a] >= RANK[b] ? a : b;
}

export type Principal =
	| { kind: "user"; userId: string; role: BrainRole }
	| { kind: "agent"; agent: string }
	| { kind: "platform" }
	| { kind: "import" };

export interface AccessRule {
	path: string;
	principal: "user" | "members";
	userId: string | null;
	level: RuleLevel;
}

export interface AccessRulesStore {
	load(tenantId: string): Promise<AccessRule[]>;
}

// La raíz nace abierta: todos los miembros leen (spec A3).
export const DEFAULT_ROOT_RULE: AccessRule = {
	path: ROOT_PATH,
	principal: "members",
	userId: null,
	level: "lector",
};
```

- [ ] **Step 4: Escribir `resolve-access.ts`**

`lib/brain/core/access/resolve-access.ts`:

```ts
// Resolución de permisos (spec etapa 17 §3.3). Pura: recibe las reglas del
// tenant, quién pregunta y la ruta, y devuelve el nivel o null si no lo ve.
import {
	type AccessRule,
	type Level,
	maxLevel,
	type Principal,
	ROOT_PATH,
} from "./types.ts";

export function parentPath(path: string): string | null {
	if (path === ROOT_PATH) return null;
	const cut = path.lastIndexOf("/");
	return cut === -1 ? ROOT_PATH : path.slice(0, cut);
}

// Raíz primero: "a/b/c" → ["", "a", "a/b", "a/b/c"].
export function ancestorChain(path: string): string[] {
	const chain: string[] = [];
	for (let node: string | null = path; node !== null; node = parentPath(node)) {
		chain.unshift(node);
	}
	return chain;
}

export function resolveAccess(
	rules: AccessRule[],
	principal: Principal,
	path: string,
): Level | null {
	// Solo un miembro común depende de las reglas (spec A9): administradores,
	// agente, plataforma e import administran todo.
	if (principal.kind !== "user" || principal.role !== "tenant_member") {
		return "administrador";
	}

	const chain = ancestorChain(path);

	// Por persona: se acumula el mayor nivel de la ruta y de sus ancestros, y lo
	// dado arriba no se quita abajo (A7).
	let own: Level | null = null;
	for (const rule of rules) {
		if (rule.principal !== "user" || rule.userId !== principal.userId) continue;
		if (rule.level === "ninguno" || !chain.includes(rule.path)) continue;
		own = maxLevel(own, rule.level);
	}

	// Acceso general: manda la regla del nodo más profundo que tenga una. Sin
	// ninguna, lector: un tenant sin la fila de la raíz no pierde su brain.
	let general: Level | null = "lector";
	for (const node of chain) {
		const rule = rules.find((r) => r.principal === "members" && r.path === node);
		if (rule) general = rule.level === "ninguno" ? null : rule.level;
	}

	return maxLevel(own, general);
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/brain/access-resolve.test.ts tests/brain/boundary.test.ts`
Expected: PASAN (el test de frontera valida que `core/access` no importa de afuera).

- [ ] **Step 6: Commit**

```bash
npx biome check --write lib/brain/core/access/types.ts lib/brain/core/access/resolve-access.ts tests/brain/access-resolve.test.ts
git add lib/brain/core/access/types.ts lib/brain/core/access/resolve-access.ts tests/brain/access-resolve.test.ts
git commit -m "feat: modelo de permisos del brain y resolveAccess" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: `withAccess`, el punto único de control

**Files:**
- Create: `lib/brain/core/access/with-access.ts`
- Test: `tests/brain/access-with-access.test.ts`

**Interfaces:**
- Consumes: `resolveAccess`, `AccessRule`, `Principal`, `atLeast` (Tarea 1); `BrainProvider` (de `core/types.ts`, con `read(slug, options?)`, `list`, `history`); `BrainNotFound`, `BrainForbidden` (de `core/errors.ts`).
- Produces: `withAccess(provider: BrainProvider, principal: Principal, rules: AccessRule[]): BrainProvider`.

- [ ] **Step 1: Escribir el test que falla**

`tests/brain/access-with-access.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { withAccess } from "@/lib/brain/core/access/with-access";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";
import { BrainForbidden, BrainNotFound } from "@/lib/brain/core/errors";
import type { BrainPage, BrainProvider } from "@/lib/brain/core/types";

const SLUGS = [
	"comercial/icp",
	"comercial/interno/notas",
	"direccion/presupuesto",
	"otros/x",
];

function pageOf(slug: string): BrainPage {
	return {
		slug,
		title: slug,
		category: "comercial",
		status: "activo",
		tags: [],
		frontmatter: {},
		body: "x",
		revision: 1,
		updatedAt: "2026-10-01T00:00:00Z",
	};
}

function fakeProvider() {
	return {
		search: vi.fn(async () =>
			SLUGS.map((slug) => ({
				slug,
				title: slug,
				category: "comercial",
				status: "activo" as const,
				tags: [],
				snippet: `texto de ${slug}`,
				updatedAt: "2026-10-01T00:00:00Z",
			})),
		),
		read: vi.fn(async (slug: string) => {
			if (!SLUGS.includes(slug)) {
				throw new BrainNotFound(slug, ["comercial/icp", "direccion/presupuesto"]);
			}
			return pageOf(slug);
		}),
		list: vi.fn(async () => SLUGS.map(pageOf)),
		history: vi.fn(async (slug: string) => (SLUGS.includes(slug) ? [] : null)),
		upsert: vi.fn(async (write: { slug: string; baseRevision?: number }) => ({
			slug: write.slug,
			revision: (write.baseRevision ?? 0) + 1,
		})),
	} satisfies BrainProvider;
}

const general = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});

// Ana: lee todo salvo dirección y lo interno; edita comercial.
const RULES: AccessRule[] = [
	general("", "lector"),
	general("direccion", "ninguno"),
	general("comercial", "editor"),
	general("comercial/interno", "ninguno"),
];
const ana: Principal = { kind: "user", userId: "ana", role: "tenant_member" };
const author = { kind: "user", userId: "ana" } as const;
const write = (slug: string, baseRevision?: number) => ({
	slug,
	title: "t",
	category: "comercial",
	status: "activo" as const,
	tags: [],
	body: "b",
	reason: "r",
	...(baseRevision === undefined ? {} : { baseRevision }),
});

describe("withAccess · quién queda sin envolver", () => {
	it.each<[string, Principal]>([
		["tenant_admin", { kind: "user", userId: "u", role: "tenant_admin" }],
		["platform_admin", { kind: "user", userId: "u", role: "platform_admin" }],
		["agente", { kind: "agent", agent: "outreach" }],
		["plataforma", { kind: "platform" }],
		["import", { kind: "import" }],
	])("%s recibe el mismo proveedor", (_name, principal) => {
		const provider = fakeProvider();
		expect(withAccess(provider, principal, [general("", "ninguno")])).toBe(provider);
	});
});

describe("withAccess · search", () => {
	it("descarta lo oculto, sin snippets de páginas ocultas", async () => {
		const provider = fakeProvider();
		const results = await withAccess(provider, ana, RULES).search({ query: "x" });
		expect(results.map((r) => r.slug)).toEqual(["comercial/icp", "otros/x"]);
		expect(JSON.stringify(results)).not.toContain("direccion");
		expect(JSON.stringify(results)).not.toContain("interno");
	});

	it("pide de más al proveedor para no quedarse corto, con tope de 20, y recorta al límite pedido", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		const one = await wrapped.search({ query: "x", limit: 1 });
		expect(one).toHaveLength(1);
		expect(provider.search).toHaveBeenLastCalledWith(
			expect.objectContaining({ query: "x", limit: 4 }),
		);
		await wrapped.search({ query: "x", limit: 20 });
		expect(provider.search).toHaveBeenLastCalledWith(
			expect.objectContaining({ limit: 20 }),
		);
		await wrapped.search({ query: "x" });
		expect(provider.search).toHaveBeenLastCalledWith(
			expect.objectContaining({ limit: 20 }),
		);
	});
});

describe("withAccess · read e historial", () => {
	it("leer una página oculta da la misma respuesta que leer una que no existe", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		const hidden = await wrapped.read("direccion/presupuesto").catch((e) => e);
		const missing = await wrapped.read("comercial/no-existe").catch((e) => e);
		expect(hidden).toBeInstanceOf(BrainNotFound);
		expect(missing).toBeInstanceOf(BrainNotFound);
		expect(hidden.suggestions).toEqual([]);
		expect(missing.suggestions).toEqual([]);
		expect(hidden.code).toBe(missing.code);
		// Lo oculto ni siquiera se le pide al proveedor.
		expect(provider.read).not.toHaveBeenCalledWith(
			"direccion/presupuesto",
			expect.anything(),
		);
	});

	it("lee lo visible y nunca pide sugerencias al proveedor", async () => {
		const provider = fakeProvider();
		const page = await withAccess(provider, ana, RULES).read("comercial/icp");
		expect(page.slug).toBe("comercial/icp");
		expect(provider.read).toHaveBeenCalledWith("comercial/icp", {
			suggestions: false,
		});
	});

	it("el historial de una página oculta es null, como si no existiera", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		expect(await wrapped.history("direccion/presupuesto")).toBeNull();
		expect(provider.history).not.toHaveBeenCalledWith("direccion/presupuesto");
		expect(await wrapped.history("comercial/icp")).toEqual([]);
	});
});

describe("withAccess · list", () => {
	it("devuelve solo lo visible", async () => {
		const pages = await withAccess(fakeProvider(), ana, RULES).list();
		expect(pages.map((p) => p.slug)).toEqual(["comercial/icp", "otros/x"]);
	});
});

describe("withAccess · upsert", () => {
	it("actualizar una página oculta es not_found", async () => {
		const provider = fakeProvider();
		await expect(
			withAccess(provider, ana, RULES).upsert(write("direccion/presupuesto", 1), author),
		).rejects.toBeInstanceOf(BrainNotFound);
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("actualizar una página visible sin ser editor es forbidden", async () => {
		const provider = fakeProvider();
		await expect(
			withAccess(provider, ana, RULES).upsert(write("otros/x", 1), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("un editor actualiza y crea dentro de su carpeta", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		expect(await wrapped.upsert(write("comercial/icp", 1), author)).toEqual({
			slug: "comercial/icp",
			revision: 2,
		});
		expect(await wrapped.upsert(write("comercial/nueva"), author)).toMatchObject({
			slug: "comercial/nueva",
		});
		expect(provider.upsert).toHaveBeenCalledTimes(2);
	});

	it("crear sin ser editor de ese lugar es forbidden, nunca not_found ni conflicto", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		// carpeta solo lectora
		await expect(wrapped.upsert(write("otros/nueva"), author)).rejects.toBeInstanceOf(BrainForbidden);
		// carpeta oculta, aunque el slug ya exista: no se revela por conflicto
		await expect(wrapped.upsert(write("direccion/presupuesto"), author)).rejects.toBeInstanceOf(BrainForbidden);
		// subcarpeta oculta dentro de una carpeta donde sí edita
		await expect(wrapped.upsert(write("comercial/interno/nueva"), author)).rejects.toBeInstanceOf(BrainForbidden);
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("una regla por persona le da editor sobre una carpeta cerrada", async () => {
		const provider = fakeProvider();
		const rules: AccessRule[] = [
			...RULES,
			{ path: "direccion", principal: "user", userId: "ana", level: "editor" },
		];
		const wrapped = withAccess(provider, ana, rules);
		expect(await wrapped.upsert(write("direccion/presupuesto", 1), author)).toMatchObject({
			revision: 2,
		});
		expect((await wrapped.list()).map((p) => p.slug)).toContain("direccion/presupuesto");
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/access-with-access.test.ts`
Expected: FALLA con `Cannot find module '@/lib/brain/core/access/with-access'`.

- [ ] **Step 3: Escribir `with-access.ts`**

`lib/brain/core/access/with-access.ts`:

```ts
// El punto único de control (spec etapa 17 §5): envuelve un BrainProvider con
// los permisos de quien pregunta. Lo invisible responde not_found, igual que lo
// que no existe; forbidden es solo para lo visible sin permiso de escritura.
import { BrainForbidden, BrainNotFound } from "../errors.ts";
import type { BrainProvider } from "../types.ts";
import { resolveAccess } from "./resolve-access.ts";
import { type AccessRule, atLeast, type Principal } from "./types.ts";

// Tope de brain_search_pages. Se pide de más para no quedarse corto después de
// descartar lo oculto; no se pagina: una persona muy restringida puede recibir
// menos resultados de los que existen (límite conocido de esta etapa).
const PROVIDER_MAX_LIMIT = 20;
const SEARCH_OVERFETCH = 4;
const DEFAULT_SEARCH_LIMIT = 8;

export function withAccess(
	provider: BrainProvider,
	principal: Principal,
	rules: AccessRule[],
): BrainProvider {
	// Solo un miembro común depende de las reglas: para los demás el envoltorio
	// no filtra nada y se evita pagarlo.
	if (principal.kind !== "user" || principal.role !== "tenant_member") {
		return provider;
	}

	const levelOf = (slug: string) => resolveAccess(rules, principal, slug);
	const isVisible = (slug: string) => levelOf(slug) !== null;

	return {
		async search(input) {
			const wanted = input.limit ?? DEFAULT_SEARCH_LIMIT;
			const found = await provider.search({
				...input,
				limit: Math.min(PROVIDER_MAX_LIMIT, wanted * SEARCH_OVERFETCH),
			});
			return found.filter((result) => isVisible(result.slug)).slice(0, wanted);
		},

		async read(slug, options) {
			// Sin sugerencias en ningún caso: con ellas, lo oculto (que nunca las
			// tendría) se distinguiría de lo que no existe.
			if (!isVisible(slug)) throw new BrainNotFound(slug, []);
			try {
				return await provider.read(slug, { ...options, suggestions: false });
			} catch (error) {
				if (error instanceof BrainNotFound) {
					throw new BrainNotFound(error.slug, []);
				}
				throw error;
			}
		},

		async list() {
			return (await provider.list()).filter((page) => isVisible(page.slug));
		},

		async history(slug) {
			return isVisible(slug) ? provider.history(slug) : null;
		},

		async upsert(write, author) {
			const level = levelOf(write.slug);
			// Actualizar algo que no se ve es como actualizar algo que no existe.
			if (write.baseRevision !== undefined && level === null) {
				throw new BrainNotFound(write.slug, []);
			}
			// Crear exige editor sobre el propio slug (que incluye su carpeta): si
			// no, ni siquiera un conflicto puede confirmar que un slug oculto existe.
			if (!atLeast(level, "editor")) {
				throw new BrainForbidden(
					"No tenés permiso para escribir en esta parte del brain.",
				);
			}
			return provider.upsert(write, author);
		},
	};
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/brain/access-with-access.test.ts tests/brain/boundary.test.ts`
Expected: PASAN.

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/brain/core/access/with-access.ts tests/brain/access-with-access.test.ts
git add lib/brain/core/access/with-access.ts tests/brain/access-with-access.test.ts
git commit -m "feat: withAccess, el punto único de control de permisos del brain" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 3: Carga de reglas, falla cerrada

**Files:**
- Create: `lib/brain/core/access/rules-store.ts`, `lib/brain/adapters/access-rules.ts`
- Test: `tests/brain/access-rules-store.test.ts`

**Interfaces:**
- Consumes: `AccessRule`, `AccessRulesStore`, `RuleLevel` (Tarea 1).
- Produces: `createSupabaseAccessRulesStore(client: SupabaseClient): AccessRulesStore` (en `core`); `accessRulesStore(): AccessRulesStore` y `loadAccessRules(tenantId: string): Promise<AccessRule[]>` (en `adapters`).

- [ ] **Step 1: Escribir el test que falla**

`tests/brain/access-rules-store.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseAccessRulesStore } from "@/lib/brain/core/access/rules-store";

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(result: Result) {
	const calls: Array<{
		table: string;
		columns: string;
		filters: Record<string, unknown>;
	}> = [];
	const client = {
		from(table: string) {
			const filters: Record<string, unknown> = {};
			let columns = "";
			const chain = {
				select: (value: string) => {
					columns = value;
					return chain;
				},
				eq: (column: string, value: unknown) => {
					filters[column] = value;
					return chain;
				},
				// biome-ignore lint/suspicious/noThenProperty: la cadena de PostgREST es esperable
				then: (resolve: (value: Result) => void) => {
					calls.push({ table, columns, filters: { ...filters } });
					resolve(result);
				},
			};
			return chain;
		},
	};
	return { client: client as unknown as SupabaseClient, calls };
}

// Value: protects=load devuelve las reglas del tenant pedido mapeadas a AccessRule y descarta filas con valores desconocidos.
// fails_when=se pierde el filtro por tenant_id, se mapea mal user_id a userId, o una fila invalida entra como regla.
// why_new=es el unico lector de brain_access_rules y de ahi depende cada decision de acceso; seam=none
describe("createSupabaseAccessRulesStore.load", () => {
	it("filtra por el tenant y mapea las columnas", async () => {
		const { client, calls } = fakeClient({
			data: [
				{ path: "", principal: "members", user_id: null, level: "lector" },
				{ path: "direccion", principal: "members", user_id: null, level: "ninguno" },
				{ path: "direccion", principal: "user", user_id: "cecilia", level: "editor" },
			],
			error: null,
		});
		const rules = await createSupabaseAccessRulesStore(client).load("tenant-a");
		expect(calls).toEqual([
			{
				table: "brain_access_rules",
				columns: "path, principal, user_id, level",
				filters: { tenant_id: "tenant-a" },
			},
		]);
		expect(rules).toEqual([
			{ path: "", principal: "members", userId: null, level: "lector" },
			{ path: "direccion", principal: "members", userId: null, level: "ninguno" },
			{ path: "direccion", principal: "user", userId: "cecilia", level: "editor" },
		]);
	});

	it("descarta una fila con principal o nivel desconocido, y avisa", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { client } = fakeClient({
			data: [
				{ path: "a", principal: "grupo", user_id: null, level: "lector" },
				{ path: "b", principal: "members", user_id: null, level: "dios" },
				{ path: "c", principal: "members", user_id: null, level: "editor" },
			],
			error: null,
		});
		const rules = await createSupabaseAccessRulesStore(client).load("tenant-a");
		expect(rules).toEqual([
			{ path: "c", principal: "members", userId: null, level: "editor" },
		]);
		expect(warn).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	it("sin filas devuelve una lista vacía", async () => {
		const { client } = fakeClient({ data: null, error: null });
		expect(await createSupabaseAccessRulesStore(client).load("tenant-a")).toEqual([]);
	});

	it("si la base falla, falla: nunca se confunde con 'sin reglas'", async () => {
		const { client } = fakeClient({ data: null, error: { message: "permiso denegado" } });
		await expect(
			createSupabaseAccessRulesStore(client).load("tenant-a"),
		).rejects.toThrow(/permisos del brain.*permiso denegado/);
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/access-rules-store.test.ts`
Expected: FALLA con `Cannot find module '@/lib/brain/core/access/rules-store'`.

- [ ] **Step 3: Escribir `rules-store.ts` (core)**

`lib/brain/core/access/rules-store.ts`:

```ts
// Lectura de las reglas del tenant (spec etapa 17 §5.3). Recibe el cliente por
// parámetro, como wiki-store.ts. Falla cerrada: si la base no responde, lanza,
// porque tratarlo como "sin reglas" dejaría abiertas las carpetas restringidas.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessRule, AccessRulesStore, RuleLevel } from "./types.ts";

const LEVELS: readonly RuleLevel[] = ["lector", "editor", "administrador", "ninguno"];

function toRule(row: Record<string, unknown>): AccessRule[] {
	const principal = row.principal;
	const level = row.level;
	if (
		(principal !== "user" && principal !== "members") ||
		typeof level !== "string" ||
		!(LEVELS as readonly string[]).includes(level)
	) {
		console.warn(
			`brain: regla de acceso descartada por valores desconocidos (path ${String(row.path)})`,
		);
		return [];
	}
	return [
		{
			path: String(row.path),
			principal,
			userId: (row.user_id as string | null) ?? null,
			level: level as RuleLevel,
		},
	];
}

export function createSupabaseAccessRulesStore(
	client: SupabaseClient,
): AccessRulesStore {
	return {
		async load(tenantId) {
			const { data, error } = await client
				.from("brain_access_rules")
				.select("path, principal, user_id, level")
				.eq("tenant_id", tenantId);
			if (error) {
				throw new Error(`No pude leer los permisos del brain: ${error.message}`);
			}
			return ((data ?? []) as Array<Record<string, unknown>>).flatMap(toRule);
		},
	};
}
```

- [ ] **Step 4: Escribir el adaptador**

`lib/brain/adapters/access-rules.ts`:

```ts
// Cablea el lector de reglas con el cliente admin de la plataforma. Las reglas
// solo las lee el servidor (la tabla no es legible con la sesión).
import { createAdminClient } from "../../supabase/admin";
import { createSupabaseAccessRulesStore } from "../core/access/rules-store.ts";
import type { AccessRule, AccessRulesStore } from "../core/access/types.ts";

export function accessRulesStore(): AccessRulesStore {
	return createSupabaseAccessRulesStore(createAdminClient());
}

export function loadAccessRules(tenantId: string): Promise<AccessRule[]> {
	return accessRulesStore().load(tenantId);
}
```

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run tests/brain/access-rules-store.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASAN y typecheck limpio.

- [ ] **Step 6: Commit**

```bash
npx biome check --write lib/brain/core/access/rules-store.ts lib/brain/adapters/access-rules.ts tests/brain/access-rules-store.test.ts
git add lib/brain/core/access/rules-store.ts lib/brain/adapters/access-rules.ts tests/brain/access-rules-store.test.ts
git commit -m "feat: carga de reglas de acceso del brain, con falla cerrada" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: Migración, cierre de la lectura directa y pruebas pgTAP

**Files:**
- Create: `supabase/migrations/20261007120000_brain_access_rules.sql`, `supabase/tests/21_brain_access_rules.test.sql`
- Modify: `supabase/tests/08_brain_tables.test.sql` (las dos pruebas de lectura de `authenticated`)

**Interfaces:**
- Produces: la tabla `public.brain_access_rules` con las columnas que lee `createSupabaseAccessRulesStore` (`tenant_id`, `path`, `principal`, `user_id`, `level`).

Esta tarea necesita Docker abierto y la base local (`npm run db:start`). Si no hay, reportar BLOCKED en el paso de verificación: no se da por terminada sin correr `npm run db:test`.

- [ ] **Step 1: Verificar que la migración nueva ordena después de las existentes**

Run: `ls supabase/migrations | tail -3`
Expected: la última es `20261006120000_tenant_auth_methods_create_tenant.sql` (o posterior). Si hay una posterior a `20261007120000`, renombrar la nueva a un timestamp mayor.

- [ ] **Step 2: Escribir la migración**

`supabase/migrations/20261007120000_brain_access_rules.sql`:

```sql
-- Permisos del brain por carpeta y por página (spec etapa 17 §4).
-- Antes de tocar SQL: supabase-postgres-best-practices (índices en claves
-- foráneas, RLS sin políticas, mínimo privilegio).

create type public.brain_access_principal as enum ('user', 'members');
create type public.brain_access_level as enum ('lector', 'editor', 'administrador', 'ninguno');

create table public.brain_access_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- '' es la raíz del brain; cualquier otra ruta es un slug (carpeta o página).
  path text not null check (
    path = ''
    or (
      char_length(path) <= 200
      and path ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'
    )
  ),
  principal public.brain_access_principal not null,
  user_id uuid references auth.users (id) on delete cascade,
  level public.brain_access_level not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brain_access_rules_user_matches_principal
    check ((principal = 'user') = (user_id is not null)),
  -- "ninguno" restringe: solo tiene sentido como acceso general del nodo.
  constraint brain_access_rules_ninguno_only_members
    check (principal = 'members' or level <> 'ninguno')
);

-- Una sola fila "todos los miembros" por nodo: user_id nulo cuenta como igual.
create unique index brain_access_rules_unique
  on public.brain_access_rules (tenant_id, path, principal, user_id) nulls not distinct;
create index brain_access_rules_user_id_idx on public.brain_access_rules (user_id);
create index brain_access_rules_created_by_idx on public.brain_access_rules (created_by);

-- Solo el servidor (service_role) lee y escribe: la decisión de acceso se toma
-- en código (withAccess) y la sesión de una persona nunca toca esta tabla.
alter table public.brain_access_rules enable row level security;
revoke all on public.brain_access_rules from anon, authenticated;

-- Cierre del agujero de lectura: hasta hoy cualquier miembro con sesión podía
-- consultar brain_pages y brain_revisions por la API de Supabase y saltearse la
-- app. Desde ahora lee solo el servidor, a través del proveedor del brain.
drop policy brain_pages_select on public.brain_pages;
drop policy brain_revisions_select on public.brain_revisions;
revoke select on public.brain_pages from authenticated;
revoke select on public.brain_revisions from authenticated;

-- La raíz nace abierta (A3): todos los miembros leen. El código también trata
-- la ausencia de esta fila como "lector", así que un olvido no cierra un brain.
insert into public.brain_access_rules (tenant_id, path, principal, level)
select distinct tenant_id, '', 'members'::public.brain_access_principal, 'lector'::public.brain_access_level
from public.tenant_connections
where capability = 'brain' and enabled
on conflict do nothing;
```

- [ ] **Step 3: Escribir la prueba pgTAP nueva**

`supabase/tests/21_brain_access_rules.test.sql`:

```sql
-- supabase/tests/21_brain_access_rules.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a2a2a2a2-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@rules-a.test', now()),
  ('a2a2a2a2-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@rules-b.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b2b2b2b2-0000-0000-0000-00000000000a', 'rules-a', 'Rules A'),
  ('b2b2b2b2-0000-0000-0000-00000000000b', 'rules-b', 'Rules B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b2b2b2b2-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000001', 'tenant_member');

insert into public.brain_pages (tenant_id, slug, title, category, body)
values ('b2b2b2b2-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'texto');

select has_table('public', 'brain_access_rules', 'existe la tabla de reglas');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.brain_access_rules'::regclass),
  'la tabla de reglas tiene RLS habilitada'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'x', 'user', null, 'lector')$$,
  '23514', null,
  'una regla por persona exige user_id'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'x', 'members', 'a2a2a2a2-0000-0000-0000-000000000001', 'lector')$$,
  '23514', null,
  'una regla de todos los miembros no lleva user_id'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'x', 'user', 'a2a2a2a2-0000-0000-0000-000000000001', 'ninguno')$$,
  '23514', null,
  'ninguno solo vale para el acceso general'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'Comercial/ICP', 'members', 'lector')$$,
  '23514', null,
  'la ruta tiene que ser un slug válido o vacía'
);

select lives_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', '', 'members', 'lector')$$,
  'la raíz se puede abrir a todos los miembros'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', '', 'members', 'editor')$$,
  '23505', null,
  'hay una sola regla de todos los miembros por nodo'
);

select lives_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'direccion', 'members', 'ninguno')$$,
  'una carpeta se puede restringir'
);

select lives_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'direccion', 'user', 'a2a2a2a2-0000-0000-0000-000000000001', 'lector')$$,
  'una persona puede tener acceso a una carpeta restringida'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'direccion', 'user', 'a2a2a2a2-0000-0000-0000-000000000001', 'editor')$$,
  '23505', null,
  'una persona tiene una sola regla por nodo'
);

select lives_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000b', '', 'members', 'lector')$$,
  'cada tenant tiene su propia raíz'
);

select is(
  (select count(*)::int from public.brain_access_rules where tenant_id = 'b2b2b2b2-0000-0000-0000-00000000000a'),
  3,
  'las reglas de un tenant son las suyas'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a2a2a2a2-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select count(*) from public.brain_access_rules$$,
  '42501', null,
  'un miembro no lee las reglas por la API'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'x', 'members', 'editor')$$,
  '42501', null,
  'un miembro no escribe reglas por la API'
);

select throws_ok(
  $$select count(*) from public.brain_pages$$,
  '42501', null,
  'un miembro ya no lee las páginas del brain directo: lee el servidor'
);

select throws_ok(
  $$select count(*) from public.brain_revisions$$,
  '42501', null,
  'un miembro ya no lee las revisiones del brain directo'
);

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.brain_access_rules$$,
  '42501', null,
  'anon no lee las reglas'
);

reset role;
delete from public.tenants where id = 'b2b2b2b2-0000-0000-0000-00000000000b';

select is(
  (select count(*)::int from public.brain_access_rules where tenant_id = 'b2b2b2b2-0000-0000-0000-00000000000b'),
  0,
  'borrar el tenant borra sus reglas'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Actualizar las dos pruebas de lectura de `08_brain_tables.test.sql`**

En `supabase/tests/08_brain_tables.test.sql` reemplazar estos dos bloques, que ya no valen porque `authenticated` no lee las tablas:

```sql
select is(
  (select count(*)::int from public.brain_pages),
  1,
  'un miembro ve solo las páginas de su tenant'
);

select is(
  (select count(*)::int from public.brain_revisions),
  1,
  'un miembro ve solo las revisiones de su tenant'
);
```

por:

```sql
select throws_ok(
  $$select count(*) from public.brain_pages$$,
  '42501', null,
  'un miembro ya no lee las páginas directo: lee el servidor por el proveedor'
);

select throws_ok(
  $$select count(*) from public.brain_revisions$$,
  '42501', null,
  'un miembro ya no lee las revisiones directo'
);
```

El `plan(13)` no cambia: se reemplazan dos pruebas por dos.

- [ ] **Step 5: Correr toda la suite de base**

Run: `npm run db:test`
Expected: todos los archivos en verde, incluidos `21_brain_access_rules.test.sql` (19 pruebas) y `08_brain_tables.test.sql` (13). Si falla `06_anon_grants` o `07_authenticated_grants` porque enumeran los privilegios de `authenticated` sobre las tablas del brain, actualizar ese archivo para reflejar que ya no tiene `select` sobre `brain_pages` y `brain_revisions`, y anotarlo en el reporte. Si no hay Docker: reportar BLOCKED.

- [ ] **Step 6: Regenerar los tipos de la base**

Run: `npm run db:types && git status --short`
Expected: `lib/supabase/database.types.ts` cambia solo por la tabla y los enums nuevos. Si arrastra cambios ajenos a esta migración, revertirlos y dejar solo lo de `brain_access_rules`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261007120000_brain_access_rules.sql supabase/tests/21_brain_access_rules.test.sql supabase/tests/08_brain_tables.test.sql lib/supabase/database.types.ts
git commit -m "feat: tabla de reglas de acceso del brain y cierre de la lectura directa" \
  -m "Los miembros dejan de leer brain_pages y brain_revisions por la API de Supabase: lee el servidor. La raíz nace abierta para los tenants con brain." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: La regla de la raíz al dar de alta un brain

**Files:**
- Create: `scripts/connections-bind-rule.ts`
- Modify: `scripts/connections-bind.mts`
- Test: `tests/scripts/connections-bind-rule.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_ROOT_RULE` (Tarea 1).
- Produces: `rootRuleRow(tenantId: string)` → fila lista para insertar en `brain_access_rules`; `DUPLICATE_RULE = "23505"`.

- [ ] **Step 1: Escribir el test que falla**

`tests/scripts/connections-bind-rule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DUPLICATE_RULE, rootRuleRow } from "../../scripts/connections-bind-rule";

describe("rootRuleRow", () => {
	it("abre la raíz a todos los miembros del tenant, en lectura", () => {
		expect(rootRuleRow("tenant-a")).toEqual({
			tenant_id: "tenant-a",
			path: "",
			principal: "members",
			user_id: null,
			level: "lector",
		});
	});

	it("reconoce el error de duplicado de Postgres", () => {
		expect(DUPLICATE_RULE).toBe("23505");
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/scripts/connections-bind-rule.test.ts`
Expected: FALLA con `Cannot find module`.

- [ ] **Step 3: Escribir el helper**

`scripts/connections-bind-rule.ts`:

```ts
// Fila de la regla de la raíz del brain (spec etapa 17 §4.3). Corre con Node
// directo: imports relativos con extensión .ts.
import { DEFAULT_ROOT_RULE } from "../lib/brain/core/access/types.ts";

// Violación de unicidad: el tenant ya tiene su regla de la raíz.
export const DUPLICATE_RULE = "23505";

export function rootRuleRow(tenantId: string) {
	return {
		tenant_id: tenantId,
		path: DEFAULT_ROOT_RULE.path,
		principal: DEFAULT_ROOT_RULE.principal,
		user_id: DEFAULT_ROOT_RULE.userId,
		level: DEFAULT_ROOT_RULE.level,
	};
}
```

- [ ] **Step 4: Usarlo en el alta del binding**

En `scripts/connections-bind.mts`, agregar el import junto a los otros:

```ts
import { DUPLICATE_RULE, rootRuleRow } from "./connections-bind-rule.ts";
```

y, justo después del bloque `if (bindError) { ... throw ... }` y antes de insertar el evento `connection.bound`, agregar:

```ts
	// El brain nace abierto: todos los miembros leen. Volver a correr el alta no
	// pisa una regla que ya existe (ni la que un administrador haya cambiado).
	if (args.capability === "brain") {
		const { error: ruleError } = await admin
			.from("brain_access_rules")
			.insert(rootRuleRow(tenant.id));
		if (ruleError && ruleError.code !== DUPLICATE_RULE) {
			throw new Error(
				`el binding quedó guardado pero no la regla de la raíz: ${ruleError.message}`,
			);
		}
	}
```

- [ ] **Step 5: Verificar con Node directo y con los tests**

Run: `npx vitest run tests/scripts && node --input-type=module -e "const m = await import('./scripts/connections-bind-rule.ts'); console.log(JSON.stringify(m.rootRuleRow('t')))"`
Expected: tests en verde y la línea con la fila de la raíz (`"path":""`, `"level":"lector"`), sin `ERR_MODULE_NOT_FOUND`. No ejecutar `scripts/connections-bind.mts`: escribe en la base.

- [ ] **Step 6: Commit**

```bash
npx biome check --write scripts/connections-bind-rule.ts tests/scripts/connections-bind-rule.test.ts
git add scripts/connections-bind-rule.ts scripts/connections-bind.mts tests/scripts/connections-bind-rule.test.ts
git commit -m "feat: el alta de un brain crea la regla de la raíz" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: El endpoint MCP aplica los permisos

**Files:**
- Modify: `lib/brain/core/mcp-server/access.ts`, `lib/brain/core/mcp-server/server.ts`, `lib/brain/core/mcp-server/handler.ts`, `lib/brain/adapters/mcp-production.ts`
- Modify (tests): `tests/brain/mcp-server/access.test.ts`, `tests/brain/mcp-server/tools.test.ts`, `tests/brain/mcp-server/handler.test.ts`

**Interfaces:**
- Consumes: `withAccess` (Tarea 2), `AccessRulesStore` (Tarea 1), `accessRulesStore` (Tarea 3).
- Produces:
  - `McpAccess` ok-variant: `{ ok: true; tenantId; userId; role: BrainRole; binding }` (desaparece `access`).
  - `BrainMcpDeps.rules: AccessRulesStore`.
  - `buildBrainMcpServer(ctx)` sin `ctx.access`: registra siempre `brain_search`, `brain_read` y `brain_upsert`.

- [ ] **Step 1: Actualizar los tests (deben fallar contra el código actual)**

**`tests/brain/mcp-server/access.test.ts`.** Reemplazar las expectativas de `access` por `role`:

```ts
	it("un miembro entra a su tenant como tenant_member", async () => {
		expect(await access("Bearer ana")).toEqual({
			ok: true,
			tenantId: "tenant-a",
			userId: "ana",
			role: "tenant_member",
			binding,
		});
	});

	it("un tenant_admin entra como tenant_admin", async () => {
		expect(await access("Bearer admin")).toMatchObject({
			ok: true,
			role: "tenant_admin",
		});
	});

	it("un platform_admin entra a un tenant donde no tiene membresía, como platform_admin", async () => {
		expect(await access("Bearer root")).toMatchObject({
			ok: true,
			tenantId: "tenant-a",
			role: "platform_admin",
		});
	});
```

(son los tres primeros `it` de `describe("resolveMcpAccess")`: se reemplazan en el lugar de los que decían `access: "read"` y `access: "read_write"`).

**`tests/brain/mcp-server/tools.test.ts`.** (a) Borrar todas las líneas `access: "read",` y `access: "read_write",` de las llamadas a `buildBrainMcpServer({ ... })`:

```bash
python3 - <<'EOF'
import pathlib, re
p = pathlib.Path("tests/brain/mcp-server/tools.test.ts")
s = p.read_text()
s = re.sub(r'^[ \t]*access: "read(?:_write)?",\n', "", s, flags=re.M)
p.write_text(s)
EOF
```

(b) Reemplazar los dos primeros tests (`con acceso read expone solo brain_search y brain_read` y `con acceso read_write agrega brain_upsert`) por uno solo:

```ts
	it("expone siempre las tres tools: el permiso lo decide el proveedor, no el rol", async () => {
		const provider = fakeProvider();
		const server = buildBrainMcpServer({
			userId: "ana",
			categories: ["comercial"],
			provider,
			limiter: fakeLimiter(),
		});
		const client = await connect(server);
		const names = (await client.listTools()).tools.map((t) => t.name).sort();
		expect(names).toEqual(["brain_read", "brain_search", "brain_upsert"]);
	});
```

Si algún test que quedó llamaba a `brain_upsert` esperando que "no existiera" para `read`, reescribirlo para que espere el error `forbidden` que lance un proveedor de prueba (`upsert: vi.fn().mockRejectedValue(new BrainForbidden("..."))`), importando `BrainForbidden` de `@/lib/brain/core/errors`.

**`tests/brain/mcp-server/handler.test.ts`.** (a) Agregar al `deps()` por defecto, junto a `store`:

```ts
		rules: { load: async () => [] },
```

(b) Reemplazar el test `un miembro ve dos tools; un admin, tres` por:

```ts
	it("todos ven las tres tools: el permiso se aplica al llamarlas", async () => {
		const member = await connect("ana", deps());
		expect(
			(await member.listTools()).tools.map((tool) => tool.name).sort(),
		).toEqual(["brain_read", "brain_search", "brain_upsert"]);
		const admin = await connect("admin", deps());
		expect(
			(await admin.listTools()).tools.map((tool) => tool.name).sort(),
		).toEqual(["brain_read", "brain_search", "brain_upsert"]);
	});
```

(c) En `un tenantId en los argumentos no llega al proveedor`, reemplazar la última línea (`expect(d.providerInstance.search).toHaveBeenCalledWith({ query: "icp" });`) por, porque el envoltorio de un miembro agrega un `limit`:

```ts
		const [called] = vi.mocked(d.providerInstance.search).mock.calls[0];
		expect(called).toMatchObject({ query: "icp" });
		expect(called).not.toHaveProperty("tenantId");
```

(d) Agregar al final del `describe("handleBrainMcp")` estos tests nuevos:

```ts
	const upsertArgs = {
		slug: "comercial/icp",
		title: "ICP",
		category: "comercial",
		status: "activo",
		tags: [],
		body: "x",
		reason: "ajuste",
		baseRevision: 3,
	};

	it("un miembro que no es editor recibe forbidden al escribir, sin llegar al proveedor", async () => {
		const d = deps();
		const client = await connect("ana", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: upsertArgs,
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "forbidden",
		});
		expect(d.providerInstance.upsert).not.toHaveBeenCalled();
	});

	it("un miembro con una regla de editor sobre la carpeta escribe como usuario", async () => {
		const d = deps({
			rules: {
				load: async () => [
					{ path: "comercial", principal: "user", userId: "ana", level: "editor" },
				],
			},
		});
		const client = await connect("ana", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: upsertArgs,
		});
		expect(result.structuredContent).toMatchObject({ ok: true, revision: 4 });
		expect(d.providerInstance.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "comercial/icp" }),
			{ kind: "user", userId: "ana" },
		);
	});

	it("una página oculta para el miembro responde not_found como si no existiera", async () => {
		const d = deps({
			rules: {
				load: async () => [
					{ path: "comercial", principal: "members", userId: null, level: "ninguno" },
				],
			},
		});
		const client = await connect("ana", d);
		const result = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/icp" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "not_found",
			suggestions: [],
		});
		expect(d.providerInstance.read).not.toHaveBeenCalled();
	});

	it("un admin no consulta las reglas y su proveedor no se envuelve", async () => {
		const load = vi.fn(async () => []);
		const d = deps({ rules: { load } });
		const client = await connect("admin", d);
		await client.callTool({ name: "brain_search", arguments: { query: "icp" } });
		expect(load).not.toHaveBeenCalled();
		expect(d.providerInstance.search).toHaveBeenCalledWith({ query: "icp" });
	});

	it("si las reglas no se pueden cargar, falla cerrado: 500 y nada llega al proveedor", async () => {
		const d = deps({
			rules: {
				load: async () => {
					throw new Error("base caída");
				},
			},
		});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const response = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				headers: {
					authorization: "Bearer ana",
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "brain_search", arguments: { query: "icp" } },
				}),
			}),
			"a",
			d,
		);
		expect(response.status).toBe(500);
		expect(d.providerInstance.search).not.toHaveBeenCalled();
		error.mockRestore();
	});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/brain/mcp-server`
Expected: FALLAN (typecheck del test falla por `role`/`rules`; en tiempo de ejecución, `role` indefinido y la tool `brain_upsert` ausente para el miembro).

- [ ] **Step 3: `access.ts` devuelve el rol y no el nivel**

En `lib/brain/core/mcp-server/access.ts`:

1. Agregar `BrainRole` al import de tipos: `import type { BrainRole } from "../types.ts";` (junto a los otros imports relativos).
2. En el tipo `McpAccess`, dentro de la variante `ok: true`, reemplazar la línea `access: "read" | "read_write";` por `role: BrainRole;`.
3. Reemplazar el cálculo de `access` y el `return` final:

```ts
	const role: BrainRole = platformAdmin
		? "platform_admin"
		: own?.role === "tenant_admin"
			? "tenant_admin"
			: "tenant_member";
```

(en lugar del bloque `const access = platformAdmin || own?.role === "tenant_admin" ? "read_write" : "read";`), y el retorno:

```ts
	return { ok: true, tenantId: tenant.id, userId, role, binding };
```

- [ ] **Step 4: `server.ts` registra siempre las tres tools**

En `lib/brain/core/mcp-server/server.ts`:

1. En el parámetro de `buildBrainMcpServer`, borrar la línea `access: "read" | "read_write";`.
2. Quitar el `if (ctx.access === "read_write") { ... }` que envuelve el `server.registerTool(BRAIN_TOOL_NAMES.upsert, ...)`: el `registerTool` de `brain_upsert` queda al mismo nivel que los otros dos, sin condición.
3. Actualizar el comentario de cabecera: `// Escribe una persona, no el agente: brain_upsert sin aprobación (D5). El permiso lo decide el proveedor que recibe (withAccess), no el rol.`

- [ ] **Step 5: `handler.ts` envuelve el proveedor con los permisos de la persona**

En `lib/brain/core/mcp-server/handler.ts`:

1. Imports nuevos junto a los otros relativos:

```ts
import type { AccessRulesStore } from "../access/types.ts";
import { withAccess } from "../access/with-access.ts";
```

2. En `BrainMcpDeps`, agregar `rules: AccessRulesStore;` (después de `store`).
3. Reemplazar la construcción del servidor:

```ts
	const server = buildBrainMcpServer({
		userId: access.userId,
		access: access.access,
		categories: access.binding.config.categories,
		provider: deps.provider(access.binding),
		limiter: createRateLimiter({
```

por:

```ts
	// Solo un miembro común depende de las reglas: para un administrador no se
	// consultan. Si no se pueden cargar, la excepción llega al 500 de abajo: se
	// falla cerrado en vez de tratarlo como "sin reglas".
	const rules =
		access.role === "tenant_member"
			? await deps.rules.load(access.tenantId)
			: [];
	const provider = withAccess(
		deps.provider(access.binding),
		{ kind: "user", userId: access.userId, role: access.role },
		rules,
	);

	const server = buildBrainMcpServer({
		userId: access.userId,
		categories: access.binding.config.categories,
		provider,
		limiter: createRateLimiter({
```

(el resto de la llamada a `createRateLimiter({ tenantId, userId, limits, hit })` y el cierre quedan igual).

- [ ] **Step 6: Cablear las reglas en producción**

En `lib/brain/adapters/mcp-production.ts`: agregar `import { accessRulesStore } from "./access-rules.ts";`, ampliar el tipo y el objeto memoizado:

```ts
let memoized:
	| Pick<BrainMcpDeps, "verify" | "store" | "hit" | "rules">
	| undefined;

function sharedDeps(): Pick<BrainMcpDeps, "verify" | "store" | "hit" | "rules"> {
	if (!memoized) {
		memoized = {
			verify: supabaseClaimsVerifier(),
			store: supabaseAccessStore(),
			hit: supabaseHit(),
			rules: accessRulesStore(),
		};
	}
	return memoized;
}
```

(conservar el comentario existente sobre la caché del verificador y el formato del archivo; no reformatear el resto).

- [ ] **Step 7: Correr los tests y el typecheck**

Run: `npx vitest run tests/brain && npm run typecheck`
Expected: todo en verde, `boundary.test.ts` incluido. Si `typecheck` marca otro uso de `access: "read"`/`McpAccess.access`, corregirlo: no debe quedar ninguno en `core/mcp-server` (`grep -rn '"read_write"' lib/brain/core` no devuelve nada; en `adapters` solo aparece en `agent-access.ts` y `tools.ts`, que son la declaración del agente y no el MCP).

- [ ] **Step 8: Commit**

```bash
npx biome check --write lib/brain/core/mcp-server/access.ts lib/brain/core/mcp-server/server.ts lib/brain/core/mcp-server/handler.ts tests/brain/mcp-server/access.test.ts tests/brain/mcp-server/tools.test.ts tests/brain/mcp-server/handler.test.ts
git diff --stat
git add lib/brain/core/mcp-server lib/brain/adapters/mcp-production.ts tests/brain/mcp-server
git commit -m "feat: el endpoint MCP del brain aplica los permisos por carpeta y página" \
  -m "Las tres tools se listan para todos; el permiso lo decide el proveedor envuelto con las reglas del tenant." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(`biome --write` sobre archivos con deuda de formato previa puede reformatear código ajeno: revisar `git diff --stat` y revertir esos hunks antes de commitear.)

---

### Tarea 7: El editor web aplica los permisos

**Files:**
- Modify: `lib/tenants/resolve.ts`, `lib/brain/adapters/editor.ts`, `lib/brain/core/editor/save.ts`, `app/[tenant]/brain/actions.ts`, `app/[tenant]/brain/page.tsx`, `app/[tenant]/brain/p/[...slug]/page.tsx`, `app/[tenant]/brain/editar/[...slug]/page.tsx`, `app/[tenant]/brain/historial/[...slug]/page.tsx`
- Modify (tests): `tests/brain/editor-save.test.ts`, `tests/brain/editor-adapter.test.ts`, `tests/brain/editor-access-chain.test.ts`
- Create (test): `tests/brain/editor-access.test.ts`

**Interfaces:**
- Consumes: `withAccess`, `resolveAccess`, `atLeast`, `ROOT_PATH`, `Principal`, `Level` (Tareas 1 y 2); `accessRulesStore` (Tarea 3).
- Produces:
  - `TenantAccess.userId: string`.
  - `OkEditorContext` suma `access(path: string): Level | null`; `canEdit` pasa a ser `atLeast(access(""), "editor")`; `provider` queda envuelto.
  - `SaveDeps.provider(binding, actor)` es asíncrono: `provider(binding: BrainBinding, actor: { tenantId: string; role: BrainRole; userId: string }): Promise<BrainProvider>`.

- [ ] **Step 1: Tests nuevos que fallan**

`tests/brain/editor-access.test.ts` (el contexto del editor con permisos, sin tocar Supabase):

```ts
// Value: protects=el contexto del editor entrega un proveedor que filtra por los permisos del miembro y un access(path) coherente; los administradores no consultan reglas.
// fails_when=el proveedor del contexto no esta envuelto (el miembro ve paginas ocultas) o canEdit ignora una regla de editor sobre la raiz.
// why_new=editor-adapter.test.ts no ejercita las reglas; seam=none
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { BrainProvider } from "@/lib/brain/core/types";

const state = vi.hoisted(() => ({
	access: null as unknown,
	rules: [] as unknown[],
	loads: [] as string[],
	raw: null as unknown,
}));

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: vi.fn(async () => state.access),
}));

vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: vi.fn(async () => [
		{
			id: "binding-1",
			tenantId: "tenant-a",
			capability: "brain",
			provider: "wiki",
			connectorUid: null,
			config: { categories: ["comercial"], requiredFrontmatter: [], search: "fts" },
		},
	]),
}));

vi.mock("@/lib/brain/adapters/access-rules", () => ({
	accessRulesStore: () => ({
		load: async (tenantId: string) => {
			state.loads.push(tenantId);
			return state.rules;
		},
	}),
}));

const page = (slug: string) => ({
	slug,
	title: slug,
	category: "comercial",
	status: "activo" as const,
	tags: [],
	frontmatter: {},
	body: "x",
	revision: 1,
	updatedAt: "2026-10-01T00:00:00Z",
});

const raw = {
	search: vi.fn(async () => []),
	read: vi.fn(),
	list: vi.fn(async () => [page("comercial/icp"), page("direccion/presupuesto")]),
	history: vi.fn(async () => null),
	upsert: vi.fn(),
} satisfies BrainProvider;

// El proveedor real se arma después de los mocks: se lee de state al llamar.
state.raw = raw;
vi.mock("@/lib/brain/adapters/provider", () => ({
	getBrainProvider: () => state.raw,
}));

import { loadEditorContext } from "@/lib/brain/adapters/editor";

function tenantAccess(role: string, userId = "ana") {
	return {
		id: "tenant-a",
		slug: "acme",
		displayName: "Acme",
		role,
		userId,
		defaultModel: "m",
		allowedModels: ["m"],
		brand: {},
	};
}

const closeDireccion: AccessRule[] = [
	{ path: "", principal: "members", userId: null, level: "lector" },
	{ path: "direccion", principal: "members", userId: null, level: "ninguno" },
];

describe("loadEditorContext · permisos", () => {
	beforeEach(() => {
		state.rules = [];
		state.loads = [];
	});

	it("un miembro lista solo lo que ve, y access responde por ruta", async () => {
		state.access = tenantAccess("tenant_member");
		state.rules = closeDireccion;
		const ctx = await loadEditorContext("acme-1");
		if (ctx?.kind !== "ok") throw new Error("se esperaba un contexto ok");
		expect((await ctx.provider.list()).map((p) => p.slug)).toEqual(["comercial/icp"]);
		expect(ctx.access("comercial/icp")).toBe("lector");
		expect(ctx.access("direccion/presupuesto")).toBeNull();
		expect(ctx.canEdit).toBe(false);
		expect(state.loads).toEqual(["tenant-a"]);
	});

	it("una regla de editor sobre la raíz habilita canEdit a un miembro", async () => {
		state.access = tenantAccess("tenant_member");
		state.rules = [
			{ path: "", principal: "members", userId: null, level: "editor" },
		];
		const ctx = await loadEditorContext("acme-2");
		if (ctx?.kind !== "ok") throw new Error("se esperaba un contexto ok");
		expect(ctx.canEdit).toBe(true);
	});

	it("un tenant_admin ve todo, edita y no consulta reglas", async () => {
		state.access = tenantAccess("tenant_admin", "root");
		state.rules = closeDireccion;
		const ctx = await loadEditorContext("acme-3");
		if (ctx?.kind !== "ok") throw new Error("se esperaba un contexto ok");
		expect((await ctx.provider.list()).map((p) => p.slug)).toEqual([
			"comercial/icp",
			"direccion/presupuesto",
		]);
		expect(ctx.canEdit).toBe(true);
		expect(ctx.access("direccion/presupuesto")).toBe("administrador");
		expect(ctx.provider).toBe(raw);
		expect(state.loads).toEqual([]);
	});
});
```

Nota: `loadEditorContext` está envuelta en `cache()` de React, que memoiza por argumento; por eso cada caso usa un slug distinto (`acme-1`, `acme-2`, `acme-3`), como ya hace `editor-adapter.test.ts`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/editor-access.test.ts`
Expected: FALLA (el contexto no tiene `access`, el proveedor no está envuelto y `TenantAccess` no tiene `userId`).

- [ ] **Step 3: `TenantAccess` suma `userId`**

En `lib/tenants/resolve.ts`: agregar `userId: string;` a `interface TenantAccess` y, en el `return` de `resolveTenantAccess`, agregar `userId: auth.user.id,` (junto a `id`, `slug`, etc.). Si `typecheck` marca algún lugar que arma un `TenantAccess` completo sin cast, agregarle `userId`.

- [ ] **Step 4: Reescribir `lib/brain/adapters/editor.ts`**

Reemplazar los imports y las dos primeras definiciones (`EditorContext`, `OkEditorContext`, `loadEditorContext`) por lo siguiente; `loadBrainPages`, `RevisionRow`, `loadRevisions` y `memberEmails` quedan sin cambios:

```ts
// Lecturas del editor (spec editor §4.3 y §6; etapa 17 §5.2). Todo se lee por
// el proveedor del brain, ahora envuelto con los permisos de la persona: el
// editor deja de tocar brain_pages y brain_revisions con el cliente de sesión.
// El tenant sale de resolveTenantAccess, que ya verificó la membresía.
import { cache } from "react";
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess, type TenantAccess } from "@/lib/tenants/resolve";
import { resolveAccess } from "../core/access/resolve-access";
import {
	atLeast,
	type Level,
	type Principal,
	ROOT_PATH,
} from "../core/access/types";
import { withAccess } from "../core/access/with-access";
import { resolveBrainBinding } from "../core/resolve";
import type { BrainPage, BrainProvider, BrainRevision } from "../core/types";
import { accessRulesStore } from "./access-rules";
import { getBrainProvider } from "./provider";

export type EditorContext =
	| {
			kind: "ok";
			tenant: TenantAccess;
			// Grueso: editor o más sobre la raíz. El permiso por nodo en pantalla
			// llega con el árbol; mientras tanto se decide con access(path).
			canEdit: boolean;
			categories: string[];
			provider: BrainProvider;
			access: (path: string) => Level | null;
	  }
	| { kind: "no-brain"; tenant: TenantAccess }
	| { kind: "external"; tenant: TenantAccess };

export type OkEditorContext = Extract<EditorContext, { kind: "ok" }>;

export const loadEditorContext = cache(
	async (tenantSlug: string): Promise<EditorContext | null> => {
		const tenant = await resolveTenantAccess(tenantSlug);
		if (!tenant) return null;
		const binding = await resolveBrainBinding(tenant.id, loadTenantBindings);
		if (!binding) return { kind: "no-brain", tenant };
		if (binding.provider !== "wiki") return { kind: "external", tenant };

		const principal: Principal = {
			kind: "user",
			userId: tenant.userId,
			role: tenant.role,
		};
		// Solo un miembro común depende de las reglas; si no se pueden cargar la
		// excepción corta la página: se falla cerrado.
		const rules =
			tenant.role === "tenant_member"
				? await accessRulesStore().load(tenant.id)
				: [];
		const access = (path: string) => resolveAccess(rules, principal, path);

		return {
			kind: "ok",
			tenant,
			canEdit: atLeast(access(ROOT_PATH), "editor"),
			categories: binding.config.categories,
			provider: withAccess(getBrainProvider(binding), principal, rules),
			access,
		};
	},
);
```

- [ ] **Step 5: `save.ts` deja que decida el proveedor**

En `lib/brain/core/editor/save.ts`:

1. Importar `BrainForbidden` y `BrainNotFound` de `../errors` (ya importa `BrainConflict` y `BrainValidation`).
2. En `SaveDeps`, reemplazar `provider(binding: BrainBinding): BrainProvider;` por:

```ts
	provider(
		binding: BrainBinding,
		actor: { tenantId: string; role: BrainRole; userId: string },
	): Promise<BrainProvider>;
```

3. Reemplazar el chequeo inicial `if (!access || access.role === "tenant_member")` por `if (!access)` (mismo cuerpo `forbidden`, mismo mensaje).
4. En el `try`, reemplazar `const saved = await deps.provider(binding).upsert(write, { kind: "user", userId: access.userId });` por:

```ts
		const provider = await deps.provider(binding, access);
		const saved = await provider.upsert(write, {
			kind: "user",
			userId: access.userId,
		});
```

5. En el `catch`, antes del manejo de `BrainConflict`, agregar:

```ts
		// Sin permiso de escritura sobre esa página (o sobre algo que no ve): la
		// pantalla muestra lo mismo, sin confirmar si existe.
		if (error instanceof BrainForbidden || error instanceof BrainNotFound)
			return {
				ok: false,
				code: "forbidden",
				message: "No tenés permiso para editar esta parte del brain.",
			};
```

- [ ] **Step 6: `actions.ts` arma el proveedor con los permisos de la persona**

En `app/[tenant]/brain/actions.ts`: agregar los imports

```ts
import { accessRulesStore } from "@/lib/brain/adapters/access-rules";
import { withAccess } from "@/lib/brain/core/access/with-access";
```

y reemplazar `provider: getBrainProvider,` por:

```ts
		// El permiso lo decide el proveedor: un miembro con rol de editor sobre
		// esa carpeta escribe; uno sin él recibe forbidden.
		provider: async (binding, actor) =>
			withAccess(
				getBrainProvider(binding),
				{ kind: "user", userId: actor.userId, role: actor.role },
				actor.role === "tenant_member"
					? await accessRulesStore().load(actor.tenantId)
					: [],
			),
```

- [ ] **Step 7: Las pantallas buscan por el proveedor envuelto y deciden la edición por página**

**`app/[tenant]/brain/page.tsx`.** Reemplazar el bloque de búsqueda que arma su propio proveedor:

```ts
	if (q.trim()) {
		const binding = await resolveBrainBinding(
			ctx.tenant.id,
			loadTenantBindings,
		);
		const results = binding
			? await getBrainProvider(binding).search({
					query: q.trim(),
					includeArchived: status === "archivado",
					limit: 20,
				})
			: [];
```

por:

```ts
	if (q.trim()) {
		const results = await ctx.provider.search({
			query: q.trim(),
			includeArchived: status === "archivado",
			limit: 20,
		});
```

y borrar los imports que quedan sin uso (`getBrainProvider`, `resolveBrainBinding`, `loadTenantBindings`).

**`app/[tenant]/brain/p/[...slug]/page.tsx`.** (a) Reemplazar el bloque del 404 que arma su propio proveedor (`const binding = await resolveBrainBinding(...)` y `const suggestions = binding ? await getBrainProvider(binding).search({...}) : [];`) por:

```ts
		const suggestions = await ctx.provider.search({
			query: slug.split("/").pop()?.replaceAll("-", " ") ?? slug,
			includeArchived: true,
			limit: 3,
		});
```

y borrar los imports sin uso (`getBrainProvider`, `resolveBrainBinding`, `loadTenantBindings`). (b) Importar `atLeast` de `@/lib/brain/core/access/types` y reemplazar `{ctx.canEdit && (` (el botón Editar) por `{atLeast(ctx.access(slug), "editor") && (`.

**`app/[tenant]/brain/editar/[...slug]/page.tsx`.** Importar `atLeast` y reemplazar `if (!ctx || ctx.kind !== "ok" || !ctx.canEdit || !slug) notFound();` por:

```ts
	if (!ctx || ctx.kind !== "ok" || !slug) notFound();
	if (!atLeast(ctx.access(slug), "editor")) notFound();
```

**`app/[tenant]/brain/historial/[...slug]/page.tsx`.** Importar `atLeast` y reemplazar `{ctx.canEdit && selected !== current && (` por `{atLeast(ctx.access(slug), "editor") && selected !== current && (`.

(`nueva/page.tsx` sigue con `ctx.canEdit`: elegir carpeta destino es de la 17.3.)

- [ ] **Step 8: Actualizar los tests existentes del editor**

**`tests/brain/editor-save.test.ts`.** (a) En `deps()`, reemplazar `provider: () => provider,` por `provider: async () => provider,`. (b) Reemplazar el test `rechaza a tenant_member y a quien no tiene acceso sin llamar al provider` por estos tres:

```ts
	it("sin sesión o sin acceso al tenant rechaza sin llamar al provider", async () => {
		const nobody = deps({ access: async () => null });
		expect(await savePage(input, nobody.deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(nobody.provider.upsert).not.toHaveBeenCalled();
	});

	it("un tenant_member llega al proveedor: el rol por sí solo ya no decide", async () => {
		const member = deps({
			access: async () => ({
				tenantId: "t1",
				role: "tenant_member",
				userId: "u2",
			}),
		});
		expect(await savePage(input, member.deps)).toMatchObject({ ok: true });
		expect(member.provider.upsert).toHaveBeenCalledTimes(1);
	});

	it("el forbidden y el not_found del proveedor salen como forbidden", async () => {
		const forbidden = deps(
			{},
			vi.fn(async () => {
				throw new BrainForbidden("sin permiso");
			}),
		);
		expect(await savePage(input, forbidden.deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		const hidden = deps(
			{},
			vi.fn(async () => {
				throw new BrainNotFound("comercial/icp", []);
			}),
		);
		expect(await savePage(input, hidden.deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
	});
```

y agregar `BrainForbidden` y `BrainNotFound` al import de `@/lib/brain/core/errors`.

**`tests/brain/editor-adapter.test.ts`.** (a) Agregar junto a los otros `vi.mock`:

```ts
vi.mock("@/lib/brain/adapters/access-rules", () => ({
	accessRulesStore: () => ({ load: async () => [] }),
}));
```

(b) En el helper `tenant()`, agregar `userId: "user-1",` al objeto base.

**`tests/brain/editor-access-chain.test.ts`.** (a) Agregar `rules: [] as Row[],` al `state` hoisted y `state.rules = [];` al `beforeEach`. (b) En el mock del cliente admin, dentro de `chain`, agregar una rama esperable para la tabla de reglas (el cliente de reglas hace `select().eq()` sin `maybeSingle`):

```ts
				// biome-ignore lint/suspicious/noThenProperty: la cadena de PostgREST es esperable
				then: (resolve: (value: unknown) => void) => {
					const rows =
						table === "brain_access_rules"
							? state.rules.filter((row) => row.tenant_id === filters.tenant_id)
							: [];
					resolve({ data: rows, error: null });
				},
```

(c) Agregar al `describe` estos tests:

```ts
	it("un miembro con la raíz restringida recibe 404 aunque sea del tenant", async () => {
		state.rules = [
			{ tenant_id: "tenant-a", path: "", principal: "members", user_id: null, level: "ninguno" },
		];
		const response = await call("acme");
		expect(response.status).toBe(404);
		expect(state.pageQueries).toEqual([]);
	});

	it("una regla por persona le devuelve el acceso a esa carpeta", async () => {
		state.rules = [
			{ tenant_id: "tenant-a", path: "", principal: "members", user_id: null, level: "ninguno" },
			{ tenant_id: "tenant-a", path: "comercial", principal: "user", user_id: "user-a", level: "lector" },
		];
		const response = await call("acme");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("cuerpo de acme");
	});
```

(el `mock` de `@/lib/supabase/admin` ya se usa para las lecturas de páginas; las reglas pasan por el mismo cliente falso).

- [ ] **Step 9: Correr todo y chequear que no quedó ningún proveedor sin envolver en las pantallas**

Run: `npx vitest run tests/brain tests/tenants tests/agents && npm run typecheck`
Expected: todo en verde.

Run: `grep -rn "getBrainProvider" app`
Expected: solo `app/[tenant]/brain/actions.ts` (que lo envuelve con `withAccess`). Ninguna página ni ruta arma un proveedor sin envolver.

- [ ] **Step 10: Commit**

```bash
npx biome check --write lib/brain/adapters/editor.ts lib/brain/core/editor/save.ts tests/brain/editor-access.test.ts
git diff --stat
git add lib/tenants/resolve.ts lib/brain app tests
git commit -m "feat: el editor web del brain aplica los permisos por carpeta y página" \
  -m "El contexto del editor entrega un proveedor envuelto con las reglas del miembro; las pantallas dejan de armar su propio proveedor para buscar." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(revisar `git diff --stat` antes de commitear: si Biome reformateó código ajeno en `app/` o en tests con deuda previa, revertir esos hunks.)

---

### Tarea 8: El agente, en el chat, actúa en nombre de la persona

**Files:**
- Create: `lib/brain/adapters/acting-provider.ts`
- Modify: `lib/brain/adapters/tools.ts`, `agents/outreach/tools/brain.ts`
- Test (create): `tests/brain/acting-provider.test.ts`
- Test (modify): `tests/brain/tools.test.ts`

**Interfaces:**
- Consumes: `withAccess`, `AccessRule`, `loadAccessRules` (Tareas 2 y 3), `getBrainProvider`.
- Produces:
  - `type BrainActor = { userId: string; role: BrainRole }` (serializable a JSON).
  - `brainActorFrom(auth): BrainActor | undefined`.
  - `resolveActingProvider(binding, actor, deps?): Promise<BrainProvider>`.
  - `createBrainTools(binding, access, options?: { actor?: BrainActor; provider?; rules? })`.

Restricción de eve: los `execute` de las tools se recompilan y solo toleran cerrar sobre datos serializables y llamadas a imports estables. Por eso la lógica vive en un módulo importado (`acting-provider.ts`) y `execute` la llama directo; el `actor` que lleva el closure es JSON.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/brain/acting-provider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
	brainActorFrom,
	resolveActingProvider,
} from "@/lib/brain/adapters/acting-provider";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { BrainBinding } from "@/lib/brain/core/resolve";
import type { BrainProvider } from "@/lib/brain/core/types";

const binding = {
	id: "b1",
	tenantId: "tenant-a",
	provider: "wiki",
	config: {},
} as unknown as BrainBinding;

const page = (slug: string) => ({
	slug,
	title: slug,
	category: "comercial",
	status: "activo" as const,
	tags: [],
	frontmatter: {},
	body: "x",
	revision: 1,
	updatedAt: "2026-10-01T00:00:00Z",
});

function raw(): BrainProvider {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(),
		list: vi.fn(async () => [page("comercial/icp"), page("direccion/x")]),
		history: vi.fn(async () => null),
		upsert: vi.fn(),
	};
}

const closeDireccion: AccessRule[] = [
	{ path: "", principal: "members", userId: null, level: "lector" },
	{ path: "direccion", principal: "members", userId: null, level: "ninguno" },
];

describe("brainActorFrom", () => {
	it("una persona sale con su id y su rol", () => {
		expect(
			brainActorFrom({
				principalId: "u1",
				principalType: "user",
				attributes: { role: "tenant_admin" },
			}),
		).toEqual({ userId: "u1", role: "tenant_admin" });
	});

	it("un rol ausente o desconocido es tenant_member, el de menor privilegio", () => {
		expect(
			brainActorFrom({ principalId: "u1", principalType: "user", attributes: {} }),
		).toEqual({ userId: "u1", role: "tenant_member" });
		expect(
			brainActorFrom({
				principalId: "u1",
				principalType: "user",
				attributes: { role: "root" },
			}),
		).toEqual({ userId: "u1", role: "tenant_member" });
	});

	it("sin persona (corrida desatendida, servicio o nada) no hay actor", () => {
		expect(brainActorFrom(null)).toBeUndefined();
		expect(brainActorFrom(undefined)).toBeUndefined();
		expect(
			brainActorFrom({ principalId: "svc", principalType: "service" }),
		).toBeUndefined();
		expect(brainActorFrom({ principalType: "user" })).toBeUndefined();
	});
});

describe("resolveActingProvider", () => {
	it("sin actor devuelve el proveedor tal cual: el agente desatendido ve todo", async () => {
		const provider = raw();
		const rules = vi.fn(async () => closeDireccion);
		const result = await resolveActingProvider(binding, undefined, {
			provider: () => provider,
			rules,
		});
		expect(result).toBe(provider);
		expect(rules).not.toHaveBeenCalled();
	});

	it("un miembro recibe un proveedor filtrado con las reglas del tenant del binding", async () => {
		const provider = raw();
		const rules = vi.fn(async () => closeDireccion);
		const result = await resolveActingProvider(
			binding,
			{ userId: "ana", role: "tenant_member" },
			{ provider: () => provider, rules },
		);
		expect(rules).toHaveBeenCalledWith("tenant-a");
		expect((await result.list()).map((p) => p.slug)).toEqual(["comercial/icp"]);
	});

	it("un administrador no consulta las reglas", async () => {
		const provider = raw();
		const rules = vi.fn(async () => closeDireccion);
		const result = await resolveActingProvider(
			binding,
			{ userId: "root", role: "tenant_admin" },
			{ provider: () => provider, rules },
		);
		expect(result).toBe(provider);
		expect(rules).not.toHaveBeenCalled();
	});

	it("si las reglas no se pueden cargar, falla cerrado", async () => {
		await expect(
			resolveActingProvider(
				binding,
				{ userId: "ana", role: "tenant_member" },
				{
					provider: raw,
					rules: async () => {
						throw new Error("base caída");
					},
				},
			),
		).rejects.toThrow("base caída");
	});
});
```

Agregar estos tests a `tests/brain/tools.test.ts`, dentro del `describe("createBrainTools")` (ya importa `createBrainTools`, `vi` y los tipos):

```ts
	describe("con una persona como actor", () => {
		const closeDireccion = [
			{ path: "", principal: "members" as const, userId: null, level: "lector" as const },
			{ path: "direccion", principal: "members" as const, userId: null, level: "ninguno" as const },
		];
		const pageOf = (slug: string) => ({
			slug,
			title: slug,
			category: "comercial",
			status: "activo" as const,
			tags: [],
			snippet: "",
			updatedAt: "2026-01-01",
		});
		const member = { userId: "ana", role: "tenant_member" as const };

		function providerWith(upsert = vi.fn(async () => ({ slug: "a", revision: 2 }))) {
			return {
				search: vi.fn(async () => [pageOf("comercial/icp"), pageOf("direccion/x")]),
				read: vi.fn(),
				list: async () => [],
				history: async () => null,
				upsert,
			};
		}

		it("brain_search filtra lo que el miembro no ve", async () => {
			const provider = providerWith();
			const tools = createBrainTools(binding, "read", {
				actor: member,
				provider: () => provider,
				rules: async () => closeDireccion,
			});
			const result = await tools.brain_search.execute({ query: "x" }, {} as never);
			expect(result).toMatchObject({ ok: true });
			expect(
				"results" in result ? result.results.map((r) => r.slug) : [],
			).toEqual(["comercial/icp"]);
		});

		it("brain_upsert de un miembro sin permiso de editor es forbidden aunque un administrador lo apruebe", async () => {
			const upsert = vi.fn(async () => ({ slug: "a", revision: 2 }));
			const tools = createBrainTools(binding, "read_write", {
				actor: member,
				provider: () => providerWith(upsert),
				rules: async () => closeDireccion,
			});
			expect("brain_upsert" in tools).toBe(true);
			if (!("brain_upsert" in tools)) return;
			const result = await tools.brain_upsert.execute(
				{
					slug: "otros/x",
					title: "t",
					category: "comercial",
					status: "activo",
					tags: [],
					body: "b",
					reason: "r",
					baseRevision: 1,
				},
				{ session: { id: "s1", auth: { initiator: { principalType: "user", principalId: "ana" } } } } as never,
			);
			expect(result).toMatchObject({ ok: false, error: "forbidden" });
			expect(upsert).not.toHaveBeenCalled();
		});

		it("sin actor el agente desatendido conserva todo el acceso", async () => {
			const provider = providerWith();
			const tools = createBrainTools(binding, "read", {
				provider: () => provider,
				rules: async () => closeDireccion,
			});
			const result = await tools.brain_search.execute({ query: "x" }, {} as never);
			expect("results" in result ? result.results : []).toHaveLength(2);
		});
	});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/brain/acting-provider.test.ts tests/brain/tools.test.ts`
Expected: FALLAN (`Cannot find module '@/lib/brain/adapters/acting-provider'` y `actor` no existe en las opciones).

- [ ] **Step 3: Escribir `acting-provider.ts`**

`lib/brain/adapters/acting-provider.ts`:

```ts
// El agente en el chat actúa en nombre de la persona que inició la sesión (spec
// etapa 17 A2): sus tools ven y escriben lo que esa persona puede. Sin persona
// (schedules, workflows), el agente conserva su propia declaración y ve todo.
//
// Vive en un módulo aparte porque los execute de las tools de eve se
// recompilan y solo pueden cerrar sobre JSON y llamar a imports estables.
import { withAccess } from "../core/access/with-access.ts";
import type { AccessRule } from "../core/access/types.ts";
import type { BrainBinding } from "../core/resolve.ts";
import type { BrainProvider, BrainRole } from "../core/types.ts";
import { loadAccessRules } from "./access-rules.ts";
import { getBrainProvider } from "./provider.ts";

// Serializable a JSON: es lo que lleva el closure de las tools.
export interface BrainActor {
	userId: string;
	role: BrainRole;
}

interface AuthLike {
	principalId?: string;
	principalType?: string;
	attributes?: Record<string, unknown>;
}

// El rol lo estampa el canal desde memberships. Si falta o no se reconoce, el
// de menor privilegio: nunca se asume administrador.
export function brainActorFrom(
	auth: AuthLike | null | undefined,
): BrainActor | undefined {
	if (!auth || auth.principalType !== "user" || !auth.principalId) {
		return undefined;
	}
	const role = auth.attributes?.role;
	return {
		userId: auth.principalId,
		role:
			role === "tenant_admin" || role === "platform_admin"
				? role
				: "tenant_member",
	};
}

export async function resolveActingProvider(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: {
		provider?: (binding: BrainBinding) => BrainProvider;
		rules?: (tenantId: string) => Promise<AccessRule[]>;
	} = {},
): Promise<BrainProvider> {
	const provider = (deps.provider ?? getBrainProvider)(binding);
	if (!actor) return provider;
	// Solo un miembro común depende de las reglas. Si no se pueden cargar, la
	// excepción sale: se falla cerrado.
	const rules =
		actor.role === "tenant_member"
			? await (deps.rules ?? loadAccessRules)(binding.tenantId)
			: [];
	return withAccess(
		provider,
		{ kind: "user", userId: actor.userId, role: actor.role },
		rules,
	);
}
```

- [ ] **Step 4: Usarlo en las tools**

En `lib/brain/adapters/tools.ts`:

1. Reemplazar los imports locales por:

```ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import type { AccessRule } from "../core/access/types.ts";
import { decideBrainUpsertResponse } from "../core/approval.ts";
import { brainContract } from "../core/contract.ts";
import { toToolError } from "../core/errors.ts";
import type { BrainBinding } from "../core/resolve.ts";
import type { BrainProvider } from "../core/types.ts";
import { type BrainActor, resolveActingProvider } from "./acting-provider.ts";
```

(ya no se usa `getBrainProvider` directo en este archivo.)

2. Definir el tipo de opciones, arriba de `buildBrainReadTools`:

```ts
// Inyección para tests más el actor (JSON). En producción solo llega `actor`.
interface BrainToolOptions {
	actor?: BrainActor;
	provider?: (binding: BrainBinding) => BrainProvider;
	rules?: (tenantId: string) => Promise<AccessRule[]>;
}
```

3. Cambiar los parámetros `deps: { provider?: ... }` de `buildBrainReadTools` y `buildBrainUpsertTool` por `deps: BrainToolOptions`, y reemplazar en los tres `execute` la línea `const provider = (deps.provider ?? getBrainProvider)(binding);` por:

```ts
				const provider = await resolveActingProvider(binding, deps.actor, deps);
```

4. En `createBrainTools`, cambiar la firma `deps: { provider?: ... } = {}` por `deps: BrainToolOptions = {}` (el resto del cuerpo queda igual). Mantener el comentario largo sobre eve y la serialización; agregarle una línea: `// El actor del closure es JSON; la lógica de permisos vive en acting-provider.ts.`

- [ ] **Step 5: Pasar el actor desde el resolver del agente**

En `agents/outreach/tools/brain.ts`: agregar `import { brainActorFrom } from "../../../lib/brain/adapters/acting-provider";` y reemplazar `return createBrainTools(binding, access);` por:

```ts
			// En el chat actúa en nombre de la persona; en corridas desatendidas no
			// hay persona y el agente conserva su declaración.
			return createBrainTools(binding, access, { actor: brainActorFrom(auth) });
```

(`auth` ya está definido arriba como `ctx.session.auth.initiator ?? ctx.session.auth.current`.)

- [ ] **Step 6: Correr los tests y el typecheck**

Run: `npx vitest run tests/brain tests/agents && npm run typecheck`
Expected: todo en verde (incluidos `tests/agents/outreach/tools/brain.test.ts`, que arma una sesión sin `principalId`: no hay actor y las tools no cambian).

- [ ] **Step 7: Commit**

```bash
npx biome check --write lib/brain/adapters/acting-provider.ts tests/brain/acting-provider.test.ts
git diff --stat
git add lib/brain/adapters/acting-provider.ts lib/brain/adapters/tools.ts agents/outreach/tools/brain.ts tests/brain
git commit -m "feat: el agente del chat actúa con los permisos de quien lo usa" \
  -m "Las tools del brain filtran y escriben según la persona que inició la sesión; el agente desatendido no cambia." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 9: Documentación, cierre y verificación final

**Files:**
- Modify: `lib/brain/README.md`, `docs/01-roadmap-etapas.md`

- [ ] **Step 1: README del módulo**

En `lib/brain/README.md`, en "Estructura", agregar bajo `core/` una línea y, en "Lo que el host tiene que proveer", una fila:

```markdown
- `core/access/`: modelo de permisos por carpeta y página (`resolveAccess`, `withAccess`) y lectura de reglas. Un `tenant_member` ve y edita lo que las reglas le dan; administradores, agente, plataforma e import no pasan por ellas.
```

```markdown
| `AccessRulesStore` | `core/access/types.ts` | Reglas de acceso del tenant. `createSupabaseAccessRulesStore(client)` lee `brain_access_rules`; si falla, lanza (falla cerrada) |
```

y en "Qué viaja con el módulo" sumar la migración `20261007120000_brain_access_rules` y `supabase/tests/21_brain_access_rules.test.sql`.

- [ ] **Step 2: Roadmap**

En `docs/01-roadmap-etapas.md`, en la Etapa 17, cambiar `- [ ] **17.2 · Permisos.**` por `- [x] **17.2 · Permisos.**` y agregar al final de esa viñeta: ` Plan: \`docs/superpowers/plans/2026-10-07-etapa-17-2-permisos.md\`. **Antes de desplegar:** aplicar la migración \`20261007120000_brain_access_rules\` a producción primero (corriendo \`npx supabase migration list\` antes: \`db push\` aplica todas las pendientes) y recién después desplegar el código; al revés, el editor fallaría cerrado por falta de la tabla.`

- [ ] **Step 3: Verificación final**

Run: `npm run typecheck && npm test`
Expected: sin errores y toda la suite en verde.

Run: `npm run db:test`
Expected: toda la suite pgTAP en verde (si no hay Docker, reportarlo como pendiente: la entrega no se da por terminada sin esto).

Run: `grep -rn "getBrainProvider" app lib/brain/core && git status --short`
Expected: `getBrainProvider` solo en `app/[tenant]/brain/actions.ts`; el árbol limpio salvo lo que se commitea ahora.

- [ ] **Step 4: Commit**

```bash
git add lib/brain/README.md docs/01-roadmap-etapas.md
git commit -m "docs: cierre de la entrega 17.2, permisos del brain" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Autorrevisión del plan

**Cobertura de la spec (§3, §4, §5, §8 17.2):**
- §3 modelo y resolución (3.1 a 3.4, 3.6 `resolveAccess` y `parentPath`): Tarea 1. §3.5 y `visibleTree`/`explainAccess`: diferidos a la 17.3 (Desvío 1).
- §4.1 tabla, §4.2 cierre de lectura, §4.3 semilla de la raíz (migración y script de alta): Tareas 4 y 5. §4.4 evento: diferido a la 17.3 (Desvío 2).
- §5 `withAccess`: Tarea 2. §5.2 superficies: MCP (Tarea 6), editor (Tarea 7), agente en el chat (Tarea 8); agente desatendido, canon e import sin cambios por construcción. §5.3 `load`: Tarea 3.
- §8 17.2, "Terminado cuando": un miembro ve `brain_upsert` por MCP y recibe `forbidden` si no es editor (Tarea 6); los criterios 2, 3 y 4 de §1 con reglas cargadas por SQL (Tareas 2, 4, 6, 7 y 8).

**Consistencia de nombres:** `Level`, `RuleLevel`, `Principal`, `AccessRule`, `AccessRulesStore`, `ROOT_PATH`, `DEFAULT_ROOT_RULE`, `atLeast`, `maxLevel`, `parentPath`, `ancestorChain`, `resolveAccess`, `withAccess`, `createSupabaseAccessRulesStore`, `accessRulesStore`, `loadAccessRules`, `BrainActor`, `brainActorFrom`, `resolveActingProvider`, `rootRuleRow`, `DUPLICATE_RULE`, `OkEditorContext.access` se definen donde se producen y se usan con el mismo nombre después.

**Riesgos que ningún test automático cubre:**
- La migración contra la base de producción: se aplica a mano, antes del deploy, tras `migration list`.
- El humo del editor contra una base local (el de la 17.1 sigue pendiente de evidencia): con permisos reales conviene recorrer índice, página, historial, edición y raw con un miembro y con un administrador.
- El comportamiento en eve de `createBrainTools` con `actor` (cierre sobre JSON): lo cubren los tests de `tools`, pero el resolver real corre dentro de una sesión de eve; verificar en producción la lista real de tools del agente después del deploy.
