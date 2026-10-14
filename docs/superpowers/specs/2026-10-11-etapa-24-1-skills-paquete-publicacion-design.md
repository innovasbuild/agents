# Etapa 24.1 · Skills de empresa: paquete y publicación — diseño

**Fecha:** 2026-10-11
**Etapa:** 24 (nueva en el roadmap), entrega 24.1. La 24.2 sirve las skills por MCP y corre sus scripts (`skill_run`); la 24.3 las lleva al chat interno y va después de la Etapa 22. Cada una tiene su spec, su plan y su PR.
**Base:** `2026-09-13-brain-design.md` (páginas, revisiones, `brain_upsert_page`), `2026-10-05-etapa-17-permisos-brain-design.md` (permisos por nodo, `withAccess`), `2026-10-08-etapa-18-1-borrado-paginas-brain-design.md` (`brain_delete_page`), `2026-10-08-etapa-18-2-editor-visual-brain-design.md` (editor y modo de entrada), `docs/02-orquestacion.md` (la escalera y los niveles de efecto).
**Depende de:** la 21.4 mergeada (la consola edita las categorías del brain de una empresa con `platform_set_brain_categories`).

## 1. Objetivo y criterio de cierre

Que una empresa pueda **armar, revisar y publicar skills en su brain**: un procedimiento en markdown más los archivos que lo acompañan (scripts, referencias, plantillas), con una versión publicada inmutable que es lo único que después se distribuye.

Pedido de Matías: dejar skills disponibles para los empleados de cada empresa (una de diseño de marca para todos, una de facturación para los administrativos), apalancando el brain, con scripts, usables desde el chat interno y desde Claude, Codex y similares, y que se actualicen solas al editarlas.

Esta entrega deja el paquete, la revisión y el registro. **Ningún asistente usa todavía una skill al cerrarla**: eso llega con la 24.2.

**Terminado cuando**, en producción, en el tenant `innovas`:

1. Un administrador publica una skill real con al menos un script.
2. Un lector de esa carpeta la ve publicada en la web.
3. Un editor cambia el borrador y el lector sigue viendo la versión anterior hasta que un administrador republica.
4. `brain_read` por MCP no la devuelve, ni publicada ni en borrador.
5. `events` tiene un `brain.skill_published` con la versión, el hash del paquete y quién publicó.

## 2. Frontera: skill y agente

Acordada en el brainstorming; la 24.2 y la 24.3 la heredan.

| | Agente | Skill |
|---|---|---|
| Qué es | Un trabajador: tools, conexiones, modelo, presupuesto, horarios | Un procedimiento: criterios, pasos, plantillas, scripts de cómputo |
| Quién lo escribe | INNOV.AS, en código, por capacidad | La empresa, en el brain, sin deploy |
| Efecto afuera | Sí, por tools con nivel de efecto y aprobación | Ninguno propio |
| Cómo se asigna | `tenant_agents` hoy; reglas por persona en la Etapa 22 | Permisos del brain por carpeta |

Una skill nunca agrega una tool ni un permiso: usa lo que ya tiene el agente que la carga. Algo deja de ser skill cuando necesita credenciales o escribe en un sistema (tool de nivel 2 o 3), cuando corre sin una persona delante (workflow) o cuando necesita estado propio.

