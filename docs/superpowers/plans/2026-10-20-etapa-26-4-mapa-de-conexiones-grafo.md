# Etapa 26.4 · Mapa de conexiones como grafo — plan de implementación

> **Para quien ejecute:** usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans, tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** que "Mapa de conexiones" abra un grafo a pantalla completa, estilo Obsidian, que aguante un brain grande, con filtros, colores, zoom, tamaño por conexiones y un popover (título, fecha de última edición, "Ver página").

**Arquitectura:** un servicio puro en `lib/brain/core/` arma un payload compacto (nodos, aristas, rotos, huérfanas) desde lo que el proveedor ya filtró por permisos; un route handler lo sirve; un componente de cliente con Sigma.js (WebGL) lo dibuja. La lista actual queda como segunda vista. Antes de todo, se pagina la lectura del brain (hoy se corta en 1.000 páginas) y se corre un spike de rendimiento que decide si la librería sirve.

**Tecnología:** Next.js 16 (App Router), React 19, Sigma.js 4.0.3 (la versión medida en el spike; en Sigma 4 las opciones van dentro de `settings` y hace falta `itemSizesReference: "screen"` para que los nodos no se vean diminutos), graphology 0.26.0, `graphology-layout-forceatlas2` (worker), Vitest (`environment: "node"`, solo `tests/**/*.test.ts`), Supabase/PostgREST.

**Spec:** `docs/superpowers/specs/2026-10-20-etapa-26-4-mapa-de-conexiones-grafo-design.md` (aprobada el 2026-10-20). Cada tarea cita las decisiones D1–D16.

## Restricciones globales

- UI, avisos y mensajes en español rioplatense; código e identificadores en inglés (CLAUDE.md del repo).
- `lib/brain/core/` no importa `@/`, `react` ni `next/*` (lo vigila `tests/brain/boundary.test.ts`). Lo que usa un componente de cliente no puede arrastrar `node:*` (`tests/brain/client-safe.ts`).
- El grafo no muestra ni transporta nada que la persona no pueda ver: los permisos son los del proveedor (`ctx.provider`), sin un segundo filtro propio (spec §4).
- Sin tablas nuevas. Migración solo si la Task 3 lo decide (D13).
- Dependencias nuevas: `sigma` 4.0.3 (no v3), `graphology` 0.26.0 y `graphology-layout-forceatlas2` 0.10.1, las versiones medidas en el spike (spec §2.1); se fijan al instalar.
- Escala (D8): compuerta a 10.000 nodos y unas 30.000 aristas con ≥ 30 fps en zoom y paneo, nodos visibles en < 3 s desde que llega la respuesta y respuesta < 2 MB comprimida. A 50.000 es meta, con tope `GRAPH_MAX_NODES`.
- Cada test nuevo abre con el bloque de cabecera del repo (`// Value: protects=… fails_when=… why_new=…; seam=none`), como `tests/brain/raw-route.test.ts`.
- `npm run lint:fix` reformatea siempre cuatro archivos ajenos (`lib/connectors/leads/coldiq.openapi.ts`, `lib/connectors/leads/google-places.openapi.ts`, `lib/supabase/database.types.ts`, `tests/connectors/coldiq-openapi.test.ts`): revertirlos antes de commitear. Hay además un error preexistente en `tests/connectors/bindings.test.ts:18`.
- Después de cada cambio de código: `npm run typecheck`. Commits con prefijo `feat:`, `fix:`, `docs:` o `refactor:`; identidad local `innovasbuild` / `matias@innov.as`.
- Trabajar en un worktree por entrega y leer desde el worktree, nunca del checkout principal. No hacer `cd` a worktrees ajenos: usar `git -C` o rutas absolutas.
- `preview_start` sirve el checkout principal contra producción, no un worktree. Para probar en navegador, levantar `npm run dev -- --port <otro>` desde el worktree con `.env.local` de la base local (ver la memoria `reference_preview_start_no_sirve_worktrees`).

## Foco de revisión

Entradas o condiciones que la spec implica y ninguna tarea ejercita por sí sola. Cada una tiene su test en la tarea dueña del código.

1. Un brain con exactamente 1.000, 1.001 y 2.500 páginas llega completo, y con un `max_rows` menor a 1.000 también (Tasks 1 y 2).
2. Una página que se enlaza a sí misma, dos páginas que se enlazan entre sí y una que enlaza dos veces a la misma no duplican aristas ni inflan el grado (Task 5).
3. Un brain vacío, uno con una sola página y uno sin ningún link no rompen el payload ni la escala de tamaño (Tasks 5 y 6).
4. Títulos con tildes, mayúsculas o caracteres raros se buscan sin distinguir acentos y no rompen el popover (Tasks 6 y 9).
5. Una persona sin acceso a una carpeta no recibe esas páginas, ni las aristas, ni los rotos que apuntan a ellas (Task 7).

---

## Entrega 26.4a · Volumen (PR 1)

