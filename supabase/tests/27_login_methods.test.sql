-- supabase/tests/27_login_methods.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- Personas. El sufijo del uuid es el número de persona.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('e8e8e8e8-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@lm-a.test', now()),
  ('e8e8e8e8-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@lm-a.test', now()),
  ('e8e8e8e8-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'caro@lm-a.test', now()),
  ('e8e8e8e8-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'dani@lm-a.test', now()),
  ('e8e8e8e8-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'eva@lm-a.test', now()),
  ('e8e8e8e8-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'fede@lm-a.test', now()),
  ('e8e8e8e8-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'gabi@lm-a.test', now()),
  ('e8e8e8e8-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'hugo@nada.test', now()),
  ('e8e8e8e8-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'ines@otra.test', now());

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at)
values
  ('g-2', 'e8e8e8e8-0000-0000-0000-000000000002', '{}', 'google', now()),
  ('a-3', 'e8e8e8e8-0000-0000-0000-000000000003', '{"custom_claims":{"xms_edov":true}}', 'azure', now()),
  ('a-4', 'e8e8e8e8-0000-0000-0000-000000000004', '{"custom_claims":{"xms_edov":false}}', 'azure', now()),
  ('a-5', 'e8e8e8e8-0000-0000-0000-000000000005', '{"custom_claims":{"tid":"x"}}', 'azure', now()),
  ('g-6', 'e8e8e8e8-0000-0000-0000-000000000006', '{}', 'google', now() - interval '1 day'),
  ('a-6', 'e8e8e8e8-0000-0000-0000-000000000006', '{"custom_claims":{"xms_edov":"1"}}', 'azure', now()),
  ('a-7', 'e8e8e8e8-0000-0000-0000-000000000007', '{"custom_claims":{"xms_edov":true}}', 'azure', now() - interval '1 day'),
  ('g-7', 'e8e8e8e8-0000-0000-0000-000000000007', '{}', 'google', now());

-- Empresas: solo correo y abierta; solo Google y abierta; solo Microsoft y
-- cerrada; correo+Google cerrada; inactiva.
insert into public.tenants (id, slug, display_name, allowed_domains, self_signup_by_domain, auth_methods, active)
values
  ('f8f8f8f8-0000-0000-0000-00000000000e', 'lm-e', 'LM E', '{lm-a.test}', true, '{email}', true),
  ('f8f8f8f8-0000-0000-0000-00000000000a', 'lm-g', 'LM G', '{lm-a.test}', true, '{google}', true),
  ('f8f8f8f8-0000-0000-0000-00000000000b', 'lm-m', 'LM M', '{}', false, '{microsoft}', true),
  ('f8f8f8f8-0000-0000-0000-00000000000c', 'lm-eg', 'LM EG', '{}', false, '{email,google}', true),
  ('f8f8f8f8-0000-0000-0000-00000000000d', 'lm-off', 'LM OFF', '{}', false, '{email}', false);

-- Caro es miembro de la empresa solo Microsoft y de la de correo+Google.
insert into public.memberships (tenant_id, user_id, role)
values
  ('f8f8f8f8-0000-0000-0000-00000000000b', 'e8e8e8e8-0000-0000-0000-000000000003', 'tenant_member'),
  ('f8f8f8f8-0000-0000-0000-00000000000c', 'e8e8e8e8-0000-0000-0000-000000000003', 'tenant_member'),
  ('f8f8f8f8-0000-0000-0000-00000000000b', 'e8e8e8e8-0000-0000-0000-000000000004', 'tenant_member');

-- Inés solo tiene una invitación a la empresa solo Microsoft y otra a la inactiva.
insert into public.invitations (tenant_id, email, role, invited_by)
values
  ('f8f8f8f8-0000-0000-0000-00000000000b', 'ines@otra.test', 'tenant_admin', 'e8e8e8e8-0000-0000-0000-000000000003'),
  ('f8f8f8f8-0000-0000-0000-00000000000d', 'ines@otra.test', 'tenant_member', 'e8e8e8e8-0000-0000-0000-000000000003');

-- Arma los claims de una sesión. p_amr es el jsonb del claim amr.
create function pg_temp.login_as(p_user int, p_amr text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"e8e8e8e8-0000-0000-0000-00000000000%s","role":"authenticated","amr":%s}',
    p_user, p_amr), true);
end $$;

-- 1-4: privilegios y check.
select ok(has_function_privilege('authenticated', 'public.current_login_method()', 'execute'), 'authenticated ejecuta current_login_method');
select ok(not has_function_privilege('anon', 'public.login_gate()', 'execute'), 'anon no ejecuta login_gate');
select lives_ok($$update public.tenants set auth_methods = '{email,microsoft}' where slug = 'lm-eg'$$, 'microsoft es un método válido');
select throws_ok($$update public.tenants set auth_methods = '{email,saml}' where slug = 'lm-eg'$$, '23514', null, 'un método desconocido sigue rechazado');
update public.tenants set auth_methods = '{email,google}' where slug = 'lm-eg';

-- 5-9: métodos de correo.
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select is((select public.current_login_method()), 'email', 'otp es correo');
select pg_temp.login_as(1, '[{"method":"magiclink","timestamp":10}]');
select is((select public.current_login_method()), 'email', 'magiclink es correo');
select pg_temp.login_as(1, '[{"method":"invite","timestamp":10}]');
select is((select public.current_login_method()), 'email', 'invite es correo');
select pg_temp.login_as(1, '[{"method":"email/signup","timestamp":10}]');
select is((select public.current_login_method()), 'email', 'email/signup es correo');
select pg_temp.login_as(1, '[{"method":"recovery","timestamp":10}]');
select is((select public.current_login_method()), 'email', 'recovery es correo');

-- 10-16: OAuth.
select pg_temp.login_as(2, '[{"method":"oauth","timestamp":10}]');
select is((select public.current_login_method()), 'google', 'oauth con identidad Google es google');
select pg_temp.login_as(3, '[{"method":"oauth","timestamp":10}]');
select is((select public.current_login_method()), 'microsoft', 'oauth con Azure y xms_edov true es microsoft');
select pg_temp.login_as(4, '[{"method":"oauth","timestamp":10}]');
select is((select public.current_login_method()), null::text, 'Azure con xms_edov false no cuenta');
select pg_temp.login_as(5, '[{"method":"oauth","timestamp":10}]');
select is((select public.current_login_method()), null::text, 'Azure sin xms_edov no cuenta');
select pg_temp.login_as(6, '[{"method":"oauth","timestamp":10}]');
select is((select public.current_login_method()), 'microsoft', 'con dos identidades gana la del ingreso más nuevo (Azure, xms_edov "1")');
select pg_temp.login_as(7, '[{"method":"oauth","timestamp":10}]');
select is((select public.current_login_method()), 'google', 'con dos identidades gana la del ingreso más nuevo (Google)');
select pg_temp.login_as(1, '[{"method":"oauth","timestamp":10}]');
select is((select public.current_login_method()), null::text, 'oauth sin identidad OAuth es null');

-- 17-22: formas raras de amr.
select pg_temp.login_as(1, '[]');
select is((select public.current_login_method()), null::text, 'amr vacío es null');
select pg_temp.login_as(1, '[{"method":"password","timestamp":10}]');
select is((select public.current_login_method()), null::text, 'un método desconocido es null');
select pg_temp.login_as(1, '["otp"]');
select is((select public.current_login_method()), null::text, 'amr como lista de strings es null, sin tirar');
select pg_temp.login_as(1, '[{"method":"otp","timestamp":"ayer"}]');
select is((select public.current_login_method()), 'email', 'un timestamp que no es número no tira');
select pg_temp.login_as(2, '[{"method":"otp","timestamp":5},{"method":"oauth","timestamp":9}]');
select is((select public.current_login_method()), 'google', 'con dos entradas gana la del timestamp más alto');
select pg_temp.login_as(2, '[{"method":"oauth","timestamp":9},{"method":"totp","timestamp":20}]');
select is((select public.current_login_method()), 'google', 'una entrada de MFA más nueva no tapa el método del login');
reset role;

-- 23-27: tenant_allows_login. Caro entró por Microsoft.
select pg_temp.login_as(3, '[{"method":"oauth","timestamp":10}]');
select is((select public.tenant_allows_login('f8f8f8f8-0000-0000-0000-00000000000b')), true, 'la empresa solo Microsoft permite a quien entró por Microsoft');
select is((select public.tenant_allows_login('f8f8f8f8-0000-0000-0000-00000000000c')), false, 'la empresa de correo+Google no');
select is((select public.tenant_allows_login('f8f8f8f8-0000-0000-0000-00000000000d')), false, 'una empresa inactiva nunca');
select is((select public.tenant_allows_login('f8f8f8f8-0000-0000-0000-0000000000ff')), false, 'una empresa inexistente nunca');
select pg_temp.login_as(4, '[{"method":"oauth","timestamp":10}]');
select is((select public.tenant_allows_login('f8f8f8f8-0000-0000-0000-00000000000b')), false, 'con método null no se permite nada');
reset role;

-- 28-31: join_tenants_by_domain respeta el método. Ana entra por correo:
-- las dos empresas abiertas tienen su dominio, pero solo una permite correo.
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select is((select public.join_tenants_by_domain()), 1, 'Ana por correo entra solo a la empresa que permite correo');
reset role;
select is(
  (select t.slug from public.memberships m join public.tenants t on t.id = m.tenant_id
    where m.user_id = 'e8e8e8e8-0000-0000-0000-000000000001'),
  'lm-e', 'y es la de correo');
select pg_temp.login_as(2, '[{"method":"oauth","timestamp":10}]');
select is((select public.join_tenants_by_domain()), 1, 'Beto por Google entra solo a la empresa que permite Google');
select pg_temp.login_as(4, '[{"method":"oauth","timestamp":10}]');
select is((select public.join_tenants_by_domain()), 0, 'con método null no entra a ninguna');
reset role;

-- 32-34: accept_pending_invitations respeta el método y la empresa activa.
select pg_temp.login_as(9, '[{"method":"invite","timestamp":10}]');
select is((select public.accept_pending_invitations()), 0, 'Inés por el link de invitación no acepta la de la empresa solo Microsoft ni la de la inactiva');
reset role;
select is(
  (select count(*)::int from public.invitations where email = 'ines@otra.test' and status = 'pending'),
  2, 'las dos invitaciones siguen pendientes');
select is(
  (select count(*)::int from public.memberships where user_id = 'e8e8e8e8-0000-0000-0000-000000000009'),
  0, 'y no se creó ninguna membresía');

-- 35-41: login_gate.
select pg_temp.login_as(3, '[{"method":"oauth","timestamp":10}]');
select is((select public.login_gate()), '{"allowed":true,"landing":null}'::jsonb, 'Caro por Microsoft: una de sus dos empresas lo permite');
select pg_temp.login_as(4, '[{"method":"oauth","timestamp":10}]');
select is((select public.login_gate()), '{"allowed":false,"landing":"lm-m"}'::jsonb, 'Dani con método null: cortado hacia su empresa');
select pg_temp.login_as(3, '[{"method":"password","timestamp":10}]');
select is((select public.login_gate()), '{"allowed":false,"landing":"lm-eg"}'::jsonb, 'miembro de dos empresas sin método permitido: la primera por slug');
select pg_temp.login_as(8, '[{"method":"otp","timestamp":10}]');
select is((select public.login_gate()), '{"allowed":true,"landing":null}'::jsonb, 'sin empresas no hay nada que imponer');
select pg_temp.login_as(9, '[{"method":"invite","timestamp":10}]');
select is((select public.login_gate()), '{"allowed":false,"landing":"lm-m"}'::jsonb, 'solo con invitación a una empresa que no permite el método: cortada hacia esa empresa');
select pg_temp.login_as(5, '[{"method":"oauth","timestamp":10}]');
select is((select public.login_gate()), '{"allowed":false,"landing":"lm-e"}'::jsonb, 'solo con dominio abierto y método null: cortada hacia la primera empresa abierta');
reset role;
-- reset role no borra los claims: sin esto auth.uid() seguiría devolviendo a la última persona.
select set_config('request.jwt.claims', '', true);
select throws_ok('select public.login_gate()', 'P0001', 'no authenticated user', 'sin sesión tira');

select * from finish();
rollback;
