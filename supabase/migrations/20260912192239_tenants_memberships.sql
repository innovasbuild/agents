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
