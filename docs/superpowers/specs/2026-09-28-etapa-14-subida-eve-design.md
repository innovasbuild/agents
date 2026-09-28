---
title: Etapa 14 · Subida de eve (0.54.2 → 0.67.2) — spec
fecha: 2026-09-28
estado: aprobada en brainstorming, pendiente de revisión escrita
etapa: 14
fuente: CHANGELOG de eve 0.54.3 a 0.67.2 · node_modules/eve/docs/guides/dynamic-capabilities.md (0.67.2) · docs/01-roadmap-etapas.md (Etapa 14) · PR #56 (aprobación directa) · PR #57 (tools dinámicas del brain)
---

# Etapa 14 · Subida de eve

## 1. Qué resuelve

Producción corre sobre eve `0.54.2`, un framework en preview que ya va por `0.67.2`: trece versiones menores de atraso, varias con cambios que rompen compatibilidad. Cuanto más se espera, más cara sale la subida. Además, la Etapa 15 (propuesta comercial) necesita saber si `defineWorkflowTool` con `ctx.ask` anda en `agents/outreach/`, y en `0.54.2` no andaba (spec 03 §16).

**No es objetivo** sumar capacidades nuevas de eve (Teams, `agentRouter`, `auto()`, extensiones). Se sube y todo queda andando igual que antes, salvo las decisiones de la §3.

## 2. Qué nos toca del changelog

Relevamiento cruzado contra `origin/main` al 2026-09-27. Lo que no aparece en esta tabla no lo usamos (no hay `TaskExec`, `postMessage`, `outputSchema`, `mode`, `rekey`, `getSkill`, `instrumentation`, `exportPolicy`, sandbox ni Slack).

| Versión | Cambio | Dónde nos toca |
|---|---|---|
| 0.57 | Cada turno corre dentro del workflow dueño de la sesión. Las sesiones del modelo anterior se importan en su próximo turno. Hay que retener la deployment vieja hasta que terminen y **retirar sesiones antes de hacer rollback a través de este límite** | Deploy y rollback (§5) |
| 0.58 | Rutas de agentes con nombre: `/eve/agents/<n>/eve/v1/*` → `/eve/<n>/v1/*` | `agents/outreach/channels/mcp.ts`, `app/.well-known/oauth-protected-resource/eve/agents/outreach/eve/v1/mcp/route.ts`, `lib/agents/channel-context.ts`, `tests/agents/channel-context.test.ts`, doc de conexión |
| 0.59 | Tools dinámicas: un schema guardado en una variable del resolver es una captura no serializable y **se rechaza al resolver** | `lib/brain/tools.ts` (`inputSchema: contract.search.input`) |
| 0.59 | Evals: `t.session()` / `t.send()` devuelve un turno con `.session` y `turn.message` | `agents/outreach/evals/*` |
| 0.62 | `t.judge.autoevals.*` → `t.judge(...)`, juez por defecto `typesafe-ai/jev` | `draft-msg1.eval.ts`, `frenos.eval.ts` |
| 0.65 | `ask_question` deja de ser tool por defecto; `ctx.ask()` devuelve `{ status, ... }` | Chat, `lib/agents/input-requests.ts`, 2 evals, descripción de `send_email` |
| 0.66 | Schemas de tools solo como JSON Schema, una sola copia de Zod; `eve/client` deja de exportar schemas Zod | Tipos (solo importamos tipos de `eve/client`) |
| 0.67 | Desaparece el modo `task`/`conversation`: toda sesión se estaciona después de cada turno; `agent_get` informa `completed` cuando el turno termina | Criterios M1/M5 de la Etapa 6 |
| 0.67 | Las tarjetas de aprobación quedan pendientes hasta que confirma el servidor; el front debe bloquear los controles en `submitted`/`streaming`/`resuming` | `app/[tenant]/chat/chat-client.tsx` |

### 2.1 El riesgo del brain

