begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin');

insert into public.tenant_workflows (tenant_id, workflow)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas');

select is(
  (select enabled from public.tenant_workflows where workflow = 'refresh-fichas'),
  false,
  'un workflow nace apagado: lo desatendido se prende a propósito'
);

insert into public.tenant_budgets (tenant_id, resource, daily_limit)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'model_usd', 5),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'model_usd', 9);

insert into public.runs (id, tenant_id, agent, trigger, eve_session_id, status, workflow, items_claimed, items_ok, items_refused, items_failed)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
        'outreach', 'schedule', 'wf:refresh-fichas:1', 'budget_exhausted', 'refresh-fichas', 0, 0, 0, 0);

select is(
  (select status::text from public.runs where id = 'dddddddd-0000-0000-0000-000000000001'),
  'budget_exhausted',
  'runs acepta el estado budget_exhausted y las columnas de conteo'
);

insert into public.usage_entries (tenant_id, run_id, node, resource, amount, unit, created_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'n', 'model_usd', 1.5, 'usd', now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'n', 'model_usd', 2, 'usd', now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'n', 'model_usd', 40, 'usd', now() - interval '2 days'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'n', 'apollo_credits', 7, 'credits', now()),
  ('aaaaaaaa-0000-0000-0000-000000000003', null, 'n', 'model_usd', 99, 'usd', now());

select is(
  public.usage_sum('aaaaaaaa-0000-0000-0000-000000000002', 'model_usd', now() - interval '1 day'),
  3.5::numeric,
  'usage_sum suma el recurso del tenant desde la fecha, sin otros tenants ni otros recursos'
);

select is(
  public.usage_sum('aaaaaaaa-0000-0000-0000-000000000002', 'model_usd', now() - interval '1 day', 'dddddddd-0000-0000-0000-000000000001'),
  1.5::numeric,
  'con corrida, usage_sum acota a esa corrida'
);

select is(
  public.usage_sum('aaaaaaaa-0000-0000-0000-000000000002', 'otro_recurso', now() - interval '1 day'),
  0::numeric,
  'sin asientos devuelve 0, no null'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.tenant_budgets),
  1,
  'un tenant_admin ve solo el presupuesto de su tenant'
);

select throws_ok(
  $$update public.tenant_budgets set daily_limit = 1000$$,
  '42501',
  null,
  'regla congelada: ni un tenant_admin se sube el presupuesto'
);

select throws_ok(
  $$update public.tenant_workflows set enabled = true$$,
  '42501',
  null,
  'authenticated no prende workflows'
);

select throws_ok(
  $$select public.usage_sum('aaaaaaaa-0000-0000-0000-000000000002', 'model_usd', now() - interval '1 day')$$,
  '42501',
  null,
  'usage_sum no es ejecutable por authenticated: expone costo interno'
);

select * from finish();
rollback;
