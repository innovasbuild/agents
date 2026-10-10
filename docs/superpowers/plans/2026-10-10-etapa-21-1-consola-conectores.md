# Etapa 21.1: conectores y agentes desde la consola de plataforma: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador de plataforma dé de alta una empresa eligiendo sus agentes, le asocie sus conectores, le cree el brain y vea qué le falta, todo desde `/plataforma`, sin terminal y sin que ninguna llave pase por la plataforma.

**Architecture:** Seis funciones SQL `security definer` que solo `service_role` ejecuta hacen cada cambio con su evento en una transacción; una tabla `connector_claims` hace imposible que un conector sirva a dos empresas; las server actions de la consola pasan por `requirePlatformAdmin()` y llaman a esas funciones con el cliente admin, verificando antes contra Vercel que cada conector exista. Un catálogo de agentes en código alimenta el alta, la consola y la página Conectar.

**Tech Stack:** Postgres (Supabase), pgTAP, Next.js 16 App Router, `@supabase/ssr`, `@vercel/connect` 1.0 (`getConnectorMetadata`), shadcn (`components/ui`), Vitest en entorno `node`.

**Spec:** `docs/superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md`

## Global Constraints

- Rama: `feat/etapa-21-1-consola`, parte de `main` (28dd238, PR 86 mergeado). No hacer push ni abrir PR sin que lo pida la persona.
- Antes de escribir SQL, cargar la skill `supabase-postgres-best-practices`. Toda función nueva es `security definer set search_path = ''`, con `revoke execute ... from public, anon, authenticated` (en este proyecto `ALTER DEFAULT PRIVILEGES` da EXECUTE a `anon` y `authenticated`, así que `from public` solo no alcanza) y `grant execute ... to service_role`. Ninguna función decide permisos (spec K1): confía en quien la llama con la clave de servicio.
- `events` es append-only: solo `insert`. Toda función de escritura deja su evento con `actor_user_id = p_actor`.
- **Ninguna pantalla, acción, log ni mensaje muestra o recibe una llave.** Solo identificadores de conectores de Vercel Connect, que no son secretos.
- `lib/connectors/auth.ts` sigue siendo el único archivo que importa `@vercel/connect` (`tests/connectors/import-rule.test.ts` lo exige).
- Las server actions de la consola llaman `requirePlatformAdmin()` **fuera** de cualquier `try` (puede tirar un redirect), validan con zod, y llaman las funciones SQL con `createAdminClient()` (las funciones no son ejecutables por `authenticated`).
- Traducción de errores de las funciones: un error de Postgres con `hint = 'consola'` lleva un mensaje en castellano escrito para la persona; la acción lo devuelve tal cual. Cualquier otro error devuelve "No se pudo guardar. Probá de nuevo." y deja el detalle en `console.error`.
- Códigos: reglas de negocio de las funciones → `errcode '23514'` con `hint = 'consola'`; conector ya reclamado → `errcode '23505'` con `hint = 'consola'`.
- Español rioplatense en UI y mensajes; código e identificadores en inglés. Nada específico de un tenant en código.
- Tests: `tests/**/*.test.ts`, entorno `node`, componentes con `createElement` y `renderToStaticMarkup`. SQL: `supabase/tests/*.test.sql` con pgTAP.
- Lint: **no** correr `npm run lint:fix` (reformatea 26 archivos ajenos). Usar `npx biome check --write <archivos de la tarea>`.
- Después de cada tarea: `npm run typecheck` limpio. Cada commit termina con la línea `Co-Authored-By` del modelo que lo escribe. Identidad de git: `innovasbuild` / `matias@innov.as`. `git add` solo de los archivos de la tarea. Hay dos rutas sin trackear ajenas que no se tocan: `.codex/` y `docs/producto-innovas-ai-os.md`.
- Base local: Docker abierto y `npm run db:start`. `npm run db:test` hace `db reset --no-seed` y corre pgTAP. Después de aplicar una migración: `npm run db:reset && npm run db:types`. **No** aplicar nada en producción.
- No usar `.env.local` para levantar servidores: trae claves de Vercel.

## Review Focus

