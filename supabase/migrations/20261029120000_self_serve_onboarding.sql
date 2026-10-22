-- Etapa 27.1: alta self-serve. Plan, trial, suspensión, estado del onboarding,
-- investigación de la empresa y slug reservado "empezar".

-- 1. Columnas de plan y onboarding. Las empresas existentes quedan enterprise.
alter table public.tenants
  add column plan text not null default 'enterprise'
    check (plan in ('free', 'pago', 'enterprise')),
  add column trial_ends_at timestamptz,
  add column suspended_reason text
    check (suspended_reason in ('trial_vencido', 'pago_fallido', 'cancelado')),
  add column onboarding_step text
    check (onboarding_step in ('carpetas', 'logo', 'acceso', 'equipo')),
  add column onboarding_completed_at timestamptz,
  add column ai_monthly_limit_usd numeric(10, 2)
    check (ai_monthly_limit_usd >= 0);

-- 2. Slug reservado: app/empezar es una ruta de primer nivel.
do $$
begin
  if exists (select 1 from public.tenants where slug = 'empezar') then
    raise exception 'hay un tenant con el slug reservado "empezar". Cambiá el slug antes de aplicar esta migración';
  end if;
end $$;

alter table public.tenants
  drop constraint tenants_slug_not_reserved;

alter table public.tenants
  add constraint tenants_slug_not_reserved
  check (slug not in ('api', 'auth', 'brain', 'empezar', 'eve', 'login', 'oauth', 'plataforma', 'sin-acceso'));

-- 3. Suspensión: una empresa inactiva o suspendida no escribe contenido ni invita.
create or replace function public.tenant_is_writable(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select t.active and t.suspended_reason is null from public.tenants t where t.id = p_tenant),
    true
  );
$$;

revoke execute on function public.tenant_is_writable(uuid) from public, anon;
grant execute on function public.tenant_is_writable(uuid) to authenticated, service_role;

create or replace function public.tenant_writable_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.tenant_is_writable(new.tenant_id) then
    raise exception 'la empresa está suspendida' using errcode = '42501', hint = 'suspended';
  end if;
  return new;
end;
$$;

revoke execute on function public.tenant_writable_guard() from public, anon, authenticated;

create trigger tenant_writable_guard before insert or update on public.brain_pages
  for each row execute function public.tenant_writable_guard();
create trigger tenant_writable_guard before insert or update on public.brain_skill_versions
  for each row execute function public.tenant_writable_guard();
create trigger tenant_writable_guard before insert or update on public.brain_folders
  for each row execute function public.tenant_writable_guard();
create trigger tenant_writable_guard before insert or update on public.invitations
  for each row execute function public.tenant_writable_guard();

-- 4. Conteos para los límites del plan. service_role (sin auth.uid()) también puede.
create or replace function public.tenant_counts(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null
     and not (select public.is_member_of(p_tenant))
     and not (select public.is_platform_admin()) then
    raise exception 'no sos parte de esta empresa' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.memberships m
              where m.tenant_id = p_tenant and m.role in ('tenant_admin', 'tenant_member')),
    'pending_invitations', (select count(*) from public.invitations i
              where i.tenant_id = p_tenant and i.status = 'pending' and i.expires_at > now()),
    'published_skills', (select count(*) from public.brain_skill_overview(p_tenant) o
              where o.action = 'publicar')
  );
end;
$$;

revoke execute on function public.tenant_counts(uuid) from public, anon;
grant execute on function public.tenant_counts(uuid) to authenticated, service_role;

-- 5. Investigación de la empresa: la escribe la service role, la lee el admin.
create table public.onboarding_research (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  status text not null check (status in ('running', 'done', 'error')),
  hint text,
  result jsonb,
  error text,
  updated_at timestamptz not null default now()
);

alter table public.onboarding_research enable row level security;

create policy onboarding_research_select on public.onboarding_research
  for select to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

revoke all on public.onboarding_research from anon;
revoke insert, update, delete, truncate on public.onboarding_research from authenticated;
grant select on public.onboarding_research to authenticated;

-- 6. Slug a partir del dominio.
create or replace function public.slug_from_domain(p_domain text)
returns text language plpgsql immutable security definer set search_path = '' as $$
declare
  v_slug text;
begin
  v_slug := left(regexp_replace(split_part(lower(btrim(p_domain)), '.', 1), '[^a-z0-9-]', '', 'g'), 39);
  if v_slug = '' then
    return 'empresa';
  end if;
  if v_slug !~ '^[a-z]' then
    v_slug := left('e-' || v_slug, 39);
  end if;
  if char_length(v_slug) < 2 then
    v_slug := 'e-' || v_slug;
  end if;
  return v_slug;
end;
$$;

revoke execute on function public.slug_from_domain(text) from public, anon;
grant execute on function public.slug_from_domain(text) to authenticated, service_role;

