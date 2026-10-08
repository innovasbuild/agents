-- supabase/tests/23_brain_delete_page.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a4a4a4a4-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@del-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b4b4b4b4-0000-0000-0000-00000000000a', 'del-a', 'Del A');

-- Las páginas se crean por brain_upsert_page para que tengan su revisión 1.
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'texto del icp', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp/objeciones', 'Objeciones', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'hijo', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'legal/contrato', 'Contrato', 'legal', 'activo', '{}'::text[], '{}'::jsonb, 'Ver [[comercial/icp|el ICP]] y [[otra]].', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'legal/viejo', 'Viejo', 'legal', 'archivado', '{}'::text[], '{}'::jsonb, 'Ver [[comercial/icp]].', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');
select public.brain_upsert_page('b4b4b4b4-0000-0000-0000-00000000000a', 'solo', 'Solo', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'sola', 'alta', null, 'user', 'a4a4a4a4-0000-0000-0000-000000000001', null, 'c4c4c4c4-0000-0000-0000-000000000001');

insert into public.brain_access_rules (tenant_id, path, principal, level)
values
  ('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 'members', 'ninguno'),
  ('b4b4b4b4-0000-0000-0000-00000000000a', 'solo', 'members', 'ninguno');

-- 1-3: existencia y privilegios
select has_function('public', 'brain_delete_page',
  array['uuid', 'text', 'integer', 'uuid', 'uuid', 'jsonb'],
  'existe brain_delete_page');
select ok(
  not has_function_privilege('authenticated',
    'public.brain_delete_page(uuid, text, integer, uuid, uuid, jsonb)', 'execute'),
  'authenticated no puede ejecutar brain_delete_page');
select ok(
  has_function_privilege('service_role',
    'public.brain_delete_page(uuid, text, integer, uuid, uuid, jsonb)', 'execute'),
  'service_role ejecuta brain_delete_page');

-- 4-5: revisión esperada distinta → BR409 y no se borra nada
select throws_ok(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 99, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'BR409', null, 'una revisión esperada distinta aborta con conflicto');
select is(
  (select count(*)::int from public.brain_pages where slug = 'comercial/icp'), 1,
  'tras el conflicto la página sigue');

-- 6: página inexistente → BR404
select throws_ok(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'no-existe', 1, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'BR404', null, 'una página que no existe responde not found');

-- 7-9: todo o nada. La segunda limpieza tiene una revisión base vieja.
select throws_ok(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 1, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001',
    '[{"slug":"legal/contrato","base_revision":1,"body":"limpio"},{"slug":"legal/viejo","base_revision":7,"body":"x"}]'::jsonb)$$,
  'BR409', null, 'una limpieza con revisión base vieja aborta todo');
select is(
  (select body from public.brain_pages where slug = 'legal/contrato'),
  'Ver [[comercial/icp|el ICP]] y [[otra]].',
  'la primera limpieza se deshizo con el conflicto');
select is(
  (select count(*)::int from public.brain_pages where slug = 'comercial/icp'), 1,
  'la página a borrar sigue tras el conflicto de una limpieza');

-- 10-19: borrado real con dos limpiezas. Quedan páginas debajo: las reglas se conservan.
select results_eq(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'comercial/icp', 1, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001',
    '[{"slug":"legal/contrato","base_revision":1,"body":"Ver el ICP y [[otra]]."},{"slug":"legal/viejo","base_revision":1,"body":"Ver ICP."}]'::jsonb)$$,
  $$values (1::integer, 2::integer, 0::integer)$$,
  'borra y devuelve revisiones borradas, páginas limpiadas y reglas borradas');
select is(
  (select count(*)::int from public.brain_pages where slug = 'comercial/icp'), 0,
  'la página ya no existe');
select is(
  (select count(*)::int from public.brain_revisions where title = 'ICP'), 0,
  'sus revisiones cayeron con ella');
select is(
  (select body from public.brain_pages where slug = 'legal/contrato'),
  'Ver el ICP y [[otra]].', 'el link se reemplazó en la página que enlazaba');
select is(
  (select revision from public.brain_pages where slug = 'legal/contrato'), 2,
  'la página limpiada tiene una revisión nueva');
select is(
  (select r.reason from public.brain_revisions r join public.brain_pages p on p.id = r.page_id
    where p.slug = 'legal/contrato' and r.revision = 2),
  'Se borró comercial/icp', 'la revisión de limpieza lleva el motivo');
select is(
  (select r.author_user_id from public.brain_revisions r join public.brain_pages p on p.id = r.page_id
    where p.slug = 'legal/contrato' and r.revision = 2),
  'a4a4a4a4-0000-0000-0000-000000000001'::uuid, 'la revisión de limpieza es de quien borró');
select is(
  (select body from public.brain_pages where slug = 'legal/viejo'),
  'Ver ICP.', 'también se limpió la página archivada');
select is(
  (select count(*)::int from public.brain_access_rules where path = 'comercial/icp'), 1,
  'las reglas se conservan mientras queden páginas debajo');
select is(
  (select count(*)::int from public.events where type = 'brain.page_deleted' and summary = 'comercial/icp'), 1,
  'el borrado deja exactamente un evento');

-- 20-22: página sin nada debajo: las reglas se borran con ella, y el evento lista lo limpiado.
select results_eq(
  $$select * from public.brain_delete_page('b4b4b4b4-0000-0000-0000-00000000000a', 'solo', 1, 'a4a4a4a4-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  $$values (1::integer, 0::integer, 1::integer)$$,
  'sin links ni páginas debajo borra también su regla');
select is(
  (select count(*)::int from public.brain_access_rules where path = 'solo'), 0,
  'la regla de la ruta se fue');
select is(
  (select jsonb_array_length(payload -> 'cleaned') from public.events
    where type = 'brain.page_deleted' and summary = 'comercial/icp'),
  2, 'el evento lista las páginas limpiadas');

select * from finish();
rollback;
