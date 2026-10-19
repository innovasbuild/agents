---
title: Agentes eve
category: dominios
status: activo
tags: [eve, agente, outreach, asistente, tools, mcp, chat, aprobaciones]
updated: 2026-10-19
sources:
  - agents/outreach/agent.ts
  - agents/outreach/instructions.md
  - agents/outreach/instructions/tenant.ts
  - agents/outreach/channels/eve.ts
  - agents/outreach/channels/mcp.ts
  - agents/outreach/connections/tenant.ts
  - agents/outreach/hooks
  - agents/outreach/schedules
  - agents/outreach/skills
  - agents/outreach/tools
  - agents/outreach/evals
  - agents/asistente/agent.ts
  - agents/asistente/instructions.md
  - agents/asistente/instructions/tenant.ts
  - agents/asistente/channels/eve.ts
  - agents/asistente/hooks
  - agents/asistente/tools
  - agents/asistente/evals
  - lib/agents/eve
  - lib/agents/assistant-instructions.ts
  - lib/agents/chat-agents.ts
  - lib/agents/chat-composer.ts
  - app/[tenant]/chat/composer.tsx
  - lib/agents/catalog.ts
  - lib/agents/session-store.ts
  - lib/agents/mcp-channel-auth.ts
  - lib/agents/agent-enabled.ts
  - lib/agents/channel-context.ts
  - lib/agents/running-tool.ts
  - lib/agents/input-requests.ts
  - lib/agents/model.ts
  - lib/agents/mail-preview.ts
  - lib/agents/eval-auth.ts
  - app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts
  - docs/superpowers/specs/03-agente-outreach-v1.md
  - docs/superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md
  - docs/superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md
  - docs/superpowers/specs/2026-10-13-etapa-22-1-chat-multiagente-design.md
---

# Agentes eve

## 1. Qué es y para qué

La plataforma corre sus agentes sobre [eve](../../node_modules/eve/docs/README.md), un framework de archivos: el agente es una carpeta con instrucciones, tools, conexiones, canales, schedules, hooks, skills y evals, y eve le da sesiones durables, streaming y aprobaciones. Hoy hay dos, ambos declarados en `next.config.ts`: `asistente` (`agents/asistente/`), que conversa solo con el brain de la empresa, y `outreach` (`agents/outreach/`), que investiga cuentas, redacta mensajes, arma la cola de envíos y manda desde la casilla del ejecutor lo que éste aprueba. El proceso de negocio de outreach está en [outreach](outreach.md); esta página es el cómo están armados los agentes. Salvo que se diga otra cosa, las secciones de abajo describen a `outreach`, que es el que tiene tools de dominio, canal MCP, schedules y skills.

El agente es de la plataforma, no de un cliente: la diferencia entre empresas es una fila (`tenant_agents`) y su [brain](brain.md). Todo lo que depende del tenant se resuelve al empezar la sesión (ver "Qué se resuelve al empezar la sesión"). Las reglas de nodos, workflows y niveles de efecto están en [orquestación](../arquitectura/orquestacion.md); los workflows que corren desatendidos, en [workflows](workflows.md).

## 2. Dónde vive en el código

