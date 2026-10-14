# Etapa 22.1: un chat para todos los agentes y el agente Asistente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/<slug>/chat` sirva para cualquier agente de chat del catálogo, con un hilo por agente, y que exista un segundo agente, Asistente, que conversa solo con el brain.

**Architecture:** El código que hoy vive dentro de `agents/outreach/` y que todo agente necesita (canal web, hooks de sesión y de runs, modelo, tools del brain) se muda a `lib/agents/eve/` como funciones que reciben el nombre del agente. `agents/asistente/` es una carpeta nueva de archivos de pocas líneas más sus instrucciones. El catálogo separa "necesita brain" de "necesita canon de outreach" y dice qué agente tiene canal MCP. La pantalla de chat lee el agente de cada hilo (`conversations.agent`) y ofrece un selector al abrir uno nuevo. El canal rechaza una conversación que entra por la ruta de otro agente.

**Tech Stack:** Next.js App Router (server components y server actions), eve (agentes con nombre montados con `withEve`), Supabase (Postgres), Vitest (entorno `node`), Biome.

**Spec:** `docs/superpowers/specs/2026-10-13-etapa-22-1-chat-multiagente-design.md`. Quien ejecuta lee la spec entera antes de la Task 1.

## Global Constraints

- Rama `feat/etapa-22-1-chat-multiagente`, creada desde `main` en un worktree propio (`superpowers:using-git-worktrees`). Identidad git local `innovasbuild` / `matias@innov.as`. No hacer `cd` a worktrees ajenos.
- Antes de escribir código de eve, leer `node_modules/eve/docs/README.md`, `guides/dynamic-capabilities.md`, `guides/frontend/nextjs.mdx` (sección de agentes con nombre) y `guides/hooks.md`.
- Los módulos que importa una carpeta de `agents/` usan imports **relativos**, nunca `@/`: eve no resuelve los paths de `tsconfig`. Vale para todo `lib/agents/eve/*` y para lo que esos archivos importen.
- Nada específico de un tenant en código: ningún `lagomarsino` ni `innovas` en `app/`, `lib/` ni `agents/`.
- El agente nuevo se llama `asistente` (carpeta, clave del catálogo, valor de `tenant_agents.agent` y de `conversations.agent`). Para la persona: "Asistente". Descripción exacta: "Conversa con el conocimiento de tu empresa: busca, lee y propone páginas del brain."
- Asistente no tiene tools con efecto hacia afuera, ni `connections/`, `schedules/`, `skills/`, `channels/mcp.ts` ni `hooks/executors.ts`. No se registra nada en `lib/workflows/registry.ts`.
- Español rioplatense en UI, instrucciones y mensajes. Código e identificadores en inglés. El chat muestra texto plano: las instrucciones del agente no piden markdown ni links.
- Antes de tocar SQL, cargar la skill `supabase-postgres-best-practices`. `events` es append-only: la migración no escribe en `events`.
- Todo `async` con `try/catch` o con el `{ error }` de Supabase leído. Componentes funcionales.
- Después de cada tarea: `npm run typecheck` y `npm test`. `npm run lint:fix` reformatea siempre cuatro archivos ajenos: revertirlos con `git checkout -- <archivo>` antes de commitear.
- Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:` y la línea final `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Evals y base local necesitan Docker abierto: `npm run db:start`, `npm run db:reset`, `npm run evals`. Las evals llaman a un modelo real y gastan tokens: correr solo las que el paso nombra.

## Review Focus

1. **No se pudieron leer los agentes habilitados.** Si `loadEnabledAgents` devuelve `null`, la página del chat no da 404 ni se queda sin selector: ofrece todos los agentes de chat del catálogo y deja que el canal rechace. Test en Task 6 (`availableChatAgents(null)`).
2. **El último hilo de la persona es de un agente que se deshabilitó.** El selector no puede arrancar en un agente que no está en la lista: cae en el primero habilitado. Test en Task 6 (`defaultChatAgent`).
3. **Server action con un agente arbitrario.** `createConversation` llamada a mano con `"toString"`, `"constructor"`, un agente sin chat o uno no habilitado no crea el hilo. Test en Task 6.
4. **Conversación de un agente por la ruta de otro, también al continuar.** No solo al crear la sesión (header) sino al continuarla (id de sesión en el path): 401 en los dos caminos. Test en Task 1.
5. **Asistente habilitado y el brain apagado después.** La sesión arranca igual, sin tools `brain_*`, y las instrucciones dicen que no hay brain conectado en vez de mandar a buscar. Test en Task 4 (`assistantSessionInstructions` con `brainConnected: false`).

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `lib/agents/eve/attribute.ts` (nuevo) | Leer un atributo string del principal de la sesión |
| `lib/agents/eve/brain-tools.ts` (nuevo) | `brainTools(agent)`: tools dinámicas del brain para un agente |
| `lib/agents/eve/model.ts` (nuevo) | `tenantModel(agent)`: modelo dinámico por tenant y agente |
| `lib/agents/eve/web-channel.ts` (nuevo) | `webChannel(agent)`: canal web con la auth de Supabase |
| `lib/agents/eve/hooks.ts` (nuevo) | `bindSessionHook()` y `runsHook()` |
| `lib/agents/channel-context.ts` | Suma el chequeo "la conversación es de este agente" |
| `lib/agents/catalog.ts` | Campos `canon` y `mcp`; entrada `asistente` |
| `lib/agents/assistant-instructions.ts` (nuevo) | Texto de la sesión del Asistente, puro |
| `lib/agents/chat-agents.ts` (nuevo) | Qué agentes ofrece la pantalla y cuál va por defecto, puro |
| `lib/tenants/home.ts` | `chatAgents` |
| `lib/tenants/nav.ts` | La entrada Chat depende de "hay agente de chat" |
| `lib/tenants/readiness.ts` | `agentsNeedCanon` lee `canon` |
| `lib/connect/connectables.ts` | Conectar lista solo agentes con `mcp` |
| `agents/asistente/**` (nuevo) | El agente |
| `agents/outreach/{agent.ts,channels/eve.ts,hooks/bind-session.ts,hooks/runs.ts,tools/brain.ts}` | Quedan como reexport de `lib/agents/eve/` |
| `app/[tenant]/chat/{page.tsx,actions.ts,chat-client.tsx}` | Hilos por agente y selector |
| `supabase/migrations/20261021120000_asistente_agent.sql` (nuevo) | Backfill de la fila `asistente` |

---

### Task 1: El canal rechaza una conversación de otro agente

**Files:**
- Modify: `lib/agents/channel-context.ts`
- Modify: `agents/outreach/channels/eve.ts`
- Test: `tests/agents/channel-context.test.ts`

**Interfaces:**
- Produces: `resolveChannelContext(request: Request, userId: string, allowsLogin: (tenantId: string) => Promise<boolean>, agent: string): Promise<ChannelContext | null>`. El cuarto parámetro es el agente dueño de la ruta por la que entró el request.

- [ ] **Step 1: Adaptar el wrapper del test y escribir los tests que fallan**

En `tests/agents/channel-context.test.ts`, reemplazar el wrapper `resolveChannelContext` por:

```ts
// Los tests de antes no hablan del método ni del agente: entran con un
// método permitido y por la ruta del agente de la conversación.
const resolveChannelContext = (
	request: Request,
	userId: string,
	allowsLogin: (tenantId: string) => Promise<boolean> = async () => true,
	agent = "outreach",
) => channelContext.resolveChannelContext(request, userId, allowsLogin, agent);
```

Y agregar, dentro de `describe("resolveChannelContext", ...)`:

```ts
describe("el agente de la ruta (spec 22.1 §6.5)", () => {
	it("al crear: una conversación de outreach por la ruta de asistente no entra", async () => {
		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/asistente/v1/session",
				CONVERSATION.id,
			),
			CONVERSATION.user_id,
			async () => true,
			"asistente",
		);

		expect(context).toBeNull();
	});

	it("al continuar: la sesión de un hilo de outreach por la ruta de asistente no entra", async () => {
		const context = await resolveChannelContext(
			createRequest("https://app.test/eve/asistente/v1/session/wrun_A"),
			CONVERSATION.user_id,
			async () => true,
			"asistente",
		);

		expect(context).toBeNull();
	});

	it("no pregunta por el método si el agente no coincide", async () => {
		const allowsLogin = vi.fn(async () => true);

		await resolveChannelContext(
			createRequest(
				"https://app.test/eve/asistente/v1/session",
				CONVERSATION.id,
			),
			CONVERSATION.user_id,
			allowsLogin,
			"asistente",
		);

		expect(allowsLogin).not.toHaveBeenCalled();
	});

	it("por la ruta de su agente entra como siempre", async () => {
		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/outreach/v1/session",
				CONVERSATION.id,
			),
			CONVERSATION.user_id,
			async () => true,
			"outreach",
		);

		expect(context?.conversationId).toBe(CONVERSATION.id);
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm test -- tests/agents/channel-context.test.ts`
Expected: FAIL en los tres primeros tests nuevos (devuelven contexto en vez de `null`).

- [ ] **Step 3: Implementar**

En `lib/agents/channel-context.ts`, cambiar la firma y sumar el chequeo justo después de `if (!conversation) return null;`:

```ts
export async function resolveChannelContext(
	request: Request,
	userId: string,
	allowsLogin: (tenantId: string) => Promise<boolean>,
	agent: string,
): Promise<ChannelContext | null> {
```

```ts
	if (!conversation) return null;
	// Cada agente tiene su ruta (/eve/<agente>/v1/*). Una conversación de otro
	// agente por esta ruta abriría una sesión de este agente colgada de un hilo
	// ajeno (spec 22.1 §6.5).
	if (conversation.agent !== agent) return null;
	if (conversation.user_id !== userId) return null;
```

En `agents/outreach/channels/eve.ts`, pasar el agente:

