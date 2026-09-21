begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_member');

insert into public.work_items (tenant_id, workflow, subject_type, subject_id, input_hash)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000001', 'h1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000002', 'h1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000003', 'h1'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000009', 'h1');

select throws_ok(
  $$insert into public.work_items (tenant_id, workflow, subject_type, subject_id, input_hash)
    values ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000001', 'h1')$$,
  '23505',
  null,
  'el mismo sujeto con la misma huella no se encola dos veces'
);

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 2, 60)),
  2,
  'reclama hasta el límite'
);

select is(
  (select count(*)::int from public.work_items
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status = 'running' and attempts = 1 and lease_until > now()),
  2,
  'lo reclamado queda running, con un intento y lease a futuro'
);

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 5, 60)),
  1,
  'el segundo reclamo solo ve lo que quedaba pending: lo tomado está bajo lease'
);

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 5, 60)),
  0,
  'con todo tomado no hay nada que reclamar'
);

select is(
  (select count(*)::int from public.work_items
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000003' and status = 'pending'),
  1,
  'reclamar para un tenant no toca los ítems de otro'
);

-- Proceso muerto: el lease vence y el ítem vuelve a estar disponible.
update public.work_items set lease_until = now() - interval '1 minute'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 5, 60)),
  3,
  'un lease vencido se vuelve a reclamar'
);

-- Tercer intento y otra muerte: no vuelve a entregarse, pasa a failed.
update public.work_items set attempts = 3, lease_until = now() - interval '1 minute'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 5, 60)),
  0,
  'con los intentos agotados no se entrega más'
);

select is(
  (select count(*)::int from public.work_items
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status = 'failed' and last_error = 'lease vencido'),
  3,
  'agotado y con lease vencido pasa a failed: nada queda colgado en running'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.work_items),
  3,
  'un miembro ve solo los ítems de su tenant'
);

select throws_ok(
  $$select public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 1, 60)$$,
  '42501',
  null,
  'authenticated no puede reclamar trabajo'
);

select * from finish();
rollback;
