# Etapa 18.1 · Borrado de páginas del brain — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador de un nodo borre una página del brain desde la web sin dejar links muertos: el servidor limpia los links entrantes (dejando el texto), borra la página con su historial y deja un evento, todo en una sola transacción.

**Architecture:** Dos funciones puras (`removeWikilinks`, `planLinkCleanup`) arman el plan de limpieza. Una función SQL `brain_delete_page` aplica limpieza, borrado, reglas y evento de forma atómica, reutilizando `brain_upsert_page` para las revisiones de las páginas limpiadas. Un núcleo con dependencias inyectadas (`previewDelete`, `deletePage`) decide permisos y arma el plan en el servidor; dos server actions con `zod` lo exponen. El borrado **no pasa por `BrainProvider`**: agente y MCP no ganan ninguna operación.

**Tech Stack:** TypeScript, Next.js App Router (server actions), Supabase (Postgres, pgTAP), Vitest (entorno `node`, solo `*.test.ts`), shadcn/ui (`AlertDialog`), Biome.

**Spec:** `docs/superpowers/specs/2026-10-08-etapa-18-1-borrado-paginas-brain-design.md` (§2 a §8). Reemplaza la decisión B8 de `2026-09-13-brain-design.md`. Base: Etapa 17 completa (PR 73, 74 y 75) en `main` y en producción.

## Global Constraints

- **Borrado real, solo desde la web, solo `administrador` del nodo** (D1). El agente y el endpoint MCP no ganan ninguna forma de borrar; `brain_upsert` sigue siendo la única escritura que ellos tienen. El contrato `BrainProvider` no cambia.
- **Sin papelera ni deshacer** (D2): la confirmación lo dice.
- **Los links entrantes se limpian solos** (D3): `[[destino|alias]]` → `alias`; `[[destino]]` y `[[destino#ancla]]` → título de la página borrada. Nunca se bloquea ni se dejan links rotos a propósito.
- **Se limpian todas las páginas que enlazan, las vea o no quien borra** (D4), incluidas las archivadas. El diálogo lista solo las visibles; para el resto muestra una cantidad, sin rutas ni títulos (A8 de la Etapa 17: lo invisible no se revela).
- **Todo o nada** (D5): limpieza, borrado, reglas y evento en una función SQL / una transacción.
- Cada página limpiada recibe **una revisión a nombre de quien borra**, por `brain_upsert_page`, con motivo `Se borró <slug>` (D6).
- Una página que también es carpeta **se borra sola**; lo que cuelga queda (D7). Las reglas de acceso de esa ruta se borran **solo si no queda ninguna página debajo** (D8).
- **El plan de limpieza lo arma el servidor al confirmar** (D9); lo que manda el cliente es solo `slug` y `expectedRevision`.
- Solo el proveedor `wiki`; un brain externo por `mcp` responde `unsupported` (D10).
- Lo invisible responde `not_found`, nunca `forbidden`; `forbidden` solo para lo visible sin administración. Si las reglas no se pueden cargar, la operación lanza: falla cerrada.
- Toda tabla lleva `tenant_id` y RLS; **`events` es append-only** (solo se inserta). Antes de tocar SQL se cargó `supabase-postgres-best-practices`: `security invoker`, `search_path = ''`, objetos con esquema, ejecución solo para `service_role`.
- `lib/brain/core` no importa nada fuera de `lib/brain/core`, salvo `zod`, `yaml`, `@modelcontextprotocol/sdk/*`, `node:*` y, solo como `import type`, `@supabase/supabase-js`. Lo vigila `tests/brain/boundary.test.ts`. Los imports relativos dentro de `core/access/` llevan extensión `.ts`; `lib/brain/core/wikilinks.ts` no importa nada (lo usa un script con Node directo).
- UI en español rioplatense; código e identificadores en inglés. Solo tokens shadcn existentes (sin colores fijos). A 375 px: sin scroll horizontal de página y objetivos táctiles de al menos 44 px (`min-h-11`).
- Commits con prefijo `feat:` / `fix:` / `refactor:` / `test:` / `docs:` y el trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No correr `npm run lint:fix` sobre todo el repo (reformatea archivos ajenos). Formatear solo lo que se edita: `npx biome check --write <archivos>`; si Biome reformatea código ajeno al cambio, revertir ese hunk.
- Toda tarea se ejecuta con `cd` al worktree `/Users/mok/Sites/innovas/agents/.claude/worktrees/etapa-18-1-borrado-brain`; antes de commitear verificar `git rev-parse --show-toplevel` y la rama `feat/etapa-18-1-borrado-brain`. **Nunca** correr `supabase link`, `db push` ni nada contra la base remota: este worktree no está enlazado a propósito.

## Precisiones respecto de la spec

Ningún desvío de fondo. Tres precisiones que la spec dejaba abiertas:

1. **`brain_delete_page` conserva el frontmatter** de cada página limpiada tal cual está (no toca `updated`): es lo que hace hoy una edición desde la web que no cambia el frontmatter.
2. **`pages(tenantId)` de las dependencias es `list()` del proveedor sin envolver** (`getBrainProvider(binding).list()`), porque la limpieza tiene que ver también las páginas que quien borra no ve.
3. **Una página no se limpia a sí misma**: `planLinkCleanup` la excluye y la función SQL ignora un elemento con el mismo slug que el borrado.

## Review Focus

Entradas que la spec implica y ninguna tarea prueba por sí sola; cada una tiene su test en la tarea que se indica.

1. Un link dentro de un bloque de código o de código en línea no se toca; una página sin links al destino sale byte a byte igual y no entra al plan. → Tarea 1.
2. Las páginas archivadas que enlazan también se limpian; una página que se enlaza a sí misma no entra al plan. → Tarea 1.
3. La vista previa no filtra rutas ni títulos de páginas ocultas: solo una cantidad. (`JSON.stringify` del resultado no contiene sus slugs.) → Tarea 4.
4. Quien no administra el nodo recibe `forbidden`; quien no lo ve, `not_found`; un brain por `mcp`, `unsupported`; si las reglas no cargan, lanza. → Tarea 4.
5. Si la revisión esperada no coincide, o una de las páginas a limpiar cambió, no se escribe nada y la respuesta es `conflict`. → Tareas 2 y 4.
6. Reglas de la ruta: se conservan si quedan páginas debajo y se borran si no. Cada borrado deja exactamente un `brain.page_deleted` y cada página limpiada, una revisión con el motivo y el autor correctos. → Tarea 2.
7. El agente y el MCP siguen sin poder borrar: ni `BrainProvider` ni `contract.ts` cambian. → Tarea 7 (`grep`).

---

### Task 1: Funciones puras de limpieza de links

**Files:**
- Modify: `lib/brain/core/wikilinks.ts` (agrega `CODE_PATTERN` y `removeWikilinks`)
- Modify: `lib/brain/core/editor/markdown-links.ts` (usa `CODE_PATTERN` compartido)
- Create: `lib/brain/core/links-cleanup.ts`
- Test: `tests/brain/wikilinks-remove.test.ts`
- Test: `tests/brain/links-cleanup.test.ts`

