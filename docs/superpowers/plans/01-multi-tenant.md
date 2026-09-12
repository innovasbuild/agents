# Etapa 1 · Esqueleto multi-tenant · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dejar la plataforma con aislamiento real entre clientes en la base, alta solo por invitación, hilos de conversación propios por usuario, y modelo de agente configurable por tenant sin redeploy.

**Architecture:** Postgres con RLS por `tenant_id` resuelta con funciones `security definer` (rompen la recursión de `memberships`), el tenant activo viajando en la URL `/[tenant]/...` y validado en el server, y el canal de eve decidiendo tenant y ownership de sesión en su `AuthFn`, que es el único punto capaz de devolver 401 (los hooks de eve son observe-only).

**Tech Stack:** Next.js 16 (App Router), eve 0.54.2, Supabase (Postgres 17, Auth, Storage), `@supabase/ssr`, Tailwind v4 + shadcn/ui, Vitest, pgTAP, Biome.

**Spec:** `docs/superpowers/specs/01-multi-tenant.md`

## Global Constraints

- Node 24 obligatorio (`engine-strict=true`). eve pinneado en `0.54.2` exacto, sin caret.
- Antes de escribir código de eve, leer `node_modules/eve/docs/README.md` y la guía del slot que se toca.
- **Los imports relativos son obligatorios en `agents/` y en todo archivo de `lib/` que se importe desde ahí** (`../supabase/admin`), nunca el alias `@/`: el compilador de eve no resuelve los paths de `tsconfig`, y la restricción es transitiva. Referencia existente: `lib/gmail/send.ts` importa `../supabase/admin` justamente por esto. En `app/`, en `lib/` de uso exclusivo del front y en `tests/` sí se usa `@/`.
- Toda tabla lleva `tenant_id` y RLS habilitada. Toda función en política va envuelta en `(select ...)`.
- `events` es append-only: nunca `UPDATE` ni `DELETE`.
- Nada específico de un tenant en el código. Va a la base o a `tenants/<slug>/`.
- Español rioplatense en UI, instrucciones y mensajes de commit. Código e identificadores en inglés.
- Prefijo de commit: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`. Cada sesión agrega su propia línea de atribución `Co-Authored-By` según el modelo con el que corre.
- Comandos: `npm run dev` · `npm run typecheck` · `npm test` · `npm run lint:fix`.
- Después de cada task: `npm run typecheck` y `npm run lint:fix` en verde antes de commitear.
- El modelo nunca ve credenciales. Ninguna tool recibe secretos por `inputSchema`.

---

# Entrega 1 · Base de datos

Se valida sola, sin tocar la app. Docker Desktop tiene que estar abierto (`supabase start` lo necesita).

### Task 1: Entorno local de Supabase y pgTAP

**Files:**
- Create: `supabase/tests/00_smoke.test.sql`
- Modify: `package.json` (scripts)
- Modify: `.gitignore` (si hiciera falta para artefactos locales)

**Interfaces:**
- Consumes: nada.
- Produces: los scripts `npm run db:start`, `npm run db:reset`, `npm run db:test`, `npm run db:types`, y el patrón de archivo pgTAP que usan todas las tasks de esta entrega.

- [ ] **Step 1: Verificar que Docker está corriendo**

Run: `docker info > /dev/null && echo OK`
Expected: `OK`. Si falla, abrir Docker Desktop y reintentar. Sin Docker no hay base local ni tests de RLS.

- [ ] **Step 2: Levantar Supabase local**

Run: `npx supabase start`
Expected: imprime `API URL: http://127.0.0.1:54321`, `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres` y las keys locales. La primera vez baja imágenes y tarda varios minutos.

- [ ] **Step 3: Escribir el test de humo de pgTAP**

`supabase/tests/00_smoke.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select has_table('public', 'google_tokens', 'google_tokens existe (migración de la Etapa 0)');

select * from finish();
rollback;
```

La extensión se crea adentro de la transacción y se va con el `rollback`: pgTAP nunca queda instalada en la base real.

- [ ] **Step 4: Agregar los scripts de base a `package.json`**

En `"scripts"`, después de `"lint:fix"`:

```json
"db:start": "supabase start",
"db:stop": "supabase stop",
"db:reset": "supabase db reset",
"db:test": "supabase test db",
"db:types": "supabase gen types typescript --linked > lib/supabase/database.types.ts"
```

**Nota que se vuelve relevante en la Task 6:** `db:test` tal como queda acá corre pgTAP contra lo que ya esté en la base — hoy eso es correcto porque no existe `supabase/seed.sql` todavía. Cuando la Task 6 agregue un seed, `db:test` deja de ser correcto sin ajustar (ver esa task).

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm run db:test`
Expected: `00_smoke.test.sql .. ok`, `All tests successful.`

- [ ] **Step 6: Commit**

```bash
git add package.json supabase/tests/00_smoke.test.sql
git commit -m "test: entorno local de supabase con pgtap"
```

---

### Task 2: Tenants, memberships y los helpers de RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_tenants_memberships.sql`
- Create: `supabase/tests/01_tenants_memberships.test.sql`

**Interfaces:**
- Consumes: el entorno de la Task 1.
- Produces: enums `public.tenant_role`, `public.run_status`, `public.run_trigger`, `public.invitation_status`; tablas `public.tenants` y `public.memberships`; funciones `public.is_platform_admin()`, `public.is_member_of(uuid)`, `public.has_tenant_role(uuid, public.tenant_role[])`. Todas las tasks siguientes usan esos tres helpers en sus políticas.

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/tests/01_tenants_memberships.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- Fixtures: dos tenants, tres usuarios.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'admin@innov.as', now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'beto@fabrica.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'innovas', 'INNOV.AS'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'platform_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'tenant_member');

-- Ana (tenant_admin de lagomarcino) solo ve su tenant.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.tenants),
  1,
  'ana ve un solo tenant'
);
select is(
  (select slug from public.tenants),
  'lagomarcino',
  'y es el suyo'
);
select is(
  (select count(*)::int from public.tenants where slug = 'fabrica'),
  0,
  'consultar el tenant de otro devuelve cero filas, no un error'
);

-- Ana no puede coronarse platform_admin.
select throws_ok(
  $$update public.memberships set role = 'platform_admin'
     where user_id = '22222222-2222-2222-2222-222222222222'$$,
  '42501',
  null,
  'un tenant_admin no puede ascenderse a platform_admin'
);

-- Ana sí puede sumar un tenant_member a su tenant.
select lives_ok(
  $$insert into public.memberships (tenant_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '33333333-3333-3333-3333-333333333333', 'tenant_member')$$,
  'un tenant_admin puede sumar miembros a su tenant'
);

-- El platform_admin ve todo.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.tenants),
  3,
  'el platform_admin ve los tres tenants'
);

-- Sin sesión no se ve nada.
reset role;
set local role anon;
set local "request.jwt.claims" to '';

select is(
  (select count(*)::int from public.tenants),
  0,
  'anon no ve tenants'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run db:test`
Expected: FAIL con `relation "public.tenants" does not exist`.

- [ ] **Step 3: Escribir la migración**

Run: `npx supabase migration new tenants_memberships`

Contenido del archivo generado:

```sql
create type public.tenant_role as enum ('platform_admin', 'tenant_admin', 'tenant_member');
create type public.run_status as enum ('running', 'ok', 'failed', 'cancelled');
create type public.run_trigger as enum ('chat', 'schedule', 'mcp', 'webhook');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  allowed_domains text[] not null default '{}',
  default_model text not null default 'anthropic/claude-sonnet-5',
  allowed_models text[] not null default '{anthropic/claude-sonnet-5,anthropic/claude-haiku-4-5}',
  self_signup_by_domain boolean not null default false,
  brand jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  constraint tenants_default_model_allowed check (default_model = any (allowed_models)),
  constraint tenants_brand_colors check (
    (brand->>'primary' is null or brand->>'primary' ~ '^#[0-9a-fA-F]{6}$')
    and (brand->>'secondary' is null or brand->>'secondary' ~ '^#[0-9a-fA-F]{6}$')
  )
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.tenant_role not null default 'tenant_member',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-- security definer: rompe la recursión de las políticas de memberships sobre
-- memberships, y deja la consulta fuera de la RLS del que llama.
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.role = 'platform_admin'
  );
$$;

