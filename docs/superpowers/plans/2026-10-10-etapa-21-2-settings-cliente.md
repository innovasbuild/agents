# Etapa 21.2: settings del cliente y "Mis cuentas": plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador de cliente configure ejecutores, aprobaciones de nivel 2 y el encendido de sus conectores desde `/<slug>/settings`, y que cualquier miembro autorice su Gmail y su HubSpot desde `/<slug>/mis-cuentas`, sin terminal.

**Architecture:** Cuatro funciones SQL `security definer` que ejecuta `authenticated` y que verifican adentro que quien llama sea administrador de esa empresa (patrón `block_member`), cada una con su evento. Server actions que resuelven la empresa por `slug` con la sesión y llaman esas funciones con el cliente de la sesión. "Mis cuentas" lee el estado pidiendo un token (sin efectos) y solo arranca una autorización por un clic.

**Tech Stack:** Postgres (Supabase), pgTAP, Next.js 16 App Router, `@supabase/ssr`, `@vercel/connect` (solo vía `lib/connectors/auth.ts`), zod, Vitest en entorno `node`.

**Spec:** `docs/superpowers/specs/2026-10-10-etapa-21-2-settings-cliente-design.md`

## Global Constraints

- Rama: `feat/etapa-21-2-settings-cliente`, sale de `main` (2af8af4, 21.1 mergeada). No hacer push ni abrir PR sin que lo pida la persona.
- Antes de escribir SQL, cargar la skill `supabase-postgres-best-practices`. Toda función nueva es `security definer set search_path = ''`. Las del cliente: `revoke execute ... from public, anon` y `grant execute ... to authenticated` (en este proyecto `ALTER DEFAULT PRIVILEGES` da EXECUTE a `anon` y `authenticated`: `from public` solo no alcanza). El permiso se decide **dentro** de la función.
- `events` es append-only: solo `insert`. Toda escritura deja su evento con `actor_user_id = auth.uid()` en la misma transacción.
- Reglas de negocio de las funciones: `errcode '23514'` con `hint = 'settings'` y mensaje en castellano; slug repetido: `errcode '23505'` con `hint = 'settings'`; sin permiso: `errcode '42501'`. La app muestra tal cual solo los mensajes con `hint = 'settings'`; `42501` → "No tenés permiso."; cualquier otro → "No se pudo guardar. Probá de nuevo." y `console.error` con código y mensaje.
- Las tablas `executors`, `tenant_connections` y `tenant_agents` siguen sin escritura directa para `authenticated`.
- Las server actions nunca toman el `tenant_id` del navegador: resuelven por `slug` con `resolveTenantAccess`. Llaman las funciones con `createServerSupabase()` (la sesión), no con el cliente admin.
- **`rpc()` no está tipado en este repo:** el typecheck no detecta un nombre de función o un argumento mal escrito. Los tests afirman nombre y argumentos exactos.
- Un archivo `"use server"` solo exporta funciones `async` y tipos. `tests/server-actions-exports.test.ts` lo vigila.
- `lib/connectors/auth.ts` es el único archivo que importa `@vercel/connect`.
- **Cargar una página nunca llama a `startAuthorizationForSubject`.** Arrancar una autorización deja el grant anterior sin servir hasta el consentimiento. Gmail se pide siempre con `GMAIL_SCOPES` completo (`lib/gmail/send.ts`).
- Ningún token ni URL de autorización se guarda, se registra en logs o eventos, ni viaja al navegador salvo la URL que pidió esa persona con su clic.
- Español rioplatense en UI y mensajes; código e identificadores en inglés. Nada específico de un tenant en código.
- Tests: `tests/**/*.test.ts`, entorno `node`, componentes con `createElement` y `renderToStaticMarkup`. SQL: `supabase/tests/*.test.sql` con pgTAP.
- Lint: **no** correr `npm run lint:fix`. Usar `npx biome check --write <archivos de la tarea>` y después `npx biome check <los mismos archivos>` (solo lectura) tiene que salir limpio. Pasar los archivos como argumentos separados.
- Después de cada tarea: `npm run typecheck` limpio. Cada commit termina con la línea `Co-Authored-By` del modelo que lo escribe. Identidad de git: `innovasbuild` / `matias@innov.as`. `git add` solo de los archivos de la tarea. Rutas sin trackear ajenas que no se tocan: `.codex/` y `docs/producto-innovas-ai-os.md`.
- Base local: Docker abierto. `npm run db:test` corre pgTAP. Después de aplicar una migración: `npm run db:reset && npm run db:types`. **No** aplicar nada en producción. No usar `.env.local` para levantar servidores.

## Review Focus

