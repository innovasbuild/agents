-- Búsqueda full-text del brain (spec brain §6.1). Siempre acotada al tenant
-- que pasa el servidor; authenticated no la ejecuta.

create or replace function public.brain_search_pages(
  p_tenant_id uuid,
  p_query text,
  p_category text default null,
  p_tag text default null,
  p_include_archived boolean default false,
  p_limit integer default 8
)
returns table (
  slug text,
  title text,
  category text,
  status public.brain_page_status,
  tags text[],
  snippet text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select websearch_to_tsquery(
      'spanish'::regconfig,
      public.f_unaccent(coalesce(p_query, ''))
    ) as query
  )
  select
    p.slug,
    p.title,
    p.category,
    p.status,
    p.tags,
    case
      when numnode(q.query) > 0
        then ts_headline('spanish'::regconfig, p.body, q.query, 'MaxWords=30, MinWords=10, MaxFragments=1')
      else left(p.body, 240)
    end,
    p.updated_at
  from public.brain_pages p
  cross join q
  where p.tenant_id = p_tenant_id
    and (p_category is null or p.category = p_category)
    and (p_tag is null or p.tags @> array[p_tag])
    and (p_include_archived or p.status <> 'archivado')
    and (numnode(q.query) = 0 or p.search @@ q.query)
  order by
    case when numnode(q.query) > 0 then ts_rank_cd(p.search, q.query) else 0 end desc,
    p.updated_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20)
$$;

revoke execute on function public.brain_search_pages(uuid, text, text, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.brain_search_pages(uuid, text, text, text, boolean, integer)
  to service_role;