**Los scripts son cómputo puro:** sin red y sin credenciales del tenant. Reciben datos y archivos, devuelven datos y archivos. Es nivel de efecto 0. Esta entrega no ejecuta nada; la regla condiciona qué tiene sentido empaquetar.

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| S1 | **El borrador vive en el brain; la versión publicada, aparte.** `SKILL.md` es una página; archivos y versiones van en tablas nuevas | Reusa editor, permisos, historial y wikilinks. Agrega solo lo que el brain no tiene: binarios y una versión atómica del paquete |
| S2 | **Formato Agent Skills** (`agentskills.io`): `SKILL.md` más `scripts/`, `references/`, `assets/` | Lo leen Claude, Codex, Cursor, Gemini CLI y Copilot. Un paquete armado afuera entra sin traducir |
| S3 | **Categoría `skill` y ruta bajo `skills/`, las dos juntas.** Una página es skill si y solo si cumple ambas | La categoría la habilita por empresa; el prefijo hace que las reglas por carpeta y los filtros sean un chequeo de ruta |
| S4 | **Solo se distribuye lo publicado.** Publicar congela texto, archivos y hash en una fila que no se modifica | Es lo que hace que la revisión valga y lo que permite actualizar por hash en la 24.2 |
| S5 | **Edita un editor del nodo; publica un administrador de la empresa** (`tenant_admin` o `platform_admin`), solo desde la web | El texto de una skill son instrucciones que llegan al asistente de todos los que la ven |
| S6 | **Los asistentes nunca ven una skill por las tools del brain.** `brain_search`, `brain_read` y `brain_upsert` dejan afuera `skills/`, por MCP y en el agente | Sin esto, un lector le pide a su asistente que lea el borrador y la revisión no sirve de nada |
| S7 | **Un lector ve la última versión publicada**; sin versión vigente, la skill no existe para él | El borrador es de quien lo edita |
| S8 | **Archivos guardados por hash** en un bucket privado. El hash lo calcula el servidor | Publicar no copia nada y un archivo publicado no se puede pisar |
| S9 | **Lo que se publica es lo que se revisó:** la publicación va atada a la revisión del texto y al hash de los archivos que el administrador tuvo delante | Si el borrador cambió mientras revisaba, conflicto y a revisar de nuevo |
| S10 | **Sin regla de dos personas.** Un administrador publica un cambio propio; el evento guarda quién editó y quién publicó | Con scripts sin red ni credenciales, el riesgo no lo justifica todavía |
| S11 | **Sin fijar versión.** Los consumidores reciben siempre la última publicada | Es el pedido: que se actualicen solas |
| S12 | **Permisos por persona sobre la carpeta** (lo que el brain ya tiene). Los grupos quedan para cuando la Etapa 22 generalice las reglas | Valida el circuito sin rediseñar permisos |
| S13 | Solo el proveedor `wiki` | Igual que el editor y el borrado |

## 4. Modelo de datos

Migración nueva. Las dos tablas llevan `tenant_id`, RLS habilitada y **ninguna política para `authenticated`**: como `brain_pages` desde la Etapa 17, solo las toca el servidor con la service role. `anon` sin nada.

### 4.1 `brain_skill_files` — archivos del borrador

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `tenant_id` | uuid | fk `tenants`, cascade |
| `page_id` | uuid | fk `brain_pages`, cascade |
| `path` | text | ruta dentro del paquete; `check` con el patrón de §5.2 |
| `sha256` | text | 64 hex |
| `size` | integer | bytes, entre 0 y 4.194.304 |
| `uploaded_by` | uuid | fk `auth.users`, set null |
| `created_at` | timestamptz | |

`unique (page_id, path)`. Índices en `tenant_id` y `uploaded_by`.

### 4.2 `brain_skill_versions` — actos de publicación

Solo de inserción: `revoke update, delete, truncate`. Cada fila es un acto.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | bigint identity | orden de los actos |
| `tenant_id` | uuid | fk `tenants`, cascade |
| `page_id` | uuid | fk `brain_pages`, **set null** al borrar la página |
| `slug` | text | ruta de la página al publicar |
| `name` | text | último tramo de la ruta |
| `action` | enum `publicar` \| `retirar` | |
| `version` | integer | sube con cada `publicar`; `retirar` repite la que retira |
| `page_revision` | integer | revisión de la página que se congeló |
| `title`, `description`, `body`, `frontmatter` | | copia del texto; vacíos en `retirar` |
| `manifest` | jsonb | `[{ path, sha256, size }]`, ordenado por `path` |
| `files_digest` | text | hash de los archivos al publicar; se compara con el del borrador para saber si hay cambios |
| `digest` | text | hash del paquete (§5.4) |
| `note` | text | nota obligatoria |
| `republished_from` | integer | versión de origen, si es una republicación |
| `actor_user_id` | uuid | fk `auth.users`, set null |
| `created_at` | timestamptz | |

