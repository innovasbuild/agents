# Etapa 22.1: un chat para todos los agentes y el agente Asistente

**Fecha:** 2026-10-13
**Estado:** diseño aprobado en conversación; falta la revisión de este documento.
**Rama:** `docs/etapa-22-1-chat-multiagente` para la spec y el plan. La implementación sale de `main` en `feat/etapa-22-1-chat-multiagente`.
**Antecedentes:** `docs/producto/roadmap.md` (Etapa 22), `docs/producto/evaluacion-gap-2026-10.md` (G5), `2026-10-11-etapa-21-4-segundo-tenant-design.md` (T4 y T5: aterrizaje y menú por agente habilitado), `2026-10-10-etapa-21-1-consola-conectores-design.md` (catálogo de agentes), `2026-09-24-etapa-11-brain-mcp-design.md` §8 (acceso al brain por agente), `2026-10-05-etapa-17-permisos-brain-design.md` (el agente actúa en nombre de la persona), `docs/arquitectura/orquestacion.md`, `node_modules/eve/docs/guides/frontend/nextjs.mdx` (agentes con nombre) y `guides/dynamic-capabilities.md`.

## 1. Qué resuelve

La pantalla `/<slug>/chat` nació con el agente de outreach y lo sigue asumiendo por nombre:

- `app/[tenant]/chat/chat-client.tsx` llama a `useEveAgent({ agent: "outreach" })`.
- `app/[tenant]/chat/page.tsx` lista solo los hilos con `agent = 'outreach'` y arma la firma del mail con la config de outreach.
- `app/[tenant]/chat/actions.ts` crea todo hilo con `agent: "outreach"`.
- `lib/tenants/nav.ts` muestra la entrada Chat solo si `outreach` está habilitado.

Dos consecuencias. Una empresa con brain y sin outreach (Lagomarsino) no tiene chat: no puede conversar con su propio brain desde la plataforma. Y el segundo agente conversacional que se sume (Etapa 15, propuesta comercial) no tiene dónde aparecer.

Al cerrar esta entrega:

