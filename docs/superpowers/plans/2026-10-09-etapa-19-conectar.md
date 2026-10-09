# Etapa 19: página "Conectar" y chequeo de agente habilitado en el canal MCP: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada persona vea en `/<slug>/conectar` qué puede conectar a Claude, ChatGPT, Claude Code, Codex o Cursor, con la URL de su empresa y los pasos copiables, y que el canal MCP del agente rechace un agente apagado.

**Architecture:** Dos funciones puras en `lib/connect/` arman la lista de conectables y las instrucciones por cliente. Una página de servidor lee `tenant_agents` y `tenant_connections` con la sesión del usuario y renderiza una tarjeta cliente por conectable. El canal MCP del agente suma una dependencia `agentEnabled` que se consulta después de resolver la membresía.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (`@supabase/ssr`), eve 0.67.2, shadcn (`components/ui`), Vitest en entorno `node` con `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-10-09-etapa-19-conectar-design.md`

## Global Constraints

- Sin migración y sin tabla nueva (spec C9). Si una tarea parece necesitar SQL, frenar y avisar.
- Español rioplatense en todo texto de UI y mensajes. Código e identificadores en inglés.
- Nada específico de un tenant en código: ningún slug, dominio ni nombre de cliente hardcodeado. `agentes.innov.as` no aparece en `lib/` ni en `app/`; las URLs salen de `publicSettings()`.
- Los tests son `tests/**/*.test.ts` (sin `.tsx`), entorno `node`. Los componentes se prueban con `createElement` y `renderToStaticMarkup`, como `tests/settings/ingreso-form.test.ts`.
- Los módulos que importa eve (`agents/**`, y lo que ellos importan de `lib/`) usan imports **relativos**, no el alias `@/`.
- Solo Claude Code lleva `tested: true`. Los otros cuatro clientes llevan `tested: false` y la etiqueta "Sin probar".
- Mensajes exactos del canal: "Ese agente no está habilitado para este cliente." y "No pude verificar tu acceso a ese cliente. Probá de nuevo."
- Después de cada tarea: `npm run typecheck` limpio. Antes de cada commit: `npm run lint:fix` y revertir con `git checkout --` cualquier archivo que biome haya tocado y que no sea de la tarea (hay cuatro archivos del repo que reformatea siempre).
- Identidad de git: `innovasbuild` / `matias@innov.as` (ya configurada en el repo). Prefijo de commit `feat:`, `fix:` o `docs:`. Cada commit termina con la línea `Co-Authored-By` vigente en la sesión que ejecuta.
- Rama: `feat/etapa-19-conectar`, creada desde `docs/plan-cierre-gap-plataforma` (ahí viven la spec y este plan).

## Review Focus

Casos que la spec implica y que conviene mirar con lupa. Cada uno tiene su test en la tarea indicada.

1. **Un nombre de agente raro en `tenant_agents.agent`** (espacios, mayúsculas, comillas). El identificador de los comandos sale saneado, la URL sale codificada y el JSON de Cursor sigue siendo válido. Tareas 1 y 2.
2. **`publicSettings()` tira porque faltan variables de entorno.** La página muestra el aviso de error, no un 500. Tarea 5.
3. **Empresa sin brain y sin agentes habilitados.** La página dice que todavía no hay nada habilitado y muestra igual la tarjeta de herramientas. Tarea 5.
4. **Fila de `tenant_agents` ausente** (no solo `enabled = false`). El canal rechaza igual. Tarea 3.
5. **El portapapeles no está disponible o la persona lo niega.** El botón dice "No se pudo copiar" y el campo sigue seleccionable. Tarea 4.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/connect/connectables.ts` (nuevo) | Función pura: de tenant, brain y agentes a la lista de conectables |
| `lib/connect/instructions.ts` (nuevo) | Función pura: pasos y snippet por cliente MCP |
| `lib/connect/copy.ts` (nuevo) | Copiar al portapapeles sin tirar |
| `lib/agents/agent-enabled.ts` (nuevo) | Lectura de `tenant_agents.enabled` con service role |
| `lib/agents/mcp-channel-auth.ts` (modifica) | Dependencia `agentEnabled` y parámetro `agent` |
| `agents/outreach/channels/mcp.ts` (modifica) | Pasa `"outreach"` al verificador |
| `lib/tenants/nav.ts` (nuevo) | Entradas del menú y filtro por rol, sacados del layout para poder probarlos |
| `app/[tenant]/layout.tsx` (modifica) | Usa `visibleNav` |
| `app/[tenant]/conectar/page.tsx` (nuevo) | Página de servidor |
| `app/[tenant]/conectar/connect-card.tsx` (nuevo) | Tarjeta cliente: URL, copiar, pestañas |
| `docs/brain-mcp-conexion.md`, `docs/agente-mcp-conexion.md`, `docs/01-roadmap-etapas.md` (modifica) | Docs alineados |

---

### Task 0: Rama de trabajo

- [ ] **Step 1: Crear la rama**

```bash
git checkout docs/plan-cierre-gap-plataforma
git checkout -b feat/etapa-19-conectar
```

- [ ] **Step 2: Confirmar el punto de partida**

Run: `npm test -- --reporter=dot 2>&1 | tail -5` y `npm run typecheck`
Expected: todos los tests en verde y typecheck sin errores. Si algo falla antes de tocar nada, frenar y avisar.

---

### Task 1: Lista de conectables

**Files:**
- Create: `lib/connect/connectables.ts`
- Test: `tests/connect/connectables.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `type Connectable`, `buildConnectables(input: { slug: string; publicUrl: string; hasBrain: boolean; enabledAgents: string[] }): Connectable[]`. Las variantes `brain` y `agent` llevan `id: string`, el identificador corto para comandos (`brain-<slug>`, `<agente>-<slug>`).

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/connect/connectables.test.ts
import { describe, expect, it } from "vitest";
import { buildConnectables } from "@/lib/connect/connectables";

const base = {
	slug: "acme",
	publicUrl: "https://app.test",
	hasBrain: true,
	enabledAgents: ["outreach"],
};

