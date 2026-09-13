begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('88888888-8888-8888-8888-888888888888', 'authenticated', 'authenticated', 'admin@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values ('aaaaaaaa-0000-0000-0000-000000000009', 'lagomarcino-locks', 'Lago Marcino');

-- 77777777 es tenant_admin de este tenant (no tenant_member): la guarda de
-- I2 es específicamente sobre lo que un tenant_admin puede hacerle a un
-- platform_admin. Un tenant_member ya estaba bloqueado de memberships_write
-- de punta a punta desde antes de este fix (using exige tenant_admin o
-- platform_admin), así que probarlo con ese rol no hubiera guardado nada.
insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000009', '77777777-7777-7777-7777-777777777777', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000009', '88888888-8888-8888-8888-888888888888', 'platform_admin');

insert into public.conversations (id, tenant_id, user_id, agent)
values ('cccccccc-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000009',
        '77777777-7777-7777-7777-777777777777', 'outreach');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';

select throws_ok(
  $$update public.conversations set eve_session_id = 'wrun_secuestrado'
     where id = 'cccccccc-0000-0000-0000-000000000099'$$,
  '42501', null,
  'el dueño de la conversación no puede escribir eve_session_id'
);

select throws_ok(
  $$update public.conversations set tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     where id = 'cccccccc-0000-0000-0000-000000000099'$$,
  '42501', null,
  'el dueño de la conversación no puede cambiarla de tenant'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';

select lives_ok(
  $$update public.conversations set title = 'nuevo título'
     where id = 'cccccccc-0000-0000-0000-000000000099'$$,
  'el dueño sí puede cambiar el título (columna permitida)'
);

-- Nota de verificación (ver reporte de la fix wave): a diferencia del grant
-- por columna de arriba, que SIEMPRE tira 42501 aunque la fila sea propia,
-- la exclusión por USING de memberships_write no lanza excepción: el UPDATE
-- simplemente afecta cero filas (probado a mano contra la base local con
-- psql, en transacción con rollback, antes de escribir esta aserción). Por
-- eso acá se mide el conteo posterior en vez de envolver en throws_ok.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';

update public.memberships set role = 'tenant_member'
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000009'
    and user_id = '88888888-8888-8888-8888-888888888888';

select is(
  (select count(*)::int from public.memberships
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000009'
      and user_id = '88888888-8888-8888-8888-888888888888'
      and role = 'tenant_member'),
  0,
  'un tenant_admin no puede degradar al platform_admin (0 filas afectadas, no error)'
);

reset role;

select is(
  (select count(*)::int from pg_tables t
    left join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
    where t.schemaname = 'public' and c.relrowsecurity is distinct from true),
  0,
  'toda tabla de public tiene RLS habilitada'
);

select * from finish();
rollback;
