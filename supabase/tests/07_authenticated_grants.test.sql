begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- Barrido sobre TODAS las tablas de public, igual que 06 para anon: una tabla
-- nueva que le devuelva a authenticated algún privilegio que PostgREST no usa
-- rompe este test sin tener que agregarla acá.
select is_empty(
  $$select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (
         has_table_privilege('authenticated', c.oid, 'TRUNCATE, TRIGGER, REFERENCES, MAINTAIN')
         or has_any_column_privilege('authenticated', c.oid, 'REFERENCES')
       )$$,
  'authenticated no tiene TRUNCATE, TRIGGER, REFERENCES ni MAINTAIN en public'
);

select is_empty(
  -- Mismo case que 06: el planner no garantiza el orden del where.
  $$select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and case when c.relkind = 'S'
             then has_sequence_privilege('authenticated', c.oid, 'USAGE, SELECT, UPDATE')
             else false end$$,
  'authenticated no usa ninguna secuencia de public'
);

-- El revoke no se pasó de largo: lo que la app usa vía PostgREST sigue.
select ok(
  has_table_privilege('authenticated', 'public.events', 'SELECT')
    and has_table_privilege('authenticated', 'public.memberships', 'SELECT, INSERT, UPDATE, DELETE')
    and has_column_privilege('authenticated', 'public.runs', 'status', 'SELECT')
    and has_column_privilege('authenticated', 'public.conversations', 'title', 'UPDATE'),
  'authenticated conserva SELECT/INSERT/UPDATE/DELETE y los grants por columna'
);

-- Default privileges: lo que creen las etapas siguientes nace igual de acotado.
create table public.authenticated_grants_probe (
  id bigint generated always as identity primary key,
  v int
);

select ok(
  not has_table_privilege('authenticated', 'public.authenticated_grants_probe',
        'TRUNCATE, TRIGGER, REFERENCES, MAINTAIN')
    and has_table_privilege('authenticated', 'public.authenticated_grants_probe',
        'SELECT, INSERT, UPDATE, DELETE'),
  'una tabla nueva en public nace sin TRUNCATE/TRIGGER/REFERENCES/MAINTAIN para authenticated'
);

select ok(
  not has_sequence_privilege('authenticated', 'public.authenticated_grants_probe_id_seq',
        'USAGE, SELECT, UPDATE'),
  'una secuencia nueva en public nace sin grants para authenticated'
);

-- De punta a punta, con el rol de PostgREST para requests con sesión.
set local role authenticated;

select lives_ok(
  $$insert into public.authenticated_grants_probe (v) values (1)$$,
  'una columna identity no necesita grants sobre su secuencia para insertar'
);

select throws_ok(
  $$truncate public.events$$,
  '42501', null,
  'authenticated no puede truncar events (TRUNCATE no evalúa RLS)'
);

select throws_ok(
  $$select setval('public.events_id_seq', 1)$$,
  '42501', null,
  'authenticated no puede reiniciar la secuencia de events'
);

reset role;

select * from finish();
rollback;