describe("buildConnectables", () => {
	it("con brain y un agente: brain, agente y herramientas, en ese orden", () => {
		const list = buildConnectables(base);

		expect(list.map((c) => c.kind)).toEqual(["brain", "agent", "tools"]);
		expect(list[0]).toMatchObject({
			kind: "brain",
			id: "brain-acme",
			url: "https://app.test/brain/acme/mcp",
		});
		expect(list[1]).toMatchObject({
			kind: "agent",
			agent: "outreach",
			id: "outreach-acme",
			name: "Agente de outreach",
			url: "https://app.test/eve/outreach/v1/mcp?tenant=acme",
		});
	});

	it("sin brain no hay tarjeta de brain", () => {
		const list = buildConnectables({ ...base, hasBrain: false });
		expect(list.map((c) => c.kind)).toEqual(["agent", "tools"]);
	});

	it("sin agentes ni brain queda solo la tarjeta de herramientas", () => {
		const list = buildConnectables({
			...base,
			hasBrain: false,
			enabledAgents: [],
		});
		expect(list.map((c) => c.kind)).toEqual(["tools"]);
	});

	it("la tarjeta de herramientas siempre está, sin URL y marcada como próxima", () => {
		const tools = buildConnectables(base).at(-1);
		expect(tools).toMatchObject({ kind: "tools", soon: true });
		expect(tools).not.toHaveProperty("url");
	});

	it("dos agentes salen en el orden recibido", () => {
		const list = buildConnectables({
			...base,
			enabledAgents: ["soporte", "outreach"],
		});
		expect(
			list.flatMap((c) => (c.kind === "agent" ? [c.agent] : [])),
		).toEqual(["soporte", "outreach"]);
	});

	it("un agente fuera del mapa usa su identificador y un texto genérico", () => {
		const [agent] = buildConnectables({
			...base,
			hasBrain: false,
			enabledAgents: ["soporte"],
		});
		expect(agent).toMatchObject({
			name: "soporte",
			description: "Agente de tu empresa.",
		});
	});

	it("la barra final de publicUrl no duplica barras", () => {
		const list = buildConnectables({
			...base,
			publicUrl: "https://app.test/",
		});
		expect(list[0]).toMatchObject({ url: "https://app.test/brain/acme/mcp" });
	});

	it("la URL del brain nunca lleva ?tenant", () => {
		const [brain] = buildConnectables(base);
		expect(brain.kind === "brain" && brain.url).not.toContain("?");
	});

	it("un nombre de agente raro: id saneado y URL codificada", () => {
		const [agent] = buildConnectables({
			...base,
			hasBrain: false,
			enabledAgents: ['Post Venta "2"'],
		});
		expect(agent).toMatchObject({
			kind: "agent",
			id: "post-venta-2-acme",
			url: "https://app.test/eve/Post%20Venta%20%222%22/v1/mcp?tenant=acme",
		});
	});
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run tests/connect/connectables.test.ts`
Expected: FAIL, no puede resolver `@/lib/connect/connectables`.

- [ ] **Step 3: Implementación mínima**

```ts
// lib/connect/connectables.ts
// Qué puede conectar una persona a su cliente MCP (spec etapa 19 §3.1).
// Función pura: la página le pasa lo que leyó de la base.

export type Connectable =
	| {
			kind: "brain";
			id: string;
			name: string;
			description: string;
			url: string;
	  }
	| {
			kind: "agent";
			agent: string;
			id: string;
			name: string;
			description: string;
			url: string;
	  }
	| { kind: "tools"; name: string; description: string; soon: true };

// Provisorio hasta el catálogo de agentes de la Etapa 22 (spec C5).
const AGENT_COPY: Record<string, { name: string; description: string }> = {
	outreach: {
		name: "Agente de outreach",
		description:
			"Investiga cuentas, redacta mensajes y arma la cola de envíos de tu empresa.",
	},
};

// Identificador para comandos de terminal y claves de JSON: sin espacios,
// comillas ni mayúsculas, venga lo que venga de tenant_agents.agent.
function commandId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function buildConnectables(input: {
	slug: string;
	publicUrl: string;
	hasBrain: boolean;
	enabledAgents: string[];
}): Connectable[] {
	const origin = input.publicUrl.replace(/\/+$/, "");
	const slug = encodeURIComponent(input.slug);
	const list: Connectable[] = [];

	if (input.hasBrain) {
		list.push({
			kind: "brain",
			id: `brain-${commandId(input.slug)}`,
			name: "Brain",
			description:
				"El conocimiento de tu empresa: buscar, leer y escribir páginas según tus permisos.",
			url: `${origin}/brain/${slug}/mcp`,
		});
	}

	for (const agent of input.enabledAgents) {
		const copy = AGENT_COPY[agent] ?? {
			name: agent,
			description: "Agente de tu empresa.",
		};
		list.push({
			kind: "agent",
			agent,
			id: `${commandId(agent)}-${commandId(input.slug)}`,
			name: copy.name,
			description: copy.description,
			url: `${origin}/eve/${encodeURIComponent(agent)}/v1/mcp?tenant=${slug}`,
		});
	}

	list.push({
		kind: "tools",
		name: "Herramientas de tu empresa",
		description:
			"Próximamente: las herramientas de tu empresa (CRM, búsqueda de contactos) desde tu propio Claude o ChatGPT.",
		soon: true,
	});

	return list;
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run tests/connect/connectables.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint:fix
git add lib/connect/connectables.ts tests/connect/connectables.test.ts
git commit -m "feat: lista de conectables por empresa para la página de conexión"
```

---

### Task 2: Instrucciones por cliente MCP

**Files:**
- Create: `lib/connect/instructions.ts`
- Test: `tests/connect/instructions.test.ts`

**Interfaces:**
- Consumes: nada (recibe `{ id, url }`, que la Tarea 1 produce en cada conectable).
- Produces: `CLIENTS` (tupla de claves), `type ClientKey`, `CLIENT_LABELS: Record<ClientKey, string>`, `interface Instructions { tested: boolean; steps: string[]; snippet?: { language: "bash" | "json"; code: string } }`, `instructionsFor(client: ClientKey, target: { id: string; url: string }): Instructions`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/connect/instructions.test.ts
import { describe, expect, it } from "vitest";
import {
	CLIENT_LABELS,
	CLIENTS,
	instructionsFor,
} from "@/lib/connect/instructions";

const target = {
	id: "outreach-acme",
	url: "https://app.test/eve/outreach/v1/mcp?tenant=acme",
};

describe("instructionsFor", () => {
	it("hay cinco clientes, cada uno con su rótulo", () => {
		expect(CLIENTS).toEqual([
			"claude-code",
			"claude-ai",
			"chatgpt",
			"codex",
			"cursor",
		]);
		for (const client of CLIENTS) expect(CLIENT_LABELS[client]).toBeTruthy();
	});

	it("solo Claude Code está probado", () => {
		expect(
			CLIENTS.filter((client) => instructionsFor(client, target).tested),
		).toEqual(["claude-code"]);
	});

	it("todos tienen al menos dos pasos", () => {
		for (const client of CLIENTS) {
			expect(instructionsFor(client, target).steps.length).toBeGreaterThan(1);
		}
	});

	it("Claude Code: comando con el id y la URL entre comillas", () => {
		expect(instructionsFor("claude-code", target).snippet).toEqual({
			language: "bash",
			code: 'claude mcp add --transport http outreach-acme "https://app.test/eve/outreach/v1/mcp?tenant=acme"',
		});
	});

	it("Codex: alta y login, con la URL entre comillas", () => {
		expect(instructionsFor("codex", target).snippet).toEqual({
			language: "bash",
			code: 'codex mcp add outreach-acme --url "https://app.test/eve/outreach/v1/mcp?tenant=acme"\ncodex mcp login outreach-acme',
		});
	});

	it("Cursor: JSON válido con el id como clave y la URL", () => {
		const snippet = instructionsFor("cursor", target).snippet;
		expect(snippet?.language).toBe("json");
		expect(JSON.parse(snippet?.code ?? "")).toEqual({
			mcpServers: { "outreach-acme": { url: target.url } },
		});
	});

	it("claude.ai y ChatGPT no llevan comando: la URL se pega a mano", () => {
		expect(instructionsFor("claude-ai", target).snippet).toBeUndefined();
		expect(instructionsFor("chatgpt", target).snippet).toBeUndefined();
	});

	it("una URL con comillas no rompe el JSON de Cursor", () => {
		const raro = { id: "x", url: 'https://app.test/eve/a%22b/v1/mcp?tenant="z"' };
		const snippet = instructionsFor("cursor", raro).snippet;
		expect(JSON.parse(snippet?.code ?? "").mcpServers.x.url).toBe(raro.url);
	});

	it("una URL con comillas o $ no se escapa del entrecomillado del comando", () => {
		const raro = { id: "x", url: 'https://app.test/mcp?tenant="$HOME`id`' };
		const code = instructionsFor("claude-code", raro).snippet?.code ?? "";
		expect(code).toContain('\\"');
		expect(code).toContain("\\$HOME");
		expect(code).toContain("\\`id\\`");
	});
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run tests/connect/instructions.test.ts`
Expected: FAIL, no puede resolver `@/lib/connect/instructions`.

- [ ] **Step 3: Implementación mínima**

```ts
// lib/connect/instructions.ts
// Pasos para conectar una URL de MCP desde cada cliente (spec etapa 19 §3.2).
// Los pasos salen de la documentación pública de cada cliente al 2026-10-09.
// `tested` dice si alguien lo probó contra esta plataforma en producción.

export const CLIENTS = [
	"claude-code",
	"claude-ai",
	"chatgpt",
	"codex",
	"cursor",
] as const;

export type ClientKey = (typeof CLIENTS)[number];

export const CLIENT_LABELS: Record<ClientKey, string> = {
	"claude-code": "Claude Code",
	"claude-ai": "claude.ai",
	chatgpt: "ChatGPT",
	codex: "Codex",
	cursor: "Cursor",
};

export interface Instructions {
	tested: boolean;
	steps: string[];
	snippet?: { language: "bash" | "json"; code: string };
}

// Dentro de comillas dobles, la shell todavía interpreta \ " $ y `.
function shellQuote(value: string): string {
	return `"${value.replace(/[\\"$`]/g, "\\$&")}"`;
}

