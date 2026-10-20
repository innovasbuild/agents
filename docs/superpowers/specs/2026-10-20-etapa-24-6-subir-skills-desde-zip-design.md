# Etapa 24.6 · Subir una skill desde un zip, por la web y por MCP — diseño

**Fecha:** 2026-10-20
**Etapa:** 24, entrega 24.6. No depende de la 24.3 (chat interno) ni de la 24.4 (`skill_run`).
**Base:** `2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md` (paquete, borrador y publicación), `2026-10-14-etapa-24-2b-paquete-por-mcp-design.md` (link firmado de 10 minutos para bajar el zip), `2026-10-15-etapa-24-5-editar-skills-por-mcp-design.md` (crear y editar el borrador por MCP; publicar solo en la web) y `2026-10-05-etapa-17-permisos-brain-design.md` (permisos por carpeta).
**Antecedente en código:** la rama `fix/mcp-skills-administrador-de-carpeta` (`creatableSkillFolders` en `lib/brain/core/skills/draft.ts`) le dice a quien administra solo algunas carpetas de skills dónde puede crear. Esta entrega usa esa misma lista; conviene que esa rama entre primero.

## 1. Objetivo y criterio de cierre

Cuando alguien le pasa a una persona de la empresa una skill en un zip, hoy esa persona tiene que crear a mano la página `skills/<carpeta>/<nombre>` desde "Nueva página" y recién después, adentro de esa skill, usar "Importar zip" o subir los archivos de a uno indicando la ruta de cada uno. El objetivo es que un zip se suba directo, en un paso, a la carpeta que la persona elija, tanto desde la web como desde un cliente MCP, y que sirva igual para una skill nueva que para actualizar una existente.

Pedido de Matías (2026-10-20): que el botón "Subir skill" esté en todas las subcarpetas de `skills/` (para organizar las skills por nivel de acceso); vista previa antes de confirmar; arrastrar archivos sueltos o una carpeta; tope del zip en 4 MB (pidió 10 MB y lo bajó el mismo día para simplificar: ver D6 y D7); que sirva para skills nuevas y para actualizaciones; y que quien administra una carpeta dentro de `skills/` pueda subir una skill nueva por la web y por MCP.

**Terminado cuando**, en producción, en el tenant `innovas`:

