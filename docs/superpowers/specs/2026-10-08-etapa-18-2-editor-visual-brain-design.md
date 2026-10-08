# Etapa 18.2 · Editor visual y vista de papel del brain — diseño

**Fecha:** 2026-10-08
**Etapa:** 18 (nueva en el roadmap), entrega 18.2. La 18.1 es el borrado de páginas (`2026-10-08-etapa-18-1-borrado-paginas-brain-design.md`). Son independientes: cada una tiene su plan y su PR.
**Base:** `2026-09-27-editor-brain-design.md` (pantallas del editor, E3, E5, E9), `2026-09-13-brain-design.md` (contrato de escritura, motivo obligatorio), `2026-10-05-etapa-17-permisos-brain-design.md` (permiso por nodo y layout con el árbol). Este documento reemplaza la pantalla `/brain/editar` y la regla "motivo obligatorio" para la edición desde la web.

## 1. Objetivo y criterio de cierre

Que quien puede editar una página del brain **la abra ya en modo edición, con un editor visual de markdown liviano**, y que quien solo lee la vea como una hoja de papel.

Pedido de Matías: que a los que tienen permiso de edición les cargue de una en modo editar, con algún editor WYSIWYG de markdown siempre precargado, liviano y claro, con herramientas para editar todo; la vista sin editor, con fondo blanco y un borde sutil para efecto papel.

**Terminado cuando**, en producción, en el tenant `innovas`:

1. Un editor abre `/brain/p/<slug>` y puede escribir sobre la página sin pasar por otra pantalla; al cambiar algo aparece la barra de guardado.
2. Guarda sin escribir un motivo; el historial muestra la revisión con "Edición desde la web".
3. Desde la barra de herramientas da formato, arma una tabla e inserta un link a otra página del brain, y el markdown guardado es el esperado (`[[slug|alias]]` para el link).
4. Abre una página escrita por el agente, cambia solo una etiqueta y guarda: el cuerpo de la revisión nueva es idéntico al anterior.
5. Un lector ve la hoja de papel, sin controles de edición.
6. Todo anda a 1280 px y a 375 px.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| V1 | **La página abre en modo edición para quien es `editor` o más** del nodo. `/brain/editar/<slug>` redirige a `/brain/p/<slug>` | Es lo pedido. Una sola ruta por página; los links viejos siguen andando |
| V2 | **Guardado explícito** con "Guardar" y "Descartar" en una barra que aparece solo con cambios. Sin autoguardado | Mantiene el historial limpio y el control de conflictos por `baseRevision`. El autoguardado generaría una revisión por pausa |
| V3 | **El motivo es opcional desde la web.** Vacío se registra como `Edición desde la web`. Agente y MCP siguen obligados a darlo | Pedir un motivo en cada corrección frena cuando editar es lo normal |
| V4 | **Tiptap 3 con `@tiptap/markdown`**, barra de herramientas propia con los componentes del sistema de diseño | Es la opción donde la barra y el estilo son nuestros, con la marca del tenant. Milkdown y MDXEditor traen interfaz propia; MDXEditor además pesa mucho más |
| V5 | **El markdown sigue siendo la fuente de verdad.** El editor lo lee y lo vuelve a escribir; nada se guarda en otro formato | El agente, el MCP, el historial y el diff trabajan sobre markdown |
| V6 | **Si el cuerpo no se tocó, se guarda el markdown original**, sin pasar por el editor | Abrir una página y cambiar un metadato no puede reescribir el texto |
| V7 | **La ida y vuelta se prueba primero.** La primera tarea del plan corre texto → editor → texto sobre un corpus y sobre páginas reales. Si altera el markdown de forma inaceptable (§5.3), se frena y se cambia a Milkdown antes de construir la interfaz | Es el riesgo principal y es barato de medir antes |
| V8 | **Interruptor "Markdown"** en la barra: cambia a la vista de código (el textarea actual, con su autocompletado de `[[`) | Salida de emergencia para lo que el editor visual no represente bien |
| V9 | **Los links del brain son un nodo propio** que se lee de `[[slug]]`, `[[slug\|alias]]` y `[[slug#ancla\|alias]]` y se escribe igual | No son markdown estándar; sin nodo propio se romperían en la ida y vuelta |
| V10 | **Sin HTML crudo.** El editor no lo interpreta: se muestra como texto, igual que la vista de lectura (E9) | El agente también escribe páginas; el HTML crudo abriría XSS |
| V11 | **La hoja es blanca en los dos temas**, con dos variables nuevas del sistema de diseño (`--paper`, `--paper-foreground`) | El pedido es "papel". Con variables propias no se cuelan colores fijos en los componentes |
| V12 | **Los metadatos salen del cuerpo de la pantalla**: el título queda arriba de la hoja y el resto va a un panel "Detalles" | Para que el editor se vea liviano |
| V13 | El código de Tiptap vive **fuera de `lib/brain/core`** (`components/brain/editor/`); lo puro que necesite queda en `core` | `core` no importa dependencias de interfaz (test de frontera) |

