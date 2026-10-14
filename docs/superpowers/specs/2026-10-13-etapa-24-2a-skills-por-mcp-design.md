# Etapa 24.2a · Skills de empresa por MCP: listar, cargar y descargar — diseño

**Fecha:** 2026-10-13
**Etapa:** 24, entrega 24.2a. La 24.2 del roadmap se parte en dos: esta sirve las skills publicadas por MCP y como zip; la 24.2b ejecuta sus scripts (`skill_run`) en un sandbox de la plataforma. La 24.3 las lleva al chat interno y va después de la Etapa 22.
**Base:** `2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md` (paquete, versiones publicadas, `withoutSkills`, S1 a S13), spec de la Etapa 11 (endpoint MCP del brain), `2026-10-05-etapa-17-permisos-brain-design.md` (permisos por nodo).
**Depende de:** la 24.1 mergeada (PR 96) y cerrada en producción.

## 1. Objetivo y criterio de cierre

Que una persona conectada al brain de su empresa por MCP reciba en su asistente las skills publicadas que puede ver, siempre en su última versión, sin instalar nada. Y que pueda bajar el paquete publicado como zip para instalarlo a mano donde el MCP no llega.

Esta entrega no ejecuta scripts. Un script se puede leer como texto; correrlo es de la 24.2b.

**Terminado cuando**, en producción, en el tenant `innovas`:

1. La skill del design system de INNOV.AS está publicada y, desde Claude conectado al brain por MCP, aparece en la descripción de `skill_load` sin haberla pedido.
2. Pedirle a Claude una pieza de marca hace que cargue la skill y lea los tokens con `skill_file`.
3. Un administrador republica con un cambio y la carga siguiente trae la versión nueva.
4. `brain_read` sobre `skills/...` sigue respondiendo que no existe.
5. El zip descargado desde la pantalla de la skill se puede volver a importar y da el mismo hash de archivos.
6. `events` tiene un `brain.skill_loaded` con la persona, la skill, la versión y el canal.

## 2. Decisiones

Las de la 24.1 siguen vigentes. Esta entrega agrega:

| # | Decisión | Por qué |
|---|---|---|
| M1 | **Las skills salen por tools propias, no por las del brain.** `withoutSkills` no cambia | Las tools del brain leen el borrador; las de skills, solo la copia publicada (S4, S6) |
| M2 | **Por MCP todos reciben la versión publicada**, también editores y administradores | El borrador es para la web. Un asistente no distingue "estoy revisando" de "estoy usando" |
| M3 | **Ve una skill quien tiene al menos lectura sobre su ruta** y la skill tiene una publicación vigente | Mismo criterio que el lector en la web (S7, S12) |
| M4 | **Las tools identifican la skill por nombre**, no por ruta | El nombre ya es único por empresa entre las publicadas, y es lo que usa el formato Agent Skills |
| M5 | **La descripción de `skill_load` lista las skills de la persona** y además hay `skill_list` | Un modelo usa lo que tiene a la vista; casi nunca llama a un listado por iniciativa propia |
| M6 | **Por MCP solo viajan archivos de texto.** Los binarios van en el zip | Nada sale por un link sin sesión, y no entran respuestas de varios MB a una conversación |
| M7 | **El zip es siempre el de la versión publicada vigente**, para cualquier nivel | El borrador no se distribuye (S4) |
| M8 | **Cada carga deja un evento**; listar y leer archivos, no | Alcanza para saber qué se usa sin llenar `events` |
| M9 | **Sin migración** | Todo lo que se lee existe desde la 24.1; `events.type` es texto libre |

## 3. Qué ve cada uno

| Situación | `skill_list` / descripción | `skill_load` y `skill_file` | Zip |
|---|---|---|---|
| Lector o más sobre la ruta, publicación vigente | Aparece | Copia publicada | Copia publicada |
| Cualquier nivel, sin publicar o retirada | No aparece | "No existe" | 404 |
| Sin lectura sobre la ruta | No aparece | "No existe" | 404 |
| Administrador de la empresa | Todas las publicadas vigentes | Copia publicada | Copia publicada |

Una skill que no existe y una que la persona no puede ver responden igual, con el mismo mensaje y sin sugerencias: el canal no revela nombres.

El nivel de la persona sobre una ruta se resuelve con `resolveAccess` y las reglas que el handler ya carga. Para un administrador no se consultan reglas.

## 4. Tools

