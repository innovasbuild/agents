---
title: Conectar el brain por MCP
category: guias
status: activo
tags: [brain, mcp]
updated: 2026-10-20
sources:
  - lib/brain/README.md
  - app/brain/[tenant]/mcp/route.ts
  - app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts
  - app/oauth/consent/page.tsx
  - app/[tenant]/conectar/page.tsx
  - lib/connect/instructions.ts
  - lib/connect/connectables.ts
  - lib/brain/core/mcp-server/handler.ts
  - lib/brain/core/mcp-server/access.ts
  - lib/brain/core/mcp-server/server.ts
  - lib/brain/core/mcp-server/rate-limit.ts
  - lib/brain/core/skills/catalog.ts
  - lib/brain/core/skills/draft.ts
  - lib/brain/core/skills/upload-mcp.ts
  - docs/superpowers/specs/2026-10-20-etapa-24-6-subir-skills-desde-zip-design.md
  - app/[tenant]/brain/skills/package/route.ts
  - lib/brain/core/limits.ts
  - docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md
  - docs/superpowers/specs/2026-10-09-etapa-19-conectar-design.md
  - docs/superpowers/specs/2026-10-13-etapa-24-2a-skills-por-mcp-design.md
---

# Conectar el brain desde tus herramientas

Cada cliente tiene su brain en una URL propia:

    https://agentes.innov.as/brain/<cliente>/mcp

Es la ruta `/brain/[tenant]/mcp` de la app; la metadata OAuth que usan los clientes para autenticar la sirve `/.well-known/oauth-protected-resource/brain/[tenant]/mcp`, y la pantalla de aprobación es `/oauth/consent`.

Entrás con tu cuenta de la plataforma. Qué podés leer y dónde podés escribir lo deciden los permisos del brain por carpeta y por página: los administradores del cliente pueden todo; el resto, lo que cada carpeta o página le dé.

Las instrucciones por cliente, con la URL de tu empresa ya puesta, están en la plataforma: menú **Conectar** (`/[tenant]/conectar`, o sea `/<cliente>/conectar`). Este archivo queda como referencia.

## Claude Code

    claude mcp add --transport http brain-<cliente> https://agentes.innov.as/brain/<cliente>/mcp

Después, dentro de Claude Code, `/mcp`, elegí `brain-<cliente>` y autenticá. Se abre el navegador, entrás con tu cuenta y aprobás el acceso.

## claude.ai

Configuración → Conectores → Agregar conector personalizado. Pegá la URL del brain. Al conectar, se abre la misma pantalla de login y aprobación. Sin probar todavía contra esta plataforma.

## Codex

Corré estos dos comandos en tu terminal:

    codex mcp add brain-<cliente> --url https://agentes.innov.as/brain/<cliente>/mcp
    codex mcp login brain-<cliente>

Se abre el navegador, entrás con tu cuenta y aprobás el acceso. Probado.

## ChatGPT y Cursor

La pantalla **Conectar** también trae los pasos para ChatGPT (Configuración → Conectores, modo desarrollador, autenticación OAuth; probado con una cuenta personal, no con un espacio de trabajo corporativo) y para Cursor (una entrada `mcpServers` con la URL en `~/.cursor/mcp.json`; sin probar). Los pasos exactos salen de `lib/connect/instructions.ts`.

## Qué podés hacer

- `brain_search`: buscar por texto, categoría o tag.
- `brain_read`: leer una página completa con su revisión.
- `brain_upsert`: crear o actualizar una página. Hace falta nivel editor sobre esa carpeta o página; sin eso responde que no tenés permiso. Para actualizar, primero leela y pasá su revisión; si alguien la cambió en el medio, vas a recibir un conflicto y tenés que volver a leerla.

Las tres tools del brain aparecen siempre en la lista. Una página que no podés ver no aparece en la búsqueda y responde "no encontrada" al leerla.

Por defecto hay un límite de 60 lecturas y 10 escrituras por minuto por persona (cada brain puede tener otros valores, entre 1 y 1000, en su configuración). Si lo pasás, la respuesta dice cuántos segundos esperar. Un pedido de más de 1 MiB se rechaza con 413.

## Skills de la empresa

Las skills (todo lo que está bajo `skills/`) no salen por `brain_search`, `brain_read` ni `brain_upsert`: esas tres responden "no encontrada" sobre `skills/`. Salen por cuatro tools propias, que aparecen **solo si vos ves alguna skill publicada**:

- `skill_list`: las skills que podés usar, con descripción y versión publicada.
- `skill_load`: carga una skill por nombre y devuelve sus instrucciones y la lista de sus archivos. Su descripción trae, además, la lista de tus skills, para que el asistente la use sin que se lo pidas.
- `skill_file`: lee un archivo de texto de una skill ya cargada, por la ruta que figura en la lista de `skill_load`.
- `skill_package`: devuelve un link de 10 minutos al zip completo de la skill, binarios incluidos. Tu asistente lo baja a una carpeta temporal y no lo instala.

Cosas a saber:

- Siempre recibís la **última versión publicada**, también si sos quien edita la skill: el borrador se ve en la plataforma o con `skill_draft_read` (ver «Crear y editar skills desde tu asistente», más abajo). Ves una skill si tenés al menos lectura sobre su ruta y tiene una publicación vigente; una que no ves responde igual que una que no existe.
- La descripción de `skill_load` lista hasta 30 skills, con 300 caracteres de descripción cada una. Una skill recién publicada aparece ahí cuando el cliente vuelve a pedir las tools (reconectando, por ejemplo); en `skill_list` aparece siempre.
- Por MCP se leen archivos de texto de hasta 256 KB; el paquete completo, con binarios, sale con `skill_package` o con **Descargar paquete** en la página de la skill o en **Conectar**.
- Los scripts los corre tu asistente en su propio entorno. Claude Code, Codex y Cursor bajan el paquete solos y usan siempre la última versión. En claude.ai y ChatGPT el entorno no sale a internet por defecto: descargá el zip y subilo como skill, y volvé a subirlo cuando haya una versión nueva.
- Cada `skill_load` deja un evento `brain.skill_loaded` con la persona, la skill, la versión y el canal. Listar y leer archivos no.
- Cada `skill_package` deja un evento `brain.skill_package_issued`.
- Cada subida confirmada de un zip (web o MCP) deja un evento `brain.skill_imported`; ver «Subir una skill desde un zip», más abajo.
- Las cuatro cuentan como lecturas en el límite por minuto.

Las skills se publican desde la plataforma; cómo, está en [el dominio brain](../dominios/brain.md).

### Crear y editar skills desde tu asistente

Si sos administrador o editor (de una carpeta de skills o de una skill), tu asistente tiene cuatro tools más. Aparecen solo para quien puede editar algo bajo `skills/`, y solo si la empresa tiene habilitada la categoría `skill`:

- `skill_create`: crea una skill nueva como **borrador**, en `skills/<carpeta>/<nombre>`. La `carpeta` es opcional: sin ella la skill queda directo bajo `skills/`. Va relativa a `skills/` (`ventas`, no `skills/ventas`) y tiene que existir. Si solo administrás o editás carpetas puntuales de skills (no todo `skills/`), tenés que pasar una de esas en `folder`: la descripción de la tool y el mensaje de rechazo le dicen a tu asistente cuáles son.
- `skill_draft_read`: lee el borrador (el `SKILL.md` completo, su revisión, su estado y sus archivos) o un archivo de texto.
- `skill_draft_edit`: cambia el borrador reemplazando un fragmento que aparece una sola vez, en el `SKILL.md` o en un archivo de texto.
- `skill_draft_write_file`: crea o reemplaza un archivo de texto del paquete.

Cosas a saber:

- **Todo va al borrador.** Lo que usan los demás no cambia hasta que un administrador publica desde la plataforma; `skill_load` y `skill_file` siguen devolviendo la versión publicada. Para probar tu cambio, pedile a tu asistente que lea el borrador.
- Cada cambio exitoso trae un link a la pantalla de la skill, donde un administrador revisa y publica.
- Por MCP entran archivos de texto de hasta 256 KB (el `SKILL.md` hasta 100 KB). Los binarios, borrar archivos, publicar y retirar son de la plataforma.
- Si otra persona guardó la skill mientras editabas, el asistente recibe un conflicto y tiene que leer el borrador de nuevo. Una skill que no podés editar responde igual que una que no existe.
- Los cambios al `SKILL.md` quedan en el historial de la página con tu nombre y `Edición por MCP: <motivo>` (la alta, con `Alta por MCP: <motivo>`). El motivo se guarda en el historial de la página solo para los cambios al `SKILL.md`: `skill_draft_write_file` no recibe motivo. Las escrituras cuentan como escrituras en el límite por minuto.
- El encabezado del `SKILL.md` admite `name`, `description`, `license` y `compatibility`. Si una edición agrega otro campo, el asistente recibe un error en lugar de perderlo al guardar.

