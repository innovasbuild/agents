# Etapa 20.2: operación de usuarios (bloqueo, rol y reenvío): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador pueda bloquear a una persona, cambiarle el rol a un miembro y reenviar una invitación desde `/<slug>/settings/usuarios`, sin SQL a mano.

**Architecture:** El bloqueo es una tabla por empresa y persona que solo escriben dos funciones `security definer`; `join_tenants_by_domain` y `login_gate` la respetan y aceptar una invitación la levanta. Un trigger impide que una empresa quede sin administrador, venga el cambio de donde venga. La aplicación suma cuatro server actions con resultado y mensaje, y la pantalla de usuarios pasa a mostrar ese resultado con dos componentes cliente chicos.

**Tech Stack:** Postgres (Supabase), pgTAP, Next.js 16 App Router, `@supabase/ssr`, shadcn (`components/ui`), Vitest en entorno `node`.

**Spec:** `docs/superpowers/specs/2026-10-09-etapa-20-login-design.md`, secciones 6 y 7, decisiones U1 a U5 y L10 a L12. La entrega 20.1 (secciones 4 y 5) ya está implementada en la rama de la que parte esta.

## Global Constraints

- Rama: `feat/etapa-20-2-usuarios`, creada desde `feat/etapa-20-login` (PR 85). Si el PR 85 se mergea antes de terminar, rebasar sobre `main`.
- Antes de escribir SQL, cargar la skill `supabase-postgres-best-practices`. Toda función nueva es `security definer set search_path = ''`, con `revoke execute ... from public, anon` y `grant execute ... to authenticated`. Toda tabla lleva `tenant_id` y RLS.
- `events` es append-only: solo `insert`.
- Las tres funciones que se redefinen (`accept_pending_invitations`, `join_tenants_by_domain`, `login_gate`) parten de su cuerpo **vigente**, el de `supabase/migrations/20261013120000_login_methods.sql`, y solo suman lo que este plan indica. No se pierde ningún evento ni condición.
- Toda server action nueva aplica el chequeo del método de la sesión con `actionAllowsLogin(supabase, userId, tenantId)` de `lib/tenants/login-check-server.ts` antes de escribir (spec L10 a L12), contra la empresa de la fila que toca. Falla cerrado. Las actions no redirigen.
- El id de la empresa sale de la fila leída con la sesión del usuario (la RLS aplica), no de un parámetro, siempre que exista una fila que leer.
- Códigos y mensajes exactos:
  - `42501` → "No tenés permiso."
  - `23514` → "La empresa no puede quedar sin administrador."
  - Excepción del trigger: `la empresa no puede quedar sin administrador`, `errcode = '23514'`.
  - Eventos: `membership.blocked`, `membership.unblocked`.
  - Reenvío: "Invitación reenviada.", "Esa persona ya tiene cuenta. Pasale el link de ingreso de la empresa.", "No se pudo mandar el mail. Probá de nuevo."
  - Rol: "No se puede cambiar el rol de un administrador de la plataforma."
  - Bloqueo propio: "No podés bloquearte a vos."
- Roles asignables desde la pantalla: `tenant_admin` y `tenant_member`. Nunca `platform_admin`.
- Español rioplatense en UI y mensajes; código e identificadores en inglés. Nada específico de un tenant en código.
- Tests: `tests/**/*.test.ts`, entorno `node`, componentes con `createElement` y `renderToStaticMarkup`. SQL: `supabase/tests/*.test.sql` con pgTAP.
- Lint: **no** correr `npm run lint:fix` (reformatea 26 archivos ajenos). Usar `npx biome check --write <archivos de la tarea>`.
- Después de cada tarea: `npm run typecheck` limpio. Cada commit termina con la línea `Co-Authored-By` del modelo que lo escribe. Identidad de git: `innovasbuild` / `matias@innov.as`. `git add` solo de los archivos de la tarea.
- Base local: Docker abierto y `npm run db:start`. `npm run db:test` hace `db reset --no-seed` y corre pgTAP. Después de aplicar una migración: `npm run db:reset && npm run db:types`.
- **No** aplicar nada en producción ni hacer push sin que lo pida la persona.

## Review Focus

1. **Tests SQL existentes que degradan o borran al único administrador de una empresa** (`01`, `05`, `24`, `25`): el trigger nuevo los va a frenar. Se arregla el armado del test sumando otro administrador, no relajando el trigger. Tarea 1.
2. **Borrar una empresa entera o un usuario de Auth**: el borrado en cascada de la empresa tiene que pasar; el de un usuario que es el único administrador tiene que fallar con `23514`. Tarea 1.
3. **Dos administradores que se degradan entre sí al mismo tiempo**: el trigger toma un candado sobre la fila del tenant para que no queden los dos como miembros. Tarea 1.
4. **Una persona bloqueada con una invitación pendiente**: la invitación gana y levanta el bloqueo; sin invitación, el dominio abierto no la vuelve a unir y `login_gate` no la manda a la landing de esa empresa. Tarea 1.
5. **Reenviar a alguien que ya tiene cuenta, o cuando el mail falla**: el vencimiento se renueva igual y la pantalla dice qué pasó; nunca queda en silencio. Tareas 2 y 3.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261014120000_member_blocks.sql` (nuevo) | Tabla de bloqueos, `block_member`, `unblock_member`, trigger del último administrador, y las tres funciones redefinidas |
| `supabase/tests/28_member_blocks.test.sql` (nuevo) | pgTAP de todo lo anterior |
| `supabase/tests/01_*`, `05_*`, `24_*`, `25_*` (modifica si hace falta) | Un segundo administrador donde el trigger frene el armado |
| `lib/invitations/invite.ts` (modifica) | `sendInvitationMail`, extraída de `inviteToTenant` |
| `app/[tenant]/settings/usuarios/actions.ts` (modifica) | Las seis actions con resultado |
| `app/[tenant]/settings/usuarios/row-actions.tsx` (nuevo) | `ActionButton` y `RoleSelect`, componentes cliente |
| `app/[tenant]/settings/usuarios/page.tsx` (modifica) | Selector de rol, Bloquear, sección Bloqueados, Reenviar |
| `docs/superpowers/specs/2026-10-09-etapa-20-login-design.md`, `docs/01-roadmap-etapas.md` (modifica) | Firmas reales y cierre |

---

### Task 1: Bloqueos y último administrador en la base

**Files:**
- Create: `supabase/migrations/20261014120000_member_blocks.sql`
- Create: `supabase/tests/28_member_blocks.test.sql`
- Modify (solo si el trigger los rompe): `supabase/tests/01_tenants_memberships.test.sql`, `05_conversation_column_locks.test.sql`, `24_brain_rules_membership_cleanup.test.sql`, `25_memberships_lock_columns.test.sql`
- Modify (generado): `lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `public.current_login_method()`, `public.has_tenant_role(uuid, tenant_role[])`, `public.is_platform_admin()`, los cuerpos vigentes de las tres funciones en `20261013120000_login_methods.sql`.
- Produces: tabla `public.membership_blocks (tenant_id, user_id, blocked_by, created_at)`; RPC `block_member(p_tenant uuid, p_user uuid) → void`; RPC `unblock_member(p_tenant uuid, p_user uuid) → void`; trigger `memberships_keep_one_admin`.

- [ ] **Step 1: Cargar la skill de Postgres**

Invocar `supabase-postgres-best-practices` y leer lo que diga sobre triggers, candados de fila y funciones `security definer`.

- [ ] **Step 2: Escribir el pgTAP que falla**

