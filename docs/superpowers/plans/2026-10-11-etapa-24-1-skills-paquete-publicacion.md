# Etapa 24.1 · Skills de empresa: paquete y publicación — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un editor arme en el brain una skill (página `SKILL.md` más archivos), un administrador de la empresa la revise y la publique como versión inmutable, y un lector vea solo lo publicado, sin que ninguna tool del brain la exponga a un asistente.

**Architecture:** El borrador es una página del brain de categoría `skill` bajo `skills/`; sus archivos van en `brain_skill_files`, con el contenido en un bucket privado guardado por hash. Publicar es una función SQL que arma la copia desde la fila bloqueada y la inserta en `brain_skill_versions`, tabla solo de inserción. Dos envoltorios de `BrainProvider` en `core` deciden qué se ve: `withoutSkills` (asistentes: nada bajo `skills/`) y `withSkillView` (web: el lector ve la copia publicada, el editor el borrador).

**Tech Stack:** Postgres (Supabase) y Storage, pgTAP, Next.js 16 App Router (route handler y server actions), `fflate` para leer zips, `yaml`, zod, Vitest en entorno `node`.

**Spec:** `docs/superpowers/specs/2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md`

## Global Constraints

- **Rama:** `feat/etapa-24-1-skills-paquete`, sale de `docs/etapa-24-skills` rebaseada sobre `main` **con la 21.4 ya mergeada** (hace falta `platform_set_brain_categories` y la migración `20261019120000_agentless_tenant`). Si la 21.4 no está en `main`, frenar y avisar. No hacer push ni abrir PR sin que lo pida la persona.
- Antes de escribir SQL, cargar la skill `supabase-postgres-best-practices`. Toda tabla lleva `tenant_id` y RLS. Las dos tablas nuevas no tienen políticas para `authenticated`: solo las toca el servidor con la service role.
- Las funciones SQL nuevas son `security invoker set search_path = ''`, con `revoke execute ... from public, anon, authenticated` y `grant execute ... to service_role`. La autorización la hace el código antes de llamar (patrón `brain_set_access_rule`).
- `events` es append-only: solo `insert`, en la misma transacción que el cambio.
- Códigos de error de las funciones: `BR404` (no existe), `BR409` (conflicto; `detail` dice `revision`, `files`, `name` o `skill_published`), `BR422` (validación; `detail` dice el campo).
- `lib/brain/core/` no importa nada fuera de `core` salvo `zod`, `yaml`, `@modelcontextprotocol/sdk`, `node:*` y, como tipo, `@supabase/supabase-js`. Lo vigila `tests/brain/boundary.test.ts`. Los imports relativos dentro de `core` llevan extensión `.ts`. `fflate` va solo en `lib/brain/adapters/`.
- Límites, copiados de la spec: archivo 4.194.304 bytes; paquete 20.971.520 bytes y 50 archivos; zip a importar 4.194.304 bytes; `description` 1024; `compatibility` 500; nombre 64; aviso por cuerpo de más de 500 líneas.
- Ruta de archivo: `^[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,5}$`, hasta 200 caracteres, y distinta de `SKILL.md` sin importar mayúsculas.
- Publica solo `tenant_admin` o `platform_admin`. Edita quien tiene nivel `editor` sobre la página.
- **`rpc()` no está tipado en este repo:** los tests afirman nombre y argumentos exactos.
- Un archivo `"use server"` solo exporta funciones `async` y tipos (`tests/server-actions-exports.test.ts`).
- Sin tool ni nodo nuevos: no se toca `TOOL_LABELS` ni `lib/workflows/registry.ts`.
- Español rioplatense en UI y mensajes; código e identificadores en inglés. Nada específico de un tenant en código.
- Tests: `tests/**/*.test.ts`, entorno `node`, componentes con `createElement` y `renderToStaticMarkup`. SQL: `supabase/tests/*.test.sql` con pgTAP.
- Lint: **no** correr `npm run lint:fix`. Usar `npx biome check --write <archivos de la tarea>` y después `npx biome check <los mismos>` tiene que salir limpio.
- Después de cada tarea: `npm run typecheck` limpio. Cada commit termina con la línea `Co-Authored-By` del modelo que lo escribe. Identidad de git: `innovasbuild` / `matias@innov.as`. `git add` solo de los archivos de la tarea.
- Base local: Docker abierto. Después de una migración: `npm run db:reset && npm run db:types`. `npm run db:test` corre pgTAP. **No** aplicar nada en producción.

## Review Focus

1. **Zip que se infla más allá de los límites:** un zip de menos de 4 MB que descomprimido pesa cientos. Tiene que rechazarse por el tamaño declarado de cada entrada **antes** de descomprimir, y por el total. Tarea 8.
2. **Archivo que el navegador interpreta:** alguien sube `x.html` o un `.svg` con script y un lector lo abre. La respuesta tiene que ser `text/plain` o una descarga, siempre con `x-content-type-options: nosniff`, nunca `text/html` ni `image/svg+xml`. Tarea 8.
3. **POST desde otro sitio a la subida de archivos:** un route handler no tiene el chequeo de origen de las server actions. Un `origin` distinto al del pedido responde 403 sin tocar nada. Tarea 8.
4. **Lector que pide lo que no le toca:** un archivo que está solo en el borrador, o uno de una versión anterior. Responde `not_found`, igual que si no existiera. Tarea 7.
5. **Dos skills con el mismo último tramo en carpetas distintas:** `skills/ventas/reporte` y `skills/admin/reporte`. La segunda en publicarse recibe un mensaje que nombra el choque; la primera sigue vigente. Tareas 1 y 6.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261020120000_brain_skills.sql` (nuevo) | Tablas, bucket, funciones y redefinición de `brain_delete_page` |
| `supabase/tests/34_brain_skills.test.sql` (nuevo) | pgTAP |
| `lib/brain/core/skills/package.ts` (nuevo) | Constantes, rutas de archivo, invariante categoría/ruta, chequeo de publicable |
| `lib/brain/core/skills/store.ts` (nuevo) | Tipos de fila y acceso a Supabase (RPC y lecturas), sin lógica |
| `lib/brain/core/skills/state.ts` (nuevo) | Estado de publicación, puro |
| `lib/brain/core/skills/view.ts` (nuevo) | `withoutSkills` y `withSkillView` |
| `lib/brain/core/skills/publish.ts` (nuevo) | Vista previa, publicar, republicar, retirar |
| `lib/brain/core/skills/files.ts` (nuevo) | Subir, quitar, leer e importar; lectura de `SKILL.md` |
| `lib/brain/core/skills/http.ts` (nuevo) | Chequeo de origen, encabezados al servir un archivo y armado de su link |
| `lib/brain/adapters/skill-zip.ts` (nuevo) | Lectura del zip con topes antes de descomprimir |
| `lib/brain/core/wiki.ts`, `core/editor/save.ts`, `core/editor/delete.ts` (modifica) | Invariante al guardar y sus mensajes; mensaje al borrar una publicada |
| `lib/brain/adapters/tools.ts`, `core/mcp-server/handler.ts` (modifica) | Los asistentes no ven `skills/` |
| `lib/brain/adapters/skills.ts` (nuevo) | Cliente admin, Storage, zip y armado de dependencias |
| `lib/brain/adapters/editor.ts` (modifica) | El contexto del editor envuelve con `withSkillView` y marca el árbol |
| `app/[tenant]/brain/skills/files/route.ts` (nuevo) | Subida, importación y lectura de archivos |
| `app/[tenant]/brain/skill-actions.ts` (nuevo) | Server actions de publicar, republicar, retirar y quitar archivo |
| `components/brain/skills/*.tsx` (nuevos) | Estado, panel, diálogo de revisión, archivos publicados |
| `app/[tenant]/brain/p/[...slug]/page.tsx`, `components/brain/editor/page-workspace.tsx`, `components/brain/brain-tree.tsx`, `lib/brain/core/access/tree.ts` (modifica) | Integración en pantalla |
| `lib/brain/README.md`, `docs/01-roadmap-etapas.md` (modifica) | Documentación |

---

### Task 1: La base

**Files:**
- Create: `supabase/migrations/20261020120000_brain_skills.sql`
- Create: `supabase/tests/34_brain_skills.test.sql`
- Modify (generado): `lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: tablas `brain_pages`, `brain_revisions`, `brain_access_rules`, `events`, `tenants`; funciones `brain_upsert_page` y `brain_delete_page(uuid, text, integer, uuid, uuid, jsonb)` (se redefine con la misma firma).
- Produces (RPC, solo `service_role`):
  - `brain_skill_files_digest(p_page_id uuid) → text`
  - `brain_skill_put_file(p_tenant_id uuid, p_page_id uuid, p_path text, p_sha256 text, p_size integer, p_actor uuid) → text` (el hash de archivos nuevo)
  - `brain_skill_remove_file(p_tenant_id uuid, p_page_id uuid, p_path text, p_actor uuid) → text`
  - `brain_publish_skill(p_tenant_id uuid, p_page_id uuid, p_expected_revision integer, p_expected_files_digest text, p_note text, p_actor uuid, p_from_version integer default null) → table (skill_version integer, skill_digest text)`
  - `brain_withdraw_skill(p_tenant_id uuid, p_page_id uuid, p_note text, p_actor uuid) → boolean`
  - `brain_skill_overview(p_tenant_id uuid) → table (page_id uuid, slug text, revision integer, draft_files_digest text, action public.brain_skill_action, version integer, page_revision integer, files_digest text, title text, description text, body text, frontmatter jsonb, manifest jsonb, digest text, published_at timestamptz)`
  - Tablas `brain_skill_files` y `brain_skill_versions`; bucket privado `skills`.

- [ ] **Step 1: Cargar la skill de Postgres**

Invocar `supabase-postgres-best-practices` antes de escribir.

- [ ] **Step 2: Escribir el test pgTAP (falla: no existe nada)**

Crear `supabase/tests/34_brain_skills.test.sql`:

```sql
-- supabase/tests/34_brain_skills.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a5a5a5a5-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@skill-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b5b5b5b5-0000-0000-0000-00000000000a', 'skill-a', 'Skill A'),
       ('b5b5b5b5-0000-0000-0000-00000000000b', 'skill-b', 'Skill B');

-- Páginas por brain_upsert_page para que tengan su revisión 1.
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/ventas/reporte', 'Reporte', 'skill', 'activo', '{}'::text[], '{"description":"Usar para armar el reporte semanal."}'::jsonb, 'cuerpo v1', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/admin/reporte', 'Reporte admin', 'skill', 'activo', '{}'::text[], '{"description":"Otro reporte."}'::jsonb, 'cuerpo', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/sin-descripcion', 'Sin', 'skill', 'activo', '{}'::text[], '{}'::jsonb, 'cuerpo', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/llena', 'Llena', 'skill', 'activo', '{}'::text[], '{"description":"x"}'::jsonb, 'cuerpo', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'texto', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000b', 'skills/reporte', 'Reporte de B', 'skill', 'activo', '{}'::text[], '{"description":"El de B."}'::jsonb, 'cuerpo b', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000002');

create temp table ids as
select slug, tenant_id, id from public.brain_pages where slug like 'skills/%' or slug = 'comercial/icp';
grant select on ids to public;

-- 1-7: tablas y privilegios
select has_table('public', 'brain_skill_files', 'existe brain_skill_files');
select has_table('public', 'brain_skill_versions', 'existe brain_skill_versions');
select ok(not has_table_privilege('authenticated', 'public.brain_skill_files', 'select'), 'authenticated no lee archivos');
select ok(not has_table_privilege('authenticated', 'public.brain_skill_versions', 'select'), 'authenticated no lee versiones');
select ok(not has_table_privilege('anon', 'public.brain_skill_versions', 'select'), 'anon no lee versiones');
select ok(not has_table_privilege('service_role', 'public.brain_skill_versions', 'update'), 'ni el servidor actualiza una versión');
select ok(not has_table_privilege('service_role', 'public.brain_skill_versions', 'delete'), 'ni el servidor borra una versión');

-- 8-12: funciones cerradas a authenticated
select ok(not has_function_privilege('authenticated', 'public.brain_skill_put_file(uuid, uuid, text, text, integer, uuid)', 'execute'), 'authenticated no sube archivos');
select ok(not has_function_privilege('authenticated', 'public.brain_skill_remove_file(uuid, uuid, text, uuid)', 'execute'), 'authenticated no quita archivos');
select ok(not has_function_privilege('authenticated', 'public.brain_publish_skill(uuid, uuid, integer, text, text, uuid, integer)', 'execute'), 'authenticated no publica');
select ok(not has_function_privilege('authenticated', 'public.brain_withdraw_skill(uuid, uuid, text, uuid)', 'execute'), 'authenticated no retira');
select ok(not has_function_privilege('authenticated', 'public.brain_skill_overview(uuid)', 'execute'), 'authenticated no lee el resumen');

-- 13-14: bucket privado y sin políticas
select is((select public from storage.buckets where id = 'skills'), false, 'el bucket skills es privado');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%''skills''%'),
  0, 'ninguna política de storage abre el bucket skills');

-- 15-16: rechazos al subir
select throws_ok(
  $$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'comercial/icp'), 'a.txt', repeat('a', 64), 10, 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'BR422', null, 'no se suben archivos a una página que no es skill');
select throws_ok(
  $$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), '../afuera.txt', repeat('a', 64), 10, 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  '23514', null, 'una ruta que se sale del paquete viola el check');

-- 17-19: subir y hash de archivos, sin importar el orden
select is(
  public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'scripts/a.py', repeat('a', 64), 100, 'a5a5a5a5-0000-0000-0000-000000000001'),
  encode(sha256(convert_to('scripts/a.py:' || repeat('a', 64), 'UTF8')), 'hex'),
  'el hash de archivos de un solo archivo');
select is(
  public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'assets/z.txt', repeat('b', 64), 200, 'a5a5a5a5-0000-0000-0000-000000000001'),
  encode(sha256(convert_to('assets/z.txt:' || repeat('b', 64) || E'\n' || 'scripts/a.py:' || repeat('a', 64), 'UTF8')), 'hex'),
  'el hash ordena por ruta, no por orden de carga');
select is(
  (select count(*)::int from public.events where type = 'brain.skill_file_added' and tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'),
  2, 'cada archivo subido deja su evento');

-- 20-22: publicar rechaza lo que no coincide o no valida
select throws_ok(
  $$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 9, public.brain_skill_files_digest((select id from ids where slug = 'skills/ventas/reporte')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'BR409', null, 'una revisión esperada vieja es conflicto');
select throws_ok(
  $$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 1, 'otro-hash', 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'BR409', null, 'un hash de archivos viejo es conflicto');
select throws_ok(
  $$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/sin-descripcion'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/sin-descripcion')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'BR422', null, 'sin descripción no se publica');

-- 23-25: publicar
select is(
  (select skill_version from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/ventas/reporte')), 'primera', 'a5a5a5a5-0000-0000-0000-000000000001')),
  1, 'la primera publicación es la versión 1');
select is(
  (select jsonb_array_length(manifest) from public.brain_skill_versions where slug = 'skills/ventas/reporte' and version = 1),
  2, 'la versión guarda el manifiesto de sus dos archivos');
select is(
  (select (payload ->> 'version')::int from public.events where type = 'brain.skill_published' and summary = 'skills/ventas/reporte'),
  1, 'publicar deja su evento con la versión');

-- 26-27: el nombre es único por empresa, no entre empresas
select throws_ok(
  $$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/admin/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/admin/reporte')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'BR409', null, 'otra skill vigente con el mismo nombre choca');
select lives_ok(
  $$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000b', (select id from ids where slug = 'skills/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/reporte')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'otra empresa publica el mismo nombre sin chocar');

-- 28: una skill publicada no se borra
select throws_ok(
  $$select * from public.brain_delete_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/ventas/reporte', 1, 'a5a5a5a5-0000-0000-0000-000000000001', 'c5c5c5c5-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'BR409', null, 'con versión vigente no se borra');

-- 29-31: retirar libera el nombre
select is(public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'salió mal', 'a5a5a5a5-0000-0000-0000-000000000001'), true, 'retira la vigente');
select is(public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'otra vez', 'a5a5a5a5-0000-0000-0000-000000000001'), false, 'retirar lo ya retirado no hace nada');
select lives_ok(
  $$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/admin/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/admin/reporte')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'con la otra retirada, el nombre queda libre');

-- 32: republicar una versión anterior crea una versión nueva (la otra se retira primero)
select public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/admin/reporte'), 'libero', 'a5a5a5a5-0000-0000-0000-000000000001');
select is(
  (select skill_version from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), null, null, 'vuelvo', 'a5a5a5a5-0000-0000-0000-000000000001', 1)),
  2, 'republicar la versión 1 crea la versión 2');

-- 33: el resumen es por empresa
select is(
  (select count(*)::int from public.brain_skill_overview('b5b5b5b5-0000-0000-0000-00000000000a')),
  4, 'el resumen trae las cuatro skills de A y ninguna de B');

-- 34: retirada, se borra y las versiones quedan como registro
select public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'cierro', 'a5a5a5a5-0000-0000-0000-000000000001');
select public.brain_delete_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/ventas/reporte', 1, 'a5a5a5a5-0000-0000-0000-000000000001', 'c5c5c5c5-0000-0000-0000-000000000001', '[]'::jsonb);
select is(
  (select count(*)::int from public.brain_skill_versions where slug = 'skills/ventas/reporte' and page_id is null),
  4, 'borrada la página, sus cuatro actos quedan con page_id nulo');

-- 35: tope de 50 archivos
insert into public.brain_skill_files (tenant_id, page_id, path, sha256, size)
select 'b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/llena'), 'f' || n || '.txt', repeat('c', 64), 1
from generate_series(1, 50) n;
select throws_ok(
  $$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/llena'), 'uno-mas.txt', repeat('d', 64), 1, 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'BR422', null, 'el archivo 51 se rechaza');

-- 36: quitar lo que no está no deja evento
select public.brain_skill_remove_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/llena'), 'no-existe.txt', 'a5a5a5a5-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.events where type = 'brain.skill_file_removed'),
  0, 'quitar lo que no está no deja evento');

select * from finish();
rollback;
```

- [ ] **Step 3: Correrlo y ver que falla**

Run: `npm run db:test`
Expected: FAIL en `34_brain_skills.test.sql` (no existe `brain_skill_files`).

- [ ] **Step 4: Escribir la migración**

Crear `supabase/migrations/20261020120000_brain_skills.sql`:

```sql
-- Skills de empresa (spec etapa 24.1 §4): archivos del borrador, actos de
-- publicación solo de inserción, bucket privado y sus funciones. Todo lo
-- escribe el servidor con la service role; la autorización va en el código.

create type public.brain_skill_action as enum ('publicar', 'retirar');

create table public.brain_skill_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  page_id uuid not null references public.brain_pages (id) on delete cascade,
  path text not null check (
    char_length(path) <= 200
    and path ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,5}$'
    and lower(path) <> 'skill.md'
  ),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size integer not null check (size between 1 and 4194304),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (page_id, path)
);

create index brain_skill_files_tenant_idx on public.brain_skill_files (tenant_id);
create index brain_skill_files_uploaded_by_idx on public.brain_skill_files (uploaded_by);

create table public.brain_skill_versions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Borrada la página, el acto queda como registro.
  page_id uuid references public.brain_pages (id) on delete set null,
  slug text not null,
  name text not null check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(name) <= 64),
  action public.brain_skill_action not null,
  version integer not null check (version >= 1),
  page_revision integer not null check (page_revision >= 1),
  title text not null default '',
  description text not null default '' check (char_length(description) <= 1024),
  body text not null default '',
  frontmatter jsonb not null default '{}'::jsonb check (jsonb_typeof(frontmatter) = 'object'),
  manifest jsonb not null default '[]'::jsonb check (jsonb_typeof(manifest) = 'array'),
  files_digest text not null default '',
  digest text not null default '',
  note text not null check (char_length(btrim(note)) between 1 and 500),
  republished_from integer,
  actor_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index brain_skill_versions_page_idx on public.brain_skill_versions (tenant_id, page_id, id desc);
create index brain_skill_versions_name_idx on public.brain_skill_versions (tenant_id, name);
create index brain_skill_versions_actor_idx on public.brain_skill_versions (actor_user_id);

alter table public.brain_skill_files enable row level security;
alter table public.brain_skill_versions enable row level security;

-- Sin políticas: como brain_pages desde la etapa 17, solo el servidor.
revoke all on public.brain_skill_files from anon, authenticated;
revoke all on public.brain_skill_versions from anon, authenticated;
-- Solo de inserción también para el servidor. Las cascadas y el set null de
-- las claves foráneas corren como el dueño de la tabla y siguen andando.
revoke update, delete, truncate on public.brain_skill_versions from service_role;

-- Bucket privado, sin políticas en storage.objects: nadie lee ni escribe
-- directo. Objeto en <tenant_id>/<sha256>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('skills', 'skills', false, 4194304)
on conflict (id) do nothing;

-- Hash de los archivos del borrador: líneas path:sha256 ordenadas por ruta.
create or replace function public.brain_skill_files_digest(p_page_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select encode(
    sha256(convert_to(
      coalesce(string_agg(f.path || ':' || f.sha256, E'\n' order by f.path collate "C"), ''),
      'UTF8'
    )),
    'hex'
  )
  from public.brain_skill_files f
  where f.page_id = p_page_id
$$;

create or replace function public.brain_skill_put_file(
  p_tenant_id uuid,
  p_page_id uuid,
  p_path text,
  p_sha256 text,
  p_size integer,
  p_actor uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
  v_count integer;
  v_total bigint;
begin
  -- El lock de la página serializa subidas, bajas y publicación.
  select * into v_page
  from public.brain_pages
  where id = p_page_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = '';
  end if;
  if v_page.category <> 'skill' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'category';
  end if;

  insert into public.brain_skill_files (tenant_id, page_id, path, sha256, size, uploaded_by)
  values (p_tenant_id, p_page_id, p_path, p_sha256, p_size, p_actor)
  on conflict (page_id, path)
  do update set sha256 = excluded.sha256, size = excluded.size,
                uploaded_by = excluded.uploaded_by, created_at = now();

  select count(*)::integer, coalesce(sum(f.size), 0)::bigint into v_count, v_total
  from public.brain_skill_files f
  where f.page_id = p_page_id;

  if v_count > 50 or v_total > 20971520 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'package_limit';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.skill_file_added', v_page.slug,
    jsonb_build_object('slug', v_page.slug, 'path', p_path, 'sha256', p_sha256, 'size', p_size)
  );

  return public.brain_skill_files_digest(p_page_id);
end;
$$;

create or replace function public.brain_skill_remove_file(
  p_tenant_id uuid,
  p_page_id uuid,
  p_path text,
  p_actor uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
begin
  select * into v_page
  from public.brain_pages
  where id = p_page_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = '';
  end if;

  delete from public.brain_skill_files
  where page_id = p_page_id and path = p_path;

  -- Quitar lo que no está no cambia nada: no deja evento.
  if found then
    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (
      p_tenant_id, p_actor, 'brain.skill_file_removed', v_page.slug,
      jsonb_build_object('slug', v_page.slug, 'path', p_path)
    );
  end if;

  return public.brain_skill_files_digest(p_page_id);
end;
$$;

-- Publicar. La copia la arma esta función desde la fila bloqueada: el servidor
-- de aplicación no le pasa contenido. Con p_from_version republica esa versión.
create or replace function public.brain_publish_skill(
  p_tenant_id uuid,
  p_page_id uuid,
  p_expected_revision integer,
  p_expected_files_digest text,
  p_note text,
  p_actor uuid,
  p_from_version integer default null
)
returns table (skill_version integer, skill_digest text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_page public.brain_pages%rowtype;
  v_from public.brain_skill_versions%rowtype;
  v_name text;
  v_title text;
  v_description text;
  v_body text;
  v_frontmatter jsonb;
  v_manifest jsonb;
  v_files_digest text;
  v_page_revision integer;
  v_version integer;
  v_digest text;
  v_editors jsonb := '[]'::jsonb;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'note';
  end if;

  select * into v_page
  from public.brain_pages
  where id = p_page_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = '';
  end if;
  if v_page.category <> 'skill' or not starts_with(v_page.slug, 'skills/') then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'category';
  end if;

  v_name := regexp_replace(v_page.slug, '^.*/', '');
  if char_length(v_name) > 64 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'name';
  end if;

  if p_from_version is null then
    if p_expected_revision is null or v_page.revision <> p_expected_revision then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'revision';
    end if;
    v_files_digest := public.brain_skill_files_digest(p_page_id);
    if p_expected_files_digest is null or v_files_digest <> p_expected_files_digest then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'files';
    end if;

    v_title := v_page.title;
    v_description := btrim(coalesce(v_page.frontmatter ->> 'description', ''));
    v_body := v_page.body;
    v_frontmatter := v_page.frontmatter;
    v_page_revision := v_page.revision;

    select coalesce(
      jsonb_agg(jsonb_build_object('path', f.path, 'sha256', f.sha256, 'size', f.size)
                order by f.path collate "C"),
      '[]'::jsonb
    ) into v_manifest
    from public.brain_skill_files f
    where f.page_id = p_page_id;

    select coalesce(jsonb_agg(distinct r.author_user_id), '[]'::jsonb) into v_editors
    from public.brain_revisions r
    where r.page_id = p_page_id
      and r.author_user_id is not null
      and r.revision > coalesce((
        select max(v.page_revision) from public.brain_skill_versions v
        where v.tenant_id = p_tenant_id and v.page_id = p_page_id and v.action = 'publicar'
      ), 0);
  else
    select * into v_from
    from public.brain_skill_versions v
    where v.tenant_id = p_tenant_id and v.page_id = p_page_id
      and v.version = p_from_version and v.action = 'publicar';

    if not found then
      raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = 'version';
    end if;

    v_title := v_from.title;
    v_description := v_from.description;
    v_body := v_from.body;
    v_frontmatter := v_from.frontmatter;
    v_manifest := v_from.manifest;
    v_files_digest := v_from.files_digest;
    v_page_revision := v_from.page_revision;
  end if;

  if v_description = '' or char_length(v_description) > 1024 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'description';
  end if;
  if char_length(coalesce(v_frontmatter ->> 'compatibility', '')) > 500 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'compatibility';
  end if;

  -- Un nombre, una skill vigente por empresa. El lock evita que dos
  -- publicaciones simultáneas del mismo nombre pasen las dos.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_name, 0));
  if exists (
    select 1
    from public.brain_skill_versions v
    where v.tenant_id = p_tenant_id
      and v.name = v_name
      and v.page_id is distinct from p_page_id
      and v.action = 'publicar'
      and v.id = (
        select max(v2.id) from public.brain_skill_versions v2
        where v2.tenant_id = v.tenant_id and v2.page_id = v.page_id
      )
  ) then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'name';
  end if;

  select coalesce(max(v.version), 0) + 1 into v_version
  from public.brain_skill_versions v
  where v.tenant_id = p_tenant_id and v.page_id = p_page_id;

  v_digest := encode(sha256(convert_to(concat_ws(E'\n',
    v_name,
    v_description,
    encode(sha256(convert_to(v_body, 'UTF8')), 'hex'),
    coalesce(v_frontmatter ->> 'compatibility', ''),
    coalesce(v_frontmatter ->> 'license', ''),
    v_files_digest
  ), 'UTF8')), 'hex');

  insert into public.brain_skill_versions (
    tenant_id, page_id, slug, name, action, version, page_revision, title, description,
    body, frontmatter, manifest, files_digest, digest, note, republished_from, actor_user_id
  )
  values (
    p_tenant_id, p_page_id, v_page.slug, v_name, 'publicar', v_version, v_page_revision, v_title,
    v_description, v_body, v_frontmatter, v_manifest, v_files_digest, v_digest, btrim(p_note),
    p_from_version, p_actor
  );

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.skill_published', v_page.slug,
    jsonb_build_object(
      'slug', v_page.slug,
      'name', v_name,
      'version', v_version,
      'digest', v_digest,
      'page_revision', v_page_revision,
      'republished_from', p_from_version,
      'editors', v_editors,
      'note', btrim(p_note)
    )
  );

  return query select v_version, v_digest;
