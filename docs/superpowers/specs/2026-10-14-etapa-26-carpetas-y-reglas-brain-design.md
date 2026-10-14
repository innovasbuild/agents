# Etapa 26 · Carpetas, reglas y estructura del brain — diseño

**Fecha:** 2026-10-14
**Etapa:** 26 (nueva en el roadmap), con tres entregas: 26.1 carpetas, 26.2 instrucciones y reglas, 26.3 estructura obligatoria. Una spec, un plan y un PR por entrega. Cada entrega depende de la anterior.
**Base:** `2026-09-13-brain-design.md` (modelo de datos, `brain_upsert_page`), `2026-09-24-etapa-11-brain-mcp-design.md` (contrato de tools y D4: por MCP escribe una persona), `2026-10-05-etapa-17-permisos-brain-design.md` (permisos por nodo, herencia, A5 y A6), `2026-10-08-etapa-18-1-borrado-paginas-brain-design.md` (plan de limpieza de links en código y aplicación atómica en SQL). Esta spec **reemplaza** la lista `categories` y la clave `requiredFrontmatter` de la config del binding `wiki`, y la edición de categorías de la consola de plataforma (spec 21.4 §4.2).

## 1. Objetivo y criterio de cierre

Que el brain de una empresa sea **gestionable desde el brain mismo**:

- Las categorías se ven aunque estén vacías, y un administrador las crea, renombra y anida desde el árbol.
- El brain tiene instrucciones visibles (cómo se comporta y cómo decide), y cada carpeta puede tener reglas propias.
- Esas reglas **le llegan solas** a quien lee o escribe, por MCP o en el chat, sin depender de que el agente se acuerde de buscarlas.
- Lo que entra a una carpeta puede estar obligado a cumplir una estructura de campos.

Pedido de Matías el 2026-10-14, a partir del brain de O'Keefe. En la consola puso las categorías `empresa, producto, comercial, operacion, tecnologia, marketing, talento, proyectos` y el índice mostraba solo `operacion`, `proyectos`, `talento` y `tecnologia`. Además, el brain que antes tenía en carpetas locales gobernaba su comportamiento con dos archivos (`AGENT.md` y `BRAIN.md`, hoy `operacion/agent` y `operacion/brain`) y con reglas por ruta (`talento/personal/00-reglas`), y la plataforma no los lee.

### 1.1 Por qué faltaban categorías (diagnóstico)

La categoría es un campo de cada página, validado contra la lista de la config, que solo aparece como etiqueta. Las carpetas del árbol salen de los prefijos de las rutas de las páginas (`visibleTree`, `lib/brain/core/access/tree.ts`), y el índice muestra solo nodos con hijos (`app/[tenant]/brain/page.tsx`). Una categoría sin páginas bajo ese prefijo no existe en el árbol. Las dos ideas nunca se conectaron.

### 1.2 Terminado cuando

En producción, en el tenant `okeefe`:

1. **26.1.** El índice muestra `empresa`, `producto`, `comercial` y `marketing` vacías, cada una con su descripción. Un administrador crea `comercial/sucursales` vacía, y renombra una carpeta con páginas enlazadas desde otras: los enlaces quedan apuntando a la ruta nueva y `/brain/p/<ruta-vieja>` redirige.
2. **26.2.** Desde Claude Code por MCP, un `brain_upsert` en `talento/personal/<x>` sin `rulesRevision` se rechaza con `rules_required` y trae la cascada (instrucciones del brain más `talento/personal/00-reglas`). El reintento con el valor devuelto entra. En el chat de la plataforma, el asistente nombra las instrucciones del brain sin haber llamado a ninguna tool.
3. **26.3.** Una ficha en `talento/personal` sin `reporta_a` se rechaza con `invalid_fields`. "Nueva página" en esa carpeta arranca con la plantilla.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Una carpeta de primer nivel es una categoría.** La categoría de una página sale del primer segmento de su ruta; nadie la elige. La columna `category` sigue existiendo y la calcula el servidor (§3.1) | Elimina las dos ideas paralelas que causaron el diagnóstico. Es el patrón que ya tiene `skills/` (categoría `skill` atada a la ruta) |
| D2 | **Las carpetas son filas** (`brain_folders`), con ruta y descripción. Existen vacías. Una página no puede vivir en una carpeta que no existe | Es lo pedido: que se vean aunque no tengan contenido |
| D3 | **Los permisos son los de la Etapa 17.** Crear, renombrar, mover, borrar una carpeta vacía o editar sus reglas exige ser administrador del nodo; las carpetas de primer nivel, de la raíz. Sin roles nuevos | La tabla `roles-brain` y la identidad por email de O'Keefe quedan reemplazadas por permisos que el servidor ya aplica |
| D4 | **Mover y renombrar son una sola operación sobre un prefijo,** con el plan en código puro y la aplicación atómica en SQL. Reescribe los enlaces, mueve permisos y carpetas y deja alias de las rutas viejas | Reusa el patrón del borrado (18.1 D5, D9). Un movimiento a medias deja enlaces rotos |
| D5 | **Mover no tiene tool.** Solo desde la web, por una persona | Es un cambio estructural. El agente lo propone en texto |
| D6 | **Instrucciones y reglas son páginas con un nombre reservado:** `00-reglas`, en la raíz (instrucciones del brain) y en cualquier carpeta | Tienen historial, permisos y editor sin construir nada nuevo. Es el nombre que O'Keefe ya usa |
| D7 | **Las reglas forman una cascada** de la raíz a la carpeta de la página. Cada nivel solo agrega, y ante una contradicción gana el de arriba | Es la semántica del contrato de O'Keefe, y la más fácil de razonar |
| D8 | **Las reglas llegan solas:** la raíz al arrancar una sesión (chat y `instructions` del MCP), la carpeta en `brain_read`, la cascada completa en `brain_rules` | No depende de que el agente las busque |
| D9 | **La escritura exige las reglas:** `brain_upsert` en una ruta con reglas pide `rulesRevision`. Si falta o está viejo, rechaza con `rules_required` y devuelve la cascada y el valor vigente | Es la única garantía real por MCP: un cliente puede ignorar `instructions`, pero no puede escribir sin recibir las reglas. Además fuerza la relectura cuando cambian |
| D10 | **El agente del chat no escribe `00-reglas` ni `00-plantilla`.** Por MCP sí, si quien conecta administra esa carpeta | Las reglas son gobierno y las decide una persona (CLAUDE.md, orquestación). Por MCP escribe una persona (D4 de la Etapa 11) |
| D11 | **Los campos obligatorios viven en `frontmatter`** y se declaran en un bloque ` ```campos ` de la `00-reglas`. Se acumulan por la cascada | El `frontmatter` ya es estructurado y validable. El bloque deja la regla legible por una persona y por la máquina en el mismo lugar |
| D12 | **"Obligatorio" quiere decir que la clave está;** `null` vale | Es la convención de O'Keefe: un dato desconocido va `null` |
| D13 | **Una página vieja que no cumple se lee igual,** y la próxima escritura tiene que completarla | No bloquea lectura ni rompe el brain al publicar una regla nueva |
| D14 | **Plantilla por carpeta** en la página reservada `00-plantilla`. Vale la más cercana, sin cascada | Una plantilla no se puede sumar a otra con sentido |
| D15 | **Solo el proveedor `wiki`.** Un brain externo por `mcp` no tiene carpetas, reglas ni campos propios; `brain_rules` responde vacío | Igual que el editor (E4) y el borrado (18.1 D10) |
| D16 | **La adaptación del contenido de O'Keefe la hace una persona,** con ayuda, al cerrar cada entrega. El código no reescribe páginas de un tenant | Nada específico de un tenant en código |

## 3. 26.1 · Carpetas

### 3.1 Modelo

Tabla nueva `brain_folders`:

| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid` | pk |
| `tenant_id` | `uuid` | not null, fk a `tenants` |
| `path` | `text` | not null, `SLUG_PATTERN`, única por tenant |
| `description` | `text` | hasta 300 caracteres, puede ser vacía |
| `created_by` | `uuid` | persona que la creó; null en la migración |
| `created_at`, `updated_at` | `timestamptz` | |

