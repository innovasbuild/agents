-- Consola de plataforma: conectores y agentes (spec 2026-10-10-etapa-21-1).
--
-- 1. tenant_connections sabe si Vercel confirmó el conector y quién tocó la fila.
-- 2. connector_claims: un conector es de una sola empresa. Asociar a la empresa
--    B el conector de la A es darle las credenciales de A; la clave primaria lo
--    hace imposible, también para las llaves de respaldo de Apollo.
-- 3. tenant_agents se cierra a authenticated como memberships: lo que un
--    administrador de cliente pueda configurar llega en 21.2 por funciones.
-- 4. Seis funciones security definer que solo service_role ejecuta. No deciden
--    permisos (is_platform_admin() acepta una fila platform_admin de cualquier
--    tenant): el gate es requirePlatformAdmin en la app. Cada una deja su evento
--    en la misma transacción. Las reglas de negocio salen con errcode 23514 (o
--    23505 para un conector ya reclamado) y hint 'consola': la app muestra ese
--    mensaje tal cual.
alter table public.tenant_connections
  add column verified_at timestamptz,
  add column verified_name text check (verified_name is null or length(verified_name) between 1 and 200),
  add column updated_by uuid references auth.users (id) on delete set null;

create index tenant_connections_updated_by_idx on public.tenant_connections (updated_by);

