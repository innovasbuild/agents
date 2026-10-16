-- Wikilinks de cada página del brain, extraídos en la base para que el árbol,
-- el índice y el mapa no tengan que bajar el cuerpo de todas las páginas
-- (el cuerpo es lo que pesa). Devuelve los grupos crudos de WIKILINK_PATTERN
-- (lib/brain/core/wikilinks.ts); el recorte de espacios lo hace el cliente.
-- Una fila por página con links, no por link: PostgREST corta en 1000 filas.
-- Siempre acotada al tenant que pasa el servidor; authenticated no la ejecuta.

create or replace function public.brain_page_links(p_tenant_id uuid)
returns table (slug text, links jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.slug, l.links
  from (
    select
      p.slug,
      (
        select jsonb_agg(
          jsonb_build_object('target', m.groups[1], 'anchor', m.groups[2], 'alias', m.groups[3])
          order by m.ord
        )
        from regexp_matches(
          p.body,
          '\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]',
          'g'
        ) with ordinality as m(groups, ord)
      ) as links
    from public.brain_pages p
    where p.tenant_id = p_tenant_id
      and position('[[' in p.body) > 0
  ) l
  where l.links is not null
$$;

revoke execute on function public.brain_page_links(uuid)
  from public, anon, authenticated;
grant execute on function public.brain_page_links(uuid)
  to service_role;
