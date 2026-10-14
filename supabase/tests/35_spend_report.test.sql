-- supabase/tests/35_spend_report.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- Personas: 1 admin de sr-a, 2 miembro de sr-a, 3 admin de sr-b, 4 platform_admin (en sr-p).
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c5c5c5c5-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm@sr-a.test', now()),
  ('c5c5c5c5-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ana@sr-a.test', now()),
  ('c5c5c5c5-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adm@sr-b.test', now()),
  ('c5c5c5c5-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'plat@sr-p.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'sr-a', 'SR A'),
  ('d5d5d5d5-0000-0000-0000-00000000000b', 'sr-b', 'SR B'),
  ('d5d5d5d5-0000-0000-0000-00000000000c', 'sr-p', 'SR P');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'c5c5c5c5-0000-0000-0000-000000000001', 'tenant_admin'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'c5c5c5c5-0000-0000-0000-000000000002', 'tenant_member'),
  ('d5d5d5d5-0000-0000-0000-00000000000b', 'c5c5c5c5-0000-0000-0000-000000000003', 'tenant_admin'),
  ('d5d5d5d5-0000-0000-0000-00000000000c', 'c5c5c5c5-0000-0000-0000-000000000004', 'platform_admin');

insert into public.runs (id, tenant_id, agent, trigger, eve_session_id, status)
values ('e5e5e5e5-0000-0000-0000-000000000001', 'd5d5d5d5-0000-0000-0000-00000000000a', 'outreach', 'chat', 'wrun_sr', 'ok');

-- sr-a: dos asientos de chat el 5 (uno cae el 6 en UTC aunque en Buenos Aires
-- todavía es 5), un workflow el 6, un follow-up sin corrida el 6, créditos que
-- no cuentan y un asiento fuera del rango. sr-b: uno el 5.
insert into public.usage_entries (tenant_id, run_id, workflow, node, resource, amount, unit, created_at)
values
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'e5e5e5e5-0000-0000-0000-000000000001', null, 'agent/step', 'model_usd', 0.10, 'usd', '2026-10-05 12:00:00+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'e5e5e5e5-0000-0000-0000-000000000001', null, 'agent/step', 'model_usd', 0.20, 'usd', '2026-10-05 22:30:00-03'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', null, 'draft-queue', 'outreach/draft', 'model_usd', 0.40, 'usd', '2026-10-06 10:00:00+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', null, null, 'outreach/draft', 'model_usd', 0.05, 'usd', '2026-10-06 11:00:00+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', null, 'target-search', 'outreach/target-search', 'apollo_credits', 7, 'credits', '2026-10-06 11:00:00+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', null, null, 'agent/step', 'model_usd', 9.00, 'usd', '2026-09-30 23:59:59+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000b', null, null, 'agent/step', 'model_usd', 3.00, 'usd', '2026-10-05 12:00:00+00');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c5c5c5c5-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1-4: privilegios.
select ok(has_function_privilege('authenticated', 'public.tenant_spend_report(uuid, timestamptz, timestamptz)', 'execute'), 'authenticated ejecuta tenant_spend_report');
select ok(not has_function_privilege('anon', 'public.tenant_spend_report(uuid, timestamptz, timestamptz)', 'execute'), 'anon no ve el gasto');
select ok(not has_function_privilege('authenticated', 'public.platform_spend_report(timestamptz, timestamptz)', 'execute'), 'authenticated no ve el gasto de todas las empresas');
select ok(has_function_privilege('service_role', 'public.platform_spend_report(timestamptz, timestamptz)', 'execute'), 'service_role ejecuta platform_spend_report');

-- 5-6: quién puede.
select pg_temp.login_as(2);
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-01+00', '2026-11-01+00')$$,
  '42501', null, 'un miembro no ve el gasto');
select pg_temp.login_as(3);
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-01+00', '2026-11-01+00')$$,
  '42501', null, 'el administrador de otra empresa no ve el gasto');

-- 7-9: rangos inválidos.
select pg_temp.login_as(1);
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-06-01+00', '2026-11-01+00')$$,
  '23514', null, 'un rango de más de 92 días se rechaza');
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-11-01+00', '2026-10-01+00')$$,
  '23514', null, 'un rango invertido se rechaza');
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', null, '2026-10-01+00')$$,
  '23514', null, 'un rango sin inicio se rechaza');

-- 10: el administrador ve su mes por día en UTC y por origen, solo model_usd.
select results_eq(
  $$select day::text, origin, round(amount, 2)::text
      from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-01+00', '2026-11-01+00')
     order by day, origin$$,
  $$values
      ('2026-10-05', 'chat', '0.10'),
      ('2026-10-06', 'chat', '0.20'),
      ('2026-10-06', 'draft-queue', '0.40'),
      ('2026-10-06', 'sin_corrida', '0.05')$$,
  'gasto del mes por día en UTC y por origen');

-- 11: sin gasto en el rango, cero filas.
select is_empty(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-11-01+00', '2026-12-01+00')$$,
  'un mes sin gasto no trae filas');

-- 12: el platform_admin lee el de cualquier empresa.
select pg_temp.login_as(4);
select is(
  (select round(sum(amount), 2)::text from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000b', '2026-10-01+00', '2026-11-01+00')),
  '3.00', 'el platform_admin ve el gasto de otra empresa');

-- 13: la de plataforma agrupa por empresa y día.
select pg_temp.logout();
select results_eq(
  $$select tenant_id::text, day::text, round(amount, 2)::text
      from public.platform_spend_report('2026-10-01+00', '2026-11-01+00')
     where tenant_id in ('d5d5d5d5-0000-0000-0000-00000000000a', 'd5d5d5d5-0000-0000-0000-00000000000b')
     order by tenant_id, day$$,
  $$values
      ('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-05', '0.10'),
      ('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-06', '0.65'),
      ('d5d5d5d5-0000-0000-0000-00000000000b', '2026-10-05', '3.00')$$,
  'gasto por empresa y día en UTC');

select * from finish();
rollback;
