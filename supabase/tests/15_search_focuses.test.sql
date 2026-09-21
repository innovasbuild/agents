begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

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

insert into public.executors (tenant_id, user_id, slug)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'ana');

insert into public.search_focuses
  (id, tenant_id, created_by, name, criteria, vector, segment, hook, idioma, max_accounts, max_contacts)
values
  ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222', 'Envases GBA',
   '{"employeeRanges":["50,200"]}'::jsonb, 'v1', 'mid_market_ar', 'h1', 'es_ar', 20, 60);

select is(
  (select status::text from public.search_focuses where id = 'ffffffff-0000-0000-0000-000000000001'),
  'activo',
  'un foco nace activo'
);

select throws_ok(
  $$insert into public.search_focuses
      (tenant_id, created_by, name, criteria, vector, segment, hook, idioma, max_accounts, max_contacts)
    values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
            'Tope cero', '{}'::jsonb, 'v1', 'mid_market_ar', 'h1', 'es_ar', 0, 10)$$,
  '23514',
  null,
  'un foco sin tope de empresas no se acepta'
);

select throws_ok(
  $$insert into public.search_focuses
      (tenant_id, created_by, name, criteria, vector, segment, hook, idioma, max_accounts, max_contacts)
    values ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
            'Ajeno', '{}'::jsonb, 'v1', 'mid_market_ar', 'h1', 'es_ar', 5, 5)$$,
  '23503',
  null,
  'el dueño del foco tiene que ser ejecutor de ese tenant'
);

insert into public.accounts (tenant_id, domain, name, ficha, expires_at, firmographics, external_ids)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'acme.test', 'Acme', '{}'::jsonb,
        now() + interval '90 days', '{"employees":120}'::jsonb, '{"apollo":"org1"}'::jsonb);

select is(
  (select firmographics->>'employees' from public.accounts where domain = 'acme.test'),
  '120',
  'accounts guarda los firmográficos de Apollo aparte de la ficha'
);

insert into public.contacts
  (tenant_id, contact_key, name, company, title, source, search_focus_id, icp, external_ids)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'li:laura-gomez', 'Laura', 'Acme',
        'Gerente General', 'apollo', 'ffffffff-0000-0000-0000-000000000001',
        '{"encaje_empresa":{"score":1.8}}'::jsonb, '{"apollo":"p1"}'::jsonb);

select is(
  (select title from public.contacts where contact_key = 'li:laura-gomez'),
  'Gerente General',
  'contacts guarda el cargo'
);

select is(
  (select icp->'encaje_empresa'->>'score' from public.contacts where contact_key = 'li:laura-gomez'),
  '1.8',
  'contacts guarda los juicios crudos del scoring'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*)::int from public.search_focuses),
  0,
  'un miembro de otro tenant no ve los focos ajenos'
);

select throws_ok(
  $$update public.search_focuses set max_contacts = 9999$$,
  '42501',
  null,
  'authenticated no escribe focos: los crean las server actions con el cliente admin'
);

select * from finish();
rollback;
