begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'colega@lagomarcino.test', now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'beto@fabrica.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', 'tenant_member'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'tenant_member');

insert into public.conversations (id, tenant_id, user_id, agent, eve_session_id)
values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '66666666-6666-6666-6666-666666666666', 'outreach', 'wrun_colega'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
   '33333333-3333-3333-3333-333333333333', 'outreach', 'wrun_beto');

-- El colega ve la suya y nada más.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

select is(
  (select count(*)::int from public.conversations),
  1,
  'un tenant_member ve solo sus conversaciones'
);

-- Ana, tenant_admin, lee las de su tenant pero no las de otro.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.conversations),
  1,
  'un tenant_admin lee las conversaciones de su tenant'
);
select is(
  (select count(*)::int from public.conversations where eve_session_id = 'wrun_beto'),
  0,
  'y ninguna de otro tenant'
);

-- Nadie crea conversaciones a nombre de otro.
select throws_ok(
  $$insert into public.conversations (tenant_id, user_id, agent)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '66666666-6666-6666-6666-666666666666', 'outreach')$$,
  '42501',
  null,
  'no se puede crear una conversación a nombre de otro usuario'
);

-- tenant_agents: el miembro lee, no escribe.
reset role;
insert into public.tenant_agents (tenant_id, agent) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'outreach');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

select throws_ok(
  $$update public.tenant_agents set enabled = false
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'un tenant_member no deshabilita agentes'
);

select * from finish();
rollback;
