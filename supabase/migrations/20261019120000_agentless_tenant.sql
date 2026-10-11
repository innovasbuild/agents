-- Etapa 21.4a: una empresa puede no tener agentes, y las categorías de su brain
-- se editan desde la consola (spec 2026-10-11-etapa-21-4 §3.1 y §4.2).

-- Copia exacta de platform_create_tenant (21.1) sin el mínimo de un agente.
create or replace function public.platform_create_tenant(
  p_actor uuid,
  p_slug text,
  p_display_name text,
  p_allowed_domains text[],
  p_auth_methods text[],
  p_brand jsonb,
  p_agents text[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_agent text;
  v_agents text[] := coalesce(p_agents, '{}');
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if (select count(distinct a) from unnest(v_agents) a) <> cardinality(v_agents) then
    raise exception 'la lista de agentes tiene repetidos' using errcode = '23514', hint = 'consola';
  end if;

  insert into public.tenants (slug, display_name, allowed_domains, auth_methods, brand)
  values (p_slug, p_display_name, coalesce(p_allowed_domains, '{}'), p_auth_methods, coalesce(p_brand, '{}'::jsonb))
  returning id into v_id;

  foreach v_agent in array v_agents loop
    insert into public.tenant_agents (tenant_id, agent, config)
    values (v_id, v_agent, '{"brain": "read_write"}'::jsonb);
  end loop;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_id, p_actor, 'tenant.created', p_display_name,
          jsonb_build_object('slug', p_slug, 'agents', to_jsonb(v_agents)));

  return v_id;
end;
$$;

create or replace function public.platform_set_brain_categories(
  p_actor uuid,
  p_tenant uuid,
  p_categories text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_categories text[] := coalesce(p_categories, '{}');
  v_connection uuid;
  v_bad text;
  v_used text;
  v_count int;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if cardinality(v_categories) < 1 or cardinality(v_categories) > 20 then
    raise exception 'el brain necesita entre 1 y 20 categorías' using errcode = '23514', hint = 'consola';
  end if;
  -- Mismo patrón que el check de brain_pages.category.
  select c into v_bad from unnest(v_categories) c where c is null or c !~ '^[a-z][a-z0-9-]{0,40}$' limit 1;
  if found then
    raise exception 'la categoría % no es válida: minúsculas, números y guiones, empezando con una letra', coalesce(v_bad, '(vacía)')
      using errcode = '23514', hint = 'consola';
  end if;
  if (select count(distinct c) from unnest(v_categories) c) <> cardinality(v_categories) then
    raise exception 'la lista de categorías tiene repetidas' using errcode = '23514', hint = 'consola';
  end if;

  select c.id into v_connection
  from public.tenant_connections c
  where c.tenant_id = p_tenant and c.capability = 'brain'
  for update;
  if v_connection is null then
    raise exception 'la empresa no tiene brain' using errcode = '23514', hint = 'consola';
  end if;

  select p.category, count(*)::int into v_used, v_count
  from public.brain_pages p
  where p.tenant_id = p_tenant and not (p.category = any (v_categories))
  group by p.category
  order by count(*) desc, p.category
  limit 1;
  if v_used is not null then
    raise exception '%', format(
      'la categoría %s tiene %s página%s: movela%s antes de quitarla',
      v_used, v_count,
      case when v_count = 1 then '' else 's' end,
      case when v_count = 1 then '' else 's' end)
      using errcode = '23514', hint = 'consola';
  end if;

  update public.tenant_connections
  set config = jsonb_set(config, '{categories}', to_jsonb(v_categories)),
      updated_by = p_actor,
      updated_at = now()
  where id = v_connection;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.categories_set', array_to_string(v_categories, ', '),
          jsonb_build_object('categories', to_jsonb(v_categories)));
end;
$$;

revoke execute on function public.platform_set_brain_categories(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.platform_set_brain_categories(uuid, uuid, text[]) to service_role;