El estado vigente de una skill es su fila de mayor `id`. Índice `(tenant_id, page_id, id desc)` y `(tenant_id, name)`.

### 4.3 Bucket `skills`

Privado, sin políticas en `storage.objects`: ni lectura ni escritura directa para nadie. Objeto en `<tenant_id>/<sha256>`. Subir dos veces el mismo contenido no duplica nada.

### 4.4 Funciones SQL

Todas `security invoker`, `search_path = ''`, ejecutables solo por `service_role`, con su evento en la misma transacción. La autorización la hace el código antes de llamar, como en `brain_set_access_rule`.

- **`brain_skill_put_file(tenant, page, path, sha256, size, actor)`**: bloquea la fila de la página (`for update`), verifica que sea categoría `skill`, inserta o reemplaza por `path`, y rechaza si el paquete pasa de 50 archivos o 20 MB. Evento `brain.skill_file_added`.
- **`brain_skill_remove_file(tenant, page, path, actor)`**: bloquea la página y borra la fila. Evento `brain.skill_file_removed`. Quitar lo que no está no deja evento.
- **`brain_publish_skill(tenant, page, expected_revision, expected_files_digest, note, actor, from_version)`**: bloquea la página; rechaza con conflicto (`BR409`) si la revisión o el hash de archivos no coinciden con lo esperado; **arma la copia ella misma** desde la fila bloqueada y los archivos (el servidor de aplicación no le pasa contenido); con `from_version` copia esa versión en vez del borrador; toma un `pg_advisory_xact_lock` por `(tenant, name)` y rechaza si otra página tiene ese nombre vigente; inserta la fila con `version = última + 1`. Evento `brain.skill_published` con `version`, `digest`, `republished_from` y los autores de las revisiones desde la publicación anterior.
- **`brain_withdraw_skill(tenant, page, note, actor)`**: inserta la fila `retirar`. Evento `brain.skill_withdrawn`. Retirar algo ya retirado no hace nada.
- **`brain_delete_page`** (se modifica): rechaza si la última fila de la página en `brain_skill_versions` es `publicar`.

- **`brain_skill_overview(tenant)`**: una fila por página de categoría `skill` con su revisión, el hash de archivos del borrador y su último acto. Es la única lectura que necesitan los estados, el árbol y la vista del lector.

El hash de archivos es `sha256` de la lista JSON `[[path, sha256], ...]` ordenada por `path`. Lo calcula solo la base (`brain_skill_files_digest`); la aplicación lo lee, nunca lo recalcula.

## 5. El paquete

### 5.1 La página

- Categoría `skill`, ruta `skills/<...>/<nombre>`. El nombre es el último tramo: minúsculas, dígitos y guiones, hasta 64 (ya lo garantiza `SLUG_PATTERN`; se suma el tope).
- Admite subcarpetas (`skills/administracion/facturacion`): dar acceso a la carpeta vale para todas las skills de adentro.
- Frontmatter: `description` (obligatoria para publicar, hasta 1024), y opcionales `compatibility` (hasta 500, texto libre: qué necesita el script), `license`.
- El estado común del brain (`activo`, `borrador`, `archivado`) no se usa: se guarda `activo` y la pantalla muestra el estado de publicación.
- Guardar con categoría `skill` fuera de `skills/`, o al revés, es error de validación.

### 5.2 Rutas de archivos

Patrón: tramos de `[A-Za-z0-9._-]`, separados por `/`, hasta 200 caracteres y 6 niveles. Se rechaza: ruta absoluta, tramo `.` o `..`, tramo que empieza con `.`, y `SKILL.md` en la raíz (ese es la página).

