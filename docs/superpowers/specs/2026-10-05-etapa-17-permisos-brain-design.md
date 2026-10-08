# Etapa 17 · Permisos del brain por carpeta y por página — diseño

**Fecha:** 2026-10-05
**Etapa:** 17 (nueva en el roadmap). Tres entregas: 17.1 aislamiento, 17.2 permisos, 17.3 árbol y compartir.
**Base:** `2026-09-13-brain-design.md` (modelo de datos y contrato), `2026-09-24-etapa-11-brain-mcp-design.md` (endpoint MCP, D4 y D5), `2026-09-27-editor-brain-design.md` (pantallas del editor). Este documento reemplaza D4 de la Etapa 11 y la regla `canEdit = rol ≠ tenant_member` del editor.

## 1. Objetivo y criterio de cierre

Que un administrador del tenant decida **quién ve y quién edita cada carpeta y cada página del brain**, con herencia hacia abajo, igual que los permisos por carpeta de Google Drive; que esa decisión valga en todas las superficies (editor web, endpoint MCP, agente en el chat); y que el módulo del brain quede aislado para poder mudarlo a su propio repo sin reescribirlo.

Pedido de Matías: por MCP, todos los usuarios tienen las tres tools (búsqueda, lectura, escritura) del lado de Claude, Cowork o Codex; el acceso real lo gobierna la configuración del brain. Si alguien no tiene lectura sobre una carpeta, directamente no la ve. Navegación de archivos estilo Obsidian, con el menú de tres puntos en cada carpeta para configurar los accesos desde ahí. El mismo modelo tiene que servir más adelante para tools MCP y agentes.

**Terminado cuando**, en producción, en el tenant `innovas`:

1. Un `tenant_admin` restringe una carpeta desde el diálogo de compartir y le da lectura a una sola persona.
2. Esa persona ve la carpeta en el árbol y la encuentra con `brain_search` por MCP; otro `tenant_member` no la ve en el árbol, `brain_search` no la devuelve y `brain_read` responde `not_found`.
3. Ese otro miembro, chateando con el agente, no consigue que el agente le cuente el contenido de la carpeta.
4. Una consulta directa a `brain_pages` con la sesión de un miembro no devuelve filas (test pgTAP).
5. `tests/brain/boundary.test.ts` pasa: nada en `lib/brain/core` importa de afuera del módulo.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| A1 | Tres niveles: **lector**, **editor**, **administrador** | Drive tiene cuatro; "comentarista" no tiene equivalente porque el brain no tiene comentarios. Administrador es quien comparte |
| A2 | **En el chat, el agente actúa en nombre de la persona.** Las tools `brain_*` de la sesión se filtran con los permisos de quien la inició. En corridas desatendidas el agente usa su propia declaración, como hoy | Sin esto, cualquier miembro extrae por el chat lo que no puede leer directo |
| A3 | **La raíz nace abierta:** `todos los miembros → lector`. Para cerrar, un administrador restringe una carpeta | El día del despliegue nadie pierde nada. Es el comportamiento de una unidad compartida de Drive |
| A4 | **Un solo punto de control en código**, `withAccess`, que envuelve el `BrainProvider`. Se **revoca el `select` de `authenticated`** sobre `brain_pages` y `brain_revisions` | Hoy un miembro con sesión puede leer toda la tabla por la API de Supabase, saltando la app. Una regla en SQL y otra en TypeScript serían dos implementaciones de la misma herencia; MCP, agente y canon corren con `service_role` y necesitan la de código igual |
| A5 | Las carpetas **no son filas**. Una carpeta es el prefijo de las páginas que tiene debajo; existe si hay al menos una página o una regla propia bajo ese prefijo | Sin tabla de carpetas, sin renombres, sin huérfanas. El slug ya lleva el camino |
| A6 | Una regla sobre `comercial/icp` aplica a la página con ese slug **y** a todo lo que cuelgue de `comercial/icp/` | Página y carpeta del mismo nombre comparten reglas. Evita dos espacios de nombres para una misma ruta |
| A7 | Las reglas por persona **se acumulan hacia abajo y no se quitan abajo** | Mismo criterio que Drive. Lo que restringe es el acceso general del nodo, no la ausencia de una regla por persona |
| A8 | Lo invisible responde **`not_found`**, nunca `forbidden` | No se confirma que existe. `forbidden` queda para lo visible sin permiso de edición |
| A9 | `platform_admin` y `tenant_admin` son administradores de todo sin mirar reglas | Como el administrador de Drive. Los permisos finos aplican a `tenant_member` |
| A10 | Principales: **persona** y **todos los miembros del tenant** ("acceso general"). Agente, plataforma e import ven todo | Grupos, agentes y tools con permisos propios son extensión del mismo tipo `Principal` (§9), no parte de esta etapa |
| A11 | `lib/brain` se parte en `core/` y `adapters/`, con un test que vigila la frontera | Mudarlo de repo es llevarse `core/` y reescribir `adapters/` |
| A12 | Sin mails ni notificaciones al compartir. Sin "copiar vínculo" | No hay casilla de notificación en el diálogo. El vínculo es la URL de la página, ya visible en el navegador |
| A13 | El índice de `/brain` deja de agrupar por categoría y pasa a reflejar el árbol. La `category` sigue existiendo como metadato y filtro | El árbol es la navegación principal; dos agrupaciones distintas en la misma pantalla confunden |

