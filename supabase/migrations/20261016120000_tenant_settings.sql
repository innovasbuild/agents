-- Settings del cliente (spec 2026-10-10-etapa-21-2).
--
-- El administrador de una empresa configura ejecutores, aprobaciones de nivel 2
-- y el encendido de sus conectores. Las tablas siguen cerradas a escritura
-- directa: escribe por funciones security definer que verifican adentro que
-- quien llama sea administrador de ESA empresa (patrón block_member, 20.2).
-- Las reglas de negocio salen con errcode 23514 (23505 para un slug repetido)
-- y hint 'settings': la app muestra ese mensaje tal cual.

-- Plataforma apaga un conector ⇒ el cliente no lo puede encender. Con una
-- sola bandera, un cliente podría rehabilitar lo que INNOV.AS apagó por una
-- llave filtrada.
alter table public.tenant_connections
  add column locked_by_platform boolean not null default false;

-- Hasta hoy solo plataforma podía deshabilitar.
update public.tenant_connections set locked_by_platform = true where not enabled;

-- El bloqueo de plataforma implica conector apagado: nunca encendido y bloqueado.
alter table public.tenant_connections
  add constraint tenant_connections_lock_implies_disabled check (not (enabled and locked_by_platform));

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

  begin
    update public.tenant_connections
       set enabled = p_enabled, locked_by_platform = not p_enabled,
           updated_by = p_actor, updated_at = now()
     where id = p_connection
    returning tenant_id, capability || '/' || provider into v_tenant, v_summary;
  exception when unique_violation then
    raise exception 'la empresa ya tiene un brain' using errcode = '23514', hint = 'consola';
  end;
  if v_tenant is null then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_tenant, p_actor, case when p_enabled then 'connection.enabled' else 'connection.disabled' end,
          v_summary, jsonb_build_object('connection_id', p_connection));
end;
$$;