`resolveToolsFromEvent` usa `Promise.allSettled`: un resolver que falla se descarta con un `log.error` y el turno sigue sin sus tools. Es el mismo mecanismo que hizo desaparecer `brain_*` hasta el PR #57. Con la regla de schemas de la 0.59, `createBrainTools` volvería a fallar al resolver y `brain_*` desaparecería otra vez, sin ningún error visible para quien usa el chat o el MCP.

## 3. Decisiones

- **D1 · Un solo salto.** `eve` pasa de `0.54.2` a `0.67.2` fijo (sin `^`) en un único PR. Se descartaron los dos escalones y el paso por versión: cuestan más deploys para cambios que casi no nos tocan. El costo de esta decisión se compensa con la verificación y el rollback de la §5.
- **D2 · La URL vieja del MCP se corta.** Solo existe `/eve/outreach/v1/mcp`. No hay rewrite ni redirect. Después del deploy se reconfigura a mano el conector `outreach-innovas` (y cualquier otro), y la doc de conexión publica la URL nueva.
- **D3 · `ask_question` queda afuera.** El agente pregunta por texto cuando necesita desambiguar. Así la única forma de pedir una segunda confirmación con botones antes de un envío deja de existir (es lo que el PR #56 quería evitar). Sale el caso "Pregunta del agente" del chat y de `input-requests`.
- **D4 · El spike no se mergea.** La tool de prueba de `defineWorkflowTool` + `ctx.ask` vive solo en el worktree. Su resultado se escribe en la §7 de esta spec.

## 4. Cambios

1. **Dependencia.** `package.json` con `"eve": "0.67.2"` y el lockfile regenerado. Releer `node_modules/eve/docs/README.md` y las guías de los slots que se tocan (canales, tools dinámicas, evals, frontend) en la versión nueva antes de escribir código.
2. **Rutas (0.58).**
   - `agents/outreach/channels/mcp.ts`: `resource = ${publicUrl}/eve/outreach/v1/mcp`, y el comentario actualizado.
   - La ruta de metadata OAuth se mueve a `app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts` y publica el resource nuevo. La carpeta vieja se borra.
   - `lib/agents/channel-context.ts` reconoce `/eve/v1/session/:id` y `/eve/<nombre>/v1/session/:id`. Deja de reconocer la forma vieja.
   - `tests/agents/channel-context.test.ts` usa las URLs nuevas y suma un caso que confirma que la forma vieja ya no matchea.
   - Cualquier otro lugar que arme URLs de eve a mano (lo encuentra el plan con `grep`) pasa a la forma nueva. `useEveAgent({ agent: "outreach" })` y `withEve` resuelven la ruta solos.
3. **Brain (0.59).** En `lib/brain/tools.ts`, cada `defineTool()` arma su `inputSchema` inline, capturando solo datos JSON (las categorías del binding), por ejemplo `inputSchema: brainContract(categories).search.input`. `execute` sigue construyendo el provider adentro, como dejó el PR #57. Test nuevo: las tools que devuelve `createBrainTools` pasan la resolución durable de eve (o su equivalente testeable que exponga el paquete). Si alguna vuelve a capturar un schema local, el test falla.
4. **`ask_question` (0.65, D3).**
   - `lib/agents/input-requests.ts` y `app/[tenant]/chat/chat-client.tsx` pierden la rama de preguntas del agente. Las aprobaciones de tools y los límites de sesión siguen igual.
   - `tests/agents/input-requests.test.ts` pierde los casos de `ask_question`.
   - `send_email.ts`: la descripción dice que la tarjeta de aprobación es la confirmación y que no se pide otra por texto. No nombra `ask_question`.
   - `aprobar-sin-gmail.eval.ts` y `sin-aprobacion-no-sale.eval.ts`: se saca `t.notCalledTool("ask_question")`. Si la intención era "no pide confirmación antes", se afirma sobre el texto de la respuesta.
5. **Evals (0.59 / 0.62).** Toda eval pasa a `t.send()` → `turn.message` / `turn.session`. `t.judge.autoevals.closedQA(...)` pasa a `t.judge(...)` con el mismo criterio en castellano.
6. **Chat (0.67).** Los botones de aprobar y rechazar (incluido el rechazo con motivo del PR #56) se deshabilitan mientras el store está en `submitted`, `streaming` o `resuming`. La tarjeta desaparece cuando el servidor confirma, no al hacer click.
7. **Tipos (0.66).** `npm run typecheck` y `npm test` definen qué más hay que tocar. No se esperan cambios fuera de tipos.
8. **Doc de conexión y memoria.** La doc del canal MCP publica la URL nueva. La memoria del proyecto registra que la URL cambió en esta etapa.

## 5. Deploy, verificación y rollback

### 5.1 Antes de mergear (local)

- `npm run typecheck`, `npm test`, `npm run lint:fix` (revirtiendo los archivos ajenos que biome reformatea siempre) y `npm run build`, todos en verde.
- Evals contra la base local (`npm run db:start`).
- Spike de la §7 corrido en `eve dev`, con la respuesta anotada.
- Si el preview del PR tiene variables de entorno, un smoke del chat ahí. Si no, se va directo a producción, como en la Etapa 6.

### 5.2 Deploy

- `morning-sweep` corre a las 10:00 UTC y `followups` a las 11:00 UTC (de lunes a viernes). El merge va fuera de 9:45–11:30 UTC.
- `dispatch` corre cada 5 minutos y toma lock por tick, así que no hay ventana libre. Se mergea apenas termina un tick (en los minutos :01–:03 de cada bloque de 5), para que el deploy entre antes del siguiente.
- Vercel deja viva la deployment anterior, que es lo que pide la 0.57 para que las sesiones viejas terminen ahí.

### 5.3 Verificación en producción

La etapa se cierra solo si pasa todo esto:

1. **Chat.** Un hilo nuevo lista la cola y usa `brain_search`. Una tarjeta de aprobación se aprueba y otra se rechaza con motivo, sin botones colgados. Un hilo **anterior al deploy** recibe un mensaje y sigue andando (importación de sesión de la 0.57).
2. **MCP.** `outreach-innovas` reconfigurado con la URL nueva. Se repiten M1 (`agent_start` → `completed`, con `brain_search`, `brain_read` y `brain_upsert` en la lista de tools), M2 (sin `?tenant` → 403 con mensaje claro) y M5 (`input_required` → `agent_update` cancelando → `completed`, sin escribir nada). La URL vieja devuelve 404.
3. **Schedules y Etapa 12.** El próximo tick de `dispatch`, `morning-sweep` y `followups` aparece en `runs` sin error, y una corrida de workflow cuenta lo que entró contra lo que salió.
4. **Logs.** En la ventana de verificación hay cero `Dynamic tool resolver` con `failed` y cero errores `[eve:` que no existieran antes del deploy.

### 5.4 Rollback

- **Qué lo dispara:** que se rompa el chat, los schedules o las tools del brain. Si solo falla el MCP o una eval, se arregla hacia adelante con otro PR.
- **Cómo:** instant rollback de Vercel a la deployment anterior. No hay migraciones de base en esta etapa, así que es solo código.
- **Qué cuesta:** una sesión que ya se importó al modelo nuevo (0.57) no vuelve atrás. Los hilos de chat usados después del deploy pueden no abrir en la versión vieja y hay que empezarlos de nuevo. Por eso la verificación se hace enseguida del deploy, tocando pocos hilos. Si hay rollback, se informa qué hilos quedaron afuera.

## 6. Tests

- `channel-context`: ruta nueva con y sin id de sesión, ruta raíz `/eve/v1`, y la forma vieja que ya no matchea.
- `brain/tools`: las tres tools pasan la resolución durable y siguen llamando al provider inyectado (el test del PR #57 queda).
- `input-requests`: aprobaciones y límite de sesión sin cambios. Sin casos de `ask_question`.
- `running-tool`: sigue comparando `TOOL_LABELS` contra el disco. Esta etapa no suma tools a `agents/outreach/tools/`.
- Evals migradas y corriendo contra la base local.

## 7. Spike: `defineWorkflowTool` + `ctx.ask` en `agents/outreach/`

**Pregunta:** en `0.67.2`, ¿una tool definida con `defineWorkflowTool` en `agents/outreach/tools/` puede llamar a `ctx.ask()` desde el cuerpo del workflow, estacionar la sesión, mostrarse en el chat y retomar con la respuesta?

**Prueba:** una tool descartable que pregunta algo con dos opciones y devuelve lo que se eligió. Se corre en `eve dev`, primero respondiendo con una opción y después con texto libre. Se anota la forma de `{ status, optionId, text }` que llega y qué pasa en una sesión que no puede pedir input.

**Resultado (2026-09-28, eve 0.67.2): no anda en `agents/outreach/`.**

- Compila y tipa bien. `defineWorkflowTool` con `"use workflow"` y `ctx.ask({ prompt, options, allowFreeform })` pasa `tsc` (`allowFreeform` existe), y el modelo ve la tool y la llama.
- Falla al ejecutarse, siempre con el mismo error: `Tool "spike_ask" is not registered as a workflow in this deployment (workflow//./agents/outreach/tools/spike_ask//execute)`. Pasa en `next dev` (con `withEve`) y en el host propio de eve (`eve eval`), así que no depende de Next.
- **Causa:** los ids no coinciden. El compilador registra el cuerpo del workflow como `workflow//./tools/spike_ask//execute`, relativo a la carpeta del agente (se ve en `.eve/compile/authored-modules/*.mjs`). El manifest (`compiled-agent-manifest.json`) lo busca como `workflow//./agents/outreach/tools/spike_ask//execute`, relativo a la raíz de la app. Es la misma familia de bug que la 0.64.1 arregló solo para las tools en background de workspace agents ("use app-relative workflow IDs").
- **No se llegó a observar** la forma de `{ status, optionId, text }`, porque la tool nunca llega a `ctx.ask`. Según la documentación de 0.67.2 (`tools/workflows.mdx`, `tools/human-in-the-loop.md`) debería ser `{ status: "answered", optionId?, text? }`, `{ status: "dismissed" }` o `{ status: "unavailable" }`.

**Para la Etapa 15:** con eve 0.67.2 y el agente en `agents/outreach/`, la propuesta comercial **no** puede usar `defineWorkflowTool`. Hay tres caminos: (a) diseñarla sin workflow tool, con una tool común que devuelve y deja que el modelo pregunte por texto; (b) esperar una versión de eve que corrija el id y volver a correr este spike (tarda minutos: una tool y una eval descartables); (c) reportar el bug a eve con esta evidencia. La tarjeta "Pregunta del agente" del chat se conservó (R2) para cuando esto ande.

## 7.1 Rulings del plan

Decididos al escribir el plan (`docs/superpowers/plans/2026-09-28-etapa-14-subida-eve.md`) y ejecutados así:

- **R1 · §4.2 "deja de reconocer la forma vieja".** No se exige. La regex de `channel-context.ts` no se ancla al inicio del path, porque no está confirmado qué prefijo trae `request.url` detrás de la reescritura de Vercel. Sin ancla, la forma vieja sigue matcheando como substring, pero eve 0.67 ya no enruta esa URL (en local devuelve 404).
- **R2 · §4.4 "pierden la rama de preguntas del agente".** No se saca. `pendingInputRequests` y la tarjeta "Pregunta del agente" manejan `kind: "question"` en general, que es lo que produce `ctx.ask()`. Solo se sacaron las menciones a `ask_question`.
- **R3 · §4.6 bloqueo de botones.** El chat ya calculaba `canAnswer = !isBusy && !isResuming`. Se corrigieron los comentarios y se probó en navegador (local): los botones se deshabilitan al hacer click y la tarjeta se va cuando confirma el servidor.
- **R4 · §4.3 prueba de resolución durable.** Es una eval (`brain-tools.eval.ts`) contra el agente compilado, porque en vitest no corre el compilador de eve. En rojo mostró `callback "inputSchema" has a non-serializable capture` y en verde pasó 4/4.

## 8. Terminado cuando

Producción corre sobre `0.67.2`, el chat, el MCP (con la URL nueva) y los schedules andan igual que antes según la §5.3, y la §7 tiene respuesta.