1. **Un identificador de conector reutilizado dentro de la misma empresa** (dos capacidades con la misma llave): la función lo rechaza con un mensaje distinto al de "otra empresa", y no deja ningún reclamo a medias. Tarea 1.
2. **Re-asociar una conexión con menos identificadores** (Apollo pasa de tres llaves a una): los reclamos sobrantes se liberan y otra empresa puede usarlos. Tarea 1.
3. **`getConnectorMetadata` tira por red u OIDC en producción**: la acción no escribe nada y dice "No pude verificar el conector en Vercel. Probá de nuevo."; nunca guarda la fila como verificada. Tareas 3 y 5.
4. **Una empresa cuyo brain ya existe con otro proveedor** (`mcp`): "Crear brain" no puede crear un segundo; el mensaje lo dice. Tareas 1 y 5.
5. **Backfill con el mismo identificador en dos empresas en producción**: la migración falla nombrando el identificador antes de tocar nada. Tarea 1, y la consulta previa del despliegue en la spec §9.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261015120000_platform_console.sql` (nuevo) | Columnas de verificación, `connector_claims`, candado de `tenant_agents`, las seis funciones, baja de `create_tenant` |
| `supabase/tests/29_platform_console.test.sql` (nuevo), `20_auth_methods_create_tenant.test.sql` (modifica) | pgTAP |
| `lib/agents/catalog.ts` (nuevo) | Catálogo de agentes |
| `lib/connect/connectables.ts` (modifica) | Lee del catálogo |
| `lib/connectors/auth.ts` (modifica) | `describeConnector` |
| `lib/connectors/verify.ts` (nuevo) | `checkConnectors`, puro |
| `lib/tenants/tenant-create.ts`, `app/plataforma/nueva/create-form.tsx`, `app/plataforma/nueva/actions.ts` (modifica) | Alta con agentes |
| `lib/tenants/readiness.ts` (nuevo) | `tenantReadiness`, puro |
| `app/plataforma/[slug]/console-actions.ts` (nuevo) | Las seis acciones |
| `app/plataforma/[slug]/console/*.tsx` (nuevos) | Componentes cliente de las secciones |
| `app/plataforma/[slug]/page.tsx`, `app/plataforma/page.tsx` (modifica) | Secciones y columna de estado |
| `scripts/connections-bind*`, `tests/scripts/connections-bind-*` (borra), `package.json`, `CLAUDE.md` (modifica) | Baja del script |
| `docs/llaves-de-clientes.md` (nuevo), `docs/01-roadmap-etapas.md` (modifica) | Procedimiento y roadmap |

---

### Task 1: La base

**Files:**
- Create: `supabase/migrations/20261015120000_platform_console.sql`
- Create: `supabase/tests/29_platform_console.test.sql`
- Modify: `supabase/tests/20_auth_methods_create_tenant.test.sql`
- Modify (generado): `lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `public.tenant_connections`, `public.tenant_agents`, `public.brain_access_rules`, `public.events`, enum `public.connector_capability`, índice `tenant_connections_one_brain`.
- Produces (RPC, solo `service_role`): `platform_create_tenant(p_actor uuid, p_slug text, p_display_name text, p_allowed_domains text[], p_auth_methods text[], p_brand jsonb, p_agents text[]) → uuid`; `platform_set_agent(p_actor uuid, p_tenant uuid, p_agent text, p_enabled boolean, p_brain text) → void`; `platform_bind_connection(p_actor uuid, p_tenant uuid, p_capability public.connector_capability, p_provider text, p_connector_uids text[], p_config jsonb, p_verified_name text) → uuid`; `platform_set_connection_enabled(p_actor uuid, p_connection uuid, p_enabled boolean) → void`; `platform_remove_connection(p_actor uuid, p_connection uuid) → void`; `platform_mark_connection_verified(p_actor uuid, p_connection uuid, p_verified_name text) → void`. Columnas nuevas en `tenant_connections`: `verified_at timestamptz`, `verified_name text`, `updated_by uuid`. Tabla `connector_claims (connector_uid, tenant_id, connection_id, created_at)`. `create_tenant` deja de existir.

- [ ] **Step 1: Cargar la skill de Postgres**

Invocar `supabase-postgres-best-practices`.

- [ ] **Step 2: Escribir el pgTAP que falla**

```sql
-- supabase/tests/29_platform_console.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

-- Personas: 1 administra la plataforma (actor), 2 es tenant_admin de pc-a, 3 miembro de pc-a.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c9c9c9c9-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'plat@pc.test', now()),
  ('c9c9c9c9-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adm@pc-a.test', now()),
  ('c9c9c9c9-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mem@pc-a.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d9d9d9d9-0000-0000-0000-00000000000a', 'pc-a', 'PC A'),
  ('d9d9d9d9-0000-0000-0000-00000000000b', 'pc-b', 'PC B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d9d9d9d9-0000-0000-0000-00000000000a', 'c9c9c9c9-0000-0000-0000-000000000002', 'tenant_admin'),
  ('d9d9d9d9-0000-0000-0000-00000000000a', 'c9c9c9c9-0000-0000-0000-000000000003', 'tenant_member');

insert into public.tenant_agents (tenant_id, agent, config)
values ('d9d9d9d9-0000-0000-0000-00000000000a', 'outreach', '{"brain": "read"}');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c9c9c9c9-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

-- 1-9: privilegios. Las funciones son solo del servidor; las tablas no se
-- escriben con la sesión; create_tenant ya no existe.
select hasnt_function('public', 'create_tenant', 'create_tenant se fue');
select ok(not has_function_privilege('authenticated', 'public.platform_create_tenant(uuid, text, text, text[], text[], jsonb, text[])', 'execute'), 'authenticated no crea empresas');
select ok(not has_function_privilege('anon', 'public.platform_bind_connection(uuid, uuid, public.connector_capability, text, text[], jsonb, text)', 'execute'), 'anon no asocia conectores');
select ok(not has_function_privilege('authenticated', 'public.platform_set_agent(uuid, uuid, text, boolean, text)', 'execute'), 'authenticated no toca agentes');
select ok(not has_function_privilege('authenticated', 'public.platform_remove_connection(uuid, uuid)', 'execute'), 'authenticated no quita conectores');
select ok(has_function_privilege('service_role', 'public.platform_bind_connection(uuid, uuid, public.connector_capability, text, text[], jsonb, text)', 'execute'), 'service_role sí');
select pg_temp.login_as(2);
select throws_ok(
  $$update public.tenant_agents set config = '{"brain":"read_write"}' where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a'$$,
  '42501', null, 'un tenant_admin ya no cambia el acceso al brain por la API');
select throws_ok(
  $$insert into public.connector_claims (connector_uid, tenant_id, connection_id) values ('x', 'd9d9d9d9-0000-0000-0000-00000000000a', gen_random_uuid())$$,
  '42501', null, 'nadie escribe los reclamos por la API');
select is((select count(*)::int from public.tenant_agents where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a'), 1, 'un miembro sigue leyendo sus agentes');
reset role;

-- 10-14: platform_create_tenant.
select is(
  (select count(*)::int from public.tenant_agents ta join public.tenants t on t.id = ta.tenant_id
    where t.slug = 'pc-nueva'), 0, 'antes del alta no hay nada');
select lives_ok(
  $$select public.platform_create_tenant('c9c9c9c9-0000-0000-0000-000000000001', 'pc-nueva', 'PC Nueva', '{nueva.test}', '{email}', '{}'::jsonb, '{outreach,soporte}')$$,
  'crea la empresa con dos agentes');
select is(
  (select array_agg(ta.agent order by ta.agent) from public.tenant_agents ta join public.tenants t on t.id = ta.tenant_id
    where t.slug = 'pc-nueva' and ta.enabled and ta.config ->> 'brain' = 'read_write'),
  array['outreach', 'soporte'], 'los dos agentes nacen activos con brain read_write');
select is(
  (select e.payload -> 'agents' from public.events e join public.tenants t on t.id = e.tenant_id
    where t.slug = 'pc-nueva' and e.type = 'tenant.created' and e.actor_user_id = 'c9c9c9c9-0000-0000-0000-000000000001'),
  '["outreach","soporte"]'::jsonb, 'el evento dice quién y con qué agentes');
select throws_ok(
  $$select public.platform_create_tenant('c9c9c9c9-0000-0000-0000-000000000001', 'pc-otra', 'Otra', '{}', '{email}', '{}'::jsonb, '{}')$$,
  '23514', 'la empresa necesita al menos un agente', 'sin agentes no se crea');
select throws_ok(
  $$select public.platform_create_tenant('c9c9c9c9-0000-0000-0000-000000000001', 'pc-otra', 'Otra', '{}', '{email}', '{}'::jsonb, '{outreach,outreach}')$$,
  '23514', 'la lista de agentes tiene repetidos', 'agentes repetidos no se crean');

-- 15-18: platform_set_agent.
select lives_ok(
  $$select public.platform_set_agent('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'outreach', false, 'none')$$,
  'apaga el agente y le saca el brain');
select is(
  (select (enabled, config ->> 'brain') from public.tenant_agents where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and agent = 'outreach'),
  (false, 'none'), 'quedó apagado y sin brain');
select lives_ok(
  $$select public.platform_set_agent('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000b', 'soporte', true, 'read')$$,
  'habilita un agente que la empresa no tenía');
select throws_ok(
  $$select public.platform_set_agent('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'outreach', true, 'todo')$$,
  '23514', 'el acceso al brain tiene que ser none, read o read_write', 'un acceso desconocido falla');

-- 19-28: platform_bind_connection y los reclamos.
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'leads', 'coldiq', '{pc-a-coldiq}', '{}'::jsonb, 'PC A ColdIQ')$$,
  'asocia un conector');
select is(
  (select (connector_uid, verified_name, verified_at is not null, enabled, updated_by) from public.tenant_connections
    where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'coldiq'),
  ('pc-a-coldiq', 'PC A ColdIQ', true, true, 'c9c9c9c9-0000-0000-0000-000000000001'::uuid),
  'guarda el identificador, la verificación y quién lo hizo');
select is(
  (select tenant_id from public.connector_claims where connector_uid = 'pc-a-coldiq'),
  'd9d9d9d9-0000-0000-0000-00000000000a'::uuid, 'el conector queda reclamado por la empresa');
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000b', 'leads', 'coldiq', '{pc-a-coldiq}', '{}'::jsonb, null)$$,
  '23505', 'el conector pc-a-coldiq ya está asociado a otra empresa', 'otra empresa no puede usar el mismo conector');
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'leads', 'google-places', '{pc-a-coldiq}', '{}'::jsonb, null)$$,
  '23505', 'el conector pc-a-coldiq ya está asociado a otra conexión de esta empresa', 'ni la misma empresa en otra conexión');
select is(
  (select count(*)::int from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'google-places'),
  0, 'el rechazo no deja la conexión a medias');
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'leads', 'apollo', '{pc-a-ap1,pc-a-ap2,pc-a-ap3}', '{}'::jsonb, null)$$,
  'Apollo acepta varios identificadores');
select is(
  (select (connector_uid, config -> 'connectorUids', verified_at) from public.tenant_connections
    where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'apollo'),
  ('pc-a-ap1', '["pc-a-ap1","pc-a-ap2","pc-a-ap3"]'::jsonb, null::timestamptz),
  'el primero va a connector_uid, todos a config.connectorUids, sin verificar');
select is((select count(*)::int from public.connector_claims where connector_uid like 'pc-a-ap%'), 3, 'reclama los tres');
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'leads', 'apollo', '{pc-a-ap1}', '{}'::jsonb, null)$$,
  'volver a asociar con menos identificadores');
select is((select count(*)::int from public.connector_claims where connector_uid like 'pc-a-ap%'), 1, 'libera los que ya no están');

-- 29-30: los liberados los puede usar otra empresa; repetidos en la lista fallan.
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000b', 'leads', 'apollo', '{pc-a-ap2}', '{}'::jsonb, null)$$,
  'otra empresa toma un identificador liberado');
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000b', 'leads', 'coldiq', '{dup,dup}', '{}'::jsonb, null)$$,
  '23514', 'la lista de identificadores tiene repetidos', 'repetidos en la misma lista');

-- 31-35: brain.
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'brain', 'wiki', '{}', '{"categories":["empresa"],"requiredFrontmatter":["title"],"search":"fts"}'::jsonb, null)$$,
  'crea el brain');
select is(
  (select level::text from public.brain_access_rules where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and path = '' and principal = 'members'),
  'lector', 'el brain nace con la regla de la raíz');
update public.brain_access_rules set level = 'editor' where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and path = '';
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'brain', 'wiki', '{}', '{"categories":["empresa","producto"],"requiredFrontmatter":["title"],"search":"fts"}'::jsonb, null)$$,
  'volver a crear el brain actualiza la configuración');
select is(
  (select level::text from public.brain_access_rules where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and path = ''),
  'editor', 'y no pisa la regla de la raíz');
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'brain', 'mcp', '{pc-a-brain-ext}', '{}'::jsonb, null)$$,
  '23514', 'la empresa ya tiene un brain', 'un segundo brain con otro proveedor falla');

-- 36-40: habilitar, verificar, quitar.
select lives_ok(
  $$select public.platform_set_connection_enabled('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'coldiq'), false)$$,
  'deshabilita');
select is(
  (select string_agg(type, ',' order by id) from public.events where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and type in ('connection.disabled')),
  'connection.disabled', 'deja el evento');
select lives_ok(
  $$select public.platform_mark_connection_verified('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'apollo'), 'Apollo PC A')$$,
  'marca verificado');
select is(
  (select (verified_name, verified_at is not null) from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'apollo'),
  ('Apollo PC A', true), 'quedó verificado con su nombre');
select throws_ok(
  $$select public.platform_remove_connection('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and capability = 'brain'))$$,
  '23514', 'el brain no se quita desde la consola', 'el brain no se quita');

-- 41-44: quitar libera los reclamos; una conexión inexistente falla.
select lives_ok(
  $$select public.platform_remove_connection('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'apollo'))$$,
  'quita Apollo');
select is((select count(*)::int from public.connector_claims where connector_uid = 'pc-a-ap1'), 0, 'y libera su reclamo');
select is(
  (select count(*)::int from public.events where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and type = 'connection.removed'),
  1, 'con su evento');
select throws_ok(
  $$select public.platform_remove_connection('c9c9c9c9-0000-0000-0000-000000000001', gen_random_uuid())$$,
  'P0002', null, 'una conexión que no existe falla');

select * from finish();
rollback;
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npm run db:test 2>&1 | tail -20`
Expected: `29_platform_console.test.sql` falla desde la primera aserción (`create_tenant` todavía existe). Los demás pasan.

- [ ] **Step 4: Escribir la migración**

```sql
-- supabase/migrations/20261015120000_platform_console.sql
-- Consola de plataforma: conectores y agentes (spec 2026-10-10-etapa-21-1).
--
-- 1. tenant_connections sabe si Vercel confirmó el conector y quién tocó la fila.
-- 2. connector_claims: un conector es de una sola empresa. Asociar a la empresa
--    B el conector de la A es darle las credenciales de A; la clave primaria lo
--    hace imposible, también para las llaves de respaldo de Apollo.
-- 3. tenant_agents se cierra a authenticated como memberships: lo que un
--    administrador de cliente pueda configurar llega en 21.2 por funciones.
-- 4. Seis funciones security definer que solo service_role ejecuta. No deciden
--    permisos (is_platform_admin() acepta una fila platform_admin de cualquier
--    tenant): el gate es requirePlatformAdmin en la app. Cada una deja su evento
--    en la misma transacción. Las reglas de negocio salen con errcode 23514 (o
--    23505 para un conector ya reclamado) y hint 'consola': la app muestra ese
--    mensaje tal cual.
alter table public.tenant_connections
  add column verified_at timestamptz,
  add column verified_name text check (verified_name is null or length(verified_name) between 1 and 200),
  add column updated_by uuid references auth.users (id) on delete set null;

create index tenant_connections_updated_by_idx on public.tenant_connections (updated_by);

create table public.connector_claims (
  connector_uid text primary key check (length(connector_uid) between 1 and 200),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null references public.tenant_connections (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index connector_claims_tenant_id_idx on public.connector_claims (tenant_id);
create index connector_claims_connection_id_idx on public.connector_claims (connection_id);

alter table public.connector_claims enable row level security;

create policy connector_claims_select on public.connector_claims
  for select to authenticated
  using ((select public.is_platform_admin()));

revoke all on public.connector_claims from anon;
revoke insert, update, delete, truncate on public.connector_claims from authenticated;
grant select on public.connector_claims to authenticated;

-- Backfill. Un identificador en dos empresas es un hecho que una persona
-- tiene que resolver antes: la migración falla nombrándolo.
do $$
declare
  v_uid text;
begin
  select u.uid into v_uid
  from (
    select c.connector_uid as uid, c.tenant_id
    from public.tenant_connections c
    where c.connector_uid is not null
    union all
    select jsonb_array_elements_text(c.config -> 'connectorUids'), c.tenant_id
    from public.tenant_connections c
    where jsonb_typeof(c.config -> 'connectorUids') = 'array'
  ) u
  group by u.uid
  having count(distinct u.tenant_id) > 1
  limit 1;

  if v_uid is not null then
    raise exception 'el conector % está asociado a más de una empresa: resolvelo antes de aplicar esta migración', v_uid;
  end if;
end $$;

insert into public.connector_claims (connector_uid, tenant_id, connection_id)
select distinct on (u.uid) u.uid, u.tenant_id, u.id
from (
  select c.connector_uid as uid, c.tenant_id, c.id
  from public.tenant_connections c
  where c.connector_uid is not null
  union all
  select jsonb_array_elements_text(c.config -> 'connectorUids'), c.tenant_id, c.id
  from public.tenant_connections c
  where jsonb_typeof(c.config -> 'connectorUids') = 'array'
) u
order by u.uid, u.id;

-- Candado de tenant_agents.
drop policy if exists tenant_agents_insert on public.tenant_agents;
drop policy if exists tenant_agents_update on public.tenant_agents;
drop policy if exists tenant_agents_delete on public.tenant_agents;
revoke insert, update, delete on public.tenant_agents from authenticated, anon;

drop function public.create_tenant(text, text, text[], text[], jsonb);

create or replace function public.platform_create_tenant(
  p_actor uuid,
  p_slug text,
  p_display_name text,
  p_allowed_domains text[],
  p_auth_methods text[],
  p_brand jsonb,
  p_agents text[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_agent text;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if p_agents is null or cardinality(p_agents) = 0 then
    raise exception 'la empresa necesita al menos un agente' using errcode = '23514', hint = 'consola';
  end if;
  if (select count(distinct a) from unnest(p_agents) a) <> cardinality(p_agents) then
    raise exception 'la lista de agentes tiene repetidos' using errcode = '23514', hint = 'consola';
  end if;

  insert into public.tenants (slug, display_name, allowed_domains, auth_methods, brand)
  values (p_slug, p_display_name, coalesce(p_allowed_domains, '{}'), p_auth_methods, coalesce(p_brand, '{}'::jsonb))
  returning id into v_id;

  foreach v_agent in array p_agents loop
    insert into public.tenant_agents (tenant_id, agent, config)
    values (v_id, v_agent, '{"brain": "read_write"}'::jsonb);
  end loop;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_id, p_actor, 'tenant.created', p_display_name,
          jsonb_build_object('slug', p_slug, 'agents', to_jsonb(p_agents)));

  return v_id;
end;
$$;

create or replace function public.platform_set_agent(
  p_actor uuid, p_tenant uuid, p_agent text, p_enabled boolean, p_brain text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if p_brain not in ('none', 'read', 'read_write') then
    raise exception 'el acceso al brain tiene que ser none, read o read_write' using errcode = '23514', hint = 'consola';
  end if;

  insert into public.tenant_agents (tenant_id, agent, enabled, config)
  values (p_tenant, p_agent, p_enabled, jsonb_build_object('brain', p_brain))
  on conflict (tenant_id, agent) do update
    set enabled = excluded.enabled,
        config = coalesce(public.tenant_agents.config, '{}'::jsonb) || jsonb_build_object('brain', p_brain);

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'agent.updated', p_agent,
          jsonb_build_object('agent', p_agent, 'enabled', p_enabled, 'brain', p_brain));
end;
$$;

create or replace function public.platform_bind_connection(
  p_actor uuid,
  p_tenant uuid,
  p_capability public.connector_capability,
  p_provider text,
  p_connector_uids text[],
  p_config jsonb,
  p_verified_name text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uids text[] := coalesce(p_connector_uids, '{}');
  v_uid text;
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
  v_id uuid;
  v_owner uuid;
  v_connection uuid;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if (select count(distinct u) from unnest(v_uids) u) <> cardinality(v_uids) then
    raise exception 'la lista de identificadores tiene repetidos' using errcode = '23514', hint = 'consola';
  end if;
  if p_capability = 'brain' and exists (
    select 1 from public.tenant_connections c
    where c.tenant_id = p_tenant and c.capability = 'brain' and c.enabled and c.provider <> p_provider
  ) then
    raise exception 'la empresa ya tiene un brain' using errcode = '23514', hint = 'consola';
  end if;

  -- Un identificador ya reclamado por otra conexión se rechaza antes de tocar
  -- nada; la clave primaria sigue siendo la red contra una carrera.
  foreach v_uid in array v_uids loop
    select k.tenant_id, k.connection_id into v_owner, v_connection
    from public.connector_claims k where k.connector_uid = v_uid;
    if v_owner is not null and v_owner <> p_tenant then
      raise exception 'el conector % ya está asociado a otra empresa', v_uid using errcode = '23505', hint = 'consola';
    end if;
    if v_owner is not null and not exists (
      select 1 from public.tenant_connections c
      where c.id = v_connection and c.tenant_id = p_tenant and c.capability = p_capability and c.provider = p_provider
    ) then
      raise exception 'el conector % ya está asociado a otra conexión de esta empresa', v_uid using errcode = '23505', hint = 'consola';
    end if;
  end loop;

  if p_provider = 'apollo' then
    v_config := v_config || jsonb_build_object('connectorUids', to_jsonb(v_uids));
  else
    v_config := v_config - 'connectorUids';
  end if;

  insert into public.tenant_connections
    (tenant_id, capability, provider, connector_uid, config, enabled, verified_at, verified_name, updated_by, updated_at)
  values
    (p_tenant, p_capability, p_provider,
     case when cardinality(v_uids) >= 1 then v_uids[1] end,
     v_config, true,
     case when p_verified_name is null then null else now() end,
     p_verified_name, p_actor, now())
  on conflict (tenant_id, capability, provider) do update
    set connector_uid = excluded.connector_uid,
        config = excluded.config,
        enabled = true,
        verified_at = excluded.verified_at,
        verified_name = excluded.verified_name,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning id into v_id;

  delete from public.connector_claims where connection_id = v_id;
  begin
    insert into public.connector_claims (connector_uid, tenant_id, connection_id)
    select u, p_tenant, v_id from unnest(v_uids) u;
  exception when unique_violation then
    raise exception 'uno de los conectores ya está asociado a otra empresa' using errcode = '23505', hint = 'consola';
  end;

  if p_capability = 'brain' then
    insert into public.brain_access_rules (tenant_id, path, principal, user_id, level, created_by)
    values (p_tenant, '', 'members', null, 'lector', p_actor)
    on conflict do nothing;
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'connection.bound', p_capability || '/' || p_provider,
          jsonb_build_object('capability', p_capability, 'provider', p_provider,
                             'connector_uid', case when cardinality(v_uids) >= 1 then v_uids[1] end,
                             'connector_uids', to_jsonb(v_uids), 'binding_id', v_id, 'actor', 'consola'));

  return v_id;
end;
$$;

create or replace function public.platform_set_connection_enabled(
  p_actor uuid, p_connection uuid, p_enabled boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_summary text;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;

  update public.tenant_connections
     set enabled = p_enabled, updated_by = p_actor, updated_at = now()
   where id = p_connection
  returning tenant_id, capability || '/' || provider into v_tenant, v_summary;
  if v_tenant is null then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_tenant, p_actor, case when p_enabled then 'connection.enabled' else 'connection.disabled' end,
          v_summary, jsonb_build_object('connection_id', p_connection));
end;
$$;

create or replace function public.platform_remove_connection(
  p_actor uuid, p_connection uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.tenant_connections%rowtype;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;

  select * into v_row from public.tenant_connections where id = p_connection;
  if v_row.id is null then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;
  if v_row.capability = 'brain' then
    raise exception 'el brain no se quita desde la consola' using errcode = '23514', hint = 'consola';
  end if;

  delete from public.tenant_connections where id = p_connection;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_row.tenant_id, p_actor, 'connection.removed', v_row.capability || '/' || v_row.provider,
          jsonb_build_object('connection_id', p_connection, 'provider', v_row.provider,
                             'connector_uid', v_row.connector_uid));
end;
$$;

create or replace function public.platform_mark_connection_verified(
  p_actor uuid, p_connection uuid, p_verified_name text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_summary text;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;

  update public.tenant_connections
     set verified_at = case when p_verified_name is null then null else now() end,
         verified_name = p_verified_name,
         updated_by = p_actor,
         updated_at = now()
   where id = p_connection
  returning tenant_id, capability || '/' || provider into v_tenant, v_summary;
  if v_tenant is null then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_tenant, p_actor, case when p_verified_name is null then 'connection.unverified' else 'connection.verified' end,
          v_summary, jsonb_build_object('connection_id', p_connection, 'verified_name', p_verified_name));
end;
$$;

revoke execute on function public.platform_create_tenant(uuid, text, text, text[], text[], jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.platform_set_agent(uuid, uuid, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.platform_bind_connection(uuid, uuid, public.connector_capability, text, text[], jsonb, text) from public, anon, authenticated;
revoke execute on function public.platform_set_connection_enabled(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.platform_remove_connection(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.platform_mark_connection_verified(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.platform_create_tenant(uuid, text, text, text[], text[], jsonb, text[]) to service_role;
grant execute on function public.platform_set_agent(uuid, uuid, text, boolean, text) to service_role;
grant execute on function public.platform_bind_connection(uuid, uuid, public.connector_capability, text, text[], jsonb, text) to service_role;
grant execute on function public.platform_set_connection_enabled(uuid, uuid, boolean) to service_role;
grant execute on function public.platform_remove_connection(uuid, uuid) to service_role;
grant execute on function public.platform_mark_connection_verified(uuid, uuid, text) to service_role;
```

- [ ] **Step 5: Actualizar `supabase/tests/20_auth_methods_create_tenant.test.sql`**

`create_tenant` ya no existe y el alta la hace el servidor. Reemplazar desde el comentario `-- platform_admin crea una empresa y su agente en una sola llamada.` hasta el final del archivo (antes de `select * from finish();`) por:

```sql
-- El alta la hace el servidor (service_role) desde la consola, con el actor
-- explícito. Ningún rol de sesión puede llamarla.
select lives_ok(
  $$select public.platform_create_tenant('11111111-1111-1111-1111-111111111111', 'acme', 'Acme', '{acme.test}', '{email}', '{"primary":"#112233"}'::jsonb, '{outreach}')$$,
  'el servidor crea una empresa'
);

select is(
  (select count(*)::int from public.tenant_agents ta
     join public.tenants t on t.id = ta.tenant_id
   where t.slug = 'acme' and ta.agent = 'outreach' and ta.enabled),
  1,
  'la empresa nueva nace con el agente elegido activo'
);

select is(
  (select auth_methods from public.tenants where slug = 'acme'),
  array['email'],
  'la empresa nueva guarda los métodos elegidos'
);

select throws_ok(
  $$select public.platform_create_tenant('11111111-1111-1111-1111-111111111111', 'acme', 'Acme 2', '{}', '{email}', '{}'::jsonb, '{outreach}')$$,
  '23505', null, 'un slug repetido falla con unique_violation'
);

select ok(
  not has_function_privilege('authenticated', 'public.platform_create_tenant(uuid, text, text, text[], text[], jsonb, text[])', 'execute'),
  'ninguna sesión puede crear empresas: lo hace el servidor'
);
```

Y dejar `select plan(8);` como está (sigue habiendo 8 aserciones: 3 + 5).

- [ ] **Step 6: Correr y ver que pasa**

Run: `npm run db:test 2>&1 | tail -25`
Expected: todo en verde, con `29` en 44 aserciones. Si una aserción de `29` falla, primero decidir si es el armado del test (una columna `not null`, una regla de otra migración) o la función; corregir el que corresponda, sin cambiar los valores esperados. Si el conteo de `plan()` no coincide, corregir el número.

- [ ] **Step 7: Regenerar tipos y commit**

```bash
npm run db:reset && npm run db:types
npm run typecheck
```

El typecheck va a fallar en `app/plataforma/nueva/actions.ts` porque `create_tenant` desapareció de los tipos. Es esperado: lo arregla la Tarea 4. Anotarlo en el reporte y commitear igual, porque la base y los tipos tienen que ir juntos.

```bash
git add supabase/migrations/20261015120000_platform_console.sql supabase/tests/29_platform_console.test.sql supabase/tests/20_auth_methods_create_tenant.test.sql lib/supabase/database.types.ts
git commit -m "feat: funciones de consola para agentes y conectores, reclamos de conector y candado de tenant_agents"
```

---

### Task 2: Catálogo de agentes

**Files:**
- Create: `lib/agents/catalog.ts`
- Modify: `lib/connect/connectables.ts`
- Test: `tests/agents/catalog.test.ts` (nuevo), `tests/connect/connectables.test.ts` (sin cambios; tiene que seguir pasando)

**Interfaces:**
- Consumes: `type Capability` de `lib/connectors/providers.ts` (solo tipo).
- Produces: `interface AgentCatalogEntry { name: string; description: string; capabilities: readonly Capability[]; brain: boolean }`; `AGENT_CATALOG: Record<"outreach", AgentCatalogEntry>`; `isCatalogAgent(value: string): boolean`; `catalogAgents(): string[]`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/agents/catalog.test.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	AGENT_CATALOG,
	catalogAgents,
	isCatalogAgent,
} from "@/lib/agents/catalog";

const ROOT = join(__dirname, "..", "..");

function agentDirs(): string[] {
	const dir = join(ROOT, "agents");
	return readdirSync(dir)
		.filter((name) => statSync(join(dir, name)).isDirectory())
		.filter((name) => existsSync(join(dir, name, "agent.ts")))
		.sort();
}

function nextConfigAgents(): string[] {
	const source = readFileSync(join(ROOT, "next.config.ts"), "utf8");
	const block = source.match(/agents:\s*{([^}]*)}/)?.[1] ?? "";
	return [...block.matchAll(/([a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1]).sort();
}

describe("catálogo de agentes", () => {
	it("tiene una entrada por carpeta de agents/ y nada más", () => {
		expect(catalogAgents().sort()).toEqual(agentDirs());
	});

	it("coincide con los agentes que monta next.config.ts", () => {
		expect(catalogAgents().sort()).toEqual(nextConfigAgents());
	});

	it("cada entrada tiene nombre y descripción", () => {
		for (const [agent, entry] of Object.entries(AGENT_CATALOG)) {
			expect(entry.name.trim().length, agent).toBeGreaterThan(0);
			expect(entry.description.trim().length, agent).toBeGreaterThan(0);
			expect(entry.capabilities.length, agent).toBeGreaterThan(0);
		}
	});

	it("isCatalogAgent reconoce solo las claves del catálogo", () => {
		expect(isCatalogAgent("outreach")).toBe(true);
		expect(isCatalogAgent("soporte")).toBe(false);
		expect(isCatalogAgent("toString")).toBe(false);
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/agents/catalog.test.ts`
Expected: FAIL, no resuelve `@/lib/agents/catalog`.

- [ ] **Step 3: Implementar**

```ts
// lib/agents/catalog.ts
// Catálogo de agentes de la plataforma (spec etapa 21.1 §5). Es la única
// lista: el alta de empresas, la consola y la página Conectar leen de acá, y
// un test lo compara contra las carpetas de agents/ y next.config.ts. Solo
// tipos de afuera: lo importan componentes cliente.
import type { Capability } from "../connectors/providers";

export interface AgentCatalogEntry {
	/** Nombre para la persona. */
	name: string;
	/** Qué hace, en una frase. */
	description: string;
	/** Capacidades de conector que usa; la consola avisa si falta alguna. */
	capabilities: readonly Capability[];
	/** Si el agente puede recibir acceso al brain de la empresa. */
	brain: boolean;
}

