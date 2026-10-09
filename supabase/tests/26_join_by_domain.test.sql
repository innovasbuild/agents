-- supabase/tests/26_join_by_domain.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c7c7c7c7-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@dom-a.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@dom-a.test', null),
  ('c7c7c7c7-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cami@sub.dom-a.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'Dani@DOM-A.Test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'eva@dom-a.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'adm@other.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'pa@other.test', now());

insert into public.tenants (id, slug, display_name, allowed_domains, self_signup_by_domain, active)
values
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'jd-a', 'JD A', '{dom-a.test}', true, true),
  ('d7d7d7d7-0000-0000-0000-00000000000b', 'jd-b', 'JD B', '{DOM-A.test,dom-x.test}', true, true),
  ('d7d7d7d7-0000-0000-0000-00000000000c', 'jd-c', 'JD C', '{dom-a.test}', false, true),
  ('d7d7d7d7-0000-0000-0000-00000000000d', 'jd-d', 'JD D', '{dom-a.test}', true, false);

insert into public.memberships (tenant_id, user_id, role)
values
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'c7c7c7c7-0000-0000-0000-000000000005', 'tenant_admin'),
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'c7c7c7c7-0000-0000-0000-000000000006', 'tenant_admin'),
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'c7c7c7c7-0000-0000-0000-000000000007', 'platform_admin');

-- 1-3: existencia y privilegios
select has_function('public', 'join_tenants_by_domain', 'existe la función de ingreso por dominio');
select ok(
  not has_function_privilege('anon', 'public.join_tenants_by_domain()', 'execute'),
  'anon no puede ejecutar el ingreso por dominio');
select ok(
  has_function_privilege('authenticated', 'public.join_tenants_by_domain()', 'execute'),
  'authenticated sí puede ejecutar el ingreso por dominio');

-- Ana: dominio exacto, entra a las dos empresas abiertas y a ninguna más.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000001","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is((select public.join_tenants_by_domain()), 2, 'Ana entra a las dos empresas abiertas con su dominio');
reset role;

select is(
  (select count(*)::int from public.memberships
    where user_id = 'c7c7c7c7-0000-0000-0000-000000000001'),
  2, 'Ana quedó con dos membresías');
select is(
  (select count(*)::int from public.memberships
    where user_id = 'c7c7c7c7-0000-0000-0000-000000000001'
      and tenant_id in ('d7d7d7d7-0000-0000-0000-00000000000c', 'd7d7d7d7-0000-0000-0000-00000000000d')),
  0, 'no entra a la empresa cerrada ni a la inactiva');
select is(
  (select count(*)::int from public.memberships
    where user_id = 'c7c7c7c7-0000-0000-0000-000000000001' and role = 'tenant_member'),
  2, 'entra siempre como tenant_member');
select is(
  (select count(*)::int from public.events
    where actor_user_id = 'c7c7c7c7-0000-0000-0000-000000000001'
      and type = 'membership.joined_by_domain'),
  2, 'cada alta deja su evento');

-- Segunda llamada: idempotente.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000001","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is((select public.join_tenants_by_domain()), 0, 'la segunda llamada no crea nada');
reset role;
select is(
  (select count(*)::int from public.events
    where actor_user_id = 'c7c7c7c7-0000-0000-0000-000000000001'
      and type = 'membership.joined_by_domain'),
  2, 'la segunda llamada no deja eventos');

-- Beto: correo sin confirmar.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000002","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is((select public.join_tenants_by_domain()), 0, 'un correo sin confirmar no se une a nada');

-- Cami: subdominio.
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000003","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is((select public.join_tenants_by_domain()), 0, 'un subdominio no coincide');

-- Dani: correo en mayúsculas contra un dominio guardado en mayúsculas.
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000004","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is((select public.join_tenants_by_domain()), 2, 'mayúsculas en el correo y en la tabla no importan');

-- Eva: ya es tenant_admin de jd-a; solo suma jd-b.
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000005","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is((select public.join_tenants_by_domain()), 1, 'quien ya es miembro no se cuenta de nuevo');
reset role;
select is(
  (select role::text from public.memberships
    where user_id = 'c7c7c7c7-0000-0000-0000-000000000005'
      and tenant_id = 'd7d7d7d7-0000-0000-0000-00000000000a'),
  'tenant_admin', 'el ingreso por dominio no baja el rol de un admin');

-- Sin sesión.
set local role authenticated;
set local "request.jwt.claims" to '{}';
select throws_ok(
  $$select public.join_tenants_by_domain()$$,
  'P0001', 'no authenticated user', 'sin sesión no hay ingreso');
