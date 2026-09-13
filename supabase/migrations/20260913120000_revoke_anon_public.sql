-- anon no lee ni escribe nada de public. Ningún camino no autenticado de la
-- app toca estas tablas: /login y /auth/callback hablan con GoTrue (no con
-- PostgREST), google_tokens se escribe con el cliente admin, y el RPC
-- accept_pending_invitations corre recién después de exchangeCodeForSession,
-- ya como authenticated. proxy.ts, app/page.tsx y resolveTenantAccess solo
-- llaman a auth.getUser() antes de cortar si no hay sesión. El logo del
-- tenant sale por el endpoint público de Storage, que no pasa por estos grants.
--
-- Hasta acá la RLS era la única barrera: los grants por defecto de Supabase le
-- dejaban a anon SELECT/INSERT/UPDATE/DELETE/TRUNCATE sobre tenants,
-- memberships, invitations y tenant_agents, SELECT sobre conversations y
-- events, TRUNCATE sobre runs (TRUNCATE no evalúa RLS) y USAGE/UPDATE sobre
-- events_id_seq. No era explotable vía PostgREST (todas las políticas son
-- `to authenticated`), pero es defensa en profundidad que faltaba.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Mismo problema que documenta 20260913014533 para funciones: las políticas
-- de ALTER DEFAULT PRIVILEGES le vuelven a dar todo a anon sobre cada objeto
-- nuevo que creen las etapas siguientes. Se cortan para el rol que corre las
-- migraciones (postgres). Las de supabase_admin no se pueden tocar desde acá,
-- pero ninguna migración del repo crea objetos con ese rol.
--
-- Funciones: esto saca el grant DIRECTO a anon, pero Postgres igual le da
-- EXECUTE a PUBLIC sobre toda función nueva. No se corta globalmente (el
-- default global aplicaría también a funciones de extensiones fuera de public).
-- Consecuencia: desde acá `revoke execute on function ... from public` sí
-- alcanza para dejar afuera a anon, y es el idiom a usar en funciones nuevas.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