create or replace function public.is_member_of(tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = tenant and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_tenant_role(tenant uuid, roles public.tenant_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = tenant
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

revoke execute on function
  public.is_platform_admin(),
  public.is_member_of(uuid),
  public.has_tenant_role(uuid, public.tenant_role[])
from public;

grant execute on function
  public.is_platform_admin(),
  public.is_member_of(uuid),
  public.has_tenant_role(uuid, public.tenant_role[])
to authenticated;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;

create policy tenants_select on public.tenants
  for select to authenticated
  using ((select public.is_member_of(id)) or (select public.is_platform_admin()));

create policy tenants_update on public.tenants
  for update to authenticated
  using (
    (select public.has_tenant_role(id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  )
  with check (
    (select public.has_tenant_role(id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy tenants_insert on public.tenants
  for insert to authenticated
  with check ((select public.is_platform_admin()));

create policy tenants_delete on public.tenants
  for delete to authenticated
  using ((select public.is_platform_admin()));

create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

-- El with check impide la escalada: un tenant_admin administra su tenant pero
-- no puede crear ni convertir a nadie en platform_admin.
create policy memberships_write on public.memberships
  for all to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  )
  with check (
    (
      (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
      or (select public.is_platform_admin())
    )
    and (role <> 'platform_admin' or (select public.is_platform_admin()))
  );
```

- [ ] **Step 4: Aplicar y correr los tests**

Run: `npm run db:reset && npm run db:test`
Expected: `01_tenants_memberships.test.sql .. ok`, 7 de 7.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/01_tenants_memberships.test.sql
git commit -m "feat: tenants, memberships y helpers de rls"
```

---

### Task 3: Invitaciones

**Files:**
- Create: `supabase/migrations/<timestamp>_invitations.sql`
- Create: `supabase/tests/02_invitations.test.sql`

**Interfaces:**
- Consumes: `public.tenants`, `public.memberships`, `public.is_platform_admin()`, `public.has_tenant_role(uuid, public.tenant_role[])` de la Task 2.
- Produces: tabla `public.invitations` y función `public.accept_pending_invitations() returns integer`, que llama el callback de auth en la Task 10.

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/tests/02_invitations.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'nuevo@lagomarcino.test', now()),
  ('55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'tarde@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino');

insert into public.memberships (tenant_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin');

insert into public.invitations (tenant_id, email, role, invited_by, expires_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'nuevo@lagomarcino.test', 'tenant_member',
   '22222222-2222-2222-2222-222222222222', now() + interval '7 days'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'tarde@lagomarcino.test', 'tenant_member',
   '22222222-2222-2222-2222-222222222222', now() - interval '1 day');

-- El invitado acepta.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select is(
  (select public.accept_pending_invitations()),
  1,
  'acepta una invitación pendiente'
);

select is(
  (select public.accept_pending_invitations()),
  0,
  'el segundo click no acepta nada'
);

reset role;
select is(
  (select count(*)::int from public.memberships
    where user_id = '44444444-4444-4444-4444-444444444444'),
  1,
  'y quedó una sola membership'
);

-- La invitación vencida no crea nada.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

select is(
  (select public.accept_pending_invitations()),
  0,
  'una invitación vencida no se acepta'
);

-- Un usuario cualquiera no lee invitaciones de un tenant ajeno.
select is(
  (select count(*)::int from public.invitations),
  0,
  'quien no es admin del tenant no ve sus invitaciones'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run db:test`
Expected: FAIL con `relation "public.invitations" does not exist`.

- [ ] **Step 3: Escribir la migración**

Run: `npx supabase migration new invitations`

```sql
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  role public.tenant_role not null default 'tenant_member',
  invited_by uuid references auth.users (id) on delete set null,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invitations_email_lowercase check (email = lower(email))
);

create unique index invitations_pending_unique_idx
  on public.invitations (tenant_id, email) where status = 'pending';
create index invitations_email_idx on public.invitations (email) where status = 'pending';
create index invitations_tenant_id_idx on public.invitations (tenant_id);
create index invitations_invited_by_idx on public.invitations (invited_by);
create index invitations_accepted_user_id_idx on public.invitations (accepted_user_id);

alter table public.invitations enable row level security;

create policy invitations_read on public.invitations
  for select to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy invitations_write on public.invitations
  for all to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  )
  with check (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

-- Idempotente y transaccional: dos clicks en el mail no crean dos memberships.
-- El binding es el mail verificado por Supabase, no un token propio.
create or replace function public.accept_pending_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
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
     where i.email = v_email and i.status = 'pending' and i.expires_at > now()
    returning i.id, i.tenant_id, i.role
  loop
    insert into public.memberships (tenant_id, user_id, role)
    values (r.tenant_id, v_user, r.role)
    on conflict (tenant_id, user_id) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.accept_pending_invitations() from public;
grant execute on function public.accept_pending_invitations() to authenticated;
```

El evento `invitation.accepted` se agrega en la Task 5, cuando existe la tabla `events`.

- [ ] **Step 4: Aplicar y correr los tests**

Run: `npm run db:reset && npm run db:test`
Expected: `02_invitations.test.sql .. ok`, 5 de 5.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/02_invitations.test.sql
git commit -m "feat: invitaciones con aceptacion idempotente"
```

---

### Task 4: Conversations y tenant_agents

**Files:**
- Create: `supabase/migrations/<timestamp>_conversations_tenant_agents.sql`
- Create: `supabase/tests/03_conversations.test.sql`

**Interfaces:**
- Consumes: helpers de la Task 2.
- Produces: `public.conversations` (columnas `id`, `tenant_id`, `user_id`, `agent`, `eve_session_id`, `title`, `model`, `created_at`, `last_message_at`) y `public.tenant_agents` (pk `(tenant_id, agent)`, `enabled`, `model`, `daily_quota`, `config`). El canal de eve (Task 11) consulta `conversations` por `eve_session_id`.

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/tests/03_conversations.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'colega@lagomarcino.test', now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'beto@fabrica.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', 'tenant_member'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'tenant_member');

insert into public.conversations (id, tenant_id, user_id, agent, eve_session_id)
values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '66666666-6666-6666-6666-666666666666', 'outreach', 'wrun_colega'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
   '33333333-3333-3333-3333-333333333333', 'outreach', 'wrun_beto');

-- El colega ve la suya y nada más.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

select is(
  (select count(*)::int from public.conversations),
  1,
  'un tenant_member ve solo sus conversaciones'
);

-- Ana, tenant_admin, lee las de su tenant pero no las de otro.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.conversations),
  1,
  'un tenant_admin lee las conversaciones de su tenant'
);
select is(
  (select count(*)::int from public.conversations where eve_session_id = 'wrun_beto'),
  0,
  'y ninguna de otro tenant'
);

-- Nadie crea conversaciones a nombre de otro.
select throws_ok(
  $$insert into public.conversations (tenant_id, user_id, agent)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '66666666-6666-6666-6666-666666666666', 'outreach')$$,
  '42501',
  null,
  'no se puede crear una conversación a nombre de otro usuario'
);

-- tenant_agents: el miembro lee, no escribe.
reset role;
insert into public.tenant_agents (tenant_id, agent) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'outreach');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

select throws_ok(
  $$update public.tenant_agents set enabled = false
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'un tenant_member no deshabilita agentes'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run db:test`
Expected: FAIL con `relation "public.conversations" does not exist`.

- [ ] **Step 3: Escribir la migración**

Run: `npx supabase migration new conversations_tenant_agents`

```sql
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  agent text not null,
  eve_session_id text unique,
  title text,
  model text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index conversations_thread_list_idx
  on public.conversations (tenant_id, user_id, last_message_at desc);
create index conversations_user_id_idx on public.conversations (user_id);

create table public.tenant_agents (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent text not null,
  enabled boolean not null default true,
  model text,
  daily_quota integer,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, agent)
);

alter table public.conversations enable row level security;
alter table public.tenant_agents enable row level security;

-- Leer y continuar son permisos distintos: el admin del tenant LEE las
-- conversaciones de su gente, pero continuar la sesión de eve exige ser el
-- dueño, y eso lo valida el canal (lib/agents/channel-context.ts).
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_member_of(tenant_id))
  );

create policy conversations_update on public.conversations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy conversations_delete on public.conversations
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy tenant_agents_select on public.tenant_agents
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

-- Separado por comando, no "for all": con una sola política que repite la
-- misma expresión en using y with check, el UPDATE de un no-admin no ve la
-- fila (using la excluye) y Postgres devuelve "UPDATE 0" en silencio, sin
-- tirar 42501. El using de update se amplía a nivel de membresía (mismo
-- patrón anti-escalada que memberships_write en la Task 2): la fila pasa a
-- ser visible para cualquier miembro, pero el with check sigue admin-only,
-- así que el intento de escritura de un no-admin sí levanta 42501. No filtra
-- nada nuevo: tenant_agents_select ya deja leer la fila completa a cualquier
-- miembro.
create policy tenant_agents_insert on public.tenant_agents
  for insert to authenticated
  with check (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy tenant_agents_update on public.tenant_agents
  for update to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()))
  with check (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy tenant_agents_delete on public.tenant_agents
  for delete to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );
```

- [ ] **Step 4: Aplicar y correr los tests**

Run: `npm run db:reset && npm run db:test`
Expected: `03_conversations.test.sql .. ok`, 5 de 5.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/03_conversations.test.sql
git commit -m "feat: conversations y tenant_agents con rls"
```

---

### Task 5: Runs, events y visibilidad por columna

**Files:**
- Create: `supabase/migrations/<timestamp>_runs_events.sql`
- Create: `supabase/tests/04_runs_events.test.sql`

**Interfaces:**
- Consumes: helpers de la Task 2, `public.conversations` de la Task 4.
- Produces: `public.runs` (con `cost_usd` invisible para `authenticated`), `public.events` (append-only), `public.run_cost_usd(uuid)`. El hook de la Task 12 escribe `runs` con el cliente admin.

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/tests/04_runs_events.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'beto@fabrica.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'tenant_member');

insert into public.runs (id, tenant_id, agent, trigger, eve_session_id, status, cost_usd)
values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   'outreach', 'chat', 'wrun_ana', 'ok', 0.1234),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
   'outreach', 'chat', 'wrun_beto', 'ok', 0.4321);

insert into public.events (tenant_id, run_id, type, summary)
values ('aaaaaaaa-0000-0000-0000-000000000002',
        'dddddddd-0000-0000-0000-000000000001', 'envio', 'mail enviado');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.runs),
  1,
  'un tenant_admin ve solo las ejecuciones de su tenant'
);

select throws_ok(
  $$select cost_usd from public.runs$$,
  '42501',
  null,
  'cost_usd no es visible para authenticated'
);

select is(
  (select public.run_cost_usd('dddddddd-0000-0000-0000-000000000001')),
  null,
  'run_cost_usd no devuelve costo a quien no es platform_admin'
);

select is(
  (select count(*)::int from public.events),
  1,
  'los eventos se leen dentro del tenant'
);

select throws_ok(
  $$update public.events set summary = 'editado'$$,
  '42501',
  null,
  'events no acepta update'
);

select throws_ok(
  $$delete from public.events$$,
  '42501',
  null,
  'events no acepta delete'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run db:test`
Expected: FAIL con `relation "public.runs" does not exist`.

- [ ] **Step 3: Escribir la migración**

Run: `npx supabase migration new runs_events`

```sql
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent text not null,
  trigger public.run_trigger not null,
  eve_session_id text not null,
  eve_turn_id text,
  conversation_id uuid references public.conversations (id) on delete set null,
  status public.run_status not null default 'running',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cost_usd numeric(10, 4)
);

create index runs_tenant_started_idx on public.runs (tenant_id, started_at desc);
create index runs_conversation_id_idx on public.runs (conversation_id);
create unique index runs_turn_idx on public.runs (eve_session_id, eve_turn_id)
  where eve_turn_id is not null;

