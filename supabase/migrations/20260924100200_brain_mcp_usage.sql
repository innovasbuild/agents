-- Spec etapa 11 §6.1 (D8): contador por minuto del endpoint MCP del brain, por
-- usuario y tenant. Escribe solo service_role, a través de brain_mcp_hit.
create table public.brain_mcp_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  reads integer not null default 0,
  writes integer not null default 0,
  primary key (tenant_id, user_id, window_start)
);

alter table public.brain_mcp_usage enable row level security;

revoke all on public.brain_mcp_usage from anon, authenticated;
grant select on public.brain_mcp_usage to authenticated;

create policy brain_mcp_usage_select on public.brain_mcp_usage
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create function public.brain_mcp_hit(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text,
  p_limit integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  if p_kind not in ('read', 'write') then
    raise exception 'brain_mcp_hit: tipo desconocido %', p_kind;
  end if;

  insert into public.brain_mcp_usage as u (tenant_id, user_id, window_start, reads, writes)
  values (
    p_tenant_id, p_user_id, v_window,
    case when p_kind = 'read' then 1 else 0 end,
    case when p_kind = 'write' then 1 else 0 end
  )
  on conflict (tenant_id, user_id, window_start) do update
    set reads = u.reads + case when p_kind = 'read' then 1 else 0 end,
        writes = u.writes + case when p_kind = 'write' then 1 else 0 end
  returning case when p_kind = 'read' then u.reads else u.writes end into v_count;

  allowed := v_count <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_window + interval '1 minute' - now())))::integer)
  end;
  return next;
end;
$$;

revoke execute on function public.brain_mcp_hit(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.brain_mcp_hit(uuid, uuid, text, integer) to service_role;