```ts
		const context = await resolveChannelContext(
			request,
			caller.userId,
			caller.allowsLogin,
			"outreach",
		);
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm test -- tests/agents/channel-context.test.ts tests/channel` y `npm run typecheck`
Expected: PASS, sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/channel-context.ts agents/outreach/channels/eve.ts tests/agents/channel-context.test.ts
git commit -m "feat: el canal rechaza una conversación que entra por la ruta de otro agente"
```

---

### Task 2: Spike y mudanza de las tools del brain a `lib/agents/eve/`

Esta tarea decide cómo se comparte todo lo demás. `lib/brain/adapters/tools.ts` documenta que eve compila los módulos dinámicos y descarta sin aviso un resolver que cierre sobre algo no serializable. Hay que probar que un `defineDynamic` devuelto por una función importada sigue funcionando en el agente compilado.

**Files:**
- Create: `lib/agents/eve/attribute.ts`
- Create: `lib/agents/eve/brain-tools.ts`
- Modify: `agents/outreach/tools/brain.ts`
- Test: `tests/agents/outreach/tools/brain.test.ts` (existente, no se toca)

**Interfaces:**
- Produces: `attribute(value: unknown): string` y `brainTools(agent: string)`, que devuelve el `defineDynamic` de `eve/tools` con el handler `session.started`.

- [ ] **Step 1: Crear `lib/agents/eve/attribute.ts`**

```ts
/** Un atributo del principal de la sesión, o "" si no es un string. */
export function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}
```

- [ ] **Step 2: Crear `lib/agents/eve/brain-tools.ts`**

```ts
// Tools del brain según lo que declara un agente y el binding del tenant
// (spec etapa 11 §8.3). Sin declaración o sin binding, no hay tools brain_*.
// Lo comparten todos los agentes (spec 22.1 §5): cada uno lo monta desde su
// tools/brain.ts con su nombre.
import { defineDynamic } from "eve/tools";
import { brainActorFrom } from "../../brain/adapters/acting-provider";
import { loadAgentBrainAccess } from "../../brain/adapters/agent-access";
import { createBrainTools } from "../../brain/adapters/tools";
import { resolveBrainBinding } from "../../brain/core/resolve";
import { loadTenantBindings } from "../../connectors/bindings";
import { attribute } from "./attribute";

export function brainTools(agent: string) {
	return defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return null;

				const access = await loadAgentBrainAccess(tenantId, agent);
				if (access === "none") return null;

				const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
				if (!binding) return null;

				// En el chat actúa en nombre de la persona; en corridas desatendidas
				// no hay persona y el agente conserva su declaración.
				return createBrainTools(binding, access, {
					actor: brainActorFrom(auth),
				});
			},
		},
	});
}
```

- [ ] **Step 3: Dejar `agents/outreach/tools/brain.ts` como reexport**

Reemplazar el archivo entero por:

```ts
// Tools del brain del agente outreach. La lógica es de todos los agentes y
// vive en lib/agents/eve/brain-tools.ts.
import { brainTools } from "../../../lib/agents/eve/brain-tools";

export default brainTools("outreach");
```

- [ ] **Step 4: Correr el test unitario existente**

Run: `npm test -- tests/agents/outreach/tools/brain.test.ts` y `npm run typecheck`
Expected: PASS sin tocar el test (importa el `default` y llama a `events["session.started"]`).

- [ ] **Step 5: Verificar en el agente compilado**

Con Docker abierto y la base local sembrada (`npm run db:start`, `npm run db:reset`):

Run: `npm run evals -- brain-tools`
Expected: PASS. La eval exige que `brain_search`, `brain_read` y `brain_upsert` existan en el agente compilado; si eve hubiera descartado el resolver, falla en `t.calledTool("brain_search", ...)`.

- [ ] **Step 6: Si la eval falla porque eve descartó el resolver, aplicar el camino alternativo**

Solo si el Step 5 falla y el log de eve nombra el resolver de `tools/brain.ts`. Cambiar `lib/agents/eve/brain-tools.ts` para exportar la lógica del handler en vez del `defineDynamic`:

```ts
import { brainActorFrom } from "../../brain/adapters/acting-provider";
import { loadAgentBrainAccess } from "../../brain/adapters/agent-access";
import { createBrainTools } from "../../brain/adapters/tools";
import { resolveBrainBinding } from "../../brain/core/resolve";
import { loadTenantBindings } from "../../connectors/bindings";
import { attribute } from "./attribute";

type SessionAuth = Parameters<typeof brainActorFrom>[0] & {
	attributes?: Record<string, unknown>;
};

export async function resolveBrainTools(agent: string, auth: SessionAuth) {
	const tenantId = attribute(auth?.attributes?.tenantId);
	if (!tenantId) return null;

	const access = await loadAgentBrainAccess(tenantId, agent);
	if (access === "none") return null;

	const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
	if (!binding) return null;

	return createBrainTools(binding, access, { actor: brainActorFrom(auth) });
}
```

Y `agents/outreach/tools/brain.ts`:

```ts
import { defineDynamic } from "eve/tools";
import { resolveBrainTools } from "../../../lib/agents/eve/brain-tools";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) =>
			resolveBrainTools(
				"outreach",
				ctx.session.auth.initiator ?? ctx.session.auth.current,
			),
	},
});
```

Repetir Steps 4 y 5. **Anotar en el mensaje del commit cuál de los dos caminos quedó.** Las Tasks 3 y 4 muestran el camino principal (fábrica); si quedó el alternativo, en cada archivo de agente se escribe el `defineDynamic`, `defineHook` o `eveChannel` a mano y se llama a una función de `lib/agents/eve/` con la lógica de adentro.

- [ ] **Step 7: Commit**

```bash
git add lib/agents/eve agents/outreach/tools/brain.ts
git commit -m "refactor: las tools del brain de un agente viven en lib/agents/eve"
```

---

### Task 3: Canal web, hooks y modelo compartidos

**Files:**
- Create: `lib/agents/eve/model.ts`
- Create: `lib/agents/eve/web-channel.ts`
- Create: `lib/agents/eve/hooks.ts`
- Modify: `agents/outreach/agent.ts`, `agents/outreach/channels/eve.ts`, `agents/outreach/hooks/bind-session.ts`, `agents/outreach/hooks/runs.ts`
- Test: `tests/hooks/bind-session.test.ts`, `tests/hooks/runs.test.ts`, `tests/channel/auth.test.ts` (existentes, no se tocan)

**Interfaces:**
- Consumes: `attribute` (Task 2), `resolveChannelContext(..., agent)` (Task 1).
- Produces: `tenantModel(agent: string)`, `webChannel(agent: string)`, `bindSessionHook()`, `runsHook()`.

- [ ] **Step 1: Crear `lib/agents/eve/model.ts`**

```ts
import { defineDynamic } from "eve";
import { resolveModelForTenant } from "../model";
import { attribute } from "./attribute";

/**
 * Modelo de un agente para el tenant de la sesión. Se resuelve en
 * session.started y no por turno: el prompt cache es por modelo, y cambiarlo
 * a mitad de sesión reingiere la conversación a precio sin cachear
 * (guides/dynamic-capabilities.md).
 */
