---
title: Etapa 1 · Esqueleto multi-tenant (spec)
fecha: 2026-09-12
estado: aprobada en brainstorming
modelo: Opus 5 (spec) · Sonnet 5 (implementación, sesión nueva)
fuente: docs/01-roadmap-etapas.md §Etapa 1 · docs/innovas-agents-kickoff.md §5 · docs/superpowers/specs/2026-09-12-arquitectura-plataforma-design.md
---

# Etapa 1 · Esqueleto multi-tenant

## 1. Objetivo y criterio de cierre

Dejar la plataforma con separación real entre clientes: datos aislados por la base (no por el código), usuarios que entran solo por invitación, hilos de conversación propios de cada usuario, y agentes cuyo modelo y habilitación salen de la base sin redeploy.

**Terminado cuando:**

1. Dos usuarios de tenants distintos no ven filas ajenas, con test automatizado tabla por tabla.
2. El selector cambia el modelo de la sesión sin deploy.
3. Un usuario no puede continuar ni streamear la sesión de eve de otro, verificado contra el deploy de Vercel.

Los tres se prueban solos. Ninguno es "los archivos existen".

## 2. Decisiones de esta spec

| # | Decisión | Por qué |
|---|---|---|
| D1 | Entran las tablas del núcleo de plataforma; las de dominio outbound van a su etapa | El patrón de RLS se prueba y documenta una vez; las columnas de `contacts` y `queue_items` se diseñan cuando se usen (el kickoff ya erró una: `approval_call_id` era `request_id`) |
| D2 | El tenant activo vive en la URL (`/[tenant]/...`), validado contra `memberships` en cada request | Es lo único que soporta dos pestañas con dos clientes sin estado escondido. El subdominio se puede sumar después mapeando dominio a slug, sin tocar la base |
| D3 | Cimientos del design system ahora (shadcn + marca por tenant en el layout), catálogo completo en Etapa 4 | Ninguna pantalla nace con estilos improvisados, y no se diseñan componentes para pantallas que todavía no tienen datos |
| D4 | Ownership de sesión y resolución de tenant se deciden en el `AuthFn` del canal | Los hooks de eve son observe-only: no pueden rechazar un turno. El `AuthFn` es el único punto que puede devolver 401 |
| D5 | Un `run` es un turno, no una sesión | Una sesión dura hasta 30 días; medir latencia y fallas por sesión no dice nada |
| D6 | El selector de modelo es editable solo al abrir un hilo | eve fija el modelo en `session.started`; cambiarlo a mitad de sesión no hace lo que el usuario cree |

## 3. Modelo de datos

Migraciones en `supabase/migrations/`, una por bloque temático. Todo en `public`, identificadores en minúscula, `timestamptz` siempre.

### 3.1 Enums

```sql
create type public.tenant_role as enum ('platform_admin', 'tenant_admin', 'tenant_member');
create type public.run_status as enum ('running', 'ok', 'failed', 'cancelled');
create type public.run_trigger as enum ('chat', 'schedule', 'mcp', 'webhook');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
```

### 3.2 Tablas

```sql
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
```

Notas de esquema:

- `allowed_models` es lo que hace seguro el selector: sin esa lista, cualquier usuario se manda un Opus por turno.
- `events.executor_id` y el trigger de dedup (mismo `contact_key` y `type` en dos horas) entran en la Etapa 3 junto con `executors` y `contacts`, que es cuando existen las FK.
- `events.payload` entra ahora porque la auditoría de carga de llaves (D3 de la spec de arquitectura) ya está decidida para la Etapa 2 y evita migrar la tabla append-only.
- `runs.eve_turn_id` permite cerrar el `run` correcto si llegan turnos solapados.

### 3.3 Diferido con el patrón ya escrito

`tenant_connections` y `config_values` a la Etapa 2. `executors`, `accounts`, `contacts` y `queue_items` a la Etapa 3, con `queue_items.request_id` (no `approval_call_id`). `google_tokens` queda como está: la Etapa 2 la absorbe en `executors`.

## 4. RLS

### 4.1 Helpers

Los tres van `security definer` con `set search_path = ''`. El definer no es comodidad: es lo que rompe la recursión cuando la política de `memberships` necesita consultar `memberships`.

```sql
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

revoke execute on function public.is_platform_admin(), public.is_member_of(uuid),
  public.has_tenant_role(uuid, public.tenant_role[]) from public;
grant execute on function public.is_platform_admin(), public.is_member_of(uuid),
  public.has_tenant_role(uuid, public.tenant_role[]) to authenticated;
```