## 3. Modelo de permisos

### 3.1 Nodos y rutas

Un **nodo** es una ruta del brain. La raíz es la ruta vacía `""`. Cualquier otra ruta cumple `SLUG_PATTERN` (`comercial`, `comercial/outreach`, `comercial/icp`). La ruta de una página es su slug; la carpeta de una página es su slug sin el último segmento.

### 3.2 Reglas

Cada nodo puede tener:

- **Reglas por persona**: `user_id → nivel`, con nivel `lector`, `editor` o `administrador`.
- **Acceso general**: una regla para el principal `members` con nivel `lector`, `editor` o `ninguno` (restringido). Sin fila, hereda.

### 3.3 Resolución

`resolveAccess(rules, principal, path): Level | null` donde `Level = "lector" | "editor" | "administrador"`:

1. Principal `platform`, `agent`, `import`, o persona con rol `platform_admin` o `tenant_admin`: `administrador`.
2. Para una persona `tenant_member`, se consideran los nodos ancestros de `path` más `path` mismo, de la raíz hacia abajo:
   - **Por persona:** el máximo nivel entre todas las reglas `user` de la persona en esos nodos.
   - **General:** la regla `members` del nodo más profundo que tenga una; `ninguno` da `null`. Si ningún nodo la tiene, vale la de la raíz, que existe siempre (§4.3).
3. Efectivo: el máximo entre los dos. Orden: `administrador > editor > lector > null`.

Tabla de casos que fija el comportamiento (y los tests):

| Reglas | Persona | Ruta | Efectivo |
|---|---|---|---|
| raíz `members: lector` | miembro sin reglas | `comercial/icp` | lector |
| raíz `members: lector`; `direccion` `members: ninguno` | miembro sin reglas | `direccion/presupuesto` | null |
| ídem más `direccion` `user cecilia: lector` | cecilia | `direccion/presupuesto` | lector |
| ídem | cecilia | `direccion` | lector |
| raíz `user marcos: editor`; `direccion` `members: ninguno` | marcos | `direccion/presupuesto` | editor (A7) |
| raíz `members: lector`; `comercial` `members: editor` | miembro | `comercial/icp` | editor |
| raíz `members: lector`; `comercial` `members: editor`; `comercial/interno` `members: ninguno` | miembro | `comercial/interno/notas` | null |
| raíz `members: ninguno`; `comercial/icp` `user cecilia: lector` | cecilia | `comercial/icp` | lector |
| ídem | cecilia | `comercial` | null |
| cualquiera | tenant_admin | cualquiera | administrador |

### 3.4 Qué habilita cada nivel

| Nivel | Buscar y leer | Crear y actualizar páginas bajo el nodo | Cambiar reglas del nodo y de lo que cuelga |
|---|---|---|---|
| lector | sí | no | no |
| editor | sí | sí | no |
| administrador | sí | sí | sí |

Nadie borra páginas (spec brain B8). Archivar es un upsert, así que exige editor.

### 3.5 Visibilidad del árbol

`visibleTree(pages, rules, principal): TreeNode` devuelve carpetas y páginas:

- Una página es visible si `resolveAccess(page.slug) ≠ null`.
- Una carpeta es visible si tiene al menos una página visible debajo (a cualquier profundidad). Si la persona solo ve `direccion/presupuesto-2027`, ve la carpeta `direccion` con esa única página.
- Las archivadas siguen la misma regla; el filtro por estado es de la pantalla, no del acceso.

### 3.6 Funciones puras

En `lib/brain/core/access/`:

```ts
type Level = "lector" | "editor" | "administrador";

type Principal =
  | { kind: "user"; userId: string; role: "platform_admin" | "tenant_admin" | "tenant_member" }
  | { kind: "agent"; agent: string }
  | { kind: "platform" }
  | { kind: "import" };

interface AccessRule {
  path: string;                       // "" para la raíz
  principal: "user" | "members";
  userId: string | null;              // solo para "user"
  level: Level | "ninguno";           // "ninguno" solo para "members"
}

function resolveAccess(rules: AccessRule[], principal: Principal, path: string): Level | null;
function parentPath(path: string): string | null;   // "comercial/icp" → "comercial" → "" → null
function visibleTree(pages: TreePage[], rules: AccessRule[], principal: Principal): TreeNode;
function explainAccess(rules: AccessRule[], path: string): NodeAccessView;  // para el diálogo (§7.3)
```

Sin dependencias. Tests de tabla con los casos de §3.3 más: rutas inválidas rechazadas, raíz sin regla `members` tratada como `lector` (defensa si la fila faltara), regla `user` con `level: "ninguno"` rechazada al validar.

## 4. Base de datos

Antes de escribir SQL: cargar `supabase-postgres-best-practices`. Esta migración es **del módulo**: viaja con él si se muda (§8.4).

### 4.1 `brain_access_rules`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `tenant_id` | uuid not null → `tenants` on delete cascade | |
| `path` | text not null | `check (path = '' or (char_length(path) <= 200 and path ~ SLUG_PATTERN))` |
| `principal` | `brain_access_principal` not null | enum `user`, `members` |
| `user_id` | uuid → `auth.users` on delete cascade | `check ((principal = 'user') = (user_id is not null))` |
| `level` | `brain_access_level` not null | enum `lector`, `editor`, `administrador`, `ninguno`. `check (principal = 'members' or level <> 'ninguno')` |
| `created_by` | uuid → `auth.users` on delete set null | |
| `created_at`, `updated_at` | timestamptz not null default `now()` | |

- Único `(tenant_id, path, principal, user_id)` con `nulls not distinct`, para que haya una sola fila `members` por nodo.
- Índice `(tenant_id, path)`.
- RLS habilitada **sin políticas** y `revoke all ... from anon, authenticated`: se lee y escribe solo con `service_role`, desde el servidor, después de `resolveAccess` en código.
- Al borrar una `membership` (o cambiarle el tenant o la persona), las reglas `user` de esa persona en ese tenant se borran. **Cambio del 2026-10-10:** lo hace el trigger `memberships_brain_rules_cleanup` en la base (migración `20261010120000`), no la server action, y deja un `brain.access_changed` por regla; la versión original dependía de la server action, no cubría otros caminos y dejaba huérfanas que *reaparecían* al reinvitar a la persona (no hay FK a `memberships` porque la clave es `(tenant_id, user_id)` y la membership puede recrearse).

### 4.2 Cierre del agujero de lectura

```sql
revoke select on public.brain_pages from authenticated;
revoke select on public.brain_revisions from authenticated;
drop policy brain_pages_select on public.brain_pages;
drop policy brain_revisions_select on public.brain_revisions;
```

Las tablas quedan con RLS habilitada y sin políticas. El editor web, que hoy lee con el cliente de sesión, pasa a leer con el cliente admin a través del store (§5). Test pgTAP nuevo: con la sesión de un miembro, `select count(*) from brain_pages` falla por permiso, y lo mismo con `brain_revisions` y `brain_access_rules`.

### 4.3 Semilla de la raíz

La migración inserta `('' , 'members', null, 'lector')` para cada tenant con binding `brain` habilitado. `resolveBrainBinding` no la crea en runtime: si un tenant nuevo recibe binding después, la regla la escribe el mismo script que da de alta el binding (`scripts/connections-bind.mts`) y `resolveAccess` igual trata la ausencia como `lector` (§3.6), así que un olvido no cierra el brain.

### 4.4 Evento

Cada cambio de reglas deja en `events` un `brain.access_changed` con `payload: { path, principal, user_id, level, action: "set" | "remove" }` y `actor_user_id`. `events` es append-only; no se toca.

## 5. Un solo punto de control: `withAccess`

`lib/brain/core/access/with-access.ts`:

```ts
function withAccess(provider: BrainProvider, principal: Principal, rules: AccessRule[]): BrainProvider
```

