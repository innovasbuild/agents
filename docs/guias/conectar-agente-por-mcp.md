---
title: Conectar el agente por MCP
category: guias
status: activo
tags: [agente, mcp]
updated: 2026-10-13
sources:
  - agents/outreach/channels/mcp.ts
  - agents/outreach/channels/eve.ts
  - lib/agents/mcp-channel-auth.ts
  - lib/agents/agent-enabled.ts
  - lib/agents/catalog.ts
  - app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts
  - app/oauth/consent/page.tsx
  - app/[tenant]/conectar/page.tsx
  - lib/connect/connectables.ts
  - lib/connect/instructions.ts
  - next.config.ts
  - docs/superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md
  - docs/superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md
  - docs/superpowers/specs/2026-10-09-etapa-19-conectar-design.md
---

# Conectar el agente por MCP

Cada tenant usa la misma URL del agente, con el tenant como parámetro de conexión:

    https://agentes.innov.as/eve/outreach/v1/mcp?tenant=<cliente>

> Desde el 2026-09-28 (subida a eve 0.67) la URL cambió. Si tu conector apunta a `/eve/agents/outreach/eve/v1/mcp`, borralo y volvé a agregarlo con la URL de arriba: la vieja ya no responde.

La metadata OAuth del canal se sirve en `/.well-known/oauth-protected-resource/eve/outreach/v1/mcp` y la aprobación en `/oauth/consent`. Entrás con tu cuenta de la plataforma — la misma que usás para el brain o el dashboard.

El agente tiene que estar habilitado para tu empresa. El Asistente no tiene canal MCP (`mcp: false` en el catálogo): la página Conectar solo ofrece el de outreach. Las instrucciones por cliente, con la URL de tu empresa ya puesta, están en la plataforma: menú **Conectar** (`/[tenant]/conectar`, o sea `/<cliente>/conectar`). Este archivo queda como referencia.

## Claude Code

    claude mcp add --transport http outreach-<cliente> "https://agentes.innov.as/eve/outreach/v1/mcp?tenant=<cliente>"

Después, `/mcp`, elegí `outreach-<cliente>` y autenticá. Se abre el navegador, entrás con tu cuenta y aprobás el acceso — misma pantalla que la del brain.

## claude.ai

Configuración → Conectores → Agregar conector personalizado. Pegá la URL de arriba. Sin probar todavía (igual que con el brain).

## Otros clientes

La pantalla **Conectar** (`/<cliente>/conectar`) arma los pasos para Codex (probado), ChatGPT (probado con cuenta personal) y Cursor (sin probar), con la misma URL de arriba. Los textos salen de `lib/connect/instructions.ts`.

## Cómo se usa

El agente expone cuatro tools, las mismas para cualquier agente conectado por MCP:

- `agent_start`: le mandás un mensaje, te devuelve un `invocationId` al toque. El trabajo sigue corriendo aunque cierres la conexión.
- `agent_get`: con el `invocationId`, el estado actual. Mientras esté `working`, seguí preguntando cada tanto.
- `agent_update`: si el estado es `input_required` (por ejemplo, una tool que necesita que apruebes algo), contestás acá.

  Ojo: por este canal las aprobaciones no pasan por la cola del dashboard ni le llegan a otra persona. Cuando el agente pide aprobar algo (por ejemplo, mandar un mail), lo contesta quien maneja el cliente MCP (Claude Code, claude.ai) con `agent_update`. Si conectás el agente así, sos vos quien revisa y confirma cada aprobación antes de contestarla: nunca armes `agent_update` para que apruebe solo.
- `agent_cancel`: pide cancelar un trabajo en curso.

Un `agent_start` no es para reintentar solo: si se corta la respuesta, preguntale a la persona antes de mandar el mismo pedido dos veces.

## Si algo falla

- **403 "Falta el tenant en la URL de conexión":** revisá que la URL tenga `?tenant=<slug>` — sin eso, no hay forma de saber a qué cliente te conectás.
- **401 "El token no es válido o venció":** volvé a autenticar el conector (`/mcp` en Claude Code).
- **403 "no tenés acceso a ese cliente":** tu cuenta no tiene membresía ahí. Pedile a un administrador que te invite.
- **No se abre el login:** la URL tiene que apuntar a `/eve/outreach/v1/mcp`, con el `?tenant=` de tu cliente.
- **403 "Ese agente no está habilitado para este cliente":** el agente está apagado para tu empresa. Pedile a un administrador de la plataforma que lo habilite.