### Task 1: Paginar `listMeta`

**Archivos:**
- Modificar: `lib/brain/core/wiki-store.ts` (método `listMeta`, ~líneas 193-201)
- Modificar y probar: `tests/brain/wiki-store.test.ts` (el cliente falso no tiene `.range`)

**Interfaces:**
- Consume: la factoría `createSupabaseWikiStore(client)` y `META_COLUMNS` existentes.
- Produce: `listMeta(tenantId)` devuelve **todas** las páginas del tenant, ordenadas por `slug`, aunque PostgREST corte cada respuesta. Misma firma que hoy.

- [x] **Paso 1: tests que fallan.** En `tests/brain/wiki-store.test.ts`, agregar al cliente falso `range(from, to)` sobre `rows[table]` con un `maxRows` configurable (por defecto 1.000) y un contador de llamadas. Tests: `listMeta devuelve 1.001 páginas`, `listMeta devuelve 2.500 páginas`, `listMeta sigue completo si el servidor corta en 500 por respuesta`, `listMeta con exactamente 1.000 páginas hace una consulta más y termina`, `listMeta pide siempre order por slug y filtra por tenant`.
- [x] **Paso 2: correr y ver que fallan.** `npx vitest run tests/brain/wiki-store.test.ts` → FAIL (la consulta no usa `.range`).
- [x] **Paso 3: implementar.** Bucle `for (let from = 0; ; …)` con `.order("slug").range(from, from + 999)`; **avanza `from` por la cantidad de filas recibidas y corta cuando una respuesta viene vacía** (no por una página corta), según D9. Sigue el estilo del bucle de `listRulePages` en el mismo archivo.
- [x] **Paso 4: correr los tests del archivo y el resto de `tests/brain`.** `npx vitest run tests/brain` → PASS.
- [x] **Paso 5: commit.** `fix: listMeta pagina para no truncar brains de más de 1.000 páginas`.

### Task 2: Paginar `listLinks`

**Archivos:**
- Modificar: `lib/brain/core/wiki-store.ts` (método `listLinks`, ~líneas 203-211)
- Modificar y probar: `tests/brain/wiki-store.test.ts` (el `rpc` del cliente falso devuelve una promesa, no una cadena)

**Interfaces:**
- Consume: RPC `brain_page_links(p_tenant_id uuid)` sin cambios (no recibe offset ni límite).
- Produce: `listLinks(tenantId)` devuelve las filas de **todas** las páginas con links, paginando con `.rpc("brain_page_links", { p_tenant_id }).order("slug").range(from, to)` y la misma regla de corte de la Task 1.

- [x] **Paso 1: tests que fallan.** El `rpc` falso devuelve una cadena con `order` y `range`. Tests: `listLinks devuelve las filas de 2.500 páginas`, `listLinks sigue completo si el servidor corta en 500`, `listLinks normaliza igual que antes` (el test existente de la línea ~265 debe seguir pasando).
- [x] **Paso 2: correr y ver que fallan.** `npx vitest run tests/brain/wiki-store.test.ts` → FAIL.
- [x] **Paso 3: implementar.** Mismo bucle que la Task 1; actualizar el comentario que dice "PostgREST corta en 1000 filas" para explicar que ahora se pagina.
- [x] **Paso 4: correr `npx vitest run tests/brain` y `npm run typecheck`.** → PASS.
- [x] **Paso 5: commit.** `fix: listLinks pagina el RPC de links`.

### Task 3: Spike de rendimiento (descartable) y decisión

**Archivos:**
- Crear en una rama aparte `spike/grafo-rendimiento` (**no entra a `main`**): `app/spike-grafo/page.tsx` y un script `scripts/spike/seed-brain.mts` que siembra N páginas con links aleatorios en la base local.
- Modificar (esto sí entra al PR): la spec, sección D8/D9, con los números medidos y la decisión.

**Interfaces:**
- Produce: tres decisiones escritas en la spec: (a) si Sigma pasa la compuerta de D8 a 10.000 nodos; (b) el valor de `GRAPH_MAX_NODES` (tope N); (c) si el costo de paginar `brain_page_links` obliga a una migración con keyset (D9, D13).

