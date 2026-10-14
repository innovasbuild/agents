# Etapa 26.1a · Carpetas del brain — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las carpetas del brain pasan a ser filas (`brain_folders`), se ven aunque estén vacías, la categoría de una página sale de su ruta, y un administrador crea, describe y borra carpetas desde el árbol. La consola deja de editar categorías.

**Architecture:** Una tabla nueva con RLS cerrado y funciones SQL `security invoker` que solo ejecuta `service_role` (mismo patrón que `brain_delete_page`). La lista `config.categories` del binding queda como reflejo de las carpetas de primer nivel, mantenido por `brain_sync_categories` en la misma transacción, así que ninguno de los llamadores de `resolveBrainBinding` cambia. El permiso se decide en un núcleo puro (`lib/brain/core/editor/folders.ts`, como `delete.ts`), el árbol recibe las carpetas además de las páginas y las pantallas suman un menú de carpeta.

**Tech Stack:** Next.js App Router (server actions), Supabase Postgres + pgTAP, Vitest, Tailwind + shadcn (`components/ui`), Biome.

**Spec:** `docs/superpowers/specs/2026-10-14-etapa-26-carpetas-y-reglas-brain-design.md` (§2 D1–D3, §3.1, §3.2, §3.4, §6). Mover y renombrar (§3.3) es el plan 26.1b, aparte.

## Global Constraints

- Toda tabla lleva `tenant_id` y RLS. `brain_folders` y sus funciones: RLS prendido, sin políticas, `revoke all ... from anon, authenticated`; las funciones `revoke execute ... from public, anon, authenticated` y `grant execute ... to service_role`.
- `events` es append-only: solo `insert`.
- Antes de tocar SQL, cargar el skill `supabase-postgres-best-practices`.
- Patrón de ruta: `^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$`, hasta 200 caracteres. Una carpeta de primer nivel además cumple el patrón de categoría `^[a-z][a-z0-9-]{0,40}$`.
- Descripción de carpeta: hasta 300 caracteres.
- Carpetas de primer nivel reservadas: `skills` (solo existe si ya existía la categoría `skill`) y `brain` (26.2). No se crean desde la pantalla.
- Hasta 20 carpetas de primer nivel.
- Solo el proveedor `wiki`. Un brain `mcp` responde `unsupported`.
- UI e instrucciones en español rioplatense; código e identificadores en inglés.
- Nada específico de un tenant en código.
- Comandos: `npm run typecheck` · `npm test` · `npm run lint:fix` (revertir los cuatro archivos ajenos que reformatea siempre, ver memoria) · `npm run db:reset` · `npm run db:test` · `npm run db:types` (necesitan Docker abierto) · `npm run docs:check`.
- Commits con prefijo (`feat:`, `fix:`, `docs:`) y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identidad git `innovasbuild` / `matias@innov.as`.

## Review Focus

1. **Una página que se borra sobre una carpeta vacía de su mismo nombre** (`x/y` página y carpeta a la vez): las reglas de acceso de `x/y` no se tienen que borrar, porque la carpeta sigue. Lo fija el test pgTAP 14 de la Task 2.
2. **Un miembro común sin acceso a una carpeta vacía** no la ve en el árbol ni en el índice. Las carpetas no tienen que filtrar rutas. Lo fija el test de `visibleTree` de la Task 4.
3. **Una escritura del agente en `comercial/sucursales/centro` cuando `comercial/sucursales` no existe** se rechaza con `folder_not_found` y el mensaje nombra la carpeta más cercana que existe. No se crea la carpeta. Lo fija el test de la Task 3.
4. **El import en una carpeta nueva** sigue andando: la base crea las carpetas que falten y suma la de primer nivel a `config.categories`. Lo fija el test pgTAP 9 de la Task 2.
5. **Borrar la última carpeta de primer nivel** se rechaza con `folder_last`. Si no, `parseWikiConfig` dejaría de aceptar la config y el brain del tenant desaparecería en silencio. Lo fija el test pgTAP 13 de la Task 2.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/brain/core/folders.ts` (nuevo) | Funciones puras: `categoryForPath`, `parentPath`, `nearestFolder`, `validateFolderPath`, constantes |
| `supabase/migrations/20261025120000_brain_folders.sql` (nuevo) | Tabla, funciones SQL, backfill, cambios a `brain_upsert_page` y `brain_delete_page`, borrado de `platform_set_brain_categories` |
| `supabase/tests/37_brain_folders.test.sql` (nuevo) | pgTAP de todo lo anterior |
| `lib/brain/core/wiki-store.ts` | `WikiStore.listFolders` |
| `lib/brain/core/wiki.ts` | La categoría se calcula y se chequea la carpeta |
| `lib/brain/core/folders-store.ts` (nuevo) | `FolderWriter` sobre Supabase (rpc) |
| `lib/brain/core/editor/folders.ts` (nuevo) | Núcleo de crear, describir y borrar, con permisos |
| `lib/brain/adapters/folders.ts` (nuevo) | Cablea el núcleo con la plataforma |
| `app/[tenant]/brain/folder-actions.ts` (nuevo) | Server actions |
| `lib/brain/core/access/tree.ts` | El árbol recibe las carpetas |
| `lib/brain/adapters/editor.ts` | Carga las carpetas para el árbol |
| `components/brain/folder-dialog.tsx` (nuevo), `components/brain/folder-delete-dialog.tsx` (nuevo) | Diálogos |
| `components/brain/tree-row-menu.tsx`, `components/brain/brain-tree.tsx`, `app/[tenant]/brain/page.tsx` | Menú, árbol e índice |
| `app/plataforma/[slug]/console/brain-section.tsx`, `app/plataforma/[slug]/console-actions.ts` | La consola muestra las categorías solo lectura |
| `lib/brain/core/folders-report.ts` (nuevo), `scripts/brain-folders-report.mts` (nuevo) | Reporte previo a la migración |

---

### Task 1: Funciones puras de carpetas

**Files:**
- Create: `lib/brain/core/folders.ts`
- Test: `tests/brain/folders.test.ts`

**Interfaces:**
- Produces:
  - `MAX_TOP_FOLDERS = 20`, `MAX_FOLDER_DESCRIPTION = 300`, `RESERVED_TOP_FOLDERS = ["skills", "brain"] as const`
  - `interface BrainFolder { path: string; description: string }`
  - `categoryForPath(slug: string): string`
  - `parentPath(slug: string): string | null` (`null` para un slug de un segmento)
  - `nearestFolder(path: string, folders: ReadonlySet<string>): string | null`
  - `validateFolderPath(path: string): { ok: true } | { ok: false; message: string }`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/folders.test.ts
import { describe, expect, it } from "vitest";
import {
	categoryForPath,
	nearestFolder,
	parentPath,
	validateFolderPath,
} from "@/lib/brain/core/folders";

describe("categoryForPath", () => {
	it("es el primer segmento", () => {
		expect(categoryForPath("talento/personal/leo")).toBe("talento");
		expect(categoryForPath("comercial")).toBe("comercial");
	});
	it("skills es la categoría skill", () => {
		expect(categoryForPath("skills/outreach")).toBe("skill");
	});
});

describe("parentPath", () => {
	it("saca el último segmento", () => {
		expect(parentPath("a/b/c")).toBe("a/b");
		expect(parentPath("a")).toBeNull();
	});
});

describe("nearestFolder", () => {
	const folders = new Set(["comercial", "comercial/icp"]);
	it("devuelve la carpeta más profunda que existe en el camino", () => {
		expect(nearestFolder("comercial/icp/x/y", folders)).toBe("comercial/icp");
		expect(nearestFolder("comercial/sucursales", folders)).toBe("comercial");
		expect(nearestFolder("marketing/x", folders)).toBeNull();
	});
});

describe("validateFolderPath", () => {
	it("acepta rutas válidas", () => {
		expect(validateFolderPath("comercial")).toEqual({ ok: true });
		expect(validateFolderPath("comercial/sucursales-norte")).toEqual({ ok: true });
	});
	it("rechaza mayúsculas, espacios y barras de más", () => {
		for (const bad of ["Comercial", "com ercial", "comercial/", "/x", "a//b", ""])
			expect(validateFolderPath(bad).ok).toBe(false);
	});
	it("una de primer nivel empieza con letra", () => {
		expect(validateFolderPath("2026").ok).toBe(false);
		expect(validateFolderPath("proyectos/2026")).toEqual({ ok: true });
	});
	it("rechaza las reservadas de primer nivel", () => {
		expect(validateFolderPath("skills")).toMatchObject({ ok: false });
		expect(validateFolderPath("brain")).toMatchObject({ ok: false });
		expect(validateFolderPath("comercial/brain")).toEqual({ ok: true });
	});
	it("rechaza rutas de más de 200 caracteres", () => {
		expect(validateFolderPath(`a/${"b".repeat(199)}`).ok).toBe(false);
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/folders.test.ts`
Expected: FAIL, no se puede resolver `@/lib/brain/core/folders`.

- [ ] **Step 3: Implementar**

```ts
// lib/brain/core/folders.ts
// Carpetas del brain (spec etapa 26 §3.1). Puro y sin imports de Next: lo usan
// el proveedor wiki, el editor y scripts con Node directo.
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "./types.ts";

export const MAX_TOP_FOLDERS = 20;
export const MAX_FOLDER_DESCRIPTION = 300;
// skills existe solo si el brain ya tenía la categoría skill; brain es la
// categoría de las instrucciones de la raíz (26.2).
export const RESERVED_TOP_FOLDERS = ["skills", "brain"] as const;

// Mismo patrón que el check de brain_pages.category.
const CATEGORY = /^[a-z][a-z0-9-]{0,40}$/;

export interface BrainFolder {
	path: string;
	description: string;
}

export function categoryForPath(slug: string): string {
	const first = slug.split("/")[0];
	return first === "skills" ? "skill" : first;
}

export function parentPath(slug: string): string | null {
	const cut = slug.lastIndexOf("/");
	return cut === -1 ? null : slug.slice(0, cut);
}

export function nearestFolder(
	path: string,
	folders: ReadonlySet<string>,
): string | null {
	for (let node: string | null = path; node !== null; node = parentPath(node)) {
		if (folders.has(node)) return node;
	}
	return null;
}

export function validateFolderPath(
	path: string,
): { ok: true } | { ok: false; message: string } {
	if (path.length === 0 || path.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(path))
		return {
			ok: false,
			message:
				"Usá minúsculas, números y guiones, con / entre carpetas y sin espacios.",
		};
	const top = path.split("/")[0];
	if (!path.includes("/") && !CATEGORY.test(top))
		return {
			ok: false,
			message: "Una carpeta de primer nivel empieza con una letra y tiene hasta 41 caracteres.",
		};
	if (!path.includes("/") && (RESERVED_TOP_FOLDERS as readonly string[]).includes(top))
		return { ok: false, message: `«${top}» es un nombre reservado del brain.` };
	return { ok: true };
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run tests/brain/folders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/folders.ts tests/brain/folders.test.ts
git commit -m "feat: funciones puras de carpetas del brain (26.1a)"
```

