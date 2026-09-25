-- Rol sin permisos para tokens del OAuth Server (spec etapa 11 §13, V7): los
-- tokens que emite el emisor OAuth 2.1 son JWT comunes del proyecto y, con la
-- anon key, funcionarían contra PostgREST con todos los permisos RLS del
-- usuario. Este hook les cambia el claim role antes de firmarlos, cuando el
-- token trae client_id (los tokens de sesión normal del dashboard no lo
-- traen). El endpoint del brain no usa PostgREST con el token del usuario
-- (usa getClaims() más la service role), así que esto no le toca nada.
--
-- No se sabe todavía si Supabase Auth corre este hook para los tokens que
-- emite el OAuth Server, a diferencia de un login normal: eso lo confirma la
-- verificación V7 contra producción, no esta migración.
create role oauth_client nologin noinherit;

-- Sin ningún grant: un rol de Postgres nace sin privilegios, así que no hace
-- falta (ni conviene) listar acá las tablas que no puede tocar.
grant oauth_client to authenticator;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  claims jsonb;
begin
  claims := event->'claims';

  if coalesce(claims->>'client_id', '') <> '' then
    claims := jsonb_set(claims, '{role}', to_jsonb('oauth_client'::text));
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Custom Access Token Hook de Supabase Auth (Authentication > Hooks). Asigna el rol oauth_client, sin privilegios, a los tokens que traen client_id (emitidos por el OAuth Server). Spec etapa 11 §13, verificación V7.';

-- Sin security definer, por recomendación de Supabase: corre con los
-- permisos de quien la invoca (supabase_auth_admin), a quien se los damos
-- explícitos acá en vez de elevar la función.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
