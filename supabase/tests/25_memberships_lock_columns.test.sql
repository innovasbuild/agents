-- supabase/tests/25_memberships_lock_columns.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a6a6a6a6-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@ml-a.test', now()),
  ('a6a6a6a6-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'miembro@ml-a.test', now()),
  ('a6a6a6a6-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'ajeno@ml-b.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'ml-a', 'ML A'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'ml-b', 'ML B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000001', 'tenant_admin'),
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000002', 'tenant_member'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'a6a6a6a6-0000-0000-0000-000000000003', 'tenant_member');

insert into public.invitations (tenant_id, email, role, invited_by, expires_at)
values ('b6b6b6b6-0000-0000-0000-00000000000a', 'nuevo@ml-a.test', 'tenant_member',
        'a6a6a6a6-0000-0000-0000-000000000001', now() + interval '7 days');

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a6a6a6a6-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'nuevo@ml-a.test', now());

-- Sesión del tenant_admin de A.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a6a6a6a6-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$insert into public.memberships (tenant_id, user_id, role)
    values ('b6b6b6b6-0000-0000-0000-00000000000a',
            'a6a6a6a6-0000-0000-0000-000000000003', 'tenant_member')$$,
  '42501', null, 'un tenant_admin no puede meter a un usuario ajeno en su tenant por INSERT');

select throws_ok(
  $$update public.memberships set user_id = 'a6a6a6a6-0000-0000-0000-000000000003'
     where user_id = 'a6a6a6a6-0000-0000-0000-000000000002'$$,
  '42501', null, 'no se puede cambiar user_id de una membresía');

select throws_ok(
  $$update public.memberships set tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000b'
     where user_id = 'a6a6a6a6-0000-0000-0000-000000000002'$$,
  '42501', null, 'no se puede cambiar tenant_id de una membresía');

select lives_ok(
  $$update public.memberships set role = 'tenant_admin'
     where user_id = 'a6a6a6a6-0000-0000-0000-000000000002'$$,
  'un tenant_admin puede cambiar el rol de un miembro de su tenant');

select throws_ok(
  $$update public.memberships set role = 'platform_admin'
     where user_id = 'a6a6a6a6-0000-0000-0000-000000000002'$$,
  '42501', null, 'no se puede dejar a nadie como platform_admin');

update public.memberships set role = 'tenant_member'
 where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000b'
   and user_id = 'a6a6a6a6-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.memberships
    where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000b' and role = 'tenant_admin'),
  0, 'no puede tocar membresías de otro tenant (0 filas afectadas)');

delete from public.memberships
 where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'
   and user_id = 'a6a6a6a6-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.memberships
    where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'
      and user_id = 'a6a6a6a6-0000-0000-0000-000000000002'),
  0, 'un tenant_admin sigue pudiendo borrar un miembro de su tenant');

-- El alta por invitación no depende del grant de la sesión.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a6a6a6a6-0000-0000-0000-000000000004","role":"authenticated"}';

select is((select public.accept_pending_invitations()), 1, 'aceptar la invitación sigue funcionando');
select is(
  (select count(*)::int from public.memberships
    where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'
      and user_id = 'a6a6a6a6-0000-0000-0000-000000000004'),
  1, 'la invitación aceptada creó la membresía');

reset role;
select * from finish();
rollback;