---

### Task 2: Migración de carpetas

**Files:**
- Create: `supabase/migrations/20261025120000_brain_folders.sql`
- Create: `supabase/tests/37_brain_folders.test.sql`
- Modify: `lib/supabase/database.types.ts` (regenerado con `npm run db:types`)

**Interfaces:**
- Produces (SQL, solo `service_role`):
  - tabla `public.brain_folders (id, tenant_id, path, description, created_by, created_at, updated_at)`
  - `brain_category_for(p_path text) returns text` (immutable)
  - `brain_sync_categories(p_tenant uuid) returns void`
  - `brain_ensure_folders(p_tenant uuid, p_path text, p_actor uuid) returns integer` (cantidad creada)
  - `brain_folders_from_config(p_tenant uuid) returns integer`
  - `brain_create_folder(p_tenant uuid, p_actor uuid, p_path text, p_description text) returns void`
  - `brain_set_folder_description(p_tenant uuid, p_actor uuid, p_path text, p_description text) returns void`
  - `brain_delete_folder(p_tenant uuid, p_actor uuid, p_path text) returns void`
  - Errores: `BR404` detail `folder` o `parent`; `BR409` detail `folder_exists`, `folder_not_empty` o `folder_last`; `BR422` detail `reserved_path`, `too_many` o `path`.

- [ ] **Step 1: Cargar el skill `supabase-postgres-best-practices`** y releer `supabase/migrations/20260913234426_brain_upsert_page.sql` y la definición vigente de `brain_delete_page` en `supabase/migrations/20261020120000_brain_skills.sql`.

- [ ] **Step 2: Escribir el test pgTAP que falla**

```sql
-- supabase/tests/37_brain_folders.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a7a7a7a7-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@fol-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b7b7b7b7-0000-0000-0000-00000000000a', 'fol-a', 'Fol A'),
       ('b7b7b7b7-0000-0000-0000-00000000000b', 'fol-b', 'Fol B');

insert into public.tenant_connections (tenant_id, capability, provider, config)
values
  ('b7b7b7b7-0000-0000-0000-00000000000a', 'brain', 'wiki',
   '{"categories": ["empresa", "comercial"], "requiredFrontmatter": [], "search": "fts"}'::jsonb),
  ('b7b7b7b7-0000-0000-0000-00000000000b', 'brain', 'wiki',
   '{"categories": ["empresa"], "requiredFrontmatter": [], "search": "fts"}'::jsonb);

-- 1-3: tabla cerrada
select has_table('public', 'brain_folders', 'existe brain_folders');
select ok(not has_table_privilege('authenticated', 'public.brain_folders', 'select'),
  'authenticated no lee brain_folders');
select ok(
  not has_function_privilege('authenticated',
    'public.brain_create_folder(uuid, uuid, text, text)', 'execute'),
  'authenticated no ejecuta brain_create_folder');

-- 4-5: carpetas desde la config
select is(public.brain_folders_from_config('b7b7b7b7-0000-0000-0000-00000000000a'), 2,
  'crea una carpeta por categoría');
select is(public.brain_folders_from_config('b7b7b7b7-0000-0000-0000-00000000000a'), 0,
  'correrla de nuevo no duplica');

-- 6-8: crear, con padre y sin padre
select lives_ok(
  $$select public.brain_create_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'comercial/sucursales', 'Una ficha por sucursal')$$,
  'crea una subcarpeta con padre');
select throws_ok(
  $$select public.brain_create_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'marketing/pauta', '')$$,
  'BR404', null, 'una subcarpeta sin padre responde not found');
select throws_ok(
  $$select public.brain_create_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'comercial', '')$$,
  'BR409', null, 'una carpeta que ya existe responde conflicto');

-- 9-10: una página nueva crea las carpetas que faltan y suma la categoría
select public.brain_upsert_page('b7b7b7b7-0000-0000-0000-00000000000a', 'marketing/pauta/meta', 'Meta', 'marketing', 'activo', '{}'::text[], '{}'::jsonb, 'x', 'alta', null, 'user', 'a7a7a7a7-0000-0000-0000-000000000001', null, null);
select is(
  (select array_agg(path order by path) from public.brain_folders where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and path like 'marketing%'),
  array['marketing', 'marketing/pauta'],
  'la página creó marketing y marketing/pauta');
select ok(
  (select config -> 'categories' ? 'marketing' from public.tenant_connections where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and capability = 'brain'),
  'la categoría nueva entró a la config');

-- 11-13: borrar (12: sin fila, 13: la última)
select throws_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'marketing')$$,
  'BR409', null, 'una carpeta con algo adentro no se borra');
select throws_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000b', 'a7a7a7a7-0000-0000-0000-000000000001', 'empresa')$$,
  'BR404', null, 'una carpeta sin fila responde not found');
select public.brain_folders_from_config('b7b7b7b7-0000-0000-0000-00000000000b');
select throws_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000b', 'a7a7a7a7-0000-0000-0000-000000000001', 'empresa')$$,
  'BR409', null, 'la última carpeta de primer nivel no se borra');

-- 14: borrar una página que comparte nombre con una carpeta conserva las reglas
select public.brain_upsert_page('b7b7b7b7-0000-0000-0000-00000000000a', 'comercial/sucursales', 'Sucursales', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'x', 'alta', null, 'user', 'a7a7a7a7-0000-0000-0000-000000000001', null, null);
insert into public.brain_access_rules (tenant_id, path, principal, level)
values ('b7b7b7b7-0000-0000-0000-00000000000a', 'comercial/sucursales', 'members', 'ninguno');
select * from public.brain_delete_page('b7b7b7b7-0000-0000-0000-00000000000a', 'comercial/sucursales', 1, 'a7a7a7a7-0000-0000-0000-000000000001', null, '[]'::jsonb);
select is(
  (select count(*)::int from public.brain_access_rules where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and path = 'comercial/sucursales'), 1,
  'las reglas de la carpeta siguen después de borrar la página homónima');

-- 15-17: borrar una vacía saca la carpeta, sus reglas y la categoría
select lives_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'comercial/sucursales')$$,
  'una carpeta vacía se borra');
select is(
  (select count(*)::int from public.brain_access_rules where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and path = 'comercial/sucursales'), 0,
  'sus reglas de acceso se borran con ella');
select lives_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'empresa')$$,
  'una de primer nivel vacía se borra si quedan otras');
select ok(
  (select not (config -> 'categories' ? 'empresa') from public.tenant_connections where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and capability = 'brain'),
  'y sale de la config');

-- 18-19: reservadas y descripción
select throws_ok(
  $$select public.brain_create_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'brain', '')$$,
  'BR422', null, 'brain es reservada');
select lives_ok(
  $$select public.brain_set_folder_description('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'comercial', 'Embudo después del CRM')$$,
  'se edita la descripción');
select is(
  (select description from public.brain_folders where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and path = 'comercial'),
  'Embudo después del CRM', 'la descripción quedó');

-- 20: aislamiento entre tenants
select is(
  (select count(*)::int from public.brain_folders where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000b'), 1,
  'el otro tenant tiene solo su carpeta');

-- 21-22: eventos y categoría calculada
select ok(
  (select count(*) > 0 from public.events where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and type = 'brain.folder_created'),
  'crear deja evento');
select is(public.brain_category_for('skills/outreach'), 'skill', 'skills es la categoría skill');

select * from finish();
rollback;
```

- [ ] **Step 3: Correrlo y ver que falla**

Run: `npm run db:reset && npm run db:test`
Expected: FAIL en `37_brain_folders.test.sql`: no existe `brain_folders`.

- [ ] **Step 4: Escribir la migración**