**Interfaces:**
- Consumes: `parseWikilinks` de `wikilinks.ts`; `BrainPage` de `types.ts`.
- Produces (Tareas 4, 5):
  - `CODE_PATTERN: RegExp` (bloques ``` y código en línea), exportado de `wikilinks.ts`.
  - `removeWikilinks(body: string, target: string, fallbackText: string): string`
  - `interface CleanupItem { slug: string; title: string; baseRevision: number; body: string }`
  - `planLinkCleanup(pages: BrainPage[], target: string): CleanupItem[]`

- [ ] **Step 1: Escribir los tests de `removeWikilinks`**

`tests/brain/wikilinks-remove.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { removeWikilinks } from "@/lib/brain/core/wikilinks";

const T = "comercial/icp";
const remove = (body: string) => removeWikilinks(body, T, "ICP");

describe("removeWikilinks", () => {
	it("deja el alias cuando lo hay", () => {
		expect(remove("Ver [[comercial/icp|el perfil]] hoy.")).toBe(
			"Ver el perfil hoy.",
		);
	});

	it("sin alias deja el título de la página borrada", () => {
		expect(remove("Ver [[comercial/icp]].")).toBe("Ver ICP.");
	});

	it("con ancla y sin alias deja el título; con ancla y alias deja el alias", () => {
		expect(remove("[[comercial/icp#objeciones]]")).toBe("ICP");
		expect(remove("[[comercial/icp#objeciones|ver objeciones]]")).toBe(
			"ver objeciones",
		);
	});

	it("reemplaza todos los links al destino en el mismo texto", () => {
		expect(remove("[[comercial/icp]] y [[comercial/icp|otra vez]]")).toBe(
			"ICP y otra vez",
		);
	});

	it("no toca los links a otros destinos, ni a destinos que empiezan igual", () => {
		const body = "[[otra]] y [[comercial/icp-viejo]] y [[comercial/icp/objeciones]]";
		expect(remove(body)).toBe(body);
	});

	it("no toca los wikilinks dentro de código en línea ni de bloques de código", () => {
		const body = "Mirá `[[comercial/icp]]` y\n```\n[[comercial/icp|x]]\n```\ny [[comercial/icp]]";
		expect(remove(body)).toBe(
			"Mirá `[[comercial/icp]]` y\n```\n[[comercial/icp|x]]\n```\ny ICP",
		);
	});

	it("un bloque de código sin cerrar protege el resto del texto, como en la vista de lectura", () => {
		const body = "[[comercial/icp]]\n```\n[[comercial/icp]]";
		expect(remove(body)).toBe("ICP\n```\n[[comercial/icp]]");
	});

	it("devuelve el cuerpo idéntico si no había links al destino", () => {
		const body = "Texto con [[otra|link]] y  espacios\n\ny saltos.\n";
		expect(remove(body)).toBe(body);
	});

	it("un título con corchetes o barras no rompe el reemplazo", () => {
		expect(removeWikilinks("[[comercial/icp]]", T, "A [b] | c")).toBe(
			"A [b] | c",
		);
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/wikilinks-remove.test.ts`
Expected: FAIL — `removeWikilinks` no existe.

- [ ] **Step 3: Implementar en `wikilinks.ts`**

Al final de `lib/brain/core/wikilinks.ts` (el archivo sigue sin imports):

```ts
// Bloques ``` y código en línea `...`: lo que matchea no se toca (lo comparten
// la vista de lectura y la limpieza de links del borrado).
export const CODE_PATTERN = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

// Sacar los links a `target` de un texto sin código: [[t|alias]] pasa a su
// alias y el resto de las formas, a `fallbackText`. Lo demás queda igual.
function unlinkChunk(
	chunk: string,
	target: string,
	fallbackText: string,
): string {
	let out = "";
	let cursor = 0;
	for (const link of parseWikilinks(chunk)) {
		if (link.target !== target) continue;
		out += chunk.slice(cursor, link.start) + (link.alias ?? fallbackText);
		cursor = link.end;
	}
	return out + chunk.slice(cursor);
}

export function removeWikilinks(
	body: string,
	target: string,
	fallbackText: string,
): string {
	let out = "";
	let cursor = 0;
	for (const match of body.matchAll(CODE_PATTERN)) {
		const start = match.index ?? 0;
		out += unlinkChunk(body.slice(cursor, start), target, fallbackText);
		out += match[0];
		cursor = start + match[0].length;
	}
	return out + unlinkChunk(body.slice(cursor), target, fallbackText);
}
```

En `lib/brain/core/editor/markdown-links.ts`, borrar la constante local `CODE` (y su comentario) e importar el compartido: `import { CODE_PATTERN, parseWikilinks } from "../wikilinks";`, reemplazando los usos de `CODE` por `CODE_PATTERN`. No cambia nada más del archivo.

- [ ] **Step 4: Correr los tests de wikilinks y los de la vista de lectura**

Run: `npx vitest run tests/brain/wikilinks-remove.test.ts tests/brain/wikilinks.test.ts tests/brain/markdown-links.test.ts`
Expected: PASS (los de `markdown-links` confirman que la vista de lectura no cambió).

- [ ] **Step 5: Escribir los tests de `planLinkCleanup`**

`tests/brain/links-cleanup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planLinkCleanup } from "@/lib/brain/core/links-cleanup";
import type { BrainPage } from "@/lib/brain/core/types";

const page = (
	slug: string,
	body: string,
	over: Partial<BrainPage> = {},
): BrainPage => ({
	slug,
	title: slug.split("/").pop() ?? slug,
	category: "comercial",
	status: "activo",
	tags: [],
	frontmatter: {},
	body,
	revision: 3,
	updatedAt: "2026-10-08T00:00:00Z",
	...over,
});

const T = "comercial/icp";

describe("planLinkCleanup", () => {
	const pages = [
		page(T, "Yo me enlazo [[comercial/icp]]", { title: "Perfil ICP" }),
		page("legal/contrato", "Ver [[comercial/icp|el perfil]]."),
		page("legal/viejo", "Ver [[comercial/icp]].", { status: "archivado", revision: 7 }),
		page("legal/otra", "Nada que ver [[suelta]]."),
		page("legal/codigo", "Solo en `[[comercial/icp]]` código."),
	];

	it("incluye solo las páginas cuyo cuerpo cambia, con su revisión vigente", () => {
		const plan = planLinkCleanup(pages, T);
		expect(plan.map((i) => i.slug)).toEqual(["legal/contrato", "legal/viejo"]);
		expect(plan[1].baseRevision).toBe(7);
	});

	it("incluye las archivadas y excluye la propia página aunque se enlace a sí misma", () => {
		const slugs = planLinkCleanup(pages, T).map((i) => i.slug);
		expect(slugs).toContain("legal/viejo");
		expect(slugs).not.toContain(T);
	});

	it("usa el título de la página borrada cuando el link no tiene alias", () => {
		const plan = planLinkCleanup(pages, T);
		expect(plan[0].body).toBe("Ver el perfil.");
		expect(plan[1].body).toBe("Ver Perfil ICP.");
	});

	it("devuelve el título de cada página limpiada", () => {
		expect(planLinkCleanup(pages, T)[0].title).toBe("contrato");
	});

	it("si la página a borrar no está entre las páginas, usa el destino como texto", () => {
		const plan = planLinkCleanup(
			[page("a", "[[x/y]]")],
			"x/y",
		);
		expect(plan[0].body).toBe("x/y");
	});

	it("sin links al destino, el plan queda vacío", () => {
		expect(planLinkCleanup([page("a", "hola")], T)).toEqual([]);
	});
});
```

- [ ] **Step 6: Implementar `links-cleanup.ts`**

`lib/brain/core/links-cleanup.ts`:

```ts
// Plan de limpieza de links al borrar una página (spec etapa 18.1 §3.2). Puro:
// recibe todas las páginas del tenant y devuelve las que hay que reescribir.
import type { BrainPage } from "./types";
import { removeWikilinks } from "./wikilinks";

export interface CleanupItem {
	slug: string;
	title: string;
	baseRevision: number;
	body: string;
}

export function planLinkCleanup(
	pages: BrainPage[],
	target: string,
): CleanupItem[] {
	const fallbackText = pages.find((p) => p.slug === target)?.title ?? target;
	const plan: CleanupItem[] = [];
	for (const page of pages) {
		// Incluye las archivadas (se pueden desarchivar) y excluye la propia.
		if (page.slug === target) continue;
		const body = removeWikilinks(page.body, target, fallbackText);
		if (body === page.body) continue;
		plan.push({
			slug: page.slug,
			title: page.title,
			baseRevision: page.revision,
			body,
		});
	}
	return plan;
}
```

- [ ] **Step 7: Correr todo, tipos y frontera**

Run: `npx vitest run tests/brain/wikilinks-remove.test.ts tests/brain/links-cleanup.test.ts tests/brain/markdown-links.test.ts tests/brain/wikilinks.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 8: Formatear y commitear**

```bash
npx biome check --write lib/brain/core/wikilinks.ts lib/brain/core/editor/markdown-links.ts lib/brain/core/links-cleanup.ts tests/brain/wikilinks-remove.test.ts tests/brain/links-cleanup.test.ts
git add lib/brain/core/wikilinks.ts lib/brain/core/editor/markdown-links.ts lib/brain/core/links-cleanup.ts tests/brain/wikilinks-remove.test.ts tests/brain/links-cleanup.test.ts
git commit -m "feat: quitar links a una página borrada y planear la limpieza, funciones puras de la 18.1

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Función SQL `brain_delete_page`

**Files:**
- Create: `supabase/migrations/20261009120000_brain_delete_page.sql`
- Create: `supabase/tests/23_brain_delete_page.test.sql`
- Modify: `lib/supabase/database.types.ts` (solo la función nueva)

**Interfaces:**
- Consumes: `brain_upsert_page` (migración `20260913234426`), tablas `brain_pages`, `brain_revisions`, `brain_access_rules`, `events`.
- Produces (Tarea 3): RPC `brain_delete_page(p_tenant_id uuid, p_slug text, p_expected_revision integer, p_actor uuid, p_binding_id uuid, p_cleanups jsonb) returns table (deleted_revisions integer, cleaned integer, rules_removed integer)`, solo `service_role`. Errores: `BR404` (no existe), `BR409` con `detail = <revisión vigente>` (revisión esperada distinta, o una página a limpiar cambió o ya no existe).

- [ ] **Step 1: Escribir la prueba pgTAP**

`supabase/tests/23_brain_delete_page.test.sql`:

```sql
-- supabase/tests/23_brain_delete_page.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a4a4a4a4-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@del-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b4b4b4b4-0000-0000-0000-00000000000a', 'del-a', 'Del A');

-- Las páginas se crean por brain_upsert_page para que tengan su revisión 1.
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'texto del icp', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp/objeciones', 'Objeciones', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'hijo', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'legal/contrato', 'Contrato', 'legal', 'activo', '{}'::text[], '{}'::jsonb, 'Ver [[comercial/icp|el ICP]] y [[otra]].', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'legal/viejo', 'Viejo', 'legal', 'archivado', '{}'::text[], '{}'::jsonb, 'Ver [[comercial/icp]].', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'solo', 'Solo', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'sola', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');

insert into public.brain_access_rules (tenant_id, path, principal, level)
values
  ('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 'members', 'ninguno'),
  ('b4b4b4b4-0000-0000-0000-00000000000a', 'solo', 'members', 'ninguno');

-- 1-3: existencia y privilegios
select has_function('public', 'brain_delete_page',
  array['uuid', 'text', 'integer', 'uuid', 'uuid', 'jsonb'],
  'existe brain_delete_page');
select ok(
  not has_function_privilege('authenticated',
    'public.brain_delete_page(uuid, text, integer, uuid, uuid, jsonb)', 'execute'),
  'authenticated no puede ejecutar brain_delete_page');
select ok(
  has_function_privilege('service_role',
    'public.brain_delete_page(uuid, text, integer, uuid, uuid, jsonb)', 'execute'),
  'service_role ejecuta brain_delete_page');

-- 4-5: revisión esperada distinta → BR409 y no se borra nada
select throws_ok(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 99, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'BR409', null, 'una revisión esperada distinta aborta con conflicto');
select is(
  (select count(*)::int from public.brain_pages where slug = 'comercial/icp'), 1,
  'tras el conflicto la página sigue');

-- 6: página inexistente → BR404
select throws_ok(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'no-existe', 1, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'BR404', null, 'una página que no existe responde not found');

-- 7-9: todo o nada. La segunda limpieza tiene una revisión base vieja.
select throws_ok(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 1, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001',
    '[{"slug":"legal/contrato","base_revision":1,"body":"limpio"},{"slug":"legal/viejo","base_revision":7,"body":"x"}]'::jsonb)$$,
  'BR409', null, 'una limpieza con revisión base vieja aborta todo');
select is(
  (select body from public.brain_pages where slug = 'legal/contrato'),
  'Ver [[comercial/icp|el ICP]] y [[otra]].',
  'la primera limpieza se deshizo con el conflicto');
select is(
  (select count(*)::int from public.brain_pages where slug = 'comercial/icp'), 1,
  'la página a borrar sigue tras el conflicto de una limpieza');

-- 10-19: borrado real con dos limpiezas. Quedan páginas debajo: las reglas se conservan.
select results_eq(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 1, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001',
    '[{"slug":"legal/contrato","base_revision":1,"body":"Ver el ICP y [[otra]]."},{"slug":"legal/viejo","base_revision":1,"body":"Ver ICP."}]'::jsonb)$$,
  $$values (1::integer, 2::integer, 0::integer)$$,
  'borra y devuelve revisiones borradas, páginas limpiadas y reglas borradas');
select is(
  (select count(*)::int from public.brain_pages where slug = 'comercial/icp'), 0,
  'la página ya no existe');
select is(
  (select count(*)::int from public.brain_revisions where title = 'ICP'), 0,
  'sus revisiones cayeron con ella');
select is(
  (select body from public.brain_pages where slug = 'legal/contrato'),
  'Ver el ICP y [[otra]].', 'el link se reemplazó en la página que enlazaba');
select is(
  (select revision from public.brain_pages where slug = 'legal/contrato'), 2,
  'la página limpiada tiene una revisión nueva');
select is(
  (select r.reason from public.brain_revisions r join public.brain_pages p on p.id = r.page_id
    where p.slug = 'legal/contrato' and r.revision = 2),
  'Se borró comercial/icp', 'la revisión de limpieza lleva el motivo');
select is(
  (select r.author_user_id from public.brain_revisions r join public.brain_pages p on p.id = r.page_id
    where p.slug = 'legal/contrato' and r.revision = 2),
  'a4a4a4a4-0000-0000-0000-000000000001'::uuid, 'la revisión de limpieza es de quien borró');
select is(
  (select body from public.brain_pages where slug = 'legal/viejo'),
  'Ver ICP.', 'también se limpió la página archivada');
select is(
  (select count(*)::int from public.brain_access_rules where path = 'comercial/icp'), 1,
  'las reglas se conservan mientras queden páginas debajo');
select is(
  (select count(*)::int from public.events where type = 'brain.page_deleted' and summary = 'comercial/icp'), 1,
  'el borrado deja exactamente un evento');

-- 20-22: página sin nada debajo: las reglas se borran con ella, y el evento lista lo limpiado.
select results_eq(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'solo', 1, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  $$values (1::integer, 0::integer, 1::integer)$$,
  'sin links ni páginas debajo borra también su regla');
select is(
  (select count(*)::int from public.brain_access_rules where path = 'solo'), 0,
  'la regla de la ruta se fue');
select is(
  (select jsonb_array_length(payload -> 'cleaned') from public.events
    where type = 'brain.page_deleted' and summary = 'comercial/icp'),
  2, 'el evento lista las páginas limpiadas');

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y ver que falla**

Run (Docker abierto): `npm run db:test`
Expected: FAIL en `23_brain_delete_page` — no existe `brain_delete_page`. Si el conteo de `plan(22)` no coincide con las aserciones al correr con la función, ajustar solo ese número.

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20261009120000_brain_delete_page.sql`:

```sql
-- Borrado de una página del brain con limpieza de links (spec etapa 18.1 §4).
-- Limpieza de las páginas que la enlazan, borrado de la página y su historial,
-- reglas de la ruta y evento, todo en una transacción. Solo lo ejecuta el
-- servidor (service_role); agente y MCP no tienen forma de borrar.

create or replace function public.brain_delete_page(
  p_tenant_id uuid,
  p_slug text,
  p_expected_revision integer,
  p_actor uuid,
  p_binding_id uuid,
  p_cleanups jsonb
)
returns table (deleted_revisions integer, cleaned integer, rules_removed integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_page public.brain_pages%rowtype;
  v_target public.brain_pages%rowtype;
  v_item jsonb;
  v_revisions integer;
  v_cleaned text[] := '{}';
  v_rules integer := 0;
begin
  select * into v_page
  from public.brain_pages
  where tenant_id = p_tenant_id and slug = p_slug
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = p_slug;
  end if;
  if v_page.revision <> p_expected_revision then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = v_page.revision::text;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_cleanups, '[]'::jsonb)) loop
    -- Una página no se limpia a sí misma: se va a borrar.
    if v_item ->> 'slug' = p_slug then
      continue;
    end if;

    select * into v_target
    from public.brain_pages
    where tenant_id = p_tenant_id and slug = v_item ->> 'slug'
    for update;

    -- Si desapareció entre el plan y esta transacción, el plan quedó viejo.
    if not found then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = '';
    end if;

    -- brain_upsert_page controla la revisión base: una página que cambió aborta todo.
    perform 1 from public.brain_upsert_page(
      p_tenant_id, v_target.slug, v_target.title, v_target.category, v_target.status,
      v_target.tags, v_target.frontmatter, v_item ->> 'body',
      'Se borró ' || p_slug, (v_item ->> 'base_revision')::integer,
      'user'::public.brain_author_kind, p_actor, null, p_binding_id
    );
    v_cleaned := v_cleaned || v_target.slug;
  end loop;

  select count(*)::integer into v_revisions
  from public.brain_revisions
  where tenant_id = p_tenant_id and page_id = v_page.id;

  -- brain_revisions cae por la clave foránea con on delete cascade.
  delete from public.brain_pages where id = v_page.id;

  -- Las reglas siguen protegiendo lo que cuelga de esta ruta: solo se borran
  -- si no queda ninguna página debajo.
  if not exists (
    select 1 from public.brain_pages
    where tenant_id = p_tenant_id and starts_with(slug, p_slug || '/')
  ) then
    delete from public.brain_access_rules
    where tenant_id = p_tenant_id and path = p_slug;
    get diagnostics v_rules = row_count;
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.page_deleted', p_slug,
    jsonb_build_object(
      'slug', p_slug,
      'title', v_page.title,
      'category', v_page.category,
      'revisions', v_revisions,
      'cleaned', to_jsonb(v_cleaned),
      'rules_removed', v_rules,
      'binding_id', p_binding_id
    )
  );

  return query select v_revisions, coalesce(cardinality(v_cleaned), 0), v_rules;