export const AGENT_CATALOG = {
	outreach: {
		name: "Agente de outreach",
		description:
			"Investiga cuentas, redacta mensajes y arma la cola de envíos de tu empresa.",
		capabilities: ["crm", "leads", "mail"],
		brain: true,
	},
} as const satisfies Record<string, AgentCatalogEntry>;

export type CatalogAgent = keyof typeof AGENT_CATALOG;

export function isCatalogAgent(value: string): value is CatalogAgent {
	return Object.hasOwn(AGENT_CATALOG, value);
}

export function catalogAgents(): CatalogAgent[] {
	return Object.keys(AGENT_CATALOG) as CatalogAgent[];
}
```

En `lib/connect/connectables.ts`: borrar `AGENT_COPY` y su comentario, sumar `import { AGENT_CATALOG, isCatalogAgent } from "../agents/catalog";` y reemplazar

```ts
		const copy = AGENT_COPY[agent] ?? {
			name: agent,
			description: "Agente de tu empresa.",
		};
```

por

```ts
		const copy = isCatalogAgent(agent)
			? AGENT_CATALOG[agent]
			: { name: agent, description: "Agente de tu empresa." };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/agents/catalog.test.ts tests/connect && npm run typecheck 2>&1 | grep -v "nueva/actions" | grep -c "error TS"`
Expected: PASS; el único error de typecheck que queda es el de `app/plataforma/nueva/actions.ts` (Tarea 4).

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/agents/catalog.ts lib/connect/connectables.ts tests/agents/catalog.test.ts
git add lib/agents/catalog.ts lib/connect/connectables.ts tests/agents/catalog.test.ts
git commit -m "feat: catálogo de agentes en código, comparado contra agents/ y next.config"
```

---

### Task 3: Verificación de conectores contra Vercel

**Files:**
- Modify: `lib/connectors/auth.ts`
- Create: `lib/connectors/verify.ts`
- Test: `tests/connectors/describe-connector.test.ts` (nuevo), `tests/connectors/verify.test.ts` (nuevo)

**Interfaces:**
- Consumes: `getConnectorMetadata`, `ConnectError` de `@vercel/connect`.
- Produces: `describeConnector(uid: string): Promise<{ name: string; service: string } | null>`; `type ConnectorCheck = { ok: true; names: Record<string, string> } | { ok: false; message: string }`; `checkConnectors(uids: string[], deps: { inVercel: boolean; describe: typeof describeConnector }): Promise<ConnectorCheck>`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/connectors/describe-connector.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	metadata: null as Record<string, unknown> | null,
	error: null as Error | null,
	calls: [] as string[],
}));

vi.mock("@vercel/connect", () => {
	class ConnectError extends Error {
		status?: number;
		constructor(message: string, options?: { status?: number }) {
			super(message);
			this.status = options?.status;
		}
	}
	return {
		ConnectError,
		NoValidTokenError: class extends ConnectError {},
		UserAuthorizationRequiredError: class extends ConnectError {},
		ConnectorInstallationRequiredError: class extends ConnectError {},
		getToken: async () => "t",
		getTokenResponse: async () => ({ token: "t", expiresAt: 0 }),
		startAuthorization: async () => ({ url: "u", expiresAt: null }),
		getConnectorMetadata: async (uid: string) => {
			state.calls.push(uid);
			if (state.error) throw state.error;
			return state.metadata;
		},
	};
});
vi.mock("@vercel/connect/eve", () => ({ connect: () => ({}) }));

const connect = await import("@vercel/connect");
const { describeConnector } = await import("@/lib/connectors/auth");

describe("describeConnector", () => {
	beforeEach(() => {
		state.metadata = { name: "Acme ColdIQ", service: "coldiq", uid: "x" };
		state.error = null;
		state.calls = [];
	});

	it("devuelve nombre y servicio del conector", async () => {
		expect(await describeConnector("acme-coldiq")).toEqual({
			name: "Acme ColdIQ",
			service: "coldiq",
		});
		expect(state.calls).toEqual(["acme-coldiq"]);
	});

	it.each([404, 403])("si Vercel responde %s, el conector no está: null", async (status) => {
		state.error = new connect.ConnectError("no", { status });
		expect(await describeConnector("x")).toBeNull();
	});

	it("cualquier otro error se propaga", async () => {
		state.error = new connect.ConnectError("boom", { status: 500 });
		await expect(describeConnector("x")).rejects.toThrow("boom");

		state.error = new Error("sin OIDC");
		await expect(describeConnector("x")).rejects.toThrow("sin OIDC");
	});
});
```

```ts
// tests/connectors/verify.test.ts
import { describe, expect, it, vi } from "vitest";
import { checkConnectors } from "@/lib/connectors/verify";

const describeOk = async (uid: string) => ({ name: `Nombre ${uid}`, service: "coldiq" });

