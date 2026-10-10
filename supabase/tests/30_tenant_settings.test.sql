begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- Personas: 1 admin de ts-a, 2 miembro de ts-a (ejecutor candidato), 3 admin de
-- ts-b, 4 platform_admin (en ts-p), 5 miembro de ts-a con historial, 6 nadie.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c0c0c0c0-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm@ts-a.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ana@ts-a.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adm@ts-b.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'plat@ts-p.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'beto@ts-a.test', now()),
  ('c0c0c0c0-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'nadie@afuera.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d0d0d0d0-0000-0000-0000-00000000000a', 'ts-a', 'TS A'),
  ('d0d0d0d0-0000-0000-0000-00000000000b', 'ts-b', 'TS B'),
  ('d0d0d0d0-0000-0000-0000-00000000000c', 'ts-p', 'TS P');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000001', 'tenant_admin'),
  ('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'tenant_member'),
  ('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000005', 'tenant_member'),
  ('d0d0d0d0-0000-0000-0000-00000000000b', 'c0c0c0c0-0000-0000-0000-000000000003', 'tenant_admin'),
  ('d0d0d0d0-0000-0000-0000-00000000000c', 'c0c0c0c0-0000-0000-0000-000000000004', 'platform_admin');

insert into public.tenant_agents (tenant_id, agent, config)
values ('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach',
        '{"brain": "read", "approvals": {"outreach/otro": "once"}}');

insert into public.tenant_connections (id, tenant_id, capability, provider, connector_uid, config)
values
  ('e0e0e0e0-0000-0000-0000-000000000001', 'd0d0d0d0-0000-0000-0000-00000000000a', 'crm', 'hubspot', null, '{}'),
  ('e0e0e0e0-0000-0000-0000-000000000002', 'd0d0d0d0-0000-0000-0000-00000000000a', 'leads', 'coldiq', 'ts-a-coldiq', '{}'),
  ('e0e0e0e0-0000-0000-0000-000000000003', 'd0d0d0d0-0000-0000-0000-00000000000a', 'brain', 'wiki', null, '{"categories":["empresa"],"requiredFrontmatter":["title"],"search":"fts"}'),
  ('e0e0e0e0-0000-0000-0000-000000000004', 'd0d0d0d0-0000-0000-0000-00000000000b', 'leads', 'coldiq', 'ts-b-coldiq', '{}');

-- Beto (5) ya es ejecutor y tiene un contacto propio: historial.
insert into public.executors (tenant_id, user_id, slug, daily_quota)
values ('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000005', 'beto', 30);
insert into public.contacts (tenant_id, contact_key, source, owner_user_id)
values ('d0d0d0d0-0000-0000-0000-00000000000a', 'em:x@cliente.test', 'csv', 'c0c0c0c0-0000-0000-0000-000000000005');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c0c0c0c0-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1-6: privilegios.
select ok(has_function_privilege('authenticated', 'public.set_executor(uuid, uuid, text, text, text, text, integer)', 'execute'), 'authenticated ejecuta set_executor');
select ok(not has_function_privilege('anon', 'public.set_executor(uuid, uuid, text, text, text, text, integer)', 'execute'), 'anon no');
select ok(not has_function_privilege('anon', 'public.remove_executor(uuid, uuid)', 'execute'), 'anon no quita ejecutores');
select ok(not has_function_privilege('anon', 'public.set_approval(uuid, text, text, text)', 'execute'), 'anon no cambia aprobaciones');
select ok(not has_function_privilege('anon', 'public.set_connection_enabled(uuid, uuid, boolean)', 'execute'), 'anon no toca conectores');
select ok(has_function_privilege('authenticated', 'public.set_connection_enabled(uuid, uuid, boolean)', 'execute'), 'authenticated ejecuta set_connection_enabled');

-- 7-10: quién puede. Un miembro, el admin de otra empresa y alguien de afuera, no.
select pg_temp.login_as(2);
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', null, null, null, 30)$$,
  '42501', 'solo un administrador puede cambiar esto', 'un miembro no se hace ejecutor a sí mismo');
select pg_temp.login_as(3);
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', null, null, null, 30)$$,
  '42501', null, 'el admin de otra empresa no');
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', 'auto')$$,
  '42501', null, 'el admin de otra empresa no cambia aprobaciones');