- RLS prendido y sin políticas para `authenticated`, como `brain_pages`: la lee y la escribe el servidor con `service_role`, y lo que ve cada persona lo filtra `withAccess` (Etapa 17).
- Índice único `(tenant_id, path)`. Una carpeta de más de un segmento exige que exista su carpeta padre (se valida en la función que la crea).
- Una página nueva en una carpeta que no existe se rechaza con `folder_not_found`. Lo chequea el proveedor `wiki` (`createWikiProvider`) para toda escritura que no sea del import. `brain_upsert_page`, en cambio, **crea las carpetas que falten** del camino de una página nueva. Así el invariante "toda página tiene su carpeta" lo garantiza la base, y el import y los tests SQL existentes siguen andando sin cambios.
- Una página nueva en la raíz (sin `/`) se rechaza con `folder_required`, salvo `00-reglas` (26.2). Las que ya existían antes de esta etapa siguen editándose (§3.4).
- La categoría la calcula el proveedor con `categoryForPath(slug)`: el primer segmento, con `skills` → `skill`. Las páginas sueltas de la raíz conservan la suya. La función SQL `brain_category_for(path)` hace lo mismo para lo que escribe la base sola (mover, en la 26.1b).
- **Ajuste del 2026-10-14, al planificar:** la lista `categories` de la config del binding **se queda**, pero como reflejo de las carpetas de primer nivel. La mantiene sola `brain_sync_categories(tenant)`, que llaman en la misma transacción todas las funciones que crean, borran o mueven una carpeta de primer nivel. Nadie la edita: `platform_set_brain_categories` se borra. Así no cambia ninguno de los llamadores de `resolveBrainBinding`: `brainContract`, las tools del agente, el MCP y el editor siguen leyendo `config.categories`. `requiredFrontmatter` sigue en la config hasta la 26.3.
- No se puede borrar la última carpeta de primer nivel (`folder_last`): `parseWikiConfig` exige al menos una categoría, y sin ella el brain del tenant dejaría de resolverse.

### 3.2 Pantallas

- El índice y el árbol muestran todas las carpetas visibles, incluidas las vacías, con su descripción en el índice y como `title` en el árbol. `visibleTree` recibe las carpetas además de las páginas, y un nodo vacío deja de podarse en `withoutArchived` si es carpeta.
- Menú de una carpeta, para su administrador: **Nueva subcarpeta**, **Renombrar**, **Mover a…**, **Editar descripción**, **Reglas de la carpeta** (26.2) y **Borrar** (solo si está vacía; si no, el ítem está deshabilitado con el motivo).
- Arriba del árbol, para el administrador de la raíz: **Nueva carpeta** e **Instrucciones del brain** (26.2).
- "Nueva página" ofrece como destino las carpetas donde la persona es editora, igual que hoy `editableFolders`, ahora con las vacías.
- La consola de plataforma deja de mostrar el editor de categorías y pasa a mostrar las carpetas de primer nivel, solo lectura, con un link al brain del tenant.

### 3.3 Mover y renombrar

Una operación, `movePath(from, to)`, para los cuatro casos: renombrar una carpeta, moverla, renombrar una página y moverla.

1. **Plan (puro):** `planMove(pages, folders, from, to)` en `lib/brain/core/move.ts` devuelve:
   - las páginas afectadas (`from` y todo lo que cuelga) con su slug nuevo y su revisión;
   - las páginas con `[[enlaces]]` hacia alguna afectada, con el cuerpo reescrito y su revisión. Se cambia el destino y se conservan el ancla y el alias. Incluye las archivadas y las que la persona no ve, como el borrado (18.1 D4). La reescritura la hace `retargetWikilinks(body, mapping)` en `wikilinks.ts`, que respeta `CODE_PATTERN`;
   - las carpetas y las reglas de acceso con su ruta nueva.
