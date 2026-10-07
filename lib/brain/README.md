# Brain

Módulo del brain de cada cliente: páginas en markdown con revisiones, búsqueda,
editor, endpoint MCP y tools para el agente. Está pensado para poder mudarse a
su propio repo.

## Estructura

- `core/`: todo el módulo. No importa nada de afuera de `lib/brain/core`, salvo
  `zod`, `yaml`, `@modelcontextprotocol/sdk`, `node:*` y, como tipo,
  `@supabase/supabase-js`. Lo vigila `tests/brain/boundary.test.ts`, que mira
  imports estáticos y dinámicos; no detecta globals de Node como `Buffer`.
- `core/access/`: modelo de permisos por carpeta y página (`resolveAccess`,
  `withAccess`) y lectura de reglas. Un `tenant_member` ve y edita lo que las
  reglas le dan; administradores, agente, plataforma e import no pasan por
  ellas. El agente del chat actúa con los permisos de quien inició la sesión
  (se fijan al iniciarla). Si se comparten hilos con turnos de escritura, el
  actor tiene que derivarse dentro de execute desde
  `toolCtx.session.auth.current` (como ya hace la tool de escritura con
  `auth.initiator` para el autor), no fijarse al iniciar la sesión.
- `adapters/`: lo que conecta el módulo con esta plataforma (Supabase admin,
  conexiones del tenant, sesión, eve, Next). Es lo que hay que reescribir en el
  repo nuevo.

## Cambiar permisos

- `core/access/manage.ts` es el único camino que cambia reglas desde la app.
  Exige administrador del nodo, valida la membresía y que la ruta exista, y
  aplica el chequeo de autoexclusión. Dar acceso (grant) solo se puede a un
  `tenant_member` simple del tenant; quitarlo (revoke) se permite para
  cualquier `userId`. Autoexclusión (`lockout`): si quien cambia no es
  administrador del tenant (es un miembro que administra el nodo), se simula
  el cambio con `applyChange` y, si después ya no resuelve a `administrador`
  sobre ese nodo, devuelve `lockout`. Los administradores del tenant quedan
  exentos.
- `core/access/rules-store.ts` (`createSupabaseAccessRulesWriter`) implementa
  `AccessRulesWriter` llamando por RPC a las funciones SQL
  `brain_set_access_rule` y `brain_remove_access_rule` (migración
  `20261008120000_brain_access_rule_fns`), que escriben regla y evento en una
  sola transacción. `adapters/access-rules.ts` (`accessRulesWriter()`) solo lo
  cablea con el cliente admin; `adapters/access-admin.ts` arma `ManageDeps`
  (`manageDeps()`) y el `ShareState` del diálogo.
- `app/[tenant]/brain/access-actions.ts` son las server actions que llama el
  diálogo de compartir.
- `core/access/tree.ts` (`visibleTree`, `editableFolders`) y
  `core/access/explain.ts` (`explainAccess`) son puras. El árbol que llega al
  navegador no lleva cuerpos ni reglas, solo estructura y qué se puede hacer.

## Qué viaja con el módulo

- `lib/brain/core/`
- `tests/brain/`, salvo los que importan de `adapters/` o de eve
  (`agent-access.test.ts`, `tools.test.ts`, `mcp-server/bearer.test.ts`,
  `mcp-server/handler.test.ts`, `mcp-server/production.test.ts`), que se
  reescriben junto con los adapters.
- Migraciones: `20260913233557_brain_tables`, `20260913234426_brain_upsert_page`,
  `20260913235330_brain_search_pages`, `20260924100200_brain_mcp_usage`,
  `20261007120000_brain_access_rules` y `20261008120000_brain_access_rule_fns`.
- Tests pgTAP del brain en `supabase/tests/`, incluido
  `supabase/tests/21_brain_access_rules.test.sql` y `22_brain_access_rule_fns`.

## Lo que el host tiene que proveer

| Interfaz | Dónde | Qué hace |
|---|---|---|
| `WikiStore` | `core/wiki-store.ts` | Lectura y escritura de páginas y revisiones. `createSupabaseWikiStore(client)` es la implementación sobre Supabase |
| `AccessStore`, `ClaimsVerifier`, `HitFn` | `core/mcp-server/` | Roles del usuario, verificación del token y contador de llamadas del endpoint MCP |
| `BrainMcpDeps.unauthorized` | `core/mcp-server/handler.ts` | Arma la respuesta 401 con su desafío |
| `load` de `resolveBrainBinding` | `core/resolve.ts` | Lista las conexiones del tenant (`BrainConnection[]`) |
| `AccessRulesStore` | `core/access/types.ts` | Reglas de acceso del tenant. `createSupabaseAccessRulesStore(client)` lee `brain_access_rules`; si falla, lanza (falla cerrada) |
| `SaveDeps` | `core/editor/save.ts` | Sesión, binding y proveedor para guardar desde el editor |

Los scripts de operación (`scripts/brain-import.mts`, `scripts/connections-bind.mts`)
corren con Node directo: en `core/`, los imports que ellos alcanzan llevan
extensión `.ts`.