1. **Administrador de otra empresa:** un `tenant_admin` de la empresa B llama cualquiera de las cuatro funciones con el `p_tenant` de A, o con una conexión de A. Tiene que recibir 42501 (o `P0002` para la conexión) y no cambiar nada. Tarea 1.
2. **Quitar un ejecutor con historial:** las claves foráneas borran la cola en cascada. La función tiene que negarse **antes** de borrar y las filas tienen que seguir ahí. Tarea 1.
3. **Cliente que rehabilita lo que plataforma apagó:** con `locked_by_platform` el cliente no habilita; si plataforma vuelve a habilitar, el cliente recupera el control. Tarea 1.
4. **Cargar "Mis cuentas" con Gmail autorizado:** no puede llamar a `startAuthorizationForSubject` ni una vez, tampoco cuando el sondeo falla. Tarea 5.
5. **Error que no es de autorización al sondear** (red, 500 de Connect): el estado es "No pude comprobarlo", nunca "Sin autorizar" con un botón que arrancaría una autorización sobre un grant sano. Tarea 5.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261016120000_tenant_settings.sql` (nuevo) | Columna `locked_by_platform`, redefinición de `platform_set_connection_enabled`, las cuatro funciones del cliente |
| `supabase/tests/30_tenant_settings.test.sql` (nuevo) | pgTAP |
| `lib/tenants/approvals.ts` (nuevo) | Nodos aprobables, políticas, lectura de la política |
| `lib/outreach/settings-query.ts` (modifica) | Filas de ejecutores y conexiones con los campos nuevos |
| `app/[tenant]/settings/config-actions.ts` (nuevo) | Las cuatro acciones |
| `app/[tenant]/settings/config/*.tsx` (nuevos) | Componentes cliente de las tres secciones |
| `app/[tenant]/settings/page.tsx` (modifica) | Secciones editables |
| `lib/accounts/status.ts` (nuevo) | Qué cuentas ve una persona y sondeo del estado, puro |
| `lib/connectors/crm/owner.ts` (nuevo) | `resolveCrmOwnerId` |
| `lib/connectors/executors.ts` (modifica) | `markCrmOwner` |
| `app/[tenant]/mis-cuentas/{page.tsx,actions.ts,account-card.tsx}` (nuevos) | La página |
| `lib/tenants/nav.ts` (modifica) | Entrada "Mis cuentas" |
| `tests/server-actions-exports.test.ts` (modifica) | Recorre todo `app/` |
| `scripts/executors-set*`, `tests/scripts/executors-set-args.test.ts` (borra), `package.json`, `docs/01-roadmap-etapas.md` (modifica) | Baja del script y roadmap |

---

### Task 1: La base

**Files:**
- Create: `supabase/migrations/20261016120000_tenant_settings.sql`
- Create: `supabase/tests/30_tenant_settings.test.sql`
- Modify (generado): `lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `public.has_tenant_role(uuid, public.tenant_role[])`, `public.is_platform_admin()`, tablas `executors`, `tenant_agents`, `tenant_connections`, `memberships`, `queue_items`, `search_focuses`, `contacts`, `events`; `public.platform_set_connection_enabled(uuid, uuid, boolean)` (21.1).
- Produces (RPC, `authenticated`): `set_executor(p_tenant uuid, p_user uuid, p_slug text, p_display_name text, p_title text, p_linkedin_url text, p_daily_quota integer) → void`; `remove_executor(p_tenant uuid, p_user uuid) → void`; `set_approval(p_tenant uuid, p_agent text, p_node text, p_policy text) → void`; `set_connection_enabled(p_tenant uuid, p_connection uuid, p_enabled boolean) → void`. Columna `tenant_connections.locked_by_platform boolean not null default false`.

- [ ] **Step 1: Cargar la skill de Postgres**

Invocar `supabase-postgres-best-practices`.

- [ ] **Step 2: Escribir el pgTAP que falla**

```sql
-- supabase/tests/30_tenant_settings.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- Personas: 1 admin de ts-a, 2 miembro de ts-a (ejecutor candidato), 3 admin de
-- ts-b, 4 platform_admin (en ts-p), 5 miembro de ts-a con historial, 6 nadie.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c0c0c0c0-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm@ts-a.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ana@ts-a.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adm@ts-b.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'plat@ts-p.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'beto@ts-a.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'nadie@afuera.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d0d0d0d0-0000-0000-0000-00000000000a', 'ts-a', 'TS A'),
  ('d0d0d0d0-0000-0000-0000-00000000000b', 'ts-b', 'TS B'),
  ('d0d0d0d0-0000-0000-0000-00000000000c', 'ts-p', 'TS P');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000001', 'tenant_admin'),
  ('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'tenant_member'),
  ('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000005', 'tenant_member'),
  ('d0d0d0d0-0000-0000-0000-00000000000b', 'c0c0c0c0-0000-0000-0000-000000000003', 'tenant_admin'),
  ('d0d0d0d0-0000-0000-0000-00000000000c', 'c0c0c0c0-0000-0000-0000-000000000004', 'platform_admin');

insert into public.tenant_agents (tenant_id, agent, config)
values ('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach',
        '{"brain": "read", "approvals": {"outreach/otro": "once"}}');

insert into public.tenant_connections (id, tenant_id, capability, provider, connector_uid, config)
values
  ('e0e0e0e0-0000-0000-0000-000000000001', 'd0d0d0d0-0000-0000-0000-00000000000a', 'crm', 'hubspot', null, '{}'),
  ('e0e0e0e0-0000-0000-0000-000000000002', 'd0d0d0d0-0000-0000-0000-00000000000a', 'leads', 'coldiq', 'ts-a-coldiq', '{}'),
  ('e0e0e0e0-0000-0000-0000-000000000003', 'd0d0d0d0-0000-0000-0000-00000000000a', 'brain', 'wiki', null, '{"categories":["empresa"],"requiredFrontmatter":["title"],"search":"fts"}'),
  ('e0e0e0e0-0000-0000-0000-000000000004', 'd0d0d0d0-0000-0000-0000-00000000000b', 'leads', 'coldiq', 'ts-b-coldiq', '{}');

-- Beto (5) ya es ejecutor y tiene un contacto propio: historial.
insert into public.executors (tenant_id, user_id, slug, daily_quota)
values ('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000005', 'beto', 30);
insert into public.contacts (tenant_id, contact_key, source, owner_user_id)
values ('d0d0d0d0-0000-0000-0000-00000000000a', 'em:x@cliente.test', 'csv', 'c0c0c0c0-0000-0000-0000-000000000005');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c0c0c0c0-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1-6: privilegios.
select ok(has_function_privilege('authenticated', 'public.set_executor(uuid, uuid, text, text, text, text, integer)', 'execute'), 'authenticated ejecuta set_executor');
select ok(not has_function_privilege('anon', 'public.set_executor(uuid, uuid, text, text, text, text, integer)', 'execute'), 'anon no');
select ok(not has_function_privilege('anon', 'public.remove_executor(uuid, uuid)', 'execute'), 'anon no quita ejecutores');
select ok(not has_function_privilege('anon', 'public.set_approval(uuid, text, text, text)', 'execute'), 'anon no cambia aprobaciones');
select ok(not has_function_privilege('anon', 'public.set_connection_enabled(uuid, uuid, boolean)', 'execute'), 'anon no toca conectores');
select ok(has_function_privilege('authenticated', 'public.set_connection_enabled(uuid, uuid, boolean)', 'execute'), 'authenticated ejecuta set_connection_enabled');

-- 7-10: quién puede. Un miembro, el admin de otra empresa y alguien de afuera, no.
select pg_temp.login_as(2);
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', null, null, null, 30)$$,
  '42501', 'solo un administrador puede cambiar esto', 'un miembro no se hace ejecutor a sí mismo');
select pg_temp.login_as(3);
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', null, null, null, 30)$$,
  '42501', null, 'el admin de otra empresa no');
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', 'auto')$$,
  '42501', null, 'el admin de otra empresa no cambia aprobaciones');
select pg_temp.login_as(6);
select throws_ok(
  $$select public.remove_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000005')$$,
  '42501', null, 'alguien de afuera no');

-- 11-20: set_executor.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', 'Ana López', '  ', 'https://www.linkedin.com/in/ana', 40)$$,
  'el admin da de alta un ejecutor');
select pg_temp.logout();
select is(
  (select (slug, display_name, title, linkedin_url, daily_quota)::text from public.executors
    where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000002'),
  '(ana,"Ana López",,https://www.linkedin.com/in/ana,40)', 'guarda los datos y deja en nulo un texto en blanco');
select is(
  (select actor_user_id from public.events where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and type = 'executor.updated'),
  'c0c0c0c0-0000-0000-0000-000000000001'::uuid, 'el evento dice quién');
update public.executors set gmail_authorized_at = now(), crm_owner_id = '777'
 where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000002';
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', 'Ana', null, null, 0)$$,
  'editar con cupo 0');
select pg_temp.logout();
select is(
  (select (crm_owner_id, gmail_authorized_at is not null, daily_quota, linkedin_url)::text from public.executors
    where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000002'),
  '(777,t,0,)', 'editar no toca lo que sella el servidor');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', null, null, null, 201)$$,
  '23514', 'el cupo diario va de 0 a 200', 'techo del cupo');
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', null, null, null, -1)$$,
  '23514', 'el cupo diario va de 0 a 200', 'piso del cupo');
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000006', 'nadie', null, null, null, 30)$$,
  '23514', 'esa persona no es miembro de la empresa', 'solo miembros');
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'beto', null, null, null, 30)$$,
  '23505', 'ese slug ya lo usa otro ejecutor', 'slug repetido');
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'Ana!', null, null, 'http://linkedin.com/ana', 30)$$,
  '23514', null, 'slug o LinkedIn con formato inválido');

-- 21-27: remove_executor. Con historial se niega y nada se borra.
select throws_ok(
  $$select public.remove_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000005')$$,
  '23514', 'tiene historial: ponele cupo 0 para que no envíe', 'con un contacto propio no se quita');
select pg_temp.logout();
select is(
  (select owner_user_id from public.contacts where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and contact_key = 'em:x@cliente.test'),
  'c0c0c0c0-0000-0000-0000-000000000005'::uuid, 'el contacto sigue con su dueño');
select is(
  (select count(*)::int from public.executors where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000005'),
  1, 'el ejecutor sigue ahí');
select pg_temp.login_as(1);
select lives_ok(
  $$select public.remove_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002')$$,
  'sin historial se quita');
select throws_ok(
  $$select public.remove_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002')$$,
  'P0002', null, 'quitar a quien no es ejecutor');
select pg_temp.logout();
select is(
  (select count(*)::int from public.executors where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000002'),
  0, 'la fila se fue');
select is(
  (select count(*)::int from public.events where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and type = 'executor.removed'
     and actor_user_id = 'c0c0c0c0-0000-0000-0000-000000000001'),
  1, 'con su evento');

-- 28-35: set_approval.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', 'auto')$$,
  'el admin cambia una política');
select pg_temp.logout();
select is(
  (select config from public.tenant_agents where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and agent = 'outreach'),
  '{"brain": "read", "approvals": {"outreach/otro": "once", "outreach/crm-record": "auto"}}'::jsonb,
  'conserva brain y las otras políticas');
select is(
  (select payload from public.events where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and type = 'approval.updated'),
  '{"agent": "outreach", "node": "outreach/crm-record", "policy": "auto"}'::jsonb, 'el evento lleva agente, nodo y política');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', 'nunca')$$,
  '23514', 'la política tiene que ser always, once o auto', 'política desconocida');
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', null)$$,
  '23514', null, 'política nula');
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'soporte/responder', 'auto')$$,
  '23514', 'ese paso no pertenece a ese agente', 'nodo de otro agente');
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'soporte', 'soporte/responder', 'auto')$$,
  '23514', 'la empresa no tiene ese agente', 'agente que la empresa no tiene');
select pg_temp.login_as(4);
select lives_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', 'always')$$,
  'un platform_admin puede');

-- 36-47: set_connection_enabled y el bloqueo de plataforma.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', false)$$,
  'el admin apaga un conector');
select lives_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', true)$$,
  'y lo vuelve a encender: lo apagó él');
select throws_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000003', false)$$,
  '23514', 'el brain lo maneja INNOV.AS', 'el brain no se toca');
select throws_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000004', false)$$,
  'P0002', null, 'una conexión de otra empresa no existe para él');
select pg_temp.login_as(3);
select throws_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', false)$$,
  '42501', null, 'el admin de otra empresa no');
select pg_temp.logout();
select is(
  (select (enabled, locked_by_platform, updated_by)::text from public.tenant_connections where id = 'e0e0e0e0-0000-0000-0000-000000000002'),
  '(t,f,c0c0c0c0-0000-0000-0000-000000000001)', 'quedó encendido, sin bloqueo, con quién lo tocó');
select is(
  (select string_agg(type || ':' || (payload ->> 'actor'), ',' order by id) from public.events
    where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and type like 'connection.%'),
  'connection.disabled:cliente,connection.enabled:cliente', 'los eventos dicen que fue el cliente');
select lives_ok(
  $$select public.platform_set_connection_enabled('c0c0c0c0-0000-0000-0000-000000000004', 'e0e0e0e0-0000-0000-0000-000000000002', false)$$,
  'plataforma lo apaga');
select is(
  (select (enabled, locked_by_platform)::text from public.tenant_connections where id = 'e0e0e0e0-0000-0000-0000-000000000002'),
  '(f,t)', 'queda bloqueado por plataforma');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', true)$$,
  '23514', 'INNOV.AS deshabilitó este conector: pedile que lo habilite', 'el cliente no lo rehabilita');
select pg_temp.logout();
select lives_ok(
  $$select public.platform_set_connection_enabled('c0c0c0c0-0000-0000-0000-000000000004', 'e0e0e0e0-0000-0000-0000-000000000002', true)$$,
  'plataforma lo enciende');
select is(
  (select (enabled, locked_by_platform)::text from public.tenant_connections where id = 'e0e0e0e0-0000-0000-0000-000000000002'),
  '(t,f)', 'y el bloqueo se va');

-- 48-52: las tablas siguen cerradas a escritura directa, y el cliente recupera el control.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', false)$$,
  'el cliente vuelve a poder apagarlo');
select throws_ok(
  $$update public.tenant_connections set locked_by_platform = false where id = 'e0e0e0e0-0000-0000-0000-000000000002'$$,
  '42501', null, 'nadie escribe la tabla de conectores directo');
select throws_ok(
  $$update public.executors set daily_quota = 9999 where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a'$$,
  '42501', null, 'ni la de ejecutores');
select throws_ok(
  $$update public.tenant_agents set config = '{"approvals":{"outreach/send":"auto"}}' where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a'$$,
  '42501', null, 'ni la de agentes');
select pg_temp.logout();
select is(
  (select count(*)::int from public.tenant_connections where locked_by_platform and enabled),
  0, 'nunca queda un conector encendido y bloqueado');

select * from finish();
rollback;
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npm run db:test 2>&1 | tail -20`
Expected: `30_tenant_settings.test.sql` falla (las funciones no existen). Los demás pasan.

- [ ] **Step 4: Escribir la migración**

```sql
-- supabase/migrations/20261016120000_tenant_settings.sql
-- Settings del cliente (spec 2026-10-10-etapa-21-2).
--
-- El administrador de una empresa configura ejecutores, aprobaciones de nivel 2
-- y el encendido de sus conectores. Las tablas siguen cerradas a escritura
-- directa: escribe por funciones security definer que verifican adentro que
-- quien llama sea administrador de ESA empresa (patrón block_member, 20.2).
-- Las reglas de negocio salen con errcode 23514 (23505 para un slug repetido)
-- y hint 'settings': la app muestra ese mensaje tal cual.

-- Plataforma apaga un conector ⇒ el cliente no lo puede encender. Con una
-- sola bandera, un cliente podría rehabilitar lo que INNOV.AS apagó por una
-- llave filtrada.
alter table public.tenant_connections
  add column locked_by_platform boolean not null default false;

-- Hasta hoy solo plataforma podía deshabilitar.
update public.tenant_connections set locked_by_platform = true where not enabled;

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

  begin
    update public.tenant_connections
       set enabled = p_enabled, locked_by_platform = not p_enabled,
           updated_by = p_actor, updated_at = now()
     where id = p_connection
    returning tenant_id, capability || '/' || provider into v_tenant, v_summary;
  exception when unique_violation then
    raise exception 'la empresa ya tiene un brain' using errcode = '23514', hint = 'consola';
  end;
  if v_tenant is null then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_tenant, p_actor, case when p_enabled then 'connection.enabled' else 'connection.disabled' end,
          v_summary, jsonb_build_object('connection_id', p_connection));
end;
$$;

-- Quién llama, o 42501. Solo la usan las funciones de abajo (corren como su
-- dueño): nadie más la ejecuta.
create or replace function public.settings_actor(p_tenant uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'no authenticated user' using errcode = '42501';
  end if;
  if not (
    (select public.has_tenant_role(p_tenant, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  ) then
    raise exception 'solo un administrador puede cambiar esto' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.set_executor(
  p_tenant uuid, p_user uuid, p_slug text, p_display_name text,
  p_title text, p_linkedin_url text, p_daily_quota integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_name text := nullif(btrim(p_display_name), '');
  v_title text := nullif(btrim(p_title), '');
  v_linkedin text := nullif(btrim(p_linkedin_url), '');
begin
  if not exists (
    select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = p_user
  ) then
    raise exception 'esa persona no es miembro de la empresa' using errcode = '23514', hint = 'settings';
  end if;
  if p_daily_quota is null or p_daily_quota < 0 or p_daily_quota > 200 then
    raise exception 'el cupo diario va de 0 a 200' using errcode = '23514', hint = 'settings';
  end if;
  if p_slug is null or p_slug !~ '^[a-z][a-z0-9-]{0,30}$' then
    raise exception 'el slug va en minúsculas, con números o guiones, y empieza con una letra'
      using errcode = '23514', hint = 'settings';
  end if;
  if v_linkedin is not null and v_linkedin !~ '^https://([a-z]{2,3}\.)?linkedin\.com/in/.+' then
    raise exception 'el LinkedIn tiene que ser una dirección https://www.linkedin.com/in/…'
      using errcode = '23514', hint = 'settings';
  end if;
  if length(v_name) > 120 or length(v_title) > 120 then
    raise exception 'el nombre y el puesto van hasta 120 caracteres' using errcode = '23514', hint = 'settings';
  end if;

  begin
    insert into public.executors (tenant_id, user_id, slug, display_name, title, linkedin_url, daily_quota)
    values (p_tenant, p_user, p_slug, v_name, v_title, v_linkedin, p_daily_quota)
    on conflict (tenant_id, user_id) do update
      set slug = excluded.slug,
          display_name = excluded.display_name,
          title = excluded.title,
          linkedin_url = excluded.linkedin_url,
          daily_quota = excluded.daily_quota;
  exception when unique_violation then
    raise exception 'ese slug ya lo usa otro ejecutor' using errcode = '23505', hint = 'settings';
  end;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'executor.updated', p_slug,
          jsonb_build_object('user_id', p_user, 'slug', p_slug, 'daily_quota', p_daily_quota));
end;
$$;

create or replace function public.remove_executor(p_tenant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_slug text;
begin
  -- Las claves foráneas hacia executors son on delete cascade (queue_items,
  -- search_focuses) o set null (contacts): borrar se llevaría el historial de
  -- envíos sin avisar. Se chequea acá, antes de tocar nada.
  if exists (select 1 from public.queue_items q where q.tenant_id = p_tenant and q.executor_user_id = p_user)
     or exists (select 1 from public.search_focuses f where f.tenant_id = p_tenant and f.created_by = p_user)
     or exists (select 1 from public.contacts c where c.tenant_id = p_tenant and c.owner_user_id = p_user)
  then
    raise exception 'tiene historial: ponele cupo 0 para que no envíe' using errcode = '23514', hint = 'settings';
  end if;

  delete from public.executors where tenant_id = p_tenant and user_id = p_user
  returning slug into v_slug;
  if not found then
    raise exception 'no es ejecutor de la empresa' using errcode = 'P0002';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'executor.removed', v_slug, jsonb_build_object('user_id', p_user));
end;
$$;

create or replace function public.set_approval(
  p_tenant uuid, p_agent text, p_node text, p_policy text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
begin
  if p_policy is null or p_policy not in ('always', 'once', 'auto') then
    raise exception 'la política tiene que ser always, once o auto' using errcode = '23514', hint = 'settings';
  end if;
  if p_node is null or p_agent is null
     or p_node !~ '^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$'
     or split_part(p_node, '/', 1) <> p_agent then
    raise exception 'ese paso no pertenece a ese agente' using errcode = '23514', hint = 'settings';
  end if;

  update public.tenant_agents
     set config = jsonb_set(
           coalesce(config, '{}'::jsonb), '{approvals}',
           coalesce(config -> 'approvals', '{}'::jsonb) || jsonb_build_object(p_node, p_policy))
   where tenant_id = p_tenant and agent = p_agent;
  if not found then
    raise exception 'la empresa no tiene ese agente' using errcode = '23514', hint = 'settings';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'approval.updated', p_node,
          jsonb_build_object('agent', p_agent, 'node', p_node, 'policy', p_policy));
end;
$$;

create or replace function public.set_connection_enabled(
  p_tenant uuid, p_connection uuid, p_enabled boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_row public.tenant_connections%rowtype;
begin
  if p_enabled is null then
    raise exception 'falta el estado' using errcode = '23514', hint = 'settings';
  end if;

  -- Filtra por empresa: una conexión de otra empresa "no existe" para quien llama.
  select * into v_row from public.tenant_connections c
   where c.id = p_connection and c.tenant_id = p_tenant
     for update;
  if not found then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;
  if v_row.capability = 'brain' then
    raise exception 'el brain lo maneja INNOV.AS' using errcode = '23514', hint = 'settings';
  end if;
  if p_enabled and v_row.locked_by_platform then
    raise exception 'INNOV.AS deshabilitó este conector: pedile que lo habilite'
      using errcode = '23514', hint = 'settings';
  end if;

  update public.tenant_connections
     set enabled = p_enabled, locked_by_platform = false, updated_by = v_actor, updated_at = now()
   where id = p_connection;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, case when p_enabled then 'connection.enabled' else 'connection.disabled' end,
          v_row.capability || '/' || v_row.provider,
          jsonb_build_object('connection_id', p_connection, 'actor', 'cliente'));
end;
$$;

revoke execute on function public.settings_actor(uuid) from public, anon, authenticated;

revoke execute on function public.set_executor(uuid, uuid, text, text, text, text, integer) from public, anon;
revoke execute on function public.remove_executor(uuid, uuid) from public, anon;
revoke execute on function public.set_approval(uuid, text, text, text) from public, anon;
revoke execute on function public.set_connection_enabled(uuid, uuid, boolean) from public, anon;

grant execute on function public.set_executor(uuid, uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.remove_executor(uuid, uuid) to authenticated;
grant execute on function public.set_approval(uuid, text, text, text) to authenticated;
grant execute on function public.set_connection_enabled(uuid, uuid, boolean) to authenticated;
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run db:test 2>&1 | tail -25`
Expected: todo en verde, con `30` en 52 aserciones. Si una aserción falla, decidir primero si es el armado del test (una columna `not null` del fixture, el orden de `login_as`/`logout`, el texto de un registro compuesto, el conteo de `plan()`) o la función; se corrige el que corresponda **sin cambiar el comportamiento esperado**. `settings_actor` se revoca de `authenticated` y la llaman funciones `security definer`: si Postgres niega la llamada interna, la causa es el dueño de la función, no el revoke; reportarlo en vez de abrir el permiso.

- [ ] **Step 6: Regenerar tipos y commit**

```bash
npm run db:reset && npm run db:types
npm run typecheck
git add supabase/migrations/20261016120000_tenant_settings.sql supabase/tests/30_tenant_settings.test.sql lib/supabase/database.types.ts
git commit -m "feat: funciones para que el administrador del cliente configure ejecutores, aprobaciones y conectores"
```

---

### Task 2: Aprobaciones y filas de settings (lectura pura)

**Files:**
- Create: `lib/tenants/approvals.ts`
- Modify: `lib/outreach/settings-query.ts`
- Test: `tests/tenants/approvals.test.ts` (nuevo), `tests/pipeline/settings-query.test.ts` (amplía)

**Interfaces:**
- Consumes: `NODES` de `lib/workflows/registry.ts`.
- Produces: `POLICIES: readonly ["always","once","auto"]`; `type Policy`; `POLICY_LABELS: Record<Policy, string>`; `POLICY_HELP: Record<Policy, string>`; `approvableNodes(agent: string): string[]`; `readPolicy(config: unknown, node: string): Policy`; `isPolicy(value: string): value is Policy`. En `settings-query.ts`: `ExecutorRow` gana `displayName, title, linkedinUrl, crmOwnerId` (todas `string | null`); `ConnectionRow` gana `lockedByPlatform: boolean`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/tenants/approvals.test.ts
import { describe, expect, it } from "vitest";
import {
	approvableNodes,
	isPolicy,
	POLICIES,
	POLICY_HELP,
	POLICY_LABELS,
	readPolicy,
} from "@/lib/tenants/approvals";
import { NODES } from "@/lib/workflows/registry";

describe("approvableNodes", () => {
	it("son los nodos de nivel 2 del agente, y nada más", () => {
		const expected = Object.entries(NODES)
			.filter(([name, info]) => name.startsWith("outreach/") && info.effect === 2)
			.map(([name]) => name)
			.sort();

		expect(approvableNodes("outreach")).toEqual(expected);
		expect(expected).toContain("outreach/crm-record");
	});

	it("nunca incluye un nodo de nivel 3", () => {
		for (const node of approvableNodes("outreach")) {
			expect(NODES[node]?.effect).toBe(2);
		}
		expect(approvableNodes("outreach")).not.toContain("outreach/send");
	});

	it("un agente sin nodos de nivel 2, o desconocido, no tiene ninguno", () => {
		expect(approvableNodes("soporte")).toEqual([]);
		expect(approvableNodes("")).toEqual([]);
		// "out" no es el agente "outreach": el prefijo es el dominio entero.
		expect(approvableNodes("out")).toEqual([]);
	});
});

describe("readPolicy", () => {
	it("lee la política guardada", () => {
		const config = { approvals: { "outreach/crm-record": "auto", "outreach/x": "once" } };
		expect(readPolicy(config, "outreach/crm-record")).toBe("auto");
		expect(readPolicy(config, "outreach/x")).toBe("once");
	});

	it.each([
		null,
		undefined,
		"texto",
		{},
		{ approvals: null },
		{ approvals: "auto" },
		{ approvals: { "outreach/crm-record": "nunca" } },
		{ approvals: { "outreach/crm-record": 1 } },
	])("cualquier otra cosa es always: %j", (config) => {
		expect(readPolicy(config, "outreach/crm-record")).toBe("always");
	});
});

describe("políticas", () => {
	it("cada política tiene rótulo y explicación", () => {
		for (const policy of POLICIES) {
			expect(POLICY_LABELS[policy]).toBeTruthy();
			expect(POLICY_HELP[policy]).toBeTruthy();
		}
	});

	it("isPolicy reconoce solo las tres", () => {
		expect(POLICIES.every(isPolicy)).toBe(true);
		expect(isPolicy("nunca")).toBe(false);
		expect(isPolicy("toString")).toBe(false);
	});
});
```

En `tests/pipeline/settings-query.test.ts`, agregar (leer primero cómo arma las filas ese archivo y seguir su estilo):

```ts
	it("trae la firma y el dueño en el CRM del ejecutor", () => {
		expect(
			toExecutorRows([
				{
					user_id: "u1",
					slug: "ana",
					daily_quota: 30,
					gmail_authorized_at: null,
					display_name: "Ana López",
					title: "AE",
					linkedin_url: "https://www.linkedin.com/in/ana",
					crm_owner_id: "777",
				},
			])[0],
		).toMatchObject({
			displayName: "Ana López",
			title: "AE",
			linkedinUrl: "https://www.linkedin.com/in/ana",
			crmOwnerId: "777",
		});
	});

	it("un ejecutor sin esos datos los trae en null", () => {
		expect(toExecutorRows([{ user_id: "u1" }])[0]).toMatchObject({
			displayName: null,
			title: null,
			linkedinUrl: null,
			crmOwnerId: null,
		});
	});

	it("la conexión dice si la bloqueó plataforma", () => {
		const rows = toConnectionRows([
			{ id: "c1", capability: "leads", provider: "coldiq", enabled: false, locked_by_platform: true },
			{ id: "c2", capability: "crm", provider: "hubspot", enabled: true },
		]);
		expect(rows.map((row) => row.lockedByPlatform)).toEqual([true, false]);
	});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tenants/approvals.test.ts tests/pipeline/settings-query.test.ts`
Expected: FAIL. `approvals` no resuelve; los campos nuevos son `undefined`.

- [ ] **Step 3: Implementar**

```ts
// lib/tenants/approvals.ts
// Política de aprobaciones de nivel 2 (docs/02-orquestacion.md §4 y spec 21.2
// S12). El registro de nodos es la única fuente de qué paso admite política:
// los de effect 2. Un nodo de nivel 3 nunca aparece: lleva aprobación humana
// siempre. Solo importa datos planos: lo usan componentes cliente.
import { NODES } from "../workflows/registry";

export const POLICIES = ["always", "once", "auto"] as const;
export type Policy = (typeof POLICIES)[number];

export const POLICY_LABELS: Record<Policy, string> = {
	always: "Siempre pedir",
	once: "Pedir la primera vez",
	auto: "Sin pedir",
};

export const POLICY_HELP: Record<Policy, string> = {
	always: "El agente espera a que una persona lo apruebe cada vez.",
	once: "Pide aprobación la primera vez y después sigue solo.",
	auto: "Lo hace solo, también en los procesos automáticos.",
};

export function isPolicy(value: string): value is Policy {
	return (POLICIES as readonly string[]).includes(value);
}

/** Nodos de nivel 2 cuyo dominio es exactamente ese agente, en orden estable. */
export function approvableNodes(agent: string): string[] {
	if (!agent) return [];
	const prefix = `${agent}/`;
	return Object.entries(NODES)
		.filter(([name, info]) => name.startsWith(prefix) && info.effect === 2)
		.map(([name]) => name)
		.sort();
}