## 3. Cómo se entra

`/brain/p/[...slug]` decide en el servidor:

- `resolveAccess(slug) === null` → 404.
- `lector` → vista de lectura (§6).
- `editor` o `administrador` → espacio de trabajo en modo edición (§4), con el cuerpo, los metadatos y la revisión de la página.

`/brain/editar/[...slug]` redirige a `/brain/p/<slug>` (permanente). `/brain/nueva` usa el mismo espacio de trabajo en modo "nueva", con el slug editable y la precarga de `?en=` de la 17.3.

Una página archivada también abre en edición para quien puede editarla; el estado se cambia desde "Detalles".

## 4. Espacio de trabajo

Un componente cliente (`components/brain/editor/page-workspace.tsx`) que reemplaza a `page-form.tsx`:

- **Encabezado de la hoja:** el título como campo grande sin borde, y a la derecha "Historial" y "Detalles". Si la 18.1 ya está mergeada, "Borrar página" pasa al pie del panel "Detalles" (misma condición: administrador del nodo).
- **Barra de herramientas** fija arriba de la hoja (pegada al hacer scroll): títulos H1 a H3, negrita, cursiva, tachado, código en línea, lista con viñetas, lista numerada, lista de tareas, cita, bloque de código, línea divisoria, tabla (menú para agregar y quitar filas y columnas y borrar la tabla), link, "Link a página", deshacer, rehacer y el interruptor "Markdown". En 375 px la barra se desplaza en horizontal dentro de sí misma, sin mover la página.
- **Cuerpo:** el editor, con la misma tipografía que la vista de lectura (`.brain-prose`).
- **Panel "Detalles"** (un `Sheet` desde la derecha en todos los tamaños): categoría, estado, tags (con las sugerencias actuales), slug (solo lectura al editar), revisión, fecha de edición y el panel de conexiones que ya existe.
- **Barra de guardado** fija abajo, visible solo con cambios: campo "Motivo (opcional)", "Descartar" y "Guardar". Ahí también se muestran los errores (`role="alert"`), el conflicto de revisión con su diff y "Reintentar sobre la revisión N", como hoy.
- **Salir con cambios:** aviso del navegador (`beforeunload`), como hoy. "Descartar" vuelve al contenido cargado.

### 4.1 Link a página

- Escribir `[[` abre el buscador de páginas (las visibles para la persona, ya cargadas); elegir una inserta el nodo. El botón "Link a página" hace lo mismo sobre la selección.
- El nodo se ve como un link con el alias o, sin alias, el título de la página; el slug queda en el `title`. Si el destino no existe se ve como link roto (misma clase que en la vista de lectura). Un clic lo selecciona; para seguirlo, `Cmd/Ctrl` + clic.
- Editar el nodo permite cambiar el alias y el destino.

### 4.2 Vista de código

El interruptor "Markdown" reemplaza el editor por el textarea con fuente monoespaciada. Al cambiar de vista, el contenido pasa de una a la otra: de visual a código se serializa; de código a visual se vuelve a leer. La barra de herramientas se deshabilita en la vista de código, salvo el interruptor.

## 5. Markdown: ida y vuelta

### 5.1 Qué soporta

CommonMark y GFM como la vista de lectura (`remark-gfm`): títulos, énfasis, tachado, listas, listas de tareas, citas, código en línea y en bloque con lenguaje, tablas, líneas divisorias, links y los links del brain (V9). Las imágenes en markdown (`![alt](url)`) se conservan y se muestran; no hay subida de archivos (§9).

### 5.2 Reglas

