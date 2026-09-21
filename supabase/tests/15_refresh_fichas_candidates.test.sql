begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.accounts (id, tenant_id, domain, name, ficha, researched_at, expires_at)
values
  -- Vencida y nunca vista: entra.
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   'uno.test', 'Uno', '{}', now() - interval '100 days', now() - interval '10 days'),
  -- Vencida y ya encolada después de su último research: no entra.
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'dos.test', 'Dos', '{}', now() - interval '100 days', now() - interval '9 days'),
  -- Vencida, con un ítem de una ficha anterior a su último research: entra.
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002',
   'tres.test', 'Tres', '{}', now() - interval '95 days', now() - interval '5 days'),
  -- Vigente: no entra.
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002',
   'cuatro.test', 'Cuatro', '{}', now() - interval '10 days', now() + interval '80 days'),
  -- Vencida de otro tenant: no entra.
  ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000003',
   'cinco.test', 'Cinco', '{}', now() - interval '100 days', now() - interval '10 days');

insert into public.work_items (tenant_id, workflow, subject_type, subject_id, input_hash, created_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account',
   'bbbbbbbb-0000-0000-0000-000000000002', 'dos.test:x', now() - interval '8 days'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account',
   'bbbbbbbb-0000-0000-0000-000000000003', 'tres.test:viejo', now() - interval '200 days'),
  -- Un ítem de otro workflow no cuenta como "ya visto" para este.
  ('aaaaaaaa-0000-0000-0000-000000000002', 'otro-workflow', 'account',
   'bbbbbbbb-0000-0000-0000-000000000001', 'uno.test:x', now());

select results_eq(
  $$select id from public.refresh_fichas_candidates('aaaaaaaa-0000-0000-0000-000000000002', now(), 10)$$,
  $$values ('bbbbbbbb-0000-0000-0000-000000000001'::uuid), ('bbbbbbbb-0000-0000-0000-000000000003'::uuid)$$,
  'vencidas y no vistas desde su último research, solo de ese tenant, de la más vieja a la más nueva'
);

select is(
  (select count(*)::int from public.refresh_fichas_candidates('aaaaaaaa-0000-0000-0000-000000000002', now(), 1)),
  1,
  'respeta el límite'
);

select is(
  (select count(*)::int from public.refresh_fichas_candidates('aaaaaaaa-0000-0000-0000-000000000002', now() - interval '30 days', 10)),
  0,
  'vence contra la fecha que recibe, no contra now()'
);

set local role authenticated;

select throws_ok(
  $$select public.refresh_fichas_candidates('aaaaaaaa-0000-0000-0000-000000000002', now(), 10)$$,
  '42501',
  null,
  'authenticated no la puede ejecutar'
);

select * from finish();
rollback;