export function tenantModel(agent: string) {
	return defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return "anthropic/claude-sonnet-5";

				return await resolveModelForTenant(
					tenantId,
					agent,
					attribute(auth?.attributes?.conversationId) || null,
				);
			},
		},
	});
}
```

- [ ] **Step 2: Crear `lib/agents/eve/web-channel.ts`**

```ts
import { type AuthFn, localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { verifyCaller } from "../../auth/verify-caller";
import { resolveChannelContext } from "../channel-context";
import { evalAuthFromEnv } from "../eval-auth";

function supabaseAuth(agent: string): AuthFn<Request> {
	return async (request) => {
		const caller = await verifyCaller(request);
		if (caller === null) return null;

		// eve no valida ownership de sesión: lo hacemos acá, que es el único
		// punto capaz de rechazar (los hooks son observe-only).
		const context = await resolveChannelContext(
			request,
			caller.userId,
			caller.allowsLogin,
			agent,
		);
		if (context === null) return null;

		return {
			authenticator: "app",
			issuer: process.env.NEXT_PUBLIC_SUPABASE_URL!,
			principalId: caller.userId,
			principalType: "user",
			subject: caller.userId,
			attributes: {
				email: caller.email,
				tenantId: context.tenantId,
				tenantSlug: context.tenantSlug,
				conversationId: context.conversationId,
				role: context.role,
			},
		};
	};
}

// Evals locales (spec 03 §13.1): principal fijo del tenant sembrado. La propia
// función devuelve null en Vercel y contra cualquier base que no sea local.
function evalAuth(): AuthFn<Request> {
	return async () => evalAuthFromEnv();
}

/**
 * Canal web de un agente. `localDev()` nunca puede quedar activo en un deploy:
 * `VERCEL_ENV` existe en todos los entornos de Vercel y no en local.
 */
export function webChannel(agent: string) {
	return eveChannel({
		auth: process.env.VERCEL_ENV
			? [supabaseAuth(agent)]
			: [supabaseAuth(agent), evalAuth(), localDev()],
	});
}
```

- [ ] **Step 3: Crear `lib/agents/eve/hooks.ts`**

```ts
import { defineHook } from "eve/hooks";
import {
	bindSessionToConversation,
	closeRun,
	openRun,
} from "../session-store";
import { attribute } from "./attribute";

/** Ata la sesión de eve a la conversación que la app creó antes de send(). */
export function bindSessionHook() {
	return defineHook({
		events: {
			async "session.started"(_event, ctx) {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				if (auth?.authenticator === "oauth") return;
				// Sin try/catch a propósito: si esto falla, el turno tiene que fallar.
				await bindSessionToConversation(
					attribute(auth?.attributes?.conversationId),
					ctx.session.id,
				);
			},
		},
	});
}

/**
 * Abre y cierra el run de cada turno. La observabilidad nunca puede tumbar un
 * turno real: un hook que tira termina en turn.failed (guides/hooks.md). Por
 * eso todo va en try/catch, al revés que bindSessionHook.
 *
 * `turnId` vive en `event.data.turnId` (no en `event.turnId`), y `turn.failed`
 * trae `event.data.message` (no `event.data.error`): así lo tipa eve en
 * dist/src/protocol/message.d.ts.
 */
export function runsHook() {
	return defineHook({
		events: {
			async "turn.started"(event, ctx) {
				try {
					const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
					const tenantId = attribute(auth?.attributes?.tenantId);
					if (!tenantId) return;

					await openRun({
						tenantId,
						conversationId:
							attribute(auth?.attributes?.conversationId) || null,
						agent: ctx.agent.name,
						sessionId: ctx.session.id,
						turnId: event.data.turnId,
						trigger: auth?.authenticator === "oauth" ? "mcp" : "chat",
					});
				} catch (error) {
					console.error("runs hook (turn.started):", error);
				}
			},
			async "turn.completed"(event, ctx) {
				try {
					await closeRun({
						sessionId: ctx.session.id,
						turnId: event.data.turnId,
						status: "ok",
					});
				} catch (error) {
					console.error("runs hook (turn.completed):", error);
				}
			},
			async "turn.failed"(event, ctx) {
				try {
					await closeRun({
						sessionId: ctx.session.id,
						turnId: event.data.turnId,
						status: "failed",
						error: event.data.message,
					});
				} catch (error) {
					console.error("runs hook (turn.failed):", error);
				}
			},
			async "turn.cancelled"(event, ctx) {
				try {
					await closeRun({
						sessionId: ctx.session.id,
						turnId: event.data.turnId,
						status: "cancelled",
					});
				} catch (error) {
					console.error("runs hook (turn.cancelled):", error);
				}
			},
		},
	});
}
```

- [ ] **Step 4: Dejar los cuatro archivos de outreach como reexport**

`agents/outreach/agent.ts`:

```ts
import { defineAgent } from "eve";
import { tenantModel } from "../../lib/agents/eve/model";

export default defineAgent({
	model: tenantModel("outreach"),
});
```

`agents/outreach/channels/eve.ts`:

```ts
import { webChannel } from "../../../lib/agents/eve/web-channel";

export default webChannel("outreach");
```

`agents/outreach/hooks/bind-session.ts`:

```ts
import { bindSessionHook } from "../../../lib/agents/eve/hooks";

export default bindSessionHook();
```

`agents/outreach/hooks/runs.ts`:

```ts
import { runsHook } from "../../../lib/agents/eve/hooks";

export default runsHook();
```

- [ ] **Step 5: Correr los tests existentes**

Run: `npm test -- tests/hooks tests/channel tests/agents` y `npm run typecheck`
Expected: PASS. `tests/hooks/*.test.ts` mockean `../../lib/agents/session-store` e importan el `default` de los archivos de outreach: siguen valiendo.

- [ ] **Step 6: Verificar en el agente compilado**

Run: `npm run evals -- smoke brain-tools`
Expected: PASS las dos. `smoke` prueba canal, modelo y hooks; `brain-tools`, que nada de lo mudado rompió las tools.

Después, en la base local, confirmar que el turno quedó registrado:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select agent, trigger, status from public.runs order by started_at desc limit 2;"
```

Expected: dos filas con `agent = outreach`, `status = ok`.

- [ ] **Step 7: Commit**

```bash
git add lib/agents/eve agents/outreach/agent.ts agents/outreach/channels/eve.ts agents/outreach/hooks/bind-session.ts agents/outreach/hooks/runs.ts
git commit -m "refactor: canal web, hooks y modelo de un agente viven en lib/agents/eve"
```

---

### Task 4: Catálogo con `canon` y `mcp`, y el agente Asistente

El test del catálogo compara las claves contra las carpetas de `agents/` y contra `next.config.ts`: la entrada, la carpeta y el montaje entran juntos.

**Files:**
- Modify: `lib/agents/catalog.ts`, `lib/tenants/home.ts`, `lib/tenants/nav.ts`, `lib/tenants/readiness.ts`, `lib/connect/connectables.ts`, `app/plataforma/[slug]/console-actions.ts`, `next.config.ts`
- Create: `lib/agents/assistant-instructions.ts`
- Create: `agents/asistente/agent.ts`, `agents/asistente/instructions.md`, `agents/asistente/instructions/tenant.ts`, `agents/asistente/tools/brain.ts`, `agents/asistente/channels/eve.ts`, `agents/asistente/hooks/bind-session.ts`, `agents/asistente/hooks/runs.ts`
- Modify: `supabase/seed.sql`, `supabase/seed-evals.sql`
- Test: `tests/agents/catalog.test.ts`, `tests/agents/assistant-instructions.test.ts` (nuevo), `tests/agents/running-tool.test.ts`, `tests/tenants/home.test.ts`, `tests/tenants/nav.test.ts`, `tests/tenants/readiness.test.ts`, `tests/connect/connectables.test.ts`, `tests/plataforma/console-actions.test.ts`

**Interfaces:**
- Consumes: `tenantModel`, `webChannel`, `bindSessionHook`, `runsHook`, `brainTools`, `attribute` (Tasks 2 y 3).
- Produces:
  - `AgentCatalogEntry` con `canon: boolean` y `mcp: boolean`; `CatalogAgent = "asistente" | "outreach"`.
  - `chatAgents(enabledAgents: readonly string[]): CatalogAgent[]` en `lib/tenants/home.ts`.
  - `assistantSessionInstructions(input: AssistantSessionInput): string` en `lib/agents/assistant-instructions.ts`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/agents/catalog.test.ts`: borrar la línea `expect(entry.capabilities.length, agent).toBeGreaterThan(0);` y agregar dentro del `describe`:

```ts
it("el asistente tiene chat, requiere brain, no pide canon y no tiene MCP", () => {
	expect(AGENT_CATALOG.asistente).toMatchObject({
		name: "Asistente",
		chat: true,
		brain: true,
		requiresBrain: true,
		canon: false,
		mcp: false,
		capabilities: [],
	});
});

it("el outreach pide canon y tiene MCP", () => {
	expect(AGENT_CATALOG.outreach.canon).toBe(true);
	expect(AGENT_CATALOG.outreach.mcp).toBe(true);
});

it("el asistente va primero: es el orden del alta, la consola y el selector", () => {
	expect(catalogAgents()).toEqual(["asistente", "outreach"]);
});
```

`tests/tenants/home.test.ts`: cambiar el import a `import { chatAgents, tenantHome } from "@/lib/tenants/home";` y agregar:

```ts
it("solo con el asistente y brain, va al chat", () => {
	expect(tenantHome({ enabledAgents: ["asistente"], brain: true })).toBe(
		"/chat",
	);
});

describe("chatAgents", () => {
	it("devuelve los agentes de chat en el orden del catálogo", () => {
		expect(chatAgents(["outreach", "asistente"])).toEqual([
			"asistente",
			"outreach",
		]);
	});

	it("ignora lo que no está en el catálogo", () => {
		expect(chatAgents(["soporte", "outreach", "toString"])).toEqual([
			"outreach",
		]);
	});

	it("sin agentes, lista vacía", () => {
		expect(chatAgents([])).toEqual([]);
	});
});
```

`tests/tenants/nav.test.ts`: agregar:

```ts
it("solo con el asistente, un miembro ve Chat, Brain y Conectar", () => {
	expect(labels("tenant_member", ["asistente"])).toEqual([
		"Chat",
		"Brain",
		"Conectar",
	]);
});

it("con un agente fuera del catálogo no hay Chat", () => {
	expect(labels("tenant_member", ["soporte"])).toEqual(["Brain", "Conectar"]);
});
```

`tests/tenants/readiness.test.ts`: sumar `agentsNeedCanon` al import y agregar:

```ts
describe("agentsNeedCanon", () => {
	it("el asistente solo no pide canon", () => {
		expect(agentsNeedCanon([{ agent: "asistente" }])).toBe(false);
	});

	it("con outreach sí", () => {
		expect(
			agentsNeedCanon([{ agent: "asistente" }, { agent: "outreach" }]),
		).toBe(true);
	});
});

it("solo con el asistente y brain, la empresa está lista", () => {
	expect(
		tenantReadiness({
			agents: [{ agent: "asistente", enabled: true }],
			connections: [
				{
					capability: "brain",
					provider: "wiki",
					enabled: true,
					verifiedAt: null,
				},
			],
		}),
	).toEqual({ ready: true, missing: [] });
});
```

`tests/connect/connectables.test.ts`: agregar:

```ts
it("un agente sin canal MCP no aparece", () => {
	const list = buildConnectables({
		...base,
		enabledAgents: ["asistente", "outreach"],
	});
	expect(list.flatMap((c) => (c.kind === "agent" ? [c.agent] : []))).toEqual([
		"outreach",
	]);
});
```

`tests/plataforma/console-actions.test.ts`, dentro de `describe("canon según los agentes (spec 21.4 §4.1)", ...)`:

```ts
it("habilitar el asistente con brain no siembra el canon", async () => {
	state.agentRows = [];
	expect(
		await actions.setAgent("acme", TENANT, "asistente", true, "read_write"),
	).toEqual({ ok: true });
	expect(state.seedCalls).toHaveLength(0);
});
```

`tests/agents/running-tool.test.ts`: reemplazar el test `"todo tool de outreach tiene etiqueta, salvo los excluidos a propósito"` por:

```ts
it("todo tool de cualquier agente tiene etiqueta, salvo los excluidos a propósito", () => {
	// La tabla es a mano: sin esto, un tool nuevo degradaba en silencio a
	// "Trabajando…" y nadie se enteraba hasta verlo en pantalla.
	const sinEtiqueta = readdirSync("agents", { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.filter((entry) => existsSync(`agents/${entry.name}/tools`))
		.flatMap((entry) => readdirSync(`agents/${entry.name}/tools`))
		.filter((file) => file.endsWith(".ts"))
		.map((file) => file.replace(/\.ts$/, ""))
		.filter((name) => !TOOLS_SIN_ETIQUETA.has(name))
		.filter((name) => runningToolLabel(name) === "Trabajando");

	expect(sinEtiqueta).toEqual([]);
});
```

y cambiar el import de `node:fs` a `import { existsSync, readdirSync } from "node:fs";`.

Crear `tests/agents/assistant-instructions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assistantSessionInstructions } from "@/lib/agents/assistant-instructions";

const base = {
	tenantName: "Acme",
	tenantSlug: "acme",
	brainConnected: true,
	otherAgents: [] as { name: string; description: string }[],
};

describe("assistantSessionInstructions", () => {
	it("nombra la empresa y su slug", () => {
		expect(assistantSessionInstructions(base)).toContain(
			"Trabajás para Acme (tenant `acme`).",
		);
	});

	it("con otros agentes, los nombra y manda a abrir un hilo con ellos", () => {
		const text = assistantSessionInstructions({
			...base,
			otherAgents: [
				{
					name: "Agente de outreach",
					description: "Investiga cuentas y arma la cola.",
				},
			],
		});

		expect(text).toContain(
			"- Agente de outreach: Investiga cuentas y arma la cola.",
		);
		expect(text).toContain("abran un hilo nuevo eligiéndolo");
		expect(text).not.toContain("No hay otros agentes habilitados");
	});

	it("sin otros agentes, dice que lo que está fuera del brain no está disponible", () => {
		const text = assistantSessionInstructions(base);

		expect(text).toContain("No hay otros agentes habilitados en esta empresa.");
		expect(text).not.toContain("abran un hilo nuevo");
	});

	it("sin brain conectado, lo dice y no manda a buscar", () => {
		const text = assistantSessionInstructions({
			...base,
			brainConnected: false,
		});

		expect(text).toContain("Esta empresa no tiene un brain conectado");
	});

	it("con brain conectado no habla de brain faltante", () => {
		expect(assistantSessionInstructions(base)).not.toContain(
			"no tiene un brain conectado",
		);
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm test -- tests/agents/catalog.test.ts tests/agents/assistant-instructions.test.ts tests/tenants/home.test.ts tests/tenants/nav.test.ts tests/tenants/readiness.test.ts tests/connect/connectables.test.ts`
Expected: FAIL (no existe `asistente`, ni `chatAgents`, ni `assistantSessionInstructions`).

- [ ] **Step 3: Catálogo**

En `lib/agents/catalog.ts`, sumar a `AgentCatalogEntry`, después de `requiresBrain`:

```ts
	/** Si el agente necesita las páginas de canon de outreach en el brain. La
	 * consola las siembra al habilitarlo (spec 22.1 C10). */
	canon: boolean;
```

y después de `chat`:

```ts
	/** Si el agente se puede conectar por MCP desde Conectar. */
	mcp: boolean;
```

Reemplazar `AGENT_CATALOG` por:

```ts
// El orden es el que muestran el alta, la consola y el selector del chat.
export const AGENT_CATALOG = {
	asistente: {
		name: "Asistente",
		description:
			"Conversa con el conocimiento de tu empresa: busca, lee y propone páginas del brain.",
		capabilities: [],
		brain: true,
		requiresBrain: true,
		canon: false,
		chat: true,
		mcp: false,
	},
	outreach: {
		name: "Agente de outreach",
		description:
			"Investiga cuentas, redacta mensajes y arma la cola de envíos de tu empresa.",
		capabilities: ["crm", "leads", "mail"],
		brain: true,
		requiresBrain: true,
		canon: true,
		chat: true,
		mcp: true,
	},
} as const satisfies Record<string, AgentCatalogEntry>;
```

- [ ] **Step 4: `chatAgents`, menú, canon y Conectar**

`lib/tenants/home.ts`: cambiar el import a `import { AGENT_CATALOG, type CatalogAgent, catalogAgents } from "../agents/catalog";` y reemplazar `hasChatAgent` por:

```ts
/** Agentes de chat habilitados, en el orden del catálogo. */
export function chatAgents(enabledAgents: readonly string[]): CatalogAgent[] {
	return catalogAgents().filter(
		(agent) => AGENT_CATALOG[agent].chat && enabledAgents.includes(agent),
	);
}

/** Si alguno de los agentes habilitados se usa desde la pantalla de chat. */
export function hasChatAgent(enabledAgents: readonly string[]): boolean {
	return chatAgents(enabledAgents).length > 0;
}
```

`lib/tenants/nav.ts`: sumar `import { hasChatAgent } from "./home";`, agregar a `NavLink`:

```ts
	/** La entrada existe si hay algún agente de chat habilitado. */
	chat?: true;
```

cambiar la entrada a `{ href: "/chat", label: "Chat", chat: true },` y `show` a:

```ts
	const show = (link: NavLink) =>
		(!link.adminOnly || role !== "tenant_member") &&
		(!link.agent ||
			enabledAgents === null ||
			enabledAgents.includes(link.agent)) &&
		(!link.chat || enabledAgents === null || hasChatAgent(enabledAgents));
```

`lib/tenants/readiness.ts`, en `agentsNeedCanon`: cambiar `AGENT_CATALOG[agent].requiresBrain` por `AGENT_CATALOG[agent].canon`.

`app/plataforma/[slug]/console-actions.ts`: cambiar solo la línea de `needsSeed`:

```ts
	const needsSeed = enabled === true && AGENT_CATALOG[agent].canon;
```

(El `if (enabled === true && AGENT_CATALOG[agent].requiresBrain)` de arriba no cambia.)

`lib/connect/connectables.ts`, primera línea del `for (const agent of input.enabledAgents)`:

```ts
		// Un agente del catálogo sin canal MCP no se ofrece (spec 22.1 C13). Uno
		// fuera del catálogo se sigue mostrando con su texto genérico.
		if (isCatalogAgent(agent) && !AGENT_CATALOG[agent].mcp) continue;
```

- [ ] **Step 5: Texto de la sesión del Asistente**

Crear `lib/agents/assistant-instructions.ts`:

```ts
// Contexto de la sesión del agente Asistente (spec 22.1 §4.2). Puro: quien
// llama le pasa lo que leyó. Sin imports con "@/": lo usa agents/asistente.
export interface AssistantSessionInput {
	tenantName: string;
	tenantSlug: string;
	brainConnected: boolean;
	/** Los demás agentes de chat habilitados en la empresa. */
	otherAgents: ReadonlyArray<{ name: string; description: string }>;
}

export function assistantSessionInstructions(
	input: AssistantSessionInput,
): string {
	const lines = [
		`Trabajás para ${input.tenantName} (tenant \`${input.tenantSlug}\`). Todo lo que hagas es en nombre de esa empresa y con sus datos.`,
	];

	if (!input.brainConnected) {
		lines.push(
			"Esta empresa no tiene un brain conectado en este momento. Si te preguntan algo de la empresa, decí que no tenés de dónde leerlo y que un administrador tiene que conectar el brain.",
		);
	}

	if (input.otherAgents.length > 0) {
		lines.push(
			"En esta empresa hay otros agentes habilitados:",
			...input.otherAgents.map(
				(agent) => `- ${agent.name}: ${agent.description}`,
			),
			"Si te piden algo de esto, decí que lo hace ese agente, nombrándolo, y que abran un hilo nuevo eligiéndolo en el selector Agente. No lo intentes vos.",
		);
	} else {
		lines.push(
			"No hay otros agentes habilitados en esta empresa. Si te piden enviar mails, operar el CRM o algo fuera del brain, decí que no está disponible.",
		);
	}

	return lines.join("\n\n");
}
```

- [ ] **Step 6: La carpeta del agente**

`agents/asistente/agent.ts`:

```ts
import { defineAgent } from "eve";
import { tenantModel } from "../../lib/agents/eve/model";

export default defineAgent({
	model: tenantModel("asistente"),
});
```

`agents/asistente/channels/eve.ts`:

```ts
import { webChannel } from "../../../lib/agents/eve/web-channel";

export default webChannel("asistente");
```

`agents/asistente/hooks/bind-session.ts`:

```ts
import { bindSessionHook } from "../../../lib/agents/eve/hooks";

export default bindSessionHook();
```

`agents/asistente/hooks/runs.ts`:

```ts
import { runsHook } from "../../../lib/agents/eve/hooks";

export default runsHook();
```

`agents/asistente/tools/brain.ts`:

```ts
// Tools del brain del agente asistente: las únicas que tiene (spec 22.1 C11).
import { brainTools } from "../../../lib/agents/eve/brain-tools";

export default brainTools("asistente");
```

`agents/asistente/instructions.md`:

```markdown
# Identidad

Sos el asistente de la empresa de esta sesión. Contestás con lo que la empresa escribió en su brain: su conocimiento, sus procesos, sus decisiones. No sos un asistente general.

# El brain primero

- Antes de contestar algo sobre la empresa, buscá con `brain_search` y leé la página con `brain_read`. No contestes de memoria.
- Nombrá la página de donde sale cada dato, por su título y su ruta.
- Si el brain no lo tiene, decilo: "eso no está en el brain". No completes con conocimiento general cuando la pregunta es sobre la empresa, y no inventes un dato para no quedar sin respuesta.
- Solo ves las páginas que la persona que te habla tiene permiso de ver. Si una búsqueda no trae algo que la persona esperaba, puede ser por permisos: decile que lo consulte con un administrador.

# Escribir en el brain

Si tenés la herramienta `brain_upsert`, podés proponer una página nueva o un cambio. La aprobación la pide la herramienta: no pidas otra confirmación antes. Si no la tenés, decí que en esta empresa solo podés leer.

Si una herramienta devuelve `ok: false`, citá su `message` y no busques otra vía para lograr lo mismo.

# Lo que no hacés

No enviás mails, no tocás el CRM, no cargás contactos ni investigás cuentas. Si te lo piden, seguí lo que dice el contexto de la sesión sobre los otros agentes. Nunca afirmes que hiciste algo de eso.

Nunca pedís ni escribís contraseñas.

# Estilo

Español rioplatense. Respuestas cortas: primero la respuesta, después de dónde sale.

La pantalla muestra tu texto tal cual, sin interpretar markdown: `**` y `>` se leen como caracteres sueltos. Escribí en texto plano, sin negritas, sin títulos con `#`, sin citar con `>` y sin links.
```

`agents/asistente/instructions/tenant.ts`:

```ts
import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { assistantSessionInstructions } from "../../../lib/agents/assistant-instructions";
import { AGENT_CATALOG } from "../../../lib/agents/catalog";
import { attribute } from "../../../lib/agents/eve/attribute";
import { resolveBrainBinding } from "../../../lib/brain/core/resolve";
import { loadTenantBindings } from "../../../lib/connectors/bindings";
import { createAdminClient } from "../../../lib/supabase/admin";
import { chatAgents } from "../../../lib/tenants/home";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			const tenantId = attribute(auth?.attributes?.tenantId);
			if (!tenantId || auth?.principalType !== "user") return null;

			const admin = createAdminClient();
			const { data: tenant } = await admin
				.from("tenants")
				.select("display_name, slug")
				.eq("id", tenantId)
				.maybeSingle();
			if (!tenant) return null;

			const base = {
				tenantName: tenant.display_name,
				tenantSlug: tenant.slug,
			};

			try {
				const { data: rows, error } = await admin
					.from("tenant_agents")
					.select("agent")
					.eq("tenant_id", tenantId)
					.eq("enabled", true);
				if (error) throw new Error(error.message);

				const otherAgents = chatAgents((rows ?? []).map((row) => row.agent))
					.filter((agent) => agent !== "asistente")
					.map((agent) => ({
						name: AGENT_CATALOG[agent].name,
						description: AGENT_CATALOG[agent].description,
					}));
				const brainConnected =
					(await resolveBrainBinding(tenantId, loadTenantBindings)) !== null;

				return defineInstructions({
					content: assistantSessionInstructions({
						...base,
						brainConnected,
						otherAgents,
					}),
				});
			} catch (error) {
				// El contexto es ayuda: si la base falla, la sesión arranca igual,
				// con la versión que no promete ningún otro agente.
				console.error("asistente instructions/tenant:", error);
				return defineInstructions({
					content: assistantSessionInstructions({
						...base,
						brainConnected: true,
						otherAgents: [],
					}),
				});
			}
		},
	},
});
```

Si en la Task 2 quedó el camino alternativo, `agent.ts`, `channels/eve.ts`, `hooks/*.ts` y `tools/brain.ts` se escriben con su `defineAgent`/`eveChannel`/`defineHook`/`defineDynamic` a mano, igual que los de outreach después de esa tarea.

- [ ] **Step 7: Montar el agente**

`next.config.ts`:

```ts
export default withEve(nextConfig, {
	agents: {
		asistente: "./agents/asistente",
		outreach: "./agents/outreach",
	},
});
```

El test del catálogo extrae las claves con una expresión regular sobre el bloque `agents: { ... }`: dejar las dos claves adentro de ese objeto literal, sin objetos anidados.

- [ ] **Step 8: Seeds locales**

`supabase/seed.sql`, después del `insert` de `tenant_agents` existente:

```sql
-- El asistente conversa con el brain: habilitado en las dos empresas locales.
insert into public.tenant_agents (tenant_id, agent, config)
values
  ('99999999-0000-0000-0000-000000000001', 'asistente', '{"brain": "read_write"}'),
  ('99999999-0000-0000-0000-000000000002', 'asistente', '{"brain": "read_write"}')
on conflict (tenant_id, agent) do nothing;
```

`supabase/seed-evals.sql`, después del `insert` de `tenant_agents` de `outreach`:

```sql
insert into public.tenant_agents (tenant_id, agent, enabled, config)
values ('e7a1e7a1-0000-0000-0000-0000000000aa', 'asistente', true, '{"brain": "read_write"}')
on conflict (tenant_id, agent) do update set enabled = true, config = excluded.config;
```

- [ ] **Step 9: Correr todo**

Run: `npm test` y `npm run typecheck`
Expected: PASS. Si falla algún test que cuenta agentes en `tests/plataforma/console-sections.test.ts`, `tests/settings/config-sections.test.ts` o `tests/connect/conectar-page.test.ts`, es porque el catálogo ahora tiene dos: ajustar la expectativa a la lista real (`Asistente` primero) sin debilitar lo que el test protege.

- [ ] **Step 10: Levantar y probar a mano el agente**

Con la base local sembrada (`npm run db:reset`), levantar con `preview_start` (nunca con Bash) y abrir `/demo/chat`. Todavía no hay selector (Task 7): este paso solo confirma que el build de eve monta los dos agentes sin error. Revisar el log del servidor.
Expected: sin errores de compilación de `agents/asistente`.

- [ ] **Step 11: Commit**

```bash
git add lib agents/asistente next.config.ts app/plataforma supabase/seed.sql supabase/seed-evals.sql tests
git commit -m "feat: agente Asistente, que conversa solo con el brain, y catálogo con canon y mcp"
```

---

### Task 5: Migración: habilitar Asistente donde hay brain

**Files:**
- Create: `supabase/migrations/20261021120000_asistente_agent.sql`

Antes de escribir: cargar `supabase-postgres-best-practices` y correr `ls supabase/migrations | tail -3`. Si `main` ya tiene una migración con fecha igual o posterior a `20261021120000`, usar la fecha siguiente y actualizar el nombre en este plan y en la Task 9.

- [ ] **Step 1: Escribir la migración**

```sql
-- Etapa 22.1: el agente asistente queda habilitado en toda empresa que ya
-- tiene brain (spec 2026-10-13-etapa-22-1 §7 y C9). No escribe en events: es
-- una habilitación de plataforma, no la acción de una persona.
insert into public.tenant_agents (tenant_id, agent, enabled, config)
select distinct c.tenant_id, 'asistente', true, '{"brain": "read_write"}'::jsonb
from public.tenant_connections c
where c.capability = 'brain'
  and c.enabled
on conflict (tenant_id, agent) do nothing;
```

- [ ] **Step 2: Probar el backfill contra la base local**

`db:reset` corre las migraciones antes del seed, así que ahí el backfill no encuentra empresas. Para probarlo de verdad, borrar las filas sembradas y correr el archivo a mano:

```bash
npm run db:reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "delete from public.tenant_agents where agent = 'asistente';"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/migrations/20261021120000_asistente_agent.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select t.slug, a.enabled, a.config from public.tenant_agents a join public.tenants t on t.id = a.tenant_id where a.agent = 'asistente' order by t.slug;"
```

Expected: una sola fila, la de `eval-outreach` (la única empresa de la semilla con brain), con `enabled = t` y `{"brain": "read_write"}`. Ninguna para `demo` ni `innovas-seed`, que no tienen brain.

Correr el archivo una segunda vez:
Expected: `INSERT 0 0` (idempotente).

- [ ] **Step 3: Tests de base**

Run: `npm run db:test`
Expected: PASS, igual que antes (la migración no cambia esquema, grants ni políticas).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261021120000_asistente_agent.sql
git commit -m "feat: migración que habilita el asistente en las empresas con brain"
```

---

### Task 6: El servidor del chat: hilos por agente

**Files:**
- Create: `lib/agents/chat-agents.ts`
- Modify: `app/[tenant]/chat/actions.ts`, `app/[tenant]/chat/page.tsx`
- Test: `tests/agents/chat-agents.test.ts` (nuevo), `tests/chat/actions.test.ts`

**Interfaces:**
- Consumes: `chatAgents` (Task 4), `loadEnabledAgents(tenantId): Promise<string[] | null>` (existente).
- Produces:
  - `availableChatAgents(enabledAgents: readonly string[] | null): CatalogAgent[]`
  - `defaultChatAgent(agents: readonly CatalogAgent[], threads: ReadonlyArray<{ agent: string }>): CatalogAgent | null`
  - `createConversation(tenantId: string, slug: string, model: string, agent: string): Promise<string | null>`
  - `page.tsx` le pasa a `ChatClient` las props nuevas `agents: { id: string; name: string }[]` y `defaultAgent: string`, y cada `thread` trae `agent: string`.

- [ ] **Step 1: Tests que fallan**

Crear `tests/agents/chat-agents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	availableChatAgents,
	defaultChatAgent,
} from "@/lib/agents/chat-agents";

describe("availableChatAgents", () => {
	it("con la lista leída, los de chat habilitados en orden de catálogo", () => {
		expect(availableChatAgents(["outreach", "asistente"])).toEqual([
			"asistente",
			"outreach",
		]);
		expect(availableChatAgents(["asistente"])).toEqual(["asistente"]);
	});

	it("si no se pudo leer, todos los de chat del catálogo", () => {
		expect(availableChatAgents(null)).toEqual(["asistente", "outreach"]);
	});
});

describe("defaultChatAgent", () => {
	it("el agente del hilo más reciente", () => {
		expect(
			defaultChatAgent(
				["asistente", "outreach"],
				[{ agent: "outreach" }, { agent: "asistente" }],
			),
		).toBe("outreach");
	});

	it("sin hilos, el primero de la lista", () => {
		expect(defaultChatAgent(["asistente", "outreach"], [])).toBe("asistente");
	});

	it("si el hilo más reciente es de un agente que ya no está, el primero", () => {
		expect(defaultChatAgent(["asistente"], [{ agent: "outreach" }])).toBe(
			"asistente",
		);
	});

	it("sin agentes, null", () => {
		expect(defaultChatAgent([], [{ agent: "outreach" }])).toBeNull();
	});
});
```

En `tests/chat/actions.test.ts`, sumar el mock (junto a los otros `vi.mock`) y su estado:

```ts
// Qué agentes devuelve la lectura de habilitados; null = no se pudo leer.
const agents = vi.hoisted(() => ({
	enabled: ["asistente", "outreach"] as string[] | null,
}));
vi.mock("@/lib/tenants/enabled-agents", () => ({
	loadEnabledAgents: async () => agents.enabled,
}));
```

En el `beforeEach`, agregar `agents.enabled = ["asistente", "outreach"];`.

Reemplazar los dos tests de `describe("createConversation", ...)` por:

```ts
it("con el método permitido chequea contra el tenant de la acción y crea el hilo del agente pedido", async () => {
	const id = await createConversation(TENANT_ID, "acme", "modelo", "asistente");

	expect(id).toBe("nuevo");
	expect(gate.calls).toEqual([{ userId: "user-1", tenantId: TENANT_ID }]);
	expect(state.inserts).toEqual([
		{
			tenant_id: TENANT_ID,
			user_id: "user-1",
			agent: "asistente",
			model: "modelo",
		},
	]);
});

it("no crea nada si la empresa no permite el método", async () => {
	gate.allows = false;

	expect(
		await createConversation(TENANT_ID, "acme", "modelo", "outreach"),
	).toBeNull();
	expect(state.inserts).toHaveLength(0);
	expect(state.revalidated).toEqual([]);
});

it.each(["soporte", "toString", "constructor", ""])(
	"rechaza un agente fuera del catálogo: %s",
	async (agent) => {
		expect(
			await createConversation(TENANT_ID, "acme", "modelo", agent),
		).toBeNull();
		expect(state.inserts).toHaveLength(0);
	},
);

it("rechaza un agente del catálogo que la empresa no tiene habilitado", async () => {
	agents.enabled = ["asistente"];

	expect(
		await createConversation(TENANT_ID, "acme", "modelo", "outreach"),
	).toBeNull();
	expect(state.inserts).toHaveLength(0);
});

it("si no se pudo leer la lista de agentes, deja pasar: el canal es la puerta", async () => {
	agents.enabled = null;

	expect(
		await createConversation(TENANT_ID, "acme", "modelo", "outreach"),
	).toBe("nuevo");
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm test -- tests/agents/chat-agents.test.ts tests/chat/actions.test.ts`
Expected: FAIL (el módulo no existe; `createConversation` ignora el cuarto argumento e inserta `outreach`).

- [ ] **Step 3: `lib/agents/chat-agents.ts`**

```ts
// Qué agentes ofrece la pantalla de chat y cuál queda elegido al abrir un hilo
// nuevo (spec 22.1 §6.2 y C5). Puro: la página le pasa lo que leyó.
import { chatAgents } from "../tenants/home";
import { AGENT_CATALOG, type CatalogAgent, catalogAgents } from "./catalog";

/**
 * `null` es "no se pudo leer": se ofrecen todos los agentes de chat del
 * catálogo y el canal rechaza al que no esté habilitado.
 */