create table public.events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  run_id uuid references public.runs (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  contact_key text,
  channel text,
  type text not null,
  summary text,
  evidence_url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_tenant_created_idx on public.events (tenant_id, created_at desc);
create index events_run_id_idx on public.events (run_id);
create index events_actor_user_id_idx on public.events (actor_user_id);

alter table public.runs enable row level security;
alter table public.events enable row level security;

create policy runs_select on public.runs
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

create policy events_select on public.events
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

-- La RLS es por fila; esto es por columna. Un revoke de columna suelto no
-- alcanza mientras exista el grant de tabla, así que se revoca la tabla y se
-- re-otorga columna por columna. Consecuencia: nadie hace select * sobre runs.
revoke select on public.runs from authenticated, anon;
grant select (id, tenant_id, agent, trigger, eve_session_id, eve_turn_id,
  conversation_id, status, error, started_at, finished_at)
  on public.runs to authenticated;

revoke insert, update, delete on public.runs from authenticated, anon;
revoke insert, update, delete on public.events from authenticated, anon;

create or replace function public.run_cost_usd(p_run uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select r.cost_usd from public.runs r
  where r.id = p_run and public.is_platform_admin();
$$;

revoke execute on function public.run_cost_usd(uuid) from public;
grant execute on function public.run_cost_usd(uuid) to authenticated;

-- Ahora que existe events, la aceptación de invitaciones deja su rastro.
create or replace function public.accept_pending_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
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
     where i.email = v_email and i.status = 'pending' and i.expires_at > now()
    returning i.id, i.tenant_id, i.role
  loop
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
```

- [ ] **Step 4: Aplicar y correr los tests**

Run: `npm run db:reset && npm run db:test`
Expected: los cinco archivos en verde, incluido `04_runs_events.test.sql` con 6 de 6.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/04_runs_events.test.sql
git commit -m "feat: runs y events con costo restringido por columna"
```

---

### Task 6: Seed, tipos y migración a la nube

**Files:**
- Create: `supabase/seed.sql`
- Create: `supabase/migrations/<timestamp>_brand_bucket.sql`
- Create: `lib/supabase/database.types.ts` (generado)
- Modify: `package.json` (script `db:test`, separarlo del seed)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todas las migraciones anteriores.
- Produces: el tipo `Database` exportado desde `lib/supabase/database.types.ts`, que usan los clientes de la Entrega 2.

- [ ] **Step 1: Escribir el seed local**

`supabase/seed.sql` (corre con `supabase db reset`, solo en local).

**IDs deliberadamente distintos de los que usan los fixtures de pgTAP** (Tasks 2-5 usan el prefijo `aaaaaaaa-0000-...` para tenants y `11111111.../22222222.../33333333.../44444444.../55555555.../66666666...` para usuarios). El seed corre antes que los tests, como estado persistente de la base; si comparte un ID con un fixture, el `insert` del test choca contra una fila que el seed ya dejó committeada y el test entero falla por violación de unicidad. Por eso el seed usa el prefijo `99999999-...`, que ningún test toca:

**El mail también tiene que ser disjunto, no solo el ID**: `auth.users` tiene un índice unique parcial sobre `email`. `admin@innov.as` ya lo usa el fixture de la Task 2 (con un `id` distinto) — por eso el seed usa `admin-seed@innov.as`, no `admin@innov.as`.

**Y el slug del tenant, por la misma razón**: `tenants.slug` es `unique` a secas, no compuesto con nada. `innovas` ya lo usa el fixture de la Task 2 (con un `id` distinto) — por eso el seed usa `innovas-seed`, no `innovas`. El slug `innovas` de verdad se crea en la nube en el Step 6, sin relación con este seed local.

Barrido completo hecho contra los cinco archivos de test (`00` a `04`): todo lo demás que el seed inserta es una clave compuesta con `tenant_id` (`memberships (tenant_id, user_id)`, `tenant_agents (tenant_id, agent)`) o una tabla que el seed no toca (`conversations`, `invitations`, `runs`) — disjunto automáticamente porque el `tenant_id` del seed (`99999999-...`) nunca coincide con el de un fixture (`aaaaaaaa-...`). Solo los tres valores marcados arriba (dos ids con prefijo `99999999-...`, un mail, un slug) necesitaban un valor explícito distinto.

```sql
-- Usuarios de prueba locales. En la nube estos usuarios no existen: la
-- membership real de Innovas se crea con un SQL puntual (Step 5).
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('99999999-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'admin-seed@innov.as', now()),
  ('99999999-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@demo.test', now())
on conflict (id) do nothing;

insert into public.tenants (id, slug, display_name, allowed_domains, brand)
values
  ('99999999-0000-0000-0000-000000000001', 'innovas-seed', 'INNOV.AS', '{innov.as}',
   '{"primary": "#1D4ED8", "secondary": "#0F172A"}'::jsonb),
  ('99999999-0000-0000-0000-000000000002', 'demo', 'Demo', '{demo.test}',
   '{"primary": "#059669", "secondary": "#064E3B"}'::jsonb)
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role)
values
  ('99999999-0000-0000-0000-000000000001', '99999999-1111-1111-1111-111111111111', 'platform_admin'),
  ('99999999-0000-0000-0000-000000000002', '99999999-2222-2222-2222-222222222222', 'tenant_admin')
on conflict (tenant_id, user_id) do nothing;

-- Sin esta fila el canal rechaza todo, que es el comportamiento correcto.
insert into public.tenant_agents (tenant_id, agent)
values
  ('99999999-0000-0000-0000-000000000001', 'outreach'),
  ('99999999-0000-0000-0000-000000000002', 'outreach')
on conflict (tenant_id, agent) do nothing;
```

- [ ] **Step 2: Crear el bucket de marca**

Run: `npx supabase migration new brand_bucket`

```sql
-- El logo del cliente no es secreto: lectura pública, escritura restringida.
insert into storage.buckets (id, name, public)
values ('brand', 'brand', true)
on conflict (id) do nothing;

-- La primera carpeta del path es el slug del tenant: brand/<slug>/logo.png
create policy "brand_write_admins" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand'
    and exists (
      select 1 from public.tenants t
      where t.slug = (storage.foldername(name))[1]
        and (
          (select public.has_tenant_role(t.id, array['tenant_admin']::public.tenant_role[]))
          or (select public.is_platform_admin())
        )
    )
  );

create policy "brand_update_admins" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brand'
    and exists (
      select 1 from public.tenants t
      where t.slug = (storage.foldername(name))[1]
        and (
          (select public.has_tenant_role(t.id, array['tenant_admin']::public.tenant_role[]))
          or (select public.is_platform_admin())
        )
    )
  );
```

En esta etapa el logo se sube a mano desde el dashboard de Supabase a `brand/<slug>/logo.png`, y el valor va en `tenants.brand->>'logo_url'` como `<slug>/logo.png`. La pantalla de carga es Etapa 4.

- [ ] **Step 3: Separar `db:test` del seed, y verificar los dos caminos**

`supabase/config.toml` tiene `[db.seed] enabled = true`: `supabase db reset` aplica `seed.sql` después de las migraciones, siempre. Eso rompe el aislamiento que los tests de pgTAP daban por sentado: la aserción de la Task 2 "el platform_admin ve los tres tenants" cuenta filas de `tenants` **sin acotar por su propio fixture**, porque `platform_admin` ve todo. Antes de esta task no había ningún tenant persistente fuera de cada transacción de test (que hace `rollback`), así que "los tres del fixture" y "todos los que ve platform_admin" coincidían. Con el seed committeado, cualquier test que cuente filas de forma global dejó de ser determinístico: pasa a ver también los tenants del seed.

La CLI de Supabase tiene un flag para esto (`supabase db reset --help` lo confirma): `--no-seed`. La solución es que **`db:test` nunca dependa de lo que haya hecho un `db:reset` previo**: se resetea a sí mismo, sin seed, y corre pgTAP en un solo paso. `db:reset` (con seed) queda para cuando alguien quiere levantar `npm run dev` con datos de ejemplo para navegar la UI.

Modificar `package.json` (el `db:test` de la Task 1):

```json
"db:test": "supabase db reset --no-seed && supabase test db",
```

(`db:reset` no cambia.)

Run: `npm run db:reset` (sin encadenar nada más)
Expected: aplica las migraciones y el seed sin errores SQL. Es la única verificación de que el seed en sí es válido — este comando ya no corre los tests.

Run: `npm run db:test`
Expected: resetea de nuevo (esta vez sin seed, por su cuenta) y corre los cinco archivos de pgTAP. Los 24 asserts en verde, exactamente igual que antes de que existiera el seed — porque para `db:test` el seed ahora no existe.

- [ ] **Step 4: Aplicar las migraciones a la nube**

Run: `npx supabase db push`
Expected: lista las cuatro migraciones nuevas y las aplica contra `gxsebhduezvhnqkyxjdh`. Pide la contraseña de la base del proyecto. Si el push falla por credenciales, pedírsela al usuario en vez de intentar rodearlo.

- [ ] **Step 5: Generar los tipos**

Run: `npm run db:types`
Expected: `lib/supabase/database.types.ts` creado, exportando `Database` con las tablas nuevas.

- [ ] **Step 6: Crear la membership real de Innovas**

Este SQL lo corre el usuario en el SQL editor de Supabase, con su propio user id (el del login con Google de la Etapa 0):

```sql
insert into public.tenants (slug, display_name, allowed_domains, brand)
values ('innovas', 'INNOV.AS', '{innov.as}',
        '{"primary": "#1D4ED8", "secondary": "#0F172A"}'::jsonb)
on conflict (slug) do nothing;

insert into public.memberships (tenant_id, user_id, role)
select t.id, u.id, 'platform_admin'
from public.tenants t, auth.users u
where t.slug = 'innovas' and u.email = 'matias@innov.as'
on conflict (tenant_id, user_id) do nothing;

insert into public.tenant_agents (tenant_id, agent)
select t.id, 'outreach' from public.tenants t where t.slug = 'innovas'
on conflict (tenant_id, agent) do nothing;
```

- [ ] **Step 7: Actualizar `CLAUDE.md`**

En la sección `## Comandos`, agregar la línea de base de datos:

```
- Base: npm run db:start · npm run db:reset · npm run db:test · npm run db:types (necesitan Docker abierto)
```

- [ ] **Step 8: Commit**

```bash
git add supabase/seed.sql supabase/migrations lib/supabase/database.types.ts CLAUDE.md
git commit -m "feat: seed, tipos generados y migraciones aplicadas"
```

---

# Entrega 2 · App

### Task 7: Middleware de sesión y resolución de tenant

**Files:**
- Create: `middleware.ts`
- Create: `lib/tenants/resolve.ts`
- Create: `tests/tenants/resolve.test.ts`
- Modify: `vitest.config.ts` (alias `@/`)
- Modify: `lib/supabase/server.ts` (sacar el comentario de deuda)

**Interfaces:**
- Consumes: `Database` de la Task 6.
- Produces: `resolveTenantAccess(slug: string): Promise<TenantAccess | null>` con `TenantAccess = { id: string; slug: string; displayName: string; role: TenantRole; defaultModel: string; allowedModels: string[]; brand: TenantBrand }`, y `TenantBrand = { primary?: string; secondary?: string; logoUrl?: string }`. Lo usan las Tasks 8, 9, 13 y 14.

- [ ] **Step 1: Enseñarle el alias `@/` a Vitest**

Hoy `vitest.config.ts` no resuelve el alias y los tests existentes importan relativo. Los tests nuevos usan `@/`, así que primero el config:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
	},
	test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

Run: `npm test`
Expected: los tests de la Etapa 0 siguen en verde (el alias no rompe los imports relativos).

- [ ] **Step 2: Escribir el test que falla**

`tests/tenants/resolve.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { brandFromRow, type TenantRow } from "@/lib/tenants/resolve";

describe("brandFromRow", () => {
	it("lee los colores del jsonb", () => {
		const row = {
			brand: { primary: "#1D4ED8", secondary: "#0F172A", logo_url: "innovas/logo.png" },
		} as TenantRow;

		expect(brandFromRow(row)).toEqual({
			primary: "#1D4ED8",
			secondary: "#0F172A",
			logoUrl: "innovas/logo.png",
		});
	});

	it("tolera una marca vacía", () => {
		expect(brandFromRow({ brand: {} } as TenantRow)).toEqual({});
	});

	it("ignora valores que no son string", () => {
		const row = { brand: { primary: 42, secondary: null } } as unknown as TenantRow;
		expect(brandFromRow(row)).toEqual({});
	});
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test -- tests/tenants/resolve.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/tenants/resolve"`.

- [ ] **Step 4: Escribir `lib/tenants/resolve.ts`**

```ts
import { createServerSupabase } from "@/lib/supabase/server";

export type TenantRole = "platform_admin" | "tenant_admin" | "tenant_member";

export interface TenantBrand {
	primary?: string;
	secondary?: string;
	logoUrl?: string;
}

export interface TenantRow {
	id: string;
	slug: string;
	display_name: string;
	default_model: string;
	allowed_models: string[];
	brand: Record<string, unknown>;
}

export interface TenantAccess {
	id: string;
	slug: string;
	displayName: string;
	role: TenantRole;
	defaultModel: string;
	allowedModels: string[];
	brand: TenantBrand;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function brandFromRow(row: Pick<TenantRow, "brand">): TenantBrand {
	const brand = row.brand ?? {};
	const primary = readString(brand, "primary");
	const secondary = readString(brand, "secondary");
	const logoUrl = readString(brand, "logo_url");

	return {
		...(primary ? { primary } : {}),
		...(secondary ? { secondary } : {}),
		...(logoUrl ? { logoUrl } : {}),
	};
}

/**
 * Traduce un slug de la URL a tenant y rol del usuario logueado. Devuelve
 * `null` si no hay sesión, si el slug no existe o si el usuario no es
 * miembro: quien llama responde 404, nunca 403, porque un 403 confirma que
 * el cliente existe.
 */
export async function resolveTenantAccess(slug: string): Promise<TenantAccess | null> {
	const supabase = await createServerSupabase();

	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	const { data: tenant } = await supabase
		.from("tenants")
		.select("id, slug, display_name, default_model, allowed_models, brand")
		.eq("slug", slug)
		.eq("active", true)
		.maybeSingle();

	if (!tenant) return null;

	const { data: membership } = await supabase
		.from("memberships")
		.select("role")
		.eq("tenant_id", tenant.id)
		.eq("user_id", auth.user.id)
		.maybeSingle();

	// El platform_admin entra a cualquier tenant aunque no tenga membership ahí.
	const { data: platformAdmin } = await supabase
		.from("memberships")
		.select("role")
		.eq("user_id", auth.user.id)
		.eq("role", "platform_admin")
		.maybeSingle();

	// platform_admin siempre gana, igual que en la RLS (todas las políticas lo
	// chequean como condición aparte, nunca subordinada al rol local). Si se
	// resolviera al revés, un platform_admin que además tuviera una membership
	// local en un tenant (tenant_member, por ejemplo) se vería degradado en la
	// UI aunque la base le siga dando acceso completo — la Task 9 usa este rol
	// para decidir quién ve /settings/usuarios.
	const role = (platformAdmin?.role ?? membership?.role) as TenantRole | undefined;
	if (!role) return null;

	return {
		id: tenant.id,
		slug: tenant.slug,
		displayName: tenant.display_name,
		role,
		defaultModel: tenant.default_model,
		allowedModels: tenant.allowed_models,
		brand: brandFromRow(tenant as TenantRow),
	};
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test -- tests/tenants/resolve.test.ts`
Expected: PASS, 3 de 3.

- [ ] **Step 6: Escribir el middleware de refresco**

`middleware.ts` en la raíz:

```ts
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refresca el access token de Supabase en cada navegación server. Cierra la
 * deuda de la Etapa 0: sin esto el token vence a la hora y el usuario tiene
 * que volver a loguearse. Las rutas de eve quedan afuera del matcher para no
 * meterse con el streaming.
 */
export async function middleware(request: NextRequest) {
	let response = NextResponse.next({ request });

	const supabase = createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return request.cookies.getAll();
				},
				setAll(cookiesToSet) {
					for (const { name, value } of cookiesToSet) {
						request.cookies.set(name, value);
					}
					response = NextResponse.next({ request });
					for (const { name, value, options } of cookiesToSet) {
						response.cookies.set(name, value, options);
					}
				},
			},
		},
	);

	await supabase.auth.getUser();

	return response;
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|eve/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
	],
};
```

- [ ] **Step 7: Actualizar el comentario obsoleto de `lib/supabase/server.ts`**

Reemplazar el comentario del `catch` de `setAll` por:

```ts
					// setAll llamado desde un Server Component sin permiso de
					// escritura. El refresco lo hace middleware.ts, así que
					// perder esta escritura no desloguea a nadie.
```

- [ ] **Step 8: Verificar que compila y que el login sigue funcionando**

Run: `npm run typecheck && npm run lint:fix`
Expected: exit 0.

Run: `npm run dev`, entrar a `http://localhost:3000/login`, loguearse con Google.
Expected: el login termina sin error y las cookies de Supabase quedan en el browser.

- [ ] **Step 9: Commit**

```bash
git add middleware.ts vitest.config.ts lib/tenants/resolve.ts tests/tenants/resolve.test.ts lib/supabase/server.ts
git commit -m "feat: refresco de sesion y resolucion de tenant"
```

---

### Task 8: Layout por tenant, shadcn y marca

**Files:**
- Create: `lib/brand/contrast.ts`
- Create: `tests/brand/contrast.test.ts`
- Create: `app/[tenant]/layout.tsx`
- Create: `app/sin-acceso/page.tsx`
- Create: `app/page.tsx` (reemplaza la landing del scaffold)
- Modify: `app/globals.css`, `components.json` (los genera shadcn)

**Interfaces:**
- Consumes: `resolveTenantAccess`, `TenantBrand` de la Task 7.
- Produces: `foregroundFor(hex: string): "#FFFFFF" | "#0A0A0A"` y `brandStyle(brand: TenantBrand): React.CSSProperties`, que usa el layout. El layout expone el tenant a las páginas hijas vía props de segmento (`params.tenant`).

- [ ] **Step 1: Escribir el test que falla**

`tests/brand/contrast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { brandStyle, foregroundFor } from "@/lib/brand/contrast";

describe("foregroundFor", () => {
	it("elige texto claro sobre un azul oscuro", () => {
		expect(foregroundFor("#1D4ED8")).toBe("#FFFFFF");
	});

	it("elige texto oscuro sobre un amarillo", () => {
		expect(foregroundFor("#FDE047")).toBe("#0A0A0A");
	});

	it("tolera el numeral ausente y las mayúsculas", () => {
		expect(foregroundFor("fde047")).toBe("#0A0A0A");
	});
});

describe("brandStyle", () => {
	it("no define variables cuando la marca está vacía", () => {
		expect(brandStyle({})).toEqual({});
	});

	it("define primary y su foreground derivado", () => {
		expect(brandStyle({ primary: "#1D4ED8" })).toEqual({
			"--primary": "#1D4ED8",
			"--primary-foreground": "#FFFFFF",
		});
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/brand/contrast.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/brand/contrast"`.

- [ ] **Step 3: Escribir `lib/brand/contrast.ts`**

```ts
import type { CSSProperties } from "react";
import type { TenantBrand } from "@/lib/tenants/resolve";

const LIGHT = "#FFFFFF";
const DARK = "#0A0A0A";

function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Luminancia relativa (WCAG 2.1). El color primario lo carga el cliente, así
 * que el texto encima no se puede elegir a mano: se deriva.
 */
export function foregroundFor(hex: string): typeof LIGHT | typeof DARK {
	const clean = hex.replace("#", "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);

	if ([r, g, b].some(Number.isNaN)) return DARK;

	const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

	return luminance > 0.45 ? DARK : LIGHT;
}

export function brandStyle(brand: TenantBrand): CSSProperties {
	const style: Record<string, string> = {};

	if (brand.primary) {
		style["--primary"] = brand.primary;
		style["--primary-foreground"] = foregroundFor(brand.primary);
	}
	if (brand.secondary) {
		style["--secondary"] = brand.secondary;
		style["--secondary-foreground"] = foregroundFor(brand.secondary);
	}

	return style as CSSProperties;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/brand/contrast.test.ts`
Expected: PASS, 5 de 5.

- [ ] **Step 5: Instalar shadcn/ui**

Run: `npx shadcn@latest init`
Responder: estilo `new-york`, color base `neutral`, CSS variables `yes`. Reescribe `app/globals.css` con los tokens y crea `components.json` y `lib/utils.ts`.

Run: `npx shadcn@latest add button card select textarea`
Expected: crea `components/ui/{button,card,select,textarea}.tsx`.

- [ ] **Step 6: Escribir el layout del tenant**

`app/[tenant]/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { brandStyle } from "@/lib/brand/contrast";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

export default async function TenantLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);

	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const logoUrl = tenant.brand.logoUrl
		? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand/${tenant.brand.logoUrl}`
		: null;

	return (
		<div style={brandStyle(tenant.brand)} className="min-h-screen bg-background">
			<header className="flex items-center gap-3 border-b px-6 py-3">
				{logoUrl ? (
					// biome-ignore lint/performance/noImgElement: el logo es del cliente, sin loader
					<img src={logoUrl} alt={tenant.displayName} className="h-8 w-auto" />
				) : (
					<span className="font-semibold">{tenant.displayName}</span>
				)}
				<span className="text-muted-foreground text-sm">{tenant.role}</span>
			</header>
			<main className="p-6">{children}</main>
		</div>
	);
}
```

- [ ] **Step 7: Escribir `/` y `/sin-acceso`**

`app/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function HomePage() {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();

	if (!auth.user) redirect("/login");

	// user_id explícito, no solo lo que la RLS deja pasar: memberships_select
	// también expone TODAS las filas del tenant a un tenant_admin, y TODAS las
	// filas de la base a un platform_admin (para que puedan administrar
	// usuarios en /settings/usuarios). Sin este filtro, esta pantalla — "a qué
	// tenant quiero entrar yo" — le mostraría a un admin una fila por cada
	// miembro de sus tenants, con tenants repetidos.
	const { data: memberships } = await supabase
		.from("memberships")
		.select("role, tenants (slug, display_name)")
		.eq("user_id", auth.user.id)
		.order("created_at");

	const tenants = (memberships ?? []).flatMap((m) => (m.tenants ? [m.tenants] : []));

	if (tenants.length === 0) redirect("/sin-acceso");
	if (tenants.length === 1) redirect(`/${tenants[0].slug}/chat`);

	return (
		<main className="p-6">
			<h1 className="mb-4 font-semibold text-xl">Elegí un cliente</h1>
			<ul className="space-y-2">
				{tenants.map((tenant) => (
					<li key={tenant.slug}>
						<Link className="underline" href={`/${tenant.slug}/chat`}>
							{tenant.display_name}
						</Link>
					</li>
				))}
			</ul>
		</main>
	);
}
```

`app/sin-acceso/page.tsx`:

```tsx
export default function SinAccesoPage() {
	return (
		<main className="p-6">
			<h1 className="mb-2 font-semibold text-xl">Todavía no tenés acceso</h1>
			<p className="text-muted-foreground">
				Tu cuenta está creada pero no pertenece a ningún cliente. Pedile a quien
				te invitó que te sume, o escribinos a hola@innov.as.
			</p>
		</main>
	);
}
```

- [ ] **Step 8: Verificar en el browser**

Run: `npm run dev` y entrar a `http://localhost:3000/`
Expected: con una sola membership redirige a `/<slug>/chat`; con un slug inexistente (`/nope/chat`) devuelve 404; el header muestra el nombre del cliente.

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: exit 0 en los tres.