### Subir una skill desde un zip

Si **administrás una carpeta** de `skills/` (o la empresa), tu asistente tiene dos tools más para subir una skill entera desde un zip, en un paso. Aparecen solo para quien administra al menos una carpeta de skills y solo si la empresa tiene habilitada la categoría `skill`. Un editor que no administra carpetas no las ve y sigue con `skill_create` y `skill_draft_*`. Si las llama sin permiso, recibe lo mismo que ante una carpeta que no existe.

- `skill_upload_link` (`{ folder }`): prepara la subida a una carpeta de skills. `folder` va relativa a `skills/` (`ventas`, no `skills/ventas`; vacía es directo en `skills/`). Devuelve un `uploadId`, una URL para subir el zip con un `PUT` y cuánto falta para que venza.
- `skill_import` (`{ uploadId, confirm? }`): lee el zip que subiste. Sin `confirm` devuelve la **vista previa** y no guarda nada; con `confirm: true` guarda la skill en el borrador y devuelve el link a su pantalla.

El flujo:

1. Tu asistente pide el link con `skill_upload_link`.
2. Sube el zip con un `PUT` a esa URL, con `Content-Type: application/zip` (hasta 4 MB).
3. Llama a `skill_import` con el `uploadId` y te muestra la vista previa: si crea o reemplaza, la ruta, los archivos y los avisos, o todos los problemas del zip juntos.
4. Si estás de acuerdo, vuelve a llamar con `confirm: true`. La skill queda en el borrador.

Cosas a saber:

- **Solo para clientes que ejecutan código y hacen una subida por HTTP**: Claude Code, Codex y Cursor. En claude.ai y ChatGPT web el asistente no puede armar ni subir un zip: usá `skill_create` y `skill_draft_write_file` para una skill de texto, o subí el zip desde la plataforma.
- El zip pesa hasta **4 MB**. El `SKILL.md` tiene que traer `name` y `description`; el destino lo elegís vos con `folder`, no sale del zip (del `SKILL.md` sale solo el `name`, que define el nombre de la skill dentro de la carpeta).
- El `uploadId` **vence a los 10 minutos de emitido el link**, también entre la vista previa y la confirmación: pasado ese tiempo hace falta un link nuevo, aunque el zip ya esté subido.
- **Todo va al borrador.** Si en esa carpeta ya hay una skill con ese `name`, reemplaza el texto y los archivos de su borrador; si no, la crea. Un administrador la revisa y la publica desde la plataforma, y los demás siguen viendo la versión publicada.
- Crear una skill nueva pide administrar la carpeta destino; reemplazar una existente, ser editor de esa skill.
- Cada subida confirmada deja un evento `brain.skill_imported` con la persona, el canal (`mcp`), la skill, si creó o reemplazó y cuántos archivos.
- `skill_upload_link` y `skill_import` con `confirm` cuentan como escrituras en el límite por minuto; `skill_import` sin `confirm`, como lectura.
- El `PUT` crudo con ese `Content-Type` se verificó contra el Supabase local (acepta el zip y un segundo `PUT` a la misma URL lo sobrescribe); todavía falta confirmarlo en producción, así que si tu cliente recibe un rechazo al subir, avisá. El flujo completo de `skill_import` con un cliente real tampoco se probó todavía. El detalle del diseño está en [el dominio brain](../dominios/brain.md).

## Si algo falla

- **403**: ese cliente no existe o tu cuenta no tiene acceso. Revisá el slug de la URL; si está bien, pedile a un administrador que te invite.
- **403 "Tu empresa no permite entrar con ese método"**: la empresa restringió con qué métodos se entra (link, código, Google). Entrá a la plataforma con uno permitido y volvé a conectar.
- **404**: el cliente no tiene brain configurado. Si tu cuenta es de administración de plataforma, también da 404 cuando el cliente no existe (para el resto, un cliente que no existe da 403).
- **401**: el token venció o no fue emitido para una aplicación conectada. Volvé a conectar el brain.
- **No se abre el login**: revisá que la URL termine en `/mcp` y que estés usando la de tu cliente.
