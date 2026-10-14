-- supabase/tests/37_brain_folders.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a7a7a7a7-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@fol-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b7b7b7b7-0000-0000-0000-00000000000a', 'fol-a', 'Fol A'),
       ('b7b7b7b7-0000-0000-0000-00000000000b', 'fol-b', 'Fol B');

insert into public.tenant_connections (tenant_id, capability, provider, config)
values
  ('b7b7b7b7-0000-0000-0000-00000000000a', 'brain', 'wiki',
   '{"categories": ["empresa", "comercial"], "requiredFrontmatter": [], "search": "fts"}'::jsonb),
  ('b7b7b7b7-0000-0000-0000-00000000000b', 'brain', 'wiki',
   '{"categories": ["empresa"], "requiredFrontmatter": [], "search": "fts"}'::jsonb);

-- 1-3: tabla cerrada
select has_table('public', 'brain_folders', 'existe brain_folders');
select ok(not has_table_privilege('authenticated', 'public.brain_folders', 'select'),
  'authenticated no lee brain_folders');
select ok(
  not has_function_privilege('authenticated',
    'public.brain_create_folder(uuid, uuid, text, text)', 'execute'),
  'authenticated no ejecuta brain_create_folder');

-- 4-5: carpetas desde la config
select is(public.brain_folders_from_config('b7b7b7b7-0000-0000-0000-00000000000a'), 2,
  'crea una carpeta por categoría');
select is(public.brain_folders_from_config('b7b7b7b7-0000-0000-0000-00000000000a'), 0,
  'correrla de nuevo no duplica');

-- 6-8: crear, con padre y sin padre
select lives_ok(
  $$select public.brain_create_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'comercial/sucursales', 'Una ficha por sucursal')$$,
  'crea una subcarpeta con padre');
select throws_ok(
  $$select public.brain_create_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'marketing/pauta', '')$$,
  'BR404', null, 'una subcarpeta sin padre responde not found');
select throws_ok(
  $$select public.brain_create_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'comercial', '')$$,
  'BR409', null, 'una carpeta que ya existe responde conflicto');

-- 9-10: una página nueva crea las carpetas que faltan y suma la categoría
select public.brain_upsert_page('b7b7b7b7-0000-0000-0000-00000000000a', 'marketing/pauta/meta', 'Meta', 'marketing', 'activo', '{}'::text[], '{}'::jsonb, 'x', 'alta', null, 'user', 'a7a7a7a7-0000-0000-0000-000000000001', null, null);
select is(
  (select array_agg(path order by path) from public.brain_folders where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and path like 'marketing%'),
  array['marketing', 'marketing/pauta'],
  'la página creó marketing y marketing/pauta');
select ok(
  (select config -> 'categories' ? 'marketing' from public.tenant_connections where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and capability = 'brain'),
  'la categoría nueva entró a la config');

-- 11-13: borrar (12: sin fila, 13: la última)
select throws_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'marketing')$$,
  'BR409', null, 'una carpeta con algo adentro no se borra');
select throws_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000b', 'a7a7a7a7-0000-0000-0000-000000000001', 'empresa')$$,
  'BR404', null, 'una carpeta sin fila responde not found');
select public.brain_folders_from_config('b7b7b7b7-0000-0000-0000-00000000000b');
select throws_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000b', 'a7a7a7a7-0000-0000-0000-000000000001', 'empresa')$$,
  'BR409', null, 'la última carpeta de primer nivel no se borra');

-- 14: borrar una página que comparte nombre con una carpeta conserva las reglas
select public.brain_upsert_page('b7b7b7b7-0000-0000-0000-00000000000a', 'comercial/sucursales', 'Sucursales', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'x', 'alta', null, 'user', 'a7a7a7a7-0000-0000-0000-000000000001', null, null);
insert into public.brain_access_rules (tenant_id, path, principal, level)
values ('b7b7b7b7-0000-0000-0000-00000000000a', 'comercial/sucursales', 'members', 'ninguno');
select * from public.brain_delete_page('b7b7b7b7-0000-0000-0000-00000000000a', 'comercial/sucursales', 1, 'a7a7a7a7-0000-0000-0000-000000000001', null, '[]'::jsonb);
select is(
  (select count(*)::int from public.brain_access_rules where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and path = 'comercial/sucursales'), 1,
  'las reglas de la carpeta siguen después de borrar la página homónima');

-- 15-17: borrar una vacía saca la carpeta, sus reglas y la categoría
select lives_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'comercial/sucursales')$$,
  'una carpeta vacía se borra');
select is(
  (select count(*)::int from public.brain_access_rules where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and path = 'comercial/sucursales'), 0,
  'sus reglas de acceso se borran con ella');
select lives_ok(
  $$select public.brain_delete_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'empresa')$$,
  'una de primer nivel vacía se borra si quedan otras');
select ok(
  (select not (config -> 'categories' ? 'empresa') from public.tenant_connections where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and capability = 'brain'),
  'y sale de la config');

-- 18-19: reservadas y descripción
select throws_ok(
  $$select public.brain_create_folder('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'brain', '')$$,
  'BR422', null, 'brain es reservada');
select lives_ok(
  $$select public.brain_set_folder_description('b7b7b7b7-0000-0000-0000-00000000000a', 'a7a7a7a7-0000-0000-0000-000000000001', 'comercial', 'Embudo después del CRM')$$,
  'se edita la descripción');
select is(
  (select description from public.brain_folders where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and path = 'comercial'),
  'Embudo después del CRM', 'la descripción quedó');

-- 20: aislamiento entre tenants
select is(
  (select count(*)::int from public.brain_folders where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000b'), 1,
  'el otro tenant tiene solo su carpeta');

-- 21-22: eventos y categoría calculada
select ok(
  (select count(*) > 0 from public.events where tenant_id = 'b7b7b7b7-0000-0000-0000-00000000000a' and type = 'brain.folder_created'),
  'crear deja evento');
select is(public.brain_category_for('skills/outreach'), 'skill', 'skills es la categoría skill');

select * from finish();
rollback;