| Ruta | Qué es |
|---|---|
| `agents/asistente/` | El agente Asistente: `agent.ts`, `instructions.md`, `instructions/tenant.ts`, `channels/eve.ts`, `hooks/{bind-session,runs,usage}.ts`, `tools/brain.ts` y cinco evals |
| `lib/agents/eve/` | Lo que comparten los agentes: `webChannel`, `bindSessionHook`, `runsHook`, `usageHook`, `tenantModel`, `brainTools` y `attribute` |
| `lib/agents/chat-agents.ts` | `availableChatAgents` y `defaultChatAgent`: qué agentes ofrece el chat y cuál queda elegido |
| `lib/agents/assistant-instructions.ts` | El contexto que se suma a las instrucciones del Asistente |
| `agents/outreach/agent.ts` | Config del agente. Solo el modelo, resuelto por tenant en `session.started` |
| `agents/outreach/instructions.md` | Constitución genérica: los cinco frenos, guardrails, claim por persona, piezas trabadas, estilo |
| `agents/outreach/instructions/tenant.ts` | Instrucciones dinámicas: resumen del día y alertas de workflows del tenant |
| `agents/outreach/tools/*.ts` | Las 13 tools (tabla de abajo) |
| `agents/outreach/connections/tenant.ts` | Conexiones del tenant, un solo resolver dinámico |
| `agents/outreach/channels/eve.ts` | Canal del chat del dashboard (auth Supabase) |
| `agents/outreach/channels/mcp.ts` | Canal MCP para Claude Code y claude.ai (OAuth) |
| `agents/outreach/hooks/{bind-session,runs,executors,usage}.ts` | Atan la sesión a la conversación, abren y cierran `runs`, marcan Gmail autorizado, asientan cada paso del modelo en `usage_entries` (ver [modelos y costos](../arquitectura/modelos-y-costos.md#los-pasos-del-agente-en-el-chat)) |
| `agents/outreach/schedules/*.ts` | Los cuatro schedules (cableado; la lógica vive en `lib/`) |
| `agents/outreach/skills/*/SKILL.md` | `outreach-corrida`, `outreach-redaccion`, `outreach-crm`, `outreach-escucha` |
| `agents/outreach/evals/` | Las nueve evals de outreach y su `support.ts` |
| `lib/agents/catalog.ts` | `AGENT_CATALOG`: única lista de agentes de la plataforma |
| `lib/agents/session-store.ts` | `bindSessionToConversation`, `openRun`, `closeRun` |
| `lib/agents/channel-context.ts` | Resuelve tenant y dueño de un request del canal del chat |
| `lib/agents/mcp-channel-auth.ts`, `agent-enabled.ts` | Acceso al canal MCP y chequeo de agente habilitado |
| `lib/agents/running-tool.ts` | `TOOL_LABELS`, `TOOLS_SIN_ETIQUETA` y el indicador de actividad |
| `lib/agents/input-requests.ts` | Pedidos de input pendientes (aprobaciones, límites, preguntas) |
| `lib/agents/mail-preview.ts` | Qué muestra el chat como "el mail tal cual sale" |
| `lib/agents/model.ts`, `eval-auth.ts` | Modelo por tenant; principal fijo para evals locales |
| `app/[tenant]/chat/` | Pantalla `/[tenant]/chat` (cliente, acciones, adjuntos) |

## 3. Cómo funciona

### Los agentes

| Agente | Qué hace | Tools | MCP | Schedules | Canon |
|---|---|---|---|---|---|
| `asistente` | Conversa con el conocimiento de la empresa: busca, lee y propone páginas del brain. No envía, no toca el CRM, no investiga cuentas | Solo las del brain (`brain_search`, `brain_read` y `brain_upsert` con aprobación de un administrador), según el acceso que la consola le dio | No (`mcp: false`) | Ninguno | No (`canon: false`): habilitarlo no siembra páginas |
| `outreach` | Investiga cuentas, redacta mensajes, arma la cola y envía lo aprobado | Las 13 de abajo | Sí (`mcp: true`) | Los cuatro de abajo | Sí (`canon: true`): al habilitarlo la consola siembra `comercial/icp` y `comercial/hooks` |

Los valores salen de `AGENT_CATALOG`. Los dos piden brain para trabajar (`requiresBrain`) y se usan desde el chat (`chat: true`). El Asistente no tiene `connections/`, `schedules/`, `skills/`, `channels/mcp.ts` ni `hooks/executors.ts`, y no registra nada en el registro de workflows. Sus instrucciones (`agents/asistente/instructions.md`) lo atan al brain: buscar antes de contestar, nombrar la página de donde sale cada dato, decir "eso no está en el brain" cuando no está, y buscar con una o dos palabras clave porque la búsqueda exige todas las palabras. `instructions/tenant.ts` suma el contexto de la sesión (`lib/agents/assistant-instructions.ts`), que le dice qué otros agentes de chat tiene habilitados la empresa para derivarles lo que él no hace.

### Lo que comparten

`lib/agents/eve/` tiene lo que antes era de outreach: `webChannel(agent)` (el canal del chat), `bindSessionHook()`, `runsHook()` y `usageHook()` (atan la sesión a la conversación, abren y cierran `runs` y asientan cada paso del modelo), `tenantModel(agent)` (el modelo por tenant, con la etiqueta `tenant:<slug>` del gateway) y `brainTools(agent)` (las tools del brain), más `attribute.ts` con el helper que lee los atributos de la auth. Cada agente los monta desde archivos de pocas líneas: `agents/asistente/agent.ts` es `defineAgent({ model: tenantModel("asistente") })`, `channels/eve.ts` es `export default webChannel("asistente")` y `tools/brain.ts` es `export default brainTools("asistente")`. Los de `agents/outreach/` son lo mismo con su nombre.

Quedó el camino directo del spike: eve compila esos archivos con la fábrica importada desde `lib/agents/eve/`, y las evals `brain-tools` de los dos agentes lo prueban contra el agente compilado. Los módulos que importa una carpeta de `agents/` usan imports relativos, nunca `@/`, porque eve no resuelve los paths de `tsconfig`.

### Agregar un agente

1. La carpeta `agents/<nombre>/` con `agent.ts`, `instructions.md`, `channels/eve.ts` (con `webChannel`), `hooks/` (con `bindSessionHook` y `runsHook`) y, si usa el brain, `tools/brain.ts` (con `brainTools`).
2. La clave en `next.config.ts`, dentro de `agents`.
3. La entrada en `lib/agents/catalog.ts`. Un test compara las tres listas (carpetas, `next.config.ts` y catálogo) y falla hasta que coincidan.
4. Una fila en `tenant_agents` por empresa que lo use, desde la consola de plataforma o con una migración (la del Asistente es `20261021120000_asistente_agent`, que lo habilita en toda empresa con brain).
5. La etiqueta en castellano de cada tool en `TOOL_LABELS`, o su entrada en `TOOLS_SIN_ETIQUETA`.

### Qué se resuelve al empezar la sesión

Todo lo que cambia por cliente se resuelve con `defineDynamic` en el evento `session.started`, no por turno: el prompt cache es por modelo, y cambiar algo a mitad de sesión reingiere la conversación a precio sin cachear. El tenant sale siempre de los `attributes` de la auth de la sesión, nunca de un input del modelo.

| Slot | Qué resuelve |
|---|---|
| `model` (`agent.ts`) | `resolveModelForTenant`: override del agente en `tenant_agents.model`, después lo elegido en el hilo (`conversations.model`), después `tenants.default_model`. Un modelo solo vale si está en `tenants.allowed_models`. Con el slug del tenant en la auth, `modelSelection` lo devuelve junto con el tag `tenant:<slug>` del AI Gateway |
| `instructions/tenant.ts` | Resumen de sesión (`sessionSummary`) para un usuario; si la base falla, la sesión arranca igual con una línea mínima. Suma las alertas de workflows de las últimas horas |
| `connections/tenant.ts` | `resolveTenantConnections` con los bindings del tenant. Un tenant sin binding de una capacidad no tiene esa clave |
| `tools/brain.ts` | Tools del brain (`brain_search`, `brain_read`, y `brain_upsert` con aprobación de un administrador) solo si el agente tiene acceso declarado y el tenant tiene binding. Los schemas van inline: un schema en una variable es una captura no serializable y eve descarta todo el resolver en silencio (causa de [#57](https://github.com/innovasbuild/agents/pull/57) y de la regla de la 0.59) |

La tool `brain` es un resolver dinámico, no una tool de dominio: aparece como `brain` en el inventario, pero lo que expone son esas tres.

### Las 13 tools

Cada tool toma el caller de `callerFromSession` (principal de tipo usuario, con tenant), y devuelve `{ ok: false, reason }` ante un guard en vez de tirar. El nivel de efecto es el del nodo de [workflows](workflows.md) que usa (0 lee o escribe solo la base propia, 1 gasta, 2 escribe en el CRM, 3 le llega a una persona).

| Tool | Qué hace | Efecto | Aprobación |
|---|---|---|---|
| `brain` | Resolver dinámico de `brain_search`, `brain_read` y `brain_upsert` según acceso y binding | 0 (lectura); `brain_upsert` escribe el canon | `brain_upsert`: `always()` y la responde un administrador (`decideBrainUpsertResponse`) |
| `crm_setup_outreach_properties` | Crea en el HubSpot del tenant las propiedades custom de outreach que falten. Idempotente. Solo `tenant_admin` o `platform_admin` | 2 | `always()` |
| `crm_upsert_contact` | Registra en el CRM un avance fuera del mail (llamada, LinkedIn, reunión): mueve la etapa solo hacia adelante y agrega una nota | 2 (nodo `outreach/crm-record`) | `once()` |
| `draft_message` | Redacta el primer mensaje con la ficha y el canon, y lo pasa por el gate (hasta 3 intentos). No encola ni envía | 1 (nodo `outreach/draft`, envuelto en `metered`) | ninguna |
| `import_contacts` | Carga contactos desde un CSV pegado (hasta 50 filas) y devuelve un veredicto por fila. No escribe en el CRM | 0 (nodo `outreach/import-contacts`) | ninguna |
| `list_queue` | Lista las piezas del ejecutor con letra, destinatario, asunto y cuerpo; marca `trabada: true` las que quedaron entre aprobación y envío | 0 (nodo `outreach/queue`) | ninguna |
| `log_event` | Deja constancia de un `freno` o una `nota`. Solo esos dos tipos (`MODEL_LOGGABLE_EVENT_TYPES`) | 0 | ninguna |
| `queue_touch` | Encola un mensaje ya redactado como pieza pendiente: vuelve a correr el gate, chequea el claim y reserva a la persona | 0 (nodo `outreach/queue`) | ninguna |
| `read_replies` | Trae, sin interpretar, las respuestas que siguen en `respuesta_neutra` | 0 (nodo `outreach/replies`) | ninguna |
| `reject_queue_item` | Descarta una pieza pendiente propia y libera a la persona si no recibió ningún toque | 0 (nodo `outreach/queue`) | ninguna |
| `research_account` | Investiga la empresa de un dominio leyendo su web y guarda la ficha 90 días; si hay ficha vigente la devuelve sin costo | 1 (nodo `outreach/research`, envuelto en `metered`) | ninguna |
| `send_email` | Envía por Gmail una pieza pendiente de la cola. Recibe `queueItemId` y exactamente el `to`, `subject` y `body` de `list_queue` | 3 (nodo `outreach/send`) | `always()` |
| `update_queue_item` | Edita asunto y cuerpo de una pieza pendiente propia; vuelve a correr el gate y si no pasa no guarda | 0 (nodo `outreach/queue`) | ninguna |

Verificado en `agents/outreach/tools/*.ts`: solo `crm_setup_outreach_properties`, `send_email` (`always()`) y `crm_upsert_contact` (`once()`) declaran `approval` en el archivo; `brain_upsert` lo declara en `lib/brain/adapters/tools.ts`. La regla de [orquestación](../arquitectura/orquestacion.md) dice que toda tool de nivel 2 o 3 lleva `approval` explícito en el chat, y el código la cumple. La spec 03 decía `once()` para `read_replies`; en disco no tiene aprobación porque solo lee la base.

### Aprobaciones

- `send_email` es el único camino de salida. Lo aprobado es lo enviado: la tool recibe `to`, `subject` y `body` y los compara contra la fila de `queue_items`; si la pieza cambió después de pedir la aprobación devuelve `pieza_cambiada` y hay que pedirla de nuevo. La tarjeta de aprobación es la confirmación del usuario: el agente no pide otra por texto ([#56](https://github.com/innovasbuild/agents/pull/56)).
- Un 401 de Gmail llama a `ctx.requireAuth` y deja la pieza en `pending`; el hook `executors.ts` marca Gmail autorizado cuando termina la autorización (`authKey` `gmail`).
- En el chat, `pendingInputRequests` (`lib/agents/input-requests.ts`) traduce los pedidos de eve a tarjetas. Cada pedido se responde con el `id` de sus propias opciones: una aprobación nunca acepta texto, porque eve toma cualquier respuesta que no sea `approve` como inválida ([#12](https://github.com/innovasbuild/agents/pull/12)). Se traducen las etiquetas de eve a "Aprobar" / "Rechazar" y los límites de sesión; las preguntas con `ctx.ask` quedan como las escribe la tool.
- Rechazar permite escribir un motivo opcional, que viaja como el próximo mensaje del chat; la pieza queda `pending`.
- Los botones se deshabilitan mientras el store está `submitted`, `streaming` o `resuming`: la tarjeta se va cuando confirma el servidor, no al hacer click (eve 0.67).

### Chat con más de un agente

- Un hilo pertenece a un agente: `conversations.agent` se fija al crearlo (`createConversation(tenantId, slug, model, agent)`) y no cambia. La acción rechaza un agente que no esté en el catálogo, que no sea de chat o que no esté habilitado en la empresa.
- Cada agente tiene su ruta (`/eve/<agente>/v1/*`) y `resolveChannelContext(request, userId, allowsLogin, agent)` rechaza una conversación cuyo agente no es el de la ruta: de lo contrario se abriría una sesión de un agente colgada del hilo de otro.
- El chat arranca en la pantalla "¿En qué trabajamos?": un compositor (`app/[tenant]/chat/composer.tsx`) con adjuntar, agente, modelo y enviar. El hilo **se crea al enviar el primer mensaje**, no al tocar "Nuevo chat": el botón queda deshabilitado mientras no haya un hilo abierto, así que no se acumulan hilos vacíos. En un hilo abierto el agente y el modelo quedan fijos (eve los fija al abrir la sesión).
- El selector de agente del compositor aparece en el chat nuevo solo si hay más de un agente de chat habilitado (`chatAgents` en `lib/tenants/home.ts`, `availableChatAgents` en `lib/agents/chat-agents.ts`). Con uno solo no hay nada que elegir ni que rotular. Queda elegido el agente del hilo más reciente (`defaultChatAgent`) o, si no hay hilos, el primero del catálogo; también cae en el primer agente disponible cuando el agente del último hilo ya no está habilitado.
- Los hilos de un agente deshabilitado no se listan: el canal rechazaría su sesión, así que ni el historial se puede abrir.
- El indicador de actividad y los adjuntos sirven a cualquier agente; las tarjetas de mail y de cola solo aparecen con las tools de outreach.

### Chat: adjuntos, mail tal cual sale, indicador de actividad

- **Adjuntos.** El composer tiene un clip: el archivo se lee a `data:` URL y viaja como parte `file` del mensaje, con tope de 15 MB del lado del cliente ([#44](https://github.com/innovasbuild/agents/pull/44)). El caso de uso es pegar un CSV de leads para que lo procese `import_contacts`. La caja es multilínea (Enter envía, Shift+Enter salta de línea, [#64](https://github.com/innovasbuild/agents/pull/64)).
- **Mail tal cual sale.** `MailPreview` muestra cuerpo y firma igual que el envío, en `draft_message`, `list_queue` (una tarjeta por pieza) y la aprobación de `send_email`. Solo se firma lo que trae `to`, `subject` y `body` (`isEmailApproval`) ([#50](https://github.com/innovasbuild/agents/pull/50)).
- **Indicador de actividad.** `thinkingLabel` decide qué decir: nada con una tarjeta abierta, "Reanudando el hilo…" al retomar, la etiqueta de la tool en curso, "Pensando…" mientras no se escribe texto ([#22](https://github.com/innovasbuild/agents/pull/22)).
- **Borrar hilos.** Cada conversación se puede borrar; los `runs` sobreviven con `conversation_id` en null. Borrar no frena un turno en vuelo.

### `TOOL_LABELS` y `TOOLS_SIN_ETIQUETA`

`toolName` son identificadores en inglés y la UI va en rioplatense, así que `lib/agents/running-tool.ts` traduce cada tool en `TOOL_LABELS` (por ejemplo `send_email` → "Mandando el mail"). Una tool sin entrada nunca muestra el id crudo: cae en "Trabajando". Toda tool nueva en `agents/<agente>/tools/` lleva su etiqueta o entra en `TOOLS_SIN_ETIQUETA` si a propósito no se nombra en pantalla; hoy esa lista está vacía y las 13 tienen etiqueta. `tests/agents/running-tool.test.ts` compara ambas contra el disco y falla hasta que alguien decida. El comentario del archivo dice "doce tools": está desactualizado, son 13.

Límite conocido: con tools en paralelo en un mismo mensaje, un hermano ya terminado tapa a uno que sigue corriendo; el indicador prefiere quedarse corto.

### Sesiones y runs

- `hooks/bind-session.ts` (en `session.started`) llama `bindSessionToConversation`: escribe `conversations.eve_session_id`. Última escritura gana, a propósito. Sin try/catch: si falla, el turno tiene que fallar, porque sin esa fila nadie puede continuar la sesión. Las sesiones con `authenticator` `oauth` (canal MCP) no se atan: no crean conversación.
- `hooks/runs.ts` abre una fila de `runs` en `turn.started` (`trigger` `chat` o `mcp`) y la cierra en `turn.completed`, `turn.failed` o `turn.cancelled`; al cerrar calcula el costo desde el libro de consumo (`set_run_cost`). Es observabilidad: todo va en try/catch, porque un hook que tira termina en `turn.failed`.
- `lib/agents/channel-context.ts` es la puerta del canal del chat: eve no valida ownership de sesión, así que acá se resuelve el tenant. Al crear la sesión sale de la conversación (header `x-innovas-conversation`); al continuar, se busca por `eve_session_id` y se ignora lo que mande el browser. Exige que la conversación sea del usuario, que sea miembro del tenant, que el agente esté habilitado en `tenant_agents` y que el método de login esté permitido. Hay una escalera de reintentos (hasta ~3 s) por la carrera con `bind-session`, que se corta si la conversación ya no existe.
- `hooks/usage.ts` (en `step.completed`) asienta cada paso del modelo en `usage_entries` (`node: agent/step`, `resource: model_usd`) con la corrida del turno y, para el respaldo de precio, el modelo que recordó de `step.started`. La lógica vive en `usageHook()` de `lib/agents/eve/hooks.ts`, junto a `runsHook()`: cada agente la exporta desde su `hooks/usage.ts` (outreach y asistente). Como `runs.ts`, es observabilidad: todo va en try/catch y nunca tumba un turno. Un agente nuevo exporta el mismo hook; `tests/agents/usage-wiring.test.ts` falla si falta. Detalle en [modelos y costos](../arquitectura/modelos-y-costos.md#los-pasos-del-agente-en-el-chat).
- `agents/outreach/channels/eve.ts` (y el del Asistente, que es el mismo `webChannel`) usa `supabaseAuth(agent)`; solo fuera de Vercel suma la auth de eval y `localDev()`. `localDev()` nunca puede quedar activo en un deploy.

### Canal MCP del agente

`channels/mcp.ts` expone el agente a Claude Code y claude.ai en `<PUBLIC_APP_URL>/eve/outreach/v1/mcp?tenant=<slug>` (cómo conectarlo: [conectar el agente por MCP](../guias/conectar-agente-por-mcp.md)). Reusa el emisor OAuth del brain con `scopes: ["openid", "email"]`. `publicSettings()` exige `PUBLIC_APP_URL` y `NEXT_PUBLIC_SUPABASE_URL` y falla al cargar si faltan.

`resolveMcpChannelAuth` (`lib/agents/mcp-channel-auth.ts`), en este orden:

1. Token válido (si no, "El token no es válido o venció.").
2. `?tenant=` presente (el tenant nunca es un argumento del modelo).
3. Membresías del usuario, y recién después el tenant: así nadie sin acceso distingue qué slugs existen.
4. Solo una fila `platform_admin` del tenant dueño (`PLATFORM_OWNER_TENANT_SLUG`) cuenta como plataforma; en otro tenant vale como `tenant_admin` ([#82](https://github.com/innovasbuild/agents/pull/82)). Sin la variable, nadie entra como plataforma por este canal.
5. **Agente habilitado**: `loadAgentEnabled` lee `tenant_agents.enabled`; sin fila o en falso, "Ese agente no está habilitado para este cliente." Se pregunta después del guard de membresía, y falla cerrado ([#84](https://github.com/innovasbuild/agents/pull/84)).

El `subject` de la sesión es `tenantSubjectId(tenant, usuario)` para que la misma persona en dos tenants no vea las invocaciones del otro, y el `issuer` es el mismo del chat: otro `issuer` sería otra identidad y pediría autorizar Gmail y HubSpot de nuevo. Una aprobación por MCP la contesta el cliente conectado con `agent_update`; no entra a la cola del dashboard.

La metadata OAuth (RFC 9728) no la sirve eve: la reescritura de Vercel solo reenvía el prefijo del protocolo, así que la sirve Next.js a mano en `/.well-known/oauth-protected-resource/eve/outreach/v1/mcp`.

### Catálogo de agentes

`AGENT_CATALOG` (`lib/agents/catalog.ts`) es la única lista: el alta de empresas, la consola y la página Conectar leen de ahí, y un test la compara contra las carpetas de `agents/` y `next.config.ts`. Cada entrada declara capacidades de conector, si puede acceder al brain, si lo necesita para trabajar (`requiresBrain`: la consola no deja habilitarlo sin brain) y si se usa desde el chat.

### Schedules

Los cuatro son cableado: arman las dependencias reales, toman un lock en `runs` por `schedule_key` y recorren los tenants; la lógica vive en `lib/` con dependencias inyectadas. Ninguno envía mail. Detalle en [outreach](outreach.md) y [workflows](workflows.md).

| Schedule | Cron (UTC) | Qué hace |
|---|---|---|
| `morning-sweep` | `0 10 * * 1-5` | Barrido de la mañana: respuestas, rebotes, piezas colgadas, vencimientos; pasa al chat lo que necesita una persona. Cierra su fila de `runs` al terminar ([#66](https://github.com/innovasbuild/agents/pull/66)) |
| `followups` | `0 11 * * 1-5` | Encola follow-ups `pending` para los contactos con `next_step_at` vencido |
| `crm-sync` | `0 12,21 * * *` | Sync entrante de HubSpot (nodo `outreach/crm-sync`), dos veces por día |
| `dispatch` | `*/5 * * * *` | Dispatcher de workflows: cada 5 minutos pregunta a quién le toca; la cadencia de cada workflow la pone su config por tenant |

La spec 03 fijaba `followups` a `30 10 * * 1-5`; en disco es `0 11 * * 1-5`.

### Evals

Cinco evals del Asistente en `agents/asistente/evals/` (con su `evals.config.ts` y `support.ts`; comparten el tenant de eval con las de outreach, así que la concurrencia es 1): `smoke` (responde con la auth de eval), `brain-tools` (`brain_search` y `brain_read` corren en el agente compilado y un juez comprueba que la respuesta nombra la página), `sin-dato` (si el brain no tiene la respuesta, busca, lo dice y no inventa), `sin-otros-agentes` (con outreach apagado, ante un pedido de mail dice que no está disponible y no promete otro agente) y `deriva-a-outreach` (con outreach habilitado nombra a ese agente y no dice haber enviado nada). Se corren con `npm run evals -- --agent asistente [evalId...]`.

Nueve evals de outreach en `agents/outreach/evals/`, con `evals.config.ts` (concurrencia 1, porque comparten el tenant sembrado) y `support.ts`. Se corren contra la Supabase local; guía en [correr evals](../guias/correr-evals.md).

| Eval | Verifica |
|---|---|
| `smoke` | El agente responde con la auth de eval y no envía nada sin que se lo pidan |
| `research` | `research_account` lee la web y guarda una ficha con hechos con URL |
| `draft-msg1` | `draft_message` produce un primer mensaje que pasa el gate y abre con el hecho de la ficha |
| `claim-ajeno` | Un contacto con claim de otro ejecutor no se encola y el agente cita el motivo |
| `sin-aprobacion-no-sale` | `send_email` pide aprobación en el primer turno; con `cancel` la pieza sigue pendiente |
| `aprobar-sin-gmail` | Aprobar sin grant de Gmail pide autorización, el turno no queda `failed` y la pieza sigue pendiente |
| `frenos` | Ante FRENA el agente frena, lo registra y no sigue llamando tools |
| `cola-por-letras` | "A y C mandalas, B con este cambio, D descartala" produce `send_email`, `update_queue_item` y `reject_queue_item` |
| `brain-tools` | `brain_search`, `brain_read` y `brain_upsert` existen en el agente compilado; `brain_upsert` pide aprobación |

`brain-tools` existe porque vitest no corre el compilador de eve: es la única prueba de que los schemas de las tools dinámicas son serializables.

### Lo que nunca se hace

- No se manda mail sin aprobación: `send_email` es la única salida y tiene `approval: always()`. Un schedule no tiene ninguna dependencia de envío.
- Una tool no confía en el modelo para tenant, ejecutor ni rol: salen de la auth de la sesión.
- No se declaran tools dinámicas con schemas en variables ni closures sobre funciones locales.
- Un hook de observabilidad nunca tira; el de `bind-session` sí, a propósito.
- `localDev()` y la auth de eval no se activan en Vercel ni contra una base que no sea local.

## 4. Cómo se prueba

| Qué | Dónde |
|---|---|
| Etiquetas contra el disco, indicador de actividad | `tests/agents/running-tool.test.ts` |
| Aprobaciones y pedidos de input | `tests/agents/input-requests.test.ts` |
| Canal del chat y acceso al canal MCP | `tests/agents/channel-context.test.ts`, `tests/agents/mcp-channel-auth.test.ts`, `tests/agents/agent-enabled.test.ts`, `tests/channel/auth.test.ts` |
| Modelo, catálogo, sesiones, preview de mail, auth de eval | `tests/agents/{model,catalog,session-store,mail-preview,eval-auth}.test.ts` |
| Hooks | `tests/hooks/{bind-session,runs,executors,usage}.test.ts`; `tests/agents/usage-wiring.test.ts` exige que cada agente tenga `usage.ts` y que `tenantModel` etiquete con `modelSelection(` |
| Tools | `tests/agents/outreach/tools/`, `tests/tools/send-email.test.ts`, `tests/tools/crm-setup-outreach-properties.test.ts` |
| Acciones del chat (borrar hilo) | `tests/chat/actions.test.ts` |
| Selector, hilos por agente y puerta del canal | `tests/agents/chat-agents.test.ts`, `tests/agents/channel-context.test.ts`, `tests/chat/actions.test.ts` |
| Comportamiento del agente | las nueve evals de outreach: `npm run evals` (o `npm run evals -- <evalId>`) y las cinco del Asistente: `npm run evals -- --agent asistente`, contra la Supabase local; se niega si `NEXT_PUBLIC_SUPABASE_URL` no es local |

```bash
npm test -- tests/agents tests/chat tests/hooks
npm run evals -- smoke
```

## 5. Decisiones

- Spec [etapa 22.1, chat multiagente](../superpowers/specs/2026-10-13-etapa-22-1-chat-multiagente-design.md): el código común de los agentes sale de `agents/outreach/` a `lib/agents/eve/`, el catálogo suma `canon` y `mcp`, el chat guarda un hilo por agente y aparece el Asistente, que solo conversa con el brain.
- Spec [03-agente-outreach-v1](../superpowers/specs/03-agente-outreach-v1.md): tools granulares con guards en código, `approval: always()` en todo envío, research por tool común (sin subagente, porque `ctx.agent` no corre en agentes anidados).
- Spec [etapa 6, canal MCP](../superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md): el tenant sale de `?tenant=`, una sesión MCP no crea conversación. La spec quedó atrás en tres cosas: la ruta (hoy `/eve/outreach/v1/mcp`), los scopes (`openid email`) y el chequeo de agente habilitado, que se sumó después.
- Spec [etapa 14, subida de eve](../superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md): eve de 0.54.2 a 0.67.2 (hoy 0.67.2), `ask_question` fuera, URL vieja del MCP cortada. Spike: `defineWorkflowTool` con `ctx.ask` no anda en `agents/outreach/`, por eso ninguna tool es una workflow tool.
- PR: [#12](https://github.com/innovasbuild/agents/pull/12) (el chat responde preguntas con sus opciones), [#15](https://github.com/innovasbuild/agents/pull/15) (entrega 3: las tools del primer toque), [#22](https://github.com/innovasbuild/agents/pull/22) (borrar hilos e indicador), [#44](https://github.com/innovasbuild/agents/pull/44) (adjuntos), [#50](https://github.com/innovasbuild/agents/pull/50) (mail tal cual sale), [#54](https://github.com/innovasbuild/agents/pull/54) (canal MCP), [#56](https://github.com/innovasbuild/agents/pull/56) (aprobación directa y motivo), [#57](https://github.com/innovasbuild/agents/pull/57) (tools del brain en MCP), [#60](https://github.com/innovasbuild/agents/pull/60) (subida de eve), [#64](https://github.com/innovasbuild/agents/pull/64) (caja multilínea), [#66](https://github.com/innovasbuild/agents/pull/66) (cerrar `runs` del sweep), [#82](https://github.com/innovasbuild/agents/pull/82) (platform_admin del tenant dueño), [#84](https://github.com/innovasbuild/agents/pull/84) (Conectar y agente habilitado).
- Tablas que toca esta página: `tenant_agents` (habilitado, modelo), `conversations` (hilos y `eve_session_id`), `runs` y `events` (auditoría), `queue_items` (lo que `send_email` consume). Su diseño está en [datos](../arquitectura/datos.md).