- **V6:** el espacio de trabajo guarda el cuerpo cargado. Mientras el editor no registre un cambio de contenido hecho por la persona, `saveBrainPage` recibe ese cuerpo original. Solo cuando hubo un cambio se serializa.
- El cuerpo serializado termina sin espacios al final de línea y con un solo salto de línea al final, como escribe hoy el formulario.
- Lo que el editor no reconoce (HTML crudo, sintaxis de otro dialecto) se conserva como texto.

### 5.3 La prueba que decide (V7)

Un conjunto de pruebas `texto → editor → texto` con:

- un corpus escrito a mano con todo lo de §5.1, más casos de riesgo: listas anidadas, tablas con alineación, bloques de código con markdown adentro, links del brain dentro de listas y tablas, líneas en blanco consecutivas, caracteres escapados;
- páginas reales del brain de `innovas`, exportadas a `tests/fixtures/` (sin datos sensibles; si las hay, se anonimizan).

**Criterio de aceptación:** el contenido que se muestra con `react-markdown` es el mismo antes y después (misma estructura y mismo texto), y los links del brain salen byte a byte iguales. Se aceptan normalizaciones de estilo estables y documentadas (por ejemplo `*` → `-` en viñetas, o `_cursiva_` → `*cursiva*`) siempre que una segunda pasada ya no cambie nada. No se acepta perder contenido, romper una tabla, tocar un bloque de código ni alterar un link del brain.

Si el criterio no se cumple y no se arregla con configuración o una extensión propia, la entrega se frena en esa tarea y se replantea con Milkdown, que comparte motor (`remark`) con la vista de lectura.

La misma tarea confirma que Tiptap funciona con la versión de React del repo (19) y con Next 16, y mide lo que suma al bundle de `/brain/p`.

## 6. Vista de papel

Clase `.brain-paper` en `app/globals.css`, con variables nuevas en `:root` y en `.dark`:

- `--paper: #ffffff` y `--paper-foreground` (el texto oscuro del tema claro), iguales en los dos temas (V11).
- Hoja centrada, ancho máximo de 720 px, borde de 1 px con `var(--border)`, radio chico y una sombra muy suave; relleno generoso (48 px en escritorio, 20 px en mobile).
- A 375 px ocupa todo el ancho: sin radio ni bordes laterales, solo borde arriba y abajo.
- La usan la vista de lectura y el espacio de trabajo: quien edita y quien lee ven la misma hoja.

La vista de lectura (lectores) conserva lo que tiene hoy, reordenado: título, cuerpo con `BrainMarkdown` dentro de la hoja, "Historial" y un botón "Detalles" con el mismo panel en solo lectura (estado, categoría, revisión, fecha, slug, tags y conexiones).

## 7. Guardado y motivo

- `savePage` (`lib/brain/core/editor/save.ts`) deja de rechazar el motivo vacío: lo reemplaza por `Edición desde la web`. El resto del flujo (permisos por `withAccess`, `baseRevision`, conflicto) no cambia.
- El contrato de `brain_upsert` para el agente y el MCP (`reason` obligatorio, `min(1)`) no cambia, y `brain_upsert_page` sigue rechazando un motivo vacío: la web siempre le manda uno.
- Tras guardar, la página queda en modo edición sobre la revisión nueva, sin navegar.

## 8. Pruebas

- **Ida y vuelta** (§5.3), en Vitest. Si el motor de markdown de Tiptap necesita DOM, esos archivos corren con un entorno de DOM por archivo (dependencia de desarrollo), sin cambiar el entorno `node` del resto.
- **Nodo de link del brain:** lectura y escritura de las tres formas, alias con caracteres especiales, destino inexistente.
- **Regla V6:** una función pura decide qué cuerpo se manda (original o serializado) según haya habido cambios; con sus casos.
- **Motivo opcional:** `savePage` con motivo vacío guarda con el texto por defecto; con motivo, lo respeta.
- **Entrada por permiso:** la decisión lector / editor de la ruta, y la redirección de `/brain/editar`.
- **Sin tests automáticos:** los componentes visuales (barra, paneles, hoja). Se verifican en el navegador a 1280 y 375 px después del despliegue, y queda dicho en el PR.

## 9. Fuera de alcance

- Subir imágenes o archivos.
- Edición simultánea entre varias personas y presencia.
- Comentarios.
- Autoguardado y borradores locales.
- Renombrar o mover páginas (E7 del editor sigue vigente).
- Menú con "/" y bloques arrastrables.