describe("checkConnectors", () => {
	it("en Vercel, confirma cada identificador y devuelve sus nombres", async () => {
		expect(
			await checkConnectors(["a", "b"], { inVercel: true, describe: describeOk }),
		).toEqual({ ok: true, names: { a: "Nombre a", b: "Nombre b" } });
	});

	it("en Vercel, un identificador que no existe corta y lo nombra", async () => {
		const describe = async (uid: string) => (uid === "b" ? null : { name: "A", service: "s" });

		expect(await checkConnectors(["a", "b"], { inVercel: true, describe })).toEqual({
			ok: false,
			message: "El conector `b` no existe o no está adjunto a este proyecto en Vercel.",
		});
	});

	it("en Vercel, un error al consultar corta con el mensaje genérico y lo loguea", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const describe = async () => {
			throw new Error("red caída");
		};

		expect(await checkConnectors(["a"], { inVercel: true, describe })).toEqual({
			ok: false,
			message: "No pude verificar el conector en Vercel. Probá de nuevo.",
		});
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it("fuera de Vercel no consulta y no hay nombres", async () => {
		const describe = vi.fn(describeOk);

		expect(await checkConnectors(["a"], { inVercel: false, describe })).toEqual({
			ok: true,
			names: {},
		});
		expect(describe).not.toHaveBeenCalled();
	});

	it("sin identificadores no consulta", async () => {
		const describe = vi.fn(describeOk);
		expect(await checkConnectors([], { inVercel: true, describe })).toEqual({
			ok: true,
			names: {},
		});
		expect(describe).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/connectors/describe-connector.test.ts tests/connectors/verify.test.ts`
Expected: FAIL. `describeConnector` no existe; `verify` no resuelve.

- [ ] **Step 3: Implementar**

En `lib/connectors/auth.ts`, sumar `ConnectError` y `getConnectorMetadata` al import de `@vercel/connect` y agregar al final:

```ts
/**
 * ¿Existe este conector y está adjunto a este proyecto de Vercel? Es lo que
 * la consola verifica antes de asociarlo a una empresa (spec 21.1 K3). Null
 * cuando Vercel dice que no (404) o que no es de este proyecto (403);
 * cualquier otro error (red, OIDC) se propaga para que quien llama no lo
 * confunda con "no existe".
 */
export async function describeConnector(
	uid: string,
): Promise<{ name: string; service: string } | null> {
	try {
		const metadata = await getConnectorMetadata(uid);
		return { name: metadata.name, service: metadata.service };
	} catch (error) {
		if (
			error instanceof ConnectError &&
			(error.status === 404 || error.status === 403)
		) {
			return null;
		}
		throw error;
	}
}
```

Crear `lib/connectors/verify.ts`:

```ts
// Verificación de conectores antes de asociarlos (spec 21.1 §4). Pura: recibe
// quién consulta a Vercel. En Vercel es obligatoria; en local no hay OIDC y
// la fila queda "sin verificar".
export type ConnectorCheck =
	| { ok: true; names: Record<string, string> }
	| { ok: false; message: string };

export async function checkConnectors(
	uids: string[],
	deps: {
		inVercel: boolean;
		describe: (uid: string) => Promise<{ name: string; service: string } | null>;
	},
): Promise<ConnectorCheck> {
	if (!deps.inVercel || uids.length === 0) return { ok: true, names: {} };

	const names: Record<string, string> = {};
	for (const uid of uids) {
		let found: { name: string; service: string } | null;
		try {
			found = await deps.describe(uid);
		} catch (error) {
			console.error("No pude consultar el conector en Vercel:", error);
			return {
				ok: false,
				message: "No pude verificar el conector en Vercel. Probá de nuevo.",
			};
		}
		if (!found) {
			return {
				ok: false,
				message: `El conector \`${uid}\` no existe o no está adjunto a este proyecto en Vercel.`,
			};
		}
		names[uid] = found.name;
	}
	return { ok: true, names };
}

/** Nombre guardado en la base: los de todos los identificadores, en orden. */
export function verifiedNameFor(
	uids: string[],
	names: Record<string, string>,
): string | null {
	const found = uids.map((uid) => names[uid]).filter(Boolean);
	return found.length === uids.length && found.length > 0
		? found.join(", ")
		: null;
}
```

Agregar a `tests/connectors/verify.test.ts`:

```ts
import { verifiedNameFor } from "@/lib/connectors/verify";

describe("verifiedNameFor", () => {
	it("une los nombres en el orden de los identificadores", () => {
		expect(verifiedNameFor(["b", "a"], { a: "A", b: "B" })).toBe("B, A");
	});

	it("si falta alguno, o no hay identificadores, es null", () => {
		expect(verifiedNameFor(["a", "b"], { a: "A" })).toBeNull();
		expect(verifiedNameFor([], {})).toBeNull();
	});
});
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/connectors && npm run typecheck 2>&1 | grep -v "nueva/actions" | grep -c "error TS"`
Expected: PASS, incluido `import-rule.test.ts`; solo queda el error de la Tarea 4.

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/connectors/auth.ts lib/connectors/verify.ts tests/connectors/describe-connector.test.ts tests/connectors/verify.test.ts
git add lib/connectors/auth.ts lib/connectors/verify.ts tests/connectors/describe-connector.test.ts tests/connectors/verify.test.ts
git commit -m "feat: la consola puede preguntarle a Vercel si un conector existe y está adjunto"
```

---

### Task 4: Alta de empresa con agentes

**Files:**
- Modify: `lib/tenants/tenant-create.ts`, `app/plataforma/nueva/create-form.tsx`, `app/plataforma/nueva/actions.ts`
- Test: `tests/tenants/tenant-create.test.ts`, `tests/plataforma/create-actions.test.ts`

**Interfaces:**
- Consumes: `platform_create_tenant` (Tarea 1), `AGENT_CATALOG`, `isCatalogAgent`, `catalogAgents` (Tarea 2).
- Produces: `createTenantSchema` con `agents: string[]`; `readCreateForm` lee `formData.getAll("agents")`; `createTenant` llama `platform_create_tenant` con `p_actor` y `p_agents` por el cliente admin.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/tenants/tenant-create.test.ts`, leer primero cómo arma el `FormData` y agregar dentro del `describe` principal (adaptando el helper de ese archivo para que `agents` use `append`, una entrada por agente):

```ts
	it("lee los agentes marcados", () => {
		const data = form();
		data.append("agents", "outreach");
		expect(readCreateForm(data)).toMatchObject({ agents: ["outreach"] });
	});

	it("sin agentes no se crea", () => {
		expect(message({ agents: [] })).toBe("Elegí al menos un agente.");
	});

	it("un agente que no está en el catálogo no se acepta", () => {
		expect(message({ agents: ["outreach", "soporte"] })).toBe(
			"Hay un agente que no existe en el catálogo.",
		);
	});
```

(`message(...)` es el helper que el archivo ya usa para sacar el primer mensaje de error del schema; si se llama distinto, usar el nombre real.) Todos los casos existentes que arman un input válido tienen que sumar `agents: ["outreach"]`.

En `tests/plataforma/create-actions.test.ts`:

1. En `form()`, después de construir `data`, agregar `data.append("agents", "outreach");` salvo que `overrides.agents === null`. Cambiar la firma a `overrides: Record<string, string | File | null> = {}` ya existente y tratar la clave `agents` aparte: si `overrides.agents` es un string, hacer `append` por cada valor separado por coma.
2. Sumar al mock de `@/lib/supabase/admin`: `createAdminClient: () => ({ rpc: supabase.rpc })` (el `rpc` del doble ya registra en `state.rpcCalls`).
3. Cambiar el test "crea la empresa con create_tenant e invita al admin hacia su chat" para esperar:

```ts
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_create_tenant",
			args: {
				p_actor: "u1",
				p_slug: "acme",
				p_display_name: "Acme",
				p_allowed_domains: ["acme.test"],
				p_auth_methods: ["email"],
				p_brand: { primary: "#112233" },
				p_agents: ["outreach"],
			},
		});
```

4. Agregar:

```ts
	it("sin agentes marcados no crea nada", async () => {
		expect(await createTenant(form({ agents: null }))).toEqual({
			ok: false,
			message: "Elegí al menos un agente.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un mensaje de regla de la base (hint consola) se muestra tal cual", async () => {
		state.rpc = {
			data: null,
			error: { code: "23514", message: "la empresa necesita al menos un agente", hint: "consola" },
		};

		expect(await createTenant(form())).toEqual({
			ok: false,
			message: "la empresa necesita al menos un agente",
		});
	});
```

El tipo de `state.rpc.error` suma `hint?: string`.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tenants/tenant-create.test.ts tests/plataforma/create-actions.test.ts`
Expected: FAIL por `agents` desconocido en el schema y por el nombre del RPC.

- [ ] **Step 3: Implementar**

`lib/tenants/tenant-create.ts`: sumar `import { isCatalogAgent } from "@/lib/agents/catalog";`; en `readCreateForm`, agregar

```ts
		agents: formData
			.getAll("agents")
			.filter((value): value is string => typeof value === "string"),
```

y en `createTenantSchema`, después de `allowExternalAdmin`:

```ts
		agents: z
			.array(z.string())
			.min(1, { error: "Elegí al menos un agente." })
			.refine((list) => list.every(isCatalogAgent), {
				error: "Hay un agente que no existe en el catálogo.",
			})
			.refine((list) => new Set(list).size === list.length, {
				error: "Hay un agente repetido.",
			}),
```

`app/plataforma/nueva/create-form.tsx`: sumar `import { AGENT_CATALOG, catalogAgents } from "@/lib/agents/catalog";` y, debajo del grupo de métodos de login, un grupo igual:

```tsx
			<fieldset className="space-y-2">
				<legend className="text-sm">Agentes</legend>
				{catalogAgents().map((agent) => (
					<label className="flex items-start gap-2 text-sm" key={agent}>
						<input
							className="mt-1"
							defaultChecked
							name="agents"
							type="checkbox"
							value={agent}
						/>
						<span>
							{AGENT_CATALOG[agent].name}
							<span className="block text-muted-foreground text-xs">
								{AGENT_CATALOG[agent].description}
							</span>
						</span>
					</label>
				))}
			</fieldset>
```

`app/plataforma/nueva/actions.ts`: reemplazar la llamada al RPC por

```ts
		const { data: tenantId, error } = await createAdminClient().rpc(
			"platform_create_tenant",
			{
				p_actor: admin.userId,
				p_slug: input.slug,
				p_display_name: input.displayName,
				p_allowed_domains: input.allowedDomains,
				p_auth_methods: input.authMethods,
				p_brand: brand,
				p_agents: input.agents,
			},
		);
		if (error || !tenantId) {
			if (error?.hint === "consola") return { ok: false, message: error.message };
			if (error?.code === "23505")
				return { ok: false, message: "Ya hay una empresa con ese slug." };
			if (error?.code === "23514")
				return {
					ok: false,
					message: "Ese slug está reservado o tiene un formato inválido.",
				};
			if (error?.code === "42501") return SIN_PERMISO;
			return NO_CREO;
		}
```

El `update` del logo y el resto siguen con `admin.supabase` (la RLS de `tenants_update` deja escribir a plataforma).

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/tenants tests/plataforma && npm run typecheck`
Expected: PASS y typecheck limpio del todo.

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/tenants/tenant-create.ts app/plataforma/nueva/create-form.tsx app/plataforma/nueva/actions.ts tests/tenants/tenant-create.test.ts tests/plataforma/create-actions.test.ts
git add lib/tenants/tenant-create.ts app/plataforma/nueva/create-form.tsx app/plataforma/nueva/actions.ts tests/tenants/tenant-create.test.ts tests/plataforma/create-actions.test.ts
git commit -m "feat: el alta de una empresa elige sus agentes del catálogo"
```

---

### Task 5: Server actions de la consola y "qué falta"

**Files:**
- Create: `lib/tenants/readiness.ts`, `app/plataforma/[slug]/console-actions.ts`
- Test: `tests/tenants/readiness.test.ts`, `tests/plataforma/console-actions.test.ts`

**Interfaces:**
- Consumes: las seis funciones SQL (Tarea 1), `AGENT_CATALOG` (Tarea 2), `describeConnector`, `checkConnectors`, `verifiedNameFor` (Tarea 3), `PROVIDERS`, `isProviderKey` (`lib/connectors/providers.ts`), `requirePlatformAdmin`, `createAdminClient`.
- Produces:
  - `tenantReadiness(input: { agents: { agent: string; enabled: boolean }[]; connections: { capability: string; provider: string; enabled: boolean; verifiedAt: string | null }[] }): { ready: boolean; missing: ReadinessIssue[] }` con `type ReadinessIssue = "agentes" | "brain" | "conectores" | "verificacion"` y `READINESS_LABELS: Record<ReadinessIssue, string>`.
  - Acciones, todas `Promise<ConsoleResult>` con `type ConsoleResult = { ok: true } | { ok: false; message: string }`: `setAgent(slug, tenantId, agent, enabled, brain)`, `createBrain(slug, tenantId)`, `bindConnection(slug, tenantId, provider, connectorUids: string[])`, `setConnectionEnabled(slug, connectionId, enabled)`, `removeConnection(slug, connectionId)`, `verifyConnection(slug, connectionId)`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/tenants/readiness.test.ts
import { describe, expect, it } from "vitest";
import { READINESS_LABELS, tenantReadiness } from "@/lib/tenants/readiness";

const ok = (over: Partial<Parameters<typeof tenantReadiness>[0]> = {}) =>
	tenantReadiness({
		agents: [{ agent: "outreach", enabled: true }],
		connections: [
			{ capability: "brain", provider: "wiki", enabled: true, verifiedAt: null },
			{ capability: "crm", provider: "hubspot", enabled: true, verifiedAt: null },
			{ capability: "leads", provider: "coldiq", enabled: true, verifiedAt: "2026-10-10T00:00:00Z" },
			{ capability: "mail", provider: "gmail", enabled: true, verifiedAt: null },
		],
		...over,
	});

describe("tenantReadiness", () => {
	it("con todo lo que el agente necesita, está lista", () => {
		expect(ok()).toEqual({ ready: true, missing: [] });
	});

	it("sin agentes habilitados", () => {
		expect(ok({ agents: [{ agent: "outreach", enabled: false }] }).missing).toEqual(["agentes"]);
		expect(ok({ agents: [] }).missing).toEqual(["agentes"]);
	});

	it("sin brain habilitado", () => {
		const r = ok({
			connections: [
				{ capability: "brain", provider: "wiki", enabled: false, verifiedAt: null },
				{ capability: "crm", provider: "hubspot", enabled: true, verifiedAt: null },
				{ capability: "leads", provider: "coldiq", enabled: true, verifiedAt: "x" },
				{ capability: "mail", provider: "gmail", enabled: true, verifiedAt: null },
			],
		});
		expect(r.missing).toEqual(["brain"]);
	});

	it("un agente habilitado que necesita una capacidad sin conector", () => {
		const r = ok({
			connections: [
				{ capability: "brain", provider: "wiki", enabled: true, verifiedAt: null },
				{ capability: "leads", provider: "coldiq", enabled: true, verifiedAt: "x" },
				{ capability: "mail", provider: "gmail", enabled: true, verifiedAt: null },
			],
		});
		expect(r.missing).toEqual(["conectores"]);
	});

	it("un conector con llave que no está verificado", () => {
		const r = ok({
			connections: [
				{ capability: "brain", provider: "wiki", enabled: true, verifiedAt: null },
				{ capability: "crm", provider: "hubspot", enabled: true, verifiedAt: null },
				{ capability: "leads", provider: "coldiq", enabled: true, verifiedAt: null },
				{ capability: "mail", provider: "gmail", enabled: true, verifiedAt: null },
			],
		});
		expect(r.missing).toEqual(["verificacion"]);
	});

	it("los proveedores sin llave (hubspot, gmail, wiki) nunca piden verificación", () => {
		expect(ok().missing).toEqual([]);
	});

	it("un agente fuera del catálogo no exige nada", () => {
		expect(
			ok({ agents: [{ agent: "outreach", enabled: true }, { agent: "raro", enabled: true }] })
				.missing,
		).toEqual([]);
	});

	it("las causas vienen en orden fijo y cada una tiene rótulo", () => {
		const r = tenantReadiness({ agents: [], connections: [] });
		expect(r).toEqual({ ready: false, missing: ["agentes", "brain"] });
		for (const issue of r.missing) expect(READINESS_LABELS[issue]).toBeTruthy();
	});
});
```

```ts
// tests/plataforma/console-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONN = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
	admin: true,
	rpc: { data: CONN, error: null as { code?: string; message: string; hint?: string } | null },
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	row: {
		id: "22222222-2222-4222-8222-222222222222",
		tenant_id: "11111111-1111-4111-8111-111111111111",
		connector_uid: "acme-coldiq",
		config: {} as Record<string, unknown>,
		provider: "coldiq",
	} as Record<string, unknown> | null,
	revalidated: [] as string[],
	inVercel: true,
	describe: {} as Record<string, { name: string; service: string } | null | Error>,
	describeCalls: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));
vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { supabase: {}, userId: "u1" } : null,
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		rpc: async (fn: string, args: Record<string, unknown>) => {
			state.rpcCalls.push({ fn, args });
			return state.rpc;
		},
		from: () => ({
			select: () => ({
				eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }),
			}),
		}),
	}),
}));
vi.mock("@/lib/connectors/auth", () => ({
	describeConnector: async (uid: string) => {
		state.describeCalls.push(uid);
		const answer = state.describe[uid];
		if (answer instanceof Error) throw answer;
		return answer ?? null;
	},
}));
vi.mock("@/lib/connectors/env", () => ({ inVercel: () => state.inVercel }));

