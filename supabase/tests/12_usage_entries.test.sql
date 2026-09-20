begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

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

insert into public.runs (id, tenant_id, agent, trigger, eve_session_id, status)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
        'outreach', 'chat', 'wrun_ana', 'ok');

insert into public.usage_entries (tenant_id, run_id, node, resource, amount, unit)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'outreach/draft', 'model_usd', 0.0300, 'usd'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'outreach/draft', 'model_usd', 0.0125, 'usd'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'outreach/leads', 'apollo_credits', 3, 'credits'),
  ('aaaaaaaa-0000-0000-0000-000000000003', null, 'outreach/leads', 'apollo_credits', 9, 'credits');

-- Como postgres (equivale a service_role para esto): la suma y la escritura.
select is(
  (select public.set_run_cost('dddddddd-0000-0000-0000-000000000001')),
  0.0425::numeric,
  'set_run_cost suma solo model_usd de esa corrida'
);

select is(
  (select cost_usd from public.runs where id = 'dddddddd-0000-0000-0000-000000000001'),
  0.0425::numeric,
  'set_run_cost deja el total escrito en runs.cost_usd'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.usage_entries),
  1,
  'un tenant_admin ve solo los asientos de su tenant que no son costo interno'
);

select is(
  (select count(*)::int from public.usage_entries where resource = 'model_usd'),
  0,
  'model_usd es costo interno: invisible para quien no es platform_admin'
);

select throws_ok(
  $$insert into public.usage_entries (tenant_id, node, resource, amount, unit)
    values ('aaaaaaaa-0000-0000-0000-000000000002', 'x', 'model_usd', 1, 'usd')$$,
  '42501',
  null,
  'authenticated no asienta consumo'
);

select throws_ok(
  $$update public.usage_entries set amount = 0$$,
  '42501',
  null,
  'usage_entries no acepta update'
);

select throws_ok(
  $$select public.set_run_cost('dddddddd-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'set_run_cost no es ejecutable por authenticated'
);

select * from finish();
rollback;
