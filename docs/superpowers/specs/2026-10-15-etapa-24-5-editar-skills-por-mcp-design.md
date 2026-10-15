# Etapa 24.5 · Crear y editar skills de empresa por MCP — diseño

**Fecha:** 2026-10-15
**Etapa:** 24, entrega 24.5. No depende de la 24.3 (chat interno) ni de la 24.4 (`skill_run`): solo de lo que ya sirve el MCP del brain (24.2a y 24.2b).
**Base:** `2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md` (paquete, borrador y versión publicada, S1 a S13), `2026-10-13-etapa-24-2a-skills-por-mcp-design.md` (catálogo publicado por MCP), `2026-10-05-etapa-17-permisos-brain-design.md` (permisos por nodo).
**Revisa:** la parte de S6 que dice "los asistentes nunca ven una skill por MCP". Sigue valiendo para `brain_search`, `brain_read` y `brain_upsert` y para quien no edita; cambia para quien es editor de esa skill (§2, D1).

## 1. Objetivo y criterio de cierre

Que una persona que es editora de skills en su empresa le pida a Claude, ChatGPT u otro cliente conectado al brain por MCP "creá la skill X" o "cambiá tal cosa en la skill Y", y el cambio quede aplicado **en el borrador**, sin pasar por la web. Un administrador sigue revisando y publicando desde la web (S5): lo que usan los demás no cambia hasta ahí.

Pedido de Matías (2026-10-15): "que quienes sean editores en skills puedan modificarlas directo desde Claude, GPT, etc.; si pido un cambio en una skill que lo aplique directo", y que también puedan crear skills nuevas. Decidido en el brainstorming: **directo al borrador**; publicar queda solo en la web.

**Terminado cuando**, en producción, en el tenant `innovas`, con un editor conectado por MCP desde Claude y desde ChatGPT:

1. El editor crea una skill con `skill_create` y le agrega un archivo con `skill_draft_write_file`. En la web aparece como borrador sin publicar, con revisión y archivo.
2. Pide un cambio sobre una skill existente y se aplica: la pantalla de la skill dice "con cambios sin publicar" y el historial muestra la revisión con su autor y el motivo.
3. `skill_load` sigue devolviendo la versión publicada; `skill_draft_read` devuelve el borrador con el cambio.
4. Una persona con rol lector, y una sin acceso a la carpeta, no ven las tools nuevas ni la skill nueva por ningún canal.
5. Un administrador publica desde la web y la carga siguiente trae el cambio.
6. `brain_read` y `brain_upsert` sobre `skills/...` siguen rechazando.

## 2. Decisiones

Las de la 24.1 y la 24.2 siguen vigentes salvo lo que dice D1. Esta entrega agrega:

| # | Decisión | Por qué |
|---|---|---|
| D1 | **El borrador sale por MCP solo para quien es editor de esa skill**, por tools propias (`skill_draft_*`, `skill_create`). Las tools del brain no cambian | Un editor ya ve el borrador en la web; el lector no. S6 protegía al lector, no al editor |
| D2 | **Todo cambio por MCP va al borrador.** Publicar, retirar y borrar siguen solo en la web | S5: el texto de una skill llega como instrucciones a todos los asistentes de la empresa. Un cliente MCP lee documentos y mails ajenos; una instrucción metida ahí no puede llegar a toda la empresa sin una persona que revise |
| D3 | **Permiso: el que ya existe.** Editar exige ser editor de la skill; crear, ser editor de la carpeta destino o administrador | Se reusa `resolveAccess` y `withAccess`; nada nuevo en permisos |
| D4 | **Quien no puede editar recibe "no existe", igual que una ruta inexistente** | El canal no revela nombres (24.2a §3) |
| D5 | **Las tools se registran solo para quien puede editar algo bajo `skills/`** y solo si la categoría `skill` está habilitada para la empresa | Un lector no ve tools que no puede usar. Un editor sin skills publicadas igual puede crear la primera: no dependen del catálogo publicado |
| D6 | **La edición es puntual:** se reemplaza un fragmento que aparece una sola vez. No hay "reescribir todo" | Es lo que hace un pedido de "cambiá X por Y" y evita pisar sin querer lo que otro editó |
| D7 | **El `SKILL.md` se edita como texto completo** (frontmatter más cuerpo), el mismo que arma el zip, y después se vuelve a validar | El modelo trabaja con un solo documento, no con campos sueltos |
| D8 | **Por MCP solo texto.** Archivos de hasta 256 KB; los binarios y los de más peso siguen en la web | Mismo criterio que `skill_file` (24.2a M6) |
| D9 | **Una skill se identifica por nombre o por ruta completa** (`skills/…`) | Entre borradores el nombre puede repetirse en dos carpetas: la ambigüedad se resuelve con la ruta |
| D10 | **Sin migración** | Todo se apoya en `brain_pages`, `brain_skill_files` y sus funciones |

