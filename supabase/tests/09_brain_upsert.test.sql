-- supabase/tests/09_brain_upsert.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a9a9a9a9-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@upsert.test', now());

insert into public.tenants (id, slug, display_name)
values ('b9b9b9b9-0000-0000-0000-00000000000a', 'upsert-a', 'Upsert A');

insert into public.memberships (tenant_id, user_id, role)
values ('b9b9b9b9-0000-0000-0000-00000000000a', 'a9a9a9a9-0000-0000-0000-000000000001', 'tenant_admin');

set local role service_role;

select is(
  (select page_revision from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo',
    array['canon:icp'], '{}', 'v1', 'alta', null,
    'user', 'a9a9a9a9-0000-0000-0000-000000000001', null, null)),
  1,
  'crea la página con revisión 1'
);

select is(
  (select count(*)::int from public.brain_revisions where tenant_id = 'b9b9b9b9-0000-0000-0000-00000000000a'),
  1,
  'el alta deja la revisión 1'
);

select is(
  (select count(*)::int from public.events
     where tenant_id = 'b9b9b9b9-0000-0000-0000-00000000000a' and type = 'brain.page_upserted'),
  1,
  'el alta deja el evento'
);

select is(
  (select page_revision from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo',
    array['canon:icp'], '{}', 'v2', 'ajuste del agente', 1,
    'agent', 'a9a9a9a9-0000-0000-0000-000000000001', 'wrun_prueba', null)),
  2,
  'actualiza con la revisión base correcta'
);

select is(
  (select body from public.brain_revisions
     where tenant_id = 'b9b9b9b9-0000-0000-0000-00000000000a' and revision = 1),
  'v1',
  'la revisión anterior queda intacta'
);

select throws_ok(
  $$select * from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo',
    '{}', '{}', 'v3', 'desactualizado', 1, 'user', null, null, null)$$,
  'BR409', null,
  'rechaza una revisión base vieja'
);

select throws_ok(
  $$select * from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo',
    '{}', '{}', 'otra', 'alta a ciegas', null, 'user', null, null, null)$$,
  'BR409', null,
  'sin revisión base no pisa una página existente'
);

select throws_ok(
  $$select * from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'comercial/no-existe', 'X', 'comercial', 'activo',
    '{}', '{}', 'x', 'edición', 3, 'user', null, null, null)$$,
  'BR404', null,
  'con revisión base, la página tiene que existir'
);

select throws_ok(
  $$select * from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'comercial/otra', 'X', 'comercial', 'activo',
    '{}', '{}', 'x', '  ', null, 'user', null, null, null)$$,
  'BR422', null,
  'el motivo es obligatorio'
);

select lives_ok(
  $$select * from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'marketing/mensajes', 'Mensajes', 'marketing', 'activo',
    '{}', '{}', 'm1', 'import desde marketing/mensajes.md', null,
    'import', null, null, null, 'marketing/mensajes.md', 'hash-1')$$,
  'importa una página nueva'
);

select is(
  (select source_revision from public.brain_pages
     where tenant_id = 'b9b9b9b9-0000-0000-0000-00000000000a' and slug = 'marketing/mensajes'),
  1,
  'el import marca source_revision'
);

select lives_ok(
  $$select * from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'marketing/mensajes', 'Mensajes', 'marketing', 'activo',
    '{}', '{}', 'm2', 'edición en la plataforma', 1,
    'user', 'a9a9a9a9-0000-0000-0000-000000000001', null, null)$$,
  'una persona edita la página importada'
);

select is(
  (select revision - source_revision from public.brain_pages
     where tenant_id = 'b9b9b9b9-0000-0000-0000-00000000000a' and slug = 'marketing/mensajes'),
  1,
  'una edición en la plataforma no mueve source_revision'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a9a9a9a9-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select * from public.brain_upsert_page(
    'b9b9b9b9-0000-0000-0000-00000000000a', 'comercial/x', 'X', 'comercial', 'activo',
    '{}', '{}', 'x', 'intento', null, 'user', null, null, null)$$,
  '42501', null,
  'authenticated no ejecuta la escritura'
);

select * from finish();
rollback;
