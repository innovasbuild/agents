-- Único camino de escritura del brain (spec brain §5.4): página, revisión y
-- evento en una transacción, con control de revisión.

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