-- Copia exacta de platform_bind_connection (21.1) salvo una línea: al volver a
-- asociar un conector que plataforma había apagado, se suelta el bloqueo. Sin
-- eso quedaba encendido y bloqueado a la vez.
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
  if p_provider <> 'apollo' and cardinality(v_uids) > 1 then
    raise exception 'este proveedor lleva un solo identificador' using errcode = '23514', hint = 'consola';
  end if;
  if p_capability = 'brain' and exists (
    select 1 from public.tenant_connections c
    where c.tenant_id = p_tenant and c.capability = 'brain' and c.provider <> p_provider
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
        locked_by_platform = false,
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

-- Quién llama, o 42501. Solo la usan las funciones de abajo (corren como su
-- dueño): nadie más la ejecuta.
create or replace function public.settings_actor(p_tenant uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'no authenticated user' using errcode = '42501';
  end if;
  if not (
    (select public.has_tenant_role(p_tenant, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  ) then
    raise exception 'solo un administrador puede cambiar esto' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.set_executor(
  p_tenant uuid, p_user uuid, p_slug text, p_display_name text,
  p_title text, p_linkedin_url text, p_daily_quota integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_name text := nullif(btrim(p_display_name), '');
  v_title text := nullif(btrim(p_title), '');
  v_linkedin text := nullif(btrim(p_linkedin_url), '');
begin
  if not exists (
    select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = p_user
  ) then
    raise exception 'esa persona no es miembro de la empresa' using errcode = '23514', hint = 'settings';
  end if;
  if p_daily_quota is null or p_daily_quota < 0 or p_daily_quota > 200 then
    raise exception 'el cupo diario va de 0 a 200' using errcode = '23514', hint = 'settings';
  end if;
  if p_slug is null or p_slug !~ '^[a-z][a-z0-9-]{0,30}$' then
    raise exception 'el slug va en minúsculas, con números o guiones, y empieza con una letra'
      using errcode = '23514', hint = 'settings';
  end if;
  if v_linkedin is not null and v_linkedin !~ '^https://([a-z]{2,3}\.)?linkedin\.com/in/.+' then
    raise exception 'el LinkedIn tiene que ser una dirección https://www.linkedin.com/in/…'
      using errcode = '23514', hint = 'settings';
  end if;
  if length(v_name) > 120 or length(v_title) > 120 then
    raise exception 'el nombre y el puesto van hasta 120 caracteres' using errcode = '23514', hint = 'settings';
  end if;

  begin
    insert into public.executors (tenant_id, user_id, slug, display_name, title, linkedin_url, daily_quota)
    values (p_tenant, p_user, p_slug, v_name, v_title, v_linkedin, p_daily_quota)
    on conflict (tenant_id, user_id) do update
      set slug = excluded.slug,
          display_name = excluded.display_name,
          title = excluded.title,
          linkedin_url = excluded.linkedin_url,
          daily_quota = excluded.daily_quota;
  exception when unique_violation then
    raise exception 'ese slug ya lo usa otro ejecutor' using errcode = '23505', hint = 'settings';
  end;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'executor.updated', p_slug,
          jsonb_build_object('user_id', p_user, 'slug', p_slug, 'daily_quota', p_daily_quota));
end;
$$;

create or replace function public.remove_executor(p_tenant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_slug text;
begin
  -- Bloquea la fila del ejecutor primero: un encolado concurrente toma KEY SHARE
  -- sobre ella (clave foránea) y queda esperando, en vez de colarse entre el
  -- chequeo de historial y el borrado.
  perform 1 from public.executors e where e.tenant_id = p_tenant and e.user_id = p_user for update;

  -- Las claves foráneas hacia executors son on delete cascade (queue_items,
  -- search_focuses) o set null (contacts): borrar se llevaría el historial de
  -- envíos sin avisar. Se chequea acá, antes de tocar nada.
  if exists (select 1 from public.queue_items q where q.tenant_id = p_tenant and q.executor_user_id = p_user)
     or exists (select 1 from public.search_focuses f where f.tenant_id = p_tenant and f.created_by = p_user)
     or exists (select 1 from public.contacts c where c.tenant_id = p_tenant and c.owner_user_id = p_user)
  then
    raise exception 'tiene historial: ponele cupo 0 para que no envíe' using errcode = '23514', hint = 'settings';
  end if;

  delete from public.executors where tenant_id = p_tenant and user_id = p_user
  returning slug into v_slug;
  if not found then
    raise exception 'no es ejecutor de la empresa' using errcode = 'P0002';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'executor.removed', v_slug, jsonb_build_object('user_id', p_user));
end;
$$;

create or replace function public.set_approval(
  p_tenant uuid, p_agent text, p_node text, p_policy text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
begin
  if p_policy is null or p_policy not in ('always', 'once', 'auto') then
    raise exception 'la política tiene que ser always, once o auto' using errcode = '23514', hint = 'settings';
  end if;
  if p_node is null or p_agent is null
     or p_node !~ '^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$'
     or split_part(p_node, '/', 1) <> p_agent then
    raise exception 'ese paso no pertenece a ese agente' using errcode = '23514', hint = 'settings';
  end if;

  update public.tenant_agents
     set config = jsonb_set(
           coalesce(config, '{}'::jsonb), '{approvals}',
           coalesce(config -> 'approvals', '{}'::jsonb) || jsonb_build_object(p_node, p_policy))
   where tenant_id = p_tenant and agent = p_agent;
  if not found then
    raise exception 'la empresa no tiene ese agente' using errcode = '23514', hint = 'settings';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'approval.updated', p_node,
          jsonb_build_object('agent', p_agent, 'node', p_node, 'policy', p_policy));
end;
$$;

create or replace function public.set_connection_enabled(
  p_tenant uuid, p_connection uuid, p_enabled boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_row public.tenant_connections%rowtype;
begin
  if p_enabled is null then
    raise exception 'falta el estado' using errcode = '23514', hint = 'settings';
  end if;

  -- Filtra por empresa: una conexión de otra empresa "no existe" para quien llama.
  select * into v_row from public.tenant_connections c
   where c.id = p_connection and c.tenant_id = p_tenant
     for update;
  if not found then
    raise exception 'no existe la conexión' using errcode = 'P0002';
  end if;
  if v_row.capability = 'brain' then
    raise exception 'el brain lo maneja INNOV.AS' using errcode = '23514', hint = 'settings';
  end if;
  if p_enabled and v_row.locked_by_platform then
    raise exception 'INNOV.AS deshabilitó este conector: pedile que lo habilite'
      using errcode = '23514', hint = 'settings';
  end if;

  update public.tenant_connections
     set enabled = p_enabled, locked_by_platform = false, updated_by = v_actor, updated_at = now()
   where id = p_connection;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, case when p_enabled then 'connection.enabled' else 'connection.disabled' end,
          v_row.capability || '/' || v_row.provider,
          jsonb_build_object('connection_id', p_connection, 'actor', 'cliente'));
end;
$$;

revoke execute on function public.settings_actor(uuid) from public, anon, authenticated;

revoke execute on function public.set_executor(uuid, uuid, text, text, text, text, integer) from public, anon;
revoke execute on function public.remove_executor(uuid, uuid) from public, anon;
revoke execute on function public.set_approval(uuid, text, text, text) from public, anon;
revoke execute on function public.set_connection_enabled(uuid, uuid, boolean) from public, anon;

grant execute on function public.set_executor(uuid, uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.remove_executor(uuid, uuid) to authenticated;
grant execute on function public.set_approval(uuid, text, text, text) to authenticated;
grant execute on function public.set_connection_enabled(uuid, uuid, boolean) to authenticated;
