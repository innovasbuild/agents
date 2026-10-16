-- supabase/tests/39_brain_page_links.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.tenants (id, slug, display_name)
values
  ('bbbb3939-0000-0000-0000-00000000000a', 'links-a', 'Links A'),
  ('bbbb3939-0000-0000-0000-00000000000b', 'links-b', 'Links B');

insert into public.brain_pages (tenant_id, slug, title, category, status, body)
values
  ('bbbb3939-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo',
   E'Ver [[marketing/mensajes]] y [[marketing/voz#tono|la voz]].\nOtra vez [[ marketing/mensajes ]] y [[comercial/viejo|el viejo]].'),
  ('bbbb3939-0000-0000-0000-00000000000a', 'marketing/mensajes', 'Mensajes', 'marketing', 'activo',
   'Sin ningún link, ni [corchetes] sueltos [[incompleto'),
  ('bbbb3939-0000-0000-0000-00000000000a', 'marketing/voz', 'Voz', 'marketing', 'activo',
   E'Multilínea [[comercial/icp\n]] y [[a|b|c]]'),
  ('bbbb3939-0000-0000-0000-00000000000b', 'comercial/icp', 'ICP B', 'comercial', 'activo',
   'Links de otro tenant [[comercial/otro]]');

set local role service_role;

select is(
  (select array_agg(slug order by slug)
     from public.brain_page_links('bbbb3939-0000-0000-0000-00000000000a')),
  array['comercial/icp', 'marketing/voz'],
  'devuelve solo las páginas con links, de un solo tenant'
);

select is(
  (select jsonb_array_length(links)
     from public.brain_page_links('bbbb3939-0000-0000-0000-00000000000a')
    where slug = 'comercial/icp'),
  4,
  'devuelve un elemento por link, repetidos incluidos (el cliente deduplica)'
);

select is(
  (select links -> 1
     from public.brain_page_links('bbbb3939-0000-0000-0000-00000000000a')
    where slug = 'comercial/icp'),
  '{"alias": "la voz", "anchor": "#tono", "target": "marketing/voz"}'::jsonb,
  'separa destino, ancla (con el #) y alias'
);

select is(
  (select links -> 0
     from public.brain_page_links('bbbb3939-0000-0000-0000-00000000000a')
    where slug = 'comercial/icp'),
  '{"alias": null, "anchor": null, "target": "marketing/mensajes"}'::jsonb,
  'los grupos que no matchean quedan en null'
);

select is(
  (select links -> 2 ->> 'target'
     from public.brain_page_links('bbbb3939-0000-0000-0000-00000000000a')
    where slug = 'comercial/icp'),
  ' marketing/mensajes ',
  'devuelve el destino crudo: el recorte lo hace el cliente'
);

select is(
  (select jsonb_array_length(links)
     from public.brain_page_links('bbbb3939-0000-0000-0000-00000000000a')
    where slug = 'marketing/voz'),
  2,
  'el destino puede cruzar un salto de línea, igual que la regex del cliente'
);

reset role;

select throws_ok(
  $$ set local role authenticated; select * from public.brain_page_links('bbbb3939-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'authenticated no la ejecuta'
);

select * from finish();
rollback;
