-- supabase/tests/37_tenant_domains.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- Personas: 1 admin de td-a, 2 admin de td-b, 3 platform_admin (en td-p).
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a6a6a6a6-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm@td-a.test', now()),
  ('a6a6a6a6-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adm@td-b.test', now()),
  ('a6a6a6a6-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'plat@td-p.test', now());

insert into public.tenants (id, slug, display_name, active)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'td-a', 'TD A', true),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'td-b', 'TD B', true),
  ('b6b6b6b6-0000-0000-0000-00000000000c', 'td-p', 'TD P', true),
  ('b6b6b6b6-0000-0000-0000-00000000000d', 'td-off', 'TD OFF', false);

insert into public.memberships (tenant_id, user_id, role)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000001', 'tenant_admin'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'a6a6a6a6-0000-0000-0000-000000000002', 'tenant_admin'),
  ('b6b6b6b6-0000-0000-0000-00000000000c', 'a6a6a6a6-0000-0000-0000-000000000003', 'platform_admin');

insert into public.tenant_domains (tenant_id, hostname, is_primary, status)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'ai.td-a.test', true, 'active'),
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'old.td-a.test', false, 'pending'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'ai.td-b.test', true, 'active'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'broken.td-b.test', false, 'failed'),
  ('b6b6b6b6-0000-0000-0000-00000000000d', 'ai.td-off.test', true, 'active');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"a6a6a6a6-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1-4: forma y privilegios.
select has_table('public', 'tenant_domains', 'existe tenant_domains');
select ok((select relrowsecurity from pg_class where oid = 'public.tenant_domains'::regclass), 'tenant_domains tiene la RLS prendida');
select ok(has_table_privilege('authenticated', 'public.tenant_domains', 'select'), 'authenticated puede leer');
select ok(not has_table_privilege('authenticated', 'public.tenant_domains', 'insert')
      and not has_table_privilege('authenticated', 'public.tenant_domains', 'update')
      and not has_table_privilege('authenticated', 'public.tenant_domains', 'delete'), 'authenticated no escribe');

-- 5: anon no lee nada.
select ok(not has_table_privilege('anon', 'public.tenant_domains', 'select'), 'anon no lee tenant_domains');

-- 6-9: un miembro ve los dominios de su empresa y no los de otra.
select pg_temp.login_as(1);
select is((select count(*)::int from public.tenant_domains), 2, 'el admin de td-a ve los 2 dominios de td-a');
select is((select count(*)::int from public.tenant_domains where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000b'), 0, 'no ve los de td-b');
select throws_ok(
  $$insert into public.tenant_domains (tenant_id, hostname) values ('b6b6b6b6-0000-0000-0000-00000000000a', 'x.td-a.test')$$,
  '42501', null, 'un admin no inserta dominios');
select throws_ok(
  $$update public.tenant_domains set status = 'active' where hostname = 'old.td-a.test'$$,
  '42501', null, 'un admin no activa un dominio');
select pg_temp.logout();

-- 10: un platform_admin ve todos.
select pg_temp.login_as(3);
select is((select count(*)::int from public.tenant_domains), 5, 'platform_admin ve los 5 dominios');
select pg_temp.logout();

-- 11-13: resolve_tenant_by_host solo devuelve activos de empresas activas.
select is(public.resolve_tenant_by_host('ai.td-a.test'), 'td-a', 'un dominio activo resuelve a su slug');
select is(public.resolve_tenant_by_host('old.td-a.test'), null, 'uno pendiente no resuelve');
select is(public.resolve_tenant_by_host('broken.td-b.test'), null, 'uno fallido no resuelve');
select is(public.resolve_tenant_by_host('ai.td-off.test'), null, 'uno de una empresa inactiva no resuelve');
select is(public.resolve_tenant_by_host('evil.test'), null, 'un host desconocido no resuelve');

-- 16-18: solo la service role ejecuta la función.
select ok(has_function_privilege('service_role', 'public.resolve_tenant_by_host(text)', 'execute'), 'service_role ejecuta resolve_tenant_by_host');
select ok(not has_function_privilege('authenticated', 'public.resolve_tenant_by_host(text)', 'execute'), 'authenticated no la ejecuta');
select ok(not has_function_privilege('anon', 'public.resolve_tenant_by_host(text)', 'execute'), 'anon no la ejecuta');

-- 19-21: un hostname es de una sola empresa y hay un solo primario por empresa.
select throws_ok(
  $$insert into public.tenant_domains (tenant_id, hostname) values ('b6b6b6b6-0000-0000-0000-00000000000b', 'ai.td-a.test')$$,
  '23505', null, 'dos empresas no pueden reclamar el mismo hostname');
select throws_ok(
  $$insert into public.tenant_domains (tenant_id, hostname, is_primary) values ('b6b6b6b6-0000-0000-0000-00000000000a', 'otro.td-a.test', true)$$,
  '23505', null, 'una empresa no tiene dos primarios');
select lives_ok(
  $$insert into public.tenant_domains (tenant_id, hostname, is_primary) values ('b6b6b6b6-0000-0000-0000-00000000000c', 'ai.td-p.test', true)$$,
  'otra empresa sí tiene su primario');

-- 22-26: formato del hostname.
select throws_ok(
  $$insert into public.tenant_domains (tenant_id, hostname) values ('b6b6b6b6-0000-0000-0000-00000000000c', 'AI.Mayus.test')$$,
  '23514', null, 'rechaza mayúsculas');
select throws_ok(
  $$insert into public.tenant_domains (tenant_id, hostname) values ('b6b6b6b6-0000-0000-0000-00000000000c', 'localhost')$$,
  '23514', null, 'rechaza un nombre sin punto');
select throws_ok(
  $$insert into public.tenant_domains (tenant_id, hostname) values ('b6b6b6b6-0000-0000-0000-00000000000c', '*.td-p.test')$$,
  '23514', null, 'rechaza comodines');
select throws_ok(
  $$insert into public.tenant_domains (tenant_id, hostname) values ('b6b6b6b6-0000-0000-0000-00000000000c', 'ai.td-p.test:3000')$$,
  '23514', null, 'rechaza puerto');
select throws_ok(
  $$insert into public.tenant_domains (tenant_id, hostname) values ('b6b6b6b6-0000-0000-0000-00000000000c', '10.0.0.1')$$,
  '23514', null, 'rechaza una IP');

-- 27-30: eventos de auditoría (append-only: solo insert).
select is((select count(*)::int from public.events where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a' and type = 'tenant_domain.added'), 2, 'cada alta deja su evento');
update public.tenant_domains set status = 'active' where hostname = 'old.td-a.test';
select is((select count(*)::int from public.events where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a' and type = 'tenant_domain.activated'), 1, 'activar un dominio deja su evento');
delete from public.tenant_domains where hostname = 'old.td-a.test';
select is((select count(*)::int from public.events where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a' and type = 'tenant_domain.removed'), 1, 'quitar un dominio deja su evento');
select lives_ok(
  $$delete from public.tenants where id = 'b6b6b6b6-0000-0000-0000-00000000000d'$$,
  'borrar una empresa con dominios no falla por el evento de baja');

select * from finish();
rollback;
