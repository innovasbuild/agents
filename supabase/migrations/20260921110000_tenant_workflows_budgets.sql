-- Configuración de workflows por tenant (spec orquestación §10), presupuestos
-- (§7.2) y las columnas que runs necesita para una pasada de workflow (§6.6).

-- Espejo de tenant_agents. enabled nace en false, al revés que los agentes:
-- un workflow desatendido gasta plata solo.
create table public.tenant_workflows (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Validado contra lib/workflows/registry.ts en código; sin FK.
  workflow text not null check (length(workflow) between 1 and 100),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, workflow)
);

-- Tabla aparte y no adentro de tenant_workflows: un recurso se comparte entre
-- workflows, y es regla congelada (spec §8.3). Sin fila, el límite es cero.
create table public.tenant_budgets (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  resource text not null check (resource ~ '^[a-z][a-z0-9_]{0,40}$'),
  daily_limit numeric(14, 6) not null check (daily_limit >= 0),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, resource)
);

create index tenant_budgets_updated_by_idx on public.tenant_budgets (updated_by);

alter table public.tenant_workflows enable row level security;
alter table public.tenant_budgets enable row level security;

create policy tenant_workflows_select on public.tenant_workflows
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

create policy tenant_budgets_select on public.tenant_budgets
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

revoke insert, update, delete on public.tenant_workflows from authenticated, anon;
revoke insert, update, delete on public.tenant_budgets from authenticated, anon;

-- Una pasada de workflow en runs. El valor nuevo del enum no se usa en esta
-- misma migración: Postgres no lo permite dentro de la transacción que lo crea.
alter type public.run_status add value if not exists 'budget_exhausted';

alter table public.runs
  add column workflow text check (workflow is null or length(workflow) between 1 and 100),
  add column items_claimed integer check (items_claimed is null or items_claimed >= 0),
  add column items_ok integer check (items_ok is null or items_ok >= 0),
  add column items_refused integer check (items_refused is null or items_refused >= 0),
  add column items_failed integer check (items_failed is null or items_failed >= 0);

-- runs tiene grants por columna (el costo es invisible): las nuevas se otorgan a mano.
grant select (workflow, items_claimed, items_ok, items_refused, items_failed)
  on public.runs to authenticated;

create index runs_tenant_workflow_started_idx
  on public.runs (tenant_id, workflow, started_at desc)
  where workflow is not null;

-- Lo gastado de un recurso desde una fecha; con p_run, acotado a una pasada.
create or replace function public.usage_sum(
  p_tenant uuid,
  p_resource text,
  p_since timestamptz,
  p_run uuid default null
)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(u.amount), 0)
    from public.usage_entries u
   where u.tenant_id = p_tenant
     and u.resource = p_resource
     and u.created_at >= p_since
     and (p_run is null or u.run_id = p_run);
$$;

revoke execute on function public.usage_sum(uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.usage_sum(uuid, text, timestamptz, uuid) to service_role;