- [ ] **Step 9: Commit**

```bash
git add app lib/brand components components.json tests/brand
git commit -m "feat: layout por tenant con marca y shadcn"
```

---

### Task 9: Invitaciones desde la app

**Files:**
- Create: `app/api/invitations/route.ts`
- Create: `lib/invitations/domain.ts`
- Create: `tests/invitations/domain.test.ts`
- Create: `app/[tenant]/settings/usuarios/page.tsx`
- Create: `app/[tenant]/settings/usuarios/actions.ts`
- Create: `app/[tenant]/settings/usuarios/invite-form.tsx`
- Modify: `app/auth/callback/route.ts`
- Modify: `app/(auth)/login/page.tsx` (magic link)

**Interfaces:**
- Consumes: `resolveTenantAccess` (Task 7), `accept_pending_invitations()` (Task 3).
- Produces: `isAllowedDomain(email: string, allowedDomains: string[]): boolean` y el endpoint `POST /api/invitations` con body `{ tenantId: string; email: string; role: TenantRole; allowExternal?: boolean }`.

- [ ] **Step 1: Escribir el test que falla**

`tests/invitations/domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedDomain } from "@/lib/invitations/domain";

describe("isAllowedDomain", () => {
	it("acepta cualquier mail cuando el tenant no declara dominios", () => {
		expect(isAllowedDomain("quien@sea.com", [])).toBe(true);
	});

	it("acepta un mail del dominio del cliente", () => {
		expect(isAllowedDomain("Ana@Lagomarcino.com", ["lagomarcino.com"])).toBe(true);
	});

	it("rechaza un mail de afuera", () => {
		expect(isAllowedDomain("ana@gmail.com", ["lagomarcino.com"])).toBe(false);
	});

	it("rechaza una cadena que no es mail", () => {
		expect(isAllowedDomain("ana-arroba-nada", ["lagomarcino.com"])).toBe(false);
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/invitations/domain.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/invitations/domain"`.