end;
$$;

create or replace function public.brain_withdraw_skill(
  p_tenant_id uuid,
  p_page_id uuid,
  p_note text,
  p_actor uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
  v_last public.brain_skill_versions%rowtype;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'note';
  end if;

  select * into v_page
  from public.brain_pages
  where id = p_page_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = '';
  end if;

  select * into v_last
  from public.brain_skill_versions v
  where v.tenant_id = p_tenant_id and v.page_id = p_page_id
  order by v.id desc
  limit 1;

  -- Retirar lo que no está vigente no hace nada.
  if not found or v_last.action = 'retirar' then
    return false;
  end if;

  insert into public.brain_skill_versions (
    tenant_id, page_id, slug, name, action, version, page_revision, note, actor_user_id
  )
  values (
    p_tenant_id, p_page_id, v_last.slug, v_last.name, 'retirar', v_last.version,
    v_last.page_revision, btrim(p_note), p_actor
  );

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.skill_withdrawn', v_last.slug,
    jsonb_build_object('slug', v_last.slug, 'name', v_last.name, 'version', v_last.version, 'note', btrim(p_note))
  );

  return true;
end;
$$;

-- Una fila por página de categoría skill, con su borrador y su último acto.
create or replace function public.brain_skill_overview(p_tenant_id uuid)
returns table (
  page_id uuid,
  slug text,
  revision integer,
  draft_files_digest text,
  action public.brain_skill_action,
  version integer,
  page_revision integer,
  files_digest text,
  title text,
  description text,
  body text,
  frontmatter jsonb,
  manifest jsonb,
  digest text,
  published_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id, p.slug, p.revision, public.brain_skill_files_digest(p.id),
    v.action, v.version, v.page_revision, v.files_digest, v.title, v.description,
    v.body, v.frontmatter, v.manifest, v.digest, v.created_at
  from public.brain_pages p
  left join lateral (
    select * from public.brain_skill_versions sv
    where sv.tenant_id = p.tenant_id and sv.page_id = p.id
    order by sv.id desc
    limit 1
  ) v on true
  where p.tenant_id = p_tenant_id and p.category = 'skill'
$$;

revoke execute on function public.brain_skill_files_digest(uuid) from public, anon, authenticated;
revoke execute on function public.brain_skill_put_file(uuid, uuid, text, text, integer, uuid) from public, anon, authenticated;
revoke execute on function public.brain_skill_remove_file(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.brain_publish_skill(uuid, uuid, integer, text, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.brain_withdraw_skill(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.brain_skill_overview(uuid) from public, anon, authenticated;

grant execute on function public.brain_skill_files_digest(uuid) to service_role;
grant execute on function public.brain_skill_put_file(uuid, uuid, text, text, integer, uuid) to service_role;
grant execute on function public.brain_skill_remove_file(uuid, uuid, text, uuid) to service_role;
grant execute on function public.brain_publish_skill(uuid, uuid, integer, text, text, uuid, integer) to service_role;
grant execute on function public.brain_withdraw_skill(uuid, uuid, text, uuid) to service_role;
grant execute on function public.brain_skill_overview(uuid) to service_role;
```

- [ ] **Step 5: Redefinir `brain_delete_page` en la misma migración**

Abrir `supabase/migrations/20261009120000_brain_delete_page.sql`, copiar el `create or replace function public.brain_delete_page(...)` **entero** al final de la migración nueva (misma firma, mismo cuerpo) y agregar este bloque inmediatamente después del chequeo de revisión (`if v_page.revision <> p_expected_revision then ... end if;`):

```sql
  -- Una skill con versión vigente no se borra: primero se retira (spec 24.1 §8.3).
  if (
    select v.action from public.brain_skill_versions v
    where v.tenant_id = p_tenant_id and v.page_id = v_page.id
    order by v.id desc
    limit 1
  ) = 'publicar' then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'skill_published';
  end if;
```

No hace falta repetir los `revoke`/`grant` de `brain_delete_page`: `create or replace` conserva los privilegios.

- [ ] **Step 6: Aplicar y correr pgTAP**

Run: `npm run db:reset && npm run db:test`
Expected: PASS en todos los archivos, incluido `23_brain_delete_page.test.sql` (sin cambios) y `34_brain_skills.test.sql` con 36 pruebas. Si `plan(36)` no coincide con las pruebas corridas, contar los `select` de aserción y corregir el número; no borrar pruebas.

- [ ] **Step 7: Regenerar tipos**

Run: `npm run db:types && npm run typecheck`
Expected: `lib/supabase/database.types.ts` incluye `brain_skill_files` y `brain_skill_versions`; typecheck limpio.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261020120000_brain_skills.sql supabase/tests/34_brain_skills.test.sql lib/supabase/database.types.ts
git commit -m "feat: tablas, bucket y funciones de las skills de empresa"
```

---

### Task 2: Reglas del paquete e invariante al guardar

**Files:**
- Create: `lib/brain/core/skills/package.ts`
- Modify: `lib/brain/core/wiki.ts` (`validateWrite`)
- Modify: `lib/brain/core/editor/save.ts` (mensaje de la validación)
- Test: `tests/brain/skills-package.test.ts`

**Interfaces:**
- Consumes: `validateWrite(write, config, today)` y `parseWikiConfig` de `core`.
- Produces (de `lib/brain/core/skills/package.ts`):
  - Constantes `SKILL_CATEGORY = "skill"`, `SKILLS_PREFIX = "skills/"`, `MAX_SKILL_NAME = 64`, `MAX_DESCRIPTION = 1024`, `MAX_COMPATIBILITY = 500`, `MAX_FILE_BYTES = 4_194_304`, `MAX_PACKAGE_BYTES = 20_971_520`, `MAX_PACKAGE_FILES = 50`, `LONG_BODY_LINES = 500`.
  - `isSkillSlug(slug: string): boolean`, `skillName(slug: string): string`, `isValidFilePath(path: string): boolean`, `skillPlacementOk(slug: string, category: string): boolean`, `assistantCategories(categories: string[]): string[]`.
  - `interface SkillFile { path: string; sha256: string; size: number }`
  - `type PublishProblem`, `type PublishWarning`, `PUBLISH_MESSAGES`, `checkPublishable(input: { slug: string; frontmatter: Record<string, unknown>; body: string; files: SkillFile[] }): { problems: PublishProblem[]; warnings: PublishWarning[] }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/brain/skills-package.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWikiConfig } from "@/lib/brain/core/config";
import { BrainValidation } from "@/lib/brain/core/errors";
import {
	assistantCategories,
	checkPublishable,
	isSkillSlug,
	isValidFilePath,
	MAX_FILE_BYTES,
	skillName,
	skillPlacementOk,
} from "@/lib/brain/core/skills/package";
import type { BrainWrite } from "@/lib/brain/core/types";
import { validateWrite } from "@/lib/brain/core/wiki";

const config = parseWikiConfig({ categories: ["comercial", "skill"] });
const write = (over: Partial<BrainWrite>): BrainWrite => ({
	slug: "skills/facturacion",
	title: "Facturación",
	category: "skill",
	status: "activo",
	tags: [],
	body: "cuerpo",
	reason: "alta",
	...over,
});

describe("rutas de archivo", () => {
	it.each([
		"scripts/calc.py",
		"assets/logo.png",
		"README.md",
		"a/b/c/d/e/f.txt",
		"references/guia_v2.final.md",
	])("acepta %s", (path) => {
		expect(isValidFilePath(path)).toBe(true);
	});

	it.each([
		"../afuera.txt",
		"scripts/../../x",
		"/abs.txt",
		"scripts/.oculto",
		".env",
		"SKILL.md",
		"skill.md",
		"a/b/c/d/e/f/g.txt",
		"con espacio.txt",
		"scripts/",
		"",
		`${"a".repeat(201)}`,
	])("rechaza %s", (path) => {
		expect(isValidFilePath(path)).toBe(false);
	});
});

describe("categoría y ruta van juntas", () => {
	it("una skill está bajo skills/ y tiene categoría skill", () => {
		expect(isSkillSlug("skills/admin/facturacion")).toBe(true);
		expect(isSkillSlug("skills")).toBe(false);
		expect(isSkillSlug("comercial/skills/x")).toBe(false);
		expect(skillName("skills/admin/facturacion")).toBe("facturacion");
		expect(skillPlacementOk("skills/x", "skill")).toBe(true);
		expect(skillPlacementOk("skills/x", "comercial")).toBe(false);
		expect(skillPlacementOk("comercial/x", "skill")).toBe(false);
		expect(skillPlacementOk("comercial/x", "comercial")).toBe(true);
	});

	it("validateWrite rechaza una skill fuera de skills/ y al revés", () => {
		expect(() => validateWrite(write({}), config, "2026-10-11")).not.toThrow();
		for (const bad of [
			write({ slug: "comercial/facturacion" }),
			write({ category: "comercial" }),
		]) {
			try {
				validateWrite(bad, config, "2026-10-11");
				throw new Error("tenía que fallar");
			} catch (error) {
				expect(error).toBeInstanceOf(BrainValidation);
				expect((error as BrainValidation).fields).toContain("category");
			}
		}
	});
});

describe("categorías que ve un asistente", () => {
	it("saca skill y deja el resto", () => {
		expect(assistantCategories(["comercial", "skill"])).toEqual(["comercial"]);
	});
	it("si skill es la única, no devuelve una lista vacía", () => {
		expect(assistantCategories(["skill"])).toEqual(["skill"]);
	});
});

describe("checkPublishable", () => {
	const base = {
		slug: "skills/facturacion",
		frontmatter: { description: "Usar para facturar." },
		body: "cuerpo",
		files: [],
	};

	it("un paquete correcto no tiene problemas", () => {
		expect(checkPublishable(base)).toEqual({ problems: [], warnings: [] });
	});

	it("exige descripción y respeta sus topes", () => {
		expect(checkPublishable({ ...base, frontmatter: {} }).problems).toEqual([
			"description_missing",
		]);
		expect(
			checkPublishable({ ...base, frontmatter: { description: "   " } })
				.problems,
		).toEqual(["description_missing"]);
		expect(
			checkPublishable({
				...base,
				frontmatter: { description: "x".repeat(1025) },
			}).problems,
		).toEqual(["description_too_long"]);
		expect(
			checkPublishable({
				...base,
				frontmatter: { description: "ok", compatibility: "x".repeat(501) },
			}).problems,
		).toEqual(["compatibility_too_long"]);
	});

	it("nombre largo, demasiados archivos y paquete pesado", () => {
		expect(
			checkPublishable({ ...base, slug: `skills/${"a".repeat(65)}` }).problems,
		).toEqual(["name_too_long"]);
		const many = Array.from({ length: 51 }, (_, i) => ({
			path: `f${i}.txt`,
			sha256: "a".repeat(64),
			size: 1,
		}));
		expect(checkPublishable({ ...base, files: many }).problems).toEqual([
			"too_many_files",
		]);
		const heavy = Array.from({ length: 6 }, (_, i) => ({
			path: `f${i}.bin`,
			sha256: "a".repeat(64),
			size: MAX_FILE_BYTES,
		}));
		expect(checkPublishable({ ...base, files: heavy }).problems).toEqual([
			"package_too_big",
		]);
	});

	it("un cuerpo de más de 500 líneas avisa y no frena", () => {
		const result = checkPublishable({
			...base,
			body: Array.from({ length: 501 }, () => "x").join("\n"),
		});
		expect(result.problems).toEqual([]);
		expect(result.warnings).toEqual(["long_body"]);
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/skills-package.test.ts`
Expected: FAIL, no resuelve `@/lib/brain/core/skills/package`.

- [ ] **Step 3: Escribir `package.ts`**

Crear `lib/brain/core/skills/package.ts`:

```ts
// Reglas del paquete de una skill (spec etapa 24.1 §5). Puro, sin dependencias.

export const SKILL_CATEGORY = "skill";
export const SKILLS_PREFIX = "skills/";
export const MAX_SKILL_NAME = 64;
export const MAX_DESCRIPTION = 1024;
export const MAX_COMPATIBILITY = 500;
export const MAX_FILE_BYTES = 4_194_304;
export const MAX_PACKAGE_BYTES = 20_971_520;
export const MAX_PACKAGE_FILES = 50;
export const MAX_FILE_PATH = 200;
export const LONG_BODY_LINES = 500;

// Tramos sin espacios que no empiezan con punto: deja afuera ".", ".." y los
// ocultos. Hasta seis niveles.
const FILE_PATH_PATTERN =
	/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,5}$/;

export interface SkillFile {
	path: string;
	sha256: string;
	size: number;
}

export function isSkillSlug(slug: string): boolean {
	return slug.startsWith(SKILLS_PREFIX);
}

export function skillName(slug: string): string {
	return slug.slice(slug.lastIndexOf("/") + 1);
}

export function isValidFilePath(path: string): boolean {
	return (
		path.length <= MAX_FILE_PATH &&
		FILE_PATH_PATTERN.test(path) &&
		// SKILL.md es la página, no un archivo del paquete.
		path.toLowerCase() !== "skill.md"
	);
}

// Una página es skill si y solo si tiene la categoría y está bajo skills/
// (spec S3). Como el slug no cambia, tampoco puede salir de la categoría.
export function skillPlacementOk(slug: string, category: string): boolean {
	return (category === SKILL_CATEGORY) === isSkillSlug(slug);
}

// Las tools del brain no anuncian la categoría skill a un asistente. Si es la
// única, se deja: el contrato exige al menos una, y el envoltorio igual
// rechaza todo lo que esté bajo skills/.
export function assistantCategories(categories: string[]): string[] {
	const rest = categories.filter((category) => category !== SKILL_CATEGORY);
	return rest.length > 0 ? rest : categories;
}

export type PublishProblem =
	| "description_missing"
	| "description_too_long"
	| "compatibility_too_long"
	| "name_too_long"
	| "too_many_files"
	| "package_too_big";
export type PublishWarning = "long_body";

export const PUBLISH_MESSAGES: Record<PublishProblem | PublishWarning, string> =
	{
		description_missing:
			"Falta la descripción: es lo que le dice al asistente cuándo usar la skill.",
		description_too_long: "La descripción supera los 1024 caracteres.",
		compatibility_too_long: "El campo compatibility supera los 500 caracteres.",
		name_too_long: "El nombre (último tramo de la ruta) supera los 64 caracteres.",
		too_many_files: "El paquete tiene más de 50 archivos.",
		package_too_big: "El paquete pesa más de 20 MB.",
		long_body:
			"El texto tiene más de 500 líneas. Conviene pasar el detalle a archivos de referencia.",
	};

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function checkPublishable(input: {
	slug: string;
	frontmatter: Record<string, unknown>;
	body: string;
	files: SkillFile[];
}): { problems: PublishProblem[]; warnings: PublishWarning[] } {
	const problems: PublishProblem[] = [];
	const warnings: PublishWarning[] = [];

	const description = text(input.frontmatter.description);
	if (description.length === 0) problems.push("description_missing");
	else if (description.length > MAX_DESCRIPTION)
		problems.push("description_too_long");
	if (text(input.frontmatter.compatibility).length > MAX_COMPATIBILITY)
		problems.push("compatibility_too_long");
	if (skillName(input.slug).length > MAX_SKILL_NAME)
		problems.push("name_too_long");
	if (input.files.length > MAX_PACKAGE_FILES) problems.push("too_many_files");
	if (
		input.files.reduce((total, file) => total + file.size, 0) >
		MAX_PACKAGE_BYTES
	)
		problems.push("package_too_big");

	if (input.body.split("\n").length > LONG_BODY_LINES)
		warnings.push("long_body");

	return { problems, warnings };
}
```

- [ ] **Step 4: Sumar el invariante a `validateWrite`**

En `lib/brain/core/wiki.ts`, agregar el import:

```ts
import { skillPlacementOk } from "./skills/package.ts";
```

y, dentro de `validateWrite`, justo después de la línea `if (!config.categories.includes(write.category)) fields.push("category");`:

```ts
	// Una skill va bajo skills/ con categoría skill, y solo ella (spec 24.1 S3).
	if (
		!fields.includes("category") &&
		!skillPlacementOk(write.slug, write.category)
	)
		fields.push("category");
```

- [ ] **Step 5: Mensaje claro en el editor**

En `lib/brain/core/editor/save.ts`, agregar el import:

```ts
import { skillPlacementOk } from "../skills/package";
```

y reemplazar el bloque `if (error instanceof BrainValidation) return { ... };` por:

```ts
		if (error instanceof BrainValidation)
			return {
				ok: false,
				code: "validation",
				fields: error.fields,
				message: skillPlacementOk(input.slug, input.category)
					? error.message
					: "Las skills van bajo skills/ con categoría skill, y nada más va ahí.",
			};
```

- [ ] **Step 6: Correr los tests**

Run: `npx vitest run tests/brain`
Expected: PASS, incluidos `skills-package.test.ts`, `boundary.test.ts` y `editor-save.test.ts`.

- [ ] **Step 7: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/skills/package.ts lib/brain/core/wiki.ts lib/brain/core/editor/save.ts tests/brain/skills-package.test.ts
npm run typecheck
git add lib/brain/core/skills/package.ts lib/brain/core/wiki.ts lib/brain/core/editor/save.ts tests/brain/skills-package.test.ts
git commit -m "feat: reglas del paquete de una skill y su lugar en el brain"
```

---

### Task 3: Acceso a datos

**Files:**
- Create: `lib/brain/core/skills/store.ts`
- Test: `tests/brain/skills-store.test.ts`

**Interfaces:**
- Consumes: las funciones SQL de la Task 1; `WikiStoreError` de `lib/brain/core/wiki-store.ts`; `SkillFile` de `package.ts`.
- Produces (de `lib/brain/core/skills/store.ts`):

```ts
export type SkillAction = "publicar" | "retirar";
export interface SkillSnapshot {
	action: SkillAction;
	version: number;
	pageRevision: number;
	filesDigest: string;
	title: string;
	description: string;
	body: string;
	frontmatter: Record<string, unknown>;
	manifest: SkillFile[];
	digest: string;
	publishedAt: string;
}
export interface SkillOverviewRow {
	pageId: string;
	slug: string;
	revision: number;
	draftFilesDigest: string;
	current: SkillSnapshot | null;
}
export interface SkillAct {
	id: number;
	action: SkillAction;
	version: number;
	pageRevision: number;
	title: string;
	description: string;
	body: string;
	manifest: SkillFile[];
	digest: string;
	note: string;
	republishedFrom: number | null;
	actorUserId: string | null;
	createdAt: string;
}
export interface SkillStore {
	overview(tenantId: string): Promise<SkillOverviewRow[]>;
	files(tenantId: string, pageId: string): Promise<SkillFile[]>;
	acts(tenantId: string, pageId: string): Promise<SkillAct[]>; // del más nuevo al más viejo
	putFile(p: { tenantId: string; pageId: string; path: string; sha256: string; size: number; actorUserId: string }): Promise<string>;
	removeFile(p: { tenantId: string; pageId: string; path: string; actorUserId: string }): Promise<string>;
	publish(p: { tenantId: string; pageId: string; expectedRevision: number | null; expectedFilesDigest: string | null; note: string; actorUserId: string; fromVersion: number | null }): Promise<{ version: number; digest: string }>;
	withdraw(p: { tenantId: string; pageId: string; note: string; actorUserId: string }): Promise<boolean>;
}
export function createSupabaseSkillStore(client: SupabaseClient): SkillStore;
```

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/brain/skills-store.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseSkillStore } from "@/lib/brain/core/skills/store";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

function clientWith(rpc: ReturnType<typeof vi.fn>) {
	return { rpc } as unknown as SupabaseClient;
}

describe("createSupabaseSkillStore", () => {
	it("overview llama a brain_skill_overview y arma el último acto", async () => {
		const rpc = vi.fn(async () => ({
			data: [
				{
					page_id: "p1",
					slug: "skills/a",
					revision: 3,
					draft_files_digest: "d1",
					action: "publicar",
					version: 2,
					page_revision: 3,
					files_digest: "d1",
					title: "A",
					description: "desc",
					body: "cuerpo",
					frontmatter: { description: "desc" },
					manifest: [{ path: "a.py", sha256: "x", size: 1 }],
					digest: "dg",
					published_at: "2026-10-11T00:00:00Z",
				},
				{
					page_id: "p2",
					slug: "skills/b",
					revision: 1,
					draft_files_digest: "d0",
					action: null,
				},
			],
			error: null,
		}));
		const rows = await createSupabaseSkillStore(clientWith(rpc)).overview("t1");
		expect(rpc).toHaveBeenCalledWith("brain_skill_overview", {
			p_tenant_id: "t1",
		});
		expect(rows[0].current?.version).toBe(2);
		expect(rows[0].current?.manifest).toEqual([
			{ path: "a.py", sha256: "x", size: 1 },
		]);
		expect(rows[1]).toEqual({
			pageId: "p2",
			slug: "skills/b",
			revision: 1,
			draftFilesDigest: "d0",
			current: null,
		});
	});

	it("publish pasa los argumentos exactos y devuelve versión y hash", async () => {
		const rpc = vi.fn(async () => ({
			data: [{ skill_version: 4, skill_digest: "dg" }],
			error: null,
		}));
		const out = await createSupabaseSkillStore(clientWith(rpc)).publish({
			tenantId: "t1",
			pageId: "p1",
			expectedRevision: 7,
			expectedFilesDigest: "fd",
			note: "nota",
			actorUserId: "u1",
			fromVersion: null,
		});
		expect(rpc).toHaveBeenCalledWith("brain_publish_skill", {
			p_tenant_id: "t1",
			p_page_id: "p1",
			p_expected_revision: 7,
			p_expected_files_digest: "fd",
			p_note: "nota",
			p_actor: "u1",
			p_from_version: null,
		});
		expect(out).toEqual({ version: 4, digest: "dg" });
	});

	it("putFile, removeFile y withdraw usan sus funciones", async () => {
		const rpc = vi.fn(async (name: string) => ({
			data: name === "brain_withdraw_skill" ? true : "digest",
			error: null,
		}));
		const store = createSupabaseSkillStore(clientWith(rpc));
		await store.putFile({
			tenantId: "t1",
			pageId: "p1",
			path: "a.py",
			sha256: "x",
			size: 3,
			actorUserId: "u1",
		});
		expect(rpc).toHaveBeenLastCalledWith("brain_skill_put_file", {
			p_tenant_id: "t1",
			p_page_id: "p1",
			p_path: "a.py",
			p_sha256: "x",
			p_size: 3,
			p_actor: "u1",
		});
		await store.removeFile({
			tenantId: "t1",
			pageId: "p1",
			path: "a.py",
			actorUserId: "u1",
		});
		expect(rpc).toHaveBeenLastCalledWith("brain_skill_remove_file", {
			p_tenant_id: "t1",
			p_page_id: "p1",
			p_path: "a.py",
			p_actor: "u1",
		});
		expect(
			await store.withdraw({
				tenantId: "t1",
				pageId: "p1",
				note: "n",
				actorUserId: "u1",
			}),
		).toBe(true);
		expect(rpc).toHaveBeenLastCalledWith("brain_withdraw_skill", {
			p_tenant_id: "t1",
			p_page_id: "p1",
			p_note: "n",
			p_actor: "u1",
		});
	});

	it("un error de la base sale como WikiStoreError con código y detalle", async () => {
		const rpc = vi.fn(async () => ({
			data: null,
			error: { code: "BR409", message: "BRAIN_CONFLICT", details: "name" },
		}));
		await expect(
			createSupabaseSkillStore(clientWith(rpc)).publish({
				tenantId: "t1",
				pageId: "p1",
				expectedRevision: 1,
				expectedFilesDigest: "fd",
				note: "n",
				actorUserId: "u1",
				fromVersion: null,
			}),
		).rejects.toMatchObject({
			name: "WikiStoreError",
			code: "BR409",
			details: "name",
		});
		expect(WikiStoreError).toBeDefined();
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/skills-store.test.ts`
Expected: FAIL, no resuelve `@/lib/brain/core/skills/store`.

- [ ] **Step 3: Escribir `store.ts`**

Crear `lib/brain/core/skills/store.ts`:

```ts
// Acceso a Supabase de las skills (spec etapa 24.1 §4.4). Sin lógica: los
// permisos van en publish.ts y files.ts, y las reglas en las funciones SQL,
// probadas con pgTAP. Recibe el cliente por parámetro.
import type { SupabaseClient } from "@supabase/supabase-js";
import { WikiStoreError } from "../wiki-store.ts";
import type { SkillFile } from "./package.ts";

export type SkillAction = "publicar" | "retirar";

export interface SkillSnapshot {
	action: SkillAction;
	version: number;
	pageRevision: number;
	filesDigest: string;
	title: string;
	description: string;
	body: string;
	frontmatter: Record<string, unknown>;
	manifest: SkillFile[];
	digest: string;
	publishedAt: string;
}

export interface SkillOverviewRow {
	pageId: string;
	slug: string;
	revision: number;
	draftFilesDigest: string;
	current: SkillSnapshot | null;
}

export interface SkillAct {
	id: number;
	action: SkillAction;
	version: number;
	pageRevision: number;
	title: string;
	description: string;
	body: string;
	manifest: SkillFile[];
	digest: string;
	note: string;
	republishedFrom: number | null;
	actorUserId: string | null;
	createdAt: string;
}

export interface SkillStore {
	overview(tenantId: string): Promise<SkillOverviewRow[]>;
	files(tenantId: string, pageId: string): Promise<SkillFile[]>;
	acts(tenantId: string, pageId: string): Promise<SkillAct[]>;
	putFile(p: {
		tenantId: string;
		pageId: string;
		path: string;
		sha256: string;
		size: number;
		actorUserId: string;
	}): Promise<string>;
	removeFile(p: {
		tenantId: string;
		pageId: string;
		path: string;
		actorUserId: string;
	}): Promise<string>;
	publish(p: {
		tenantId: string;
		pageId: string;
		expectedRevision: number | null;
		expectedFilesDigest: string | null;
		note: string;
		actorUserId: string;
		fromVersion: number | null;
	}): Promise<{ version: number; digest: string }>;
	withdraw(p: {
		tenantId: string;
		pageId: string;
		note: string;
		actorUserId: string;
	}): Promise<boolean>;
}

type Row = Record<string, unknown>;

function fail(error: {
	code?: string;
	message: string;
	details?: string | null;
}): never {
	throw new WikiStoreError(
		error.code ?? "",
		error.message,
		error.details ?? "",
	);
}

function toManifest(value: unknown): SkillFile[] {
	return Array.isArray(value) ? (value as SkillFile[]) : [];
}

export function createSupabaseSkillStore(client: SupabaseClient): SkillStore {
	return {
		async overview(tenantId) {
			const { data, error } = await client.rpc("brain_skill_overview", {
				p_tenant_id: tenantId,
			});
			if (error) fail(error);
			return ((data ?? []) as Row[]).map((row) => ({
				pageId: row.page_id as string,
				slug: row.slug as string,
				revision: row.revision as number,
				draftFilesDigest: row.draft_files_digest as string,
				current: row.action
					? {
							action: row.action as SkillAction,
							version: row.version as number,
							pageRevision: row.page_revision as number,
							filesDigest: row.files_digest as string,
							title: row.title as string,
							description: row.description as string,
							body: row.body as string,
							frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
							manifest: toManifest(row.manifest),
							digest: row.digest as string,
							publishedAt: row.published_at as string,
						}
					: null,
			}));
		},

		async files(tenantId, pageId) {
			const { data, error } = await client
				.from("brain_skill_files")
				.select("path, sha256, size")
				.eq("tenant_id", tenantId)
				.eq("page_id", pageId)
				.order("path");
			if (error) fail(error);
			return (data ?? []) as SkillFile[];
		},

		async acts(tenantId, pageId) {
			const { data, error } = await client
				.from("brain_skill_versions")
				.select(
					"id, action, version, page_revision, title, description, body, manifest, digest, note, republished_from, actor_user_id, created_at",
				)
				.eq("tenant_id", tenantId)
				.eq("page_id", pageId)
				.order("id", { ascending: false });
			if (error) fail(error);
			return ((data ?? []) as Row[]).map((row) => ({
				id: row.id as number,
				action: row.action as SkillAction,
				version: row.version as number,
				pageRevision: row.page_revision as number,
				title: row.title as string,
				description: row.description as string,
				body: row.body as string,
				manifest: toManifest(row.manifest),
				digest: row.digest as string,
				note: row.note as string,
				republishedFrom: (row.republished_from as number | null) ?? null,
				actorUserId: (row.actor_user_id as string | null) ?? null,
				createdAt: row.created_at as string,
			}));
		},

		async putFile(p) {
			const { data, error } = await client.rpc("brain_skill_put_file", {
				p_tenant_id: p.tenantId,
				p_page_id: p.pageId,
				p_path: p.path,
				p_sha256: p.sha256,
				p_size: p.size,
				p_actor: p.actorUserId,
			});
			if (error) fail(error);
			return data as string;
		},

		async removeFile(p) {
			const { data, error } = await client.rpc("brain_skill_remove_file", {
				p_tenant_id: p.tenantId,
				p_page_id: p.pageId,
				p_path: p.path,
				p_actor: p.actorUserId,
			});
			if (error) fail(error);
			return data as string;
		},

		async publish(p) {
			const { data, error } = await client.rpc("brain_publish_skill", {
				p_tenant_id: p.tenantId,
				p_page_id: p.pageId,
				p_expected_revision: p.expectedRevision,
				p_expected_files_digest: p.expectedFilesDigest,
				p_note: p.note,
				p_actor: p.actorUserId,
				p_from_version: p.fromVersion,
			});
			if (error) fail(error);
			const row = (
				data as Array<{ skill_version: number; skill_digest: string }> | null
			)?.[0];
			if (!row) throw new Error("La base no confirmó la publicación.");
			return { version: row.skill_version, digest: row.skill_digest };
		},

		async withdraw(p) {
			const { data, error } = await client.rpc("brain_withdraw_skill", {
				p_tenant_id: p.tenantId,
				p_page_id: p.pageId,
				p_note: p.note,
				p_actor: p.actorUserId,
			});
			if (error) fail(error);
			return data === true;
		},
	};
}
```

- [ ] **Step 4: Correr, lint, typecheck y commit**

```bash
npx vitest run tests/brain/skills-store.test.ts tests/brain/boundary.test.ts
npx biome check --write lib/brain/core/skills/store.ts tests/brain/skills-store.test.ts
npm run typecheck
git add lib/brain/core/skills/store.ts tests/brain/skills-store.test.ts
git commit -m "feat: acceso a datos de las skills"
```

Expected: tests PASS.

---

### Task 4: Estados y qué ve cada uno

**Files:**
- Create: `lib/brain/core/skills/state.ts`
- Create: `lib/brain/core/skills/view.ts`
- Test: `tests/brain/skills-state.test.ts`, `tests/brain/skills-view.test.ts`

**Interfaces:**
- Consumes: `SkillOverviewRow`, `SkillSnapshot` (Task 3); `isSkillSlug`, `SKILL_CATEGORY` (Task 2); `BrainProvider`, `BrainPage` de `core/types.ts`; `atLeast`, `Level` de `core/access/types.ts`; `BrainForbidden`, `BrainNotFound` de `core/errors.ts`.
- Produces:
  - `type SkillState = { kind: "sin_publicar" } | { kind: "publicada"; version: number; dirty: boolean } | { kind: "retirada"; version: number }`
  - `skillState(row: SkillOverviewRow): SkillState`
  - `publishedSnapshot(row: SkillOverviewRow | undefined): SkillSnapshot | null` (el acto vigente si es `publicar`)
  - `skillStateLabel(state: SkillState): string` (el rótulo en castellano)
  - `withoutSkills(provider: BrainProvider): BrainProvider`
  - `withSkillView(provider: BrainProvider, options: { levelOf: (slug: string) => Level | null; overview: () => Promise<SkillOverviewRow[]> }): BrainProvider`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/brain/skills-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	publishedSnapshot,
	skillState,
	skillStateLabel,
} from "@/lib/brain/core/skills/state";
import type {
	SkillOverviewRow,
	SkillSnapshot,
} from "@/lib/brain/core/skills/store";

const snapshot = (over: Partial<SkillSnapshot> = {}): SkillSnapshot => ({
	action: "publicar",
	version: 3,
	pageRevision: 5,
	filesDigest: "fd",
	title: "T",
	description: "d",
	body: "publicado",
	frontmatter: { description: "d" },
	manifest: [],
	digest: "dg",
	publishedAt: "2026-10-11T00:00:00Z",
	...over,
});
const row = (over: Partial<SkillOverviewRow> = {}): SkillOverviewRow => ({
	pageId: "p1",
	slug: "skills/a",
	revision: 5,
	draftFilesDigest: "fd",
	current: snapshot(),
	...over,
});

describe("skillState", () => {
	it("sin actos: sin publicar", () => {
		expect(skillState(row({ current: null }))).toEqual({ kind: "sin_publicar" });
	});
	it("borrador igual a lo publicado", () => {
		expect(skillState(row())).toEqual({
			kind: "publicada",
			version: 3,
			dirty: false,
		});
	});
	it("cambió el texto o cambiaron los archivos", () => {
		expect(skillState(row({ revision: 6 }))).toMatchObject({ dirty: true });
		expect(skillState(row({ draftFilesDigest: "otro" }))).toMatchObject({
			dirty: true,
		});
	});
	it("rótulos", () => {
		expect(skillStateLabel({ kind: "sin_publicar" })).toBe("Sin publicar");
		expect(skillStateLabel({ kind: "publicada", version: 2, dirty: true })).toBe(
			"Publicada v2, con cambios sin publicar",
		);
	});
	it("último acto retirar", () => {
		expect(skillState(row({ current: snapshot({ action: "retirar" }) }))).toEqual(
			{ kind: "retirada", version: 3 },
		);
	});
});

describe("publishedSnapshot", () => {
	it("solo devuelve un acto vigente", () => {
		expect(publishedSnapshot(row())?.body).toBe("publicado");
		expect(
			publishedSnapshot(row({ current: snapshot({ action: "retirar" }) })),
		).toBeNull();
		expect(publishedSnapshot(row({ current: null }))).toBeNull();
		expect(publishedSnapshot(undefined)).toBeNull();
	});
});
```

Crear `tests/brain/skills-view.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Level } from "@/lib/brain/core/access/types";
import { BrainForbidden, BrainNotFound } from "@/lib/brain/core/errors";
import type { SkillOverviewRow } from "@/lib/brain/core/skills/store";
import { withoutSkills, withSkillView } from "@/lib/brain/core/skills/view";
import type {
	BrainPage,
	BrainProvider,
	BrainWrite,
} from "@/lib/brain/core/types";

const page = (slug: string, over: Partial<BrainPage> = {}): BrainPage => ({
	slug,
	title: `borrador ${slug}`,
	category: slug.startsWith("skills/") ? "skill" : "comercial",
	status: "activo",
	tags: [],
	frontmatter: { description: "borrador" },
	body: `cuerpo borrador de ${slug}`,
	revision: 9,
	updatedAt: "2026-10-11T00:00:00Z",
	...over,
});

const PAGES = [
	page("comercial/icp"),
	page("skills/publicada"),
	page("skills/sin-publicar"),
	page("skills/retirada"),
];

function fakeProvider() {
	const upsert = vi.fn(async (write: BrainWrite) => ({
		slug: write.slug,
		revision: 10,
	}));
	const provider: BrainProvider = {
		search: async () =>
			PAGES.map((p) => ({
				slug: p.slug,
				title: p.title,
				category: p.category,
				status: p.status,
				tags: [],
				snippet: p.body,
				updatedAt: p.updatedAt,
			})),
		read: async (slug) => {
			const found = PAGES.find((p) => p.slug === slug);
			if (!found) throw new BrainNotFound(slug, []);
			return found;
		},
		list: async () => PAGES,
		history: async () => [],
		upsert,
	};
	return { provider, upsert };
}

const snap = (action: "publicar" | "retirar") => ({
	action,
	version: 2,
	pageRevision: 4,
	filesDigest: "fd",
	title: "Publicada",
	description: "desc publicada",
	body: "cuerpo publicado",
	frontmatter: { description: "desc publicada" },
	manifest: [],
	digest: "dg",
	publishedAt: "2026-10-10T00:00:00Z",
});
const OVERVIEW: SkillOverviewRow[] = [
	{
		pageId: "p1",
		slug: "skills/publicada",
		revision: 9,
		draftFilesDigest: "x",
		current: snap("publicar"),
	},
	{
		pageId: "p2",
		slug: "skills/sin-publicar",
		revision: 9,
		draftFilesDigest: "x",
		current: null,
	},
	{
		pageId: "p3",
		slug: "skills/retirada",
		revision: 9,
		draftFilesDigest: "x",
		current: snap("retirar"),
	},
];

const write = (slug: string, category: string): BrainWrite => ({
	slug,
	title: "t",
	category,
	status: "activo",
	tags: [],
	body: "b",
	reason: "r",
});

describe("withoutSkills (asistentes)", () => {
	it("search y list dejan afuera todo skills/", async () => {
		const wrapped = withoutSkills(fakeProvider().provider);
		expect((await wrapped.search({ query: "" })).map((r) => r.slug)).toEqual([
			"comercial/icp",
		]);
		expect((await wrapped.list()).map((p) => p.slug)).toEqual([
			"comercial/icp",
		]);
	});

	it("read e history responden como si no existiera", async () => {
		const wrapped = withoutSkills(fakeProvider().provider);
		await expect(wrapped.read("skills/publicada")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
		expect(await wrapped.history("skills/publicada")).toBeNull();
		expect((await wrapped.read("comercial/icp")).slug).toBe("comercial/icp");
	});

	it("upsert rechaza la ruta y la categoría, y no llega al proveedor", async () => {
		const { provider, upsert } = fakeProvider();
		const wrapped = withoutSkills(provider);
		const author = { kind: "user" as const, userId: "u1" };
		await expect(
			wrapped.upsert(write("skills/nueva", "skill"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		await expect(
			wrapped.upsert(write("skills/nueva", "comercial"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		await expect(
			wrapped.upsert(write("comercial/x", "skill"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		expect(upsert).not.toHaveBeenCalled();
		await wrapped.upsert(write("comercial/x", "comercial"), author);
		expect(upsert).toHaveBeenCalledTimes(1);
	});
});

describe("withSkillView (web)", () => {
	const view = (level: Level | null) => {
		const overview = vi.fn(async () => OVERVIEW);
		return {
			overview,
			wrapped: withSkillView(fakeProvider().provider, {
				levelOf: () => level,
				overview,
			}),
		};
	};

	it("un editor ve el borrador", async () => {
		const { wrapped } = view("editor");
		expect((await wrapped.read("skills/publicada")).body).toBe(
			"cuerpo borrador de skills/publicada",
		);
		expect((await wrapped.list()).map((p) => p.slug)).toHaveLength(4);
		expect(await wrapped.history("skills/publicada")).toEqual([]);
	});

	it("un lector ve la copia publicada, con la revisión del borrador", async () => {
		const { wrapped } = view("lector");
		const read = await wrapped.read("skills/publicada");
		expect(read.body).toBe("cuerpo publicado");
		expect(read.title).toBe("Publicada");
		expect(read.frontmatter).toEqual({ description: "desc publicada" });
		expect(read.slug).toBe("skills/publicada");
	});

	it("para un lector, sin versión vigente la skill no existe", async () => {
		const { wrapped } = view("lector");
		await expect(wrapped.read("skills/sin-publicar")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
		await expect(wrapped.read("skills/retirada")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
		expect((await wrapped.list()).map((p) => p.slug)).toEqual([
			"comercial/icp",
			"skills/publicada",
		]);
	});

	it("un lector no encuentra skills con la búsqueda ni ve su historial", async () => {
		const { wrapped } = view("lector");
		expect((await wrapped.search({ query: "" })).map((r) => r.slug)).toEqual([
			"comercial/icp",
		]);
		expect(await wrapped.history("skills/publicada")).toBeNull();
	});

	it("lo que no es skill pasa sin consultar el resumen", async () => {
		const { wrapped, overview } = view("lector");
		await wrapped.read("comercial/icp");
		expect(overview).not.toHaveBeenCalled();
	});

	it("el resumen se lee una sola vez por envoltorio", async () => {
		const { wrapped, overview } = view("lector");
		await wrapped.list();
		await wrapped.read("skills/publicada");
		expect(overview).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run tests/brain/skills-state.test.ts tests/brain/skills-view.test.ts`
Expected: FAIL, no resuelve `state` ni `view`.

- [ ] **Step 3: Escribir `state.ts`**

Crear `lib/brain/core/skills/state.ts`:

```ts
// Estado de publicación de una skill (spec etapa 24.1 §8.1). Puro.
import type { SkillOverviewRow, SkillSnapshot } from "./store.ts";

export type SkillState =
	| { kind: "sin_publicar" }
	| { kind: "publicada"; version: number; dirty: boolean }
	| { kind: "retirada"; version: number };

export function skillState(row: SkillOverviewRow): SkillState {
	const current = row.current;
	if (!current) return { kind: "sin_publicar" };
	if (current.action === "retirar")
		return { kind: "retirada", version: current.version };
	return {
		kind: "publicada",
		version: current.version,
		// Tras republicar una versión anterior, la revisión congelada es la de
		// aquella versión: el borrador queda "con cambios", que es lo correcto.
		dirty:
			row.revision !== current.pageRevision ||
			row.draftFilesDigest !== current.filesDigest,
	};
}

// La copia que se distribuye: el último acto, solo si es una publicación.
export function publishedSnapshot(
	row: SkillOverviewRow | undefined,
): SkillSnapshot | null {
	return row?.current?.action === "publicar" ? row.current : null;
}

export function skillStateLabel(state: SkillState): string {
	if (state.kind === "sin_publicar") return "Sin publicar";
	if (state.kind === "retirada") return `Retirada (era la v${state.version})`;
	return state.dirty
		? `Publicada v${state.version}, con cambios sin publicar`
		: `Publicada v${state.version}`;
}
```

- [ ] **Step 4: Escribir `view.ts`**

Crear `lib/brain/core/skills/view.ts`:

```ts
// Qué se ve de una skill según por dónde se mire (spec etapa 24.1 §7).
// withoutSkills: los asistentes (tools del agente y endpoint MCP) no ven nada
// bajo skills/. No se resuelve con withAccess porque el agente es
// administrador en el brain.
// withSkillView: en la web, quien edita ve el borrador y quien solo lee ve la
// copia publicada; sin versión vigente, para un lector la skill no existe.
import { atLeast, type Level } from "../access/types.ts";
import { BrainForbidden, BrainNotFound } from "../errors.ts";
import type { BrainPage, BrainProvider } from "../types.ts";
import { isSkillSlug, SKILL_CATEGORY } from "./package.ts";
import { publishedSnapshot } from "./state.ts";
import type { SkillOverviewRow } from "./store.ts";

export function withoutSkills(provider: BrainProvider): BrainProvider {
	return {
		async search(input) {
			return (await provider.search(input)).filter(
				(result) => !isSkillSlug(result.slug),
			);
		},
		async read(slug, options) {
			if (isSkillSlug(slug)) throw new BrainNotFound(slug, []);
			return provider.read(slug, options);
		},
		async list() {
			return (await provider.list()).filter((page) => !isSkillSlug(page.slug));
		},
		async history(slug) {
			return isSkillSlug(slug) ? null : provider.history(slug);
		},
		async upsert(write, author) {
			if (isSkillSlug(write.slug) || write.category === SKILL_CATEGORY) {
				throw new BrainForbidden(
					"Las skills se editan y se publican desde la plataforma, no desde un asistente.",
				);
			}
			return provider.upsert(write, author);
		},
	};
}

export function withSkillView(
	provider: BrainProvider,
	options: {
		levelOf: (slug: string) => Level | null;
		overview: () => Promise<SkillOverviewRow[]>;
	},
): BrainProvider {
	// Una lectura por envoltorio: el contexto del editor vive un request.
	let loaded: Promise<Map<string, SkillOverviewRow>> | null = null;
	const rows = () => {
		loaded ??= options
			.overview()
			.then((list) => new Map(list.map((row) => [row.slug, row])));
		return loaded;
	};
	const seesDraft = (slug: string) => atLeast(options.levelOf(slug), "editor");

	const published = async (page: BrainPage): Promise<BrainPage | null> => {
		const snapshot = publishedSnapshot((await rows()).get(page.slug));
		if (!snapshot) return null;
		return {
			...page,
			title: snapshot.title,
			frontmatter: snapshot.frontmatter,
			body: snapshot.body,
			updatedAt: snapshot.publishedAt,
		};
	};

	return {
		async search(input) {
			// El fragmento sale del borrador: solo para quien lo puede ver.
			return (await provider.search(input)).filter(
				(result) => !isSkillSlug(result.slug) || seesDraft(result.slug),
			);
		},
		async read(slug, readOptions) {
			const page = await provider.read(slug, readOptions);
			if (!isSkillSlug(slug) || seesDraft(slug)) return page;
			const view = await published(page);
			if (!view) throw new BrainNotFound(slug, []);
			return view;
		},
		async list() {
			const pages = await provider.list();
			const out: BrainPage[] = [];
			for (const page of pages) {
				if (!isSkillSlug(page.slug) || seesDraft(page.slug)) {
					out.push(page);
					continue;
				}
				const view = await published(page);
				if (view) out.push(view);
			}
			return out;
		},
		async history(slug) {
			// Las revisiones son del borrador.
			if (isSkillSlug(slug) && !seesDraft(slug)) return null;
			return provider.history(slug);
		},
		upsert: (write, author) => provider.upsert(write, author),
	};
}
```

- [ ] **Step 5: Correr, lint, typecheck y commit**

```bash
npx vitest run tests/brain/skills-state.test.ts tests/brain/skills-view.test.ts tests/brain/boundary.test.ts
npx biome check --write lib/brain/core/skills/state.ts lib/brain/core/skills/view.ts tests/brain/skills-state.test.ts tests/brain/skills-view.test.ts
npm run typecheck
git add lib/brain/core/skills/state.ts lib/brain/core/skills/view.ts tests/brain/skills-state.test.ts tests/brain/skills-view.test.ts
git commit -m "feat: estados de una skill y que ve cada uno"
```

Expected: tests PASS.

---

### Task 5: Los asistentes no ven `skills/`

**Files:**
- Modify: `lib/brain/adapters/tools.ts`
- Modify: `lib/brain/core/mcp-server/handler.ts`
- Test: `tests/brain/tools.test.ts`, `tests/brain/mcp-server/handler.test.ts` (se agregan casos)

**Interfaces:**
- Consumes: `withoutSkills` (Task 4), `assistantCategories` (Task 2).
- Produces: nada nuevo. Cambia el comportamiento de `createBrainTools` y de `handleBrainMcp`.

- [ ] **Step 1: Agregar los casos que fallan en `tests/brain/tools.test.ts`**

Dentro de `describe("createBrainTools", ...)`, al final, agregar (usa `binding` y `vi` que el archivo ya tiene):

```ts
	describe("skills", () => {
		const skillBinding: BrainBinding = {
			...binding,
			config: { ...binding.config, categories: ["comercial", "skill"] },
		} as BrainBinding;
		const summary = (slug: string) => ({
			slug,
			title: slug,
			category: slug.startsWith("skills/") ? "skill" : "comercial",
			status: "activo" as const,
			tags: [],
			snippet: "",
			updatedAt: "2026-01-01",
		});

		function setup() {
			const read = vi.fn();
			const upsert = vi.fn(async () => ({ slug: "a", revision: 1 }));
			const tools = createBrainTools(skillBinding, "read_write", {
				provider: () => ({
					search: async () => [
						summary("comercial/icp"),
						summary("skills/facturacion"),
					],
					read,
					list: async () => [],
					history: async () => null,
					upsert,
				}),
			});
			return { tools, read, upsert };
		}

		it("brain_search no devuelve nada bajo skills/", async () => {
			const { tools } = setup();
			const result = await tools.brain_search.execute(
				{ query: "" },
				{} as never,
			);
			expect(
				(result as { results: Array<{ slug: string }> }).results.map(
					(r) => r.slug,
				),
			).toEqual(["comercial/icp"]);
		});

		it("brain_read de una skill responde not_found sin tocar el proveedor", async () => {
			const { tools, read } = setup();
			const result = await tools.brain_read.execute(
				{ slug: "skills/facturacion" },
				{} as never,
			);
			expect(result).toMatchObject({ ok: false, error: "not_found" });
			expect(read).not.toHaveBeenCalled();
		});

		it("brain_upsert rechaza la ruta skills/ y no escribe", async () => {
			const { tools, upsert } = setup();
			if (!("brain_upsert" in tools)) throw new Error("falta brain_upsert");
			const result = await tools.brain_upsert.execute(
				{
					slug: "skills/x",
					title: "x",
					category: "comercial",
					status: "activo",
					tags: [],
					body: "b",
					reason: "r",
				},
				{ session: { id: "s1", auth: { initiator: null } } } as never,
			);
			expect(result).toMatchObject({ ok: false, error: "forbidden" });
			expect(upsert).not.toHaveBeenCalled();
		});
	});
```

- [ ] **Step 2: Agregar los casos que fallan en `tests/brain/mcp-server/handler.test.ts`**

Dentro de `describe("handleBrainMcp", ...)`, al final (usa `binding`, `store`, `deps` y `connect` del archivo):

```ts
	describe("skills", () => {
		const skillBinding: BrainBinding = {
			...binding,
			config: { ...binding.config, categories: ["comercial", "skill"] },
		} as BrainBinding;
		const skillDeps = () =>
			deps({ store: { ...store, brainBinding: async () => skillBinding } });

		it("ni un administrador lee una skill por MCP", async () => {
			const d = skillDeps();
			const admin = await connect("admin", d);
			const result = await admin.callTool({
				name: "brain_read",
				arguments: { slug: "skills/facturacion" },
			});
			expect(result.isError).toBe(true);
			expect(result.structuredContent).toMatchObject({ error: "not_found" });
			expect(d.providerInstance.read).not.toHaveBeenCalled();
		});

		it("brain_upsert no anuncia la categoría skill", async () => {
			const admin = await connect("admin", skillDeps());
			const upsert = (await admin.listTools()).tools.find(
				(tool) => tool.name === "brain_upsert",
			);
			expect(JSON.stringify(upsert?.inputSchema)).toContain('"comercial"');
			expect(JSON.stringify(upsert?.inputSchema)).not.toContain('"skill"');
		});
	});
```

Run: `npx vitest run tests/brain/tools.test.ts tests/brain/mcp-server/handler.test.ts`
Expected: FAIL en los cinco casos nuevos.

- [ ] **Step 3: Envolver las tools del agente**

En `lib/brain/adapters/tools.ts`:

Agregar los imports:

```ts
import { assistantCategories } from "../core/skills/package.ts";
import { withoutSkills } from "../core/skills/view.ts";
```

En `buildBrainReadTools` y en `buildBrainUpsertTool`, reemplazar `const categories = binding.config.categories;` por:

```ts
	// Un asistente no ve la categoría skill (spec 24.1 S6).
	const categories = assistantCategories(binding.config.categories);
```

En los tres `execute`, reemplazar `const provider = await resolveActingProvider(binding, deps.actor, deps);` por:

```ts
				const provider = withoutSkills(
					await resolveActingProvider(binding, deps.actor, deps),
				);
```

En `createBrainTools`, reemplazar `const contract = brainContract(binding.config.categories);` por:

```ts
	const contract = brainContract(
		assistantCategories(binding.config.categories),
	);
```

`withoutSkills` y `assistantCategories` son imports estables, así que no rompen la rehidratación de los callbacks que explica el comentario del archivo. **No** tocar `resolveActingProvider`: lo usa también el guardado del editor web, que sí tiene que escribir borradores.

- [ ] **Step 4: Envolver el endpoint MCP**

En `lib/brain/core/mcp-server/handler.ts`, agregar:

```ts
import { assistantCategories } from "../skills/package.ts";
import { withoutSkills } from "../skills/view.ts";
```

y en `handleBrainMcpInner` reemplazar la construcción del proveedor y las categorías:

```ts
	// withoutSkills por fuera de withAccess: ni un administrador ve skills por
	// este canal (spec 24.1 S6).
	const provider = withoutSkills(
		withAccess(
			deps.provider(access.binding),
			{ kind: "user", userId: access.userId, role: access.role },
			rules,
		),
	);

	const server = buildBrainMcpServer({
		userId: access.userId,
		categories: assistantCategories(access.binding.config.categories),
```

(el resto del objeto que recibe `buildBrainMcpServer` queda igual).

- [ ] **Step 5: Correr todo el brain**

Run: `npx vitest run tests/brain`
Expected: PASS, incluidos los casos nuevos y `contract.test.ts` sin cambios.

- [ ] **Step 6: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/adapters/tools.ts lib/brain/core/mcp-server/handler.ts tests/brain/tools.test.ts tests/brain/mcp-server/handler.test.ts
npm run typecheck
git add lib/brain/adapters/tools.ts lib/brain/core/mcp-server/handler.ts tests/brain/tools.test.ts tests/brain/mcp-server/handler.test.ts
git commit -m "feat: las tools del brain no exponen skills a los asistentes"
```

---

### Task 6: Publicar, republicar y retirar

**Files:**
- Create: `lib/brain/core/skills/publish.ts`
- Modify: `lib/brain/core/editor/delete.ts` (mensaje cuando la skill está publicada)
- Test: `tests/brain/skills-publish.test.ts`; se agrega un caso a `tests/brain/editor-delete.test.ts`

**Interfaces:**
- Consumes: `SkillStore`, `SkillOverviewRow`, `SkillAct` (Task 3); `checkPublishable`, `PUBLISH_MESSAGES`, `isSkillSlug`, `skillName`, `SkillFile`, `PublishProblem`, `PublishWarning` (Task 2); `skillState`, `SkillState` (Task 4); `isAdminRole` de `core/access/types.ts`; `WikiStoreError`.
- Produces (de `lib/brain/core/skills/publish.ts`):

```ts
export interface SkillActor { tenantId: string; userId: string; role: BrainRole }
export interface PublishDeps {
	actor(tenantSlug: string): Promise<SkillActor | null>;
	binding(tenantId: string): Promise<{ provider: "wiki" | "mcp" } | null>;
	// La página sin envolver con permisos ni con withSkillView: el borrador real.
	page(tenantId: string, slug: string): Promise<BrainPage | null>;
	revisions(tenantId: string, slug: string): Promise<BrainRevision[]>;
	store: SkillStore;
}
export type SkillFailure = {
	ok: false;
	code: "not_found" | "forbidden" | "conflict" | "validation" | "unsupported" | "name_taken";
	message: string;
};
export interface PublishPreview {
	slug: string;
	name: string;
	title: string;
	revision: number;
	filesDigest: string;
	state: SkillState;
	problems: PublishProblem[];
	warnings: PublishWarning[];
	body: string;
	previousBody: string | null;
	description: string;
	previousDescription: string | null;
	files: { added: SkillFile[]; changed: SkillFile[]; removed: SkillFile[] };
	editorIds: string[];
}
export function previewPublish(tenantSlug: string, slug: string, deps: PublishDeps): Promise<{ ok: true; preview: PublishPreview } | SkillFailure>;
export function publishSkill(tenantSlug: string, slug: string, input: { expectedRevision: number; expectedFilesDigest: string; note: string }, deps: PublishDeps): Promise<{ ok: true; version: number } | SkillFailure>;
export function republishSkill(tenantSlug: string, slug: string, input: { fromVersion: number; note: string }, deps: PublishDeps): Promise<{ ok: true; version: number } | SkillFailure>;
export function withdrawSkill(tenantSlug: string, slug: string, input: { note: string }, deps: PublishDeps): Promise<{ ok: true; withdrawn: boolean } | SkillFailure>;
```

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/brain/skills-publish.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
	type PublishDeps,
	previewPublish,
	publishSkill,
	republishSkill,
	withdrawSkill,
} from "@/lib/brain/core/skills/publish";
import type {
	SkillAct,
	SkillOverviewRow,
	SkillStore,
} from "@/lib/brain/core/skills/store";
import type {
	BrainPage,
	BrainRevision,
	BrainRole,
} from "@/lib/brain/core/types";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

const SLUG = "skills/admin/facturacion";
const file = (path: string, sha: string, size = 10) => ({
	path,
	sha256: sha,
	size,
});

const draftPage: BrainPage = {
	slug: SLUG,
	title: "Facturación",
	category: "skill",
	status: "activo",
	tags: [],
	frontmatter: { description: "Usar para facturar." },
	body: "cuerpo nuevo",
	revision: 7,
	updatedAt: "2026-10-11T00:00:00Z",
};

const publishedAct: SkillAct = {
	id: 1,
	action: "publicar",
	version: 1,
	pageRevision: 5,
	title: "Facturación",
	description: "Usar para facturar (v1).",
	body: "cuerpo viejo",
	manifest: [file("scripts/calc.py", "a"), file("assets/viejo.png", "b")],
	digest: "dg1",
	note: "primera",
	republishedFrom: null,
	actorUserId: "admin1",
	createdAt: "2026-10-10T00:00:00Z",
};

const revision = (n: number, author: string | null): BrainRevision => ({
	revision: n,
	title: "Facturación",
	category: "skill",
	status: "activo",
	tags: [],
	frontmatter: {},
	body: "x",
	authorKind: "user",
	authorUserId: author,
	reason: "r",
	createdAt: "2026-10-11T00:00:00Z",
});

function setup(
	opts: {
		role?: BrainRole;
		provider?: "wiki" | "mcp";
		row?: SkillOverviewRow | null;
		page?: BrainPage | null;
		publishError?: unknown;
		acts?: SkillAct[];
	} = {},
) {
	const row: SkillOverviewRow | null =
		opts.row === undefined
			? {
					pageId: "p1",
					slug: SLUG,
					revision: 7,
					draftFilesDigest: "fd7",
					current: {
						action: "publicar",
						version: 1,
						pageRevision: 5,
						filesDigest: "fd5",
						title: "Facturación",
						description: "Usar para facturar (v1).",
						body: "cuerpo viejo",
						frontmatter: {},
						manifest: publishedAct.manifest,
						digest: "dg1",
						publishedAt: "2026-10-10T00:00:00Z",
					},
				}
			: opts.row;
	const publish = vi.fn(async () => {
		if (opts.publishError) throw opts.publishError;
		return { version: 2, digest: "dg2" };
	});
	const withdraw = vi.fn(async () => true);
	const store: SkillStore = {
		overview: async () => (row ? [row] : []),
		files: async () => [
			file("scripts/calc.py", "a2"),
			file("references/guia.md", "c"),
		],
		acts: async () => opts.acts ?? [publishedAct],
		putFile: vi.fn(),
		removeFile: vi.fn(),
		publish,
		withdraw,
	};
	const deps: PublishDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: "admin1",
			role: opts.role ?? "tenant_admin",
		}),
		binding: async () => ({ provider: opts.provider ?? "wiki" }),
		page: async () => (opts.page === undefined ? draftPage : opts.page),
		revisions: async () => [
			revision(7, "beto"),
			revision(6, "ana"),
			revision(5, "viejo"),
		],
		store,
	};
	return { deps, publish, withdraw };
}

describe("previewPublish", () => {
	it("compara el borrador con la última publicación", async () => {
		const { deps } = setup();
		const result = await previewPublish("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		const { preview } = result;
		expect(preview.name).toBe("facturacion");
		expect(preview.revision).toBe(7);
		expect(preview.filesDigest).toBe("fd7");
		expect(preview.state).toEqual({ kind: "publicada", version: 1, dirty: true });
		expect(preview.body).toBe("cuerpo nuevo");
		expect(preview.previousBody).toBe("cuerpo viejo");
		expect(preview.files.added.map((f) => f.path)).toEqual([
			"references/guia.md",
		]);
		expect(preview.files.changed.map((f) => f.path)).toEqual([
			"scripts/calc.py",
		]);
		expect(preview.files.removed.map((f) => f.path)).toEqual([
			"assets/viejo.png",
		]);
		// Solo quienes editaron después de la revisión publicada (5).
		expect(preview.editorIds.sort()).toEqual(["ana", "beto"]);
		expect(preview.problems).toEqual([]);
	});

	it("sin publicación previa todo es agregado", async () => {
		const { deps } = setup({
			acts: [],
			row: {
				pageId: "p1",
				slug: SLUG,
				revision: 7,
				draftFilesDigest: "fd7",
				current: null,
			},
		});
		const result = await previewPublish("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		expect(result.preview.previousBody).toBeNull();
		expect(result.preview.files.added).toHaveLength(2);
		expect(result.preview.state).toEqual({ kind: "sin_publicar" });
	});
});

describe("quién publica", () => {
	it("un miembro recibe forbidden aunque sea editor, exista o no la skill", async () => {
		for (const row of [undefined, null]) {
			const { deps, publish } = setup({ role: "tenant_member", row });
			const result = await publishSkill(
				"acme",
				SLUG,
				{ expectedRevision: 7, expectedFilesDigest: "fd7", note: "n" },
				deps,
			);
			expect(result).toMatchObject({ ok: false, code: "forbidden" });
			expect(publish).not.toHaveBeenCalled();
		}
	});

	it("un administrador publica con lo que revisó", async () => {
		const { deps, publish } = setup();
		const result = await publishSkill(
			"acme",
			SLUG,
			{ expectedRevision: 7, expectedFilesDigest: "fd7", note: "  ajuste  " },
			deps,
		);
		expect(result).toEqual({ ok: true, version: 2 });
		expect(publish).toHaveBeenCalledWith({
			tenantId: "t1",
			pageId: "p1",
			expectedRevision: 7,
			expectedFilesDigest: "fd7",
			note: "ajuste",
			actorUserId: "admin1",
			fromVersion: null,
		});
	});

	it("platform_admin también publica", async () => {
		const { deps } = setup({ role: "platform_admin" });
		expect(
			await publishSkill(
				"acme",
				SLUG,
				{ expectedRevision: 7, expectedFilesDigest: "fd7", note: "n" },
				deps,
			),
		).toMatchObject({ ok: true });
	});
});

describe("rechazos al publicar", () => {
	const input = { expectedRevision: 7, expectedFilesDigest: "fd7", note: "n" };

	it("sin nota", async () => {
		const { deps, publish } = setup();
		expect(
			await publishSkill("acme", SLUG, { ...input, note: "   " }, deps),
		).toMatchObject({ ok: false, code: "validation" });
		expect(publish).not.toHaveBeenCalled();
	});

	it("sin descripción no llega a la base", async () => {
		const { deps, publish } = setup({
			page: { ...draftPage, frontmatter: {} },
		});
		const result = await publishSkill("acme", SLUG, input, deps);
		expect(result).toMatchObject({ ok: false, code: "validation" });
		expect(result.ok === false && result.message).toMatch(/descripción/);
		expect(publish).not.toHaveBeenCalled();
	});

	it("el borrador cambió mientras revisaba: conflicto", async () => {
		const { deps } = setup({
			publishError: new WikiStoreError("BR409", "BRAIN_CONFLICT", "files"),
		});
		expect(await publishSkill("acme", SLUG, input, deps)).toMatchObject({
			ok: false,
			code: "conflict",
		});
	});

	it("otra skill vigente con el mismo nombre: el mensaje la nombra", async () => {
		const { deps } = setup({
			publishError: new WikiStoreError("BR409", "BRAIN_CONFLICT", "name"),
		});
		const result = await publishSkill("acme", SLUG, input, deps);
		expect(result).toMatchObject({ ok: false, code: "name_taken" });
		expect(result.ok === false && result.message).toContain("facturacion");
	});

	it("brain externo: unsupported; fuera de skills/: not_found", async () => {
		const { deps } = setup({ provider: "mcp" });
		expect(await publishSkill("acme", SLUG, input, deps)).toMatchObject({
			code: "unsupported",
		});
		expect(
			await publishSkill("acme", "comercial/icp", input, setup().deps),
		).toMatchObject({ code: "not_found" });
	});

	it("un error que no es de la base se propaga", async () => {
		const { deps } = setup({ publishError: new Error("caída") });
		await expect(publishSkill("acme", SLUG, input, deps)).rejects.toThrow(
			"caída",
		);
	});
});

describe("republicar y retirar", () => {
	it("republicar pasa la versión de origen y no exige revisión", async () => {
		const { deps, publish } = setup();
		expect(
			await republishSkill("acme", SLUG, { fromVersion: 1, note: "vuelvo" }, deps),
		).toEqual({ ok: true, version: 2 });
		expect(publish).toHaveBeenCalledWith({
			tenantId: "t1",
			pageId: "p1",
			expectedRevision: null,
			expectedFilesDigest: null,
			note: "vuelvo",
			actorUserId: "admin1",
			fromVersion: 1,
		});
	});

	it("retirar exige administrador y nota", async () => {
		const member = setup({ role: "tenant_member" });
		expect(
			await withdrawSkill("acme", SLUG, { note: "n" }, member.deps),
		).toMatchObject({ code: "forbidden" });
		const admin = setup();
		expect(
			await withdrawSkill("acme", SLUG, { note: "" }, admin.deps),
		).toMatchObject({ code: "validation" });
		expect(
			await withdrawSkill("acme", SLUG, { note: "salió mal" }, admin.deps),
		).toEqual({ ok: true, withdrawn: true });
		expect(admin.withdraw).toHaveBeenCalledWith({
			tenantId: "t1",
			pageId: "p1",
			note: "salió mal",
			actorUserId: "admin1",
		});
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/skills-publish.test.ts`
Expected: FAIL, no resuelve `@/lib/brain/core/skills/publish`.

- [ ] **Step 3: Escribir `publish.ts`**

Crear `lib/brain/core/skills/publish.ts`:

```ts
// Publicación de skills (spec etapa 24.1 §8). Sin Next ni Supabase: recibe sus
// dependencias, como deletePage. Publica solo un administrador de la empresa;
// el rol se mira antes que nada, así la respuesta a un miembro no depende de
// que la skill exista.
import { isAdminRole } from "../access/types.ts";
import type { BrainPage, BrainRevision, BrainRole } from "../types.ts";
import { WikiStoreError } from "../wiki-store.ts";
import {
	checkPublishable,
	isSkillSlug,
	PUBLISH_MESSAGES,
	type PublishProblem,
	type PublishWarning,
	type SkillFile,
	skillName,
} from "./package.ts";
import { type SkillState, skillState } from "./state.ts";
import type { SkillOverviewRow, SkillStore } from "./store.ts";

export interface SkillActor {
	tenantId: string;
	userId: string;
	role: BrainRole;
}

export interface PublishDeps {
	actor(tenantSlug: string): Promise<SkillActor | null>;
	binding(tenantId: string): Promise<{ provider: "wiki" | "mcp" } | null>;
	// La página sin envolver con permisos ni con withSkillView: el borrador real.
	page(tenantId: string, slug: string): Promise<BrainPage | null>;
	revisions(tenantId: string, slug: string): Promise<BrainRevision[]>;
	store: SkillStore;
}

export type SkillFailure = {
	ok: false;
	code:
		| "not_found"
		| "forbidden"
		| "conflict"
		| "validation"
		| "unsupported"
		| "name_taken";
	message: string;
};

export interface PublishPreview {
	slug: string;
	name: string;
	title: string;
	revision: number;
	filesDigest: string;
	state: SkillState;
	problems: PublishProblem[];
	warnings: PublishWarning[];
	body: string;
	previousBody: string | null;
	description: string;
	previousDescription: string | null;
	files: { added: SkillFile[]; changed: SkillFile[]; removed: SkillFile[] };
	editorIds: string[];
}

export const skillFail = (
	code: SkillFailure["code"],
	message: string,
): SkillFailure => ({ ok: false, code, message });

const NOT_FOUND = "No encontrado.";
const MAX_NOTE = 500;

type Authorized = { ok: true; actor: SkillActor; row: SkillOverviewRow };

async function authorize(
	tenantSlug: string,
	slug: string,
	deps: PublishDeps,
): Promise<Authorized | SkillFailure> {
	if (!isSkillSlug(slug)) return skillFail("not_found", NOT_FOUND);
	const actor = await deps.actor(tenantSlug);
	if (!actor) return skillFail("not_found", NOT_FOUND);
	if (!isAdminRole(actor.role)) {
		return skillFail(
			"forbidden",
			"Solo un administrador de la empresa publica o retira skills.",
		);
	}
	const binding = await deps.binding(actor.tenantId);
	if (!binding) return skillFail("not_found", NOT_FOUND);
	if (binding.provider !== "wiki") {
		return skillFail(
			"unsupported",
			"Este brain es externo: las skills se publican en su origen.",
		);
	}
	const row = (await deps.store.overview(actor.tenantId)).find(
		(item) => item.slug === slug,
	);
	if (!row) return skillFail("not_found", NOT_FOUND);
	return { ok: true, actor, row };
}

function cleanNote(note: string): string | null {
	const trimmed = note.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_NOTE ? trimmed : null;
}

const NOTE_REQUIRED = "Escribí una nota de hasta 500 caracteres.";

// Traduce los rechazos de las funciones SQL. Lo demás se propaga.
function storeFailure(error: unknown, slug: string): SkillFailure {
	if (!(error instanceof WikiStoreError)) throw error;
	if (error.code === "BR409") {
		return error.details === "name"
			? skillFail(
					"name_taken",
					`Ya hay otra skill publicada con el nombre «${skillName(slug)}». Retirá esa o usá otra ruta para esta.`,
				)
			: skillFail(
					"conflict",
					"El borrador cambió mientras revisabas. Volvé a abrir la revisión.",
				);
	}
	if (error.code === "BR422") {
		return skillFail("validation", `Datos inválidos en: ${error.details}.`);
	}
	if (error.code === "BR404") return skillFail("not_found", NOT_FOUND);
	throw error;
}

function compareFiles(previous: SkillFile[], current: SkillFile[]) {
	const before = new Map(previous.map((item) => [item.path, item]));
	const now = new Set(current.map((item) => item.path));
	return {
		added: current.filter((item) => !before.has(item.path)),
		changed: current.filter((item) => {
			const old = before.get(item.path);
			return old !== undefined && old.sha256 !== item.sha256;
		}),
		removed: previous.filter((item) => !now.has(item.path)),
	};
}

export async function previewPublish(
	tenantSlug: string,
	slug: string,
	deps: PublishDeps,
): Promise<{ ok: true; preview: PublishPreview } | SkillFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;
	const { actor, row } = auth;

	const page = await deps.page(actor.tenantId, slug);
	if (!page) return skillFail("not_found", NOT_FOUND);
	const [files, acts, revisions] = await Promise.all([
		deps.store.files(actor.tenantId, row.pageId),
		deps.store.acts(actor.tenantId, row.pageId),
		deps.revisions(actor.tenantId, slug),
	]);
	// La última publicación, aunque después se haya retirado.
	const previous = acts.find((act) => act.action === "publicar") ?? null;
	const check = checkPublishable({
		slug,
		frontmatter: page.frontmatter,
		body: page.body,
		files,
	});
	const since = previous?.pageRevision ?? 0;

	return {
		ok: true,
		preview: {
			slug,
			name: skillName(slug),
			title: page.title,
			revision: page.revision,
			filesDigest: row.draftFilesDigest,
			state: skillState(row),
			problems: check.problems,
			warnings: check.warnings,
			body: page.body,
			previousBody: previous?.body ?? null,
			description:
				typeof page.frontmatter.description === "string"
					? page.frontmatter.description
					: "",
			previousDescription: previous?.description ?? null,
			files: compareFiles(previous?.manifest ?? [], files),
			editorIds: [
				...new Set(
					revisions
						.filter((rev) => rev.revision > since && rev.authorUserId !== null)
						.map((rev) => rev.authorUserId as string),
				),
			],
		},
	};
}

export async function publishSkill(
	tenantSlug: string,
	slug: string,
	input: { expectedRevision: number; expectedFilesDigest: string; note: string },
	deps: PublishDeps,
): Promise<{ ok: true; version: number } | SkillFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;
	const { actor, row } = auth;
	const note = cleanNote(input.note);
	if (!note) return skillFail("validation", NOTE_REQUIRED);

	const page = await deps.page(actor.tenantId, slug);
	if (!page) return skillFail("not_found", NOT_FOUND);
	const files = await deps.store.files(actor.tenantId, row.pageId);
	const { problems } = checkPublishable({
		slug,
		frontmatter: page.frontmatter,
		body: page.body,
		files,
	});
	if (problems.length > 0) {
		return skillFail(
			"validation",
			problems.map((problem) => PUBLISH_MESSAGES[problem]).join(" "),
		);
	}

	try {
		const out = await deps.store.publish({
			tenantId: actor.tenantId,
			pageId: row.pageId,
			expectedRevision: input.expectedRevision,
			expectedFilesDigest: input.expectedFilesDigest,
			note,
			actorUserId: actor.userId,
			fromVersion: null,
		});
		return { ok: true, version: out.version };
	} catch (error) {
		return storeFailure(error, slug);
	}
}

export async function republishSkill(
	tenantSlug: string,
	slug: string,
	input: { fromVersion: number; note: string },
	deps: PublishDeps,
): Promise<{ ok: true; version: number } | SkillFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;
	const note = cleanNote(input.note);
	if (!note) return skillFail("validation", NOTE_REQUIRED);

	try {
		const out = await deps.store.publish({
			tenantId: auth.actor.tenantId,
			pageId: auth.row.pageId,
			expectedRevision: null,
			expectedFilesDigest: null,
			note,
			actorUserId: auth.actor.userId,
			fromVersion: input.fromVersion,
		});
		return { ok: true, version: out.version };
	} catch (error) {
		return storeFailure(error, slug);
	}
}

export async function withdrawSkill(
	tenantSlug: string,
	slug: string,
	input: { note: string },
	deps: PublishDeps,
): Promise<{ ok: true; withdrawn: boolean } | SkillFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;
	const note = cleanNote(input.note);
	if (!note) return skillFail("validation", NOTE_REQUIRED);

	try {
		const withdrawn = await deps.store.withdraw({
			tenantId: auth.actor.tenantId,
			pageId: auth.row.pageId,
			note,
			actorUserId: auth.actor.userId,
		});
		return { ok: true, withdrawn };
	} catch (error) {
		return storeFailure(error, slug);
	}
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/brain/skills-publish.test.ts`
Expected: PASS.

- [ ] **Step 5: Mensaje al borrar una skill publicada (test primero)**

En `tests/brain/editor-delete.test.ts`, dentro de `describe("deletePage", ...)`, agregar:

```ts
	it("una skill con versión vigente no se borra: pide retirarla", async () => {
		const { deps } = setup({
			deleterError: new WikiStoreError(
				"BR409",
				"BRAIN_CONFLICT",
				"skill_published",
			),
		});
		const result = await deletePage("acme", "suelta", 3, deps);
		expect(result).toMatchObject({ ok: false, code: "conflict" });
		expect(result.ok === false && result.message).toMatch(/Retirala/);
	});
```

Run: `npx vitest run tests/brain/editor-delete.test.ts`
Expected: FAIL (el mensaje es el genérico).

En `lib/brain/core/editor/delete.ts`, dentro del `catch` de `deletePage`, **antes** del `if (error.code === "BR409" || error.code === "40P01")`:

```ts
			if (error.code === "BR409" && error.details === "skill_published") {
				return fail(
					"conflict",
					"Esta skill está publicada. Retirala antes de borrarla.",
				);
			}
```

Run: `npx vitest run tests/brain/editor-delete.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/skills/publish.ts lib/brain/core/editor/delete.ts tests/brain/skills-publish.test.ts tests/brain/editor-delete.test.ts
npm run typecheck
git add lib/brain/core/skills/publish.ts lib/brain/core/editor/delete.ts tests/brain/skills-publish.test.ts tests/brain/editor-delete.test.ts
git commit -m "feat: publicar, republicar y retirar una skill"
```

---

### Task 7: Archivos e importación

**Files:**
- Create: `lib/brain/core/skills/files.ts`
- Test: `tests/brain/skills-files.test.ts`

**Interfaces:**
- Consumes: `SkillActor`, `SkillFailure`, `skillFail` (Task 6); `SkillStore` (Task 3); `publishedSnapshot` (Task 4); `isSkillSlug`, `isValidFilePath`, límites y `SkillFile` (Task 2); `resolveAccess` de `core/access/resolve-access.ts`; `AccessRulesStore`, `atLeast`, `isAdminRole`, `Level`, `Principal` de `core/access/types.ts`; errores de `core/errors.ts`; `yaml`.
- Produces (de `lib/brain/core/skills/files.ts`):

```ts
export interface BlobStore {
	put(tenantId: string, sha256: string, bytes: Uint8Array): Promise<void>;
	get(tenantId: string, sha256: string): Promise<Uint8Array | null>;
}
export interface FilesDeps {
	actor(tenantSlug: string): Promise<SkillActor | null>;
	binding(tenantId: string): Promise<{ provider: "wiki" | "mcp" } | null>;
	rules: AccessRulesStore;
	page(tenantId: string, slug: string): Promise<BrainPage | null>;
	// Guarda el borrador con los permisos de la persona (lanza errores Brain*).
	save(actor: SkillActor, write: BrainWrite): Promise<{ revision: number }>;
	store: SkillStore;
	blobs: BlobStore;
}
export interface PackageEntry { path: string; bytes: Uint8Array }
export interface ParsedSkillMd { description: string; compatibility: string; license: string; body: string }
export function sha256Hex(bytes: Uint8Array): string;
export function parseSkillMd(text: string): ParsedSkillMd | null;
export function planImport(entries: PackageEntry[]): { ok: true; skill: ParsedSkillMd; files: PackageEntry[] } | { ok: false; problems: string[] };
export function putSkillFile(tenantSlug: string, slug: string, input: PackageEntry, deps: FilesDeps): Promise<{ ok: true; filesDigest: string } | SkillFailure>;
export function removeSkillFile(tenantSlug: string, slug: string, path: string, deps: FilesDeps): Promise<{ ok: true; filesDigest: string } | SkillFailure>;
export function readSkillFile(tenantSlug: string, slug: string, input: { path: string; version?: number }, deps: FilesDeps): Promise<{ ok: true; path: string; bytes: Uint8Array } | SkillFailure>;
export function importSkillPackage(tenantSlug: string, slug: string, entries: PackageEntry[], deps: FilesDeps): Promise<{ ok: true; files: number; revision: number } | SkillFailure>;
```

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/brain/skills-files.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import { BrainConflict } from "@/lib/brain/core/errors";
import {
	type FilesDeps,
	importSkillPackage,
	parseSkillMd,
	planImport,
	putSkillFile,
	readSkillFile,
	removeSkillFile,
	sha256Hex,
} from "@/lib/brain/core/skills/files";
import { MAX_FILE_BYTES } from "@/lib/brain/core/skills/package";
import type {
	SkillAct,
	SkillOverviewRow,
} from "@/lib/brain/core/skills/store";
import type {
	BrainPage,
	BrainRole,
	BrainWrite,
} from "@/lib/brain/core/types";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

const SLUG = "skills/admin/facturacion";
const bytes = (text: string) => new TextEncoder().encode(text);
const SKILL_MD = `---
name: facturacion
description: Usar para emitir y validar facturas.
compatibility: Python 3
---

# Facturación

Pasos.
`;

const page: BrainPage = {
	slug: SLUG,
	title: "Facturación",
	category: "skill",
	status: "activo",
	tags: ["finanzas"],
	frontmatter: { description: "vieja", updated: "2026-10-01" },
	body: "viejo",
	revision: 4,
	updatedAt: "2026-10-11T00:00:00Z",
};

const published = [{ path: "scripts/calc.py", sha256: "pub", size: 3 }];
const draftFiles = [
	{ path: "scripts/calc.py", sha256: "draft", size: 3 },
	{ path: "references/nuevo.md", sha256: "solo-borrador", size: 3 },
];
const oldAct: SkillAct = {
	id: 1,
	action: "publicar",
	version: 1,
	pageRevision: 2,
	title: "F",
	description: "d",
	body: "b",
	manifest: [{ path: "scripts/viejo.py", sha256: "v1", size: 3 }],
	digest: "dg",
	note: "n",
	republishedFrom: null,
	actorUserId: null,
	createdAt: "2026-10-01T00:00:00Z",
};

const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});

function setup(
	opts: {
		role?: BrainRole;
		rules?: AccessRule[];
		current?: SkillOverviewRow["current"];
		putError?: unknown;
		saveError?: unknown;
	} = {},
) {
	const blobs = new Map<string, Uint8Array>([
		["t1/pub", bytes("publicado")],
		["t1/draft", bytes("borrador")],
		["t1/solo-borrador", bytes("nuevo")],
		["t1/v1", bytes("viejo")],
	]);
	const calls: string[] = [];
	const putFile = vi.fn(async (p: { path: string }) => {
		if (opts.putError) throw opts.putError;
		calls.push(`put:${p.path}`);
		return "digest-nuevo";
	});
	const removeFile = vi.fn(async (p: { path: string }) => {
		calls.push(`remove:${p.path}`);
		return "digest-nuevo";
	});
	const save = vi.fn(async (_actor: unknown, _write: BrainWrite) => {
		if (opts.saveError) throw opts.saveError;
		calls.push("save");
		return { revision: 5 };
	});
	const deps: FilesDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: "ana",
			role: opts.role ?? "tenant_member",
		}),
		binding: async () => ({ provider: "wiki" }),
		rules: { load: async () => opts.rules ?? [members("", "editor")] },
		page: async () => page,
		save,
		store: {
			overview: async () => [
				{
					pageId: "p1",
					slug: SLUG,
					revision: 4,
					draftFilesDigest: "fd",
					current:
						opts.current === undefined
							? {
									action: "publicar",
									version: 2,
									pageRevision: 3,
									filesDigest: "fdp",
									title: "F",
									description: "d",
									body: "b",
									frontmatter: {},
									manifest: published,
									digest: "dg",
									publishedAt: "2026-10-10T00:00:00Z",
								}
							: opts.current,
				},
			],
			files: async () => draftFiles,
			acts: async () => [oldAct],
			putFile,
			removeFile,
			publish: vi.fn(),
			withdraw: vi.fn(),
		},
		blobs: {
			put: vi.fn(async (tenantId, sha, data) => {
				blobs.set(`${tenantId}/${sha}`, data);
			}),
			get: async (tenantId, sha) => blobs.get(`${tenantId}/${sha}`) ?? null,
		},
	};
	return { deps, putFile, removeFile, save, calls, blobs };
}

const LECTOR = { rules: [members("", "lector")] };
const HIDDEN = { rules: [members("", "lector"), members("skills", "ninguno")] };

describe("parseSkillMd", () => {
	it("separa el encabezado del cuerpo", () => {
		expect(parseSkillMd(SKILL_MD)).toEqual({
			description: "Usar para emitir y validar facturas.",
			compatibility: "Python 3",
			license: "",
			body: "# Facturación\n\nPasos.\n",
		});
	});
	it("sin encabezado o con YAML roto devuelve null", () => {
		expect(parseSkillMd("# Solo texto")).toBeNull();
		expect(parseSkillMd("---\ndescription: [1, 2\n---\ncuerpo")).toBeNull();
		expect(parseSkillMd("---\n- lista\n---\ncuerpo")).toBeNull();
	});
});

describe("planImport", () => {
	it("acepta el paquete con o sin carpeta raíz", () => {
		const flat = planImport([
			{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
			{ path: "scripts/calc.py", bytes: bytes("print(1)") },
		]);
		const nested = planImport([
			{ path: "facturacion/SKILL.md", bytes: bytes(SKILL_MD) },
			{ path: "facturacion/scripts/calc.py", bytes: bytes("print(1)") },
		]);
		for (const plan of [flat, nested]) {
			if (!plan.ok) throw new Error(plan.problems.join(" "));
			expect(plan.files.map((f) => f.path)).toEqual(["scripts/calc.py"]);
			expect(plan.skill.description).toMatch(/facturas/);
		}
	});

	it("rechaza entero: sin SKILL.md, ruta inválida, archivo vacío o pesado", () => {
		expect(
			planImport([{ path: "scripts/calc.py", bytes: bytes("x") }]),
		).toMatchObject({ ok: false });
		const bad = planImport([
			{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
			{ path: "scripts/../../etc/passwd", bytes: bytes("x") },
			{ path: "vacio.txt", bytes: new Uint8Array() },
			{ path: "pesado.bin", bytes: new Uint8Array(MAX_FILE_BYTES + 1) },
		]);
		if (bad.ok) throw new Error("tenía que fallar");
		expect(bad.problems).toHaveLength(3);
		expect(bad.problems.join(" ")).toContain("scripts/../../etc/passwd");
	});

	it("rechaza un SKILL.md sin descripción y más de 50 archivos", () => {
		expect(
			planImport([{ path: "SKILL.md", bytes: bytes("---\nname: x\n---\nc") }]),
		).toMatchObject({ ok: false });
		const many = Array.from({ length: 51 }, (_, i) => ({
			path: `f${i}.txt`,
			bytes: bytes("x"),
		}));
		expect(
			planImport([{ path: "SKILL.md", bytes: bytes(SKILL_MD) }, ...many]),
		).toMatchObject({ ok: false });
	});
});

describe("putSkillFile", () => {
	it("un editor sube: primero el contenido, después la fila con el hash del servidor", async () => {
		const { deps, putFile, blobs } = setup();
		const data = bytes("print(1)");
		const result = await putSkillFile(
			"acme",
			SLUG,
			{ path: "scripts/nuevo.py", bytes: data },
			deps,
		);
		expect(result).toEqual({ ok: true, filesDigest: "digest-nuevo" });
		const sha = sha256Hex(data);
		expect(blobs.get(`t1/${sha}`)).toBe(data);
		expect(putFile).toHaveBeenCalledWith({
			tenantId: "t1",
			pageId: "p1",
			path: "scripts/nuevo.py",
			sha256: sha,
			size: data.length,
			actorUserId: "ana",
		});
	});

	it("un lector no sube; quien no ve la skill recibe not_found", async () => {
		const input = { path: "a.txt", bytes: bytes("x") };
		expect(
			await putSkillFile("acme", SLUG, input, setup(LECTOR).deps),
		).toMatchObject({ code: "forbidden" });
		expect(
			await putSkillFile("acme", SLUG, input, setup(HIDDEN).deps),
		).toMatchObject({ code: "not_found" });
	});

	it("ruta inválida, vacío o pesado: validación, sin tocar el bucket", async () => {
		const { deps } = setup();
		for (const input of [
			{ path: "../x", bytes: bytes("x") },
			{ path: "SKILL.md", bytes: bytes("x") },
			{ path: "a.txt", bytes: new Uint8Array() },
			{ path: "a.bin", bytes: new Uint8Array(MAX_FILE_BYTES + 1) },
		]) {
			expect(await putSkillFile("acme", SLUG, input, deps)).toMatchObject({
				code: "validation",
			});
		}
		expect(deps.blobs.put).not.toHaveBeenCalled();
	});

	it("el tope del paquete que impone la base sale como validación", async () => {
		const { deps } = setup({
			putError: new WikiStoreError("BR422", "BRAIN_VALIDATION", "package_limit"),
		});
		const result = await putSkillFile(
			"acme",
			SLUG,
			{ path: "a.txt", bytes: bytes("x") },
			deps,
		);
		expect(result).toMatchObject({ code: "validation" });
		expect(result.ok === false && result.message).toMatch(/50 archivos/);
	});
});

describe("removeSkillFile", () => {
	it("un editor quita; un lector no", async () => {
		const editor = setup();
		expect(
			await removeSkillFile("acme", SLUG, "scripts/calc.py", editor.deps),
		).toEqual({ ok: true, filesDigest: "digest-nuevo" });
		expect(
			await removeSkillFile("acme", SLUG, "scripts/calc.py", setup(LECTOR).deps),
		).toMatchObject({ code: "forbidden" });
	});
});

describe("readSkillFile", () => {
	const text = (result: Awaited<ReturnType<typeof readSkillFile>>) =>
		result.ok ? new TextDecoder().decode(result.bytes) : result.code;

	it("un editor lee el borrador y cualquier versión", async () => {
		const { deps } = setup();
		expect(
			text(await readSkillFile("acme", SLUG, { path: "scripts/calc.py" }, deps)),
		).toBe("borrador");
		expect(
			text(
				await readSkillFile(
					"acme",
					SLUG,
					{ path: "scripts/viejo.py", version: 1 },
					deps,
				),
			),
		).toBe("viejo");
	});

	it("un lector lee solo lo que está en la versión vigente", async () => {
		const { deps } = setup(LECTOR);
		expect(
			text(await readSkillFile("acme", SLUG, { path: "scripts/calc.py" }, deps)),
		).toBe("publicado");
	});

	it("un lector no llega a un archivo del borrador ni a una versión anterior", async () => {
		const { deps } = setup(LECTOR);
		expect(
			text(
				await readSkillFile("acme", SLUG, { path: "references/nuevo.md" }, deps),
			),
		).toBe("not_found");
		expect(
			text(
				await readSkillFile(
					"acme",
					SLUG,
					{ path: "scripts/viejo.py", version: 1 },
					deps,
				),
			),
		).toBe("not_found");
	});

	it("para un lector, una skill retirada o sin publicar no tiene archivos", async () => {
		for (const current of [null, { ...setupCurrent(), action: "retirar" as const }]) {
			const { deps } = setup({ ...LECTOR, current });
			expect(
				text(
					await readSkillFile("acme", SLUG, { path: "scripts/calc.py" }, deps),
				),
			).toBe("not_found");
		}
	});

	it("quien no ve la skill recibe not_found", async () => {
		expect(
			text(
				await readSkillFile(
					"acme",
					SLUG,
					{ path: "scripts/calc.py" },
					setup(HIDDEN).deps,
				),
			),
		).toBe("not_found");
	});
});

function setupCurrent(): NonNullable<SkillOverviewRow["current"]> {
	return {
		action: "publicar",
		version: 2,
		pageRevision: 3,
		filesDigest: "fdp",
		title: "F",
		description: "d",
		body: "b",
		frontmatter: {},
		manifest: published,
		digest: "dg",
		publishedAt: "2026-10-10T00:00:00Z",
	};
}

describe("importSkillPackage", () => {
	const entries = [
		{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
		{ path: "scripts/calc.py", bytes: bytes("print(2)") },
	];

	it("guarda el borrador, quita lo que el paquete no trae y carga lo nuevo", async () => {
		const { deps, save, calls } = setup();
		const result = await importSkillPackage("acme", SLUG, entries, deps);
		expect(result).toEqual({ ok: true, files: 1, revision: 5 });
		expect(save.mock.calls[0][1]).toMatchObject({
			slug: SLUG,
			title: "Facturación",
			category: "skill",
			tags: ["finanzas"],
			body: "# Facturación\n\nPasos.\n",
			reason: "Importación de paquete",
			baseRevision: 4,
			frontmatter: {
				description: "Usar para emitir y validar facturas.",
				compatibility: "Python 3",
				updated: "2026-10-01",
			},
		});
		// Primero se quita lo viejo: así el tope de 50 no salta a mitad de camino.
		expect(calls).toEqual([
			"save",
			"remove:references/nuevo.md",
			"put:scripts/calc.py",
		]);
	});

	it("un paquete inválido no cambia nada", async () => {
		const { deps, save, putFile } = setup();
		const result = await importSkillPackage(
			"acme",
			SLUG,
			[{ path: "scripts/calc.py", bytes: bytes("x") }],
			deps,
		);
		expect(result).toMatchObject({ code: "validation" });
		expect(save).not.toHaveBeenCalled();
		expect(putFile).not.toHaveBeenCalled();
		expect(deps.blobs.put).not.toHaveBeenCalled();
	});

	it("un lector no importa; si alguien guardó en el medio, conflicto", async () => {
		expect(
			await importSkillPackage("acme", SLUG, entries, setup(LECTOR).deps),
		).toMatchObject({ code: "forbidden" });
		const { deps, putFile } = setup({ saveError: new BrainConflict(SLUG, 5) });
		expect(
			await importSkillPackage("acme", SLUG, entries, deps),
		).toMatchObject({ code: "conflict" });
		expect(putFile).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run tests/brain/skills-files.test.ts`
Expected: FAIL, no resuelve `@/lib/brain/core/skills/files`.

- [ ] **Step 3: Escribir `files.ts`**

Crear `lib/brain/core/skills/files.ts`:

```ts
// Archivos de una skill (spec etapa 24.1 §6 y §7). Sin Next ni Supabase:
// recibe sus dependencias. Sube y quita quien es editor de la página; lee el
// borrador quien es editor, y quien solo lee llega a lo que figura en la
// versión vigente. El hash lo calcula siempre el servidor.
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRulesStore,
	atLeast,
	isAdminRole,
	type Level,
	type Principal,
} from "../access/types.ts";
import {
	BrainConflict,
	BrainForbidden,
	BrainNotFound,
	BrainValidation,
} from "../errors.ts";
import type { BrainPage, BrainWrite } from "../types.ts";
import { WikiStoreError } from "../wiki-store.ts";
import {
	isSkillSlug,
	isValidFilePath,
	MAX_DESCRIPTION,
	MAX_FILE_BYTES,
	MAX_PACKAGE_BYTES,
	MAX_PACKAGE_FILES,
	type SkillFile,
} from "./package.ts";
import { type SkillActor, type SkillFailure, skillFail } from "./publish.ts";
import { publishedSnapshot } from "./state.ts";
import type { SkillOverviewRow, SkillStore } from "./store.ts";

export interface BlobStore {
	put(tenantId: string, sha256: string, bytes: Uint8Array): Promise<void>;
	get(tenantId: string, sha256: string): Promise<Uint8Array | null>;
}

export interface FilesDeps {
	actor(tenantSlug: string): Promise<SkillActor | null>;
	binding(tenantId: string): Promise<{ provider: "wiki" | "mcp" } | null>;
	rules: AccessRulesStore;
	page(tenantId: string, slug: string): Promise<BrainPage | null>;
	// Guarda el borrador con los permisos de la persona (lanza errores Brain*).
	save(actor: SkillActor, write: BrainWrite): Promise<{ revision: number }>;
	store: SkillStore;
	blobs: BlobStore;
}

export interface PackageEntry {
	path: string;
	bytes: Uint8Array;
}

export interface ParsedSkillMd {
	description: string;
	compatibility: string;
	license: string;
	body: string;
}

const NOT_FOUND = "No encontrado.";
const IMPORT_REASON = "Importación de paquete";

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMd(text: string): ParsedSkillMd | null {
	const match = FRONTMATTER.exec(text);
	if (!match) return null;
	let data: unknown;
	try {
		data = parseYaml(match[1]);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null || Array.isArray(data))
		return null;
	const fields = data as Record<string, unknown>;
	const str = (value: unknown) =>
		typeof value === "string" ? value.trim() : "";
	return {
		description: str(fields.description),
		compatibility: str(fields.compatibility),
		license: str(fields.license),
		body: match[2].replace(/^\r?\n/, ""),
	};
}

// Un zip suele traer el paquete adentro de una carpeta con su nombre.
function stripRoot(entries: PackageEntry[]): PackageEntry[] {
	if (entries.some((entry) => entry.path === "SKILL.md")) return entries;
	const roots = new Set(entries.map((entry) => entry.path.split("/")[0]));
	if (roots.size !== 1 || entries.some((entry) => !entry.path.includes("/")))
		return entries;
	const prefix = `${[...roots][0]}/`;
	return entries.map((entry) => ({
		...entry,
		path: entry.path.slice(prefix.length),
	}));
}

export function planImport(
	raw: PackageEntry[],
):
	| { ok: true; skill: ParsedSkillMd; files: PackageEntry[] }
	| { ok: false; problems: string[] } {
	const entries = stripRoot(raw);
	const problems: string[] = [];

	const skillMd = entries.find((entry) => entry.path === "SKILL.md");
	const files = entries.filter((entry) => entry.path !== "SKILL.md");
	let skill: ParsedSkillMd | null = null;
	if (!skillMd) {
		problems.push("Falta SKILL.md en la raíz del paquete.");
	} else {
		skill = parseSkillMd(new TextDecoder().decode(skillMd.bytes));
		if (!skill) {
			problems.push("SKILL.md no tiene un encabezado YAML válido.");
		} else if (skill.description.length === 0) {
			problems.push("SKILL.md no trae description.");
		} else if (skill.description.length > MAX_DESCRIPTION) {
			problems.push("La description de SKILL.md supera los 1024 caracteres.");
		}
	}

	const seen = new Set<string>();
	let total = 0;
	for (const entry of files) {
		total += entry.bytes.length;
		if (!isValidFilePath(entry.path)) {
			problems.push(`Ruta inválida: ${entry.path}`);
		} else if (seen.has(entry.path)) {
			problems.push(`Ruta repetida: ${entry.path}`);
		} else if (entry.bytes.length === 0) {
			problems.push(`Archivo vacío: ${entry.path}`);
		} else if (entry.bytes.length > MAX_FILE_BYTES) {
			problems.push(`Supera los 4 MB: ${entry.path}`);
		}
		seen.add(entry.path);
	}
	if (files.length > MAX_PACKAGE_FILES)
		problems.push("El paquete tiene más de 50 archivos.");
	if (total > MAX_PACKAGE_BYTES) problems.push("El paquete pesa más de 20 MB.");

	if (problems.length > 0 || !skill) return { ok: false, problems };
	return { ok: true, skill, files };
}

type Context = {
	ok: true;
	actor: SkillActor;
	level: Level;
	row: SkillOverviewRow;
};

// Quién es, qué nivel tiene sobre la skill y cuál es su fila. Lo que no ve
// responde not_found, igual que lo que no existe.
async function context(
	tenantSlug: string,
	slug: string,
	deps: FilesDeps,
): Promise<Context | SkillFailure> {
	if (!isSkillSlug(slug)) return skillFail("not_found", NOT_FOUND);
	const actor = await deps.actor(tenantSlug);
	if (!actor) return skillFail("not_found", NOT_FOUND);
	const binding = await deps.binding(actor.tenantId);
	if (!binding) return skillFail("not_found", NOT_FOUND);
	if (binding.provider !== "wiki") {
		return skillFail(
			"unsupported",
			"Este brain es externo: las skills se arman en su origen.",
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
	if (level === null) return skillFail("not_found", NOT_FOUND);
	const row = (await deps.store.overview(actor.tenantId)).find(
		(item) => item.slug === slug,
	);
	if (!row) return skillFail("not_found", NOT_FOUND);
	return { ok: true, actor, level, row };
}

const ONLY_EDITORS = "Necesitás ser editor de esta skill para cambiar sus archivos.";

function fileProblem(entry: PackageEntry): string | null {
	if (!isValidFilePath(entry.path))
		return "Ruta inválida. Usá letras, números, guiones y puntos, sin espacios ni «..», hasta seis niveles.";
	if (entry.bytes.length === 0) return "El archivo está vacío.";
	if (entry.bytes.length > MAX_FILE_BYTES) return "El archivo supera los 4 MB.";
	return null;
}

function storeFailure(error: unknown): SkillFailure {
	if (!(error instanceof WikiStoreError)) throw error;
	if (error.code === "BR422" && error.details === "package_limit") {
		return skillFail(
			"validation",
			"El paquete no puede pasar de 50 archivos ni de 20 MB.",
		);
	}
	if (error.code === "BR422" || error.code === "23514") {
		return skillFail("validation", "Archivo o ruta inválidos.");
	}
	if (error.code === "BR404") return skillFail("not_found", NOT_FOUND);
	throw error;
}

export async function putSkillFile(
	tenantSlug: string,
	slug: string,
	input: PackageEntry,
	deps: FilesDeps,
): Promise<{ ok: true; filesDigest: string } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	if (!atLeast(ctx.level, "editor")) return skillFail("forbidden", ONLY_EDITORS);
	const problem = fileProblem(input);
	if (problem) return skillFail("validation", problem);

	const sha256 = sha256Hex(input.bytes);
	// Primero el contenido: una fila nunca apunta a algo que no está guardado.
	await deps.blobs.put(ctx.actor.tenantId, sha256, input.bytes);
	try {
		const filesDigest = await deps.store.putFile({
			tenantId: ctx.actor.tenantId,
			pageId: ctx.row.pageId,
			path: input.path,
			sha256,
			size: input.bytes.length,
			actorUserId: ctx.actor.userId,
		});
		return { ok: true, filesDigest };
	} catch (error) {
		return storeFailure(error);
	}
}

export async function removeSkillFile(
	tenantSlug: string,
	slug: string,
	path: string,
	deps: FilesDeps,
): Promise<{ ok: true; filesDigest: string } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	if (!atLeast(ctx.level, "editor")) return skillFail("forbidden", ONLY_EDITORS);
	try {
		const filesDigest = await deps.store.removeFile({
			tenantId: ctx.actor.tenantId,
			pageId: ctx.row.pageId,
			path,
			actorUserId: ctx.actor.userId,
		});
		return { ok: true, filesDigest };
	} catch (error) {
		return storeFailure(error);
	}
}

export async function readSkillFile(
	tenantSlug: string,
	slug: string,
	input: { path: string; version?: number },
	deps: FilesDeps,
): Promise<{ ok: true; path: string; bytes: Uint8Array } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	const { actor, row } = ctx;

	let manifest: SkillFile[];
	if (atLeast(ctx.level, "editor")) {
		manifest =
			input.version === undefined
				? await deps.store.files(actor.tenantId, row.pageId)
				: ((await deps.store.acts(actor.tenantId, row.pageId)).find(
						(act) =>
							act.action === "publicar" && act.version === input.version,
					)?.manifest ?? []);
	} else {
		// Un lector llega solo a la versión vigente: ni borrador ni anteriores.
		manifest =
			input.version === undefined
				? (publishedSnapshot(row)?.manifest ?? [])
				: [];
	}

	const file = manifest.find((item) => item.path === input.path);
	if (!file) return skillFail("not_found", NOT_FOUND);
	const bytes = await deps.blobs.get(actor.tenantId, file.sha256);
	if (!bytes) return skillFail("not_found", NOT_FOUND);
	return { ok: true, path: file.path, bytes };
}

export async function importSkillPackage(
	tenantSlug: string,
	slug: string,
	entries: PackageEntry[],
	deps: FilesDeps,
): Promise<{ ok: true; files: number; revision: number } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	if (!atLeast(ctx.level, "editor")) return skillFail("forbidden", ONLY_EDITORS);
	const { actor, row } = ctx;

	// Todo se valida antes de escribir: un paquete inválido no cambia nada.
	const plan = planImport(entries);
	if (!plan.ok) return skillFail("validation", plan.problems.join(" "));

	const page = await deps.page(actor.tenantId, slug);
	if (!page) return skillFail("not_found", NOT_FOUND);

	const frontmatter: Record<string, unknown> = {
		...page.frontmatter,
		description: plan.skill.description,
	};
	for (const key of ["compatibility", "license"] as const) {
		if (plan.skill[key]) frontmatter[key] = plan.skill[key];
		else delete frontmatter[key];
	}

	let revision: number;
	try {
		revision = (
			await deps.save(actor, {
				slug,
				title: page.title,
				category: page.category,
				status: page.status,
				tags: page.tags,
				frontmatter,
				body: plan.skill.body,
				reason: IMPORT_REASON,
				baseRevision: page.revision,
			})
		).revision;
	} catch (error) {
		if (error instanceof BrainConflict) {
			return skillFail(
				"conflict",
				"Alguien guardó el borrador mientras importabas. Recargá y probá de nuevo.",
			);
		}
		if (error instanceof BrainForbidden || error instanceof BrainNotFound)
			return skillFail("forbidden", ONLY_EDITORS);
		if (error instanceof BrainValidation)
			return skillFail("validation", error.message);
		throw error;
	}

	try {
		const incoming = new Set(plan.files.map((file) => file.path));
		const existing = await deps.store.files(actor.tenantId, row.pageId);
		// Primero se quita lo que el paquete no trae: así el tope de 50 archivos
		// no salta a mitad de camino.
		for (const file of existing) {
			if (incoming.has(file.path)) continue;
			await deps.store.removeFile({
				tenantId: actor.tenantId,
				pageId: row.pageId,
				path: file.path,
				actorUserId: actor.userId,
			});
		}
		for (const file of plan.files) {
			const sha256 = sha256Hex(file.bytes);
			await deps.blobs.put(actor.tenantId, sha256, file.bytes);
			await deps.store.putFile({
				tenantId: actor.tenantId,
				pageId: row.pageId,
				path: file.path,
				sha256,
				size: file.bytes.length,
				actorUserId: actor.userId,
			});
		}
	} catch (error) {
		return storeFailure(error);
	}

	return { ok: true, files: plan.files.length, revision };
}
```

Nota para quien implementa: la importación no es una transacción. Si falla después de guardar el texto, el borrador queda a medio importar; es un borrador, nunca se publicó nada, y volver a importar lo deja completo. No intentar deshacer.

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/brain/skills-files.test.ts tests/brain/boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck y commit**

```bash
npx biome check --write lib/brain/core/skills/files.ts tests/brain/skills-files.test.ts
npm run typecheck
git add lib/brain/core/skills/files.ts tests/brain/skills-files.test.ts
git commit -m "feat: archivos de una skill e importacion de paquetes"
```

---

### Task 8: Conexión con la plataforma: zip, Storage, subida y acciones

**Files:**
- Create: `lib/brain/core/skills/http.ts`
- Create: `lib/brain/adapters/skill-zip.ts`
- Create: `lib/brain/adapters/skills.ts`
- Create: `app/[tenant]/brain/skills/files/route.ts`
- Create: `app/[tenant]/brain/skill-actions.ts`
- Modify: `lib/brain/adapters/editor.ts`
- Modify: `lib/brain/core/access/tree.ts`
- Modify: `package.json`, `package-lock.json` (dependencia `fflate`)
- Test: `tests/brain/skills-http.test.ts`, `tests/brain/skills-zip.test.ts`; se agrega un caso a `tests/brain/access-tree.test.ts`

**Interfaces:**
- Consumes: todo lo de las Tasks 2 a 7; `createAdminClient` de `@/lib/supabase/admin`; `resolveTenantAccess` de `@/lib/tenants/resolve`; `loadTenantBindings` de `@/lib/connectors/bindings`; `resolveBrainBinding`; `getBrainProvider`; `resolveActingProvider`; `accessRulesStore`.
- Produces:
  - `lib/brain/core/skills/http.ts`: `isSameOrigin(origin: string | null, host: string | null): boolean`, `fileHeaders(path: string, bytes: Uint8Array): Record<string, string>`, `skillFileHref(tenantSlug: string, slug: string, path: string, version?: number): string`.
  - `lib/brain/adapters/skill-zip.ts`: `class ZipRejected extends Error`, `unzipPackage(zip: Uint8Array): PackageEntry[]`.
  - `lib/brain/adapters/skills.ts`: `skillStore(): SkillStore`, `blobStore(): BlobStore`, `publishDeps(): PublishDeps`, `filesDeps(): FilesDeps`.
  - `lib/brain/adapters/editor.ts`: el contexto `ok` suma `skills: () => Promise<SkillOverviewRow[]>`; `provider` queda envuelto con `withSkillView`.
  - `lib/brain/core/access/tree.ts`: `TreePage` suma `pending?: boolean`.
  - Server actions (`app/[tenant]/brain/skill-actions.ts`): `getPublishPreview(raw)`, `publishSkillAction(raw)`, `republishSkillAction(raw)`, `withdrawSkillAction(raw)`, `removeSkillFileAction(raw)`.
  - HTTP: `POST /<tenant>/brain/skills/files` (multipart: `slug`, `file`, y `path` o `kind=zip`) y `GET /<tenant>/brain/skills/files?slug=&path=&version=`.

- [ ] **Step 1: Tests de los ayudantes HTTP (fallan)**

Crear `tests/brain/skills-http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	fileHeaders,
	isSameOrigin,
	skillFileHref,
} from "@/lib/brain/core/skills/http";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("isSameOrigin", () => {
	it("acepta solo un origin cuyo host es el del pedido", () => {
		expect(isSameOrigin("https://agentes.innov.as", "agentes.innov.as")).toBe(
			true,
		);
		expect(isSameOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
	});
	it("rechaza otro sitio, la falta de origin y un origin que no es URL", () => {
		expect(isSameOrigin("https://malo.example", "agentes.innov.as")).toBe(false);
		expect(isSameOrigin(null, "agentes.innov.as")).toBe(false);
		expect(isSameOrigin("null", "agentes.innov.as")).toBe(false);
		expect(isSameOrigin("https://agentes.innov.as", null)).toBe(false);
	});
});

describe("fileHeaders", () => {
	it("un texto se sirve como texto plano, nunca como html ni svg", () => {
		for (const path of ["x.html", "logo.svg", "scripts/calc.py"]) {
			const headers = fileHeaders(path, bytes("<script>alert(1)</script>"));
			expect(headers["content-type"]).toBe("text/plain; charset=utf-8");
			expect(headers["x-content-type-options"]).toBe("nosniff");
			expect(headers["content-security-policy"]).toContain("sandbox");
		}
	});
	it("un binario se descarga con su nombre", () => {
		const headers = fileHeaders(
			"assets/logo.png",
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
		);
		expect(headers["content-type"]).toBe("application/octet-stream");
		expect(headers["content-disposition"]).toBe(
			'attachment; filename="logo.png"',
		);
		expect(headers["x-content-type-options"]).toBe("nosniff");
	});
});

describe("skillFileHref", () => {
	it("arma el link con la ruta codificada y la versión opcional", () => {
		expect(skillFileHref("acme", "skills/a", "scripts/calc.py")).toBe(
			"/acme/brain/skills/files?slug=skills%2Fa&path=scripts%2Fcalc.py",
		);
		expect(skillFileHref("acme", "skills/a", "a.txt", 3)).toBe(
			"/acme/brain/skills/files?slug=skills%2Fa&path=a.txt&version=3",
		);
	});
});
```

Run: `npx vitest run tests/brain/skills-http.test.ts`
Expected: FAIL, no resuelve `http`.

- [ ] **Step 2: Escribir `http.ts`**

Crear `lib/brain/core/skills/http.ts`:

```ts
// Ayudantes puros del endpoint de archivos (spec etapa 24.1 §6). Un route
// handler no tiene el chequeo de origen de las server actions, y un archivo
// subido por una persona nunca se sirve con un tipo que el navegador ejecute.

export function isSameOrigin(
	origin: string | null,
	host: string | null,
): boolean {
	if (!origin || !host) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

function looksLikeText(bytes: Uint8Array): boolean {
	if (bytes.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

export function fileHeaders(
	path: string,
	bytes: Uint8Array,
): Record<string, string> {
	const base = {
		"x-content-type-options": "nosniff",
		"cache-control": "no-store",
		"content-security-policy": "default-src 'none'; sandbox",
	};
	if (looksLikeText(bytes)) {
		return { ...base, "content-type": "text/plain; charset=utf-8" };
	}
	// El nombre sale de una ruta ya validada: sin comillas ni saltos de línea.
	const name = path.slice(path.lastIndexOf("/") + 1);
	return {
		...base,
		"content-type": "application/octet-stream",
		"content-disposition": `attachment; filename="${name}"`,
	};
}

export function skillFileHref(
	tenantSlug: string,
	slug: string,
	path: string,
	version?: number,
): string {
	const query = new URLSearchParams({ slug, path });
	if (version !== undefined) query.set("version", String(version));
	return `/${tenantSlug}/brain/skills/files?${query}`;
}
```

Run: `npx vitest run tests/brain/skills-http.test.ts tests/brain/boundary.test.ts`
Expected: PASS.

- [ ] **Step 3: Instalar `fflate` y escribir el test del zip (falla)**

Run: `npm install fflate`

Abrir `node_modules/fflate/lib/index.d.ts` y confirmar que existen `unzipSync(data, opts?)`, `zipSync(data)`, `UnzipOptions.filter` y que `UnzipFileInfo` trae `name` y `originalSize`. Si algún nombre difiere, usar el de la versión instalada en el Step 4 y dejarlo anotado en el commit.

Crear `tests/brain/skills-zip.test.ts`:

```ts
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { unzipPackage, ZipRejected } from "@/lib/brain/adapters/skill-zip";
import { MAX_FILE_BYTES } from "@/lib/brain/core/skills/package";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("unzipPackage", () => {
	it("devuelve los archivos y descarta carpetas y basura de macOS", () => {
		const zip = zipSync({
			"facturacion/SKILL.md": bytes("---\ndescription: x\n---\ncuerpo"),
			"facturacion/scripts/calc.py": bytes("print(1)"),
			"__MACOSX/facturacion/._SKILL.md": bytes("x"),
			"facturacion/.DS_Store": bytes("x"),
		});
		expect(
			unzipPackage(zip)
				.map((entry) => entry.path)
				.sort(),
		).toEqual(["facturacion/SKILL.md", "facturacion/scripts/calc.py"]);
	});

	it("rechaza por tamaño declarado antes de descomprimir", () => {
		// Ceros: comprime a pocos KB y se infla a más del tope por archivo.
		const zip = zipSync({ "grande.bin": new Uint8Array(MAX_FILE_BYTES + 1) });
		expect(zip.length).toBeLessThan(100_000);
		expect(() => unzipPackage(zip)).toThrow(ZipRejected);
	});

	it("rechaza un paquete con más archivos de los que admite", () => {
		const many = Object.fromEntries(
			Array.from({ length: 60 }, (_, i) => [`f${i}.txt`, bytes("x")]),
		);
		expect(() => unzipPackage(zipSync(many))).toThrow(ZipRejected);
	});

	it("rechaza lo que no es un zip", () => {
		expect(() => unzipPackage(bytes("no soy un zip"))).toThrow(ZipRejected);
	});
});
```

Run: `npx vitest run tests/brain/skills-zip.test.ts`
Expected: FAIL, no resuelve `skill-zip`.

- [ ] **Step 4: Escribir `skill-zip.ts`**

Crear `lib/brain/adapters/skill-zip.ts`:

```ts
// Lectura del zip de un paquete (spec etapa 24.1 §6). Vive en adapters porque
// core no puede importar fflate. Sin otros imports de la plataforma: se prueba
// solo. Los topes se miran en el tamaño que declara cada entrada, antes de
// descomprimirla, y otra vez sobre lo que salió.
import { unzipSync } from "fflate";
import type { PackageEntry } from "../core/skills/files";
import {
	MAX_FILE_BYTES,
	MAX_PACKAGE_BYTES,
	MAX_PACKAGE_FILES,
} from "../core/skills/package";

export class ZipRejected extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZipRejected";
	}
}

const TOO_BIG =
	"El paquete supera los límites: 50 archivos, 4 MB por archivo y 20 MB en total.";

function isNoise(name: string): boolean {
	return (
		name.endsWith("/") ||
		name.startsWith("__MACOSX/") ||
		name.split("/").pop() === ".DS_Store"
	);
}

export function unzipPackage(zip: Uint8Array): PackageEntry[] {
	let count = 0;
	let declared = 0;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(zip, {
			filter(file) {
				if (isNoise(file.name)) return false;
				count += 1;
				declared += file.originalSize;
				// +1 archivo: SKILL.md no cuenta para el tope del paquete.
				if (
					count > MAX_PACKAGE_FILES + 1 ||
					file.originalSize > MAX_FILE_BYTES ||
					declared > MAX_PACKAGE_BYTES + MAX_FILE_BYTES
				) {
					throw new ZipRejected(TOO_BIG);
				}
				return true;
			},
		});
	} catch (error) {
		if (error instanceof ZipRejected) throw error;
		throw new ZipRejected("El archivo no es un zip válido.");
	}

	const entries = Object.entries(files).map(([path, bytes]) => ({
		path,
		bytes,
	}));
	// Un encabezado puede mentir sobre el tamaño: se vuelve a mirar lo que salió.
	if (entries.some((entry) => entry.bytes.length > MAX_FILE_BYTES)) {
		throw new ZipRejected(TOO_BIG);
	}
	return entries;
}
```

Run: `npx vitest run tests/brain/skills-zip.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir `adapters/skills.ts`**

Crear `lib/brain/adapters/skills.ts`:

```ts
// Cablea las skills con la plataforma (spec etapa 24.1 §9): sesión, binding,
// reglas, cliente admin y Storage. Los permisos los deciden core/skills/
// publish.ts y files.ts.
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { BrainNotFound } from "../core/errors";
import { resolveBrainBinding } from "../core/resolve";
import type { BlobStore, FilesDeps } from "../core/skills/files";
import type { PublishDeps } from "../core/skills/publish";
import { createSupabaseSkillStore, type SkillStore } from "../core/skills/store";
import { accessRulesStore } from "./access-rules";
import { resolveActingProvider } from "./acting-provider";
import { getBrainProvider } from "./provider";

const BUCKET = "skills";

export function skillStore(): SkillStore {
	return createSupabaseSkillStore(createAdminClient());
}

export function blobStore(): BlobStore {
	const bucket = () => createAdminClient().storage.from(BUCKET);
	return {
		async put(tenantId, sha256, bytes) {
			// El objeto se llama como su contenido: subirlo dos veces es inocuo.
			const { error } = await bucket().upload(`${tenantId}/${sha256}`, bytes, {
				contentType: "application/octet-stream",
				upsert: true,
			});
			if (error) {
				throw new Error(`skills: no pude guardar el archivo: ${error.message}`);
			}
		},
		async get(tenantId, sha256) {
			const { data, error } = await bucket().download(`${tenantId}/${sha256}`);
			if (error || !data) {
				console.error(
					`skills: no pude leer ${tenantId}/${sha256}: ${error?.message ?? "sin datos"}`,
				);
				return null;
			}
			return new Uint8Array(await data.arrayBuffer());
		},
	};
}

async function wikiBinding(tenantId: string) {
	const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
	return binding && binding.provider === "wiki" ? binding : null;
}

function shared() {
	return {
		async actor(tenantSlug: string) {
			const tenant = await resolveTenantAccess(tenantSlug);
			return tenant
				? { tenantId: tenant.id, userId: tenant.userId, role: tenant.role }
				: null;
		},
		async binding(tenantId: string) {
			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			return binding ? { provider: binding.provider } : null;
		},
		// El borrador real: proveedor sin envolver con permisos ni con la vista
		// de skills. El permiso ya lo decidió quien llama.
		async page(tenantId: string, slug: string) {
			const binding = await wikiBinding(tenantId);
			if (!binding) return null;
			try {
				return await getBrainProvider(binding).read(slug, {
					suggestions: false,
				});
			} catch (error) {
				if (error instanceof BrainNotFound) return null;
				throw error;
			}
		},
		store: skillStore(),
	};
}

export function publishDeps(): PublishDeps {
	return {
		...shared(),
		async revisions(tenantId, slug) {
			const binding = await wikiBinding(tenantId);
			if (!binding) return [];
			return (await getBrainProvider(binding).history(slug)) ?? [];
		},
	};
}

export function filesDeps(): FilesDeps {
	return {
		...shared(),
		rules: accessRulesStore(),
		blobs: blobStore(),
		// Por el mismo camino que el guardado del editor: withAccess decide.
		async save(actor, write) {
			const binding = await wikiBinding(actor.tenantId);
			if (!binding) throw new BrainNotFound(write.slug, []);
			const provider = await resolveActingProvider(binding, {
				userId: actor.userId,
				role: actor.role,
			});
			return provider.upsert(write, { kind: "user", userId: actor.userId });
		},
	};
}
```

- [ ] **Step 6: El contexto del editor aplica la vista de skills y marca el árbol**

Test primero. En `tests/brain/access-tree.test.ts`, agregar junto a los casos de `visibleTree`:

```ts
	it("lleva la marca de pendiente de una skill hasta el nodo", () => {
		const root = visibleTree(
			[
				{
					slug: "skills/facturacion",
					title: "Facturación",
					status: "activo",
					pending: true,
				},
				{ slug: "skills/marca", title: "Marca", status: "activo" },
			],
			() => "editor",
		);
		const skills = root.children.find((node) => node.path === "skills");
		const byName = new Map(
			(skills?.children ?? []).map((node) => [node.name, node.page]),
		);
		expect(byName.get("facturacion")?.pending).toBe(true);
		expect(byName.get("marca")?.pending).toBeUndefined();
	});
```

Run: `npx vitest run tests/brain/access-tree.test.ts`
Expected: FAIL (`pending` no existe en `TreePage` y no se copia).

En `lib/brain/core/access/tree.ts`, sumar el campo a `TreePage`:

```ts
export interface TreePage {
	slug: string;
	title: string;
	status: BrainStatus;
	// Skill sin publicar o con cambios sin publicar. Solo se marca para quien
	// puede editarla.
	pending?: boolean;
}
```

y en `visibleTree` reemplazar la línea que arma `parent.page` (y su comentario) por:

```ts
		// Solo estos campos viajan al navegador: nunca el cuerpo.
		parent.page = {
			slug: page.slug,
			title: page.title,
			status: page.status,
			...(page.pending ? { pending: true } : {}),
		};
```

En `lib/brain/adapters/editor.ts`:

Agregar los imports:

```ts
import { atLeast } from "../core/access/types";
import { SKILL_CATEGORY } from "../core/skills/package";
import { skillState } from "../core/skills/state";
import type { SkillOverviewRow } from "../core/skills/store";
import { withSkillView } from "../core/skills/view";
import { skillStore } from "./skills";
```

(`atLeast` se suma al import existente de `../core/access/types`).

En el tipo `EditorContext`, variante `ok`, agregar el campo:

```ts
			// Resumen de las skills del tenant; vacío si el brain no las habilita.
			skills: () => Promise<SkillOverviewRow[]>;
```

En `loadEditorContext`, reemplazar el `return { kind: "ok", ... }` por:

```ts
		// Sin la categoría no puede existir una página de skill: no se consulta.
		const skillsEnabled = binding.config.categories.includes(SKILL_CATEGORY);
		let overview: Promise<SkillOverviewRow[]> | null = null;
		const skills = () => {
			overview ??= skillsEnabled
				? skillStore().overview(tenant.id)
				: Promise.resolve([]);
			return overview;
		};
		const guarded = withAccess(getBrainProvider(binding), principal, rules);

		return {
			kind: "ok",
			tenant,
			categories: binding.config.categories,
			// Quien solo lee una skill ve su versión publicada (spec 24.1 §7).
			provider: skillsEnabled
				? withSkillView(guarded, { levelOf: access, overview: skills })
				: guarded,
			access,
			skills,
		};
```

Reemplazar `loadBrainTree` por:

```ts
export const loadBrainTree = cache(
	async (ctx: OkEditorContext): Promise<TreeNode> => {
		const pages = await loadBrainPages(ctx);
		const pending = new Set(
			(await ctx.skills())
				.filter((row) => {
					const state = skillState(row);
					return (
						state.kind === "sin_publicar" ||
						(state.kind === "publicada" && state.dirty)
					);
				})
				.map((row) => row.slug),
		);
		return visibleTree(
			pages.map((page) => ({
				slug: page.slug,
				title: page.title,
				status: page.status,
				...(pending.has(page.slug) && atLeast(ctx.access(page.slug), "editor")
					? { pending: true }
					: {}),
			})),
			ctx.access,
		);
	},
);
```

Run: `npx vitest run tests/brain && npm run typecheck`
Expected: PASS. Si algún test arma un `EditorContext` a mano (`editor-adapter.test.ts`), sumarle `skills: async () => []`.

- [ ] **Step 7: Server actions**

Crear `app/[tenant]/brain/skill-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { filesDeps, publishDeps } from "@/lib/brain/adapters/skills";
import { removeSkillFile } from "@/lib/brain/core/skills/files";
import {
	previewPublish,
	publishSkill,
	republishSkill,
	withdrawSkill,
} from "@/lib/brain/core/skills/publish";

// Una server action la invoca cualquier cliente autenticado con lo que quiera:
// se valida la forma en el borde; el permiso lo decide el núcleo.
const base = {
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	slug: z.string().min(1).max(200),
};
const note = z.string().max(500);

const invalid = {
	ok: false,
	code: "invalid",
	message: "Datos inválidos.",
} as const;

function refresh(tenantSlug: string) {
	revalidatePath(`/${tenantSlug}/brain`, "layout");
}

export async function getPublishPreview(raw: unknown) {
	const parsed = z.object(base).safeParse(raw);
	if (!parsed.success) return invalid;
	return previewPublish(parsed.data.tenantSlug, parsed.data.slug, publishDeps());
}

export async function publishSkillAction(raw: unknown) {
	const parsed = z
		.object({
			...base,
			expectedRevision: z.number().int().positive(),
			expectedFilesDigest: z.string().regex(/^[0-9a-f]{64}$/),
			note,
		})
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, ...input } = parsed.data;
	const result = await publishSkill(tenantSlug, slug, input, publishDeps());
	if (result.ok) refresh(tenantSlug);
	return result;
}

export async function republishSkillAction(raw: unknown) {
	const parsed = z
		.object({ ...base, fromVersion: z.number().int().positive(), note })
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, ...input } = parsed.data;
	const result = await republishSkill(tenantSlug, slug, input, publishDeps());
	if (result.ok) refresh(tenantSlug);
	return result;
}

export async function withdrawSkillAction(raw: unknown) {
	const parsed = z.object({ ...base, note }).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, ...input } = parsed.data;
	const result = await withdrawSkill(tenantSlug, slug, input, publishDeps());
	if (result.ok) refresh(tenantSlug);
	return result;
}

export async function removeSkillFileAction(raw: unknown) {
	const parsed = z
		.object({ ...base, path: z.string().min(1).max(200) })
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, path } = parsed.data;
	const result = await removeSkillFile(tenantSlug, slug, path, filesDeps());
	if (result.ok) refresh(tenantSlug);
	return result;
}
```

- [ ] **Step 8: Route handler de archivos**

Crear `app/[tenant]/brain/skills/files/route.ts`:

```ts
import { revalidatePath } from "next/cache";
import { unzipPackage, ZipRejected } from "@/lib/brain/adapters/skill-zip";
import { filesDeps } from "@/lib/brain/adapters/skills";
import {
	importSkillPackage,
	putSkillFile,
	readSkillFile,
} from "@/lib/brain/core/skills/files";
import { fileHeaders, isSameOrigin } from "@/lib/brain/core/skills/http";
import { MAX_FILE_BYTES } from "@/lib/brain/core/skills/package";
import type { SkillFailure } from "@/lib/brain/core/skills/publish";

// Subida, importación y lectura de los archivos de una skill (spec etapa 24.1
// §6). No es una server action porque esas tienen tope de 2 MB. El permiso lo
// decide core/skills/files.ts.

const TENANT = /^[a-z0-9-]{1,63}$/;
const STATUS: Record<SkillFailure["code"], number> = {
	not_found: 404,
	forbidden: 403,
	conflict: 409,
	validation: 422,
	unsupported: 422,
	name_taken: 409,
};
// El formulario multipart agrega unos bytes alrededor del archivo.
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 65_536;

function refuse(status: number, message: string): Response {
	return Response.json({ ok: false, message }, { status });
}

function failed(result: SkillFailure): Response {
	return Response.json(result, { status: STATUS[result.code] });
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ tenant: string }> },
) {
	const { tenant } = await params;
	const query = new URL(request.url).searchParams;
	const slug = query.get("slug");
	const path = query.get("path");
	const rawVersion = query.get("version");
	const version = rawVersion === null ? undefined : Number(rawVersion);
	if (
		!TENANT.test(tenant) ||
		!slug ||
		!path ||
		(version !== undefined && (!Number.isInteger(version) || version < 1))
	) {
		return new Response("No encontrado", { status: 404 });
	}

	const result = await readSkillFile(
		tenant,
		slug,
		{ path, ...(version === undefined ? {} : { version }) },
		filesDeps(),
	);
	// Sin distinguir motivos: lo que no se ve responde igual que lo que no existe.
	if (!result.ok) return new Response("No encontrado", { status: 404 });
	return new Response(result.bytes, {
		headers: fileHeaders(result.path, result.bytes),
	});
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ tenant: string }> },
) {
	const { tenant } = await params;
	if (!TENANT.test(tenant)) return refuse(404, "No encontrado.");
	// Un route handler no trae el chequeo de origen de las server actions.
	if (
		!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))
	) {
		return refuse(403, "Origen no permitido.");
	}
	if (Number(request.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
		return refuse(413, "El archivo supera los 4 MB.");
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return refuse(400, "Pedido inválido.");
	}
	const slug = form.get("slug");
	const file = form.get("file");
	const path = form.get("path");
	if (typeof slug !== "string" || !(file instanceof File)) {
		return refuse(400, "Pedido inválido.");
	}
	if (file.size > MAX_FILE_BYTES) {
		return refuse(413, "El archivo supera los 4 MB.");
	}
	const bytes = new Uint8Array(await file.arrayBuffer());

	if (form.get("kind") === "zip") {
		let entries: ReturnType<typeof unzipPackage>;
		try {
			entries = unzipPackage(bytes);
		} catch (error) {
			if (error instanceof ZipRejected) return refuse(422, error.message);
			throw error;
		}
		const result = await importSkillPackage(tenant, slug, entries, filesDeps());
		if (!result.ok) return failed(result);
		revalidatePath(`/${tenant}/brain`, "layout");
		return Response.json(result);
	}

	if (typeof path !== "string") return refuse(400, "Falta la ruta.");
	const result = await putSkillFile(tenant, slug, { path, bytes }, filesDeps());
	if (!result.ok) return failed(result);
	revalidatePath(`/${tenant}/brain`, "layout");
	return Response.json(result);
}
```

- [ ] **Step 9: Correr todo, lint, typecheck y commit**

```bash
npm test
npx biome check --write lib/brain/core/skills/http.ts lib/brain/adapters/skill-zip.ts lib/brain/adapters/skills.ts lib/brain/adapters/editor.ts lib/brain/core/access/tree.ts "app/[tenant]/brain/skill-actions.ts" "app/[tenant]/brain/skills/files/route.ts" tests/brain/skills-http.test.ts tests/brain/skills-zip.test.ts tests/brain/access-tree.test.ts
npm run typecheck
git add package.json package-lock.json lib/brain/core/skills/http.ts lib/brain/adapters/skill-zip.ts lib/brain/adapters/skills.ts lib/brain/adapters/editor.ts lib/brain/core/access/tree.ts "app/[tenant]/brain/skill-actions.ts" "app/[tenant]/brain/skills/files/route.ts" tests/brain/skills-http.test.ts tests/brain/skills-zip.test.ts tests/brain/access-tree.test.ts
git commit -m "feat: subida, importacion y publicacion de skills conectadas a la plataforma"
```

Expected: `npm test` PASS entero, incluido `tests/server-actions-exports.test.ts`.

---

### Task 9: Pantallas

**Files:**
- Create: `components/brain/skills/published-files.tsx`
- Create: `components/brain/skills/publish-dialog.tsx`
- Create: `components/brain/skills/skill-panel.tsx`
- Modify: `components/brain/editor/page-workspace.tsx`
- Modify: `components/brain/brain-tree.tsx`
- Modify: `app/[tenant]/brain/p/[...slug]/page.tsx`
- Test: `tests/brain/skills-components.test.ts`

**Interfaces:**
- Consumes: server actions y HTTP de la Task 8; `SkillState`, `skillState`, `skillStateLabel`, `publishedSnapshot` (Task 4); `SkillFile`, `PUBLISH_MESSAGES`, `isSkillSlug` (Task 2); `PublishPreview` (Task 6); `skillFileHref` (Task 8); `DiffView` y `diffLines`; `skillStore()`; componentes de `components/ui`.
- Produces:
  - `PublishedFiles({ tenantSlug, slug, files }: { tenantSlug: string; slug: string; files: SkillFile[] })`
  - `SkillPanel(props: SkillPanelProps)` con

```ts
export interface SkillVersionRow {
	id: number;
	action: "publicar" | "retirar";
	version: number;
	note: string;
	createdAt: string;
	republishedFrom: number | null;
}
export interface SkillPanelProps {
	tenantSlug: string;
	slug: string;
	state: SkillState;
	files: SkillFile[];
	versions: SkillVersionRow[];
	canPublish: boolean;
}
```

  - `PageWorkspaceProps` suma `skill?: ReactNode`.

- [ ] **Step 1: Test del componente puro (falla)**

Crear `tests/brain/skills-components.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublishedFiles } from "@/components/brain/skills/published-files";

describe("PublishedFiles", () => {
	it("lista los archivos de la versión vigente con su link", () => {
		const html = renderToStaticMarkup(
			createElement(PublishedFiles, {
				tenantSlug: "acme",
				slug: "skills/facturacion",
				files: [
					{ path: "scripts/calc.py", sha256: "a", size: 2048 },
					{ path: "assets/logo.png", sha256: "b", size: 10 },
				],
			}),
		);
		expect(html).toContain("scripts/calc.py");
		expect(html).toContain("2 KB");
		expect(html).toContain(
			"/acme/brain/skills/files?slug=skills%2Ffacturacion&amp;path=scripts%2Fcalc.py",
		);
	});

	it("sin archivos no muestra nada", () => {
		expect(
			renderToStaticMarkup(
				createElement(PublishedFiles, {
					tenantSlug: "acme",
					slug: "skills/x",
					files: [],
				}),
			),
		).toBe("");
	});
});
```

Run: `npx vitest run tests/brain/skills-components.test.ts`
Expected: FAIL, no resuelve el componente.

- [ ] **Step 2: `published-files.tsx`**

Crear `components/brain/skills/published-files.tsx`:

```tsx
import { skillFileHref } from "@/lib/brain/core/skills/http";
import type { SkillFile } from "@/lib/brain/core/skills/package";

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// Archivos de una versión publicada, para quien solo lee la skill.
export function PublishedFiles({
	tenantSlug,
	slug,
	files,
}: {
	tenantSlug: string;
	slug: string;
	files: SkillFile[];
}) {
	if (files.length === 0) return null;
	return (
		<section className="space-y-2">
			<h2 className="font-medium text-sm">Archivos de la skill</h2>
			<ul className="divide-y rounded-lg border text-sm">
				{files.map((file) => (
					<li key={file.path} className="flex items-center gap-3 px-3 py-2">
						<a
							className="mr-auto break-all underline"
							href={skillFileHref(tenantSlug, slug, file.path)}
							target="_blank"
							rel="noreferrer"
						>
							{file.path}
						</a>
						<span className="shrink-0 text-muted-foreground">
							{formatSize(file.size)}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
```

Run: `npx vitest run tests/brain/skills-components.test.ts`
Expected: PASS.

- [ ] **Step 3: `publish-dialog.tsx`**

Crear `components/brain/skills/publish-dialog.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
	getPublishPreview,
	publishSkillAction,
} from "@/app/[tenant]/brain/skill-actions";
import { DiffView } from "@/components/brain/diff-view";
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
import { Textarea } from "@/components/ui/textarea";
import { diffLines } from "@/lib/brain/core/diff";
import { skillFileHref } from "@/lib/brain/core/skills/http";
import {
	PUBLISH_MESSAGES,
	type SkillFile,
} from "@/lib/brain/core/skills/package";
import type { PublishPreview } from "@/lib/brain/core/skills/publish";
import { formatSize } from "./published-files";

type Loaded = { preview: PublishPreview };
type Failed = { error: string };

function FileGroup({
	label,
	files,
	tenantSlug,
	slug,
	linked,
}: {
	label: string;
	files: SkillFile[];
	tenantSlug: string;
	slug: string;
	linked: boolean;
}) {
	if (files.length === 0) return null;
	return (
		<div>
			<p className="font-medium">{label}</p>
			<ul className="list-disc pl-5">
				{files.map((file) => (
					<li key={file.path} className="break-all">
						{linked ? (
							<a
								className="underline"
								href={skillFileHref(tenantSlug, slug, file.path)}
								target="_blank"
								rel="noreferrer"
							>
								{file.path}
							</a>
						) : (
							file.path
						)}{" "}
						<span className="text-muted-foreground">
							({formatSize(file.size)})
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

// Revisión antes de publicar (spec 24.1 §8.2): lo que se confirma es la
// revisión y el hash de archivos que se cargaron acá.
export function PublishDialog({
	tenantSlug,
	slug,
	onClose,
}: {
	tenantSlug: string;
	slug: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const [state, setState] = useState<Loaded | Failed | null>(null);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		getPublishPreview({ tenantSlug, slug })
			.then((result) => {
				if (cancelled) return;
				setState(
					result.ok ? { preview: result.preview } : { error: result.message },
				);
			})
			.catch(() => {
				if (!cancelled)
					setState({ error: "No se pudo cargar. Probá de nuevo." });
			});
		return () => {
			cancelled = true;
		};
	}, [tenantSlug, slug]);

	async function confirm(preview: PublishPreview) {
		setBusy(true);
		setError(null);
		try {
			const result = await publishSkillAction({
				tenantSlug,
				slug,
				expectedRevision: preview.revision,
				expectedFilesDigest: preview.filesDigest,
				note,
			});
			if (result.ok) {
				router.refresh();
				onClose();
				return;
			}
			setError(result.message);
		} catch {
			setError("No se pudo publicar. Probá de nuevo.");
		} finally {
			setBusy(false);
		}
	}

	const preview = state && "preview" in state ? state.preview : null;
	const hasFileChanges =
		preview !== null &&
		preview.files.added.length +
			preview.files.changed.length +
			preview.files.removed.length >
			0;

	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
				<AlertDialogHeader>
					<AlertDialogTitle>
						Publicar {preview ? `«${preview.name}»` : "skill"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						Lo que publiques es lo que van a recibir los asistentes de quienes
						tengan acceso a esta skill.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{state === null && <p className="text-sm">Cargando…</p>}
				{state && "error" in state && (
					<p className="text-destructive text-sm">{state.error}</p>
				)}
				{preview && (
					<div className="space-y-4 text-sm">
						{preview.problems.length > 0 && (
							<ul className="list-disc space-y-1 pl-5 text-destructive">
								{preview.problems.map((problem) => (
									<li key={problem}>{PUBLISH_MESSAGES[problem]}</li>
								))}
							</ul>
						)}
						{preview.warnings.map((warning) => (
							<p key={warning} className="text-muted-foreground">
								{PUBLISH_MESSAGES[warning]}
							</p>
						))}

						<section className="space-y-1">
							<h3 className="font-medium">Descripción</h3>
							<p>{preview.description || "(sin descripción)"}</p>
							{preview.previousDescription !== null &&
								preview.previousDescription !== preview.description && (
									<p className="text-muted-foreground">
										Antes: {preview.previousDescription}
									</p>
								)}
						</section>

						<section className="space-y-1">
							<h3 className="font-medium">
								{preview.previousBody === null
									? "Texto (primera publicación)"
									: "Cambios en el texto"}
							</h3>
							<DiffView
								blocks={diffLines(preview.previousBody ?? "", preview.body)}
							/>
						</section>

						<section className="space-y-2">
							<h3 className="font-medium">Archivos</h3>
							{hasFileChanges ? (
								<>
									<FileGroup
										label="Agregados"
										files={preview.files.added}
										tenantSlug={tenantSlug}
										slug={slug}
										linked
									/>
									<FileGroup
										label="Cambiados"
										files={preview.files.changed}
										tenantSlug={tenantSlug}
										slug={slug}
										linked
									/>
									<FileGroup
										label="Quitados"
										files={preview.files.removed}
										tenantSlug={tenantSlug}
										slug={slug}
										linked={false}
									/>
								</>
							) : (
								<p className="text-muted-foreground">Sin cambios en archivos.</p>
							)}
						</section>

						{preview.editorIds.length > 0 && (
							<p className="text-muted-foreground">
								{preview.editorIds.length === 1
									? "Una persona editó"
									: `${preview.editorIds.length} personas editaron`}{" "}
								el borrador desde la última publicación. El detalle está en el
								historial de la página.
							</p>
						)}

						<label className="block space-y-1">
							<span>Nota de publicación</span>
							<Textarea
								value={note}
								maxLength={500}
								onChange={(e) => setNote(e.target.value)}
								placeholder="Qué cambia en esta versión"
							/>
						</label>
						{error && <p className="text-destructive">{error}</p>}
					</div>
				)}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
					{preview && (
						<Button
							disabled={
								busy || preview.problems.length > 0 || note.trim().length === 0
							}
							onClick={() => confirm(preview)}
						>
							{busy ? "Publicando…" : "Publicar"}
						</Button>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
```

Antes de dar por bueno este archivo, abrir `components/brain/delete-page-dialog.tsx` y `components/ui/alert-dialog.tsx` y confirmar que los nombres de los componentes de diálogo y sus props coinciden; si difieren, seguir los de esos archivos.

- [ ] **Step 4: `skill-panel.tsx`**

Crear `components/brain/skills/skill-panel.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import {
	removeSkillFileAction,
	republishSkillAction,
	withdrawSkillAction,
} from "@/app/[tenant]/brain/skill-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { skillFileHref } from "@/lib/brain/core/skills/http";
import type { SkillFile } from "@/lib/brain/core/skills/package";
import {
	type SkillState,
	skillStateLabel,
} from "@/lib/brain/core/skills/state";
import { PublishDialog } from "./publish-dialog";
import { formatSize } from "./published-files";

export interface SkillVersionRow {
	id: number;
	action: "publicar" | "retirar";
	version: number;
	note: string;
	createdAt: string;
	republishedFrom: number | null;
}

export interface SkillPanelProps {
	tenantSlug: string;
	slug: string;
	state: SkillState;
	files: SkillFile[];
	versions: SkillVersionRow[];
	canPublish: boolean;
}

// Estado, archivos y versiones de una skill (spec 24.1 §6 y §8), para quien la
// edita. Publicar, republicar y retirar aparecen solo para un administrador.
export function SkillPanel({
	tenantSlug,
	slug,
	state,
	files,
	versions,
	canPublish,
}: SkillPanelProps) {
	const router = useRouter();
	const pathId = useId();
	const fileInput = useRef<HTMLInputElement>(null);
	const zipInput = useRef<HTMLInputElement>(null);
	const [path, setPath] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [publishing, setPublishing] = useState(false);
	const [isPending, startTransition] = useTransition();

	const endpoint = `/${tenantSlug}/brain/skills/files`;
	const publishable =
		state.kind !== "publicada" || state.dirty;

	async function upload(form: FormData) {
		setMessage(null);
		try {
			const response = await fetch(endpoint, { method: "POST", body: form });
			const result = (await response.json()) as {
				ok: boolean;
				message?: string;
			};
			if (!result.ok) {
				setMessage(result.message ?? "No se pudo subir.");
				return;
			}
			setPath("");
			if (fileInput.current) fileInput.current.value = "";
			if (zipInput.current) zipInput.current.value = "";
			router.refresh();
		} catch {
			setMessage("No se pudo subir. Probá de nuevo.");
		}
	}

	function uploadFile() {
		const file = fileInput.current?.files?.[0];
		if (!file) {
			setMessage("Elegí un archivo.");
			return;
		}
		const form = new FormData();
		form.set("slug", slug);
		form.set("path", path.trim() || file.name);
		form.set("file", file);
		startTransition(() => upload(form));
	}

	function importZip() {
		const file = zipInput.current?.files?.[0];
		if (!file) {
			setMessage("Elegí un zip.");
			return;
		}
		if (
			!window.confirm(
				"Importar reemplaza el texto y los archivos del borrador por los del paquete. No publica nada.",
			)
		)
			return;
		const form = new FormData();
		form.set("slug", slug);
		form.set("kind", "zip");
		form.set("file", file);
		startTransition(() => upload(form));
	}

	function run(
		action: () => Promise<{ ok: boolean; message?: string }>,
		failure: string,
	) {
		setMessage(null);
		startTransition(async () => {
			try {
				const result = await action();
				if (!result.ok) {
					setMessage(result.message ?? failure);
					return;
				}
				router.refresh();
			} catch {
				setMessage(failure);
			}
		});
	}

	function askNote(question: string): string | null {
		const note = window.prompt(question)?.trim();
		return note ? note : null;
	}

	return (
		<section className="space-y-4 rounded-lg border p-3 text-sm">
			<div className="space-y-2">
				<h2 className="font-medium">Skill</h2>
				<p>{skillStateLabel(state)}</p>
				{canPublish ? (
					<div className="flex flex-wrap gap-2">
						{publishable && (
							<Button
								size="sm"
								disabled={isPending}
								onClick={() => setPublishing(true)}
							>
								Revisar y publicar
							</Button>
						)}
						{state.kind === "publicada" && (
							<Button
								size="sm"
								variant="outline"
								disabled={isPending}
								onClick={() => {
									const note = askNote("¿Por qué se retira? Queda en el registro.");
									if (!note) return;
									run(
										() => withdrawSkillAction({ tenantSlug, slug, note }),
										"No se pudo retirar.",
									);
								}}
							>
								Retirar
							</Button>
						)}
					</div>
				) : (
					<p className="text-muted-foreground">
						La publica un administrador de la empresa.
					</p>
				)}
				<p className="text-muted-foreground">
					Se publica lo guardado: guardá los cambios del texto antes de revisar.
				</p>
			</div>

			<div className="space-y-2">
				<h3 className="font-medium">Archivos del borrador</h3>
				{files.length === 0 ? (
					<p className="text-muted-foreground">Todavía no hay archivos.</p>
				) : (
					<ul className="divide-y rounded-md border">
						{files.map((file) => (
							<li key={file.path} className="flex items-center gap-2 px-2 py-1">
								<a
									className="mr-auto break-all underline"
									href={skillFileHref(tenantSlug, slug, file.path)}
									target="_blank"
									rel="noreferrer"
								>
									{file.path}
								</a>
								<span className="shrink-0 text-muted-foreground">
									{formatSize(file.size)}
								</span>
								<Button
									size="sm"
									variant="ghost"
									disabled={isPending}
									aria-label={`Quitar ${file.path}`}
									onClick={() =>
										run(
											() =>
												removeSkillFileAction({
													tenantSlug,
													slug,
													path: file.path,
												}),
											"No se pudo quitar.",
										)
									}
								>
									Quitar
								</Button>
							</li>
						))}
					</ul>
				)}

				<label htmlFor={pathId} className="block space-y-1">
					<span>Ruta dentro del paquete</span>
					<Input
						id={pathId}
						value={path}
						placeholder="scripts/calcular.py"
						onChange={(e) => setPath(e.target.value)}
					/>
				</label>
				<input ref={fileInput} type="file" aria-label="Archivo a subir" />
				<Button
					size="sm"
					variant="outline"
					disabled={isPending}
					onClick={uploadFile}
				>
					Subir archivo
				</Button>
				<p className="text-muted-foreground">
					Hasta 4 MB por archivo, 50 archivos y 20 MB en total. Si la ruta queda
					vacía se usa el nombre del archivo.
				</p>
			</div>

			<div className="space-y-2">
				<h3 className="font-medium">Importar un paquete</h3>
				<input
					ref={zipInput}
					type="file"
					accept=".zip,application/zip"
					aria-label="Zip del paquete"
				/>
				<Button
					size="sm"
					variant="outline"
					disabled={isPending}
					onClick={importZip}
				>
					Importar zip
				</Button>
			</div>

			{versions.length > 0 && (
				<div className="space-y-2">
					<h3 className="font-medium">Versiones</h3>
					<ol className="divide-y rounded-md border">
						{versions.map((row) => (
							<li key={row.id} className="space-y-1 px-2 py-1">
								<p>
									{row.action === "publicar"
										? `v${row.version}`
										: `Retirada la v${row.version}`}
									{row.republishedFrom !== null &&
										` (republica la v${row.republishedFrom})`}{" "}
									<span className="text-muted-foreground">
										{row.createdAt.slice(0, 10)}
									</span>
								</p>
								<p className="text-muted-foreground">{row.note}</p>
								{canPublish && row.action === "publicar" && (
									<Button
										size="sm"
										variant="ghost"
										disabled={isPending}
										onClick={() => {
											const note = askNote(
												`¿Por qué se republica la v${row.version}? Queda en el registro.`,
											);
											if (!note) return;
											run(
												() =>
													republishSkillAction({
														tenantSlug,
														slug,
														fromVersion: row.version,
														note,
													}),
												"No se pudo republicar.",
											);
										}}
									>
										Republicar
									</Button>
								)}
							</li>
						))}
					</ol>
				</div>
			)}

			{message && <p className="text-destructive">{message}</p>}
			{publishing && (
				<PublishDialog
					tenantSlug={tenantSlug}
					slug={slug}
					onClose={() => setPublishing(false)}
				/>
			)}
		</section>
	);
}
```

- [ ] **Step 5: `PageWorkspace`: panel, descripción de la skill y campos fijos**

El editor no tiene hoy dónde cargar el frontmatter, y sin `description` una skill no se publica. Leer `components/brain/editor/page-workspace.tsx` entero antes de tocarlo.

Agregar el import:

```ts
import {
	MAX_COMPATIBILITY,
	MAX_DESCRIPTION,
	SKILL_CATEGORY,
} from "@/lib/brain/core/skills/package";
```

En `PageWorkspaceProps`, agregar:

```ts
	// Panel de la skill (estado, archivos, versiones), ya armado en el servidor.
	skill?: ReactNode;
```

Sumar `skill` a la desestructuración de props. Debajo de los `useState`, agregar:

```ts
	const isSkill = form.category === SKILL_CATEGORY;
	const frontmatterText = (key: string) =>
		typeof form.frontmatter[key] === "string"
			? (form.frontmatter[key] as string)
			: "";
	// Un campo vacío se saca del frontmatter en vez de guardarse como "".
	const setFrontmatterText = (key: string, value: string) =>
		setForm((f) => {
			const next = { ...f.frontmatter };
			if (value.length > 0) next[key] = value;
			else delete next[key];
			return { ...f, frontmatter: next };
		});
```

En la condición que detecta cambios sin guardar (la que compara `form.status !== saved.status`, cerca de la línea 116), sumar una comparación más con `||`:

```ts
		JSON.stringify(form.frontmatter) !== JSON.stringify(saved.frontmatter) ||
```

En `detailsFields`:

1. Al `<select>` de "Categoría" agregarle `disabled={mode === "edit" && isSkill}`: una skill ya creada no cambia de categoría (spec §8.3).
2. Envolver el `<label>` de "Estado" en `{!isSkill && ( ... )}`: el estado común del brain no se usa en una skill (spec §5.1).
3. Inmediatamente después de ese bloque, agregar los campos de la skill:

```tsx
			{isSkill && (
				<>
					<label className="block space-y-1">
						<span>Descripción: cuándo usar esta skill</span>
						<Textarea
							value={frontmatterText("description")}
							maxLength={MAX_DESCRIPTION}
							rows={4}
							placeholder="Usar cuando alguien pide emitir o revisar una factura."
							onChange={(e) =>
								setFrontmatterText("description", e.target.value)
							}
						/>
						<span className="text-muted-foreground">
							Es lo que lee el asistente para decidir si la carga. Sin esto no
							se puede publicar.
						</span>
					</label>
					<label className="block space-y-1">
						<span>Qué necesita (opcional)</span>
						<Input
							value={frontmatterText("compatibility")}
							maxLength={MAX_COMPATIBILITY}
							className="min-h-11 lg:min-h-9"
							placeholder="Python 3 con openpyxl"
							onChange={(e) =>
								setFrontmatterText("compatibility", e.target.value)
							}
						/>
					</label>
					{mode === "new" && (
						<p className="text-muted-foreground">
							La ruta de una skill empieza con <code>skills/</code>.
						</p>
					)}
				</>
			)}
```

Si el archivo no importa `Textarea`, sumar `import { Textarea } from "@/components/ui/textarea";`.

4. Dentro del bloque `{mode === "edit" && ( <> ... </> )}`, inmediatamente antes de `{facts}`:

```tsx
					{skill}
```

Verificar a mano que guardar una página que **no** es skill sigue mandando el mismo `frontmatter` que antes (el objeto no se toca si no se usan los campos nuevos).

- [ ] **Step 6: La página arma el panel y la vista del lector**

En `app/[tenant]/brain/p/[...slug]/page.tsx`:

Agregar imports:

```ts
import { PublishedFiles } from "@/components/brain/skills/published-files";
import { SkillPanel } from "@/components/brain/skills/skill-panel";
import { skillStore } from "@/lib/brain/adapters/skills";
import { isAdminRole } from "@/lib/brain/core/access/types";
import { isSkillSlug } from "@/lib/brain/core/skills/package";
import { publishedSnapshot, skillState } from "@/lib/brain/core/skills/state";
```

Después de `const incoming = ...`, agregar:

```ts
	// Una skill suma su panel (quien edita) o sus archivos publicados (quien lee).
	const skillRow = isSkillSlug(slug)
		? (await ctx.skills()).find((row) => row.slug === slug)
		: undefined;
```

Dentro del `if (entryMode(level) === "edit")`, antes del `return`, armar el panel:

```tsx
		let skill: React.ReactNode;
		if (skillRow) {
			const store = skillStore();
			const [files, acts] = await Promise.all([
				store.files(ctx.tenant.id, skillRow.pageId),
				store.acts(ctx.tenant.id, skillRow.pageId),
			]);
			skill = (
				<SkillPanel
					tenantSlug={tenantSlug}
					slug={slug}
					state={skillState(skillRow)}
					files={files}
					versions={acts.map((act) => ({
						id: act.id,
						action: act.action,
						version: act.version,
						note: act.note,
						createdAt: act.createdAt,
						republishedFrom: act.republishedFrom,
					}))}
					canPublish={isAdminRole(ctx.tenant.role)}
				/>
			);
		}
```

y pasar `skill={skill}` a `<PageWorkspace ... />`. Agregar `import type React from "react";` si el archivo no tiene el tipo a mano (o tipar `skill` como `ReactNode` importando `type ReactNode` de `react`).

Reemplazar el `return (<ReadingView ... />)` final por:

```tsx
	const publishedFiles = publishedSnapshot(skillRow)?.manifest ?? [];

	return (
		<div className="space-y-6">
			<ReadingView
				tenantSlug={tenantSlug}
				page={page}
				lookup={lookup}
				outgoing={outgoing}
				incoming={incoming}
				actions={
					// El historial de una skill es el de su borrador: no es para lectores.
					skillRow ? undefined : (
						<Button asChild variant="outline" className="min-h-11 lg:min-h-0">
							<Link href={historyHref(tenantSlug, slug)}>Historial</Link>
						</Button>
					)
				}
			/>
			{skillRow && (
				<PublishedFiles
					tenantSlug={tenantSlug}
					slug={slug}
					files={publishedFiles}
				/>
			)}
		</div>
	);
```

- [ ] **Step 7: Marca en el árbol**

En `components/brain/brain-tree.tsx`, dentro de `renderNode`, ubicar dónde se muestra `{label}` (el texto del nodo) y agregar inmediatamente después:

```tsx
					{node.page?.pending && (
						<span
							className="ml-1 inline-block size-1.5 shrink-0 rounded-full bg-amber-500"
							role="img"
							aria-label="Pendiente de publicar"
							title="Pendiente de publicar"
						/>
					)}
```

- [ ] **Step 8: Correr, lint, typecheck y commit**

```bash
npm test
npx biome check --write components/brain/skills/published-files.tsx components/brain/skills/publish-dialog.tsx components/brain/skills/skill-panel.tsx components/brain/editor/page-workspace.tsx components/brain/brain-tree.tsx "app/[tenant]/brain/p/[...slug]/page.tsx" tests/brain/skills-components.test.ts
npm run typecheck
git add components/brain/skills components/brain/editor/page-workspace.tsx components/brain/brain-tree.tsx "app/[tenant]/brain/p/[...slug]/page.tsx" tests/brain/skills-components.test.ts
git commit -m "feat: pantallas para armar, revisar y publicar skills"
```

Expected: `npm test` y typecheck limpios.

---

### Task 10: Documentación y verificación en el navegador

**Files:**
- Modify: `lib/brain/README.md`
- Modify: `docs/01-roadmap-etapas.md`
- Modify: `docs/brain-mcp-conexion.md`

**Interfaces:**
- Consumes: todo lo anterior, corriendo en local.
- Produces: documentación y evidencia de la pasada en navegador.

- [ ] **Step 1: README del módulo**

En `lib/brain/README.md`, agregar antes de "## Qué viaja con el módulo" esta sección:

```markdown
## Skills

- Una skill es una página de categoría `skill` bajo `skills/`; las dos cosas
  van juntas y lo exige `validateWrite` (`core/skills/package.ts`,
  `skillPlacementOk`). Como el slug no cambia, tampoco puede salir de la
  categoría.
- El borrador es la página más sus archivos (`brain_skill_files`); el
  contenido de cada archivo va al bucket privado `skills`, en
  `<tenant_id>/<sha256>`. El hash lo calcula el servidor.
- Publicar (`core/skills/publish.ts`) exige `tenant_admin` o `platform_admin`
  y llama a `brain_publish_skill`, que arma la copia desde la fila bloqueada y
  la inserta en `brain_skill_versions`. Esa tabla es solo de inserción, también
  para la service role. Retirar es otra fila; republicar copia una versión
  anterior a una nueva.
- **Lo que se publica es lo que se revisó:** la publicación va con la revisión
  de la página y el hash de archivos que mostró la pantalla; si algo cambió, la
  base responde `BR409`.
- **Qué ve cada uno.** `core/skills/view.ts` tiene dos envoltorios de
  `BrainProvider`. `withoutSkills` va en las tools del agente
  (`adapters/tools.ts`) y en el endpoint MCP (`core/mcp-server/handler.ts`):
  ningún asistente ve ni escribe nada bajo `skills/`, sea quien sea.
  `withSkillView` va en el contexto del editor web (`adapters/editor.ts`): quien
  es editor de la skill ve el borrador; quien solo lee ve la copia publicada, y
  sin versión vigente la skill no existe para él.
- `resolveActingProvider` **no** lleva `withoutSkills`: lo usa el guardado del
  editor web, que tiene que escribir borradores.
- Los archivos se sirven siempre por `app/[tenant]/brain/skills/files/route.ts`,
  como texto plano o como descarga, nunca con un tipo que el navegador ejecute
  (`core/skills/http.ts`). El `POST` verifica el origen a mano: un route handler
  no trae el chequeo de las server actions.
- El zip se lee en `adapters/skill-zip.ts` (`fflate` no entra a `core`). Los
  topes se miran en el tamaño declarado de cada entrada antes de descomprimir.
- Los archivos que ninguna fila referencia quedan en el bucket: no hay limpieza
  todavía.
- Habilitar skills en una empresa es agregar `skill` a las categorías de su
  brain desde la consola de plataforma.
```

Y en la lista de migraciones de "Qué viaja con el módulo", sumar `20261020120000_brain_skills`.

- [ ] **Step 2: Documentación de conexión y roadmap**

En `docs/brain-mcp-conexion.md`, al final de la sección "## Qué podés hacer", agregar:

```markdown
Las skills de la empresa (todo lo que está bajo `skills/`) no salen por estas tres tools: se arman y se publican desde la plataforma.
```

En `docs/01-roadmap-etapas.md`, en la entrada de la Etapa 24, reemplazar `plan a escribir` por `` `docs/superpowers/plans/2026-10-11-etapa-24-1-skills-paquete-publicacion.md` `` y, en el ítem **24.1**, agregar al principio `Código terminado; falta el cierre en producción (spec §12).` **No** marcar el checkbox: la entrega se cierra con el criterio de la spec §1 en producción.

- [ ] **Step 3: Preparar la base local**

Run: `npm run db:reset`

Con la base local arriba, agregar la categoría `skill` al brain de la empresa `demo` desde `/plataforma/demo` entrando como el `platform_admin` de la semilla (`admin-seed@innov.as`). Si esa empresa no tiene brain, crearlo desde la misma consola.

- [ ] **Step 4: Pasada en navegador**

Invocar la skill `/qa` contra el servidor local (`npm run dev` lo levanta la herramienta de preview, no Bash) y recorrer, con tres personas de la empresa `demo` (un `tenant_admin`, un miembro con regla `editor` sobre `skills` y un miembro con regla `lector` sobre `skills`; las reglas se dan desde el diálogo de compartir del brain):

1. El editor crea `skills/facturacion` con categoría `skill`, escribe el texto, pone la descripción en el frontmatter y guarda.
2. El editor sube `scripts/calc.py` y un `.png`; los ve listados con su tamaño. Intenta subir con ruta `../x`: lo rechaza con el mensaje de ruta inválida.
3. El editor importa un zip de un paquete estándar: el texto y los archivos del borrador pasan a ser los del zip.
4. El editor no ve "Revisar y publicar". El lector no ve la skill en el árbol y la URL directa responde "No existe la página".
5. El administrador abre "Revisar y publicar": ve el texto, los archivos agregados y el aviso de nota obligatoria. Publica. El estado pasa a "Publicada v1".
6. El lector ahora ve la skill en el árbol, la abre, ve el texto publicado y la lista de archivos; abre `scripts/calc.py` y lo ve como texto. No tiene botón "Historial".
7. El editor cambia el texto y guarda. El árbol le muestra la marca de pendiente. El lector recarga y sigue viendo el texto de la v1.
8. El administrador republica la v1 desde "Versiones" y después publica el borrador nuevo: quedan v2 y v3 en la lista.
9. El administrador intenta borrar la skill: el diálogo responde que hay que retirarla. La retira; el lector deja de verla; la borra.
10. Crear `skills/a/reporte` y `skills/b/reporte`, publicar la primera e intentar publicar la segunda: el mensaje nombra el choque de nombre.

Para cada paso que falle: corregir, volver a correr `npm test` y repetir el paso. Guardar una captura de los pasos 5, 6 y 7.

- [ ] **Step 5: Las tools del brain, por MCP, en local**

Con el servidor local arriba, conectar el MCP del brain de `demo` (ver `docs/brain-mcp-conexion.md`, con la URL local) entrando como el administrador y comprobar con una skill publicada: `brain_search` con consulta vacía y categoría sin filtrar no la lista; `brain_read` de `skills/facturacion` responde `not_found`; `brain_upsert` sobre `skills/nueva` responde `forbidden`.

- [ ] **Step 6: Chequeo final y commit**

```bash
npm test
npm run typecheck
npm run db:test
npx biome check lib/brain app/\[tenant\]/brain components/brain tests/brain
git add lib/brain/README.md docs/01-roadmap-etapas.md docs/brain-mcp-conexion.md
git commit -m "docs: skills en el README del brain, la guia de conexion y el roadmap"
```

Expected: todo limpio.

- [ ] **Step 7: Avisar lo que queda para el cierre en producción**

No desplegar. Dejarle escrito a la persona, al terminar, estos puntos de la spec §12:

1. Antes de desplegar, correr en producción `select tenant_id, slug, category from brain_pages where slug like 'skills/%' and category <> 'skill';`. Si devuelve filas, esas páginas dejarían de poder guardarse (el invariante de S3): hay que moverlas o recategorizarlas antes.
2. `npx supabase migration list` contra producción y confirmar qué más hay pendiente: `db push` aplica todas.
3. Aplicar la migración antes que el código.
4. Después del deploy, agregar la categoría `skill` al brain de `innovas` desde `/plataforma/innovas` y recorrer el criterio de cierre de la spec §1.