1. Un administrador de una subcarpeta de `skills/` (y no de la empresa) sube un zip de 3 MB desde la web, ve la vista previa (nombre, descripción, cantidad de archivos, tamaño, si crea o reemplaza) y confirma. La skill aparece como borrador sin publicar en esa carpeta, con sus archivos.
2. Sube de nuevo una versión modificada del mismo zip: la vista previa dice que reemplaza el borrador, y al confirmar el historial muestra la revisión con su autor.
3. Un zip con un problema (sin `SKILL.md`, ruta inválida, más de 50 archivos) muestra todos los problemas en la vista previa y no escribe nada.
4. Desde un cliente MCP con ejecución de código (Claude Code), la misma persona obtiene el link, sube el zip, ve la vista previa y confirma. El resultado es idéntico al de la web.
5. Una persona que no administra esa carpeta no ve el botón ni las tools de subida, y si las llama recibe lo mismo que ante una carpeta inexistente.
6. Nada de lo subido llega a otras personas antes de que un administrador de la empresa lo publique desde la web (24.5 D2 sigue vigente).

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **"Subir skill" es un ítem del menú de cada carpeta de `skills/`**, incluida `skills/` y todas sus subcarpetas, para quien administra esa carpeta | Las carpetas son el modo de dar acceso distinto a distintas skills (pedido de Matías). El menú de carpetas ya muestra sus acciones solo a quien administra |
| D2 | **La carpeta destino la elige la persona, nunca el zip.** Del `SKILL.md` sale solo el `name`, que hoy `parseSkillMd` no lee y hay que sumar. **La vista previa exige un `name` válido** (mismo patrón y largo máximo que ya rigen) en los dos caminos, la carpeta y el panel de una skill (D11): si falta o no sirve, es un problema y no se puede confirmar. No se usa la carpeta raíz del zip ni el nombre del archivo como reemplazo. Subiendo a una carpeta, el `name` decide el destino. Desde el panel de una skill el destino ya está dado: el `name` no renombra nada, y si difiere del de la skill se avisa en la vista previa sin bloquear. Las skills que ya están en el brain no cambian: su nombre sale de su ruta, no del encabezado, y siguen sirviéndose y publicándose aunque su `SKILL.md` no traiga `name` | Un zip no puede mandar una skill a una carpeta donde la persona no administra. Decidido por Matías el 2026-10-20: lo ya cargado sigue funcionando; lo que se sube desde ahora trae `name` |
| D3 | **Nueva o actualización se decide por el destino:** si ya existe `skills/<carpeta>/<name>` es una actualización (reemplaza el texto y los archivos del borrador, como hace hoy `importSkillPackage`); si no, se crea | Es lo que hace la importación actual; solo suma el "si no existe, crear" |
| D4 | **Permiso.** Crear una skill nueva: administrar la carpeta destino (o la empresa). Actualizar una existente: ser editor de esa skill, como hoy. Mismo permiso por la web y por MCP | Es lo pedido por Matías. Se resuelve con `resolveAccess` y el nivel de la carpeta; no se agrega nada al modelo de permisos |
| D5 | **Vista previa sin escribir.** Antes de confirmar, el servidor lee el zip, corre `planImport` y devuelve: nombre, descripción, archivos y tamaños, si crea o reemplaza, y **todos** los problemas juntos. Recién con la confirmación escribe | Hoy un zip malo se descubre después de pulsar "Importar" y el reemplazo se confirma con un `window.confirm` |
| D6 | **Por la web, el zip viaja en el pedido, como hoy.** Con el tope de 4 MB (D7) entra en el límite de 4,5 MB de una función de Vercel (4 MB + 64 KB de formulario, la cuenta que ya hace la ruta). El navegador conserva el archivo y lo manda dos veces: una para la vista previa (sin escribir) y otra para confirmar. No hay objeto de preparación en la web. **Por MCP sí:** un asistente no puede pasar un binario en los argumentos de una tool, así que `skill_upload_link` entrega un link firmado para subir el zip al bucket privado `skill-packages` bajo un prefijo de preparación, y `skill_import` lo lee desde ahí | Es la solución más simple que cumple el tope. Por MCP es la misma mecánica que ya usa `skill_package` para la bajada (24.2b) |
| D7 | **Tope del zip: 4 MB** (el mismo de un archivo suelto). Los topes del contenido no cambian: 50 archivos, 4 MB por archivo, 20 MB descomprimido. El servidor verifica el tamaño real antes de descomprimir, no confía en lo declarado | Decidido por Matías el 2026-10-20 "para simplificar por ahora". Si más adelante hacen falta zips de hasta 10 MB, la web pasa a subir directo a Storage como ya hace el camino MCP |
| D8 | **Por MCP, dos tools:** `skill_upload_link` (`{ folder }`, relativa a `skills/` como en `skill_create`; devuelve `uploadId`, la URL de subida y el vencimiento) y `skill_import` (`{ uploadId, confirm? }`: vista previa; con `confirm: true`, escribe). La carpeta se fija al pedir el link y no se vuelve a pasar. Funciona para clientes que ejecutan código y tienen red (Claude Code, Codex, Cursor), igual que `skill_package`. Para claude.ai y ChatGPT web siguen `skill_create` y `skill_draft_write_file` (texto) o la web | Un asistente sin ejecución de código no puede armar ni subir un binario de megas. Se dice en la descripción de la tool |
| D9 | **Todo va al borrador.** La subida nunca publica, ni crea una versión publicada, ni retira. Los eventos y el historial registran quién subió, por qué canal y qué cambió | 24.5 D2: el texto de una skill llega a todos los asistentes de la empresa y un cliente MCP lee contenido ajeno |
| D10 | **Los archivos sueltos se arrastran.** En el panel de una skill, arrastrar archivos o una carpeta los sube con la ruta tomada de su ubicación relativa (o de su nombre). El campo "Ruta dentro del paquete" queda como ajuste, no como paso obligado. Siguen valiendo 4 MB por archivo, por la ruta de hoy. **No es una importación:** cada archivo es un pedido aparte, sin vista previa y sin todo-o-nada; al terminar se dice cuáles subieron y cuáles no (por ejemplo, los que pasan el tope de 50 archivos). Una carpeta arrastrada que trae `SKILL.md` se sube como archivos sueltos; para un paquete entero, el zip | Pedido de Matías |
| D11 | **El panel de una skill usa el mismo flujo** (vista previa y confirmación) en lugar del botón "Importar zip" con `window.confirm`; ahí el destino ya está elegido | Un solo camino, una sola pantalla que mantener |
| D12 | **Sin migración.** Solo el camino MCP usa Storage: el bucket ya admite objetos de 26 MB y no tiene políticas, solo el servidor sube y firma | Ver `20261022120000_skill_packages_bucket.sql` |

## 3. Cómo funciona

El servicio recibe **los bytes del zip y la carpeta destino**; de dónde vinieron es cosa del adaptador.

