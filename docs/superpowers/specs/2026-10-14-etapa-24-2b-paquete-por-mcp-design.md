# Etapa 24.2b · Paquete completo por MCP y skills en `/conectar` — diseño

**Fecha:** 2026-10-14
**Etapa:** 24, entrega 24.2b. Cambia de alcance respecto del roadmap del 2026-10-13: ya no ejecuta scripts del lado de la plataforma. Entrega el paquete publicado completo al asistente, que lo corre en su propio entorno. El sandbox propio pasa a la 24.3 (chat interno) y la ejecución por MCP del lado de la plataforma queda como 24.4.
**Base:** `2026-10-13-etapa-24-2a-skills-por-mcp-design.md` (tools de skills, catálogo, descarga del zip, M1 a M9), `2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md` (paquete, versiones publicadas, S1 a S13), `2026-10-09-etapa-19-conectar-design.md` (página `/conectar`).
**Depende de:** la 24.2a (misma rama, `feat/etapa-24-2a-skills-por-mcp`) y, para producción, del cierre de la 24.1 y la 24.2a.

## 1. Objetivo y criterio de cierre

Que un asistente con entorno de ejecución y salida a internet (Claude Code, Codex, Cursor) pueda bajar el paquete publicado de una skill, con sus binarios, y correr sus scripts, siempre en la última versión publicada y sin que la persona instale nada. Y que cada persona vea en `/conectar` qué skills tiene disponibles.

La plataforma no ejecuta nada en esta entrega.

**Terminado cuando**, en producción, en el tenant `innovas`:

1. Hay una skill publicada con un script y una plantilla binaria. Desde Claude Code conectado al brain por MCP, pedir la tarea hace que el asistente cargue la skill, baje el paquete con `skill_package`, corra el script y produzca el archivo.
2. Un administrador republica con un cambio y, en la sesión siguiente, el asistente usa la versión nueva sin que la persona haga nada.
3. Una persona sin lectura sobre esa skill no obtiene link por MCP ni por la web.
4. Desde la web se descarga un paquete de más de 5 MB.
5. `/conectar` le muestra a cada persona las mismas skills que `skill_list`.
6. `events` tiene un `brain.skill_package_issued` con la persona, la skill, la versión y el canal.

## 2. Decisiones

Las de la 24.1 (S1 a S13) y la 24.2a (M1 a M9) siguen vigentes, salvo M6, que esta entrega reemplaza por P2. Se agregan:

| # | Decisión | Por qué |
|---|---|---|
| P1 | **Por MCP ejecuta el cliente, no la plataforma.** No hay `skill_run` | Menos infraestructura y no se paga cómputo de corridas de terceros. El sandbox propio se construye una vez, para el chat interno (24.3) |
| P2 | **El paquete completo sale por un link firmado de 10 minutos** que devuelve `skill_package`. Reemplaza a M6: los binarios siguen sin viajar dentro de una respuesta MCP, pero ahora hay un link sin sesión | El asistente no tiene sesión de navegador. Lo que entrega el link es lo mismo que esa persona ya puede bajar desde la web |
| P3 | **El zip se guarda por digest** en un bucket privado y se arma la primera vez que alguien lo pide | Un solo archivo para bajar, sin pasar por una función de Vercel. Dos versiones con el mismo contenido comparten zip |
| P4 | **La descarga web redirige a un link firmado de 60 segundos** | Cierra el pendiente del tope de 4,5 MB de respuesta que dejó la 24.2a (§5 de esa spec) |
| P5 | **El asistente descomprime en una carpeta temporal y no instala la skill** | Una copia instalada queda vieja al republicar. Pedir el paquete en cada sesión es lo que sostiene "siempre la última" |
| P6 | **Cada link emitido deja un evento**, por MCP y por web | Es la única salida de archivos de la empresa sin sesión; conviene saber quién la pidió |
| P7 | **Límite aceptado: claude.ai y ChatGPT web no corren scripts siempre al día.** Su entorno de ejecución no sale a internet por defecto, así que la persona sube el zip a mano y lo vuelve a subir cuando cambia | Decisión de producto del 2026-10-14. La alternativa (ejecutar del lado de la plataforma) queda en el roadmap como 24.4 |
| P8 | **No se limpian los zips de versiones retiradas o reemplazadas** | Pesan a lo sumo 20 MB y nadie puede pedirlos: el link solo se emite para la versión vigente. Queda como pendiente |

