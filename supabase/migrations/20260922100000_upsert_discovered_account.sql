-- Upsert atómico para cuentas descubiertas (revisión Task 6, ronda 1). El
-- store hacía un select de existencia y después un upsert: entre esas dos
-- llamadas hay una ventana TOCTOU donde `research_account` (tool de chat sin
-- lease) puede crear la cuenta con research real, y el upsert de
-- descubrimiento la pisaría con `ficha: {}`. Esta función resuelve todo en
-- una sola sentencia: `ficha`/`expires_at` solo se tocan en el insert, nunca
-- en el "do update set", así que no hay ventana que cerrar.
create or replace function public.upsert_discovered_account(
  p_tenant_id uuid,
  p_domain text,
  p_name text,
  p_firmographics jsonb,
  p_external_ids jsonb
)
returns uuid
language sql security definer set search_path = '' as $$
  insert into public.accounts (tenant_id, domain, name, ficha, expires_at, firmographics, external_ids)
  values (p_tenant_id, p_domain, p_name, '{}'::jsonb, now(), p_firmographics, p_external_ids)
  on conflict (tenant_id, domain) do update set
    name = excluded.name,
    firmographics = excluded.firmographics,
    external_ids = excluded.external_ids
  returning id;
$$;

revoke execute on function public.upsert_discovered_account(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_discovered_account(uuid, text, text, jsonb, jsonb) to service_role;
