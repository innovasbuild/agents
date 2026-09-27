# Editor del brain — diseño

**Fecha:** 2026-09-27
**Etapa:** 4 (casilla pendiente "Editor del brain", roadmap línea 208). Corre en paralelo a la Etapa 6 (canal MCP) sin tocar lo que ella toca.
**Base:** `docs/superpowers/specs/2026-09-13-brain-design.md` §8, que este documento completa y del que se desvía en lo anotado en §9.

## 1. Objetivo y criterio de cierre

Que una persona del tenant pueda **leer** el brain cómodo, **entender cómo se conectan** sus páginas y **editarlo** desde la plataforma, sin pasar por Claude Code ni por el import.

Pedido de Matías: "leer y entender y editar mejor todo". "Entender" es, concretamente, ver las conexiones entre páginas: a qué enlaza cada una, qué la enlaza, qué quedó suelto y qué link apunta a nada.

**Terminado cuando:** Matías edita una página del canon desde `/innovas/brain` en producción, la revisión queda con `author_kind: user`, y el agente la lee actualizada en su siguiente `brain_search`.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| E1 | Las conexiones se calculan al leer, en código, con una función pura sobre los bodies del tenant | Sin migración, sin backfill y sin tocar `brain_upsert_page`, que comparten el agente, el import y el MCP. El brain de `innovas` es de decenas a pocos cientos de páginas |
| E2 | Sin grafo visual en esta etapa | Con pocas páginas una lista de enlaces explica más que un grafo de fuerza. Queda pendiente (§10) |
| E3 | Rutas de página bajo `/brain/p/[...slug]` | Un slug `mapa` o `nueva` no puede chocar con las rutas fijas de `/brain` |
| E4 | Solo el proveedor `wiki` tiene editor | Un brain externo por `mcp` se edita en su origen; no hay forma de listar todas sus páginas para armar conexiones |
| E5 | Se escribe solo por `provider.upsert` con autor `user` | Es el único camino de escritura de la spec del brain §5.4: revisión, evento y control de `baseRevision` ya resueltos |
| E6 | El rol se chequea en la server action, no solo en la pantalla | La escritura corre con service role; la RLS no protege este camino |
| E7 | El slug no se renombra | Renombrar rompe los backlinks y exige reescribirlos en otras páginas. Pendiente (§10) |
| E8 | Diff propio (LCS de líneas) en vez de una dependencia | Es chico, se testea fácil y no suma paquetes |
| E9 | Markdown con `react-markdown` + `remark-gfm`, sin HTML crudo | El agente también escribe páginas: el HTML crudo abriría XSS |

## 3. Pantallas

Todo bajo `app/[tenant]/brain/`. Ítem **"Brain"** nuevo en la nav del layout del tenant, visible para todos los miembros.

| Ruta | Qué muestra |
|---|---|
| `/brain` | Índice. Páginas agrupadas por categoría (orden de `config.categories`), buscador, filtro por estado (por defecto oculta `archivado`) y chips de tags de canon. Cada fila: título, slug, estado, tags de canon, links entrantes y salientes. Botón "Nueva página" para admin |
| `/brain/mapa` | La vista para entender: por categoría, hubs (páginas ordenadas por links entrantes), huérfanas (sin links entrantes) y links rotos con su página de origen |
| `/brain/p/[...slug]` | Página renderizada, con wikilinks navegables. Panel lateral (abajo en mobile): categoría, estado, tags, revisión, última edición; **Enlaza a** y **La enlazan**. Botones Editar e Historial |
| `/brain/p/[...slug]/editar` | Formulario de edición (§5) |
| `/brain/nueva` | El mismo formulario con el slug editable |
| `/brain/p/[...slug]/historial` | Revisiones y diff (§6) |

- Tenant sin binding de brain: `/brain` muestra "Este cliente no tiene brain configurado".
- Binding `mcp`: `/brain` muestra "Este brain vive en un servidor externo; se edita en su origen" y ninguna otra ruta funciona (404).
- Página inexistente: 404 con hasta tres sugerencias por búsqueda, igual que `BrainNotFound`.
- Búsqueda: `brain_search_pages` llamada desde el servidor por `provider.search`, después de `resolveTenantAccess`. Sin consulta, el índice lista todo sin buscar.
- Estilo: shadcn con la marca del tenant, como el resto del dashboard. Se agregan los componentes que falten (`tabs`, `badge`, `dialog`) con el CLI de shadcn.

## 4. Conexiones

### 4.1 Wikilinks

La regex vive hoy en `lib/brain/import/document.ts:26`. Se mueve a `lib/brain/wikilinks.ts` junto con un parser que devuelve `{ target, anchor, alias, start, end }` por ocurrencia; el import pasa a importarla de ahí sin cambiar su comportamiento.