Se registran en el mismo servidor MCP del brain (`/brain/<slug>/mcp`), después de las tres existentes. Si la persona no ve ninguna skill, **no se registra ninguna de las tres**: una empresa sin skills no ve cambios.

### 4.1 `skill_list`

Sin argumentos. Devuelve `{ ok, skills: [{ name, description, version, publishedAt }] }`, ordenadas por nombre. Sin tope.

### 4.2 `skill_load`

Recibe `{ name }`. Devuelve:

```json
{
  "ok": true,
  "name": "innov-design-system",
  "version": 3,
  "digest": "<sha256 del paquete>",
  "publishedAt": "2026-10-13T12:00:00Z",
  "instructions": "<cuerpo del SKILL.md publicado>",
  "compatibility": "<si la versión lo trae>",
  "files": [
    { "path": "assets/tokens/globals.css", "size": 4210, "readable": true },
    { "path": "assets/logo.png", "size": 88211, "readable": false }
  ]
}
```

`readable` se decide sin bajar el archivo: `size <= 262144`. Que sea texto se comprueba recién en `skill_file`.

**Descripción dinámica.** El texto fijo explica qué es una skill de la empresa y que hay que cargarla antes de hacer la tarea que describe. Después lista las skills de la persona, una por línea: `- <name>: <descripción>`. Topes: 30 skills (por nombre) y 300 caracteres por descripción, cortada con "…". Si hay más de 30, una línea final dice cuántas faltan y que se ven con `skill_list`.

Las descripciones las escribió una persona de la empresa y las aprobó un administrador (S5). Igual se normalizan antes de entrar a la descripción de la tool: saltos de línea y espacios repetidos pasan a un espacio.

### 4.3 `skill_file`

Recibe `{ name, path }`. Devuelve `{ ok, name, version, path, size, content }`.

- La ruta se busca en el `manifest` de la versión publicada y el contenido se lee del bucket por el `sha256` que figura ahí. Nunca se consulta `brain_skill_files` (el borrador).
- Ruta fuera del manifiesto: "no existe en esta versión".
- Más de 256 KB, o no es texto (tiene un byte nulo o no es UTF-8 válido, el criterio de `fileHeaders` de la 24.1, que pasa a un ayudante compartido): error que dice que el archivo está en la descarga del paquete.
- Si el blob no se puede leer: error interno con identificador, como el resto del servidor.

### 4.4 Comunes a las tres

- Cuentan como lectura en el limitador que ya tiene el endpoint.
- Errores con el mismo formato que las tools del brain (`toToolError`).
- La versión se resuelve en cada llamada: no hay estado entre `skill_load` y `skill_file`. Si entre una y otra se republica, `skill_file` responde de la versión nueva y devuelve su número, que el asistente puede comparar.

### 4.5 Instrucciones del servidor

`McpServer` recibe `instructions` solo cuando la persona ve alguna skill. Un párrafo: la empresa publica skills (procedimientos revisados); antes de una tarea que coincida con una, cargarla con `skill_load` y seguirla; los archivos de texto se leen con `skill_file`; los scripts todavía no se ejecutan desde este servidor.

## 5. Descarga del zip

**Ruta:** `GET /[tenant]/brain/skills/package?slug=skills/...`, al lado de `skills/files`.

- Orden de controles: miembro de la empresa → lectura sobre el slug → publicación vigente. Cualquier falla es 404.
- Respuesta: `application/zip`, `content-disposition: attachment; filename="<name>-v<version>.zip"`, `x-content-type-options: nosniff`, `cache-control: no-store`.
- Contenido: una carpeta raíz `<name>/` con `SKILL.md` y los archivos del manifiesto, binarios incluidos.
- `SKILL.md` se arma desde la copia publicada: frontmatter YAML con `name`, `description` y, si están, `license` y `compatibility`; después el cuerpo. Los demás campos del frontmatter del brain no se exportan.
- El zip lo escribe un módulo propio con `node:zlib` (`deflateRawSync`), método 8, CRC-32, sin zip64. Es el espejo de `unzipPackage`.

**Botón:** en el panel de archivos publicados (`published-files.tsx`), "Descargar paquete (v<n>)". Lo ve quien ve la versión publicada.

**Límite de respuesta en Vercel.** Un paquete puede pesar hasta 20 MB y las funciones de Vercel limitan el cuerpo de respuesta. El plan verifica primero si una respuesta por partes (`ReadableStream`) supera ese límite en un deploy de preview. Si no, la ruta responde 413 con mensaje claro para paquetes cuyo zip supere 4 MB y la descarga completa queda para la 24.2b. El resultado de esa verificación se anota en la sección de decisiones de `docs/dominios/brain.md`.