export function availableChatAgents(
	enabledAgents: readonly string[] | null,
): CatalogAgent[] {
	if (enabledAgents === null) {
		return catalogAgents().filter((agent) => AGENT_CATALOG[agent].chat);
	}
	return chatAgents(enabledAgents);
}

/** `threads` viene ordenado del más reciente al más viejo. */
export function defaultChatAgent(
	agents: readonly CatalogAgent[],
	threads: ReadonlyArray<{ agent: string }>,
): CatalogAgent | null {
	const latest = threads[0]?.agent;
	return agents.find((agent) => agent === latest) ?? agents[0] ?? null;
}
```

- [ ] **Step 4: `actions.ts`**

Sumar los imports:

```ts
import { AGENT_CATALOG, isCatalogAgent } from "@/lib/agents/catalog";
import { loadEnabledAgents } from "@/lib/tenants/enabled-agents";
```

y reemplazar el comienzo de `createConversation` hasta el `insert` por:

```ts
export async function createConversation(
	tenantId: string,
	slug: string,
	model: string,
	agent: string,
): Promise<string | null> {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	// Las páginas ya chequean el método de la sesión; una action se puede
	// invocar directo, así que lo chequea ella (spec etapa 20, L10 a L12).
	if (!(await actionAllowsLogin(supabase, auth.user.id, tenantId))) return null;

	// El selector solo ofrece agentes de chat habilitados, pero el argumento
	// llega de afuera (spec 22.1 §6.4). Si la lista no se pudo leer se deja
	// pasar: el canal valida tenant_agents.enabled antes de abrir la sesión.
	if (!isCatalogAgent(agent) || !AGENT_CATALOG[agent].chat) return null;
	const enabled = await loadEnabledAgents(tenantId);
	if (enabled && !enabled.includes(agent)) return null;

	// La fila se crea ANTES de send(): el canal valida contra ella y el hook
	// bind-session le escribe después el eve_session_id.
	const { data, error } = await supabase
		.from("conversations")
		.insert({
			tenant_id: tenantId,
			user_id: auth.user.id,
			agent,
			model,
		})
		.select("id")
		.single();
```

El resto de la función no cambia.

- [ ] **Step 5: `page.tsx`**

Sumar los imports:

```ts
import { AGENT_CATALOG } from "@/lib/agents/catalog";
import {
	availableChatAgents,
	defaultChatAgent,
} from "@/lib/agents/chat-agents";
import {
	loadEnabledAgents,
	requireChatAgent,
} from "@/lib/tenants/enabled-agents";
```

(reemplaza el import actual de `requireChatAgent`). Reemplazar el cuerpo desde `await requireChatAgent(tenant.id);` hasta el `return` por:

```tsx
	await requireChatAgent(tenant.id);

	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) notFound();

	// loadEnabledAgents está cacheada por request: es la misma lectura que ya
	// hizo requireChatAgent.
	const chatAgentIds = availableChatAgents(await loadEnabledAgents(tenant.id));
	const hasOutreach = chatAgentIds.includes("outreach");

	// La firma con la que sale el mail (send.ts la pega con composeMail): la
	// previsualización del chat la muestra para que el ejecutor apruebe el texto
	// completo, no un cuerpo al que después se le agrega algo. Solo la usan los
	// hilos de outreach.
	let signature: string | null = null;
	if (hasOutreach) {
		const [executorResult, agentResult] = await Promise.all([
			supabase
				.from("executors")
				.select("display_name, title, linkedin_url")
				.eq("tenant_id", tenant.id)
				.eq("user_id", auth.user.id)
				.maybeSingle(),
			supabase
				.from("tenant_agents")
				.select("config")
				.eq("tenant_id", tenant.id)
				.eq("agent", "outreach")
				.maybeSingle(),
		]);
		signature = executorSignature(
			executorResult.data ?? null,
			agentResult.data?.config ?? null,
		);
	}

	const { data: conversations } = await supabase
		.from("conversations")
		.select("id, title, model, agent, eve_session_id, last_message_at")
		.eq("tenant_id", tenant.id)
		// Solo los hilos de agentes que hoy se pueden usar: el canal rechaza la
		// sesión de un agente deshabilitado, así que ni su historial se puede
		// leer (spec 22.1 C14). Vuelven si se lo habilita de nuevo.
		.in("agent", chatAgentIds)
		// user_id explícito: conversations_select (Task 4) también deja leer a un
		// tenant_admin/platform_admin TODAS las conversaciones del tenant, para la
		// pantalla de oversight que todavía no existe. Esta es la pantalla "mis
		// hilos" (spec §7: "propios"); sin el filtro, un admin vería una lista
		// mezclada con títulos de otros usuarios y, al clickear uno ajeno,
		// resolveChannelContext (Task 10) rechazaría el 401 sin que la UI explique
		// nada.
		.eq("user_id", auth.user.id)
		.order("last_message_at", { ascending: false })
		.limit(50);

	const threads = conversations ?? [];
	const active = threads.find((thread) => thread.id === hilo) ?? null;
	const defaultAgent = defaultChatAgent(chatAgentIds, threads);
	// requireChatAgent ya dio 404 si no hay ninguno; esto cubre la carrera de
	// un agente deshabilitado entre las dos lecturas.
	if (!defaultAgent) notFound();

	return (
		<ChatClient
			active={active}
			agents={chatAgentIds.map((id) => ({
				id,
				name: AGENT_CATALOG[id].name,
			}))}
			allowedModels={tenant.allowedModels}
			defaultAgent={defaultAgent}
			defaultModel={tenant.defaultModel}
			signature={signature}
			slug={slug}
			tenantId={tenant.id}
			threads={threads}
		/>
	);