- [x] **Paso 1: instalar en la rama del spike** `sigma graphology graphology-layout-forceatlas2` y armar la página con un grafo sintético de 1.000, 10.000 y 50.000 nodos (aristas ≈ 3× nodos, distribución con algunos hubs).
- [x] **Paso 2: medir en el navegador** (notebook de gama media, build de producción `npm run build && npm start`): cuadros por segundo en zoom y paneo, tiempo hasta ver los nodos, memoria. Medir también el tamaño del JSON del payload comprimido (se estima con la forma de `GraphPayload` de la Task 5).
- [x] **Paso 3: medir el costo del RPC.** Sembrar 10.000 páginas con cuerpo y links en la base local (`npm run db:start`, necesita Docker) y cronometrar `listLinks` completo (varias respuestas de 1.000). Si tarda más de 5 s, la decisión (c) es "migración con parámetros `p_after text, p_limit int`".
- [x] **Paso 4: escribir los resultados** en la spec (tabla con 1.000 / 10.000 / 50.000) y las tres decisiones. Si no pasa a 10.000: **frenar y volver a la spec** (se evalúa otra librería); no seguir con la Task 5.
- [x] **Paso 5 (condicional, solo si la decisión (c) es sí; no aplicó, sin migración en la 26.4a):** crear la migración `supabase/migrations/<timestamp>_brain_page_links_keyset.sql` con los parámetros nuevos (la función vieja sigue existiendo hasta que el código nuevo esté en producción), adaptar `listLinks` y sus tests. **Orden de despliegue: migración antes que el código** (como en la 26.1a).
- [x] **Paso 6: commit** de la spec (y de la migración si aplica). `docs: resultados del spike del grafo`.

**Resultado de la Task 3 (spec §2.1):** (a) Sigma pasa la compuerta a 10.000; (b) `GRAPH_MAX_NODES` = 20.000; (c) sin migración en la 26.4a, y la migración con keyset queda como decisión abierta para la 26.4b.

**Cierre de la entrega 26.4a:** commitear también la spec y este plan (`docs: spec y plan de la etapa 26.4`), abrir el PR y agregar la 26.4 al roadmap (`docs/producto/roadmap.md`, Etapa 26, siguiendo el formato de la 26.1–26.3; ese archivo tiene cambios locales de la 24.6: no mezclarlos). **Hecho:** spec, plan, entrada del roadmap y fila de `decisiones/README.md` están commiteados en la rama; falta abrir el PR.

---

## Entrega 26.4b · Grafo (PR 2)

### Task 3b: Migración keyset de `brain_page_links` (decisión (i) de la spec §2.1 (c))

Primera tarea de la 26.4b. La spec dejó la decisión (i)/(ii)/(iii) abierta para Matías; se ejecuta (i), la recomendada, como ruling del controlador (2026-10-20): la migración **se escribe en la rama pero no se aplica a ninguna base compartida ni a producción**, y es reversible hasta que Matías la apruebe. Antes de tocar SQL, cargar el skill `supabase-postgres-best-practices` (regla del repo).

**Archivos:**
- Crear: `supabase/migrations/20261028120000_brain_page_links_keyset.sql`
- Modificar: `lib/brain/core/wiki-store.ts` (`listLinks`, ~líneas 227-237 y el helper `fetchAllPages`, ~líneas 149-169)
- Probar: `tests/brain/wiki-store.test.ts`, `supabase/tests/39_brain_page_links.test.sql` (o un archivo pgTAP nuevo si es más limpio)
- Modificar: la spec §2.1 (c) y el roadmap (entrada 26.4), para dejar escrito que se ejecuta la salida (i) y qué falta.

**Interfaces:**
- Consume: la función actual `public.brain_page_links(p_tenant_id uuid)` (migración `20261027120000_brain_page_links.sql`, se conserva sin tocar) y `PAGE_SIZE`.
- Produce: `public.brain_page_links_after(p_tenant_id uuid, p_after text, p_limit int) returns table (slug text, links jsonb)`: las páginas del tenant con `slug > p_after` (`p_after` nulo o vacío = desde el principio) que tienen `[[` en el cuerpo, ordenadas por `slug`, **a lo sumo `p_limit`**, aplicando la extracción de wikilinks **solo a esas filas** (primero se acota y recién después se corre la regexp, para que el costo de cada llamada no dependa del tamaño del brain). Mismos permisos que la función vieja: se revoca a `public`, `anon` y `authenticated` y se concede a `service_role`; `language sql stable security invoker set search_path = ''`. La función vieja queda hasta que el código nuevo esté en producción (un retiro posterior es otra migración, fuera de esta tarea). `listLinks(tenantId)` sigue devolviendo `BrainPageLinks[]` y la misma normalización (`toLinks`).

