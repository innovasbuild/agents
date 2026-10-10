-- supabase/tests/29_platform_console.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

-- Personas: 1 administra la plataforma (actor), 2 es tenant_admin de pc-a, 3 miembro de pc-a.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c9c9c9c9-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'plat@pc.test', now()),
  ('c9c9c9c9-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adm@pc-a.test', now()),
  ('c9c9c9c9-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mem@pc-a.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d9d9d9d9-0000-0000-0000-00000000000a', 'pc-a', 'PC A'),
  ('d9d9d9d9-0000-0000-0000-00000000000b', 'pc-b', 'PC B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d9d9d9d9-0000-0000-0000-00000000000a', 'c9c9c9c9-0000-0000-0000-000000000002', 'tenant_admin'),
  ('d9d9d9d9-0000-0000-0000-00000000000a', 'c9c9c9c9-0000-0000-0000-000000000003', 'tenant_member');

insert into public.tenant_agents (tenant_id, agent, config)
values ('d9d9d9d9-0000-0000-0000-00000000000a', 'outreach', '{"brain": "read"}');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c9c9c9c9-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

-- 1-9: privilegios. Las funciones son solo del servidor; las tablas no se
-- escriben con la sesión; create_tenant ya no existe.
select hasnt_function('public', 'create_tenant', 'create_tenant se fue');
select ok(not has_function_privilege('authenticated', 'public.platform_create_tenant(uuid, text, text, text[], text[], jsonb, text[])', 'execute'), 'authenticated no crea empresas');
select ok(not has_function_privilege('anon', 'public.platform_bind_connection(uuid, uuid, public.connector_capability, text, text[], jsonb, text)', 'execute'), 'anon no asocia conectores');
select ok(not has_function_privilege('authenticated', 'public.platform_set_agent(uuid, uuid, text, boolean, text)', 'execute'), 'authenticated no toca agentes');
select ok(not has_function_privilege('authenticated', 'public.platform_remove_connection(uuid, uuid)', 'execute'), 'authenticated no quita conectores');
select ok(has_function_privilege('service_role', 'public.platform_bind_connection(uuid, uuid, public.connector_capability, text, text[], jsonb, text)', 'execute'), 'service_role sí');
select pg_temp.login_as(2);
select throws_ok(
  $$update public.tenant_agents set config = '{"brain":"read_write"}' where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a'$$,
  '42501', null, 'un tenant_admin ya no cambia el acceso al brain por la API');
select throws_ok(
  $$insert into public.connector_claims (connector_uid, tenant_id, connection_id) values ('x', 'd9d9d9d9-0000-0000-0000-00000000000a', gen_random_uuid())$$,
  '42501', null, 'nadie escribe los reclamos por la API');
select is((select count(*)::int from public.tenant_agents where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a'), 1, 'un miembro sigue leyendo sus agentes');
reset role;

-- 10-14: platform_create_tenant.
select is(
  (select count(*)::int from public.tenant_agents ta join public.tenants t on t.id = ta.tenant_id
    where t.slug = 'pc-nueva'), 0, 'antes del alta no hay nada');
select lives_ok(
  $$select public.platform_create_tenant('c9c9c9c9-0000-0000-0000-000000000001', 'pc-nueva', 'PC Nueva', '{nueva.test}', '{email}', '{}'::jsonb, '{outreach,soporte}')$$,
  'crea la empresa con dos agentes');
select is(
  (select array_agg(ta.agent order by ta.agent) from public.tenant_agents ta join public.tenants t on t.id = ta.tenant_id
    where t.slug = 'pc-nueva' and ta.enabled and ta.config ->> 'brain' = 'read_write'),
  array['outreach', 'soporte'], 'los dos agentes nacen activos con brain read_write');
select is(
  (select e.payload -> 'agents' from public.events e join public.tenants t on t.id = e.tenant_id
    where t.slug = 'pc-nueva' and e.type = 'tenant.created' and e.actor_user_id = 'c9c9c9c9-0000-0000-0000-000000000001'),
  '["outreach","soporte"]'::jsonb, 'el evento dice quién y con qué agentes');
select throws_ok(
  $$select public.platform_create_tenant('c9c9c9c9-0000-0000-0000-000000000001', 'pc-otra', 'Otra', '{}', '{email}', '{}'::jsonb, '{}')$$,
  '23514', 'la empresa necesita al menos un agente', 'sin agentes no se crea');
select throws_ok(
  $$select public.platform_create_tenant('c9c9c9c9-0000-0000-0000-000000000001', 'pc-otra', 'Otra', '{}', '{email}', '{}'::jsonb, '{outreach,outreach}')$$,
  '23514', 'la lista de agentes tiene repetidos', 'agentes repetidos no se crean');

-- 15-18: platform_set_agent.
select lives_ok(
  $$select public.platform_set_agent('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'outreach', false, 'none')$$,
  'apaga el agente y le saca el brain');
select is(
  (select (enabled, config ->> 'brain') from public.tenant_agents where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and agent = 'outreach'),
  (false, 'none'::text), 'quedó apagado y sin brain');
select lives_ok(
  $$select public.platform_set_agent('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000b', 'soporte', true, 'read')$$,
  'habilita un agente que la empresa no tenía');
select throws_ok(
  $$select public.platform_set_agent('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'outreach', true, 'todo')$$,
  '23514', 'el acceso al brain tiene que ser none, read o read_write', 'un acceso desconocido falla');

-- 19-28: platform_bind_connection y los reclamos.
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'leads', 'coldiq', '{pc-a-coldiq}', '{}'::jsonb, 'PC A ColdIQ')$$,
  'asocia un conector');
select is(
  (select (connector_uid, verified_name, verified_at is not null, enabled, updated_by) from public.tenant_connections
    where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'coldiq'),
  ('pc-a-coldiq'::text, 'PC A ColdIQ'::text, true, true, 'c9c9c9c9-0000-0000-0000-000000000001'::uuid),
  'guarda el identificador, la verificación y quién lo hizo');
select is(
  (select tenant_id from public.connector_claims where connector_uid = 'pc-a-coldiq'),
  'd9d9d9d9-0000-0000-0000-00000000000a'::uuid, 'el conector queda reclamado por la empresa');
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000b', 'leads', 'coldiq', '{pc-a-coldiq}', '{}'::jsonb, null)$$,
  '23505', 'el conector pc-a-coldiq ya está asociado a otra empresa', 'otra empresa no puede usar el mismo conector');
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'leads', 'google-places', '{pc-a-coldiq}', '{}'::jsonb, null)$$,
  '23505', 'el conector pc-a-coldiq ya está asociado a otra conexión de esta empresa', 'ni la misma empresa en otra conexión');
