---
title: Brain
category: dominios
status: activo
tags: [brain, wiki, mcp, permisos, editor, canon]
updated: 2026-10-15
sources:
  - lib/brain/README.md
  - lib/brain/core
  - lib/brain/adapters
  - tests/brain/boundary.test.ts
  - scripts/brain-import.mts
  - app/[tenant]/brain
  - app/brain/[tenant]/mcp/route.ts
  - lib/outreach/canon.ts
  - lib/outreach/marco-reflect.ts
  - lib/brain/core/skills
  - lib/brain/core/skills/catalog.ts
  - lib/brain/core/skills/skill-md.ts
  - app/[tenant]/brain/skills/package/route.ts
  - lib/brain/adapters/mcp-production.ts
  - lib/brain/adapters/skill-zip.ts
  - lib/brain/adapters/skills.ts
  - lib/brain/core/skills/package-link.ts
  - lib/brain/adapters/skill-packages.ts
  - app/[tenant]/conectar/skills-section.tsx
  - supabase/migrations/20261022120000_skill_packages_bucket.sql
  - supabase/migrations/20261020120000_brain_skills.sql
  - supabase/migrations/20261026120000_platform_enable_brain_skills.sql
  - docs/superpowers/specs/2026-09-13-brain-design.md
  - docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md
  - docs/superpowers/specs/2026-09-27-editor-brain-design.md
  - docs/superpowers/specs/2026-10-05-etapa-17-permisos-brain-design.md
  - docs/superpowers/specs/2026-10-08-etapa-18-1-borrado-paginas-brain-design.md
  - docs/superpowers/specs/2026-10-08-etapa-18-2-editor-visual-brain-design.md
  - docs/superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md
  - docs/superpowers/plans/2026-10-10-etapa-21-3a-brain-como-fuente.md
  - docs/superpowers/specs/2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md
  - docs/superpowers/plans/2026-10-11-etapa-24-1-skills-paquete-publicacion.md
  - docs/superpowers/specs/2026-10-13-etapa-24-2a-skills-por-mcp-design.md
  - docs/superpowers/plans/2026-10-13-etapa-24-2a-skills-por-mcp.md
  - docs/superpowers/specs/2026-10-14-etapa-24-2b-paquete-por-mcp-design.md
  - docs/superpowers/specs/2026-10-15-etapa-24-5-editar-skills-por-mcp-design.md
  - docs/superpowers/plans/2026-10-15-etapa-24-5-editar-skills-por-mcp.md
  - docs/superpowers/specs/2026-10-14-etapa-26-carpetas-y-reglas-brain-design.md
  - docs/superpowers/plans/2026-10-14-etapa-26-1a-carpetas.md
  - lib/brain/core/folders.ts
  - lib/brain/core/skills/draft.ts
  - lib/brain/core/folders-report.ts
  - scripts/brain-folders-report.mts
  - supabase/migrations/20261025120000_brain_folders.sql
---

# Brain

## 1. Qué es y para qué

El brain es la base de conocimiento de cada cliente: páginas en markdown con revisiones, que los agentes consultan y actualizan, que las personas editan desde la plataforma y que Claude o ChatGPT pueden leer y escribir por MCP. Ahí vive el **canon** de un tenant: ICP, mensajes, voz, hooks, objeciones, producto. Es el brain **del producto**, uno por tenant (`lib/brain`). No es gbrain, el brain del coding agent que se instala con `/setup-gbrain` y `/sync-gbrain`; no se mezclan.

Un tenant tiene como máximo un brain habilitado (índice único parcial en `tenant_connections`). Puede ser de dos proveedores:

| Proveedor | Qué es | Editor web |
|---|---|---|
| `wiki` | Páginas en Supabase (`brain_pages`, `brain_revisions`). `authKind: "none"` | Sí |
| `mcp` | Un servidor MCP remoto que habla nuestro mismo contrato (`brain_search`, `brain_read`, `brain_upsert`). La llave está en Vercel Connect | No: muestra un aviso |

Para la regla general de tenancy ver [tenancy](../arquitectura/tenancy.md). Cómo conectar Claude o ChatGPT al endpoint está en [conectar el brain por MCP](../guias/conectar-brain-por-mcp.md); cómo lo usa un agente, en [agentes eve](agentes-eve.md) y [outreach](outreach.md).

## 2. Dónde vive en el código

El módulo está pensado para mudarse a su propio repo, por eso se divide en `core` y `adapters`. El detalle de interfaces y de lo que viaja con el módulo está en [lib/brain/README.md](../../lib/brain/README.md): esta página lo resume y no lo copia.

| Ruta | Qué hay |
|---|---|
| `lib/brain/core/` | Todo el módulo, sin dependencias de la plataforma |
| `lib/brain/core/wiki.ts`, `wiki-store.ts` | Proveedor `wiki`: valida contra el binding, arma el autor y traduce errores de la base |
| `lib/brain/core/mcp.ts`, `mcp-config.ts` | Proveedor `mcp`: cliente de un brain remoto |
| `lib/brain/core/contract.ts` | Contrato de las tres tools; lo comparten el agente y el endpoint MCP |
| `lib/brain/core/access/` | Permisos: `resolveAccess`, `withAccess`, `manage`, `tree`, `explain`, lectura de reglas |
| `lib/brain/core/editor/` | Lógica del editor: guardado, slug, entrada por permiso, borrado, autocompletado de `[[` |
| `lib/brain/core/mcp-server/` | Endpoint MCP: acceso, handler, servidor, límites por minuto |
| `lib/brain/core/import/` | Núcleo puro del import de una bóveda de markdown |
| `lib/brain/core/skills/` | Skills de empresa: reglas del paquete, estados, qué ve cada uno (`withoutSkills`, `withSkillView`), publicar, archivos e importación |
| `lib/brain/core/skills/catalog.ts`, `skill-md.ts` | Catálogo de skills publicadas para el MCP y armado del `SKILL.md` del zip |
| `lib/brain/adapters/skill-zip.ts`, `skills.ts` | Lector y escritor de zip, Storage de archivos y armado de dependencias de las skills |
| `lib/brain/core/folders.ts`, `folders-store.ts` | Carpetas: tipos, `categoryForPath`, validación de rutas, rutas reservadas y el contrato del almacén |
| `lib/brain/core/editor/folders.ts`, `adapters/folders.ts` | Crear, describir y borrar carpetas (permisos incluidos) y su cableado a Supabase y a las server actions |
| `lib/brain/core/folders-report.ts` | Reporte en seco de la migración de carpetas |
| `lib/brain/core/rules.ts`, `rules-source.ts` | Páginas reservadas, cascada de reglas (`rulesFor`), topes de tamaño, fuente de reglas (`RulesSource`), `requireRules` y `seesBrain` |
| `lib/brain/core/session.ts` | Bloque de arranque (`formatBrainSession`): instrucciones de la raíz y carpetas |
| `lib/brain/core/rules-report.ts` | Reporte en seco de las páginas reservadas |
| `lib/brain/adapters/rules.ts`, `adapters/session-instructions.ts` | Cableado de la fuente de reglas a Supabase y bloque de arranque del chat (`brainSessionInstructions`) |
| `lib/agents/eve/brain-instructions.ts` | Instrucciones dinámicas de eve: suma el bloque de arranque en `session.started` |
| `lib/brain/core/config.ts` | Lectura y validación de la config del binding |
| `lib/brain/adapters/` | Lo que toca la plataforma: Supabase admin, sesión, eve, Next, reflejo del canon |
| `app/[tenant]/brain/` | Pantallas y server actions del brain |
| `app/brain/[tenant]/mcp/route.ts` | Endpoint MCP |
| `components/brain/` | Árbol, diálogo de compartir, diálogo de borrado, editor Tiptap (`components/brain/editor/`, fuera de `core`) |
| `scripts/brain-import.mts` | CLI del import |
| `lib/outreach/canon.ts`, `canon-blocks.ts`, `marco-reflect.ts` | Cómo el outreach lee el canon del brain |

