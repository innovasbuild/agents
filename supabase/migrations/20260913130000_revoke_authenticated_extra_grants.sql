-- Mismo hallazgo que 20260913120000 para anon, ahora para authenticated: los
-- grants por defecto de Supabase le dejaban TRUNCATE, TRIGGER, REFERENCES y
-- MAINTAIN sobre todas las tablas de public, y USAGE/SELECT/UPDATE sobre
-- events_id_seq. TRUNCATE no evalúa RLS y events es append-only; UPDATE sobre
-- la secuencia habilita setval. No es explotable vía PostgREST (no expone
-- ninguno de estos), pero la base no debería depender de eso.
--
-- SELECT/INSERT/UPDATE/DELETE quedan como están: son los que la RLS y los
-- grants por columna (runs, conversations) ya acotan.
revoke truncate, trigger, references, maintain
  on all tables in schema public from authenticated;

-- Ningún camino de la app necesita la secuencia como authenticated: events se
-- inserta con el cliente admin (app/api/invitations/route.ts) o desde
-- accept_pending_invitations, que es security definer. Y aunque algún día
-- authenticated tuviera INSERT, una columna `generated always as identity` no
-- pide privilegios sobre su secuencia.
revoke all on all sequences in schema public from authenticated;

-- Default privileges del rol que corre las migraciones: lo que creen las
-- etapas siguientes nace sin estos grants. Consecuencia para secuencias: una
-- columna serial/bigserial (default nextval) insertada por authenticated
-- necesitaría un grant usage explícito. La convención del repo es uuid o
-- identity, que no lo necesitan.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from authenticated;