## 3. Qué ve cada uno

Mismo criterio que la 24.2a §3: ve una skill quien tiene al menos lectura sobre su ruta y la skill tiene una publicación vigente.

| Situación | `skill_package` | Descarga web | Sección en `/conectar` |
|---|---|---|---|
| Lector o más, publicación vigente | Link al zip publicado | Redirección al zip publicado | Aparece |
| Cualquier nivel, sin publicar o retirada | "No existe" | 404 | No aparece |
| Sin lectura sobre la ruta | "No existe" | 404 | No aparece |
| Otro tenant | "No existe" | 404 | No aparece |

Una skill que no existe y una que la persona no puede ver responden igual, como en la 24.2a.

## 4. La tool `skill_package`

Se registra en el servidor MCP del brain junto a `skill_list`, `skill_load` y `skill_file`, con la misma condición: si la persona no ve ninguna skill, no se registra.

Recibe `{ name }`. Devuelve:

```json
{
  "ok": true,
  "name": "propuesta-comercial",
  "version": 3,
  "filename": "propuesta-comercial-v3.zip",
  "url": "<link firmado>",
  "expiresIn": 600
}
```

- Cuenta como lectura en el limitador del endpoint. Errores con `toToolError`.
- La versión se resuelve en cada llamada: siempre la vigente.
- No devuelve hash ni tamaño del zip.

**Descripción de la tool.** Dice: que devuelve un link de descarga que vence en 10 minutos con el paquete completo de la skill, binarios incluidos; que hay que bajarlo a una carpeta temporal, descomprimirlo y correr los scripts desde ahí; que no hay que instalarlo en la carpeta de skills del cliente porque esa copia queda vieja; que si el link venció se pide otro; y que si el entorno no puede bajar archivos, se sigue con `skill_load` y `skill_file` y se le avisa a la persona.

### 4.1 Ajustes a las tools de la 24.2a

- `skill_file`, ante un binario o un archivo de más de 256 KB: el mensaje pasa de "está en la descarga del paquete, desde la página de la skill" a "se obtiene con `skill_package`".
- Instrucciones del servidor (`SKILL_INSTRUCTIONS`): se reemplaza "los scripts todavía no se ejecutan desde este servidor" por: si la skill trae scripts y tu entorno puede ejecutar código y bajar archivos, pedí el paquete con `skill_package`; si no puede, seguí las instrucciones con lo que tengas y avisale a la persona que hay un script que no pudiste correr.
- `skill_list` y `skill_load` no cambian.

## 5. El zip guardado

**Bucket.** `skill-packages`, privado, sin políticas en `storage.objects`, `file_size_limit` de 26 MB (27262976 bytes). El bucket `skills` de la 24.1 no cambia.

**Objeto.** `<tenant_id>/<digest>.zip`, donde `digest` es el de la versión publicada (24.1 §5.4).

**Emitir un link.** Una función de `core`, pura, que recibe sus dependencias y una skill ya resuelta y autorizada por quien la llama: el catálogo por MCP, los controles de la ruta por web. No decide permisos.

1. Pregunta al almacén si el objeto existe. Si no, lee los archivos de la versión publicada, arma el zip con `renderSkillMd` y `zipPackage`, y lo sube con `upsert`. Si existe, no lee ningún archivo.
2. Pide el link firmado con el vencimiento del canal y el nombre de descarga `<name>-v<version>.zip`.
3. Registra el evento (§7). Si falla, sigue.