### Pantallas y rutas

| Ruta | Qué muestra |
|---|---|
| `/[tenant]/brain` | Índice con árbol de carpetas, búsqueda y filtros; `?carpeta=<ruta>` entra a una carpeta |
| `/[tenant]/brain/p/[...slug]` | La página. Abre en edición para quien es `editor` o más; el resto ve la hoja de lectura |
| `/[tenant]/brain/nueva` | Alta de página (mismo espacio de trabajo; `?en=` precarga una carpeta donde podés escribir) |
| `/[tenant]/brain/editar/[...slug]` | Redirige de forma permanente a `/brain/p/<slug>` (quedó por los links viejos) |
| `/[tenant]/brain/historial/[...slug]` | Revisiones con autor, diff y restaurar |
| `/[tenant]/brain/mapa` | Páginas más enlazadas, huérfanas y links rotos |
| `/[tenant]/brain/raw/[...slug]` | Cuerpo vigente en texto plano, para el diff del aviso de conflicto |
| `/[tenant]/brain/skills/files` | Archivos de una skill: `GET` los sirve (texto plano o descarga), `POST` sube un archivo o importa un zip |
| `/[tenant]/brain/skills/package` | `GET ?slug=skills/...`: zip de la versión publicada de una skill (descarga) |
| `/brain/[tenant]/mcp` | Endpoint MCP del brain |
| `/.well-known/oauth-protected-resource/brain/[tenant]/mcp` | Metadata OAuth del recurso (RFC 9728) |

## 3. Cómo funciona

### Páginas y revisiones

