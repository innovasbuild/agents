-- supabase/tests/32_outreach_settings.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- Personas: 1 admin de os-a, 2 miembro de os-a, 3 admin de os-b, 4 platform_admin (en os-p).
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c3c3c3c3-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm@os-a.test', now()),
  ('c3c3c3c3-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ana@os-a.test', now()),
  ('c3c3c3c3-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adm@os-b.test', now()),
  ('c3c3c3c3-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'plat@os-p.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'os-a', 'OS A'),
  ('d3d3d3d3-0000-0000-0000-00000000000b', 'os-b', 'OS B'),
  ('d3d3d3d3-0000-0000-0000-00000000000c', 'os-p', 'OS P');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'c3c3c3c3-0000-0000-0000-000000000001', 'tenant_admin'),
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'c3c3c3c3-0000-0000-0000-000000000002', 'tenant_member'),
  ('d3d3d3d3-0000-0000-0000-00000000000b', 'c3c3c3c3-0000-0000-0000-000000000003', 'tenant_admin'),
  ('d3d3d3d3-0000-0000-0000-00000000000c', 'c3c3c3c3-0000-0000-0000-000000000004', 'platform_admin');

-- Solo os-a tiene el agente de outreach.
insert into public.tenant_agents (tenant_id, agent, config)
values ('d3d3d3d3-0000-0000-0000-00000000000a', 'outreach',
        '{"brain": "read", "approvals": {"outreach/otro": "once"}, "outreach": {"timezone": "America/Argentina/Buenos_Aires"}}');

insert into public.config_values (tenant_id, kind, value, label)
values
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg', 'Segmento'),
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'idioma', 'es_ar', 'Rioplatense');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c3c3c3c3-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1-4: privilegios.
select ok(has_function_privilege('authenticated', 'public.set_list_value(uuid, public.config_value_kind, text, text, boolean)', 'execute'), 'authenticated ejecuta set_list_value');
select ok(not has_function_privilege('anon', 'public.set_outreach_config(uuid, jsonb)', 'execute'), 'anon no cambia la configuración');
select ok(
  not has_function_privilege('authenticated', 'public.platform_set_budget(uuid, uuid, text, numeric)', 'execute')
  and has_function_privilege('service_role', 'public.platform_set_budget(uuid, uuid, text, numeric)', 'execute'),
  'el presupuesto lo escribe solo service_role');
select ok(not has_function_privilege('anon', 'public.tenant_budget_status(uuid, text[], timestamptz)', 'execute'), 'anon no ve presupuestos');

-- 5-10: quién puede.
select pg_temp.login_as(2);
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_x', 'X', true)$$,
  '42501', null, 'un miembro no edita listas');
select throws_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 60, 5)$$,
  '42501', null, 'un miembro no enciende workflows');
select throws_ok(
  $$select * from public.tenant_budget_status('d3d3d3d3-0000-0000-0000-00000000000a', array['model_usd'], now() - interval '1 day')$$,
  '42501', null, 'un miembro no ve el gasto');
select pg_temp.login_as(3);
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"UTC"}')$$,
  '42501', null, 'el admin de otra empresa no cambia la configuración');
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_x', 'X', true)$$,
  '42501', null, 'ni sus listas');
select pg_temp.login_as(4);
select lives_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_plat', 'De plataforma', true)$$,
  'un platform_admin puede');

-- 11-16: set_list_value.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_dos', 'Segundo', true)$$,
  'el admin da de alta un segmento');
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'hook', 'h_uno', 'Uno', true)$$,
  '23514', 'los hooks y vectores se editan en el brain', 'no edita hooks');
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'idioma', 'es_ar', 'Rioplatense', false)$$,
  '23514', null, 'no desactiva el último idioma activo');
select lives_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_dos', 'Segundo', false)$$,
  'desactiva un segmento habiendo otros');
select pg_temp.logout();
select is(
  (select active::text || '|' || label from public.config_values
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and kind = 'segmento' and value = 'seg_dos'),
  'false|Segundo', 'queda desactivado, no borrado');
select is(
  (select count(*)::int from public.events
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and type = 'outreach.list_value_updated'
      and actor_user_id = 'c3c3c3c3-0000-0000-0000-000000000001'),
  2, 'cada escritura deja su evento con el actor');

-- 17-22: set_outreach_config.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"America/Montevideo","bcc":null}')$$,
  'el admin guarda la configuración');
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"UTC","icp":{"revision":"x"}}')$$,
  '23514', 'el ICP se edita en el brain', 'rechaza la clave icp');
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '[]')$$,
  '23514', null, 'rechaza lo que no es un objeto');
select pg_temp.logout();
select is(
  (select config #>> '{outreach,timezone}' from public.tenant_agents
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and agent = 'outreach'),
  'America/Montevideo', 'reemplaza la clave outreach');
select is(
  (select (config ->> 'brain') || '|' || (config #>> '{approvals,outreach/otro}') from public.tenant_agents
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and agent = 'outreach'),
  'read|once', 'preserva brain y approvals');
select pg_temp.login_as(3);
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000b', '{"timezone":"UTC"}')$$,
  '23514', 'la empresa no tiene el agente de outreach', 'sin agente no hay configuración que guardar');