`zipPackage` es reproducible, así que dos pedidos simultáneos suben los mismos bytes.

**Contenido.** El de la 24.2a §5: carpeta raíz `<name>/` con `SKILL.md` armado por `renderSkillMd` y los archivos del manifiesto.

**Vencimientos.** 600 segundos por MCP, 60 por web.

## 6. Descarga web

`GET /[tenant]/brain/skills/package?slug=skills/...` mantiene su orden de controles (miembro → lectura sobre el slug → publicación vigente; cualquier falla es 404) y pasa a responder `302` con `location` al link firmado y `cache-control: no-store`. Deja de armar el zip en la respuesta.

Los botones "Descargar paquete (v{n})" de la 24.2a no cambian.

## 7. Registro de uso

Cada link emitido inserta en `events`: `type = 'brain.skill_package_issued'`, `actor_user_id`, `channel = 'mcp'` o `'web'`, `summary = <slug>`, `payload = { name, version, digest }`. Solo inserción.

Si la inserción falla, se registra en consola y el link se entrega igual.

## 8. Sección "Tus skills" en `/conectar`

- Debajo de la tarjeta del brain. Aparece solo si la empresa tiene el brain habilitado y la persona ve al menos una skill publicada.
- La lista sale del mismo catálogo que `skill_list`, armado con la sesión web en lugar del principal de MCP. Sin tope: se muestran todas, ordenadas por nombre.
- Por skill: nombre, descripción, versión, link a su página en el brain y "Descargar paquete (v{n})".
- Si la lectura falla: "No se pudieron leer tus skills. Recargá la página." Nunca una lista vacía por un error.
- Dos textos de ayuda, siempre visibles (no se detecta el cliente):
  - Claude Code, Codex y Cursor: "Con el brain conectado, tu asistente carga estas skills solo y usa siempre la última versión."
  - claude.ai y ChatGPT: "Tu asistente lee las instrucciones de cada skill. Para que además corra sus scripts, descargá el paquete y subilo como skill. Cuando se publique una versión nueva vas a tener que subirlo de nuevo."

La página no muestra historial de uso.

## 9. Errores

| Caso | MCP | Web |
|---|---|---|
| Skill inexistente o ajena | "No existe la skill … entre las que podés usar" | 404 |
| Falla al armar, subir o firmar | "No pude preparar el paquete. Probá de nuevo." Detalle solo en el log | 500 sin detalle |
| Falla el evento | Se entrega el link | Se redirige igual |
| Falla la lectura del catálogo | El servidor se arma sin tools de skills (24.2a §7) | `/conectar` muestra el mensaje de error de §8 |
| Link vencido | Lo responde el storage; el asistente pide otro | La persona vuelve a apretar el botón |