const actions = await import("@/app/plataforma/[slug]/console-actions");

const SIN_PERMISO = { ok: false, message: "No tenés permiso." };
const GENERICO = { ok: false, message: "No se pudo guardar. Probá de nuevo." };

beforeEach(() => {
	state.admin = true;
	state.rpc = { data: CONN, error: null };
	state.rpcCalls = [];
	state.row = { id: CONN, tenant_id: TENANT, connector_uid: "acme-coldiq", config: {}, provider: "coldiq" };
	state.revalidated = [];
	state.inVercel = true;
	state.describe = { "acme-coldiq": { name: "Acme ColdIQ", service: "coldiq" } };
	state.describeCalls = [];
});

describe("gate común", () => {
	it("sin plataforma, ninguna acción toca la base", async () => {
		state.admin = false;
		expect(await actions.setAgent("acme", TENANT, "outreach", true, "read")).toEqual(SIN_PERMISO);
		expect(await actions.createBrain("acme", TENANT)).toEqual(SIN_PERMISO);
		expect(await actions.bindConnection("acme", TENANT, "coldiq", ["x"])).toEqual(SIN_PERMISO);
		expect(await actions.setConnectionEnabled("acme", CONN, false)).toEqual(SIN_PERMISO);
		expect(await actions.removeConnection("acme", CONN)).toEqual(SIN_PERMISO);
		expect(await actions.verifyConnection("acme", CONN)).toEqual(SIN_PERMISO);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un mensaje con hint consola se devuelve tal cual; otro error es genérico", async () => {
		state.rpc = { data: null, error: { code: "23514", message: "la empresa ya tiene un brain", hint: "consola" } };
		expect(await actions.createBrain("acme", TENANT)).toEqual({ ok: false, message: "la empresa ya tiene un brain" });

		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		state.rpc = { data: null, error: { code: "XX000", message: "detalle interno" } };
		expect(await actions.createBrain("acme", TENANT)).toEqual(GENERICO);
		log.mockRestore();
	});

	it("revalida el listado y el detalle de la empresa", async () => {
		await actions.setAgent("acme", TENANT, "outreach", true, "read");
		expect(state.revalidated).toEqual(["/plataforma", "/plataforma/acme"]);
	});
});

describe("setAgent", () => {
	it("llama platform_set_agent con el actor", async () => {
		expect(await actions.setAgent("acme", TENANT, "outreach", false, "none")).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{ fn: "platform_set_agent", args: { p_actor: "u1", p_tenant: TENANT, p_agent: "outreach", p_enabled: false, p_brain: "none" } },
		]);
	});

	it.each(["soporte", "", "toString"])("rechaza el agente %s fuera del catálogo", async (agent) => {
		expect(await actions.setAgent("acme", TENANT, agent, true, "read")).toEqual({ ok: false, message: "Ese agente no existe en el catálogo." });
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("rechaza un acceso al brain desconocido y un id que no es guid", async () => {
		expect((await actions.setAgent("acme", TENANT, "outreach", true, "todo")).ok).toBe(false);
		expect((await actions.setAgent("acme", "no-es-id", "outreach", true, "read")).ok).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("createBrain", () => {
	it("asocia wiki con la configuración por defecto", async () => {
		expect(await actions.createBrain("acme", TENANT)).toEqual({ ok: true });
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_bind_connection",
			args: {
				p_actor: "u1",
				p_tenant: TENANT,
				p_capability: "brain",
				p_provider: "wiki",
				p_connector_uids: [],
				p_config: {
					categories: ["empresa", "producto", "comercial", "operacion"],
					requiredFrontmatter: ["title", "category", "status", "updated"],
					search: "fts",
				},
				p_verified_name: null,
			},
		});
	});
});

describe("bindConnection", () => {
	it("verifica en Vercel y asocia con el nombre del conector", async () => {
		expect(await actions.bindConnection("acme", TENANT, "coldiq", [" acme-coldiq "])).toEqual({ ok: true });
		expect(state.describeCalls).toEqual(["acme-coldiq"]);
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_bind_connection",
			args: {
				p_actor: "u1",
				p_tenant: TENANT,
				p_capability: "leads",
				p_provider: "coldiq",
				p_connector_uids: ["acme-coldiq"],
				p_config: {},
				p_verified_name: "Acme ColdIQ",
			},
		});
	});

	it("si Vercel no conoce el conector, no escribe nada", async () => {
		state.describe = {};
		expect(await actions.bindConnection("acme", TENANT, "coldiq", ["nada"])).toEqual({
			ok: false,
			message: "El conector `nada` no existe o no está adjunto a este proyecto en Vercel.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("si consultar a Vercel falla, no escribe nada", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		state.describe = { "acme-coldiq": new Error("red") };
		expect(await actions.bindConnection("acme", TENANT, "coldiq", ["acme-coldiq"])).toEqual({
			ok: false,
			message: "No pude verificar el conector en Vercel. Probá de nuevo.",
		});
		expect(state.rpcCalls).toHaveLength(0);
		log.mockRestore();
	});

	it("fuera de Vercel asocia sin verificar", async () => {
		state.inVercel = false;
		await actions.bindConnection("acme", TENANT, "coldiq", ["acme-coldiq"]);
		expect(state.describeCalls).toHaveLength(0);
		expect(state.rpcCalls[0]?.args.p_verified_name).toBeNull();
	});

	it("un proveedor con llave exige exactamente un identificador; Apollo acepta varios", async () => {
		expect((await actions.bindConnection("acme", TENANT, "coldiq", [])).ok).toBe(false);
		expect((await actions.bindConnection("acme", TENANT, "coldiq", ["a", "b"])).ok).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);

		state.describe = { a: { name: "A", service: "apollo" }, b: { name: "B", service: "apollo" } };
		expect(await actions.bindConnection("acme", TENANT, "apollo", ["a", "b"])).toEqual({ ok: true });
		expect(state.rpcCalls[0]?.args).toMatchObject({ p_capability: "leads", p_connector_uids: ["a", "b"], p_verified_name: "A, B" });
	});

	it("hubspot no lleva identificador: es el conector de plataforma", async () => {
		expect(await actions.bindConnection("acme", TENANT, "hubspot", [])).toEqual({ ok: true });
		expect(state.rpcCalls[0]?.args).toMatchObject({ p_capability: "crm", p_provider: "hubspot", p_connector_uids: [] });
		expect((await actions.bindConnection("acme", TENANT, "hubspot", ["x"])).ok).toBe(false);
	});

	it.each(["wiki", "nada", "mcp"])("el proveedor %s no se asocia desde este formulario", async (provider) => {
		expect((await actions.bindConnection("acme", TENANT, provider, ["x"])).ok).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un identificador con espacios o comillas no pasa", async () => {
		expect((await actions.bindConnection("acme", TENANT, "coldiq", ["a b"])).ok).toBe(false);
		expect((await actions.bindConnection("acme", TENANT, "coldiq", ['a"b'])).ok).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un conector de otra empresa se informa con su identificador", async () => {
		state.rpc = { data: null, error: { code: "23505", message: "el conector acme-coldiq ya está asociado a otra empresa", hint: "consola" } };
		expect(await actions.bindConnection("acme", TENANT, "coldiq", ["acme-coldiq"])).toEqual({
			ok: false,
			message: "el conector acme-coldiq ya está asociado a otra empresa",
		});
	});
});

describe("setConnectionEnabled, removeConnection, verifyConnection", () => {
	it("habilitar y quitar llaman a su función", async () => {
		expect(await actions.setConnectionEnabled("acme", CONN, false)).toEqual({ ok: true });
		expect(await actions.removeConnection("acme", CONN)).toEqual({ ok: true });
		expect(state.rpcCalls.map((c) => c.fn)).toEqual(["platform_set_connection_enabled", "platform_remove_connection"]);
		expect(state.rpcCalls[0]?.args).toEqual({ p_actor: "u1", p_connection: CONN, p_enabled: false });
	});

	it("verificar consulta cada identificador de la fila y guarda el nombre", async () => {
		state.row = { id: CONN, tenant_id: TENANT, connector_uid: "a", config: { connectorUids: ["a", "b"] }, provider: "apollo" };
		state.describe = { a: { name: "A", service: "apollo" }, b: { name: "B", service: "apollo" } };

		expect(await actions.verifyConnection("acme", CONN)).toEqual({ ok: true });
		expect(state.describeCalls).toEqual(["a", "b"]);
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_mark_connection_verified",
			args: { p_actor: "u1", p_connection: CONN, p_verified_name: "A, B" },
		});
	});

	it("verificar un conector que Vercel no conoce lo deja sin verificar y lo dice", async () => {
		state.describe = {};
		expect(await actions.verifyConnection("acme", CONN)).toEqual({
			ok: false,
			message: "El conector `acme-coldiq` no existe o no está adjunto a este proyecto en Vercel.",
		});
		expect(state.rpcCalls[0]).toEqual({
			fn: "platform_mark_connection_verified",
			args: { p_actor: "u1", p_connection: CONN, p_verified_name: null },
		});
	});

	it("verificar fuera de Vercel no hace nada y lo explica", async () => {
		state.inVercel = false;
		expect(await actions.verifyConnection("acme", CONN)).toEqual({
			ok: false,
			message: "La verificación contra Vercel solo corre en un deploy.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("verificar una fila que no existe o sin identificador no consulta", async () => {
		state.row = null;
		expect((await actions.verifyConnection("acme", CONN)).ok).toBe(false);
		state.row = { id: CONN, tenant_id: TENANT, connector_uid: null, config: {}, provider: "hubspot" };
		expect(await actions.verifyConnection("acme", CONN)).toEqual({
			ok: false,
			message: "Este conector no tiene identificador que verificar.",
		});
		expect(state.describeCalls).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tenants/readiness.test.ts tests/plataforma/console-actions.test.ts`
Expected: FAIL, los módulos no existen (también `@/lib/connectors/env`).

- [ ] **Step 3: Implementar**

```ts
// lib/connectors/env.ts
// ¿Corremos en un deploy de Vercel? Ahí hay OIDC y la verificación de
// conectores es obligatoria (spec 21.1 §4). Aparte para poder doblarla en tests.
export function inVercel(): boolean {
	return Boolean(process.env.VERCEL_ENV);
}
```

```ts
// lib/tenants/readiness.ts
// Qué le falta a una empresa para que sus agentes puedan trabajar (spec 21.1
// §6.2). Puro: la consola le pasa lo que leyó.
import { AGENT_CATALOG, isCatalogAgent } from "../agents/catalog";
import { isProviderKey, PROVIDERS } from "../connectors/providers";

export type ReadinessIssue = "agentes" | "brain" | "conectores" | "verificacion";

export const READINESS_LABELS: Record<ReadinessIssue, string> = {
	agentes: "sin agentes habilitados",
	brain: "sin brain",
	conectores: "faltan conectores",
	verificacion: "conectores sin verificar",
};

interface ConnectionState {
	capability: string;
	provider: string;
	enabled: boolean;
	verifiedAt: string | null;
}

function needsVerification(provider: string): boolean {
	return isProviderKey(provider) && PROVIDERS[provider].authKind === "connect_api_key";
}

export function tenantReadiness(input: {
	agents: { agent: string; enabled: boolean }[];
	connections: ConnectionState[];
}): { ready: boolean; missing: ReadinessIssue[] } {
	const missing: ReadinessIssue[] = [];
	const enabledAgents = input.agents.filter((a) => a.enabled);
	const enabled = input.connections.filter((c) => c.enabled);

	if (enabledAgents.length === 0) missing.push("agentes");
	if (!enabled.some((c) => c.capability === "brain")) missing.push("brain");

	const needed = new Set<string>();
	for (const { agent } of enabledAgents) {
		if (isCatalogAgent(agent)) {
			for (const capability of AGENT_CATALOG[agent].capabilities) needed.add(capability);
		}
	}
	const covered = new Set(enabled.map((c) => c.capability));
	if ([...needed].some((capability) => !covered.has(capability))) missing.push("conectores");

	if (enabled.some((c) => needsVerification(c.provider) && c.verifiedAt === null)) {
		missing.push("verificacion");
	}

	return { ready: missing.length === 0, missing };
}
```

```ts
// app/plataforma/[slug]/console-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isCatalogAgent } from "@/lib/agents/catalog";
import { describeConnector } from "@/lib/connectors/auth";
import { inVercel } from "@/lib/connectors/env";
import { isProviderKey, PROVIDERS, type ProviderKey } from "@/lib/connectors/providers";
import { checkConnectors, verifiedNameFor } from "@/lib/connectors/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";

export type ConsoleResult = { ok: true } | { ok: false; message: string };

const SIN_PERMISO: ConsoleResult = { ok: false, message: "No tenés permiso." };
const INVALIDO: ConsoleResult = { ok: false, message: "No se pudo procesar el pedido." };
const GENERICO: ConsoleResult = { ok: false, message: "No se pudo guardar. Probá de nuevo." };

// guid y no uuid: el seed local usa ids que no son v4.
const idSchema = z.guid();
// Identificadores de conectores de Vercel: sin espacios ni comillas. No son secretos.
const UID = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;
const BRAIN_ACCESS = ["none", "read", "read_write"] as const;

export const DEFAULT_BRAIN_CONFIG = {
	categories: ["empresa", "producto", "comercial", "operacion"],
	requiredFrontmatter: ["title", "category", "status", "updated"],
	search: "fts",
} as const;

/**
 * Un error de una función de consola llega con hint 'consola' y un mensaje
 * escrito para la persona; se muestra tal cual. Cualquier otro se loguea.
 */
function fromDbError(error: { code?: string; message: string; hint?: string | null }): ConsoleResult {
	if (error.hint === "consola") return { ok: false, message: error.message };
	console.error("consola:", error.code, error.message);
	return GENERICO;
}

function done(slug: string, result: ConsoleResult): ConsoleResult {
	revalidatePath("/plataforma");
	revalidatePath(`/plataforma/${slug}`);
	return result;
}

async function call(
	slug: string,
	fn: "platform_set_agent" | "platform_bind_connection" | "platform_set_connection_enabled" | "platform_remove_connection" | "platform_mark_connection_verified",
	args: Record<string, unknown>,
): Promise<ConsoleResult> {
	// biome-ignore lint/suspicious/noExplicitAny: el nombre de la función y sus argumentos ya están validados arriba
	const { error } = await createAdminClient().rpc(fn as any, args as any);
	return done(slug, error ? fromDbError(error) : { ok: true });
}

export async function setAgent(
	slug: string,
	tenantId: string,
	agent: string,
	enabled: boolean,
	brain: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	if (!isCatalogAgent(agent)) return { ok: false, message: "Ese agente no existe en el catálogo." };
	if (!(BRAIN_ACCESS as readonly string[]).includes(brain)) return INVALIDO;

	return call(slug, "platform_set_agent", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_agent: agent,
		p_enabled: enabled === true,
		p_brain: brain,
	});
}

export async function createBrain(slug: string, tenantId: string): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;

	return call(slug, "platform_bind_connection", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_capability: "brain",
		p_provider: "wiki",
		p_connector_uids: [],
		p_config: DEFAULT_BRAIN_CONFIG,
		p_verified_name: null,
	});
}

/** Cuántos identificadores lleva un proveedor: ninguno (OAuth de plataforma), uno, o varios. */
function uidRule(provider: ProviderKey): "none" | "one" | "many" {
	const info = PROVIDERS[provider];
	if (info.authKind !== "connect_api_key") return "none";
	return info.multiple ? "many" : "one";
}

export async function bindConnection(
	slug: string,
	tenantId: string,
	provider: string,
	connectorUids: string[],
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	// wiki y mcp (brain) tienen su propio botón; lo demás tiene que estar en el catálogo.
	if (!isProviderKey(provider) || PROVIDERS[provider].capability === "brain") {
		return { ok: false, message: "Ese proveedor no se asocia desde acá." };
	}

	const uids = [...new Set(connectorUids.map((u) => u.trim()).filter(Boolean))];
	if (uids.some((u) => !UID.test(u))) {
		return { ok: false, message: "Un identificador tiene caracteres que no van." };
	}
	const rule = uidRule(provider);
	if (rule === "none" && uids.length > 0) {
		return { ok: false, message: "Este proveedor no lleva identificador: cada persona autoriza su cuenta." };
	}
	if (rule === "one" && uids.length !== 1) {
		return { ok: false, message: "Este proveedor lleva exactamente un identificador." };
	}
	if (rule === "many" && uids.length === 0) {
		return { ok: false, message: "Pegá al menos un identificador." };
	}

	const check = await checkConnectors(uids, { inVercel: inVercel(), describe: describeConnector });
	if (!check.ok) return check;

	return call(slug, "platform_bind_connection", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_capability: PROVIDERS[provider].capability,
		p_provider: provider,
		p_connector_uids: uids,
		p_config: {},
		p_verified_name: verifiedNameFor(uids, check.names),
	});
}

export async function setConnectionEnabled(
	slug: string,
	connectionId: string,
	enabled: boolean,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(connectionId).success) return INVALIDO;

	return call(slug, "platform_set_connection_enabled", {
		p_actor: admin.userId,
		p_connection: connectionId,
		p_enabled: enabled === true,
	});
}