### 5.3 Límites

| Qué | Tope | Por qué |
|---|---|---|
| Archivo | 4 MB | El pedido a una función de Vercel admite 4,5 MB |
| Paquete | 20 MB y 50 archivos | Tiene que copiarse rápido a un sandbox |
| Zip a importar | 4 MB | El mismo tope del pedido |
| `description` | 1024 | El del estándar |

Un texto de más de 500 líneas avisa al publicar y no frena.

### 5.4 Hash del paquete

El `digest` lo calcula la función de publicar: `sha256` de nombre, descripción, hash del cuerpo, `compatibility`, `license` y hash de archivos, codificados como una lista JSON (el escape de JSON evita que campos distintos den el mismo texto). El mismo contenido da el mismo hash sin importar el orden de carga. Armar el archivo `SKILL.md` a partir de la copia (frontmatter más cuerpo) es de la 24.2, que es la que lo sirve.

Los wikilinks del cuerpo se publican como están. La página enlazada se lee viva, con los permisos de quien la lea: cambiar `[[marca/paleta]]` cambia lo que el asistente encuentra sin pasar por la revisión de la skill. Es deliberado: ese contenido lo gobiernan los permisos del brain.

## 6. Carga de archivos

- **Sueltos.** Panel "Archivos" en la página: subir a una ruta, reemplazar, quitar.
- **Importar zip.** Un paquete estándar entero: `SKILL.md` llena la descripción, `compatibility`, `license` y el cuerpo del borrador (una revisión nueva, con motivo `Importación de paquete`; el título de la página no cambia), y el resto reemplaza los archivos. Se importa sobre una página de skill que ya existe. Admite el zip con o sin carpeta raíz. Una sola ruta inválida, un archivo fuera de límite o la falta de `SKILL.md` rechazan el zip entero, sin cambios. **Nunca publica.**

Sin editor de código en el navegador: los archivos de texto se ven en modo lectura; para cambiarlos se vuelven a subir.

Suben por un route handler (`app/[tenant]/brain/skills/files/route.ts`), no por una server action (tope de 2 MB). El servidor verifica nivel `editor` sobre la página, calcula el hash, sube el objeto y recién entonces llama a `brain_skill_put_file`. Si esa llamada falla, el objeto queda sin uso en el bucket (§11).

El mismo handler sirve el contenido de un archivo (`GET`), siempre pasando por el servidor: un editor lee los archivos del borrador y los de cualquier versión; un lector, solo los que figuran en el manifiesto de la versión vigente. El bucket nunca se expone ni se firman links en esta entrega.

## 7. Qué ve cada uno

| Quién | Web | Tools del brain (MCP y agente) |
|---|---|---|
| Administrador de la empresa | Borrador, archivos, versiones; publica, republica, retira | Nada bajo `skills/` |
| Editor del nodo | Borrador, archivos, versiones | Nada |
| Lector del nodo | Última versión publicada, con sus archivos; nada si no hay vigente | Nada |
| Sin acceso | `not_found` | Nada |

- **Web.** `entryMode` sigue decidiendo `edit` o `read`. En `read`, una skill muestra la copia publicada (texto y lista de archivos), no la página. Sin versión vigente, un lector recibe lo mismo que si no existiera, y no aparece en su árbol.
- **Historial y `raw`.** Las revisiones son del borrador: solo editor o más. La ruta `raw` de una skill aplica la misma regla.
- **Búsqueda web.** Para quien no es editor de la skill, la búsqueda no devuelve páginas bajo `skills/` (el fragmento saldría del borrador). Las encuentra por el árbol.
- **Tools.** Un envoltorio `withoutSkills(provider)` en `core`, aplicado en el endpoint MCP y en las tools del agente: `search` y `list` filtran `skills/`, `read` e `history` responden `not_found`, `upsert` rechaza con `forbidden` cualquier ruta bajo `skills/` o categoría `skill`. Además `brainContract` saca `skill` de la lista de categorías que anuncia. El agente es administrador en el brain: por eso el filtro va en un envoltorio propio y no en `withAccess`.