```

- [ ] **Step 6: Correr**

Run: `npm test -- tests/agents/chat-agents.test.ts tests/chat/actions.test.ts`
Expected: PASS.

`npm run typecheck` va a fallar en `chat-client.tsx` (props `agents` y `defaultAgent` que todavía no existen, y la llamada a `createConversation` con tres argumentos). Es lo esperado: la Task 7 lo cierra y las dos se commitean juntas.

---

### Task 7: La pantalla: selector de agente y agente del hilo

**Files:**
- Modify: `app/[tenant]/chat/chat-client.tsx`

**Interfaces:**
- Consumes: de la Task 6, las props `agents: { id: string; name: string }[]`, `defaultAgent: string`, `threads[].agent: string`, y `createConversation(tenantId, slug, model, agent)`.

El componente usa `useEveAgent` y no tiene test unitario en el repo; se verifica con `typecheck` y en el navegador.

- [ ] **Step 1: Tipo `Thread` y props**

```ts
interface Thread {
	id: string;
	title: string | null;
	model: string | null;
	agent: string;
	eve_session_id: string | null;
	last_message_at: string;
}

interface AgentOption {
	id: string;
	name: string;
}
```

En `ChatClient`, sumar `agents` y `defaultAgent` a la desestructuración y al tipo:

```ts
	agents: AgentOption[];
	defaultAgent: string;