```sql
-- supabase/migrations/20261025120000_brain_folders.sql
-- Etapa 26.1a: las carpetas del brain pasan a ser filas (spec etapa 26 §3.1).
-- config.categories del binding queda como reflejo de las de primer nivel, y lo
-- mantiene brain_sync_categories en la misma transacción que la cambia.

create table public.brain_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  path text not null check (
    char_length(path) <= 200
    and path ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'
    -- Una de primer nivel es una categoría: mismo patrón que brain_pages.category.
    and (position('/' in path) > 0 or path ~ '^[a-z][a-z0-9-]{0,40}$')
  ),
  description text not null default '' check (char_length(description) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, path)
);
create index brain_folders_created_by_idx on public.brain_folders (created_by);

-- Solo el servidor lee y escribe: lo que ve cada persona lo decide withAccess.
alter table public.brain_folders enable row level security;
revoke all on public.brain_folders from anon, authenticated;

create or replace function public.brain_category_for(p_path text)
returns text language sql immutable set search_path = '' as $$
  select case when split_part(p_path, '/', 1) = 'skills' then 'skill'
              else split_part(p_path, '/', 1) end;
$$;

create or replace function public.brain_sync_categories(p_tenant uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.tenant_connections c
  set config = jsonb_set(
        c.config, '{categories}',
        coalesce((
          select jsonb_agg(public.brain_category_for(f.path) order by f.path)
          from public.brain_folders f
          where f.tenant_id = p_tenant and position('/' in f.path) = 0
        ), '[]'::jsonb)),
      updated_at = now()
  where c.tenant_id = p_tenant and c.capability = 'brain' and c.provider = 'wiki';
end;
$$;

-- Crea p_path y cada carpeta de su camino que falte. Devuelve cuántas creó.
create or replace function public.brain_ensure_folders(p_tenant uuid, p_path text, p_actor uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_path, '/');
  v_created integer := 0;
  v_rows integer;
  v_top boolean := false;
begin
  for i in 1 .. cardinality(v_parts) loop
    insert into public.brain_folders (tenant_id, path, created_by)
    values (p_tenant, array_to_string(v_parts[1:i], '/'), p_actor)
    on conflict (tenant_id, path) do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
    if i = 1 and v_rows > 0 then v_top := true; end if;
  end loop;
  if v_top then perform public.brain_sync_categories(p_tenant); end if;
  return v_created;
end;
$$;

-- Una carpeta de primer nivel por categoría de la config (skill → skills).
create or replace function public.brain_folders_from_config(p_tenant uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_created integer := 0;
  v_rows integer;
  v_category text;
begin
  for v_category in
    select jsonb_array_elements_text(c.config -> 'categories')
    from public.tenant_connections c
    where c.tenant_id = p_tenant and c.capability = 'brain' and c.provider = 'wiki'
  loop
    insert into public.brain_folders (tenant_id, path)
    values (p_tenant, case when v_category = 'skill' then 'skills' else v_category end)
    on conflict (tenant_id, path) do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;
  return v_created;
end;
$$;

create or replace function public.brain_create_folder(
  p_tenant uuid, p_actor uuid, p_path text, p_description text
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_parent text := nullif(regexp_replace(p_path, '/?[^/]+$', ''), '');
begin
  if v_parent is null and p_path in ('skills', 'brain') then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'reserved_path';
  end if;
  if v_parent is null and (
    select count(*) from public.brain_folders
    where tenant_id = p_tenant and position('/' in path) = 0
  ) >= 20 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'too_many';
  end if;
  if v_parent is not null and not exists (
    select 1 from public.brain_folders where tenant_id = p_tenant and path = v_parent
  ) then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = 'parent';
  end if;

  begin
    insert into public.brain_folders (tenant_id, path, description, created_by)
    values (p_tenant, p_path, coalesce(p_description, ''), p_actor);
  exception
    when unique_violation then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'folder_exists';
    when check_violation then
      raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'path';
  end;
  if v_parent is null then perform public.brain_sync_categories(p_tenant); end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.folder_created', p_path,
          jsonb_build_object('path', p_path));
end;
$$;

create or replace function public.brain_set_folder_description(
  p_tenant uuid, p_actor uuid, p_path text, p_description text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.brain_folders
  set description = coalesce(p_description, ''), updated_at = now()
  where tenant_id = p_tenant and path = p_path;
  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = 'folder';
  end if;
  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.folder_described', p_path,
          jsonb_build_object('path', p_path));
end;
$$;

create or replace function public.brain_delete_folder(
  p_tenant uuid, p_actor uuid, p_path text
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_rules integer;
begin
  perform 1 from public.brain_folders
  where tenant_id = p_tenant and path = p_path
  for update;
  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = 'folder';
  end if;
  if p_path = 'skills' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'reserved_path';
  end if;
  if exists (
    select 1 from public.brain_pages
    where tenant_id = p_tenant and (slug = p_path or starts_with(slug, p_path || '/'))
  ) or exists (
    select 1 from public.brain_folders
    where tenant_id = p_tenant and starts_with(path, p_path || '/')
  ) then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'folder_not_empty';
  end if;
  if position('/' in p_path) = 0 and (
    select count(*) from public.brain_folders
    where tenant_id = p_tenant and position('/' in path) = 0
  ) <= 1 then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'folder_last';
  end if;

  delete from public.brain_folders where tenant_id = p_tenant and path = p_path;
  delete from public.brain_access_rules where tenant_id = p_tenant and path = p_path;
  get diagnostics v_rules = row_count;
  if position('/' in p_path) = 0 then perform public.brain_sync_categories(p_tenant); end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.folder_deleted', p_path,
          jsonb_build_object('path', p_path, 'rules_removed', v_rules));
end;
$$;

-- Permisos: solo el servidor.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.brain_category_for(text)',
    'public.brain_sync_categories(uuid)',
    'public.brain_ensure_folders(uuid, text, uuid)',
    'public.brain_folders_from_config(uuid)',
    'public.brain_create_folder(uuid, uuid, text, text)',
    'public.brain_set_folder_description(uuid, uuid, text, text)',
    'public.brain_delete_folder(uuid, uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

-- La consola deja de editar categorías (spec etapa 26 §3.1).
drop function if exists public.platform_set_brain_categories(uuid, uuid, text[]);

-- Backfill: una carpeta por categoría y por cada prefijo de ruta que ya existe.
do $$
declare
  v_tenant uuid;
  v_prefix text;
begin
  for v_tenant in
    select tenant_id from public.tenant_connections where capability = 'brain' and provider = 'wiki'
  loop
    perform public.brain_folders_from_config(v_tenant);
    for v_prefix in
      select distinct regexp_replace(slug, '/[^/]+$', '')
      from public.brain_pages
      where tenant_id = v_tenant and position('/' in slug) > 0
    loop
      perform public.brain_ensure_folders(v_tenant, v_prefix, null);
    end loop;
    perform public.brain_sync_categories(v_tenant);
  end loop;
end;
$$;
```

Además, en el mismo archivo, dos redefiniciones:

1. **`brain_upsert_page`:** copiar entera la función de `20260913234426_brain_upsert_page.sql` (con su `revoke` y su `grant`) y, dentro del bloque `if not found then`, justo después del chequeo `if p_base_revision is not null then ... end if;` y antes de `v_revision := 1;`, insertar:

```sql
    -- Toda página tiene su carpeta (spec etapa 26 §3.1): se crean las que falten.
    if position('/' in p_slug) > 0 then
      perform public.brain_ensure_folders(
        p_tenant_id, regexp_replace(p_slug, '/[^/]+$', ''), p_author_user_id);
    end if;
```

2. **`brain_delete_page`:** copiar entera la definición vigente de `20261020120000_brain_skills.sql` (con su `revoke` y su `grant`) y, en la condición que decide si se borran las reglas de acceso de la ruta (el bloque que empieza con el comentario `-- Las reglas siguen protegiendo`), sumar al `if not exists (...)` un `and not exists (select 1 from public.brain_folders where tenant_id = p_tenant_id and path = p_slug)`, para que las reglas de una carpeta homónima no se borren.

- [ ] **Step 5: Correr los tests y ver que pasan**

Run: `npm run db:reset && npm run db:test`
Expected: PASS en todos los archivos, `37_brain_folders.test.sql` incluido. Si falla `23_brain_delete_page.test.sql`, mirar si alguna aserción sobre reglas cambió por la carpeta que ahora crea `brain_upsert_page`: la página `comercial/icp` tiene hijas, así que la carpeta `comercial/icp` existe y sus reglas ya se conservaban por esa razón. Ajustar solo si la aserción depende de la regla nueva, y anotarlo en el commit.

- [ ] **Step 6: Regenerar los tipos**

Run: `npm run db:types`
Expected: `lib/supabase/database.types.ts` gana `brain_folders` y las funciones nuevas, y pierde `platform_set_brain_categories`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261025120000_brain_folders.sql supabase/tests/37_brain_folders.test.sql lib/supabase/database.types.ts
git commit -m "feat: tabla brain_folders y funciones de carpetas (26.1a)"
```

---

### Task 3: El proveedor wiki calcula la categoría y chequea la carpeta

**Files:**
- Modify: `lib/brain/core/wiki-store.ts` (interfaz `WikiStore` y `createSupabaseWikiStore`)
- Modify: `lib/brain/core/wiki.ts` (`createWikiProvider().upsert`)
- Modify: `lib/brain/core/errors.ts` (si `BrainValidation` no acepta un mensaje propio, ver Step 3)
- Modify: los `fakeStore` de los tests que construyen un `WikiStore` (los encuentra `npm run typecheck`)
- Test: `tests/brain/wiki-folders.test.ts`

**Interfaces:**
- Consumes: `categoryForPath`, `parentPath`, `nearestFolder`, `BrainFolder` (Task 1).
- Produces: `WikiStore.listFolders(tenantId: string): Promise<BrainFolder[]>`. `createWikiProvider().upsert` lanza `BrainValidation(["folder"])` con mensaje `folder_not_found` y `BrainValidation(["slug"])` con mensaje de `folder_required`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/wiki-folders.test.ts
import { describe, expect, it, vi } from "vitest";
import type { WikiConfig } from "@/lib/brain/core/config";
import { BrainValidation } from "@/lib/brain/core/errors";
import type { BrainWrite } from "@/lib/brain/core/types";
import { createWikiProvider } from "@/lib/brain/core/wiki";
import type { WikiStore } from "@/lib/brain/core/wiki-store";

const config: WikiConfig = {
	categories: ["comercial", "talento"],
	requiredFrontmatter: [],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

function store(folders: string[]): WikiStore {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(async () => null),
		list: async () => [],
		listRevisions: async () => null,
		listFolders: async () => folders.map((path) => ({ path, description: "" })),
		upsert: vi.fn(async (params) => ({ slug: params.slug, revision: 1 })),
	};
}

const write = (slug: string, category = "otra"): BrainWrite => ({
	slug,
	title: "T",
	category,
	status: "activo",
	tags: [],
	body: "x",
	reason: "alta",
});

function provider(s: WikiStore) {
	return createWikiProvider({
		tenantId: "t",
		bindingId: "b",
		config,
		store: s,
		today: () => "2026-10-14",
	});
}

describe("carpetas en el proveedor wiki", () => {
	it("calcula la categoría desde la ruta, ignore lo que venga", async () => {
		const s = store(["talento", "talento/personal"]);
		await provider(s).upsert(write("talento/personal/leo", "empresa"), {
			kind: "user",
			userId: "u",
		});
		expect(s.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ category: "talento" }),
		);
	});

	it("rechaza una página nueva en una subcarpeta que no existe y nombra la más cercana", async () => {
		const s = store(["comercial"]);
		const result = provider(s).upsert(write("comercial/sucursales/centro"), {
			kind: "agent",
			agent: "asistente",
			sessionId: "s",
		});
		await expect(result).rejects.toBeInstanceOf(BrainValidation);
		await expect(result).rejects.toThrow(/comercial\/sucursales.*comercial/s);
		expect(s.upsert).not.toHaveBeenCalled();
	});

	it("una carpeta de primer nivel que no existe falla como categoría", async () => {
		const s = store(["comercial"]);
		await expect(
			provider(s).upsert(write("marketing/pauta"), { kind: "user", userId: "u" }),
		).rejects.toMatchObject({ fields: expect.arrayContaining(["category"]) });
	});

	it("rechaza una página nueva en la raíz", async () => {
		const s = store([]);
		await expect(
			provider(s).upsert(write("suelta"), { kind: "user", userId: "u" }),
		).rejects.toMatchObject({ fields: ["slug"] });
	});

	it("deja editar una página suelta que ya existía, con su categoría", async () => {
		const s = store([]);
		await provider(s).upsert(
			{ ...write("suelta", "comercial"), baseRevision: 3 },
			{ kind: "user", userId: "u" },
		);
		expect(s.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ category: "comercial" }),
		);
	});

	it("el import no chequea subcarpetas: las crea la base", async () => {
		const s = store([]);
		await provider(s).upsert(write("comercial/nueva/x"), {
			kind: "import",
			sourcePath: "a.md",
			sourceHash: "h",
		});
		expect(s.upsert).toHaveBeenCalled();
	});

	it("una edición no relee las carpetas", async () => {
		const s = store([]);
		const listFolders = vi.spyOn(s, "listFolders");
		await provider(s).upsert(
			{ ...write("comercial/sin-carpeta/x"), baseRevision: 2 },
			{ kind: "user", userId: "u" },
		);
		expect(listFolders).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/wiki-folders.test.ts`
