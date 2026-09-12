begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'beto@fabrica.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'tenant_member');

insert into public.runs (id, tenant_id, agent, trigger, eve_session_id, status, cost_usd)
values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   'outreach', 'chat', 'wrun_ana', 'ok', 0.1234),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
   'outreach', 'chat', 'wrun_beto', 'ok', 0.4321);

insert into public.events (tenant_id, run_id, type, summary)
values ('aaaaaaaa-0000-0000-0000-000000000002',
        'dddddddd-0000-0000-0000-000000000001', 'envio', 'mail enviado');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.runs),
  1,
  'un tenant_admin ve solo las ejecuciones de su tenant'
);

select throws_ok(
  $$select cost_usd from public.runs$$,
  '42501',
  null,
  'cost_usd no es visible para authenticated'
);

select is(
  (select public.run_cost_usd('dddddddd-0000-0000-0000-000000000001')),
  null,
  'run_cost_usd no devuelve costo a quien no es platform_admin'
);

select is(
  (select count(*)::int from public.events),
  1,
  'los eventos se leen dentro del tenant'
);

select throws_ok(
  $$update public.events set summary = 'editado'$$,
  '42501',
  null,
  'events no acepta update'
);

select throws_ok(
  $$delete from public.events$$,
  '42501',
  null,
  'events no acepta delete'
);

select * from finish();
rollback;