/** Misma regla que nodePolicy en lib/workflows/store.ts: todo lo demás es always. */
export function readPolicy(config: unknown, node: string): Policy {
	const approvals =
		config && typeof config === "object"
			? (config as { approvals?: unknown }).approvals
			: null;
	const value =
		approvals && typeof approvals === "object"
			? (approvals as Record<string, unknown>)[node]
			: null;
	return value === "auto" || value === "once" ? value : "always";
}
```

En `lib/outreach/settings-query.ts`: sumar a `ExecutorRow` los cuatro campos (`displayName`, `title`, `linkedinUrl`, `crmOwnerId`, todos `string | null`) y mapearlos con `nullableStr(row.display_name)`, `nullableStr(row.title)`, `nullableStr(row.linkedin_url)`, `nullableStr(row.crm_owner_id)`. Sumar a `ConnectionRow` `lockedByPlatform: boolean` con `row.locked_by_platform === true`. Cambiar el comentario de cabecera: ya no es "de solo lectura para /settings", es "normalización de las filas de /settings".

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/tenants/approvals.test.ts tests/pipeline && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/tenants/approvals.ts lib/outreach/settings-query.ts tests/tenants/approvals.test.ts tests/pipeline/settings-query.test.ts
npx biome check lib/tenants/approvals.ts lib/outreach/settings-query.ts tests/tenants/approvals.test.ts tests/pipeline/settings-query.test.ts
git add lib/tenants/approvals.ts lib/outreach/settings-query.ts tests/tenants/approvals.test.ts tests/pipeline/settings-query.test.ts
git commit -m "feat: nodos aprobables y política leídos del registro, y filas de settings con firma y bloqueo"
```

---

### Task 3: Server actions del settings

**Files:**
- Create: `app/[tenant]/settings/config-actions.ts`
- Modify: `tests/server-actions-exports.test.ts`
- Test: `tests/settings/config-actions.test.ts` (nuevo)

**Interfaces:**
- Consumes: las cuatro funciones SQL (Tarea 1); `approvableNodes`, `isPolicy` (Tarea 2); `resolveTenantAccess` (`lib/tenants/resolve.ts`, devuelve `{ id, slug, role, userId, ... } | null`); `createServerSupabase`; `actionAllowsLogin(supabase, userId, tenantId)`.
- Produces, todas `Promise<ConfigResult>` con `type ConfigResult = { ok: true } | { ok: false; message: string }`:
  - `saveExecutor(slug: string, userId: string, input: { slug: string; displayName: string; title: string; linkedinUrl: string; dailyQuota: number })`
  - `removeExecutor(slug: string, userId: string)`
  - `saveApproval(slug: string, agent: string, node: string, policy: string)`
  - `toggleConnection(slug: string, connectionId: string, enabled: boolean)`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/settings/config-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CONN = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
	access: {
		id: "11111111-1111-4111-8111-111111111111",
		slug: "acme",
		role: "tenant_admin",
		userId: "me",
	} as { id: string; slug: string; role: string; userId: string } | null,
	allows: true,
	rpc: { data: null, error: null } as {
		data: unknown;
		error: { code?: string; message: string; hint?: string } | null;
	},
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	resolved: [] as string[],
	revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async (slug: string) => {
		state.resolved.push(slug);
		return state.access;
	},
}));
vi.mock("@/lib/tenants/login-check-server", () => ({
	actionAllowsLogin: async () => state.allows,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		rpc: async (fn: string, args: Record<string, unknown>) => {
			state.rpcCalls.push({ fn, args });
			return state.rpc;
		},
	}),
}));

const actions = await import("@/app/[tenant]/settings/config-actions");

const SIN_PERMISO = { ok: false, message: "No tenés permiso." };
const INVALIDO = { ok: false, message: "No se pudo procesar el pedido." };
const GENERICO = { ok: false, message: "No se pudo guardar. Probá de nuevo." };
const INPUT = {
	slug: "ana",
	displayName: "Ana López",
	title: "AE",
	linkedinUrl: "https://www.linkedin.com/in/ana",
	dailyQuota: 40,
};

beforeEach(() => {
	state.access = { id: TENANT, slug: "acme", role: "tenant_admin", userId: "me" };
	state.allows = true;
	state.rpc = { data: null, error: null };
	state.rpcCalls = [];
	state.resolved = [];
	state.revalidated = [];
});

const all = () => [
	actions.saveExecutor("acme", USER, INPUT),
	actions.removeExecutor("acme", USER),
	actions.saveApproval("acme", "outreach", "outreach/crm-record", "auto"),
	actions.toggleConnection("acme", CONN, false),
];

