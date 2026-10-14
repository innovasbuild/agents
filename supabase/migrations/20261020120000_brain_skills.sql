-- Skills de empresa (spec etapa 24.1 §4): archivos del borrador, actos de
-- publicación solo de inserción, bucket privado y sus funciones. Todo lo
-- escribe el servidor con la service role; la autorización va en el código.

create type public.brain_skill_action as enum ('publicar', 'retirar');

create table public.brain_skill_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  page_id uuid not null references public.brain_pages (id) on delete cascade,
  path text not null check (
    char_length(path) <= 200
    and path ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,5}$'
    and lower(path) <> 'skill.md'
  ),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size integer not null check (size between 0 and 4194304),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (page_id, path)
);

create index brain_skill_files_tenant_idx on public.brain_skill_files (tenant_id);
create index brain_skill_files_uploaded_by_idx on public.brain_skill_files (uploaded_by);

create table public.brain_skill_versions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Borrada la página, el acto queda como registro.
  page_id uuid references public.brain_pages (id) on delete set null,
  slug text not null,
  name text not null check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(name) <= 64),
  action public.brain_skill_action not null,
  version integer not null check (version >= 1),
  page_revision integer not null check (page_revision >= 1),
  title text not null default '',
  description text not null default '' check (char_length(description) <= 1024),
  body text not null default '',
  frontmatter jsonb not null default '{}'::jsonb check (jsonb_typeof(frontmatter) = 'object'),
  manifest jsonb not null default '[]'::jsonb check (jsonb_typeof(manifest) = 'array'),
  files_digest text not null default '',
  digest text not null default '',
  note text not null check (char_length(btrim(note)) between 1 and 500),
  republished_from integer,
  actor_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index brain_skill_versions_page_idx on public.brain_skill_versions (tenant_id, page_id, id desc);
create index brain_skill_versions_name_idx on public.brain_skill_versions (tenant_id, name);
create index brain_skill_versions_actor_idx on public.brain_skill_versions (actor_user_id);

alter table public.brain_skill_files enable row level security;
alter table public.brain_skill_versions enable row level security;

-- Sin políticas: como brain_pages desde la etapa 17, solo el servidor.
revoke all on public.brain_skill_files from anon, authenticated;
revoke all on public.brain_skill_versions from anon, authenticated;
-- Solo de inserción también para el servidor. Las cascadas y el set null de
-- las claves foráneas corren como el dueño de la tabla y siguen andando.
revoke update, delete, truncate on public.brain_skill_versions from service_role;

-- Bucket privado, sin políticas en storage.objects: nadie lee ni escribe
-- directo. Objeto en <tenant_id>/<sha256>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('skills', 'skills', false, 4194304)
on conflict (id) do nothing;

