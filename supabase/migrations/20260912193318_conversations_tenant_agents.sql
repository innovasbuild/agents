create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  agent text not null,
  eve_session_id text unique,
  title text,
  model text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index conversations_thread_list_idx
  on public.conversations (tenant_id, user_id, last_message_at desc);
create index conversations_user_id_idx on public.conversations (user_id);

create table public.tenant_agents (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent text not null,
  enabled boolean not null default true,
  model text,
  daily_quota integer,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, agent)
);

alter table public.conversations enable row level security;
alter table public.tenant_agents enable row level security;

-- Leer y continuar son permisos distintos: el admin del tenant LEE las
-- conversaciones de su gente, pero continuar la sesión de eve exige ser el
-- dueño, y eso lo valida el canal (lib/agents/channel-context.ts).
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_member_of(tenant_id))
  );

create policy conversations_update on public.conversations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy conversations_delete on public.conversations
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy tenant_agents_select on public.tenant_agents
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

create policy tenant_agents_insert on public.tenant_agents
  for insert to authenticated
  with check (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

-- El using es de alcance "miembro" (igual que la lectura) a propósito: si
-- fuera solo tenant_admin, la fila de un miembro nunca sería candidata a
-- update y postgres haría UPDATE 0 en silencio en vez de negar el permiso.
-- Con este using, la fila SÍ es candidata, pero el with check exige admin,
-- así que el intento de escritura falla con 42501 (mismo mecanismo que
-- memberships_write en la migración de la Task 2).
create policy tenant_agents_update on public.tenant_agents
  for update to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()))
  with check (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create policy tenant_agents_delete on public.tenant_agents
  for delete to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );
