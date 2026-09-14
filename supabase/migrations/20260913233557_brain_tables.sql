-- Brain por tenant: páginas vigentes y revisiones append-only.
-- Spec docs/superpowers/specs/2026-09-13-brain-design.md §5.

create extension if not exists unaccent with schema extensions;

-- unaccent no es immutable y una columna generada lo exige. El wrapper fija el
-- diccionario calificado, que es lo que vuelve estable el resultado.
create or replace function public.f_unaccent(value text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, value)
$$;

-- Nace con EXECUTE para PUBLIC (default de Postgres, no de Supabase): el
-- revoke de siempre alcanza para dejar afuera a anon (idiom documentado en
-- 06_anon_grants.test.sql). Solo la columna generada la usa; nadie necesita
-- llamarla directo.
revoke execute on function public.f_unaccent(text) from public;

create type public.brain_page_status as enum ('activo', 'borrador', 'archivado');
create type public.brain_author_kind as enum ('user', 'agent', 'import');

create table public.brain_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  slug text not null check (
    char_length(slug) <= 200
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'
  ),
  title text not null check (char_length(title) between 1 and 300),
  -- La lista válida es por tenant y vive en el binding; acá solo el formato.
  category text not null check (category ~ '^[a-z][a-z0-9-]{0,40}$'),
  status public.brain_page_status not null default 'activo',
  tags text[] not null default '{}',
  frontmatter jsonb not null default '{}'::jsonb check (jsonb_typeof(frontmatter) = 'object'),
  body text not null check (octet_length(body) <= 204800),
  revision integer not null default 1 check (revision >= 1),
  search tsvector generated always as (
    setweight(to_tsvector('spanish'::regconfig, public.f_unaccent(title)), 'A')
    || setweight(to_tsvector('spanish'::regconfig, public.f_unaccent(body)), 'B')
  ) stored,
  -- Rastro del import: si revision <> source_revision, alguien editó la
  -- página en la plataforma y el import no la pisa.
  source_path text,
  source_hash text,
  source_revision integer,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index brain_pages_search_idx on public.brain_pages using gin (search);
create index brain_pages_tags_idx on public.brain_pages using gin (tags);
create index brain_pages_tenant_category_status_idx on public.brain_pages (tenant_id, category, status);
create index brain_pages_updated_by_idx on public.brain_pages (updated_by);

create table public.brain_revisions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  page_id uuid not null references public.brain_pages (id) on delete cascade,
  revision integer not null check (revision >= 1),
  title text not null,
  category text not null,
  status public.brain_page_status not null,
  tags text[] not null default '{}',
  frontmatter jsonb not null default '{}'::jsonb,
  body text not null,
  author_kind public.brain_author_kind not null,
  author_user_id uuid references auth.users (id) on delete set null,
  approved_by_user_id uuid references auth.users (id) on delete set null,
  session_id text,
  reason text not null check (char_length(btrim(reason)) > 0),
  created_at timestamptz not null default now(),
  unique (page_id, revision)
);

create index brain_revisions_tenant_idx on public.brain_revisions (tenant_id, created_at desc);
create index brain_revisions_author_user_id_idx on public.brain_revisions (author_user_id);
create index brain_revisions_approved_by_user_id_idx on public.brain_revisions (approved_by_user_id);

alter table public.brain_pages enable row level security;
alter table public.brain_revisions enable row level security;

create policy brain_pages_select on public.brain_pages
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

create policy brain_revisions_select on public.brain_revisions
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

-- Escribe solo el servidor con la service role, por public.brain_upsert_page.
-- Revisiones append-only con el mismo mecanismo que events: sin trigger, para
-- que el borrado en cascada de un tenant siga funcionando.
revoke insert, update, delete, truncate on public.brain_pages from authenticated, anon;
revoke insert, update, delete, truncate on public.brain_revisions from authenticated, anon;
revoke select on public.brain_pages from anon;
revoke select on public.brain_revisions from anon;