export async function removeConnection(slug: string, connectionId: string): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(connectionId).success) return INVALIDO;

	return call(slug, "platform_remove_connection", {
		p_actor: admin.userId,
		p_connection: connectionId,
	});
}

export async function verifyConnection(slug: string, connectionId: string): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(connectionId).success) return INVALIDO;
	if (!inVercel()) {
		return { ok: false, message: "La verificación contra Vercel solo corre en un deploy." };
	}

	const { data: row, error } = await createAdminClient()
		.from("tenant_connections")
		.select("id, tenant_id, connector_uid, config, provider")
		.eq("id", connectionId)
		.maybeSingle();
	if (error || !row) return INVALIDO;

	const extra = (row.config as { connectorUids?: unknown } | null)?.connectorUids;
	const uids = [
		...new Set([
			...(typeof row.connector_uid === "string" ? [row.connector_uid] : []),
			...(Array.isArray(extra) ? extra.filter((u): u is string => typeof u === "string") : []),
		]),
	];
	if (uids.length === 0) {
		return { ok: false, message: "Este conector no tiene identificador que verificar." };
	}

	const check = await checkConnectors(uids, { inVercel: true, describe: describeConnector });
	const marked = await call(slug, "platform_mark_connection_verified", {
		p_actor: admin.userId,
		p_connection: connectionId,
		p_verified_name: check.ok ? verifiedNameFor(uids, check.names) : null,
	});
	if (!check.ok) return check;
	return marked;
}
```

Si `createAdminClient().rpc` está tipado contra `Database` y rechaza la unión de nombres, reemplazar el `as any` por una sobrecarga chica por función o por `rpc(fn, args)` con el tipo generado; anotar lo elegido en el reporte. No dejar el `biome-ignore` si no hace falta.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/tenants/readiness.test.ts tests/plataforma/console-actions.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio. Si el test "verificar un conector que Vercel no conoce" falla porque el orden entre marcar y devolver no coincide, ajustar la acción (primero marca como no verificado, después devuelve el mensaje del chequeo), no el test.

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/connectors/env.ts lib/tenants/readiness.ts "app/plataforma/[slug]/console-actions.ts" tests/tenants/readiness.test.ts tests/plataforma/console-actions.test.ts
git add lib/connectors/env.ts lib/tenants/readiness.ts "app/plataforma/[slug]/console-actions.ts" tests/tenants/readiness.test.ts tests/plataforma/console-actions.test.ts
git commit -m "feat: acciones de consola para agentes, brain y conectores, y el cálculo de qué le falta a una empresa"
```

---

### Task 6: Pantallas

**Files:**
- Create: `app/plataforma/[slug]/console/agents-section.tsx`, `brain-section.tsx`, `connections-section.tsx`, `bind-form.tsx`, `console-button.tsx`
- Modify: `app/plataforma/[slug]/page.tsx`, `app/plataforma/page.tsx`
- Test: `tests/plataforma/detail-page.test.ts` (nuevo), `tests/plataforma/list-page.test.ts` (nuevo), `tests/plataforma/console-sections.test.ts` (nuevo)

**Interfaces:**
- Consumes: las seis acciones y `ConsoleResult` (Tarea 5); `tenantReadiness`, `READINESS_LABELS` (Tarea 5); `AGENT_CATALOG`, `catalogAgents` (Tarea 2); `PROVIDERS` (`lib/connectors/providers.ts`); `runRowAction` de `app/[tenant]/settings/usuarios/run-row-action.ts` (ya existe; su tipo `ActionResult` es compatible con `ConsoleResult`).
- Produces: componentes cliente `ConsoleButton({ run, label, confirmText? })`, `AgentsSection({ slug, tenantId, agents })`, `BrainSection({ slug, tenantId, brain })`, `ConnectionsSection({ slug, tenantId, connections })`, `BindForm({ slug, tenantId })`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/plataforma/console-sections.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/plataforma/[slug]/console-actions", () => ({
	setAgent: async () => ({ ok: true }),
	createBrain: async () => ({ ok: true }),
	bindConnection: async () => ({ ok: true }),
	setConnectionEnabled: async () => ({ ok: true }),
	removeConnection: async () => ({ ok: true }),
	verifyConnection: async () => ({ ok: true }),
}));

const { AgentsSection } = await import("@/app/plataforma/[slug]/console/agents-section");
const { BrainSection } = await import("@/app/plataforma/[slug]/console/brain-section");
const { ConnectionsSection } = await import("@/app/plataforma/[slug]/console/connections-section");
const { BindForm } = await import("@/app/plataforma/[slug]/console/bind-form");

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("AgentsSection", () => {
	it("una fila por agente del catálogo, con interruptor y acceso al brain", () => {
		const html = renderToStaticMarkup(
			createElement(AgentsSection, {
				slug: "acme",
				tenantId: TENANT,
				agents: [{ agent: "outreach", enabled: true, brain: "read" }],
			}),
		);
		expect(html).toContain("Agente de outreach");
		expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
		expect(html).toMatch(/<option[^>]*value="read"[^>]*selected/);
		expect(html).toContain("Lectura y escritura");
	});

	it("un agente que la empresa no tiene aparece apagado", () => {
		const html = renderToStaticMarkup(
			createElement(AgentsSection, { slug: "acme", tenantId: TENANT, agents: [] }),
		);
		expect(html).toContain("Agente de outreach");
		expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
	});
});

describe("BrainSection", () => {
	it("sin brain ofrece crearlo", () => {
		const html = renderToStaticMarkup(
			createElement(BrainSection, { slug: "acme", tenantId: TENANT, brain: null }),
		);
		expect(html).toContain("Crear brain");
	});

	it("con brain muestra proveedor, categorías y el link", () => {
		const html = renderToStaticMarkup(
			createElement(BrainSection, {
				slug: "acme",
				tenantId: TENANT,
				brain: { provider: "wiki", categories: ["empresa", "producto"], createdAt: "2026-10-10T00:00:00Z" },
			}),
		);
		expect(html).toContain("wiki");
		expect(html).toContain("empresa, producto");
		expect(html).toContain('href="/acme/brain"');
		expect(html).not.toContain("Crear brain");
	});
});

describe("ConnectionsSection", () => {
	const connection = {
		id: "22222222-2222-4222-8222-222222222222",
		capability: "leads",
		provider: "apollo",
		connectorUids: ["a1", "a2"],
		enabled: true,
		verifiedAt: null as string | null,
		verifiedName: null as string | null,
	};

	it("lista identificadores, estado y verificación, con sus botones", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, { slug: "acme", tenantId: TENANT, connections: [connection] }),
		);
		expect(html).toContain("apollo");
		expect(html).toContain("a1");
		expect(html).toContain("a2");
		expect(html).toContain("Sin verificar");
		expect(html).toContain("Verificar");
		expect(html).toContain("Deshabilitar");
		expect(html).toContain("Quitar");
	});

	it("una conexión verificada y deshabilitada lo dice", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				tenantId: TENANT,
				connections: [{ ...connection, enabled: false, verifiedAt: "2026-10-10T12:00:00Z", verifiedName: "Apollo Acme" }],
			}),
		);
		expect(html).toContain("Apollo Acme");
		expect(html).toContain("Habilitar");
		expect(html).not.toContain("Sin verificar");
	});

	it("sin conexiones lo dice", () => {
		expect(
			renderToStaticMarkup(createElement(ConnectionsSection, { slug: "acme", tenantId: TENANT, connections: [] })),
		).toContain("Todavía no hay conectores");
	});
});

describe("BindForm", () => {
	it("ofrece los proveedores del catálogo salvo los de brain y avisa que acá no va la llave", () => {
		const html = renderToStaticMarkup(createElement(BindForm, { slug: "acme", tenantId: TENANT }));
		expect(html).toContain('value="coldiq"');
		expect(html).toContain('value="hubspot"');
		expect(html).not.toContain('value="wiki"');
		expect(html).not.toContain('value="mcp"');
		expect(html).toContain("Acá nunca va la llave");
	});
});
```

```ts
// tests/plataforma/detail-page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
const state = {
	admin: true as boolean,
	tenant: { id: "t1", slug: "acme", display_name: "Acme", allowed_domains: [], self_signup_by_domain: false, allowed_models: ["m"], default_model: "m", auth_methods: ["email"], brand: {}, active: true } as Record<string, unknown> | null,
	memberships: [] as unknown[],
	agents: [] as unknown[],
	connections: [] as unknown[],
};