-- Hash de los archivos del borrador: sha256 de la lista JSON [[path, sha256], ...]
-- ordenada por ruta. JSON escapa cada campo, así que la codificación no es ambigua.
create or replace function public.brain_skill_files_digest(p_page_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select encode(
    sha256(convert_to(
      coalesce(
        jsonb_agg(jsonb_build_array(f.path, f.sha256) order by f.path collate "C"),
        '[]'::jsonb
      )::text,
      'UTF8'
    )),
    'hex'
  )
  from public.brain_skill_files f
  where f.page_id = p_page_id
$$;

create or replace function public.brain_skill_put_file(
  p_tenant_id uuid,
  p_page_id uuid,
  p_path text,
  p_sha256 text,
  p_size integer,
  p_actor uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
  v_count integer;
  v_total bigint;
begin
  -- El lock de la página serializa subidas, bajas y publicación.
  select * into v_page
  from public.brain_pages
  where id = p_page_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = '';
  end if;
  if v_page.category <> 'skill' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'category';
  end if;

  insert into public.brain_skill_files (tenant_id, page_id, path, sha256, size, uploaded_by)
  values (p_tenant_id, p_page_id, p_path, p_sha256, p_size, p_actor)
  on conflict (page_id, path)
  do update set sha256 = excluded.sha256, size = excluded.size,
                uploaded_by = excluded.uploaded_by, created_at = now();

  select count(*)::integer, coalesce(sum(f.size), 0)::bigint into v_count, v_total
  from public.brain_skill_files f
  where f.page_id = p_page_id;

  if v_count > 50 or v_total > 20971520 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'package_limit';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.skill_file_added', v_page.slug,
    jsonb_build_object('slug', v_page.slug, 'path', p_path, 'sha256', p_sha256, 'size', p_size)
  );

  return public.brain_skill_files_digest(p_page_id);
end;
$$;

create or replace function public.brain_skill_remove_file(
  p_tenant_id uuid,
  p_page_id uuid,
  p_path text,
  p_actor uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
begin
  select * into v_page
  from public.brain_pages
  where id = p_page_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = '';
  end if;

  delete from public.brain_skill_files
  where page_id = p_page_id and path = p_path;

  -- Quitar lo que no está no cambia nada: no deja evento.
  if found then
    insert into public.events (tenant_id, actor_user_id, type, summary, payload)
    values (
      p_tenant_id, p_actor, 'brain.skill_file_removed', v_page.slug,
      jsonb_build_object('slug', v_page.slug, 'path', p_path)
    );
  end if;

  return public.brain_skill_files_digest(p_page_id);
end;
$$;

-- Publicar. La copia la arma esta función desde la fila bloqueada: el servidor
-- de aplicación no le pasa contenido. Con p_from_version republica esa versión.
create or replace function public.brain_publish_skill(
  p_tenant_id uuid,
  p_page_id uuid,
  p_expected_revision integer,
  p_expected_files_digest text,
  p_note text,
  p_actor uuid,
  p_from_version integer default null
)
returns table (skill_version integer, skill_digest text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_page public.brain_pages%rowtype;
  v_from public.brain_skill_versions%rowtype;
  v_name text;
  v_title text;
  v_description text;
  v_body text;
  v_frontmatter jsonb;
  v_manifest jsonb;
  v_files_digest text;
  v_page_revision integer;
  v_version integer;
  v_digest text;
  v_editors jsonb := '[]'::jsonb;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'note';
  end if;

  select * into v_page
  from public.brain_pages
  where id = p_page_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = '';
  end if;
  if v_page.category <> 'skill' or not starts_with(v_page.slug, 'skills/') then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'category';
  end if;

  v_name := regexp_replace(v_page.slug, '^.*/', '');
  if char_length(v_name) > 64 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'name';
  end if;

  if p_from_version is null then
    if p_expected_revision is null or v_page.revision <> p_expected_revision then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'revision';
    end if;
    v_files_digest := public.brain_skill_files_digest(p_page_id);
    if p_expected_files_digest is null or v_files_digest <> p_expected_files_digest then
      raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'files';
    end if;

    v_title := v_page.title;
    v_description := btrim(coalesce(v_page.frontmatter ->> 'description', ''));
    v_body := v_page.body;
    v_frontmatter := v_page.frontmatter;
    v_page_revision := v_page.revision;

    select coalesce(
      jsonb_agg(jsonb_build_object('path', f.path, 'sha256', f.sha256, 'size', f.size)
                order by f.path collate "C"),
      '[]'::jsonb
    ) into v_manifest
    from public.brain_skill_files f
    where f.page_id = p_page_id;

    select coalesce(jsonb_agg(distinct r.author_user_id), '[]'::jsonb) into v_editors
    from public.brain_revisions r
    where r.page_id = p_page_id
      and r.author_user_id is not null
      and r.revision > coalesce((
        select max(v.page_revision) from public.brain_skill_versions v
        where v.tenant_id = p_tenant_id and v.page_id = p_page_id and v.action = 'publicar'
      ), 0);
  else
    select * into v_from
    from public.brain_skill_versions v
    where v.tenant_id = p_tenant_id and v.page_id = p_page_id
      and v.version = p_from_version and v.action = 'publicar';

    if not found then
      raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = 'version';
    end if;

    v_title := v_from.title;
    v_description := v_from.description;
    v_body := v_from.body;
    v_frontmatter := v_from.frontmatter;
    v_manifest := v_from.manifest;
    v_files_digest := v_from.files_digest;
    v_page_revision := v_from.page_revision;
  end if;

  if v_description = '' or char_length(v_description) > 1024 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'description';
  end if;
  if char_length(coalesce(v_frontmatter ->> 'compatibility', '')) > 500 then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'compatibility';
  end if;

  -- Un nombre, una skill vigente por empresa. El lock evita que dos
  -- publicaciones simultáneas del mismo nombre pasen las dos.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_name, 0));
  if exists (
    select 1
    from public.brain_skill_versions v
    where v.tenant_id = p_tenant_id
      and v.name = v_name
      and v.page_id is distinct from p_page_id
      and v.action = 'publicar'
      and v.id = (
        select max(v2.id) from public.brain_skill_versions v2
        where v2.tenant_id = v.tenant_id and v2.page_id = v.page_id
      )
  ) then
    raise exception using errcode = 'BR409', message = 'BRAIN_CONFLICT', detail = 'name';
  end if;

  select coalesce(max(v.version), 0) + 1 into v_version
  from public.brain_skill_versions v
  where v.tenant_id = p_tenant_id and v.page_id = p_page_id;

  -- Lista JSON de seis campos: el escape de JSON hace la codificación inequívoca
  -- (con un separador común, campos distintos podían dar el mismo texto).
  v_digest := encode(sha256(convert_to(jsonb_build_array(
    v_name,
    v_description,
    encode(sha256(convert_to(v_body, 'UTF8')), 'hex'),
    coalesce(v_frontmatter ->> 'compatibility', ''),
    coalesce(v_frontmatter ->> 'license', ''),
    v_files_digest
  )::text, 'UTF8')), 'hex');

  insert into public.brain_skill_versions (
    tenant_id, page_id, slug, name, action, version, page_revision, title, description,
    body, frontmatter, manifest, files_digest, digest, note, republished_from, actor_user_id
  )
  values (
    p_tenant_id, p_page_id, v_page.slug, v_name, 'publicar', v_version, v_page_revision, v_title,
    v_description, v_body, v_frontmatter, v_manifest, v_files_digest, v_digest, btrim(p_note),
    p_from_version, p_actor
  );

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.skill_published', v_page.slug,
    jsonb_build_object(
      'slug', v_page.slug,
      'name', v_name,
      'version', v_version,
      'digest', v_digest,
      'page_revision', v_page_revision,
      'republished_from', p_from_version,
      'editors', v_editors,
      'note', btrim(p_note)
    )
  );

  return query select v_version, v_digest;