```sql
-- supabase/tests/28_member_blocks.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- Personas. El último dígito del uuid es el número de persona.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('b8b8b8b8-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm1@bk.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adm2@bk.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mem@bk.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'otro@otra.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'solo@unica.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'segundo@unica.test', now());

-- bk-a: abierta al dominio bk.test, dos administradores y un miembro.
-- bk-b: otra empresa. bk-c: una empresa con un solo administrador.
insert into public.tenants (id, slug, display_name, allowed_domains, self_signup_by_domain, auth_methods, active)
values
  ('a8a8a8a8-0000-0000-0000-00000000000a', 'bk-a', 'BK A', '{bk.test}', true, '{email}', true),
  ('a8a8a8a8-0000-0000-0000-00000000000b', 'bk-b', 'BK B', '{}', false, '{email}', true),
  ('a8a8a8a8-0000-0000-0000-00000000000c', 'bk-c', 'BK C', '{}', false, '{email}', true);

insert into public.memberships (tenant_id, user_id, role)
values
  ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000001', 'tenant_admin'),
  ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000002', 'tenant_admin'),
  ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003', 'tenant_member'),
  ('a8a8a8a8-0000-0000-0000-00000000000b', 'b8b8b8b8-0000-0000-0000-000000000004', 'tenant_admin'),
  ('a8a8a8a8-0000-0000-0000-00000000000c', 'b8b8b8b8-0000-0000-0000-000000000005', 'tenant_admin');

-- Sesión por link de correo de la persona N.
create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"b8b8b8b8-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

-- 1-3: estructura y privilegios.
select has_table('public', 'membership_blocks', 'existe la tabla de bloqueos');
select ok(has_function_privilege('authenticated', 'public.block_member(uuid, uuid)', 'execute'), 'authenticated ejecuta block_member');
select ok(not has_function_privilege('anon', 'public.unblock_member(uuid, uuid)', 'execute'), 'anon no ejecuta unblock_member');

-- 4-7: quién no puede bloquear.
select pg_temp.login_as(3);
select throws_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000002')$$,
  '42501', null, 'un miembro común no puede bloquear');
select throws_ok(
  $$insert into public.membership_blocks (tenant_id, user_id) values ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000002')$$,
  '42501', null, 'nadie escribe la tabla por la API');
select pg_temp.login_as(4);
select throws_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  '42501', null, 'el administrador de otra empresa no puede bloquear acá');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000001')$$,
  '42501', null, 'nadie se bloquea a sí mismo');

-- 8-13: bloquear a un miembro.
select lives_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  'un administrador bloquea a un miembro');
select is(
  (select count(*)::int from public.membership_blocks
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  1, 'el administrador ve el bloqueo');
select lives_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  'bloquear dos veces no falla');
reset role;
select is(
  (select count(*)::int from public.memberships
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  0, 'la membresía se borró');
select is(
  (select blocked_by from public.membership_blocks
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  'b8b8b8b8-0000-0000-0000-000000000001'::uuid, 'queda anotado quién bloqueó');
select is(
  (select count(*)::int from public.events
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and type = 'membership.blocked'
      and payload ->> 'user_id' = 'b8b8b8b8-0000-0000-0000-000000000003'),
  1, 'un solo evento aunque se bloquee dos veces');

-- 14-17: la persona bloqueada.
select pg_temp.login_as(3);
select is(
  (select count(*)::int from public.membership_blocks),
  0, 'la persona bloqueada no ve la tabla de bloqueos');
select is((select public.join_tenants_by_domain()), 0, 'el dominio abierto no vuelve a unir a un bloqueado');
select is((select public.login_gate()), '{"allowed":true,"landing":null}'::jsonb, 'login_gate no la manda a la landing de la empresa que la bloqueó');
select throws_ok(
  $$select public.unblock_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  '42501', null, 'no puede desbloquearse sola');

-- 18-20: desbloquear.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.unblock_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  'un administrador desbloquea');
reset role;
select is(
  (select count(*)::int from public.events
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and type = 'membership.unblocked'),
  1, 'desbloquear deja su evento');
select pg_temp.login_as(3);
select is((select public.join_tenants_by_domain()), 1, 'desbloqueada, el dominio abierto la vuelve a unir');

-- 21-24: una invitación levanta el bloqueo.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  'se la bloquea de nuevo');
reset role;
insert into public.invitations (tenant_id, email, role, invited_by)
values ('a8a8a8a8-0000-0000-0000-00000000000a', 'mem@bk.test', 'tenant_admin', 'b8b8b8b8-0000-0000-0000-000000000001');
select pg_temp.login_as(3);
select is((select public.accept_pending_invitations()), 1, 'acepta la invitación aunque estaba bloqueada');
reset role;
select is(
  (select count(*)::int from public.membership_blocks
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  0, 'aceptar la invitación levantó el bloqueo');
select is(
  (select role::text from public.memberships
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  'tenant_admin', 'y entra con el rol de la invitación');

-- 25-27: el único administrador no se toca.
select pg_temp.login_as(5);
select throws_ok(
  $$update public.memberships set role = 'tenant_member'
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000c' and user_id = 'b8b8b8b8-0000-0000-0000-000000000005'$$,
  '23514', 'la empresa no puede quedar sin administrador', 'el único administrador no se degrada');
select throws_ok(
  $$delete from public.memberships
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000c' and user_id = 'b8b8b8b8-0000-0000-0000-000000000005'$$,
  '23514', 'la empresa no puede quedar sin administrador', 'el único administrador no se saca');
reset role;
select throws_ok(
  $$delete from auth.users where id = 'b8b8b8b8-0000-0000-0000-000000000005'$$,
  '23514', null, 'borrar de Auth al único administrador también falla');

-- 28-31: con dos administradores sí se puede, hasta que queda uno.
insert into public.memberships (tenant_id, user_id, role)
values ('a8a8a8a8-0000-0000-0000-00000000000c', 'b8b8b8b8-0000-0000-0000-000000000006', 'tenant_admin');
select pg_temp.login_as(6);
select lives_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000c', 'b8b8b8b8-0000-0000-0000-000000000005')$$,
  'con dos administradores, uno bloquea al otro');
select throws_ok(
  $$update public.memberships set role = 'tenant_member'
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000c' and user_id = 'b8b8b8b8-0000-0000-0000-000000000006'$$,
  '23514', null, 'y el que quedó ya no se puede degradar');
select pg_temp.login_as(1);
select lives_ok(
  $$update public.memberships set role = 'tenant_member'
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000002'$$,
  'con tres administradores en bk-a, uno se degrada');
select lives_ok(
  $$update public.memberships set role = 'tenant_admin'
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000002'$$,
  'subir a alguien a administrador nunca lo frena el trigger');
reset role;

-- 32-33: borrar la empresa entera pasa, y se lleva sus bloqueos.
select lives_ok(
  $$delete from public.tenants where id = 'a8a8a8a8-0000-0000-0000-00000000000c'$$,
  'borrar una empresa entera no lo frena el trigger');
select is(
  (select count(*)::int from public.membership_blocks where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000c'),
  0, 'y sus bloqueos se van con ella');

select * from finish();
rollback;
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npm run db:test 2>&1 | tail -20`
Expected: `28_member_blocks.test.sql` falla porque `public.membership_blocks` no existe. Los demás archivos pasan.

- [ ] **Step 4: Escribir la migración**

Las tres funciones redefinidas se copian de `supabase/migrations/20261013120000_login_methods.sql` y se les suma **solo** lo marcado con `-- 20.2`. Antes de pegar, abrir ese archivo y confirmar que el cuerpo de abajo coincide con el vigente en todo lo demás.