end;
$$;

revoke execute on function public.brain_delete_page(
  uuid, text, integer, uuid, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.brain_delete_page(
  uuid, text, integer, uuid, uuid, jsonb
) to service_role;
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `npm run db:test`
Expected: PASS en los 28+ archivos, incluidas las 22 pruebas de `23_brain_delete_page` y sin regresiones. Posibles ajustes:
- Si `brain_revisions` no deja borrar por la cascada (error de permiso o de trigger), no cambiar la tabla: reportar el error exacto y detenerse (BLOCKED).
- Si `perform 1 from public.brain_upsert_page(...)` no resuelve la sobrecarga por el `null` de `p_session_id`, castear: `null::text`.

- [ ] **Step 5: Regenerar los tipos y quedarse solo con la función nueva**

```bash
npm run db:types
git diff --stat lib/supabase/database.types.ts
```

El generador mete deriva ajena (por ejemplo `ComputedFields: never;` en todas las tablas). Conservar solo la entrada nueva de `Functions` (`brain_delete_page`) y revertir cualquier otro hunk (con `git checkout -p` o `sed`), hasta que el diff sean solo las líneas de esa función.

- [ ] **Step 6: Commitear**

```bash
git add supabase/migrations/20261009120000_brain_delete_page.sql supabase/tests/23_brain_delete_page.test.sql lib/supabase/database.types.ts
git commit -m "feat: función SQL que borra una página, limpia los links entrantes y deja su evento

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Escritor del borrado

**Files:**
- Create: `lib/brain/core/delete-store.ts`
- Test: `tests/brain/delete-store.test.ts`

**Interfaces:**
- Consumes: RPC de la Tarea 2; `WikiStoreError` de `wiki-store.ts`.
- Produces (Tareas 4, 5):
  - `interface DeleteParams { tenantId: string; slug: string; expectedRevision: number; actorUserId: string; bindingId: string; cleanups: Array<{ slug: string; baseRevision: number; body: string }> }`
  - `interface DeleteOutcome { deletedRevisions: number; cleaned: number; rulesRemoved: number }`
  - `interface PageDeleter { delete(params: DeleteParams): Promise<DeleteOutcome> }`
  - `createSupabasePageDeleter(client: SupabaseClient): PageDeleter` — ante un error de la base lanza `WikiStoreError` con el `code` de Postgres (`BR404`, `BR409`).

- [ ] **Step 1: Escribir el test**

`tests/brain/delete-store.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabasePageDeleter } from "@/lib/brain/core/delete-store";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