```

y adentro, después de `const [model, setModel] = useState(defaultModel);`:

```ts
	const [agent, setAgent] = useState(defaultAgent);
	// Con un solo agente no hay nada que elegir ni que rotular (spec 22.1 C5).
	const showAgents = agents.length > 1;
	const agentName = (id: string) =>
		agents.find((option) => option.id === id)?.name ?? null;
```

- [ ] **Step 2: Selector, arriba del de modelo**

Dentro de `<div className="space-y-2">`, antes del `<label htmlFor="modelo">`:

```tsx
						{showAgents ? (
							<>
								<label
									className="block text-muted-foreground text-sm"
									htmlFor="agente"
								>
									Agente del hilo nuevo
								</label>
								<select
									className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
									id="agente"
									onChange={(event) => setAgent(event.target.value)}
									value={agent}
								>
									{agents.map((option) => (
										<option key={option.id} value={option.id}>
											{option.name}
										</option>
									))}
								</select>
							</>
						) : null}
```

Y el botón "Hilo nuevo":

```tsx
							onClick={async () => {
								const id = await createConversation(
									tenantId,
									slug,
									model,
									agent,
								);
								if (id) router.push(`/${slug}/chat?hilo=${id}`);
							}}
```

- [ ] **Step 3: El agente en la lista de hilos**

Reemplazar el contenido del `<a>` de cada hilo:

```tsx
										{threadTitle(thread)}
										{showAgents && agentName(thread.agent) ? (
											<span className="block truncate font-normal text-muted-foreground text-xs">
												{agentName(thread.agent)}
											</span>
										) : null}