describe("gate común", () => {
	it("sin acceso a la empresa, ninguna acción llama a la base", async () => {
		state.access = null;
		expect(await Promise.all(all())).toEqual([SIN_PERMISO, SIN_PERMISO, SIN_PERMISO, SIN_PERMISO]);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un miembro no llama a la base", async () => {
		state.access = { id: TENANT, slug: "acme", role: "tenant_member", userId: "me" };
		expect(await Promise.all(all())).toEqual([SIN_PERMISO, SIN_PERMISO, SIN_PERMISO, SIN_PERMISO]);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("si la empresa no permite el método de la sesión, tampoco", async () => {
		state.allows = false;
		expect(await Promise.all(all())).toEqual([SIN_PERMISO, SIN_PERMISO, SIN_PERMISO, SIN_PERMISO]);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("la empresa sale del slug resuelto con la sesión, nunca de un argumento", async () => {
		await actions.toggleConnection("acme", CONN, true);
		expect(state.resolved).toEqual(["acme"]);
		expect(state.rpcCalls[0]?.args.p_tenant).toBe(TENANT);
	});

	it("un slug con forma inválida ni siquiera se resuelve", async () => {
		expect(await actions.removeExecutor("../otra", USER)).toEqual(INVALIDO);
		expect(state.resolved).toHaveLength(0);
	});

	it("un platform_admin pasa", async () => {
		state.access = { id: TENANT, slug: "acme", role: "platform_admin", userId: "me" };
		expect(await actions.toggleConnection("acme", CONN, true)).toEqual({ ok: true });
	});

	it("traduce los errores de la base", async () => {
		state.rpc = { data: null, error: { code: "23514", message: "el cupo diario va de 0 a 200", hint: "settings" } };
		expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual({ ok: false, message: "el cupo diario va de 0 a 200" });

		state.rpc = { data: null, error: { code: "23505", message: "ese slug ya lo usa otro ejecutor", hint: "settings" } };
		expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual({ ok: false, message: "ese slug ya lo usa otro ejecutor" });

		state.rpc = { data: null, error: { code: "42501", message: "solo un administrador puede cambiar esto" } };
		expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual(SIN_PERMISO);

		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// Un 23514 SIN hint es un check de la tabla: su texto no va a la pantalla.
			state.rpc = { data: null, error: { code: "23514", message: 'violates check constraint "executors_slug_check"' } };
			expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual(GENERICO);
			expect(log).toHaveBeenCalledWith("settings:", "23514", 'violates check constraint "executors_slug_check"');
		} finally {
			log.mockRestore();
		}
	});

	it("revalida el settings de la empresa solo cuando salió bien", async () => {
		await actions.toggleConnection("acme", CONN, true);
		expect(state.revalidated).toEqual(["/acme/settings"]);

		state.revalidated = [];
		state.rpc = { data: null, error: { code: "42501", message: "x" } };
		await actions.toggleConnection("acme", CONN, true);
		expect(state.revalidated).toEqual([]);
	});
});

describe("saveExecutor", () => {
	it("llama set_executor con los argumentos exactos", async () => {
		expect(await actions.saveExecutor("acme", USER, INPUT)).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_executor",
				args: {
					p_tenant: TENANT,
					p_user: USER,
					p_slug: "ana",
					p_display_name: "Ana López",
					p_title: "AE",
					p_linkedin_url: "https://www.linkedin.com/in/ana",
					p_daily_quota: 40,
				},
			},
		]);
	});

	it.each([
		["usuario que no es guid", "no-es-id", INPUT],
		["cupo no entero", USER, { ...INPUT, dailyQuota: 1.5 }],
		["cupo como texto", USER, { ...INPUT, dailyQuota: "40" as unknown as number }],
		["slug vacío", USER, { ...INPUT, slug: "" }],
		["nombre de 500 caracteres", USER, { ...INPUT, displayName: "x".repeat(500) }],
	])("rechaza %s sin llamar a la base", async (_name, userId, input) => {
		expect(await actions.saveExecutor("acme", userId, input)).toEqual(INVALIDO);
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("removeExecutor", () => {
	it("llama remove_executor", async () => {
		expect(await actions.removeExecutor("acme", USER)).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([{ fn: "remove_executor", args: { p_tenant: TENANT, p_user: USER } }]);
	});
});

describe("saveApproval", () => {
	it("llama set_approval para un nodo de nivel 2", async () => {
		expect(await actions.saveApproval("acme", "outreach", "outreach/crm-record", "auto")).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{ fn: "set_approval", args: { p_tenant: TENANT, p_agent: "outreach", p_node: "outreach/crm-record", p_policy: "auto" } },
		]);
	});

	it.each([
		["nivel 3", "outreach", "outreach/send"],
		["nivel 1", "outreach", "outreach/research"],
		["nodo inexistente", "outreach", "outreach/nada"],
		["nodo de otro agente", "soporte", "outreach/crm-record"],
	])("un paso de %s no admite política y no llega a la base", async (_name, agent, node) => {
		expect(await actions.saveApproval("acme", agent, node, "auto")).toEqual({
			ok: false,
			message: "Ese paso no admite política.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("una política desconocida no llega a la base", async () => {
		expect(await actions.saveApproval("acme", "outreach", "outreach/crm-record", "nunca")).toEqual(INVALIDO);
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("toggleConnection", () => {
	it("llama set_connection_enabled", async () => {
		expect(await actions.toggleConnection("acme", CONN, false)).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{ fn: "set_connection_enabled", args: { p_tenant: TENANT, p_connection: CONN, p_enabled: false } },
		]);
	});

	it("rechaza un id o un estado inválidos", async () => {
		expect(await actions.toggleConnection("acme", "x", true)).toEqual(INVALIDO);
		expect(await actions.toggleConnection("acme", CONN, "true" as unknown as boolean)).toEqual(INVALIDO);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("una conexión que no es de la empresa se informa sin detalle", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.rpc = { data: null, error: { code: "P0002", message: "no existe la conexión" } };
			expect(await actions.toggleConnection("acme", CONN, true)).toEqual(GENERICO);
		} finally {
			log.mockRestore();
		}
	});
});
```

En `tests/server-actions-exports.test.ts`, cambiar `walk("app/plataforma")` por `walk("app")`.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/settings/config-actions.test.ts tests/server-actions-exports.test.ts`
Expected: `config-actions` FAIL (el módulo no existe). `server-actions-exports` PASS con el recorrido ampliado; si marca algún archivo ya existente fuera de `app/plataforma`, **no** arreglarlo: reportarlo y dejar el recorrido en `app` igual (el test tiene que quedar rojo y el controlador decide).

- [ ] **Step 3: Implementar**

```ts
// app/[tenant]/settings/config-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { approvableNodes, isPolicy } from "@/lib/tenants/approvals";
import { actionAllowsLogin } from "@/lib/tenants/login-check-server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

export type ConfigResult = { ok: true } | { ok: false; message: string };

const SIN_PERMISO: ConfigResult = { ok: false, message: "No tenés permiso." };
const INVALIDO: ConfigResult = {
	ok: false,
	message: "No se pudo procesar el pedido.",
};
const GENERICO: ConfigResult = {
	ok: false,
	message: "No se pudo guardar. Probá de nuevo.",
};

const slugSchema = z.string().regex(/^[a-z0-9-]{1,63}$/);
// guid y no uuid: el seed local usa ids que no son v4.
const idSchema = z.guid();
const executorSchema = z.object({
	slug: z.string().min(1).max(31),
	displayName: z.string().max(120),
	title: z.string().max(120),
	linkedinUrl: z.string().max(300),
	dailyQuota: z.number().int(),
});

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * La empresa sale del slug resuelto con la sesión; el id nunca viene del
 * navegador. La base vuelve a verificar el rol: esto evita la llamada y da el
 * mensaje. También mira el método de login (spec etapa 20, L10 a L12).
 */
async function adminOf(
	slug: string,
): Promise<{ supabase: Supabase; tenantId: string } | ConfigResult> {
	if (!slugSchema.safeParse(slug).success) return INVALIDO;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant || tenant.role === "tenant_member") return SIN_PERMISO;

	const supabase = await createServerSupabase();
	if (!(await actionAllowsLogin(supabase, tenant.userId, tenant.id))) {
		return SIN_PERMISO;
	}
	return { supabase, tenantId: tenant.id };
}

/** Solo un mensaje con hint 'settings' fue escrito para la persona. */
function fromDbError(error: {
	code?: string;
	message: string;
	hint?: string | null;
}): ConfigResult {
	if (error.hint === "settings") return { ok: false, message: error.message };
	if (error.code === "42501") return SIN_PERMISO;
	console.error("settings:", error.code, error.message);
	return GENERICO;
}

async function call(
	slug: string,
	supabase: Supabase,
	fn: "set_executor" | "remove_executor" | "set_approval" | "set_connection_enabled",
	args: Record<string, unknown>,
): Promise<ConfigResult> {
	// rpc() no valida nombre ni argumentos contra los tipos en este repo: los
	// tests de esta acción afirman ambos.
	// biome-ignore lint/suspicious/noExplicitAny: ver comentario de arriba
	const { error } = await supabase.rpc(fn as any, args as any);
	if (error) return fromDbError(error);
	revalidatePath(`/${slug}/settings`);
	return { ok: true };
}

export async function saveExecutor(
	slug: string,
	userId: string,
	input: {
		slug: string;
		displayName: string;
		title: string;
		linkedinUrl: string;
		dailyQuota: number;
	},
): Promise<ConfigResult> {
	if (!idSchema.safeParse(userId).success) return INVALIDO;
	const parsed = executorSchema.safeParse(input);
	if (!parsed.success) return INVALIDO;

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin.supabase, "set_executor", {
		p_tenant: admin.tenantId,
		p_user: userId,
		p_slug: parsed.data.slug,
		p_display_name: parsed.data.displayName,
		p_title: parsed.data.title,
		p_linkedin_url: parsed.data.linkedinUrl,
		p_daily_quota: parsed.data.dailyQuota,
	});
}

export async function removeExecutor(
	slug: string,
	userId: string,
): Promise<ConfigResult> {
	if (!idSchema.safeParse(userId).success) return INVALIDO;

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin.supabase, "remove_executor", {
		p_tenant: admin.tenantId,
		p_user: userId,
	});
}

export async function saveApproval(
	slug: string,
	agent: string,
	node: string,
	policy: string,
): Promise<ConfigResult> {
	if (typeof agent !== "string" || typeof node !== "string") return INVALIDO;
	if (typeof policy !== "string" || !isPolicy(policy)) return INVALIDO;
	// El registro vive en código: la base no puede saber qué nodo es de nivel 2.
	if (!approvableNodes(agent).includes(node)) {
		return { ok: false, message: "Ese paso no admite política." };
	}

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin.supabase, "set_approval", {
		p_tenant: admin.tenantId,
		p_agent: agent,
		p_node: node,
		p_policy: policy,
	});
}

export async function toggleConnection(
	slug: string,
	connectionId: string,
	enabled: boolean,
): Promise<ConfigResult> {
	if (!idSchema.safeParse(connectionId).success) return INVALIDO;
	if (typeof enabled !== "boolean") return INVALIDO;

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin.supabase, "set_connection_enabled", {
		p_tenant: admin.tenantId,
		p_connection: connectionId,
		p_enabled: enabled,
	});
}
```

Si `supabase.rpc` acepta los nombres sin el `as any` (los tipos regenerados en la Tarea 1 ya traen las cuatro funciones), sacar el cast y el `biome-ignore`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/settings tests/server-actions-exports.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Commit**

```bash
npx biome check --write "app/[tenant]/settings/config-actions.ts" tests/settings/config-actions.test.ts tests/server-actions-exports.test.ts
npx biome check "app/[tenant]/settings/config-actions.ts" tests/settings/config-actions.test.ts tests/server-actions-exports.test.ts
git add "app/[tenant]/settings/config-actions.ts" tests/settings/config-actions.test.ts tests/server-actions-exports.test.ts
git commit -m "feat: acciones del settings para ejecutores, aprobaciones y conectores, y la guardia de use server sobre todo app/"
```

---

### Task 4: Pantalla de settings

**Files:**
- Create: `app/[tenant]/settings/config/executors-section.tsx`, `app/[tenant]/settings/config/approvals-section.tsx`, `app/[tenant]/settings/config/connections-section.tsx`, `lib/tenants/executor-slug.ts`
- Modify: `app/[tenant]/settings/page.tsx`
- Test: `tests/settings/config-sections.test.ts` (nuevo), `tests/settings/settings-page.test.ts` (nuevo), `tests/tenants/executor-slug.test.ts` (nuevo)

**Interfaces:**
- Consumes: las cuatro acciones y `ConfigResult` (Tarea 3); `approvableNodes`, `readPolicy`, `POLICIES`, `POLICY_LABELS`, `POLICY_HELP` (Tarea 2); `toExecutorRows`, `toConnectionRows` (Tarea 2); `AGENT_CATALOG`, `isCatalogAgent` (`lib/agents/catalog.ts`); `runRowAction`, `Feedback` (`app/[tenant]/settings/usuarios/run-row-action.ts`; su `run` espera `{ ok: true; message? } | { ok: false; message }`, compatible con `ConfigResult`); `ActionButton` (`app/[tenant]/settings/usuarios/row-actions.tsx`); `loadPeople` (`lib/tenants/people.ts`).
- Produces: `suggestExecutorSlug(email: string | undefined): string`; componentes cliente `ExecutorsSection({ slug, executors, candidates })`, `ApprovalsSection({ slug, agents })`, `ConnectionsSection({ slug, connections })`.

Tipos de las props (declararlos y exportarlos en cada componente):

```ts
// executors-section.tsx
export interface ExecutorView {
	userId: string;
	person: string; // nombre o correo, para mostrar
	slug: string;
	displayName: string;
	title: string;
	linkedinUrl: string;
	dailyQuota: number;
	gmailAuthorizedAt: string | null;
	crmOwnerId: string | null;
}
export interface CandidateView {
	userId: string;
	person: string;
	suggestedSlug: string;
}
// approvals-section.tsx
export interface AgentApprovals {
	agent: string;
	name: string;
	nodes: { node: string; policy: Policy }[];
}
// connections-section.tsx
export interface ConnectionView {
	id: string;
	capability: string;
	provider: string;
	enabled: boolean;
	lockedByPlatform: boolean;
}
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/tenants/executor-slug.test.ts
import { describe, expect, it } from "vitest";
import { suggestExecutorSlug } from "@/lib/tenants/executor-slug";

describe("suggestExecutorSlug", () => {
	it.each([
		["ana@acme.test", "ana"],
		["Ana.Lopez@acme.test", "ana-lopez"],
		["juan_perez+ventas@acme.test", "juan-perez-ventas"],
		["99problems@acme.test", "e-99problems"],
		["ñandú@acme.test", "and"],
		["a".repeat(60) + "@acme.test", "a".repeat(31)],
		["--@acme.test", ""],
		[undefined, ""],
	])("%s → %s", (email, slug) => {
		expect(suggestExecutorSlug(email)).toBe(slug);
	});

	it("lo que sugiere siempre cumple el formato de la base, o es vacío", () => {
		for (const email of ["ana@x.test", "A.B-C@x.test", "1@x.test", "..@x.test"]) {
			expect(suggestExecutorSlug(email)).toMatch(/^([a-z][a-z0-9-]{0,30})?$/);
		}
	});
});
```

```ts
// tests/settings/config-sections.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/[tenant]/settings/config-actions", () => ({
	saveExecutor: async () => ({ ok: true }),
	removeExecutor: async () => ({ ok: true }),
	saveApproval: async () => ({ ok: true }),
	toggleConnection: async () => ({ ok: true }),
}));

const { ExecutorsSection } = await import("@/app/[tenant]/settings/config/executors-section");
const { ApprovalsSection } = await import("@/app/[tenant]/settings/config/approvals-section");
const { ConnectionsSection } = await import("@/app/[tenant]/settings/config/connections-section");

const executor = {
	userId: "u1",
	person: "Ana López",
	slug: "ana",
	displayName: "Ana López",
	title: "AE",
	linkedinUrl: "https://www.linkedin.com/in/ana",
	dailyQuota: 40,
	gmailAuthorizedAt: "2026-10-01T00:00:00Z",
	crmOwnerId: "777",
};

describe("ExecutorsSection", () => {
	it("muestra cada ejecutor con sus datos editables y su estado", () => {
		const html = renderToStaticMarkup(
			createElement(ExecutorsSection, { slug: "acme", executors: [executor], candidates: [] }),
		);
		expect(html).toContain("Ana López");
		expect(html).toMatch(/<input[^>]*value="ana"/);
		expect(html).toMatch(/<input[^>]*type="number"[^>]*value="40"/);
		expect(html).toMatch(/<input[^>]*max="200"/);
		expect(html).toContain("Gmail autorizado");
		expect(html).toContain("HubSpot vinculado");
		expect(html).toContain("Quitar");
		expect(html).not.toContain("executors:set");
	});

	it("avisa lo que le falta autorizar a un ejecutor", () => {
		const html = renderToStaticMarkup(
			createElement(ExecutorsSection, {
				slug: "acme",
				executors: [{ ...executor, gmailAuthorizedAt: null, crmOwnerId: null }],
				candidates: [],
			}),
		);
		expect(html).toContain("Falta autorizar Gmail");
		expect(html).toContain("Falta autorizar HubSpot");
	});

	it("ofrece agregar a un miembro que todavía no es ejecutor, con el slug sugerido", () => {
		const html = renderToStaticMarkup(
			createElement(ExecutorsSection, {
				slug: "acme",
				executors: [],
				candidates: [{ userId: "u2", person: "beto@acme.test", suggestedSlug: "beto" }],
			}),
		);
		expect(html).toContain("Agregar ejecutor");
		expect(html).toMatch(/<option[^>]*value="u2"[^>]*>beto@acme\.test/);
		expect(html).toMatch(/<input[^>]*value="beto"/);
		expect(html).toContain("Todavía no hay ejecutores");
	});

	it("sin miembros disponibles no ofrece agregar y dice por qué", () => {
		const html = renderToStaticMarkup(
			createElement(ExecutorsSection, { slug: "acme", executors: [executor], candidates: [] }),
		);
		expect(html).not.toContain("Agregar ejecutor");
		expect(html).toContain("Todos los miembros ya son ejecutores");
	});
});

describe("ApprovalsSection", () => {
	it("un selector por paso de nivel 2, con la política actual y su explicación", () => {
		const html = renderToStaticMarkup(
			createElement(ApprovalsSection, {
				slug: "acme",
				agents: [
					{ agent: "outreach", name: "Agente de outreach", nodes: [{ node: "outreach/crm-record", policy: "once" }] },
				],
			}),
		);
		expect(html).toContain("Agente de outreach");
		expect(html).toContain("outreach/crm-record");
		expect(html).toMatch(/<option[^>]*value="once"[^>]*selected/);
		expect(html).toContain("Siempre pedir");
		expect(html).toContain("Sin pedir");
		expect(html).toContain("Pide aprobación la primera vez");
	});

	it("sin pasos que configurar lo dice", () => {
		expect(
			renderToStaticMarkup(createElement(ApprovalsSection, { slug: "acme", agents: [] })),
		).toContain("No hay pasos que requieran una política");
	});
});

describe("ConnectionsSection", () => {
	const base = { id: "c1", capability: "leads", provider: "coldiq", enabled: true, lockedByPlatform: false };

	it("un conector habilitado se puede deshabilitar; uno deshabilitado por el cliente, habilitar", () => {
		const on = renderToStaticMarkup(createElement(ConnectionsSection, { slug: "acme", connections: [base] }));
		expect(on).toContain("coldiq");
		expect(on).toContain("Deshabilitar");

		const off = renderToStaticMarkup(
			createElement(ConnectionsSection, { slug: "acme", connections: [{ ...base, enabled: false }] }),
		);
		expect(off).toContain("Habilitar");
		expect(off).not.toContain("Deshabilitado por INNOV.AS");
	});

	it("uno bloqueado por plataforma no tiene botón y lo explica", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				connections: [{ ...base, enabled: false, lockedByPlatform: true }],
			}),
		);
		expect(html).toContain("Deshabilitado por INNOV.AS");
		expect(html).not.toContain("<button");
	});

	it("el brain no tiene botón", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				connections: [{ id: "b", capability: "brain", provider: "wiki", enabled: true, lockedByPlatform: false }],
			}),
		);
		expect(html).toContain("wiki");
		expect(html).toContain("Lo maneja INNOV.AS");
		expect(html).not.toContain("<button");
	});

	it("nunca muestra el identificador del conector", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				connections: [{ ...base, connectorUid: "acme-coldiq-secreto" } as never],
			}),
		);
		expect(html).not.toContain("acme-coldiq-secreto");
	});

	it("sin conectores lo dice", () => {
		expect(
			renderToStaticMarkup(createElement(ConnectionsSection, { slug: "acme", connections: [] })),
		).toContain("Todavía no hay conexiones configuradas");
	});
});
```

```ts
// tests/settings/settings-page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
const state = {
	role: "tenant_admin" as string,
	tables: {} as Record<string, Result>,
	selects: {} as Record<string, string>,
};

function query(table: string) {
	const result = (): Result => state.tables[table] ?? { data: [], error: null };
	const q = {
		select: (columns: string) => {
			state.selects[table] = columns;
			return q;
		},
		eq: () => q,
		order: () => q,
		maybeSingle: async () => result(),
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) => Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => ({
		id: "t1",
		slug: "acme",
		displayName: "Acme",
		role: state.role,
		userId: "me",
		defaultModel: "m",
		allowedModels: ["m"],
		brand: {},
	}),
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({ from: (table: string) => query(table) }),
}));
vi.mock("@/lib/tenants/people", () => ({
	loadPeople: async (ids: string[]) =>
		new Map(ids.map((id) => [id, { name: id === "u1" ? "Ana López" : "", email: `${id}@acme.test` }])),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/settings/modelo-form", () => ({ ModeloForm: () => null }));
vi.mock("@/app/[tenant]/settings/ingreso-form", () => ({ IngresoForm: () => null }));
vi.mock("@/app/[tenant]/settings/config-actions", () => ({
	saveExecutor: async () => ({ ok: true }),
	removeExecutor: async () => ({ ok: true }),
	saveApproval: async () => ({ ok: true }),
	toggleConnection: async () => ({ ok: true }),
}));

const { default: SettingsPage } = await import("@/app/[tenant]/settings/page");
const render = async () =>
	renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ tenant: "acme" }) }));

describe("settings del cliente", () => {
	beforeEach(() => {
		state.role = "tenant_admin";
		state.selects = {};
		state.tables = {
			tenants: { data: { allowed_domains: [], self_signup_by_domain: false }, error: null },
			memberships: { data: [{ user_id: "u1" }, { user_id: "u2" }], error: null },
			executors: {
				data: [{ user_id: "u1", slug: "ana", daily_quota: 40, gmail_authorized_at: null, display_name: null, title: null, linkedin_url: null, crm_owner_id: null }],
				error: null,
			},
			tenant_agents: {
				data: [{ agent: "outreach", enabled: true, config: { approvals: { "outreach/crm-record": "auto" } } }],
				error: null,
			},
			tenant_connections: {
				data: [{ id: "c1", capability: "leads", provider: "coldiq", enabled: false, locked_by_platform: true }],
				error: null,
			},
		};
	});

	it("un miembro recibe 404", async () => {
		state.role = "tenant_member";
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("arma las tres secciones con lo que leyó", async () => {
		const html = await render();
		expect(html).toContain("Ana López");
		expect(html).toContain("Agregar ejecutor");
		expect(html).toMatch(/<option[^>]*value="u2"/);
		expect(html).toMatch(/<option[^>]*value="auto"[^>]*selected/);
		expect(html).toContain("Deshabilitado por INNOV.AS");
	});

	it("nunca le pide a la base el identificador ni la configuración del conector", async () => {
		await render();
		expect(state.selects.tenant_connections).not.toMatch(/connector_uid|config/);
	});

	it("un agente deshabilitado no ofrece aprobaciones", async () => {
		state.tables.tenant_agents = {
			data: [{ agent: "outreach", enabled: false, config: {} }],
			error: null,
		};
		expect(await render()).toContain("No hay pasos que requieran una política");
	});

	it.each(["executors", "memberships", "tenant_agents", "tenant_connections"])(
		"si falla la lectura de %s, lo dice y no muestra una sección vacía como si fuera cierta",
		async (table) => {
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				state.tables[table] = { data: null, error: { message: "boom" } };
				const html = await render();
				expect(html).toContain("No pude leer esta sección");
				expect(log).toHaveBeenCalled();
			} finally {
				log.mockRestore();
			}
		},
	);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/tenants/executor-slug.test.ts tests/settings/config-sections.test.ts tests/settings/settings-page.test.ts`
Expected: FAIL. Los módulos no existen y la página no tiene las secciones.

- [ ] **Step 3: Implementar**

```ts
// lib/tenants/executor-slug.ts
// Slug sugerido para un ejecutor a partir de su correo. Es una sugerencia: la
// persona lo puede cambiar y la base valida el formato (^[a-z][a-z0-9-]{0,30}$).
export function suggestExecutorSlug(email: string | undefined): string {
	const local = (email ?? "").split("@")[0] ?? "";
	const cleaned = local
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!cleaned) return "";
	const lettered = /^[a-z]/.test(cleaned) ? cleaned : `e-${cleaned}`;
	return lettered.slice(0, 31).replace(/-+$/, "");
}
```

```tsx
// app/[tenant]/settings/config/executors-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { removeExecutor, saveExecutor } from "../config-actions";
import { ActionButton } from "../usuarios/row-actions";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";

export interface ExecutorView {
	userId: string;
	person: string;
	slug: string;
	displayName: string;
	title: string;
	linkedinUrl: string;
	dailyQuota: number;
	gmailAuthorizedAt: string | null;
	crmOwnerId: string | null;
}

export interface CandidateView {
	userId: string;
	person: string;
	suggestedSlug: string;
}

interface Draft {
	slug: string;
	displayName: string;
	title: string;
	linkedinUrl: string;
	dailyQuota: number;
}

const MAX_QUOTA = 200;
const DEFAULT_QUOTA = 30;

function Message({ feedback }: { feedback: Feedback }) {
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

function Fields({
	draft,
	onChange,
	disabled,
	idPrefix,
}: {
	draft: Draft;
	onChange: (draft: Draft) => void;
	disabled: boolean;
	idPrefix: string;
}) {
	const field = (key: keyof Draft, label: string, extra: Record<string, unknown> = {}) => (
		<label className="block min-w-0 flex-1 basis-40 text-xs text-muted-foreground" htmlFor={`${idPrefix}-${key}`}>
			{label}
			<Input
				className="mt-1"
				disabled={disabled}
				id={`${idPrefix}-${key}`}
				onChange={(event) =>
					onChange({
						...draft,
						[key]: key === "dailyQuota" ? Number(event.target.value) : event.target.value,
					})
				}
				value={draft[key]}
				{...extra}
			/>
		</label>
	);

	return (
		<div className="flex flex-wrap gap-3">
			{field("slug", "Slug")}
			{field("displayName", "Nombre en la firma")}
			{field("title", "Puesto")}
			{field("linkedinUrl", "LinkedIn", { placeholder: "https://www.linkedin.com/in/…" })}
			{field("dailyQuota", "Cupo diario", { type: "number", min: 0, max: MAX_QUOTA, step: 1 })}
		</div>
	);
}

function ExecutorRow({ slug, executor }: { slug: string; executor: ExecutorView }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [draft, setDraft] = useState<Draft>({
		slug: executor.slug,
		displayName: executor.displayName,
		title: executor.title,
		linkedinUrl: executor.linkedinUrl,
		dailyQuota: executor.dailyQuota,
	});

	function save() {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => saveExecutor(slug, executor.userId, draft),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			setFeedback(out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }));
		});
	}

	return (
		<li className="space-y-3 px-4 py-3">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<span className="font-medium text-sm">{executor.person}</span>
				<span className="text-muted-foreground text-xs">
					{executor.gmailAuthorizedAt ? "Gmail autorizado" : "Falta autorizar Gmail"}
				</span>
				<span className="text-muted-foreground text-xs">
					{executor.crmOwnerId ? "HubSpot vinculado" : "Falta autorizar HubSpot"}
				</span>
			</div>
			<Fields disabled={pending} draft={draft} idPrefix={executor.userId} onChange={setDraft} />
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={pending} onClick={save} size="sm" type="button">
					Guardar
				</Button>
				<Message feedback={feedback} />
				<span className="ml-auto">
					<ActionButton
						confirmText="¿Quitar a esta persona de los ejecutores? Si ya tiene envíos o contactos no se puede: ponele cupo 0."
						label="Quitar"
						run={() => removeExecutor(slug, executor.userId)}
					/>
				</span>
			</div>
		</li>
	);
}

function AddExecutor({ slug, candidates }: { slug: string; candidates: CandidateView[] }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [userId, setUserId] = useState(candidates[0]?.userId ?? "");
	const [draft, setDraft] = useState<Draft>({
		slug: candidates[0]?.suggestedSlug ?? "",
		displayName: "",
		title: "",
		linkedinUrl: "",
		dailyQuota: DEFAULT_QUOTA,
	});

	function pick(next: string) {
		setUserId(next);
		setDraft({
			...draft,
			slug: candidates.find((c) => c.userId === next)?.suggestedSlug ?? "",
		});
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => saveExecutor(slug, userId, draft),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			setFeedback(out.feedback ?? (out.failed ? null : { ok: true, text: "Ejecutor agregado." }));
		});
	}

	return (
		<form className="space-y-3 rounded-lg border bg-card px-4 py-3" onSubmit={submit}>
			<h3 className="font-medium text-sm">Agregar ejecutor</h3>
			<label className="block text-xs text-muted-foreground" htmlFor="nuevo-ejecutor">
				Persona
				<select
					className="mt-1 block h-9 max-w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
					disabled={pending}
					id="nuevo-ejecutor"
					onChange={(event) => pick(event.target.value)}
					value={userId}
				>
					{candidates.map((candidate) => (
						<option key={candidate.userId} value={candidate.userId}>
							{candidate.person}
						</option>
					))}
				</select>
			</label>
			<Fields disabled={pending} draft={draft} idPrefix="nuevo" onChange={setDraft} />
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={pending} size="sm" type="submit">
					Agregar
				</Button>
				<Message feedback={feedback} />
			</div>
		</form>
	);
}

export function ExecutorsSection({
	slug,
	executors,
	candidates,
}: {
	slug: string;
	executors: ExecutorView[];
	candidates: CandidateView[];
}) {
	return (
		<div className="space-y-4">
			{executors.length === 0 ? (
				<p className="text-muted-foreground text-sm">Todavía no hay ejecutores configurados.</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{executors.map((executor) => (
						<ExecutorRow executor={executor} key={executor.userId} slug={slug} />
					))}
				</ul>
			)}
			{candidates.length > 0 ? (
				<AddExecutor candidates={candidates} slug={slug} />
			) : (
				<p className="text-muted-foreground text-sm">
					Todos los miembros ya son ejecutores. Para sumar a alguien, invitalo primero desde Usuarios.
				</p>
			)}
		</div>
	);
}
```

```tsx
// app/[tenant]/settings/config/approvals-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { POLICIES, POLICY_HELP, POLICY_LABELS, type Policy } from "@/lib/tenants/approvals";
import { saveApproval } from "../config-actions";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";

export interface AgentApprovals {
	agent: string;
	name: string;
	nodes: { node: string; policy: Policy }[];
}

function NodeRow({ slug, agent, node, policy }: { slug: string; agent: string; node: string; policy: Policy }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [value, setValue] = useState<Policy>(policy);

	function change(next: Policy) {
		const previous = value;
		setValue(next);
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => saveApproval(slug, agent, node, next),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			// Si no se guardó, el selector vuelve a lo que la base tiene.
			if (out.failed) setValue(previous);
			setFeedback(out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }));
		});
	}

	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="font-mono text-sm">{node}</div>
				<div className="text-muted-foreground text-xs">{POLICY_HELP[value]}</div>
			</div>
			{feedback ? (
				<span
					className={feedback.ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"}
					role={feedback.ok ? "status" : "alert"}
				>
					{feedback.text}
				</span>
			) : null}
			<select
				aria-label={`Política de ${node}`}
				className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
				disabled={pending}
				onChange={(event) => change(event.target.value as Policy)}
				value={value}
			>
				{POLICIES.map((option) => (
					<option key={option} value={option}>
						{POLICY_LABELS[option]}
					</option>
				))}
			</select>
		</li>
	);
}

export function ApprovalsSection({ slug, agents }: { slug: string; agents: AgentApprovals[] }) {
	if (agents.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No hay pasos que requieran una política de aprobación.
			</p>
		);
	}
	return (
		<div className="space-y-4">
			<p className="text-muted-foreground text-sm">
				Son los pasos en los que el agente escribe en tus sistemas. Lo que le llega a una persona de afuera siempre pide aprobación.
			</p>
			{agents.map(({ agent, name, nodes }) => (
				<div key={agent}>
					<h3 className="mb-2 font-medium text-sm">{name}</h3>
					<ul className="divide-y rounded-lg border bg-card">
						{nodes.map(({ node, policy }) => (
							<NodeRow agent={agent} key={node} node={node} policy={policy} slug={slug} />
						))}
					</ul>
				</div>
			))}
		</div>
	);
}
```

```tsx
// app/[tenant]/settings/config/connections-section.tsx
"use client";

import { toggleConnection } from "../config-actions";
import { ActionButton } from "../usuarios/row-actions";

export interface ConnectionView {
	id: string;
	capability: string;
	provider: string;
	enabled: boolean;
	lockedByPlatform: boolean;
}

function Control({ slug, connection }: { slug: string; connection: ConnectionView }) {
	if (connection.capability === "brain") {
		return <span className="text-muted-foreground text-xs">Lo maneja INNOV.AS</span>;
	}
	if (connection.lockedByPlatform) {
		return <span className="text-muted-foreground text-xs">Deshabilitado por INNOV.AS</span>;
	}
	return (
		<ActionButton
			confirmText={
				connection.enabled
					? "¿Deshabilitar este conector? El agente deja de usarlo hasta que lo habilites."
					: undefined
			}
			label={connection.enabled ? "Deshabilitar" : "Habilitar"}
			run={() => toggleConnection(slug, connection.id, !connection.enabled)}
		/>
	);
}

export function ConnectionsSection({ slug, connections }: { slug: string; connections: ConnectionView[] }) {
	if (connections.length === 0) {
		return <p className="text-muted-foreground text-sm">Todavía no hay conexiones configuradas.</p>;
	}
	return (
		<ul className="divide-y rounded-lg border bg-card">
			{connections.map((connection) => (
				<li className="flex flex-wrap items-center gap-3 px-4 py-3" key={connection.id}>
					<span className="font-medium text-sm">{connection.provider}</span>
					<span className="text-muted-foreground text-sm">{connection.capability}</span>
					<span className={connection.enabled ? "ml-auto text-sm" : "ml-auto text-muted-foreground text-sm"}>
						{connection.enabled ? "Habilitada" : "Deshabilitada"}
					</span>
					<Control connection={connection} slug={slug} />
				</li>
			))}
		</ul>
	);
}
```

En `app/[tenant]/settings/page.tsx`:

1. Imports nuevos: las tres secciones, `loadPeople`, `suggestExecutorSlug`, `approvableNodes`, `readPolicy`, `AGENT_CATALOG`, `isCatalogAgent`. Sacar `fecha` si queda sin uso.
2. Reemplazar las dos lecturas actuales de `executors` y `tenant_connections` y sumar dos, dentro del mismo `Promise.all`:

```ts
		supabase
			.from("executors")
			.select("user_id, slug, daily_quota, gmail_authorized_at, display_name, title, linkedin_url, crm_owner_id")
			.eq("tenant_id", tenant.id),
		// Sin connector_uid ni config: el cliente no los ve (spec 21.2 §5).
		supabase
			.from("tenant_connections")
			.select("id, capability, provider, enabled, locked_by_platform")
			.eq("tenant_id", tenant.id)
			.order("created_at"),
		supabase.from("memberships").select("user_id").eq("tenant_id", tenant.id),
		supabase
			.from("tenant_agents")
			.select("agent, enabled, config")
			.eq("tenant_id", tenant.id),
```

3. Después del `Promise.all`, armar las vistas:

```ts
	for (const [name, result] of [
		["executors", executorsResult],
		["memberships", membershipsResult],
		["tenant_agents", agentsResult],
		["tenant_connections", connectionsResult],
	] as const) {
		if (result.error) console.error(`settings: no pude leer ${name}:`, result.error);
	}
	const executorsFailed = Boolean(executorsResult.error || membershipsResult.error);

	const executorRows = toExecutorRows(executorsResult.data ?? []);
	const memberIds = (membershipsResult.data ?? []).map((row) => row.user_id as string);
	const people = executorsFailed
		? new Map()
		: await loadPeople([...new Set([...memberIds, ...executorRows.map((row) => row.userId)])]);
	const label = (userId: string) => {
		const person = people.get(userId);
		return person?.name || person?.email || userId;
	};

	const executors = executorRows.map((row) => ({
		userId: row.userId,
		person: label(row.userId),
		slug: row.slug ?? "",
		displayName: row.displayName ?? "",
		title: row.title ?? "",
		linkedinUrl: row.linkedinUrl ?? "",
		dailyQuota: row.dailyQuota,
		gmailAuthorizedAt: row.gmailAuthorizedAt,
		crmOwnerId: row.crmOwnerId,
	}));
	const taken = new Set(executorRows.map((row) => row.userId));
	const candidates = memberIds
		.filter((userId) => !taken.has(userId))
		.map((userId) => ({
			userId,
			person: label(userId),
			suggestedSlug: suggestExecutorSlug(people.get(userId)?.email),
		}));

	const approvals = (agentsResult.data ?? [])
		.filter((row) => row.enabled === true)
		.map((row) => {
			const agent = row.agent as string;
			return {
				agent,
				name: isCatalogAgent(agent) ? AGENT_CATALOG[agent].name : agent,
				nodes: approvableNodes(agent).map((node) => ({ node, policy: readPolicy(row.config, node) })),
			};
		})
		.filter((entry) => entry.nodes.length > 0);

	const connections = toConnectionRows(connectionsResult.data ?? []);
```

4. Reemplazar las secciones "Ejecutores" y "Conexiones" del JSX y sumar "Aprobaciones" entre las dos. `Unreadable` es un componente local del archivo:

```tsx
const Unreadable = () => (
	<p className="text-muted-foreground text-sm">No pude leer esta sección. Recargá la página.</p>
);
```

```tsx
			<section>
				<h2 className="mb-3 text-lg">Ejecutores</h2>
				{executorsFailed ? (
					<Unreadable />
				) : (
					<ExecutorsSection candidates={candidates} executors={executors} slug={slug} />
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Aprobaciones</h2>
				{agentsResult.error ? <Unreadable /> : <ApprovalsSection agents={approvals} slug={slug} />}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Conectores</h2>
				{connectionsResult.error ? (
					<Unreadable />
				) : (
					<ConnectionsSection connections={connections} slug={slug} />
				)}
			</section>
```

El texto que mandaba a correr `npm run executors:set` se va.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/settings tests/tenants tests/pipeline && npm run typecheck && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: PASS, typecheck limpio, suite completa en verde. Si el doble de `settings-page.test.ts` no coincide con la cadena real de la página (`order`, `maybeSingle`), ajustar el doble, no lo que afirma.

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/tenants/executor-slug.ts "app/[tenant]/settings/config" "app/[tenant]/settings/page.tsx" tests/tenants/executor-slug.test.ts tests/settings/config-sections.test.ts tests/settings/settings-page.test.ts
npx biome check lib/tenants/executor-slug.ts "app/[tenant]/settings/config" "app/[tenant]/settings/page.tsx" tests/tenants/executor-slug.test.ts tests/settings/config-sections.test.ts tests/settings/settings-page.test.ts
git add lib/tenants/executor-slug.ts "app/[tenant]/settings/config" "app/[tenant]/settings/page.tsx" tests/tenants/executor-slug.test.ts tests/settings/config-sections.test.ts tests/settings/settings-page.test.ts
git commit -m "feat: el administrador del cliente edita ejecutores, aprobaciones y conectores desde su settings"
```

---

### Task 5: "Mis cuentas"

**Files:**
- Create: `lib/accounts/status.ts`, `lib/connectors/crm/owner.ts`, `app/[tenant]/mis-cuentas/page.tsx`, `app/[tenant]/mis-cuentas/actions.ts`, `app/[tenant]/mis-cuentas/account-card.tsx`
- Modify: `lib/connectors/executors.ts`, `lib/tenants/nav.ts`
- Test: `tests/accounts/status.test.ts`, `tests/connectors/crm-owner.test.ts`, `tests/accounts/actions.test.ts`, `tests/accounts/page.test.ts` (nuevos), `tests/tenants/nav.test.ts` (modifica)

**Interfaces:**
- Consumes: `tokenForSubject`, `startAuthorizationForSubject`, `isConnectAuthError`, `isConnectorNotInstalledError` (`lib/connectors/auth.ts`); `GOOGLE_CONNECTOR_UID`, `HUBSPOT_CONNECTOR_UID` (`lib/connectors/platform.ts`); `GMAIL_SCOPES` (`lib/gmail/send.ts`); `connectSubjectIssuer` (`lib/outreach/web-context.ts`); `webSession(slug)` (`lib/outreach/web-session.ts`, devuelve `{ caller: { tenantId, userId, role, email }, tenant } | null`); `markGmailAuthorized` (`lib/connectors/executors.ts`); `createAdminClient`.
- Produces:
  - `lib/accounts/status.ts`: `type AccountKey = "hubspot" | "gmail"`; `type AccountState = "autorizada" | "sin_autorizar" | "no_disponible" | "desconocido"`; `ACCOUNT_LABELS: Record<AccountKey, string>`; `STATE_LABELS: Record<AccountState, string>`; `accountsFor(input: { connections: { capability: string; provider: string; enabled: boolean }[]; isExecutor: boolean }): AccountKey[]`; `probeAccount(key: AccountKey, deps: { token: (key: AccountKey) => Promise<unknown>; isAuthError: (e: unknown) => boolean; isNotInstalled: (e: unknown) => boolean }): Promise<AccountState>`.
  - `lib/connectors/crm/owner.ts`: `resolveCrmOwnerId(token: string, email: string, fetchImpl?: typeof fetch): Promise<string | null>`.
  - `lib/connectors/executors.ts`: `markCrmOwner(tenantId: string, userId: string, ownerId: string): Promise<void>`.
  - `app/[tenant]/mis-cuentas/actions.ts`: `startAccountAuthorization(slug: string, key: string): Promise<{ ok: true; url: string } | { ok: false; message: string }>`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/accounts/status.test.ts
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_LABELS, accountsFor, probeAccount, STATE_LABELS } from "@/lib/accounts/status";

const HUBSPOT = { capability: "crm", provider: "hubspot", enabled: true };
const GMAIL = { capability: "mail", provider: "gmail", enabled: true };

describe("accountsFor", () => {
	it("HubSpot para cualquiera si la empresa lo tiene habilitado", () => {
		expect(accountsFor({ connections: [HUBSPOT], isExecutor: false })).toEqual(["hubspot"]);
	});

	it("Gmail solo para ejecutores, y solo si la empresa lo tiene habilitado", () => {
		expect(accountsFor({ connections: [HUBSPOT, GMAIL], isExecutor: true })).toEqual(["hubspot", "gmail"]);
		expect(accountsFor({ connections: [HUBSPOT, GMAIL], isExecutor: false })).toEqual(["hubspot"]);
		expect(accountsFor({ connections: [HUBSPOT], isExecutor: true })).toEqual(["hubspot"]);
	});

	it("un conector deshabilitado no cuenta", () => {
		expect(
			accountsFor({
				connections: [{ ...HUBSPOT, enabled: false }, { ...GMAIL, enabled: false }],
				isExecutor: true,
			}),
		).toEqual([]);
	});

	it("otros proveedores no generan cuentas", () => {
		expect(
			accountsFor({
				connections: [{ capability: "leads", provider: "coldiq", enabled: true }, { capability: "crm", provider: "otro", enabled: true }],
				isExecutor: true,
			}),
		).toEqual([]);
	});
});

describe("probeAccount", () => {
	const AUTH = new Error("auth");
	const MISSING = new Error("not installed");
	const deps = (token: () => Promise<unknown>) => ({
		token,
		isAuthError: (e: unknown) => e === AUTH,
		isNotInstalled: (e: unknown) => e === MISSING,
	});

	it("hay token: autorizada", async () => {
		expect(await probeAccount("gmail", deps(async () => ({ token: "t" })))).toBe("autorizada");
	});

	it("falta el grant: sin autorizar", async () => {
		expect(await probeAccount("gmail", deps(async () => { throw AUTH; }))).toBe("sin_autorizar");
	});

	it("el conector no está instalado: no disponible", async () => {
		expect(await probeAccount("hubspot", deps(async () => { throw MISSING; }))).toBe("no_disponible");
	});

	it("cualquier otro error es desconocido, nunca sin autorizar, y se registra", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await probeAccount("gmail", deps(async () => { throw new Error("red caída"); }))).toBe("desconocido");
			expect(log).toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});

	it("no instalado gana si un error cumple las dos condiciones", async () => {
		const both = new Error("ambos");
		expect(
			await probeAccount("hubspot", {
				token: async () => { throw both; },
				isAuthError: () => true,
				isNotInstalled: () => true,
			}),
		).toBe("no_disponible");
	});

	it("le pide el token a la cuenta que le pasaron", async () => {
		const token = vi.fn(async () => "t");
		await probeAccount("hubspot", { token, isAuthError: () => false, isNotInstalled: () => false });
		expect(token).toHaveBeenCalledWith("hubspot");
	});
});

describe("rótulos", () => {
	it("cada cuenta y cada estado tienen texto", () => {
		expect(ACCOUNT_LABELS).toEqual({ hubspot: "HubSpot", gmail: "Gmail" });
		expect(STATE_LABELS.no_disponible).toBe("No disponible: pedile a INNOV.AS que la habilite");
		expect(STATE_LABELS.desconocido).toBe("No pude comprobarlo. Recargá la página.");
		expect(STATE_LABELS.autorizada).toBe("Autorizada");
		expect(STATE_LABELS.sin_autorizar).toBe("Sin autorizar");
	});
});
```

```ts
// tests/connectors/crm-owner.test.ts
import { describe, expect, it, vi } from "vitest";
import { resolveCrmOwnerId } from "@/lib/connectors/crm/owner";

const reply = (status: number, body: unknown) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("resolveCrmOwnerId", () => {
	it("pregunta a HubSpot por el dueño con ese correo y devuelve su id", async () => {
		const fetchImpl = reply(200, { results: [{ id: "92296278", email: "ana@acme.test" }] });

		expect(await resolveCrmOwnerId("tok", "Ana@Acme.test", fetchImpl)).toBe("92296278");

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://api.hubapi.com/crm/v3/owners?email=ana%40acme.test&limit=2");
		expect(init.headers).toEqual({ Authorization: "Bearer tok" });
	});

	it("el correo va codificado: no puede inyectar parámetros", async () => {
		const fetchImpl = reply(200, { results: [] });
		await resolveCrmOwnerId("tok", "a@b.test&archived=true", fetchImpl);
		const [url] = fetchImpl.mock.calls[0] as unknown as [string];
		expect(url).toContain("email=a%40b.test%26archived%3Dtrue&limit=2");
	});

	it.each([
		["sin resultados", 200, { results: [] }],
		["el resultado es de otro correo", 200, { results: [{ id: "1", email: "otra@acme.test" }] }],
		["dos dueños con ese correo", 200, { results: [{ id: "1", email: "ana@acme.test" }, { id: "2", email: "ana@acme.test" }] }],
		["sin permiso para leer dueños", 403, { message: "scopes" }],
		["token rechazado", 401, {}],
		["HubSpot caído", 500, {}],
		["cuerpo inesperado", 200, { nada: true }],
	])("%s: null", async (_name, status, body) => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await resolveCrmOwnerId("tok", "ana@acme.test", reply(status, body))).toBeNull();
		} finally {
			log.mockRestore();
		}
	});

	it("un error de red es null y se registra sin el token", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const fetchImpl = vi.fn(async () => {
				throw new Error("red");
			});
			expect(await resolveCrmOwnerId("tok-secreto", "ana@acme.test", fetchImpl)).toBeNull();
			expect(JSON.stringify(log.mock.calls)).not.toContain("tok-secreto");
		} finally {
			log.mockRestore();
		}
	});

	it("sin correo no pregunta", async () => {
		const fetchImpl = reply(200, { results: [] });
		expect(await resolveCrmOwnerId("tok", "", fetchImpl)).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
```

```ts
// tests/accounts/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	session: {
		caller: { tenantId: "t1", userId: "u1", role: "tenant_member", email: "ana@acme.test" },
		tenant: { id: "t1", slug: "acme" },
	} as { caller: { tenantId: string; userId: string; role: string; email: string }; tenant: { id: string; slug: string } } | null,
	connections: [
		{ capability: "crm", provider: "hubspot", enabled: true },
		{ capability: "mail", provider: "gmail", enabled: true },
	] as { capability: string; provider: string; enabled: boolean }[],
	executor: { user_id: "u1" } as { user_id: string } | null,
	startCalls: [] as { connector: string; who: unknown; scopes: unknown }[],
	startThrows: null as Error | null,
}));

vi.mock("@/lib/outreach/web-session", () => ({ webSession: async () => state.session }));
vi.mock("@/lib/outreach/web-context", () => ({ connectSubjectIssuer: () => "https://sb.test" }));
vi.mock("@/lib/gmail/send", () => ({ GMAIL_SCOPES: ["gmail.send", "gmail.readonly"] }));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) => {
			const q = {
				select: () => q,
				eq: () => q,
				maybeSingle: async () => ({ data: state.executor, error: null }),
				// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
				then: (resolve: (v: unknown) => unknown) =>
					Promise.resolve({ data: table === "tenant_connections" ? state.connections : [], error: null }).then(resolve),
			};
			return q;
		},
	}),
}));
vi.mock("@/lib/connectors/auth", () => ({
	startAuthorizationForSubject: async (connector: string, who: unknown, scopes: unknown) => {
		state.startCalls.push({ connector, who, scopes });
		if (state.startThrows) throw state.startThrows;
		return { url: "https://connect.test/autorizar", expiresAt: null };
	},
}));

const { startAccountAuthorization } = await import("@/app/[tenant]/mis-cuentas/actions");

beforeEach(() => {
	state.session = {
		caller: { tenantId: "t1", userId: "u1", role: "tenant_member", email: "ana@acme.test" },
		tenant: { id: "t1", slug: "acme" },
	};
	state.connections = [
		{ capability: "crm", provider: "hubspot", enabled: true },
		{ capability: "mail", provider: "gmail", enabled: true },
	];
	state.executor = { user_id: "u1" };
	state.startCalls = [];
	state.startThrows = null;
});

describe("startAccountAuthorization", () => {
	it("Gmail: pide la autorización para el sujeto de la sesión con los scopes completos", async () => {
		expect(await startAccountAuthorization("acme", "gmail")).toEqual({
			ok: true,
			url: "https://connect.test/autorizar",
		});
		expect(state.startCalls).toEqual([
			{
				connector: "google/google",
				who: { tenantId: "t1", userId: "u1", issuer: "https://sb.test" },
				scopes: ["gmail.send", "gmail.readonly"],
			},
		]);
	});

	it("HubSpot: sin scopes", async () => {
		await startAccountAuthorization("acme", "hubspot");
		expect(state.startCalls[0]).toMatchObject({ connector: "mcp.hubspot.com/hubspot", scopes: undefined });
	});

	it("sin sesión no llama a Connect", async () => {
		state.session = null;
		expect(await startAccountAuthorization("acme", "gmail")).toEqual({
			ok: false,
			message: "Volvé a entrar: no hay sesión.",
		});
		expect(state.startCalls).toHaveLength(0);
	});

	it.each(["outlook", "", "__proto__", "toString"])("la cuenta %s no existe y no llama a Connect", async (key) => {
		expect((await startAccountAuthorization("acme", key)).ok).toBe(false);
		expect(state.startCalls).toHaveLength(0);
	});

	it("Gmail para quien no es ejecutor no llama a Connect", async () => {
		state.executor = null;
		expect(await startAccountAuthorization("acme", "gmail")).toEqual({
			ok: false,
			message: "Esa cuenta no está disponible para vos.",
		});
		expect(state.startCalls).toHaveLength(0);
	});

	it("una cuenta que la empresa no tiene habilitada no llama a Connect", async () => {
		state.connections = [];
		expect((await startAccountAuthorization("acme", "hubspot")).ok).toBe(false);
		expect(state.startCalls).toHaveLength(0);
	});

	it("si Connect falla, lo dice sin detalle y lo registra", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.startThrows = new Error("connect caído");
			expect(await startAccountAuthorization("acme", "hubspot")).toEqual({
				ok: false,
				message: "No pude arrancar la autorización. Probá de nuevo.",
			});
			expect(log).toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});
});
```

```ts
// tests/accounts/page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AUTH = new Error("auth");
const state = vi.hoisted(() => ({
	session: true,
	connections: [] as { capability: string; provider: string; enabled: boolean }[],
	executor: null as Record<string, unknown> | null,
	tokens: {} as Record<string, "ok" | "auth" | "boom">,
	tokenCalls: [] as { connector: string; scopes: unknown }[],
	startCalls: 0,
	gmailMarks: [] as string[],
	ownerMarks: [] as string[],
	owner: "777" as string | null,
	ownerThrows: false,
}));

vi.mock("@/lib/outreach/web-session", () => ({
	webSession: async () =>
		state.session
			? { caller: { tenantId: "t1", userId: "u1", role: "tenant_member", email: "ana@acme.test" }, tenant: { id: "t1", slug: "acme", displayName: "Acme" } }
			: null,
}));
vi.mock("@/lib/outreach/web-context", () => ({ connectSubjectIssuer: () => "https://sb.test" }));
vi.mock("@/lib/gmail/send", () => ({ GMAIL_SCOPES: ["gmail.send", "gmail.readonly"] }));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) => {
			const q = {
				select: () => q,
				eq: () => q,
				maybeSingle: async () => ({ data: state.executor, error: null }),
				// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
				then: (resolve: (v: unknown) => unknown) =>
					Promise.resolve({ data: table === "tenant_connections" ? state.connections : [], error: null }).then(resolve),
			};
			return q;
		},
	}),
}));
vi.mock("@/lib/connectors/auth", () => ({
	tokenForSubject: async (connector: string, _who: unknown, scopes: unknown) => {
		state.tokenCalls.push({ connector, scopes });
		const outcome = state.tokens[connector] ?? "ok";
		if (outcome === "auth") throw AUTH;
		if (outcome === "boom") throw new Error("red");
		return { token: `tok-${connector}`, expiresAt: 0 };
	},
	startAuthorizationForSubject: async () => {
		state.startCalls += 1;
		return { url: "x", expiresAt: null };
	},
	isConnectAuthError: (e: unknown) => e === AUTH,
	isConnectorNotInstalledError: () => false,
}));
vi.mock("@/lib/connectors/executors", () => ({
	markGmailAuthorized: async (_t: string, userId: string) => {
		state.gmailMarks.push(userId);
	},
	markCrmOwner: async (_t: string, _u: string, ownerId: string) => {
		state.ownerMarks.push(ownerId);
	},
}));
vi.mock("@/lib/connectors/crm/owner", () => ({
	resolveCrmOwnerId: async () => {
		if (state.ownerThrows) throw new Error("hubspot");
		return state.owner;
	},
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/mis-cuentas/actions", () => ({
	startAccountAuthorization: async () => ({ ok: true, url: "x" }),
}));

const { default: MisCuentasPage } = await import("@/app/[tenant]/mis-cuentas/page");
const render = async () =>
	renderToStaticMarkup(await MisCuentasPage({ params: Promise.resolve({ tenant: "acme" }) }));

const BOTH = [
	{ capability: "crm", provider: "hubspot", enabled: true },
	{ capability: "mail", provider: "gmail", enabled: true },
];

describe("Mis cuentas", () => {
	beforeEach(() => {
		state.session = true;
		state.connections = BOTH;
		state.executor = { user_id: "u1", gmail_authorized_at: "2026-10-01T00:00:00Z", crm_owner_id: "777" };
		state.tokens = {};
		state.tokenCalls = [];
		state.startCalls = 0;
		state.gmailMarks = [];
		state.ownerMarks = [];
		state.owner = "777";
		state.ownerThrows = false;
	});

	it("sin acceso da 404", async () => {
		state.session = false;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("cargar la página NUNCA arranca una autorización, en ningún estado", async () => {
		for (const tokens of [
			{},
			{ "google/google": "auth", "mcp.hubspot.com/hubspot": "auth" },
			{ "google/google": "boom", "mcp.hubspot.com/hubspot": "boom" },
		] as Record<string, "ok" | "auth" | "boom">[]) {
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				state.tokens = tokens;
				await render();
			} finally {
				log.mockRestore();
			}
		}
		expect(state.startCalls).toBe(0);
	});

	it("un ejecutor ve las dos cuentas; Gmail se sondea con los scopes completos", async () => {
		const html = await render();
		expect(html).toContain("HubSpot");
		expect(html).toContain("Gmail");
		expect(html).toContain("Autorizada");
		expect(html).toContain("Reautorizar");
		expect(state.tokenCalls).toContainEqual({ connector: "google/google", scopes: ["gmail.send", "gmail.readonly"] });
		expect(state.tokenCalls).toContainEqual({ connector: "mcp.hubspot.com/hubspot", scopes: undefined });
	});

	it("quien no es ejecutor ve solo HubSpot y no se sondea Gmail", async () => {
		state.executor = null;
		const html = await render();
		expect(html).toContain("HubSpot");
		expect(html).not.toContain("Gmail");
		expect(state.tokenCalls.map((c) => c.connector)).toEqual(["mcp.hubspot.com/hubspot"]);
	});

	it("sin grant: Sin autorizar y botón Autorizar", async () => {
		state.tokens = { "mcp.hubspot.com/hubspot": "auth" };
		const html = await render();
		expect(html).toContain("Sin autorizar");
		expect(html).toContain(">Autorizar<");
	});

	it("si no se pudo comprobar, lo dice y no ofrece botón", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.executor = null;
			state.tokens = { "mcp.hubspot.com/hubspot": "boom" };
			const html = await render();
			expect(html).toContain("No pude comprobarlo");
			expect(html).not.toContain("<button");
		} finally {
			log.mockRestore();
		}
	});

	it("una empresa sin cuentas que autorizar lo dice", async () => {
		state.connections = [];
		expect(await render()).toContain("No hay cuentas para autorizar");
	});

	it("reconcilia: sella Gmail y guarda el dueño de HubSpot cuando faltan", async () => {
		state.executor = { user_id: "u1", gmail_authorized_at: null, crm_owner_id: null };
		await render();
		expect(state.gmailMarks).toEqual(["u1"]);
		expect(state.ownerMarks).toEqual(["777"]);
	});

	it("no reconcilia lo que ya está, ni a quien no es ejecutor, ni sin autorización", async () => {
		await render();
		expect(state.gmailMarks).toEqual([]);
		expect(state.ownerMarks).toEqual([]);

		state.executor = null;
		await render();
		expect(state.ownerMarks).toEqual([]);

		state.executor = { user_id: "u1", gmail_authorized_at: null, crm_owner_id: null };
		state.tokens = { "google/google": "auth", "mcp.hubspot.com/hubspot": "auth" };
		await render();
		expect(state.gmailMarks).toEqual([]);
		expect(state.ownerMarks).toEqual([]);
	});

	it("si HubSpot no devuelve dueño, o falla, la página carga y lo dice", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.executor = { user_id: "u1", gmail_authorized_at: "x", crm_owner_id: null };
			state.owner = null;
			expect(await render()).toContain("No pude leer tu usuario de HubSpot");

			state.ownerThrows = true;
			expect(await render()).toContain("No pude leer tu usuario de HubSpot");
			expect(state.ownerMarks).toEqual([]);
		} finally {
			log.mockRestore();
		}
	});

	it("ningún token llega al HTML", async () => {
		expect(await render()).not.toContain("tok-");
	});
});
```

En `tests/tenants/nav.test.ts`: en las dos listas esperadas, agregar `"Mis cuentas"` después de `"Conectar"`, y sumar:

```ts
	it("Mis cuentas apunta a /mis-cuentas y la ve cualquier rol", () => {
		const entry = visibleNav("tenant_member").find((e) => e.label === "Mis cuentas");
		expect(entry).toMatchObject({ href: "/mis-cuentas" });
	});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/accounts tests/connectors/crm-owner.test.ts tests/tenants/nav.test.ts`
Expected: FAIL. Los módulos no existen y el menú no tiene la entrada.

- [ ] **Step 3: Implementar la lógica pura y los adaptadores**

```ts
// lib/accounts/status.ts
// "Mis cuentas" (spec 21.2 §4.4): qué cuentas le corresponden a una persona y
// en qué estado está cada una. Puro: quien llama inyecta cómo pedir el token.
// Pedir un token no modifica nada; arrancar una autorización sí (deja el grant
// anterior sin servir), y por eso NO vive acá.
export type AccountKey = "hubspot" | "gmail";
export type AccountState =
	| "autorizada"
	| "sin_autorizar"
	| "no_disponible"
	| "desconocido";

export const ACCOUNT_LABELS: Record<AccountKey, string> = {
	hubspot: "HubSpot",
	gmail: "Gmail",
};

export const STATE_LABELS: Record<AccountState, string> = {
	autorizada: "Autorizada",
	sin_autorizar: "Sin autorizar",
	no_disponible: "No disponible: pedile a INNOV.AS que la habilite",
	desconocido: "No pude comprobarlo. Recargá la página.",
};

export function isAccountKey(value: string): value is AccountKey {
	return value === "hubspot" || value === "gmail";
}

export function accountsFor(input: {
	connections: { capability: string; provider: string; enabled: boolean }[];
	isExecutor: boolean;
}): AccountKey[] {
	const has = (capability: string, provider: string) =>
		input.connections.some(
			(c) => c.enabled && c.capability === capability && c.provider === provider,
		);
	const keys: AccountKey[] = [];
	if (has("crm", "hubspot")) keys.push("hubspot");
	if (input.isExecutor && has("mail", "gmail")) keys.push("gmail");
	return keys;
}

/**
 * Un error que no es "falta el grant" ni "no está instalado" es desconocido:
 * decir "sin autorizar" ofrecería un botón que arranca una autorización sobre
 * un grant que puede estar perfecto.
 */
export async function probeAccount(
	key: AccountKey,
	deps: {
		token: (key: AccountKey) => Promise<unknown>;
		isAuthError: (error: unknown) => boolean;
		isNotInstalled: (error: unknown) => boolean;
	},
): Promise<AccountState> {
	try {
		await deps.token(key);
		return "autorizada";
	} catch (error) {
		if (deps.isNotInstalled(error)) return "no_disponible";
		if (deps.isAuthError(error)) return "sin_autorizar";
		console.error(`mis-cuentas: no pude comprobar ${key}:`, error);
		return "desconocido";
	}
}
```

```ts
// lib/connectors/crm/owner.ts
// Quién es esta persona en HubSpot: el id de dueño cuyo correo es el suyo
// (spec 21.2 S9). Nunca tira: sin dueño, sin permiso o con HubSpot caído
// devuelve null y la pantalla lo dice. El token no se registra nunca.
const API = "https://api.hubapi.com";

export async function resolveCrmOwnerId(
	token: string,
	email: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	const wanted = email.trim().toLowerCase();
	if (!wanted) return null;

	try {
		const response = await fetchImpl(
			`${API}/crm/v3/owners?email=${encodeURIComponent(wanted)}&limit=2`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		if (!response.ok) {
			console.error("hubspot owners:", response.status);
			return null;
		}
		const body = (await response.json()) as { results?: unknown };
		const results = Array.isArray(body.results) ? body.results : [];
		const matches = results.filter(
			(row): row is { id: string; email: string } =>
				typeof row === "object" &&
				row !== null &&
				typeof (row as { id?: unknown }).id === "string" &&
				typeof (row as { email?: unknown }).email === "string" &&
				(row as { email: string }).email.toLowerCase() === wanted,
		);
		// Dos dueños con el mismo correo: no se adivina cuál.
		return matches.length === 1 ? matches[0].id : null;
	} catch (error) {
		console.error(
			"hubspot owners:",
			error instanceof Error ? error.message : "error",
		);
		return null;
	}
}
```

En `lib/connectors/executors.ts`, agregar al final:

```ts
/**
 * Sella el dueño de HubSpot del ejecutor. Es un hecho que informa HubSpot, no
 * una preferencia: lo escribe el servidor, no una función del cliente (spec
 * 21.2 S8). Solo actualiza: quien no es ejecutor no pasa a serlo por esto.
 */
export async function markCrmOwner(
	tenantId: string,
	userId: string,
	ownerId: string,
): Promise<void> {
	const { error } = await createAdminClient()
		.from("executors")
		.update({ crm_owner_id: ownerId })
		.eq("tenant_id", tenantId)
		.eq("user_id", userId);
	if (error)
		throw new Error(`No pude registrar el usuario de HubSpot: ${error.message}`);
}
```

Agregar a `tests/connectors/` un test de `markCrmOwner` solo si ya existe un archivo que pruebe `markGmailAuthorized` con el cliente admin doblado (buscar con `grep -rn markGmailAuthorized tests`); si existe, sumar ahí: actualiza `crm_owner_id` filtrando por `tenant_id` y `user_id`, usa `update` y no `upsert`, y tira si la base devuelve error. Si no existe, crear `tests/connectors/executors.test.ts` con esos tres casos doblando `@/lib/supabase/admin`.

En `lib/tenants/nav.ts`, después de la entrada de Conectar:

```ts
	{ href: "/mis-cuentas", label: "Mis cuentas" },
```

- [ ] **Step 4: Implementar la acción, la tarjeta y la página**

```ts
// app/[tenant]/mis-cuentas/actions.ts
"use server";

import { accountsFor, isAccountKey } from "@/lib/accounts/status";
import { startAuthorizationForSubject } from "@/lib/connectors/auth";
import { GOOGLE_CONNECTOR_UID, HUBSPOT_CONNECTOR_UID } from "@/lib/connectors/platform";
import { GMAIL_SCOPES } from "@/lib/gmail/send";
import { connectSubjectIssuer } from "@/lib/outreach/web-context";
import { webSession } from "@/lib/outreach/web-session";
import { createServerSupabase } from "@/lib/supabase/server";

export type AuthorizationResult =
	| { ok: true; url: string }
	| { ok: false; message: string };

/**
 * El ÚNICO lugar de "Mis cuentas" que arranca una autorización, y solo por un
 * clic: entre este link y el consentimiento, el grant anterior deja de servir
 * (verificado en producción el 2026-09-15). Siempre para el sujeto de la
 * sesión; no hay parámetro para actuar por otra persona. La URL no se registra.
 */
export async function startAccountAuthorization(
	slug: string,
	key: string,
): Promise<AuthorizationResult> {
	if (typeof key !== "string" || !isAccountKey(key)) {
		return { ok: false, message: "Esa cuenta no existe." };
	}
	const session = await webSession(slug);
	if (!session) return { ok: false, message: "Volvé a entrar: no hay sesión." };
	const { caller } = session;

	const supabase = await createServerSupabase();
	const [{ data: connections }, { data: executor }] = await Promise.all([
		supabase
			.from("tenant_connections")
			.select("capability, provider, enabled")
			.eq("tenant_id", caller.tenantId),
		supabase
			.from("executors")
			.select("user_id")
			.eq("tenant_id", caller.tenantId)
			.eq("user_id", caller.userId)
			.maybeSingle(),
	]);
	const mine = accountsFor({
		connections: (connections ?? []) as { capability: string; provider: string; enabled: boolean }[],
		isExecutor: Boolean(executor),
	});
	if (!mine.includes(key)) {
		return { ok: false, message: "Esa cuenta no está disponible para vos." };
	}

	try {
		const { url } = await startAuthorizationForSubject(
			key === "gmail" ? GOOGLE_CONNECTOR_UID : HUBSPOT_CONNECTOR_UID,
			{
				tenantId: caller.tenantId,
				userId: caller.userId,
				issuer: connectSubjectIssuer(),
			},
			key === "gmail" ? [...GMAIL_SCOPES] : undefined,
		);
		return { ok: true, url };
	} catch (error) {
		console.error(
			`mis-cuentas: no pude arrancar la autorización de ${key}:`,
			error instanceof Error ? error.message : "error",
		);
		return { ok: false, message: "No pude arrancar la autorización. Probá de nuevo." };
	}
}
```

```tsx
// app/[tenant]/mis-cuentas/account-card.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ACCOUNT_LABELS, type AccountKey, type AccountState, STATE_LABELS } from "@/lib/accounts/status";
import { startAccountAuthorization } from "./actions";

const REAUTH_WARNING =
	"Hasta que completes el consentimiento, esta cuenta deja de funcionar. ¿Seguimos?";

export function AccountCard({
	slug,
	account,
	state,
	note,
}: {
	slug: string;
	account: AccountKey;
	state: AccountState;
	note?: string;
}) {
	const [pending, startTransition] = useTransition();
	const [message, setMessage] = useState<string | null>(null);
	// Solo se ofrece autorizar cuando se sabe el estado: con "desconocido" el
	// grant puede estar sano y arrancar una autorización lo rompería.
	const canAuthorize = state === "autorizada" || state === "sin_autorizar";

	function authorize() {
		if (state === "autorizada" && !window.confirm(REAUTH_WARNING)) return;
		setMessage(null);
		startTransition(async () => {
			const result = await startAccountAuthorization(slug, account);
			if (!result.ok) {
				setMessage(result.message);
				return;
			}
			window.open(result.url, "_blank", "noopener,noreferrer");
			setMessage("Completá la autorización en la pestaña que se abrió y recargá esta página.");
		});
	}

	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="font-medium text-sm">{ACCOUNT_LABELS[account]}</div>
				<div className="text-muted-foreground text-sm">{STATE_LABELS[state]}</div>
				{note ? <div className="text-muted-foreground text-xs">{note}</div> : null}
				{message ? (
					<div className="text-xs" role="status">
						{message}
					</div>
				) : null}
			</div>
			{canAuthorize ? (
				<Button
					disabled={pending}
					onClick={authorize}
					size="sm"
					type="button"
					variant={state === "autorizada" ? "outline" : "default"}
				>
					{state === "autorizada" ? "Reautorizar" : "Autorizar"}
				</Button>
			) : null}
		</li>
	);
}
```

```tsx
// app/[tenant]/mis-cuentas/page.tsx
import { notFound } from "next/navigation";
import { type AccountKey, type AccountState, accountsFor, probeAccount } from "@/lib/accounts/status";
import { isConnectAuthError, isConnectorNotInstalledError, tokenForSubject } from "@/lib/connectors/auth";
import { resolveCrmOwnerId } from "@/lib/connectors/crm/owner";
import { markCrmOwner, markGmailAuthorized } from "@/lib/connectors/executors";
import { GOOGLE_CONNECTOR_UID, HUBSPOT_CONNECTOR_UID } from "@/lib/connectors/platform";
import { GMAIL_SCOPES } from "@/lib/gmail/send";
import { connectSubjectIssuer } from "@/lib/outreach/web-context";
import { webSession } from "@/lib/outreach/web-session";
import { createServerSupabase } from "@/lib/supabase/server";
import { AccountCard } from "./account-card";

const OWNER_NOTE = "No pude leer tu usuario de HubSpot. Avisale a un administrador.";

export default async function MisCuentasPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const session = await webSession(slug);
	if (!session) notFound();
	const { caller } = session;

	const supabase = await createServerSupabase();
	const [connectionsResult, executorResult] = await Promise.all([
		supabase
			.from("tenant_connections")
			.select("capability, provider, enabled")
			.eq("tenant_id", caller.tenantId),
		supabase
			.from("executors")
			.select("user_id, gmail_authorized_at, crm_owner_id")
			.eq("tenant_id", caller.tenantId)
			.eq("user_id", caller.userId)
			.maybeSingle(),
	]);
	if (connectionsResult.error || executorResult.error) {
		console.error("mis-cuentas: no pude leer la configuración:", connectionsResult.error ?? executorResult.error);
		return (
			<div className="max-w-3xl space-y-4">
				<h1 className="text-3xl leading-tight">Mis cuentas</h1>
				<p className="text-muted-foreground text-sm">No pude leer tus cuentas. Recargá la página.</p>
			</div>
		);
	}

	const executor = executorResult.data as
		| { gmail_authorized_at: string | null; crm_owner_id: string | null }
		| null;
	const accounts = accountsFor({
		connections: (connectionsResult.data ?? []) as { capability: string; provider: string; enabled: boolean }[],
		isExecutor: Boolean(executor),
	});

	const subject = {
		tenantId: caller.tenantId,
		userId: caller.userId,
		issuer: connectSubjectIssuer(),
	};
	// Pedir un token no modifica nada. Acá NUNCA se llama a
	// startAuthorizationForSubject: eso es solo por el clic (actions.ts).
	const tokens = new Map<AccountKey, string>();
	const states = new Map<AccountKey, AccountState>();
	await Promise.all(
		accounts.map(async (key) => {
			const state = await probeAccount(key, {
				token: async (account) => {
					const { token } = await tokenForSubject(
						account === "gmail" ? GOOGLE_CONNECTOR_UID : HUBSPOT_CONNECTOR_UID,
						subject,
						account === "gmail" ? [...GMAIL_SCOPES] : undefined,
					);
					tokens.set(account, token);
				},
				isAuthError: isConnectAuthError,
				isNotInstalled: isConnectorNotInstalledError,
			});
			states.set(key, state);
		}),
	);

	// Reconciliación: solo ejecutores, solo con la cuenta autorizada. Nada de
	// esto puede romper la página.
	let hubspotNote: string | undefined;
	if (executor) {
		if (states.get("gmail") === "autorizada" && !executor.gmail_authorized_at) {
			try {
				await markGmailAuthorized(caller.tenantId, caller.userId);
			} catch (error) {
				console.error("mis-cuentas: no pude sellar Gmail:", error);
			}
		}
		const hubspotToken = tokens.get("hubspot");
		if (states.get("hubspot") === "autorizada" && !executor.crm_owner_id && hubspotToken) {
			try {
				const ownerId = await resolveCrmOwnerId(hubspotToken, caller.email);
				if (ownerId) await markCrmOwner(caller.tenantId, caller.userId, ownerId);
				else hubspotNote = OWNER_NOTE;
			} catch (error) {
				console.error("mis-cuentas: no pude guardar el dueño de HubSpot:", error instanceof Error ? error.message : "error");
				hubspotNote = OWNER_NOTE;
			}
		}
	}

	return (
		<div className="max-w-3xl space-y-6">
			<div>
				<h1 className="mb-2 text-3xl leading-tight">Mis cuentas</h1>
				<p className="text-muted-foreground text-sm">
					Autorizá tus cuentas para que el agente pueda trabajar a tu nombre. Solo vos podés autorizar las tuyas.
				</p>
			</div>
			{accounts.length === 0 ? (
				<p className="text-muted-foreground text-sm">No hay cuentas para autorizar en esta empresa.</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{accounts.map((key) => (
						<AccountCard
							account={key}
							key={key}
							note={key === "hubspot" ? hubspotNote : undefined}
							slug={slug}
							state={states.get(key) ?? "desconocido"}
						/>
					))}
				</ul>
			)}
		</div>
	);
}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run tests/accounts tests/connectors tests/tenants/nav.test.ts tests/server-actions-exports.test.ts && npm run typecheck && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: PASS (incluido `tests/connectors/import-rule.test.ts`: ningún archivo nuevo importa `@vercel/connect`), typecheck limpio, suite completa en verde. Si otro test de la suite afirma la lista del menú o cuenta sus entradas, actualizarlo sumando "Mis cuentas" y decirlo en el reporte.

- [ ] **Step 6: Commit**

```bash
npx biome check --write lib/accounts/status.ts lib/connectors/crm/owner.ts lib/connectors/executors.ts lib/tenants/nav.ts "app/[tenant]/mis-cuentas" tests/accounts tests/connectors/crm-owner.test.ts tests/tenants/nav.test.ts
npx biome check lib/accounts/status.ts lib/connectors/crm/owner.ts lib/connectors/executors.ts lib/tenants/nav.ts "app/[tenant]/mis-cuentas" tests/accounts tests/connectors/crm-owner.test.ts tests/tenants/nav.test.ts
git add lib/accounts/status.ts lib/connectors/crm/owner.ts lib/connectors/executors.ts lib/tenants/nav.ts "app/[tenant]/mis-cuentas" tests/accounts tests/connectors tests/tenants/nav.test.ts
git commit -m "feat: Mis cuentas, para que cada persona autorice Gmail y HubSpot sin esperar a que falle una acción"
```

---

### Task 6: Baja del script, roadmap y verificación

**Files:**
- Delete: `scripts/executors-set.mts`, `scripts/executors-set-args.ts`, `tests/scripts/executors-set-args.test.ts`
- Modify: `package.json`, `docs/01-roadmap-etapas.md`, y los comentarios o mensajes que nombren `executors:set` o `executors-set`

- [ ] **Step 1: Confirmar que nada más usa el script**

Run: `grep -rn "executors-set\|executors:set" . --include='*.ts' --include='*.tsx' --include='*.mts' --include='*.md' --include='*.json' --include='*.sql' | grep -v node_modules | grep -v "\.next/" | grep -v "\.eve/" | grep -v "\.claude/worktrees" | grep -v "^./docs/superpowers" | grep -v "^./docs/2026-10-09"`
Expected: `package.json`, los tres archivos a borrar, comentarios en código (por ejemplo en migraciones viejas, que **no** se tocan) y documentación viva. Si algún archivo de código importa de `executors-set-args`, mover esa pieza antes de borrar.

- [ ] **Step 2: Borrar y actualizar referencias**

```bash
git rm scripts/executors-set.mts scripts/executors-set-args.ts tests/scripts/executors-set-args.test.ts
```

Borrar la línea `"executors:set": ...` de `package.json`. En código y documentación viva (no `docs/superpowers/**`, no `docs/2026-10-09-*`, no migraciones ya aplicadas), cambiar cada mención del script por "desde Configuración → Ejecutores" cuando sea una instrucción para una persona, o por la función `set_executor` cuando sea un comentario sobre quién escribe la tabla. Solo texto: ningún cambio de comportamiento.

- [ ] **Step 3: Actualizar el roadmap**

En `docs/01-roadmap-etapas.md`, sección "## Etapa 21":

1. En la línea `**Spec/Plan:**`, después de la parte de la 21.1, agregar: ` 21.2: \`docs/superpowers/specs/2026-10-10-etapa-21-2-settings-cliente-design.md\` · \`docs/superpowers/plans/2026-10-10-etapa-21-2-settings-cliente.md\`.` y dejar "21.3 a 21.5: a escribir."
2. Reemplazar la línea de la 21.2 por:

```
- [ ] **21.2 · Settings del cliente.** Código terminado; falta el cierre en producción (anexo A de la spec: autorizar Gmail y HubSpot desde "Mis cuentas", comprobar que cargar la página no rompe un Gmail ya autorizado, que el dueño de HubSpot se guarda solo, que `auto` deja escribir al workflow y que un conector apagado por plataforma no se puede encender desde el cliente). El administrador del cliente edita ejecutores (con techo de 200 por día y sin poder quitar a quien tiene historial), elige la política de los pasos de nivel 2 y enciende o apaga los conectores que INNOV.AS asoció; cualquier miembro autoriza sus cuentas en `/<slug>/mis-cuentas`. Todo por funciones que verifican en la base que quien llama sea administrador de esa empresa. `executors:set` se va. **Antes de desplegar:** `npx supabase migration list` y aplicar `20261016120000_tenant_settings` antes que el código.
```

- [ ] **Step 4: Verificar todo y commitear**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npm run db:test 2>&1 | tail -4; npm run typecheck; npm run build 2>&1 | tail -5`
Expected: todo en verde.

```bash
git add package.json docs/01-roadmap-etapas.md
git add -u scripts tests/scripts lib agents app
git status --short
git commit -m "docs: baja de executors:set y cierre de código de la 21.2"
```

Antes del commit, `git status --short` no tiene que mostrar nada fuera de esta tarea salvo `.codex/` y `docs/producto-innovas-ai-os.md` sin trackear.

- [ ] **Step 5: Verificación en navegador contra la base local (la corre el controlador)**

1. `npm run db:reset`. Levantar `next dev` con variables explícitas a la base local (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` de `npx supabase status -o env`, `PUBLIC_APP_URL=http://localhost:3000`, `PLATFORM_OWNER_TENANT_SLUG=innovas-seed`), con `env -i` para no heredar `.env.local`.
2. Crear por la API de admin de Auth un usuario `tenant_admin` y otro `tenant_member` en `demo` (los del seed no aceptan link mágico) y entrar con `generate_link`.
3. Como administrador, en `/demo/settings`: agregar al miembro como ejecutor con el slug sugerido; editar el cupo a 200 (se guarda) y a 201 (mensaje "el cupo diario va de 0 a 200"); quitar al ejecutor (se va); volver a agregarlo, insertarle un contacto propio por SQL y quitarlo (mensaje de historial y sigue ahí).
4. Aprobaciones: cambiar `outreach/crm-record` a "Sin pedir", recargar y ver que quedó; comprobar por SQL que `config.brain` no cambió.
5. Conectores: insertar por SQL un `leads/coldiq` habilitado; deshabilitarlo y habilitarlo desde la pantalla; ponerle `locked_by_platform = true, enabled = false` por SQL y ver "Deshabilitado por INNOV.AS" sin botón. Mirar el HTML: el identificador no aparece.
6. Como miembro: `/demo/settings` da 404; el menú muestra "Mis cuentas"; `/demo/mis-cuentas` carga. En local Connect no responde: el estado tiene que ser "No pude comprobarlo" **sin botón**, y el log del servidor no puede mostrar ninguna llamada de autorización.
7. A 375 px: settings y Mis cuentas sin scroll horizontal.
8. Apagar el dev server y `npm run db:reset`.

Si algún paso no se puede correr, decirlo en el resumen y no darlo por verificado.

- [ ] **Step 6: Entregar**

Usar `superpowers:verification-before-completion`. En el resumen final: orden de despliegue (migración antes que el código), el anexo A como pendiente de producción, que el camino REST para el dueño de HubSpot no se pudo probar contra el conector real, y qué pasos de navegador no se corrieron. No hacer push ni abrir el PR sin que lo pida la persona.