- Hay una sola pantalla de chat y sirve para cualquier agente del catálogo que se use conversando.
- Cada hilo pertenece a un agente. La persona lo elige al abrir el hilo.
- Existe un segundo agente, **Asistente**, que solo conversa con el brain de la empresa. Es el que queda cuando outreach no está habilitado.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| C1 | La Etapa 22 se parte. **22.1** (esta spec): chat multiagente y agente Asistente. **22.2**: permisos de uso por agente y reglas de acceso generalizadas. En la 22.1 cualquier miembro usa cualquier agente habilitado, igual que hoy | Los permisos tocan el modelo de reglas del brain y merecen su spec. El chat multiagente no depende de ellos |
| C2 | Una pantalla de chat, no una por agente | El menú no crece con cada agente y la persona tiene todos sus hilos en un lugar |
| C3 | Cada hilo pertenece a un agente y no cambia. `conversations.agent` ya existe | La sesión de eve nace contra la ruta de un agente (`/eve/<agente>/v1/*`) y resuelve modelo, instrucciones y tools en `session.started`. Cambiar a mitad de hilo es otra sesión |
| C4 | El agente se elige a mano al abrir el hilo. No se infiere de la conversación | Inferir exige un router antes del primer mensaje; si se equivoca, la persona queda en un hilo que no puede hacer lo que pidió y no sabe por qué |
| C5 | El selector aparece solo si la empresa tiene más de un agente de chat habilitado. Por defecto queda el agente del hilo más reciente de la persona; si no tiene hilos, el primero del catálogo | Con un solo agente no hay nada que elegir. Quien hace outreach todos los días no tiene que cambiar el selector cada vez |
| C6 | El segundo agente es `asistente`, en `agents/asistente/`. Para la persona se llama "Asistente" | Es por capacidad (conversar con el conocimiento de la empresa), no por cliente |
| C7 | Asistente se habilita con una fila en `tenant_agents`, como cualquier agente. No es implícito | Un solo mecanismo: el canal ya valida `tenant_agents.enabled`, y ahí viven el modelo y el acceso al brain. INNOV.AS puede apagarlo para una empresa |
| C8 | Asistente necesita brain (`requiresBrain: true`). La regla que abre el chat no cambia: hay chat si hay un agente de chat habilitado | Sin brain el Asistente no tiene nada que ofrecer. "Hay brain, entonces hay chat" sale de habilitarlo, sin una segunda regla |
| C9 | El alta de empresas trae Asistente tildado. La migración lo habilita en toda empresa que hoy tenga brain habilitado | Pedido de Mati: el chat queda disponible aunque outreach no esté. **Costo:** el chat no lo frena ningún presupuesto (`orquestacion.md` §"Presupuesto"); el gasto de modelos de una empresa solo con brain lo paga INNOV.AS hasta la 21.5 |
| C10 | `requiresBrain` deja de significar también "necesita el canon de outreach". El catálogo suma `canon: boolean` | Hoy `agentsNeedCanon` lee `requiresBrain`: habilitar Asistente sembraría `comercial/icp` y `comercial/hooks` en el brain de una empresa sin outreach, que es lo que la 21.4 (T6) evitó |
| C11 | Asistente no tiene tools con efecto hacia afuera: ni mail, ni CRM, ni conectores. Sus únicas tools son las del brain, con el acceso que declare su fila (`config.brain`) | El brain es lo único que toda empresa con chat tiene. `brain_upsert` sigue pidiendo aprobación como hoy |
| C12 | Cuando alguien le pide a Asistente algo de otro agente, contesta con el nombre del agente que lo hace y le dice que abra un hilo con él. Sin link | La pantalla muestra el texto tal cual, sin markdown ni links. El selector está a la vista en la misma pantalla |
| C13 | Asistente no tiene canal MCP. El catálogo suma `mcp: boolean` y Conectar lista solo los agentes con `mcp: true` | El brain ya tiene su endpoint MCP propio (Etapa 11). Un canal MCP del Asistente duplicaría eso |
| C14 | Los hilos de un agente que se deshabilitó no se listan. Vuelven si se lo habilita de nuevo | El canal rechaza con 401 toda sesión de un agente apagado, así que ni el historial se puede leer. Mostrarlos sería ofrecer algo que falla |
| C15 | El código que comparten los agentes (canal web, hooks de sesión y de runs, modelo, tools del brain) se muda a `lib/agents/eve/`. Cada carpeta de agente conserva archivos de pocas líneas que lo reexportan | eve descubre por archivo, así que cada agente necesita sus archivos. Copiarlos enteros garantiza que diverjan |

## 3. Catálogo

`lib/agents/catalog.ts` suma dos campos y una entrada:

```ts
export interface AgentCatalogEntry {
	name: string;
	description: string;
	capabilities: readonly Capability[];
	brain: boolean;
	requiresBrain: boolean;
	/** Si el agente necesita las páginas de canon de outreach en el brain. */
	canon: boolean;
	chat: boolean;
	/** Si el agente se puede conectar por MCP desde Conectar. */
	mcp: boolean;
}
```

| Agente | `capabilities` | `brain` | `requiresBrain` | `canon` | `chat` | `mcp` |
|---|---|---|---|---|---|---|
| `asistente` | `[]` | sí | sí | no | sí | no |
| `outreach` | `crm`, `leads`, `mail` | sí | sí | sí | sí | sí |

`asistente` va primero: es el orden en que el alta, la consola y el selector muestran los agentes.

- Nombre: "Asistente". Descripción: "Conversa con el conocimiento de tu empresa: busca, lee y propone páginas del brain."
- `agentsNeedCanon` (`lib/tenants/readiness.ts`) pasa a leer `canon`. Lo usan la consola, la página del brain y el MCP del brain; ninguno cambia de firma.
- `app/plataforma/[slug]/console-actions.ts`: `needsSeed` pasa a `enabled === true && AGENT_CATALOG[agent].canon`. El chequeo "este agente necesita el brain" sigue leyendo `requiresBrain`.
- `lib/connect/connectables.ts` filtra los agentes por `mcp`.
- `tests/agents/catalog.test.ts`: el test que exige `capabilities.length > 0` se va (Asistente no tiene); se agregan "asistente tiene chat, requiere brain y no pide canon" y "outreach pide canon y tiene MCP".

