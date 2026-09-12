create table public.runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent text not null,
  trigger public.run_trigger not null,
  eve_session_id text not null,
  eve_turn_id text,
  conversation_id uuid references public.conversations (id) on delete set null,
  status public.run_status not null default 'running',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cost_usd numeric(10, 4)
);

create index runs_tenant_started_idx on public.runs (tenant_id, started_at desc);
create index runs_conversation_id_idx on public.runs (conversation_id);
create unique index runs_turn_idx on public.runs (eve_session_id, eve_turn_id)
  where eve_turn_id is not null;

create table public.events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  run_id uuid references public.runs (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  contact_key text,
  channel text,
  type text not null,
  summary text,
  evidence_url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_tenant_created_idx on public.events (tenant_id, created_at desc);
create index events_run_id_idx on public.events (run_id);
create index events_actor_user_id_idx on public.events (actor_user_id);

alter table public.runs enable row level security;
alter table public.events enable row level security;

create policy runs_select on public.runs
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

create policy events_select on public.events
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

-- La RLS es por fila; esto es por columna. Un revoke de columna suelto no
-- alcanza mientras exista el grant de tabla, así que se revoca la tabla y se
-- re-otorga columna por columna. Consecuencia: nadie hace select * sobre runs.
revoke select on public.runs from authenticated, anon;
grant select (id, tenant_id, agent, trigger, eve_session_id, eve_turn_id,
  conversation_id, status, error, started_at, finished_at)
  on public.runs to authenticated;

revoke insert, update, delete on public.runs from authenticated, anon;
revoke insert, update, delete on public.events from authenticated, anon;

create or replace function public.run_cost_usd(p_run uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select r.cost_usd from public.runs r
  where r.id = p_run and public.is_platform_admin();
$$;

revoke execute on function public.run_cost_usd(uuid) from public;
grant execute on function public.run_cost_usd(uuid) to authenticated;

-- Ahora que existe events, la aceptación de invitaciones deja su rastro.
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

    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (r.tenant_id, v_user, 'invitation.accepted', 'Invitación aceptada',
            jsonb_build_object('invitation_id', r.id, 'role', r.role));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
