-- supabase/migrations/20261025120000_brain_folders.sql
-- Etapa 26.1a: las carpetas del brain pasan a ser filas (spec etapa 26 §3.1).
-- config.categories del binding queda como reflejo de las de primer nivel, y lo
-- mantiene brain_sync_categories en la misma transacción que la cambia.

create table public.brain_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  path text not null check (
    char_length(path) <= 200
    and path ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'
    -- Una de primer nivel es una categoría: mismo patrón que brain_pages.category.
    and (position('/' in path) > 0 or path ~ '^[a-z][a-z0-9-]{0,40}$')
  ),
  description text not null default '' check (char_length(description) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, path)
);
create index brain_folders_created_by_idx on public.brain_folders (created_by);

-- Solo el servidor lee y escribe: lo que ve cada persona lo decide withAccess.
alter table public.brain_folders enable row level security;
revoke all on public.brain_folders from anon, authenticated;

create or replace function public.brain_category_for(p_path text)
returns text language sql immutable set search_path = '' as $$
  select case when split_part(p_path, '/', 1) = 'skills' then 'skill'
              else split_part(p_path, '/', 1) end;
$$;

create or replace function public.brain_sync_categories(p_tenant uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.tenant_connections c
  set config = jsonb_set(
        c.config, '{categories}',
        coalesce((
          -- distinct: skills y una fila skill colada darían skill dos veces, y
          -- parseCategories rechaza la config entera.
          select jsonb_agg(distinct public.brain_category_for(f.path)
                           order by public.brain_category_for(f.path))
          from public.brain_folders f
          where f.tenant_id = p_tenant and position('/' in f.path) = 0
        ), '[]'::jsonb)),
      updated_at = now()
  where c.tenant_id = p_tenant and c.capability = 'brain' and c.provider = 'wiki';
end;
$$;

-- Crea p_path y cada carpeta de su camino que falte. Devuelve cuántas creó.
create or replace function public.brain_ensure_folders(p_tenant uuid, p_path text, p_actor uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_path, '/');
  v_created integer := 0;
  v_rows integer;
  v_top boolean := false;
begin
  -- skill es la categoría de skills/: una carpeta skill la duplicaría.
  if v_parts[1] = 'skill' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'reserved_path';
  end if;
  -- Una de primer nivel nueva cambia la config: mismo orden de bloqueo que
  -- brain_create_folder y brain_delete_folder (primero el binding).
  if not exists (
    select 1 from public.brain_folders where tenant_id = p_tenant and path = v_parts[1]
  ) then
    perform 1 from public.tenant_connections
    where tenant_id = p_tenant and capability = 'brain' and provider = 'wiki'
    for update;
  end if;
  for i in 1 .. cardinality(v_parts) loop
    insert into public.brain_folders (tenant_id, path, created_by)
    values (p_tenant, array_to_string(v_parts[1:i], '/'), p_actor)
    on conflict (tenant_id, path) do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
    if i = 1 and v_rows > 0 then v_top := true; end if;
  end loop;
  if v_top then perform public.brain_sync_categories(p_tenant); end if;
  return v_created;
end;
$$;

-- Una carpeta de primer nivel por categoría de la config (skill → skills).
create or replace function public.brain_folders_from_config(p_tenant uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_created integer := 0;
  v_rows integer;
  v_category text;
begin
  for v_category in
    select jsonb_array_elements_text(c.config -> 'categories')
    from public.tenant_connections c
    where c.tenant_id = p_tenant and c.capability = 'brain' and c.provider = 'wiki'
  loop
    insert into public.brain_folders (tenant_id, path)
    values (p_tenant, case when v_category = 'skill' then 'skills' else v_category end)
    on conflict (tenant_id, path) do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;
  return v_created;
end;
$$;

create or replace function public.brain_create_folder(
  p_tenant uuid, p_actor uuid, p_path text, p_description text
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_parent text := nullif(regexp_replace(p_path, '/?[^/]+$', ''), '');
begin
  -- Serializa por tenant el tope de 20 carpetas de primer nivel.
  perform 1 from public.tenant_connections
  where tenant_id = p_tenant and capability = 'brain' and provider = 'wiki'
  for update;
  -- skill es la categoría de skills/: una carpeta skill la duplicaría.
  if v_parent is null and p_path in ('skills', 'skill', 'brain') then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'reserved_path';
  end if;
  if v_parent is null and (
    select count(*) from public.brain_folders
    where tenant_id = p_tenant and position('/' in path) = 0
  ) >= 20 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'too_many';
  end if;
  if v_parent is not null and not exists (
    select 1 from public.brain_folders where tenant_id = p_tenant and path = v_parent
  ) then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = 'parent';
  end if;

  begin
    insert into public.brain_folders (tenant_id, path, description, created_by)
    values (p_tenant, p_path, coalesce(p_description, ''), p_actor);
  exception
    when unique_violation then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'folder_exists';
    when check_violation then
      raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'path';
  end;
  if v_parent is null then perform public.brain_sync_categories(p_tenant); end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.folder_created', p_path,
          jsonb_build_object('path', p_path));
end;
$$;

create or replace function public.brain_set_folder_description(
  p_tenant uuid, p_actor uuid, p_path text, p_description text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.brain_folders
  set description = coalesce(p_description, ''), updated_at = now()
  where tenant_id = p_tenant and path = p_path;
  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = 'folder';
  end if;
  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.folder_described', p_path,
          jsonb_build_object('path', p_path));
end;
$$;

create or replace function public.brain_delete_folder(
  p_tenant uuid, p_actor uuid, p_path text
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_rules integer;
begin
  -- Serializa por tenant el chequeo de la última de primer nivel: dos borrados
  -- simultáneos de las dos últimas dejarían la config en [].
  perform 1 from public.tenant_connections
  where tenant_id = p_tenant and capability = 'brain' and provider = 'wiki'
  for update;
  perform 1 from public.brain_folders
  where tenant_id = p_tenant and path = p_path
  for update;
  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = 'folder';
  end if;
  if p_path = 'skills' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'reserved_path';
  end if;
  if exists (
    select 1 from public.brain_pages
    where tenant_id = p_tenant and (slug = p_path or starts_with(slug, p_path || '/'))
  ) or exists (
    select 1 from public.brain_folders
    where tenant_id = p_tenant and starts_with(path, p_path || '/')
  ) then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'folder_not_empty';
  end if;
  if position('/' in p_path) = 0 and (
    select count(*) from public.brain_folders
    where tenant_id = p_tenant and position('/' in path) = 0
  ) <= 1 then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'folder_last';
  end if;

  delete from public.brain_folders where tenant_id = p_tenant and path = p_path;
  delete from public.brain_access_rules where tenant_id = p_tenant and path = p_path;
  get diagnostics v_rules = row_count;
  if position('/' in p_path) = 0 then perform public.brain_sync_categories(p_tenant); end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.folder_deleted', p_path,
          jsonb_build_object('path', p_path, 'rules_removed', v_rules));
end;
$$;

-- Permisos: solo el servidor.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.brain_category_for(text)',
    'public.brain_sync_categories(uuid)',
    'public.brain_ensure_folders(uuid, text, uuid)',
    'public.brain_folders_from_config(uuid)',
    'public.brain_create_folder(uuid, uuid, text, text)',
    'public.brain_set_folder_description(uuid, uuid, text, text)',
    'public.brain_delete_folder(uuid, uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

-- Redefinición de brain_upsert_page (misma firma, copia de 20260913234426):
-- una página nueva crea las carpetas de su camino que falten.

create or replace function public.brain_upsert_page(
  p_tenant_id uuid,
  p_slug text,
  p_title text,
  p_category text,
  p_status public.brain_page_status,
  p_tags text[],
  p_frontmatter jsonb,
  p_body text,
  p_reason text,
  p_base_revision integer,
  p_author_kind public.brain_author_kind,
  p_author_user_id uuid,
  p_session_id text,
  p_binding_id uuid,
  p_source_path text default null,
  p_source_hash text default null
)
returns table (page_id uuid, page_slug text, page_revision integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_page public.brain_pages%rowtype;
  v_page_id uuid;
  v_revision integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'reason';
  end if;
  if p_author_kind = 'import' and (p_source_path is null or p_source_hash is null) then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'source';
  end if;

  select * into v_page
  from public.brain_pages
  where tenant_id = p_tenant_id and slug = p_slug
  for update;

  if not found then
    if p_base_revision is not null then
      raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = p_slug;
    end if;

    -- Toda página tiene su carpeta (spec etapa 26 §3.1): se crean las que falten.
    if position('/' in p_slug) > 0 then
      perform public.brain_ensure_folders(
        p_tenant_id, regexp_replace(p_slug, '/[^/]+$', ''), p_author_user_id);
    end if;

    v_revision := 1;
    begin
      insert into public.brain_pages (
        tenant_id, slug, title, category, status, tags, frontmatter, body, revision,
        source_path, source_hash, source_revision, updated_by
      )
      values (
        p_tenant_id, p_slug, p_title, p_category, p_status,
        coalesce(p_tags, '{}'), coalesce(p_frontmatter, '{}'::jsonb), p_body, 1,
        p_source_path, p_source_hash,
        case when p_author_kind = 'import' then 1 end,
        p_author_user_id
      )
      returning id into v_page_id;
    exception when unique_violation then
      -- Dos altas simultáneas del mismo slug: la segunda pierde.
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = '';
    end;
  else
    if p_base_revision is null or p_base_revision <> v_page.revision then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = v_page.revision::text;
    end if;

    v_page_id := v_page.id;
    v_revision := v_page.revision + 1;

    update public.brain_pages
    set title = p_title,
        category = p_category,
        status = p_status,
        tags = coalesce(p_tags, '{}'),
        frontmatter = coalesce(p_frontmatter, '{}'::jsonb),
        body = p_body,
        revision = v_revision,
        source_path = case when p_author_kind = 'import' then p_source_path else source_path end,
        source_hash = case when p_author_kind = 'import' then p_source_hash else source_hash end,
        source_revision = case when p_author_kind = 'import' then v_revision else source_revision end,
        updated_by = p_author_user_id,
        updated_at = now()
    where id = v_page_id;
  end if;

  insert into public.brain_revisions (
    tenant_id, page_id, revision, title, category, status, tags, frontmatter, body,
    author_kind, author_user_id, session_id, reason
  )
  values (
    p_tenant_id, v_page_id, v_revision, p_title, p_category, p_status,
    coalesce(p_tags, '{}'), coalesce(p_frontmatter, '{}'::jsonb), p_body,
    p_author_kind, p_author_user_id, p_session_id, p_reason
  );

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_author_user_id, 'brain.page_upserted', p_slug,
    jsonb_build_object(
      'slug', p_slug,
      'revision', v_revision,
      'author_kind', p_author_kind,
      'binding_id', p_binding_id,
      'reason', p_reason
    )
  );

  return query select v_page_id, p_slug, v_revision;
end;
$$;

revoke execute on function public.brain_upsert_page(
  uuid, text, text, text, public.brain_page_status, text[], jsonb, text, text, integer,
  public.brain_author_kind, uuid, text, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.brain_upsert_page(
  uuid, text, text, text, public.brain_page_status, text[], jsonb, text, text, integer,
  public.brain_author_kind, uuid, text, uuid, text, text
) to service_role;

-- Redefinición de brain_delete_page (misma firma, copia de 20261020120000_brain_skills):
-- las reglas de una carpeta homónima no se borran con la página.
create or replace function public.brain_delete_page(
  p_tenant_id uuid,
  p_slug text,
  p_expected_revision integer,
  p_actor uuid,
  p_binding_id uuid,
  p_cleanups jsonb
)
returns table (deleted_revisions integer, cleaned integer, rules_removed integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_page public.brain_pages%rowtype;
  v_target public.brain_pages%rowtype;
  v_item jsonb;
  v_revisions integer;
  v_cleaned text[] := '{}';
  v_rules integer := 0;
begin
  select * into v_page
  from public.brain_pages
  where tenant_id = p_tenant_id and slug = p_slug
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = p_slug;
  end if;
  if v_page.revision <> p_expected_revision then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = v_page.revision::text;
  end if;

  -- Una skill con versión vigente no se borra: primero se retira (spec 24.1 §8.3).
  if (
    select v.action from public.brain_skill_versions v
    where v.tenant_id = p_tenant_id and v.page_id = v_page.id
    order by v.id desc
    limit 1
  ) = 'publicar' then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'skill_published';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_cleanups, '[]'::jsonb)) loop
    -- Una página no se limpia a sí misma: se va a borrar.
    if v_item ->> 'slug' = p_slug then
      continue;
    end if;

    select * into v_target
    from public.brain_pages
    where tenant_id = p_tenant_id and slug = v_item ->> 'slug'
    for update;

    -- Si desapareció entre el plan y esta transacción, el plan quedó viejo.
    if not found then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = '';
    end if;

    -- brain_upsert_page controla la revisión base: una página que cambió aborta todo.
    perform 1 from public.brain_upsert_page(
      p_tenant_id, v_target.slug, v_target.title, v_target.category, v_target.status,
      v_target.tags, v_target.frontmatter, v_item ->> 'body',
      'Se borró ' || p_slug, (v_item ->> 'base_revision')::integer,
      'user'::public.brain_author_kind, p_actor, null, p_binding_id
    );
    v_cleaned := v_cleaned || v_target.slug;
  end loop;

  select count(*)::integer into v_revisions
  from public.brain_revisions
  where tenant_id = p_tenant_id and page_id = v_page.id;

  -- brain_revisions cae por la clave foránea con on delete cascade.
  delete from public.brain_pages where id = v_page.id;

  -- Las reglas siguen protegiendo lo que cuelga de esta ruta: solo se borran
  -- si no queda ninguna página debajo.
  -- Tampoco si la ruta es además una carpeta (spec etapa 26 §3.1): sus reglas son de la carpeta.
  if not exists (
    select 1 from public.brain_pages
    where tenant_id = p_tenant_id and starts_with(slug, p_slug || '/')
  ) and not exists (
    select 1 from public.brain_folders
    where tenant_id = p_tenant_id and path = p_slug
  ) then
    delete from public.brain_access_rules
    where tenant_id = p_tenant_id and path = p_slug;
    get diagnostics v_rules = row_count;
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.page_deleted', p_slug,
    jsonb_build_object(
      'slug', p_slug,
      'title', v_page.title,
      'category', v_page.category,
      'revisions', v_revisions,
      'cleaned', to_jsonb(v_cleaned),
      'rules_removed', v_rules,
      'binding_id', p_binding_id
    )
  );

  return query select v_revisions, coalesce(cardinality(v_cleaned), 0), v_rules;
end;
$$;

revoke execute on function public.brain_delete_page(
  uuid, text, integer, uuid, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.brain_delete_page(
  uuid, text, integer, uuid, uuid, jsonb
) to service_role;

-- La consola deja de editar categorías (spec etapa 26 §3.1).
drop function if exists public.platform_set_brain_categories(uuid, uuid, text[]);

-- Backfill: una carpeta por categoría y por cada prefijo de ruta que ya existe.
do $$
declare
  v_tenant uuid;
  v_prefix text;
begin
  for v_tenant in
    select tenant_id from public.tenant_connections where capability = 'brain' and provider = 'wiki'
  loop
    perform public.brain_folders_from_config(v_tenant);
    for v_prefix in
      select distinct regexp_replace(slug, '/[^/]+$', '')
      from public.brain_pages
      where tenant_id = v_tenant and position('/' in slug) > 0
    loop
      perform public.brain_ensure_folders(v_tenant, v_prefix, null);
    end loop;
    perform public.brain_sync_categories(v_tenant);
  end loop;
end;
$$;