Expected: FAIL: la categoría llega como `empresa` y no hay rechazo de carpeta.

- [ ] **Step 3: Implementar**

En `lib/brain/core/wiki-store.ts`, sumar a `WikiStore`:

```ts
	listFolders(tenantId: string): Promise<BrainFolder[]>;
```

(con `import type { BrainFolder } from "./folders.ts";`) y a `createSupabaseWikiStore`:

```ts
		async listFolders(tenantId) {
			const { data, error } = await client
				.from("brain_folders")
				.select("path, description")
				.eq("tenant_id", tenantId)
				.order("path");
			if (error) throw storeError(error);
			return ((data ?? []) as Array<{ path: string; description: string }>).map(
				(row) => ({ path: row.path, description: row.description }),
			);
		},
```

En `lib/brain/core/wiki.ts`, importar `categoryForPath`, `nearestFolder` y `parentPath` de `./folders.ts`, y reemplazar el comienzo de `upsert(write, author)` por:

```ts
		async upsert(input, author) {
			const isNew = input.baseRevision === undefined;
			const nested = input.slug.includes("/");
			// La categoría sale de la ruta (spec etapa 26 D1). Una página suelta que
			// ya existía conserva la suya.
			const write = nested
				? { ...input, category: categoryForPath(input.slug) }
				: input;
			if (isNew && !nested) {
				throw new BrainValidation(
					["slug"],
					"Una página nueva va dentro de una carpeta: usá una ruta como categoria/nombre.",
				);
			}
			// La de primer nivel la valida la categoría. Las subcarpetas, acá; el
			// import no, porque la base crea las que falten.
			const parent = parentPath(write.slug);
			if (isNew && author.kind !== "import" && parent?.includes("/")) {
				const folders = new Set(
					(await store.listFolders(tenantId)).map((f) => f.path),
				);
				if (!folders.has(parent)) {
					const near = nearestFolder(parent, folders);
					throw new BrainValidation(
						["folder"],
						`No existe la carpeta ${parent}.${near ? ` La más cercana es ${near}.` : ""} Pedile a un administrador que la cree.`,
					);
				}
			}
			const frontmatter = validateWrite(write, config, today());
```

y dejar el resto del cuerpo igual (sigue usando `write`).

Si `BrainValidation` (en `lib/brain/core/errors.ts`) no acepta un segundo argumento de mensaje, agregarlo como opcional: `constructor(fields: string[], message?: string)`, con el mensaje actual como valor por defecto. Revisar que `tests/brain/errors.test.ts` siga pasando.

- [ ] **Step 4: Arreglar los fakes**

Run: `npm run typecheck`
Expected: errores de tipo en cada fake de `WikiStore` al que le falta `listFolders`. A cada uno sumarle `listFolders: async () => []`. Si un test existente crea una página nueva bajo una subcarpeta (dos o más `/`) o en la raíz y ahora falla, cambiar su fake para que devuelva esa carpeta, o usar una ruta de dos segmentos. No cambiar lo que el test afirma.

- [ ] **Step 5: Correr los tests**