select is(
  (select count(*)::int from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'google-places'),
  0, 'el rechazo no deja la conexión a medias');
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'leads', 'apollo', '{pc-a-ap1,pc-a-ap2,pc-a-ap3}', '{}'::jsonb, null)$$,
  'Apollo acepta varios identificadores');
select is(
  (select (connector_uid, config -> 'connectorUids', verified_at) from public.tenant_connections
    where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'apollo'),
  ('pc-a-ap1'::text, '["pc-a-ap1","pc-a-ap2","pc-a-ap3"]'::jsonb, null::timestamptz),
  'el primero va a connector_uid, todos a config.connectorUids, sin verificar');
select is((select count(*)::int from public.connector_claims where connector_uid like 'pc-a-ap%'), 3, 'reclama los tres');
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'leads', 'apollo', '{pc-a-ap1}', '{}'::jsonb, null)$$,
  'volver a asociar con menos identificadores');
select is((select count(*)::int from public.connector_claims where connector_uid like 'pc-a-ap%'), 1, 'libera los que ya no están');

-- 29-30: los liberados los puede usar otra empresa; repetidos en la lista fallan.
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000b', 'leads', 'apollo', '{pc-a-ap2}', '{}'::jsonb, null)$$,
  'otra empresa toma un identificador liberado');
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000b', 'leads', 'coldiq', '{dup,dup}', '{}'::jsonb, null)$$,
  '23514', 'la lista de identificadores tiene repetidos', 'repetidos en la misma lista');

-- 31-35: brain.
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'brain', 'wiki', '{}', '{"categories":["empresa"],"requiredFrontmatter":["title"],"search":"fts"}'::jsonb, null)$$,
  'crea el brain');
select is(
  (select level::text from public.brain_access_rules where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and path = '' and principal = 'members'),
  'lector', 'el brain nace con la regla de la raíz');
update public.brain_access_rules set level = 'editor' where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and path = '';
select lives_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'brain', 'wiki', '{}', '{"categories":["empresa","producto"],"requiredFrontmatter":["title"],"search":"fts"}'::jsonb, null)$$,
  'volver a crear el brain actualiza la configuración');
select is(
  (select level::text from public.brain_access_rules where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and path = ''),
  'editor', 'y no pisa la regla de la raíz');
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'brain', 'mcp', '{pc-a-brain-ext}', '{}'::jsonb, null)$$,
  '23514', 'la empresa ya tiene un brain', 'un segundo brain con otro proveedor falla');
select public.platform_set_connection_enabled('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and capability = 'brain'), false);
select throws_ok(
  $$select public.platform_bind_connection('c9c9c9c9-0000-0000-0000-000000000001', 'd9d9d9d9-0000-0000-0000-00000000000a', 'brain', 'mcp', '{pc-a-brain-ext}', '{}'::jsonb, null)$$,
  '23514', 'la empresa ya tiene un brain', 'con el brain deshabilitado tampoco entra un segundo');
select lives_ok(
  $$select public.platform_set_connection_enabled('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and capability = 'brain'), true)$$,
  'el brain se puede volver a habilitar');

-- 36-40: habilitar, verificar, quitar.
select lives_ok(
  $$select public.platform_set_connection_enabled('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'coldiq'), false)$$,
  'deshabilita');
select is(
  (select string_agg(type, ',' order by id) from public.events where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and type in ('connection.disabled')),
  'connection.disabled,connection.disabled', 'deja el evento (el del brain y el de coldiq)');
select lives_ok(
  $$select public.platform_mark_connection_verified('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'apollo'), 'Apollo PC A')$$,
  'marca verificado');
select is(
  (select (verified_name, verified_at is not null) from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'apollo'),
  ('Apollo PC A'::text, true), 'quedó verificado con su nombre');
select throws_ok(
  $$select public.platform_remove_connection('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and capability = 'brain'))$$,
  '23514', 'el brain no se quita desde la consola', 'el brain no se quita');

-- 41-44: quitar libera los reclamos; una conexión inexistente falla.
select lives_ok(
  $$select public.platform_remove_connection('c9c9c9c9-0000-0000-0000-000000000001', (select id from public.tenant_connections where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and provider = 'apollo'))$$,
  'quita Apollo');
select is((select count(*)::int from public.connector_claims where connector_uid = 'pc-a-ap1'), 0, 'y libera su reclamo');
select is(
  (select count(*)::int from public.events where tenant_id = 'd9d9d9d9-0000-0000-0000-00000000000a' and type = 'connection.removed'),
  1, 'con su evento');
select throws_ok(
  $$select public.platform_remove_connection('c9c9c9c9-0000-0000-0000-000000000001', gen_random_uuid())$$,
  'P0002', null, 'una conexión que no existe falla');

select * from finish();
rollback;