const LOGIN =
	"Se abre el navegador: entrá con tu cuenta de la plataforma y aprobá el acceso.";

export function instructionsFor(
	client: ClientKey,
	target: { id: string; url: string },
): Instructions {
	const { id, url } = target;

	switch (client) {
		case "claude-code":
			return {
				tested: true,
				steps: [
					"Corré este comando en tu terminal.",
					`Dentro de Claude Code, escribí /mcp, elegí ${id} y autenticá.`,
					LOGIN,
				],
				snippet: {
					language: "bash",
					code: `claude mcp add --transport http ${id} ${shellQuote(url)}`,
				},
			};
		case "claude-ai":
			return {
				tested: false,
				steps: [
					"Abrí Configuración y entrá a Conectores.",
					"Elegí Agregar conector personalizado y pegá la URL de arriba.",
					"Guardá y apretá Conectar.",
					LOGIN,
					"En planes Team y Enterprise, primero lo agrega un dueño de la organización y después cada persona se conecta.",
				],
			};
		case "chatgpt":
			return {
				tested: false,
				steps: [
					"Abrí Configuración y entrá a Conectores (puede figurar como Apps).",
					"En Ajustes avanzados, activá el Modo desarrollador.",
					"Volvé a Conectores, elegí Crear y pegá la URL de arriba.",
					"En autenticación elegí OAuth, confirmá que confiás en la aplicación y creala.",
					LOGIN,
					"Hace falta un plan con Modo desarrollador. En un espacio de trabajo, lo tiene que habilitar un administrador.",
				],
			};
		case "codex":
			return {
				tested: false,
				steps: ["Corré estos dos comandos en tu terminal.", LOGIN],
				snippet: {
					language: "bash",
					code: `codex mcp add ${id} --url ${shellQuote(url)}\ncodex mcp login ${id}`,
				},
			};
		case "cursor":
			return {
				tested: false,
				steps: [
					"Agregá esto a ~/.cursor/mcp.json (o a .cursor/mcp.json del proyecto).",
					"Al primer uso, Cursor abre el navegador: entrá con tu cuenta de la plataforma y aprobá el acceso.",
					"Abrí un chat nuevo del agente para que vea las herramientas.",
				],
				snippet: {
					language: "json",
					code: JSON.stringify({ mcpServers: { [id]: { url } } }, null, 2),
				},
			};
	}
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run tests/connect/instructions.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint:fix
git add lib/connect/instructions.ts tests/connect/instructions.test.ts
git commit -m "feat: instrucciones de conexión por cliente MCP"
```

---

### Task 3: El canal MCP del agente exige el agente habilitado

**Files:**
- Create: `lib/agents/agent-enabled.ts`
- Modify: `lib/agents/mcp-channel-auth.ts` (interfaz `McpChannelAuthDeps`, `resolveMcpChannelAuth` después del guard de `own`, `verifyMcpChannelToken`)
- Modify: `agents/outreach/channels/mcp.ts`
- Test: `tests/agents/mcp-channel-auth.test.ts` (modifica), `tests/agents/agent-enabled.test.ts` (nuevo)

**Interfaces:**
- Consumes: `createAdminClient` de `lib/supabase/admin`.
- Produces: `loadAgentEnabled(tenantId: string, agent: string): Promise<boolean>`; `McpChannelAuthDeps.agentEnabled: (tenantId: string) => Promise<boolean>`; `verifyMcpChannelToken(request: Request, agent: string)`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/agents/mcp-channel-auth.test.ts`, agregar `agentEnabled` al helper `deps()` (línea ~28, junto a `platformOwnerTenantId`):

```ts
		// tenant-x es el dueño de la plataforma en estas pruebas.
		platformOwnerTenantId: async () => "tenant-x",
		agentEnabled: async () => true,
		...overrides,
```

Y agregar este bloque antes del `});` final del `describe("resolveMcpChannelAuth", ...)`:

```ts
	describe("el agente tiene que estar habilitado para el cliente (spec etapa 19 §5)", () => {
		const APAGADO = "Ese agente no está habilitado para este cliente.";

		it("apagado: un miembro no entra y el mensaje dice por qué", async () => {
			expect(
				await resolveMcpChannelAuth(
					request("ana", "a"),
					deps({ agentEnabled: async () => false }),
				),
			).toEqual({ ok: false, kind: "forbidden", message: APAGADO });
		});

		it("apagado: tampoco entra un administrador de plataforma", async () => {
			expect(
				await resolveMcpChannelAuth(
					request("root", "a"),
					deps({ agentEnabled: async () => false }),
				),
			).toEqual({ ok: false, kind: "forbidden", message: APAGADO });
		});

		it("se consulta con el id del tenant de la URL", async () => {
			const agentEnabled = vi.fn(async () => true);
			await resolveMcpChannelAuth(request("ana", "a"), deps({ agentEnabled }));
			expect(agentEnabled).toHaveBeenCalledWith("tenant-a");
		});

		it("sin membresía no se consulta: el mensaje no revela si el agente está prendido", async () => {
			const agentEnabled = vi.fn(async () => false);
			const sinMembresia = deps({
				agentEnabled,
				tenantBySlug: async (slug) =>
					slug === "b" ? { id: "tenant-b", active: true } : null,
			});

			const result = await resolveMcpChannelAuth(
				request("ana", "b"),
				sinMembresia,
			);

			expect(result).toMatchObject({
				ok: false,
				message: "No tenés acceso a ese cliente.",
			});
			expect(agentEnabled).not.toHaveBeenCalled();
		});

		it("si la consulta falla, no deja pasar ni filtra el motivo", async () => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			const result = await resolveMcpChannelAuth(
				request("ana", "a"),
				deps({
					agentEnabled: async () => {
						throw new Error("conexión a postgres perdida");
					},
				}),
			);

			expect(result).toEqual({
				ok: false,
				kind: "forbidden",
				message: "No pude verificar tu acceso a ese cliente. Probá de nuevo.",
			});
			expect(JSON.stringify(result)).not.toContain("postgres");
			error.mockRestore();
		});
	});
```

Crear `tests/agents/agent-enabled.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	result: { data: { enabled: boolean } | null; error: { message: string } | null };
	calls: unknown[][];
} = { result: { data: null, error: null }, calls: [] };

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: (table: string) => {
			state.calls.push(["from", table]);
			const query = {
				select: (columns: string) => {
					state.calls.push(["select", columns]);
					return query;
				},
				eq: (column: string, value: unknown) => {
					state.calls.push(["eq", column, value]);
					return query;
				},
				maybeSingle: async () => state.result,
			};
			return query;
		},
	}),
}));

const { loadAgentEnabled } = await import("@/lib/agents/agent-enabled");

describe("loadAgentEnabled", () => {
	beforeEach(() => {
		state.calls = [];
		state.result = { data: null, error: null };
	});

	it("prendido devuelve true y filtra por tenant y agente", async () => {
		state.result = { data: { enabled: true }, error: null };

		expect(await loadAgentEnabled("tenant-a", "outreach")).toBe(true);
		expect(state.calls).toEqual([
			["from", "tenant_agents"],
			["select", "enabled"],
			["eq", "tenant_id", "tenant-a"],
			["eq", "agent", "outreach"],
		]);
	});

	it("apagado devuelve false", async () => {
		state.result = { data: { enabled: false }, error: null };
		expect(await loadAgentEnabled("tenant-a", "outreach")).toBe(false);
	});

	it("sin fila devuelve false: un agente no dado de alta no está habilitado", async () => {
		expect(await loadAgentEnabled("tenant-a", "outreach")).toBe(false);
	});

	it("un error de la base tira: quien llama decide fallar cerrado", async () => {
		state.result = { data: null, error: { message: "timeout" } };
		await expect(loadAgentEnabled("tenant-a", "outreach")).rejects.toThrow(
			"timeout",
		);
	});
});
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run tests/agents/mcp-channel-auth.test.ts tests/agents/agent-enabled.test.ts`
Expected: FAIL. `agent-enabled.test.ts` no resuelve el módulo; en `mcp-channel-auth.test.ts` los casos de "apagado" reciben `ok: true`.

- [ ] **Step 3: Implementar**

Crear `lib/agents/agent-enabled.ts`:

```ts
// ¿Este agente está habilitado para este cliente? Mismo criterio que el canal
// del dashboard (channel-context.ts): sin fila en tenant_agents, o con
// enabled en false, no. Import relativo: lo importa un canal de eve.
import { createAdminClient } from "../supabase/admin";

export async function loadAgentEnabled(
	tenantId: string,
	agent: string,
): Promise<boolean> {
	const { data, error } = await createAdminClient()
		.from("tenant_agents")
		.select("enabled")
		.eq("tenant_id", tenantId)
		.eq("agent", agent)
		.maybeSingle();
	if (error) throw new Error(`No pude leer el agente: ${error.message}`);
	return data?.enabled === true;
}
```

En `lib/agents/mcp-channel-auth.ts`:

1. Sumar el import, debajo del import de `../auth/oauth-principal`:

```ts
import { loadAgentEnabled } from "./agent-enabled";
```

2. Sumar a `McpChannelAuthDeps`, después de `platformOwnerTenantId`:

```ts
	// ¿El agente de este canal está habilitado para ese tenant? Se pregunta
	// recién cuando la persona ya probó que pertenece al tenant.
	agentEnabled: (tenantId: string) => Promise<boolean>;
```

3. En `resolveMcpChannelAuth`, entre el guard `if (!platformAdmin && !own) { ... }` y el comentario "Mismo mapeo que el brain", insertar:

```ts
	// Después del guard de membresía a propósito: quien no pertenece al tenant
	// nunca llega acá, así que este mensaje no le dice nada a un extraño.
	let enabled: boolean;
	try {
		enabled = await deps.agentEnabled(tenant.id);
	} catch (error) {
		console.error("canal mcp: no pude leer si el agente está habilitado", error);
		return deny(
			"forbidden",
			"No pude verificar tu acceso a ese cliente. Probá de nuevo.",
		);
	}
	if (!enabled) {
		return deny("forbidden", "Ese agente no está habilitado para este cliente.");
	}
```

4. Reemplazar `verifyMcpChannelToken` completo por:

```ts
export async function verifyMcpChannelToken(
	request: Request,
	agent: string,
): Promise<SessionAuthContext> {
	if (!cachedVerify) cachedVerify = createOAuthClaimsVerifier();
	const result = await resolveMcpChannelAuth(request, {
		verify: cachedVerify,
		tenantBySlug: loadTenantBySlug,
		membershipsOf: loadMemberships,
		platformOwnerTenantId: loadPlatformOwnerTenantId,
		agentEnabled: (tenantId) => loadAgentEnabled(tenantId, agent),
	});
	if (result.ok) return result.sessionAuth;
	if (result.kind === "unauthenticated") {
		throw new UnauthenticatedError({ message: result.message });
	}
	throw new ForbiddenError({ message: result.message });
}
```

En `agents/outreach/channels/mcp.ts`, reemplazar el `export default` por:

```ts
// El agente de este canal es el de esta carpeta. Función con nombre a nivel
// de módulo, igual que el `verifyToken` de la guía de eve (channels/mcp.mdx).
function verifyOutreachToken(request: Request) {
	return verifyMcpChannelToken(request, "outreach");
}

export default mcpChannel({
	auth: oauthResource(verifyOutreachToken, {
		issuer,
		resource,
		// El servidor OAuth de Supabase solo publica openid, profile, email y
		// phone: un scope propio podría hacer que rechace el /oauth/authorize.
		// "openid email" es el que la Etapa 11 probó de punta a punta (V3/V7).
		scopes: ["openid", "email"],
	}),
});
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run tests/agents/mcp-channel-auth.test.ts tests/agents/agent-enabled.test.ts && npm run typecheck`
Expected: PASS en los dos archivos (los casos previos siguen verdes porque `deps()` devuelve `true`) y typecheck limpio.

- [ ] **Step 5: Verificar que eve sigue compilando el canal**

Run: `npm run build 2>&1 | tail -20`
Expected: build sin errores. Si eve se queja del canal, frenar: es el riesgo conocido de cómo eve compila módulos de autor.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add lib/agents/agent-enabled.ts lib/agents/mcp-channel-auth.ts agents/outreach/channels/mcp.ts tests/agents/mcp-channel-auth.test.ts tests/agents/agent-enabled.test.ts
git commit -m "fix: el canal MCP del agente rechaza un agente que no está habilitado para el cliente"
```

---

### Task 4: Tarjeta de conexión

**Files:**
- Create: `lib/connect/copy.ts`
- Create: `app/[tenant]/conectar/connect-card.tsx`
- Test: `tests/connect/copy.test.ts`, `tests/connect/connect-card.test.ts`

**Interfaces:**
- Consumes: `type Connectable` (Tarea 1); `CLIENTS`, `CLIENT_LABELS`, `instructionsFor` (Tarea 2).
- Produces: `copyText(text: string, clipboard?: { writeText(text: string): Promise<void> }): Promise<boolean>`; componente `ConnectCard({ connectable }: { connectable: Connectable })`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/connect/copy.test.ts
import { describe, expect, it, vi } from "vitest";
import { copyText } from "@/lib/connect/copy";

describe("copyText", () => {
	it("copia y devuelve true", async () => {
		const writeText = vi.fn(async () => {});
		expect(await copyText("hola", { writeText })).toBe(true);
		expect(writeText).toHaveBeenCalledWith("hola");
	});

	it("si el navegador lo niega devuelve false, sin tirar", async () => {
		const writeText = async () => {
			throw new Error("NotAllowedError");
		};
		expect(await copyText("hola", { writeText })).toBe(false);
	});

	it("sin portapapeles disponible devuelve false", async () => {
		expect(await copyText("hola", undefined)).toBe(false);
	});
});
```

```ts
// tests/connect/connect-card.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Connectable } from "@/lib/connect/connectables";

const { ConnectCard } = await import("@/app/[tenant]/conectar/connect-card");

const render = (connectable: Connectable) =>
	renderToStaticMarkup(createElement(ConnectCard, { connectable }));

const agent: Connectable = {
	kind: "agent",
	agent: "outreach",
	id: "outreach-acme",
	name: "Agente de outreach",
	description: "Investiga cuentas.",
	url: "https://app.test/eve/outreach/v1/mcp?tenant=acme",
};

describe("ConnectCard", () => {
	it("muestra nombre, descripción y la URL en un campo de solo lectura", () => {
		const html = render(agent);

		expect(html).toContain("Agente de outreach");
		expect(html).toContain("Investiga cuentas.");
		// renderToStaticMarkup escapa & pero no ? ni =.
		expect(html).toMatch(
			/<input[^>]*readOnly=""[^>]*value="https:\/\/app\.test\/eve\/outreach\/v1\/mcp\?tenant=acme"/i,
		);
	});

	it("tiene una pestaña por cliente", () => {
		const html = render(agent);
		for (const label of ["Claude Code", "claude.ai", "ChatGPT", "Codex", "Cursor"]) {
			expect(html).toContain(label);
		}
	});

	it("cuatro clientes llevan la marca Sin probar; Claude Code no", () => {
		const html = render(agent);
		expect(html.match(/Sin probar/g)?.length).toBe(4);
	});

	it("la pestaña inicial es Claude Code, con su comando", () => {
		expect(render(agent)).toContain("claude mcp add --transport http outreach-acme");
	});

	it("la tarjeta de herramientas no tiene URL ni pestañas", () => {
		const html = render({
			kind: "tools",
			name: "Herramientas de tu empresa",
			description: "Próximamente: las herramientas de tu empresa.",
			soon: true,
		});

		expect(html).toContain("Herramientas de tu empresa");
		expect(html).toContain("Próximamente");
		expect(html).not.toContain("<input");
		expect(html).not.toContain("Claude Code");
	});
});
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run tests/connect/copy.test.ts tests/connect/connect-card.test.ts`
Expected: FAIL, no resuelven `@/lib/connect/copy` ni `connect-card`.

- [ ] **Step 3: Implementar**

```ts
// lib/connect/copy.ts
// Copiar al portapapeles sin tirar: el navegador puede negarlo o no tenerlo
// (página sin HTTPS, permiso denegado). Quien llama muestra el resultado.
export async function copyText(
	text: string,
	clipboard: { writeText(text: string): Promise<void> } | undefined,
): Promise<boolean> {
	if (!clipboard) return false;
	try {
		await clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
```

```tsx
// app/[tenant]/conectar/connect-card.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Connectable } from "@/lib/connect/connectables";
import { copyText } from "@/lib/connect/copy";
import {
	CLIENT_LABELS,
	CLIENTS,
	instructionsFor,
} from "@/lib/connect/instructions";

function CopyButton({ text, label }: { text: string; label: string }) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

	async function copy() {
		const ok = await copyText(
			text,
			typeof navigator === "undefined" ? undefined : navigator.clipboard,
		);
		setState(ok ? "copied" : "failed");
		setTimeout(() => setState("idle"), 2000);
	}

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={copy}
			aria-label={label}
		>
			{state === "copied"
				? "Copiado"
				: state === "failed"
					? "No se pudo copiar"
					: "Copiar"}
		</Button>
	);
}

export function ConnectCard({ connectable }: { connectable: Connectable }) {
	if (connectable.kind === "tools") {
		return (
			<Card className="opacity-70">
				<CardHeader>
					<CardTitle>{connectable.name}</CardTitle>
					<CardDescription>{connectable.description}</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const { id, name, description, url } = connectable;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{name}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-2">
					<input
						readOnly
						value={url}
						aria-label={`URL de ${name}`}
						onFocus={(event) => event.currentTarget.select()}
						className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-1.5 font-mono text-xs"
					/>
					<CopyButton text={url} label={`Copiar la URL de ${name}`} />
				</div>

				<Tabs defaultValue={CLIENTS[0]}>
					<div className="overflow-x-auto">
						<TabsList>
							{CLIENTS.map((client) => (
								<TabsTrigger key={client} value={client}>
									{CLIENT_LABELS[client]}
									{instructionsFor(client, { id, url }).tested ? null : (
										<span className="ml-1 rounded-full border px-1.5 text-[10px] text-muted-foreground">
											Sin probar
										</span>
									)}
								</TabsTrigger>
							))}
						</TabsList>
					</div>
					{CLIENTS.map((client) => {
						const { steps, snippet } = instructionsFor(client, { id, url });
						return (
							<TabsContent key={client} value={client} className="space-y-3">
								<ol className="list-decimal space-y-1 pl-5">
									{steps.map((step) => (
										<li key={step}>{step}</li>
									))}
								</ol>
								{snippet ? (
									<div className="space-y-2">
										<pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
											<code>{snippet.code}</code>
										</pre>
										<CopyButton
											text={snippet.code}
											label={`Copiar el ${snippet.language === "json" ? "JSON" : "comando"} de ${CLIENT_LABELS[client]}`}
										/>
									</div>
								) : null}
							</TabsContent>
						);
					})}
				</Tabs>
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `npx vitest run tests/connect/copy.test.ts tests/connect/connect-card.test.ts`
Expected: PASS, 3 y 5 tests. Si el test de la URL falla por el orden de atributos del `<input>` en el HTML, ajustar **el regex del test** para que no dependa del orden (dos `expect` separados, uno por atributo), no el componente.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint:fix
git add lib/connect/copy.ts "app/[tenant]/conectar/connect-card.tsx" tests/connect/copy.test.ts tests/connect/connect-card.test.ts
git commit -m "feat: tarjeta de conexión con URL copiable y pestañas por cliente MCP"
```

---

### Task 5: Página `/[tenant]/conectar` y entrada en el menú

**Files:**
- Create: `lib/tenants/nav.ts`
- Create: `app/[tenant]/conectar/page.tsx`
- Modify: `app/[tenant]/layout.tsx` (saca `NavLink`, `NavEntry` y `NAV`; usa `visibleNav`)
- Test: `tests/tenants/nav.test.ts`, `tests/connect/conectar-page.test.ts`

**Interfaces:**
- Consumes: `buildConnectables` (Tarea 1), `ConnectCard` (Tarea 4), `resolveTenantAccess` y `type TenantRole` de `@/lib/tenants/resolve`, `createServerSupabase` de `@/lib/supabase/server`, `publicSettings` de `@/lib/brain/adapters/mcp-production`.
- Produces: `type NavLink`, `type NavEntry`, `NAV`, `visibleNav(role: TenantRole): NavEntry[]`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/tenants/nav.test.ts
import { describe, expect, it } from "vitest";
import { visibleNav } from "@/lib/tenants/nav";

const labels = (role: Parameters<typeof visibleNav>[0]) =>
	visibleNav(role).map((entry) => entry.label);

describe("visibleNav", () => {
	it("un miembro ve Conectar y no ve Configuración", () => {
		expect(labels("tenant_member")).toEqual([
			"Chat",
			"Outreach",
			"Brain",
			"Métricas",
			"Conectar",
		]);
	});

	it("un administrador ve además Configuración, al final", () => {
		expect(labels("tenant_admin")).toEqual([
			"Chat",
			"Outreach",
			"Brain",
			"Métricas",
			"Conectar",
			"Configuración",
		]);
		expect(labels("platform_admin")).toEqual(labels("tenant_admin"));
	});

	it("Conectar apunta a /conectar", () => {
		expect(visibleNav("tenant_member")).toContainEqual({
			href: "/conectar",
			label: "Conectar",
		});
	});
});
```

```ts
// tests/connect/conectar-page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };

const state: {
	tenant: unknown;
	agents: Result;
	brain: Result;
	settings: () => { publicUrl: string; issuer: string };
} = {
	tenant: null,
	agents: { data: [], error: null },
	brain: { data: [], error: null },
	settings: () => ({ publicUrl: "https://app.test", issuer: "https://x/auth/v1" }),
};

// Consulta encadenable que resuelve al hacer await, como la de supabase-js.
function query(result: () => Result) {
	const q = {
		select: () => q,
		eq: () => q,
		order: () => q,
		limit: () => q,
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) =>
			Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.tenant,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) =>
			query(() => (table === "tenant_agents" ? state.agents : state.brain)),
	}),
}));
vi.mock("@/lib/brain/adapters/mcp-production", () => ({
	publicSettings: () => state.settings(),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: ConectarPage } = await import(
	"@/app/[tenant]/conectar/page"
);

const tenant = (role: string) => ({
	id: "tenant-a",
	slug: "acme",
	displayName: "Acme",
	role,
	userId: "u1",
	defaultModel: "m",
	allowedModels: ["m"],
	brand: {},
});

const render = async () =>
	renderToStaticMarkup(
		await ConectarPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

describe("página Conectar", () => {
	beforeEach(() => {
		state.tenant = tenant("tenant_member");
		state.agents = { data: [{ agent: "outreach" }], error: null };
		state.brain = { data: [{ id: "c1" }], error: null };
		state.settings = () => ({
			publicUrl: "https://app.test",
			issuer: "https://x/auth/v1",
		});
	});

	it("sin acceso al tenant da 404", async () => {
		state.tenant = null;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("muestra el brain y el agente con las URLs de la empresa", async () => {
		const html = await render();

		expect(html).toContain("https://app.test/brain/acme/mcp");
		expect(html).toContain("https://app.test/eve/outreach/v1/mcp?tenant=acme");
		expect(html).toContain("Agente de outreach");
		expect(html).toContain("Herramientas de tu empresa");
	});

	it("un miembro y un administrador ven lo mismo", async () => {
		const comoMiembro = await render();
		state.tenant = tenant("tenant_admin");
		expect(await render()).toBe(comoMiembro);
	});

	it("un agente que no vino habilitado no aparece", async () => {
		state.agents = { data: [], error: null };
		const html = await render();

		expect(html).not.toContain("Agente de outreach");
		expect(html).toContain("https://app.test/brain/acme/mcp");
	});

	it("sin brain no hay tarjeta de brain", async () => {
		state.brain = { data: [], error: null };
		const html = await render();

		expect(html).not.toContain("/brain/acme/mcp");
		expect(html).toContain("Agente de outreach");
	});

	it("sin brain ni agentes avisa que no hay nada habilitado y deja la tarjeta de herramientas", async () => {
		state.agents = { data: [], error: null };
		state.brain = { data: [], error: null };
		const html = await render();

		expect(html).toContain("Tu empresa todavía no tiene conexiones habilitadas.");
		expect(html).toContain("Herramientas de tu empresa");
	});

	it("si falla la lectura de agentes muestra el aviso y ninguna tarjeta", async () => {
		state.agents = { data: null, error: { message: "timeout" } };
		const html = await render();

		expect(html).toContain("No se pudieron leer tus conexiones. Recargá la página.");
		expect(html).not.toContain("/brain/acme/mcp");
		expect(html).not.toContain("timeout");
	});

	it("si falla la lectura del brain muestra el aviso y ninguna tarjeta", async () => {
		state.brain = { data: null, error: { message: "timeout" } };
		const html = await render();

		expect(html).toContain("No se pudieron leer tus conexiones. Recargá la página.");
		expect(html).not.toContain("Agente de outreach");
	});

	it("si falta la URL pública muestra el aviso, no un error del servidor", async () => {
		state.settings = () => {
			throw new Error("faltan PUBLIC_APP_URL");
		};
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const html = await render();

		expect(html).toContain("No se pudieron leer tus conexiones. Recargá la página.");
		expect(html).not.toContain("PUBLIC_APP_URL");
		error.mockRestore();
	});
});
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run tests/tenants/nav.test.ts tests/connect/conectar-page.test.ts`
Expected: FAIL, no resuelven `@/lib/tenants/nav` ni la página.

- [ ] **Step 3: Implementar el menú**

```ts
// lib/tenants/nav.ts
// Entradas del menú del tenant y qué ve cada rol. Vive fuera del layout para
// poder probarlo sin renderizar la página.
import type { TenantRole } from "./resolve";

export type NavLink = { href: string; label: string; adminOnly?: boolean };
// Una entrada con `items` es un desplegable: agrupa destinos de un mismo
// dominio para que la tira no ponga todo al mismo nivel.
export type NavEntry = NavLink | { label: string; items: NavLink[] };

export const NAV: NavEntry[] = [
	{ href: "/chat", label: "Chat" },
	{
		label: "Outreach",
		items: [
			{ href: "/cola", label: "Cola" },
			{ href: "/pipeline", label: "Pipeline" },
			{ href: "/contactos", label: "Contactos" },
			{ href: "/cuentas", label: "Cuentas" },
			{ href: "/focos", label: "Focos" },
		],
	},
	{ href: "/brain", label: "Brain" },
	{ href: "/metricas", label: "Métricas" },
	{ href: "/conectar", label: "Conectar" },
	// /settings hace notFound() para tenant_member: el link no se muestra,
	// no tiene sentido ofrecer una ruta que va a 404.
	{ href: "/settings", label: "Configuración", adminOnly: true },
];

export function visibleNav(role: TenantRole): NavEntry[] {
	return NAV.filter(
		(item) => "items" in item || !item.adminOnly || role !== "tenant_member",
	);
}
```

`lib/tenants/resolve.ts` importa `createServerSupabase`; como acá el import es solo de tipo (`import type`), no arrastra código de servidor.

En `app/[tenant]/layout.tsx`:

1. Borrar las definiciones de `NavLink`, `NavEntry` y `NAV` (desde `type NavLink = ...` hasta el `];` que cierra `NAV`, comentarios incluidos).
2. Sumar el import, en orden alfabético con los otros `@/lib/tenants/*`:

```ts
import { visibleNav } from "@/lib/tenants/nav";
```

3. Reemplazar

```tsx
						{NAV.filter(
							(item) =>
								"items" in item ||
								!item.adminOnly ||
								tenant.role !== "tenant_member",
						).map((item) =>
```

por

```tsx
						{visibleNav(tenant.role).map((item) =>
```

- [ ] **Step 4: Implementar la página**

```tsx
// app/[tenant]/conectar/page.tsx
import { notFound } from "next/navigation";
import { publicSettings } from "@/lib/brain/adapters/mcp-production";
import { buildConnectables, type Connectable } from "@/lib/connect/connectables";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { ConnectCard } from "./connect-card";

// Lo que la empresa le habilitó a esta persona para conectar a su cliente MCP
// (spec etapa 19 §4). Lee con la sesión del usuario: la RLS de tenant_agents
// y tenant_connections ya deja leer a cualquier miembro. Devuelve null si
// algo falla: una lista vacía por un error parecería "no tenés nada".
async function loadConnectables(
	tenantId: string,
	slug: string,
): Promise<Connectable[] | null> {
	try {
		const supabase = await createServerSupabase();
		const [agents, brain] = await Promise.all([
			supabase
				.from("tenant_agents")
				.select("agent")
				.eq("tenant_id", tenantId)
				.eq("enabled", true)
				.order("agent"),
			supabase
				.from("tenant_connections")
				.select("id")
				.eq("tenant_id", tenantId)
				.eq("capability", "brain")
				.eq("enabled", true)
				.limit(1),
		]);
		if (agents.error || brain.error) return null;

		return buildConnectables({
			slug,
			publicUrl: publicSettings().publicUrl,
			hasBrain: (brain.data ?? []).length > 0,
			enabledAgents: (agents.data ?? []).map((row) => row.agent as string),
		});
	} catch (error) {
		console.error("conectar: no pude armar las conexiones", error);
		return null;
	}
}

export default async function ConectarPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();

	const connectables = await loadConnectables(tenant.id, tenant.slug);
	const nothingEnabled =
		connectables?.every((connectable) => connectable.kind === "tools") ?? false;

	return (
		<div className="max-w-3xl space-y-6">
			<header className="space-y-2">
				<h1 className="text-3xl leading-tight">Conectá tus herramientas</h1>
				<p className="text-muted-foreground text-sm">
					Estas son las conexiones que tu empresa te habilitó. Al conectar vas
					a entrar con tu cuenta de la plataforma y vas a ver solo lo que tu
					cuenta tiene permitido.
				</p>
			</header>

			{connectables === null ? (
				<p className="text-muted-foreground text-sm">
					No se pudieron leer tus conexiones. Recargá la página.
				</p>
			) : (
				<>
					{nothingEnabled ? (
						<p className="text-muted-foreground text-sm">
							Tu empresa todavía no tiene conexiones habilitadas.
						</p>
					) : null}
					{connectables.map((connectable) => (
						<ConnectCard
							key={
								connectable.kind === "tools" ? "tools" : connectable.id
							}
							connectable={connectable}
						/>
					))}
				</>
			)}
		</div>
	);
}
```

- [ ] **Step 5: Correr los tests y ver que pasan**

Run: `npx vitest run tests/tenants/nav.test.ts tests/connect/conectar-page.test.ts && npm run typecheck`
Expected: PASS, 3 y 9 tests, typecheck limpio.

- [ ] **Step 6: Correr la suite completa**

Run: `npm test -- --reporter=dot 2>&1 | tail -8`
Expected: todo en verde. El layout no tenía tests propios; si algún test que renderiza el layout falla, es por el import nuevo y hay que mirarlo.

- [ ] **Step 7: Verificar en el navegador contra la base local**

Con Docker abierto y `npm run db:start` corriendo, levantar el dev server con `preview_start` (no con Bash) y abrir `/<slug-del-seed>/conectar` con el login sembrado.
Expected: las tarjetas con sus URLs, las cinco pestañas, "Copiar" cambia a "Copiado", y a 375 px no hay scroll horizontal de la página. Probar modo oscuro. Si no hay Docker o login sembrado en el entorno, **decirlo en el resumen** y dejarlo anotado para el anexo A de la spec; no darlo por verificado.

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add lib/tenants/nav.ts "app/[tenant]/layout.tsx" "app/[tenant]/conectar/page.tsx" tests/tenants/nav.test.ts tests/connect/conectar-page.test.ts
git commit -m "feat: página Conectar con las conexiones de cada empresa y su entrada en el menú"
```

---

### Task 6: Docs alineados con la página

**Files:**
- Modify: `docs/brain-mcp-conexion.md`
- Modify: `docs/agente-mcp-conexion.md`
- Modify: `docs/01-roadmap-etapas.md` (Etapa 19)

**Interfaces:**
- Consumes: nada. Produces: nada.

- [ ] **Step 1: Corregir `docs/brain-mcp-conexion.md`**

Reemplazar la línea

```
Entrás con tu cuenta de la plataforma. Si sos administrador del cliente podés leer y escribir; si no, solo leer.
```

por

```
Entrás con tu cuenta de la plataforma. Qué podés leer y dónde podés escribir lo deciden los permisos del brain por carpeta y por página: los administradores del cliente pueden todo; el resto, lo que cada carpeta o página le dé.

Las instrucciones por cliente, con la URL de tu empresa ya puesta, están en la plataforma: menú **Conectar** (`/<cliente>/conectar`). Este archivo queda como referencia.
```

Y en la sección "Qué podés hacer", reemplazar el ítem de `brain_upsert` por

```
- `brain_upsert`: crear o actualizar una página. Hace falta nivel editor sobre esa carpeta o página; sin eso responde que no tenés permiso. Para actualizar, primero leela y pasá su revisión; si alguien la cambió en el medio, vas a recibir un conflicto y tenés que volver a leerla.

Las tres tools aparecen siempre en la lista. Una página que no podés ver no aparece en la búsqueda y responde "no encontrada" al leerla.
```

- [ ] **Step 2: Corregir `docs/agente-mcp-conexion.md`**

Después del párrafo "Entrás con tu cuenta de la plataforma — la misma que usás para el brain o el dashboard.", agregar:

```
El agente tiene que estar habilitado para tu empresa. Las instrucciones por cliente, con la URL de tu empresa ya puesta, están en la plataforma: menú **Conectar** (`/<cliente>/conectar`). Este archivo queda como referencia.
```

Y en "Si algo falla", agregar al final de la lista:

```
- **403 "Ese agente no está habilitado para este cliente":** el agente está apagado para tu empresa. Pedile a un administrador de la plataforma que lo habilite.
```

- [ ] **Step 3: Actualizar la Etapa 19 del roadmap**

En `docs/01-roadmap-etapas.md`, dentro de "## Etapa 19":

1. Cambiar la línea `**Spec/Plan:**` por:

```
**Spec/Plan:** `docs/superpowers/specs/2026-10-09-etapa-19-conectar-design.md` · `docs/superpowers/plans/2026-10-09-etapa-19-conectar.md`
```

2. Tildar (`- [x]`) estas cuatro casillas: la de la página `/<slug>/conectar`, la de las instrucciones por cliente MCP, la de corregir los dos markdown y la del canal MCP que chequea `tenant_agents.enabled`.
3. Dejar sin tildar la de probar claude.ai y ChatGPT y la de verificación en producción, y agregarles al final: ` Lo corre una persona: anexo A de la spec.`

- [ ] **Step 4: Confirmar que no quedó la afirmación vieja**

Run: `grep -n "solo leer\|solo administradores" docs/brain-mcp-conexion.md docs/agente-mcp-conexion.md`
Expected: sin resultados.

- [ ] **Step 5: Commit**

```bash
git add docs/brain-mcp-conexion.md docs/agente-mcp-conexion.md docs/01-roadmap-etapas.md
git commit -m "docs: guías de conexión alineadas con los permisos del brain y la página Conectar"
```

---

### Task 7: Cierre

- [ ] **Step 1: Suite completa, typecheck y build**

Run: `npm test -- --reporter=dot 2>&1 | tail -8 && npm run typecheck && npm run build 2>&1 | tail -15`
Expected: todo en verde.

- [ ] **Step 2: Confirmar que no se filtró nada de un tenant al código**

Run: `grep -rn "agentes.innov.as\|innovas" lib/connect lib/tenants/nav.ts lib/agents/agent-enabled.ts "app/[tenant]/conectar"`
Expected: sin resultados.

- [ ] **Step 3: Revisar el diff de la rama**

Run: `git diff --stat docs/plan-cierre-gap-plataforma...HEAD`
Expected: solo los archivos de la tabla "Estructura de archivos" y sus tests. Si aparece un archivo que biome reformateó por su cuenta, revertirlo con `git checkout docs/plan-cierre-gap-plataforma -- <archivo>` y commitear.

- [ ] **Step 4: Entregar**

Usar `superpowers:verification-before-completion` y después `/ship` para abrir el PR. En la descripción del PR: que no hay migración, que la verificación en producción es el anexo A de la spec y la corre una persona, y qué quedó sin verificar en navegador si el paso 7 de la Tarea 5 no se pudo correr.