Un helper nuevo en `lib/tenants/home.ts`, al lado de `hasChatAgent`:

```ts
/** Agentes de chat habilitados, en el orden del catálogo. */
export function chatAgents(enabledAgents: readonly string[]): CatalogAgent[]
```

`hasChatAgent` queda como `chatAgents(...).length > 0`.

## 4. Agente Asistente

Carpeta `agents/asistente/`, montada en `next.config.ts` como `asistente: "./agents/asistente"`. Queda en `/eve/asistente/v1/*`.

| Archivo | Qué hace |
|---|---|
| `agent.ts` | Modelo dinámico en `session.started`, con `resolveModelForTenant(tenantId, "asistente", conversationId)` |
| `instructions.md` | Identidad, límites y estilo (§4.1) |
| `instructions/tenant.ts` | Contexto de la sesión (§4.2) |
| `tools/brain.ts` | Tools del brain con el acceso de la fila `asistente` |
| `channels/eve.ts` | Canal web con la misma autenticación que outreach |
| `hooks/bind-session.ts` | Ata `eve_session_id` a la conversación |
| `hooks/runs.ts` | Abre y cierra el `run` de cada turno, con `agent: "asistente"` |
| `evals/` | §9 |

No tiene `connections/`, `schedules/`, `skills/`, `channels/mcp.ts` ni `hooks/executors.ts`. No tiene nodos ni workflows: no hay nada que registrar en `lib/workflows/registry.ts`.

Según la escalera de `orquestacion.md`, es un agente porque hay una persona conversando.

### 4.1 Instrucciones fijas

`instructions.md`, en español rioplatense, con estas reglas:

- **Identidad.** Es el asistente de la empresa de la sesión. Contesta con lo que la empresa escribió en su brain.
- **Brain primero.** Antes de contestar algo sobre la empresa, busca con `brain_search` y lee con `brain_read`. Nombra la página de donde sale cada dato.
- **Sin dato.** Si el brain no lo tiene, lo dice. No completa con conocimiento general cuando la pregunta es sobre la empresa.
- **Escribir.** Si la fila le da `read_write`, puede proponer una página con `brain_upsert`; la aprobación la pide la tool. Si una tool devuelve `ok: false`, cita su `message` y no busca otra vía.
- **Lo que no hace.** No envía mails, no toca el CRM, no carga contactos. Si se lo piden, aplica la derivación de §4.2.
- **Estilo.** Texto plano, sin markdown (la pantalla no lo interpreta). Respuestas cortas.

### 4.2 Instrucciones de la sesión

`instructions/tenant.ts` resuelve en `session.started` y devuelve:

- El nombre de la empresa y su slug: "Trabajás para …".
- Si la empresa tiene brain conectado. Si no lo tiene, que lo diga cuando le pregunten algo de la empresa.
- **Los otros agentes de chat habilitados**, con su nombre y descripción del catálogo, y la instrucción: "Si te piden algo de esto, decí que lo hace ese agente y que abran un hilo nuevo eligiéndolo. No lo intentes vos."
- Si no hay otros agentes: "No hay otros agentes habilitados en esta empresa. Si te piden enviar mails, operar el CRM o algo fuera del brain, decí que no está disponible."

Si la lectura falla, devuelve solo la línea de la empresa, igual que outreach.

No lleva el resumen de outreach (`lib/outreach/summary.ts`) ni las alertas de workflows.

## 5. Código compartido entre agentes

Módulo nuevo `lib/agents/eve/`:

| Export | Sale de | Parámetro |
|---|---|---|
| `webChannel(agent)` | `agents/outreach/channels/eve.ts` | nombre del agente (§6.5) |
| `bindSessionHook()` | `agents/outreach/hooks/bind-session.ts` | — |
| `runsHook()` | `agents/outreach/hooks/runs.ts` (ya usa `ctx.agent.name`) | — |
| `tenantModel(agent)` | el `defineDynamic` de `agents/outreach/agent.ts` | nombre del agente |
| `brainTools(agent)` | `agents/outreach/tools/brain.ts` | nombre del agente |

Los archivos de `agents/outreach/` y `agents/asistente/` quedan como `export default webChannel("asistente");` y equivalentes. Imports relativos, como hoy: eve no resuelve los paths de `tsconfig`.

**A verificar antes de mudar nada.** `lib/brain/adapters/tools.ts` documenta que eve compila los módulos dinámicos y descarta sin aviso un resolver que cierre sobre un valor no serializable. El primer paso del plan es mudar un solo archivo (`tools/brain.ts`), correr el build de eve y `agents/outreach/evals/brain-tools.eval.ts`, y confirmar que las tools `brain_*` siguen apareciendo. El nombre del agente es un string, que es serializable; lo dudoso es que el `defineDynamic` venga de una función importada. Si eve no lo tolera, C15 se cumple a medias: se comparte la lógica de adentro de cada handler como función de `lib/agents/eve/` y cada agente escribe su propio `defineDynamic`.

`hooks/executors.ts`, `channels/mcp.ts`, `connections/`, `schedules/` y el resto de `tools/` son de outreach y no se tocan.

## 6. Pantalla de chat

### 6.1 Quién entra

No cambia la regla: `requireChatAgent` deja pasar si hay algún agente de chat habilitado. Lo que cambia es que ahora una empresa solo con brain tiene uno.

- `lib/tenants/nav.ts`: `NavLink` suma `chat?: true`. La entrada Chat deja de pedir `agent: "outreach"` y pasa a `chat: true`; `visibleNav` la muestra si `hasChatAgent(enabledAgents)`. Con `enabledAgents` en `null` no oculta nada, como hoy.
- `tenantHome` no cambia de código, pero sí de efecto: una empresa con brain y Asistente aterriza en `/chat` en vez de `/brain`. Es la regla T4 de la 21.4 aplicada tal cual.

### 6.2 `page.tsx`

- Lee los agentes habilitados (`loadEnabledAgents`) y calcula `chatAgents`. Si la lectura devuelve `null`, usa todos los agentes de chat del catálogo: el canal igual rechaza al que no esté habilitado.
- Lista los hilos de la persona con `.in("agent", chatAgents)` y suma `agent` al `select`.
- La firma (`executors` y la config de `outreach`) se lee solo si `outreach` está entre los agentes de chat. Si no, `signature` va `null`.
- Le pasa a `ChatClient` la lista `agents: { id, name }[]` y `defaultAgent`: el agente del hilo más reciente si está en la lista; si no, el primero.

### 6.3 `ChatClient`

- **Selector de agente.** Un `select` rotulado "Agente", arriba del de modelo, con los nombres del catálogo. Se renderiza solo si `agents.length > 1`. Arranca en `defaultAgent`.
- **Hilo nuevo.** `createConversation(tenantId, slug, model, agent)`.
- **Lista de hilos.** Con más de un agente, cada hilo muestra debajo del título el nombre de su agente en texto secundario. Con uno solo, la lista queda como hoy.
- **`Thread`.** `useEveAgent({ agent: thread.agent, ... })`. El componente ya se remonta por `key={active.id}`, que es lo que pide eve al cambiar de agente.
- **Encabezado del hilo.** Con más de un agente, el nombre del agente arriba de los mensajes.
- **Estado vacío.** "Elegí un hilo o abrí uno nuevo." (hoy dice "para hablar con el agente").
- Las tarjetas de mail, la cola y la aprobación de envío son partes que solo produce outreach. No se condicionan por agente: un hilo de Asistente nunca las recibe.

Sin desborde horizontal a 375 px: el selector es un `select` más en la columna de hilos, con las mismas clases que el de modelo.

### 6.4 `actions.ts`