reset role;

-- Candado de columnas: tenant_admin de jd-a (Adm).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000006","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';

update public.tenants set default_model = 'anthropic/claude-haiku-4.5' where slug = 'jd-a';
select is((select default_model from public.tenants where slug = 'jd-a'),
  'anthropic/claude-haiku-4.5', 'un tenant_admin cambia el modelo default');

update public.tenants set self_signup_by_domain = false where slug = 'jd-a';
select is((select self_signup_by_domain from public.tenants where slug = 'jd-a'),
  false, 'un tenant_admin cierra el ingreso');

update public.tenants set self_signup_by_domain = true where slug = 'jd-a';
select is((select self_signup_by_domain from public.tenants where slug = 'jd-a'),
  true, 'un tenant_admin abre el ingreso');

select throws_ok($$update public.tenants set allowed_domains = '{gmail.com}' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia allowed_domains');
select throws_ok($$update public.tenants set active = false where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia active');
select throws_ok($$update public.tenants set slug = 'otro' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia slug');
select throws_ok($$update public.tenants set allowed_models = '{anthropic/claude-haiku-4.5}' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia allowed_models');
select throws_ok($$update public.tenants set auth_methods = '{email}' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia auth_methods');
select throws_ok($$update public.tenants set brand = '{"primary":"#112233"}'::jsonb where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia brand');
select throws_ok($$update public.tenants set display_name = 'Otro' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia display_name');

-- El admin de plataforma sí cambia todo.
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000007","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
update public.tenants set allowed_domains = '{dom-a.test,dom-z.test}' where slug = 'jd-a';
select is((select cardinality(allowed_domains) from public.tenants where slug = 'jd-a'),
  2, 'el admin de plataforma cambia allowed_domains');
reset role;

-- El owner de la base (migraciones, scripts) también.
update public.tenants set display_name = 'JD A bis' where slug = 'jd-a';
select is((select display_name from public.tenants where slug = 'jd-a'),
  'JD A bis', 'el owner cambia cualquier columna');

-- Restricción: el modo abierto exige dominios.
select throws_ok($$update public.tenants set allowed_domains = '{}' where slug = 'jd-a'$$,
  '23514', null, 'abrir el ingreso sin dominios viola la restricción');
update public.tenants set allowed_domains = '{}' where slug = 'jd-c';
select is((select cardinality(allowed_domains) from public.tenants where slug = 'jd-c'),
  0, 'con el ingreso cerrado se puede vaciar la lista');

-- D8 en la base: abrir el modo con un dominio público.
insert into public.tenants (id, slug, display_name, allowed_domains, self_signup_by_domain, active)
values
  ('d7d7d7d7-0000-0000-0000-00000000000e', 'jd-e', 'JD E', '{Gmail.com}', false, true),
  ('d7d7d7d7-0000-0000-0000-00000000000f', 'jd-f', 'JD F', '{dom-f.test}', false, true);
insert into public.memberships (tenant_id, user_id, role)
values
  ('d7d7d7d7-0000-0000-0000-00000000000e', 'c7c7c7c7-0000-0000-0000-000000000006', 'tenant_admin'),
  ('d7d7d7d7-0000-0000-0000-00000000000f', 'c7c7c7c7-0000-0000-0000-000000000006', 'tenant_admin'),
  ('d7d7d7d7-0000-0000-0000-00000000000e', 'c7c7c7c7-0000-0000-0000-000000000007', 'platform_admin');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000006","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select throws_ok($$update public.tenants set self_signup_by_domain = true where slug = 'jd-e'$$,
  '42501', null, 'un tenant_admin no abre el ingreso con un dominio público cargado');
update public.tenants set self_signup_by_domain = true where slug = 'jd-f';
select is((select self_signup_by_domain from public.tenants where slug = 'jd-f'),
  true, 'un tenant_admin abre el ingreso con dominios propios');
update public.tenants set default_model = 'anthropic/claude-haiku-4.5' where slug = 'jd-f';
select is((select default_model from public.tenants where slug = 'jd-f'),
  'anthropic/claude-haiku-4.5', 'con el modo ya abierto, cambiar el modelo no re-chequea dominios');
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000007","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
update public.tenants set self_signup_by_domain = true where slug = 'jd-e';
select is((select self_signup_by_domain from public.tenants where slug = 'jd-e'),
  true, 'el admin de plataforma abre el ingreso aun con un dominio público');
reset role;

select * from finish();
rollback;
