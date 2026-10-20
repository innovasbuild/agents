-- supabase/tests/40_brain_page_links_after.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.tenants (id, slug, display_name)
values
  ('bbbb4040-0000-0000-0000-00000000000a', 'links-after-a', 'Links After A'),
  ('bbbb4040-0000-0000-0000-00000000000b', 'links-after-b', 'Links After B');

insert into public.brain_pages (tenant_id, slug, title, category, status, body)
values
  ('bbbb4040-0000-0000-0000-00000000000a', 'a/sin-links', 'Sin links', 'a', 'activo',
   'Nada que enlazar, ni [corchetes] sueltos'),
  ('bbbb4040-0000-0000-0000-00000000000a', 'b/roto', 'Roto', 'b', 'activo',
   'Un [[incompleto que no cierra'),
  ('bbbb4040-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo',
   E'Ver [[marketing/mensajes]] y [[marketing/voz#tono|la voz]].\nOtra vez [[ marketing/mensajes ]].'),
  ('bbbb4040-0000-0000-0000-00000000000a', 'marketing/voz', 'Voz', 'marketing', 'activo',
   E'Multilínea [[comercial/icp\n]] y [[a|b|c]]'),
  ('bbbb4040-0000-0000-0000-00000000000a', 'z/ultimo', 'Último', 'z', 'activo',
   'Vuelve a [[comercial/icp]]'),
  ('bbbb4040-0000-0000-0000-00000000000b', 'comercial/icp', 'ICP B', 'comercial', 'activo',
   'Links de otro tenant [[comercial/otro]]');

set local role service_role;

-- Sin order by en el agregado: también prueba que la función devuelve en orden.
select is(
  (select array_agg(slug)
     from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', null, 10)),
  array['b/roto', 'comercial/icp', 'marketing/voz', 'z/ultimo'],
  'p_after nulo: desde el principio, solo páginas con [[, en orden por slug, de un solo tenant'
);

select results_eq(
  $$ select slug, links from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', '', 10) $$,
  $$ select slug, links from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', null, 10) $$,
  'p_after vacío es lo mismo que nulo'
);

select is(
  (select array_agg(slug)
     from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', 'comercial/icp', 10)),
  array['marketing/voz', 'z/ultimo'],
  'p_after deja afuera ese slug y los anteriores'
);

select is(
  (select array_agg(slug)
     from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', null, 2)),
  array['b/roto', 'comercial/icp'],
  'p_limit acota la cantidad de filas'
);

select is(
  (select count(*)::int
     from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', 'z/ultimo', 10)),
  0,
  'después del último slug no hay filas: el cliente corta con la respuesta vacía'
);

select ok(
  (select links is null
     from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', null, 10)
    where slug = 'b/roto'),
  'una página con [[ sin link válido vuelve con links nulo: cuenta para el cursor'
);

select results_eq(
  $$ select slug, links
       from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', null, 10)
      where links is not null $$,
  $$ select slug, links
       from public.brain_page_links('bbbb4040-0000-0000-0000-00000000000a')
      order by slug $$,
  'extrae los mismos links que brain_page_links (grupos crudos, en orden, repetidos incluidos)'
);

reset role;

select throws_ok(
  $$ set local role authenticated; select * from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', null, 10) $$,
  '42501',
  null,
  'authenticated no la ejecuta'
);

select throws_ok(
  $$ set local role anon; select * from public.brain_page_links_after('bbbb4040-0000-0000-0000-00000000000a', null, 10) $$,
  '42501',
  null,
  'anon no la ejecuta'
);

select is(
  (select prosecdef
     from pg_proc
    where oid = 'public.brain_page_links_after(uuid, text, integer)'::regprocedure),
  false,
  'es security invoker'
);

select is(
  (select proconfig
     from pg_proc
    where oid = 'public.brain_page_links_after(uuid, text, integer)'::regprocedure),
  array['search_path=""'],
  'fija search_path vacío'
);

select * from finish();
rollback;
