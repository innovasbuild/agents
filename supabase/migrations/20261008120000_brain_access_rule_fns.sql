-- Cambios de reglas de acceso del brain (spec etapa 17 §4.4). La regla y el
-- evento brain.access_changed se escriben en una transacción: o quedan las dos
-- cosas o ninguna. Solo las ejecuta el servidor (service_role).

create or replace function public.brain_set_access_rule(
  p_tenant_id uuid,
  p_path text,
  p_principal public.brain_access_principal,
  p_user_id uuid,
  p_level public.brain_access_level,
  p_actor uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.brain_access_rules (tenant_id, path, principal, user_id, level, created_by)
  values (p_tenant_id, p_path, p_principal, p_user_id, p_level, p_actor)
  on conflict (tenant_id, path, principal, user_id)
  do update set level = excluded.level, updated_at = now();

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.access_changed',
    coalesce(nullif(p_path, ''), '(raíz)'),
    jsonb_build_object(
      'path', p_path,
      'principal', p_principal,
      'user_id', p_user_id,
      'level', p_level,
      'action', 'set'
    )
  );
end;
$$;

create or replace function public.brain_remove_access_rule(
  p_tenant_id uuid,
  p_path text,
  p_principal public.brain_access_principal,
  p_user_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.brain_access_rules
  where tenant_id = p_tenant_id
    and path = p_path
    and principal = p_principal
    and user_id is not distinct from p_user_id;

  -- Quitar lo que ya no está no cambia nada: no deja evento.
  if not found then
    return;
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.access_changed',
    coalesce(nullif(p_path, ''), '(raíz)'),
    jsonb_build_object(
      'path', p_path,
      'principal', p_principal,
      'user_id', p_user_id,
      'level', null,
      'action', 'remove'
    )
  );
end;
$$;

revoke execute on function public.brain_set_access_rule(
  uuid, text, public.brain_access_principal, uuid, public.brain_access_level, uuid
) from public, anon, authenticated;
revoke execute on function public.brain_remove_access_rule(
  uuid, text, public.brain_access_principal, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.brain_set_access_rule(
  uuid, text, public.brain_access_principal, uuid, public.brain_access_level, uuid
) to service_role;
grant execute on function public.brain_remove_access_rule(
  uuid, text, public.brain_access_principal, uuid, uuid
) to service_role;
