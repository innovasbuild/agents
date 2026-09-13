-- supabase/tests/10_brain_search.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('aaaa1010-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@busqueda.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('bbbb1010-0000-0000-0000-00000000000a', 'busqueda-a', 'Búsqueda A'),
  ('bbbb1010-0000-0000-0000-00000000000b', 'busqueda-b', 'Búsqueda B');

insert into public.memberships (tenant_id, user_id, role)
values ('bbbb1010-0000-0000-0000-00000000000a', 'aaaa1010-0000-0000-0000-000000000001', 'tenant_admin');

insert into public.brain_pages (tenant_id, slug, title, category, status, tags, body, updated_at)
values
  ('bbbb1010-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo',
   array['canon:icp'], 'Decisión de compra en empresas medianas del agro', now() - interval '1 day'),
  ('bbbb1010-0000-0000-0000-00000000000a', 'marketing/mensajes', 'Mensajes', 'marketing', 'activo',
   array['canon:mensajes'], 'Pitch para directorios que deciden rápido', now()),
  ('bbbb1010-0000-0000-0000-00000000000a', 'comercial/viejo', 'Viejo', 'comercial', 'archivado',
   '{}', 'Decisión de compra archivada', now() - interval '2 days'),
  ('bbbb1010-0000-0000-0000-00000000000b', 'comercial/icp', 'ICP B', 'comercial', 'activo',
   '{}', 'Decisión de compra de otro cliente', now());

set local role service_role;

select is(
  (select array_agg(slug order by slug)
     from public.brain_search_pages('bbbb1010-0000-0000-0000-00000000000a', 'decision')),
  array['comercial/icp'],
  'encuentra sin acentos, sin archivadas y sin otros tenants'
);

select is(
  (select array_agg(slug order by slug)
     from public.brain_search_pages('bbbb1010-0000-0000-0000-00000000000a', 'decision', null, null, true)),
  array['comercial/icp', 'comercial/viejo'],
  'incluye archivadas si se pide'
);

select is(
  (select array_agg(slug)
     from public.brain_search_pages('bbbb1010-0000-0000-0000-00000000000a', '', null, 'canon:mensajes')),
  array['marketing/mensajes'],
  'filtra por tag de canon sin consulta'
);

select is(
  (select array_agg(slug)
     from public.brain_search_pages('bbbb1010-0000-0000-0000-00000000000a', '', 'comercial')),
  array['comercial/icp'],
  'filtra por categoría'
);

select is(
  (select array_agg(r.slug order by r.n)
     from public.brain_search_pages('bbbb1010-0000-0000-0000-00000000000a', 'de la')
       with ordinality as r(slug, title, category, status, tags, snippet, updated_at, n)),
  array['marketing/mensajes', 'comercial/icp'],
  'una consulta sin términos ordena por actualización'
);

select is(
  (select count(*)::int
     from public.brain_search_pages('bbbb1010-0000-0000-0000-00000000000a', '', null, null, true, 0)),
  1,
  'el límite mínimo es 1'
);

select ok(
  (select snippet <> ''
     from public.brain_search_pages('bbbb1010-0000-0000-0000-00000000000a', 'compra') limit 1),
  'devuelve un fragmento'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"aaaa1010-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select * from public.brain_search_pages('bbbb1010-0000-0000-0000-00000000000a', 'decision')$$,
  '42501', null,
  'authenticated no ejecuta la búsqueda directo'
);

select * from finish();
rollback;
