-- Las aristas del grafo (spec orquestación §6). Una fila es "este workflow
-- tiene que procesar este sujeto". Estado operativo, derivado y descartable:
-- el resultado vive en la tabla de dominio y el hecho en events.
create type public.work_item_status as enum ('pending', 'running', 'done', 'refused', 'failed');

create table public.work_items (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workflow text not null check (length(workflow) between 1 and 100),
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_]{0,40}$'),
  -- Sin FK: el sujeto es polimórfico por subject_type.
  subject_id uuid not null,
  input_hash text not null check (length(input_hash) between 1 and 200),
  status public.work_item_status not null default 'pending',
  attempts smallint not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text check (last_error is null or length(last_error) <= 2000),
  result_reason text check (result_reason is null or length(result_reason) <= 200),
  run_id uuid references public.runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deduplica contra todo lo visto, no solo contra lo confirmado: la fila
  -- queda aunque haya terminado refused o failed (spec §6.3).
  unique (tenant_id, workflow, subject_type, subject_id, input_hash)
);

-- Parcial: el reclamo solo mira lo vivo, y done/refused/failed son la mayoría
-- de la tabla con el tiempo.
create index work_items_claim_idx
  on public.work_items (tenant_id, workflow, next_attempt_at)
  where status in ('pending', 'running');
create index work_items_run_id_idx on public.work_items (run_id);

alter table public.work_items enable row level security;

create policy work_items_select on public.work_items
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

revoke insert, update, delete on public.work_items from authenticated, anon;

-- Reclamo atómico (spec §6.4). El máximo de intentos (3) también vive en
-- lib/workflows/types.ts como MAX_ATTEMPTS: si cambia uno, cambia el otro.
create or replace function public.claim_work_items(
  p_tenant uuid,
  p_workflow text,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.work_items
language plpgsql security definer set search_path = '' as $$
begin
  -- Un proceso que muere cuenta como intento. Agotado y con el lease vencido:
  -- a failed, para que ninguna fila quede reclamable para siempre ni colgada.
  update public.work_items w
     set status = 'failed',
         last_error = 'lease vencido',
         lease_until = null,
         updated_at = now()
   where w.tenant_id = p_tenant
     and w.workflow = p_workflow
     and w.status = 'running'
     and w.lease_until < now()
     and w.attempts >= 3;

  return query
  update public.work_items w
     set status = 'running',
         attempts = w.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where w.id in (
     select c.id
       from public.work_items c
      where c.tenant_id = p_tenant
        and c.workflow = p_workflow
        and c.attempts < 3
        and (
          (c.status = 'pending' and c.next_attempt_at <= now())
          or (c.status = 'running' and c.lease_until < now())
        )
      order by c.next_attempt_at, c.id
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning w.*;
end;
$$;

revoke execute on function public.claim_work_items(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_work_items(uuid, text, integer, integer) to service_role;