Run: `npm test -- tests/brain`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/brain/core tests/brain
git commit -m "feat: la categoría sale de la ruta y una página nueva necesita su carpeta (26.1a)"
```

---

### Task 4: El árbol conoce las carpetas

**Files:**
- Modify: `lib/brain/core/access/tree.ts`
- Test: `tests/brain/access-tree.test.ts` (sumar casos al final)

**Interfaces:**
- Consumes: `BrainFolder` (Task 1).
- Produces:
  - `TreeNode` gana `folder: { description: string } | null`.
  - `visibleTree(pages, access, folders?: readonly BrainFolder[]): TreeNode` (el tercer argumento es opcional; sin él el árbol es el de hoy).
  - `isFolderNode(node: TreeNode): boolean` (raíz, carpeta guardada o nodo con hijos).
  - `withoutArchived` conserva los nodos con `folder !== null` aunque queden vacíos.
  - `editableFolders` cuenta también las carpetas vacías.

- [ ] **Step 1: Escribir los tests que fallan**

Sumar a `tests/brain/access-tree.test.ts` (reusar los imports que ya tiene el archivo y agregar `isFolderNode`):

```ts
describe("carpetas guardadas", () => {
	const all = () => "lector" as const;

	it("muestra una carpeta vacía con su descripción", () => {
		const root = visibleTree([], all, [
			{ path: "comercial", description: "Embudo" },
		]);
		expect(root.children).toEqual([
			expect.objectContaining({
				path: "comercial",
				page: null,
				children: [],
				folder: { description: "Embudo" },
			}),
		]);
		expect(isFolderNode(root.children[0])).toBe(true);
	});

	it("cuelga las subcarpetas vacías de su padre", () => {
		const root = visibleTree([], all, [
			{ path: "comercial", description: "" },
			{ path: "comercial/sucursales", description: "" },
		]);
		expect(root.children[0].children[0].path).toBe("comercial/sucursales");
	});

	it("no muestra una carpeta vacía que la persona no ve", () => {
		const access = (path: string) => (path.startsWith("talento") ? null : "lector");
		const root = visibleTree([], access as never, [
			{ path: "comercial", description: "" },
			{ path: "talento", description: "" },
		]);
		expect(root.children.map((n) => n.path)).toEqual(["comercial"]);
	});

	it("withoutArchived no poda carpetas guardadas vacías", () => {
		const root = visibleTree(
			[{ slug: "comercial/viejo", title: "Viejo", status: "archivado" }],
			all,
			[{ path: "comercial", description: "" }],
		);
		expect(withoutArchived(root).children.map((n) => n.path)).toEqual(["comercial"]);
	});

	it("editableFolders incluye las vacías", () => {
		const root = visibleTree([], () => "editor", [
			{ path: "comercial", description: "" },
		]);
		expect(editableFolders(root)).toEqual(["", "comercial"]);
	});
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run tests/brain/access-tree.test.ts`
Expected: FAIL: `isFolderNode` no existe y el árbol no tiene `folder`.

- [ ] **Step 3: Implementar**

En `lib/brain/core/access/tree.ts`:

- Importar `import type { BrainFolder } from "../folders.ts";`.
- Sumar `folder: { description: string } | null;` a `TreeNode`, y `folder: null` en cada lugar donde se arma un nodo (la raíz y los nodos intermedios de `visibleTree`).
- Exportar:

```ts
export function isFolderNode(node: TreeNode): boolean {
	return node.path === ROOT_PATH || node.folder !== null || node.children.length > 0;
}
```

- En `sortNodes`, ordenar por `isFolderNode` en vez de `children.length > 0`.
- Cambiar la firma a `visibleTree(pages, access, folders: readonly BrainFolder[] = [])` y, antes del `for (const page of pages)`, recorrer las carpetas ordenadas por `path` con la misma lógica de `ancestorChain`. Una carpeta entra si `access(folder.path) !== null`, y su nodo recibe `folder: { description }`:

```ts
	const ensure = (path: string): TreeNode => {
		let parent = root;
		for (const step of ancestorChain(path).slice(1)) {
			let node = byPath.get(step);
			if (!node) {
				node = {
					path: step,
					name: lastSegment(step),
					page: null,
					folder: null,
					level: access(step),
					children: [],
				};
				byPath.set(step, node);
				parent.children.push(node);
			}
			parent = node;
		}
		return parent;
	};

	for (const folder of [...folders].sort((a, b) => a.path.localeCompare(b.path))) {
		if (access(folder.path) === null) continue;
		ensure(folder.path).folder = { description: folder.description };
	}
```

  y que el loop de páginas use `ensure(page.slug)` en lugar de su propia cadena, conservando el chequeo `if (access(page.slug) === null) continue;`. Un nodo intermedio que solo existe porque una página visible cuelga de él se sigue creando, como hoy.
- En `withoutArchived`, la condición de poda pasa a `node.path !== ROOT_PATH && page === null && children.length === 0 && node.folder === null`.
- En `editableFolders`, `const isFolder = isFolderNode(node);`.

- [ ] **Step 4: Correr los tests**

Run: `npm test -- tests/brain` y `npm run typecheck`
Expected: PASS. Si un componente o test arma un `TreeNode` a mano y falla por `folder`, sumarle `folder: null`.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/core/access/tree.ts tests/brain components
git commit -m "feat: el árbol del brain muestra las carpetas vacías (26.1a)"
```

---

### Task 5: Núcleo y server actions de carpetas

**Files:**
- Create: `lib/brain/core/folders-store.ts`
- Create: `lib/brain/core/editor/folders.ts`
- Create: `lib/brain/adapters/folders.ts`
- Create: `app/[tenant]/brain/folder-actions.ts`
- Test: `tests/brain/editor-folders.test.ts`, `tests/brain/folder-actions.test.ts`

**Interfaces:**
- Consumes: `validateFolderPath`, `parentPath`, `MAX_FOLDER_DESCRIPTION` (Task 1); `resolveAccess`, `isAdminRole`, `AccessRulesStore`, `Principal` de `lib/brain/core/access`; `WikiStoreError`.
- Produces:
  - `interface FolderWriter { create(p: { tenantId: string; actorUserId: string; path: string; description: string }): Promise<void>; describe(p: same): Promise<void>; remove(p: { tenantId: string; actorUserId: string; path: string }): Promise<void> }` y `createSupabaseFolderWriter(client)`.
  - `type FolderFailure = { ok: false; code: "invalid" | "not_found" | "forbidden" | "conflict" | "unsupported"; message: string }`.
  - `interface FolderDeps { actor; rules; binding; writer: FolderWriter }` (las tres primeras con la misma forma que en `DeleteDeps`).
  - `createFolder(tenantSlug, path, description, deps)`, `describeFolder(tenantSlug, path, description, deps)`, `deleteFolder(tenantSlug, path, deps)`, cada una `Promise<{ ok: true } | FolderFailure>`.
  - `folderDeps(): FolderDeps` (adapter).
  - Server actions `createBrainFolder(raw)`, `describeBrainFolder(raw)`, `deleteBrainFolder(raw)`.

- [ ] **Step 1: Escribir el test del núcleo que falla**

```ts
// tests/brain/editor-folders.test.ts
import { describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import {
	createFolder,
	deleteFolder,
	describeFolder,
	type FolderDeps,
} from "@/lib/brain/core/editor/folders";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

function deps(
	role: string,
	rules: AccessRule[] = [],
	overrides: Partial<FolderDeps> = {},
): FolderDeps {
	return {
		actor: async () => ({ tenantId: "t", userId: "u", role: role as never }),
		rules: { load: vi.fn(async () => rules) } as never,
		binding: async () => ({ id: "b", provider: "wiki" }),
		writer: {
			create: vi.fn(async () => {}),
			describe: vi.fn(async () => {}),
			remove: vi.fn(async () => {}),
		},
		...overrides,
	};
}

describe("createFolder", () => {
	it("un admin de la empresa crea una de primer nivel", async () => {
		const d = deps("tenant_admin");
		expect(await createFolder("okeefe", "marketing", "Marca y pauta", d)).toEqual({ ok: true });
		expect(d.writer.create).toHaveBeenCalledWith({
			tenantId: "t",
			actorUserId: "u",
			path: "marketing",
			description: "Marca y pauta",
		});
	});

	it("un miembro sin administración no crea", async () => {
		expect(await createFolder("okeefe", "marketing", "", deps("tenant_member"))).toMatchObject({
			ok: false,
			code: "not_found",
		});
	});

	it("un miembro administrador de comercial crea una subcarpeta ahí", async () => {
		const rules = [
			{ path: "comercial", principal: "user", userId: "u", level: "administrador" },
		] as unknown as AccessRule[];
		expect(
			await createFolder("okeefe", "comercial/sucursales", "", deps("tenant_member", rules)),
		).toEqual({ ok: true });
	});

	it("valida la ruta y la descripción antes de escribir", async () => {
		const d = deps("tenant_admin");
		expect(await createFolder("okeefe", "Mal Nombre", "", d)).toMatchObject({ code: "invalid" });
		expect(await createFolder("okeefe", "ok", "x".repeat(301), d)).toMatchObject({
			code: "invalid",
		});
		expect(d.writer.create).not.toHaveBeenCalled();
	});

	it("traduce los errores de la base", async () => {
		const failing = (detail: string, code = "BR409") =>
			deps("tenant_admin", [], {
				writer: {
					create: vi.fn(async () => {
						throw new WikiStoreError(code, "x", detail);
					}),
					describe: vi.fn(),
					remove: vi.fn(),
				},
			});
		expect(await createFolder("okeefe", "comercial", "", failing("folder_exists"))).toMatchObject({
			code: "conflict",
			message: expect.stringContaining("Ya existe"),
		});
		expect(
			await createFolder("okeefe", "a/b", "", failing("parent", "BR404")),
		).toMatchObject({ code: "not_found" });
		expect(
			await createFolder("okeefe", "otra", "", failing("too_many", "BR422")),
		).toMatchObject({ code: "invalid", message: expect.stringContaining("20") });
	});

	it("un brain externo no tiene carpetas", async () => {
		const d = deps("tenant_admin", [], {
			binding: async () => ({ id: "b", provider: "mcp" }),
		});
		expect(await createFolder("okeefe", "x", "", d)).toMatchObject({ code: "unsupported" });
	});
});

describe("describeFolder y deleteFolder", () => {
	it("describir exige administrar la carpeta", async () => {
		const rules = [
			{ path: "comercial", principal: "user", userId: "u", level: "editor" },
		] as unknown as AccessRule[];
		expect(
			await describeFolder("okeefe", "comercial", "x", deps("tenant_member", rules)),
		).toMatchObject({ code: "forbidden" });
	});

	it("borrar una no vacía devuelve el motivo", async () => {
		const d = deps("tenant_admin", [], {
			writer: {
				create: vi.fn(),
				describe: vi.fn(),
				remove: vi.fn(async () => {
					throw new WikiStoreError("BR409", "x", "folder_not_empty");
				}),
			},
		});
		expect(await deleteFolder("okeefe", "comercial", d)).toMatchObject({
			code: "conflict",
			message: expect.stringContaining("vacía"),
		});
	});

	it("borrar la última de primer nivel devuelve el motivo", async () => {
		const d = deps("tenant_admin", [], {
			writer: {
				create: vi.fn(),
				describe: vi.fn(),
				remove: vi.fn(async () => {
					throw new WikiStoreError("BR409", "x", "folder_last");
				}),
			},
		});
		expect(await deleteFolder("okeefe", "empresa", d)).toMatchObject({
			code: "conflict",
			message: expect.stringContaining("al menos una"),
		});
	});
});
```

Antes de correrlo, abrir `tests/brain/access-resolve.test.ts` y copiar la forma exacta de un `AccessRule` por persona (nombres de campo y valor de `principal`). Si difiere de la de arriba, ajustar los tres literales de reglas de este test a esa forma.

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/editor-folders.test.ts`
Expected: FAIL: no existe `@/lib/brain/core/editor/folders`.

- [ ] **Step 3: Implementar el writer y el núcleo**

```ts
// lib/brain/core/folders-store.ts
// Escritor de carpetas (spec etapa 26 §3.1). Aparte del BrainProvider: agente y
// MCP no crean ni borran carpetas.
import type { SupabaseClient } from "@supabase/supabase-js";
import { WikiStoreError } from "./wiki-store.ts";

export interface FolderParams {
	tenantId: string;
	actorUserId: string;
	path: string;
	description: string;
}

export interface FolderWriter {
	create(params: FolderParams): Promise<void>;
	describe(params: FolderParams): Promise<void>;
	remove(params: Omit<FolderParams, "description">): Promise<void>;
}

export function createSupabaseFolderWriter(client: SupabaseClient): FolderWriter {
	const rpc = async (fn: string, args: Record<string, unknown>) => {
		const { error } = await client.rpc(fn, args);
		if (error)
			throw new WikiStoreError(error.code ?? "", error.message, error.details ?? "");
	};
	return {
		create: (p) =>
			rpc("brain_create_folder", {
				p_tenant: p.tenantId,
				p_actor: p.actorUserId,
				p_path: p.path,
				p_description: p.description,
			}),
		describe: (p) =>
			rpc("brain_set_folder_description", {
				p_tenant: p.tenantId,
				p_actor: p.actorUserId,
				p_path: p.path,
				p_description: p.description,
			}),
		remove: (p) =>
			rpc("brain_delete_folder", {
				p_tenant: p.tenantId,
				p_actor: p.actorUserId,
				p_path: p.path,
			}),
	};
}
```

```ts
// lib/brain/core/editor/folders.ts
// Crear, describir y borrar carpetas (spec etapa 26 §3.2). Sin Next ni
// Supabase, como delete.ts: el permiso se decide acá con las reglas del tenant.
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRulesStore,
	isAdminRole,
	type Principal,
	ROOT_PATH,
} from "../access/types.ts";
import { MAX_FOLDER_DESCRIPTION, parentPath, validateFolderPath } from "../folders.ts";
import type { FolderWriter } from "../folders-store.ts";
import type { BrainRole } from "../types.ts";
import { WikiStoreError } from "../wiki-store.ts";

export type FolderFailure = {
	ok: false;
	code: "invalid" | "not_found" | "forbidden" | "conflict" | "unsupported";
	message: string;
};
type FolderResult = { ok: true } | FolderFailure;

export interface FolderDeps {
	actor(
		tenantSlug: string,
	): Promise<{ tenantId: string; userId: string; role: BrainRole } | null>;
	rules: AccessRulesStore;
	binding(tenantId: string): Promise<{ id: string; provider: "wiki" | "mcp" } | null>;
	writer: FolderWriter;
}

const fail = (code: FolderFailure["code"], message: string): FolderFailure => ({
	ok: false,
	code,
	message,
});
const NOT_FOUND = "No encontrado.";

const MESSAGES: Record<string, FolderFailure> = {
	folder_exists: fail("conflict", "Ya existe una carpeta con ese nombre."),
	folder_not_empty: fail(
		"conflict",
		"La carpeta no está vacía: mové o borrá lo que tiene adentro antes de borrarla.",
	),
	folder_last: fail(
		"conflict",
		"El brain necesita al menos una carpeta de primer nivel.",
	),
	parent: fail("not_found", "La carpeta de arriba ya no existe."),
	folder: fail("not_found", NOT_FOUND),
	too_many: fail("invalid", "El brain admite hasta 20 carpetas de primer nivel."),
	reserved_path: fail("invalid", "Ese nombre está reservado por el brain."),
	path: fail("invalid", "El nombre de la carpeta no es válido."),
};

// Quién es y si administra `target`. Lo que no ve responde not_found.
async function authorize(
	tenantSlug: string,
	target: string,
	deps: FolderDeps,
): Promise<{ ok: true; tenantId: string; userId: string } | FolderFailure> {
	const actor = await deps.actor(tenantSlug);
	if (!actor) return fail("not_found", NOT_FOUND);
	const binding = await deps.binding(actor.tenantId);
	if (!binding) return fail("not_found", NOT_FOUND);
	if (binding.provider !== "wiki")
		return fail("unsupported", "Este brain es externo: sus carpetas se manejan en su origen.");

	const rules = isAdminRole(actor.role) ? [] : await deps.rules.load(actor.tenantId);
	const principal: Principal = { kind: "user", userId: actor.userId, role: actor.role };
	const level = resolveAccess(rules, principal, target);
	if (level === null) return fail("not_found", NOT_FOUND);
	if (level !== "administrador")
		return fail("forbidden", "Solo un administrador de esta carpeta puede hacerlo.");
	return { ok: true, tenantId: actor.tenantId, userId: actor.userId };
}

async function run(write: () => Promise<void>): Promise<FolderResult> {
	try {
		await write();
		return { ok: true };
	} catch (error) {
		if (error instanceof WikiStoreError && MESSAGES[error.details])
			return MESSAGES[error.details];
		throw error;
	}
}

function checkInput(path: string, description: string): FolderFailure | null {
	const valid = validateFolderPath(path);
	if (!valid.ok) return fail("invalid", valid.message);
	if (description.length > MAX_FOLDER_DESCRIPTION)
		return fail("invalid", `La descripción tiene hasta ${MAX_FOLDER_DESCRIPTION} caracteres.`);
	return null;
}

export async function createFolder(
	tenantSlug: string,
	path: string,
	description: string,
	deps: FolderDeps,
): Promise<FolderResult> {
	const bad = checkInput(path, description);
	if (bad) return bad;
	// Crear algo de primer nivel es administrar la raíz.
	const auth = await authorize(tenantSlug, parentPath(path) ?? ROOT_PATH, deps);
	if (!auth.ok) return auth;
	return run(() =>
		deps.writer.create({
			tenantId: auth.tenantId,
			actorUserId: auth.userId,
			path,
			description: description.trim(),
		}),
	);
}

export async function describeFolder(
	tenantSlug: string,
	path: string,
	description: string,
	deps: FolderDeps,
): Promise<FolderResult> {
	if (description.length > MAX_FOLDER_DESCRIPTION)
		return fail("invalid", `La descripción tiene hasta ${MAX_FOLDER_DESCRIPTION} caracteres.`);
	const auth = await authorize(tenantSlug, path, deps);
	if (!auth.ok) return auth;
	return run(() =>
		deps.writer.describe({
			tenantId: auth.tenantId,
			actorUserId: auth.userId,
			path,
			description: description.trim(),
		}),
	);
}

export async function deleteFolder(
	tenantSlug: string,
	path: string,
	deps: FolderDeps,
): Promise<FolderResult> {
	// Borrar una de primer nivel es una decisión sobre la raíz.
	const target = path.includes("/") ? path : ROOT_PATH;
	const auth = await authorize(tenantSlug, target, deps);
	if (!auth.ok) return auth;
	return run(() =>
		deps.writer.remove({ tenantId: auth.tenantId, actorUserId: auth.userId, path }),
	);
}
```

Nota: `describeFolder` no llama a `validateFolderPath` porque la carpeta ya existe, y una reservada heredada como `skills` también se puede describir.

- [ ] **Step 4: Correr el test del núcleo**

Run: `npx vitest run tests/brain/editor-folders.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir el adapter y las server actions, con su test**

```ts
// lib/brain/adapters/folders.ts
// Cablea las carpetas con la plataforma. El permiso lo decide core/editor/folders.ts.
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import type { FolderDeps } from "../core/editor/folders";
import { createSupabaseFolderWriter } from "../core/folders-store";
import { resolveBrainBinding } from "../core/resolve";
import { accessRulesStore } from "./access-rules";

export function folderDeps(): FolderDeps {
	return {
		async actor(tenantSlug) {
			const tenant = await resolveTenantAccess(tenantSlug);
			return tenant ? { tenantId: tenant.id, userId: tenant.userId, role: tenant.role } : null;
		},
		rules: accessRulesStore(),
		async binding(tenantId) {
			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			return binding ? { id: binding.id, provider: binding.provider } : null;
		},
		writer: createSupabaseFolderWriter(createAdminClient()),
	};
}
```

```ts
// app/[tenant]/brain/folder-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { folderDeps } from "@/lib/brain/adapters/folders";
import { createFolder, deleteFolder, describeFolder } from "@/lib/brain/core/editor/folders";

// La forma se valida en el borde; el permiso lo decide el núcleo.
const base = {
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	path: z.string().min(1).max(200),
};
const withDescription = { ...base, description: z.string().max(2000) };
const invalid = { ok: false, code: "invalid", message: "Datos inválidos." } as const;

function done<T extends { ok: boolean }>(tenantSlug: string, result: T): T {
	if (result.ok) revalidatePath(`/${tenantSlug}/brain`, "layout");
	return result;
}

export async function createBrainFolder(raw: unknown) {
	const parsed = z.object(withDescription).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, path, description } = parsed.data;
	return done(tenantSlug, await createFolder(tenantSlug, path, description, folderDeps()));
}

export async function describeBrainFolder(raw: unknown) {
	const parsed = z.object(withDescription).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, path, description } = parsed.data;
	return done(tenantSlug, await describeFolder(tenantSlug, path, description, folderDeps()));
}

export async function deleteBrainFolder(raw: unknown) {
	const parsed = z.object(base).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, path } = parsed.data;
	return done(tenantSlug, await deleteFolder(tenantSlug, path, folderDeps()));
}
```

```ts
// tests/brain/folder-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const createFolder = vi.fn();
const describeFolder = vi.fn();
const deleteFolder = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/brain/adapters/folders", () => ({ folderDeps: () => ({}) }));
vi.mock("@/lib/brain/core/editor/folders", () => ({
	createFolder,
	describeFolder,
	deleteFolder,
}));

const { createBrainFolder, deleteBrainFolder, describeBrainFolder } = await import(
	"@/app/[tenant]/brain/folder-actions"
);

beforeEach(() => {
	for (const fn of [createFolder, describeFolder, deleteFolder, revalidatePath]) fn.mockReset();
});

describe("folder actions", () => {
	it("rechaza datos mal formados sin llegar al núcleo", async () => {
		expect(await createBrainFolder({ tenantSlug: "A B", path: "x", description: "" })).toMatchObject({
			code: "invalid",
		});
		expect(await deleteBrainFolder({ tenantSlug: "okeefe", path: "" })).toMatchObject({
			code: "invalid",
		});
		expect(createFolder).not.toHaveBeenCalled();
		expect(deleteFolder).not.toHaveBeenCalled();
	});

	it("revalida el brain solo si salió bien", async () => {
		createFolder.mockResolvedValueOnce({ ok: true });
		await createBrainFolder({ tenantSlug: "okeefe", path: "marketing", description: "" });
		expect(revalidatePath).toHaveBeenCalledWith("/okeefe/brain", "layout");

		revalidatePath.mockReset();
		describeFolder.mockResolvedValueOnce({ ok: false, code: "forbidden", message: "x" });
		await describeBrainFolder({ tenantSlug: "okeefe", path: "marketing", description: "y" });
		expect(revalidatePath).not.toHaveBeenCalled();
	});
});
```

Run: `npx vitest run tests/brain/folder-actions.test.ts tests/brain/editor-folders.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/brain/core/folders-store.ts lib/brain/core/editor/folders.ts lib/brain/adapters/folders.ts "app/[tenant]/brain/folder-actions.ts" tests/brain/editor-folders.test.ts tests/brain/folder-actions.test.ts
git commit -m "feat: crear, describir y borrar carpetas del brain con permisos (26.1a)"
```

---

### Task 6: Árbol, menú e índice con carpetas

**Files:**
- Modify: `lib/brain/adapters/editor.ts` (`EditorContext` gana `folders`, `loadBrainTree` los pasa)
- Create: `components/brain/folder-dialog.tsx`, `components/brain/folder-delete-dialog.tsx`
- Modify: `components/brain/tree-row-menu.tsx`, `components/brain/brain-tree.tsx`, `app/[tenant]/brain/page.tsx`
- Test: `tests/brain/editor-tree.test.ts` (sumar un caso), `tests/brain/tree-row-menu.test.tsx` (nuevo)

**Interfaces:**
- Consumes: `visibleTree(..., folders)`, `isFolderNode`, `TreeNode.folder` (Task 4); server actions de la Task 5; `WikiStore.listFolders` (Task 3).
- Produces: `OkEditorContext.folders: () => Promise<BrainFolder[]>`. `TreeRowMenu` gana las props `onNewFolder(parent: string)`, `onDescribe(node: TreeNode)` y `onDeleteFolder(node: TreeNode)`.

- [ ] **Step 1: Cargar las carpetas en el contexto del editor**

En `lib/brain/adapters/editor.ts`, dentro de `loadEditorContext`, después de `guarded`:

```ts
		// Las carpetas se leen sin envolver: visibleTree las filtra con ctx.access.
		let folderList: Promise<BrainFolder[]> | null = null;
		const folders = () => {
			folderList ??= createSupabaseWikiStore(createAdminClient()).listFolders(tenant.id);
			return folderList;
		};
```

con los imports `createSupabaseWikiStore` (de `../core/wiki-store`) y `type BrainFolder` (de `../core/folders`). Sumar `folders: () => Promise<BrainFolder[]>;` al tipo del caso `"ok"` y `folders,` al objeto que se devuelve. En `loadBrainTree`, pasar `await ctx.folders()` como tercer argumento de `visibleTree`. Si `tests/brain/editor-adapter.test.ts` o `tests/brain/editor-tree.test.ts` arman un `OkEditorContext` a mano, sumarles `folders: async () => []`.

Sumar a `tests/brain/editor-tree.test.ts` un caso que arme el contexto con `folders: async () => [{ path: "marketing", description: "Marca" }]` y sin páginas, y verifique que `loadBrainTree(ctx)` devuelve un hijo `marketing` con `folder: { description: "Marca" }`. Usar el mismo armado de contexto que ya tiene ese archivo.

- [ ] **Step 2: Diálogo de carpeta (crear y describir)**

```tsx
// components/brain/folder-dialog.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBrainFolder, describeBrainFolder } from "@/app/[tenant]/brain/folder-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_FOLDER_DESCRIPTION } from "@/lib/brain/core/folders";

type Mode =
	| { kind: "create"; parent: string }
	| { kind: "describe"; path: string; description: string };

export function FolderDialog({
	tenantSlug,
	mode,
	onClose,
}: {
	tenantSlug: string;
	mode: Mode;
	onClose: () => void;
}) {
	const router = useRouter();
	const [name, setName] = useState("");
	const [description, setDescription] = useState(
		mode.kind === "describe" ? mode.description : "",
	);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const creating = mode.kind === "create";
	const prefix = creating && mode.parent ? `${mode.parent}/` : "";

	const submit = () =>
		start(async () => {
			const result = creating
				? await createBrainFolder({ tenantSlug, path: `${prefix}${name.trim()}`, description })
				: await describeBrainFolder({ tenantSlug, path: mode.path, description });
			if (!result.ok) {
				setError(result.message);
				return;
			}
			router.refresh();
			onClose();
		});

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{creating ? (mode.parent ? "Nueva subcarpeta" : "Nueva carpeta") : "Descripción de la carpeta"}
					</DialogTitle>
					<DialogDescription>
						{creating
							? mode.parent
								? `Va dentro de ${mode.parent}.`
								: "Una carpeta de primer nivel es una categoría del brain."
							: mode.path}
					</DialogDescription>
				</DialogHeader>
				{creating && (
					<label className="block space-y-1 text-sm">
						<span>Nombre</span>
						<div className="flex items-center gap-1">
							{prefix && <span className="text-muted-foreground">{prefix}</span>}
							<Input
								autoFocus
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="sucursales"
							/>
						</div>
						<span className="text-muted-foreground text-xs">
							Minúsculas, números y guiones.
						</span>
					</label>
				)}
				<label className="block space-y-1 text-sm">
					<span>Qué va acá</span>
					<Textarea
						value={description}
						maxLength={MAX_FOLDER_DESCRIPTION}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Una línea o dos: la ve la gente en el índice y el agente al decidir dónde escribe."
					/>
				</label>
				{error && <p className="text-destructive text-sm" role="alert">{error}</p>}
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						Cancelar
					</Button>
					<Button onClick={submit} disabled={pending || (creating && name.trim() === "")}>
						{creating ? "Crear" : "Guardar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
```

- [ ] **Step 3: Diálogo de borrado de carpeta**

```tsx
// components/brain/folder-delete-dialog.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBrainFolder } from "@/app/[tenant]/brain/folder-actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function FolderDeleteDialog({
	tenantSlug,
	path,
	onClose,
}: {
	tenantSlug: string;
	path: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>¿Borrar la carpeta {path}?</AlertDialogTitle>
					<AlertDialogDescription>
						Solo se puede borrar una carpeta vacía. Sus permisos se borran con ella.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error && <p className="text-destructive text-sm" role="alert">{error}</p>}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
					<AlertDialogAction
						disabled={pending}
						onClick={(event) => {
							event.preventDefault();
							start(async () => {
								const result = await deleteBrainFolder({ tenantSlug, path });
								if (!result.ok) {
									setError(result.message);
									return;
								}
								router.refresh();
								onClose();
							});
						}}
					>
						Borrar
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
```

Antes de usarlo, revisar en `components/brain/delete-page-dialog.tsx` cómo evita que el `AlertDialog` abierto desde el menú deje `pointer-events` trabado en el `<body>`, y repetir esa misma solución acá.

- [ ] **Step 4: Escribir el test del menú que falla**

Antes, buscar con `grep -rln "happy-dom" tests | head -3` un test de componente existente (por ejemplo `tests/brain/skills-components.test.ts`) y copiar su encabezado de entorno y su forma de renderizar. El test, con ese encabezado:

```tsx
// tests/brain/tree-row-menu.test.tsx
import { describe, expect, it } from "vitest";
import { folderMenuItems } from "@/components/brain/tree-row-menu";
import type { TreeNode } from "@/lib/brain/core/access/tree";

const node = (over: Partial<TreeNode>): TreeNode => ({
	path: "comercial",
	name: "comercial",
	page: null,
	folder: { description: "" },
	level: "administrador",
	children: [],
	...over,
});

describe("folderMenuItems", () => {
	it("un administrador ve las acciones de carpeta", () => {
		expect(folderMenuItems(node({}))).toEqual([
			"new-subfolder",
			"describe",
			"delete-folder",
		]);
	});
	it("un editor no ve ninguna", () => {
		expect(folderMenuItems(node({ level: "editor" }))).toEqual([]);
	});
	it("una carpeta implícita (sin fila) no se describe ni se borra", () => {
		expect(folderMenuItems(node({ folder: null, children: [node({ path: "comercial/x" })] }))).toEqual([
			"new-subfolder",
		]);
	});
	it("la raíz ofrece nueva carpeta", () => {
		expect(folderMenuItems(node({ path: "", name: "", folder: null }))).toEqual(["new-subfolder"]);
	});
});
```

Run: `npx vitest run tests/brain/tree-row-menu.test.tsx`
Expected: FAIL: `folderMenuItems` no existe.

- [ ] **Step 5: Menú de fila**

En `components/brain/tree-row-menu.tsx`:

- Exportar una función pura que decide los ítems de carpeta:

```ts
export type FolderMenuItem = "new-subfolder" | "describe" | "delete-folder";

export function folderMenuItems(node: TreeNode): FolderMenuItem[] {
	if (node.level !== "administrador" || !isFolderNode(node)) return [];
	const items: FolderMenuItem[] = ["new-subfolder"];
	if (node.folder !== null) items.push("describe", "delete-folder");
	return items;
}
```

- Sumar las props `onNewFolder: () => void`, `onDescribe: () => void` y `onDeleteFolder: () => void`.
- `const isFolder = isFolderNode(node);`, en lugar de `node.children.length > 0`.
- Agregar al final de `items`, según `folderMenuItems(node)`, tres `DropdownMenuItem` con `className="min-h-11 lg:min-h-0"`: "Nueva subcarpeta…" (en la raíz, "Nueva carpeta…") con `onSelect={onNewFolder}`, "Editar descripción…" con `onSelect={onDescribe}`, y "Borrar carpeta…" con la misma clase destructiva de "Borrar…" y `onSelect={onDeleteFolder}`.

Run: `npx vitest run tests/brain/tree-row-menu.test.tsx`
Expected: PASS.

- [ ] **Step 6: Árbol**

En `components/brain/brain-tree.tsx`:

- Estados nuevos: `const [folderDialog, setFolderDialog] = useState<null | { kind: "create"; parent: string } | { kind: "describe"; path: string; description: string }>(null);` y `const [deletingFolder, setDeletingFolder] = useState<string | null>(null);`.
- En `renderNode`, `const hasChildren = isFolderNode(node) && node.path !== "";` para el chevrón (una carpeta vacía se pliega igual), y debajo, cuando está abierta y `node.children.length === 0`, un `<p className="pl-11 text-muted-foreground text-xs lg:pl-7">Vacía</p>`.
- Si `node.folder?.description`, ponerla como `title` del botón o link del nodo.
- Pasar a cada `TreeRowMenu` (las filas y la raíz): `onNewFolder={() => setFolderDialog({ kind: "create", parent: node.path })}`, `onDescribe={() => setFolderDialog({ kind: "describe", path: node.path, description: node.folder?.description ?? "" })}` y `onDeleteFolder={() => setDeletingFolder(node.path)}`. En la raíz, `parent: ""`.
- Montar `<FolderDialog tenantSlug={tenantSlug} mode={folderDialog} onClose={() => setFolderDialog(null)} />` cuando `folderDialog` no es null, y `<FolderDeleteDialog tenantSlug={tenantSlug} path={deletingFolder} onClose={() => setDeletingFolder(null)} />` cuando `deletingFolder` no es null, al lado de los diálogos que ya hay.
- El texto "No hay páginas para mostrar." pasa a "Todavía no hay carpetas.".

- [ ] **Step 7: Índice**

En `app/[tenant]/brain/page.tsx`:

- Importar `isFolderNode` de `@/lib/brain/core/access/tree`.
- `folders` en modo navegación: `...children.filter(isFolderNode)`, en lugar de `(n) => n.children.length > 0`.
- Con `?carpeta=X`, mostrar arriba de la lista las subcarpetas directas de `X`, con la misma lista visual. Para eso, buscar el nodo de `X` en `tree` (recorrido por `path`) y usar sus hijos `isFolderNode`.
- En cada fila de carpeta, debajo del nombre, la descripción si existe: `<span className="block truncate text-muted-foreground text-xs">{node.folder.description}</span>`. A la derecha, `countPages(node)` páginas, o "Vacía" si es 0.

- [ ] **Step 8: Verificar**

Run: `npm run typecheck && npm test -- tests/brain && npm run lint:fix`
Expected: PASS. Revertir los archivos ajenos que reformatee `lint:fix` (`git status`).

Después, verificar en el navegador con la base local (ver la memoria "preview_start no sirve worktrees" para levantar el worktree contra la base local): como admin, crear `marketing`, crear `marketing/pauta`, editar su descripción, verla en el índice vacía, y borrar `marketing/pauta`. Probar también a 375 px.

- [ ] **Step 9: Commit**

```bash
git add lib/brain/adapters/editor.ts components/brain "app/[tenant]/brain/page.tsx" tests/brain
git commit -m "feat: menú de carpetas y carpetas vacías en el árbol y el índice (26.1a)"
```

---

### Task 7: Consola de plataforma y alta de un brain

**Files:**
- Modify: `app/plataforma/[slug]/console/brain-section.tsx`
- Modify: `app/plataforma/[slug]/console-actions.ts`
- Delete: `lib/brain/core/categories.ts`, `tests/brain/categories.test.ts`
- Test: `tests/plataforma/console-actions.test.ts`, `tests/plataforma/console-sections.test.ts`

**Interfaces:**
- Consumes: `brain_folders_from_config` (Task 2).
- Produces: `createBrain` crea las carpetas de primer nivel. `setBrainCategories` deja de existir.

- [ ] **Step 1: Ajustar los tests**

En `tests/plataforma/console-actions.test.ts`:
- Borrar los casos de `setBrainCategories`.
- En el caso que prueba `createBrain`, afirmar que después de `platform_bind_connection` se llama al rpc `brain_folders_from_config` con `{ p_tenant: <tenantId> }`. Usar el mismo mock de `createAdminClient().rpc` que ya tiene el archivo.

En `tests/plataforma/console-sections.test.ts`:
- Reemplazar lo que pruebe el formulario de categorías por un caso que renderiza `BrainSection` con `categories: ["empresa", "comercial"]` y espera ver los dos nombres y un link a `/<slug>/brain` con el texto "Editar en el brain", sin `input`.

Run: `npx vitest run tests/plataforma`
Expected: FAIL.

- [ ] **Step 2: Implementar**

En `console-actions.ts`:
- Borrar `setBrainCategories`, el import de `parseCategories` y `"platform_set_brain_categories"` de la unión de `call`.
- En `createBrain`, después de `if (!created.ok) return created;`:

```ts
	// Las carpetas de primer nivel son las categorías (spec etapa 26 D1).
	const { error: foldersError } = await createAdminClient().rpc(
		"brain_folders_from_config",
		{ p_tenant: tenantId },
	);
	if (foldersError) {
		console.error("consola: no pude crear las carpetas del brain", foldersError);
		return { ok: false, message: "El brain se creó, pero no sus carpetas. Probá de nuevo." };
	}
```

En `brain-section.tsx`:
- Borrar `CategoriesForm`, el import de `Input` y el de `setBrainCategories`.
- En su lugar, mostrar:

```tsx
				<div className="mt-2 text-xs">
					<span className="text-muted-foreground">Categorías: </span>
					{brain.categories.join(", ")}
				</div>
				<p className="text-muted-foreground text-xs">
					Son las carpetas de primer nivel.{" "}
					<Link className="underline" href={`/${slug}/brain`}>
						Editar en el brain
					</Link>
					.
				</p>
```

(`Link` ya está importado.) Borrar `lib/brain/core/categories.ts` y `tests/brain/categories.test.ts`.

- [ ] **Step 3: Verificar**

Run: `npx vitest run tests/plataforma && npm run typecheck`
Expected: PASS, sin referencias colgadas a `parseCategories` de `categories.ts`. La de `config.ts` es otra función y se queda.

- [ ] **Step 4: Commit**

```bash
git add -A "app/plataforma/[slug]" lib/brain/core/categories.ts tests/brain/categories.test.ts tests/plataforma
git commit -m "feat: la consola muestra las categorías y el brain nace con sus carpetas (26.1a)"
```

---

### Task 8: Reporte previo a la migración

**Files:**
- Create: `lib/brain/core/folders-report.ts`
- Create: `scripts/brain-folders-report.mts`
- Modify: `package.json` (script `brain:folders-report`)
- Test: `tests/brain/folders-report.test.ts`

**Interfaces:**
- Consumes: `categoryForPath` (Task 1).
- Produces: `folderReport(categories: string[], pages: Array<{ slug: string; category: string }>): { folders: string[]; mismatched: Array<{ slug: string; category: string; expected: string }>; loose: string[] }`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/folders-report.test.ts
import { describe, expect, it } from "vitest";
import { folderReport } from "@/lib/brain/core/folders-report";

describe("folderReport", () => {
	it("lista carpetas, categorías que no coinciden y páginas sueltas", () => {
		const report = folderReport(
			["empresa", "talento", "skill"],
			[
				{ slug: "talento/personal/leo", category: "talento" },
				{ slug: "talento/x", category: "empresa" },
				{ slug: "skills/outreach", category: "skill" },
				{ slug: "suelta", category: "empresa" },
			],
		);
		expect(report.folders).toEqual([
			"empresa",
			"skills",
			"talento",
			"talento/personal",
		]);
		expect(report.mismatched).toEqual([
			{ slug: "talento/x", category: "empresa", expected: "talento" },
		]);
		expect(report.loose).toEqual(["suelta"]);
	});
});
```

Run: `npx vitest run tests/brain/folders-report.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementar**

```ts
// lib/brain/core/folders-report.ts
// Qué hace la migración de carpetas en un tenant, antes de aplicarla (spec
// etapa 26 §3.4). Puro: lo usa scripts/brain-folders-report.mts.
import { categoryForPath, parentPath } from "./folders.ts";

export function folderReport(
	categories: string[],
	pages: Array<{ slug: string; category: string }>,
) {
	const folders = new Set(categories.map((c) => (c === "skill" ? "skills" : c)));
	for (const page of pages) {
		for (let node = parentPath(page.slug); node !== null; node = parentPath(node))
			folders.add(node);
	}
	return {
		folders: [...folders].sort(),
		mismatched: pages
			.filter((p) => p.slug.includes("/") && categoryForPath(p.slug) !== p.category)
			.map((p) => ({ slug: p.slug, category: p.category, expected: categoryForPath(p.slug) })),
		loose: pages.filter((p) => !p.slug.includes("/")).map((p) => p.slug),
	};
}
```

```ts
// scripts/brain-folders-report.mts
// Reporte en seco de la migración de carpetas (spec etapa 26 §3.4). No escribe.
//   npm run brain:folders-report -- --tenant okeefe
// Contra producción lo corre una persona con un env file de producción:
//   node --env-file=<archivo> scripts/brain-folders-report.mts --tenant okeefe
import { createClient } from "@supabase/supabase-js";
import { folderReport } from "../lib/brain/core/folders-report.ts";

const tenantSlug = process.argv[process.argv.indexOf("--tenant") + 1];
if (!process.argv.includes("--tenant") || !tenantSlug) {
	console.error("Uso: npm run brain:folders-report -- --tenant <slug>");
	process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
	console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
	process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: tenant } = await db.from("tenants").select("id").eq("slug", tenantSlug).single();
if (!tenant) {
	console.error(`No existe el tenant ${tenantSlug}.`);
	process.exit(1);
}
const { data: binding } = await db
	.from("tenant_connections")
	.select("config")
	.eq("tenant_id", tenant.id)
	.eq("capability", "brain")
	.eq("provider", "wiki")
	.single();
const { data: pages, error } = await db
	.from("brain_pages")
	.select("slug, category")
	.eq("tenant_id", tenant.id);
if (error) throw error;

const report = folderReport(
	((binding?.config as { categories?: string[] } | null)?.categories ?? []),
	pages ?? [],
);
console.log(`Carpetas (${report.folders.length}):`);
for (const folder of report.folders) console.log(`  ${folder}`);
console.log(`\nPáginas cuya categoría no coincide con su ruta (${report.mismatched.length}):`);
for (const m of report.mismatched)
	console.log(`  ${m.slug}: ${m.category} → quedaría ${m.expected} en su próxima edición`);
console.log(`\nPáginas sueltas en la raíz (${report.loose.length}):`);
for (const slug of report.loose) console.log(`  ${slug}`);
```

Antes de dar por buenos los nombres de las variables de entorno, compararlos con los que lee `scripts/brain-import.mts` (línea 40 en adelante) y usar los mismos.

En `package.json`, al lado de `brain:import`:

```json
    "brain:folders-report": "node --env-file=.env.local scripts/brain-folders-report.mts",
```

- [ ] **Step 3: Verificar**

Run: `npx vitest run tests/brain/folders-report.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/brain/core/folders-report.ts scripts/brain-folders-report.mts package.json tests/brain/folders-report.test.ts
git commit -m "feat: reporte en seco de la migración de carpetas (26.1a)"
```

---

### Task 9: Documentación y cierre de la rama

**Files:**
- Modify: `docs/dominios/brain.md`, `docs/arquitectura/datos.md`, `docs/producto/roadmap.md`, `docs/decisiones/README.md`, `docs/_meta/cobertura.ts` (solo si el check lo pide)
- Regenerate: `docs/referencia/` con `npm run docs:sync`

- [ ] **Step 1: Regenerar la referencia y ver qué falta**

Run: `npm run docs:sync && npm run docs:check`
Expected: FAIL, nombrando la tabla `brain_folders`, el script `brain:folders-report` y lo que corresponda.

- [ ] **Step 2: Documentar**

En `docs/dominios/brain.md`:
- En "Categorías y canon", reemplazar el párrafo que dice que las categorías viven en la config y las edita la consola por uno que dice que son las carpetas de primer nivel (`brain_folders`), que `config.categories` es un reflejo que mantiene `brain_sync_categories`, y que la categoría de una página sale de su ruta (`categoryForPath`, `skills` → `skill`).
- Agregar una sección "Carpetas" con:
  - la tabla y sus funciones;
  - los permisos (administrador del padre para crear; de la carpeta para describir y borrar; de la raíz para las de primer nivel);
  - `folder_not_found` y `folder_required`;
  - que la base crea las carpetas que falten;
  - las rutas reservadas;
  - el reporte en seco.
- En la tabla de archivos, sumar `core/folders.ts`, `core/folders-store.ts`, `core/editor/folders.ts`, `core/folders-report.ts` y `adapters/folders.ts`, y sacar `core/categories.ts`.

En `docs/arquitectura/datos.md`, sumar `brain_folders` donde están las demás tablas del brain.

En `docs/decisiones/README.md`, la fila de la Etapa 26 ya enlaza este plan: dejarla en `en curso`, porque faltan la 26.1b, la 26.2 y la 26.3.

En `docs/producto/roadmap.md`, debajo de la entrega 26.1, anotar el plan y el orden de despliegue: **aplicar la migración `20261025120000_brain_folders` antes que el código** (corriendo `npx supabase migration list` antes, porque `db push` aplica todas las pendientes). Al revés, la consola llamaría a una función que no existe y el árbol leería una tabla que no existe. Correr `npm run brain:folders-report -- --tenant okeefe` contra producción antes de aplicar.

- [ ] **Step 3: Verificar todo**

Run: `npm run docs:check && npm run typecheck && npm test && npm run db:test`
Expected: todo en verde.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: carpetas del brain en la wiki y orden de despliegue de la 26.1a"
```

---

## Cierre en producción (lo hace una persona después del merge)

1. `npm run brain:folders-report -- --tenant okeefe` con el env de producción. Revisar las páginas con categoría distinta de su ruta y las sueltas.
2. `npx supabase migration list` y después aplicar la migración. Recién entonces desplegar el código.
3. En `/okeefe/brain`: se ven `empresa`, `producto`, `comercial` y `marketing` vacías. Cargar la descripción de las ocho (sale de la tabla "Categorías" de `operacion/brain`).
4. Crear `comercial/sucursales` vacía y borrarla.
5. Mover y renombrar (criterio 1, segunda mitad) quedan para la 26.1b.