- [ ] **Step 3: Escribir `lib/invitations/domain.ts`**

```ts
/**
 * `allowed_domains` valida al invitar; no es puerta de entrada. Quien deja el
 * cliente pierde acceso cuando se le saca la membership, no cuando le cierran
 * el mail. Lista vacía significa sin restricción.
 */
export function isAllowedDomain(email: string, allowedDomains: string[]): boolean {
	const parts = email.trim().toLowerCase().split("@");
	if (parts.length !== 2 || parts[1].length === 0) return false;
	if (allowedDomains.length === 0) return true;

	return allowedDomains.some((domain) => domain.trim().toLowerCase() === parts[1]);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/invitations/domain.test.ts`
Expected: PASS, 4 de 4.

- [ ] **Step 5: Escribir el endpoint de invitación**

`app/api/invitations/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedDomain } from "@/lib/invitations/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

const bodySchema = z.object({
	tenantId: z.uuid(),
	email: z.email(),
	role: z.enum(["tenant_admin", "tenant_member"]),
	allowExternal: z.boolean().optional(),
});

export async function POST(request: Request) {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) {
		return NextResponse.json({ error: "no autenticado" }, { status: 401 });
	}

	const parsed = bodySchema.safeParse(await request.json());
	if (!parsed.success) {
		return NextResponse.json({ error: "payload inválido" }, { status: 400 });
	}
	const { tenantId, role, allowExternal } = parsed.data;
	const email = parsed.data.email.trim().toLowerCase();

	// La RLS ya limita lo que este usuario ve: si no es admin del tenant, no
	// hay fila y el pedido muere acá.
	const { data: membership } = await supabase
		.from("memberships")
		.select("role")
		.eq("tenant_id", tenantId)
		.eq("user_id", auth.user.id)
		.in("role", ["tenant_admin", "platform_admin"])
		.maybeSingle();

	const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");

	if (!membership && !isPlatformAdmin) {
		return NextResponse.json({ error: "sin permiso" }, { status: 403 });
	}

	const admin = createAdminClient();

	const { data: tenant } = await admin
		.from("tenants")
		.select("slug, allowed_domains")
		.eq("id", tenantId)
		.single();

	if (!tenant) {
		return NextResponse.json({ error: "tenant inexistente" }, { status: 404 });
	}

	const external = !isAllowedDomain(email, tenant.allowed_domains);
	if (external && !allowExternal) {
		return NextResponse.json(
			{ error: "dominio_no_permitido", allowedDomains: tenant.allowed_domains },
			{ status: 422 },
		);
	}

	const { error: insertError } = await admin.from("invitations").insert({
		tenant_id: tenantId,
		email,
		role,
		invited_by: auth.user.id,
	});

	if (insertError) {
		return NextResponse.json({ error: "ya hay una invitación pendiente" }, { status: 409 });
	}

	const origin = new URL(request.url).origin;
	const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
		redirectTo: `${origin}/auth/callback`,
	});

	if (inviteError) {
		// El usuario ya existe en Auth: no hace falta mail de alta, la
		// invitación pendiente se acepta la próxima vez que entre.
		console.warn("inviteUserByEmail:", inviteError.message);
	}

	if (external) {
		await admin.from("events").insert({
			tenant_id: tenantId,
			actor_user_id: auth.user.id,
			type: "invitation.external",
			summary: `Invitación fuera de los dominios del cliente: ${email}`,
			payload: { email, role },
		});
	}

	return NextResponse.json({ ok: true }, { status: 201 });
}
```

- [ ] **Step 6: Aceptar invitaciones en el callback**

En `app/auth/callback/route.ts`, antes del `return NextResponse.redirect(...)` final, agregar:

```ts
	// Alta solo por invitación: si hay invitaciones pendientes para este mail
	// verificado, se convierten en memberships acá y en ningún otro lado.
	const { error: acceptError } = await supabase.rpc("accept_pending_invitations");
	if (acceptError) {
		console.error("No se pudieron aceptar las invitaciones:", acceptError.message);
	}
```

Y cambiar el destino final de `/chat` a `/`:

```ts
	return NextResponse.redirect(new URL("/", requestUrl.origin));
```

- [ ] **Step 7: Agregar magic link al login**

Sin esto, el invitado entra con el mail de invitación y después no tiene cómo volver: el login solo ofrece Google. Reemplazar el cuerpo de `app/(auth)/login/page.tsx` conservando el bloque de Google tal cual está y sumando el formulario:

```tsx
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);

	async function entrarConMagicLink(event: React.FormEvent) {
		event.preventDefault();
		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: {
				emailRedirectTo: `${window.location.origin}/auth/callback`,
				// Sin esto, un mail nunca invitado crea igual una fila en auth.users
				// y recibe un link — contradice "alta solo por invitación". Un
				// invitado real ya tiene su fila (la crea admin.inviteUserByEmail al
				// invitarlo), así que este flag no le rompe el login a nadie invitado.
				shouldCreateUser: false,
			},
		});
		// El mensaje no distingue mail existente de inexistente: no le confirmamos
		// a nadie quién tiene cuenta en la plataforma.
		setSent(!error);
	}
```

Y en el JSX, debajo del botón de Google:

```tsx
			<form onSubmit={entrarConMagicLink}>
				<input
					onChange={(event) => setEmail(event.target.value)}
					placeholder="tu@empresa.com"
					type="email"
					value={email}
				/>
				<button type="submit">Mandarme un link</button>
			</form>
			{sent ? <p>Si ese mail tiene acceso, te llega un link para entrar.</p> : null}
```

Agregar `import { useState } from "react";` arriba.

- [ ] **Step 8: Escribir la pantalla de usuarios**

`app/[tenant]/settings/usuarios/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function revokeMembership(membershipId: string, slug: string) {
	const supabase = await createServerSupabase();
	// La RLS decide: si no sos admin del tenant, no borra nada.
	await supabase.from("memberships").delete().eq("id", membershipId);
	revalidatePath(`/${slug}/settings/usuarios`);
}

export async function revokeInvitation(invitationId: string, slug: string) {
	const supabase = await createServerSupabase();
	await supabase.from("invitations").update({ status: "revoked" }).eq("id", invitationId);
	revalidatePath(`/${slug}/settings/usuarios`);
}
```

`app/[tenant]/settings/usuarios/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { revokeInvitation, revokeMembership } from "./actions";
import { InviteForm } from "./invite-form";

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

	const { data: memberships } = await supabase
		.from("memberships")
		.select("id, role, user_id")
		.eq("tenant_id", tenant.id);

	const { data: invitations } = await supabase
		.from("invitations")
		.select("id, email, role, expires_at")
		.eq("tenant_id", tenant.id)
		.eq("status", "pending");

	return (
		<div className="space-y-8">
			<section>
				<h1 className="mb-3 font-semibold text-xl">Usuarios de {tenant.displayName}</h1>
				<ul className="space-y-2">
					{(memberships ?? []).map((membership) => (
						<li key={membership.id} className="flex items-center gap-3">
							<span className="font-mono text-sm">{membership.user_id}</span>
							<span className="text-muted-foreground text-sm">{membership.role}</span>
							<form action={revokeMembership.bind(null, membership.id, slug)}>
								<Button type="submit" variant="outline" size="sm">
									Sacar
								</Button>
							</form>
						</li>
					))}
				</ul>
			</section>

			<section>
				<h2 className="mb-3 font-semibold">Invitaciones pendientes</h2>
				<ul className="space-y-2">
					{(invitations ?? []).map((invitation) => (
						<li key={invitation.id} className="flex items-center gap-3">
							<span>{invitation.email}</span>
							<span className="text-muted-foreground text-sm">{invitation.role}</span>
							<form action={revokeInvitation.bind(null, invitation.id, slug)}>
								<Button type="submit" variant="outline" size="sm">
									Revocar
								</Button>
							</form>
						</li>
					))}
				</ul>
			</section>

			<InviteForm tenantId={tenant.id} />
		</div>
	);
}
```

`app/[tenant]/settings/usuarios/invite-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function InviteForm({ tenantId }: { tenantId: string }) {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [message, setMessage] = useState<string | null>(null);

	async function invite(allowExternal: boolean) {
		setMessage(null);
		const response = await fetch("/api/invitations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ tenantId, email, role: "tenant_member", allowExternal }),
		});

		if (response.status === 422) {
			setMessage("Ese mail está fuera de los dominios del cliente. ¿Invitar igual?");
			return;
		}
		if (!response.ok) {
			setMessage("No se pudo invitar. Revisá el mail e intentá de nuevo.");
			return;
		}

		setEmail("");
		setMessage("Invitación enviada.");
		router.refresh();
	}

	return (
		<section className="space-y-2">
			<h2 className="font-semibold">Invitar</h2>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void invite(false);
				}}
			>
				<input
					className="rounded border px-3 py-2"
					onChange={(event) => setEmail(event.target.value)}
					placeholder="mail@cliente.com"
					type="email"
					value={email}
				/>
				<Button type="submit">Invitar</Button>
			</form>
			{message ? (
				<p className="text-muted-foreground text-sm">
					{message}{" "}
					{message.startsWith("Ese mail") ? (
						<button className="underline" onClick={() => void invite(true)} type="button">
							Invitar igual
						</button>
					) : null}
				</p>
			) : null}
		</section>
	);
}
```

- [ ] **Step 9: Verificar el flujo completo**

