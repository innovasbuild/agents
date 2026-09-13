-- Bindings de un tenant con un proveedor de conector, y ejecutores de outreach.
-- Las credenciales NO viven acá: `connector_uid` es el identificador (no
-- secreto) de un conector de Vercel Connect. Spec 02 §3.

create type public.connector_capability as enum ('crm', 'leads', 'enrichment', 'brain', 'mail');

create table public.tenant_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  capability public.connector_capability not null,
  -- Se valida contra el registro de lib/connectors/providers.ts en código;
  -- el check solo impide basura. Sumar un proveedor no requiere migración.
  provider text not null check (provider ~ '^[a-z][a-z0-9-]{0,40}$'),
  connector_uid text check (connector_uid is null or length(connector_uid) between 1 and 200),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- La unique tiene tenant_id como primera columna: sirve de índice para la
  -- RLS y para la consulta del resolver, no hace falta otro.
  unique (tenant_id, capability, provider)
);

create table public.executors (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  daily_quota integer not null default 30 check (daily_quota >= 0),
  gmail_authorized_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index executors_user_id_idx on public.executors (user_id);

alter table public.tenant_connections enable row level security;
alter table public.executors enable row level security;

create policy tenant_connections_select on public.tenant_connections
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

create policy executors_select on public.executors
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

-- Sin políticas de escritura y además sin privilegio: un binding reapuntado a
-- otro conector es acceso a las credenciales de otro tenant. Escribe solo el
-- servidor con la service role (scripts/connections-bind.mts, hooks).
revoke insert, update, delete on public.tenant_connections from authenticated, anon;
revoke insert, update, delete on public.executors from authenticated, anon;
revoke select on public.tenant_connections from anon;
revoke select on public.executors from anon;
