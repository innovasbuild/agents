-- Sembrador de refresh-fichas (spec orquestación §6.2 y §6.3). Devuelve las
-- cuentas vencidas que el workflow todavía no encoló desde su último research.
-- Sin el "todavía no encoló", una cuenta que el workflow ya rechazó
-- (sin_ancla) sigue vencida para siempre, ocupa el límite y deja sin turno a
-- las que vencen después. enqueue() igual deduplica por huella: son dos capas.

create index accounts_tenant_expires_idx
  on public.accounts (tenant_id, expires_at);

create or replace function public.refresh_fichas_candidates(
  p_tenant uuid,
  p_now timestamptz,
  p_limit integer
)
returns table (
  id uuid,
  domain text,
  name text,
  researched_at timestamptz,
  expires_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.domain, a.name, a.researched_at, a.expires_at
    from public.accounts a
   where a.tenant_id = p_tenant
     and a.expires_at <= p_now
     and not exists (
       select 1
         from public.work_items w
        where w.tenant_id = a.tenant_id
          and w.workflow = 'refresh-fichas'
          and w.subject_type = 'account'
          and w.subject_id = a.id
          and w.created_at >= a.researched_at
     )
   order by a.expires_at, a.id
   limit greatest(p_limit, 0);
$$;

revoke execute on function public.refresh_fichas_candidates(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.refresh_fichas_candidates(uuid, timestamptz, integer) to service_role;