-- 7. Alta self-serve: la empresa, su admin y el Asistente en una transacción.
create or replace function public.self_serve_create_tenant(p_display_name text, p_domain text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_method text;
  v_email text;
  v_domain text := regexp_replace(lower(btrim(coalesce(p_domain, ''))), '^@', '');
  v_name text := nullif(btrim(p_display_name), '');
  v_base text;
  v_slug text;
  v_suffix text;
  v_id uuid;
  n integer := 1;
begin
  if v_user is null then
    raise exception 'no authenticated user' using errcode = '42501';
  end if;

  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'tu correo no está confirmado' using errcode = '23514', hint = 'email_not_confirmed';
  end if;
  if public.is_public_email_domain(v_domain) then
    raise exception 'el dominio es de correo público' using errcode = '23514', hint = 'public_domain';
  end if;
  if v_domain = '' or v_domain <> split_part(v_email, '@', 2) then
    raise exception 'el dominio no es el de tu correo' using errcode = '23514', hint = 'domain_mismatch';
  end if;

  v_method := public.current_login_method();
  if v_method is null then
    raise exception 'no se pudo determinar cómo ingresaste' using errcode = '23514', hint = 'login_method_unknown';
  end if;

  -- Un doble envío para el mismo dominio se serializa: el segundo ve la empresa del primero.
  perform pg_advisory_xact_lock(hashtext(v_domain));
  if exists (
    select 1 from public.tenants t where t.active and v_domain = any (t.allowed_domains)
  ) then
    raise exception 'ya hay una empresa con ese dominio' using errcode = '23514', hint = 'domain_taken';
  end if;

  if v_name is null then
    raise exception 'falta el nombre de la empresa' using errcode = '23514', hint = 'name_required';
  end if;

  v_base := public.slug_from_domain(v_domain);
  loop
    v_suffix := case when n = 1 then '' else '-' || n end;
    v_slug := left(v_base, 39 - char_length(v_suffix)) || v_suffix;
    n := n + 1;
    continue when v_slug in ('api', 'auth', 'brain', 'empezar', 'eve', 'login', 'oauth', 'plataforma', 'sin-acceso')
      or exists (select 1 from public.tenants t where t.slug = v_slug);
    begin
      insert into public.tenants (
        slug, display_name, allowed_domains, auth_methods, self_signup_by_domain,
        plan, trial_ends_at, onboarding_step
      ) values (
        v_slug, v_name, array[v_domain], array[v_method], false,
        'free', now() + interval '3 months', 'carpetas'
      ) returning id into v_id;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_id, v_user, 'tenant_admin');

  insert into public.tenant_agents (tenant_id, agent, config)
  values (v_id, 'asistente', '{"brain": "read_write"}'::jsonb);

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_id, v_user, 'tenant.created', v_name,
          jsonb_build_object('slug', v_slug, 'agents', jsonb_build_array('asistente'), 'origin', 'self_serve'));
  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_id, v_user, 'membership.created', 'Administrador de la empresa',
          jsonb_build_object('role', 'tenant_admin'));

  return jsonb_build_object('id', v_id, 'slug', v_slug);
end;
$$;

revoke execute on function public.self_serve_create_tenant(text, text) from public, anon;
grant execute on function public.self_serve_create_tenant(text, text) to authenticated;

-- 8. Avance del onboarding. null lo da por terminado.
create or replace function public.set_onboarding_step(p_tenant uuid, p_step text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
begin
  if p_step is not null and p_step not in ('logo', 'acceso', 'equipo') then
    raise exception 'paso de onboarding inválido' using errcode = '23514';
  end if;
  update public.tenants
  set onboarding_step = p_step,
      onboarding_completed_at = case when p_step is null then now() else onboarding_completed_at end
  where id = p_tenant;
end;
$$;

revoke execute on function public.set_onboarding_step(uuid, text) from public, anon;
grant execute on function public.set_onboarding_step(uuid, text) to authenticated;

-- 9. A dónde manda a quien entró sin membresía.
create or replace function public.signup_route()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_domain text;
begin
  if v_user is null then
    raise exception 'no authenticated user' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_user) then
    return 'chat';
  end if;

  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;
  v_domain := split_part(coalesce(v_email, ''), '@', 2);

  if v_domain <> '' and exists (
    select 1 from public.tenants t
    where t.active and not t.self_signup_by_domain and v_domain = any (t.allowed_domains)
  ) then
    return 'dominio_tomado';
  end if;
  if v_domain = '' or public.is_public_email_domain(v_domain) then
    return 'sin_acceso';
  end if;
  return 'empezar';
end;
$$;

revoke execute on function public.signup_route() from public, anon;
grant execute on function public.signup_route() to authenticated;

-- 10. Una empresa suspendida no acepta invitaciones: el trigger tenant_writable_guard
-- haría fallar la función entera, y con ella las invitaciones de las empresas sanas.
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
       and t.suspended_reason is null
       and v_method = any (t.auth_methods)
       and i.email = v_email and i.status = 'pending' and i.expires_at > now()
    returning i.id, i.tenant_id, i.role
  loop
    -- 20.2: una invitación es una decisión explícita y más nueva que el bloqueo.
    delete from public.membership_blocks
    where tenant_id = r.tenant_id and user_id = v_user;
    if found then
      insert into public.events (tenant_id, actor_user_id, type, summary, payload)
      values (r.tenant_id, v_user, 'membership.unblocked', 'Bloqueo levantado por una invitación',
              jsonb_build_object('user_id', v_user, 'invitation_id', r.id));
    end if;

    insert into public.memberships (tenant_id, user_id, role)
    values (r.tenant_id, v_user, r.role)
    on conflict (tenant_id, user_id) do nothing;

    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (r.tenant_id, v_user, 'invitation.accepted', 'Invitación aceptada',
            jsonb_build_object('invitation_id', r.id, 'role', r.role));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