## 3. Qué ve y qué puede cada uno

| Situación | Tools nuevas | Resultado |
|---|---|---|
| Editor de al menos una skill o de una carpeta bajo `skills/` | Las cuatro | Lee y cambia el borrador de las skills donde edita; crea dentro de las carpetas donde edita |
| Administrador de la empresa | Las cuatro | Todas las skills, todas las carpetas |
| Lector, o sin reglas bajo `skills/` | Ninguna | Igual que hoy |
| Cualquiera, sobre una skill donde no edita | — | "No existe" (D4) |
| Categoría `skill` no habilitada | Ninguna | Igual que hoy |
| Proveedor que no es `wiki` | Ninguna | Igual que hoy (S13) |

Una skill creada por MCP es un borrador sin publicación vigente: nadie más la ve (ni `skill_list`, ni `skill_load`, ni el zip) hasta que un administrador la publique.

## 4. Tools

Se registran en el servidor MCP del brain (`/brain/<slug>/mcp`), después de las del catálogo. Cuentan como **escritura** en el limitador, salvo `skill_draft_read`, que cuenta como lectura. Errores con el formato de siempre (`toToolError`). Las respuestas de las cuatro incluyen `reviewUrl`: el link a la pantalla de la skill en la web, con el dominio de la empresa si el pedido llegó por él.

### 4.1 `skill_draft_read`

`{ skill, path? }` — `skill` es nombre o ruta (D9).

- Sin `path`: devuelve `{ ok, slug, name, revision, state, publishedVersion, skillMd, files: [{ path, size, readable }] }`.
  - `skillMd` es el texto completo, con encabezado YAML (`name`, `description`, y `license` y `compatibility` si están) y cuerpo, armado como el zip (`skill-md.ts`, que se generaliza para recibir el borrador).
  - `state`: `sin_publicar`, `con_cambios` (la revisión o el hash de archivos del borrador difieren de lo publicado), `al_dia` o `retirada`. Sale de la misma comparación que usa la web (`state.ts`).
- Con `path`: el archivo de texto del borrador, con `{ path, size, content }`. Tope de 256 KB y solo texto (D8).

Es la única forma de que el asistente vea su propio cambio: `skill_load` y `skill_file` siguen sirviendo lo publicado (24.2a M2).

### 4.2 `skill_draft_edit`

`{ skill, path?, old, new, reason }`. `path` vacío significa el `SKILL.md`.

1. Resuelve la skill y verifica que la persona es editora (D3, D4).
2. Lee el borrador en ese momento y exige que `old` aparezca **exactamente una vez**. Si no aparece: "no aparece en el borrador". Si aparece más de una vez: "aparece N veces, sumá contexto". `old` no puede estar vacío.
3. **`SKILL.md`:** aplica el reemplazo sobre `skillMd` (D7), lo vuelve a leer con `parseSkillMd` y valida: encabezado YAML válido, `description` de hasta 1024 caracteres (un borrador que ya la tenía no puede quedar sin ella; uno que venía sin `description` se puede seguir editando, porque publicar ya exige que esté), `compatibility` de hasta 500. Un cambio al campo `name` se rechaza: el nombre es la ruta y no cambia. Guarda con `baseRevision` igual a la revisión leída: si alguien guardó en el medio, conflicto y no se pisa nada. Conserva el resto del frontmatter del brain sin tocar. Tope de 100 KB para el cuerpo, el de `brain_upsert`.
4. **Archivo de texto:** lo lee del borrador por su `sha256`, aplica el reemplazo, y lo guarda con `putSkillFile`. Si el contenido cambió entre la lectura y la escritura, gana la última escritura: los archivos no tienen revisión y editarlos a la vez es raro; se declara y no se resuelve acá.
5. Responde `{ ok, slug, path, revision?, state, reviewUrl, message }`. El mensaje dice que el cambio **está en el borrador y no en vivo**, y que un administrador lo publica desde la web.

`reason` es obligatorio (hasta 200 caracteres). Cuando el cambio es en el `SKILL.md` queda en la revisión como `Edición por MCP: <reason>`; en un archivo el cambio deja `brain.skill_file_added` con la persona y la ruta, y el motivo se acepta pero no se guarda.

