-- supabase/tests/33_agentless_tenant.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('e3e3e3e3-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'plat@at.test', now());

-- 1-3: alta sin agentes.
select lives_ok(
  $$select public.platform_create_tenant('e3e3e3e3-0000-0000-0000-000000000001', 'at-brain', 'AT Brain', '{at.test}', '{email}', '{}'::jsonb, '{}')$$,
  'crea una empresa sin agentes');
select is(
  (select count(*)::int from public.tenant_agents ta join public.tenants t on t.id = ta.tenant_id where t.slug = 'at-brain'),
  0, 'no nace ninguna fila de agente');
select is(
  (select e.payload -> 'agents' from public.events e join public.tenants t on t.id = e.tenant_id where t.slug = 'at-brain' and e.type = 'tenant.created'),
  '[]'::jsonb, 'el evento dice que nació sin agentes');

-- 4: la consola dejó de editar categorías (spec etapa 26 §3.1); las mantienen las carpetas.
select hasnt_function('public', 'platform_set_brain_categories', array['uuid', 'uuid', 'text[]'],
  'platform_set_brain_categories ya no existe');

select * from finish();
rollback;
