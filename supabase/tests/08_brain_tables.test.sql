-- supabase/tests/08_brain_tables.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a8a8a8a8-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@brain-a.test', now()),
  ('a8a8a8a8-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@brain-b.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b8b8b8b8-0000-0000-0000-00000000000a', 'brain-a', 'Brain A'),
  ('b8b8b8b8-0000-0000-0000-00000000000b', 'brain-b', 'Brain B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b8b8b8b8-0000-0000-0000-00000000000a', 'a8a8a8a8-0000-0000-0000-000000000001', 'tenant_admin'),
  ('b8b8b8b8-0000-0000-0000-00000000000b', 'a8a8a8a8-0000-0000-0000-000000000002', 'tenant_admin');

insert into public.brain_pages (id, tenant_id, slug, title, category, body, tags)
values
  ('c8c8c8c8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-00000000000a',
   'comercial/icp', 'ICP', 'comercial', 'Decisión de compra en empresas medianas', array['canon:icp']),
  ('c8c8c8c8-0000-0000-0000-00000000000b', 'b8b8b8b8-0000-0000-0000-00000000000b',
   'comercial/icp', 'ICP de B', 'comercial', 'Otro contenido', '{}');

insert into public.brain_revisions
  (tenant_id, page_id, revision, title, category, status, tags, frontmatter, body, author_kind, reason)
values
  ('b8b8b8b8-0000-0000-0000-00000000000a', 'c8c8c8c8-0000-0000-0000-00000000000a', 1,
   'ICP', 'comercial', 'activo', array['canon:icp'], '{}', 'Decisión de compra en empresas medianas', 'import', 'import inicial'),
  ('b8b8b8b8-0000-0000-0000-00000000000b', 'c8c8c8c8-0000-0000-0000-00000000000b', 1,
   'ICP de B', 'comercial', 'activo', '{}', '{}', 'Otro contenido', 'import', 'import inicial');

select ok(
  (select search @@ to_tsquery('spanish', public.f_unaccent('decision'))
     from public.brain_pages where id = 'c8c8c8c8-0000-0000-0000-00000000000a'),
  'la columna de búsqueda ignora acentos'
);

select throws_ok(
  $$insert into public.brain_pages (tenant_id, slug, title, category, body)
     values ('b8b8b8b8-0000-0000-0000-00000000000a', 'Comercial/ICP', 'x', 'comercial', 'x')$$,
  '23514', null,
  'el slug tiene que estar en minúsculas con guiones'
);

select throws_ok(
  $$insert into public.brain_pages (tenant_id, slug, title, category, body)
     values ('b8b8b8b8-0000-0000-0000-00000000000a', 'comercial/icp', 'x', 'comercial', 'x')$$,
  '23505', null,
  'el slug es único dentro del tenant'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a8a8a8a8-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.brain_pages),
  1,
  'un miembro ve solo las páginas de su tenant'
);

select is(
  (select count(*)::int from public.brain_revisions),
  1,
  'un miembro ve solo las revisiones de su tenant'
);

select throws_ok(
  $$insert into public.brain_pages (tenant_id, slug, title, category, body)
     values ('b8b8b8b8-0000-0000-0000-00000000000a', 'comercial/nueva', 'x', 'comercial', 'x')$$,
  '42501', null,
  'ni un tenant_admin escribe páginas directo: escribe el servidor'
);

select throws_ok(
  $$update public.brain_pages set body = 'pisado'$$,
  '42501', null,
  'authenticated no actualiza páginas'
);

select throws_ok(
  $$delete from public.brain_pages$$,
  '42501', null,
  'authenticated no borra páginas'
);

select throws_ok(
  $$insert into public.brain_revisions
      (tenant_id, page_id, revision, title, category, status, body, author_kind, reason)
     values ('b8b8b8b8-0000-0000-0000-00000000000a', 'c8c8c8c8-0000-0000-0000-00000000000a', 2,
             'x', 'comercial', 'activo', 'x', 'user', 'x')$$,
  '42501', null,
  'authenticated no inserta revisiones'
);

select throws_ok(
  $$update public.brain_revisions set body = 'reescrito'$$,
  '42501', null,
  'las revisiones no se actualizan'
);

select throws_ok(
  $$delete from public.brain_revisions$$,
  '42501', null,
  'las revisiones no se borran'
);

select throws_ok(
  $$truncate public.brain_revisions$$,
  '42501', null,
  'las revisiones no se truncan'
);

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.brain_pages$$,
  '42501', null,
  'anon no lee páginas'
);

select * from finish();
rollback;