`createConversation` recibe `agent` y, antes de insertar:

1. Valida con `isCatalogAgent` y `AGENT_CATALOG[agent].chat`.
2. Lee `loadEnabledAgents(tenantId)`. Si devuelve una lista y el agente no está, devuelve `null`. Si devuelve `null` (no se pudo leer), deja pasar: el canal es la puerta.

Una server action se puede invocar con cualquier argumento; por eso se valida acá aunque el selector solo ofrezca agentes habilitados.

### 6.5 El canal

`lib/agents/channel-context.ts` ya resuelve la conversación, su dueño, la membresía y `tenant_agents.enabled` del agente **de la conversación**. Falta un chequeo: que la ruta por la que entra el request sea la del mismo agente. Sin eso, un cliente puede mandar el header de una conversación de `asistente` a `/eve/outreach/v1/*` y abrir una sesión de outreach colgada de un hilo de Asistente.

- `resolveChannelContext` suma el parámetro `agent` (se lo pasa `webChannel(agent)`, §5) y devuelve `null` si `conversation.agent !== agent`.
- Test nuevo en `tests/agents/channel-context.test.ts`: conversación de un agente, request por la ruta de otro, 401.

## 7. Base de datos

Una migración, `supabase/migrations/<fecha>_asistente_agent.sql`. Sin tablas ni columnas nuevas.

1. **Backfill.** Inserta `(tenant_id, 'asistente', enabled = true, config = '{"brain": "read_write"}')` en `tenant_agents` para cada empresa con una fila habilitada de `tenant_connections` con `capability = 'brain'`. `on conflict (tenant_id, agent) do nothing`.
2. **Índice.** `conversations_thread_list_idx` ya cubre `(tenant_id, user_id, last_message_at desc)`; el filtro por `agent` sobre los 50 hilos de una persona no necesita índice propio.

`events` no se toca. La migración no deja evento por empresa: es una habilitación de plataforma, no una acción de una persona. Cargar `supabase-postgres-best-practices` antes de escribirla.

`platform_create_tenant` y `platform_set_agent` no validan nombres de agente en la base (el catálogo vive en código), así que no cambian.

**Orden de despliegue.** Cualquiera de los dos funciona. Con la migración primero, el código viejo ignora la fila `asistente` porque no está en su catálogo. Con el código primero, Asistente existe y nadie lo tiene habilitado. Se sigue la costumbre: `npx supabase migration list`, migración, código.

## 8. Lo que cambia para cada empresa

| Empresa | Antes | Después |
|---|---|---|
| Con outreach y brain (`innovas`) | Chat con outreach | Chat con selector: Asistente y outreach. El selector arranca en el agente del último hilo. Los hilos viejos siguen siendo de outreach |
| Solo con brain | Sin chat; aterriza en `/brain` | Chat con Asistente, sin selector; aterriza en `/chat`. No ve nada de outreach |
| Sin brain y sin agentes | Aterriza en `/conectar` | Igual |

## 9. Tests y evals

**Unitarios (vitest):**

- `catalog.test.ts`: §3.
- `home.test.ts`: `chatAgents` devuelve en orden de catálogo e ignora nombres que no están; una empresa con brain y `asistente` aterriza en `/chat`.
- `nav.test.ts`: Chat visible con solo `asistente`; el desplegable Outreach sigue oculto.
- `readiness.test.ts`: `agentsNeedCanon` es falso con solo `asistente` y verdadero con `outreach`.
- `connectables.test.ts`: `asistente` habilitado no aparece en Conectar.
- `channel-context.test.ts`: §6.5.
- `model.test.ts`: no cambia; `resolveModelForTenant` ya recibe el agente.
- Acción `createConversation`: rechaza un agente fuera del catálogo, uno sin chat y uno no habilitado.
- `running-tool.test.ts`: hoy compara `TOOL_LABELS` contra `agents/outreach/tools`. Pasa a recorrer `tools/` de todos los agentes. Asistente solo aporta `brain.ts`, cuyas tools ya tienen etiqueta.
- Consola: habilitar `asistente` en una empresa sin canon no siembra plantillas.