- [x] **Paso 1: tests que fallan** (`tests/brain/wiki-store.test.ts`; el cliente falso ya tiene `maxRows` y ganchos): `listLinks llama brain_page_links_after con p_after nulo la primera vez y el último slug recibido después`; `listLinks devuelve las filas de 2.500 páginas`; `listLinks sigue completo si el servidor corta en 500`; `listLinks corta con una respuesta vacía`; `listLinks no repite slugs`; `listLinks propaga un error de la primera página y de una posterior`; y el test existente de normalización sigue verde.
- [x] **Paso 2: correr y ver que fallan.** `npx vitest run tests/brain/wiki-store.test.ts` → FAIL.
- [x] **Paso 3: migración y código.** Escribir la migración; cambiar `listLinks` a un bucle keyset (`p_after` = último slug de la respuesta anterior, `p_limit` = `PAGE_SIZE`, corte con respuesta vacía; helper privado hermano de `fetchAllPages`, sin duplicar su lógica de errores). Con keyset ya no hace falta el descarte de slugs repetidos en este camino.
- [x] **Paso 4: prueba en base.** Con Supabase local arriba, `npm run db:test` (hace `db reset` de la base local; esto es una base de desarrollo en la máquina de Matías) con un caso pgTAP: orden por slug, `p_limit`, `p_after`, solo páginas con links, y que `authenticated` no puede ejecutar la función. Medir el costo: sembrar 10.000 y 20.000 páginas con links en un tenant de prueba y cronometrar `listLinks` completo; **debe ser lineal** (la spec midió 4,25 s a 10.000 y 15 s a 20.000 con la función vieja). Borrar lo sembrado.
- [x] **Paso 5: docs.** En la spec §2.1 (c) y en el roadmap escribir: se ejecuta la salida (i); la migración está escrita y probada en local, **no aplicada**; orden de despliegue **migración antes que el código** (`npx supabase migration list` antes de `db push`, porque `db push` aplica todas las pendientes); los tiempos medidos antes y después. Si la función vieja ya no tiene usos en el código, anotarlo como retiro pendiente. *Revisión final de la 26.4b (ruling R20): el orden de despliegue ya no importa, porque `listLinks` cae a `brain_page_links` si la función nueva no existe; la vieja la usa ese fallback y se retiran juntos (Task 13, paso 4c).*
- [x] **Paso 6:** `npm run typecheck`, `npx vitest run tests/brain tests/docs`, `npm run docs:check`; **commit:** `feat: listLinks pagina por keyset con brain_page_links_after`.

### Task 4: Instalar dependencias

**Archivos:** `package.json`, `package-lock.json`.

- [x] **Paso 1:** `npm install sigma@4.0.3 graphology@0.26.0 graphology-layout-forceatlas2@0.10.1` (más los tipos que falten), fijando esas versiones exactas: son las que midió el spike (Sigma 4, no v3).
- [x] **Paso 2:** `npm run typecheck`.
- [x] **Paso 3: commit.** `feat: dependencias del grafo del brain`.

### Task 5: Payload del grafo (servidor)

**Archivos:**
- Crear: `lib/brain/core/graph.ts`
- Probar: `tests/brain/graph.test.ts`

**Interfaces:**
- Consume: `BrainPageMeta` (`lib/brain/core/types.ts`), `LinkIndex` y `OutgoingLink` (`lib/brain/core/links.ts`).
- Produce:
  ```ts
  export const GRAPH_STATUSES = ["activo", "borrador", "archivado"] as const;
  export const GRAPH_MAX_NODES: number; // valor fijado por la Task 3
  export type GraphNode = [slug: string, title: string, category: number, status: number, updatedAt: string, tags: number[]];
  export interface GraphPayload {
    categories: string[];            // distintas, ordenadas alfabéticamente
    tags: string[];                  // distintos, ordenados alfabéticamente
    nodes: GraphNode[];              // ordenados por slug; status = índice en GRAPH_STATUSES
    edges: Array<[number, number]>;  // pares sin orden, source < target, sin duplicados ni autoenlaces
    broken: Array<[target: string, sources: number[]]>; // un destino inexistente distinto, con los nodos que lo apuntan
    orphans: number[];               // índices de nodos de LinkIndex.orphans
    total: number;                   // páginas antes del tope
    truncated: boolean;
  }
  export function buildGraphPayload(pages: BrainPageMeta[], index: LinkIndex, options?: { maxNodes?: number }): GraphPayload;
  ```

- [x] **Paso 1: tests que fallan** (`tests/brain/graph.test.ts`): `cada nodo lleva título, categoría, estado, fecha y tags por índice`; `A→B y B→A dan una sola arista`; `un link repetido da una sola arista`; `un autoenlace no da arista`; `un link roto no da arista y queda en broken con sus orígenes`; `dos páginas que apuntan al mismo destino roto comparten una entrada`; `las archivadas siguen en nodos y aristas` (D14); `orphans coincide con LinkIndex.orphans`; `brain vacío`; `una sola página`; `con maxNodes se queda con las más conectadas, desempata por slug, remapea aristas, rotos y huérfanas y marca truncated y total`.
- [x] **Paso 2: correr y ver que fallan.** `npx vitest run tests/brain/graph.test.ts` → FAIL (módulo inexistente).
- [x] **Paso 3: implementar `buildGraphPayload`** a partir de `index.outgoing` (links con `broken: false`) y de `index.broken`. Sin imports de `@/`, `react` ni `next`.
- [x] **Paso 4:** `npx vitest run tests/brain/graph.test.ts tests/brain/boundary.test.ts` → PASS.
- [x] **Paso 5: commit.** `feat: payload compacto del grafo del brain`.

### Task 6: Lógica pura del cliente (tamaño, color, filtros, vecindario)

