-- supabase/tests/33_agentless_tenant.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('e3e3e3e3-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'plat@at.test', now());

-- 1-3: alta sin agentes.
select lives_ok(
  $$select public.platform_create_tenant('e3e3e3e3-0000-0000-0000-000000000001', 'at-brain', 'AT Brain', '{at.test}', '{email}', '{}'::jsonb, '{}')$$,
  'crea una empresa sin agentes');
select is(
  (select count(*)::int from public.tenant_agents ta join public.tenants t on t.id = ta.tenant_id where t.slug = 'at-brain'),
  0, 'no nace ninguna fila de agente');
select is(
  (select e.payload -> 'agents' from public.events e join public.tenants t on t.id = e.tenant_id where t.slug = 'at-brain' and e.type = 'tenant.created'),
  '[]'::jsonb, 'el evento dice que nació sin agentes');

-- Brain de la empresa, con una página en la categoría comercial.
select public.platform_bind_connection(
  'e3e3e3e3-0000-0000-0000-000000000001',
  (select id from public.tenants where slug = 'at-brain'),
  'brain', 'wiki', '{}',
  '{"categories": ["empresa", "comercial"], "search": "fts", "requiredFrontmatter": ["title"]}'::jsonb, null);

insert into public.brain_pages (tenant_id, slug, title, category, status, body)
select id, 'comercial/nota', 'Nota', 'comercial', 'activo', 'x' from public.tenants where slug = 'at-brain';

-- 4-6: privilegios.
select ok(not has_function_privilege('authenticated', 'public.platform_set_brain_categories(uuid, uuid, text[])', 'execute'), 'authenticated no cambia categorías');
select ok(not has_function_privilege('anon', 'public.platform_set_brain_categories(uuid, uuid, text[])', 'execute'), 'anon tampoco');
select ok(has_function_privilege('service_role', 'public.platform_set_brain_categories(uuid, uuid, text[])', 'execute'), 'service_role sí');

-- 7-8: guardar.
select lives_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{empresa,trigo,comercial}')$$,
  'agrega una categoría');
select is(
  (select c.config from public.tenant_connections c join public.tenants t on t.id = c.tenant_id where t.slug = 'at-brain' and c.capability = 'brain'),
  '{"categories": ["empresa", "trigo", "comercial"], "search": "fts", "requiredFrontmatter": ["title"]}'::jsonb,
  'cambia solo categories, el resto de config queda igual');

-- 9-14: rechazos.
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{empresa,trigo}')$$,
  '23514', 'la categoría comercial tiene 1 página: movela antes de quitarla', 'no quita una categoría con páginas');
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{}')$$,
  '23514', 'el brain necesita entre 1 y 20 categorías', 'ni cero');
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{comercial,Trigo}')$$,
  '23514', 'la categoría Trigo no es válida: minúsculas, números y guiones, empezando con una letra', 'ni mayúsculas');
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{comercial,comercial}')$$,
  '23514', 'la lista de categorías tiene repetidas', 'ni repetidas');
select throws_ok(
  $$select public.platform_set_brain_categories(null, (select id from public.tenants where slug = 'at-brain'), '{comercial}')$$,
  'P0001', 'falta el actor', 'sin actor no corre');
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', gen_random_uuid(), '{comercial}')$$,
  '23514', 'la empresa no tiene brain', 'sin brain no hay qué cambiar');

select * from finish();
rollback;
