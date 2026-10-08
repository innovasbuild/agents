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

## Borrar páginas

- `core/editor/delete.ts` (`previewDelete`, `deletePage`) es el único camino
  que borra. Exige administrador del nodo, rechaza con `unsupported` si el
  brain es externo (`mcp`) y arma el plan de limpieza en el servidor, con las
  páginas de `deps.pages()` sin envolver con permisos: al confirmar se rehace,
  lo que mandó o vio el navegador no cuenta. `previewDelete` nombra solo las
  páginas que enlazan y que la persona ve; las ocultas solo se cuentan
  (`hiddenLinkers`). Un conflicto de revisión (`BR409`) o un deadlock de
  Postgres (`40P01`) se devuelven como `conflict`.
- `core/wikilinks.ts` (`removeWikilinks`) y `core/links-cleanup.ts`
  (`planLinkCleanup`) son puras: quitan los links a la página borrada y
  planean qué páginas reescribir.
- `core/delete-store.ts` (`createSupabasePageDeleter`) implementa `PageDeleter`
  llamando por RPC a la función SQL `brain_delete_page` (migración
  `20261009120000_brain_delete_page`), que limpia las páginas que enlazan,
  borra la página (sus revisiones caen por la clave foránea), quita las reglas
  de acceso de la ruta solo si no queda ninguna página debajo y deja el evento
  `brain.page_deleted`, todo en una transacción. Las limpiezas viajan ordenadas
  por slug para que dos borrados concurrentes no se traben.
- El borrado no pasa por `BrainProvider` ni por `core/contract.ts`: el agente y
  el MCP no tienen cómo borrar.
- `adapters/delete-page.ts` (`deleteDeps()`) cablea sesión, binding, reglas y
  cliente admin; `app/[tenant]/brain/delete-actions.ts` son las server actions
  que llama el diálogo (`components/brain/delete-page-dialog.tsx`).

## Editor visual

- La página abre sola en edición para quien es `editor` o más sobre esa página;
  el resto ve la hoja de lectura. Lo decide `core/editor/entry-mode.ts`
  (`entryMode`: `hidden`, `read` o `edit`). `/brain/editar/<slug>` redirige de
  forma permanente (`permanentRedirect`) a `/brain/p/<slug>`, así que los links
  viejos siguen andando; `/brain/nueva` usa el mismo espacio de trabajo.
- El editor es Tiptap 3 con `@tiptap/markdown` y vive en
  `components/brain/editor/`, **fuera de `core`**: `core` no importa Tiptap.
- El markdown sigue siendo la fuente de verdad; nada se guarda en otro formato.
  El editor lee el markdown y lo vuelve a escribir, y a veces lo normaliza.
  `core/editor/body-to-save.ts` (`chooseBodyToSave`) compara lo que serializa
  ahora el editor con lo que serializaba el cuerpo original al cargarlo: si es
  igual, la persona no tocó el texto y se guarda el cuerpo original tal cual.
  Abrir una página del agente y cambiar solo una etiqueta no reescribe el cuerpo.
- El nodo `WikiLink` (`wikilink-node.ts`) lee y escribe `[[slug]]`,
  `[[slug|alias]]` y `[[slug#ancla|alias]]`, y guarda el texto original en
  `raw`: mientras no se edite el nodo, sale carácter por carácter igual. Los `|`
  de un link dentro de una tabla se protegen antes de que `marked` parta las
  celdas.
- El HTML crudo nunca se interpreta. El nodo `RawHtml` (`raw-html-node.ts`) lo
  guarda como un átomo con el texto original (`raw`), lo muestra como texto y lo
  devuelve igual al guardar; es lo mismo que hace la vista de lectura.
- Las URL y los emails sueltos se escriben sueltos, sin `<...>`: lo hace
  `bareAutolinks` (`extensions.ts`), que envuelve `getMarkdown()` y no toca el
  código.
- El motivo del cambio es opcional desde la web: vacío se registra como
  `DEFAULT_WEB_REASON` ("Edición desde la web", `core/editor/save.ts`). Para el
  agente y el MCP sigue siendo obligatorio (`reason` con `min(1)` en
  `core/contract.ts` y el chequeo de `core/wiki.ts`).
- Prueba de ida y vuelta: `npx vitest run tests/brain/editor-roundtrip.test.ts`
  (corre en `happy-dom`). Recorre el corpus sintético
  (`tests/fixtures/markdown-corpus.ts`) más las páginas reales que haya en
  `tests/fixtures/brain-real/`. Para sumar páginas reales, copiar ahí archivos
  `.md` del brain de un tenant. Esa carpeta está en `.gitignore` y **no se
  commitea**: el repo es público y las páginas son de clientes. Por cada caso se
  exige que la vista de lectura sea la misma, que los `[[...]]` salgan byte a
  byte iguales y que una segunda pasada no cambie nada; los casos `exact: true`
  además exigen markdown idéntico.
- Normalizaciones aceptadas (casos `exact: false`): el relleno de las tablas
  (columnas alineadas con espacios, guiones de la fila separadora más largos) y
  las líneas en blanco alrededor de una tabla; el escape `\[` y `\]` en un
  título con corchetes; y las líneas en blanco consecutivas, que pueden colapsar.
  El contenido visible es el mismo. Por V6 solo alcanzan a una página que una
  persona edita de verdad: si no toca el cuerpo, se guarda el original.

## Qué viaja con el módulo

- `lib/brain/core/`
- `tests/brain/`, salvo los que importan de `adapters/` o de eve
  (`agent-access.test.ts`, `tools.test.ts`, `mcp-server/bearer.test.ts`,
  `mcp-server/handler.test.ts`, `mcp-server/production.test.ts`), que se
  reescriben junto con los adapters.
- Migraciones: `20260913233557_brain_tables`, `20260913234426_brain_upsert_page`,
  `20260913235330_brain_search_pages`, `20260924100200_brain_mcp_usage`,
  `20261007120000_brain_access_rules`, `20261008120000_brain_access_rule_fns` y
  `20261009120000_brain_delete_page`.
- Tests pgTAP del brain en `supabase/tests/`, incluido
  `supabase/tests/21_brain_access_rules.test.sql`, `22_brain_access_rule_fns` y
  `23_brain_delete_page.test.sql`.

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