- `brain_pages` guarda la página vigente: `slug` (ruta en minúsculas con guiones, hasta 200 caracteres, única por tenant), `title`, `category`, `status` (`activo`, `borrador`, `archivado`), `tags`, `frontmatter`, `body` (hasta 200 KiB) y `revision`.
- `brain_revisions` es **append-only**: cada escritura deja una revisión nueva con autor (`user`, `agent` o `import`), quién aprobó, sesión y motivo obligatorio.
- El único camino de escritura es la función SQL `brain_upsert_page`, con control de concurrencia optimista: para actualizar hay que pasar `baseRevision`; sin ella solo se crean páginas nuevas. Un desfase devuelve conflicto (`BR409`). Los otros códigos son `BR404` y `BR422`. La función ejecuta solo `service_role`.
- Los miembros no leen las tablas por la API de Supabase: desde la 17.2 se revocó el `select` de `authenticated` sobre `brain_pages` y `brain_revisions`. Todo pasa por el proveedor, con el cliente admin y el tenant que resuelve la app.
- Las categorías válidas son las carpetas de primer nivel del tenant (ver [Carpetas](#carpetas-etapa-261a)); la base valida el formato (`^[a-z][a-z0-9-]{0,40}$`, hasta 20).
- Una página se retira con `status: archivado`. Ni el agente ni el MCP pueden borrar.

### Búsqueda

`brain_search_pages` es full-text en español sin acentos (`tsvector` generado sobre título, peso A, y cuerpo, peso B). Filtra por categoría y tag, oculta archivadas salvo `includeArchived`, y devuelve hasta 20 resultados con fragmento. Siempre va acotada al tenant que pasa el servidor; `authenticated` no la ejecuta. Un brain `mcp` delega la búsqueda al servidor remoto.

### Editor y editor visual

- La página abre en edición por permiso (`entryMode`: `hidden`, `read`, `edit`). Lo oculto da 404.
- El editor es Tiptap 3 con `@tiptap/markdown` y vive **fuera de `core`**. El markdown sigue siendo la fuente de verdad: `chooseBodyToSave` compara lo que serializa el editor con lo que serializaba el original al cargar, y si es igual guarda el cuerpo original sin tocarlo. El nodo `WikiLink` conserva el texto exacto de `[[slug|alias]]`; el HTML crudo nunca se interpreta (nodo `RawHtml`).
- El guardado es explícito. El motivo es opcional desde la web (vacío se registra como "Edición desde la web"); para el agente y el MCP sigue siendo obligatorio.
- Un conflicto de revisión muestra el diff y ofrece reintentar sobre la revisión vigente.
- Solo el proveedor `wiki` tiene editor.

### Borrado con limpieza de links

- Lo hace únicamente `core/editor/delete.ts` (`previewDelete`, `deletePage`), desde la web y para quien es `administrador` del nodo. No pasa por `BrainProvider` ni por el contrato: el agente y el MCP no tienen cómo borrar. Un brain `mcp` responde `unsupported`.
- El servidor arma el plan de limpieza: `[[destino|alias]]` pasa a `alias`; `[[destino]]` y `[[destino#ancla]]` pasan al título. Lo que está en bloques de código no se toca. El cliente manda solo `slug` y `expectedRevision`.
- La función SQL `brain_delete_page` (solo `service_role`) reescribe las páginas que enlazan, borra la página (las revisiones caen por la clave foránea), quita las reglas de acceso de esa ruta solo si no queda ninguna página debajo y deja el evento `brain.page_deleted` en `events`, todo en una transacción. Las limpiezas viajan ordenadas por slug para evitar deadlocks (`40P01` se trata como conflicto).
- Se limpian **todas** las páginas que enlazan, las vea o no quien borra; el diálogo nombra solo las visibles y cuenta las ocultas.
- No hay papelera ni deshacer.

### Permisos por carpeta y página

Resumen; la referencia completa está en el [README del módulo](../../lib/brain/README.md).

- Tres niveles: `lector`, `editor`, `administrador`. Las reglas viven en `brain_access_rules` (RLS sin políticas: solo `service_role`) y son de dos tipos: por persona y "acceso general" (`members`) por carpeta. Un `path` vacío es la raíz. Hay herencia hacia abajo como en Drive: lo dado arriba no se quita abajo; el acceso general lo decide la carpeta más profunda que tenga regla.
- Un único punto de control, `withAccess(proveedor, principal, reglas)`, lo aplican el editor web, el endpoint MCP y el agente del chat. Administradores del tenant, agente desatendido, plataforma e import no pasan por las reglas.
- Lo oculto responde "no encontrado", igual que lo inexistente. "Sin permiso" solo para lo visible sin escritura. Si las reglas no cargan, la operación falla: **falla cerrada**, nunca "sin reglas".
- Cambiar reglas solo se hace por `core/access/manage.ts`, que exige administrador del nodo y evita la autoexclusión (`lockout`). Escribe por las funciones SQL `brain_set_access_rule` y `brain_remove_access_rule`, que dejan el evento `brain.access_changed` en la misma transacción. Las server actions son `app/[tenant]/brain/access-actions.ts`.
- Las reglas por persona se van con la membresía: el trigger `memberships_brain_rules_cleanup` sobre `memberships` borra las reglas del usuario en ese tenant y deja un evento por cada una; reinvitar a alguien no las revive. El acceso general no se toca.
- El agente en el chat actúa con los permisos de quien inició la sesión (`acting-provider.ts`). Un workflow o schedule, sin persona, conserva la declaración del agente.
- El árbol que llega al navegador no lleva cuerpos ni reglas, solo estructura y qué se puede hacer (`visibleTree`).

### El brain servido por MCP

Cada tenant con brain `wiki` expone `/brain/[tenant]/mcp` (stateless, `@modelcontextprotocol/sdk`) con las tres tools del contrato. El acceso lo resuelve `core/mcp-server/access.ts` a partir del **token y la URL**, nunca de argumentos de la tool: el token tiene que traer `client_id` (lo emite el servidor OAuth 2.1 de Supabase, con consentimiento en `/oauth/consent`), la persona tiene que tener membresía en ese tenant y el método de login tiene que estar permitido. Un `platform_admin` solo cuenta como plataforma si su fila es del tenant dueño (`PLATFORM_OWNER_TENANT_SLUG`); sin esa variable nadie entra como plataforma. Quien no tiene acceso recibe 403 antes de saber si el tenant existe.

- Límites por usuario y tenant: 60 lecturas y 10 escrituras por minuto por defecto (`mcpLimits` en el binding). El contador está en la tabla `brain_mcp_usage`, que escribe la función `brain_mcp_hit`.
- Pedidos de más de 1 MiB se cortan con 413. Un error interno devuelve un 500 con id, sin detalle.
- `PUBLIC_APP_URL` arma las URL públicas del recurso en la metadata OAuth.
- Un miembro sin `editor` que llama `brain_upsert` recibe `forbidden`.
- Un token del emisor OAuth lleva el rol `oauth_client` (sin permisos en Postgres) gracias al Custom Access Token Hook de la migración `20260925120000_oauth_client_role_hook`.

### Agentes

`tenant_agents.config.brain` declara el acceso de cada agente (`none`, `read`, `read_write`); sin declaración no hay tools `brain_*`. En eve los agentes de chat (`outreach` y `asistente`) las reciben por la tool dinámica `brain` (`agents/<agente>/tools/brain.ts`, que monta `brainTools` de `lib/agents/eve/`). `brain_upsert` siempre pide aprobación y solo la acepta un `tenant_admin` o `platform_admin` **del mismo tenant** (`core/approval.ts`). Un tenant sin binding `brain` no ve ninguna tool `brain_*`.

### Import

`npm run brain:import -- --tenant <slug> --from "<carpeta>"` importa una bóveda de markdown (por ejemplo, de Obsidian). **Dry-run por defecto**; con `--apply` escribe. Un manifiesto (`brain-import.json` del tenant) fija qué entra (`include`/`exclude`) y qué tags de canon recibe cada ruta. Es idempotente: guarda `source_path`, `source_hash` y `source_revision` en `brain_pages`, y si alguien editó la página en la plataforma (la revisión cambió), el import no la pisa.

### Categorías y canon

- Las categorías son las carpetas de primer nivel de la empresa (`brain_folders`; por ejemplo `empresa`, `producto`, `comercial`, `operacion` como valores de ejemplo). `config.categories` del binding es un reflejo: lo mantiene la función SQL `brain_sync_categories` y nadie lo edita a mano. La categoría de una página sale de su ruta (`categoryForPath` en `core/folders.ts`: el primer segmento, con `skills` → `skill`).
- El **canon** son páginas con tags `canon:icp`, `canon:mensajes`, `canon:voz`, `canon:hooks` y `canon:objeciones`. Ningún nodo ni workflow escribe páginas `canon:*` sin aprobación humana (ver [orquestación](../arquitectura/orquestacion.md)).

### Carpetas (etapa 26.1a)

- **Tabla `brain_folders`** (`tenant_id`, `path`, `description`, `created_by`): una fila por carpeta, de cualquier nivel. Tiene RLS activado y sin grants para `anon` ni `authenticated`: solo el servidor la lee y escribe, y lo que ve cada persona lo decide `withAccess`. El árbol y el índice muestran también las carpetas vacías.
- **Funciones SQL** (migración `20261025120000_brain_folders`): `brain_category_for` (la categoría de una ruta), `brain_sync_categories` (refleja los primeros niveles en `config.categories`), `brain_ensure_folders` y `brain_folders_from_config` (el backfill de la migración), `brain_create_folder`, `brain_set_folder_description` y `brain_delete_folder`. Crear, describir y borrar dejan evento (`brain.folder_created`, `brain.folder_described`, `brain.folder_deleted`). La categoría de una página la calcula el proveedor `wiki` (`createWikiProvider`, con `categoryForPath`) antes de escribir; `brain_upsert_page` solo crea, con `brain_ensure_folders`, las carpetas que falten del camino de una página nueva. Crear o borrar una de primer nivel bloquea primero la fila del binding del tenant (`tenant_connections ... for update`), así dos administradores a la vez no pasan juntos el tope de 20 ni borran juntos las dos últimas; `brain_sync_categories` además deduplica.
- **Permisos** (`core/editor/folders.ts`): para crear una carpeta hay que ser `administrador` del padre (para una de primer nivel, de la raíz); para describirla, de la propia carpeta, también si es de primer nivel; para borrarla, de la propia carpeta, salvo las de primer nivel, que piden administrador de la raíz. Solo se borran carpetas vacías y nunca la última de primer nivel. El menú del árbol muestra lo mismo: una carpeta implícita (con páginas pero sin fila en `brain_folders`) no ofrece acciones de carpeta, y "Borrar carpeta" en una de primer nivel aparece solo para quien administra la raíz.
- **Errores:** una página nueva cuya carpeta padre (de segundo nivel o más) no existe se rechaza con un `BrainValidation` de código `validation` y `fields: ["folder"]`, con un mensaje que nombra la carpeta más cercana (lo chequea el proveedor `wiki` en `core/wiki.ts`, salvo en el import); una página nueva en una carpeta de primer nivel que no está en `config.categories` (salvo `skills/`), también con `fields: ["folder"]` y el mensaje "No existe la carpeta <carpeta>. Pedile a un administrador que la cree." (desde la 26.2b; antes era `fields: ["category"]` con el mensaje genérico, y lo sigue siendo para una edición y para el import). El MCP y las tools del agente devuelven ese mismo `fields` y `message`; una página nueva en la raíz, sin `/`, con código `validation` y `fields: ["slug"]`. No hay códigos `folder_not_found` ni `folder_required`. En cambio la base **crea las carpetas que falten** del camino de una página nueva, así que "toda página tiene su carpeta" lo garantiza ella y el import sigue andando.
- **El import y las de primer nivel:** `brain-import` escribe por el proveedor, y `validateWrite` exige que la categoría (el primer segmento) ya esté en `config.categories`. Por eso el import crea subcarpetas bajo categorías que existen, pero **no crea una carpeta de primer nivel nueva**; eso solo pasa llamando `brain_upsert_page` directo por SQL (como el backfill).
- **Rutas reservadas de primer nivel** (`RESERVED_TOP_FOLDERS` en `core/folders.ts` y `brain_create_folder`): `skills` (solo existe si el brain ya tenía la categoría `skill`, o si plataforma la habilitó con `platform_enable_brain_skills` desde `/plataforma/<slug>`: es el único camino para una empresa que no la tenía), `skill` (es la categoría de `skills/`: una carpeta `skill` la duplicaría en `config.categories` y el brain dejaría de resolverse) y `brain` (instrucciones de la raíz, 26.2) no se crean desde el árbol. `brain_ensure_folders` también rechaza `skill/`, así que una página nueva bajo `skill/` falla con `reserved_path`. Borrar: la base solo se niega a borrar `skills`; `brain`, si existe y está vacía, se borra como cualquier otra.
- **Reporte en seco:** `npm run brain:folders-report` (`core/folders-report.ts`, `scripts/brain-folders-report.mts`) corre antes de la migración y no escribe nada. Sin `--tenant` recorre todas las empresas, que es como hay que correrlo antes de `db push`, porque el backfill corre para todas y un bloqueante en cualquiera aborta la migración; `-- --tenant <slug>` mira una sola. Lista las categorías nuevas que se agregarían, los slugs bajo `brain/` y los de `skills/` sin la categoría `skill`. Sale con código 2 si hay **bloqueantes**: slugs con `/` cuyo primer segmento no cumple `^[a-z][a-z0-9-]{0,40}$` (empieza con un número o pasa de 41 caracteres) o es `skill`, y entradas inválidas en `config.categories`. Con un bloqueante el backfill de la migración abortaría (con `check_violation`, o con `reserved_path` para `skill/`): la migración es transaccional y se deshace sin perder datos, pero el deploy queda frenado hasta que una persona renombre esas páginas. El reporte **nunca se corrió contra una base real**; hay que correrlo a mano, con el env de producción, antes de `db push`.

### Instrucciones y reglas (etapa 26.2a)

- **Páginas reservadas:** `00-reglas` (instrucciones y reglas) y `00-plantilla` (reservada para la 26.3, todavía sin uso) en la raíz y en cada carpeta (`RESERVED_LEAVES` en `core/types.ts`). La `00-reglas` de la raíz se guarda con la categoría `brain`. Topes de una `00-reglas` activa: 12 000 caracteres la de la raíz, 20 000 la de una carpeta y 40 000 la suma de la cascada que aplica a cualquier carpeta (`checkRulesWrite`, que corre en el proveedor `wiki`). Pasarse es un error `validation` con `fields: ["body"]` (no hay un código `rules_too_large`).
- **Cascada (`rulesFor` en `core/rules.ts`):** la raíz primero y después cada carpeta hasta la de la página; entran solo las `00-reglas` en estado `activo`. Una `00-reglas` no se gobierna a sí misma (`governingFolders` le saca su propia carpeta). La `revision` de la cascada son 16 caracteres hex del sha256 de `slug:revision` de cada entrada; sin cadena es `""`. `fields` y `template` van vacíos hasta la 26.3.
- **Por dónde llegan:**
  - Al arrancar: en el MCP, como `instructions` del servidor (el endpoint es stateless y `instructions` solo viaja en la respuesta a `initialize`, así que el bloque se arma solo en ese pedido y no en cada `tools/call`); en el chat, en `session.started` (`brainSessionInstructions`, montado por `brainInstructions` de `lib/agents/eve/brain-instructions.ts` en `agents/asistente/instructions/brain.ts` y `agents/outreach/instructions/brain.ts`). El bloque (`formatBrainSession`) trae la `00-reglas` de la raíz y la tabla de carpetas de primer nivel (sin `skills`) que la persona ve.
  - `brain_read` suma `rules` (`withoutRoot`: la cascada sin la raíz, que ya llegó al arrancar, con la `revision` de la cascada completa).
  - `brain_rules` (tool nueva, en el MCP y en las tools de lectura del agente) devuelve la cascada completa de una ruta, aunque la página no exista.
  - `brain_upsert` rechaza con `rules_required`, un código propio que lleva `rules` (la cascada con su `revision`). En el MCP cuenta como lectura en `brain_mcp_usage`, no como escritura.
- **Quién exige `rulesRevision`:** el MCP y las tools del agente de chat (`requireRules` en `core/rules-source.ts`, en `brain_upsert`). El editor web, el import y los seeds escriben por el proveedor sin pasar por ahí y no la piden. Si la ruta no tiene cadena, `brain_upsert` escribe con o sin `rulesRevision` y un valor espurio se ignora; con cadena, sin el valor o con uno viejo no se escribe nada. Un brain `mcp` externo no tiene reglas propias (`EMPTY_RULES`).
- **Permisos:**
  - Escribir una reservada exige `administrador` de su carpeta (de la raíz, para la de la raíz); si no, `reserved_slug` (código propio), que se chequea en `withAccess` después de verificar `editor`, para no contarle a quien no puede escribir ahí que es una página de reglas. Los administradores del tenant, el import y la plataforma no pasan por `withAccess`.
  - El agente del chat nunca escribe una reservada: `brain_upsert` responde `reserved_slug` antes de armar el proveedor.
  - Las reglas se filtran por la **ruta pedida**, no por la `00-reglas` (`withRulesAccess`): una `00-reglas` que la persona no puede leer igual le llega si gobierna una ruta que ve. Una ruta que no ve da `not_found` en `brain_rules` y `forbidden` al crear (nunca `rules_required` con el cuerpo de las reglas).
  - Las reglas de `skills/` no salen por las tools del brain, como las skills (`withoutSkillRules` en el MCP y en las tools del agente, también para un administrador o el agente sin persona): `brain_rules` y `brain_read` sobre `skills/...` dan `not_found`, y `brain_upsert` sobre `skills/...` rechaza con el `forbidden` de skills (`rejectSkillWrite`) antes de pedir reglas. No va en `createWikiRules`: un panel web puede querer las reglas de una skill.
  - Las instrucciones de la raíz le llegan solo a quien ve alguna parte del brain (`seesBrain`): en el MCP el bloque siempre lleva la línea que anuncia el canal de reglas, pero sin la raíz si la persona no ve nada; en el chat devuelve `null`.
- **Reporte en seco:** `npm run brain:rules-report` (`core/rules-report.ts`, `scripts/brain-rules-report.mts`) solo hace SELECT. Sin `--tenant` recorre todas las empresas con brain `wiki`; `-- --tenant <slug>` mira una. Lista las páginas reservadas que ya existen, las carpetas que van a empezar a pedir `rulesRevision` y, como ATENCIÓN, las que pasan su tope, las cascadas de más de 40 000 caracteres y las páginas que cuelgan de una reservada (nada de eso bloquea el deploy). Sale con código 0 aunque haya hallazgos y con 1 solo si no puede leer los datos (faltan variables de entorno, falla una consulta o el conteo no coincide). Contra producción lo corre una persona con el env de producción.

**Pendientes conocidos de la 26.2a**

- El eval `agents/asistente/evals/instrucciones-brain.eval.ts` está escrito y nunca se ejecutó (gasta modelo): una persona lo corre al cierre.
- `TOOL_LABELS` (`lib/agents/running-tool.ts`) tiene la clave `brain`, pero eve nombra las tools por su clave (`brain_search`, `brain_read`, `brain_upsert`): esas tres muestran "Trabajando…" en el indicador del chat y solo `brain_rules` muestra su etiqueta. Seguimiento: sumar las tres etiquetas y hacer que el test compare contra las claves reales.
- `requireRules` solo chequea que la persona **vea** la ruta, no que sea `editor`: un lector recibe `rules_required`, relee y recién en el reintento le llega `forbidden`. Un viaje de más, sin filtrar nada que no vea.
- En el `brain_upsert` del MCP las reglas se leen antes del limitador: un pedido que el límite va a frenar igual hace la lectura de `listRulePages`.
- ~~Borrar una página reservada chequea `administrador` sobre el slug de la página y no sobre su carpeta (`lib/brain/core/editor/delete.ts`).~~ Resuelto por la 26.2b: `delete.ts` exige administrar la carpeta.
- La aprobación de `brain_upsert` del agente (`always()`) ocurre antes de ejecutar: un `rules_required` llega después de que un administrador ya aprobó, y el reintento vuelve a pedir aprobación. Se mitiga con las descripciones y las instrucciones (leer con `brain_rules` o `brain_read` antes de escribir).
- ~~Pantallas (panel "Reglas que aplican", menús del árbol, insignia en la búsqueda)~~ Resuelto por la 26.2b (ver abajo).

### Reglas en el editor web (etapa 26.2b)

Pantallas sobre el núcleo de la 26.2a. No tiene migraciones ni tablas nuevas.

- **Panel "Reglas que aplican"** (`components/brain/rules-panel.tsx`): va arriba del papel, plegado, con el conteo. No aparece si la ruta no tiene reglas, si la persona no la ve o si es de `skills/`. Es informativo: guardar no exige nada. Las reglas se filtran como en el MCP (`editorRules` en `core/editor/rules-panel.ts`: `withRulesAccess` y `withoutSkillRules`, por la ruta pedida), y las `00-reglas` que la persona no puede abrir van sin el link "Abrir". Un error de lectura no rompe el editor: `loadRulesPanel` lo registra y devuelve un aviso (`RULES_LOAD_ERROR`).
- **En "Nueva página"** el panel sigue a la carpeta del slug que se escribe. El hook `useFolderRules` pide `loadNewPageRules` (`app/[tenant]/brain/rules-actions.ts`, que valida la forma y resuelve el panel con `loadNewPageRulesPanel` sobre el contexto de la persona) una vez por carpeta, con una pausa de 300 ms (`RULES_DEBOUNCE_MS`), y descarta una respuesta vieja. La cascada de una página que no existe se sondea con la hoja `<carpeta>/nueva-pagina` (`probeSlugFor`). Si el pedido falla, el panel pasa a estado de error y volver a cualquier carpeta lo pide de nuevo. En edición el hook está apagado y manda el servidor (`router.refresh()` trae reglas nuevas).
- **Árbol:** las reservadas no son hijas: cuelgan como marcas `rules` y `template` de su carpeta (`TreeNode` en `core/access/tree.ts`; en la raíz, `rules` son las instrucciones del brain). El indicador solo aparece si la `00-reglas` está activa; `withoutArchived` conserva la marca aunque esté archivada, para que el menú la abra en vez de ofrecer crear otra, y `countPages` no las cuenta (una carpeta con solo su `00-reglas` dice "Vacía").
- **Menú del árbol:** "Instrucciones del brain" (en la raíz) y "Reglas de la carpeta" abren la `00-reglas` existente en cualquier estado o, si no hay, crean una en `/brain/nueva?reglas=1[&en=<carpeta>]` (`rulesEntryHref`, `resolveNewRulesPage`): en borrador, con el slug fijo, el título de la reservada, el aviso (`ReservedNotice`, `reservedNotice`) y el contador contra el tope. Hace falta administrar la carpeta; `skills/` no ofrece reglas propias y una carpeta que no existe no arma la página. "Borrar carpeta…" aparece deshabilitado con el motivo (`folderDeleteBlocks`: tiene páginas o subcarpetas, o tiene reglas propias); se calcula sobre el árbol sin podar y solo para carpetas con fila, porque `brain_delete_folder` cuenta toda página bajo el prefijo, archivadas y reservadas incluidas. Es solo experiencia: lo frena la base.
- **Quien no administra la carpeta** abre una reservada en lectura (`entryLevel` en `core/editor/reserved.ts`) y no la puede borrar: `delete.ts` exige `administrador` sobre la carpeta de la página (`folderOfPage`), igual que `withAccess` al escribirla.
- **Índice y búsqueda:** el índice no lista las reservadas salvo con una consulta (`listedInIndex`); la búsqueda las marca con la insignia "Reglas" o "Plantilla" (`reservedBadge`).
- **Categoría:** la del editor sale de la ruta (`pageCategory` en `core/editor/page-category.ts`) y se muestra como texto; ya no hay selector. Un error de `category` o `folder` marca el campo slug, y sin categoría la miga muestra "—". "Nueva página" arranca en la primera carpeta editable que no es `skills` (`resolveNewPagePrefix`); `?en=` solo se acepta si es una carpeta válida y editable.
- **Módulos aptos para el cliente:** `core/reserved-slugs.ts` y `core/editor/reserved.ts` no importan `rules.ts` ni `node:crypto` porque los usan componentes de cliente (árbol, menú, editor). `rules.ts` re-exporta lo de `reserved-slugs.ts`. `tests/brain/client-safe.ts` sigue los imports de runtime y los tests de esos componentes verifican que no llegan a `node:*`. `core/editor/rules-panel.ts` sí usa `rules.ts`: el cliente importa de él solo tipos.

**Pendientes conocidos de la 26.2b**

- QA en navegador pendiente: la hace una persona con el checklist del plan ([2026-10-15-etapa-26-2b-reglas-editor](../superpowers/plans/2026-10-15-etapa-26-2b-reglas-editor.md), sección Cierre).
- En "Nueva página" con `?en=skills`, mientras el slug está en la raíz la categoría mostrada es la inicial (`skill`).
- Desde "Nueva página" se puede crear `skills/00-reglas` o `skills/00-plantilla` como página de skill forzada a activo (necesita administrar `skills`). Es el comportamiento previo; candidato a rechazar las reservadas bajo `skills/`.
- El ítem deshabilitado "Borrar carpeta…" hereda la opacidad del menú (`data-disabled:opacity-50`) y atenúa también el motivo: revisar el contraste.
- Las etiquetas de las tools del brain en `TOOL_LABELS` (clave `brain` contra `brain_search`, `brain_read` y `brain_upsert`) siguen pendientes (ver la 26.2a).
- Las carpetas implícitas (sin fila en `brain_folders`) no ofrecen "Reglas de la carpeta".

### El canon como fuente del ICP y de los hooks (etapa 21.3a)

- El ICP sale del bloque `icp` de la página con tag `canon:icp`; el scoring lo lee del brain (`loadIcpLevels`) y guarda la huella del bloque en cada juicio. Si el brain no responde, lanza y el runner reintenta. Solo cuentan las páginas `activo`, y más de 5 páginas con el mismo tag es un error de carga.
- Guardar o borrar una página `canon:hooks` **refleja** sus bloques `hooks` y `vectores` en `config_values` (función `outreach_reflect_marco`). El brain manda y `config_values` lo sigue. `withCanonReflection` (`adapters/canon-reflection.ts`) engancha el reflejo al guardado sin que el brain conozca al outreach. Un bloque inválido no se refleja y no falla el guardado; sigue vigente lo último que se reflejó bien.
- El brain nace con `comercial/icp` y `comercial/hooks` en borrador. El outreach no se habilita sin brain.
- La pantalla `/<slug>/settings/outreach` muestra ICP, hooks y vectores solo en lectura, con "Releer del brain".

### Skills de empresa (etapa 24.1)

- Una skill es una página de categoría `skill` bajo `skills/`; las dos cosas van juntas y lo exige `validateWrite` (`skillPlacementOk`). El borrador es la página más sus archivos (tabla `brain_skill_files`); el contenido de cada archivo va a un bucket privado, por hash (`<tenant_id>/<sha256>`), que calcula el servidor.
- Edita quien es `editor` de la página; **publica** solo `tenant_admin` o `platform_admin` (`core/skills/publish.ts`). Publicar copia el borrador a `brain_skill_versions`, tabla solo de inserción: la función SQL arma la copia desde la fila bloqueada y la publicación va atada a la revisión y al hash de archivos que mostró la pantalla (si algo cambió, responde conflicto). Retirar y republicar son filas nuevas; una publicada no se borra sin retirarla antes.
- `withoutSkills` va en las tools del agente, en el endpoint MCP y en el lector del canon de outreach: ningún asistente ve ni escribe nada bajo `skills/`. `withSkillView` va en el contexto del editor web: el editor de la skill ve el borrador y quien solo lee ve la copia publicada (revisión publicada, estado `activo`, sin etiquetas); sin versión vigente la skill no existe para esa persona.
- Los archivos se sirven siempre por `/[tenant]/brain/skills/files`, como texto plano o descarga con `nosniff`. El `POST` verifica el origen a mano. El zip se lee con un parser propio (`adapters/skill-zip.ts`) que mira los tamaños declarados antes de descomprimir e infla cada entrada acotada a su tamaño.
- El detalle y las garantías están en [lib/brain/README.md](../../lib/brain/README.md) (sección Skills). Falta el cierre en producción; ver la spec §12. Cómo se sirven por MCP, en la subsección siguiente.

### Skills por MCP (etapa 24.2a)

El endpoint MCP suma cuatro tools, `skill_list`, `skill_load`, `skill_file` y `skill_package` (esta última se explica más abajo). Las tres primeras sirven **solo la copia publicada** de cada skill (nunca el borrador ni `brain_skill_files`). Se registran únicamente si el brain es `wiki` y la persona ve al menos una skill; con otro proveedor o sin skills visibles, el servidor es el de siempre. Además, en ese caso el servidor lleva `instructions` que explican cuándo cargar una skill.

| Situación | Lista y descripción | `skill_load` / `skill_file` | Zip (web y `skill_package`, el mismo) |
|---|---|---|---|
| Lector o más sobre la ruta, publicación vigente | Aparece | Copia publicada | Copia publicada |
| Sin publicar o retirada (cualquier nivel) | No aparece | "No existe" | 404 |
| Sin lectura sobre la ruta | No aparece | "No existe" | 404 |
| Administrador de la empresa | Todas las publicadas vigentes | Copia publicada | Copia publicada |

- `core/skills/catalog.ts` (`loadSkillCatalog`) es puro: recibe el `overview` de la 24.1, una función de nivel por ruta (`resolveAccess` con las reglas que el handler ya cargó), un lector de blobs y un registrador. Se arma una vez por request. Si el overview falla, el servidor se arma sin skills y se registra en consola.
- Las tools identifican la skill por **nombre** (único entre las publicadas). Una skill inexistente y una que la persona no ve dan el mismo mensaje. `skill_file` busca la ruta en el manifiesto de la versión publicada y lee el blob por su `sha256`; más de 256 KB o no texto (`looksLikeText`) devuelve un error que apunta a `skill_package`. La versión se resuelve en cada llamada, sin estado entre tools.
- La descripción de `skill_load` lista hasta 30 skills (`describeSkills`), con descripciones de hasta 300 caracteres, normalizadas a una línea; si hay más, una línea final dice cuántas faltan. Una skill nueva aparece cuando el cliente vuelve a pedir las tools, porque el endpoint es sin estado y no avisa `tools/list_changed`.
- `skill_load` exitoso inserta en `events` un `brain.skill_loaded` (`channel: mcp`, `summary` = slug, `payload` con `name`, `version` y `digest`) desde `adapters/mcp-production.ts` (`skillLoadEvent`). Si la inserción falla, se registra en consola y la carga responde igual. Listar y leer archivos no dejan evento.
- **Descarga:** `GET /[tenant]/brain/skills/package?slug=skills/...` ya no arma ni transmite el zip: responde 302 a un link firmado de 60 segundos sobre el zip guardado (bucket `skill-packages`, objeto `<tenant_id>/<digest>.zip`), con `cache-control: no-store`. Lo permite `publishedSkillFor` (`core/skills/files.ts`): miembro, lectura sobre el slug y publicación vigente; cualquier falla de permiso es 404 y un error interno es 500. El zip lo escribe `zipPackage` (`adapters/skill-zip.ts`, `node:zlib`, sin zip64), espejo de `unzipPackage`, con una carpeta raíz `<name>/`: el `SKILL.md` (`core/skills/skill-md.ts`) y los archivos del manifiesto, binarios incluidos. El botón "Descargar paquete (v<n>)" está en la página de la skill y en `/conectar`.

### Paquete completo por MCP (etapa 24.2b)

- **Tool `skill_package`:** recibe el nombre de una skill visible y devuelve `{ name, version, filename, url, expiresIn }`: un link firmado de 600 segundos al zip de la versión publicada vigente, con nombre `<name>-v<n>.zip`. Se registra junto con las otras tres y cuenta como lectura. Su descripción le dice al asistente que lo baje a una carpeta temporal, lo descomprima y corra los scripts desde ahí, que no lo instale en su carpeta de skills (esa copia queda vieja al republicar), que pida otro link si venció y que, si su entorno no baja archivos, siga con `skill_load` y `skill_file` y avise de lo que no pudo correr. Las instrucciones del servidor y el mensaje de `skill_file` para archivos binarios o grandes apuntan a esta tool.
- **Bucket `skill-packages`** (migración `20261022120000_skill_packages_bucket`): privado, objeto `<tenant_id>/<digest>.zip`, con un tope por objeto de 26 MB (27262976 bytes). El zip se arma la primera vez que alguien lo pide y se reutiliza: dos versiones con el mismo contenido comparten objeto. `issuePackageLink` (`core/skills/package-link.ts`, puro) decide si hay que armarlo, lo sube y firma el link; `adapters/skill-packages.ts` pone el bucket (`packageObjects`), el cableado (`packageLinkDeps`) y el evento. Si falta un blob, falla: nunca se guarda un paquete incompleto.
- **Evento `brain.skill_package_issued`:** cada link emitido inserta una fila en `events` (`channel` `mcp` o `web`, `summary` = slug, `payload` con `name`, `version` y `digest`). Si la inserción falla, se registra en consola y el link se entrega igual.
- **Sección "Tus skills" de `/conectar`** (`app/[tenant]/conectar/skills-section.tsx`): lista las skills que la persona puede usar (`memberSkills`, que aplica `visibleSkills` con sus niveles) con descripción y botón de descarga, y explica la diferencia entre Claude Code, Codex y Cursor (usan siempre la última) y claude.ai y ChatGPT (hay que subir el zip de nuevo en cada versión). Si no se pudieron leer, lo dice en vez de mostrar una lista vacía; si la persona no ve ninguna, la sección no aparece.
- **Límite aceptado (P7):** claude.ai y ChatGPT web no corren scripts siempre al día; su entorno no sale a internet por defecto. Queda como etapa 24.4.
- **Pendientes:** limpiar los zips huérfanos de versiones retiradas o reemplazadas (P8); dependencias entre skills (24.2c); skills en el chat interno (24.3); ejecutar del lado de la plataforma (24.4). El cierre en producción está en la spec §13.

### Crear y editar skills por MCP (etapa 24.5)

`lib/brain/core/skills/draft.ts` es el único lugar que ve el borrador de una skill desde un asistente. El handler le pasa el proveedor con `withAccess` pero **sin** `withoutSkills`; las tres tools del brain siguen recibiendo el envuelto con la guardia. Las tools (`skill_create`, `skill_draft_read`, `skill_draft_edit`, `skill_draft_write_file`) se registran solo si el brain es del proveedor `wiki`, la categoría `skill` está habilitada y la persona puede editar algo bajo `skills/`, y todo cambio va al borrador: publicar es solo de la web (24.1 S5). Reusan `putSkillFile` y `readSkillFile` para el permiso de editor y los topes del paquete, y el guardado del brain para el `SKILL.md` (con `baseRevision`, o sin él para crear: el guardado sin `baseRevision` solo crea páginas nuevas, así que `skill_create` nunca pisa una página).

### Frontera core/adapters

`lib/brain/core` no importa nada de afuera: solo `zod`, `yaml`, `@modelcontextprotocol/sdk`, `node:*` y, como tipo, `@supabase/supabase-js`. Los imports relativos llevan extensión `.ts` porque scripts con Node directo los recorren. Lo que el host tiene que proveer (`WikiStore`, `AccessStore`, `AccessRulesStore`, `unauthorized`, `SaveDeps`) está en la tabla del README del módulo.

## 4. Cómo se prueba

| Qué | Cómo |
|---|---|
| Frontera: `core` no importa de afuera (estático, `import()` y `require`) | `npx vitest run tests/brain/boundary.test.ts` (detector en `tests/brain/boundary-check.ts`). No detecta globals de Node como `Buffer` |
| Todo el módulo | `npx vitest run tests/brain` |
| Permisos | `tests/brain/access-*.test.ts`, `editor-access*.test.ts`, `agent-access.test.ts`, `acting-provider.test.ts` |
| Borrado | `tests/brain/editor-delete.test.ts`, `delete-store.test.ts`, `delete-actions.test.ts`, `links-cleanup.test.ts`, `wikilinks-remove.test.ts` |
| Editor: ida y vuelta del markdown | `npx vitest run tests/brain/editor-roundtrip.test.ts` (entorno `happy-dom`). Suma las páginas reales de `tests/fixtures/brain-real/`, que no se versiona porque el repo es público |
| Skills | `tests/brain/skills-*.test.ts` (paquete, estados, vistas, publicar, archivos, zip, ruta, catálogo, `SKILL.md` y ruta de descarga `skills-package-route.test.ts`) y pgTAP `34_brain_skills` |
| Endpoint MCP | `tests/brain/mcp-server/` (acceso, handler, límites, producción, tools de skills) |
| Canon como fuente | `tests/brain/canon-reflection.test.ts` y `tests/outreach/canon.test.ts` |
| Reglas en el editor (26.2b) | `tests/brain/editor-reserved.test.ts`, `editor-rules-panel.test.ts`, `rules-panel.test.ts`, `rules-panel-hook.test.ts`, `reserved-notice.test.ts`, `page-list.test.ts`, `editor-page-category.test.ts`, `editor-new-page.test.ts`, `editor-adapter.test.ts`, `editor-delete.test.ts`, `rules-actions.test.ts`, `tree-row-menu.test.ts`, `access-tree.test.ts`, `wiki-folders.test.ts`. `tests/brain/client-safe.ts` es el seguidor de imports de cliente |
| Base | pgTAP en `supabase/tests/`: `08_brain_tables`, `09_brain_upsert`, `10_brain_search`, `18_brain_mcp_usage`, `21_brain_access_rules`, `22_brain_access_rule_fns`, `23_brain_delete_page`, `24_brain_rules_membership_cleanup`, `31_outreach_marco_reflect`, `34_brain_skills`, `37_brain_folders`. Corren con `npm run db:test` (necesita Docker) |

## 5. Decisiones

Specs y planes en `docs/superpowers/`:
[brain](../superpowers/specs/2026-09-13-brain-design.md) ·
[etapa 11, brain por MCP](../superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md) ·
[editor del brain](../superpowers/specs/2026-09-27-editor-brain-design.md) ·
[etapa 17, permisos](../superpowers/specs/2026-10-05-etapa-17-permisos-brain-design.md) ·
[etapa 18.1, borrado](../superpowers/specs/2026-10-08-etapa-18-1-borrado-paginas-brain-design.md) ·
[etapa 18.2, editor visual](../superpowers/specs/2026-10-08-etapa-18-2-editor-visual-brain-design.md) ·
[etapa 21.3, config de outreach](../superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md) y [plan 21.3a](../superpowers/plans/2026-10-10-etapa-21-3a-brain-como-fuente.md) ·
[etapa 26, carpetas y reglas](../superpowers/specs/2026-10-14-etapa-26-carpetas-y-reglas-brain-design.md), [plan 26.1a](../superpowers/plans/2026-10-14-etapa-26-1a-carpetas.md) y [plan 26.2b](../superpowers/plans/2026-10-15-etapa-26-2b-reglas-editor.md) ·
[etapa 24.1, skills de empresa](../superpowers/specs/2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md) y [plan](../superpowers/plans/2026-10-11-etapa-24-1-skills-paquete-publicacion.md) ·
[etapa 24.2a, skills por MCP](../superpowers/specs/2026-10-13-etapa-24-2a-skills-por-mcp-design.md) y [plan](../superpowers/plans/2026-10-13-etapa-24-2a-skills-por-mcp.md) ·
[etapa 24.2b, paquete por MCP](../superpowers/specs/2026-10-14-etapa-24-2b-paquete-por-mcp-design.md) y [plan](../superpowers/plans/2026-10-14-etapa-24-2b-paquete-por-mcp.md) ·
[etapa 24.5, crear y editar skills por MCP](../superpowers/specs/2026-10-15-etapa-24-5-editar-skills-por-mcp-design.md) y [plan](../superpowers/plans/2026-10-15-etapa-24-5-editar-skills-por-mcp.md).

Pull requests:

- [#2](https://github.com/innovasbuild/agents/pull/2): brain por tenant con proveedor `wiki`, tablas, búsqueda, aprobación de `brain_upsert` e import.
- [#51](https://github.com/innovasbuild/agents/pull/51): brain por MCP, emisor OAuth 2.1, proveedor `mcp`, `brain_mcp_usage`.
- [#52](https://github.com/innovasbuild/agents/pull/52): Custom Access Token Hook; los tokens del emisor llevan el rol `oauth_client`.
- [#55](https://github.com/innovasbuild/agents/pull/55): editor del brain (leer, entender conexiones, editar), historial y mapa.
- [#73](https://github.com/innovasbuild/agents/pull/73): aislamiento en `core` y `adapters` (17.1); el editor y `raw` leen por el proveedor con el cliente admin.
- [#74](https://github.com/innovasbuild/agents/pull/74): permisos por carpeta y página, `brain_access_rules`, `withAccess` (17.2).
- [#75](https://github.com/innovasbuild/agents/pull/75): árbol, menú de tres puntos y diálogo de compartir (17.3).
- [#76](https://github.com/innovasbuild/agents/pull/76): borrado con limpieza de links (18.1); reemplaza la regla "nunca se borran páginas" de la spec del brain.
- [#77](https://github.com/innovasbuild/agents/pull/77): primer intento de la 18.2, mergeado a la rama de la 18.1 y por eso no llegó a `main`.
- [#78](https://github.com/innovasbuild/agents/pull/78): editor visual Tiptap y vista de papel (18.2), el que sí llegó a `main`.
- [#79](https://github.com/innovasbuild/agents/pull/79): las reglas por persona se van con la membresía; `platform_admin` por MCP alineado con la app.
- [#90](https://github.com/innovasbuild/agents/pull/90): el brain como fuente del ICP y los hooks (21.3a) y pantalla de outreach (21.3b).

Decisiones de la 24.2a (M1 a M9 de la spec):

- M1: las skills salen por tools propias; `withoutSkills` no cambia, así que las tools del brain siguen sin ver `skills/`.
- M2: por MCP todos reciben la versión publicada, también editores y administradores.
- M3: ve una skill quien tiene al menos lectura sobre su ruta y la skill tiene publicación vigente.
- M4: las tools identifican la skill por nombre, no por ruta.
- M5: la descripción de `skill_load` lista las skills de la persona y además existe `skill_list`.
- M6: por MCP solo viajan archivos de texto (hasta 256 KB); los binarios van en el zip.
- M7: el zip es siempre el de la versión publicada vigente, para cualquier nivel.
- M8: cada carga deja un evento; listar y leer archivos no.
- M9: sin migración; `events.type` es texto libre.
- Pendiente de la 24.2a, cerrado por la 24.2b: la descarga ya no pasa por la función, así que el tope de respuesta de Vercel no aplica. Queda verificar en un preview que un paquete de más de 5 MB baja bien.

Decisiones de la 24.2b (P1 a P8 de la spec; P2 reemplaza a M6):

- P1: por MCP ejecuta el cliente, no la plataforma; no hay `skill_run`.
- P2: el paquete completo sale por un link firmado de 10 minutos que devuelve `skill_package`.
- P3: el zip se guarda por digest en un bucket privado y se arma la primera vez que se pide.
- P4: la descarga web redirige a un link firmado de 60 segundos.
- P5: el asistente descomprime en una carpeta temporal y no instala la skill.
- P6: cada link emitido deja un evento, por MCP y por web.
- P7: límite aceptado: claude.ai y ChatGPT web no corren scripts siempre al día; la persona sube el zip a mano.
- P8: no se limpian los zips de versiones retiradas o reemplazadas.

Discrepancias spec-versus-código:

- La spec del brain dice que las páginas nunca se borran (B8); desde #76 un administrador del nodo puede borrar desde la web. El agente y el MCP siguen sin poder.
- El PR #55 entregó un formulario con pestañas Editar y Vista previa; #78 lo retiró (`page-form.tsx`) a favor del editor visual, y `/brain/editar/<slug>` ahora redirige.
- El PR #55 dejaba escribir solo a `tenant_admin` y `platform_admin`; desde la 17.2 escribe quien tenga `editor` sobre la página.
- El canal MCP del agente (`lib/agents/mcp-channel-auth.ts`) todavía no está alineado con la regla de `platform_admin` del dueño, según el README del módulo.
