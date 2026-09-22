begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.tenants (id, slug, display_name)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino');

-- Cuenta nueva: se crea con ficha = '{}' (research_account todavía no corrió)
-- y guarda los firmográficos/external_ids que trae el descubrimiento.
select public.upsert_discovered_account(
  'aaaaaaaa-0000-0000-0000-000000000002', 'uno.test', 'Uno',
  '{"employees":50}'::jsonb, '{"apollo":"org1"}'::jsonb
);

select is(
  (select ficha from public.accounts where domain = 'uno.test'),
  '{}'::jsonb,
  'una cuenta nueva se crea con ficha vacía'
);

select is(
  (select firmographics->>'employees' from public.accounts where domain = 'uno.test'),
  '50',
  'una cuenta nueva guarda los firmográficos del descubrimiento'
);

-- Cuenta existente con research real: la corrida de descubrimiento no le
-- pisa la ficha ni el vencimiento, la razón de esta migración.
insert into public.accounts (tenant_id, domain, name, ficha, researched_at, expires_at)
values (
  'aaaaaaaa-0000-0000-0000-000000000002', 'dos.test', 'Dos',
  '{"resumen":"research real"}'::jsonb, now() - interval '1 day', now() + interval '89 days'
);

select public.upsert_discovered_account(
  'aaaaaaaa-0000-0000-0000-000000000002', 'dos.test', 'Dos SRL',
  '{"employees":200}'::jsonb, '{"apollo":"org2"}'::jsonb
);

select is(
  (select ficha->>'resumen' from public.accounts where domain = 'dos.test'),
  'research real',
  'una cuenta existente con ficha real no la pierde tras un upsert de descubrimiento'
);

select ok(
  (select expires_at > now() + interval '80 days' from public.accounts where domain = 'dos.test'),
  'una cuenta existente no le pisan expires_at'
);

select is(
  (select firmographics->>'employees' from public.accounts where domain = 'dos.test'),
  '200',
  'una cuenta existente sí actualiza sus firmográficos'
);

select is(
  (select external_ids->>'apollo' from public.accounts where domain = 'dos.test'),
  'org2',
  'una cuenta existente sí actualiza sus external_ids'
);

select * from finish();
rollback;