**Archivos:**
- Crear: `lib/brain/core/graph-view.ts`
- Probar: `tests/brain/graph-view.test.ts`

**Interfaces:**
- Consume: `GraphPayload` y `GraphNode` de la Task 5.
- Produce:
  ```ts
  export function degrees(payload: Pick<GraphPayload, "nodes" | "edges">): number[];            // vecinos distintos por nodo; fijo (D14)
  export function nodeSize(degree: number, maxDegree: number, range?: { min: number; max: number }): number; // raíz cuadrada entre min y max (por defecto 3 y 18); maxDegree 0 → min
  export function categoryColors(base: string[], count: number): string[];                       // base[i % base.length]; cada vuelta alterna aclarar/oscurecer
  export function seedPosition(slug: string): { x: number; y: number };                          // determinista desde el slug (D11)
  export function neighborhood(edges: Array<[number, number]>, nodeCount: number, start: number, hops: 1 | 2 | 3): Set<number>;
  export interface GraphFilters { categories: Set<number> | null; statuses: Set<number>; tags: Set<number> | null; onlyOrphans: boolean; local: { node: number; hops: 1 | 2 | 3 } | null }
  export function visibleNodes(payload: GraphPayload, filters: GraphFilters): Set<number>;
  export function matchesText(node: GraphNode, query: string): boolean;                           // sin distinguir mayúsculas ni acentos; título o slug
  export function formatEditDate(iso: string): string;                                            // "20 oct 2026", es-AR, zona America/Argentina/Buenos_Aires
  ```

- [x] **Paso 1: tests que fallan.** `degrees cuenta vecinos distintos`; `nodeSize: grado 0 da el mínimo, el máximo grado da el máximo, es monótona, y un hub de 100 contra una hoja de 1 se ve claramente más grande pero acotado`; `nodeSize con maxDegree 0 da el mínimo`; `categoryColors repite sin colisión exacta cuando hay más categorías que colores`; `seedPosition es estable y distinta entre slugs`; `neighborhood a 1, 2 y 3 saltos`; `neighborhood de un nodo aislado es él solo`; `visibleNodes: categorías, estados, tags (al menos uno), huérfanas y vecindario se combinan con Y`; `matchesText ignora tildes y mayúsculas ("Politica" encuentra "Política de ventas")`; `formatEditDate` con `toMatch(/^20 oct\.? 2026$/)` para `2026-10-20T12:00:00Z` (la variación del punto depende del ICU).
- [x] **Paso 2: correr y ver que fallan.** `npx vitest run tests/brain/graph-view.test.ts` → FAIL.
- [x] **Paso 3: implementar** las funciones. `categoryColors` recibe colores ya resueltos como `#rrggbb` o `rgb(...)`: la resolución desde tokens CSS vive en la Task 8.
- [x] **Paso 4:** `npx vitest run tests/brain/graph-view.test.ts tests/brain/boundary.test.ts` → PASS. Verificar con `tests/brain/client-safe.ts` que `graph-view.ts` no arrastra `node:*` (agregar un test que lo asserte con el mismo helper que ya usan los otros módulos de cliente).
- [x] **Paso 5: commit.** `feat: lógica pura del grafo (tamaño, color, filtros, vecindario)`.

### Task 7: Route handler de datos

**Archivos:**
- Crear: `app/[tenant]/brain/mapa/datos/route.ts`
- Probar: `tests/brain/graph-route.test.ts`

**Interfaces:**
- Consume: `loadEditorContext`, `loadBrainMeta`, `loadBrainLinkIndex` (`lib/brain/adapters/editor.ts`), `buildGraphPayload` y `GRAPH_MAX_NODES` (Task 5).
- Produce: `GET /[tenant]/brain/mapa/datos` → `200` con el `GraphPayload` en JSON y `cache-control: private, no-store`; `404` si no hay contexto o el contexto no es `ok`. Cualquier otro error se relanza (como `raw/[...slug]/route.ts`).

- [x] **Paso 1: tests que fallan** (patrón de `tests/brain/raw-route.test.ts`): `404 sin contexto`; `404 si el contexto es no-brain o external`; `200 con el payload y cache-control private, no-store`; `relanza los errores del proveedor`; y el test de permisos del foco 5: con el arnés de `tests/brain/editor-access-chain.test.ts` y una persona sin acceso a una carpeta, ningún slug de esa carpeta aparece en el texto de la respuesta (ni en nodos, ni en aristas, ni en rotos).
- [x] **Paso 2: correr y ver que fallan.** `npx vitest run tests/brain/graph-route.test.ts` → FAIL.
- [x] **Paso 3: implementar el handler.** `Promise.all` de `loadBrainMeta` y `loadBrainLinkIndex`, `buildGraphPayload(pages, index, { maxNodes: GRAPH_MAX_NODES })` (`GRAPH_MAX_NODES` = 20.000, spec §2.1 b), `Response.json`.
- [x] **Paso 4:** `npx vitest run tests/brain` y `npm run typecheck` → PASS.
- [x] **Paso 5: commit.** `feat: endpoint de datos del grafo del brain`.

