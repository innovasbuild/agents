-- supabase/tests/38_tenant_profile_settings.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- Personas: 1 admin de tp-a, 2 miembro de tp-a, 3 admin de tp-b, 4 platform_admin (en tp-p).
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c7c7c7c7-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm@tp-a.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ana@tp-a.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adm@tp-b.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'plat@tp-p.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'tp-a', 'TP A'),
  ('d7d7d7d7-0000-0000-0000-00000000000b', 'tp-b', 'TP B'),
  ('d7d7d7d7-0000-0000-0000-00000000000c', 'tp-p', 'TP P');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'c7c7c7c7-0000-0000-0000-000000000001', 'tenant_admin'),
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'c7c7c7c7-0000-0000-0000-000000000002', 'tenant_member'),
  ('d7d7d7d7-0000-0000-0000-00000000000b', 'c7c7c7c7-0000-0000-0000-000000000003', 'tenant_admin'),
  ('d7d7d7d7-0000-0000-0000-00000000000c', 'c7c7c7c7-0000-0000-0000-000000000004', 'platform_admin');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c7c7c7c7-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

-- Devuelve el hint del error que tira la sentencia (null si no tira).
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end $$;

select ok(has_function_privilege('authenticated', 'public.set_tenant_profile(uuid, text, jsonb)', 'execute'), 'authenticated ejecuta set_tenant_profile');
select ok(not has_function_privilege('anon', 'public.set_tenant_auth_methods(uuid, text[])', 'execute'), 'anon no cambia los métodos');
select ok(not has_function_privilege('anon', 'public.set_ai_monthly_limit(uuid, numeric)', 'execute'), 'anon no cambia el tope de IA');

select pg_temp.login_as(2);
select throws_ok($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', 'X', '{}')$$, '42501', null, 'un miembro no edita el perfil');
select throws_ok($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{email}')$$, '42501', null, 'un miembro no cambia los métodos');
select throws_ok($$select public.set_ai_monthly_limit('d7d7d7d7-0000-0000-0000-00000000000a', 5)$$, '42501', null, 'un miembro no cambia el tope');
select pg_temp.login_as(3);
select throws_ok($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', 'X', '{}')$$, '42501', null, 'el admin de otra empresa no edita el perfil');

select pg_temp.login_as(1);
select lives_ok($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', '  Nuevo Nombre ', '{"primary":"#112233","logo_url":"https://x.test/a.png"}')$$, 'el admin edita el perfil');
select is((select display_name from public.tenants where slug = 'tp-a'), 'Nuevo Nombre', 'guarda el nombre sin espacios');
select is((select brand::text from public.tenants where slug = 'tp-a'), '{"primary": "#112233", "logo_url": "https://x.test/a.png"}', 'guarda la marca');
select is((select count(*)::int from public.events where tenant_id = 'd7d7d7d7-0000-0000-0000-00000000000a' and type = 'tenant.profile_updated'), 1, 'deja el evento del perfil');
select lives_ok($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', 'Nuevo Nombre', '{"primary":"","secondary":"#abcdef"}')$$, 'un color vacío se acepta');
select is((select brand::text from public.tenants where slug = 'tp-a'), '{"secondary": "#abcdef"}', 'el color vacío no se guarda');
select throws_ok($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', '', '{}')$$, '23514', null, 'nombre vacío');
select throws_ok($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', repeat('a', 81), '{}')$$, '23514', null, 'nombre de 81 caracteres');
select throws_ok($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', 'X', '{"otra":"cosa"}')$$, '23514', null, 'clave de marca desconocida');
select throws_ok($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', 'X', '{"primary":"rojo"}')$$, '23514', null, 'color inválido');
select is(pg_temp.hint_of($$select public.set_tenant_profile('d7d7d7d7-0000-0000-0000-00000000000a', '', '{}')$$), 'settings', 'el error del perfil lleva hint settings');

select lives_ok($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{microsoft,email}')$$, 'el admin cambia los métodos conservando el propio');
select is((select auth_methods from public.tenants where slug = 'tp-a'), '{microsoft,email}'::text[], 'guarda los métodos');
select is((select count(*)::int from public.events where tenant_id = 'd7d7d7d7-0000-0000-0000-00000000000a' and type = 'tenant.auth_methods_updated'), 1, 'deja el evento de métodos');
select throws_ok($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{}')$$, '23514', null, 'métodos vacíos');
select throws_ok($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{saml}')$$, '23514', null, 'método desconocido');
select throws_ok($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{email,email}')$$, '23514', null, 'métodos repetidos');
select is(pg_temp.hint_of($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{}')$$), 'settings', 'el error de métodos lleva hint settings');

select throws_ok($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{microsoft}')$$, '23514', 'No podés sacar la forma de entrar con la que estás usando ahora.', 'no puede sacar el método de su sesión (otp = email)');
select is(pg_temp.hint_of($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{microsoft}')$$), 'settings', 'ese error lleva hint settings');

select lives_ok($$select public.set_ai_monthly_limit('d7d7d7d7-0000-0000-0000-00000000000a', 12.5)$$, 'el admin fija el tope');
select is((select ai_monthly_limit_usd::text from public.tenants where slug = 'tp-a'), '12.50', 'guarda el tope');
select is((select payload ->> 'resource' from public.events where tenant_id = 'd7d7d7d7-0000-0000-0000-00000000000a' and type = 'budget.updated'), 'model_usd_monthly', 'el evento nombra el recurso');
select throws_ok($$select public.set_ai_monthly_limit('d7d7d7d7-0000-0000-0000-00000000000a', -1)$$, '23514', null, 'tope negativo');

select pg_temp.login_as(4);
select lives_ok($$select public.set_ai_monthly_limit('d7d7d7d7-0000-0000-0000-00000000000a', null)$$, 'plataforma saca el tope');
select lives_ok($$select public.set_tenant_auth_methods('d7d7d7d7-0000-0000-0000-00000000000a', '{microsoft}')$$, 'plataforma está exenta de la regla del método propio');

select * from finish();
rollback;
