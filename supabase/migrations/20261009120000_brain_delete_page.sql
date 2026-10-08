-- Borrado de una página del brain con limpieza de links (spec etapa 18.1 §4).
-- Limpieza de las páginas que la enlazan, borrado de la página y su historial,
-- reglas de la ruta y evento, todo en una transacción. Solo lo ejecuta el
-- servidor (service_role); agente y MCP no tienen forma de borrar.

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

revoke execute on function public.brain_delete_page(
  uuid, text, integer, uuid, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.brain_delete_page(
  uuid, text, integer, uuid, uuid, jsonb
) to service_role;