### Task 8: Componente del grafo (Sigma) con color y tamaño

**Archivos:**
- Crear: `components/brain/graph/brain-graph.tsx` (`"use client"`), `components/brain/graph/graph-theme.ts`
- Sin test unitario: el entorno de Vitest es `node` y Sigma necesita WebGL. La verificación es en el navegador (Paso 5).

**Interfaces:**
- Consume: `GraphPayload` (Task 5); `degrees`, `nodeSize`, `categoryColors`, `seedPosition` (Task 6); el endpoint de la Task 7.
- Produce: `export function BrainGraph(props: { tenantSlug: string }): JSX.Element` que ocupa el alto y ancho de su contenedor; y en `graph-theme.ts`: `readGraphTheme(): { palette: string[]; edge: string; label: string; ghost: string; background: string }`, que resuelve los tokens `--graph-1…8` (ruling R16: no `--chart-*`, ver spec D5), `--border`, `--foreground`, `--destructive` y `--background` a `rgb(...)` (dibujando en un canvas de 1×1 y leyendo el píxel, porque los tokens pueden ser `oklch` y Sigma no los entiende) y se vuelve a leer cuando cambia la clase `dark` de `<html>` (`MutationObserver`).

- [x] **Paso 1: cargar y mostrar.** Pedir `/${tenantSlug}/brain/mapa/datos`; estados D16: cargando, brain sin páginas ("Todavía no hay páginas"), error o 404 ("No pudimos cargar el mapa" con botón "Reintentar").
- [x] **Paso 2: armar el `Graph`** de graphology (no dirigido, sin multi-aristas), con posición inicial de `seedPosition`, `size` de `nodeSize(degree, maxDegree)` y color de `categoryColors(palette, categories.length)`; las archivadas atenuadas.
- [x] **Paso 3: layout** con ForceAtlas2 en worker, `barnesHutOptimize` cuando hay más de ~2.000 nodos, detenido tras un tiempo acotado (el que haya validado el spike) y **pausado cuando la persona interactúa** (zoom, paneo, clic): con la CPU 4× más lenta el layout bajó a 13 fps mientras corre (spec §2.1 a).
- [x] **Paso 4: Sigma** con zoom y paneo, etiquetas solo en los nodos grandes a poco zoom, y `import` dinámico (`next/dynamic`, `ssr: false`) desde donde se monte.
- [x] **Paso 5: verificar en el navegador** contra la base local: grafo visible, un hub claramente más grande que una hoja, colores por categoría en claro y oscuro, sin errores en consola. `npm run typecheck` y `npm run lint:fix` (revertir los 4 archivos ajenos).
- [x] **Paso 6: commit.** `feat: grafo del brain con Sigma (color y tamaño por conexiones)`.

### Task 9: Popover y resaltado al pasar el mouse

**Archivos:**
- Crear: `components/brain/graph/graph-popover.tsx`
- Modificar: `components/brain/graph/brain-graph.tsx`

**Interfaces:**
- Consume: `pageHref` (`lib/brain/core/editor/slug.ts`), `formatEditDate` (Task 6), eventos `clickNode`, `clickStage` y `enterNode`/`leaveNode` de Sigma, `sigma.graphToViewport`.
- Produce: `GraphPopover(props: { title: string; updatedAt: string; href: string; anchor: () => { x: number; y: number } | null; subscribe: (onFrame: () => void) => () => void; onClose: () => void })`: tarjeta absoluta (`role="dialog"`) anclada a la posición del nodo en pantalla. `anchor` da el punto del nodo en el contenedor (null si el nodo ya no existe y el popover se cierra) y `subscribe` registra una función que corre después de cada cuadro (`sigma.on("afterRender")`): el popover se reposiciona por ref, sin re-render por cuadro. Muestra **título, fecha de última edición y botón "Ver página"** (D6); se cierra con Esc, clic afuera o clic en el fondo, y sigue al nodo mientras se mueve la cámara. No usa un Popover de Radix (no existe en `components/ui` y anclar a un punto de canvas no lo justifica): usa los tokens `bg-popover` y `text-popover-foreground`.

- [x] **Paso 1:** cablear `clickNode` → abrir; `clickStage` y Esc → cerrar; `camera "updated"` → reposicionar. *Se reposiciona con `afterRender`, que cubre cámara y layout (ver la interfaz).*
- [x] **Paso 2:** hover resalta el nodo y sus vecinos y atenúa el resto (`nodeReducer` / `edgeReducer` + `sigma.refresh()`). *Se hizo con el estado `isHighlighted` de Sigma 4 y reglas de estilo, no con reducers (ver Task 11).*
- [x] **Paso 3: verificar en el navegador:** clic en un nodo muestra título y fecha correctos; "Ver página" navega a `/${tenant}/brain/p/<slug>`; Esc y clic afuera cierran; con un título largo y con tildes no se rompe la tarjeta (foco 4). `npm run typecheck`.
- [x] **Paso 4: commit.** `feat: popover de nodo y resaltado de vecinos en el grafo`.

