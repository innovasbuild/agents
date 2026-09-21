-- El foco de búsqueda (spec etapa 13 §6 y §8). Es la forma operativa de un
-- vector del canon y la unidad de autorización del gasto en Apollo.
create type public.search_focus_status as enum ('activo', 'agotado', 'cancelado');

create table public.search_focuses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- El dueño define el claim de todo lo que se descubra. La FK compuesta
  -- obliga a que sea ejecutor de ESTE tenant, igual que contacts.owner_user_id.
  created_by uuid not null,
  name text not null check (length(name) between 1 and 200),
  criteria jsonb not null default '{}'::jsonb,
  -- Validados contra config_values por la puerta, no por FK: el valor es
  -- polimórfico por kind, igual que en contacts.
  vector text not null,
  segment text not null,
  hook text not null,
  idioma text not null,
  max_accounts integer not null check (max_accounts > 0),
  max_contacts integer not null check (max_contacts > 0),
  status public.search_focus_status not null default 'activo',
  accounts_found integer not null default 0 check (accounts_found >= 0),
  contacts_found integer not null default 0 check (contacts_found >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, created_by) references public.executors (tenant_id, user_id)
    on delete cascade
);

-- El sembrador del workflow busca por esto en cada pasada.
create index search_focuses_tenant_status_idx
  on public.search_focuses (tenant_id, status)
  where status = 'activo';
create index search_focuses_created_by_idx on public.search_focuses (tenant_id, created_by);

alter table public.search_focuses enable row level security;

create policy search_focuses_select on public.search_focuses
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

revoke insert, update, delete on public.search_focuses from authenticated, anon;

-- Firmográficos de Apollo, aparte de la ficha (que es el research web).
alter table public.accounts
  add column firmographics jsonb not null default '{}'::jsonb,
  add column external_ids jsonb not null default '{}'::jsonb;

alter table public.contacts
  add column title text check (title is null or length(title) between 1 and 200),
  add column search_focus_id uuid references public.search_focuses (id) on delete set null,
  add column icp jsonb not null default '{}'::jsonb,
  add column external_ids jsonb not null default '{}'::jsonb;

create index contacts_search_focus_id_idx on public.contacts (search_focus_id);

-- El origen nuevo. El check viejo solo admitía csv y chat.
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts
  add constraint contacts_source_check check (source in ('csv', 'chat', 'apollo'));
