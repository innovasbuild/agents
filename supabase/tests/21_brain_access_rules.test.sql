-- supabase/tests/21_brain_access_rules.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a2a2a2a2-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@rules-a.test', now()),
  ('a2a2a2a2-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@rules-b.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b2b2b2b2-0000-0000-0000-00000000000a', 'rules-a', 'Rules A'),
  ('b2b2b2b2-0000-0000-0000-00000000000b', 'rules-b', 'Rules B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b2b2b2b2-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000001', 'tenant_member');

insert into public.brain_pages (tenant_id, slug, title, category, body)
values ('b2b2b2b2-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'texto');

select has_table('public', 'brain_access_rules', 'existe la tabla de reglas');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.brain_access_rules'::regclass),
  'la tabla de reglas tiene RLS habilitada'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'x', 'user', null, 'lector')$$,
  '23514', null,
  'una regla por persona exige user_id'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'x', 'members', 'a2a2a2a2-0000-0000-0000-000000000001', 'lector')$$,
  '23514', null,
  'una regla de todos los miembros no lleva user_id'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'x', 'user', 'a2a2a2a2-0000-0000-0000-000000000001', 'ninguno')$$,
  '23514', null,
  'ninguno solo vale para el acceso general'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'Comercial/ICP', 'members', 'lector')$$,
  '23514', null,
  'la ruta tiene que ser un slug válido o vacía'
);

select lives_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', '', 'members', 'lector')$$,
  'la raíz se puede abrir a todos los miembros'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', '', 'members', 'editor')$$,
  '23505', null,
  'hay una sola regla de todos los miembros por nodo'
);

select lives_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'direccion', 'members', 'ninguno')$$,
  'una carpeta se puede restringir'
);

select lives_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'direccion', 'user', 'a2a2a2a2-0000-0000-0000-000000000001', 'lector')$$,
  'una persona puede tener acceso a una carpeta restringida'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'direccion', 'user', 'a2a2a2a2-0000-0000-0000-000000000001', 'editor')$$,
  '23505', null,
  'una persona tiene una sola regla por nodo'
);

select lives_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000b', '', 'members', 'lector')$$,
  'cada tenant tiene su propia raíz'
);

select is(
  (select count(*)::int from public.brain_access_rules where tenant_id = 'b2b2b2b2-0000-0000-0000-00000000000a'),
  3,
  'las reglas de un tenant son las suyas'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a2a2a2a2-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select count(*) from public.brain_access_rules$$,
  '42501', null,
  'un miembro no lee las reglas por la API'
);

select throws_ok(
  $$insert into public.brain_access_rules (tenant_id, path, principal, level)
    values ('b2b2b2b2-0000-0000-0000-00000000000a', 'x', 'members', 'editor')$$,
  '42501', null,
  'un miembro no escribe reglas por la API'
);

select throws_ok(
  $$select count(*) from public.brain_pages$$,
  '42501', null,
  'un miembro ya no lee las páginas del brain directo: lee el servidor'
);

select throws_ok(
  $$select count(*) from public.brain_revisions$$,
  '42501', null,
  'un miembro ya no lee las revisiones del brain directo'
);

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.brain_access_rules$$,
  '42501', null,
  'anon no lee las reglas'
);

reset role;
delete from public.tenants where id = 'b2b2b2b2-0000-0000-0000-00000000000b';

select is(
  (select count(*)::int from public.brain_access_rules where tenant_id = 'b2b2b2b2-0000-0000-0000-00000000000b'),
  0,
  'borrar el tenant borra sus reglas'
);

select * from finish();
rollback;
