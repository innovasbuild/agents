begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- Barrido sobre TODAS las tablas de public, no una lista fija: una tabla
-- nueva que le devuelva algo a anon rompe este test sin tener que acordarse
-- de agregarla acá.
select is_empty(
  $$select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (
         has_table_privilege('anon', c.oid,
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
       )$$,
  'anon no tiene ningún privilegio de tabla ni de columna en public'
);

select ok(
  not has_column_privilege('anon', 'public.conversations', 'eve_session_id', 'SELECT'),
  'anon no lee columnas de conversations (el hallazgo del cierre de la Etapa 1)'
);

select is_empty(
  -- El case evita que el planner evalúe has_sequence_privilege sobre
  -- relaciones que no son secuencias (el orden del where no está garantizado).
  $$select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and case when c.relkind = 'S'
             then has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')
             else false end$$,
  'anon no usa ninguna secuencia de public'
);

select is_empty(
  $$select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  'anon no ejecuta ninguna función de public'
);

-- Los default privileges: lo que creen las etapas siguientes nace sin anon.
create table public.anon_grants_probe (id int);
create function public.anon_grants_probe_fn() returns int language sql as $$ select 1 $$;

select ok(
  not has_table_privilege('anon', 'public.anon_grants_probe', 'SELECT')
    and has_table_privilege('authenticated', 'public.anon_grants_probe', 'SELECT'),
  'una tabla nueva en public nace sin grants para anon (authenticated no cambia)'
);

-- Una función nueva todavía nace con EXECUTE para PUBLIC (default de Postgres,
-- no de Supabase). Lo que cambia es que anon ya no recibe un grant directo, así
-- que el `revoke execute ... from public` de siempre alcanza para cerrarla.
revoke execute on function public.anon_grants_probe_fn() from public;

select ok(
  not has_function_privilege('anon', 'public.anon_grants_probe_fn()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.anon_grants_probe_fn()', 'EXECUTE'),
  'en una función nueva, revoke from public alcanza para dejar afuera a anon'
);

-- De punta a punta: con el rol de PostgREST para requests sin sesión, el
-- SELECT ya no devuelve cero filas por RLS, directamente se rechaza.
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select throws_ok(
  $$select id from public.conversations$$,
  '42501', null,
  'anon no puede leer conversations ni siquiera para recibir cero filas'
);

reset role;

select * from finish();
rollback;
