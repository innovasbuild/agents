-- supabase/tests/28_member_blocks.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- Personas. El último dígito del uuid es el número de persona.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('b8b8b8b8-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm1@bk.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adm2@bk.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mem@bk.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'otro@otra.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'solo@unica.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'segundo@unica.test', now()),
  ('b8b8b8b8-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'plat@plataforma.test', now());

-- bk-a: abierta al dominio bk.test, dos administradores y un miembro.
-- bk-b: otra empresa. bk-c: una empresa con un solo administrador.
insert into public.tenants (id, slug, display_name, allowed_domains, self_signup_by_domain, auth_methods, active)
values
  ('a8a8a8a8-0000-0000-0000-00000000000a', 'bk-a', 'BK A', '{bk.test}', true, '{email}', true),
  ('a8a8a8a8-0000-0000-0000-00000000000b', 'bk-b', 'BK B', '{}', false, '{email}', true),
  ('a8a8a8a8-0000-0000-0000-00000000000c', 'bk-c', 'BK C', '{}', false, '{email}', true);

insert into public.memberships (tenant_id, user_id, role)
values
  ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000001', 'tenant_admin'),
  ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000002', 'tenant_admin'),
  ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003', 'tenant_member'),
  ('a8a8a8a8-0000-0000-0000-00000000000b', 'b8b8b8b8-0000-0000-0000-000000000004', 'tenant_admin'),
  ('a8a8a8a8-0000-0000-0000-00000000000c', 'b8b8b8b8-0000-0000-0000-000000000005', 'tenant_admin');

-- Sesión por link de correo de la persona N.
create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"b8b8b8b8-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

-- 1-3: estructura y privilegios.
select has_table('public', 'membership_blocks', 'existe la tabla de bloqueos');
select ok(has_function_privilege('authenticated', 'public.block_member(uuid, uuid)', 'execute'), 'authenticated ejecuta block_member');
select ok(not has_function_privilege('anon', 'public.unblock_member(uuid, uuid)', 'execute'), 'anon no ejecuta unblock_member');

-- 4-7: quién no puede bloquear.
select pg_temp.login_as(3);
select throws_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000002')$$,
  '42501', null, 'un miembro común no puede bloquear');
select throws_ok(
  $$insert into public.membership_blocks (tenant_id, user_id) values ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000002')$$,
  '42501', null, 'nadie escribe la tabla por la API');
select pg_temp.login_as(4);
select throws_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  '42501', null, 'el administrador de otra empresa no puede bloquear acá');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000001')$$,
  '42501', null, 'nadie se bloquea a sí mismo');

-- 8-13: bloquear a un miembro.
select lives_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  'un administrador bloquea a un miembro');
select is(
  (select count(*)::int from public.membership_blocks
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  1, 'el administrador ve el bloqueo');
select lives_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  'bloquear dos veces no falla');
reset role;
select is(
  (select count(*)::int from public.memberships
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  0, 'la membresía se borró');
select is(
  (select blocked_by from public.membership_blocks
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  'b8b8b8b8-0000-0000-0000-000000000001'::uuid, 'queda anotado quién bloqueó');
select is(
  (select count(*)::int from public.events
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and type = 'membership.blocked'
      and payload ->> 'user_id' = 'b8b8b8b8-0000-0000-0000-000000000003'),
  1, 'un solo evento aunque se bloquee dos veces');

-- 14-17: la persona bloqueada.
select pg_temp.login_as(3);
select is(
  (select count(*)::int from public.membership_blocks),
  0, 'la persona bloqueada no ve la tabla de bloqueos');
select is((select public.join_tenants_by_domain()), 0, 'el dominio abierto no vuelve a unir a un bloqueado');
select is((select public.login_gate()), '{"allowed":true,"landing":null}'::jsonb, 'login_gate no la manda a la landing de la empresa que la bloqueó');
select throws_ok(
  $$select public.unblock_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  '42501', null, 'no puede desbloquearse sola');

-- 18-20: desbloquear.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.unblock_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  'un administrador desbloquea');
reset role;
select is(
  (select count(*)::int from public.events
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and type = 'membership.unblocked'),
  1, 'desbloquear deja su evento');
select pg_temp.login_as(3);
select is((select public.join_tenants_by_domain()), 1, 'desbloqueada, el dominio abierto la vuelve a unir');

-- 21-24: una invitación levanta el bloqueo.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000003')$$,
  'se la bloquea de nuevo');