function fakeClient(result: {
	data?: unknown;
	error?: { code?: string; message: string; details?: string | null } | null;
}) {
	const rpc = vi.fn(async () => ({ data: null, error: null, ...result }));
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

const params = {
	tenantId: "t1",
	slug: "comercial/icp",
	expectedRevision: 4,
	actorUserId: "u1",
	bindingId: "b1",
	cleanups: [{ slug: "legal/contrato", baseRevision: 2, body: "limpio" }],
};

describe("createSupabasePageDeleter", () => {
	it("llama a brain_delete_page con los nombres de la función y devuelve los conteos", async () => {
		const { client, rpc } = fakeClient({
			data: [{ deleted_revisions: 5, cleaned: 1, rules_removed: 2 }],
		});
		const outcome = await createSupabasePageDeleter(client).delete(params);
		expect(rpc).toHaveBeenCalledWith("brain_delete_page", {
			p_tenant_id: "t1",
			p_slug: "comercial/icp",
			p_expected_revision: 4,
			p_actor: "u1",
			p_binding_id: "b1",
			p_cleanups: [{ slug: "legal/contrato", base_revision: 2, body: "limpio" }],
		});
		expect(outcome).toEqual({ deletedRevisions: 5, cleaned: 1, rulesRemoved: 2 });
	});

	it("traduce un error de la base a WikiStoreError con su código", async () => {
		const { client } = fakeClient({
			error: { code: "BR409", message: "BRAIN_CONFLICT", details: "5" },
		});
		const error = await createSupabasePageDeleter(client)
			.delete(params)
			.catch((e) => e);
		expect(error).toBeInstanceOf(WikiStoreError);
		expect(error.code).toBe("BR409");
		expect(error.details).toBe("5");
	});

	it("si la base no devuelve fila, lanza: no se da el borrado por hecho", async () => {
		const { client } = fakeClient({ data: [] });
		await expect(createSupabasePageDeleter(client).delete(params)).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/delete-store.test.ts`
Expected: FAIL — `@/lib/brain/core/delete-store` no existe.

- [ ] **Step 3: Implementar**

`lib/brain/core/delete-store.ts`:

```ts
// Escritor del borrado de páginas (spec etapa 18.1 §5.1). Aparte del
// BrainProvider a propósito: el contrato que comparten el agente y el MCP no
// gana ninguna operación de borrado. Recibe el cliente por parámetro.
import type { SupabaseClient } from "@supabase/supabase-js";
import { WikiStoreError } from "./wiki-store.ts";

export interface DeleteParams {
	tenantId: string;
	slug: string;
	expectedRevision: number;
	actorUserId: string;
	bindingId: string;
	cleanups: Array<{ slug: string; baseRevision: number; body: string }>;
}

export interface DeleteOutcome {
	deletedRevisions: number;
	cleaned: number;
	rulesRemoved: number;
}

export interface PageDeleter {
	delete(params: DeleteParams): Promise<DeleteOutcome>;
}

export function createSupabasePageDeleter(client: SupabaseClient): PageDeleter {
	return {
		async delete(params) {
			const { data, error } = await client.rpc("brain_delete_page", {
				p_tenant_id: params.tenantId,
				p_slug: params.slug,
				p_expected_revision: params.expectedRevision,
				p_actor: params.actorUserId,
				p_binding_id: params.bindingId,
				p_cleanups: params.cleanups.map((item) => ({
					slug: item.slug,
					base_revision: item.baseRevision,
					body: item.body,
				})),
			});
			if (error) {
				throw new WikiStoreError(
					error.code ?? "",
					error.message,
					error.details ?? "",
				);
			}
			const row = (
				data as Array<{
					deleted_revisions: number;
					cleaned: number;
					rules_removed: number;
				}> | null
			)?.[0];
			if (!row) {
				throw new Error("La base no confirmó el borrado de la página.");
			}
			return {
				deletedRevisions: row.deleted_revisions,
				cleaned: row.cleaned,
				rulesRemoved: row.rules_removed,
			};
		},
	};
}
```

- [ ] **Step 4: Correr tests, frontera y tipos**

Run: `npx vitest run tests/brain/delete-store.test.ts tests/brain/wiki-store.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Formatear y commitear**

```bash
npx biome check --write lib/brain/core/delete-store.ts tests/brain/delete-store.test.ts
git add lib/brain/core/delete-store.ts tests/brain/delete-store.test.ts
git commit -m "feat: escritor del borrado de páginas del brain sobre la función SQL

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Núcleo del borrado (vista previa y borrado)

**Files:**
- Create: `lib/brain/core/editor/delete.ts`
- Test: `tests/brain/editor-delete.test.ts`

**Interfaces:**
- Consumes: `planLinkCleanup`, `CleanupItem` (Tarea 1); `PageDeleter` (Tarea 3); `resolveAccess` (`../access/resolve-access.ts`); `AccessRulesStore`, `isAdminRole`, `Principal` (`../access/types.ts`); `WikiStoreError`; `BrainPage`, `BrainRole`, `CANON_TAGS`, `SLUG_PATTERN`, `MAX_SLUG_LENGTH` (`../types`).
- Produces (Tareas 5, 6):
  - `type DeleteFailure = { ok: false; code: "not_found" | "forbidden" | "conflict" | "unsupported"; message: string }`
  - `interface DeletePreview { slug: string; title: string; revision: number; linkers: Array<{ slug: string; title: string }>; hiddenLinkers: number; hasChildren: boolean; canonTags: string[] }`
  - `interface DeleteDeps { actor(tenantSlug): Promise<{ tenantId: string; userId: string; role: BrainRole } | null>; rules: AccessRulesStore; binding(tenantId): Promise<{ id: string; provider: "wiki" | "mcp" } | null>; pages(tenantId): Promise<BrainPage[]>; deleter: PageDeleter }`
  - `previewDelete(tenantSlug, slug, deps): Promise<{ ok: true; preview: DeletePreview } | DeleteFailure>`
  - `deletePage(tenantSlug, slug, expectedRevision, deps): Promise<{ ok: true; cleaned: number } | DeleteFailure>`

- [ ] **Step 1: Escribir los tests**

`tests/brain/editor-delete.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
	deletePage,
	type DeleteDeps,
	previewDelete,
} from "@/lib/brain/core/editor/delete";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { DeleteParams } from "@/lib/brain/core/delete-store";
import type { BrainPage, BrainRole } from "@/lib/brain/core/types";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

const page = (slug: string, body: string, over: Partial<BrainPage> = {}): BrainPage => ({
	slug,
	title: slug.split("/").pop() ?? slug,
	category: "comercial",
	status: "activo",
	tags: [],
	frontmatter: {},
	body,
	revision: 3,
	updatedAt: "2026-10-08T00:00:00Z",
	...over,
});
const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const user = (path: string, userId: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "user",
	userId,
	level,
});

const PAGES = [
	page("comercial/icp", "texto", { tags: ["canon:icp"], title: "ICP" }),
	page("comercial/icp/objeciones", "hijo"),
	page("legal/contrato", "Ver [[comercial/icp|el perfil]]."),
	page("direccion/secreta", "Ver [[comercial/icp]]."),
	page("suelta", "nada"),
];

function setup(opts: {
	role?: BrainRole;
	userId?: string;
	rules?: AccessRule[];
	pages?: BrainPage[];
	provider?: "wiki" | "mcp";
	hasBinding?: boolean;
	deleterError?: unknown;
} = {}) {
	const del = vi.fn(async (_params: DeleteParams) => {
		if (opts.deleterError) throw opts.deleterError;
		return { deletedRevisions: 4, cleaned: 2, rulesRemoved: 0 };
	});
	const deps: DeleteDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: opts.userId ?? "admin1",
			role: opts.role ?? "tenant_admin",
		}),
		rules: { load: async () => opts.rules ?? [members("", "lector")] },
		binding: async () =>
			opts.hasBinding === false ? null : { id: "b1", provider: opts.provider ?? "wiki" },
		pages: async () => opts.pages ?? PAGES,
		deleter: { delete: del },
	};
	return { deps, del };
}