end;
$$;

create or replace function public.brain_withdraw_skill(
  p_tenant_id uuid,
  p_page_id uuid,
  p_note text,
  p_actor uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
  v_last public.brain_skill_versions%rowtype;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception using errcode = 'BR422', message = 'BRAIN_VALIDATION', detail = 'note';
  end if;

  select * into v_page
  from public.brain_pages
  where id = p_page_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'BR404', message = 'BRAIN_NOT_FOUND', detail = '';
  end if;

  select * into v_last
  from public.brain_skill_versions v
  where v.tenant_id = p_tenant_id and v.page_id = p_page_id
  order by v.id desc
  limit 1;

  -- Retirar lo que no está vigente no hace nada.
  if not found or v_last.action = 'retirar' then
    return false;
  end if;

  insert into public.brain_skill_versions (
    tenant_id, page_id, slug, name, action, version, page_revision, note, actor_user_id
  )
  values (
    p_tenant_id, p_page_id, v_last.slug, v_last.name, 'retirar', v_last.version,
    v_last.page_revision, btrim(p_note), p_actor
  );

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.skill_withdrawn', v_last.slug,
    jsonb_build_object('slug', v_last.slug, 'name', v_last.name, 'version', v_last.version, 'note', btrim(p_note))
  );

  return true;
end;
$$;

-- Una fila por página de categoría skill, con su borrador y su último acto.
create or replace function public.brain_skill_overview(p_tenant_id uuid)
returns table (
  page_id uuid,
  slug text,
  revision integer,
  draft_files_digest text,
  action public.brain_skill_action,
  version integer,
  page_revision integer,
  files_digest text,
  title text,
  description text,
  body text,
  frontmatter jsonb,
  manifest jsonb,
  digest text,
  published_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id, p.slug, p.revision, public.brain_skill_files_digest(p.id),
    v.action, v.version, v.page_revision, v.files_digest, v.title, v.description,
    v.body, v.frontmatter, v.manifest, v.digest, v.created_at
  from public.brain_pages p
  left join lateral (
    select * from public.brain_skill_versions sv
    where sv.tenant_id = p.tenant_id and sv.page_id = p.id
    order by sv.id desc
    limit 1
  ) v on true
  where p.tenant_id = p_tenant_id and p.category = 'skill'
$$;

revoke execute on function public.brain_skill_files_digest(uuid) from public, anon, authenticated;
revoke execute on function public.brain_skill_put_file(uuid, uuid, text, text, integer, uuid) from public, anon, authenticated;
revoke execute on function public.brain_skill_remove_file(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.brain_publish_skill(uuid, uuid, integer, text, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.brain_withdraw_skill(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.brain_skill_overview(uuid) from public, anon, authenticated;

grant execute on function public.brain_skill_files_digest(uuid) to service_role;
grant execute on function public.brain_skill_put_file(uuid, uuid, text, text, integer, uuid) to service_role;
grant execute on function public.brain_skill_remove_file(uuid, uuid, text, uuid) to service_role;
grant execute on function public.brain_publish_skill(uuid, uuid, integer, text, text, uuid, integer) to service_role;
grant execute on function public.brain_withdraw_skill(uuid, uuid, text, uuid) to service_role;
grant execute on function public.brain_skill_overview(uuid) to service_role;

-- Redefinición de brain_delete_page (misma firma): una skill con versión vigente no se borra.
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
  if not exists (
    select 1 from public.brain_pages
    where tenant_id = p_tenant_id and starts_with(slug, p_slug || '/')
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