select pg_temp.login_as(6);
select throws_ok(
  $$select public.remove_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000005')$$,
  '42501', null, 'alguien de afuera no');

-- 11-20: set_executor.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', 'Ana López', '  ', 'https://www.linkedin.com/in/ana', 40)$$,
  'el admin da de alta un ejecutor');
select pg_temp.logout();
select is(
  (select (slug, display_name, title, linkedin_url, daily_quota)::text from public.executors
    where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000002'),
  '(ana,"Ana López",,https://www.linkedin.com/in/ana,40)', 'guarda los datos y deja en nulo un texto en blanco');
select is(
  (select actor_user_id from public.events where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and type = 'executor.updated'),
  'c0c0c0c0-0000-0000-0000-000000000001'::uuid, 'el evento dice quién');
update public.executors set gmail_authorized_at = now(), crm_owner_id = '777'
 where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000002';
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', 'Ana', null, null, 0)$$,
  'editar con cupo 0');
select pg_temp.logout();
select is(
  (select (crm_owner_id, gmail_authorized_at is not null, daily_quota, linkedin_url)::text from public.executors
    where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000002'),
  '(777,t,0,)', 'editar no toca lo que sella el servidor');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', null, null, null, 201)$$,
  '23514', 'el cupo diario va de 0 a 200', 'techo del cupo');
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'ana', null, null, null, -1)$$,
  '23514', 'el cupo diario va de 0 a 200', 'piso del cupo');
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000006', 'nadie', null, null, null, 30)$$,
  '23514', 'esa persona no es miembro de la empresa', 'solo miembros');
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'beto', null, null, null, 30)$$,
  '23505', 'ese slug ya lo usa otro ejecutor', 'slug repetido');
select throws_ok(
  $$select public.set_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002', 'Ana!', null, null, 'http://linkedin.com/ana', 30)$$,
  '23514', null, 'slug o LinkedIn con formato inválido');

-- 21-27: remove_executor. Con historial se niega y nada se borra.
select throws_ok(
  $$select public.remove_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000005')$$,
  '23514', 'tiene historial: ponele cupo 0 para que no envíe', 'con un contacto propio no se quita');
select pg_temp.logout();
select is(
  (select owner_user_id from public.contacts where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and contact_key = 'em:x@cliente.test'),
  'c0c0c0c0-0000-0000-0000-000000000005'::uuid, 'el contacto sigue con su dueño');
select is(
  (select count(*)::int from public.executors where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000005'),
  1, 'el ejecutor sigue ahí');
select pg_temp.login_as(1);
select lives_ok(
  $$select public.remove_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002')$$,
  'sin historial se quita');
select throws_ok(
  $$select public.remove_executor('d0d0d0d0-0000-0000-0000-00000000000a', 'c0c0c0c0-0000-0000-0000-000000000002')$$,
  'P0002', null, 'quitar a quien no es ejecutor');
select pg_temp.logout();
select is(
  (select count(*)::int from public.executors where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and user_id = 'c0c0c0c0-0000-0000-0000-000000000002'),
  0, 'la fila se fue');
select is(
  (select count(*)::int from public.events where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and type = 'executor.removed'
     and actor_user_id = 'c0c0c0c0-0000-0000-0000-000000000001'),
  1, 'con su evento');

-- 28-35: set_approval.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', 'auto')$$,
  'el admin cambia una política');
select pg_temp.logout();
select is(
  (select config from public.tenant_agents where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and agent = 'outreach'),
  '{"brain": "read", "approvals": {"outreach/otro": "once", "outreach/crm-record": "auto"}}'::jsonb,
  'conserva brain y las otras políticas');