| Operación | Comportamiento |
|---|---|
| `search` | Llama al proveedor de abajo con `limit` multiplicado (hasta el máximo de 20 que admite `brain_search_pages`), filtra lo que `resolveAccess` da `null`, recorta al `limit` pedido. Si el proveedor devolvió el máximo y después del filtro faltan resultados, se acepta el recorte: no se pagina. Con pocas páginas visibles para una persona muy restringida, la búsqueda puede devolver menos de lo que existe; es un límite conocido y aceptado para esta etapa |
| `read` | `resolveAccess(slug) === null` → `BrainNotFound` **sin sugerencias**. Si el proveedor de abajo tira `BrainNotFound` con sugerencias, se filtran las invisibles |
| `upsert` | Actualizar (`baseRevision` presente): invisible → `BrainNotFound`; visible sin `editor` → `BrainForbidden`. Crear (`baseRevision` ausente): exige `editor` sobre la carpeta destino (`parentPath(slug)`); si no, `BrainForbidden`. Nunca se revela si el slug existe cuando la carpeta es invisible: en ese caso también `BrainForbidden` |
| `list` (nuevo, §5.1) | Devuelve solo páginas visibles |

Los principales `agent`, `platform` e `import` devuelven el proveedor sin envolver (siempre `administrador`), para que el envoltorio no cueste nada donde no filtra.

### 5.1 `list` en el contrato

`BrainProvider` suma `list(): Promise<BrainPageRow[]>` (todas las páginas del tenant, con cuerpo, ordenadas por slug). Es lo que hoy hace `loadBrainPages` con el cliente de sesión. El proveedor `wiki` lo implementa con el store; el proveedor `mcp` tira `BrainUnsupported` (el editor ya muestra "se edita en su origen" para ese caso). No entra en el contrato de tools (`contract.ts`): es para el editor, no para el modelo.

### 5.2 Superficies

| Superficie | Principal | Qué cambia |
|---|---|---|
| Editor web (`app/[tenant]/brain/*`) | `{ kind: "user", userId, role }` de la sesión | `loadEditorContext` arma el provider envuelto y expone `access(path)`; `canEdit` pasa a ser por nodo. `loadBrainPages` y `loadRevisions` leen por el store con el cliente admin. Las vistas, edición e historial de una página invisible dan 404 |
| Endpoint MCP (`lib/brain/core/mcp-server`) | la persona del token | `buildBrainMcpServer` registra las tres tools siempre; `access: "read" \| "read_write"` desaparece de `McpAccess`. El envoltorio decide. Un miembro que llama `brain_upsert` sin editor recibe `{ ok: false, error: "forbidden" }`, como cualquier error del brain |
| Agente en el chat (`createBrainTools`) | la persona que inició la sesión (`toolCtx.session.auth.initiator`) | `createBrainTools(binding, access, { principal })`: cada `execute` obtiene el provider y lo envuelve con las reglas del tenant, que se cargan en el `execute` (el closure solo lleva JSON). La aprobación de `brain_upsert` no cambia |
| Agente desatendido (schedules, workflows, `lib/outreach/canon.ts`) | `{ kind: "agent" }` | Sin cambios funcionales |
| Import | `{ kind: "import" }` | Sin cambios |

La declaración `tenant_agents.config.brain` sigue decidiendo si el agente tiene tools del brain (D11 de la Etapa 11). El principal de la persona se aplica encima.

### 5.3 Carga de reglas

`AccessRulesStore` (interfaz en `core`, implementación en `adapters`):

```ts
interface AccessRulesStore {
  load(tenantId: string): Promise<AccessRule[]>;
  set(tenantId: string, rule: AccessRule, actorUserId: string): Promise<void>;     // upsert por clave única
  remove(tenantId: string, path: string, principal: "user" | "members", userId: string | null, actorUserId: string): Promise<void>;
}
```

Se cargan **todas** las reglas del tenant por operación (una consulta, cientos de filas como mucho). Sin caché en esta etapa: un cambio en el diálogo vale en la siguiente llamada. En el editor web se envuelve en `cache()` de React por request, como el resto de `load.ts`.

## 6. Aislamiento de `lib/brain`

### 6.1 Estructura