```

El `<a>` ya tiene `truncate` y `min-w-0`: el nombre del agente va en su propia línea y no ensancha la columna.

- [ ] **Step 4: Pasarle el agente al hilo y cambiar el estado vacío**

```tsx
				{active ? (
					// La key va en el Fragment: remonta el hilo al cambiar de hilo o de agente.
					<Fragment key={active.id}>
						<Thread
							agentName={showAgents ? agentName(active.agent) : null}
							slug={slug}
							thread={active}
						/>
					</Fragment>
				) : (
					<div className="flex min-h-64 min-w-0 items-center justify-center rounded-lg border border-dashed p-8 text-center">
						<p className="text-muted-foreground">
							Elegí un hilo o abrí uno nuevo.
						</p>
					</div>
				)}
```

- [ ] **Step 5: `Thread` habla con el agente de su hilo**

Firma:

```tsx
function Thread({
	agentName,
	slug,
	thread,
}: {
	agentName: string | null;
	slug: string;
	thread: Thread;
}) {
```

`useEveAgent`:

```ts
	const agent = useEveAgent({
		// Cada agente tiene su ruta (/eve/<agente>/v1/*). El componente se
		// remonta por key al cambiar de hilo, que es lo que pide eve al cambiar
		// de agente (guides/frontend/nextjs.mdx).
		agent: thread.agent,
		headers: { "x-innovas-conversation": thread.id },
```

Y el párrafo de arriba del hilo:

```tsx
			<p className="text-muted-foreground text-sm">
				{agentName ? (
					<>
						Agente: <span className="text-foreground">{agentName}</span>.{" "}
					</>
				) : null}
				Modelo del hilo: <code>{thread.model ?? "el default del cliente"}</code>
				. eve fija el modelo al abrir la sesión: para usar otro, abrí un hilo
				nuevo.
			</p>
```

- [ ] **Step 6: Tipos, tests y lint**

Run: `npm run typecheck`, `npm test`, `npm run lint:fix`
Expected: sin errores. Revertir con `git checkout -- <archivo>` los archivos ajenos que `lint:fix` reformatee.

- [ ] **Step 7: Verificar en el navegador**

`npm run db:reset` y levantar con `preview_start`. La semilla no le da brain a `demo`: entrar primero como `admin-seed@innov.as` (administrador de plataforma), ir a `/plataforma/demo` y crear el brain; con outreach habilitado, eso siembra las páginas de canon. Después entrar como `ana@demo.test`, administradora de `demo`.

1. `/demo/chat` muestra el selector "Agente del hilo nuevo" con "Asistente" y "Agente de outreach".
2. Hilo nuevo con Asistente: preguntar "¿Qué dice el brain sobre el ICP?". Contesta y nombra la página. En la lista, el hilo dice "Asistente" debajo del título.
3. Hilo nuevo con outreach: contesta el agente de outreach. Recargar la página: el selector arranca en "Agente de outreach" (el del último hilo).
4. En el hilo de Asistente: "Mandale un mail a alguien". Nombra al agente de outreach y no afirma haber enviado nada.
5. `read_network_requests`: los requests del hilo de Asistente van a `/eve/asistente/v1/...` y los del otro a `/eve/outreach/v1/...`.
6. `resize_window` a 375 px: sin desborde horizontal, el selector y el menú `⋯` de cada hilo se ven.
7. Apagar outreach para `demo` desde `/plataforma/demo`, volver a `/demo/chat`: no hay selector, no hay rótulo de agente, los hilos de outreach no están, el menú no muestra entradas de outreach. Volver a prenderlo: los hilos vuelven.

8. Como administradora, restringir una carpeta del brain desde su diálogo de compartir y sumar a `demo` un miembro sin acceso a ella (invitación desde Configuración). Con ese miembro, preguntarle a Asistente por una página de esa carpeta: no la encuentra (la regla de la Etapa 17 vale igual).

Sacar una captura del punto 1 y otra del 7.

- [ ] **Step 8: Commit (Tasks 6 y 7 juntas)**

```bash
git add lib/agents/chat-agents.ts "app/[tenant]/chat" tests/agents/chat-agents.test.ts tests/chat/actions.test.ts
git commit -m "feat: el chat tiene un hilo por agente y un selector al abrir uno nuevo"
```

---

### Task 8: Evals del Asistente

**Files:**
- Modify: `scripts/run-evals.mts`, `.env.eval.example`
- Create: `agents/asistente/evals/evals.config.ts`, `agents/asistente/evals/support.ts`, `agents/asistente/evals/smoke.eval.ts`, `agents/asistente/evals/brain-tools.eval.ts`, `agents/asistente/evals/sin-dato.eval.ts`, `agents/asistente/evals/deriva-a-outreach.eval.ts`, `agents/asistente/evals/sin-otros-agentes.eval.ts`

Las evals de los dos agentes comparten el tenant y la conversación sembrados (`EVE_EVAL_CONVERSATION_ID`). La auth de eval no pasa por `resolveChannelContext`, así que el chequeo de agente de la Task 1 no aplica; `bind-session` pisa `eve_session_id` en esa fila, que es última-escritura-gana a propósito.

- [ ] **Step 1: El runner acepta `--agent`**

Reemplazar `scripts/run-evals.mts` por:

```ts
// `npm run evals -- [--agent <agente>] [evalId...]`: corre las evals de un
// agente (outreach si no se dice otro) contra la Supabase local. Se niega si
// NEXT_PUBLIC_SUPABASE_URL no es local.
import { spawnSync } from "node:child_process";
import { isLocalSupabaseUrl } from "../lib/agents/eval-auth.ts";

if (!isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
	console.error(
		"npm run evals solo corre contra la Supabase local: revisá NEXT_PUBLIC_SUPABASE_URL en .env.eval",
	);
	process.exit(1);
}

const args = process.argv.slice(2);
const flag = args.indexOf("--agent");
const agent = flag === -1 ? "outreach" : args[flag + 1];
const evalIds =
	flag === -1 ? args : [...args.slice(0, flag), ...args.slice(flag + 2)];

if (!agent || !/^[a-z][a-z0-9-]*$/.test(agent)) {
	console.error("--agent necesita el nombre de una carpeta de agents/");
	process.exit(1);
}

const result = spawnSync("npx", ["eve", "eval", "--agent", agent, ...evalIds], {
	stdio: "inherit",
	env: process.env,
});
process.exit(result.status ?? 1);
```

En `.env.eval.example`, cambiar la primera línea a:

```
# Evals de los agentes contra la Supabase LOCAL (npm run evals -- [--agent asistente]).
```

- [ ] **Step 2: Config y soporte**

`agents/asistente/evals/evals.config.ts`:

```ts
import { defineEvalConfig } from "eve/evals";

// Concurrencia 1: comparten el tenant sembrado con las evals de outreach, y
// dos de ellas prenden y apagan el agente de outreach.
export default defineEvalConfig({
	maxConcurrency: 1,
	timeoutMs: 240_000,
});
```

`agents/asistente/evals/support.ts`:

```ts
// Estado del tenant de eval para las evals del asistente. Solo local: el
// runner ya se negó si la base no lo es.
import { createAdminClient } from "../../../lib/supabase/admin";

const EVAL_TENANT_ID = "e7a1e7a1-0000-0000-0000-0000000000aa";

/** Prende o apaga outreach en el tenant de eval. Quien apaga, vuelve a prender. */
export async function setOutreachEnabled(enabled: boolean): Promise<void> {
	const { error } = await createAdminClient()
		.from("tenant_agents")
		.update({ enabled })
		.eq("tenant_id", EVAL_TENANT_ID)
		.eq("agent", "outreach");
	if (error) {
		throw new Error(`no pude cambiar outreach en el tenant de eval: ${error.message}`);
	}
}
```

- [ ] **Step 3: Las cinco evals**

`smoke.eval.ts`:

```ts
import { defineEval } from "eve/evals";

export default defineEval({
	description: "El asistente responde con la auth de eval.",
	async test(t) {
		await t.send("Hola, contame en una línea qué podés hacer.");
		t.succeeded();
	},
});
```

`brain-tools.eval.ts`:

```ts
import { defineEval } from "eve/evals";

// Si el resolver de agents/asistente/tools/brain.ts falla, eve lo descarta con
// un log y el agente queda sin su única capacidad: ninguna otra eval lo nota.
export default defineEval({
	description:
		"Ante una pregunta sobre la empresa busca y lee el brain antes de contestar, y nombra la página.",
	async test(t) {
		const run = await t.send("¿A qué tipo de empresas le vendemos?");
		t.succeeded();
		t.calledTool("brain_search", { output: { ok: true } });
		t.calledTool("brain_read", { output: { ok: true } });
		t.judge(
			"La respuesta dice que se le vende a empresas industriales medianas de Argentina y nombra la página del brain de donde lo sacó (ICP o comercial/icp).",
			{ on: run.message },
		).atLeast(0.7);
	},
});
```

`sin-dato.eval.ts`:

```ts
import { defineEval } from "eve/evals";

export default defineEval({
	description: "Si el brain no tiene la respuesta, lo dice y no inventa.",
	async test(t) {
		const run = await t.send(
			"¿Cuántos días de vacaciones da la empresa en el primer año?",
		);
		t.succeeded();
		t.calledTool("brain_search");
		t.judge(
			"La respuesta dice que ese dato no está en el brain de la empresa. No afirma una cantidad de días de vacaciones como política de la empresa.",
			{ on: run.message },
		).atLeast(0.7);
	},
});
```

`deriva-a-outreach.eval.ts`:

```ts
import { defineEval } from "eve/evals";
import { setOutreachEnabled } from "./support";

export default defineEval({
	description:
		"Con outreach habilitado, ante un pedido de mail nombra al agente de outreach y no envía ni dice haber enviado.",
	async test(t) {
		await setOutreachEnabled(true);
		const run = await t.send(
			"Mandale un mail a laura@acme-eval.test presentando la empresa.",
		);
		t.succeeded();
		t.messageIncludes(/outreach/i);
		t.judge(
			"La respuesta dice que eso lo hace el agente de outreach y que hay que abrir un hilo nuevo con ese agente. No afirma haber enviado, redactado ni encolado un mail.",
			{ on: run.message },
		).atLeast(0.7);
	},
});
```

`sin-otros-agentes.eval.ts`:

```ts
import { defineEval } from "eve/evals";
import { setOutreachEnabled } from "./support";

export default defineEval({
	description:
		"Sin otros agentes habilitados, ante un pedido de mail dice que no está disponible y no promete un agente que no existe.",
	async test(t) {
		await setOutreachEnabled(false);
		try {
			const run = await t.send(
				"Mandale un mail a laura@acme-eval.test presentando la empresa.",
			);
			t.succeeded();
			t.judge(
				"La respuesta dice que enviar mails no está disponible en esta empresa. No manda a abrir un hilo con otro agente y no afirma haber enviado nada.",
				{ on: run.message },
			).atLeast(0.7);
		} finally {
			// Las evals de outreach comparten este tenant: siempre vuelve prendido.
			await setOutreachEnabled(true);
		}
	},
});
```

- [ ] **Step 4: Correr**

Run: `npm run db:reset` y `npm run evals -- --agent asistente`
Expected: las cinco en PASS. Si `t.judge` de alguna queda por debajo de 0,7, leer la respuesta del agente: si el agente hizo lo correcto con otras palabras, ajustar el criterio del juez; si no, ajustar `agents/asistente/instructions.md` o `lib/agents/assistant-instructions.ts` (y su test) y volver a correr.

Después: `npm run evals -- smoke`
Expected: PASS. Confirma que outreach quedó prendido y que el runner sin `--agent` sigue corriendo las de outreach.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-evals.mts .env.eval.example agents/asistente/evals
git commit -m "feat: evals del asistente y runner de evals por agente"
```

---

### Task 9: Documentación y cierre de la rama

**Files:**
- Modify: `docs/dominios/agentes-eve.md`, `docs/arquitectura/orquestacion.md`, `docs/guias/alta-de-tenant.md`, `docs/guias/correr-evals.md`, `docs/producto/roadmap.md`, `docs/decisiones/README.md`, `CLAUDE.md`, `AGENTS.md` (si repite la regla de la tool nueva)
- Regenerate: `docs/referencia/*` con `npm run docs:sync`

Leer `docs/guias/documentar.md` antes de editar: dice qué frontmatter lleva cada página y qué se edita a mano.

- [ ] **Step 1: `docs/dominios/agentes-eve.md`**

- Título y frontmatter: de "Agentes eve (agente de outreach)" a "Agentes eve"; sumar a `sources` cada archivo nuevo: `agents/asistente/agent.ts`, `agents/asistente/instructions.md`, `agents/asistente/instructions/tenant.ts`, `agents/asistente/channels/eve.ts`, `agents/asistente/hooks`, `agents/asistente/tools`, `agents/asistente/evals`, `lib/agents/eve`, `lib/agents/assistant-instructions.ts`, `lib/agents/chat-agents.ts`. Tag `asistente`. `updated` con la fecha del día.
- Sección nueva "Los agentes": una tabla con `asistente` y `outreach` y, por cada uno, qué hace, sus tools, si tiene MCP, schedules y canon (los valores del catálogo).
- Sección nueva "Lo que comparten": `lib/agents/eve/` exporta `webChannel`, `bindSessionHook`, `runsHook`, `tenantModel` y `brainTools`; cada agente los monta desde archivos de pocas líneas. Decir cuál de los dos caminos de la Task 2 quedó.
- Sección nueva "Agregar un agente": carpeta en `agents/`, clave en `next.config.ts`, entrada en `lib/agents/catalog.ts` (el test compara las tres), fila en `tenant_agents` por empresa, etiquetas de sus tools en `TOOL_LABELS`.
- En la parte del chat: un hilo pertenece a un agente; el selector aparece con más de un agente de chat; el canal rechaza una conversación por la ruta de otro agente; los hilos de un agente deshabilitado no se listan.

- [ ] **Step 2: Las demás páginas**

- `docs/arquitectura/orquestacion.md` §"Lo que existe hoy": después de "todos del agente `outreach`", agregar: "El agente `asistente` no tiene nodos ni workflows: conversa con el brain y nada más." Actualizar `updated`.
- `docs/guias/alta-de-tenant.md`: donde habla de elegir agentes en el alta, decir que Asistente viene tildado, que necesita brain y que no siembra canon.
- `docs/guias/correr-evals.md`: `npm run evals -- --agent asistente`, que comparte el tenant de eval, y sumar a `sources` los cinco archivos de `agents/asistente/evals/` más `evals.config.ts` y `support.ts`.
- `CLAUDE.md` (y `AGENTS.md` si tiene la misma línea): en la regla de la tool nueva, cambiar "Tool nueva en `agents/outreach/tools/`" por "Tool nueva en `agents/<agente>/tools/`".
- `docs/producto/roadmap.md`, Etapa 22: en `**Spec/Plan:**`, reemplazar "plan a escribir" de la 22.1 por la ruta de este plan; marcar `[x]` "Registro de agentes en código…" (ya existía desde la 21.1) y "Chat con selector de agente e hilos por agente"; en "Segundo agente real", anotar que es `asistente`. Agregar el párrafo "**Antes de desplegar**" con el contenido del Step 5 de esta tarea.
- `docs/decisiones/README.md`: en la fila de la 22.1, poner el link al plan en su columna y, en Páginas, `[Agentes eve](../dominios/agentes-eve.md)`. El estado sigue `en curso` hasta el cierre en producción.

- [ ] **Step 3: Regenerar y chequear**

Run: `npm run docs:sync` y después `npm run docs:check`
Expected: `docs/referencia/tools-del-agente.md` suma `asistente/brain`; `docs/referencia/evals.md` suma las cinco evals; `docs/referencia/migraciones.md` suma la migración. `docs:check` en verde. Si falla por una superficie sin página, se documenta en `agentes-eve.md`: no se agrega una exclusión en `docs/_meta/cobertura.ts` para ponerlo en verde.

- [ ] **Step 4: `/docs-wiki`**

Correr la skill `/docs-wiki` y dejarla en verde.

- [ ] **Step 5: Texto de despliegue**

> Nota 2026-10-13: el orden se corrigió en la revisión final. Va el código primero y la migración después, porque el código viejo mostraría el agente `asistente` (fuera de su catálogo) con una URL MCP que no existe. El texto de abajo ya lo refleja.

Este párrafo va al roadmap (Step 2) y al cuerpo del PR:

> **Antes de desplegar:** `npx supabase migration list` (`db push` aplica todas las pendientes: confirmar las ajenas), desplegar primero el código y recién después aplicar `20261021120000_asistente_agent`. Con el código nuevo y sin la fila, el Asistente existe y nadie lo tiene habilitado; con la migración primero, el código viejo (`lib/connect/connectables.ts`, `app/[tenant]/settings/page.tsx`) mostraría el agente `asistente` fuera de su catálogo, con una URL MCP que no existe. Orden corregido el 2026-10-13 en la revisión final (antes decía migración primero). **Después del deploy:** en `innovas`, abrir un hilo con Asistente, pedirle que liste sus herramientas (tienen que ser `brain_search`, `brain_read` y `brain_upsert`) y confirmar el `run` con `agent = 'asistente'`; abrir un hilo de outreach y confirmar que la firma aparece en la tarjeta del mail; en una empresa solo con brain, confirmar que `/<slug>` cae en el chat sin selector y que su brain no recibió páginas de canon; probar que una conversación de un agente abierta por la ruta del otro da 401, mirar el chat a 375 px, y entrar como `tenant_member` con una carpeta del brain restringida para confirmar que el Asistente no la ve. El chat no tiene tope de presupuesto: el gasto de modelos de una empresa solo con brain lo paga INNOV.AS hasta la 21.5; se apaga desde `/plataforma/<slug>`.

- [ ] **Step 6: Verificación final y commit**

Run: `npm run typecheck`, `npm test`, `npm run db:test`, `npm run docs:check`
Expected: todo en verde.

```bash
git add docs CLAUDE.md AGENTS.md
git commit -m "docs: agentes eve con el asistente, chat multiagente y despliegue de la 22.1"
```

- [ ] **Step 7: PR**

Con `/ship`. El cierre en producción (spec §13) lo corre una persona después del deploy y no forma parte de este plan: la etapa queda `en curso` hasta entonces.

---

## Cobertura de la spec

| Spec | Task |
|---|---|
| §3 Catálogo (`canon`, `mcp`, `asistente`, `chatAgents`, `agentsNeedCanon`, `needsSeed`, Conectar) | 4 |
| §4 Agente Asistente, §4.1 y §4.2 | 4 |
| §5 Código compartido y su verificación | 2 y 3 |
| §6.1 Quién entra (menú, aterrizaje) | 4 |
| §6.2 `page.tsx` | 6 |
| §6.3 `ChatClient` | 7 |
| §6.4 `actions.ts` | 6 |
| §6.5 El canal | 1 y 3 |
| §7 Base de datos | 5 |
| §9 Tests unitarios | 1, 4 y 6 |
| §9 Evals | 8 |
| §9 Navegador | 7 |
| §10 Documentación | 9 |
| §12 Riesgo "tool invisible en producción" | 9 (Step 5) |
| §13 Terminado cuando | Cierre en producción, fuera del plan |