```sql
-- supabase/migrations/20261014120000_member_blocks.sql
-- Operación de usuarios (spec 2026-10-09-etapa-20-login-design, 20.2).
--
-- 1. membership_blocks: una persona bloqueada en una empresa. "Sacar" a
--    alguien de un dominio abierto no alcanza: vuelve a entrar sola. La tabla
--    la escriben solo block_member y unblock_member.
-- 2. join_tenants_by_domain salta a los bloqueados; login_gate no los manda a
--    la landing de la empresa que los bloqueó; aceptar una invitación levanta
--    el bloqueo, porque es una decisión explícita y más nueva.
-- 3. memberships_keep_one_admin: una empresa no puede quedar sin
--    administrador, venga el cambio de un UPDATE de rol, de un DELETE o de
--    block_member.
create table public.membership_blocks (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  blocked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index membership_blocks_user_id_idx on public.membership_blocks (user_id);
create index membership_blocks_blocked_by_idx on public.membership_blocks (blocked_by);

alter table public.membership_blocks enable row level security;

create policy membership_blocks_select on public.membership_blocks
  for select to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

revoke all on public.membership_blocks from anon;
revoke insert, update, delete, truncate on public.membership_blocks from authenticated;
grant select on public.membership_blocks to authenticated;

-- Una empresa no puede quedar sin administrador. El candado sobre la fila del
-- tenant serializa dos cambios simultáneos (dos administradores que se
-- degradan entre sí); "no key update" no choca con los FK que insertan filas
-- hijas. Si la fila del tenant ya no está, es el borrado en cascada de la
-- empresa entera y se deja pasar.
create or replace function public.memberships_keep_one_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role not in ('tenant_admin', 'platform_admin') then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role in ('tenant_admin', 'platform_admin') then
    return new;
  end if;

  perform 1 from public.tenants t where t.id = old.tenant_id for no key update;
  if not found then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = old.tenant_id
      and m.id <> old.id
      and m.role in ('tenant_admin', 'platform_admin')
  ) then
    raise exception 'la empresa no puede quedar sin administrador'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.memberships_keep_one_admin() from public;

create trigger memberships_keep_one_admin
  before update of role or delete on public.memberships
  for each row execute function public.memberships_keep_one_admin();

create or replace function public.block_member(p_tenant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_target_role public.tenant_role;
begin
  if v_actor is null then
    raise exception 'no authenticated user';
  end if;
  if not (
    (select public.has_tenant_role(p_tenant, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  ) then
    raise exception 'solo un administrador puede bloquear' using errcode = '42501';
  end if;
  if p_user = v_actor then
    raise exception 'nadie se bloquea a sí mismo' using errcode = '42501';
  end if;

  select m.role into v_target_role
  from public.memberships m
  where m.tenant_id = p_tenant and m.user_id = p_user;

  -- Misma regla que memberships_write: solo plataforma toca a un platform_admin.
  if v_target_role = 'platform_admin' and not (select public.is_platform_admin()) then
    raise exception 'solo plataforma bloquea a un administrador de plataforma'
      using errcode = '42501';
  end if;

  -- El trigger memberships_keep_one_admin puede frenar este delete.
  delete from public.memberships
  where tenant_id = p_tenant and user_id = p_user;

  insert into public.membership_blocks (tenant_id, user_id, blocked_by)
  values (p_tenant, p_user, v_actor)
  on conflict (tenant_id, user_id) do nothing;

  if found then
    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (p_tenant, v_actor, 'membership.blocked', 'Persona bloqueada',
            jsonb_build_object('user_id', p_user));
  end if;
end;
$$;

revoke execute on function public.block_member(uuid, uuid) from public;
revoke execute on function public.block_member(uuid, uuid) from anon;
grant execute on function public.block_member(uuid, uuid) to authenticated;

create or replace function public.unblock_member(p_tenant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'no authenticated user';
  end if;
  if not (
    (select public.has_tenant_role(p_tenant, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  ) then
    raise exception 'solo un administrador puede desbloquear' using errcode = '42501';
  end if;

  delete from public.membership_blocks
  where tenant_id = p_tenant and user_id = p_user;

  if found then
    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (p_tenant, v_actor, 'membership.unblocked', 'Persona desbloqueada',
            jsonb_build_object('user_id', p_user));
  end if;
end;
$$;

revoke execute on function public.unblock_member(uuid, uuid) from public;
revoke execute on function public.unblock_member(uuid, uuid) from anon;
grant execute on function public.unblock_member(uuid, uuid) to authenticated;

create or replace function public.accept_pending_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_method text;
  v_email text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
  end if;

  v_method := public.current_login_method();
  if v_method is null then
    return 0;
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email is null then
    return 0;
  end if;

  for r in
    update public.invitations i
       set status = 'accepted', accepted_at = now(), accepted_user_id = v_user
      from public.tenants t
     where t.id = i.tenant_id
       and t.active
       and v_method = any (t.auth_methods)
       and i.email = v_email and i.status = 'pending' and i.expires_at > now()
    returning i.id, i.tenant_id, i.role
  loop
    -- 20.2: una invitación es una decisión explícita y más nueva que el bloqueo.
    delete from public.membership_blocks
    where tenant_id = r.tenant_id and user_id = v_user;
    if found then
      insert into public.events (tenant_id, actor_user_id, type, summary, payload)
      values (r.tenant_id, v_user, 'membership.unblocked', 'Bloqueo levantado por una invitación',
              jsonb_build_object('user_id', v_user, 'invitation_id', r.id));
    end if;

    insert into public.memberships (tenant_id, user_id, role)
    values (r.tenant_id, v_user, r.role)
    on conflict (tenant_id, user_id) do nothing;

    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (r.tenant_id, v_user, 'invitation.accepted', 'Invitación aceptada',
            jsonb_build_object('invitation_id', r.id, 'role', r.role));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.join_tenants_by_domain()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_method text;
  v_email text;
  v_domain text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
  end if;

  v_method := public.current_login_method();
  if v_method is null then
    return 0;
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return 0;
  end if;

  v_domain := split_part(v_email, '@', 2);

  for r in
    select t.id
    from public.tenants t
    where t.active
      and t.self_signup_by_domain
      and v_method = any (t.auth_methods)
      and v_domain = any (select lower(d) from unnest(t.allowed_domains) d)
      -- 20.2: el dominio abierto no vuelve a unir a una persona bloqueada.
      and not exists (
        select 1 from public.membership_blocks b
        where b.tenant_id = t.id and b.user_id = v_user
      )
  loop
    insert into public.memberships (tenant_id, user_id, role)
    values (r.id, v_user, 'tenant_member')
    on conflict (tenant_id, user_id) do nothing;

    if found then
      insert into public.events (tenant_id, actor_user_id, type, summary, payload)
      values (r.id, v_user, 'membership.joined_by_domain', 'Ingreso por dominio',
              jsonb_build_object('domain', v_domain));
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.login_gate()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_method text;
  v_email text;
  v_domain text;
  v_landing text;
begin
  if v_user is null then
    raise exception 'no authenticated user';
  end if;

  v_method := public.current_login_method();

  if exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and t.active and v_method = any (t.auth_methods)
  ) then
    return jsonb_build_object('allowed', true, 'landing', null);
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email ~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    v_domain := split_part(v_email, '@', 2);
  end if;

  -- Las empresas que la esperan: donde ya es miembro, donde tiene una
  -- invitación pendiente y donde su dominio está abierto. En ese orden.
  select w.slug into v_landing
  from (
    select t.slug, 1 as ord
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and t.active
    union all
    select t.slug, 2
    from public.invitations i
    join public.tenants t on t.id = i.tenant_id
    where v_email is not null and i.email = v_email
      and i.status = 'pending' and i.expires_at > now() and t.active
    union all
    select t.slug, 3
    from public.tenants t
    where v_domain is not null and t.active and t.self_signup_by_domain
      and v_domain = any (select lower(d) from unnest(t.allowed_domains) d)
      -- 20.2: una empresa que la bloqueó no la espera por dominio.
      and not exists (
        select 1 from public.membership_blocks b
        where b.tenant_id = t.id and b.user_id = v_user
      )
  ) w
  order by w.ord, w.slug
  limit 1;

  if v_landing is null then
    return jsonb_build_object('allowed', true, 'landing', null);
  end if;
  return jsonb_build_object('allowed', false, 'landing', v_landing);
end;
$$;
```

- [ ] **Step 5: Correr todo el pgTAP y arreglar el armado de los tests viejos**

Run: `npm run db:test 2>&1 | tail -30`
Expected: `28` pasa con 33 aserciones. Si `01`, `05`, `24` o `25` fallan con `23514`, es porque su armado saca o degrada al único administrador de una empresa. En cada caso: sumar un segundo administrador a esa empresa en el `insert` de preparación del test (un usuario nuevo de `auth.users` y su fila `tenant_admin`), y si eso cambia un conteo esperado, ajustar ese número explicando por qué en un comentario. No tocar el trigger ni borrar aserciones. Si un conteo de `plan()` no coincide en `28`, corregir el número del `plan`.

- [ ] **Step 6: Regenerar tipos y commit**

```bash
npm run db:reset && npm run db:types
npm run typecheck && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"
git add supabase/migrations/20261014120000_member_blocks.sql supabase/tests/28_member_blocks.test.sql lib/supabase/database.types.ts
# más los supabase/tests/*.sql que hubo que ajustar en el Step 5
git commit -m "feat: bloqueo por persona y una empresa no puede quedar sin administrador"
```

---

### Task 2: `sendInvitationMail`