### Task 10: Selector Grafo | Lista y pantalla completa

**Archivos:**
- Modificar: `app/[tenant]/brain/mapa/page.tsx` (recibe `searchParams`; el botón de `app/[tenant]/brain/page.tsx:147` no cambia)
- Crear: `components/brain/graph/mapa-vista.tsx` (`"use client"`)

**Interfaces:**
- Consume: `BrainGraph` (Task 8).
- Produce: `MapaVista(props: { tenantSlug: string; vista?: "grafo" | "lista" })`: renderiza el grafo en una capa `fixed inset-0 z-50 bg-background` con barra superior propia ("← Brain", selector Grafo/Lista y, luego, los filtros), **solo** si `vista === "grafo"` o si `vista` es `undefined` y `matchMedia("(min-width: 768px)")` da verdadero (D1, D2). La página sigue renderizando la lista en el servidor como base, con un enlace "Ver grafo" (`?vista=grafo`) en su encabezado; la barra del grafo tiene "Lista" (`?vista=lista`).

- [x] **Paso 1:** `page.tsx` lee `searchParams` (Promise, Next 16), normaliza `vista` a `"grafo" | "lista" | undefined` (cualquier otro valor es `undefined`) y monta `<MapaVista>` sobre la lista actual, que no cambia.
- [x] **Paso 2: verificar en el navegador** a 1280 px (el grafo abre a pantalla completa y tapa el árbol), a 375 px (entra la lista sin salto y "Ver grafo" abre el grafo), y con `?vista=lista` en escritorio (queda la lista). `npm run typecheck`.
- [x] **Paso 3: commit.** `feat: el mapa de conexiones abre el grafo a pantalla completa`.

**Cierre de la entrega 26.4b:** `npm test` completo, PR 2.

---

## Entrega 26.4c · Filtros y cierre (PR 3)

### Task 11: Barra de filtros, buscador y nodos fantasma

**Archivos:**
- Crear: `components/brain/graph/graph-toolbar.tsx`
- Modificar: `components/brain/graph/brain-graph.tsx`, `components/brain/graph/mapa-vista.tsx`

**Interfaces:**
- Consume: `GraphFilters`, `visibleNodes`, `matchesText` (Task 6); `GraphPayload.broken` (Task 5); `readGraphTheme().ghost` (Task 8).
- Produce: estado de filtros del grafo, compartido entre la barra y el componente, con: categorías (varias; la leyenda de colores es clickeable y filtra), estados (activo y borrador prendidos, archivado apagado), tags, "Huérfanas", "Links rotos" (apagado) y un buscador de texto. Los filtros ocultan con estados y reglas de estilo de Sigma 4 (por ejemplo, el estado `isHidden` con `setNodesState` / `setEdgesState`, o una regla `when` / `whenState` que lleve `visibility: "hidden"`), o con `setNodeAttribute` / `setSetting`, sin reconstruir el grafo. **No con `nodeReducer` / `edgeReducer`:** en Sigma 4.0.3 cualquier reducer apaga el refresco en el lugar (`refreshNodeState`) que usa el resaltado del hover y copia el objeto de cada nodo en cada actualización, también mientras corre el layout; el texto **resalta** las coincidencias, centra la cámara en la primera y abre su popover (D12). Con archivadas ocultas se ocultan también sus aristas. "Links rotos" agrega un nodo fantasma por destino distinto (D15): tamaño mínimo, color `ghost`, popover con el nombre tal como está escrito y "Esta página no existe", sin fecha y sin botón.

**Pendientes que vienen de la revisión final de la 26.4b:**
- Precalcular un índice plegado (título y slug sin tildes ni mayúsculas, una vez por payload) para `matchesText`: hoy normaliza en cada llamada, unas 40.000 normalizaciones por tecla a 20.000 nodos.
- Confirmar en `node_modules/sigma` el nombre real del estado de Sigma 4 para ocultar (en lugar de dar por hecho `isHidden`) o resolverlo con una regla `when` que lleve `visibility: "hidden"`.
- Texto de los nodos fantasma cuyo destino es una página oculta para la persona: `broken[].target` es lo que escribió una página visible (ruling R15), así que "Esta página no existe" puede ser falso; definir el texto.
- Archivadas: ocultas por defecto (D7); revisar que el filtro arranque así y que se oculten también sus aristas.
- Tema claro: la arista con `--border` queda muy tenue sobre blanco; revisarla en el QA.

