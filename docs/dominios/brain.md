---
title: Brain
category: dominios
status: activo
tags: [brain, wiki, mcp, permisos, editor, canon]
updated: 2026-10-13
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
  - lib/brain/adapters/skill-zip.ts
  - lib/brain/adapters/skills.ts
  - supabase/migrations/20261020120000_brain_skills.sql
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
| `lib/brain/adapters/skill-zip.ts`, `skills.ts` | Lector de zip con topes, Storage de archivos y armado de dependencias de las skills |
| `lib/brain/core/categories.ts`, `config.ts` | Lectura y validación de las categorías del tenant |
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
| `/brain/[tenant]/mcp` | Endpoint MCP del brain |
| `/.well-known/oauth-protected-resource/brain/[tenant]/mcp` | Metadata OAuth del recurso (RFC 9728) |

## 3. Cómo funciona

### Páginas y revisiones

- `brain_pages` guarda la página vigente: `slug` (ruta en minúsculas con guiones, hasta 200 caracteres, única por tenant), `title`, `category`, `status` (`activo`, `borrador`, `archivado`), `tags`, `frontmatter`, `body` (hasta 200 KiB) y `revision`.
- `brain_revisions` es **append-only**: cada escritura deja una revisión nueva con autor (`user`, `agent` o `import`), quién aprobó, sesión y motivo obligatorio.
- El único camino de escritura es la función SQL `brain_upsert_page`, con control de concurrencia optimista: para actualizar hay que pasar `baseRevision`; sin ella solo se crean páginas nuevas. Un desfase devuelve conflicto (`BR409`). Los otros códigos son `BR404` y `BR422`. La función ejecuta solo `service_role`.
- Los miembros no leen las tablas por la API de Supabase: desde la 17.2 se revocó el `select` de `authenticated` sobre `brain_pages` y `brain_revisions`. Todo pasa por el proveedor, con el cliente admin y el tenant que resuelve la app.
- Las categorías válidas son una lista por tenant que vive en la config del binding (`^[a-z][a-z0-9-]{0,40}$`, hasta 20). La base solo valida el formato. Las edita la consola de plataforma con `parseCategories` (`core/categories.ts`).
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

`tenant_agents.config.brain` declara el acceso de cada agente (`none`, `read`, `read_write`); sin declaración no hay tools `brain_*`. En eve el agente de outreach las recibe por la tool dinámica `brain` (`agents/outreach/tools/brain.ts`). `brain_upsert` siempre pide aprobación y solo la acepta un `tenant_admin` o `platform_admin` **del mismo tenant** (`core/approval.ts`). Un tenant sin binding `brain` no ve ninguna tool `brain_*`.

### Import

`npm run brain:import -- --tenant <slug> --from "<carpeta>"` importa una bóveda de markdown (por ejemplo, de Obsidian). **Dry-run por defecto**; con `--apply` escribe. Un manifiesto (`brain-import.json` del tenant) fija qué entra (`include`/`exclude`) y qué tags de canon recibe cada ruta. Es idempotente: guarda `source_path`, `source_hash` y `source_revision` en `brain_pages`, y si alguien editó la página en la plataforma (la revisión cambió), el import no la pisa.

### Categorías y canon

- Las categorías son de la empresa (por ejemplo `empresa`, `producto`, `comercial`, `operacion` como valores de ejemplo).
- El **canon** son páginas con tags `canon:icp`, `canon:mensajes`, `canon:voz`, `canon:hooks` y `canon:objeciones`. Ningún nodo ni workflow escribe páginas `canon:*` sin aprobación humana (ver [orquestación](../arquitectura/orquestacion.md)).

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
- El detalle y las garantías están en [lib/brain/README.md](../../lib/brain/README.md) (sección Skills). Falta el cierre en producción; ver la spec §12.

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
| Skills | `tests/brain/skills-*.test.ts` (paquete, estados, vistas, publicar, archivos, zip, ruta) y pgTAP `34_brain_skills` |
| Endpoint MCP | `tests/brain/mcp-server/` (acceso, handler, límites, producción) |
| Canon como fuente | `tests/brain/canon-reflection.test.ts` y `tests/outreach/canon.test.ts` |
| Base | pgTAP en `supabase/tests/`: `08_brain_tables`, `09_brain_upsert`, `10_brain_search`, `18_brain_mcp_usage`, `21_brain_access_rules`, `22_brain_access_rule_fns`, `23_brain_delete_page`, `24_brain_rules_membership_cleanup`, `31_outreach_marco_reflect`, `34_brain_skills`. Corren con `npm run db:test` (necesita Docker) |

## 5. Decisiones

Specs y planes en `docs/superpowers/`:
[brain](../superpowers/specs/2026-09-13-brain-design.md) ·
[etapa 11, brain por MCP](../superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md) ·
[editor del brain](../superpowers/specs/2026-09-27-editor-brain-design.md) ·
[etapa 17, permisos](../superpowers/specs/2026-10-05-etapa-17-permisos-brain-design.md) ·
[etapa 18.1, borrado](../superpowers/specs/2026-10-08-etapa-18-1-borrado-paginas-brain-design.md) ·
[etapa 18.2, editor visual](../superpowers/specs/2026-10-08-etapa-18-2-editor-visual-brain-design.md) ·
[etapa 21.3, config de outreach](../superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md) y [plan 21.3a](../superpowers/plans/2026-10-10-etapa-21-3a-brain-como-fuente.md) ·
[etapa 24.1, skills de empresa](../superpowers/specs/2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md) y [plan](../superpowers/plans/2026-10-11-etapa-24-1-skills-paquete-publicacion.md).

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

Discrepancias spec-versus-código:

- La spec del brain dice que las páginas nunca se borran (B8); desde #76 un administrador del nodo puede borrar desde la web. El agente y el MCP siguen sin poder.
- El PR #55 entregó un formulario con pestañas Editar y Vista previa; #78 lo retiró (`page-form.tsx`) a favor del editor visual, y `/brain/editar/<slug>` ahora redirige.
- El PR #55 dejaba escribir solo a `tenant_admin` y `platform_admin`; desde la 17.2 escribe quien tenga `editor` sobre la página.
- El canal MCP del agente (`lib/agents/mcp-channel-auth.ts`) todavía no está alineado con la regla de `platform_admin` del dueño, según el README del módulo.
