begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@outreach-a.test', now()),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@outreach-b.test', now()),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'caro@outreach-a.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'outreach-a', 'Outreach A'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'outreach-b', 'Outreach B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', 'tenant_member'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'a1a1a1a1-0000-0000-0000-000000000002', 'tenant_member'),
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000003', 'tenant_member');

insert into public.executors (tenant_id, user_id, slug)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', 'ana'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'a1a1a1a1-0000-0000-0000-000000000002', 'beto');

insert into public.config_values (tenant_id, kind, value, label)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'hook', 'h_uno', 'Uno'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'hook', 'h_dos', 'Dos');

insert into public.accounts (tenant_id, domain, name, ficha, expires_at)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'acme-a.test', 'Acme A', '{}', now() + interval '90 days'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'acme-b.test', 'Acme B', '{}', now() + interval '90 days');

insert into public.contacts (id, tenant_id, contact_key, email, owner_user_id, stage, source)
values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'uno@acme-a.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'msg1_enviado', 'csv'),
  ('c1c1c1c1-0000-0000-0000-000000000002', 'b1b1b1b1-0000-0000-0000-00000000000b', 'em:dos@acme-b.test', 'dos@acme-b.test', 'a1a1a1a1-0000-0000-0000-000000000002', 'a_contactar', 'csv'),
  ('c1c1c1c1-0000-0000-0000-000000000003', 'b1b1b1b1-0000-0000-0000-00000000000a', 'em:tres@acme-a.test', 'tres@acme-a.test', null, 'msg1_enviado', 'csv');

insert into public.queue_items (tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, ancla, draft_original, gate_result)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000001', 'em:uno@acme-a.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'followup_2', 'uno@acme-a.test', 'Asunto', 'Cuerpo', 'h_uno', 'v_uno', 'es_ar', null, '{}', '{}'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'c1c1c1c1-0000-0000-0000-000000000002', 'em:dos@acme-b.test', 'a1a1a1a1-0000-0000-0000-000000000002', 'msg1', 'dos@acme-b.test', 'Asunto', 'Cuerpo', 'h_dos', 'v_dos', 'es_ar', '{"hecho":"x","fuente":"https://acme-b.test"}', '{}', '{}');

-- RLS: lectura dentro del tenant, escritura solo del servidor.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a1a1a1a1-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.contacts),
  2,
  'un miembro ve los contactos de su tenant y ninguno ajeno'
);

select is(
  (select count(*)::int from public.queue_items where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'),
  0,
  'un miembro no ve la cola de otro tenant'
);

select is(
  (select count(*)::int from public.config_values) + (select count(*)::int from public.accounts),
  2,
  'config_values y accounts se leen solo dentro del tenant'
);

select throws_ok(
  $$insert into public.contacts (tenant_id, contact_key, source)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:nuevo@acme-a.test', 'chat')$$,
  '42501', null,
  'authenticated no puede crear contactos'
);

select throws_ok(
  $$update public.queue_items set body = 'otro' where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000a'$$,
  '42501', null,
  'authenticated no puede editar piezas de la cola'
);

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.contacts$$,
  '42501', null,
  'anon no puede leer contactos'
);

reset role;

-- Escalera de estados.
select throws_ok(
  $$update public.contacts set stage = 'a_contactar' where id = 'c1c1c1c1-0000-0000-0000-000000000001'$$,
  '23514', null,
  'la escalera no retrocede'
);

select lives_ok(
  $$update public.contacts set stage = 'sin_respuesta' where id = 'c1c1c1c1-0000-0000-0000-000000000003';
    update public.contacts set stage = 'en_conversacion' where id = 'c1c1c1c1-0000-0000-0000-000000000003'$$,
  'dentro del mismo rango se puede saltar (sin_respuesta a en_conversacion)'
);

select throws_ok(
  $$update public.contacts set stage = 'sin_atribucion' where id = 'c1c1c1c1-0000-0000-0000-000000000003'$$,
  '23514', null,
  'sin_atribucion solo se asigna al crear'
);

-- Cola.
select throws_ok(
  $$insert into public.queue_items (tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, draft_original, gate_result)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000001', 'em:uno@acme-a.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'followup_3', 'uno@acme-a.test', 'A', 'B', 'h', 'v', 'es_ar', '{}', '{}')$$,
  '23505', null,
  'una sola pieza viva por persona'
);

select throws_ok(
  $$insert into public.queue_items (tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, draft_original, gate_result)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000003', 'em:tres@acme-a.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'msg1', 'tres@acme-a.test', 'A', 'B', 'h', 'v', 'es_ar', '{}', '{}')$$,
  '23514', null,
  'un msg1 sin ancla no entra a la cola'
);

select throws_ok(
  $$update public.contacts set owner_user_id = 'a1a1a1a1-0000-0000-0000-000000000003' where id = 'c1c1c1c1-0000-0000-0000-000000000003'$$,
  '23503', null,
  'el claim solo lo tiene un ejecutor del mismo tenant'
);

select throws_ok(
  $$insert into public.queue_items (tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, draft_original, gate_result)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000002', 'em:dos@acme-b.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'followup_2', 'dos@acme-b.test', 'A', 'B', 'h', 'v', 'es_ar', '{}', '{}')$$,
  '23503', null,
  'una pieza no puede apuntar a un contacto de otro tenant'
);

-- Eventos.
insert into public.events (tenant_id, contact_key, type, payload)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'encolado', '{"queue_item_id":"q1"}'),
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'encolado', '{"queue_item_id":"q1"}'),
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'encolado', '{"queue_item_id":"q2"}');

select is(
  (select count(*)::int from public.events where contact_key = 'em:uno@acme-a.test' and type = 'encolado'),
  2,
  'el dedup descarta el mismo evento dentro de 2 horas y conserva los distintos'
);

insert into public.events (tenant_id, contact_key, type, payload, created_at)
values ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'respuesta', '{"gmail_message_id":"m1"}', now() - interval '3 hours');

select throws_ok(
  $$insert into public.events (tenant_id, contact_key, type, payload)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'respuesta', '{"gmail_message_id":"m1"}')$$,
  '23505', null,
  'una respuesta se registra una sola vez aunque pasen más de 2 horas'
);

-- Locks y ejecutores.
insert into public.runs (tenant_id, agent, trigger, eve_session_id, schedule_key)
values ('b1b1b1b1-0000-0000-0000-00000000000a', 'outreach', 'schedule', 'sweep', 'sweep:b1b1b1b1-0000-0000-0000-00000000000a:2026-09-15');

select throws_ok(
  $$insert into public.runs (tenant_id, agent, trigger, eve_session_id, schedule_key)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'outreach', 'schedule', 'sweep-2', 'sweep:b1b1b1b1-0000-0000-0000-00000000000a:2026-09-15')$$,
  '23505', null,
  'el cron no corre dos veces el mismo barrido del día'
);

select lives_ok(
  $$update public.executors set slug = 'ana'
     where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'$$,
  'el mismo slug puede existir en otro tenant'
);

-- Caro pasa a ser ejecutora recién acá: el test del claim de arriba
-- necesita que no lo sea.
insert into public.executors (tenant_id, user_id)
values ('b1b1b1b1-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000003');

select throws_ok(
  $$update public.executors set slug = 'ana'
     where user_id = 'a1a1a1a1-0000-0000-0000-000000000003'$$,
  '23505', null,
  'dos ejecutores del mismo tenant no comparten slug'
);

select * from finish();
rollback;
