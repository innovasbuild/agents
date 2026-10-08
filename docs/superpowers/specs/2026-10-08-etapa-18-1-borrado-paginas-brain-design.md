# Etapa 18.1 · Borrado de páginas del brain — diseño

**Fecha:** 2026-10-08
**Etapa:** 18 (nueva en el roadmap), entrega 18.1. La 18.2 es el editor visual (`2026-10-08-etapa-18-2-editor-visual-brain-design.md`). Son independientes: cada una tiene su plan y su PR.
**Base:** `2026-09-13-brain-design.md` (modelo de datos, B8 y `brain_upsert_page`), `2026-09-27-editor-brain-design.md` (conexiones y pantallas), `2026-10-05-etapa-17-permisos-brain-design.md` (permisos por nodo). Este documento **reemplaza la decisión B8** de la spec del brain.

## 1. Objetivo y criterio de cierre

Que un administrador de un nodo pueda **borrar una página del brain desde la web sin dejar links muertos**: el sistema busca las páginas que la enlazan, saca esos enlaces dejando su texto, y borra la página con su historial, todo junto o nada.

Pedido de Matías: borrado de una página del wiki, que tiene que buscar links en otras páginas a la página a borrar para evitar links muertos.

**Terminado cuando**, en producción, en el tenant `innovas`:

1. Un administrador borra una página enlazada desde otras dos desde el menú de tres puntos; la página deja de existir (404 en la web, `not_found` por MCP).
2. Las dos páginas que la enlazaban muestran el texto del link sin enlace, con una revisión nueva cuyo motivo es `Se borró <slug>`.
3. `events` tiene un `brain.page_deleted` con la ruta, el título y las páginas limpiadas.
4. Un `tenant_member` sin administración sobre el nodo no ve "Borrar…" y la acción le responde `forbidden` (o `not_found` si no ve la página).
5. Ni el agente ni el endpoint MCP tienen forma de borrar: `brain_upsert` sigue siendo la única escritura.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Borrado real, solo desde la web.** La página y sus revisiones desaparecen. Reemplaza B8 ("nunca se borran páginas") por: "se borra solo desde la web, por un administrador del nodo; agente y MCP archivan" | Es lo pedido. Acota el riesgo a personas, a la web y a quien administra el nodo. No toca el contrato del agente ni del MCP |
| D2 | **Sin papelera ni deshacer.** La confirmación lo dice | Una papelera suma un estado nuevo en todas las superficies. Queda en §9 |
| D3 | **Los links entrantes se limpian solos:** cada `[[slug\|alias]]` pasa a su texto. Nunca se bloquea el borrado por links ni se dejan rotos a propósito | Cumple "evitar links muertos" sin trabajo manual |
| D4 | **Se limpian todas las páginas que enlazan, las vea o no quien borra.** La confirmación lista las visibles y, para el resto, muestra solo una cantidad | La limpieza no escribe contenido propio en una página ajena: saca un enlace que dejó de existir. Listar las ocultas revelaría rutas (A8 de la Etapa 17) |
| D5 | **Todo o nada, en una función SQL.** Limpieza, borrado, reglas y evento en una transacción | Un borrado a medias dejaría links muertos o páginas limpiadas sin motivo |
| D6 | Cada página limpiada recibe **una revisión a nombre de quien borra**, por `brain_upsert_page`, con motivo `Se borró <slug>` | Queda en su historial y se puede revertir con "Restaurar" |
| D7 | Una página que también es carpeta (A6 de la Etapa 17) **se borra sola**; lo que cuelga queda | Borrar una carpeta entera es otra operación, con otro riesgo (§9) |
| D8 | Las reglas de acceso de esa ruta se borran **solo si no queda nada debajo** | Si quedan páginas, las reglas siguen protegiéndolas |
| D9 | El plan de limpieza lo arma **el servidor al confirmar**, no el navegador | La lista que se ve en el diálogo es informativa; lo que se escribe no depende de lo que mande el cliente |
| D10 | Solo el proveedor `wiki`. Un brain externo por `mcp` no se borra desde acá | Igual que el editor (E4) |

## 3. Qué se limpia

### 3.1 Reemplazo de un link

Función pura `removeWikilinks(body, target, fallbackText)` en `lib/brain/core/wikilinks.ts`:

- `[[target|alias]]` → `alias`.
- `[[target]]` y `[[target#ancla]]` → `fallbackText` (el título de la página borrada).
- `[[target#ancla|alias]]` → `alias`.
- Los links a otros destinos no se tocan.
- Los wikilinks dentro de bloques ```` ``` ```` y de código en línea no se tocan (mismo criterio que `toMarkdownLinks`).
- Devuelve el cuerpo igual, byte a byte, si no había links a `target`.

### 3.2 Plan de limpieza

Función pura `planLinkCleanup(pages, target)` en `lib/brain/core/links-cleanup.ts`:

```ts
interface CleanupItem { slug: string; title: string; baseRevision: number; body: string }
function planLinkCleanup(pages: BrainPage[], target: string): CleanupItem[];
```

- Recorre **todas** las páginas del tenant, incluidas las archivadas (se pueden desarchivar) y excluida la propia `target`.
- Incluye una página solo si su cuerpo cambia al aplicar `removeWikilinks`.
- `baseRevision` es la revisión vigente de esa página al armar el plan.

## 4. Base de datos

Migración nueva, sin tablas. Antes de escribirla se carga `supabase-postgres-best-practices`.

### 4.1 `brain_delete_page`

```sql
brain_delete_page(
  p_tenant_id uuid,
  p_slug text,
  p_expected_revision integer,
  p_actor uuid,
  p_binding_id uuid,
  p_cleanups jsonb          -- [{ "slug": text, "base_revision": int, "body": text }]
) returns table (deleted_revisions integer, cleaned integer, rules_removed integer)
```

`security invoker`, `search_path = ''`, ejecutable solo por `service_role`. En una transacción:

1. Toma la página con `for update`. Si no existe: `BR404`. Si su `revision` no es `p_expected_revision`: `BR409` (cambió desde la vista previa).
2. Por cada elemento de `p_cleanups`, llama a `brain_upsert_page` con el título, categoría, estado, tags y frontmatter vigentes de esa página, el cuerpo nuevo, `p_base_revision = base_revision`, autor `user` = `p_actor` y motivo `Se borró <p_slug>`. Un conflicto de revisión en cualquiera aborta todo con `BR409`.
3. Borra la fila de `brain_pages`; `brain_revisions` cae por la clave foránea con `on delete cascade` que ya existe.
4. Si no queda ninguna página con `slug like p_slug || '/%'`, borra las filas de `brain_access_rules` con `path = p_slug`.
5. Inserta en `events` un `brain.page_deleted` con `actor_user_id = p_actor`, `summary = p_slug` y `payload: { slug, title, category, revisions, cleaned: [slugs], rules_removed, binding_id }`.

`events` sigue siendo append-only: solo se inserta. `brain_revisions` no admite `delete` para `authenticated` ni `anon`; lo hace el servidor, por la cascada.

### 4.2 Lo que no cambia

`brain_upsert_page` no se toca. No hay columnas ni tablas nuevas. La migración se aplica a producción **antes** que el código (correr `npx supabase migration list` primero); con la migración aplicada y el código viejo no cambia nada.

## 5. Operación y permisos

### 5.1 Núcleo

`lib/brain/core/editor/delete.ts`, sin Next ni Supabase, con dependencias inyectadas como `savePage` y `changeAccess`:

```ts
type DeleteResult =
  | { ok: true; cleaned: number }
  | { ok: false; code: "not_found" | "forbidden" | "conflict" | "unsupported"; message: string };

interface DeletePreview {
  slug: string; title: string; revision: number;
  linkers: { slug: string; title: string }[];   // solo las que la persona ve
  hiddenLinkers: number;                        // cantidad, sin rutas
  hasChildren: boolean;
  canonTags: string[];
}