2. **Aplicación (atómica):** `brain_move_path(p_tenant, p_actor, p_from, p_to, p_plan)`, función SQL `security definer` que, en una transacción:
   - verifica que ninguna página del plan cambió de revisión. Si una cambió, aborta todo con `conflict` y la pantalla rearma el plan;
   - verifica que `to` no exista como página ni como carpeta. Si existe, `destination_exists`: no se fusiona;
   - cambia el slug de cada página afectada conservando su `page_id`, y deja una revisión por página con `reason` `mover: <from> → <to>` y `author_kind` `user`;
   - reescribe los cuerpos con enlaces por `brain_upsert_page` con su `baseRevision`, con el mismo `reason`;
   - actualiza `brain_folders.path` y `brain_access_rules.path` de ese prefijo;
   - inserta un alias por cada slug viejo en `brain_slug_aliases`;
   - agrega a `events` un `brain.moved` con `from`, `to`, cantidad de páginas movidas y de páginas reescritas.
3. **Alias:** tabla `brain_slug_aliases` (`tenant_id`, `old_slug`, `page_id`, `created_at`; pk `(tenant_id, old_slug)`, RLS sin políticas). `brain_read` de una ruta vieja devuelve la página actual con `movedFrom`, y `/brain/p/<ruta-vieja>` redirige con 308. Crear una página en una ruta que era alias borra el alias.

**Permisos:** administrador de `from` y editor o más en el padre de `to`. Si `from` o `to` es de primer nivel, administrador de la raíz.

**Límites:**
- Hasta 500 páginas afectadas por operación; más, `too_large`.
- `skills/` y lo que cuelga no se mueven ni se renombran (`reserved_path`): los paquetes publicados apuntan a su ruta.
- `00-reglas` y `00-plantilla` se mueven con su carpeta, pero no se pueden mover solas.

**Pantalla:** un diálogo con el plan antes de confirmar ("se mueven 14 páginas, se arreglan enlaces en 6 páginas, viajan 2 reglas de acceso"). Las páginas reescritas que la persona no ve se cuentan sin nombrarlas (18.1 D4). En 26.3, también muestra las páginas que no cumplen los campos del destino, sin bloquear.

### 3.4 Migración

Una migración SQL, más un script de reporte que se corre antes:

- **Reporte, en seco (`npm run brain:folders-report -- --tenant <slug>`):** lista las carpetas que se crearían, las páginas cuya `category` no coincide con el primer segmento de su ruta y las páginas sueltas en la raíz. No escribe. Lo lee una persona antes de aplicar.
- **Migración:** por cada tenant con binding `wiki`, crea en `brain_folders` una fila por cada categoría de `config.categories` y una por cada prefijo de ruta existente (todos los niveles), y copia `config.requiredFrontmatter` como pendiente de pasar a la `00-reglas` de la raíz (§5.4).
- Las páginas con categoría distinta del primer segmento **conservan la suya** hasta que una persona las mueva. `brain_upsert_page` recalcula la categoría en su próxima escritura, y el reporte las nombra para que no sea una sorpresa.
- Las páginas sueltas en la raíz que ya existen conservan su categoría y se pueden seguir editando. Una nueva no se puede crear.

## 4. 26.2 · Instrucciones y reglas

### 4.1 Páginas reservadas