Formato: `[[slug]]`, `[[slug|alias]]`, `[[slug#ancla|alias]]`. El target se compara contra slugs exactos: el import ya reescribió todo a slugs canónicos (spec brain §9.3). Un wikilink escrito a mano con un nombre que no es slug cuenta como roto, y eso es lo que tiene que ver quien lo escribió.

### 4.2 Índice

`lib/brain/links.ts`, función pura:

```ts
interface LinkPage { slug: string; title: string; category: string; status: BrainStatus; body: string }

interface LinkIndex {
  outgoing: Map<string, OutgoingLink[]>; // por página de origen, en orden de aparición
  incoming: Map<string, string[]>;       // slugs de origen, ordenados
  broken: { source: string; target: string }[];
  orphans: string[];                     // sin links entrantes desde otra página
}
interface OutgoingLink { target: string; alias: string | null; broken: boolean; archived: boolean }

function buildLinkIndex(pages: LinkPage[]): LinkIndex
```

Reglas:
- Un link a la misma página no cuenta como entrante ni saca a la página de huérfana.
- El mismo target repetido en una página cuenta una vez (se conserva la primera ocurrencia).
- Las archivadas entran al índice. Un link a una archivada no es roto: sale con `archived: true` y se muestra atenuado.
- Un link que sale de una archivada no cuenta como entrante para su destino (una página solo enlazada desde archivadas es huérfana).
- Las archivadas no se listan como huérfanas.

### 4.3 Carga

`lib/brain/editor/load.ts`: una query con el cliente de sesión, `select slug, title, category, status, tags, body, revision, updated_at from brain_pages where tenant_id = $1`, envuelta en `cache()` de React para que layout y página compartan el resultado dentro del request. La RLS de lectura de `brain_pages` ya existe (spec brain §5.5).

## 5. Edición

### 5.1 Permisos

- Leen todos los miembros del tenant y `platform_admin`.
- Crean, editan, archivan y restauran `tenant_admin` y `platform_admin`. Es la misma regla que el MCP (D4 de la Etapa 11).
- Un `tenant_member` no ve botones de escritura y las rutas `/editar` y `/nueva` le dan 404.
- La server action repite el chequeo (E6).

### 5.2 Formulario

- **Slug**: solo lectura al editar; editable en `/brain/nueva`, validado contra `SLUG_PATTERN` y `MAX_SLUG_LENGTH`.
- **Título**, **categoría** (select con `config.categories`), **estado** (`activo`, `borrador`, `archivado`), **tags** (texto libre con sugerencias de `CANON_TAGS` y los tags ya usados en el tenant).
- **Cuerpo**: pestañas Editar / Vista previa. Al escribir `[[` se abre un autocompletado con los slugs y títulos existentes; elegir uno inserta `[[slug|Título]]`.
- **Motivo del cambio**: obligatorio (`brain_revisions.reason` es `not null`).
- El frontmatter extra se conserva tal cual; no se edita en esta etapa. `updated` lo pone `validateWrite` si falta.
- Guardar con cambios sin enviar y salir de la pantalla pide confirmación del navegador (`beforeunload`).

### 5.3 Guardar

Server action `saveBrainPage` en `app/[tenant]/brain/actions.ts`, que delega en `lib/brain/editor/save.ts` para poder testearla sin Next:

1. Valida la entrada con zod en el borde.
2. `resolveTenantAccess(slug)`; sin acceso o con rol `tenant_member`, `{ ok: false, code: "forbidden" }`.
3. `resolveBrainBinding` con el cliente admin; sin binding o con binding `mcp`, `{ ok: false, code: "unsupported" }`.
4. `getBrainProvider(binding).upsert(write, { kind: "user", userId })` con `baseRevision` de la revisión que se abrió (en una página nueva, sin `baseRevision`, y si el slug ya existe vuelve conflicto).
5. `revalidatePath` de `/[tenant]/brain` y de la página.

Resultados:

| Error | Respuesta | Pantalla |
|---|---|---|
| `BrainConflict` | `{ ok: false, code: "conflict", currentRevision }` | Aviso "Alguien guardó la revisión N mientras editabas". Se conserva el texto; botón para ver el diff entre tu versión y la vigente y botón para reintentar sobre la nueva base |
| `BrainValidation` | `{ ok: false, code: "validation", fields }` | Marca los campos |
| Otro | `{ ok: false, code: "internal" }` y log con un id | "No se pudo guardar (id)" |

### 5.4 Archivar

Es cambiar el estado a `archivado` por el mismo formulario. No hay borrado.

## 6. Historial

