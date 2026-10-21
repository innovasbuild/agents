-- Wikilinks del brain paginados por keyset (spec etapa 26.4 §2.1 (c), salida (i)).
-- brain_page_links no se inlinea (la cláusula SET lo impide), así que paginarla
-- desde el cliente con offset vuelve a extraer los links de todos los cuerpos
-- del tenant en cada llamada: el total crece con el cuadrado de las páginas.
-- Esta función acota primero (slug > p_after, orden por slug, a lo sumo p_limit,
-- con el índice único (tenant_id, slug)) y recién después corre la regexp sobre
-- esas filas: cada llamada cuesta lo mismo sin importar el tamaño del brain.
--
-- Devuelve toda página con "[[" en el cuerpo, también las que no tienen ningún
-- link válido (con links nulo): si se descartaran acá, una tanda entera de
-- páginas así devolvería una respuesta vacía y el cliente cortaría antes de
-- tiempo. El cliente avanza con el último slug recibido y descarta los nulos.
-- p_after nulo o vacío = desde el principio. Misma regex y mismos grupos crudos
-- que brain_page_links (lib/brain/core/wikilinks.ts).
--
-- brain_page_links queda sin tocar hasta que el código nuevo esté en producción;
-- su retiro es otra migración.

create or replace function public.brain_page_links_after(
  p_tenant_id uuid,
  p_after text,
  p_limit int
)
returns table (slug text, links jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
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
  from (
    -- La tanda se elige antes de extraer: el limit no deja que la regexp
    -- corra sobre filas fuera de la página.
    select bp.slug, bp.body
    from public.brain_pages bp
    where bp.tenant_id = p_tenant_id
      and bp.slug > coalesce(p_after, '')
      and position('[[' in bp.body) > 0
    order by bp.slug
    limit p_limit
  ) p
  order by p.slug
$$;

revoke execute on function public.brain_page_links_after(uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.brain_page_links_after(uuid, text, int)
  to service_role;
