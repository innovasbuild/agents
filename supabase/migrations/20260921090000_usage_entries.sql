-- Libro de consumo (spec orquestación §7.2). Append-only, igual que events:
-- todo nodo que gasta un recurso medido deja su asiento acá. Es la base de
-- los presupuestos y, más adelante, de la facturación por tenant.
create table public.usage_entries (
  -- bigint identity y no uuid: tabla append-only de alto volumen relativo;
  -- un uuid v4 fragmenta el índice y nadie referencia estas filas desde afuera.
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  run_id uuid references public.runs (id) on delete set null,
  workflow text check (workflow is null or length(workflow) between 1 and 100),
  node text not null check (length(node) between 1 and 100),
  resource text not null check (resource ~ '^[a-z][a-z0-9_]{0,40}$'),
  amount numeric(14, 6) not null check (amount >= 0),
  unit text not null check (unit in ('usd', 'credits')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- La consulta caliente es "cuánto gastó este tenant de este recurso desde hoy".
create index usage_entries_tenant_resource_created_idx
  on public.usage_entries (tenant_id, resource, created_at desc);
-- FK sin índice = cascada y joins con seq scan.
create index usage_entries_run_id_idx on public.usage_entries (run_id);

alter table public.usage_entries enable row level security;

-- model_usd es costo interno de INNOV.AS: lo ve solo platform_admin, con el
-- mismo criterio que runs.cost_usd. El resto (créditos de terceros) lo ve el tenant.
create policy usage_entries_select on public.usage_entries
  for select to authenticated
  using (
    (select public.is_platform_admin())
    or ((select public.is_member_of(tenant_id)) and resource <> 'model_usd')
  );

revoke insert, update, delete on public.usage_entries from authenticated, anon;

-- Total de la corrida, escrito al cerrarla. Devuelve el total para no pedir
-- un segundo round-trip.
create or replace function public.set_run_cost(p_run uuid)
returns numeric language sql security definer set search_path = '' as $$
  update public.runs r
     set cost_usd = (
       select coalesce(sum(u.amount), 0)
         from public.usage_entries u
        where u.run_id = p_run and u.resource = 'model_usd'
     )
   where r.id = p_run
  returning r.cost_usd;
$$;

revoke execute on function public.set_run_cost(uuid) from public, anon, authenticated;
grant execute on function public.set_run_cost(uuid) to service_role;