select is(
  (select payload from public.events where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and type = 'approval.updated'),
  '{"agent": "outreach", "node": "outreach/crm-record", "policy": "auto"}'::jsonb, 'el evento lleva agente, nodo y política');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', 'nunca')$$,
  '23514', 'la política tiene que ser always, once o auto', 'política desconocida');
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', null)$$,
  '23514', null, 'política nula');
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'soporte/responder', 'auto')$$,
  '23514', 'ese paso no pertenece a ese agente', 'nodo de otro agente');
select throws_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'soporte', 'soporte/responder', 'auto')$$,
  '23514', 'la empresa no tiene ese agente', 'agente que la empresa no tiene');
select pg_temp.login_as(4);
select lives_ok(
  $$select public.set_approval('d0d0d0d0-0000-0000-0000-00000000000a', 'outreach', 'outreach/crm-record', 'always')$$,
  'un platform_admin puede');

-- 36-47: set_connection_enabled y el bloqueo de plataforma.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', false)$$,
  'el admin apaga un conector');
select lives_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', true)$$,
  'y lo vuelve a encender: lo apagó él');
select throws_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000003', false)$$,
  '23514', 'el brain lo maneja INNOV.AS', 'el brain no se toca');
select throws_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000004', false)$$,
  'P0002', null, 'una conexión de otra empresa no existe para él');
select pg_temp.login_as(3);
select throws_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', false)$$,
  '42501', null, 'el admin de otra empresa no');
select pg_temp.logout();
select is(
  (select (enabled, locked_by_platform, updated_by)::text from public.tenant_connections where id = 'e0e0e0e0-0000-0000-0000-000000000002'),
  '(t,f,c0c0c0c0-0000-0000-0000-000000000001)', 'quedó encendido, sin bloqueo, con quién lo tocó');
select is(
  (select string_agg(type || ':' || (payload ->> 'actor'), ',' order by id) from public.events
    where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a' and type like 'connection.%'),
  'connection.disabled:cliente,connection.enabled:cliente', 'los eventos dicen que fue el cliente');
select lives_ok(
  $$select public.platform_set_connection_enabled('c0c0c0c0-0000-0000-0000-000000000004', 'e0e0e0e0-0000-0000-0000-000000000002', false)$$,
  'plataforma lo apaga');
select is(
  (select (enabled, locked_by_platform)::text from public.tenant_connections where id = 'e0e0e0e0-0000-0000-0000-000000000002'),
  '(f,t)', 'queda bloqueado por plataforma');
select pg_temp.login_as(1);
select throws_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', true)$$,
  '23514', 'INNOV.AS deshabilitó este conector: pedile que lo habilite', 'el cliente no lo rehabilita');
select pg_temp.logout();
select lives_ok(
  $$select public.platform_set_connection_enabled('c0c0c0c0-0000-0000-0000-000000000004', 'e0e0e0e0-0000-0000-0000-000000000002', true)$$,
  'plataforma lo enciende');
select is(
  (select (enabled, locked_by_platform)::text from public.tenant_connections where id = 'e0e0e0e0-0000-0000-0000-000000000002'),
  '(t,f)', 'y el bloqueo se va');

-- 48-52: las tablas siguen cerradas a escritura directa, y el cliente recupera el control.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_connection_enabled('d0d0d0d0-0000-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-000000000002', false)$$,
  'el cliente vuelve a poder apagarlo');
select throws_ok(
  $$update public.tenant_connections set locked_by_platform = false where id = 'e0e0e0e0-0000-0000-0000-000000000002'$$,
  '42501', null, 'nadie escribe la tabla de conectores directo');
select throws_ok(
  $$update public.executors set daily_quota = 9999 where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a'$$,
  '42501', null, 'ni la de ejecutores');
select throws_ok(
  $$update public.tenant_agents set config = '{"approvals":{"outreach/send":"auto"}}' where tenant_id = 'd0d0d0d0-0000-0000-0000-00000000000a'$$,
  '42501', null, 'ni la de agentes');
select pg_temp.logout();
select is(
  (select count(*)::int from public.tenant_connections where locked_by_platform and enabled),
  0, 'nunca queda un conector encendido y bloqueado');

select * from finish();
rollback;