Run: `npm run dev`, entrar a `/<slug>/settings/usuarios`, invitar un mail del dominio del cliente.
Expected: aparece en pendientes. Con un mail de otro dominio aparece el aviso y el botón "Invitar igual", y al usarlo queda un evento `invitation.external`.

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add app lib/invitations tests/invitations
git commit -m "feat: alta de usuarios por invitacion"
```

---

### Task 10: Contexto de canal: tenant y ownership de sesión

**Files:**
- Create: `lib/agents/channel-context.ts`
- Create: `tests/agents/channel-context.test.ts`

**Interfaces:**
- Consumes: `conversations` y `tenant_agents` (Task 4).
- Produces: `resolveChannelContext(request: Request, userId: string): Promise<ChannelContext | null>` con `ChannelContext = { tenantId: string; tenantSlug: string; conversationId: string; role: string }`. Lo consume el canal en la Task 11.

- [ ] **Step 1: Escribir el test que falla**

`tests/agents/channel-context.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
	conversationById: null as Record<string, unknown> | null,
	conversationBySession: null as Record<string, unknown> | null,
	tenantAgent: null as Record<string, unknown> | null,
	membership: null as Record<string, unknown> | null,
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from(table: string) {
			const result =
				table === "tenant_agents"
					? rows.tenantAgent
					: table === "memberships"
						? rows.membership
						: null;

			const builder = {
				select: () => builder,
				eq: (column: string) => {
					if (column === "id") builder._kind = "byId";
					if (column === "eve_session_id") builder._kind = "bySession";
					return builder;
				},
				maybeSingle: async () => ({
					data:
						table === "conversations"
							? builder._kind === "bySession"
								? rows.conversationBySession
								: rows.conversationById
							: result,
					error: null,
				}),
				_kind: "byId" as string,
			};
			return builder;
		},
	}),
}));

const { resolveChannelContext } = await import("@/lib/agents/channel-context");

const CONVERSATION = {
	id: "cccccccc-0000-0000-0000-000000000001",
	tenant_id: "aaaaaaaa-0000-0000-0000-000000000002",
	user_id: "22222222-2222-2222-2222-222222222222",
	agent: "outreach",
	tenants: { slug: "lagomarcino" },
};

function createRequest(url: string, conversationId?: string) {
	return new Request(url, {
		headers: conversationId ? { "x-innovas-conversation": conversationId } : {},
	});
}

beforeEach(() => {
	rows.conversationById = CONVERSATION;
	rows.conversationBySession = CONVERSATION;
	rows.tenantAgent = { enabled: true };
	rows.membership = { role: "tenant_member" };
});

describe("resolveChannelContext", () => {
	it("resuelve el tenant al crear una sesión", async () => {
		const context = await resolveChannelContext(
			createRequest("https://app.test/eve/agents/outreach/eve/v1/session", CONVERSATION.id),
			CONVERSATION.user_id,
		);

		expect(context).toEqual({
			tenantId: CONVERSATION.tenant_id,
			tenantSlug: "lagomarcino",
			conversationId: CONVERSATION.id,
			role: "tenant_member",
		});
	});

	it("rechaza crear sobre una conversación ajena", async () => {
		const context = await resolveChannelContext(
			createRequest("https://app.test/eve/agents/outreach/eve/v1/session", CONVERSATION.id),
			"99999999-9999-9999-9999-999999999999",
		);

		expect(context).toBeNull();
	});

	it("rechaza continuar la sesión de otro usuario", async () => {
		const context = await resolveChannelContext(
			createRequest("https://app.test/eve/agents/outreach/eve/v1/session/wrun_A"),
			"99999999-9999-9999-9999-999999999999",
		);

		expect(context).toBeNull();
	});

	it("ignora el header al continuar y usa la sesión de la URL", async () => {
		rows.conversationById = { ...CONVERSATION, tenant_id: "otro-tenant" };

		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/agents/outreach/eve/v1/session/wrun_A",
				"cccccccc-0000-0000-0000-000000000009",
			),
			CONVERSATION.user_id,
		);

		expect(context?.tenantId).toBe(CONVERSATION.tenant_id);
	});

	it("rechaza si el agente está deshabilitado para el tenant", async () => {
		rows.tenantAgent = { enabled: false };

		const context = await resolveChannelContext(
			createRequest("https://app.test/eve/agents/outreach/eve/v1/session", CONVERSATION.id),
			CONVERSATION.user_id,
		);

		expect(context).toBeNull();
	});

	it("rechaza cuando no hay sesión ni header", async () => {
		const context = await resolveChannelContext(
			createRequest("https://app.test/eve/agents/outreach/eve/v1/session"),
			CONVERSATION.user_id,
		);

		expect(context).toBeNull();
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/agents/channel-context.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/agents/channel-context"`.

- [ ] **Step 3: Escribir `lib/agents/channel-context.ts`**

```ts
// Import relativo y no "@/": este módulo lo importa el canal de eve, que no
// resuelve los paths de tsconfig.
import { createAdminClient } from "../supabase/admin";

export interface ChannelContext {
	tenantId: string;
	tenantSlug: string;
	conversationId: string;
	role: string;
}

// Las rutas de sesión de eve traen el id en el path, tanto en
// /eve/v1/session/:id como en /eve/agents/<agente>/eve/v1/session/:id.
const SESSION_PATH = /\/eve\/v1\/session\/([^/?]+)/;

interface ConversationRow {
	id: string;
	tenant_id: string;
	user_id: string;
	agent: string;
	tenants: { slug: string } | null;
}

/**
 * Resuelve tenant y dueño para un request del canal de eve.
 *
 * Al crear una sesión el tenant sale de la conversación que la app creó antes
 * de `send()`. Al continuar, sale de la base buscando por `eve_session_id`, y
 * se ignora lo que manda el browser: eve no valida ownership de sesión
 * (guides/auth-and-route-protection.md), así que esta función es la puerta.
 *
 * Devuelve `null` ante cualquier duda; el canal traduce eso a 401.
 */
export async function resolveChannelContext(
	request: Request,
	userId: string,
): Promise<ChannelContext | null> {
	const admin = createAdminClient();
	const sessionId = new URL(request.url).pathname.match(SESSION_PATH)?.[1];

	let conversation: ConversationRow | null = null;

	if (sessionId) {
		const { data } = await admin
			.from("conversations")
			.select("id, tenant_id, user_id, agent, tenants (slug)")
			.eq("eve_session_id", sessionId)
			.maybeSingle();
		conversation = data as ConversationRow | null;
	} else {
		const conversationId = request.headers.get("x-innovas-conversation");
		if (!conversationId) return null;

		const { data } = await admin
			.from("conversations")
			.select("id, tenant_id, user_id, agent, tenants (slug)")
			.eq("id", conversationId)
			.maybeSingle();
		conversation = data as ConversationRow | null;
	}

	if (!conversation) return null;
	if (conversation.user_id !== userId) return null;

	const { data: membership } = await admin
		.from("memberships")
		.select("role")
		.eq("tenant_id", conversation.tenant_id)
		.eq("user_id", userId)
		.maybeSingle();

	if (!membership) return null;

	const { data: tenantAgent } = await admin
		.from("tenant_agents")
		.select("enabled")
		.eq("tenant_id", conversation.tenant_id)
		.eq("agent", conversation.agent)
		.maybeSingle();

	if (!tenantAgent?.enabled) return null;

	return {
		tenantId: conversation.tenant_id,
		tenantSlug: conversation.tenants?.slug ?? "",
		conversationId: conversation.id,
		role: membership.role as string,
	};
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/agents/channel-context.test.ts`
Expected: PASS, 6 de 6.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/channel-context.ts tests/agents/channel-context.test.ts
git commit -m "feat: contexto de tenant y ownership de sesion para el canal"
```

---

### Task 11: Canal de eve con tenant

**Files:**
- Modify: `agents/outreach/channels/eve.ts`

**Interfaces:**
- Consumes: `resolveChannelContext` (Task 10), `verifyCaller` (Etapa 0).
- Produces: `ctx.session.auth.current.attributes` con `email`, `tenantId`, `tenantSlug`, `conversationId`, `role`. Los leen las Tasks 12 y 13.

- [ ] **Step 1: Reescribir el canal**

`agents/outreach/channels/eve.ts` completo (ojo: imports relativos, el alias `@/` no se resuelve en `agents/`):

```ts
import { type AuthFn, localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { resolveChannelContext } from "../../../lib/agents/channel-context";
import { verifyCaller } from "../../../lib/auth/verify-caller";

function supabaseAuth(): AuthFn<Request> {
	return async (request) => {
		const caller = await verifyCaller(request);
		if (caller === null) return null;

		// eve no valida ownership de sesión: lo hacemos acá, que es el único
		// punto capaz de rechazar (los hooks son observe-only).
		const context = await resolveChannelContext(request, caller.userId);
		if (context === null) return null;

		return {
			authenticator: "app",
			issuer: process.env.NEXT_PUBLIC_SUPABASE_URL!,
			principalId: caller.userId,
			principalType: "user",
			subject: caller.userId,
			attributes: {
				email: caller.email,
				tenantId: context.tenantId,
				tenantSlug: context.tenantSlug,
				conversationId: context.conversationId,
				role: context.role,
			},
		};
	};
}

// `localDev()` nunca puede quedar activo en un deploy: `VERCEL_ENV` existe en
// todos los entornos de Vercel y no en local.
export default eveChannel({
	auth: process.env.VERCEL_ENV
		? [supabaseAuth()]
		: [supabaseAuth(), localDev()],
});
```

- [ ] **Step 2: Verificar que el health sigue público y que el resto exige contexto**

Run: `npm run dev` en una terminal y en otra:

```bash
curl -s localhost:3000/eve/agents/outreach/eve/v1/health
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/eve/agents/outreach/eve/v1/info
```

Expected: el health devuelve `{"ok":true,...}`; el `info` sin cookie devuelve `401`.

- [ ] **Step 3: Correr typecheck y tests**

Run: `npm run typecheck && npm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add agents/outreach/channels/eve.ts
git commit -m "feat: canal de eve con tenant y ownership de sesion"
```

---

### Task 12: Hooks de sesión y de runs

**Files:**
- Create: `lib/agents/session-store.ts`
- Create: `agents/outreach/hooks/bind-session.ts`
- Create: `agents/outreach/hooks/runs.ts`
- Create: `tests/agents/session-store.test.ts`

**Interfaces:**
- Consumes: `conversations` y `runs` (Tasks 4 y 5), los `attributes` del canal (Task 11).
- Produces: `bindSessionToConversation(conversationId, sessionId)`, `openRun(input)`, `closeRun(input)` en `lib/agents/session-store.ts`.

- [ ] **Step 1: Escribir el test que falla**

`tests/agents/session-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ updates: [] as unknown[], inserts: [] as unknown[] }));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			update(values: unknown) {
				calls.updates.push(values);
				return {
					eq: () => ({
						// closeRun encadena dos eq; bindSessionToConversation cierra
						// con select().maybeSingle().
						eq: async () => ({ error: null }),
						select: () => ({
							maybeSingle: async () => ({ data: { id: "conv-1" }, error: null }),
						}),
					}),
				};
			},
			insert: async (values: unknown) => {
				calls.inserts.push(values);
				return { error: null };
			},
		}),
	}),
}));

const { bindSessionToConversation, openRun } = await import("@/lib/agents/session-store");

beforeEach(() => {
	calls.updates = [];
	calls.inserts = [];
});

describe("bindSessionToConversation", () => {
	it("escribe el session id en la conversación", async () => {
		await bindSessionToConversation("conv-1", "wrun_A");
		expect(calls.updates[0]).toMatchObject({ eve_session_id: "wrun_A" });
	});

	it("tira si falta el id de conversación, para que el turno falle", async () => {
		await expect(bindSessionToConversation("", "wrun_A")).rejects.toThrow();
	});
});