```
lib/brain/
├── core/                     ← sin imports fuera de lib/brain/core, salvo zod y @modelcontextprotocol/sdk
│   ├── types.ts, contract.ts, errors.ts, limits.ts, config.ts, mcp-config.ts
│   ├── wiki.ts, wiki-store.ts (interfaz WikiStore + implementación sobre un SupabaseClient inyectado)
│   ├── resolve.ts (recibe `load` por parámetro, como hoy)
│   ├── access/ (resolve-access.ts, tree.ts, with-access.ts, explain.ts)
│   ├── links.ts, wikilinks.ts, diff.ts
│   ├── editor/ (save.ts, slug.ts, markdown-links.ts, load-context.ts con deps por parámetro)
│   ├── mcp-server/ (access.ts, handler.ts, server.ts, rate-limit.ts)
│   └── import/ (document.ts, manifest.ts, plan.ts)
└── adapters/                 ← la única carpeta que importa de @/lib/... y de next
    ├── supabase.ts           ← WikiStore, AccessRulesStore, HitFn, ClaimsVerifier, AccessStore con createAdminClient
    ├── platform.ts           ← binding (loadTenantBindings), tenant y rol (resolveTenantAccess), PeopleDirectory (loadPeople)
    ├── provider.ts           ← getBrainProvider(binding) (hoy lib/brain/provider.ts)
    ├── agent-access.ts       ← loadAgentBrainAccess (hoy lib/brain/agent-access.ts)
    ├── tools.ts              ← createBrainTools con eve (defineTool, always); eve es de la plataforma, no del módulo
    └── editor.ts             ← loadEditorContext, loadBrainPages, loadRevisions cableados con cache() de React
```

`wiki-store.ts` ya recibe el `SupabaseClient` por parámetro y el tipo `SupabaseClient` es de `@supabase/supabase-js`, un paquete, no una dependencia de la plataforma: queda en `core`. `tools.ts` depende de eve y de la política de aprobación con roles: queda en `adapters`; `approval.ts` (la decisión pura sobre `responder`) queda en `core`.

Los consumidores de afuera (`app/[tenant]/brain/*`, `app/brain/[tenant]/mcp/route.ts`, `agents/outreach/tools/brain.ts`, `lib/outreach/canon.ts`, `scripts/*`) importan **solo de `lib/brain/adapters`** o de los tipos de `core`.

### 6.2 Test de frontera

`tests/brain/boundary.test.ts` recorre `lib/brain/core/**` y falla si algún import resuelve fuera de `lib/brain/core`, con la lista blanca `zod`, `@modelcontextprotocol/sdk/*`, `@supabase/supabase-js` (solo tipos). Mismo patrón que `tests/agents/running-tool.test.ts`: compara contra el disco.

### 6.3 Qué se mueve y qué no

La entrega 17.1 es un refactor **sin cambio funcional**: mover archivos, invertir las dependencias que faltan (`editor/load.ts`, `provider.ts`, `agent-access.ts`, `tools.ts`, `mcp-server/supabase.ts`), sumar `list()` y pasar el editor a leer por el provider. Los tests existentes se mueven con los archivos y siguen pasando. `git mv` para conservar historia.

### 6.4 Lo que viaja con el módulo

Documentado en `lib/brain/README.md` (nuevo, corto): las migraciones `20260913233557_brain_tables`, `20260913234426_brain_upsert_page`, `20260913235330_brain_search_pages`, `20260924100200_brain_mcp_usage` y la de esta etapa; los tests pgTAP del brain; y las interfaces que un host tiene que implementar (`WikiStore`, `AccessRulesStore`, `AccessStore`, `ClaimsVerifier`, `HitFn`, `PeopleDirectory`).

## 7. Pantallas

Todo bajo `app/[tenant]/brain/`, con `layout.tsx` nuevo que monta el árbol. Estilo shadcn con la marca del tenant.

### 7.1 Árbol

- Panel izquierdo de 260 px en escritorio; en mobile, un `Sheet` que abre un botón "Archivos" arriba del contenido.
- Carpetas plegables con chevron; páginas como hojas con su título (el slug en `title` del elemento). La página actual resaltada. Archivadas atenuadas, ocultas por defecto, con un interruptor "Mostrar archivadas" al pie del árbol.
- Estado de plegado en `localStorage` por tenant (`brain-tree:<slug>`), en `try/catch`; por defecto, abierto hasta el primer nivel.
- El árbol lo arma `visibleTree` en el servidor; el plegado es cliente.
- Botón "Nueva página" arriba del árbol, visible si la persona es editor de la raíz.

### 7.2 Menú de tres puntos

`DropdownMenu` que aparece al pasar o enfocar la fila (siempre visible en mobile):

| Nodo | Ítems | Condición |
|---|---|---|
| Carpeta | Nueva página acá | editor del nodo |
| Carpeta | Compartir… | administrador del nodo |
| Página | Editar · Historial | editor / lector |
| Página | Compartir… | administrador del nodo |