### 4.3 `skill_draft_write_file`

`{ skill, path, content }` — crea o reemplaza un archivo de texto del paquete. Sin `reason`: `brain_skill_put_file` no lo guarda.

- `path` válido según `isValidFilePath` (24.1 §5.2); `SKILL.md` no es un archivo del paquete y se rechaza con un mensaje que manda a `skill_draft_edit`.
- `content` de hasta 256 KB (D8). Cuenta para los topes del paquete: 50 archivos y 20 MB; los hace cumplir la base (`brain_skill_put_file`).
- Usa `putSkillFile`. Respuesta como la de 4.2.

### 4.4 `skill_create`

`{ name, folder?, title?, description, instructions, compatibility?, reason }`

- La ruta es `skills/<folder>/<name>` (o `skills/<name>` sin carpeta). `name` y cada tramo de `folder` siguen la regla de siempre: minúsculas, dígitos y guiones, `name` de hasta 64.
- Permiso: editor de la carpeta destino o administrador (D3), el mismo que "Nueva página acá" en la web.
- Crea la página con categoría `skill`, estado `activo`, sin tags, `title` (por defecto, el nombre), `description` y `compatibility` en el encabezado y `instructions` como cuerpo. Se guarda por el proveedor con los permisos de la persona, como cualquier edición; el chequeo `skillPlacementOk` y la categoría habilitada los hace el mismo camino de la web.
- La carpeta destino tiene que existir (`skills/` siempre existe); si no, el error la nombra y dice que un administrador la crea.
- Si la ruta ya existe: conflicto, no se pisa. Si la categoría `skill` no está habilitada para la empresa: mensaje que lo dice y manda al administrador.
- No chequea si ya hay otra skill publicada con ese nombre: lo valida la publicación (`brain_publish_skill`). Chequearlo acá le diría a un editor qué nombres existen en skills que no ve.
- Respuesta: `{ ok, slug, name, revision, state: "sin_publicar", reviewUrl, message }`.

### 4.5 Instrucciones del servidor y descripciones

Para quien tiene las tools, `McpServer` suma a `instructions` un párrafo: las tools `skill_*` cambian el **borrador**, no lo que usan los demás; para ver el cambio hay que leer con `skill_draft_read`; después de cambiar, avisarle a la persona que un administrador tiene que publicar y darle el link. Si la persona no ve ninguna skill publicada pero sí puede editar, las `instructions` de skills publicadas no se agregan (siguen dependiendo del catálogo, 24.2a §4.5).

Cada descripción de tool dice, en su primera línea, "cambia el borrador, no la versión publicada" o "lee el borrador".

## 5. Código

| Archivo | Qué hace |
|---|---|
| `lib/brain/core/skills/draft.ts` (nuevo, puro) | `createSkillDrafts(deps)` devuelve `read`, `edit`, `writeFile` y `create`. Resuelve nombre o ruta (D9) contra el `overview`, aplica el reemplazo, valida y delega el guardado. Sin Supabase ni Next: vigilado por `tests/brain/boundary.test.ts` |
| `lib/brain/core/skills/skill-md.ts` | Se generaliza para armar el `SKILL.md` desde un borrador (hoy solo desde una copia publicada), y una función inversa que aplica el texto editado al frontmatter y al cuerpo |
| `lib/brain/core/skills/files.ts` | Se reusan `putSkillFile` y el chequeo de editor. Si hace falta, se exporta lo mínimo para no duplicarlos |
| `lib/brain/core/skills/view.ts` | El mensaje de rechazo de `upsert` sobre `skills/` deja de decir "no desde un asistente": manda a las tools `skill_*` para quien edita y deja claro que publicar es desde la plataforma |
| `lib/brain/core/mcp-server/server.ts` | Recibe `skillDrafts?` opcional, registra las cuatro tools y suma el párrafo a `instructions` |
| `lib/brain/core/mcp-server/handler.ts` | Decide si la persona puede editar algo bajo `skills/` (D5), arma `skillDrafts` y se lo pasa. `BrainMcpDeps` suma lo que haga falta (guardado de la página y de archivos) |
| `lib/brain/adapters/mcp-production.ts` | Cablea el guardado con el proveedor `wiki` y `putSkillFile` con el almacén de blobs |

**Frontera del borrador.** El proveedor que arma el handler hoy es `withoutSkills(withAccess(...))` y es lo único que reciben `brain_search`, `brain_read` y `brain_upsert`. `skillDrafts` usa el proveedor **sin** `withoutSkills`, pero solo dentro de `draft.ts`, que verifica el nivel de editor en cada llamada. Un test comprueba que las tools del brain siguen recibiendo el proveedor con la guardia puesta (D1).