## 6. Registro de uso

`skill_load` exitoso inserta en `events`: `type = 'brain.skill_loaded'`, `actor_user_id`, `channel = 'mcp'`, `summary = <slug>`, `payload = { name, version, digest }`. Solo inserción.

Si la inserción falla, se registra en consola y la tool responde igual: el registro no puede tirar una carga.

## 7. Código

| Archivo | Qué hace |
|---|---|
| `lib/brain/core/skills/catalog.ts` (nuevo, puro) | Dado el `overview`, una función de nivel por ruta, un lector de blobs y un registrador: `list()`, `load(name)`, `file(name, path)`. También `describeSkills(skills)` para la descripción y sus topes |
| `lib/brain/core/skills/skill-md.ts` (nuevo, puro) | Arma el `SKILL.md` de una copia publicada |
| `lib/brain/core/skills/http.ts` | Exporta `looksLikeText` |
| `lib/brain/core/mcp-server/server.ts` | Recibe `skills?` opcional; registra las tres tools y las `instructions` |
| `lib/brain/core/mcp-server/handler.ts` | Arma el catálogo con las reglas ya cargadas y lo pasa. `BrainMcpDeps` suma `skills` (overview, blobs, registro) |
| `lib/brain/adapters/mcp-production.ts` | Cablea `skillStore()`, `blobStore()` y la inserción del evento |
| `lib/brain/adapters/skill-zip.ts` | Suma `zipPackage(entries)` |
| `app/[tenant]/brain/skills/package/route.ts` (nuevo) | La descarga |
| `components/brain/skills/published-files.tsx` | El botón |

`catalog.ts` vive en `core`: sin Supabase ni Next, vigilado por `tests/brain/boundary.test.ts`. El overview se pide una vez por request y solo si el proveedor del brain es `wiki` (S13); con otro proveedor no hay tools de skills.

**Costo por request.** Cada pedido al endpoint arma el servidor y por eso lee el overview (una llamada a `brain_skill_overview`). Es la misma lectura que ya hace la web por página. Si falla, el servidor se arma sin tools de skills y se registra en consola: las tools del brain no dependen de las skills.

## 8. Pruebas

**vitest** (`tests/brain/`):

- `catalog`: lector con publicación vigente ve la skill; sin publicar y retirada no aparecen; editor recibe la copia publicada y no el borrador; sin lectura responde igual que inexistente; administrador ve todas; orden por nombre.
- `describeSkills`: tope de 30 con la línea de "faltan N"; descripción de más de 300 caracteres cortada; saltos de línea normalizados.
- `file`: ruta fuera del manifiesto; más de 256 KB; binario; blob ausente; lee por el `sha256` del manifiesto aunque el borrador tenga otro archivo en la misma ruta.
- Servidor MCP: con skills aparecen las tres tools y las `instructions`; sin skills, ninguna; `brain_read` de `skills/...` sigue en "no existe"; el evento se inserta en `skill_load` y no en las otras; una falla del registro no rompe la carga; una falla del overview deja las tools del brain andando.
- `skill-md`: frontmatter con y sin `license` y `compatibility`; descripción con dos puntos, comillas y saltos de línea queda como YAML válido.
- `zipPackage`: ida y vuelta por `unzipPackage` con el mismo contenido; subcarpetas; archivo vacío.
- Ruta de descarga: 404 para no miembro, sin lectura y sin publicación; cabeceras.

**Navegador y Claude** (al cerrar): el criterio de §1 con el design system de INNOV.AS.

## 9. Fuera de esta entrega

- `skill_run`, el sandbox, bibliotecas base y `usage_entries`: **24.2b**.
- Binarios por MCP y la página de skills por persona (Etapa 19): **24.2b**.
- Skills en el chat interno: **24.3**, después de la Etapa 22.
- Sincronizar a disco para Claude Code y Codex; la extensión de skills de MCP (SEP-2640): después de la 24.3.
- Avisar a los clientes conectados que cambió la lista de tools (`tools/list_changed`): el endpoint es sin estado. Una skill recién publicada aparece en la descripción cuando el cliente vuelve a pedir la lista; `skill_list` la muestra siempre.

## 10. Despliegue

Sin migración. Va después del cierre de la 24.1 en producción.

1. Mergear y desplegar.
2. Publicar la skill del design system en `innovas` (importar el zip, revisar, publicar).
3. Reconectar el MCP del brain en Claude y recorrer el criterio de §1.