- [ ] **Paso 1:** cablear la barra con `visibleNodes` y estados de Sigma (sin reducers); el tamaño de los nodos **no cambia** al filtrar (grado fijo, D14).
- [ ] **Paso 2:** buscador y fantasmas, con el popover del fantasma.
- [ ] **Paso 3: verificar en el navegador:** cada filtro responde sin recargar; "Huérfanas" muestra las mismas páginas que la lista; con el tenant de prueba más grande, la barra no tapa el grafo a 375 px (en celular el grafo es opcional, pero no debe romperse). `npm run typecheck`.
- [ ] **Paso 4: commit.** `feat: filtros, buscador y links rotos en el grafo`.

### Task 12: Vista local

**Archivos:** `components/brain/graph/graph-toolbar.tsx`, `components/brain/graph/brain-graph.tsx`.

**Interfaces:**
- Consume: `neighborhood` y `GraphFilters.local` (Task 6).
- Produce: con un nodo seleccionado, la barra ofrece "Vecindario" con 1, 2 o 3 saltos (el popover no cambia, D7); activa `filters.local`; un botón "Ver todo" la quita y vuelve a encuadrar la cámara. Oculta lo que queda afuera igual que los filtros de la Task 11: con estados y reglas de estilo de Sigma 4, no con reducers.

- [ ] **Paso 1:** implementar y verificar en el navegador con un brain de prueba de al menos ~1.000 páginas (sembrado como en la Task 3): al activar 2 saltos solo quedan el nodo y sus vecinos; combinar con un filtro de categoría respeta ambos.
- [ ] **Paso 2: commit.** `feat: vista local del grafo (vecindario a N saltos)`.

### Task 13: QA, documentación y cierre de la etapa

**Archivos:**
- Modificar: `docs/dominios/brain.md`, `docs/producto/roadmap.md` (entrega 26.4), `docs/_meta/cobertura.ts` solo si hace falta una exclusión con motivo.
- Regenerar: `npm run docs:sync` (`docs/referencia/` no se edita a mano).

- [ ] **Paso 1: QA completo en el navegador** (base local, 1.001 y ~10.000 páginas sembradas): los siete criterios del §1 de la spec; escritorio y 375 px; claro y oscuro; consola sin errores; el brain real de `innovas` en producción cuando se despliegue.
- [ ] **Paso 2: documentar** en `docs/dominios/brain.md` el mapa como grafo, el endpoint, el tope `GRAPH_MAX_NODES`, la paginación y el límite de 1.000 filas de PostgREST.
- [ ] **Paso 3:** `npm run docs:sync` y `npm run docs:check` → verde. La ruta nueva `/[tenant]/brain/mapa/datos` pide página o exclusión con motivo: la salida normal es la página, no la exclusión.
- [ ] **Paso 4:** `/docs-wiki` en verde (una etapa no se cierra sin eso). Marcar la 26.4 en el roadmap con su estado real y los pendientes (confirmar `max_rows` de producción, primera mirada del brain real).
- [ ] **Paso 4b: chequeos de producción pendientes** (no se pudieron correr desde las sesiones de la 26.4b): `select tenant_id, count(*) from brain_pages group by 1 order by 2 desc limit 5` en producción, con el resultado en el roadmap; y confirmar el límite de 4,5 MB de Vercel con una respuesta real de `/mapa/datos` en un deploy de preview.
- [ ] **Paso 4c: retiro de `brain_page_links` y del fallback**, cuando Matías haya aplicado `20261028120000_brain_page_links_keyset.sql` en producción: una migración que borre `brain_page_links(p_tenant_id)` y, en el mismo cambio, sacar el fallback de `listLinks` y sus tests.
- [ ] **Paso 5:** `npm test`, `npm run typecheck`, `npm run lint:fix` (revertir los 4 archivos ajenos). **Commit:** `docs: cierre de la etapa 26.4`.

---

## Autorrevisión contra la spec

- **§1 criterios 1–7:** 1 y 2 (Tasks 8, 10), 3 (Task 9), 4 (Task 11), 5 (Task 7), 6 (Tasks 1–3 y 12), 7 (Task 13).
- **D1–D2:** Task 10. **D3:** Tasks 3, 4 y 8. **D4–D5:** Tasks 6 y 8. **D6:** Task 9. **D7:** Tasks 6, 9, 11 y 12. **D8:** Task 3 (vara) y Task 5 (tope). **D9:** Tasks 1–3. **D10:** Tasks 5 y 7. **D11:** Tasks 6 y 8. **D12:** Tasks 10 y 11. **D13:** Task 3, paso 5. **D14:** Tasks 5, 6 y 11. **D15:** Task 11. **D16:** Task 8.
- **Tipos consistentes:** `GraphPayload`/`GraphNode` se definen en la Task 5 y las Tasks 6–11 los consumen con esos nombres; `GraphFilters` se define en la Task 6 y se usa en la 11 y la 12.
- **Pendientes que no son de código:** confirmar el `max_rows` de producción, y que Matías decida aplicar la migración keyset (el código anda sin ella por el fallback de `listLinks`; ver Task 13, pasos 4b y 4c).