**Quién puede editar algo (D5).** Un ayudante puro decide si la persona es administradora o tiene nivel de editor sobre alguna ruta bajo `skills/` (una skill existente o una carpeta donde pueda crear). El plan lo define y lo prueba contra las reglas por carpeta y por persona.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un cliente MCP que lee contenido ajeno edita una skill por una instrucción inyectada | Solo toca el borrador (D2); la revisión humana de un administrador sigue antes de publicar (S5); cada cambio tiene autor y motivo y la pantalla de publicación ya muestra los autores de las revisiones desde la publicación anterior (24.1 §4.4) |
| Dos editores cambian a la vez | Para el `SKILL.md`, `baseRevision` lo convierte en conflicto. Para archivos, gana la última escritura (§4.2) |
| Un cliente crea muchas skills | Cuentan como escritura en el limitador; un borrador sin publicar no llega a nadie |
| El asistente dice "listo, publicado" | Cada respuesta y las `instructions` aclaran que es borrador; `skill_draft_read` devuelve `state` |
| `skill_create` pisa una skill existente | Se verifica que la ruta no exista antes de guardar (ver §8, primer punto) |

## 7. Pruebas

**vitest** (`tests/brain/`):

- `draft`: resolver por nombre y por ruta; nombre ambiguo entre dos carpetas devuelve error que pide la ruta; lector y sin acceso reciben "no existe"; editor de otra carpeta no edita esta; administrador edita todas.
- `edit` sobre `SKILL.md`: fragmento ausente, repetido y vacío; cambio de `description` válido; `description` que queda vacía o de más de 1024; encabezado que queda inválido; cambio del campo `name` rechazado; conflicto de revisión; cuerpo de más de 100 KB.
- `edit` y `write_file` sobre archivos: archivo de texto cambiado; binario o de más de 256 KB; ruta inválida; `SKILL.md` como archivo; tope de 50 archivos y de 20 MB.
- `create`: sin permiso en la carpeta, ruta existente, nombre o carpeta inválidos, `description` vacía o larga, categoría `skill` deshabilitada; la skill nueva no aparece en `skill_list`, `skill_load` ni en el zip, tampoco para otro editor.
- `read`: estados `sin_publicar`, `con_cambios`, `al_dia` y `retirada`; devuelve el borrador y no la versión publicada.
- Servidor MCP: las cuatro tools aparecen para editor y administrador, y para nadie más; un editor sin skills publicadas las ve; `brain_read` y `brain_upsert` sobre `skills/...` siguen rechazando con el mensaje nuevo.
- Frontera: `tests/brain/boundary.test.ts` sigue verde con `draft.ts` en `core`.

**Navegador y clientes** (al cerrar): el criterio de §1 desde Claude y desde ChatGPT, con un editor y con un lector.

## 8. A verificar en el plan

1. **Creación exclusiva. Resuelto al escribir el plan.** El guardado del brain sin `baseRevision` solo crea páginas nuevas: si la ruta existe da conflicto, también en una carrera entre dos altas (índice único). `skill_create` lo usa tal cual, sin chequear antes.
2. **Qué deja el guardado en `events`** y si el canal MCP queda distinguible. La revisión lleva el motivo `Edición por MCP: …`; si hace falta un evento propio, se agrega con el tipo en texto libre, sin migración.
3. **Cómo ve ChatGPT las tools de escritura.** ChatGPT pide confirmación en las tools que declaran escritura: se anotan `readOnlyHint` y `destructiveHint` de cada tool según corresponda.

## 9. Fuera de esta entrega

- Publicar, retirar y borrar skills o archivos por MCP. Cualquier cambio de ese tipo reabre S5 y es una decisión aparte.
- Archivos binarios y de más de 256 KB por MCP, e importar un zip.
- Reescribir el `SKILL.md` entero en una llamada.
- Renombrar o mover una skill: el nombre es la ruta y no cambia.
- Avisar al cliente conectado que cambió la lista de tools (el endpoint es sin estado, como en la 24.2a).

## 10. Despliegue

Sin migración. Va después del cierre de la 24.2b en producción.

1. Mergear y desplegar.
2. Con un editor de `innovas` conectado por MCP, recorrer el criterio de §1 desde Claude y desde ChatGPT.
3. Verificar con un lector que las tools no aparecen y que la skill nueva no se ve.
