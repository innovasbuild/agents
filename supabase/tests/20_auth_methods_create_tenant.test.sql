begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'admin@innov.as', now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'innovas', 'INNOV.AS'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'platform_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin');

select is(
  (select auth_methods from public.tenants where slug = 'innovas'),
  array['email', 'google'],
  'una fila existente queda con los dos métodos por defecto'
);

select throws_ok(
  $$update public.tenants set auth_methods = '{}' where slug = 'innovas'$$,
  '23514', null, 'auth_methods no puede quedar vacío'
);

select throws_ok(
  $$update public.tenants set auth_methods = '{email,saml}' where slug = 'innovas'$$,
  '23514', null, 'auth_methods rechaza un método desconocido'
);

-- El alta la hace el servidor (service_role) desde la consola, con el actor
-- explícito. Ningún rol de sesión puede llamarla.
select lives_ok(
  $$select public.platform_create_tenant('11111111-1111-1111-1111-111111111111', 'acme', 'Acme', '{acme.test}', '{email}', '{"primary":"#112233"}'::jsonb, '{outreach}')$$,
  'el servidor crea una empresa'
);

select is(
  (select count(*)::int from public.tenant_agents ta
     join public.tenants t on t.id = ta.tenant_id
   where t.slug = 'acme' and ta.agent = 'outreach' and ta.enabled),
  1,
  'la empresa nueva nace con el agente elegido activo'
);

select is(
  (select auth_methods from public.tenants where slug = 'acme'),
  array['email'],
  'la empresa nueva guarda los métodos elegidos'
);

select throws_ok(
  $$select public.platform_create_tenant('11111111-1111-1111-1111-111111111111', 'acme', 'Acme 2', '{}', '{email}', '{}'::jsonb, '{outreach}')$$,
  '23505', null, 'un slug repetido falla con unique_violation'
);

select ok(
  not has_function_privilege('authenticated', 'public.platform_create_tenant(uuid, text, text, text[], text[], jsonb, text[])', 'execute'),
  'ninguna sesión puede crear empresas: lo hace el servidor'
);

select * from finish();
rollback;