**Files:**
- Modify: `lib/invitations/invite.ts`
- Test: `tests/invitations/invite.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` admin.
- Produces: `sendInvitationMail(params: { admin: SupabaseClient; email: string; origin: string; next?: string }): Promise<"ok" | "ya_existe" | "mail_fallo">`. `inviteToTenant` conserva su firma y sus resultados.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/invitations/invite.test.ts`, sumar `sendInvitationMail` al import y agregar al final del archivo, reusando el doble `admin` y el `state` que el archivo ya define (resetear `state.invites` e `state.inviteError` en el `beforeEach` existente si no lo hace):

```ts
describe("sendInvitationMail", () => {
	const params = {
		// biome-ignore lint/suspicious/noExplicitAny: doble de prueba del cliente admin
		admin: admin as any,
		email: "ana@acme.test",
		origin: "https://app.test",
	};

	it("manda el mail con el callback del origen", async () => {
		expect(await sendInvitationMail(params)).toBe("ok");
		expect(state.invites).toEqual([
			{ email: "ana@acme.test", redirectTo: "https://app.test/auth/callback" },
		]);
	});

	it("con next, lo lleva codificado en el callback", async () => {
		await sendInvitationMail({ ...params, next: "/acme/chat" });

		expect(state.invites[0].redirectTo).toBe(
			"https://app.test/auth/callback?next=%2Facme%2Fchat",
		);
	});

	it.each(["email_exists", "user_already_exists"])(
		"si la persona ya tiene cuenta (%s) lo dice",
		async (code) => {
			state.inviteError = { code, message: "ya existe" };
			expect(await sendInvitationMail(params)).toBe("ya_existe");
		},
	);

	it("cualquier otro error es un fallo del mail", async () => {
		state.inviteError = { code: "over_email_send_rate_limit", message: "x" };
		expect(await sendInvitationMail(params)).toBe("mail_fallo");
	});

	it("no escribe nada en la base", async () => {
		await sendInvitationMail(params);
		expect(state.inserts).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/invitations/invite.test.ts`
Expected: FAIL, `sendInvitationMail` no existe.

- [ ] **Step 3: Implementar**

En `lib/invitations/invite.ts`, agregar antes de `inviteToTenant`:

```ts
export type InvitationMailOutcome = "ok" | "ya_existe" | "mail_fallo";

/**
 * Manda el mail de invitación de Supabase. No toca `invitations`: quien llama
 * ya creó o renovó la fila. Si la persona ya tiene cuenta, Supabase no
 * reinvita y no hace falta: la invitación pendiente se acepta la próxima vez
 * que entre.
 */
export async function sendInvitationMail(params: {
	admin: SupabaseClient;
	email: string;
	origin: string;
	next?: string;
}): Promise<InvitationMailOutcome> {
	const redirectTo = params.next
		? `${params.origin}/auth/callback?next=${encodeURIComponent(params.next)}`
		: `${params.origin}/auth/callback`;

	const { error } = await params.admin.auth.admin.inviteUserByEmail(
		params.email,
		{ redirectTo },
	);
	if (!error) return "ok";

	if (error.code === "email_exists" || error.code === "user_already_exists") {
		console.warn("inviteUserByEmail:", error.message);
		return "ya_existe";
	}

	// Fallo real (rate limit, SMTP caído): la fila de invitations queda pendiente.
	console.error("inviteUserByEmail:", error.message);
	return "mail_fallo";
}
```

Y en `inviteToTenant`, reemplazar todo desde `const redirectTo = params.next` hasta el `return { kind: "mail_fallo" };` final por:

```ts
	const outcome = await sendInvitationMail({
		admin: params.admin,
		email,
		origin: params.origin,
		next: params.next,
	});
	return { kind: outcome };
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/invitations tests/plataforma && npm run typecheck`
Expected: PASS. Los tests existentes de `inviteToTenant`, de la ruta y del alta de empresas no cambian: el comportamiento es el mismo.

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/invitations/invite.ts tests/invitations/invite.test.ts
git add lib/invitations/invite.ts tests/invitations/invite.test.ts
git commit -m "refactor: el envío del mail de invitación sale a su propia función"
```

---

### Task 3: Server actions de usuarios

**Files:**
- Modify: `app/[tenant]/settings/usuarios/actions.ts`
- Test: `tests/settings/usuarios-actions.test.ts` (modifica), `tests/settings/usuarios-admin-actions.test.ts` (nuevo)

**Interfaces:**
- Consumes: `actionAllowsLogin` (`@/lib/tenants/login-check-server`), `sendInvitationMail` (Tarea 2), RPC `block_member` y `unblock_member` (Tarea 1), `originFrom` (`@/lib/tenants/origin`), `createAdminClient`.
- Produces, todas con `Promise<ActionResult>` donde `type ActionResult = { ok: true; message?: string } | { ok: false; message: string }`:
  - `revokeMembership(membershipId: string, slug: string)`
  - `revokeInvitation(invitationId: string, slug: string)`
  - `changeMemberRole(membershipId: string, role: string, slug: string)`
  - `blockMember(membershipId: string, slug: string)`
  - `unblockMember(tenantId: string, userId: string, slug: string)`
  - `resendInvitation(invitationId: string, slug: string)`

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/settings/usuarios-actions.test.ts` (el de `revokeMembership` y `revokeInvitation`):

1. Sumar a `state` (dentro del `vi.hoisted`) `writeError: null as { code?: string; message: string } | null,` y hacer que `delete().eq()` y `update().eq()` del doble devuelvan `{ error: state.writeError }`. Resetearlo en el `beforeEach`.
2. Agregar después del `describe.each`:

```ts
describe("resultado de las bajas", () => {
	it("cuando sale bien devuelven ok", async () => {
		expect(await revokeMembership(ROW_ID, "acme")).toEqual({ ok: true });
		expect(await revokeInvitation(ROW_ID, "acme")).toEqual({ ok: true });
	});

	it("sacar al único administrador explica por qué no se pudo", async () => {
		state.writeError = { code: "23514", message: "check" };

		expect(await revokeMembership(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "La empresa no puede quedar sin administrador.",
		});
	});

	it("sin permiso, sin fila o con el método no permitido dicen que no hay permiso", async () => {
		gate.allows = false;
		expect(await revokeMembership(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});

		gate.allows = true;
		state.row = null;
		expect(await revokeInvitation(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});
	});

	it("otro error de la base no se filtra al mensaje", async () => {
		state.writeError = { code: "XX000", message: "detalle interno" };
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await revokeMembership(ROW_ID, "acme");

		expect(result).toEqual({
			ok: false,
			message: "No se pudo completar. Probá de nuevo.",
		});
		error.mockRestore();
	});
});
```

Crear `tests/settings/usuarios-admin-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ROW_ID = "33333333-3333-4333-8333-333333333333";

type Reply = { data: unknown; error: { code?: string; message: string } | null };
type Call = {
	table: string;
	op: "read" | "update";
	values?: Record<string, unknown>;
	filters: [string, unknown][];
};

const db = vi.hoisted(() => ({
	user: { id: "u1" } as { id: string } | null,
	/** Qué devuelve la lectura de cada tabla. */
	read: {} as Record<string, { data: unknown; error: unknown }>,
	update: { data: [{ id: "x" }], error: null } as {
		data: unknown;
		error: { code?: string; message: string } | null;
	},
	rpc: { data: null, error: null } as {
		data: unknown;
		error: { code?: string; message: string } | null;
	},
	calls: [] as unknown[],
	rpcCalls: [] as { fn: string; args: unknown }[],
	revalidated: [] as string[],
}));

const gate = vi.hoisted(() => ({
	allows: true,
	calls: [] as { userId: string; tenantId: string }[],
}));

const mail = vi.hoisted(() => ({
	outcome: "ok" as "ok" | "ya_existe" | "mail_fallo",
	sent: [] as { email: string; origin: string; next?: string }[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		db.revalidated.push(path);
	},
}));
vi.mock("next/headers", () => ({
	headers: async () => new Headers({ origin: "https://app.test" }),
}));
vi.mock("@/lib/tenants/login-check-server", () => ({
	actionAllowsLogin: async (_s: unknown, userId: string, tenantId: string) => {
		gate.calls.push({ userId, tenantId });
		return gate.allows;
	},
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ admin: true }),
}));
vi.mock("@/lib/invitations/invite", () => ({
	sendInvitationMail: async (params: {
		email: string;
		origin: string;
		next?: string;
	}) => {
		mail.sent.push({
			email: params.email,
			origin: params.origin,
			next: params.next,
		});
		return mail.outcome;
	},
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: { getUser: async () => ({ data: { user: db.user } }) },
		rpc: async (fn: string, args: unknown) => {
			db.rpcCalls.push({ fn, args });
			return db.rpc;
		},
		from(table: string) {
			const call: Call = { table, op: "read", filters: [] };
			const chain = {
				// select() abre una lectura, o cierra un update().eq().select().
				select: () => {
					if (call.op === "update") {
						db.calls.push(call);
						return Promise.resolve(db.update as Reply);
					}
					return chain;
				},
				update: (values: Record<string, unknown>) => {
					call.op = "update";
					call.values = values;
					return chain;
				},
				eq: (column: string, value: unknown) => {
					call.filters.push([column, value]);
					return chain;
				},
				maybeSingle: async () => {
					db.calls.push(call);
					return db.read[table] ?? { data: null, error: null };
				},
			};
			return chain;
		},
	}),
}));

const { blockMember, changeMemberRole, resendInvitation, unblockMember } =
	await import("@/app/[tenant]/settings/usuarios/actions");

const SIN_PERMISO = { ok: false, message: "No tenés permiso." };
const updates = () =>
	(db.calls as Call[]).filter((call) => call.op === "update");

beforeEach(() => {
	db.user = { id: "u1" };
	db.read = {};
	db.update = { data: [{ id: "x" }], error: null };
	db.rpc = { data: null, error: null };
	db.calls = [];
	db.rpcCalls = [];
	db.revalidated = [];
	gate.allows = true;
	gate.calls = [];
	mail.outcome = "ok";
	mail.sent = [];
});

