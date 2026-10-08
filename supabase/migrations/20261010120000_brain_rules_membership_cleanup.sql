-- Seguimiento de la Etapa 17: las reglas por persona de brain_access_rules no
-- sobrevivían a la membresía. Si se sacaba a alguien del tenant y se lo
-- reinvitaba, sus reglas (incluido "administrador") volvían solas. Ahora se
-- van con la membresía y cada una deja su evento brain.access_changed.
-- Antes de tocar SQL: supabase-postgres-best-practices (security definer con
-- search_path vacío, objetos con esquema, privilegios mínimos).

-- Trigger: al borrar una membresía se borran las reglas por persona de ese
-- tenant. security definer porque la tabla de reglas no admite escritura desde
-- la sesión. El evento se omite si el tenant ya no existe (borrado en cascada
-- del tenant entero: el evento no tendría a quién colgarse).
create or replace function public.brain_access_rules_on_membership_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with removed as (
    delete from public.brain_access_rules
    where tenant_id = old.tenant_id
      and principal = 'user'
      and user_id = old.user_id
    returning path
  )
  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  select
    old.tenant_id,
    (select auth.uid()),
    'brain.access_changed',
    coalesce(nullif(path, ''), '(raíz)'),
    jsonb_build_object(
      'path', path,
      'principal', 'user',
      'user_id', old.user_id,
      'level', null,
      'action', 'remove',
      'reason', 'membership_removed'
    )
  from removed
  where exists (select 1 from public.tenants t where t.id = old.tenant_id);

  return old;
end;
$$;

revoke execute on function public.brain_access_rules_on_membership_delete()
  from public, anon, authenticated;

create trigger memberships_brain_rules_cleanup
  after delete on public.memberships
  for each row
  execute function public.brain_access_rules_on_membership_delete();

-- Limpieza de lo que ya quedó huérfano antes de este trigger. Es una función
-- (y no solo una sentencia) para poder probarla y volver a correrla.
create or replace function public.brain_cleanup_orphan_access_rules()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_removed integer;
begin
  with removed as (
    delete from public.brain_access_rules r
    where r.principal = 'user'
      and not exists (
        select 1 from public.memberships m
        where m.tenant_id = r.tenant_id and m.user_id = r.user_id
      )
    returning r.tenant_id, r.path, r.user_id
  ), logged as (
    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    select
      tenant_id,
      null,
      'brain.access_changed',
      coalesce(nullif(path, ''), '(raíz)'),
      jsonb_build_object(
        'path', path,
        'principal', 'user',
        'user_id', user_id,
        'level', null,
        'action', 'remove',
        'reason', 'orphan_cleanup'
      )
    from removed
    returning 1
  )
  select count(*)::integer into v_removed from removed;

  return v_removed;
end;
$$;

revoke execute on function public.brain_cleanup_orphan_access_rules()
  from public, anon, authenticated;
grant execute on function public.brain_cleanup_orphan_access_rules() to service_role;

select public.brain_cleanup_orphan_access_rules();
