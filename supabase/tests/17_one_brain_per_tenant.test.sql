begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.tenants (id, slug, display_name)
values ('aaaaaaaa-0000-0000-0000-000000000011', 'cerebro', 'Cerebro');

insert into public.tenant_connections (tenant_id, capability, provider, config, enabled)
values ('aaaaaaaa-0000-0000-0000-000000000011', 'brain', 'wiki', '{"categories":["comercial"]}', true);

select throws_ok(
  $$insert into public.tenant_connections (tenant_id, capability, provider, connector_uid, config, enabled)
    values ('aaaaaaaa-0000-0000-0000-000000000011', 'brain', 'mcp', 'x', '{}', true)$$,
  '23505',
  null,
  'un segundo brain habilitado en el mismo tenant se rechaza'
);

select lives_ok(
  $$insert into public.tenant_connections (tenant_id, capability, provider, connector_uid, config, enabled)
    values ('aaaaaaaa-0000-0000-0000-000000000011', 'brain', 'mcp', 'x', '{}', false)$$,
  'un brain deshabilitado convive con el habilitado'
);

select throws_ok(
  $$update public.tenant_connections set enabled = true
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000011' and provider = 'mcp'$$,
  '23505',
  null,
  'habilitar el segundo brain también se rechaza'
);

select lives_ok(
  $$insert into public.tenant_connections (tenant_id, capability, provider, connector_uid, config, enabled)
    values ('aaaaaaaa-0000-0000-0000-000000000011', 'leads', 'coldiq', 'c1', '{}', true),
           ('aaaaaaaa-0000-0000-0000-000000000011', 'leads', 'apollo', 'a1', '{}', true)$$,
  'el índice no toca otras capacidades'
);

select * from finish();
rollback;