previewDelete(tenantSlug, slug, deps): Promise<{ ok: true; preview: DeletePreview } | Failure>
deletePage(tenantSlug, slug, expectedRevision, deps): Promise<DeleteResult>
```

Reglas, en este orden:

1. Sin sesión en el tenant, o brain no `wiki`: `not_found` / `unsupported`.
2. Se cargan las reglas (falla cerrada: si no se pueden cargar, lanza).
3. `resolveAccess(slug) === null` → `not_found`. Menor que `administrador` → `forbidden`. Una página inexistente bajo un nodo que la persona administra → `not_found`.
4. Se cargan **todas** las páginas del tenant con el proveedor sin envolver (hace falta para limpiar las ocultas, D4) y se arma el plan.
5. `previewDelete` devuelve las páginas del plan que la persona ve (`resolveAccess ≠ null`) y cuenta las demás. `deletePage` arma el plan de nuevo (D9) y llama a la función SQL.
6. `BR409` → `conflict` con el mensaje "La página o alguna de las que la enlazan cambió. Volvé a abrir el diálogo."

El borrado **no pasa por `BrainProvider`**: el contrato que comparten el agente y el MCP no gana ninguna operación (D1). La escritura la hace un `BrainPageDeleter` aparte (núcleo con el cliente inyectado, cableado en `adapters/`).

### 5.2 Server actions

En `app/[tenant]/brain/delete-actions.ts`, con `zod` en el borde: `getDeletePreview({ tenantSlug, slug })` y `deleteBrainPage({ tenantSlug, slug, expectedRevision })`. Al borrar bien, revalida `/<tenant>/brain` con `"layout"`.

### 5.3 Carrera conocida

Si alguien agrega un link nuevo a la página entre que el servidor arma el plan y la transacción, ese link queda roto: la página nueva no estaba en el plan. La ventana es de milisegundos y el link aparece en el reporte de links rotos del mapa de conexiones. No se bloquea toda la tabla para evitarlo.

## 6. Pantallas

- **Árbol:** el menú de tres puntos suma "Borrar…" en los nodos que tienen página, para quien es `administrador` del nodo. Va último y en color destructivo.
- **Vista de la página:** un botón "Borrar página" junto a "Historial", con la misma condición.
- **Diálogo** (`AlertDialog`): título `Borrar "<título>"`; ruta; texto "No se puede deshacer: se borra la página con todo su historial."; lista de páginas que enlazan con el texto "En estas páginas el link se reemplaza por su texto:" y, si corresponde, "y N páginas más que no podés ver"; aviso si tiene etiquetas `canon:*` ("Los agentes usan esta página para redactar."); aviso si tiene páginas debajo ("Las páginas que cuelgan de esta no se borran."). Botones "Cancelar" y "Borrar definitivamente" (destructivo, deshabilitado mientras trabaja). Un error se muestra en un `role="alert"`.
- Al terminar, lleva a `/brain` (o a `/brain?carpeta=<carpeta>` si la página tenía carpeta).
- A 375 px: sin scroll horizontal y objetivos táctiles de 44 px. Español rioplatense.

## 7. Otras superficies

- **Agente y MCP:** sin cambios. La descripción de `brain_upsert` ("Nunca borres: para retirar una página, poné status archivado") se mantiene.
- **Documentación:** B8 se reescribe en `2026-09-13-brain-design.md` con una nota que apunta a esta spec; `lib/brain/README.md` suma una sección "Borrar páginas".

## 8. Pruebas

- **Puras (Vitest):** `removeWikilinks` (alias, ancla, ancla y alias, sin alias, varios links en una línea, dentro de código, otros destinos intactos, sin links devuelve igual) y `planLinkCleanup` (incluye archivadas, excluye la propia, solo las que cambian, link de una página a sí misma).
- **Núcleo:** `previewDelete` y `deletePage` con dobles: `not_found` para lo oculto, `forbidden` para quien no administra, las ocultas se cuentan y no se listan, el plan se arma en el servidor, `conflict`, falla cerrada, proveedor `mcp` → `unsupported`.
- **pgTAP:** borra página y revisiones; limpia con revisión nueva y motivo; todo o nada ante conflicto en una limpieza; `BR409` si la revisión esperada no coincide; reglas borradas solo sin hijos; un evento `brain.page_deleted`; `authenticated` y `anon` no ejecutan la función.
- **Acciones:** el borde rechaza datos mal formados y revalida solo si salió bien.

## 9. Fuera de alcance

- Papelera y restaurar una página borrada.
- Borrar una carpeta con todo lo que tiene debajo.
- Borrado por el agente o por MCP.
- Renombrar o mover páginas (E7 del editor sigue vigente).
- Limpieza de reglas al eliminar una membresía (seguimiento de la 17.3).
