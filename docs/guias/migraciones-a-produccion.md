---
title: Migraciones a producción
category: guias
status: activo
tags: [migraciones, supabase, produccion, rls, pgtap]
updated: 2026-10-13
sources:
  - package.json
  - supabase/config.toml
  - supabase/migrations/20261019120000_agentless_tenant.sql
  - supabase/tests/33_agentless_tenant.test.sql
  - docs/superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md
  - docs/superpowers/specs/2026-10-10-etapa-21-2-settings-cliente-design.md
  - docs/superpowers/plans/2026-09-24-etapa-11-brain-mcp.md
  - docs/superpowers/plans/2026-09-21-etapa-12-e3-refresh-fichas.md
  - docs/producto/kickoff.md
  - CLAUDE.md
---

# Migraciones a producción

Hay dos tramos: escribir y probar la migración en local, y aplicarla en producción. El segundo lo hace una persona al desplegar, nunca un agente: `db push` pide la contraseña de la base de producción. El modelo de datos y las reglas de tenancy están en [datos](../arquitectura/datos.md) y [tenancy](../arquitectura/tenancy.md). Los comandos de `db:*` necesitan Docker abierto.

## A. Escribir y probar la migración (local)

1. Antes de tocar SQL, cargá el skill `supabase-postgres-best-practices` (regla del repo).

2. Creá `supabase/migrations/<AAAAMMDDHHMMSS>_<nombre>.sql`, con una marca de tiempo posterior a la última (`ls supabase/migrations | tail -1`). Reglas del repo:
   - Toda tabla lleva `tenant_id` y RLS prendida (`enable row level security`) con sus políticas por tenant.
   - `events` es append-only: nunca `UPDATE` ni `DELETE`.
   - Las escrituras sensibles van por funciones `security definer set search_path = ''`, con `revoke execute ... from public, anon, authenticated` y `grant execute ... to service_role` cuando solo las llama la app con la clave de servicio (el modelo es `supabase/migrations/20261019120000_agentless_tenant.sql`). Quién es `platform_admin` lo verifica la server action, no la función.
   - Una migración se escribe para que el código viejo siga andando contra la base nueva (columna con valor por defecto, función redefinida con la misma firma). Es lo que permite aplicarla antes que el código.

3. Escribí su test pgTAP en `supabase/tests/<NN>_<nombre>.test.sql`, con el número siguiente al último (`ls supabase/tests | tail -1`). Cada test abre `begin;`, carga `pgtap`, declara `plan(n)` y se cierra con `finish()` y `rollback`; mirá `supabase/tests/33_agentless_tenant.test.sql`. Probá lo que importa: que `authenticated` y `anon` no puedan ejecutar ni escribir, y que cada tenant vea solo lo suyo.

4. Levantá la base local:

   ```bash
   npm run db:start
   ```

5. Corré los tests de SQL. Resetea la base local sin seed y corre pgTAP:

   ```bash
   npm run db:test
   ```

6. Regenerá los tipos de TypeScript desde la base local:

   ```bash
   npm run db:types
   ```

   Reescribe `lib/supabase/database.types.ts`; commitealo junto con la migración.

7. Si agregaste una tabla, mencionala por su nombre en la página de dominio que corresponda y regenerá la referencia (`docs/referencia/migraciones.md` y `tablas.md`):

   ```bash
   npm run docs:sync
   ```

8. Para ver la migración sobre datos de seed (incluida la empresa de pruebas), reseteá con seed:

   ```bash
   npm run db:reset
   ```

## B. Aplicarla en producción

Lo corre una persona, con la base de producción enlazada al proyecto (`npx supabase link --project-ref <ref>`, ver `docs/producto/kickoff.md`; el enlace es local a cada checkout y no viaja a los worktrees).

1. Si la migración puede fallar con datos existentes, corré antes la consulta de precondición que diga su spec o su plan (por ejemplo, la 21.1 pide verificar que ningún `connector_uid` esté en dos empresas antes de aplicarla, porque la migración falla a propósito).

2. Mirá qué hay pendiente:

   ```bash
   npx supabase migration list
   ```

   Las filas con el remoto vacío son las que se van a aplicar. `db push` aplica **todas** las pendientes, no solo la tuya, y el CLI no deja elegir una.

3. Si hay pendientes que no son tuyas, nombralas y confirmá con quien las escribió (o con el dueño del proyecto) si se aplican juntas o se espera. Es lo que pasó en las etapas 11 y 12: había migraciones ajenas mergeadas hacía días y sin aplicar. No sigas sin esa respuesta.

4. Aplicá:

   ```bash
   npx supabase db push
   ```

5. Verificá que el remoto quedó igual que el local:

   ```bash
   npx supabase migration list
   ```

6. Recién ahora desplegá el código. El orden es migración antes que código: el código nuevo llama funciones que la base vieja no tiene y fallaría con un error genérico, mientras que el código viejo contra la base nueva sigue funcionando (spec 21.1 §9 y spec 21.2). Si la migración incluye cambios de configuración en el panel de Supabase Auth, una persona los hace a mano: no los aplica `db push`.

7. Mergear a `main` no aplica nada: `db push` es un paso manual y separado.

## Qué va a fallar si te olvidás de algo

| Te olvidaste de | Qué pasa | Dónde se ve |
|---|---|---|
| El test pgTAP de la migración | Nada falla solo: la migración queda sin cobertura de RLS | revisión del PR |
| Los permisos de una función (`revoke` y `grant`) | El test pgTAP de grants falla si lo escribiste; si no, queda abierta a `authenticated` | `npm run db:test` |
| Regenerar tipos | `npm run typecheck` falla en cuanto el código usa la columna o función nueva | CI (`npm run typecheck`) |
| Regenerar la referencia | "docs/referencia coincide con lo que genera docs:sync" | `tests/docs/wiki.test.ts` |
| Nombrar la tabla nueva en la wiki | "toda superficie está mencionada en arquitectura/, dominios/ o guias/…" | `tests/docs/cobertura.test.ts` |
| Correr `migration list` antes de `db push` | Se aplican migraciones ajenas sin que nadie lo decida (ej.: Realtime de la cola sin aplicar durante días) | producción |
| Aplicar la migración antes que el código | El alta o la pantalla nueva falla con "No se pudo guardar" al llamar una función que no existe | producción |

CI (`.github/workflows/ci.yml`) corre `npm run typecheck` y `npm test`; no corre `db:test`. Los tests de SQL los corre quien escribe la migración, en local.

No verificados en esta máquina (Docker apagado al escribir la guía): `npm run db:start`, `db:test`, `db:types`, `db:reset`, `npx supabase migration list`, `npx supabase db push` y `npx supabase link`. Salen de `package.json`, de los planes y del kickoff del repo.