create table public.connector_claims (
  connector_uid text primary key check (length(connector_uid) between 1 and 200),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null references public.tenant_connections (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index connector_claims_tenant_id_idx on public.connector_claims (tenant_id);
create index connector_claims_connection_id_idx on public.connector_claims (connection_id);

alter table public.connector_claims enable row level security;

create policy connector_claims_select on public.connector_claims
  for select to authenticated
  using ((select public.is_platform_admin()));

revoke all on public.connector_claims from anon;
revoke insert, update, delete, truncate on public.connector_claims from authenticated;
grant select on public.connector_claims to authenticated;

-- Backfill. Un identificador en dos empresas es un hecho que una persona
-- tiene que resolver antes: la migración falla nombrándolo.
do $$
declare
  v_uid text;
begin
  select u.uid into v_uid
  from (
    select c.connector_uid as uid, c.tenant_id
    from public.tenant_connections c
    where c.connector_uid is not null
    union all
    select jsonb_array_elements_text(c.config -> 'connectorUids'), c.tenant_id
    from public.tenant_connections c
    where jsonb_typeof(c.config -> 'connectorUids') = 'array'
  ) u
  group by u.uid
  having count(distinct u.tenant_id) > 1
  limit 1;

  if v_uid is not null then
    raise exception 'el conector % está asociado a más de una empresa: resolvelo antes de aplicar esta migración', v_uid;
  end if;
end $$;

insert into public.connector_claims (connector_uid, tenant_id, connection_id)
select distinct on (u.uid) u.uid, u.tenant_id, u.id
from (
  select c.connector_uid as uid, c.tenant_id, c.id
  from public.tenant_connections c
  where c.connector_uid is not null
  union all
  select jsonb_array_elements_text(c.config -> 'connectorUids'), c.tenant_id, c.id
  from public.tenant_connections c
  where jsonb_typeof(c.config -> 'connectorUids') = 'array'
) u
order by u.uid, u.id;

-- Candado de tenant_agents.
drop policy if exists tenant_agents_insert on public.tenant_agents;
drop policy if exists tenant_agents_update on public.tenant_agents;
drop policy if exists tenant_agents_delete on public.tenant_agents;
revoke insert, update, delete on public.tenant_agents from authenticated, anon;

drop function public.create_tenant(text, text, text[], text[], jsonb);

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
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if p_agents is null or cardinality(p_agents) = 0 then
    raise exception 'la empresa necesita al menos un agente' using errcode = '23514', hint = 'consola';
  end if;
  if (select count(distinct a) from unnest(p_agents) a) <> cardinality(p_agents) then
    raise exception 'la lista de agentes tiene repetidos' using errcode = '23514', hint = 'consola';
  end if;

  insert into public.tenants (slug, display_name, allowed_domains, auth_methods, brand)
  values (p_slug, p_display_name, coalesce(p_allowed_domains, '{}'), p_auth_methods, coalesce(p_brand, '{}'::jsonb))
  returning id into v_id;

  foreach v_agent in array p_agents loop
    insert into public.tenant_agents (tenant_id, agent, config)
    values (v_id, v_agent, '{"brain": "read_write"}'::jsonb);
  end loop;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_id, p_actor, 'tenant.created', p_display_name,
          jsonb_build_object('slug', p_slug, 'agents', to_jsonb(p_agents)));

  return v_id;
end;
$$;

create or replace function public.platform_set_agent(
  p_actor uuid, p_tenant uuid, p_agent text, p_enabled boolean, p_brain text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if p_brain not in ('none', 'read', 'read_write') then
    raise exception 'el acceso al brain tiene que ser none, read o read_write' using errcode = '23514', hint = 'consola';
  end if;

  insert into public.tenant_agents (tenant_id, agent, enabled, config)
  values (p_tenant, p_agent, p_enabled, jsonb_build_object('brain', p_brain))
  on conflict (tenant_id, agent) do update
    set enabled = excluded.enabled,
        config = coalesce(public.tenant_agents.config, '{}'::jsonb) || jsonb_build_object('brain', p_brain);

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'agent.updated', p_agent,
          jsonb_build_object('agent', p_agent, 'enabled', p_enabled, 'brain', p_brain));
end;
$$;

create or replace function public.platform_bind_connection(
  p_actor uuid,
  p_tenant uuid,
  p_capability public.connector_capability,
  p_provider text,
  p_connector_uids text[],
  p_config jsonb,
  p_verified_name text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uids text[] := coalesce(p_connector_uids, '{}');
  v_uid text;
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
  v_id uuid;
  v_owner uuid;
  v_connection uuid;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if (select count(distinct u) from unnest(v_uids) u) <> cardinality(v_uids) then
    raise exception 'la lista de identificadores tiene repetidos' using errcode = '23514', hint = 'consola';
  end if;
  if p_capability = 'brain' and exists (
    select 1 from public.tenant_connections c
    where c.tenant_id = p_tenant and c.capability = 'brain' and c.enabled and c.provider <> p_provider
  ) then
    raise exception 'la empresa ya tiene un brain' using errcode = '23514', hint = 'consola';
  end if;

  -- Un identificador ya reclamado por otra conexión se rechaza antes de tocar
  -- nada; la clave primaria sigue siendo la red contra una carrera.
  foreach v_uid in array v_uids loop
    select k.tenant_id, k.connection_id into v_owner, v_connection
    from public.connector_claims k where k.connector_uid = v_uid;
    if v_owner is not null and v_owner <> p_tenant then
      raise exception 'el conector % ya está asociado a otra empresa', v_uid using errcode = '23505', hint = 'consola';
    end if;
    if v_owner is not null and not exists (
      select 1 from public.tenant_connections c
      where c.id = v_connection and c.tenant_id = p_tenant and c.capability = p_capability and c.provider = p_provider
    ) then
      raise exception 'el conector % ya está asociado a otra conexión de esta empresa', v_uid using errcode = '23505', hint = 'consola';
    end if;
  end loop;

  if p_provider = 'apollo' then
    v_config := v_config || jsonb_build_object('connectorUids', to_jsonb(v_uids));
  else
    v_config := v_config - 'connectorUids';
  end if;

  insert into public.tenant_connections
    (tenant_id, capability, provider, connector_uid, config, enabled, verified_at, verified_name, updated_by, updated_at)
  values
    (p_tenant, p_capability, p_provider,
     case when cardinality(v_uids) >= 1 then v_uids[1] end,
     v_config, true,
     case when p_verified_name is null then null else now() end,
     p_verified_name, p_actor, now())
  on conflict (tenant_id, capability, provider) do update
    set connector_uid = excluded.connector_uid,
        config = excluded.config,
        enabled = true,
        verified_at = excluded.verified_at,
        verified_name = excluded.verified_name,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning id into v_id;

  delete from public.connector_claims where connection_id = v_id;
  begin
    insert into public.connector_claims (connector_uid, tenant_id, connection_id)
    select u, p_tenant, v_id from unnest(v_uids) u;
  exception when unique_violation then
    raise exception 'uno de los conectores ya está asociado a otra empresa' using errcode = '23505', hint = 'consola';
  end;

  if p_capability = 'brain' then
    insert into public.brain_access_rules (tenant_id, path, principal, user_id, level, created_by)
    values (p_tenant, '', 'members', null, 'lector', p_actor)
    on conflict do nothing;
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'connection.bound', p_capability || '/' || p_provider,
          jsonb_build_object('capability', p_capability, 'provider', p_provider,
                             'connector_uid', case when cardinality(v_uids) >= 1 then v_uids[1] end,
                             'connector_uids', to_jsonb(v_uids), 'binding_id', v_id, 'actor', 'consola'));

  return v_id;
end;
$$;

create or replace function public.platform_set_connection_enabled(
  p_actor uuid, p_connection uuid, p_enabled boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_summary text;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;

  update public.tenant_connections
     set enabled = p_enabled, updated_by = p_actor, updated_at = now()
   where id = p_connection
  returning tenant_id, capability || '/' || provider into v_tenant, v_summary;
  if v_tenant is null then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_tenant, p_actor, case when p_enabled then 'connection.enabled' else 'connection.disabled' end,
          v_summary, jsonb_build_object('connection_id', p_connection));
end;
$$;

create or replace function public.platform_remove_connection(
  p_actor uuid, p_connection uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.tenant_connections%rowtype;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;

  select * into v_row from public.tenant_connections where id = p_connection;
  if v_row.id is null then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;
  if v_row.capability = 'brain' then
    raise exception 'el brain no se quita desde la consola' using errcode = '23514', hint = 'consola';
  end if;

  delete from public.tenant_connections where id = p_connection;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_row.tenant_id, p_actor, 'connection.removed', v_row.capability || '/' || v_row.provider,
          jsonb_build_object('connection_id', p_connection, 'provider', v_row.provider,
                             'connector_uid', v_row.connector_uid));
end;
$$;

create or replace function public.platform_mark_connection_verified(
  p_actor uuid, p_connection uuid, p_verified_name text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_summary text;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;

  update public.tenant_connections
     set verified_at = case when p_verified_name is null then null else now() end,
         verified_name = p_verified_name,
         updated_by = p_actor,
         updated_at = now()
   where id = p_connection
  returning tenant_id, capability || '/' || provider into v_tenant, v_summary;
  if v_tenant is null then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_tenant, p_actor, case when p_verified_name is null then 'connection.unverified' else 'connection.verified' end,
          v_summary, jsonb_build_object('connection_id', p_connection, 'verified_name', p_verified_name));
end;
$$;

revoke execute on function public.platform_create_tenant(uuid, text, text, text[], text[], jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.platform_set_agent(uuid, uuid, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.platform_bind_connection(uuid, uuid, public.connector_capability, text, text[], jsonb, text) from public, anon, authenticated;
revoke execute on function public.platform_set_connection_enabled(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.platform_remove_connection(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.platform_mark_connection_verified(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.platform_create_tenant(uuid, text, text, text[], text[], jsonb, text[]) to service_role;
grant execute on function public.platform_set_agent(uuid, uuid, text, boolean, text) to service_role;
grant execute on function public.platform_bind_connection(uuid, uuid, public.connector_capability, text, text[], jsonb, text) to service_role;
grant execute on function public.platform_set_connection_enabled(uuid, uuid, boolean) to service_role;
grant execute on function public.platform_remove_connection(uuid, uuid) to service_role;
grant execute on function public.platform_mark_connection_verified(uuid, uuid, text) to service_role;
