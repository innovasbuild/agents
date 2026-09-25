begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'ana@a.test', now()),
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'beto@b.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000021', 'tenant-a', 'A'),
  ('aaaaaaaa-0000-0000-0000-000000000022', 'tenant-b', 'B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'tenant_member'),
  ('aaaaaaaa-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444444', 'tenant_member');

select is(
  (select allowed from public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'read', 1)),
  true,
  'la primera lectura del minuto pasa'
);

select results_eq(
  $$select allowed, retry_after_seconds > 0 from public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'read', 1)$$,
  $$values (false, true)$$,
  'la segunda con límite 1 se corta y dice cuánto esperar'
);

select is(
  (select allowed from public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'write', 1)),
  true,
  'escrituras y lecturas se cuentan por separado'
);

insert into public.brain_mcp_usage (tenant_id, user_id, window_start, reads)
values ('aaaaaaaa-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444444', date_trunc('minute', now()) - interval '1 minute', 500);

select is(
  (select allowed from public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444444', 'read', 60)),
  true,
  'la ventana nueva arranca de cero'
);

select throws_ok(
  $$select public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'borrar', 1)$$,
  'P0001',
  null,
  'un tipo desconocido tira'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is_empty(
  $$select 1 from public.brain_mcp_usage where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000022'$$,
  'un usuario no ve el contador de otro tenant'
);

select throws_ok(
  $$select public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'read', 1000)$$,
  '42501',
  null,
  'authenticated no puede ejecutar brain_mcp_hit'
);

select * from finish();
rollback;