## 8. Publicación y ciclo de vida

### 8.1 Estados

Derivados por una función pura a partir de la última fila de `brain_skill_versions`, la revisión de la página y el hash de sus archivos:

- **Sin publicar**: no hay filas.
- **Publicada vN**: última fila `publicar`, y borrador igual a lo publicado.
- **Publicada vN, con cambios sin publicar**: última fila `publicar`, y la revisión o el hash de archivos difieren.
- **Retirada**: última fila `retirar`.

El árbol marca las que tienen cambios sin publicar, solo para quien puede editarlas.

### 8.2 Revisión

"Publicar" lo ve solo un administrador de la empresa, y solo si el borrador difiere de lo publicado. Abre una revisión con:

- La diferencia del texto contra la última versión (reusa `diff-view`).
- Archivos agregados, cambiados y quitados, con tamaño; el contenido de cada archivo de texto a un clic.
- Quiénes editaron desde la última publicación.
- El resultado de las validaciones: descripción presente, nombre válido y único, límites; aviso por texto largo.
- Nota de publicación, obligatoria.

La pantalla carga una revisión y un hash de archivos; confirmar manda esos dos valores. El servidor arma la copia leyendo la página en esa revisión y los archivos, y la función SQL rechaza si algo cambió.

### 8.3 Ciclo de vida

- **Nueva versión.** Publicar de nuevo crea la siguiente.
- **Republicar.** Desde el historial de versiones, una versión anterior se publica como versión nueva con el mismo contenido. No toca el borrador, que queda "con cambios sin publicar".
- **Retirar.** Deja de estar vigente en el acto. Borrador e historial quedan; publicar la reactiva.
- **Borrar.** Con versión vigente, no: primero se retira. Borrada la página, sus versiones quedan como registro con `page_id` nulo; los archivos del borrador caen por la clave foránea.
- **Cambiar de categoría o de ruta.** Una página con filas en `brain_skill_versions` no sale de la categoría `skill`. No hay renombrar: otro nombre es otra skill.

### 8.4 Habilitar skills en una empresa

Agregar `skill` a las categorías de su brain desde la consola de plataforma. Sin esa categoría no se puede crear la página y la pantalla no ofrece nada de esto. No hay interruptor nuevo.

## 9. Código

- **`lib/brain/core/skills/`** (puro, respeta `tests/brain/boundary.test.ts`): `package.ts` (rutas, límites, validaciones), `state.ts` (estados), `publish.ts` (`previewPublish`, `publishSkill`, `republishSkill`, `withdrawSkill`: exigen administrador), `files.ts` (subir, quitar, leer e importar), `view.ts` (`withoutSkills` para los asistentes y `withSkillView` para la web), `store.ts` (RPC a las funciones SQL, como `delete-store.ts`).
- **`lib/brain/adapters/skills.ts`**: cliente admin, Storage y lectura del zip. El zip va en `adapters` porque necesita una dependencia nueva que `core` no puede importar; cuál, lo decide el plan.
- **`app/[tenant]/brain/skill-actions.ts`**: server actions de publicar, republicar, retirar y quitar archivo. **`app/[tenant]/brain/skills/files/route.ts`**: subida e importación.
- **`components/brain/skills/`**: panel de archivos, estado, revisión, historial de versiones, vista publicada.
- **Se tocan:** `core/editor/save.ts` (invariante de S3 y bloqueo de categoría), `core/editor/delete.ts` (mensaje cuando hay versión vigente), `core/contract.ts`, el endpoint MCP y `adapters/tools.ts` (envoltorio), la página `p/[...slug]`, `raw`, `historial`, el árbol y la búsqueda web.
- `lib/brain/README.md` suma la sección de skills y la migración a "Qué viaja con el módulo".