describe("changeMemberRole", () => {
	beforeEach(() => {
		db.read.memberships = {
			data: { tenant_id: TENANT_ID, user_id: USER_ID, role: "tenant_member" },
			error: null,
		};
	});

	it("cambia el rol de la fila y revalida", async () => {
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual({
			ok: true,
		});
		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(updates()).toEqual([
			{
				table: "memberships",
				op: "update",
				values: { role: "tenant_admin" },
				filters: [["id", ROW_ID]],
			},
		]);
		expect(db.revalidated).toEqual(["/acme/settings/usuarios"]);
	});

	it.each(["platform_admin", "owner", ""])(
		"rechaza el rol %s sin tocar la base",
		async (role) => {
			expect(await changeMemberRole(ROW_ID, role, "acme")).toEqual(SIN_PERMISO);
			expect(db.calls).toHaveLength(0);
		},
	);

	it("no cambia el rol de un administrador de la plataforma", async () => {
		db.read.memberships = {
			data: { tenant_id: TENANT_ID, user_id: USER_ID, role: "platform_admin" },
			error: null,
		};

		expect(await changeMemberRole(ROW_ID, "tenant_member", "acme")).toEqual({
			ok: false,
			message: "No se puede cambiar el rol de un administrador de la plataforma.",
		});
		expect(updates()).toHaveLength(0);
	});

	it("el último administrador no se degrada", async () => {
		db.update = { data: null, error: { code: "23514", message: "check" } };

		expect(await changeMemberRole(ROW_ID, "tenant_member", "acme")).toEqual({
			ok: false,
			message: "La empresa no puede quedar sin administrador.",
		});
	});

	it("si la RLS no deja escribir (cero filas) no hay permiso", async () => {
		db.update = { data: [], error: null };
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual(
			SIN_PERMISO,
		);
	});

	it("sin sesión, sin fila o con el método no permitido no escribe", async () => {
		gate.allows = false;
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual(
			SIN_PERMISO,
		);

		gate.allows = true;
		db.read.memberships = { data: null, error: null };
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual(
			SIN_PERMISO,
		);

		db.user = null;
		expect(await changeMemberRole(ROW_ID, "tenant_admin", "acme")).toEqual(
			SIN_PERMISO,
		);
		expect(updates()).toHaveLength(0);
	});
});

describe("blockMember", () => {
	beforeEach(() => {
		db.read.memberships = {
			data: { tenant_id: TENANT_ID, user_id: USER_ID, role: "tenant_member" },
			error: null,
		};
	});

	it("bloquea a la persona de la fila, en la empresa de la fila", async () => {
		expect(await blockMember(ROW_ID, "acme")).toEqual({ ok: true });
		expect(db.rpcCalls).toEqual([
			{ fn: "block_member", args: { p_tenant: TENANT_ID, p_user: USER_ID } },
		]);
		expect(db.revalidated).toEqual(["/acme/settings/usuarios"]);
	});

	it("nadie se bloquea a sí mismo", async () => {
		db.read.memberships = {
			data: { tenant_id: TENANT_ID, user_id: "u1", role: "tenant_admin" },
			error: null,
		};

		expect(await blockMember(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No podés bloquearte a vos.",
		});
		expect(db.rpcCalls).toHaveLength(0);
	});

	it.each([
		["42501", "No tenés permiso."],
		["23514", "La empresa no puede quedar sin administrador."],
	])("traduce el error %s de la base", async (code, message) => {
		db.rpc = { data: null, error: { code, message: "x" } };
		expect(await blockMember(ROW_ID, "acme")).toEqual({ ok: false, message });
	});

	it("con el método no permitido o sin fila no llama a la base", async () => {
		gate.allows = false;
		expect(await blockMember(ROW_ID, "acme")).toEqual(SIN_PERMISO);

		gate.allows = true;
		db.read.memberships = { data: null, error: null };
		expect(await blockMember(ROW_ID, "acme")).toEqual(SIN_PERMISO);
		expect(db.rpcCalls).toHaveLength(0);
	});
});

describe("unblockMember", () => {
	beforeEach(() => {
		db.read.membership_blocks = {
			data: { tenant_id: TENANT_ID, user_id: USER_ID },
			error: null,
		};
	});

	it("desbloquea si el bloqueo se ve con la sesión", async () => {
		expect(await unblockMember(TENANT_ID, USER_ID, "acme")).toEqual({
			ok: true,
		});
		expect(gate.calls).toEqual([{ userId: "u1", tenantId: TENANT_ID }]);
		expect(db.rpcCalls).toEqual([
			{ fn: "unblock_member", args: { p_tenant: TENANT_ID, p_user: USER_ID } },
		]);
	});

	it("si el bloqueo no se ve (otra empresa, o no es administrador) no hay permiso", async () => {
		db.read.membership_blocks = { data: null, error: null };

		expect(await unblockMember(TENANT_ID, USER_ID, "acme")).toEqual(
			SIN_PERMISO,
		);
		expect(db.rpcCalls).toHaveLength(0);
	});

	it("con el método no permitido no llama a la base", async () => {
		gate.allows = false;
		expect(await unblockMember(TENANT_ID, USER_ID, "acme")).toEqual(
			SIN_PERMISO,
		);
		expect(db.rpcCalls).toHaveLength(0);
	});
});

