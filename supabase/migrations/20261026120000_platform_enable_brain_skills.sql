-- supabase/migrations/20261026120000_platform_enable_brain_skills.sql
-- Habilitar skills/ en una empresa que no la tenía. Desde la 26.1a (brain_folders)
-- la consola no edita categorías y brain_create_folder rechaza skills como ruta
-- reservada: esta función es el único camino, y es de plataforma.

create or replace function public.platform_enable_brain_skills(
  p_actor uuid,
  p_tenant uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_connection uuid;
  v_config jsonb;
  v_has_folder boolean;
  v_categories jsonb;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;

  -- Primero el binding: mismo orden de bloqueo que brain_create_folder y
  -- brain_delete_folder, que serializan por tenant el tope de carpetas.
  select c.id, c.config into v_connection, v_config
  from public.tenant_connections c
  where c.tenant_id = p_tenant and c.capability = 'brain' and c.provider = 'wiki'
  for update;
  if v_connection is null then
    raise exception 'la empresa no tiene brain' using errcode = '23514', hint = 'consola';
  end if;

  select exists (
    select 1 from public.brain_folders where tenant_id = p_tenant and path = 'skills'
  ) into v_has_folder;
  -- Ya habilitadas: no hay nada que cambiar ni que registrar.
  if v_has_folder and (v_config -> 'categories') ? 'skill' then
    return false;
  end if;

  if not v_has_folder and (
    select count(*) from public.brain_folders
    where tenant_id = p_tenant and position('/' in path) = 0
  ) >= 20 then
    raise exception 'el brain ya tiene 20 carpetas de primer nivel: borrá una antes de habilitar skills'
      using errcode = '23514', hint = 'consola';
  end if;

  perform public.brain_ensure_folders(p_tenant, 'skills', p_actor);
  -- Con la carpeta ya creada pero sin la categoría (config desfasada), ensure no
  -- sincroniza: se hace acá, siempre.
  perform public.brain_sync_categories(p_tenant);

  select config -> 'categories' into v_categories
  from public.tenant_connections where id = v_connection;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.skills_enabled', 'skills',
          jsonb_build_object('categories', v_categories));
  return true;
end;
$$;

revoke execute on function public.platform_enable_brain_skills(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.platform_enable_brain_skills(uuid, uuid) to service_role;