"Nueva página acá" abre `/brain/nueva?en=<ruta>` con el slug precargado con ese prefijo.

### 7.3 Diálogo de compartir

`Dialog` con título `Compartir "<nombre>"` (último segmento de la ruta; `Brain` para la raíz):

1. **Agregar personas**: combobox con los miembros del tenant que no tienen regla propia en el nodo (nombre y correo, por `PeopleDirectory`), y un selector de nivel. Al elegir, se guarda al momento.
2. **Personas que tienen acceso**:
   - Los `tenant_admin` del tenant, fijos, con "Administrador" sin selector.
   - Reglas propias del nodo: nombre, correo, selector de nivel, botón quitar.
   - Reglas heredadas: atenuadas, con "heredado de <carpeta>" y link a esa carpeta (abre el diálogo ahí). No se editan acá (A7).
3. **Acceso general**: selector con `Heredar (lector)` o `Heredar (editor)` o `Heredar (restringido)`, mostrando entre paréntesis lo que hereda; `Restringido`; `Todos los miembros: Lector`; `Todos los miembros: Editor`. En la raíz no existe "Heredar".

`explainAccess(rules, path)` arma la vista: reglas propias, heredadas con su origen, y el acceso general efectivo con su origen. Pura, testeada.

### 7.4 Acciones

Server actions en `app/[tenant]/brain/access-actions.ts`, con `zod` en el borde:

- `grantAccess(tenantSlug, path, userId, level)`
- `revokeAccess(tenantSlug, path, userId)`
- `setGeneralAccess(tenantSlug, path, level | "ninguno" | "inherit")` (`inherit` borra la fila `members`; en la raíz se rechaza)

Cada una: resuelve la sesión, exige `resolveAccess(path) === "administrador"`, verifica que `userId` tenga membership en el tenant, escribe por `AccessRulesStore`, deja el evento (§4.4) y revalida `/brain`. Un `tenant_member` administrador de un nodo no puede quitar ni bajar su propia regla: se rechaza con mensaje, para que no se deje afuera por error. Si hace falta, lo hace un admin del tenant.

### 7.5 Índice y resto de pantallas

- `/brain`: buscador, filtro por estado y chips de tags quedan. Los resultados se listan planos con su ruta; sin consulta, muestra las páginas de primer nivel y las carpetas, que llevan al árbol. El mapa de conexiones no cambia salvo que solo cuenta páginas visibles.
- `/brain/p/[...slug]`, `/brain/editar/[...slug]`, `/brain/historial/[...slug]`: 404 si la ruta es invisible; "Editar" solo con editor; los paneles de enlaces omiten destinos invisibles.
- `/brain/nueva`: el selector de carpeta destino solo ofrece carpetas donde la persona es editor.

## 8. Entregas

Una sesión y un PR por entrega. Cada una termina con `npm run typecheck`, `npm test`, `npm run db:test` y `/ship`.

### 17.1 · Aislamiento

§6 completo. Sin cambio visible. Terminado cuando el test de frontera pasa, los tests existentes pasan sin cambiar su contenido (solo su ubicación) y `/brain` en producción se ve igual.

### 17.2 · Permisos

§3, §4, §5 completos. Terminado cuando los criterios 2, 3 y 4 de §1 se cumplen con reglas cargadas por SQL (todavía sin diálogo), y un miembro ve `brain_upsert` por MCP desde Claude Code y recibe `forbidden` al escribir donde no es editor.

**Producción:** `db push` aplica todas las migraciones pendientes; antes se corre `migration list` y se confirma lo ajeno.

### 17.3 · Árbol y compartir

§7 completo. Terminado cuando el criterio 1 de §1 se cumple desde la UI, en escritorio y a 375 px.

## 9. Pendiente, fuera de esta etapa

- **Agentes y tools MCP como principales con permisos propios.** `Principal` suma `{ kind: "agent", agent }` con reglas, y `tenant_agents.config.brain` se reemplaza por reglas en `brain_access_rules`. El diálogo suma una pestaña "Agentes". Después, lo mismo para quién puede usar cada agente y cada tool.
- **Grupos** de personas como principal.
- **Búsqueda paginada** para personas con muy pocas páginas visibles (límite de §5).
- **Caché de reglas** si la consulta por operación pesa.
- **Renombrar y mover** páginas y carpetas desde el árbol (E7 del editor sigue vigente).
- **Grafo visual** (E2 del editor).