const MEMBER_OF_COMERCIAL = {
	role: "tenant_member" as const,
	userId: "beto",
	rules: [
		members("", "lector"),
		members("direccion", "ninguno"),
		user("comercial", "beto", "administrador"),
	],
};

describe("previewDelete", () => {
	it("un administrador del tenant recibe el resumen con todas las que enlazan", async () => {
		const { deps } = setup();
		const result = await previewDelete("i", "comercial/icp", deps);
		expect(result).toMatchObject({
			ok: true,
			preview: {
				slug: "comercial/icp",
				title: "ICP",
				revision: 3,
				hasChildren: true,
				canonTags: ["canon:icp"],
				hiddenLinkers: 0,
			},
		});
		if (result.ok) {
			expect(result.preview.linkers.map((l) => l.slug).sort()).toEqual([
				"direccion/secreta",
				"legal/contrato",
			]);
		}
	});

	it("a un administrador de nodo le muestra las que ve y solo cuenta las ocultas, sin rutas ni títulos", async () => {
		const { deps } = setup(MEMBER_OF_COMERCIAL);
		const result = await previewDelete("i", "comercial/icp", deps);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.preview.linkers.map((l) => l.slug)).toEqual(["legal/contrato"]);
		expect(result.preview.hiddenLinkers).toBe(1);
		expect(JSON.stringify(result)).not.toContain("direccion");
		expect(JSON.stringify(result)).not.toContain("secreta");
	});

	it("quien no ve la página recibe not_found; quien la ve sin administrarla, forbidden", async () => {
		const hidden = setup({
			role: "tenant_member",
			userId: "ana",
			rules: [members("", "lector"), members("comercial", "ninguno")],
		});
		expect(await previewDelete("i", "comercial/icp", hidden.deps)).toMatchObject({
			ok: false,
			code: "not_found",
		});
		const visible = setup({ role: "tenant_member", userId: "ana" });
		expect(await previewDelete("i", "comercial/icp", visible.deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
	});

	it("una página que no existe, un slug inválido y un tenant sin sesión responden not_found", async () => {
		const { deps } = setup();
		expect(await previewDelete("i", "no-existe", deps)).toMatchObject({ code: "not_found" });
		expect(await previewDelete("i", "../x", deps)).toMatchObject({ code: "not_found" });
		deps.actor = async () => null;
		expect(await previewDelete("i", "comercial/icp", deps)).toMatchObject({ code: "not_found" });
	});

	it("sin brain es not_found y con un brain externo (mcp) es unsupported", async () => {
		expect(
			await previewDelete("i", "comercial/icp", setup({ hasBinding: false }).deps),
		).toMatchObject({ code: "not_found" });
		expect(
			await previewDelete("i", "comercial/icp", setup({ provider: "mcp" }).deps),
		).toMatchObject({ ok: false, code: "unsupported" });
	});

	it("si las reglas no se pueden cargar, lanza: falla cerrada", async () => {
		const { deps } = setup({ role: "tenant_member", userId: "ana" });
		deps.rules = {
			load: async () => {
				throw new Error("base caída");
			},
		};
		await expect(previewDelete("i", "comercial/icp", deps)).rejects.toThrow(/base caída/);
	});

	it("una página sin hijos ni etiquetas de canon lo dice", async () => {
		const { deps } = setup();
		const result = await previewDelete("i", "suelta", deps);
		expect(result).toMatchObject({
			ok: true,
			preview: { hasChildren: false, canonTags: [], linkers: [], hiddenLinkers: 0 },
		});
	});
});

describe("deletePage", () => {
	it("arma el plan en el servidor y llama al escritor con la revisión esperada", async () => {
		const { deps, del } = setup();
		const result = await deletePage("i", "comercial/icp", 3, deps);
		expect(result).toEqual({ ok: true, cleaned: 2 });
		expect(del).toHaveBeenCalledWith({
			tenantId: "t1",
			slug: "comercial/icp",
			expectedRevision: 3,
			actorUserId: "admin1",
			bindingId: "b1",
			cleanups: [
				{ slug: "legal/contrato", baseRevision: 3, body: "Ver el perfil." },
				{ slug: "direccion/secreta", baseRevision: 3, body: "Ver ICP." },
			],
		});
	});

	it("limpia también las páginas que quien borra no ve", async () => {
		const { deps, del } = setup(MEMBER_OF_COMERCIAL);
		await deletePage("i", "comercial/icp", 3, deps);
		const sent = del.mock.calls[0][0].cleanups.map((c: { slug: string }) => c.slug);
		expect(sent).toContain("direccion/secreta");
	});

	it("quien no administra el nodo no borra nada", async () => {
		const { deps, del } = setup({ role: "tenant_member", userId: "ana" });
		expect(await deletePage("i", "comercial/icp", 3, deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(del).not.toHaveBeenCalled();
	});

	it("un conflicto de la base responde conflict; una página que ya no está, not_found", async () => {
		const conflict = setup({
			deleterError: new WikiStoreError("BR409", "BRAIN_CONFLICT", "5"),
		});
		expect(await deletePage("i", "comercial/icp", 3, conflict.deps)).toMatchObject({
			ok: false,
			code: "conflict",
		});
		const gone = setup({
			deleterError: new WikiStoreError("BR404", "BRAIN_NOT_FOUND", "comercial/icp"),
		});
		expect(await deletePage("i", "comercial/icp", 3, gone.deps)).toMatchObject({
			code: "not_found",
		});
	});

	it("cualquier otro error del escritor se propaga", async () => {
		const { deps } = setup({ deleterError: new Error("red caída") });
		await expect(deletePage("i", "comercial/icp", 3, deps)).rejects.toThrow(/red caída/);
	});

	it("con un brain externo no escribe", async () => {
		const { deps, del } = setup({ provider: "mcp" });
		expect(await deletePage("i", "comercial/icp", 3, deps)).toMatchObject({
			code: "unsupported",
		});
		expect(del).not.toHaveBeenCalled();
	});
});
```

El plan sale en el orden de `pages` (en `PAGES`, `legal/contrato` antes que `direccion/secreta`), y el esperado del test respeta ese orden.

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/editor-delete.test.ts`
Expected: FAIL — `@/lib/brain/core/editor/delete` no existe.

- [ ] **Step 3: Implementar**

`lib/brain/core/editor/delete.ts`:

```ts
// Borrado de páginas (spec etapa 18.1 §5). Sin Next ni Supabase: recibe sus
// dependencias, como savePage y changeAccess. El permiso se decide acá, con las
// reglas del tenant; la escritura corre con service role.
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRulesStore,
	isAdminRole,
	type Principal,
} from "../access/types.ts";
import type { PageDeleter } from "../delete-store.ts";
import { planLinkCleanup } from "../links-cleanup";
import {
	type BrainPage,
	type BrainRole,
	CANON_TAGS,
	MAX_SLUG_LENGTH,
	SLUG_PATTERN,
} from "../types";
import { WikiStoreError } from "../wiki-store.ts";

export type DeleteFailure = {
	ok: false;
	code: "not_found" | "forbidden" | "conflict" | "unsupported";
	message: string;
};

export interface DeletePreview {
	slug: string;
	title: string;
	revision: number;
	// Solo las páginas que enlazan y que la persona ve.
	linkers: Array<{ slug: string; title: string }>;
	// Las demás: se cuentan, no se nombran (A8 de la Etapa 17).
	hiddenLinkers: number;
	hasChildren: boolean;
	canonTags: string[];
}

export interface DeleteDeps {
	actor(
		tenantSlug: string,
	): Promise<{ tenantId: string; userId: string; role: BrainRole } | null>;
	rules: AccessRulesStore;
	binding(
		tenantId: string,
	): Promise<{ id: string; provider: "wiki" | "mcp" } | null>;
	// Todas las páginas del tenant, SIN envolver con permisos: la limpieza tiene
	// que ver también las que quien borra no ve.
	pages(tenantId: string): Promise<BrainPage[]>;
	deleter: PageDeleter;
}

const fail = (code: DeleteFailure["code"], message: string): DeleteFailure => ({
	ok: false,
	code,
	message,
});
const NOT_FOUND = "No encontrado.";

function isValidSlug(slug: string): boolean {
	return slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

type Authorized = {
	ok: true;
	tenantId: string;
	actorUserId: string;
	principal: Principal;
	rules: Awaited<ReturnType<AccessRulesStore["load"]>>;
	bindingId: string;
	pages: BrainPage[];
	page: BrainPage;
};

// Quién es, qué ve y si administra la página. Lo que no ve responde not_found.
async function authorize(
	tenantSlug: string,
	slug: string,
	deps: DeleteDeps,
): Promise<Authorized | DeleteFailure> {
	if (!isValidSlug(slug)) return fail("not_found", NOT_FOUND);
	const actor = await deps.actor(tenantSlug);
	if (!actor) return fail("not_found", NOT_FOUND);

	const binding = await deps.binding(actor.tenantId);
	if (!binding) return fail("not_found", NOT_FOUND);
	if (binding.provider !== "wiki") {
		return fail(
			"unsupported",
			"Este brain es externo: las páginas se borran en su origen.",
		);
	}

	// Solo un miembro común depende de las reglas. Si no se pueden cargar, esto
	// lanza: falla cerrada.
	const rules = isAdminRole(actor.role)
		? []
		: await deps.rules.load(actor.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: actor.userId,
		role: actor.role,
	};
	const level = resolveAccess(rules, principal, slug);
	if (level === null) return fail("not_found", NOT_FOUND);
	if (level !== "administrador") {
		return fail("forbidden", "Solo un administrador puede borrar esta página.");
	}

	const pages = await deps.pages(actor.tenantId);
	const page = pages.find((p) => p.slug === slug);
	if (!page) return fail("not_found", NOT_FOUND);

	return {
		ok: true,
		tenantId: actor.tenantId,
		actorUserId: actor.userId,
		principal,
		rules,
		bindingId: binding.id,
		pages,
		page,
	};
}

export async function previewDelete(
	tenantSlug: string,
	slug: string,
	deps: DeleteDeps,
): Promise<{ ok: true; preview: DeletePreview } | DeleteFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;

	const plan = planLinkCleanup(auth.pages, slug);
	const visible = plan.filter(
		(item) => resolveAccess(auth.rules, auth.principal, item.slug) !== null,
	);
	return {
		ok: true,
		preview: {
			slug,
			title: auth.page.title,
			revision: auth.page.revision,
			linkers: visible.map(({ slug: s, title }) => ({ slug: s, title })),
			hiddenLinkers: plan.length - visible.length,
			hasChildren: auth.pages.some((p) => p.slug.startsWith(`${slug}/`)),
			canonTags: auth.page.tags.filter((tag) =>
				(CANON_TAGS as readonly string[]).includes(tag),
			),
		},
	};
}

export async function deletePage(
	tenantSlug: string,
	slug: string,
	expectedRevision: number,
	deps: DeleteDeps,
): Promise<{ ok: true; cleaned: number } | DeleteFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;

	// El plan se arma de nuevo acá (D9): lo que se escribe no depende de lo que
	// vio o mandó el navegador.
	const plan = planLinkCleanup(auth.pages, slug);
	try {
		const outcome = await deps.deleter.delete({
			tenantId: auth.tenantId,
			slug,
			expectedRevision,
			actorUserId: auth.actorUserId,
			bindingId: auth.bindingId,
			cleanups: plan.map(({ slug: s, baseRevision, body }) => ({
				slug: s,
				baseRevision,
				body,
			})),
		});
		return { ok: true, cleaned: outcome.cleaned };
	} catch (error) {
		if (error instanceof WikiStoreError) {
			if (error.code === "BR409") {
				return fail(
					"conflict",
					"La página o alguna de las que la enlazan cambió. Volvé a abrir el diálogo.",
				);
			}
			if (error.code === "BR404") return fail("not_found", NOT_FOUND);
		}
		throw error;
	}
}
```

- [ ] **Step 4: Correr los tests, frontera y tipos**

Run: `npx vitest run tests/brain/editor-delete.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Formatear y commitear**

```bash
npx biome check --write lib/brain/core/editor/delete.ts tests/brain/editor-delete.test.ts
git add lib/brain/core/editor/delete.ts tests/brain/editor-delete.test.ts
git commit -m "feat: núcleo del borrado de páginas del brain con vista previa y permisos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Adaptador y server actions

**Files:**
- Create: `lib/brain/adapters/delete-page.ts`
- Create: `app/[tenant]/brain/delete-actions.ts`
- Test: `tests/brain/delete-actions.test.ts`

**Interfaces:**
- Consumes: `DeleteDeps`, `previewDelete`, `deletePage` (Tarea 4); `createSupabasePageDeleter` (Tarea 3); `accessRulesStore` (`adapters/access-rules.ts`); `getBrainProvider` (`adapters/provider.ts`); `resolveBrainBinding` (`core/resolve`); `loadTenantBindings`; `resolveTenantAccess`; `createAdminClient`.
- Produces (Tarea 6): server actions `getDeletePreview(raw: unknown)` y `deleteBrainPage(raw: unknown)`; `deleteDeps(): DeleteDeps` en el adaptador.

- [ ] **Step 1: Escribir el test de las acciones**

`tests/brain/delete-actions.test.ts` (mismo patrón que `tests/brain/access-actions.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const previewDelete = vi.fn();
const deletePage = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/brain/adapters/delete-page", () => ({ deleteDeps: () => ({}) }));
vi.mock("@/lib/brain/core/editor/delete", () => ({ previewDelete, deletePage }));

const { getDeletePreview, deleteBrainPage } = await import(
	"@/app/[tenant]/brain/delete-actions"
);

beforeEach(() => {
	previewDelete.mockReset();
	deletePage.mockReset();
	revalidatePath.mockReset();
});

describe("delete actions", () => {
	it("rechaza datos mal formados sin llegar al núcleo", async () => {
		expect(await getDeletePreview({ tenantSlug: "A B", slug: "x" })).toMatchObject({ ok: false, code: "invalid" });
		expect(await getDeletePreview({ tenantSlug: "innovas", slug: "" })).toMatchObject({ code: "invalid" });
		expect(await deleteBrainPage({ tenantSlug: "innovas", slug: "x", expectedRevision: 0 })).toMatchObject({ code: "invalid" });
		expect(await deleteBrainPage({ tenantSlug: "innovas", slug: "x", expectedRevision: 1.5 })).toMatchObject({ code: "invalid" });
		expect(previewDelete).not.toHaveBeenCalled();
		expect(deletePage).not.toHaveBeenCalled();
	});

	it("la vista previa pasa tenant y slug ya validados y no revalida nada", async () => {
		previewDelete.mockResolvedValueOnce({ ok: true, preview: {} });
		await getDeletePreview({ tenantSlug: "innovas", slug: "comercial/icp" });
		expect(previewDelete).toHaveBeenCalledWith("innovas", "comercial/icp", {});
		expect(revalidatePath).not.toHaveBeenCalled();
	});

	it("borrar pasa la revisión esperada y revalida el brain solo si salió bien", async () => {
		deletePage.mockResolvedValueOnce({ ok: true, cleaned: 2 });
		expect(
			await deleteBrainPage({ tenantSlug: "innovas", slug: "comercial/icp", expectedRevision: 3 }),
		).toEqual({ ok: true, cleaned: 2 });
		expect(deletePage).toHaveBeenCalledWith("innovas", "comercial/icp", 3, {});
		expect(revalidatePath).toHaveBeenCalledWith("/innovas/brain", "layout");

		revalidatePath.mockReset();
		deletePage.mockResolvedValueOnce({ ok: false, code: "forbidden", message: "no" });
		await deleteBrainPage({ tenantSlug: "innovas", slug: "comercial/icp", expectedRevision: 3 });
		expect(revalidatePath).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/delete-actions.test.ts`
Expected: FAIL — las acciones no existen.

- [ ] **Step 3: Implementar el adaptador**

`lib/brain/adapters/delete-page.ts`:

```ts
// Cablea el borrado de páginas con la plataforma: sesión, binding, reglas y
// cliente admin. El permiso lo decide core/editor/delete.ts.
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { createSupabasePageDeleter } from "../core/delete-store";
import type { DeleteDeps } from "../core/editor/delete";
import { resolveBrainBinding } from "../core/resolve";
import { accessRulesStore } from "./access-rules";
import { getBrainProvider } from "./provider";

export function deleteDeps(): DeleteDeps {
	return {
		async actor(tenantSlug) {
			const tenant = await resolveTenantAccess(tenantSlug);
			return tenant
				? { tenantId: tenant.id, userId: tenant.userId, role: tenant.role }
				: null;
		},
		rules: accessRulesStore(),
		async binding(tenantId) {
			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			return binding ? { id: binding.id, provider: binding.provider } : null;
		},
		// list() del proveedor sin envolver: la limpieza ve también lo que quien
		// borra no puede ver.
		async pages(tenantId) {
			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			if (!binding || binding.provider !== "wiki") return [];
			return getBrainProvider(binding).list();
		},
		deleter: createSupabasePageDeleter(createAdminClient()),
	};
}
```

- [ ] **Step 4: Implementar las acciones**

`app/[tenant]/brain/delete-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteDeps } from "@/lib/brain/adapters/delete-page";
import { deletePage, previewDelete } from "@/lib/brain/core/editor/delete";

// Una server action la invoca cualquier cliente autenticado con lo que quiera:
// se valida la forma en el borde; el permiso lo decide el núcleo.
const base = {
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	slug: z.string().min(1).max(200),
};

const invalid = {
	ok: false,
	code: "invalid",
	message: "Datos inválidos.",
} as const;

export async function getDeletePreview(raw: unknown) {
	const parsed = z.object(base).safeParse(raw);
	if (!parsed.success) return invalid;
	return previewDelete(parsed.data.tenantSlug, parsed.data.slug, deleteDeps());
}

export async function deleteBrainPage(raw: unknown) {
	const parsed = z
		.object({ ...base, expectedRevision: z.number().int().positive() })
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, expectedRevision } = parsed.data;
	const result = await deletePage(tenantSlug, slug, expectedRevision, deleteDeps());
	if (result.ok) revalidatePath(`/${tenantSlug}/brain`, "layout");
	return result;
}
```

- [ ] **Step 5: Correr tests y tipos**

Run: `npx vitest run tests/brain/delete-actions.test.ts tests/brain/editor-delete.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio. Si `@/app/[tenant]/...` no resuelve en Vitest, usar la ruta relativa como `tests/brain/access-actions.test.ts`.

- [ ] **Step 6: Formatear y commitear**

```bash
npx biome check --write lib/brain/adapters/delete-page.ts "app/[tenant]/brain/delete-actions.ts" tests/brain/delete-actions.test.ts
git add lib/brain/adapters/delete-page.ts "app/[tenant]/brain/delete-actions.ts" tests/brain/delete-actions.test.ts
git commit -m "feat: server actions del borrado de páginas del brain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Interfaz — diálogo, botón y menú

**Files:**
- Create: `components/brain/delete-page-dialog.tsx`
- Create: `components/brain/delete-page-button.tsx`
- Modify: `components/brain/tree-row-menu.tsx` (ítem "Borrar…" y prop `onDelete`)
- Modify: `components/brain/brain-tree.tsx` (estado `deleting` y montaje del diálogo)
- Modify: `app/[tenant]/brain/p/[...slug]/page.tsx` (botón "Borrar página")

**Interfaces:**
- Consumes: `getDeletePreview`, `deleteBrainPage` (Tarea 5); `DeletePreview` (Tarea 4); `AlertDialog*` de `components/ui/alert-dialog.tsx`; `TreeNode` (Etapa 17).
- Produces: `<DeletePageDialog tenantSlug slug title onClose />` y `<DeletePageButton tenantSlug slug title />`.

- [ ] **Step 1: Escribir el diálogo**

`components/brain/delete-page-dialog.tsx` (cumple §6 de la spec: resumen, lista de páginas visibles, cantidad de ocultas, avisos de canon y de páginas debajo, botón destructivo; se monta cuando se pide y carga la vista previa al abrirse):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
	deleteBrainPage,
	getDeletePreview,
} from "@/app/[tenant]/brain/delete-actions";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { DeletePreview } from "@/lib/brain/core/editor/delete";

type Loaded = { preview: DeletePreview };
type Failed = { error: string };

export function DeletePageDialog({
	tenantSlug,
	slug,
	title,
	onClose,
}: {
	tenantSlug: string;
	slug: string;
	title: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const [state, setState] = useState<Loaded | Failed | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		getDeletePreview({ tenantSlug, slug })
			.then((result) => {
				if (cancelled) return;
				setState(
					result.ok ? { preview: result.preview } : { error: result.message },
				);
			})
			.catch(() => {
				if (!cancelled) setState({ error: "No se pudo cargar. Probá de nuevo." });
			});
		return () => {
			cancelled = true;
		};
	}, [tenantSlug, slug]);

	async function confirm(preview: DeletePreview) {
		setBusy(true);
		setError(null);
		try {
			const result = await deleteBrainPage({
				tenantSlug,
				slug,
				expectedRevision: preview.revision,
			});
			if (!result.ok) {
				setError(result.message);
				return;
			}
			const folder = slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : null;
			router.push(
				folder ? `/${tenantSlug}/brain?carpeta=${folder}` : `/${tenantSlug}/brain`,
			);
			router.refresh();
			onClose();
		} catch {
			setError("No se pudo borrar. Probá de nuevo.");
		} finally {
			setBusy(false);
		}
	}

	const preview = state && "preview" in state ? state.preview : null;

	return (
		<AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<AlertDialogHeader>
					<AlertDialogTitle>Borrar "{title}"</AlertDialogTitle>
					<AlertDialogDescription>
						<code>{slug}</code>. No se puede deshacer: se borra la página con
						todo su historial.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{state === null && (
					<p className="text-muted-foreground text-sm">Cargando…</p>
				)}
				{state && "error" in state && (
					<p role="alert" className="text-sm">
						{state.error}
					</p>
				)}
				{preview && (
					<div className="space-y-3 text-sm">
						{preview.linkers.length > 0 || preview.hiddenLinkers > 0 ? (
							<div className="space-y-1">
								<p>En estas páginas el link se reemplaza por su texto:</p>
								<ul className="list-disc space-y-0.5 pl-5">
									{preview.linkers.map((linker) => (
										<li key={linker.slug}>
											{linker.title}{" "}
											<span className="text-muted-foreground text-xs">
												{linker.slug}
											</span>
										</li>
									))}
								</ul>
								{preview.hiddenLinkers > 0 && (
									<p className="text-muted-foreground">
										y {preview.hiddenLinkers}{" "}
										{preview.hiddenLinkers === 1 ? "página más" : "páginas más"}{" "}
										que no podés ver.
									</p>
								)}
							</div>
						) : (
							<p className="text-muted-foreground">
								Ninguna otra página enlaza a esta.
							</p>
						)}
						{preview.canonTags.length > 0 && (
							<p>
								<strong>Ojo:</strong> los agentes usan esta página para redactar (
								{preview.canonTags.join(", ")}).
							</p>
						)}
						{preview.hasChildren && (
							<p>Las páginas que cuelgan de esta no se borran.</p>
						)}
					</div>
				)}
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy} className="min-h-11">
						Cancelar
					</AlertDialogCancel>
					<Button
						type="button"
						variant="destructive"
						className="min-h-11"
						disabled={busy || !preview}
						onClick={() => preview && confirm(preview)}
					>
						Borrar definitivamente
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
```

Si `components/ui/alert-dialog.tsx` no exporta alguno de esos nombres, usar los que exporte (es el `AlertDialog` estándar de shadcn); si `Button` no tiene la variante `destructive`, usar la clase `bg-destructive text-white hover:bg-destructive/90`. No se usa `AlertDialogAction` a propósito: cierra el diálogo al hacer clic, y acá tiene que quedar abierto hasta que termine y para mostrar un error.

- [ ] **Step 2: Escribir el botón de la vista de la página**

`components/brain/delete-page-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DeletePageDialog } from "@/components/brain/delete-page-dialog";
import { Button } from "@/components/ui/button";

export function DeletePageButton({
	tenantSlug,
	slug,
	title,
}: {
	tenantSlug: string;
	slug: string;
	title: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				type="button"
				variant="outline"
				className="min-h-11 text-destructive"
				onClick={() => setOpen(true)}
			>
				Borrar página
			</Button>
			{open && (
				<DeletePageDialog
					tenantSlug={tenantSlug}
					slug={slug}
					title={title}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}
```

- [ ] **Step 3: Sumar "Borrar…" al menú del árbol**

En `components/brain/tree-row-menu.tsx`: agregar la prop `onDelete: () => void` y, después del ítem "Compartir…", un ítem solo para nodos con página y nivel `administrador`:

```tsx
	if (node.page && node.level === "administrador") {
		items.push(
			<DropdownMenuItem
				key="delete"
				className="min-h-11 text-destructive focus:text-destructive lg:min-h-0"
				onSelect={onDelete}
			>
				Borrar…
			</DropdownMenuItem>,
		);
	}
```

En `components/brain/brain-tree.tsx`: agregar el estado `const [deleting, setDeleting] = useState<{ slug: string; title: string } | null>(null);`; pasar a los dos `TreeRowMenu` (filas y raíz) `onDelete={() => node.page && setDeleting({ slug: node.page.slug, title: node.page.title })}` (la raíz no tiene página: pasa una función vacía); y montar, junto al `ShareDialog`, `{deleting && <DeletePageDialog tenantSlug={tenantSlug} slug={deleting.slug} title={deleting.title} onClose={() => setDeleting(null)} />}`. Importar `DeletePageDialog`.

- [ ] **Step 4: Sumar "Borrar página" a la vista de la página**

En `app/[tenant]/brain/p/[...slug]/page.tsx`, junto al botón "Historial" (antes del de "Editar"), mostrar el botón solo a quien administra la página:

```tsx
{ctx.access(slug) === "administrador" && (
	<DeletePageButton tenantSlug={tenantSlug} slug={slug} title={page.title} />
)}
```

con `import { DeletePageButton } from "@/components/brain/delete-page-button";`.

- [ ] **Step 5: Tipos, lint y suite**

```bash
npm run typecheck && npx vitest run tests/brain
npx biome check --write components/brain/delete-page-dialog.tsx components/brain/delete-page-button.tsx components/brain/tree-row-menu.tsx components/brain/brain-tree.tsx "app/[tenant]/brain/p/[...slug]/page.tsx"
```
Expected: todo en verde. Si Biome reformatea código ajeno al cambio dentro de esos archivos, revertir ese hunk.

- [ ] **Step 6: Verificar en el navegador (si el entorno lo permite)**

Si el worktree no tiene `.env.local` ni login sembrado, **no intentar**: dejar escrito en el reporte exactamente qué no se verificó. Con entorno: abrir una página con links entrantes como administrador y comprobar el menú de tres puntos ("Borrar…" último y en rojo), el diálogo (lista de páginas, "y N páginas más", avisos de canon y de hijos, botón deshabilitado mientras carga), el borrado (vuelve a `/brain` o a `?carpeta=`, las páginas que enlazaban muestran el texto sin link), un miembro sin administración (no ve "Borrar…"), y 375 px sin scroll horizontal.

- [ ] **Step 7: Commitear**

```bash
git add components/brain/delete-page-dialog.tsx components/brain/delete-page-button.tsx components/brain/tree-row-menu.tsx components/brain/brain-tree.tsx "app/[tenant]/brain/p/[...slug]/page.tsx"
git commit -m "feat: diálogo de borrado de páginas del brain desde el árbol y la vista de la página

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cierre — documentación y verificación final

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-brain-design.md` (reescribe B8)
- Modify: `lib/brain/README.md` (sección "Borrar páginas")
- Modify: `docs/01-roadmap-etapas.md` (Etapa 18, entrega 18.1)

- [ ] **Step 1: Documentar**

1. En `docs/superpowers/specs/2026-09-13-brain-design.md`, reescribir la fila B8 de la tabla de decisiones: **"Las páginas se archivan; el borrado real existe solo desde la web, por un administrador del nodo, con limpieza de links y sin papelera. Ninguna tool del agente ni del MCP borra"**, con la razón "Reemplaza la regla original ('nunca se borran'). Ver `2026-10-08-etapa-18-1-borrado-paginas-brain-design.md`".
2. En `lib/brain/README.md`, agregar la sección **"Borrar páginas"**: `core/editor/delete.ts` es el único camino (exige administrador del nodo, arma el plan de limpieza en el servidor, `previewDelete` solo cuenta las páginas ocultas que enlazan); `core/wikilinks.ts` (`removeWikilinks`) y `core/links-cleanup.ts` (`planLinkCleanup`) son puras; `core/delete-store.ts` llama a la función SQL `brain_delete_page`, que limpia, borra, quita las reglas de la ruta si no queda nada debajo y deja `brain.page_deleted` en una transacción; el borrado no pasa por `BrainProvider`, así que agente y MCP no pueden borrar; las server actions viven en `app/[tenant]/brain/delete-actions.ts` y el cableado en `adapters/delete-page.ts`. Sumar la migración `20261009120000_brain_delete_page` y el pgTAP `23_brain_delete_page.test.sql` a las listas "viaja con el módulo".
3. En `docs/01-roadmap-etapas.md`, después de la Etapa 17, agregar la sección **"Etapa 18 · Borrado de páginas y editor visual del brain — `[ ]`"** con dos entregas: `[x] 18.1 · Borrado de páginas` (spec y plan de esta entrega; deja escrito: **antes de desplegar, aplicar la migración `20261009120000_brain_delete_page` a producción (corriendo `npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después desplegar el código; al revés, el diálogo falla al borrar**; y qué quedó sin verificar en navegador) y `[ ] 18.2 · Editor visual y vista de papel` (spec: `2026-10-08-etapa-18-2-editor-visual-brain-design.md`).

- [ ] **Step 2: Verificación completa**

```bash
npm run typecheck
npm test
npm run db:test
grep -rn "brain_delete_page\|deletePage\|previewDelete" lib/brain/core/contract.ts lib/brain/core/types.ts lib/brain/adapters/tools.ts lib/brain/core/mcp-server || true
```
Expected: typecheck limpio; todos los tests en verde; pgTAP en verde (incluye `23_brain_delete_page`); el `grep` no imprime nada: ni `BrainProvider`, ni el contrato del agente, ni las tools, ni el MCP conocen el borrado (Review Focus 7).

- [ ] **Step 3: Verificar el criterio de cierre de la spec (§1) en el navegador**

Si no hay entorno local con login, anotar en el reporte que **no se corrió** y que lo hace una persona en producción después del despliegue: borrar una página enlazada desde otras dos y comprobar las cinco condiciones de §1.

- [ ] **Step 4: Commitear**

```bash
git add docs/superpowers/specs/2026-09-13-brain-design.md lib/brain/README.md docs/01-roadmap-etapas.md
git commit -m "docs: cierre de la entrega 18.1, borrado de páginas del brain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Cobertura de la spec (§2 a §8):** D1/D2 (borrado real, solo web, sin papelera) → Tareas 4 a 7. D3 y §3 (limpieza de links) → Tarea 1. D4 (limpiar las ocultas, contar sin nombrar) → Tarea 4. D5/§4 (función SQL atómica con evento) → Tarea 2. D6 (revisión por página limpiada) → Tarea 2. D7/D8 (página que es carpeta; reglas solo si no queda nada) → Tarea 2. D9 (plan en el servidor) → Tarea 4. D10 (`unsupported` para `mcp`) → Tarea 4. §5.2 acciones → Tarea 5. §6 pantallas → Tarea 6. §7 otras superficies y documentación → Tarea 7. §8 pruebas → Tareas 1 a 5.

**Escaneo de marcadores sin completar:** ninguno; cada paso tiene el código o el comando. Los dos puntos donde el entorno puede obligar a un ajuste menor (conteo de `plan(N)` de pgTAP, nombres exportados de `alert-dialog.tsx`) lo dicen en el paso.

**Consistencia de tipos:** `CleanupItem` y `planLinkCleanup` (Tarea 1) los usa `delete.ts` (Tarea 4); `PageDeleter`/`DeleteParams`/`DeleteOutcome` (Tarea 3) los usan `delete.ts` y el adaptador (Tarea 5); `DeletePreview` (Tarea 4) lo consume el diálogo (Tarea 6); los parámetros `p_*` de `brain_delete_page` (Tarea 2) coinciden con el escritor (Tarea 3).