No hay nodo nuevo ni tool nueva: nada que registrar en `lib/workflows/registry.ts` ni en `TOOL_LABELS`.

## 10. Pruebas

**pgTAP** (`supabase/tests/`): aislamiento entre empresas en las dos tablas; nada para `anon` ni `authenticated`; `brain_skill_versions` sin `update` ni `delete`; `brain_publish_skill` numera, rechaza revisión o hash viejos, exige nombre único y deja su evento; el hash de archivos no depende del orden de carga; topes de archivos y tamaño bajo carrera; `brain_delete_page` rechaza con versión vigente y deja las versiones al borrar una retirada; bucket sin acceso directo.

**vitest** (`tests/brain/`): rutas válidas e inválidas; importación de zip (ruta que se sale, límites, sin `SKILL.md`, con y sin carpeta raíz); estados; quién publica (administrador sí, editor no); qué ve cada nivel; `withoutSkills` sobre las cinco operaciones; `brainContract` sin `skill`; invariante de S3; conflicto al publicar con borrador cambiado; republicar y retirar.

**Navegador** (`/qa`, base local): un editor arma el borrador e importa un zip; un administrador revisa y publica; un lector ve solo lo publicado; el editor cambia y el lector no lo ve; republicar una versión anterior; retirar.

## 11. Fuera de esta entrega

- Usar una skill desde un asistente, `skill_run`, exportar el zip publicado, qué bibliotecas trae el sandbox: **24.2**.
- Skills en el chat interno y asistente general: **24.3**, después de la Etapa 22 (el asistente general es el candidato a su segundo agente).
- Sincronizar a disco para Claude Code y Codex; servir por la extensión de skills de MCP (SEP-2640): después de la 24.3.
- Grupos o equipos como audiencia: con las reglas generalizadas de la Etapa 22.
- Scripts con red a dominios permitidos. Scripts con credenciales del tenant no se contemplan: eso es una tool.
- Aprobación por dos personas. Renombrar o mover una skill publicada. Editor de código en el navegador.
- Limpieza de objetos del bucket que ninguna fila referencia.

## 12. Despliegue

1. `npx supabase migration list` contra producción y confirmar qué más hay pendiente: `db push` aplica todas.
2. Aplicar la migración **antes** que el código.
3. Desplegar.
4. En `/plataforma/innovas`, agregar la categoría `skill` al brain.
5. Recorrer el criterio de cierre de §1.

## Anexo · Lo que se averiguó para la 24.2 y la 24.3

Investigado el 2026-10-11; verificar de nuevo al escribir esas specs.

- **eve:** una skill dinámica (`defineDynamic` en `session.started` o `turn.started`) puede devolver `files`; eve los escribe en el sandbox de la sesión y los reescribe solo si cambian. En Vercel el sandbox por defecto es Vercel Sandbox. Sin verificar: cuándo arranca el sandbox y cuánto cuesta por sesión.
- **Ningún cliente masivo trae skills desde un servidor MCP todavía.** La extensión de skills de MCP (SEP-2640) está aprobada y solo tiene prototipos; exige aprobación de la persona por skill antes de ejecutar código.
- **Claude Code y Codex** leen el campo `instructions` del servidor MCP. Claude Code descubre skills en `~/.claude/skills` y las recarga en caliente; Codex en `~/.agents/skills`.
- **claude.ai y ChatGPT web:** las skills se suben a mano o las provee un administrador; no hay API para empujarlas. La documentación de Anthropic se contradice sobre el aprovisionamiento a toda la organización. El sandbox de claude.ai sale por defecto solo a gestores de paquetes. Un conector MCP propio da tools; prompts y recursos no están documentados.
- De ahí la decisión de la 24.2: `skill_run` ejecuta del lado de la plataforma, que es el único camino que da scripts siempre al día en cualquier cliente con tools.
