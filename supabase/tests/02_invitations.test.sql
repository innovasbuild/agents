begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'nuevo@lagomarcino.test', now()),
  ('55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'tarde@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino');

insert into public.memberships (tenant_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin');

insert into public.invitations (tenant_id, email, role, invited_by, expires_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'nuevo@lagomarcino.test', 'tenant_member',
   '22222222-2222-2222-2222-222222222222', now() + interval '7 days'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'tarde@lagomarcino.test', 'tenant_member',
   '22222222-2222-2222-2222-222222222222', now() - interval '1 day');

-- El invitado acepta.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select is(
  (select public.accept_pending_invitations()),
  1,
  'acepta una invitación pendiente'
);

select is(
  (select public.accept_pending_invitations()),
  0,
  'el segundo click no acepta nada'
);

reset role;
select is(
  (select count(*)::int from public.memberships
    where user_id = '44444444-4444-4444-4444-444444444444'),
  1,
  'y quedó una sola membership'
);

-- La invitación vencida no crea nada.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

select is(
  (select public.accept_pending_invitations()),
  0,
  'una invitación vencida no se acepta'
);

-- Un usuario cualquiera no lee invitaciones de un tenant ajeno.
select is(
  (select count(*)::int from public.invitations),
  0,
  'quien no es admin del tenant no ve sus invitaciones'
);

select * from finish();
rollback;
