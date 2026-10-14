---
title: Conectar el brain por MCP
category: guias
status: activo
tags: [brain, mcp]
updated: 2026-10-13
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

Las tres tools aparecen siempre en la lista. Una página que no podés ver no aparece en la búsqueda y responde "no encontrada" al leerla.

Por defecto hay un límite de 60 lecturas y 10 escrituras por minuto por persona (cada brain puede tener otros valores, entre 1 y 1000, en su configuración). Si lo pasás, la respuesta dice cuántos segundos esperar. Un pedido de más de 1 MiB se rechaza con 413.

## Skills de la empresa

Las skills (todo lo que está bajo `skills/`) no salen por `brain_search`, `brain_read` ni `brain_upsert`: esas tres responden "no encontrada" sobre `skills/`. Salen por tres tools propias, que aparecen **solo si vos ves alguna skill publicada**:

- `skill_list`: las skills que podés usar, con descripción y versión publicada.
- `skill_load`: carga una skill por nombre y devuelve sus instrucciones y la lista de sus archivos. Su descripción trae, además, la lista de tus skills, para que el asistente la use sin que se lo pidas.
- `skill_file`: lee un archivo de texto de una skill ya cargada, por la ruta que figura en la lista de `skill_load`.

Cosas a saber:

- Siempre recibís la **última versión publicada**, también si sos quien edita la skill: el borrador se ve solo en la plataforma. Ves una skill si tenés al menos lectura sobre su ruta y tiene una publicación vigente; una que no ves responde igual que una que no existe.
- La descripción de `skill_load` lista hasta 30 skills, con 300 caracteres de descripción cada una. Una skill recién publicada aparece ahí cuando el cliente vuelve a pedir las tools (reconectando, por ejemplo); en `skill_list` aparece siempre.
- Por MCP viajan archivos de texto de hasta 256 KB. Los binarios y lo más pesado están en **Descargar paquete**, en la página de la skill: baja un zip de la versión publicada.
- Los scripts de una skill no se ejecutan desde el servidor todavía (etapa 24.2b); se pueden leer como texto.
- Cada `skill_load` deja un evento `brain.skill_loaded` con la persona, la skill, la versión y el canal. Listar y leer archivos no.
- Las tres cuentan como lecturas en el límite por minuto.

Las skills se arman y se publican desde la plataforma; cómo, está en [el dominio brain](../dominios/brain.md).

## Si algo falla

- **403**: ese cliente no existe o tu cuenta no tiene acceso. Revisá el slug de la URL; si está bien, pedile a un administrador que te invite.
- **403 "Tu empresa no permite entrar con ese método"**: la empresa restringió con qué métodos se entra (link, código, Google). Entrá a la plataforma con uno permitido y volvé a conectar.
- **404**: el cliente no tiene brain configurado. Si tu cuenta es de administración de plataforma, también da 404 cuando el cliente no existe (para el resto, un cliente que no existe da 403).
- **401**: el token venció o no fue emitido para una aplicación conectada. Volvé a conectar el brain.
- **No se abre el login**: revisá que la URL termine en `/mcp` y que estés usando la de tu cliente.