- **Web.** La persona elige la carpeta (o abre el panel de una skill) y el zip. El navegador lo manda a la ruta de subida con la acción "vista previa"; el servidor verifica proveedor `wiki`, categoría `skill` habilitada y permiso (D4), valida el tamaño (≤ 4 MB), y responde con la vista previa. Si la persona confirma, el navegador manda el mismo archivo con la acción "confirmar" y el permiso se revalida.
- **MCP.** `skill_upload_link { folder }` verifica lo mismo y responde con una URL de subida firmada para un objeto cuya clave lleva el tenant, la persona y la carpeta, y con un `uploadId` (la parte final de esa clave). El cliente sube el zip con esa URL (vence en 10 minutos). `skill_import { uploadId }` lee el objeto, saca la carpeta de la clave, rechaza como "no existe" un `uploadId` cuyo tenant o persona no sea el del pedido, y devuelve la vista previa; con `confirm: true` revalida el permiso, escribe y borra el objeto.

Los pasos del servicio son los mismos en los dos caminos:

1. **Vista previa.** Descomprime con `unzipPackage`, valida con `planImport` (que ahora también lee y exige `name`, D2), calcula el destino y si crea o reemplaza. Avisa, sin bloquear, si ya hay una skill con el mismo nombre en otra carpeta (el publicar la rechazaría por `name_taken`). No escribe nada.
2. **Confirmar.** Si no hay problemas, crea la página (si no existía) y escribe el texto y los archivos con las funciones de `files.ts` que ya existen. Todo o nada: un paquete inválido no cambia nada.
3. **Resultado.** La skill queda en borrador con su `reviewUrl`. Un administrador de la empresa la revisa y la publica como siempre.

La lógica vive en un servicio puro en `lib/brain/core/skills/` (permiso, destino, plan y escritura, con el tenant y la persona que llegan del caller). La web y el MCP son dos adaptadores finos sobre el mismo servicio.

## 4. Qué ve y qué puede cada uno

| Situación | Web | MCP |
|---|---|---|
| Administra la carpeta X de `skills/` | "Subir skill" en X; crea y actualiza | `skill_upload_link` y `skill_import` para X |
| Administra la empresa | En todas las carpetas | En todas |
| Es editor (no administrador) de X | No ve el botón de la carpeta; puede actualizar una skill existente donde edita, desde su panel | Ninguna tool de subida (criterio de cierre 5); edita el borrador con `skill_draft_*` |
| Es lector, o no tiene reglas bajo `skills/` | Nada | Ninguna tool |
| Categoría `skill` no habilitada, o proveedor que no es `wiki` | Nada | Ninguna tool |

Quien no puede recibe el mismo rechazo que ante una carpeta que no existe: el canal no revela nombres.

## 5. Fuera de alcance

- Publicar, retirar o borrar desde la subida.
- Más de una skill por zip; traer una skill desde una URL o un repositorio.
- Binarios por MCP sin ejecución de código del lado del cliente.
- Cambiar los topes del contenido de un paquete, el de 4 MB de un archivo suelto o el de 4 MB del zip (D7).
- Que el zip decida la carpeta destino.

## 6. Qué queda al constructor

- Nombres de archivos, funciones y tools internas (salvo `skill_upload_link` y `skill_import`, que son contrato).
- Formato exacto de la clave del objeto de preparación del camino MCP y cómo se limpian los que quedan abandonados. Criterio: ninguno vive más de 24 horas, y un fallo de limpieza no rompe la subida.
- Textos de la interfaz, siempre en español rioplatense.
- Si "Subir skill" aparece también en carpetas que hoy son implícitas (sin fila en `brain_folders`). El menú de carpetas hoy no ofrece acciones en esas; hay que ver qué pide la base para crear una página adentro y no inventar una excepción.
- Eventos y registro: `brain.skill_imported` con canal, si creó o reemplazó, cantidad de archivos y bytes, en el estilo de `brain.skill_package_issued`.
- Documentación: la guía de MCP (`docs/guias/conectar-brain-por-mcp.md`), el dominio brain y la cobertura de `docs:check`.

## 7. Decisiones tomadas por quien escribió el diseño (revisar)

- **Quién crea (D4): administrador de la carpeta**, como figuraba al aprobar Matías "el resto". Queda una asimetría a sabiendas: `skill_create` (texto, por MCP) deja crear a un editor de la carpeta y la subida de un zip no. Si molesta, es un cambio de una línea en el permiso.
- El `name` falta o no sirve → problema de la vista previa, sin reemplazo por la carpeta raíz del zip, en la carpeta y en el panel (D2). En el panel no renombra la skill; si difiere, avisa.
- Por la web el zip se manda dos veces (vista previa y confirmación) en lugar de dejarlo preparado en el servidor: es más simple y con 4 MB no cuesta nada (D6).
- La carpeta del destino viaja en la clave del objeto de preparación del camino MCP y `skill_import` solo recibe `uploadId` y `confirm` (D8, §3).
- Los archivos sueltos arrastrados no son atómicos ni tienen vista previa; la promesa de todo-o-nada es del zip (D10).
- Un nombre repetido en otra carpeta avisa pero no bloquea la subida (§3, paso 3).