describe("resendInvitation", () => {
	beforeEach(() => {
		db.read.invitations = {
			data: { tenant_id: TENANT_ID, email: "ana@acme.test", status: "pending" },
			error: null,
		};
		db.read.tenants = { data: { slug: "acme-real" }, error: null };
	});

	it("renueva el vencimiento a 14 días y manda el mail hacia el chat de la empresa", async () => {
		const antes = Date.now();

		expect(await resendInvitation(ROW_ID, "lo-que-mande-el-navegador")).toEqual(
			{ ok: true, message: "Invitación reenviada." },
		);

		const [update] = updates();
		expect(update.table).toBe("invitations");
		expect(update.filters).toEqual([
			["id", ROW_ID],
			["status", "pending"],
		]);
		const vence = new Date(update.values?.expires_at as string).getTime();
		const dias = (vence - antes) / 86_400_000;
		expect(dias).toBeGreaterThan(13.99);
		expect(dias).toBeLessThan(14.01);

		// El slug del link sale de la base, no del parámetro.
		expect(mail.sent).toEqual([
			{
				email: "ana@acme.test",
				origin: "https://app.test",
				next: "/acme-real/chat",
			},
		]);
	});

	it("si la persona ya tiene cuenta lo dice, y el vencimiento se renueva igual", async () => {
		mail.outcome = "ya_existe";

		expect(await resendInvitation(ROW_ID, "acme")).toEqual({
			ok: true,
			message:
				"Esa persona ya tiene cuenta. Pasale el link de ingreso de la empresa.",
		});
		expect(updates()).toHaveLength(1);
	});

	it("si el mail falla lo dice", async () => {
		mail.outcome = "mail_fallo";

		expect(await resendInvitation(ROW_ID, "acme")).toEqual({
			ok: false,
			message: "No se pudo mandar el mail. Probá de nuevo.",
		});
	});

	it("una invitación que ya no está pendiente no se reenvía", async () => {
		db.read.invitations = {
			data: { tenant_id: TENANT_ID, email: "ana@acme.test", status: "revoked" },
			error: null,
		};

		expect(await resendInvitation(ROW_ID, "acme")).toEqual(SIN_PERMISO);
		expect(updates()).toHaveLength(0);
		expect(mail.sent).toHaveLength(0);
	});

	it("si la RLS no deja renovar (cero filas) no manda el mail", async () => {
		db.update = { data: [], error: null };

		expect(await resendInvitation(ROW_ID, "acme")).toEqual(SIN_PERMISO);
		expect(mail.sent).toHaveLength(0);
	});

	it("con el método no permitido no renueva ni manda nada", async () => {
		gate.allows = false;

		expect(await resendInvitation(ROW_ID, "acme")).toEqual(SIN_PERMISO);
		expect(updates()).toHaveLength(0);
		expect(mail.sent).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/settings/usuarios-actions.test.ts tests/settings/usuarios-admin-actions.test.ts`
Expected: FAIL. Las cuatro actions nuevas no existen y las dos viejas devuelven `undefined`.

- [ ] **Step 3: Implementar**

Reemplazar `app/[tenant]/settings/usuarios/actions.ts` entero:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { sendInvitationMail } from "@/lib/invitations/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { actionAllowsLogin } from "@/lib/tenants/login-check-server";
import { originFrom } from "@/lib/tenants/origin";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

export type ActionResult =
	| { ok: true; message?: string }
	| { ok: false; message: string };

const SIN_PERMISO: ActionResult = { ok: false, message: "No tenés permiso." };
const SIN_ADMIN: ActionResult = {
	ok: false,
	message: "La empresa no puede quedar sin administrador.",
};
const FALLO: ActionResult = {
	ok: false,
	message: "No se pudo completar. Probá de nuevo.",
};

const ASSIGNABLE_ROLES = ["tenant_admin", "tenant_member"] as const;
const INVITATION_DAYS = 14;

/** Traduce un error de Postgres a un mensaje; el detalle nunca sale de acá. */
function fromDbError(error: { code?: string; message: string }): ActionResult {
	if (error.code === "23514") return SIN_ADMIN;
	if (error.code === "42501") return SIN_PERMISO;
	console.error("usuarios:", error.message);
	return FALLO;
}

/**
 * La fila que toca la acción, leída con la sesión (la RLS aplica), y el
 * chequeo del método contra la empresa de esa fila (spec etapa 20, L10 a
 * L12). `null` sin sesión, si la fila no se ve o no se pudo leer, o si la
 * empresa no permite el método: quien llama no escribe nada.
 */
async function allowedRow<Row extends { tenant_id: string }>(
	supabase: Supabase,
	read: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ userId: string; row: Row } | null> {
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	const { data, error } = await read();
	if (error || !data) return null;
	const row = data as Row;

	if (!(await actionAllowsLogin(supabase, auth.user.id, row.tenant_id))) {
		return null;
	}
	return { userId: auth.user.id, row };
}

function done(slug: string, result: ActionResult): ActionResult {
	revalidatePath(`/${slug}/settings/usuarios`);
	return result;
}

export async function revokeMembership(
	membershipId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	const allowed = await allowedRow(supabase, () =>
		supabase
			.from("memberships")
			.select("tenant_id")
			.eq("id", membershipId)
			.maybeSingle(),
	);
	if (!allowed) return done(slug, SIN_PERMISO);

	// La RLS decide: si no sos admin del tenant, no borra nada.
	const { error } = await supabase
		.from("memberships")
		.delete()
		.eq("id", membershipId);
	return done(slug, error ? fromDbError(error) : { ok: true });
}

export async function revokeInvitation(
	invitationId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	const allowed = await allowedRow(supabase, () =>
		supabase
			.from("invitations")
			.select("tenant_id")
			.eq("id", invitationId)
			.maybeSingle(),
	);
	if (!allowed) return done(slug, SIN_PERMISO);

	const { error } = await supabase
		.from("invitations")
		.update({ status: "revoked" })
		.eq("id", invitationId);
	return done(slug, error ? fromDbError(error) : { ok: true });
}

export async function changeMemberRole(
	membershipId: string,
	role: string,
	slug: string,
): Promise<ActionResult> {
	if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
		return SIN_PERMISO;
	}
	const supabase = await createServerSupabase();
	const allowed = await allowedRow<{ tenant_id: string; role: string }>(
		supabase,
		() =>
			supabase
				.from("memberships")
				.select("tenant_id, user_id, role")
				.eq("id", membershipId)
				.maybeSingle(),
	);
	if (!allowed) return SIN_PERMISO;
	if (allowed.row.role === "platform_admin") {
		return {
			ok: false,
			message: "No se puede cambiar el rol de un administrador de la plataforma.",
		};
	}

	const { data, error } = await supabase
		.from("memberships")
		.update({ role: role as (typeof ASSIGNABLE_ROLES)[number] })
		.eq("id", membershipId)
		.select("id");
	if (error) return done(slug, fromDbError(error));
	// Cero filas: la RLS no dejó escribir.
	if (!data || data.length === 0) return done(slug, SIN_PERMISO);
	return done(slug, { ok: true });
}

export async function blockMember(
	membershipId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	const allowed = await allowedRow<{ tenant_id: string; user_id: string }>(
		supabase,
		() =>
			supabase
				.from("memberships")
				.select("tenant_id, user_id, role")
				.eq("id", membershipId)
				.maybeSingle(),
	);
	if (!allowed) return SIN_PERMISO;
	if (allowed.row.user_id === allowed.userId) {
		return { ok: false, message: "No podés bloquearte a vos." };
	}

	const { error } = await supabase.rpc("block_member", {
		p_tenant: allowed.row.tenant_id,
		p_user: allowed.row.user_id,
	});
	return done(slug, error ? fromDbError(error) : { ok: true });
}

export async function unblockMember(
	tenantId: string,
	userId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	// Un bloqueo no tiene id propio. Se lee con la sesión: si no se ve, quien
	// llama no es administrador de esa empresa.
	const allowed = await allowedRow<{ tenant_id: string; user_id: string }>(
		supabase,
		() =>
			supabase
				.from("membership_blocks")
				.select("tenant_id, user_id")
				.eq("tenant_id", tenantId)
				.eq("user_id", userId)
				.maybeSingle(),
	);
	if (!allowed) return SIN_PERMISO;

	const { error } = await supabase.rpc("unblock_member", {
		p_tenant: allowed.row.tenant_id,
		p_user: allowed.row.user_id,
	});
	return done(slug, error ? fromDbError(error) : { ok: true });
}

export async function resendInvitation(
	invitationId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	const allowed = await allowedRow<{
		tenant_id: string;
		email: string;
		status: string;
	}>(supabase, () =>
		supabase
			.from("invitations")
			.select("tenant_id, email, status")
			.eq("id", invitationId)
			.maybeSingle(),
	);
	if (!allowed || allowed.row.status !== "pending") return SIN_PERMISO;

	const expiresAt = new Date(
		Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000,
	).toISOString();
	const { data: renewed, error } = await supabase
		.from("invitations")
		.update({ expires_at: expiresAt })
		.eq("id", invitationId)
		.eq("status", "pending")
		.select("id");
	if (error) return done(slug, fromDbError(error));
	if (!renewed || renewed.length === 0) return done(slug, SIN_PERMISO);

	// El link lleva al chat de la empresa de la invitación: el slug sale de la
	// base, no del parámetro que manda el navegador.
	const { data: tenant } = await supabase
		.from("tenants")
		.select("slug")
		.eq("id", allowed.row.tenant_id)
		.maybeSingle();

	const outcome = await sendInvitationMail({
		admin: createAdminClient(),
		email: allowed.row.email,
		origin: originFrom(await headers()),
		next: tenant?.slug ? `/${tenant.slug}/chat` : undefined,
	});

	if (outcome === "mail_fallo") {
		return done(slug, {
			ok: false,
			message: "No se pudo mandar el mail. Probá de nuevo.",
		});
	}
	return done(slug, {
		ok: true,
		message:
			outcome === "ya_existe"
				? "Esa persona ya tiene cuenta. Pasale el link de ingreso de la empresa."
				: "Invitación reenviada.",
	});
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run tests/settings && npm run typecheck`
Expected: PASS y typecheck limpio. En `usuarios-actions.test.ts`, los casos existentes "sin sesión", "fila no se ve" y "método no permitido" siguen pasando: las dos bajas siguen sin escribir y siguen revalidando. Si el doble de `tests/settings/usuarios-actions.test.ts` no encadena `.select("tenant_id")` igual que antes, adaptar el doble, no la action.

`page.tsx` todavía pasa estas actions a `<form action>`; como ahora devuelven un valor, `tsc` puede quejarse ahí. Si lo hace, dejar ese error anotado en el reporte: lo resuelve la Tarea 4, que reemplaza esos formularios. No tocar `page.tsx` en esta tarea salvo que el typecheck no pueda quedar limpio de otro modo; en ese caso, envolver cada uso en una función `async` que descarte el resultado y decirlo en el reporte.

- [ ] **Step 5: Commit**

```bash
npx biome check --write "app/[tenant]/settings/usuarios/actions.ts" tests/settings/usuarios-actions.test.ts tests/settings/usuarios-admin-actions.test.ts
git add "app/[tenant]/settings/usuarios/actions.ts" tests/settings/usuarios-actions.test.ts tests/settings/usuarios-admin-actions.test.ts
git commit -m "feat: actions para bloquear, cambiar el rol y reenviar invitaciones, con resultado y mensaje"
```

---

### Task 4: Pantalla de usuarios

**Files:**
- Create: `app/[tenant]/settings/usuarios/row-actions.tsx`
- Modify: `app/[tenant]/settings/usuarios/page.tsx`
- Test: `tests/settings/usuarios-row-actions.test.ts` (nuevo), `tests/settings/usuarios-page.test.ts` (nuevo)

**Interfaces:**
- Consumes: las seis actions y `ActionResult` de la Tarea 3; `ROLE_LABELS`; `loadPeople`; `resolveTenantAccess`.
- Produces: `ActionButton({ run, label, confirmText? })` y `RoleSelect({ membershipId, slug, role })`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/settings/usuarios-row-actions.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/settings/usuarios/actions", () => ({
	changeMemberRole: async () => ({ ok: true }),
}));

const { ActionButton, RoleSelect } = await import(
	"@/app/[tenant]/settings/usuarios/row-actions"
);

describe("ActionButton", () => {
	it("dibuja un botón con su rótulo y sin mensaje al arrancar", () => {
		const html = renderToStaticMarkup(
			createElement(ActionButton, {
				run: async () => ({ ok: true as const }),
				label: "Bloquear",
			}),
		);

		expect(html).toContain("Bloquear");
		expect(html).toContain('type="button"');
		expect(html).not.toContain('role="status"');
		expect(html).not.toContain('role="alert"');
	});
});

describe("RoleSelect", () => {
	const render = (role: "tenant_admin" | "tenant_member") =>
		renderToStaticMarkup(
			createElement(RoleSelect, { membershipId: "m1", slug: "acme", role }),
		);

	it("ofrece Usuario y Administrador, nunca administrador de la plataforma", () => {
		const html = render("tenant_member");

		expect(html).toContain(">Usuario<");
		expect(html).toContain(">Administrador<");
		expect(html).not.toContain("Administrador de la plataforma");
	});

	it("marca el rol actual", () => {
		expect(render("tenant_admin")).toMatch(
			/<option[^>]*value="tenant_admin"[^>]*selected/,
		);
	});

	it("tiene nombre accesible", () => {
		expect(render("tenant_member")).toContain('aria-label="Rol"');
	});
});
```

Crear `tests/settings/usuarios-page.test.ts`:

```ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const state: {
	tenant: unknown;
	memberships: unknown[];
	invitations: unknown[];
	blocks: unknown[];
} = { tenant: null, memberships: [], invitations: [], blocks: [] };

// Consulta encadenable que resuelve al hacer await, como la de supabase-js.
function query(result: () => Result) {
	const q = {
		select: () => q,
		eq: () => q,
		order: () => q,
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) =>
			Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.tenant,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) =>
			query(() => ({
				data:
					table === "memberships"
						? state.memberships
						: table === "invitations"
							? state.invitations
							: state.blocks,
				error: null,
			})),
	}),
}));
vi.mock("@/lib/tenants/people", () => ({
	loadPeople: async (ids: string[]) =>
		new Map(ids.map((id) => [id, { name: `Nombre ${id}`, email: `${id}@a.test` }])),
}));
vi.mock("@/app/[tenant]/settings/usuarios/actions", () => ({
	revokeMembership: async () => ({ ok: true }),
	revokeInvitation: async () => ({ ok: true }),
	changeMemberRole: async () => ({ ok: true }),
	blockMember: async () => ({ ok: true }),
	unblockMember: async () => ({ ok: true }),
	resendInvitation: async () => ({ ok: true }),
}));
vi.mock("@/app/[tenant]/settings/usuarios/invite-form", () => ({
	InviteForm: () => null,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	useRouter: () => ({ refresh: () => {} }),
}));