- `00-reglas` en la raíz: **instrucciones del brain**. `00-reglas` dentro de una carpeta: **reglas de la carpeta**. `00-plantilla` dentro de una carpeta: plantilla (26.3). `RESERVED_LEAVES = ["00-reglas", "00-plantilla"]` en `lib/brain/core/types.ts`.
- Su categoría es la de su carpeta. La de la raíz tiene categoría `brain`, reservada: no se puede crear una carpeta `brain`.
- Escribirlas exige ser administrador de su carpeta (de la raíz, para la de la raíz). `validateWrite` lo chequea en todas las superficies.
- El agente del chat no las escribe (D10): `brain_upsert` de las tools del agente devuelve `reserved_slug` con un texto que le dice que lo proponga en la conversación. Por MCP pasan, con el permiso de arriba.
- El árbol no las lista como páginas: el menú las abre como "Instrucciones del brain" y "Reglas de la carpeta", y la carpeta muestra un indicador cuando tiene reglas. La búsqueda las encuentra, con la insignia "Reglas".
- Tamaño: la de la raíz, hasta 12 000 caracteres (entra en cada sesión); la de una carpeta, hasta 20 000. Guardar una `00-reglas` que haga pasar alguna cascada de 40 000 caracteres se rechaza con `rules_too_large`, nombrando la ruta.

### 4.2 Cascada

`rulesFor(path, pages)` en `lib/brain/core/rules.ts`, pura, devuelve:

```ts
interface RulesCascade {
	revision: string; // opaca, ver abajo
	chain: Array<{ path: string; slug: string; revision: number; body: string }>;
	fields: FieldSpec[]; // 26.3
	template: { slug: string; body: string; frontmatter: Record<string, unknown> } | null; // 26.3
}
```

- `chain` es la `00-reglas` de la raíz más la de cada carpeta de `ancestorChain(path)` que tenga una activa, en ese orden. Las archivadas no cuentan.
- `revision` es un hash corto (sha-256, 16 caracteres en hex) de los pares `slug:revision` de la cadena. Si no hay cadena, es la cadena vacía y la ruta "no tiene reglas".
- Las reglas se aplican según los permisos de quien escribe: una `00-reglas` que la persona no puede leer igual le llega en la cascada, porque gobierna lo que escribe. Se expone solo su cuerpo y su ruta, nunca páginas hermanas.

### 4.3 Entrega por canal

| Canal | Qué recibe |
|---|---|
| Chat: todo agente con brain declarado (`tenant_agents.config.brain` distinto de `none`) | En `session.started`, un bloque con la `00-reglas` de la raíz y una tabla de las carpetas de primer nivel con su descripción, armada de `brain_folders`. Lo arma `brainSessionInstructions(tenantId)` en `lib/brain/adapters/` y lo suman el asistente y outreach a sus instrucciones dinámicas |
| MCP, al conectar | Lo mismo en el campo `instructions` del servidor, más una línea fija: "Cada carpeta puede tener reglas propias: llegan en `brain_read`, en `brain_rules` y en el rechazo de `brain_upsert`." Se suma a las instrucciones de skills que ya existen |
| `brain_read` | La página y `rules: { revision, chain }`, con la `chain` **sin** la raíz (ya llegó al arrancar) |
| `brain_rules({ path })`, tool nueva de lectura | La cascada completa, raíz incluida, más `fields` y `template` (26.3). Sirve para una ruta que todavía no existe. Cuenta como lectura en `brain_mcp_usage` |
| `brain_upsert` | Input nuevo opcional `rulesRevision`. Si la ruta tiene reglas y el valor falta o no coincide, devuelve `rules_required` con la cascada completa y el `revision` vigente, sin escribir |
| Editor web | Un panel "Reglas que aplican", colapsable, al lado del editor y en "Nueva página", con la cascada y un link a cada `00-reglas`. No exige nada a las personas |

- Por la raíz incluida en `rules_required`, un cliente MCP que ignora `instructions` recibe las instrucciones del brain antes de su primera escritura.
- `brain_rules` va en `TOOL_LABELS` (`lib/agents/running-tool.ts`) como "Leyendo las reglas del brain".
- Las descripciones de `brain_read` y `brain_upsert` del contrato nombran `rulesRevision` y el rechazo, para que el modelo sepa reintentar con el valor devuelto.
- Un rechazo `rules_required` no cuenta como error en los logs ni en el uso: es parte del flujo.

## 5. 26.3 · Estructura obligatoria

### 5.1 Declaración

La `00-reglas` de cualquier nivel puede llevar **un** bloque cercado `campos`:

````
```campos
- persona
- email: texto
- ingreso: fecha
- reporta_a: ruta
- estado_persona: opciones(activo, licencia, baja)
```
````

- Una línea por campo: `- <clave>` o `- <clave>: <tipo>`. La clave sigue el patrón actual del frontmatter (`^[a-z][a-z0-9_]{0,40}$`).
- Hay cinco tipos: `texto` (por defecto), `fecha` (`YYYY-MM-DD`), `numero`, `ruta` (un slug que existe como página en el brain del tenant) y `opciones(a, b, …)`.
- Para no romper lo que ya existe, el lector acepta también un bloque `lint` con claves sin tipo, como el de `talento/personal/00-reglas`.
- `parseFieldBlock(body)` en `lib/brain/core/fields.ts` lo lee. Una línea que no se entiende hace que guardar esa `00-reglas` se rechace con `invalid_rules` y el número de línea.
- Los campos se acumulan por la cascada. Si dos niveles declaran la misma clave con tipos distintos, vale el de más arriba, y guardar la de abajo se rechaza con `invalid_rules`.

### 5.2 Validación

- `validateFields(frontmatter, fields, exists)` es pura y devuelve la lista de problemas (`falta`, `tipo`). La llama `validateWrite` en las tres superficies después del chequeo de `rulesRevision`.
- Valida las páginas `activo` y `borrador`. Las archivadas y las reservadas no se validan.
- `null` cumple (D12). Una clave que está y no tiene el tipo declarado no cumple.
- El rechazo es `invalid_fields` con `[{ campo, problema, esperado }]`. En el editor, cada campo marcado en el formulario.
- Una página que no cumple y no se escribe sigue como está (D13).

### 5.3 Plantilla y formulario

- `<carpeta>/00-plantilla`: su cuerpo y su `frontmatter` son el arranque de "Nueva página" en esa carpeta y en las de abajo que no tengan una propia. `brain_rules` la devuelve en `template`.
- El editor muestra los `fields` de la cascada como un formulario arriba del cuerpo. Las claves del `frontmatter` que no están declaradas se ven como hoy.
- Cada carpeta con campos tiene una vista **Cumplimiento**, enlazada desde su menú, que lista las páginas que no cumplen con lo que les falta. Cubre la parte de máquina del lint mensual de O'Keefe.

### 5.4 Migración

