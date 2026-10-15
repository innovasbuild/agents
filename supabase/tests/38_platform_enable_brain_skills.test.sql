-- supabase/tests/38_platform_enable_brain_skills.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a8a8a8a8-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@sk-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b8b8b8b8-0000-0000-0000-00000000000a', 'sk-a', 'Sk A'),
       ('b8b8b8b8-0000-0000-0000-00000000000b', 'sk-b', 'Sk B'),
       ('b8b8b8b8-0000-0000-0000-00000000000c', 'sk-c', 'Sk C'),
       ('b8b8b8b8-0000-0000-0000-00000000000d', 'sk-d', 'Sk D');

-- a: brain sin skills; b: sin brain; c: carpeta skills pero config desfasada;
-- d: 20 carpetas de primer nivel.
insert into public.tenant_connections (tenant_id, capability, provider, config)
values
  ('b8b8b8b8-0000-0000-0000-00000000000a', 'brain', 'wiki',
   '{"categories": ["empresa", "comercial"], "requiredFrontmatter": [], "search": "fts"}'::jsonb),
  ('b8b8b8b8-0000-0000-0000-00000000000c', 'brain', 'wiki',
   '{"categories": ["empresa"], "requiredFrontmatter": [], "search": "fts"}'::jsonb),
  ('b8b8b8b8-0000-0000-0000-00000000000d', 'brain', 'wiki',
   '{"categories": ["empresa"], "requiredFrontmatter": [], "search": "fts"}'::jsonb);

select public.brain_folders_from_config('b8b8b8b8-0000-0000-0000-00000000000a');
select public.brain_folders_from_config('b8b8b8b8-0000-0000-0000-00000000000c');
select public.brain_folders_from_config('b8b8b8b8-0000-0000-0000-00000000000d');
insert into public.brain_folders (tenant_id, path)
values ('b8b8b8b8-0000-0000-0000-00000000000c', 'skills');
insert into public.brain_folders (tenant_id, path)
select 'b8b8b8b8-0000-0000-0000-00000000000d', 'carpeta-' || g from generate_series(1, 19) g;

-- 1: solo el servidor
select ok(
  not has_function_privilege('authenticated',
    'public.platform_enable_brain_skills(uuid, uuid)', 'execute'),
  'authenticated no ejecuta platform_enable_brain_skills');

-- 2-3: validaciones
select throws_ok(
  $$select public.platform_enable_brain_skills(null, 'b8b8b8b8-0000-0000-0000-00000000000a')$$,
  'P0001', null, 'sin actor no hace nada');
select throws_ok(
  $$select public.platform_enable_brain_skills('a8a8a8a8-0000-0000-0000-000000000001', 'b8b8b8b8-0000-0000-0000-00000000000b')$$,
  '23514', 'la empresa no tiene brain', 'una empresa sin brain responde con mensaje de consola');

-- 4: antes, brain_create_folder la rechaza
select throws_ok(
  $$select public.brain_create_folder('b8b8b8b8-0000-0000-0000-00000000000a', 'a8a8a8a8-0000-0000-0000-000000000001', 'skills', '')$$,
  'BR422', null, 'brain_create_folder sigue rechazando skills');

-- 5-8: habilitar
select is(
  public.platform_enable_brain_skills('a8a8a8a8-0000-0000-0000-000000000001', 'b8b8b8b8-0000-0000-0000-00000000000a'),
  true, 'habilita skills y avisa que cambió algo');
select ok(
  exists (select 1 from public.brain_folders where tenant_id = 'b8b8b8b8-0000-0000-0000-00000000000a' and path = 'skills'),
  'aparece la carpeta skills');
select is(
  (select config -> 'categories' from public.tenant_connections where tenant_id = 'b8b8b8b8-0000-0000-0000-00000000000a' and capability = 'brain'),
  '["comercial", "empresa", "skill"]'::jsonb,
  'la categoría skill entró a la config, sin tocar las otras');
select is(
  (select count(*)::int from public.events where tenant_id = 'b8b8b8b8-0000-0000-0000-00000000000a' and type = 'brain.skills_enabled' and actor_user_id = 'a8a8a8a8-0000-0000-0000-000000000001'),
  1, 'deja un evento con el actor');

-- 9-10: idempotente
select is(
  public.platform_enable_brain_skills('a8a8a8a8-0000-0000-0000-000000000001', 'b8b8b8b8-0000-0000-0000-00000000000a'),
  false, 'correrla de nuevo no cambia nada');
select is(
  (select count(*)::int from public.events where tenant_id = 'b8b8b8b8-0000-0000-0000-00000000000a' and type = 'brain.skills_enabled'),
  1, 'y no deja otro evento');

-- 11: se puede publicar una página bajo skills/
select lives_ok(
  $$select public.brain_upsert_page('b8b8b8b8-0000-0000-0000-00000000000a', 'skills/diseno', 'Diseño', 'skill', 'activo', '{}'::text[], '{}'::jsonb, 'x', 'alta', null, 'user', 'a8a8a8a8-0000-0000-0000-000000000001', null, null)$$,
  'se crea la página skills/diseno');

-- 12-13: config desfasada (carpeta sin categoría): se repara
select is(
  public.platform_enable_brain_skills('a8a8a8a8-0000-0000-0000-000000000001', 'b8b8b8b8-0000-0000-0000-00000000000c'),
  true, 'con la carpeta pero sin la categoría, la categoría se repone');
select ok(
  (select config -> 'categories' ? 'skill' from public.tenant_connections where tenant_id = 'b8b8b8b8-0000-0000-0000-00000000000c' and capability = 'brain'),
  'la config quedó con skill');

-- 14: tope de carpetas de primer nivel
select throws_ok(
  $$select public.platform_enable_brain_skills('a8a8a8a8-0000-0000-0000-000000000001', 'b8b8b8b8-0000-0000-0000-00000000000d')$$,
  '23514', null, 'con 20 carpetas de primer nivel no entra una más');

-- 15-16: aislamiento
select ok(
  not exists (select 1 from public.brain_folders where tenant_id = 'b8b8b8b8-0000-0000-0000-00000000000d' and path = 'skills'),
  'la empresa que falló no recibió la carpeta');
select is(
  (select count(*)::int from public.events where tenant_id in ('b8b8b8b8-0000-0000-0000-00000000000b', 'b8b8b8b8-0000-0000-0000-00000000000d') and type = 'brain.skills_enabled'),
  0, 'las que fallaron no dejaron evento');

select * from finish();
rollback;