reset role;
insert into public.invitations (tenant_id, email, role, invited_by)
values ('a8a8a8a8-0000-0000-0000-00000000000a', 'mem@bk.test', 'tenant_admin', 'b8b8b8b8-0000-0000-0000-000000000001');
select pg_temp.login_as(3);
select is((select public.accept_pending_invitations()), 1, 'acepta la invitación aunque estaba bloqueada');
reset role;
select is(
  (select count(*)::int from public.membership_blocks
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  0, 'aceptar la invitación levantó el bloqueo');
select is(
  (select role::text from public.memberships
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000003'),
  'tenant_admin', 'y entra con el rol de la invitación');

-- 25-27: el único administrador no se toca.
select pg_temp.login_as(5);
select throws_ok(
  $$update public.memberships set role = 'tenant_member'
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000c' and user_id = 'b8b8b8b8-0000-0000-0000-000000000005'$$,
  '23514', 'la empresa no puede quedar sin administrador', 'el único administrador no se degrada');
select throws_ok(
  $$delete from public.memberships
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000c' and user_id = 'b8b8b8b8-0000-0000-0000-000000000005'$$,
  '23514', 'la empresa no puede quedar sin administrador', 'el único administrador no se saca');
reset role;
select throws_ok(
  $$delete from auth.users where id = 'b8b8b8b8-0000-0000-0000-000000000005'$$,
  '23514', null, 'borrar de Auth al único administrador también falla');

-- 28-31: con dos administradores sí se puede, hasta que queda uno.
insert into public.memberships (tenant_id, user_id, role)
values ('a8a8a8a8-0000-0000-0000-00000000000c', 'b8b8b8b8-0000-0000-0000-000000000006', 'tenant_admin');
select pg_temp.login_as(6);
select lives_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000c', 'b8b8b8b8-0000-0000-0000-000000000005')$$,
  'con dos administradores, uno bloquea al otro');
select throws_ok(
  $$update public.memberships set role = 'tenant_member'
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000c' and user_id = 'b8b8b8b8-0000-0000-0000-000000000006'$$,
  '23514', null, 'y el que quedó ya no se puede degradar');
select pg_temp.login_as(1);
select lives_ok(
  $$update public.memberships set role = 'tenant_member'
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000002'$$,
  'con tres administradores en bk-a, uno se degrada');
select lives_ok(
  $$update public.memberships set role = 'tenant_admin'
     where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000002'$$,
  'subir a alguien a administrador nunca lo frena el trigger');
reset role;

-- 32-34: a quién no se bloquea. La persona 7 recién acá entra como
-- platform_admin de bk-a, para que no cambie nada de lo anterior (is_platform_admin()
-- es global y el trigger la cuenta como administradora).
insert into public.memberships (tenant_id, user_id, role)
values ('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000007', 'platform_admin');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000007')$$,
  '42501', 'solo plataforma bloquea a un administrador de plataforma',
  'un administrador de la empresa no bloquea a un administrador de plataforma');
select throws_ok(
  $$select public.block_member('a8a8a8a8-0000-0000-0000-00000000000a', 'b8b8b8b8-0000-0000-0000-000000000004')$$,
  '42501', 'solo se bloquea a un miembro de la empresa',
  'no se bloquea a alguien que no es miembro de la empresa');
reset role;
select is(
  (select count(*)::int from public.membership_blocks
    where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000a' and user_id = 'b8b8b8b8-0000-0000-0000-000000000004'),
  0, 'y no queda ningún bloqueo de esa persona');

-- 35-36: borrar la empresa entera pasa, y se lleva sus bloqueos.
select lives_ok(
  $$delete from public.tenants where id = 'a8a8a8a8-0000-0000-0000-00000000000c'$$,
  'borrar una empresa entera no lo frena el trigger');
select is(
  (select count(*)::int from public.membership_blocks where tenant_id = 'a8a8a8a8-0000-0000-0000-00000000000c'),
  0, 'y sus bloqueos se van con ella');

select * from finish();
rollback;