`has_tenant_role` **no** incluye a `platform_admin`. Las políticas lo escriben aparte, explícito.

### 4.2 Patrón

`alter table ... enable row level security` en todas. Toda función va envuelta en `(select ...)` para que Postgres la evalúe una vez por query y no una vez por fila. Lectura estándar de una tabla con `tenant_id`:

```sql
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );
```

Para tablas sin dueño individual (`tenants`, `tenant_agents`, `events`, `runs`) la lectura es `(select public.is_member_of(tenant_id)) or (select public.is_platform_admin())`.

### 4.3 Lo que no es uniforme

**`memberships`, escalada de privilegio.** Un `tenant_admin` administra su tenant, pero no puede coronarse:

```sql
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

**`conversations`, leer y continuar son permisos distintos.** El dueño lee y escribe lo suyo; `tenant_admin` y `platform_admin` leen las del tenant (es el "evaluar conversaciones" de la reunión), pero **continuar una sesión de eve exige `user_id = auth.uid()`** y eso lo valida el canal, no la RLS. En detalle: insert con `with check (user_id = (select auth.uid()) and (select public.is_member_of(tenant_id)))`; update solo del dueño (título y `last_message_at`; `eve_session_id` lo escribe el hook con `service_role`); delete del dueño o de un `tenant_admin` del tenant.

**`events`, append-only del motor.** Lectura para miembros; escritura solo por `service_role`, que bypassea RLS. Además, a nivel de grants:

```sql
revoke insert, update, delete on public.events from authenticated, anon;
```

El `revoke` no bloquea a `accept_pending_invitations()`: una función `security definer` corre con los privilegios de su dueño, no con los del que la llama. Es justamente por eso que la escritura de `events` pasa por ahí y no por una política.

**`runs.cost_usd`, visibilidad por columna.** La RLS es por fila. Un `revoke` de columna suelto no alcanza si existe el grant de tabla, así que se revoca la tabla y se re-otorga por columna:

```sql
revoke select on public.runs from authenticated;
grant select (id, tenant_id, agent, trigger, eve_session_id, eve_turn_id,
  conversation_id, status, error, started_at, finished_at) on public.runs to authenticated;