describe("openRun", () => {
	it("inserta el run en estado running", async () => {
		await openRun({
			tenantId: "tenant-1",
			conversationId: "conv-1",
			agent: "outreach",
			sessionId: "wrun_A",
			turnId: "turn-1",
		});

		expect(calls.inserts[0]).toMatchObject({
			tenant_id: "tenant-1",
			agent: "outreach",
			trigger: "chat",
			eve_session_id: "wrun_A",
			eve_turn_id: "turn-1",
			status: "running",
		});
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/agents/session-store.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/agents/session-store"`.

- [ ] **Step 3: Escribir `lib/agents/session-store.ts`**

```ts
// Import relativo: lo importan los hooks de eve (ver Global Constraints).
import { createAdminClient } from "../supabase/admin";

export interface OpenRunInput {
	tenantId: string;
	conversationId: string | null;
	agent: string;
	sessionId: string;
	turnId: string;
}

export interface CloseRunInput {
	sessionId: string;
	turnId: string;
	status: "ok" | "failed" | "cancelled";
	error?: string;
}

/**
 * Ata la sesión durable de eve a la conversación de la app. Es lo que permite
 * después validar ownership por `eve_session_id`. Si falla, tira: sin esta
 * fila nadie va a poder continuar la sesión, así que es mejor que el turno
 * falle ahora y el usuario reintente.
 */
export async function bindSessionToConversation(
	conversationId: string,
	sessionId: string,
): Promise<void> {
	if (!conversationId) {
		throw new Error("session.started sin conversationId en los attributes del canal");
	}

	const admin = createAdminClient();
	// Última escritura gana, a propósito: si el primer turno falló antes de
	// atar la sesión, el segundo intento crea otra sesión de eve y la
	// conversación tiene que quedar apuntando a esa, no a la muerta.
	const { data, error } = await admin
		.from("conversations")
		.update({ eve_session_id: sessionId, last_message_at: new Date().toISOString() })
		.eq("id", conversationId)
		.select("id")
		.maybeSingle();

	if (error || !data) {
		throw new Error(
			`No se pudo atar la sesión ${sessionId} a la conversación ${conversationId}`,
		);
	}
}

export async function openRun(input: OpenRunInput): Promise<void> {
	const admin = createAdminClient();
	await admin.from("runs").insert({
		tenant_id: input.tenantId,
		agent: input.agent,
		trigger: "chat",
		eve_session_id: input.sessionId,
		eve_turn_id: input.turnId,
		conversation_id: input.conversationId,
		status: "running",
	});
}

export async function closeRun(input: CloseRunInput): Promise<void> {
	const admin = createAdminClient();
	await admin
		.from("runs")
		.update({
			status: input.status,
			error: input.error ?? null,
			finished_at: new Date().toISOString(),
		})
		.eq("eve_session_id", input.sessionId)
		.eq("eve_turn_id", input.turnId);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/agents/session-store.test.ts`
Expected: PASS, 3 de 3.

- [ ] **Step 5: Escribir el hook que ata la sesión**

`agents/outreach/hooks/bind-session.ts`:

```ts
import { defineHook } from "eve/hooks";
import { bindSessionToConversation } from "../../../lib/agents/session-store";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export default defineHook({
	events: {
		async "session.started"(_event, ctx) {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			// Sin try/catch a propósito: si esto falla, el turno tiene que fallar.
			await bindSessionToConversation(
				attribute(auth?.attributes?.conversationId),
				ctx.session.id,
			);
		},
	},
});
```

- [ ] **Step 6: Escribir el hook de runs**

`agents/outreach/hooks/runs.ts`:

```ts
import { defineHook } from "eve/hooks";
import { closeRun, openRun } from "../../../lib/agents/session-store";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// La observabilidad nunca puede tumbar un turno real: un hook que tira
// termina en turn.failed (guides/hooks.md). Por eso todo va en try/catch,
// al revés que bind-session.
export default defineHook({
	events: {
		async "turn.started"(event, ctx) {
			try {
				const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return;

				await openRun({
					tenantId,
					conversationId: attribute(auth?.attributes?.conversationId) || null,
					agent: ctx.agent.name,
					sessionId: ctx.session.id,
					turnId: event.turnId,
				});
			} catch (error) {
				console.error("runs hook (turn.started):", error);
			}
		},
		async "turn.completed"(event, ctx) {
			try {
				await closeRun({ sessionId: ctx.session.id, turnId: event.turnId, status: "ok" });
			} catch (error) {
				console.error("runs hook (turn.completed):", error);
			}
		},
		async "turn.failed"(event, ctx) {
			try {
				await closeRun({
					sessionId: ctx.session.id,
					turnId: event.turnId,
					status: "failed",
					error: String(event.data?.error ?? "turno fallido"),
				});
			} catch (error) {
				console.error("runs hook (turn.failed):", error);
			}
		},
		async "turn.cancelled"(event, ctx) {
			try {
				await closeRun({
					sessionId: ctx.session.id,
					turnId: event.turnId,
					status: "cancelled",
				});
			} catch (error) {
				console.error("runs hook (turn.cancelled):", error);
			}
		},
	},
});
```

Si el tipo de `event.turnId` o `event.data` no coincide, leer `node_modules/eve/docs/concepts/sessions-runs-and-streaming.md` y ajustar sin inventar campos.

- [ ] **Step 7: Verificar**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/agents/session-store.ts agents/outreach/hooks tests/agents/session-store.test.ts
git commit -m "feat: hooks de sesion y de runs"
```

---

### Task 13: Modelo e instrucciones por tenant

**Files:**
- Create: `lib/agents/model.ts`
- Create: `tests/agents/model.test.ts`
- Create: `agents/outreach/instructions/tenant.ts`
- Modify: `agents/outreach/agent.ts`

**Interfaces:**
- Consumes: `tenants` y `tenant_agents` (Tasks 2 y 4), `conversations.model` (Task 4), attributes del canal (Task 11).
- Produces: `pickModel(input: { agentModel: string | null; conversationModel: string | null; defaultModel: string; allowedModels: string[] }): string` y `resolveModelForTenant(tenantId, agent, conversationId): Promise<string>`.

- [ ] **Step 1: Escribir el test que falla**

`tests/agents/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickModel } from "@/lib/agents/model";

const allowed = ["anthropic/claude-sonnet-5", "anthropic/claude-haiku-4-5"];

describe("pickModel", () => {
	it("prioriza el override del agente en el tenant", () => {
		expect(
			pickModel({
				agentModel: "anthropic/claude-haiku-4-5",
				conversationModel: "anthropic/claude-sonnet-5",
				defaultModel: "anthropic/claude-sonnet-5",
				allowedModels: allowed,
			}),
		).toBe("anthropic/claude-haiku-4-5");
	});

	it("usa el modelo que eligió el usuario en el hilo", () => {
		expect(
			pickModel({
				agentModel: null,
				conversationModel: "anthropic/claude-haiku-4-5",
				defaultModel: "anthropic/claude-sonnet-5",
				allowedModels: allowed,
			}),
		).toBe("anthropic/claude-haiku-4-5");
	});

	it("cae al default del tenant si no hay elección", () => {
		expect(
			pickModel({
				agentModel: null,
				conversationModel: null,
				defaultModel: "anthropic/claude-sonnet-5",
				allowedModels: allowed,
			}),
		).toBe("anthropic/claude-sonnet-5");
	});

	it("ignora un modelo que el tenant no habilitó", () => {
		expect(
			pickModel({
				agentModel: null,
				conversationModel: "anthropic/claude-opus-5",
				defaultModel: "anthropic/claude-sonnet-5",
				allowedModels: allowed,
			}),
		).toBe("anthropic/claude-sonnet-5");
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/agents/model.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/agents/model"`.

- [ ] **Step 3: Escribir `lib/agents/model.ts`**

```ts
// Import relativo: lo importa agents/outreach/agent.ts (ver Global Constraints).
import { createAdminClient } from "../supabase/admin";

export interface PickModelInput {
	agentModel: string | null;
	conversationModel: string | null;
	defaultModel: string;
	allowedModels: string[];
}

/**
 * Precedencia: override del agente en el tenant, después lo que eligió el
 * usuario en el hilo, después el default del tenant. `allowed_models` es el
 * freno: sin esa lista, cualquiera se manda un Opus por turno.
 */
export function pickModel(input: PickModelInput): string {
	const candidates = [input.agentModel, input.conversationModel];

	for (const candidate of candidates) {
		if (candidate && input.allowedModels.includes(candidate)) return candidate;
	}

	return input.defaultModel;
}

export async function resolveModelForTenant(
	tenantId: string,
	agent: string,
	conversationId: string | null,
): Promise<string> {
	const admin = createAdminClient();

	const { data: tenant } = await admin
		.from("tenants")
		.select("default_model, allowed_models")
		.eq("id", tenantId)
		.single();

	const { data: tenantAgent } = await admin
		.from("tenant_agents")
		.select("model")
		.eq("tenant_id", tenantId)
		.eq("agent", agent)
		.maybeSingle();

	const { data: conversation } = conversationId
		? await admin.from("conversations").select("model").eq("id", conversationId).maybeSingle()
		: { data: null };

	return pickModel({
		agentModel: tenantAgent?.model ?? null,
		conversationModel: conversation?.model ?? null,
		defaultModel: tenant?.default_model ?? "anthropic/claude-sonnet-5",
		allowedModels: tenant?.allowed_models ?? ["anthropic/claude-sonnet-5"],
	});
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/agents/model.test.ts`
Expected: PASS, 4 de 4.

- [ ] **Step 5: Pasar `agent.ts` a `defineDynamic`**

`agents/outreach/agent.ts`:

```ts
import { defineAgent, defineDynamic } from "eve";
import { resolveModelForTenant } from "../../lib/agents/model";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export default defineAgent({
	// Se resuelve en session.started y no por turno: el prompt cache es por
	// modelo, y cambiarlo a mitad de sesión reingiere la conversación a precio
	// sin cachear (guides/dynamic-capabilities.md).
	model: defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return "anthropic/claude-sonnet-5";

				return await resolveModelForTenant(
					tenantId,
					"outreach",
					attribute(auth?.attributes?.conversationId) || null,
				);
			},
		},
	}),
});
```

- [ ] **Step 6: Escribir las instrucciones por tenant**

`agents/outreach/instructions/tenant.ts`:

```ts
import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { createAdminClient } from "../../../lib/supabase/admin";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			const tenantId = attribute(auth?.attributes?.tenantId);
			if (!tenantId) return null;

			const admin = createAdminClient();
			const { data: tenant } = await admin
				.from("tenants")
				.select("display_name, slug")
				.eq("id", tenantId)
				.maybeSingle();

			if (!tenant) return null;

			return defineInstructions({
				content: `Trabajás para ${tenant.display_name} (tenant \`${tenant.slug}\`). Todo lo que hagas es en nombre de ese cliente y con sus datos.`,
			});
		},
	},
});
```

- [ ] **Step 7: Verificar**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: exit 0.

Run: `npm run dev` y `curl -s localhost:3000/eve/agents/outreach/eve/v1/health`
Expected: `{"ok":true,"status":"ready",...}`. Si el build de eve se queja del modelo dinámico, releer `node_modules/eve/docs/agent-config.md#choose-the-model-dynamically`.

- [ ] **Step 8: Commit**

```bash
git add lib/agents/model.ts agents/outreach tests/agents/model.test.ts
git commit -m "feat: modelo e instrucciones por tenant"
```

---

### Task 14: Chat con hilos y selector de modelo

**Files:**
- Create: `app/[tenant]/chat/page.tsx`
- Create: `app/[tenant]/chat/actions.ts`
- Create: `app/[tenant]/chat/chat-client.tsx`
- Delete: `app/chat/page.tsx`

**Interfaces:**
- Consumes: `resolveTenantAccess` (Task 7), el canal (Task 11), `conversations` (Task 4).
- Produces: la UI final de la etapa. No la consume nadie más.

- [ ] **Step 1: Escribir las server actions**

`app/[tenant]/chat/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function createConversation(
	tenantId: string,
	slug: string,
	model: string,
): Promise<string | null> {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	// La fila se crea ANTES de send(): el canal valida contra ella y el hook
	// bind-session le escribe después el eve_session_id.
	const { data, error } = await supabase
		.from("conversations")
		.insert({
			tenant_id: tenantId,
			user_id: auth.user.id,
			agent: "outreach",
			model,
		})
		.select("id")
		.single();

	if (error) return null;

	revalidatePath(`/${slug}/chat`);
	return data.id;
}

export async function renameConversation(conversationId: string, title: string, slug: string) {
	const supabase = await createServerSupabase();
	await supabase
		.from("conversations")
		.update({ title: title.slice(0, 80), last_message_at: new Date().toISOString() })
		.eq("id", conversationId);
	revalidatePath(`/${slug}/chat`);
}
```

- [ ] **Step 2: Escribir la página**

`app/[tenant]/chat/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { ChatClient } from "./chat-client";

export default async function ChatPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ hilo?: string }>;
}) {
	const { tenant: slug } = await params;
	const { hilo } = await searchParams;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();

	const supabase = await createServerSupabase();
	const { data: conversations } = await supabase
		.from("conversations")
		.select("id, title, model, eve_session_id, last_message_at")
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach")
		.order("last_message_at", { ascending: false })
		.limit(50);

	const threads = conversations ?? [];
	const active = threads.find((thread) => thread.id === hilo) ?? null;

	return (
		<ChatClient
			active={active}
			allowedModels={tenant.allowedModels}
			defaultModel={tenant.defaultModel}
			slug={slug}
			tenantId={tenant.id}
			threads={threads}
		/>
	);
}
```

- [ ] **Step 3: Escribir el cliente de chat**

`app/[tenant]/chat/chat-client.tsx`:

```tsx
"use client";

import { useEveAgent } from "eve/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createConversation, renameConversation } from "./actions";

interface Thread {
	id: string;
	title: string | null;
	model: string | null;
	eve_session_id: string | null;
	last_message_at: string;
}

interface SendEmailInput {
	to?: string;
	subject?: string;
	body?: string;
}

export function ChatClient({
	active,
	allowedModels,
	defaultModel,
	slug,
	tenantId,
	threads,
}: {
	active: Thread | null;
	allowedModels: string[];
	defaultModel: string;
	slug: string;
	tenantId: string;
	threads: Thread[];
}) {
	const router = useRouter();
	const [model, setModel] = useState(defaultModel);

	return (
		<div className="grid gap-6 md:grid-cols-[240px_1fr]">
			<aside className="space-y-3">
				<div className="space-y-2">
					<label className="block text-muted-foreground text-sm" htmlFor="modelo">
						Modelo del hilo nuevo
					</label>
					<select
						className="w-full rounded border px-2 py-1"
						id="modelo"
						onChange={(event) => setModel(event.target.value)}
						value={model}
					>
						{allowedModels.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
					<Button
						className="w-full"
						onClick={async () => {
							const id = await createConversation(tenantId, slug, model);
							if (id) router.push(`/${slug}/chat?hilo=${id}`);
						}}
						type="button"
					>
						Hilo nuevo
					</Button>
				</div>

				<ul className="space-y-1">
					{threads.map((thread) => (
						<li key={thread.id}>
							<a
								className={`block truncate rounded px-2 py-1 text-sm ${
									thread.id === active?.id ? "bg-muted font-medium" : ""
								}`}
								href={`/${slug}/chat?hilo=${thread.id}`}
							>
								{thread.title ?? "Hilo sin título"}
							</a>
						</li>
					))}
				</ul>
			</aside>

			{active ? (
				<Thread key={active.id} slug={slug} thread={active} />
			) : (
				<p className="text-muted-foreground">
					Elegí un hilo o abrí uno nuevo para hablar con el agente.
				</p>
			)}
		</div>
	);
}

function Thread({ slug, thread }: { slug: string; thread: Thread }) {
	const [text, setText] = useState("");

	const agent = useEveAgent({
		agent: "outreach",
		headers: { "x-innovas-conversation": thread.id },
		...(thread.eve_session_id
			? { initialSession: { sessionId: thread.eve_session_id, streamIndex: 0 }, resume: true }
			: {}),
	});

	const isBusy = agent.status === "submitted" || agent.status === "streaming";
	const isResuming = agent.status === "resuming";

	// El input pendiente de la tool vive en part.input del dynamic-tool con
	// state "approval-requested"; el requestId, en toolMetadata.eve.inputRequest.
	const pendingApprovals = agent.data.messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (part.type !== "dynamic-tool" || part.state !== "approval-requested") return [];
			const request = part.toolMetadata?.eve?.inputRequest;
			if (!request) return [];
			return [{ requestId: request.requestId, input: part.input as SendEmailInput }];
		}),
	);

	return (
		<section className="space-y-4">
			<p className="text-muted-foreground text-sm">
				Modelo del hilo: <code>{thread.model ?? "el default del cliente"}</code>. eve fija el
				modelo al abrir la sesión: para usar otro, abrí un hilo nuevo.
			</p>

			<div className="space-y-2">
				{agent.data.messages.map((message) => (
					<article key={message.id}>
						<strong>{message.role}:</strong>{" "}
						{message.parts
							.filter((part) => part.type === "text")
							.map((part) => (
								<span key={`${message.id}-text-${part.stepIndex}`}>{part.text}</span>
							))}
					</article>
				))}
			</div>

			{pendingApprovals.map(({ requestId, input }) => (
				<fieldset className="rounded border p-3" key={requestId}>
					<legend className="px-1 text-sm">Aprobación pendiente: enviar email</legend>
					<p>
						<strong>Para:</strong> {input.to ?? "(sin destinatario)"}
					</p>
					<p>
						<strong>Asunto:</strong> {input.subject ?? "(sin asunto)"}
					</p>
					<p className="whitespace-pre-wrap">
						<strong>Cuerpo:</strong>
						{"\n"}
						{input.body ?? "(sin cuerpo)"}
					</p>
					<div className="mt-2 flex gap-2">
						<Button
							onClick={() => void agent.respond([{ requestId, optionId: "approve" }])}
							type="button"
						>
							Aprobar
						</Button>
						<Button
							onClick={() => void agent.respond([{ requestId, optionId: "cancel" }])}
							type="button"
							variant="outline"
						>
							Rechazar
						</Button>
					</div>
				</fieldset>
			))}

			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const message = text.trim();
					if (message.length === 0 || isResuming) return;

					void agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
					if (!thread.title) void renameConversation(thread.id, message, slug);
					setText("");
				}}
			>
				<input
					className="flex-1 rounded border px-3 py-2"
					disabled={isResuming}
					onChange={(event) => setText(event.target.value)}
					placeholder="Escribí un mensaje para el agente"
					value={text}
				/>
				<Button disabled={isResuming} type="submit">
					Enviar
				</Button>
			</form>
		</section>
	);
}
```

- [ ] **Step 4: Borrar el chat viejo**

Run: `git rm -r app/chat`
Expected: `app/chat/page.tsx` eliminado. Era andamio de la Etapa 0 y su reemplazo vive en `/[tenant]/chat`.

- [ ] **Step 5: Probar el flujo en local**

Run: `npm run dev`, entrar a `/<slug>/chat`, abrir un hilo nuevo, mandar un mensaje.
Expected: el agente responde; en la base, `conversations.eve_session_id` quedó escrito y hay una fila en `runs` con `status = 'ok'`. Recargar la página y volver al hilo: el historial se rehidrata.

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add app
git commit -m "feat: chat por tenant con hilos y selector de modelo"
```

---

### Task 15: Verificación contra el deploy y cierre

**Files:**
- Modify: `tests/channel/auth.test.ts`
- Modify: `docs/01-roadmap-etapas.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el criterio de cierre verificado.

- [ ] **Step 1: Agregar el test de ownership contra el deploy**

En `tests/channel/auth.test.ts`, dentro del `describe.skipIf(!process.env.SPIKE_BASE_URL)` existente:

```ts
	it("rechaza continuar una sesión de otro usuario", async () => {
		const response = await fetch(
			`${process.env.SPIKE_BASE_URL}/eve/agents/outreach/eve/v1/session/wrun_inexistente`,
			{ method: "POST", body: JSON.stringify({ message: "hola" }) },
		);

		expect(response.status).toBe(401);
	});
```

- [ ] **Step 2: Deployar**

Run: `git push`
Expected: Vercel buildea y publica. Verificar en el dashboard que el build terminó.

- [ ] **Step 3: Correr los tests contra el deploy**

Run: `SPIKE_BASE_URL=https://agents-six-iota.vercel.app npm test -- tests/channel/auth.test.ts`
Expected: PASS, incluido el caso nuevo.

- [ ] **Step 4: Verificar el criterio de cierre a mano**

1. Entrar a `https://agents-six-iota.vercel.app/`, que redirige al tenant.
2. Abrir un hilo con un modelo y otro hilo con el otro modelo de la lista. Confirmar en `runs` que las dos sesiones existen y que el modelo cambió sin deploy.
3. Invitar un mail de prueba, aceptar desde ese mail, confirmar que aparece la membership y que el usuario nuevo solo ve su tenant.
4. Con el usuario de prueba, pedir `/<otro-slug>/chat`: tiene que dar 404.

- [ ] **Step 5: Tildar el roadmap**

En `docs/01-roadmap-etapas.md`, marcar la Etapa 1 como `[x]`, tildar sus tareas, y anotar bajo "Terminado cuando" la fecha y el resultado de la verificación.

- [ ] **Step 6: Commit y cierre**

```bash
git add tests/channel/auth.test.ts docs/01-roadmap-etapas.md
git commit -m "test: ownership de sesion contra el deploy y cierre de la etapa 1"
git push
```

Después: `/context-save`.

---

## Notas para quien implemente

- **Los tests de RLS son el corazón de la etapa.** Si un test de fuga pasa en verde antes de escribir la política, está mal escrito: probablemente la consulta corre como `postgres` y no como `authenticated`. Verificá que el `set local role authenticated` y el `request.jwt.claims` estén antes de la consulta.
- **`select *` sobre `runs` explota** por el grant por columna. Es intencional.
- **Imports relativos dentro de `agents/`**, alias `@/` en `app/` y `lib/`.
- Si algo de la API de eve no coincide con lo que dice este plan, la fuente de verdad es `node_modules/eve/docs`, no el plan. Anotá la diferencia en la spec antes de seguir.
