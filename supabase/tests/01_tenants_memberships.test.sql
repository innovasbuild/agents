begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- Fixtures: dos tenants, tres usuarios.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'admin@innov.as', now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'beto@fabrica.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'innovas', 'INNOV.AS'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'platform_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'tenant_member');

-- Ana (tenant_admin de lagomarcino) solo ve su tenant.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.tenants),
  1,
  'ana ve un solo tenant'
);
select is(
  (select slug from public.tenants),
  'lagomarcino',
  'y es el suyo'
);
select is(
  (select count(*)::int from public.tenants where slug = 'fabrica'),
  0,
  'consultar el tenant de otro devuelve cero filas, no un error'
);

-- Ana no puede coronarse platform_admin.
select throws_ok(
  $$update public.memberships set role = 'platform_admin'
     where user_id = '22222222-2222-2222-2222-222222222222'$$,
  '42501',
  null,
  'un tenant_admin no puede ascenderse a platform_admin'
);

-- Ana sí puede sumar un tenant_member a su tenant.
select lives_ok(
  $$insert into public.memberships (tenant_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '33333333-3333-3333-3333-333333333333', 'tenant_member')$$,
  'un tenant_admin puede sumar miembros a su tenant'
);

-- El platform_admin ve todo.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.tenants),
  3,
  'el platform_admin ve los tres tenants'
);

-- Sin sesión no se ve nada. Desde 20260913120000 anon no tiene ni el grant de
-- tabla: ya no recibe cero filas por RLS, el SELECT se rechaza antes.
reset role;
set local role anon;
set local "request.jwt.claims" to '';

select throws_ok(
  $$select count(*) from public.tenants$$,
  '42501', null,
  'anon no ve tenants'
);

select * from finish();
rollback;