- `/brain/p/[...slug]/historial` lee `brain_revisions` de la página con el cliente de sesión (RLS de select por membresía ya existe), de la más nueva a la más vieja.
- Cada revisión: número, fecha, badge de tipo de autor (**Persona**, **Agente**, **Import**) y motivo. Para `user` y `agent` se muestra el email del usuario: se resuelve en el servidor con el cliente admin, solo para los `author_user_id` que son miembros del tenant; si no, "Persona" o "Agente" a secas.
- Abrir una revisión muestra su diff contra la anterior. Selector para compararla contra la vigente.
- **Restaurar** (solo admin): llama a `saveBrainPage` con el contenido de esa revisión, `baseRevision` de la vigente y motivo "Restaurada desde la revisión N". Si alguien guardó en el medio, sale el conflicto de §5.3.

### 6.1 Diff

`lib/brain/diff.ts`, funciones puras:

- `diffLines(a, b)` → bloques `{ kind: "equal" | "added" | "removed", lines }` por LCS de líneas. Los bloques `equal` largos se colapsan en la pantalla dejando tres líneas de contexto.
- `diffMeta(a, b)` → cambios de título, categoría, estado y tags (agregados y quitados).

## 7. Markdown

`components/brain/markdown.tsx` con `react-markdown` + `remark-gfm` y un plugin remark chico (`lib/brain/remark-wikilinks.ts`) que convierte cada wikilink en un nodo link. El render:
- Link sano: `<Link href="/[tenant]/brain/p/<slug>#ancla">alias o título</Link>`.
- Link a archivada: igual, atenuado, con título "Archivada".
- Link roto: `<span>` con subrayado punteado y título "No existe la página <slug>".
- Sin `rehype-raw`: el HTML del cuerpo se muestra como texto.

## 8. Tests

**Unitarios (vitest, TDD, en `tests/brain/`):**
- `wikilinks.test.ts`: los tres formatos, anclas, alias con espacios, varios por línea, texto sin links. Los tests del import siguen en verde con la regex movida.
- `links.test.ts`: salientes en orden, entrantes, rotos, huérfanas, autolink, duplicados, links a y desde archivadas.
- `diff.test.ts`: iguales, solo agregado, solo quitado, cambios mezclados, texto vacío; `diffMeta` con tags.
- `editor-save.test.ts`: `tenant_member` rechazado, binding `mcp` rechazado, sin binding rechazado, autor `{ kind: "user", userId }` de la sesión, motivo obligatorio, traducción de `BrainConflict` y `BrainValidation`.
- `remark-wikilinks.test.ts`: link sano, roto y archivado producen los nodos esperados.

**Base:** sin SQL nuevo, sin pgTAP nuevo. Las políticas de `brain_pages` y `brain_revisions` ya tienen cobertura.

**Navegador (`/qa`, desktop y mobile, base local con el brain de `innovas` importado):**
1. Leer una página, seguir un wikilink y volver por "La enlazan".
2. Editar, guardar y ver la revisión nueva en el historial con su diff.
3. Conflicto con dos pestañas: el texto se conserva y el reintento funciona.
4. Como `tenant_member`: sin botones de escritura y 404 en `/editar`.
5. `/brain/mapa` muestra huérfanas y links rotos que coinciden con el reporte del import.

## 9. Desvíos sobre la spec del brain §8

- Rutas de página bajo `/brain/p/` en vez de `/brain/[...slug]` (E3).
- Se suma `/brain/mapa` y el panel de conexiones por página: el §8 pedía solo un "panel de wikilinks rotos".
- El diff dentro de la tarjeta de aprobación del chat no entra en esta etapa (§10).

## 10. Pendientes, fuera de esta etapa

- **Grafo visual** de páginas y links (E2).
- **Renombrar un slug** reescribiendo los wikilinks que lo apuntan (E7).
- **Editar el frontmatter extra.**
- **Tabla `brain_links` materializada** por `brain_upsert_page`, si el brain de un tenant pasa de unas 500 páginas o la carga de §4.3 se vuelve lenta (E1).
- **Diff contra la versión vigente en la tarjeta de aprobación del chat** cuando el agente propone un `brain_upsert` (spec brain §8, último punto).

## 11. Riesgos

- **Choque con la Etapa 6.** Esta etapa no toca `lib/brain/mcp-server/`, `brain_upsert_page` ni migraciones. El único archivo compartido es `app/[tenant]/layout.tsx` (un ítem de nav): conflicto de merge trivial.
- **Tamaño de la carga de §4.3.** Todos los bodies de un tenant en cada request de `/brain`. Con el límite de 200 KB por página y unos cientos de páginas es aceptable; la señal para materializar es la de §10.
- **Escritura con service role.** El único guardia es el chequeo de rol en `saveBrainPage` (E6); lo cubre `editor-save.test.ts`.