const { default: UsuariosPage } = await import(
	"@/app/[tenant]/settings/usuarios/page"
);

const tenant = (role: string, userId = "yo") => ({
	id: "t1",
	slug: "acme",
	displayName: "Acme",
	role,
	userId,
	defaultModel: "m",
	allowedModels: ["m"],
	brand: {},
});

const render = async () =>
	renderToStaticMarkup(
		await UsuariosPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

/** El <li> de la persona con ese correo. */
const rowOf = (html: string, email: string) =>
	html.split("<li").find((li) => li.includes(email)) ?? "";

describe("página de usuarios", () => {
	beforeEach(() => {
		state.tenant = tenant("tenant_admin");
		state.memberships = [
			{ id: "m-yo", role: "tenant_admin", user_id: "yo" },
			{ id: "m-ana", role: "tenant_member", user_id: "ana" },
			{ id: "m-plat", role: "platform_admin", user_id: "plat" },
		];
		state.invitations = [
			{ id: "i1", email: "nueva@a.test", role: "tenant_member", expires_at: "2026-11-01T00:00:00Z" },
		];
		state.blocks = [];
	});

	it("un miembro común recibe 404", async () => {
		state.tenant = tenant("tenant_member");
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("un miembro tiene selector de rol, Sacar y Bloquear", async () => {
		const row = rowOf(await render(), "ana@a.test");

		expect(row).toContain("<select");
		expect(row).toContain("Sacar");
		expect(row).toContain("Bloquear");
	});

	it("la propia fila no ofrece Bloquear", async () => {
		const row = rowOf(await render(), "yo@a.test");

		expect(row).toContain("<select");
		expect(row).not.toContain("Bloquear");
	});

	it("un administrador de la plataforma muestra el rol como texto, sin selector ni Bloquear", async () => {
		const row = rowOf(await render(), "plat@a.test");

		expect(row).toContain("Administrador de la plataforma");
		expect(row).not.toContain("<select");
		expect(row).not.toContain("Bloquear");
	});

	it("una invitación pendiente ofrece Reenviar y Revocar", async () => {
		const row = rowOf(await render(), "nueva@a.test");

		expect(row).toContain("Reenviar");
		expect(row).toContain("Revocar");
	});

	it("sin bloqueados no aparece la sección", async () => {
		expect(await render()).not.toContain("Bloqueados");
	});

	it("con bloqueados los lista con Desbloquear", async () => {
		state.blocks = [
			{ tenant_id: "t1", user_id: "beto", created_at: "2026-10-09T12:00:00Z" },
		];
		const html = await render();

		expect(html).toContain("Bloqueados");
		const row = rowOf(html, "beto@a.test");
		expect(row).toContain("Nombre beto");
		expect(row).toContain("Desbloquear");
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/settings/usuarios-row-actions.test.ts tests/settings/usuarios-page.test.ts`
Expected: FAIL. `row-actions` no existe y la página no tiene selector, Bloquear, Reenviar ni Bloqueados.

- [ ] **Step 3: Implementar los componentes cliente**

```tsx
// app/[tenant]/settings/usuarios/row-actions.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import { type ActionResult, changeMemberRole } from "./actions";

type Feedback = { ok: boolean; text: string } | null;

function Message({ feedback }: { feedback: Feedback }) {
	if (!feedback) return null;
	return (
		<span
			className={
				feedback.ok
					? "text-muted-foreground text-xs"
					: "text-destructive text-xs"
			}
			role={feedback.ok ? "status" : "alert"}
		>
			{feedback.text}
		</span>
	);
}

/**
 * Botón que corre una server action y muestra lo que respondió. La action
 * llega ya ligada a su fila (`.bind` en la página): acá no se arma ningún id.
 */
export function ActionButton({
	run,
	label,
	confirmText,
}: {
	run: () => Promise<ActionResult>;
	label: string;
	/** Si viene, se pide confirmación antes de correr la acción. */
	confirmText?: string;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);

	function onClick() {
		if (confirmText && !window.confirm(confirmText)) return;
		setFeedback(null);
		startTransition(async () => {
			try {
				const result = await run();
				if (!result.ok || result.message) {
					setFeedback({ ok: result.ok, text: result.message ?? "" });
				}
				if (result.ok) router.refresh();
			} catch {
				setFeedback({ ok: false, text: "No se pudo completar. Probá de nuevo." });
			}
		});
	}

	return (
		<span className="inline-flex items-center gap-2">
			<Message feedback={feedback} />
			<Button
				disabled={pending}
				onClick={onClick}
				size="sm"
				type="button"
				variant="outline"
			>
				{label}
			</Button>
		</span>
	);
}

export function RoleSelect({
	membershipId,
	slug,
	role,
}: {
	membershipId: string;
	slug: string;
	role: "tenant_admin" | "tenant_member";
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);

	function onChange(next: string) {
		setFeedback(null);
		startTransition(async () => {
			try {
				const result = await changeMemberRole(membershipId, next, slug);
				if (!result.ok) setFeedback({ ok: false, text: result.message });
				// Con error también se refresca: el selector vuelve al rol real.
				router.refresh();
			} catch {
				setFeedback({ ok: false, text: "No se pudo completar. Probá de nuevo." });
			}
		});
	}

	return (
		<span className="inline-flex items-center gap-2">
			<select
				aria-label="Rol"
				className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
				defaultValue={role}
				disabled={pending}
				key={role}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="tenant_member">{ROLE_LABELS.tenant_member}</option>
				<option value="tenant_admin">{ROLE_LABELS.tenant_admin}</option>
			</select>
			<Message feedback={feedback} />
		</span>
	);
}
```

- [ ] **Step 4: Implementar la página**

Reemplazar `app/[tenant]/settings/usuarios/page.tsx` entero:

```tsx
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadPeople } from "@/lib/tenants/people";
import { resolveTenantAccess, type TenantRole } from "@/lib/tenants/resolve";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import {
	blockMember,
	resendInvitation,
	revokeInvitation,
	revokeMembership,
	unblockMember,
} from "./actions";
import { InviteForm } from "./invite-form";
import { ActionButton, RoleSelect } from "./row-actions";

const fecha = (value: string) => new Date(value).toLocaleDateString("es-AR");

export default async function UsuariosPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	if (tenant.role === "tenant_member") notFound();

	const supabase = await createServerSupabase();

	const [{ data: memberships }, { data: invitations }, { data: blocks }] =
		await Promise.all([
			supabase
				.from("memberships")
				.select("id, role, user_id")
				.eq("tenant_id", tenant.id),
			supabase
				.from("invitations")
				.select("id, email, role, expires_at")
				.eq("tenant_id", tenant.id)
				.eq("status", "pending"),
			supabase
				.from("membership_blocks")
				.select("tenant_id, user_id, created_at")
				.eq("tenant_id", tenant.id)
				.order("created_at", { ascending: false }),
		]);

	const people = await loadPeople([
		...(memberships ?? []).map(({ user_id }) => user_id),
		...(blocks ?? []).map(({ user_id }) => user_id),
	]);

	return (
		<div className="max-w-3xl space-y-10">
			<section>
				<h1 className="mb-4 text-3xl leading-tight">
					Usuarios de {tenant.displayName}
				</h1>
				<ul className="divide-y rounded-lg border bg-card empty:hidden">
					{(memberships ?? []).map((membership) => {
						const role = membership.role as TenantRole;
						const isSelf = membership.user_id === tenant.userId;
						return (
							<li
								key={membership.id}
								className="flex flex-wrap items-center gap-3 px-4 py-3"
							>
								<div className="min-w-0">
									<div>
										{people.get(membership.user_id)?.name || "Sin nombre"}
									</div>
									<div className="truncate text-muted-foreground text-sm">
										{people.get(membership.user_id)?.email}
									</div>
								</div>
								{role === "platform_admin" ? (
									<span className="text-muted-foreground text-sm">
										{ROLE_LABELS[role]}
									</span>
								) : (
									<RoleSelect
										membershipId={membership.id}
										slug={slug}
										role={role}
									/>
								)}
								<span className="ml-auto inline-flex flex-wrap items-center gap-2">
									<ActionButton
										label="Sacar"
										run={revokeMembership.bind(null, membership.id, slug)}
									/>
									{role === "platform_admin" || isSelf ? null : (
										<ActionButton
											confirmText="Esta persona no va a poder volver a entrar a la empresa, ni siquiera por el dominio, hasta que la desbloquees o la invites de nuevo."
											label="Bloquear"
											run={blockMember.bind(null, membership.id, slug)}
										/>
									)}
								</span>
							</li>
						);
					})}
				</ul>
			</section>

			{(blocks ?? []).length > 0 ? (
				<section>
					<h2 className="mb-3 text-lg">Bloqueados</h2>
					<ul className="divide-y rounded-lg border bg-card">
						{(blocks ?? []).map((block) => (
							<li
								key={block.user_id}
								className="flex flex-wrap items-center gap-3 px-4 py-3"
							>
								<div className="min-w-0">
									<div>{people.get(block.user_id)?.name || "Sin nombre"}</div>
									<div className="truncate text-muted-foreground text-sm">
										{people.get(block.user_id)?.email}
									</div>
								</div>
								<span className="text-muted-foreground text-sm">
									Desde el {fecha(block.created_at)}
								</span>
								<span className="ml-auto">
									<ActionButton
										label="Desbloquear"
										run={unblockMember.bind(
											null,
											block.tenant_id,
											block.user_id,
											slug,
										)}
									/>
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<section>
				<h2 className="mb-3 text-lg">Invitaciones pendientes</h2>
				<ul className="divide-y rounded-lg border bg-card empty:hidden">
					{(invitations ?? []).map((invitation) => (
						<li
							key={invitation.id}
							className="flex flex-wrap items-center gap-3 px-4 py-3"
						>
							<span>{invitation.email}</span>
							<span className="text-muted-foreground text-sm">
								{ROLE_LABELS[invitation.role as TenantRole]}
							</span>
							<span className="ml-auto inline-flex flex-wrap items-center gap-2">
								<ActionButton
									label="Reenviar"
									run={resendInvitation.bind(null, invitation.id, slug)}
								/>
								<ActionButton
									label="Revocar"
									run={revokeInvitation.bind(null, invitation.id, slug)}
								/>
							</span>
						</li>
					))}
				</ul>
			</section>

			<InviteForm tenantId={tenant.id} />
		</div>
	);
}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run tests/settings && npm run typecheck && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: PASS, typecheck limpio y suite completa en verde. Si el test de la fila falla porque `rowOf` corta el `<li>` en otro lugar del que el HTML real produce, ajustar el helper del test para que aísle la fila, sin relajar lo que cada test afirma sobre ella.

- [ ] **Step 6: Commit**

```bash
npx biome check --write "app/[tenant]/settings/usuarios/row-actions.tsx" "app/[tenant]/settings/usuarios/page.tsx" tests/settings/usuarios-row-actions.test.ts tests/settings/usuarios-page.test.ts
git add "app/[tenant]/settings/usuarios/row-actions.tsx" "app/[tenant]/settings/usuarios/page.tsx" tests/settings/usuarios-row-actions.test.ts tests/settings/usuarios-page.test.ts
git commit -m "feat: la pantalla de usuarios cambia roles, bloquea, desbloquea y reenvía invitaciones"
```

---

### Task 5: Verificación en navegador, docs y cierre

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-etapa-20-login-design.md` (sección 7), `docs/01-roadmap-etapas.md` (Etapa 20)

- [ ] **Step 1: Suite completa, pgTAP, typecheck y build**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npm run db:test 2>&1 | tail -4; npm run typecheck; npm run build 2>&1 | tail -5`
Expected: todo en verde.

- [ ] **Step 2: Verificar en el navegador contra la base local**

1. `npm run db:reset`.
2. Levantar el dev server con variables **explícitas** a la base local, no con `.env.local` (trae claves de Vercel): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` de `npx supabase status -o env`, `PUBLIC_APP_URL=http://localhost:3000` y `PLATFORM_OWNER_TENANT_SLUG=innovas-seed`.
3. Los usuarios del seed no tienen `created_at` y GoTrue no les manda link. Por SQL: dejar `demo` abierta (`self_signup_by_domain = true`, dominio `demo.test`). Entrar con dos correos nuevos `@demo.test` por `/login/demo`, con el link de Mailpit (`http://127.0.0.1:54324`): quedan como miembros. Por SQL, subir a uno a `tenant_admin`. `demo` ya tiene una administradora del seed, así que quedan dos.
4. Como ese administrador, en `/demo/settings/usuarios`:
   - Cambiar el rol del otro miembro a Administrador y recargar: se mantiene. Volverlo a Usuario.
   - **Bloquear** al miembro: desaparece de la lista y aparece en "Bloqueados".
   - En otra ventana, con la sesión del bloqueado, recargar `/demo/chat`: 404. Pedir un link nuevo y abrirlo: no vuelve a entrar a `demo` y cae en `/sin-acceso`.
   - **Desbloquear**: sale de "Bloqueados". El bloqueado pide otro link y vuelve a entrar.
   - Invitar a un correo nuevo, apretar **Reenviar**: aparece "Invitación reenviada." y hay un segundo mail en Mailpit. Reenviar la invitación de alguien que ya tiene cuenta: aparece el aviso de que ya tiene cuenta.
   - Por SQL, dejar a ese administrador como único administrador de `demo` e intentar cambiarse a Usuario y apretar "Sacar" en su propia fila: aparece "La empresa no puede quedar sin administrador." y no cambia nada.
5. A 375 px: la fila con selector y dos botones no desborda la página.
6. Restaurar `demo` (`self_signup_by_domain = false`) y apagar el dev server.

Si algún paso no se puede correr en el entorno, **decirlo en el resumen** y no darlo por verificado.

- [ ] **Step 3: Alinear la spec con lo implementado**

En `docs/superpowers/specs/2026-10-09-etapa-20-login-design.md`, sección 7:

1. La línea de `blockMember(tenantId, userId, slug)` y `unblockMember(...)` pasa a: "`blockMember(membershipId, slug)`: lee la fila con la sesión y bloquea a esa persona en esa empresa; la propia fila responde "No podés bloquearte a vos." `unblockMember(tenantId, userId, slug)`: un bloqueo no tiene id propio; se lee con la sesión antes de llamar al `rpc`. `42501`: "No tenés permiso". `23514`: el mismo mensaje del administrador."
2. Agregar al final de la lista: "Todas aplican el chequeo del método de la sesión (`actionAllowsLogin`) contra la empresa de la fila antes de escribir (L10)."
3. En la sección 6, punto 5, agregar: "y deja el evento `membership.unblocked`."

- [ ] **Step 4: Actualizar el roadmap**

En `docs/01-roadmap-etapas.md`, sección "## Etapa 20":

1. En la línea `**Spec/Plan:**`, reemplazar "20.2: plan a escribir." por "20.2: `docs/superpowers/plans/2026-10-09-etapa-20-2-usuarios.md`."
2. Reemplazar la casilla de la 20.2 por:

```
- [x] **20.2 · Operación de usuarios.** Bloqueo por persona (`membership_blocks`, `block_member`, `unblock_member`), el dominio abierto no vuelve a unir a un bloqueado y una invitación levanta el bloqueo; una empresa no puede quedar sin administrador (trigger `memberships_keep_one_admin`); cambio de rol y reenvío de invitación desde `/settings/usuarios`. **Antes de desplegar:** aplicar la migración `20261014120000_member_blocks` a producción primero (corriendo `npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después desplegar el código; al revés, la pantalla de usuarios falla al leer los bloqueos. Borrar de Auth a la única administradora de una empresa ahora falla hasta nombrar a otra.
```

Si algún paso del navegador quedó sin correr, agregarlo al final de esa casilla con "Sin verificar: ...".

3. Cambiar el encabezado de la etapa de `` `[ ]` `` a `` `[x]` `` solo si la 20.1 ya está mergeada y verificada en producción; si no, dejarlo como está.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-09-etapa-20-login-design.md docs/01-roadmap-etapas.md
git commit -m "docs: cierre de la entrega 20.2, operación de usuarios"
```

- [ ] **Step 6: Entregar**

Usar `superpowers:verification-before-completion`. En el resumen final: que la migración va antes que el código, que borrar de Auth a la única administradora de una empresa ahora falla, y qué pasos de navegador no se pudieron correr. No hacer push ni abrir el PR sin que lo pida la persona.