## 10. Código

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/<fecha>_skill_packages_bucket.sql` (nuevo) | Crea el bucket |
| `lib/brain/core/skills/package-link.ts` (nuevo, puro) | `issuePackageLink(...)`: los tres pasos de §5. Define la interfaz del almacén de paquetes (`exists`, `put`, `sign`) y la del registrador |
| `lib/brain/core/skills/catalog.ts` | Suma `package(name)` al catálogo y cambia el mensaje de `skill_file` |
| `lib/brain/core/mcp-server/server.ts` | Registra `skill_package`; nuevo texto de `SKILL_INSTRUCTIONS` |
| `lib/brain/adapters/skills.ts` | `packageStore()` sobre Supabase Storage con el cliente admin; el listado de skills para la sesión web |
| `lib/brain/adapters/mcp-production.ts` | Cablea el almacén y el evento con `channel: mcp` |
| `app/[tenant]/brain/skills/package/route.ts` | Redirige (§6) |
| `app/[tenant]/conectar/page.tsx` y un componente nuevo | La sección de §8 |

`package-link.ts` vive en `core`, vigilado por `tests/brain/boundary.test.ts`.

## 11. Pruebas

**vitest** (`tests/brain/` y `tests/connect/`):

- Catálogo, `package(name)`: lector con publicación vigente recibe link; sin publicar, retirada y sin lectura responden igual que inexistente.
- `issuePackageLink`: arma y sube solo si el objeto falta; si existe no lee ningún archivo; el nombre del objeto es `<tenant_id>/<digest>.zip`; el nombre de descarga lleva la versión; una falla del evento no rompe; una falla del almacén da el error genérico sin filtrar el detalle.
- Adaptador: vencimiento de 600 por MCP y 60 por web; el objeto de un tenant nunca se firma para otro.
- Servidor MCP: con skills aparece `skill_package`; sin skills, no; el evento se inserta con `channel: mcp`; el mensaje de `skill_file` para binarios nombra `skill_package`.
- Ruta web: 302 con `location` para quien puede; 404 para no miembro, sin lectura y sin publicación; 500 si falla el almacén.
- `/conectar`: lista lo mismo que el catálogo; distingue falla de lista vacía; no aparece sin brain.

**pgTAP:** el bucket `skill-packages` existe, es privado, tiene el tope de 26 MB y no tiene políticas.

**Manual** (al cerrar): el criterio de §1.

## 12. Fuera de esta entrega

Decidido el 2026-10-14 y anotado acá para que no se pierda.

**24.2c · Dependencias entre skills.**
- Una skill puede declarar que usa archivos de otra (el caso: `propuesta-comercial` toma la plantilla de `identidad-de-marca`).
- La dependencia se resuelve a la última versión publicada al momento de usarla, no a la que había al publicar.
- Quien ve la skill pero no su dependencia la usa igual: el paquete incluye los archivos de la dependencia. Ese permiso extendido vale solo para ese uso; listar, cargar y descargar la dependencia por separado sigue pidiendo lectura.
- Al publicar una versión nueva, la pantalla avisa qué otras skills la usan.
- El registro guarda versión y digest de las dos.

**24.3 · Skills en el chat interno** (después de la Etapa 22). Ejecuta en un sandbox de la plataforma:
- Vercel Sandbox, sin red. Verificado el 2026-10-14: la imagen por defecto trae Node LTS y Python 3.14; una corrida de un minuto con 1 vCPU cuesta alrededor de 0,002 USD.
- Bibliotecas: una lista fija de la plataforma en una sola imagen para todos los tenants, orientada a armar documentos, más lo que la skill traiga como archivos propios. La skill no declara dependencias a instalar.
- Entrada del script: argumentos de línea de comandos y archivos de texto que escribe el asistente, con tope (256 KB en total como punto de partida). Subir un archivo de la persona queda afuera.
- Salida: los archivos que produce el script se guardan 30 días y se bajan por un link a la plataforma que pide sesión, solo para quien corrió. El registro de la corrida no se borra.
- Nodo nuevo de nivel 0 con asiento en `usage_entries`.

**24.4 · Ejecutar por MCP del lado de la plataforma.** `skill_run` sobre el sandbox de la 24.3, para que claude.ai y ChatGPT web también corran siempre la última versión (levanta el límite P7).

**Sin fecha:** limpiar zips huérfanos (P8); sincronizar a disco para Claude Code y Codex; la extensión de skills de MCP (SEP-2640); `tools/list_changed`.

## 13. Despliegue

Una migración, que crea el bucket. Va después del cierre de la 24.1 y la 24.2a en producción.

1. Correr `npx supabase migration list` (un `db push` aplica todas las pendientes) y aplicar la migración.
2. Desplegar el código. Al revés, `skill_package` y la descarga web fallan con 500 hasta que exista el bucket; el resto del brain no se ve afectado.
3. En un deploy de preview, bajar desde la web un paquete de más de 5 MB.
4. En `innovas`, publicar la skill con script y plantilla, y recorrer el criterio de §1 desde Claude Code.
