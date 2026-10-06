-- Spec alta de empresas §3: métodos de login permitidos por empresa y alta
-- atómica de tenant + agente.

alter table public.tenants
  add column auth_methods text[] not null default '{email,google}'
  constraint tenants_auth_methods_valid check (
    cardinality(auth_methods) >= 1
    and auth_methods <@ array['email', 'google']
  );

-- security invoker a propósito: la RLS de tenants y tenant_agents decide quién
-- puede crear. Sin la fila de tenant_agents el canal rechaza todo, por eso las
-- dos inserciones van juntas.
create or replace function public.create_tenant(
  p_slug text,
  p_display_name text,
  p_allowed_domains text[],
  p_auth_methods text[],
  p_brand jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.tenants (slug, display_name, allowed_domains, auth_methods, brand)
  values (p_slug, p_display_name, coalesce(p_allowed_domains, '{}'), p_auth_methods, coalesce(p_brand, '{}'::jsonb))
  returning id into v_id;

  insert into public.tenant_agents (tenant_id, agent, config)
  values (v_id, 'outreach', '{"brain": "read_write"}'::jsonb);

  return v_id;
end;
$$;

revoke execute on function public.create_tenant(text, text, text[], text[], jsonb) from public;
grant execute on function public.create_tenant(text, text, text[], text[], jsonb) to authenticated;
