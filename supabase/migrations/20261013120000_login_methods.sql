-- supabase/migrations/20261013120000_login_methods.sql
-- Métodos de login impuestos (spec 2026-10-09-etapa-20-login-design, 20.1).
--
-- 1. microsoft es un método válido de tenants.auth_methods.
-- 2. current_login_method(): con qué método se abrió ESTA sesión. Sale del
--    claim amr del JWT y de auth.identities; nunca de un parámetro, porque
--    las funciones que crean membresías las puede llamar cualquier usuario
--    logueado. GoTrue no pone el proveedor en amr (solo para SAML), pero un
--    login OAuth actualiza identities.last_sign_in_at y uno por correo no.
-- 3. Una sesión de Azure solo cuenta si su identidad trae xms_edov
--    verdadero: sin ese claim GoTrue da el correo por verificado aunque
--    Microsoft no lo haya verificado.
-- 4. Las dos altas (invitación y dominio) solo crean membresías en empresas
--    que permiten el método. login_gate() decide el corte al entrar y
--    tenant_allows_login() cada request.
alter table public.tenants drop constraint tenants_auth_methods_valid;
alter table public.tenants add constraint tenants_auth_methods_valid check (
  cardinality(auth_methods) >= 1
  and auth_methods <@ array['email', 'google', 'microsoft']
);

create or replace function public.current_login_method()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_amr jsonb := (select auth.jwt()) -> 'amr';
  v_method text;
  v_provider text;
  v_edov text;
begin
  if v_user is null or v_amr is null or jsonb_typeof(v_amr) <> 'array' then
    return null;
  end if;

  -- La entrada más nueva entre los métodos de login que conocemos. Las de
  -- MFA (totp...) no son un método de login y no se miran.
  select e ->> 'method' into v_method
  from jsonb_array_elements(v_amr) e
  where jsonb_typeof(e) = 'object'
    and e ->> 'method' in ('otp', 'magiclink', 'invite', 'email/signup', 'recovery', 'oauth')
  order by case when e ->> 'timestamp' ~ '^[0-9]+$' then (e ->> 'timestamp')::numeric end desc nulls last
  limit 1;

  if v_method is null then
    return null;
  end if;
  if v_method <> 'oauth' then
    return 'email';
  end if;

  select i.provider, i.identity_data -> 'custom_claims' ->> 'xms_edov'
    into v_provider, v_edov
  from auth.identities i
  where i.user_id = v_user and i.provider in ('google', 'azure')
  order by i.last_sign_in_at desc nulls last
  limit 1;

  if v_provider = 'google' then
    return 'google';
  end if;
  if v_provider = 'azure' and v_edov in ('true', '1') then
    return 'microsoft';
  end if;
  return null;
end;
$$;

revoke execute on function public.current_login_method() from public;
revoke execute on function public.current_login_method() from anon;
grant execute on function public.current_login_method() to authenticated;

create or replace function public.tenant_allows_login(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (select public.current_login_method()) = any (t.auth_methods)
    from public.tenants t
    where t.id = p_tenant and t.active
  ), false);
$$;

revoke execute on function public.tenant_allows_login(uuid) from public;
revoke execute on function public.tenant_allows_login(uuid) from anon;
grant execute on function public.tenant_allows_login(uuid) to authenticated;

create or replace function public.accept_pending_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_method text;
  v_email text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
  end if;

  v_method := public.current_login_method();
  if v_method is null then
    return 0;
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email is null then
    return 0;
  end if;

  for r in
    update public.invitations i
       set status = 'accepted', accepted_at = now(), accepted_user_id = v_user
      from public.tenants t
     where t.id = i.tenant_id
       and t.active
       and v_method = any (t.auth_methods)
       and i.email = v_email and i.status = 'pending' and i.expires_at > now()
    returning i.id, i.tenant_id, i.role
  loop
    insert into public.memberships (tenant_id, user_id, role)
    values (r.tenant_id, v_user, r.role)
    on conflict (tenant_id, user_id) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.join_tenants_by_domain()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_method text;
  v_email text;
  v_domain text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
  end if;

  v_method := public.current_login_method();
  if v_method is null then
    return 0;
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
      and v_method = any (t.auth_methods)
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

create or replace function public.login_gate()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_method text;
  v_email text;
  v_domain text;
  v_landing text;
begin
  if v_user is null then
    raise exception 'no authenticated user';
  end if;

  v_method := public.current_login_method();

  if exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and t.active and v_method = any (t.auth_methods)
  ) then
    return jsonb_build_object('allowed', true, 'landing', null);
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email ~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    v_domain := split_part(v_email, '@', 2);
  end if;

  -- Las empresas que la esperan: donde ya es miembro, donde tiene una
  -- invitación pendiente y donde su dominio está abierto. En ese orden.
  select w.slug into v_landing
  from (
    select t.slug, 1 as ord
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and t.active
    union all
    select t.slug, 2
    from public.invitations i
    join public.tenants t on t.id = i.tenant_id
    where v_email is not null and i.email = v_email
      and i.status = 'pending' and i.expires_at > now() and t.active
    union all
    select t.slug, 3
    from public.tenants t
    where v_domain is not null and t.active and t.self_signup_by_domain
      and v_domain = any (select lower(d) from unnest(t.allowed_domains) d)
  ) w
  order by w.ord, w.slug
  limit 1;

  if v_landing is null then
    return jsonb_build_object('allowed', true, 'landing', null);
  end if;
  return jsonb_build_object('allowed', false, 'landing', v_landing);
end;
$$;

revoke execute on function public.login_gate() from public;
revoke execute on function public.login_gate() from anon;
grant execute on function public.login_gate() to authenticated;
