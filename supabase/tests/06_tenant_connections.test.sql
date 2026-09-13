begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a6a6a6a6-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@conexiones-a.test', now()),
  ('a6a6a6a6-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@conexiones-b.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'conexiones-a', 'Conexiones A'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'conexiones-b', 'Conexiones B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000001', 'tenant_admin'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'a6a6a6a6-0000-0000-0000-000000000002', 'tenant_admin');

insert into public.tenant_connections (tenant_id, capability, provider, connector_uid, config)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'brain', 'innovas-brains', 'conexiones-a-brain', '{"url":"https://brain-a.test/mcp"}'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'brain', 'innovas-brains', 'conexiones-b-brain', '{"url":"https://brain-b.test/mcp"}');

insert into public.executors (tenant_id, user_id)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000001'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'a6a6a6a6-0000-0000-0000-000000000002');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a6a6a6a6-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.tenant_connections where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'),
  1,
  'un miembro ve los bindings de su tenant'
);

select is(
  (select count(*)::int from public.tenant_connections where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000b'),
  0,
  'un miembro no ve los bindings de otro tenant'
);

select is(
  (select count(*)::int from public.executors where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000b'),
  0,
  'un miembro no ve los ejecutores de otro tenant'
);

select throws_ok(
  $$insert into public.tenant_connections (tenant_id, capability, provider)
     values ('b6b6b6b6-0000-0000-0000-00000000000a', 'crm', 'hubspot')$$,
  '42501', null,
  'ni un tenant_admin puede crear bindings: los escribe solo el servidor'
);

select throws_ok(
  $$update public.tenant_connections set connector_uid = 'conexiones-b-brain'
     where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'$$,
  '42501', null,
  'nadie con rol authenticated puede reapuntar un binding a otro conector'
);

select throws_ok(
  $$delete from public.tenant_connections where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'$$,
  '42501', null,
  'authenticated no puede borrar bindings'
);

select throws_ok(
  $$insert into public.executors (tenant_id, user_id)
     values ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000002')$$,
  '42501', null,
  'authenticated no puede escribir ejecutores'
);

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.tenant_connections$$,
  '42501', null,
  'anon no puede leer bindings'
);

select throws_ok(
  $$select count(*) from public.executors$$,
  '42501', null,
  'anon no puede leer ejecutores'
);

select * from finish();
rollback;
