-- supabase/migrations/20261014120000_member_blocks.sql
-- Operación de usuarios (spec 2026-10-09-etapa-20-login-design, 20.2).
--
-- 1. membership_blocks: una persona bloqueada en una empresa. "Sacar" a
--    alguien de un dominio abierto no alcanza: vuelve a entrar sola. La tabla
--    la escriben solo block_member y unblock_member.
-- 2. join_tenants_by_domain salta a los bloqueados; login_gate no los manda a
--    la landing de la empresa que los bloqueó; aceptar una invitación levanta
--    el bloqueo, porque es una decisión explícita y más nueva.
-- 3. memberships_keep_one_admin: una empresa no puede quedar sin
--    administrador, venga el cambio de un UPDATE de rol, de un DELETE o de
--    block_member.
create table public.membership_blocks (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  blocked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index membership_blocks_user_id_idx on public.membership_blocks (user_id);
create index membership_blocks_blocked_by_idx on public.membership_blocks (blocked_by);

alter table public.membership_blocks enable row level security;

create policy membership_blocks_select on public.membership_blocks
  for select to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

revoke all on public.membership_blocks from anon;
revoke insert, update, delete, truncate on public.membership_blocks from authenticated;
grant select on public.membership_blocks to authenticated;

-- Una empresa no puede quedar sin administrador. El candado sobre la fila del
-- tenant serializa dos cambios simultáneos (dos administradores que se
-- degradan entre sí); "no key update" no choca con los FK que insertan filas
-- hijas. Si la fila del tenant ya no está, es el borrado en cascada de la
-- empresa entera y se deja pasar.
create or replace function public.memberships_keep_one_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role not in ('tenant_admin', 'platform_admin') then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role in ('tenant_admin', 'platform_admin') then
    return new;
  end if;

  -- Serializa porque corre en READ COMMITTED (lo de PostgREST): con un nivel más estricto el candado no refresca la foto.
  perform 1 from public.tenants t where t.id = old.tenant_id for no key update;
  if not found then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = old.tenant_id
      and m.id <> old.id
      and m.role in ('tenant_admin', 'platform_admin')
  ) then
    raise exception 'la empresa no puede quedar sin administrador'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.memberships_keep_one_admin() from public, anon, authenticated;

create trigger memberships_keep_one_admin
  before update of role or delete on public.memberships
  for each row execute function public.memberships_keep_one_admin();

create or replace function public.block_member(p_tenant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_target_role public.tenant_role;
begin
  if v_actor is null then
    raise exception 'no authenticated user';
  end if;
  if not (
    (select public.has_tenant_role(p_tenant, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  ) then
    raise exception 'solo un administrador puede bloquear' using errcode = '42501';
  end if;
  if p_user = v_actor then
    raise exception 'nadie se bloquea a sí mismo' using errcode = '42501';
  end if;

  select m.role into v_target_role
  from public.memberships m
  where m.tenant_id = p_tenant and m.user_id = p_user;

  -- Misma regla que memberships_write: solo plataforma toca a un platform_admin.
  if v_target_role = 'platform_admin' and not (select public.is_platform_admin()) then
    raise exception 'solo plataforma bloquea a un administrador de plataforma'
      using errcode = '42501';
  end if;

  -- Solo se bloquea a un miembro (o a quien ya está bloqueado: bloquear dos
  -- veces no falla). Si no, un administrador podría anotar a cualquier uuid.
  if v_target_role is null and not exists (
    select 1 from public.membership_blocks b
    where b.tenant_id = p_tenant and b.user_id = p_user
  ) then
    raise exception 'solo se bloquea a un miembro de la empresa' using errcode = '42501';
  end if;

  -- El trigger memberships_keep_one_admin puede frenar este delete.
  delete from public.memberships
  where tenant_id = p_tenant and user_id = p_user;

  insert into public.membership_blocks (tenant_id, user_id, blocked_by)
  values (p_tenant, p_user, v_actor)
  on conflict (tenant_id, user_id) do nothing;

  if found then
    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (p_tenant, v_actor, 'membership.blocked', 'Persona bloqueada',
            jsonb_build_object('user_id', p_user));
  end if;
end;
$$;

revoke execute on function public.block_member(uuid, uuid) from public;
revoke execute on function public.block_member(uuid, uuid) from anon;
grant execute on function public.block_member(uuid, uuid) to authenticated;

create or replace function public.unblock_member(p_tenant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'no authenticated user';
  end if;
  if not (
    (select public.has_tenant_role(p_tenant, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  ) then
    raise exception 'solo un administrador puede desbloquear' using errcode = '42501';
  end if;

  delete from public.membership_blocks
  where tenant_id = p_tenant and user_id = p_user;

  if found then
    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (p_tenant, v_actor, 'membership.unblocked', 'Persona desbloqueada',
            jsonb_build_object('user_id', p_user));
  end if;
end;
$$;

revoke execute on function public.unblock_member(uuid, uuid) from public;
revoke execute on function public.unblock_member(uuid, uuid) from anon;
grant execute on function public.unblock_member(uuid, uuid) to authenticated;

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
      -- 20.2: el dominio abierto no vuelve a unir a una persona bloqueada.
      and not exists (
        select 1 from public.membership_blocks b
        where b.tenant_id = t.id and b.user_id = v_user
      )
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
      -- 20.2: una empresa que la bloqueó no la espera por dominio.
      and not exists (
        select 1 from public.membership_blocks b
        where b.tenant_id = t.id and b.user_id = v_user
      )
  ) w
  order by w.ord, w.slug
  limit 1;

  if v_landing is null then
    return jsonb_build_object('allowed', true, 'landing', null);
  end if;
  return jsonb_build_object('allowed', false, 'landing', v_landing);
end;
$$;
