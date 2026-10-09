-- Ingreso por dominio de correo (spec 2026-10-09-ingreso-por-dominio-design).
--
-- 1. El modo abierto exige al menos un dominio. Antes solo lo validaba el
--    formulario de la consola.
-- 2. Candado de columnas en tenants: tenants_update deja a un tenant_admin
--    escribir cualquier columna de su fila por la API (allowed_domains,
--    active, slug, allowed_models, auth_methods, brand...). Con el ingreso
--    por dominio eso sería abrir la puerta a cualquier correo. Una sesión de
--    usuario que no es admin de plataforma solo cambia default_model y
--    self_signup_by_domain. service_role, postgres y las funciones security
--    definer no son 'authenticated' y pasan. Comparar el jsonb entero hace
--    que una columna nueva de tenants nazca cerrada.
-- 3. join_tenants_by_domain(): mismo patrón que accept_pending_invitations.
--    authenticated ya no puede insertar en memberships (20261011120000), así
--    que el alta es una función security definer.
alter table public.tenants
  add constraint tenants_self_signup_needs_domain
  check (not self_signup_by_domain or cardinality(allowed_domains) >= 1);

create or replace function public.tenants_guard_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if (select public.is_platform_admin()) then
    return new;
  end if;
  if (to_jsonb(new) - 'default_model' - 'self_signup_by_domain')
     is distinct from (to_jsonb(old) - 'default_model' - 'self_signup_by_domain') then
    raise exception 'solo plataforma puede cambiar estas columnas de tenants'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.tenants_guard_columns() from public;

create trigger tenants_guard_columns
  before update on public.tenants
  for each row execute function public.tenants_guard_columns();

create or replace function public.join_tenants_by_domain()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_domain text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return 0;
  end if;

  v_domain := split_part(v_email, '@', 2);

  for r in
    select t.id
    from public.tenants t
    where t.active
      and t.self_signup_by_domain
      and v_domain = any (select lower(d) from unnest(t.allowed_domains) d)
  loop
    insert into public.memberships (tenant_id, user_id, role)
    values (r.id, v_user, 'tenant_member')
    on conflict (tenant_id, user_id) do nothing;

    if found then
      insert into public.events (tenant_id, actor_user_id, type, summary, payload)
      values (r.id, v_user, 'membership.joined_by_domain', 'Ingreso por dominio',
              jsonb_build_object('domain', v_domain));
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.join_tenants_by_domain() from public;
revoke execute on function public.join_tenants_by_domain() from anon;
grant execute on function public.join_tenants_by_domain() to authenticated;