function query(result: () => Result) {
	const q = {
		select: () => q,
		eq: () => q,
		order: () => q,
		maybeSingle: async () => result(),
		returns: () => q,
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) => Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/platform", () => ({
	platformOwnerSlug: () => "innovas",
	requirePlatformAdmin: async () =>
		state.admin
			? {
					userId: "u1",
					supabase: {
						from: (table: string) =>
							query(() => ({
								data:
									table === "tenants"
										? state.tenant
										: table === "memberships"
											? state.memberships
											: table === "tenant_agents"
												? state.agents
												: state.connections,
								error: null,
							})),
					},
				}
			: null,
}));
vi.mock("@/lib/tenants/people", () => ({ loadPeople: async () => new Map() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://app.test" }) }));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/plataforma/[slug]/tenant-form", () => ({ TenantForm: () => null }));
vi.mock("@/app/plataforma/[slug]/console-actions", () => ({
	setAgent: async () => ({ ok: true }),
	createBrain: async () => ({ ok: true }),
	bindConnection: async () => ({ ok: true }),
	setConnectionEnabled: async () => ({ ok: true }),
	removeConnection: async () => ({ ok: true }),
	verifyConnection: async () => ({ ok: true }),
}));

const { default: TenantDetailPage } = await import("@/app/plataforma/[slug]/page");

const render = async () =>
	renderToStaticMarkup(
		await TenantDetailPage({
			params: Promise.resolve({ slug: "acme" }),
			searchParams: Promise.resolve({}),
		}),
	);

describe("detalle de la empresa", () => {
	beforeEach(() => {
		state.admin = true;
		state.memberships = [];
		state.agents = [{ agent: "outreach", enabled: true, config: { brain: "read_write" } }];
		state.connections = [];
	});

	it("sin plataforma da 404", async () => {
		state.admin = false;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("muestra qué falta y las tres secciones", async () => {
		const html = await render();
		expect(html).toContain("Qué falta");
		expect(html).toContain("sin brain");
		expect(html).toContain("faltan conectores");
		expect(html).toContain("Agentes");
		expect(html).toContain("Crear brain");
		expect(html).toContain("Asociar conector");
	});

	it("con todo listo lo dice", async () => {
		state.connections = [
			{ id: "c1", capability: "brain", provider: "wiki", connector_uid: null, config: { categories: ["empresa"] }, enabled: true, verified_at: null, verified_name: null, created_at: "2026-10-10T00:00:00Z" },
			{ id: "c2", capability: "crm", provider: "hubspot", connector_uid: null, config: {}, enabled: true, verified_at: null, verified_name: null, created_at: "2026-10-10T00:00:00Z" },
			{ id: "c3", capability: "leads", provider: "coldiq", connector_uid: "acme-coldiq", config: {}, enabled: true, verified_at: "2026-10-10T00:00:00Z", verified_name: "Acme ColdIQ", created_at: "2026-10-10T00:00:00Z" },
			{ id: "c4", capability: "mail", provider: "gmail", connector_uid: null, config: {}, enabled: true, verified_at: null, verified_name: null, created_at: "2026-10-10T00:00:00Z" },
		];
		const html = await render();
		expect(html).toContain("Lista para trabajar");
		expect(html).not.toContain("Crear brain");
		expect(html).toContain("Acme ColdIQ");
	});
});
```

```ts
// tests/plataforma/list-page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
const state = {
	tenants: [] as unknown[],
	memberships: [] as unknown[],
	agents: [] as unknown[],
	connections: [] as unknown[],
};

function query(result: () => Result) {
	const q = {
		select: () => q,
		order: () => q,
		returns: () => q,
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) => Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/platform", () => ({
	platformOwnerSlug: () => "innovas",
	requirePlatformAdmin: async () => ({
		userId: "u1",
		supabase: {
			from: (table: string) =>
				query(() => ({
					data:
						table === "tenants"
							? state.tenants
							: table === "memberships"
								? state.memberships
								: table === "tenant_agents"
									? state.agents
									: state.connections,
					error: null,
				})),
		},
	}),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: PlataformaPage } = await import("@/app/plataforma/page");

describe("listado de empresas", () => {
	beforeEach(() => {
		state.tenants = [
			{ id: "t1", slug: "acme", display_name: "Acme", active: true, created_at: "2026-10-01T00:00:00Z" },
			{ id: "t2", slug: "beta", display_name: "Beta", active: true, created_at: "2026-10-01T00:00:00Z" },
		];
		state.memberships = [];
		state.agents = [{ tenant_id: "t1", agent: "outreach", enabled: true }];
		state.connections = [
			{ tenant_id: "t1", capability: "brain", provider: "wiki", enabled: true, verified_at: null },
			{ tenant_id: "t1", capability: "crm", provider: "hubspot", enabled: true, verified_at: null },
			{ tenant_id: "t1", capability: "leads", provider: "coldiq", enabled: true, verified_at: "x" },
			{ tenant_id: "t1", capability: "mail", provider: "gmail", enabled: true, verified_at: null },
		];
	});

	it("resume qué le falta a cada empresa", async () => {
		const html = renderToStaticMarkup(await PlataformaPage());
		const acme = html.split("<li").find((li) => li.includes(">Acme<")) ?? "";
		const beta = html.split("<li").find((li) => li.includes(">Beta<")) ?? "";
		expect(acme).toContain("Lista");
		expect(beta).toContain("Faltan: sin agentes habilitados, sin brain");
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/plataforma/console-sections.test.ts tests/plataforma/detail-page.test.ts tests/plataforma/list-page.test.ts`
Expected: FAIL, los componentes no existen y las páginas no tienen las secciones.

- [ ] **Step 3: Implementar los componentes cliente**

```tsx
// app/plataforma/[slug]/console/console-button.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Feedback } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { runRowAction } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { Button } from "@/components/ui/button";
import type { ConsoleResult } from "../console-actions";

export function ConsoleMessage({ feedback }: { feedback: Feedback }) {
	if (!feedback) return null;
	return (
		<span
			className={feedback.ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"}
			role={feedback.ok ? "status" : "alert"}
		>
			{feedback.text}
		</span>
	);
}

/** Botón que corre una acción de consola ya ligada a su fila y muestra lo que respondió. */
export function ConsoleButton({
	run,
	label,
	confirmText,
	variant = "outline",
}: {
	run: () => Promise<ConsoleResult>;
	label: string;
	confirmText?: string;
	variant?: "outline" | "default";
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);

	function onClick() {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run,
				confirmText,
				confirm: (text) => window.confirm(text),
				refresh: () => router.refresh(),
			});
			if (out.ran) setFeedback(out.feedback);
		});
	}

	return (
		<span className="inline-flex flex-wrap items-center gap-2">
			<ConsoleMessage feedback={feedback} />
			<Button disabled={pending} onClick={onClick} size="sm" type="button" variant={variant}>
				{label}
			</Button>
		</span>
	);
}
```

```tsx
// app/plataforma/[slug]/console/agents-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Feedback } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { runRowAction } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { Button } from "@/components/ui/button";
import { AGENT_CATALOG, catalogAgents } from "@/lib/agents/catalog";
import { setAgent } from "../console-actions";
import { ConsoleMessage } from "./console-button";

const BRAIN_LABELS: Record<string, string> = {
	none: "Sin acceso",
	read: "Lectura",
	read_write: "Lectura y escritura",
};

export interface AgentState {
	agent: string;
	enabled: boolean;
	brain: string;
}

function AgentRow({ slug, tenantId, agent, state }: { slug: string; tenantId: string; agent: keyof typeof AGENT_CATALOG; state: AgentState | undefined }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [enabled, setEnabled] = useState(state?.enabled ?? false);
	const [brain, setBrain] = useState(state?.brain ?? "read_write");
	const entry = AGENT_CATALOG[agent];

	function save() {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => setAgent(slug, tenantId, agent, enabled, entry.brain ? brain : "none"),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			setFeedback(out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }));
		});
	}

	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
				<input
					checked={enabled}
					className="mt-1"
					disabled={pending}
					onChange={(event) => setEnabled(event.target.checked)}
					type="checkbox"
				/>
				<span>
					{entry.name}
					<span className="block text-muted-foreground text-xs">{entry.description}</span>
				</span>
			</label>
			{entry.brain ? (
				<select
					aria-label={`Acceso al brain de ${entry.name}`}
					className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
					disabled={pending}
					onChange={(event) => setBrain(event.target.value)}
					value={brain}
				>
					{Object.entries(BRAIN_LABELS).map(([value, label]) => (
						<option key={value} value={value}>{label}</option>
					))}
				</select>
			) : null}
			<ConsoleMessage feedback={feedback} />
			<Button disabled={pending} onClick={save} size="sm" type="button" variant="outline">
				Guardar
			</Button>
		</li>
	);
}

export function AgentsSection({ slug, tenantId, agents }: { slug: string; tenantId: string; agents: AgentState[] }) {
	return (
		<ul className="divide-y rounded-lg border bg-card">
			{catalogAgents().map((agent) => (
				<AgentRow key={agent} agent={agent} slug={slug} state={agents.find((a) => a.agent === agent)} tenantId={tenantId} />
			))}
		</ul>
	);
}
```

Nota para el test "marca el rol actual": `renderToStaticMarkup` de un `<input checked>` controlado produce `checked=""`, y de un `<select value>` produce `selected=""` en la opción; los regex de los tests lo contemplan.

```tsx
// app/plataforma/[slug]/console/brain-section.tsx
"use client";

import Link from "next/link";
import { createBrain } from "../console-actions";
import { ConsoleButton } from "./console-button";

export interface BrainState {
	provider: string;
	categories: string[];
	createdAt: string;
}

const fecha = (value: string) => new Date(value).toLocaleDateString("es-AR");

export function BrainSection({ slug, tenantId, brain }: { slug: string; tenantId: string; brain: BrainState | null }) {
	if (!brain) {
		return (
			<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
				<span className="min-w-0 flex-1 text-muted-foreground">
					La empresa todavía no tiene brain. Nace vacío, con permisos abiertos para sus miembros.
				</span>
				<ConsoleButton label="Crear brain" run={() => createBrain(slug, tenantId)} variant="default" />
			</div>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
			<div className="min-w-0 flex-1">
				<div>Proveedor {brain.provider} · desde el {fecha(brain.createdAt)}</div>
				<div className="text-muted-foreground text-xs">Categorías: {brain.categories.join(", ")}</div>
			</div>
			<Link className="underline underline-offset-4" href={`/${slug}/brain`}>Abrir</Link>
		</div>
	);
}
```

```tsx
// app/plataforma/[slug]/console/connections-section.tsx
"use client";

import { removeConnection, setConnectionEnabled, verifyConnection } from "../console-actions";
import { ConsoleButton } from "./console-button";

export interface ConnectionState {
	id: string;
	capability: string;
	provider: string;
	connectorUids: string[];
	enabled: boolean;
	verifiedAt: string | null;
	verifiedName: string | null;
}

const fecha = (value: string) => new Date(value).toLocaleDateString("es-AR");

export function ConnectionsSection({ slug, tenantId, connections }: { slug: string; tenantId: string; connections: ConnectionState[] }) {
	if (connections.length === 0) {
		return <p className="text-muted-foreground text-sm">Todavía no hay conectores asociados.</p>;
	}
	return (
		<ul className="divide-y rounded-lg border bg-card" data-tenant={tenantId}>
			{connections.map((connection) => (
				<li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" key={connection.id}>
					<div className="min-w-0 flex-1">
						<div>
							{connection.provider}
							<span className="ml-2 text-muted-foreground text-xs">{connection.capability}</span>
						</div>
						{connection.connectorUids.length > 0 ? (
							<div className="font-mono text-muted-foreground text-xs">{connection.connectorUids.join(" · ")}</div>
						) : (
							<div className="text-muted-foreground text-xs">Conector de plataforma: cada persona autoriza su cuenta.</div>
						)}
						<div className="text-muted-foreground text-xs">
							{connection.verifiedAt
								? `Verificado el ${fecha(connection.verifiedAt)}${connection.verifiedName ? ` · ${connection.verifiedName}` : ""}`
								: connection.connectorUids.length > 0
									? "Sin verificar"
									: null}
						</div>
					</div>
					<span className="rounded-full border px-2 py-0.5 text-xs">{connection.enabled ? "Habilitado" : "Deshabilitado"}</span>
					<span className="inline-flex flex-wrap items-center gap-2">
						{connection.connectorUids.length > 0 ? (
							<ConsoleButton label="Verificar" run={() => verifyConnection(slug, connection.id)} />
						) : null}
						<ConsoleButton
							label={connection.enabled ? "Deshabilitar" : "Habilitar"}
							run={() => setConnectionEnabled(slug, connection.id, !connection.enabled)}
						/>
						<ConsoleButton
							confirmText="Se quita la asociación y el identificador queda libre. La llave sigue en Vercel: borrala ahí si ya no se usa."
							label="Quitar"
							run={() => removeConnection(slug, connection.id)}
						/>
					</span>
				</li>
			))}
		</ul>
	);
}
```

```tsx
// app/plataforma/[slug]/console/bind-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Feedback } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { runRowAction } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVIDERS, type ProviderKey } from "@/lib/connectors/providers";
import { bindConnection } from "../console-actions";
import { ConsoleMessage } from "./console-button";

const OFFERED = (Object.keys(PROVIDERS) as ProviderKey[]).filter((p) => PROVIDERS[p].capability !== "brain");

export function BindForm({ slug, tenantId }: { slug: string; tenantId: string }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [provider, setProvider] = useState<ProviderKey>(OFFERED[0]);
	const [uids, setUids] = useState<string[]>([""]);
	const info = PROVIDERS[provider];
	const withKey = info.authKind === "connect_api_key";

	function submit(event: React.FormEvent) {
		event.preventDefault();
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => bindConnection(slug, tenantId, provider, withKey ? uids : []),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			if (!out.failed) setUids([""]);
			setFeedback(out.feedback ?? (out.failed ? null : { ok: true, text: "Conector asociado." }));
		});
	}

	return (
		<form className="space-y-3 rounded-lg border bg-card px-4 py-3 text-sm" onSubmit={submit}>
			<h3 className="font-medium">Asociar conector</h3>
			<label className="block">
				<span className="mb-1 block text-xs text-muted-foreground">Proveedor</span>
				<select
					className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
					disabled={pending}
					onChange={(event) => {
						setProvider(event.target.value as ProviderKey);
						setUids([""]);
					}}
					value={provider}
				>
					{OFFERED.map((p) => (
						<option key={p} value={p}>{p} · {PROVIDERS[p].capability}</option>
					))}
				</select>
			</label>
			{withKey ? (
				<div className="space-y-2">
					<p className="text-muted-foreground text-xs">
						Pegá el identificador del conector creado en Vercel (<code>vercel connect list</code>). Acá nunca va la llave.
					</p>
					{uids.map((uid, index) => (
						<Input
							aria-label={`Identificador ${index + 1}`}
							className="max-w-md font-mono"
							disabled={pending}
							// biome-ignore lint/suspicious/noArrayIndexKey: campos sin identidad propia
							key={index}
							onChange={(event) => setUids(uids.map((u, i) => (i === index ? event.target.value : u)))}
							placeholder="acme-coldiq"
							value={uid}
						/>
					))}
					{info.multiple ? (
						<Button disabled={pending} onClick={() => setUids([...uids, ""])} size="sm" type="button" variant="outline">
							Agregar otro
						</Button>
					) : null}
				</div>
			) : (
				<p className="text-muted-foreground text-xs">
					Este proveedor usa el conector de la plataforma: cada persona autoriza su propia cuenta desde la app.
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={pending} size="sm" type="submit">Asociar</Button>
				<ConsoleMessage feedback={feedback} />
			</div>
		</form>
	);
}
```

- [ ] **Step 4: Implementar las páginas**

En `app/plataforma/[slug]/page.tsx`:

1. Sumar imports: `AgentsSection`, `BrainSection`, `ConnectionsSection`, `BindForm` desde `./console/*`, y `READINESS_LABELS`, `tenantReadiness` desde `@/lib/tenants/readiness`.
2. Después de cargar `memberships`, leer con `admin.supabase` (la RLS deja leer a plataforma):

```ts
	const [{ data: agentRows }, { data: connectionRows }] = await Promise.all([
		admin.supabase
			.from("tenant_agents")
			.select("agent, enabled, config")
			.eq("tenant_id", tenant.id),
		admin.supabase
			.from("tenant_connections")
			.select("id, capability, provider, connector_uid, config, enabled, verified_at, verified_name, created_at")
			.eq("tenant_id", tenant.id)
			.order("created_at"),
	]);
	const agents = (agentRows ?? []).map((row) => ({
		agent: row.agent as string,
		enabled: row.enabled === true,
		brain: ((row.config as { brain?: unknown } | null)?.brain as string | undefined) ?? "none",
	}));
	const connections = (connectionRows ?? []).map((row) => {
		const extra = (row.config as { connectorUids?: unknown } | null)?.connectorUids;
		return {
			id: row.id as string,
			capability: row.capability as string,
			provider: row.provider as string,
			connectorUids: [
				...new Set([
					...(typeof row.connector_uid === "string" ? [row.connector_uid] : []),
					...(Array.isArray(extra) ? extra.filter((u): u is string => typeof u === "string") : []),
				]),
			],
			enabled: row.enabled === true,
			verifiedAt: (row.verified_at as string | null) ?? null,
			verifiedName: (row.verified_name as string | null) ?? null,
			createdAt: row.created_at as string,
			categories: ((row.config as { categories?: unknown } | null)?.categories as string[] | undefined) ?? [],
		};
	});
	const brainRow = connections.find((c) => c.capability === "brain" && c.enabled) ?? null;
	const readiness = tenantReadiness({ agents, connections });
```

3. Entre la sección del formulario y la de "Usuarios", insertar:

```tsx
			<section>
				<h2 className="mb-3 text-lg">Qué falta</h2>
				{readiness.ready ? (
					<p className="text-sm">Lista para trabajar.</p>
				) : (
					<ul className="list-disc pl-5 text-sm">
						{readiness.missing.map((issue) => (
							<li key={issue}>{READINESS_LABELS[issue]}</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Agentes</h2>
				<AgentsSection agents={agents} slug={tenant.slug} tenantId={tenant.id} />
			</section>

			<section>
				<h2 className="mb-3 text-lg">Brain</h2>
				<BrainSection
					brain={brainRow ? { provider: brainRow.provider, categories: brainRow.categories, createdAt: brainRow.createdAt } : null}
					slug={tenant.slug}
					tenantId={tenant.id}
				/>
			</section>

			<section className="space-y-4">
				<h2 className="text-lg">Conectores</h2>
				<ConnectionsSection
					connections={connections.filter((c) => c.capability !== "brain")}
					slug={tenant.slug}
					tenantId={tenant.id}
				/>
				<BindForm slug={tenant.slug} tenantId={tenant.id} />
			</section>
```

En `app/plataforma/page.tsx`: sumar a `Promise.all` dos lecturas, `tenant_agents` (`tenant_id, agent, enabled`) y `tenant_connections` (`tenant_id, capability, provider, enabled, verified_at`), agrupar por `tenant_id`, y por cada empresa calcular `tenantReadiness`. En la fila, después del badge Activo/Inactivo:

```tsx
								<span className="text-muted-foreground text-sm">
									{readiness.ready
										? "Lista"
										: `Faltan: ${readiness.missing.map((issue) => READINESS_LABELS[issue]).join(", ")}`}
								</span>
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run tests/plataforma && npm run typecheck && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: PASS, typecheck limpio, suite completa en verde. Si el test de la lista falla porque `rowOf` corta el `<li>` en otro lugar, ajustar el helper del test, no lo que afirma.

- [ ] **Step 6: Commit**

```bash
npx biome check --write "app/plataforma/[slug]/console" "app/plataforma/[slug]/page.tsx" app/plataforma/page.tsx tests/plataforma/console-sections.test.ts tests/plataforma/detail-page.test.ts tests/plataforma/list-page.test.ts
git add "app/plataforma/[slug]/console" "app/plataforma/[slug]/page.tsx" app/plataforma/page.tsx tests/plataforma/console-sections.test.ts tests/plataforma/detail-page.test.ts tests/plataforma/list-page.test.ts
git commit -m "feat: la consola habilita agentes, crea el brain, asocia conectores y muestra qué le falta a cada empresa"
```

---

### Task 7: Baja del script, procedimiento, roadmap y cierre

**Files:**
- Delete: `scripts/connections-bind.mts`, `scripts/connections-bind-args.ts`, `scripts/connections-bind-config.ts`, `scripts/connections-bind-errors.ts`, `scripts/connections-bind-rule.ts`, `tests/scripts/connections-bind-args.test.ts`, `tests/scripts/connections-bind-errors.test.ts`, `tests/scripts/connections-bind-rule.test.ts`
- Modify: `package.json`, `CLAUDE.md`, `docs/01-roadmap-etapas.md`
- Create: `docs/llaves-de-clientes.md`

- [ ] **Step 1: Confirmar que nada más usa el script**

Run: `grep -rn "connections-bind\|connections:bind" --include=*.ts --include=*.mts --include=*.md --include=*.json . | grep -v node_modules | grep -v "\.eve/" | grep -v "^./docs/superpowers"`
Expected: solo `package.json`, `scripts/connections-bind*`, sus tests, `CLAUDE.md` o docs que describen el procedimiento viejo (`docs/brain-mcp-conexion.md` no; `docs/superpowers/specs/*` sí, y esas no se tocan). Si `scripts/brain-import.mts` importa algo de `connections-bind-*`, mover esa pieza a un archivo propio (`scripts/brain-import-rule.ts`, por ejemplo) antes de borrar.

- [ ] **Step 2: Borrar y actualizar**

```bash
git rm scripts/connections-bind.mts scripts/connections-bind-args.ts scripts/connections-bind-config.ts scripts/connections-bind-errors.ts scripts/connections-bind-rule.ts tests/scripts/connections-bind-args.test.ts tests/scripts/connections-bind-errors.test.ts tests/scripts/connections-bind-rule.test.ts
```

En `package.json`, borrar la línea `"connections:bind": ...`. En `CLAUDE.md`, la línea `- Comandos:` no cambia (no listaba el script); en la línea de la Etapa 7 / spec alta que dice "Los conectores siguen por `npm run connections:bind`" dentro de `docs/01-roadmap-etapas.md`, si existe, reemplazar por "Los conectores se asocian desde `/plataforma/<slug>`".

- [ ] **Step 3: Escribir `docs/llaves-de-clientes.md`**

```markdown
# Llaves de clientes: cómo entran a la plataforma

Las llaves de API de un cliente (ColdIQ, Apollo, Google Places) son del cliente. Viven en Vercel Connect, nunca en nuestra base, en el código, en un mail ni en una pantalla de la plataforma. La plataforma guarda solo el **identificador** del conector, que no es secreto.

## Quién hace qué

| Paso | Quién |
|---|---|
| Crea la llave en el proveedor | El cliente |
| Se la pasa a INNOV.AS | El cliente, por un canal seguro |
| Crea el conector en Vercel y lo adjunta al proyecto | INNOV.AS |
| Asocia el identificador a la empresa en la consola | INNOV.AS |
| Rota o da de baja | INNOV.AS, a pedido del cliente |

## Canal seguro

Nunca por mail, chat, ticket ni documento compartido. Opciones aceptadas: un gestor de secretos compartido con enlace de un solo uso, o la llave dictada en una llamada y tipeada directo en el comando de abajo. Si una llave llegó por un canal que no es seguro, se da por comprometida: pedirle al cliente que la rote antes de cargarla.

## Alta

Desde la carpeta del proyecto (`vercel link` ya hecho):

```bash
vercel connect create <servicio> --name <slug>-<proveedor>
vercel connect attach <uid> --yes
```

El nombre lleva el slug de la empresa para que `vercel connect list` lo muestre sin ambigüedad. El comando pide la llave en el momento; no se guarda en ningún archivo. Después:

1. Si la llave quedó en el portapapeles, en el historial de la terminal o en un archivo temporal, borrarla.
2. En `/plataforma/<slug>`, sección Conectores, elegir el proveedor y pegar el `uid`. La consola le pregunta a Vercel si existe y está adjunto, y recién ahí lo guarda. Si Vercel no lo conoce, no se guarda nada.
3. Un `uid` solo puede estar asociado a una empresa. Si la consola dice que ya está asociado a otra, no es un error de tipeo: es una llave de otro cliente.

## Rotación

1. El cliente crea la llave nueva y la pasa por el canal seguro.
2. `vercel connect create` con un nombre nuevo (`<slug>-<proveedor>-2`) y `attach`.
3. En la consola, asociar el `uid` nuevo al mismo proveedor: reemplaza al viejo y libera su identificador.
4. En Vercel, borrar el conector viejo. La consola no lo hace.

## Baja

1. En la consola, Quitar. Queda el evento `connection.removed` con quién lo hizo.
2. En Vercel, borrar el conector.
3. Avisarle al cliente que revoque la llave en el proveedor.

## Lo que no hace la plataforma

- No pide ni muestra llaves. Si una pantalla lo hiciera, es un bug grave.
- No verifica que la llave funcione contra el proveedor: eso se ve en la primera corrida del agente.
- No crea conectores desde la web. Cuando Vercel habilite la instalación por una página del cliente, este documento cambia.
```

- [ ] **Step 4: Actualizar el roadmap**

En `docs/01-roadmap-etapas.md`, sección "## Etapa 21":

1. La línea `**Spec/Plan:**` pasa a: `**Spec/Plan:** 21.1: \`docs/superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md\` · \`docs/superpowers/plans/2026-10-10-etapa-21-1-consola-conectores.md\`. 21.2 a 21.5: a escribir. Alcance general en \`docs/2026-10-09-plan-cierre-gap-plataforma.md\` §2.`
2. Reemplazar las casillas por:

```
Frontera decidida el 2026-10-10: cada cliente trae sus llaves y su administrador configura sus agentes; INNOV.AS ve el estado de todo y asocia las llaves que el cliente le pasa por un canal seguro (`docs/llaves-de-clientes.md`). Cinco entregas:

- [x] **21.1 · Consola: conectores y agentes.** Catálogo de agentes en código; alta de empresa eligiendo agentes; desde `/plataforma/<slug>`, habilitar agentes con su acceso al brain, crear el brain, asociar conectores con verificación contra Vercel, deshabilitar, quitar y verificar; "qué falta" por empresa; `connector_claims` impide que un conector sirva a dos empresas; `tenant_agents` cerrada a `authenticated`; `connections:bind` se va. **Antes de desplegar:** correr en producción la consulta de la spec §9 (ningún conector en dos empresas), aplicar la migración `20261015120000_platform_console` primero (`npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después el código; al revés, el alta de empresas falla. Después del deploy, apretar Verificar en cada conector de `innovas`.
- [ ] **21.2 · Settings del cliente.** Ejecutores, aprobaciones de nivel 2, qué conector usa cada agente, "Mis cuentas" para Gmail y HubSpot.
- [ ] **21.3 · Configuración de outreach.** ICP, listas y presupuestos desde la UI.
- [ ] **21.4 · Segundo tenant.** La Etapa 7 como prueba, solo con lo anterior.
- [ ] **21.5 · Clave de modelos por empresa.** Una clave del AI Gateway por cliente, en la cuenta de INNOV.AS, con presupuesto, y el gasto visible para el cliente.
```

3. Dejar el "Terminado cuando" como está.

- [ ] **Step 5: Verificar y commitear**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npm run db:test 2>&1 | tail -4; npm run typecheck; npm run build 2>&1 | tail -5`
Expected: todo en verde.

```bash
git add package.json CLAUDE.md docs/llaves-de-clientes.md docs/01-roadmap-etapas.md
git commit -m "docs: procedimiento de llaves de clientes, baja de connections:bind y cierre de la 21.1"
```

- [ ] **Step 6: Verificación en navegador contra la base local (la corre el controlador)**

1. `npm run db:reset`. Levantar el dev server con variables explícitas a la base local (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` de `npx supabase status -o env`, `PUBLIC_APP_URL=http://localhost:3000`, `PLATFORM_OWNER_TENANT_SLUG=innovas-seed`).
2. Entrar como `platform_admin` del seed (`admin-seed@innov.as`, link por Mailpit; si GoTrue no manda link a un usuario del seed, crear uno nuevo con `email_confirm` por la API de admin y darle membresía `platform_admin` en `innovas-seed`).
3. `/plataforma/nueva`: crear `prueba-21` con solo `outreach`. Expected: detalle con "Qué falta: sin brain, faltan conectores".
4. Crear brain. Expected: desaparece "sin brain" y aparece el link a `/prueba-21/brain`.
5. Asociar `coldiq` con `prueba-21-coldiq`. Expected: fila "Sin verificar" (en local no hay Vercel) y "conectores sin verificar" en qué falta. Apretar Verificar: "La verificación contra Vercel solo corre en un deploy."
6. En otra empresa (`demo`), asociar `coldiq` con el mismo `prueba-21-coldiq`. Expected: "el conector prueba-21-coldiq ya está asociado a otra empresa".
7. Deshabilitar, habilitar y quitar el conector en `prueba-21`. Expected: cada acción se refleja y después de quitar, `demo` sí puede asociarlo.
8. Apagar `outreach` en `prueba-21`. Expected: "sin agentes habilitados"; y `/prueba-21/conectar` deja de mostrar el agente.
9. Listado `/plataforma`: columna "Faltan: ..." por empresa.
10. A 375 px: las filas de conectores y agentes no desbordan.
11. Restaurar y apagar el dev server.

Si algún paso no se puede correr, decirlo en el resumen y no darlo por verificado.

- [ ] **Step 7: Entregar**

Usar `superpowers:verification-before-completion`. En el resumen final: la consulta previa y el orden de deploy, que las conexiones de `innovas` quedan "Sin verificar" hasta apretar Verificar en producción, y qué pasos de navegador no se corrieron. No hacer push ni abrir el PR sin que lo pida la persona.
