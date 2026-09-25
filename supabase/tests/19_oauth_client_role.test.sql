begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- El rol existe y no puede loguearse ni heredar privilegios de otro rol.
select is(
  (select rolcanlogin from pg_roles where rolname = 'oauth_client'),
  false,
  'oauth_client no puede loguearse: solo se asume vía SET ROLE'
);

select is(
  (select rolinherit from pg_roles where rolname = 'oauth_client'),
  false,
  'oauth_client no hereda privilegios de otro rol'
);

-- authenticator lo puede asumir: si no, PostgREST no puede cambiar a él.
select ok(
  pg_has_role('authenticator', 'oauth_client', 'member'),
  'authenticator puede asumir oauth_client'
);

-- Barrido sobre TODAS las tablas de public, igual que 06/07: una tabla nueva
-- que le devuelva algo a oauth_client rompe este test sin tener que
-- acordarse de agregarla acá.
select is_empty(
  $$select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (
         has_table_privilege('oauth_client', c.oid,
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege('oauth_client', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
       )$$,
  'oauth_client no tiene ningún privilegio de tabla ni de columna en public'
);

select is_empty(
  $$select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and case when c.relkind = 'S'
             then has_sequence_privilege('oauth_client', c.oid, 'USAGE, SELECT, UPDATE')
             else false end$$,
  'oauth_client no usa ninguna secuencia de public'
);

-- La función existe, con la forma que espera el hook de Supabase.
select is(
  (select pg_get_function_result('public.custom_access_token_hook(jsonb)'::regprocedure)),
  'jsonb',
  'custom_access_token_hook devuelve jsonb'
);

-- Solo supabase_auth_admin puede ejecutarla.
select ok(
  has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
  'supabase_auth_admin puede ejecutar el hook'
);

select is_empty(
  $$select r.rolname from pg_roles r
     where r.rolname in ('authenticated', 'anon')
       and has_function_privilege(r.rolname, 'public.custom_access_token_hook(jsonb)', 'EXECUTE')$$,
  'ni authenticated ni anon pueden ejecutar el hook'
);

-- Comportamiento: con client_id, el claim role pasa a oauth_client; sin él,
-- las claims no se tocan.
select is(
  public.custom_access_token_hook(
    '{"user_id":"11111111-1111-1111-1111-111111111111","authentication_method":"oauth","claims":{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","client_id":"claude-code"}}'::jsonb
  ) -> 'claims' ->> 'role',
  'oauth_client',
  'un token con client_id sale con role oauth_client'
);

select is(
  public.custom_access_token_hook(
    '{"user_id":"11111111-1111-1111-1111-111111111111","authentication_method":"password","claims":{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}}'::jsonb
  ) -> 'claims' ->> 'role',
  'authenticated',
  'un token sin client_id sale con su role de siempre, sin tocar'
);

select * from finish();
rollback;