revoke insert, update, delete on public.runs from authenticated, anon;
```

Consecuencia práctica que la implementación tiene que respetar: **no se puede hacer `select *` sobre `runs`**, hay que nombrar columnas. El `platform_admin` lee el costo por una función `security definer` que chequea el rol:

```sql
create or replace function public.run_cost_usd(p_run uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select r.cost_usd from public.runs r
  where r.id = p_run and public.is_platform_admin();
$$;
```

**`tenants`.** Lee todo miembro. Update de `brand`, `allowed_models` y `default_model` por `tenant_admin`; insert y delete solo `platform_admin`.

**`invitations`.** Solo admins del tenant, en lectura y escritura. El invitado no lee la tabla: recibe un mail.

## 5. Identidad, alta y sesión

### 5.1 Login

Google y magic link, los dos nativos de Supabase Auth. Sin contraseñas. Microsoft (Azure) se habilita cuando un cliente lo pida: es configuración del proyecto, no código.

### 5.2 Invitación

`POST /api/invitations` (server, `service_role`), autorizado por `tenant_admin` del tenant o `platform_admin`:

1. Normaliza el mail a minúsculas.
2. Valida contra `tenants.allowed_domains`. Si cae fuera, rechaza con un error claro. El admin puede agregar el dominio o mandar `allow_external: true`, que queda asentado en `events` con tipo `invitation.external`. **`allowed_domains` valida al invitar, no es puerta de entrada**: quien deja de trabajar en el cliente pierde el acceso cuando se le saca la membership, no cuando le cierran el mail.
3. Inserta la fila `pending` y llama a `auth.admin.inviteUserByEmail(email, { redirectTo })`.

No hay token propio. El magic link lo emite Supabase y el binding es el mail verificado, así que no sumamos un secreto más para custodiar.

### 5.3 Aceptación

El invitado hace click, cae en `/auth/callback` con sesión válida, y el callback llama a una función transaccional e idempotente:

```sql
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
    values (r.tenant_id, v_user, 'invitation.accepted',
            'Invitación aceptada', jsonb_build_object('invitation_id', r.id, 'role', r.role));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
```

Dos clicks crean una sola membership. Sin membership y sin invitación: pantalla `/sin-acceso`, no un 404 ni un loop de login.

### 5.4 Resolución de tenant

`app/[tenant]/layout.tsx` traduce slug a tenant y verifica membership en el server. Si no sos miembro: **404, no 403**. Un 403 confirma que el cliente existe. `/` redirige al único tenant si tenés uno y muestra selector si tenés varios.

### 5.5 Refresco de sesión (deuda de la Etapa 0)

Dos piezas que cubren cosas distintas:

- `middleware.ts` con `updateSession` de `@supabase/ssr`: refresca en cada navegación del lado server. El matcher excluye `/eve/*` para no meterse con el streaming.
- El cliente de browser en la página de chat, que autorefresca y reescribe la cookie. Es lo que mantiene viva una pestaña abierta tres horas sin navegar.

## 6. eve por tenant

### 6.1 El canal decide todo

`agents/outreach/channels/eve.ts` es el único lugar que puede rechazar: los hooks son observe-only ("Handlers are observe-only", `guides/hooks.md`), y la doc de eve dice explícitamente que el ownership de sesión es política de la aplicación ("Route auth does not enforce session ownership", `guides/auth-and-route-protection.md`).

El `AuthFn` corre en cada request y bifurca según la ruta, que trae el `sessionId` en el path (`POST /eve/v1/session/:sessionId`):

**Crear sesión** (`POST /eve/v1/session`): el browser manda `x-innovas-conversation` con el id de la fila que la app creó antes de `send()`. El canal verifica, con el cliente admin:

1. La conversación existe y `user_id` es el caller.
2. El caller es miembro del tenant de esa conversación.
3. `tenant_agents` tiene el agente `enabled` para ese tenant.

**Continuar, streamear, cancelar, compactar**: tenant y dueño salen de `conversations` buscando por `eve_session_id`. **No se usa lo que manda el browser.** Si no hay fila o `user_id` no coincide, el `AuthFn` devuelve `null` y eve responde 401.

En los dos casos estampa:

```ts
{
  authenticator: "app",
  issuer: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  principalId: caller.userId,
  principalType: "user",
  subject: caller.userId,
  attributes: {
    email: caller.email,
    tenantId, tenantSlug, conversationId,
    role,
  },
}
```

`localDev()` sigue condicionado por `VERCEL_ENV`, igual que en la Etapa 0.

Costo: cada request de eve suma una consulta a `conversations` por índice unique, más el `auth.getUser()` que ya hacía. Aceptable para chat.

### 6.2 Hooks, con criterios de falla opuestos

Un hook que tira corta el turno (`guides/hooks.md`: "A thrown handler ... surfaces as `turn.failed`"). Por eso los dos hooks se comportan distinto a propósito:

- `agents/outreach/hooks/bind-session.ts`, en `session.started`: escribe `eve_session_id = ctx.session.id` en la conversación de `attributes.conversationId`. **Si falla, que falle el turno**: sin esa fila nadie va a poder continuar la sesión, así que es mejor que el usuario reintente ahora.
- `agents/outreach/hooks/runs.ts`, en `turn.started`, `turn.completed`, `turn.failed` y `turn.cancelled`: inserta el `run` y lo cierra con `status`, `finished_at` y `error`. **Todo envuelto en try/catch**: la observabilidad nunca puede tumbar un turno real.

Un `run` es un turno (D5). El vocabulario de eventos está verificado en `concepts/sessions-runs-and-streaming.md`.

### 6.3 Modelo por tenant

`agents/outreach/agent.ts` pasa a `defineDynamic` resolviendo en `session.started`, no por turno: el prompt cache es por modelo y cambiarlo a mitad de sesión reingiere la conversación a precio sin cachear (`guides/dynamic-capabilities.md`).

Precedencia: `tenant_agents.model` → `conversations.model` (lo que eligió el usuario) → `tenants.default_model`. Siempre validado contra `tenants.allowed_models`; si llega uno que no está en la lista, gana el default y queda un evento `model.rejected`.

Las instrucciones quedan dinámicas por tenant pero mínimas en esta etapa: nombre del cliente y su canon en `tenants/<slug>/skills/`. El contenido real es Etapa 3.

## 7. UI y theming

Rutas de la etapa, nada más:

| Ruta | Qué hace |
|---|---|
| `/` | Redirige al único tenant, o selector si tenés varios |
| `/[tenant]/chat` | Lista de hilos propios + chat con aprobación |
| `/[tenant]/settings/usuarios` | Miembros, invitar, revocar |
| `/sin-acceso` | Sesión válida sin membership ni invitación |

**Theming.** shadcn/ui sobre Tailwind v4. `app/[tenant]/layout.tsx` lee `tenants.brand` y escribe `--primary` y `--secondary` como CSS variables; los `-foreground` se derivan por contraste con una función pura testeable, para que el color de un cliente no deje texto ilegible. El logo sale de un bucket `brand` de Storage, lectura pública, escritura restringida por política a admins del tenant con `(storage.foldername(name))[1] = slug`. En esta etapa el logo se sube a mano; la pantalla de carga es Etapa 4. Un solo set de componentes para todos: la marca cambia variables, nunca variantes.

**Chat.** Lista de hilos desde `conversations` (propios, por `last_message_at`). El botón de hilo nuevo crea la fila antes de `send()`. El chat se monta con `key={conversation.id}`, `initialSession` y `resume: true`, que es lo que la doc pide para hilos múltiples. El título son las primeras palabras del primer mensaje, sin gastar un modelo en eso.

**Selector de modelo.** Opciones desde `tenants.allowed_models`. Editable solo al abrir un hilo nuevo; en un hilo existente muestra con qué modelo arrancó, deshabilitado, con la acción "hilo nuevo con otro modelo". Mentirle al usuario en la UI sería peor que no tener selector.

La cola de aprobación del chat se muda tal cual desde `/chat`, sin rediseñarla. El input de la tool sigue viniendo en `part.input` del part `dynamic-tool` con `state === "approval-requested"` (hallazgo 6 de la spec 00).

## 8. Tests

**pgTAP en `supabase/tests/`** (`supabase test db`, con Docker Desktop abierto):

- Fuga entre tenants, tabla por tabla: el usuario de A consulta filas de B y recibe **cero filas, no un error**.
- `platform_admin` que sí ve todo.
- `tenant_admin` que no puede leer `cost_usd` ni ascenderse a `platform_admin`.
- `tenant_admin` que lee las conversaciones de su tenant pero no las de otro.
- `accept_pending_invitations()` dos veces seguidas: una sola membership.
- Invitación vencida que no crea nada.
- Ninguna política recursa (una consulta simple a `memberships` termina).

**Vitest**:

- Resolución de tenant y derivación de contraste, como funciones puras.
- Ownership del canal, con `Request` armado a mano y el cliente admin mockeado: crear con conversación ajena, continuar con sesión ajena, agente deshabilitado.
- `tests/channel/auth.test.ts` contra el deploy (`SPIKE_BASE_URL`), extendido con "usuario B pide la sesión de A y recibe 401".

**Seed** (`supabase/seed.sql`): tenant `innovas` con un usuario `platform_admin`, tenant `demo` con un `tenant_member`, y la fila de `tenant_agents` para `outreach` en los dos (sin esa fila el canal rechaza todo, que es el comportamiento correcto). Es lo que hace posible el test de fuga. En la nube, la membership real se crea con un SQL puntual con el user id verdadero.

## 9. Entregas

El plan se parte en dos, en este orden:

1. **Base de datos**: migraciones, helpers, políticas, grants, funciones, seed y pgTAP. Se valida sola, sin tocar la app.
2. **App**: middleware de sesión, invitaciones, resolución de tenant, canal, hooks, `defineDynamic`, shadcn con marca, chat con hilos y selector.

## 10. Fuera de alcance

`tenant_connections`, `config_values` y Supabase Vault (Etapa 2). `executors`, `accounts`, `contacts`, `queue_items` y el trigger de dedup (Etapa 3). Catálogo de componentes, dashboard y pantalla de carga de llaves (Etapa 4). Self-signup por dominio: el flag se modela apagado y no se implementa. Verificación de la app de Google y migración de Gmail a Connect (Etapa 2).

## 11. Deuda que esta etapa deja anotada

| Para | Qué |
|---|---|
| Etapa 2 | `google_tokens` se absorbe en `executors`; refresh token a Vault |
| Etapa 4 | Carga del logo y de la marca desde la UI; hoy se sube a mano al bucket |
| Etapa 4 | Accesibilidad del theming cuando el color primario del cliente no da contraste ni derivando |
| Etapa 9 | Agregados de `runs` (p50, p95, tasa de falla) y la pantalla de ejecuciones |
| Cuando duela | `runs` crece un registro por turno; si el volumen lo pide, particionar por fecha |
