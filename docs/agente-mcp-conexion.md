# Conectar el agente por MCP

Cada tenant usa la misma URL del agente, con el tenant como parámetro de conexión:

    https://agentes.innov.as/eve/agents/outreach/eve/v1/mcp?tenant=<cliente>

Entrás con tu cuenta de la plataforma — la misma que usás para el brain o el dashboard.

## Claude Code

    claude mcp add --transport http outreach-<cliente> "https://agentes.innov.as/eve/agents/outreach/eve/v1/mcp?tenant=<cliente>"

Después, `/mcp`, elegí `outreach-<cliente>` y autenticá. Se abre el navegador, entrás con tu cuenta y aprobás el acceso — misma pantalla que la del brain.

## claude.ai

Configuración → Conectores → Agregar conector personalizado. Pegá la URL de arriba. Sin probar todavía (igual que con el brain).

## Cómo se usa

El agente expone cuatro tools, las mismas para cualquier agente conectado por MCP:

- `agent_start`: le mandás un mensaje, te devuelve un `invocationId` al toque. El trabajo sigue corriendo aunque cierres la conexión.
- `agent_get`: con el `invocationId`, el estado actual. Mientras esté `working`, seguí preguntando cada tanto.
- `agent_update`: si el estado es `input_required` (por ejemplo, una tool que necesita que apruebes algo), contestás acá.

  Ojo: por este canal las aprobaciones no pasan por la cola del dashboard ni le llegan a otra persona. Cuando el agente pide aprobar algo (por ejemplo, mandar un mail), lo contesta quien maneja el cliente MCP (Claude Code, claude.ai) con `agent_update`. Si conectás el agente así, sos vos quien revisa y confirma cada aprobación antes de contestarla: nunca armes `agent_update` para que apruebe solo.
- `agent_cancel`: pide cancelar un trabajo en curso.

Un `agent_start` no es para reintentar solo: si se corta la respuesta, preguntale a la persona antes de mandar el mismo pedido dos veces.

## Si algo falla

- **403 sin mensaje sobre el tenant:** revisá que la URL tenga `?tenant=<slug>` — sin eso, no hay forma de saber a qué cliente te conectás.
- **403 "no tenés acceso a ese cliente":** tu cuenta no tiene membresía ahí. Pedile a un administrador que te invite.
- **No se abre el login:** la URL tiene que apuntar a `/eve/agents/outreach/eve/v1/mcp`, con el `?tenant=` de tu cliente.
