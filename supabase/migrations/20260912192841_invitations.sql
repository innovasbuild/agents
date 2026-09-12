create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  role public.tenant_role not null default 'tenant_member',
  invited_by uuid references auth.users (id) on delete set null,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invitations_email_lowercase check (email = lower(email))
);

create unique index invitations_pending_unique_idx
  on public.invitations (tenant_id, email) where status = 'pending';
create index invitations_email_idx on public.invitations (email) where status = 'pending';
create index invitations_tenant_id_idx on public.invitations (tenant_id);
create index invitations_invited_by_idx on public.invitations (invited_by);
create index invitations_accepted_user_id_idx on public.invitations (accepted_user_id);

alter table public.invitations enable row level security;

create policy invitations_read on public.invitations
  for select to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy invitations_write on public.invitations
  for all to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  )
  with check (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

-- Idempotente y transaccional: dos clicks en el mail no crean dos memberships.
-- El binding es el mail verificado por Supabase, no un token propio.
create or replace function public.accept_pending_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
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
     where i.email = v_email and i.status = 'pending' and i.expires_at > now()
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

revoke execute on function public.accept_pending_invitations() from public;
grant execute on function public.accept_pending_invitations() to authenticated;