**Evals de Asistente** (`agents/asistente/evals/`):

- `smoke`: contesta un saludo.
- `brain-tools`: ante una pregunta sobre la empresa llama a `brain_search` antes de contestar.
- `sin-dato`: si el brain no tiene la respuesta, lo dice y no inventa.
- `deriva-a-outreach`: con outreach habilitado, ante "mandale un mail a X" nombra al agente de outreach y no afirma haber enviado nada.
- `sin-otros-agentes`: sin outreach, ante el mismo pedido dice que no está disponible.

**Navegador (`/qa`), con la base local:**

- Empresa con los dos agentes: selector visible, hilo nuevo de cada uno, cada hilo contesta con su agente, el rótulo del agente en la lista, 375 px.
- Empresa solo con brain: `/<slug>` cae en el chat, sin selector, sin entradas de outreach en el menú.
- Como `tenant_member` sin permiso sobre una carpeta del brain: Asistente no la encuentra (la regla de la Etapa 17 vale igual).

## 10. Documentación

- `docs/dominios/agentes-eve.md`: los dos agentes, el módulo `lib/agents/eve/` y qué archivos lleva un agente nuevo.
- `docs/arquitectura/orquestacion.md`: "todos del agente `outreach`" sigue siendo cierto para nodos y workflows; se agrega que Asistente no tiene ninguno.
- `docs/guias/alta-de-tenant.md`: Asistente viene tildado.
- `docs/producto/roadmap.md`: la Etapa 22 queda partida en 22.1 y 22.2.
- `CLAUDE.md`: la regla de la tool nueva nombra `agents/outreach/tools/`; pasa a "en `agents/<agente>/tools/`".
- `npm run docs:sync` y `/docs-wiki` en verde antes de cerrar.

## 11. Fuera de alcance

- Permisos de quién usa cada agente, y el agente como principal con reglas propias sobre el brain (22.2).
- Inferir el agente por la conversación, o un router.
- Cambiar el agente de un hilo ya abierto.
- Canal MCP del Asistente.
- Skills de empresa (Etapa 24). El Asistente es donde naturalmente van a montarse; esa spec lo decide.
- Renderizar markdown o links en el chat.
- Un solo asistente que monte las capacidades de cada agente como paquetes de tools. Se revisa al especificar la Etapa 15: si la propuesta comercial necesita las mismas tools de contacto y CRM que outreach, conviene ese camino.
- Tope de gasto para el chat.

## 12. Riesgos

| Riesgo | Qué se hace |
|---|---|
| eve descarta un `defineDynamic` que viene de una función importada | Se prueba primero con un solo archivo (§5). Hay camino alternativo |
| Un segundo agente es un segundo servicio en Vercel: más tiempo de build y otra función | Se mide en el preview. No hay cron nuevo |
| Gasto de modelos sin tope en empresas solo con brain (C9) | Queda anotado. INNOV.AS puede apagar Asistente desde la consola. La 21.5 trae la clave por empresa |
| Memoria del repo: "tool nueva invisible en producción" | El cierre incluye pedirle al Asistente deployado que liste sus tools |
| El selector por defecto en Asistente confunde a quien hace outreach y todavía no tiene hilos | El default es el agente del último hilo; quien ya usa outreach arranca en outreach |

## 13. Terminado cuando

En producción:

1. En `innovas`, una persona abre un hilo con Asistente, pregunta algo que está en el brain y recibe la respuesta con la página nombrada. El turno queda en `runs` con `agent = 'asistente'`.
2. La misma persona abre un hilo de outreach y la corrida funciona como antes, con la firma en la tarjeta del mail.
3. En el hilo de Asistente pide enviar un mail: Asistente nombra al agente de outreach y no envía nada.
4. Una empresa solo con brain entra a `/<slug>`, cae en el chat, conversa con Asistente y no ve selector ni nada de outreach. Su brain no recibió páginas de canon.
5. Un request con la conversación de un agente por la ruta del otro recibe 401.