- `config.requiredFrontmatter` de cada tenant se copia, en el reporte de §3.4, como sugerencia de bloque `campos` para la `00-reglas` de la raíz. La pega una persona. Después la clave se quita de la config.
- Script en seco por defecto, `npm run brain:frontmatter-from-body -- --tenant <slug> [--apply]`: pasa al `frontmatter` las claves del primer bloque ` ```yaml ` del cuerpo y saca el bloque del cuerpo. Deja una revisión con `author_kind` `import` y `reason` `estructura: metadatos al frontmatter`. No pisa una clave que ya está en el `frontmatter` y lista los conflictos. Es genérico: sirve para cualquier brain importado de una bóveda que guardaba los metadatos en el cuerpo.

## 6. Errores del contrato

Todos con mensaje en castellano y lo necesario para reintentar.

| Código | Cuándo | Trae |
|---|---|---|
| `folder_not_found` | Se escribe una página en una carpeta que no existe | La carpeta y la más cercana que existe |
| `folder_not_empty` | Se borra una carpeta con algo adentro | Cantidad de páginas y subcarpetas |
| `destination_exists` | Se mueve a una ruta ocupada | La ruta |
| `reserved_path` | Se mueve `skills/`, se crea la carpeta `brain` o se mueve sola una página reservada | La ruta |
| `reserved_slug` | El agente del chat escribe una `00-reglas` o `00-plantilla`, o alguien sin administración de esa carpeta | Qué hacer |
| `rules_required` | Escritura con `rulesRevision` faltante o viejo | `revision` y la cascada completa |
| `rules_too_large` / `invalid_rules` | Se guarda una `00-reglas` inválida | La ruta, el límite o la línea |
| `invalid_fields` | La página no cumple los campos | La lista de problemas |
| `too_large` | Mover más de 500 páginas | La cantidad |
| `moved` (aviso, no error) | `brain_read` de una ruta vieja | `movedFrom` y la ruta actual |

## 7. Pruebas

- **Unitarias:**
  - `planMove`: prefijos, anclas y alias, enlaces dentro de código, archivadas, páginas no visibles.
  - `retargetWikilinks`.
  - `rulesFor`: cadena, archivadas, revisión estable, raíz sola.
  - `parseFieldBlock`: los cinco tipos, `lint` heredado, líneas inválidas.
  - `validateFields`: `null`, tipos, `ruta` inexistente.
  - `brainContract` con las categorías desde carpetas.
- **pgTAP:**
  - RLS de `brain_folders` y `brain_slug_aliases` (`authenticated` no lee ni escribe).
  - `brain_move_path`: todo o nada, conflicto que aborta, reglas de acceso que viajan, alias, `destination_exists`, límite.
  - `brain_upsert_page`: rechaza `folder_not_found` y calcula la categoría.
- **Integración de tools:** `brain_upsert` sin `rulesRevision` en una ruta con reglas devuelve `rules_required` con la raíz, y el reintento entra; `brain_read` de un alias devuelve `movedFrom`; el agente del chat recibe `reserved_slug` al escribir una `00-reglas`.
- **Eval del asistente** (`agents/asistente/evals/`): con un brain de prueba que tiene `persona/00-reglas` con campos y plantilla, se le pide "cargá a Juan Pérez, vendedor de la sucursal Centro". Pasa si llama a `brain_rules` o recibe `rules_required`, y la escritura final cumple los campos sin que nadie se lo pida.
- `npm run docs:check` en verde en cada entrega: la tabla nueva, la tool nueva y las rutas nuevas tienen página.

## 8. Trabajo con O'Keefe al cerrar cada entrega

Lo hace una persona, con ayuda del asistente o de Claude Code por MCP. No va en el código (D16).

- **26.1:** correr el reporte, decidir las páginas con categoría distinta de su ruta, cargar la descripción de las ocho categorías (sale de la tabla "Categorías" de `operacion/brain`).
- **26.2:**
  - Fundir `operacion/agent` y `operacion/brain` en `00-reglas` de la raíz. Se queda el criterio: tests de deslinde, tipos de página, canon contra estado, convenciones de contenido, flujos de ingest y query, prohibiciones de contenido.
  - Se va lo que ahora hace la plataforma: roles e identidad por email, escritura con `baseRevision`, el log mensual (lo reemplaza el historial de revisiones con `reason`), la frase de arranque.
  - Archivar `operacion/roles-brain`, `operacion/identidad-verificada`, `operacion/instrucciones-proyecto` y `operacion/agent`, con un aviso que apunta a `00-reglas` y a los permisos del brain.
  - `talento/personal/00-reglas` queda como está.
- **26.3:**
  - Pasar el bloque `lint` de `talento/personal/00-reglas` a `campos` con tipos (`ingreso: fecha`, `reporta_a: ruta`, `estado_persona: opciones(...)`).
  - Mover `talento/personal/plantilla-ficha` a `talento/personal/00-plantilla`.
  - Correr `brain:frontmatter-from-body` en seco y después con `--apply`.

## 9. Fuera de alcance

- Tool de mover para el agente o el MCP (D5).
- Papelera o deshacer de un movimiento. Se revierte con otro movimiento, y el historial de cada página queda.
- Validar las exigencias en prosa de una `00-reglas` ("listado y ficha coinciden"). Siguen siendo instrucciones para el agente.
- Carpetas, reglas o campos en un brain externo por `mcp` (D15).
- Búsqueda o filtros por campos del `frontmatter`. Con los campos ya estructurados es posible después.
- Lint periódico automático (un workflow que corre la vista Cumplimiento y avisa). Se puede sumar como workflow por capacidad cuando haga falta.
