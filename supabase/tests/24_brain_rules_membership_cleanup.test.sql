-- supabase/tests/24_brain_rules_membership_cleanup.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a5a5a5a5-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@mc-a.test', now()),
  ('a5a5a5a5-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@mc-a.test', now()),
  ('a5a5a5a5-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol@mc-a.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b5b5b5b5-0000-0000-0000-00000000000a', 'mc-a', 'MC A'),
  ('b5b5b5b5-0000-0000-0000-00000000000b', 'mc-b', 'MC B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b5b5b5b5-0000-0000-0000-00000000000a', 'a5a5a5a5-0000-0000-0000-000000000001', 'tenant_member'),
  ('b5b5b5b5-0000-0000-0000-00000000000b', 'a5a5a5a5-0000-0000-0000-000000000001', 'tenant_member'),
  ('b5b5b5b5-0000-0000-0000-00000000000a', 'a5a5a5a5-0000-0000-0000-000000000002', 'tenant_member'),
  ('b5b5b5b5-0000-0000-0000-00000000000a', 'a5a5a5a5-0000-0000-0000-000000000003', 'tenant_member');

insert into public.brain_access_rules (tenant_id, path, principal, user_id, level)
values
  ('b5b5b5b5-0000-0000-0000-00000000000a', 'comercial', 'user', 'a5a5a5a5-0000-0000-0000-000000000001', 'editor'),
  ('b5b5b5b5-0000-0000-0000-00000000000b', 'legal', 'user', 'a5a5a5a5-0000-0000-0000-000000000001', 'lector'),
  ('b5b5b5b5-0000-0000-0000-00000000000a', 'comercial', 'user', 'a5a5a5a5-0000-0000-0000-000000000002', 'lector'),
  ('b5b5b5b5-0000-0000-0000-00000000000a', '', 'members', null, 'lector');

-- 1-3: existencia y privilegios
select has_trigger('public', 'memberships', 'memberships_brain_rules_cleanup',
  'existe el trigger que limpia las reglas al borrar una membresía');
select has_function('public', 'brain_cleanup_orphan_access_rules', 'existe la limpieza de reglas huérfanas');
select ok(
  not has_function_privilege('authenticated', 'public.brain_cleanup_orphan_access_rules()', 'execute'),
  'authenticated no puede ejecutar la limpieza de huérfanas');

-- Ana sale del tenant A.
delete from public.memberships
where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'
  and user_id = 'a5a5a5a5-0000-0000-0000-000000000001';

-- 4-7: se van sus reglas de A y solo esas
select is(
  (select count(*)::int from public.brain_access_rules
    where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'
      and user_id = 'a5a5a5a5-0000-0000-0000-000000000001'),
  0, 'las reglas de la persona en ese tenant se van con su membresía');
select is(
  (select count(*)::int from public.brain_access_rules
    where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000b'
      and user_id = 'a5a5a5a5-0000-0000-0000-000000000001'),
  1, 'las reglas de la misma persona en otro tenant quedan');
select is(
  (select count(*)::int from public.brain_access_rules
    where user_id = 'a5a5a5a5-0000-0000-0000-000000000002'),
  1, 'las reglas de otra persona quedan');
select is(
  (select count(*)::int from public.brain_access_rules
    where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a' and principal = 'members'),
  1, 'el acceso general del nodo queda');

-- 8-10: deja su evento
select is(
  (select count(*)::int from public.events
    where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'
      and type = 'brain.access_changed'
      and payload ->> 'reason' = 'membership_removed'),
  1, 'deja un evento brain.access_changed por la regla borrada');
select results_eq(
  $$select payload ->> 'path', payload ->> 'user_id', payload ->> 'action'
      from public.events
     where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'
       and payload ->> 'reason' = 'membership_removed'$$,
  $$values ('comercial'::text, 'a5a5a5a5-0000-0000-0000-000000000001'::text, 'remove'::text)$$,
  'el evento dice qué ruta, de quién y que fue un remove');
select is(
  (select count(*)::int from public.events
    where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000b' and type = 'brain.access_changed'),
  0, 'no deja eventos en el otro tenant');

-- 11: reinvitar no revive nada
insert into public.memberships (tenant_id, user_id, role)
values ('b5b5b5b5-0000-0000-0000-00000000000a', 'a5a5a5a5-0000-0000-0000-000000000001', 'tenant_member');
select is(
  (select count(*)::int from public.brain_access_rules
    where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'
      and user_id = 'a5a5a5a5-0000-0000-0000-000000000001'),
  0, 'al reinvitarla no reaparece ninguna regla');

-- 12: quien no tenía reglas no deja evento
create temp table _events_before as
  select count(*)::int as n from public.events where type = 'brain.access_changed';
delete from public.memberships
where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'
  and user_id = 'a5a5a5a5-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.events where type = 'brain.access_changed'),
  (select n from _events_before),
  'borrar la membresía de quien no tiene reglas no deja evento');

-- 13-16: limpieza de lo que ya estaba huérfano (con el trigger apagado se simula)
alter table public.memberships disable trigger memberships_brain_rules_cleanup;
delete from public.memberships
where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'
  and user_id = 'a5a5a5a5-0000-0000-0000-000000000002';
alter table public.memberships enable trigger memberships_brain_rules_cleanup;
select is(
  (select count(*)::int from public.brain_access_rules
    where user_id = 'a5a5a5a5-0000-0000-0000-000000000002'),
  1, 'con el trigger apagado la regla quedó huérfana');
select is(public.brain_cleanup_orphan_access_rules(), 1, 'la limpieza borra la huérfana y dice cuántas');
select is(
  (select count(*)::int from public.brain_access_rules
    where user_id = 'a5a5a5a5-0000-0000-0000-000000000002'),
  0, 'la huérfana ya no está');
select is(
  (select count(*)::int from public.events where payload ->> 'reason' = 'orphan_cleanup'),
  1, 'la limpieza de huérfanas deja su evento');

-- 17: borrar un tenant entero no se rompe por el trigger
select lives_ok(
  $$delete from public.tenants where id = 'b5b5b5b5-0000-0000-0000-00000000000b'$$,
  'borrar un tenant (cascada de membresías y reglas) sigue andando');

select * from finish();
rollback;