-- 23-28: set_workflow.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 60, 5)$$,
  'crea la fila del workflow');
select throws_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 4, 5)$$,
  '23514', null, 'cadencia por debajo de 5 minutos');
select throws_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 60, 1001)$$,
  '23514', null, 'ítems por encima de 1000');
select pg_temp.logout();
update public.tenant_workflows set config = config || '{"otra": 1}'
 where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and workflow = 'refresh-fichas';
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', false, 120, 3)$$,
  'edita la fila existente');
select pg_temp.logout();
select is(
  (select enabled::text || '|' || config::text from public.tenant_workflows
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and workflow = 'refresh-fichas'),
  'false|' || '{"otra": 1, "cadence_minutes": 120, "items_per_tick": 3}'::jsonb::text,
  'apaga, cambia cadencia e ítems y preserva las claves ajenas');
select is(
  (select count(*)::int from public.events
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and type = 'workflow.updated'),
  2, 'cada cambio de workflow deja su evento');

-- 29-34: presupuestos.
select lives_ok(
  $$select public.platform_set_budget('c3c3c3c3-0000-0000-0000-000000000004', 'd3d3d3d3-0000-0000-0000-00000000000a', 'model_usd', 2.5)$$,
  'plataforma fija un presupuesto');
select throws_ok(
  $$select public.platform_set_budget('c3c3c3c3-0000-0000-0000-000000000004', 'd3d3d3d3-0000-0000-0000-00000000000a', 'model_usd', -1)$$,
  '23514', null, 'rechaza un límite negativo');
select is(
  (select daily_limit::text || '|' || updated_by::text from public.tenant_budgets
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and resource = 'model_usd'),
  '2.500000|c3c3c3c3-0000-0000-0000-000000000004', 'guarda el límite y quién lo puso');
select is(
  (select payload ->> 'to' from public.events
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and type = 'budget.updated'),
  '2.5', 'deja el evento con el límite nuevo');

insert into public.usage_entries (tenant_id, node, resource, amount, unit, created_at)
values
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'outreach/research', 'model_usd', 0.4, 'usd', now()),
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'outreach/research', 'model_usd', 9, 'usd', now() - interval '2 days'),
  ('d3d3d3d3-0000-0000-0000-00000000000b', 'outreach/research', 'model_usd', 7, 'usd', now());

select pg_temp.login_as(1);
select results_eq(
  $$select resource, daily_limit::numeric, spent::numeric
      from public.tenant_budget_status('d3d3d3d3-0000-0000-0000-00000000000a', array['model_usd', 'apollo_credits'], now() - interval '1 day')
     order by resource$$,
  $$values ('apollo_credits'::text, 0::numeric, 0::numeric), ('model_usd'::text, 2.5::numeric, 0.4::numeric)$$,
  'una fila por recurso pedido: límite (0 sin fila) y gasto desde la fecha, solo de esta empresa');
select pg_temp.login_as(3);
select throws_ok(
  $$select * from public.tenant_budget_status('d3d3d3d3-0000-0000-0000-00000000000a', array['model_usd'], now() - interval '1 day')$$,
  '42501', null, 'otra empresa no ve este gasto');

-- 35: las tablas siguen cerradas a escritura directa.
select pg_temp.login_as(1);
select throws_ok(
  $$insert into public.tenant_budgets (tenant_id, resource, daily_limit) values ('d3d3d3d3-0000-0000-0000-00000000000a', 'apollo_credits', 100)$$,
  '42501', null, 'el admin no escribe presupuestos directo');


-- 36-46: endurecimiento.
select pg_temp.logout();
update public.tenants set allowed_models = '{anthropic/claude-sonnet-5}' where id = 'd3d3d3d3-0000-0000-0000-00000000000a';
select set_config('role', 'anon', true);
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_z', 'Z', true)$$,
  '42501', null, 'anon no edita listas');
select throws_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 60, 5)$$,
  '42501', null, 'anon no enciende workflows');
select pg_temp.logout();
select pg_temp.login_as(2);
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"UTC"}')$$,
  '42501', null, 'un miembro no cambia la configuración');
select pg_temp.login_as(4);
select lives_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"UTC"}')$$,
  'un platform_admin puede cambiar la configuración');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'vector', 'v_uno', 'Uno', true)$$,
  '23514', 'los hooks y vectores se editan en el brain', 'no edita vectores');
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"UTC","extra":1}')$$,
  '23514', null, 'rechaza una clave desconocida');
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"models":{"classify":"openai/gpt-9"}}')$$,
  '23514', 'ese modelo no está habilitado para la empresa', 'rechaza un modelo no habilitado');
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', jsonb_build_object('timezone', repeat('x', 20000)))$$,
  '23514', 'la configuración es demasiado grande', 'rechaza un payload enorme');
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"models":null}')$$,
  '23514', 'los modelos tienen que ser un objeto', 'rechaza models null');
select lives_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"models":{"classify":"anthropic/claude-sonnet-5"}}')$$,
  'acepta un modelo habilitado');
select pg_temp.logout();
select is(
  (select config #>> '{outreach,models,classify}' from public.tenant_agents
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and agent = 'outreach'),
  'anthropic/claude-sonnet-5', 'queda guardado el modelo');
select * from finish();
rollback;
