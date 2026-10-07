-- supabase/tests/22_brain_access_rule_fns.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a3a3a3a3-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@fns-a.test', now()),
  ('a3a3a3a3-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adm@fns-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b3b3b3b3-0000-0000-0000-00000000000a', 'fns-a', 'Fns A');

select has_function('public', 'brain_set_access_rule',
  array['uuid', 'text', 'brain_access_principal', 'uuid', 'brain_access_level', 'uuid'],
  'existe brain_set_access_rule');
select has_function('public', 'brain_remove_access_rule',
  array['uuid', 'text', 'brain_access_principal', 'uuid', 'uuid'],
  'existe brain_remove_access_rule');

select ok(
  not has_function_privilege('authenticated',
    'public.brain_set_access_rule(uuid, text, public.brain_access_principal, uuid, public.brain_access_level, uuid)',
    'execute'),
  'authenticated no puede ejecutar brain_set_access_rule'
);
select ok(
  has_function_privilege('service_role',
    'public.brain_set_access_rule(uuid, text, public.brain_access_principal, uuid, public.brain_access_level, uuid)',
    'execute'),
  'service_role ejecuta brain_set_access_rule'
);

select public.brain_set_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'comercial', 'user',
  'a3a3a3a3-0000-0000-0000-000000000001', 'lector', 'a3a3a3a3-0000-0000-0000-000000000002');

select is(
  (select level::text from public.brain_access_rules
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a' and path = 'comercial'
      and user_id = 'a3a3a3a3-0000-0000-0000-000000000001'),
  'lector',
  'set crea la regla por persona'
);

select public.brain_set_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'comercial', 'user',
  'a3a3a3a3-0000-0000-0000-000000000001', 'editor', 'a3a3a3a3-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.brain_access_rules
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a' and path = 'comercial'
      and user_id = 'a3a3a3a3-0000-0000-0000-000000000001'),
  1,
  'dar acceso dos veces a la misma persona no duplica la fila'
);
select is(
  (select level::text from public.brain_access_rules
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a' and path = 'comercial'
      and user_id = 'a3a3a3a3-0000-0000-0000-000000000001'),
  'editor',
  'la segunda llamada cambia el nivel'
);

-- Acceso general: user_id nulo cuenta como igual (índice nulls not distinct).
select public.brain_set_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'legal', 'members', null, 'ninguno',
  'a3a3a3a3-0000-0000-0000-000000000002');
select public.brain_set_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'legal', 'members', null, 'lector',
  'a3a3a3a3-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.brain_access_rules
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a' and path = 'legal'),
  1,
  'el acceso general de un nodo es una sola fila'
);

select is(
  (select count(*)::int from public.events
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a'
      and type = 'brain.access_changed'),
  4,
  'cada set deja exactamente un evento'
);

select public.brain_remove_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'comercial', 'user',
  'a3a3a3a3-0000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000002');
select public.brain_remove_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'comercial', 'user',
  'a3a3a3a3-0000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000002');

select results_eq(
  $$select payload->>'action', payload->>'path', payload->>'level'
      from public.events
     where type = 'brain.access_changed' and payload->>'action' = 'remove'$$,
  $$values ('remove'::text, 'comercial'::text, null::text)$$,
  'quitar una regla que existe deja un evento remove, y quitar una que ya no existe no deja otro'
);

select * from finish();
rollback;
