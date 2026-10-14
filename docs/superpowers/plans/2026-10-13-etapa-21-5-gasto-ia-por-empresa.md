# Etapa 21.5: gasto de IA por empresa — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada llamada al modelo quede asentada y etiquetada por empresa, y que el cliente y la plataforma vean el gasto del mes.

**Architecture:** `usage_entries` es la fuente de las pantallas. Un hook de eve asienta los pasos del agente en el chat, que hoy quedan afuera. Toda llamada sale con el tag `tenant:<slug>` en `providerOptions.gateway`, y el reporte del AI Gateway se consulta solo a pedido para conciliar contra el libro.

**Tech Stack:** Next.js (App Router), eve 0.67.2, AI SDK 7 (`ai` 7.0.108, que reexporta `gateway` de `@ai-sdk/gateway` 4.0.88), Supabase Postgres con pgTAP, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md`

## Global Constraints

- Español rioplatense en UI y mensajes. Código e identificadores en inglés.
- Nada específico de un tenant en código.
- `usage_entries` y `events` son solo de inserción: nunca `UPDATE` ni `DELETE`.
- Todo lo que importan tools, schedules y hooks de eve usa imports relativos; eve no resuelve `@/`.
- Antes de escribir código de eve: leer `node_modules/eve/docs/README.md` y `node_modules/eve/docs/guides/hooks.md`.
- Antes de tocar SQL: cargar la skill `supabase-postgres-best-practices`.
- Toda operación asíncrona va en `try/catch`. Excepción: `requirePlatformAdmin()` y `resolveTenantAccess()` pueden redirigir tirando, así que se llaman fuera del `try`.
- La medición nunca tumba un turno: un hook de consumo atrapa todo y loguea.
- Tag único por llamada: `tenant:<slug>` (spec G5).
- Días en UTC en las pantallas de período (spec G7). Período: mes en curso y mes anterior (G8).
- Tolerancia de la conciliación: el mayor entre US$ 1 y el 5 % del gateway (spec §5.3).
- El cliente no ve `usage_entries` ni `runs.cost_usd`: solo el agregado por día y por origen (G9).
- Commits con prefijo `feat:`, `fix:`, `docs:` o `refactor:`. Identidad git local `innovasbuild` / `matias@innov.as`.
- Después de cada cambio de código: `npm run typecheck`. `npm run lint:fix` reformatea siempre cuatro archivos ajenos del repo: revertirlos con `git checkout -- <archivo>` antes de commitear.
- `npm run db:test` y `npm run db:types` necesitan Docker abierto.
- No se debilita `npm run docs:check`: una ruta nueva pide página en la wiki.

## Verificaciones ya resueltas (spec §12)

| # | Pregunta | Resultado |
|---|---|---|
| 1 | ¿Un hook puede suscribirse a `step.completed`? | Sí. La guía de hooks acepta cualquier evento del stream y `step.completed` está en `concepts/sessions-runs-and-streaming.md`. Firma: `(event, ctx)` |
| 2 | ¿De dónde sale el id del modelo? | `step.started` trae `data.modelId`; `step.completed` no. El hook lo recuerda en memoria entre los dos eventos y, si no lo tiene y además falta el costo, lo resuelve con `resolveModelForTenant` |
| 3 | ¿La compactación emite `step.completed`? | No verificado. Emite `compaction.requested` y `compaction.completed` sin costo. Queda como causa conocida de diferencia y se mira en el cierre en producción |
| 4 | ¿Los tags conviven con el `sessionId` de eve? | Sí. `mergeGatewaySessionId` hace `{...opciones, gateway: {...gateway, sessionId}}` |
| 5 | ¿Las sesiones por MCP traen `tenantSlug`? | Sí (`lib/agents/mcp-channel-auth.ts`) |
| 6 | ¿`getSpendReport` acepta OIDC? | El SDK manda la misma credencial que las llamadas al modelo. Si el servidor la acepta solo se sabe con una consulta real: la acción muestra el rechazo y se prueba en el cierre |
| 7 | ¿`agent/step` va al registry? | No. El test del registry compara `lib/<dominio>/services/` y los nodos de workflows; `lib/agents/step-usage.ts` no es un servicio |

El costo que eve informa en `usage.costUsd` sale de `providerMetadata.gateway.cost` (`extractGatewayCostUsd` en `harness/tool-loop.js`), así que su `source` es `gateway`.

## Ajustes sobre la spec

Dos detalles que la spec no resolvía y este plan fija:

- **Origen de un asiento.** El schedule de follow-ups asienta con `workflow: null` y `run_id: null`. Con `coalesce(workflow, 'chat')` aparecería como chat. El origen pasa a ser: el `workflow` si lo trae; si no, `chat` cuando tiene corrida y `sin_corrida` cuando no. En pantalla, `sin_corrida` se rotula "Procesos programados".
- **Helper de tags.** Los schedules conocen el `tenantId` y no el slug. Además de `gatewayOptions(slug)` hay un `createGatewayOptions(admin)` que resuelve el slug por id con caché. El `extra` de la spec no hace falta: `zeroDataRetention` se queda en el servicio de evaluación, que lo combina con los tags.

## Review Focus

1. **La base falla al resolver el slug.** La llamada al modelo sale igual, con el tag `tenant:<id>`, y la conciliación atribuye ese tag a la empresa por id. Tests en Task 1 y Task 8.
2. **Un paso del chat sin corrida encontrada** (`resolveRunId` devuelve null). El asiento se inserta igual con `run_id: null`; cuenta para el presupuesto y el mes. Test en Task 4.
3. **Enero.** El mes anterior es diciembre del año anterior, no el mes -1. Test en Task 6.
4. **Conciliar el mes en curso el día 1.** No hay día cerrado: la acción responde con un mensaje y no consulta al gateway con un rango invertido. Test en Task 8.
5. **Montos que llegan como texto.** Postgres devuelve `numeric` como string según el camino; las tablas suman números, no concatenan. Test en Task 6.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/workflows/gateway-options.ts` (nuevo) | Arma el tag y las opciones del gateway |
| `lib/outreach/services/{generate-draft,generate-research,evaluate}.ts` | Reciben las opciones y las pasan al SDK |
| `agents/outreach/tools/{research_account,draft_message}.ts`, `agents/outreach/schedules/{followups,dispatch}.ts` | Puertas: resuelven las opciones del tenant |
| `lib/agents/model.ts`, `agents/outreach/agent.ts` | Selección de modelo con tags para el chat |
| `lib/agents/step-usage.ts` (nuevo) | Convierte un `step.completed` en un asiento |
| `agents/outreach/hooks/usage.ts` (nuevo) | Hook que asienta los pasos del agente |
| `supabase/migrations/20261022120000_spend_report.sql` (nuevo) | Dos funciones de lectura |
| `supabase/tests/35_spend_report.test.sql` (nuevo) | pgTAP de las funciones |
| `lib/usage/report.ts` (nuevo) | Rangos de mes en UTC y armado de tablas |
| `lib/usage/reconcile.ts` (nuevo) | Comparación libro contra gateway |
| `app/[tenant]/settings/gasto/page.tsx` (nuevo) | Pantalla del cliente |
| `app/plataforma/gasto/{page.tsx,actions.ts,reconcile-panel.tsx}` (nuevos) | Pantalla de plataforma y conciliación |

## Preparación

- [ ] Crear la rama de trabajo desde la rama de la spec, en un worktree propio (skill `superpowers:using-git-worktrees`):

```bash
git worktree add -b feat/etapa-21-5-gasto-ia .claude/worktrees/etapa-21-5-impl docs/etapa-21-5-gasto-ia
```

- [ ] En ese worktree, instalar dependencias y confirmar la línea de base:

```bash
npm install
```

```bash
npm run typecheck && npm test
```

Expected: typecheck sin errores y la suite en verde. Si algo falla antes de tocar nada, frenar y avisar.

- [ ] Confirmar que el nombre de la migración sigue libre:

```bash
ls supabase/migrations | tail -3
```

Expected: la última es `20261020120000_brain_skills.sql`. Si hay una posterior, usar el siguiente timestamp en Task 5 y en todo lugar donde este plan nombra el archivo. (La etapa 22.1 ocupa `20261021120000_asistente_agent.sql`, por eso la nuestra es `20261022120000`.)

---

### Task 1: Helper de opciones del gateway

**Files:**
- Create: `lib/workflows/gateway-options.ts`
- Test: `tests/workflows/gateway-options.test.ts`

**Interfaces:**
- Consumes: `AdminLike` de `lib/workflows/usage.ts`.
- Produces:
  - `type GatewayOptions = { gateway: { tags: string[] } }`
  - `tenantTag(key: string): string`
  - `gatewayOptions(slug: string): GatewayOptions`
  - `createGatewayOptions(admin: AdminLike): (tenantId: string) => Promise<GatewayOptions>`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/workflows/gateway-options.test.ts
import { describe, expect, it, vi } from "vitest";
import {
	createGatewayOptions,
	gatewayOptions,
	tenantTag,
} from "@/lib/workflows/gateway-options";

function fakeAdmin(result: { data: unknown; error: unknown }) {
	const maybeSingle = vi.fn(async () => result);
	const eq = vi.fn(() => ({ maybeSingle }));
	const select = vi.fn(() => ({ eq }));
	return { admin: { from: vi.fn(() => ({ select })) }, maybeSingle };
}

describe("gatewayOptions", () => {
	it("arma el tag de la empresa", () => {
		expect(tenantTag("acme")).toBe("tenant:acme");
		expect(gatewayOptions("acme")).toEqual({
			gateway: { tags: ["tenant:acme"] },
		});
	});
});

describe("createGatewayOptions", () => {
	it("resuelve el slug por id y lo guarda en caché", async () => {
		const { admin, maybeSingle } = fakeAdmin({
			data: { slug: "acme" },
			error: null,
		});
		const optionsFor = createGatewayOptions(admin as never);
		expect(await optionsFor("t1")).toEqual({
			gateway: { tags: ["tenant:acme"] },
		});
		await optionsFor("t1");
		expect(maybeSingle).toHaveBeenCalledTimes(1);
	});

	it("si la base falla, etiqueta con el id y no guarda el fallo", async () => {
		const { admin, maybeSingle } = fakeAdmin({
			data: null,
			error: { message: "db caída" },
		});
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const optionsFor = createGatewayOptions(admin as never);
		expect(await optionsFor("t1")).toEqual({
			gateway: { tags: ["tenant:t1"] },
		});
		await optionsFor("t1");
		expect(maybeSingle).toHaveBeenCalledTimes(2);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("si la consulta tira, etiqueta con el id y no tira", async () => {
		const admin = {
			from: () => {
				throw new Error("sin red");
			},
		};
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			createGatewayOptions(admin as never)("t1"),
		).resolves.toEqual({ gateway: { tags: ["tenant:t1"] } });
		spy.mockRestore();
	});
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- tests/workflows/gateway-options.test.ts`
Expected: FAIL, no encuentra `@/lib/workflows/gateway-options`.

- [ ] **Step 3: Implementar**

```ts
// lib/workflows/gateway-options.ts
// Opciones del AI Gateway que acompañan a toda llamada al modelo (spec 21.5
// §4). El tag es lo que separa el gasto por empresa en el gateway. Imports
// relativos: lo usan tools, schedules y el agente de eve.
import type { AdminLike } from "./usage";

// `type` y no `interface`: tiene que ser asignable al Record de providerOptions.
export type GatewayOptions = { gateway: { tags: string[] } };

export function tenantTag(key: string): string {
	return `tenant:${key}`;
}

export function gatewayOptions(slug: string): GatewayOptions {
	return { gateway: { tags: [tenantTag(slug)] } };
}

/**
 * Para las puertas que conocen el id del tenant y no su slug (schedules).
 * Nunca tira: un tag no puede tumbar una llamada al modelo. Si no puede leer
 * el slug etiqueta con el id, que la conciliación sabe atribuir, y no guarda
 * el fallo en caché.
 */
export function createGatewayOptions(
	admin: AdminLike,
): (tenantId: string) => Promise<GatewayOptions> {
	const cache = new Map<string, GatewayOptions>();
	return async (tenantId) => {
		const cached = cache.get(tenantId);
		if (cached) return cached;
		try {
			const { data, error } = await admin
				.from("tenants")
				.select("slug")
				.eq("id", tenantId)
				.maybeSingle();
			const slug = (data as { slug?: unknown } | null)?.slug;
			if (!error && typeof slug === "string" && slug) {
				const options = gatewayOptions(slug);
				cache.set(tenantId, options);
				return options;
			}
			console.error("gateway-options:", error?.message ?? "tenant sin slug");
		} catch (error) {
			console.error("gateway-options:", error);
		}
		return gatewayOptions(tenantId);
	};
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npm test -- tests/workflows/gateway-options.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add lib/workflows/gateway-options.ts tests/workflows/gateway-options.test.ts
git commit -m "feat: helper de tags del gateway por empresa"
```

---

### Task 2: Servicios y puertas mandan el tag

**Files:**
- Modify: `lib/outreach/services/generate-draft.ts` (firma de `generateDraft` y la llamada a `deps.generateText`)
- Modify: `lib/outreach/services/generate-research.ts` (firma de `generateResearch` y la llamada a `deps.generateText`)
- Modify: `lib/outreach/services/evaluate.ts` (`runEvaluation`)
- Modify: `agents/outreach/tools/research_account.ts`, `agents/outreach/tools/draft_message.ts`
- Modify: `agents/outreach/schedules/followups.ts`, `agents/outreach/schedules/dispatch.ts`
- Test: `tests/outreach/services/generate-draft.test.ts`, `tests/outreach/services/generate-research.test.ts`, `tests/outreach/services/evaluate.test.ts`, `tests/workflows/model-calls.test.ts`

**Interfaces:**
- Consumes: `GatewayOptions`, `gatewayOptions`, `createGatewayOptions` de Task 1.
- Produces: los tres servicios aceptan `providerOptions?: GatewayOptions` en su segundo argumento (`deps`). Ninguna otra firma cambia.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `tests/outreach/services/generate-draft.test.ts`, con este import arriba junto a los otros:

```ts
import { gatewayOptions } from "@/lib/workflows/gateway-options";
```

```ts
describe("generateDraft — opciones del gateway", () => {
	it("pasa el tag de la empresa a generateText", async () => {
		const generateText = vi.fn(async () => ({
			output: { subject: "s", body: "b" },
			usage: usageStub,
		}));
		await generateDraft("m", "system", "prompt", {
			generateText: generateText as never,
			providerOptions: gatewayOptions("acme"),
		});
		expect(generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: { gateway: { tags: ["tenant:acme"] } },
			}),
		);
	});
});
```

Agregar al final de `tests/outreach/services/generate-research.test.ts` (sumar `vi` y `gatewayOptions` a los imports si faltan). Si el primer test del archivo arma el resultado de `generateText` con más campos, usar ese mismo stub en vez de este:

```ts
describe("generateResearch — opciones del gateway", () => {
	it("pasa el tag de la empresa a generateText", async () => {
		const generateText = vi.fn(async () => ({
			output: {},
			usage: {},
			providerMetadata: undefined,
		}));
		await generateResearch(
			{
				model: "m",
				system: "s",
				prompt: "p",
				readPage: async () => ({ ok: false, reason: "x" }) as never,
			},
			{
				generateText: generateText as never,
				providerOptions: gatewayOptions("acme"),
			},
		);
		expect(generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: { gateway: { tags: ["tenant:acme"] } },
			}),
		);
	});
});
```

Agregar al final de `tests/outreach/services/evaluate.test.ts` (sumar `vi`, `runEvaluation` y `gatewayOptions` a los imports si faltan):

```ts
describe("runEvaluation — opciones del gateway", () => {
	const args = { model: "typesafe-ai/jev", state: {}, questions: {} };
	const stub = () =>
		vi.fn(async () => ({ answers: {}, usage: {}, providerMetadata: {} }));

	it("suma el tag sin perder zeroDataRetention", async () => {
		const evaluate = stub();
		await runEvaluation(args, {
			evaluate: evaluate as never,
			providerOptions: gatewayOptions("acme"),
		});
		expect(evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: {
					gateway: { tags: ["tenant:acme"], zeroDataRetention: true },
				},
			}),
		);
	});

	it("sin opciones, sigue mandando zeroDataRetention", async () => {
		const evaluate = stub();
		await runEvaluation(args, { evaluate: evaluate as never });
		expect(evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: { gateway: { zeroDataRetention: true } },
			}),
		);
	});
});
```

En `tests/workflows/model-calls.test.ts`, agregar un segundo `it` dentro del `describe("llamadas al modelo", ...)`:

```ts
	it("todo archivo que importa generateText o experimental_evaluate etiqueta la llamada", () => {
		// Spec 21.5 §4.4: una llamada sin tag no se nota hasta conciliar contra
		// el gateway. La puerta arma las opciones con gatewayOptions o con el
		// resolvedor que devuelve createGatewayOptions.
		const sinEtiqueta = [...walk("agents"), ...walk("lib"), ...walk("app")]
			.filter((file) => /\.(ts|tsx|mts)$/.test(file))
			.filter((file) => IMPORTS_MODEL_CALL.test(readFileSync(file, "utf8")))
			.filter(
				(file) =>
					!/\b(gatewayOptions|createGatewayOptions)\(/.test(
						readFileSync(file, "utf8"),
					),
			);

		expect(sinEtiqueta).toEqual([]);
	});
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `npm test -- tests/outreach/services/generate-draft.test.ts tests/outreach/services/generate-research.test.ts tests/outreach/services/evaluate.test.ts tests/workflows/model-calls.test.ts`
Expected: FAIL. Los de servicios porque `providerOptions` no llega a la llamada; el de `model-calls` lista las cuatro puertas.

- [ ] **Step 3: Servicios**

En `lib/outreach/services/generate-draft.ts`, importar el tipo y sumar el campo a `deps` y a la llamada:

```ts
import type { GatewayOptions } from "../../workflows/gateway-options";
```

```ts
export async function generateDraft(
	model: string,
	system: string,
	prompt: string,
	deps: {
		generateText: typeof generateText;
		abortSignal?: AbortSignal;
		providerOptions?: GatewayOptions;
	},
): Promise<{ output: unknown; usage: unknown; providerMetadata: unknown }> {
```

En el objeto que recibe `deps.generateText`, después de `abortSignal: deps.abortSignal,`:

```ts
			providerOptions: deps.providerOptions,
```

En `lib/outreach/services/generate-research.ts`, el mismo import y el mismo campo en `deps`:

```ts
	deps: {
		generateText: typeof generateText;
		abortSignal?: AbortSignal;
		providerOptions?: GatewayOptions;
	},
```

En el objeto que recibe `deps.generateText`, después de `prompt: args.prompt,`:

```ts
			providerOptions: deps.providerOptions,
```

En `lib/outreach/services/evaluate.ts`, el mismo import, y `runEvaluation` queda:

```ts
export async function runEvaluation(
	args: EvaluationArgs,
	deps: {
		evaluate: typeof evaluate;
		abortSignal?: AbortSignal;
		providerOptions?: GatewayOptions;
	},
): Promise<{ answers: Row; usage: unknown; providerMetadata: unknown }> {
	const result = await deps.evaluate({
		model: args.model,
		state: args.state,
		questions: args.questions,
		abortSignal: deps.abortSignal,
		providerOptions: {
			gateway: {
				...deps.providerOptions?.gateway,
				// Datos personales de terceros pasando por un modelo.
				zeroDataRetention: true,
			},
		},
	} as Parameters<typeof evaluate>[0]);
```

El resto de la función no cambia.

- [ ] **Step 4: Puertas del chat**

En `agents/outreach/tools/research_account.ts`, sumar el import:

```ts
import { createGatewayOptions } from "../../../lib/workflows/gateway-options";
```

Después de `const admin = createAdminClient();`:

```ts
		const gatewayOptionsFor = createGatewayOptions(admin);
```

Y el primer argumento de `metered` pasa a ser:

```ts
						async (args: Parameters<typeof generateResearch>[0]) =>
							generateResearch(args, {
								generateText,
								abortSignal: ctx.abortSignal,
								providerOptions: await gatewayOptionsFor(caller.tenantId),
							}),
```

En `agents/outreach/tools/draft_message.ts`, el mismo import, la misma línea después de `const admin = createAdminClient();`, y el primer argumento de `metered`:

```ts
					async (model: string, system: string, prompt: string) =>
						generateDraft(model, system, prompt, {
							generateText,
							abortSignal: ctx.abortSignal,
							providerOptions: await gatewayOptionsFor(caller.tenantId),
						}),
```

- [ ] **Step 5: Puertas de los schedules**

En `agents/outreach/schedules/followups.ts`, sumar el import (un nivel de `../` como los demás imports de `lib/workflows` en ese archivo). Antes de la llamada a `draftMessage`, junto a `const brain = ...`:

```ts
	const gatewayOptionsFor = createGatewayOptions(admin);
```

Y el primer argumento de `metered`:

```ts
				async (model: string, system: string, prompt: string) =>
					generateDraft(model, system, prompt, {
						generateText,
						providerOptions: await gatewayOptionsFor(input.tenantId),
					}),
```

En `agents/outreach/schedules/dispatch.ts`, sumar el import. Dentro de `run()`, después de `const record = createUsageRecorder(admin);`:

```ts
		const gatewayOptionsFor = createGatewayOptions(admin);
```

Hay cuatro llamadas a `metered`. Cada primer argumento queda así.

Nodo `outreach/research`:

```ts
						async (args: Parameters<typeof generateResearch>[0]) =>
							generateResearch(args, {
								generateText,
								abortSignal: signal,
								providerOptions: await gatewayOptionsFor(tenantId),
							}),
```

Nodo `outreach/icp-score`:

```ts
						async (args: Parameters<typeof runEvaluation>[0]) =>
							runEvaluation(args, {
								evaluate: experimental_evaluate,
								providerOptions: await gatewayOptionsFor(tenantId),
							}),
```

Nodo `outreach/draft` del workflow `draft-queue`:

```ts
							async (model: string, system: string, prompt: string) =>
								generateDraft(model, system, prompt, {
									generateText,
									abortSignal: signal,
									providerOptions: await gatewayOptionsFor(tenantId),
								}),
```

Nodo `outreach/verify-fact`:

```ts
						async (args: Parameters<typeof runEvaluation>[0]) =>
							runEvaluation(args, {
								evaluate: experimental_evaluate,
								providerOptions: await gatewayOptionsFor(tenantId),
							}),
```

- [ ] **Step 6: Correr los tests y verlos pasar**

Run: `npm test -- tests/outreach tests/workflows tests/tools`
Expected: PASS. Si un test existente comparaba la llamada a `generateText` con `toHaveBeenCalledWith` exacto, ahora recibe además `providerOptions: undefined`: ajustar esa expectativa con `expect.objectContaining`.

- [ ] **Step 7: Commit**

```bash
npm run typecheck
git add lib/outreach/services agents/outreach/tools agents/outreach/schedules tests/outreach/services tests/workflows/model-calls.test.ts
git commit -m "feat: toda llamada al modelo sale con el tag de la empresa"
```

---

### Task 3: El chat manda el tag

**Files:**
- Modify: `lib/agents/model.ts` (función nueva al final)
- Modify: `agents/outreach/agent.ts`
- Test: `tests/agents/model.test.ts`

**Interfaces:**
- Consumes: `gatewayOptions`, `GatewayOptions` de Task 1.
- Produces: `modelSelection(model: string, tenantSlug: string): ModelSelection`, con `type ModelSelection = string | { model: string; modelOptions: { providerOptions: GatewayOptions } }`.

- [ ] **Step 1: Escribir el test que falla**

En `tests/agents/model.test.ts`, cambiar el import a `import { modelSelection, pickModel } from "@/lib/agents/model";` y agregar al final:

```ts
describe("modelSelection", () => {
	it("con slug, devuelve el modelo con el tag de la empresa", () => {
		expect(modelSelection("anthropic/claude-sonnet-5", "acme")).toEqual({
			model: "anthropic/claude-sonnet-5",
			modelOptions: {
				providerOptions: { gateway: { tags: ["tenant:acme"] } },
			},
		});
	});

	it("sin slug, devuelve solo el modelo", () => {
		expect(modelSelection("anthropic/claude-sonnet-5", "")).toBe(
			"anthropic/claude-sonnet-5",
		);
	});
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- tests/agents/model.test.ts`
Expected: FAIL, `modelSelection` no existe.

- [ ] **Step 3: Implementar**

En `lib/agents/model.ts`, sumar el import arriba:

```ts
import { type GatewayOptions, gatewayOptions } from "../workflows/gateway-options";
```

Y al final del archivo:

```ts
export type ModelSelection =
	| string
	| { model: string; modelOptions: { providerOptions: GatewayOptions } };

/**
 * Lo que devuelve el modelo dinámico del agente. Con slug suma el tag de la
 * empresa, que es lo que separa el gasto del chat en el AI Gateway (spec 21.5
 * §4.3). eve agrega su `sessionId` a las mismas opciones sin pisar los tags.
 */
export function modelSelection(
	model: string,
	tenantSlug: string,
): ModelSelection {
	if (!tenantSlug) return model;
	return {
		model,
		modelOptions: { providerOptions: gatewayOptions(tenantSlug) },
	};
}
```

En `agents/outreach/agent.ts`, cambiar el import y el handler:

```ts
import { modelSelection, resolveModelForTenant } from "../../lib/agents/model";
```

```ts
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return "anthropic/claude-sonnet-5";

				const model = await resolveModelForTenant(
					tenantId,
					"outreach",
					attribute(auth?.attributes?.conversationId) || null,
				);
				return modelSelection(model, attribute(auth?.attributes?.tenantSlug));
			},
```

- [ ] **Step 4: Correr el test y el chequeo de tipos**

Run: `npm test -- tests/agents/model.test.ts && npm run typecheck`
Expected: PASS y sin errores. Si el chequeo de tipos rechaza el objeto de selección, leer `node_modules/eve/docs/agent-config.md` ("Choose the model dynamically", punto "Selection object") y ajustar la forma a lo que tipa eve; no castear a `never`.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/model.ts agents/outreach/agent.ts tests/agents/model.test.ts
git commit -m "feat: el chat etiqueta sus llamadas con la empresa"
```

---

### Task 4: Asiento de los pasos del agente

**Files:**
- Create: `lib/agents/step-usage.ts`
- Create: `agents/outreach/hooks/usage.ts`
- Test: `tests/agents/step-usage.test.ts`, `tests/hooks/usage.test.ts`

**Interfaces:**
- Consumes: `UsageEntry`, `createUsageRecorder`, `resolveRunId` de `lib/workflows/usage.ts`; `modelCostUsd` de `lib/workflows/pricing.ts`; `resolveModelForTenant` de `lib/agents/model.ts`.
- Produces:
  - `interface StepUsage { costUsd?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }`
  - `stepUsageEntry(input: { tenantId: string; runId: string | null; agent: string; modelId: string | null; stepIndex: number; usage: StepUsage | undefined }): UsageEntry | null`

- [ ] **Step 1: Escribir el test de la función pura**

```ts
// tests/agents/step-usage.test.ts
import { describe, expect, it } from "vitest";
import { stepUsageEntry } from "@/lib/agents/step-usage";

const base = {
	tenantId: "t1",
	runId: "r1",
	agent: "outreach",
	modelId: "anthropic/claude-sonnet-5",
	stepIndex: 2,
};

describe("stepUsageEntry", () => {
	it("con costo informado, asienta ese monto con fuente gateway", () => {
		expect(
			stepUsageEntry({
				...base,
				usage: {
					costUsd: 0.0123,
					inputTokens: 1000,
					outputTokens: 200,
					cacheReadTokens: 800,
					cacheWriteTokens: 0,
				},
			}),
		).toEqual({
			tenantId: "t1",
			runId: "r1",
			workflow: null,
			node: "agent/step",
			resource: "model_usd",
			amount: 0.0123,
			unit: "usd",
			meta: {
				agent: "outreach",
				model: "anthropic/claude-sonnet-5",
				source: "gateway",
				inputTokens: 1000,
				outputTokens: 200,
				cacheReadTokens: 800,
				cacheWriteTokens: 0,
				stepIndex: 2,
			},
		});
	});

	it("sin costo, usa la tabla de precios", () => {
		const entry = stepUsageEntry({
			...base,
			usage: { inputTokens: 1_000_000, outputTokens: 0 },
		});
		expect(entry?.amount).toBe(2);
		expect(entry?.meta.source).toBe("tabla");
	});

	it("sin costo y sin modelo, asienta cero con fuente sin_precio", () => {
		const entry = stepUsageEntry({
			...base,
			modelId: null,
			usage: { inputTokens: 500, outputTokens: 10 },
		});
		expect(entry?.amount).toBe(0);
		expect(entry?.meta).toMatchObject({ source: "sin_precio", model: null });
	});

	it("sin corrida, asienta igual con run_id nulo", () => {
		const entry = stepUsageEntry({
			...base,
			runId: null,
			usage: { costUsd: 0.5 },
		});
		expect(entry).toMatchObject({ runId: null, amount: 0.5 });
	});

	it("sin usage, no hay asiento", () => {
		expect(stepUsageEntry({ ...base, usage: undefined })).toBeNull();
	});

	it("un costo negativo o no finito no se toma como informado", () => {
		const entry = stepUsageEntry({
			...base,
			usage: { costUsd: Number.NaN, inputTokens: 1_000_000 },
		});
		expect(entry?.meta.source).toBe("tabla");
	});
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- tests/agents/step-usage.test.ts`
Expected: FAIL, no encuentra el módulo.

- [ ] **Step 3: Implementar la función pura**

```ts
// lib/agents/step-usage.ts
// Convierte un `step.completed` de eve en un asiento de consumo (spec 21.5
// §3). Es lo que mete en el libro los pasos del propio agente, que `metered`
// no ve. Imports relativos: lo usa un hook de eve.
import { modelCostUsd } from "../workflows/pricing";
import type { UsageEntry } from "../workflows/usage";

export interface StepUsage {
	costUsd?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}

const count = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function stepUsageEntry(input: {
	tenantId: string;
	runId: string | null;
	agent: string;
	modelId: string | null;
	stepIndex: number;
	usage: StepUsage | undefined;
}): UsageEntry | null {
	const { usage } = input;
	if (!usage) return null;

	const informed =
		typeof usage.costUsd === "number" &&
		Number.isFinite(usage.costUsd) &&
		usage.costUsd >= 0
			? usage.costUsd
			: null;
	// El costo de eve sale de providerMetadata.gateway.cost. Sin él, la tabla
	// (que sobreestima porque no descuenta caché) es el lado seguro.
	const table = modelCostUsd({
		model: input.modelId ?? "",
		usage,
		providerMetadata: undefined,
	});

	return {
		tenantId: input.tenantId,
		runId: input.runId,
		workflow: null,
		node: "agent/step",
		resource: "model_usd",
		amount: informed ?? table.usd,
		unit: "usd",
		meta: {
			agent: input.agent,
			model: input.modelId,
			source: informed === null ? table.source : "gateway",
			inputTokens: count(usage.inputTokens),
			outputTokens: count(usage.outputTokens),
			cacheReadTokens: count(usage.cacheReadTokens),
			cacheWriteTokens: count(usage.cacheWriteTokens),
			stepIndex: input.stepIndex,
		},
	};
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npm test -- tests/agents/step-usage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Escribir el test del hook**

```ts
// tests/hooks/usage.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	entries: [] as unknown[],
	runId: "run-1" as string | null,
	resolved: 0,
	failRecord: false,
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({}),
}));
vi.mock("../../lib/workflows/usage", () => ({
	createUsageRecorder: () => async (entry: unknown) => {
		if (calls.failRecord) throw new Error("db caída");
		calls.entries.push(entry);
	},
	resolveRunId: async () => calls.runId,
}));
vi.mock("../../lib/agents/model", () => ({
	resolveModelForTenant: async () => {
		calls.resolved++;
		return "anthropic/claude-sonnet-5";
	},
}));

const { default: hook } = await import("@/agents/outreach/hooks/usage");
// biome-ignore lint/suspicious/noExplicitAny: evento y ctx de eve simulados.
const events = (hook as any).events;

function ctx(tenantId: string | undefined) {
	return {
		agent: { name: "outreach" },
		session: {
			id: "wrun_A",
			auth: {
				current: { attributes: { tenantId, conversationId: "c1" } },
			},
		},
	};
}

const completed = (usage: unknown, stepIndex = 0) => ({
	data: { turnId: "turn-1", stepIndex, usage },
});

beforeEach(() => {
	calls.entries = [];
	calls.runId = "run-1";
	calls.resolved = 0;
	calls.failRecord = false;
});

describe("hook de consumo del agente", () => {
	it("asienta el paso con el modelo que vio en step.started", async () => {
		await events["step.started"](
			{ data: { turnId: "turn-1", stepIndex: 0, modelId: "anthropic/claude-opus-5" } },
			ctx("tenant-1"),
		);
		await events["step.completed"](completed({ costUsd: 0.2 }), ctx("tenant-1"));
		expect(calls.entries).toEqual([
			expect.objectContaining({
				tenantId: "tenant-1",
				runId: "run-1",
				node: "agent/step",
				resource: "model_usd",
				amount: 0.2,
				meta: expect.objectContaining({
					agent: "outreach",
					model: "anthropic/claude-opus-5",
					source: "gateway",
				}),
			}),
		]);
		expect(calls.resolved).toBe(0);
	});

	it("sin modelo recordado y sin costo, lo resuelve para usar la tabla", async () => {
		await events["step.completed"](
			completed({ inputTokens: 1_000_000 }, 7),
			ctx("tenant-1"),
		);
		expect(calls.resolved).toBe(1);
		expect(calls.entries).toEqual([
			expect.objectContaining({
				amount: 2,
				meta: expect.objectContaining({ source: "tabla" }),
			}),
		]);
	});

	it("sin corrida encontrada, asienta igual", async () => {
		calls.runId = null;
		await events["step.completed"](completed({ costUsd: 0.1 }, 8), ctx("tenant-1"));
		expect(calls.entries).toEqual([
			expect.objectContaining({ runId: null, amount: 0.1 }),
		]);
	});

	it("sin tenant no asienta", async () => {
		await events["step.completed"](completed({ costUsd: 0.1 }, 9), ctx(undefined));
		expect(calls.entries).toEqual([]);
	});

	it("sin usage no asienta", async () => {
		await events["step.completed"](completed(undefined, 10), ctx("tenant-1"));
		expect(calls.entries).toEqual([]);
	});

	it("si asentar tira, el hook no tira", async () => {
		calls.failRecord = true;
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			events["step.completed"](completed({ costUsd: 0.1 }, 11), ctx("tenant-1")),
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
```

- [ ] **Step 6: Correr el test y verlo fallar**

Run: `npm test -- tests/hooks/usage.test.ts`
Expected: FAIL, no encuentra `@/agents/outreach/hooks/usage`.

- [ ] **Step 7: Implementar el hook**

```ts
// agents/outreach/hooks/usage.ts
import { defineHook } from "eve/hooks";
import { resolveModelForTenant } from "../../../lib/agents/model";
import { stepUsageEntry } from "../../../lib/agents/step-usage";
import { createAdminClient } from "../../../lib/supabase/admin";
import {
	createUsageRecorder,
	resolveRunId,
} from "../../../lib/workflows/usage";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// `step.completed` no trae el modelo; `step.started` sí. Se recuerda en
// memoria entre los dos: si el proceso cambió en el medio se pierde, y solo
// importa cuando además falta el costo (ahí se resuelve de nuevo).
const MAX_REMEMBERED = 500;
const models = new Map<string, string>();
const stepKey = (sessionId: string, turnId: string, stepIndex: number) =>
	`${sessionId}:${turnId}:${stepIndex}`;

// Asienta en usage_entries cada llamada al modelo del propio agente (spec
// 21.5 §3). Las llamadas que hacen las tools por dentro las asienta `metered`
// y no pasan por acá. Mismo principio que hooks/runs.ts: la medición nunca
// puede tumbar un turno, así que todo va en try/catch.
export default defineHook({
	events: {
		async "step.started"(event, ctx) {
			try {
				if (models.size >= MAX_REMEMBERED) models.clear();
				models.set(
					stepKey(ctx.session.id, event.data.turnId, event.data.stepIndex),
					event.data.modelId,
				);
			} catch (error) {
				console.error("usage hook (step.started):", error);
			}
		},
		async "step.completed"(event, ctx) {
			try {
				const { turnId, stepIndex, usage } = event.data;
				const key = stepKey(ctx.session.id, turnId, stepIndex);
				let modelId = models.get(key) ?? null;
				models.delete(key);

				const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId || !usage) return;

				if (modelId === null && usage.costUsd === undefined) {
					modelId = await resolveModelForTenant(
						tenantId,
						ctx.agent.name,
						attribute(auth?.attributes?.conversationId) || null,
					);
				}

				const admin = createAdminClient();
				const entry = stepUsageEntry({
					tenantId,
					runId: await resolveRunId(admin, ctx.session.id, turnId),
					agent: ctx.agent.name,
					modelId,
					stepIndex,
					usage,
				});
				if (entry) await createUsageRecorder(admin)(entry);
			} catch (error) {
				console.error("usage hook (step.completed):", error);
			}
		},
	},
});
```

- [ ] **Step 8: Correr los tests y verlos pasar**

Run: `npm test -- tests/hooks tests/agents && npm run typecheck`
Expected: PASS y sin errores de tipos. Si el chequeo de tipos no reconoce `"step.started"` o `"step.completed"` como claves de `events`, mirar el tipo `HookDefinition` en `node_modules/eve/dist/src/hooks/` y `node_modules/eve/docs/guides/hooks.md`, y ajustar la firma a lo que tipa eve.

- [ ] **Step 9: Commit**

```bash
git add lib/agents/step-usage.ts agents/outreach/hooks/usage.ts tests/agents/step-usage.test.ts tests/hooks/usage.test.ts
git commit -m "feat: los pasos del agente en el chat asientan su consumo"
```

---

### Task 5: Funciones de lectura en la base

**Files:**
- Create: `supabase/migrations/20261022120000_spend_report.sql`
- Create: `supabase/tests/35_spend_report.test.sql`
- Modify: `lib/supabase/database.types.ts` (regenerado, no a mano)

**Interfaces:**
- Consumes: `public.settings_actor(uuid)`, `public.usage_entries`.
- Produces:
  - `public.tenant_spend_report(p_tenant uuid, p_from timestamptz, p_to timestamptz) returns table (day date, origin text, amount numeric)`, ejecutable por `authenticated`.
  - `public.platform_spend_report(p_from timestamptz, p_to timestamptz) returns table (tenant_id uuid, amount numeric)`, ejecutable solo por `service_role`. *(Forma final tras la revisión: una fila por empresa y rango, con guarda de límites; la forma empresa x día que muestran los bloques de abajo se cambió porque PostgREST corta en 1000 filas. La página pide tres rangos en paralelo y la acción uno. Vale la migración y el spec §6, no el código de esta tarea.)*
  - En las dos, el rango es `[p_from, p_to)` y el día se corta en UTC. `origin` es el `workflow`, o `chat` si no hay workflow y hay corrida, o `sin_corrida`.

- [ ] **Step 1: Cargar la skill de Postgres**

Invocar `supabase-postgres-best-practices` antes de escribir SQL.

- [ ] **Step 2: Escribir el test pgTAP que falla**

```sql
-- supabase/tests/35_spend_report.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- Personas: 1 admin de sr-a, 2 miembro de sr-a, 3 admin de sr-b, 4 platform_admin (en sr-p).
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c5c5c5c5-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm@sr-a.test', now()),
  ('c5c5c5c5-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ana@sr-a.test', now()),
  ('c5c5c5c5-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adm@sr-b.test', now()),
  ('c5c5c5c5-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'plat@sr-p.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'sr-a', 'SR A'),
  ('d5d5d5d5-0000-0000-0000-00000000000b', 'sr-b', 'SR B'),
  ('d5d5d5d5-0000-0000-0000-00000000000c', 'sr-p', 'SR P');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'c5c5c5c5-0000-0000-0000-000000000001', 'tenant_admin'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'c5c5c5c5-0000-0000-0000-000000000002', 'tenant_member'),
  ('d5d5d5d5-0000-0000-0000-00000000000b', 'c5c5c5c5-0000-0000-0000-000000000003', 'tenant_admin'),
  ('d5d5d5d5-0000-0000-0000-00000000000c', 'c5c5c5c5-0000-0000-0000-000000000004', 'platform_admin');

insert into public.runs (id, tenant_id, agent, trigger, eve_session_id, status)
values ('e5e5e5e5-0000-0000-0000-000000000001', 'd5d5d5d5-0000-0000-0000-00000000000a', 'outreach', 'chat', 'wrun_sr', 'ok');

-- sr-a: dos asientos de chat el 5 (uno cae el 6 en UTC aunque en Buenos Aires
-- todavía es 5), un workflow el 6, un follow-up sin corrida el 6, créditos que
-- no cuentan y un asiento fuera del rango. sr-b: uno el 5.
insert into public.usage_entries (tenant_id, run_id, workflow, node, resource, amount, unit, created_at)
values
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'e5e5e5e5-0000-0000-0000-000000000001', null, 'agent/step', 'model_usd', 0.10, 'usd', '2026-10-05 12:00:00+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', 'e5e5e5e5-0000-0000-0000-000000000001', null, 'agent/step', 'model_usd', 0.20, 'usd', '2026-10-05 22:30:00-03'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', null, 'draft-queue', 'outreach/draft', 'model_usd', 0.40, 'usd', '2026-10-06 10:00:00+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', null, null, 'outreach/draft', 'model_usd', 0.05, 'usd', '2026-10-06 11:00:00+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', null, 'target-search', 'outreach/target-search', 'apollo_credits', 7, 'credits', '2026-10-06 11:00:00+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000a', null, null, 'agent/step', 'model_usd', 9.00, 'usd', '2026-09-30 23:59:59+00'),
  ('d5d5d5d5-0000-0000-0000-00000000000b', null, null, 'agent/step', 'model_usd', 3.00, 'usd', '2026-10-05 12:00:00+00');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c5c5c5c5-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1-4: privilegios.
select ok(has_function_privilege('authenticated', 'public.tenant_spend_report(uuid, timestamptz, timestamptz)', 'execute'), 'authenticated ejecuta tenant_spend_report');
select ok(not has_function_privilege('anon', 'public.tenant_spend_report(uuid, timestamptz, timestamptz)', 'execute'), 'anon no ve el gasto');
select ok(not has_function_privilege('authenticated', 'public.platform_spend_report(timestamptz, timestamptz)', 'execute'), 'authenticated no ve el gasto de todas las empresas');
select ok(has_function_privilege('service_role', 'public.platform_spend_report(timestamptz, timestamptz)', 'execute'), 'service_role ejecuta platform_spend_report');

-- 5-6: quién puede.
select pg_temp.login_as(2);
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-01+00', '2026-11-01+00')$$,
  '42501', null, 'un miembro no ve el gasto');
select pg_temp.login_as(3);
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-01+00', '2026-11-01+00')$$,
  '42501', null, 'el administrador de otra empresa no ve el gasto');

-- 7-9: rangos inválidos.
select pg_temp.login_as(1);
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-06-01+00', '2026-11-01+00')$$,
  '23514', null, 'un rango de más de 92 días se rechaza');
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-11-01+00', '2026-10-01+00')$$,
  '23514', null, 'un rango invertido se rechaza');
select throws_ok(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', null, '2026-10-01+00')$$,
  '23514', null, 'un rango sin inicio se rechaza');

-- 10: el administrador ve su mes por día en UTC y por origen, solo model_usd.
select results_eq(
  $$select day::text, origin, round(amount, 2)::text
      from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-01+00', '2026-11-01+00')
     order by day, origin$$,
  $$values
      ('2026-10-05', 'chat', '0.10'),
      ('2026-10-06', 'chat', '0.20'),
      ('2026-10-06', 'draft-queue', '0.40'),
      ('2026-10-06', 'sin_corrida', '0.05')$$,
  'gasto del mes por día en UTC y por origen');

-- 11: sin gasto en el rango, cero filas.
select is_empty(
  $$select * from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000a', '2026-11-01+00', '2026-12-01+00')$$,
  'un mes sin gasto no trae filas');

-- 12: el platform_admin lee el de cualquier empresa.
select pg_temp.login_as(4);
select is(
  (select round(sum(amount), 2)::text from public.tenant_spend_report('d5d5d5d5-0000-0000-0000-00000000000b', '2026-10-01+00', '2026-11-01+00')),
  '3.00', 'el platform_admin ve el gasto de otra empresa');

-- 13: la de plataforma agrupa por empresa y día.
select pg_temp.logout();
select results_eq(
  $$select tenant_id::text, day::text, round(amount, 2)::text
      from public.platform_spend_report('2026-10-01+00', '2026-11-01+00')
     where tenant_id in ('d5d5d5d5-0000-0000-0000-00000000000a', 'd5d5d5d5-0000-0000-0000-00000000000b')
     order by tenant_id, day$$,
  $$values
      ('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-05', '0.10'),
      ('d5d5d5d5-0000-0000-0000-00000000000a', '2026-10-06', '0.65'),
      ('d5d5d5d5-0000-0000-0000-00000000000b', '2026-10-05', '3.00')$$,
  'gasto por empresa y día en UTC');

select * from finish();
rollback;
```

- [ ] **Step 3: Correr el test y verlo fallar**

Run: `npm run db:test`
Expected: FAIL en `35_spend_report.test.sql`, las funciones no existen. Si falla el `insert` en `public.runs` por una columna obligatoria que este plan no conoce, completar esa columna mirando la definición en `lib/supabase/database.types.ts` (`runs.Insert`).

- [ ] **Step 4: Escribir la migración**

```sql
-- supabase/migrations/20261022120000_spend_report.sql
-- Etapa 21.5: lectura del gasto en modelos por período (spec §6). No hay
-- tablas nuevas: usage_entries sigue cerrada y esto solo agrega.
--
-- En las dos funciones el rango es [p_from, p_to) y el día se corta en UTC
-- (spec G7): es como reporta el AI Gateway, y con otro corte la conciliación
-- no cierra.

-- El gasto de una empresa por día y por origen. La llama su administrador
-- (o un platform_admin): settings_actor lo verifica adentro. El costo por
-- corrida sigue sin exponerse (spec G9).
--
-- Origen: el workflow si el asiento lo trae; si no, 'chat' cuando tiene
-- corrida y 'sin_corrida' cuando no (el schedule de follow-ups asienta sin
-- workflow y sin corrida, y no es chat).
create or replace function public.tenant_spend_report(
  p_tenant uuid, p_from timestamptz, p_to timestamptz
) returns table (day date, origin text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.settings_actor(p_tenant);
  if p_from is null or p_to is null or p_to <= p_from
     or p_to - p_from > interval '92 days' then
    raise exception 'período inválido' using errcode = '23514', hint = 'settings';
  end if;
  return query
    select (u.created_at at time zone 'UTC')::date,
           coalesce(u.workflow, case when u.run_id is null then 'sin_corrida' else 'chat' end),
           sum(u.amount)
      from public.usage_entries u
     where u.tenant_id = p_tenant
       and u.resource = 'model_usd'
       and u.created_at >= p_from
       and u.created_at < p_to
     group by 1, 2;
end;
$$;

revoke execute on function public.tenant_spend_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.tenant_spend_report(uuid, timestamptz, timestamptz) to authenticated;

-- El gasto de todas las empresas por día. Solo service_role: la pantalla de
-- plataforma la llama después de comprobar que quien entra es platform_admin.
create or replace function public.platform_spend_report(
  p_from timestamptz, p_to timestamptz
) returns table (tenant_id uuid, day date, amount numeric)
language sql stable set search_path = '' as $$
  select u.tenant_id,
         (u.created_at at time zone 'UTC')::date,
         sum(u.amount)
    from public.usage_entries u
   where u.resource = 'model_usd'
     and u.created_at >= p_from
     and u.created_at < p_to
   group by 1, 2;
$$;

revoke execute on function public.platform_spend_report(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.platform_spend_report(timestamptz, timestamptz) to service_role;
```

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `npm run db:test`
Expected: PASS en los 35 archivos, incluido `35_spend_report.test.sql` con 13 de 13. Si el test 12 falla porque `is_platform_admin()` pide algo más que la membresía (por ejemplo, que el tenant sea el dueño de la plataforma), copiar cómo arma su platform_admin `supabase/tests/32_outreach_settings.test.sql` o `29_platform_console.test.sql`; no cambiar la función.

- [ ] **Step 6: Mirar el plan de la consulta de plataforma**

Con la base local levantada (`npm run db:reset` deja la semilla):

```bash
npx supabase db query "explain select * from public.platform_spend_report(now() - interval '62 days', now())"
```

Si el comando no existe en la versión instalada del CLI, correr el `explain` con `psql` contra la URL que imprime `npx supabase status`. Sobre la base local, con pocas filas, un seq scan es esperable y no se agrega índice. Dejar anotado en el mensaje del commit que el índice por `(resource, created_at)` queda para cuando el `explain` en producción lo pida (spec §6).

- [ ] **Step 7: Regenerar los tipos**

Run: `npm run db:types`
Expected: `lib/supabase/database.types.ts` suma `tenant_spend_report` y `platform_spend_report` en `Functions`, sin otros cambios.

- [ ] **Step 8: Commit**

```bash
npm run typecheck
git add supabase/migrations/20261022120000_spend_report.sql supabase/tests/35_spend_report.test.sql lib/supabase/database.types.ts
git commit -m "feat: funciones de lectura del gasto en modelos por período"
```

---

### Task 6: Rangos de mes y tablas del reporte

**Files:**
- Create: `lib/usage/report.ts`
- Test: `tests/usage/report.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type Period = "actual" | "anterior"`
  - `parsePeriod(value: unknown): Period`
  - `monthRange(period: Period, now: Date): { from: Date; to: Date; label: string }` (rango `[from, to)` en UTC)
  - `interface SpendRow { day: string; origin: string; amount: number }`
  - `toSpendRows(raw: readonly unknown[]): SpendRow[]`
  - `summarize(rows: readonly SpendRow[]): { total: number; byDay: { day: string; amount: number }[]; byOrigin: { origin: string; label: string; amount: number }[] }`
  - `originLabel(origin: string): string`
  - `interface PlatformRow { tenantId: string; day: string; amount: number }`
  - `toPlatformRows(raw: readonly unknown[]): PlatformRow[]`
  - `platformTotals(rows: readonly PlatformRow[], now: Date): Map<string, { today: number; month: number; previous: number }>`
  - `usd(amount: number): string`
  - `dayLabel(day: string): string`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/usage/report.test.ts
import { describe, expect, it } from "vitest";
import {
	dayLabel,
	monthRange,
	originLabel,
	parsePeriod,
	platformTotals,
	summarize,
	toPlatformRows,
	toSpendRows,
	usd,
} from "@/lib/usage/report";

describe("parsePeriod", () => {
	it("solo acepta anterior; cualquier otra cosa es el mes en curso", () => {
		expect(parsePeriod("anterior")).toBe("anterior");
		expect(parsePeriod("actual")).toBe("actual");
		expect(parsePeriod(undefined)).toBe("actual");
		expect(parsePeriod(["anterior"])).toBe("actual");
	});
});

describe("monthRange", () => {
	const now = new Date("2026-10-13T15:00:00Z");

	it("mes en curso: del 1 al 1 del mes siguiente, en UTC", () => {
		const range = monthRange("actual", now);
		expect(range.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(range.to.toISOString()).toBe("2026-11-01T00:00:00.000Z");
		expect(range.label).toBe("octubre de 2026");
	});

	it("mes anterior", () => {
		const range = monthRange("anterior", now);
		expect(range.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
		expect(range.to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(range.label).toBe("septiembre de 2026");
	});

	it("en enero, el mes anterior es diciembre del año anterior", () => {
		const range = monthRange("anterior", new Date("2027-01-15T12:00:00Z"));
		expect(range.from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
		expect(range.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
		expect(range.label).toBe("diciembre de 2026");
	});

	it("corta en UTC aunque en Buenos Aires todavía sea el mes anterior", () => {
		// 2026-10-31 22:00 en Buenos Aires.
		const range = monthRange("actual", new Date("2026-11-01T01:00:00Z"));
		expect(range.label).toBe("noviembre de 2026");
	});
});

describe("toSpendRows y summarize", () => {
	const raw = [
		{ day: "2026-10-06", origin: "draft-queue", amount: "0.400000" },
		{ day: "2026-10-05", origin: "chat", amount: 0.1 },
		{ day: "2026-10-06", origin: "chat", amount: "0.200000" },
		{ day: "2026-10-06", origin: "sin_corrida", amount: 0.05 },
		{ day: 20261006, origin: "chat", amount: 1 },
		null,
	];

	it("descarta filas sin forma y convierte montos que llegan como texto", () => {
		expect(toSpendRows(raw)).toHaveLength(4);
		expect(toSpendRows(raw)[0]).toEqual({
			day: "2026-10-06",
			origin: "draft-queue",
			amount: 0.4,
		});
	});

	it("suma números: el total no concatena textos", () => {
		const summary = summarize(toSpendRows(raw));
		expect(summary.total).toBeCloseTo(0.75, 6);
	});

	it("por día, en orden de fecha", () => {
		const { byDay } = summarize(toSpendRows(raw));
		expect(byDay.map((row) => row.day)).toEqual(["2026-10-05", "2026-10-06"]);
		expect(byDay[1].amount).toBeCloseTo(0.65, 6);
	});

	it("por origen, de mayor a menor, con su rótulo", () => {
		const { byOrigin } = summarize(toSpendRows(raw));
		expect(byOrigin.map((row) => row.label)).toEqual([
			"draft-queue",
			"Chat",
			"Procesos programados",
		]);
		expect(byOrigin[1].amount).toBeCloseTo(0.3, 6);
	});

	it("sin filas, total cero y tablas vacías", () => {
		expect(summarize([])).toEqual({ total: 0, byDay: [], byOrigin: [] });
	});
});

describe("originLabel", () => {
	it("rotula chat y sin_corrida; un workflow muestra su clave", () => {
		expect(originLabel("chat")).toBe("Chat");
		expect(originLabel("sin_corrida")).toBe("Procesos programados");
		expect(originLabel("refresh-fichas")).toBe("refresh-fichas");
	});
});

describe("platformTotals", () => {
	it("separa hoy, mes en curso y mes anterior por empresa, en UTC", () => {
		const rows = toPlatformRows([
			{ tenant_id: "a", day: "2026-10-13", amount: "1.5" },
			{ tenant_id: "a", day: "2026-10-02", amount: 2 },
			{ tenant_id: "a", day: "2026-09-30", amount: 4 },
			{ tenant_id: "b", day: "2026-09-10", amount: "0.25" },
			{ tenant_id: "b", day: "2026-08-31", amount: 100 },
		]);
		const totals = platformTotals(rows, new Date("2026-10-13T23:00:00Z"));
		expect(totals.get("a")).toEqual({ today: 1.5, month: 3.5, previous: 4 });
		expect(totals.get("b")).toEqual({ today: 0, month: 0, previous: 0.25 });
	});
});

describe("formato", () => {
	it("usd con dos decimales en es-AR", () => {
		expect(usd(1234.5)).toBe("US$ 1.234,50");
		expect(usd(0)).toBe("US$ 0,00");
	});

	it("dayLabel no corre el día por la zona horaria", () => {
		expect(dayLabel("2026-10-05")).toBe("05/10/2026");
	});
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- tests/usage/report.test.ts`
Expected: FAIL, no encuentra `@/lib/usage/report`.

- [ ] **Step 3: Implementar**

```ts
// lib/usage/report.ts
// Reporte de gasto en modelos por período (spec 21.5 §5). Puro: recibe lo que
// devuelven tenant_spend_report y platform_spend_report. Todo en UTC (G7).

export type Period = "actual" | "anterior";

export function parsePeriod(value: unknown): Period {
	return value === "anterior" ? "anterior" : "actual";
}

const MONTHS = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];

/** Rango `[from, to)` del mes, en UTC. Date.UTC normaliza el mes -1 y el 12. */
export function monthRange(
	period: Period,
	now: Date,
): { from: Date; to: Date; label: string } {
	const shift = period === "actual" ? 0 : -1;
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth() + shift;
	const from = new Date(Date.UTC(year, month, 1));
	const to = new Date(Date.UTC(year, month + 1, 1));
	return {
		from,
		to,
		label: `${MONTHS[from.getUTCMonth()]} de ${from.getUTCFullYear()}`,
	};
}

// Postgres devuelve numeric como texto según el camino.
const num = (value: unknown): number => {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface SpendRow {
	day: string;
	origin: string;
	amount: number;
}

export function toSpendRows(raw: readonly unknown[]): SpendRow[] {
	return raw.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const row = entry as Record<string, unknown>;
		return typeof row.day === "string" &&
			DAY.test(row.day) &&
			typeof row.origin === "string"
			? [{ day: row.day, origin: row.origin, amount: num(row.amount) }]
			: [];
	});
}

const ORIGIN_LABELS: Record<string, string> = {
	chat: "Chat",
	sin_corrida: "Procesos programados",
};

export function originLabel(origin: string): string {
	return Object.hasOwn(ORIGIN_LABELS, origin) ? ORIGIN_LABELS[origin] : origin;
}

export function summarize(rows: readonly SpendRow[]): {
	total: number;
	byDay: { day: string; amount: number }[];
	byOrigin: { origin: string; label: string; amount: number }[];
} {
	const days = new Map<string, number>();
	const origins = new Map<string, number>();
	let total = 0;
	for (const row of rows) {
		total += row.amount;
		days.set(row.day, (days.get(row.day) ?? 0) + row.amount);
		origins.set(row.origin, (origins.get(row.origin) ?? 0) + row.amount);
	}
	return {
		total,
		byDay: [...days]
			.map(([day, amount]) => ({ day, amount }))
			.sort((a, b) => a.day.localeCompare(b.day)),
		byOrigin: [...origins]
			.map(([origin, amount]) => ({
				origin,
				label: originLabel(origin),
				amount,
			}))
			.sort((a, b) => b.amount - a.amount),
	};
}

export interface PlatformRow {
	tenantId: string;
	day: string;
	amount: number;
}

export function toPlatformRows(raw: readonly unknown[]): PlatformRow[] {
	return raw.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const row = entry as Record<string, unknown>;
		return typeof row.tenant_id === "string" &&
			typeof row.day === "string" &&
			DAY.test(row.day)
			? [{ tenantId: row.tenant_id, day: row.day, amount: num(row.amount) }]
			: [];
	});
}

export function platformTotals(
	rows: readonly PlatformRow[],
	now: Date,
): Map<string, { today: number; month: number; previous: number }> {
	const today = now.toISOString().slice(0, 10);
	const month = today.slice(0, 7);
	const previous = monthRange("anterior", now).from.toISOString().slice(0, 7);
	const totals = new Map<
		string,
		{ today: number; month: number; previous: number }
	>();
	for (const row of rows) {
		const entry = totals.get(row.tenantId) ?? {
			today: 0,
			month: 0,
			previous: 0,
		};
		if (row.day === today) entry.today += row.amount;
		if (row.day.startsWith(month)) entry.month += row.amount;
		if (row.day.startsWith(previous)) entry.previous += row.amount;
		totals.set(row.tenantId, entry);
	}
	return totals;
}

export function usd(amount: number): string {
	return `US$ ${amount.toLocaleString("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/** `2026-10-05` → `05/10/2026`, sin pasar por Date para no correr el día. */
export function dayLabel(day: string): string {
	const [year, month, date] = day.split("-");
	return `${date}/${month}/${year}`;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npm test -- tests/usage/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add lib/usage/report.ts tests/usage/report.test.ts
git commit -m "feat: rangos de mes en UTC y tablas del reporte de gasto"
```

---

### Task 7: Pantalla del cliente

**Files:**
- Create: `app/[tenant]/settings/gasto/page.tsx`
- Modify: `app/[tenant]/settings/page.tsx` (link nuevo junto a "Usuarios →")
- Test: `tests/settings/gasto-page.test.ts`

**Interfaces:**
- Consumes: `resolveTenantAccess` (`lib/tenants/resolve.ts`), `createServerSupabase`, la función `tenant_spend_report` (Task 5) y todo `lib/usage/report.ts` (Task 6).
- Produces: la ruta `/<slug>/settings/gasto`, con `?periodo=anterior` para el mes anterior.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/settings/gasto-page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	role: "tenant_admin" as string | null,
	rows: [] as unknown[],
	error: null as { message: string } | null,
	rpc: [] as unknown[],
};

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () =>
		state.role === null
			? null
			: { id: "t1", slug: "acme", displayName: "Acme", role: state.role },
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		rpc: async (name: string, args: unknown) => {
			state.rpc.push([name, args]);
			return { data: state.error ? null : state.rows, error: state.error };
		},
	}),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: GastoPage } = await import(
	"@/app/[tenant]/settings/gasto/page"
);

const render = async (periodo?: string) =>
	renderToStaticMarkup(
		await GastoPage({
			params: Promise.resolve({ tenant: "acme" }),
			searchParams: Promise.resolve(periodo ? { periodo } : {}),
		}),
	);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
	state.role = "tenant_admin";
	state.error = null;
	state.rpc = [];
	state.rows = [
		{ day: "2026-10-05", origin: "chat", amount: "0.100000" },
		{ day: "2026-10-06", origin: "draft-queue", amount: "1.400000" },
	];
});

describe("pantalla de gasto del cliente", () => {
	it("un miembro recibe 404", async () => {
		state.role = "tenant_member";
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(state.rpc).toEqual([]);
	});

	it("sin acceso a la empresa, 404", async () => {
		state.role = null;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("pide el mes en curso en UTC y muestra total, días y orígenes", async () => {
		const html = await render();
		expect(state.rpc).toEqual([
			[
				"tenant_spend_report",
				{
					p_tenant: "t1",
					p_from: "2026-10-01T00:00:00.000Z",
					p_to: "2026-11-01T00:00:00.000Z",
				},
			],
		]);
		expect(html).toContain("octubre de 2026");
		expect(html).toContain("US$ 1,50");
		expect(html).toContain("05/10/2026");
		expect(html).toContain("Chat");
		expect(html).toContain("draft-queue");
		expect(html).toContain("UTC");
	});

	it("con periodo=anterior pide el mes anterior", async () => {
		const html = await render("anterior");
		expect(state.rpc[0]).toEqual([
			"tenant_spend_report",
			expect.objectContaining({ p_from: "2026-09-01T00:00:00.000Z" }),
		]);
		expect(html).toContain("septiembre de 2026");
	});

	it("sin gasto, estado vacío y no una tabla en cero", async () => {
		state.rows = [];
		const html = await render();
		expect(html).toContain("No hay gasto registrado");
		expect(html).not.toContain("<table");
	});

	it("si la lectura falla, lo dice y no muestra cero", async () => {
		state.error = { message: "roto" };
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const html = await render();
		expect(html).toContain("No pude leer el gasto");
		expect(html).not.toContain("US$ 0,00");
		spy.mockRestore();
	});
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- tests/settings/gasto-page.test.ts`
Expected: FAIL, no encuentra la página.

- [ ] **Step 3: Implementar la página**

```tsx
// app/[tenant]/settings/gasto/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import {
	dayLabel,
	monthRange,
	type Period,
	parsePeriod,
	summarize,
	toSpendRows,
	usd,
} from "@/lib/usage/report";

const PERIODS: { key: Period; label: string }[] = [
	{ key: "actual", label: "Mes en curso" },
	{ key: "anterior", label: "Mes anterior" },
];

export default async function GastoPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ periodo?: string | string[] }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	// 404 y no 403, como el resto de settings: el gasto es del administrador.
	if (tenant.role === "tenant_member") notFound();

	const period = parsePeriod((await searchParams).periodo);
	const range = monthRange(period, new Date());

	let rows: ReturnType<typeof toSpendRows> | null = null;
	try {
		const supabase = await createServerSupabase();
		const { data, error } = await supabase.rpc("tenant_spend_report", {
			p_tenant: tenant.id,
			p_from: range.from.toISOString(),
			p_to: range.to.toISOString(),
		} as never);
		if (error) console.error("gasto: tenant_spend_report:", error);
		else rows = toSpendRows((data as unknown[] | null) ?? []);
	} catch (error) {
		console.error("gasto: tenant_spend_report:", error);
	}

	const summary = rows === null ? null : summarize(rows);

	return (
		<div className="max-w-3xl space-y-8">
			<div>
				<Link
					className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
					href={`/${slug}/settings`}
				>
					← Configuración
				</Link>
				<h1 className="text-3xl leading-tight">Gasto en modelos de IA</h1>
			</div>

			<nav aria-label="Período" className="flex gap-4 text-sm">
				{PERIODS.map(({ key, label }) => (
					<Link
						aria-current={key === period ? "page" : undefined}
						className={
							key === period
								? "font-medium underline underline-offset-4"
								: "text-muted-foreground hover:text-foreground"
						}
						href={
							key === "actual"
								? `/${slug}/settings/gasto`
								: `/${slug}/settings/gasto?periodo=${key}`
						}
						key={key}
					>
						{label}
					</Link>
				))}
			</nav>

			{summary === null ? (
				<p className="text-muted-foreground text-sm">
					No pude leer el gasto. Recargá la página.
				</p>
			) : summary.byDay.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No hay gasto registrado en {range.label}.
				</p>
			) : (
				<>
					<section>
						<h2 className="mb-1 text-lg capitalize">{range.label}</h2>
						<p className="text-3xl">{usd(summary.total)}</p>
					</section>

					<section>
						<h2 className="mb-3 text-lg">Por origen</h2>
						<div className="overflow-x-auto rounded-lg border bg-card">
							<table className="w-full text-sm">
								<thead className="text-left text-muted-foreground">
									<tr>
										<th className="px-4 py-2 font-normal">Origen</th>
										<th className="px-4 py-2 text-right font-normal">Gasto</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{summary.byOrigin.map((row) => (
										<tr key={row.origin}>
											<td className="px-4 py-2">{row.label}</td>
											<td className="px-4 py-2 text-right tabular-nums">
												{usd(row.amount)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>

					<section>
						<h2 className="mb-3 text-lg">Por día</h2>
						<div className="overflow-x-auto rounded-lg border bg-card">
							<table className="w-full text-sm">
								<thead className="text-left text-muted-foreground">
									<tr>
										<th className="px-4 py-2 font-normal">Día</th>
										<th className="px-4 py-2 text-right font-normal">Gasto</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{summary.byDay.map((row) => (
										<tr key={row.day}>
											<td className="px-4 py-2">{dayLabel(row.day)}</td>
											<td className="px-4 py-2 text-right tabular-nums">
												{usd(row.amount)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				</>
			)}

			<p className="text-muted-foreground text-xs">
				Los días cortan a la medianoche UTC (21:00 de Buenos Aires). El gasto
				del chat se registra desde que se activó esta pantalla; lo anterior no
				figura.
			</p>
		</div>
	);
}
```

- [ ] **Step 4: Link desde settings**

En `app/[tenant]/settings/page.tsx`, el link "Usuarios →" es el último del `return`. Agregarle `mr-6` a su `className` y sumar después:

```tsx
			<Link
				className="inline-block text-sm underline underline-offset-4"
				href={`/${slug}/settings/gasto`}
			>
				Gasto →
			</Link>
```

Antes de editar, confirmar en el archivo que esa pantalla ya devuelve 404 a un `tenant_member`; si un miembro puede verla, el link va dentro de la misma condición que muestra las secciones del administrador.

- [ ] **Step 5: Correr los tests y verlos pasar**

Run: `npm test -- tests/settings`
Expected: PASS. Si `tests/settings/settings-page.test.ts` cuenta links o compara el HTML exacto, actualizar esa expectativa para incluir "Gasto →".

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add "app/[tenant]/settings/gasto/page.tsx" "app/[tenant]/settings/page.tsx" tests/settings
git commit -m "feat: el administrador del cliente ve su gasto del mes"
```

---

### Task 8: Conciliación contra el gateway (lógica)

**Files:**
- Create: `lib/usage/reconcile.ts`
- Test: `tests/usage/reconcile.test.ts`

**Interfaces:**
- Consumes: `Period` de Task 6.
- Produces:
  - `TOLERANCE_USD = 1`, `TOLERANCE_PCT = 0.05`
  - `reconcileRange(period: Period, now: Date): { startDate: string; endDate: string; from: Date; to: Date } | null` (`startDate` y `endDate` inclusive en `YYYY-MM-DD`; `[from, to)` para el libro; `null` si no hay día cerrado)
  - `interface ReconcileLine { key: string; kind: "empresa" | "tag_sin_empresa" | "sin_etiqueta"; label: string; ledger: number; gateway: number; diff: number; diffPct: number | null; flagged: boolean }`
  - `reconcile(input: { tenants: { id: string; slug: string; name: string }[]; ledger: { tenantId: string; amount: number }[]; gatewayByTag: { tag?: string; totalCost: number }[]; gatewayTotal: number }): ReconcileLine[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/usage/reconcile.test.ts
import { describe, expect, it } from "vitest";
import { reconcile, reconcileRange } from "@/lib/usage/reconcile";

const tenants = [
	{ id: "id-a", slug: "acme", name: "Acme" },
	{ id: "id-b", slug: "beta", name: "Beta" },
];

describe("reconcileRange", () => {
	it("mes en curso: del 1 hasta ayer, en UTC", () => {
		const range = reconcileRange("actual", new Date("2026-10-13T15:00:00Z"));
		expect(range).toEqual({
			startDate: "2026-10-01",
			endDate: "2026-10-12",
			from: new Date("2026-10-01T00:00:00Z"),
			to: new Date("2026-10-13T00:00:00Z"),
		});
	});

	it("mes anterior: el mes completo", () => {
		const range = reconcileRange("anterior", new Date("2026-10-13T15:00:00Z"));
		expect(range).toMatchObject({
			startDate: "2026-09-01",
			endDate: "2026-09-30",
		});
		expect(range?.to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
	});

	it("el día 1 no hay día cerrado en el mes en curso", () => {
		expect(
			reconcileRange("actual", new Date("2026-10-01T10:00:00Z")),
		).toBeNull();
	});

	it("el día 1, el mes anterior sí se puede conciliar", () => {
		expect(
			reconcileRange("anterior", new Date("2026-10-01T10:00:00Z")),
		).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-30" });
	});
});

describe("reconcile", () => {
	it("una empresa que cierra dentro de la tolerancia no se marca", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 10.4 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 10 }],
			gatewayTotal: 10,
		});
		expect(lines[0]).toMatchObject({
			kind: "empresa",
			label: "Acme",
			ledger: 10.4,
			gateway: 10,
			flagged: false,
		});
		expect(lines[0].diff).toBeCloseTo(0.4, 6);
		expect(lines[0].diffPct).toBeCloseTo(0.04, 6);
	});

	it("marca la diferencia que supera el mayor entre US$ 1 y el 5 %", () => {
		const big = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 106 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 100 }],
			gatewayTotal: 100,
		});
		expect(big[0].flagged).toBe(true);

		// 6 % pero 60 centavos: por debajo de US$ 1 no se marca.
		const small = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 10.6 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 10 }],
			gatewayTotal: 10,
		});
		expect(small[0].flagged).toBe(false);
	});

	it("empresa en el libro sin tag en el gateway: gateway cero y sin porcentaje", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-b", amount: 3 }],
			gatewayByTag: [],
			gatewayTotal: 0,
		});
		const beta = lines.find((line) => line.label === "Beta");
		expect(beta).toMatchObject({
			ledger: 3,
			gateway: 0,
			diffPct: null,
			flagged: true,
		});
	});

	it("un tag con el id de la empresa se le atribuye igual que el del slug", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 5 }],
			gatewayByTag: [
				{ tag: "tenant:acme", totalCost: 4 },
				{ tag: "tenant:id-a", totalCost: 1 },
			],
			gatewayTotal: 5,
		});
		expect(lines.find((line) => line.label === "Acme")).toMatchObject({
			gateway: 5,
			flagged: false,
		});
		expect(lines.some((line) => line.kind === "tag_sin_empresa")).toBe(false);
	});

	it("un tag de una empresa que no existe queda en su propia fila", () => {
		const lines = reconcile({
			tenants,
			ledger: [],
			gatewayByTag: [{ tag: "tenant:fantasma", totalCost: 2 }],
			gatewayTotal: 2,
		});
		expect(lines.find((line) => line.kind === "tag_sin_empresa")).toMatchObject(
			{ label: "tenant:fantasma", ledger: 0, gateway: 2, flagged: true },
		);
	});

	it("la fila sin etiqueta es el total menos los tags de empresa", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 10 }],
			gatewayByTag: [
				{ tag: "tenant:acme", totalCost: 10 },
				{ tag: "otra-cosa", totalCost: 99 },
			],
			gatewayTotal: 12.5,
		});
		expect(lines.at(-1)).toMatchObject({
			kind: "sin_etiqueta",
			label: "Sin etiqueta",
			gateway: 2.5,
			flagged: true,
		});
	});

	it("sin gasto sin etiqueta, la fila está y no se marca", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 10 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 10 }],
			gatewayTotal: 10,
		});
		expect(lines.at(-1)).toMatchObject({
			kind: "sin_etiqueta",
			gateway: 0,
			flagged: false,
		});
	});

	it("una empresa sin gasto en ningún lado no aparece", () => {
		const lines = reconcile({
			tenants,
			ledger: [{ tenantId: "id-a", amount: 1 }],
			gatewayByTag: [{ tag: "tenant:acme", totalCost: 1 }],
			gatewayTotal: 1,
		});
		expect(lines.some((line) => line.label === "Beta")).toBe(false);
	});
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- tests/usage/reconcile.test.ts`
Expected: FAIL, no encuentra `@/lib/usage/reconcile`.

- [ ] **Step 3: Implementar**

```ts
// lib/usage/reconcile.ts
// Compara el libro (usage_entries) contra el reporte del AI Gateway por tag
// (spec 21.5 §5.3). Puro: la acción junta los datos y esto arma la tabla.
import { monthRange, type Period } from "./report";

export const TOLERANCE_USD = 1;
export const TOLERANCE_PCT = 0.05;

const TAG_PREFIX = "tenant:";
const DAY_MS = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Qué días conciliar. El mes en curso llega hasta ayer: el gateway demora en
 * ingerir y el día de hoy nunca cierra. `startDate` y `endDate` son inclusive
 * (así los pide el gateway); `[from, to)` es el mismo rango para el libro.
 * `null` si todavía no hay un día cerrado.
 */
export function reconcileRange(
	period: Period,
	now: Date,
): { startDate: string; endDate: string; from: Date; to: Date } | null {
	const month = monthRange(period, now);
	const today = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const to = period === "actual" ? today : month.to;
	if (to.getTime() <= month.from.getTime()) return null;
	return {
		startDate: isoDay(month.from),
		endDate: isoDay(new Date(to.getTime() - DAY_MS)),
		from: month.from,
		to,
	};
}

export interface ReconcileLine {
	key: string;
	kind: "empresa" | "tag_sin_empresa" | "sin_etiqueta";
	label: string;
	ledger: number;
	gateway: number;
	diff: number;
	diffPct: number | null;
	flagged: boolean;
}

function line(
	base: Pick<ReconcileLine, "key" | "kind" | "label">,
	ledger: number,
	gateway: number,
): ReconcileLine {
	const diff = ledger - gateway;
	return {
		...base,
		ledger,
		gateway,
		diff,
		diffPct: gateway > 0 ? diff / gateway : null,
		flagged: Math.abs(diff) > Math.max(TOLERANCE_USD, TOLERANCE_PCT * gateway),
	};
}

export function reconcile(input: {
	tenants: { id: string; slug: string; name: string }[];
	ledger: { tenantId: string; amount: number }[];
	gatewayByTag: { tag?: string; totalCost: number }[];
	gatewayTotal: number;
}): ReconcileLine[] {
	const ledger = new Map<string, number>();
	for (const row of input.ledger) {
		ledger.set(row.tenantId, (ledger.get(row.tenantId) ?? 0) + row.amount);
	}

	// El tag lleva el slug; si la base falló al resolverlo lleva el id
	// (lib/workflows/gateway-options.ts). Los dos son de la misma empresa.
	const byKey = new Map<string, string>();
	for (const tenant of input.tenants) {
		byKey.set(tenant.slug, tenant.id);
		byKey.set(tenant.id, tenant.id);
	}

	const gateway = new Map<string, number>();
	const orphans = new Map<string, number>();
	let tagged = 0;
	for (const row of input.gatewayByTag) {
		if (!row.tag?.startsWith(TAG_PREFIX)) continue;
		tagged += row.totalCost;
		const tenantId = byKey.get(row.tag.slice(TAG_PREFIX.length));
		if (tenantId) {
			gateway.set(tenantId, (gateway.get(tenantId) ?? 0) + row.totalCost);
		} else {
			orphans.set(row.tag, (orphans.get(row.tag) ?? 0) + row.totalCost);
		}
	}

	const lines: ReconcileLine[] = [];
	for (const tenant of input.tenants) {
		const inLedger = ledger.get(tenant.id) ?? 0;
		const inGateway = gateway.get(tenant.id) ?? 0;
		if (inLedger === 0 && inGateway === 0) continue;
		lines.push(
			line(
				{ key: tenant.id, kind: "empresa", label: tenant.name },
				inLedger,
				inGateway,
			),
		);
	}
	for (const [tag, cost] of orphans) {
		// Gasto del gateway que el libro no puede atribuir: siempre se marca.
		lines.push({
			...line({ key: tag, kind: "tag_sin_empresa", label: tag }, 0, cost),
			flagged: true,
		});
	}

	// Lo que el gateway cobró sin tag de empresa: una llamada sin etiquetar.
	// Medio centavo de margen por redondeo del reporte.
	const untagged = Math.max(0, input.gatewayTotal - tagged);
	lines.push({
		...line(
			{ key: "sin_etiqueta", kind: "sin_etiqueta", label: "Sin etiqueta" },
			0,
			untagged,
		),
		flagged: untagged > 0.005,
	});
	return lines;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npm test -- tests/usage/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add lib/usage/reconcile.ts tests/usage/reconcile.test.ts
git commit -m "feat: comparación del libro de consumo contra el gateway"
```

---

### Task 9: Pantalla de plataforma y acción de conciliar

**Files:**
> Nota de la revisión final: la página y la acción de abajo se escribieron con `platform_spend_report` por empresa x día. Quedaron con una fila por empresa (tres consultas en paralelo en la página, una en la acción); el código vigente es el del repo.

- Create: `app/plataforma/gasto/page.tsx`
- Create: `app/plataforma/gasto/actions.ts`
- Create: `app/plataforma/gasto/reconcile-panel.tsx`
- Modify: `app/plataforma/page.tsx` (link a la pantalla nueva)
- Test: `tests/plataforma/gasto-page.test.ts`, `tests/plataforma/gasto-actions.test.ts`

**Interfaces:**
- Consumes: `requirePlatformAdmin` (`lib/tenants/platform.ts`), `createAdminClient`, `platform_spend_report` (Task 5), `lib/usage/report.ts` (Task 6), `lib/usage/reconcile.ts` (Task 8), `gateway` de `ai`.
- Produces:
  - `reconcileSpend(period: unknown): Promise<ReconcileResult>`
  - `type ReconcileResult = { ok: true; startDate: string; endDate: string; lines: ReconcileLine[] } | { ok: false; message: string }`
  - La ruta `/plataforma/gasto`.

- [ ] **Step 1: Escribir el test de la acción**

```ts
// tests/plataforma/gasto-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	admin: true,
	tenants: [{ id: "id-a", slug: "acme", display_name: "Acme" }] as unknown[],
	ledger: [{ tenant_id: "id-a", day: "2026-10-05", amount: "10.000000" }] as unknown[],
	dbError: null as { message: string } | null,
	gatewayError: null as Error | null,
	reports: [] as unknown[],
	rpc: [] as unknown[],
};

vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { userId: "u1", supabase: {} } : null,
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: async () => ({ data: state.tenants, error: state.dbError }),
		}),
		rpc: async (name: string, args: unknown) => {
			state.rpc.push([name, args]);
			return { data: state.ledger, error: state.dbError };
		},
	}),
}));
vi.mock("ai", () => ({
	gateway: {
		getSpendReport: async (params: { groupBy: string }) => {
			state.reports.push(params);
			if (state.gatewayError) throw state.gatewayError;
			return params.groupBy === "tag"
				? { results: [{ tag: "tenant:acme", totalCost: 10 }] }
				: { results: [{ day: "2026-10-05", totalCost: 12 }] };
		},
	},
}));

const { reconcileSpend } = await import("@/app/plataforma/gasto/actions");

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
	state.admin = true;
	state.dbError = null;
	state.gatewayError = null;
	state.reports = [];
	state.rpc = [];
});

describe("reconcileSpend", () => {
	it("sin permiso de plataforma no consulta nada", async () => {
		state.admin = false;
		expect(await reconcileSpend("actual")).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});
		expect(state.reports).toEqual([]);
		expect(state.rpc).toEqual([]);
	});

	it("pide el mismo rango al libro y al gateway, y arma las líneas", async () => {
		const result = await reconcileSpend("actual");
		expect(state.rpc).toEqual([
			[
				"platform_spend_report",
				{
					p_from: "2026-10-01T00:00:00.000Z",
					p_to: "2026-10-13T00:00:00.000Z",
				},
			],
		]);
		expect(state.reports).toEqual([
			{ startDate: "2026-10-01", endDate: "2026-10-12", groupBy: "tag" },
			{ startDate: "2026-10-01", endDate: "2026-10-12", groupBy: "day" },
		]);
		expect(result).toMatchObject({
			ok: true,
			startDate: "2026-10-01",
			endDate: "2026-10-12",
		});
		if (!result.ok) throw new Error("esperaba ok");
		expect(result.lines).toEqual([
			expect.objectContaining({ label: "Acme", ledger: 10, gateway: 10 }),
			expect.objectContaining({ kind: "sin_etiqueta", gateway: 2 }),
		]);
	});

	it("el día 1, el mes en curso responde con un mensaje y no consulta", async () => {
		vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
		const result = await reconcileSpend("actual");
		expect(result.ok).toBe(false);
		expect(state.reports).toEqual([]);
	});

	it("si el gateway rechaza, muestra el motivo", async () => {
		state.gatewayError = new Error("Custom Reporting requires a Pro plan");
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await reconcileSpend("anterior")).toEqual({
			ok: false,
			message:
				"El gateway rechazó la consulta: Custom Reporting requires a Pro plan",
		});
		spy.mockRestore();
	});

	it("si falla la base, no consulta al gateway", async () => {
		state.dbError = { message: "roto" };
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await reconcileSpend("actual");
		expect(result).toEqual({
			ok: false,
			message: "No pude leer el libro de consumo. Probá de nuevo.",
		});
		expect(state.reports).toEqual([]);
		spy.mockRestore();
	});
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- tests/plataforma/gasto-actions.test.ts`
Expected: FAIL, no encuentra el módulo.

- [ ] **Step 3: Implementar la acción**

```ts
// app/plataforma/gasto/actions.ts
"use server";

import { gateway } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import {
	type ReconcileLine,
	reconcile,
	reconcileRange,
} from "@/lib/usage/reconcile";
import { parsePeriod, toPlatformRows } from "@/lib/usage/report";

export type ReconcileResult =
	| { ok: true; startDate: string; endDate: string; lines: ReconcileLine[] }
	| { ok: false; message: string };

/**
 * Compara el libro contra el reporte del AI Gateway (spec 21.5 §5.3). A
 * pedido: cada consulta al reporte se cobra, así que no corre al cargar la
 * página. El resultado no se guarda.
 */
export async function reconcileSpend(period: unknown): Promise<ReconcileResult> {
	// Fuera del try: puede redirigir tirando.
	const actor = await requirePlatformAdmin();
	if (!actor) return { ok: false, message: "No tenés permiso." };

	const range = reconcileRange(parsePeriod(period), new Date());
	if (!range) {
		return {
			ok: false,
			message:
				"Todavía no hay un día cerrado este mes. Probá mañana o conciliá el mes anterior.",
		};
	}

	let tenants: { id: string; slug: string; name: string }[];
	let ledger: { tenantId: string; amount: number }[];
	try {
		const admin = createAdminClient();
		const [tenantsResult, ledgerResult] = await Promise.all([
			admin.from("tenants").select("id, slug, display_name"),
			admin.rpc("platform_spend_report", {
				p_from: range.from.toISOString(),
				p_to: range.to.toISOString(),
			} as never),
		]);
		const error = tenantsResult.error ?? ledgerResult.error;
		if (error) throw new Error(error.message);
		tenants = (
			(tenantsResult.data ?? []) as {
				id: string;
				slug: string;
				display_name: string;
			}[]
		).map((row) => ({ id: row.id, slug: row.slug, name: row.display_name }));
		ledger = toPlatformRows((ledgerResult.data as unknown[] | null) ?? []);
	} catch (error) {
		console.error("conciliación: libro:", error);
		return {
			ok: false,
			message: "No pude leer el libro de consumo. Probá de nuevo.",
		};
	}

	try {
		const dates = { startDate: range.startDate, endDate: range.endDate };
		const [byTag, byDay] = await Promise.all([
			gateway.getSpendReport({ ...dates, groupBy: "tag" }),
			gateway.getSpendReport({ ...dates, groupBy: "day" }),
		]);
		return {
			ok: true,
			...dates,
			lines: reconcile({
				tenants,
				ledger,
				gatewayByTag: byTag.results,
				gatewayTotal: byDay.results.reduce(
					(sum, row) => sum + row.totalCost,
					0,
				),
			}),
		};
	} catch (error) {
		console.error("conciliación: gateway:", error);
		const reason = error instanceof Error ? error.message : "error desconocido";
		return { ok: false, message: `El gateway rechazó la consulta: ${reason}` };
	}
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npm test -- tests/plataforma/gasto-actions.test.ts tests/server-actions-exports.test.ts`
Expected: PASS. `server-actions-exports` verifica que un archivo `"use server"` solo exporte funciones asíncronas y tipos; si rechaza el `export type`, mover `ReconcileResult` a `lib/usage/reconcile.ts` e importarlo desde ahí en la acción y en el panel.

- [ ] **Step 5: Panel de conciliación (cliente)**

```tsx
// app/plataforma/gasto/reconcile-panel.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { type Period, usd } from "@/lib/usage/report";
import { type ReconcileResult, reconcileSpend } from "./actions";

const PERIODS: { key: Period; label: string }[] = [
	{ key: "actual", label: "Mes en curso (hasta ayer)" },
	{ key: "anterior", label: "Mes anterior" },
];

const pct = (value: number | null) =>
	value === null
		? "—"
		: `${(value * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

export function ReconcilePanel() {
	const [result, setResult] = useState<ReconcileResult | null>(null);
	const [pending, startTransition] = useTransition();

	const run = (period: Period) =>
		startTransition(async () => {
			try {
				setResult(await reconcileSpend(period));
			} catch (error) {
				console.error("conciliación:", error);
				setResult({
					ok: false,
					message: "No pude conciliar. Probá de nuevo.",
				});
			}
		});

	return (
		<section>
			<h2 className="mb-1 text-lg">Conciliar con el gateway</h2>
			<p className="mb-3 text-muted-foreground text-sm">
				Compara lo asentado acá contra lo que cobró el AI Gateway por empresa.
				Cada consulta tiene costo, por eso es a pedido.
			</p>
			<div className="mb-4 flex flex-wrap gap-3">
				{PERIODS.map(({ key, label }) => (
					<Button
						disabled={pending}
						key={key}
						onClick={() => run(key)}
						variant="outline"
					>
						{label}
					</Button>
				))}
			</div>

			{pending ? (
				<p className="text-muted-foreground text-sm">Consultando el gateway…</p>
			) : null}

			{!pending && result && !result.ok ? (
				<p className="text-destructive text-sm" role="alert">
					{result.message}
				</p>
			) : null}

			{!pending && result?.ok ? (
				<>
					<p className="mb-2 text-muted-foreground text-sm">
						Del {result.startDate} al {result.endDate}, en UTC.
					</p>
					<div className="overflow-x-auto rounded-lg border bg-card">
						<table className="w-full text-sm">
							<thead className="text-left text-muted-foreground">
								<tr>
									<th className="px-4 py-2 font-normal">Empresa</th>
									<th className="px-4 py-2 text-right font-normal">Libro</th>
									<th className="px-4 py-2 text-right font-normal">Gateway</th>
									<th className="px-4 py-2 text-right font-normal">
										Diferencia
									</th>
									<th className="px-4 py-2 text-right font-normal">%</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{result.lines.map((line) => (
									<tr
										className={line.flagged ? "text-destructive" : undefined}
										key={line.key}
									>
										<td className="px-4 py-2">
											{line.label}
											{line.flagged ? " · revisar" : ""}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(line.ledger)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(line.gateway)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(line.diff)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{pct(line.diffPct)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="mt-2 text-muted-foreground text-xs">
						Se marca una diferencia mayor a US$ 1 o al 5 %, la que sea más
						grande. Causas conocidas: pasos abortados o fallidos que el gateway
						cobra y nadie informa, asientos con precio de tabla, la compactación
						de contexto y la demora de ingesta del gateway. "Sin etiqueta" es lo
						que el gateway cobró sin tag de empresa: si no es cero, alguna
						llamada salió sin etiquetar.
					</p>
				</>
			) : null}
		</section>
	);
}
```

- [ ] **Step 6: Escribir el test de la página**

```ts
// tests/plataforma/gasto-page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	admin: true,
	tenants: [] as unknown[],
	ledger: [] as unknown[],
	error: null as { message: string } | null,
	rpc: [] as unknown[],
};

vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { userId: "u1", supabase: {} } : null,
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: () => ({
				order: async () => ({ data: state.tenants, error: null }),
			}),
		}),
		rpc: async (name: string, args: unknown) => {
			state.rpc.push([name, args]);
			return { data: state.error ? null : state.ledger, error: state.error };
		},
	}),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));
vi.mock("@/app/plataforma/gasto/reconcile-panel", () => ({
	ReconcilePanel: () => null,
}));

const { default: GastoPlataformaPage } = await import(
	"@/app/plataforma/gasto/page"
);
const render = async () => renderToStaticMarkup(await GastoPlataformaPage());

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
	state.admin = true;
	state.error = null;
	state.rpc = [];
	state.tenants = [
		{ id: "id-a", slug: "acme", display_name: "Acme" },
		{ id: "id-b", slug: "beta", display_name: "Beta" },
	];
	state.ledger = [
		{ tenant_id: "id-a", day: "2026-10-13", amount: "1.500000" },
		{ tenant_id: "id-a", day: "2026-10-02", amount: "2.000000" },
		{ tenant_id: "id-a", day: "2026-09-30", amount: "4.000000" },
	];
});

describe("gasto por empresa en plataforma", () => {
	it("sin permiso de plataforma, 404 y ninguna lectura", async () => {
		state.admin = false;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(state.rpc).toEqual([]);
	});

	it("pide desde el 1 del mes anterior y muestra hoy, mes y mes anterior", async () => {
		const html = await render();
		expect(state.rpc[0]).toEqual([
			"platform_spend_report",
			{
				p_from: "2026-09-01T00:00:00.000Z",
				p_to: "2026-11-01T00:00:00.000Z",
			},
		]);
		expect(html).toContain("Acme");
		expect(html).toContain("US$ 1,50");
		expect(html).toContain("US$ 3,50");
		expect(html).toContain("US$ 4,00");
		expect(html).toContain('href="/plataforma/acme"');
	});

	it("una empresa sin gasto aparece en cero", async () => {
		const html = await render();
		expect(html).toContain("Beta");
		expect(html).toContain("US$ 0,00");
	});

	it("muestra la fila de total", async () => {
		expect(await render()).toContain("Total");
	});

	it("si la lectura falla, lo dice y no muestra ceros", async () => {
		state.error = { message: "roto" };
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const html = await render();
		expect(html).toContain("No pude leer el gasto");
		expect(html).not.toContain("US$ 0,00");
		spy.mockRestore();
	});
});
```

- [ ] **Step 7: Correr el test y verlo fallar**

Run: `npm test -- tests/plataforma/gasto-page.test.ts`
Expected: FAIL, no encuentra la página.

- [ ] **Step 8: Implementar la página**

```tsx
// app/plataforma/gasto/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import {
	monthRange,
	platformTotals,
	toPlatformRows,
	usd,
} from "@/lib/usage/report";
import { ReconcilePanel } from "./reconcile-panel";

interface TenantRow {
	id: string;
	slug: string;
	display_name: string;
}

const ZERO = { today: 0, month: 0, previous: 0 };

export default async function GastoPlataformaPage() {
	// 404 y no 403: un 403 confirma que la consola existe.
	const actor = await requirePlatformAdmin();
	if (!actor) notFound();

	const now = new Date();
	const current = monthRange("actual", now);
	const previous = monthRange("anterior", now);

	let tenants: TenantRow[] = [];
	let loaded: ReturnType<typeof platformTotals> | null = null;
	try {
		// platform_spend_report es de service_role: se llama recién después de
		// comprobar que quien entra es platform_admin.
		const admin = createAdminClient();
		const [tenantsResult, ledgerResult] = await Promise.all([
			admin
				.from("tenants")
				.select("id, slug, display_name")
				.order("display_name"),
			admin.rpc("platform_spend_report", {
				p_from: previous.from.toISOString(),
				p_to: current.to.toISOString(),
			} as never),
		]);
		const error = tenantsResult.error ?? ledgerResult.error;
		if (error) {
			console.error("gasto de plataforma:", error);
		} else {
			tenants = (tenantsResult.data ?? []) as TenantRow[];
			loaded = platformTotals(
				toPlatformRows((ledgerResult.data as unknown[] | null) ?? []),
				now,
			);
		}
	} catch (error) {
		console.error("gasto de plataforma:", error);
	}
	// const: el narrowing de un `let` no llega a los callbacks del JSX.
	const totals = loaded;

	const sum = { ...ZERO };
	if (totals) {
		for (const tenant of tenants) {
			const row = totals.get(tenant.id) ?? ZERO;
			sum.today += row.today;
			sum.month += row.month;
			sum.previous += row.previous;
		}
	}

	return (
		<div className="max-w-3xl space-y-10">
			<div>
				<Link
					className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
					href="/plataforma"
				>
					← Empresas
				</Link>
				<h1 className="text-3xl leading-tight">Gasto en modelos de IA</h1>
				<p className="text-muted-foreground text-sm">
					Lo asentado en el libro de consumo, con los días en UTC.
				</p>
			</div>

			{totals === null ? (
				<p className="text-muted-foreground text-sm">
					No pude leer el gasto. Recargá la página.
				</p>
			) : (
				<div className="overflow-x-auto rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead className="text-left text-muted-foreground">
							<tr>
								<th className="px-4 py-2 font-normal">Empresa</th>
								<th className="px-4 py-2 text-right font-normal">Hoy</th>
								<th className="px-4 py-2 text-right font-normal capitalize">
									{current.label}
								</th>
								<th className="px-4 py-2 text-right font-normal capitalize">
									{previous.label}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{tenants.map((tenant) => {
								const row = totals.get(tenant.id) ?? ZERO;
								return (
									<tr key={tenant.id}>
										<td className="px-4 py-2">
											<Link
												className="underline underline-offset-4"
												href={`/plataforma/${tenant.slug}`}
											>
												{tenant.display_name}
											</Link>
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(row.today)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(row.month)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(row.previous)}
										</td>
									</tr>
								);
							})}
						</tbody>
						<tfoot className="border-t font-medium">
							<tr>
								<td className="px-4 py-2">Total</td>
								<td className="px-4 py-2 text-right tabular-nums">
									{usd(sum.today)}
								</td>
								<td className="px-4 py-2 text-right tabular-nums">
									{usd(sum.month)}
								</td>
								<td className="px-4 py-2 text-right tabular-nums">
									{usd(sum.previous)}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
			)}

			<ReconcilePanel />
		</div>
	);
}
```

- [ ] **Step 9: Link desde la lista de empresas**

En `app/plataforma/page.tsx`, el encabezado tiene el `<h1>Empresas</h1>` y el botón "Nueva empresa" dentro de un `div` con `justify-between`. Envolver el botón y un link nuevo en un contenedor:

```tsx
				<div className="flex items-center gap-4">
					<Link
						className="text-sm underline underline-offset-4"
						href="/plataforma/gasto"
					>
						Gasto
					</Link>
					<Button asChild size="lg">
						<Link href="/plataforma/nueva">Nueva empresa</Link>
					</Button>
				</div>
```

- [ ] **Step 10: Correr los tests y verlos pasar**

Run: `npm test -- tests/plataforma tests/server-actions-exports.test.ts`
Expected: PASS. Si `tests/plataforma/list-page.test.ts` compara el HTML del encabezado, actualizar esa expectativa para incluir el link "Gasto".

- [ ] **Step 11: Commit**

```bash
npm run typecheck
git add app/plataforma/gasto app/plataforma/page.tsx tests/plataforma
git commit -m "feat: gasto por empresa en plataforma y conciliación con el gateway"
```

---

### Task 10: Wiki, roadmap y verificación completa

**Files:**
- Modify: `docs/arquitectura/modelos-y-costos.md`, `docs/dominios/plataforma.md`
- Modify: `docs/producto/roadmap.md` (línea 21.5)
- Regenerado: `docs/referencia/` con `npm run docs:sync`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `npm run docs:check` en verde.

- [ ] **Step 1: Ver qué pide la wiki**

Run: `npm run docs:sync && npm run docs:check`
Expected: FAIL. Lista al menos las dos rutas nuevas (`/[tenant]/settings/gasto` y `/plataforma/gasto`) sin página. No se agrega ninguna exclusión en `docs/_meta/cobertura.ts`: se escribe la página.

- [ ] **Step 2: Documentar con la skill**

Invocar `/docs-wiki` y seguirla. Lo que tiene que quedar escrito, como mínimo:

En `docs/arquitectura/modelos-y-costos.md`:
- En "Por dónde se llama a un modelo": toda llamada sale con el tag `tenant:<slug>`; lo arma `lib/workflows/gateway-options.ts`; `tests/workflows/model-calls.test.ts` falla si una puerta no lo usa; en el chat sale del modelo dinámico (`modelSelection` en `lib/agents/model.ts`).
- En "El libro de consumo: `usage_entries`": los pasos del agente en el chat asientan con `node: agent/step` desde `agents/outreach/hooks/usage.ts`; cuentan contra el mismo límite diario de `model_usd`; el chat no se corta por presupuesto.
- Sección nueva "Reporte por período y conciliación": las dos funciones de lectura, el corte en UTC, la ruta `/[tenant]/settings/gasto`, la ruta `/plataforma/gasto`, la tolerancia y las causas conocidas de diferencia.
- En "Decisiones": link a la spec de la 21.5 y por qué tags y no una clave por empresa.
- Sumar a `sources` del frontmatter: la spec de la 21.5, `lib/workflows/gateway-options.ts`, `lib/agents/step-usage.ts`, `agents/outreach/hooks/usage.ts`, `lib/usage/report.ts`, `lib/usage/reconcile.ts` y la migración `20261022120000_spend_report.sql`. Actualizar `updated`.

En `docs/dominios/plataforma.md`:
- En "Dónde vive en el código" y "Cómo funciona": la pantalla `/plataforma/gasto`, que lee con `service_role` después de `requirePlatformAdmin`, y el botón de conciliar. Actualizar `updated` y `sources`.

- [ ] **Step 3: Roadmap**

La fila de `docs/decisiones/README.md` y la línea "Spec/Plan" de la Etapa 21 ya apuntan a este plan. En `docs/producto/roadmap.md`, en la línea de la 21.5, reemplazar `Spec y plan escritos; falta implementar.` por:

```markdown
Código terminado; falta el cierre en producción. **Antes de desplegar:** `npx supabase migration list` y aplicar `20261022120000_spend_report` antes que el código; confirmar en Vercel que el equipo tiene Custom Reporting. **Después del deploy:** mandar un mensaje por el chat de `innovas` y comprobar los asientos `agent/step`; revisar el límite diario de `model_usd` de cada empresa, porque el chat ahora suma contra él; al día siguiente, conciliar.
```

- [ ] **Step 4: Verificación completa**

```bash
npm run docs:sync && npm run docs:check
```

Expected: PASS.

```bash
npm run lint:fix
```

Después, `git status`: biome reformatea siempre cuatro archivos ajenos a esta rama. Revertir con `git checkout -- <archivo>` todo archivo modificado que esta rama no tocó.

```bash
npm run typecheck && npm test
```

Expected: sin errores y la suite completa en verde.

```bash
npm run db:test
```

Expected: PASS (Docker abierto).

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: wiki y roadmap de la etapa 21.5"
```

- [ ] **Step 6: Probar en el navegador contra la base local**

`preview_start` levanta el checkout principal contra producción y no sirve para un worktree: seguir la memoria `reference_preview_start_no_sirve_worktrees.md` para levantar este worktree contra la base local. Con `npm run db:reset` hecho y la empresa `demo` de la semilla, insertar algunos asientos de prueba en la base local para que haya qué mostrar:

```sql
insert into public.usage_entries (tenant_id, workflow, node, resource, amount, unit, created_at)
select id, null, 'agent/step', 'model_usd', 0.42, 'usd', now() - interval '1 day' from public.tenants where slug = 'demo'
union all
select id, 'draft-queue', 'outreach/draft', 'model_usd', 1.10, 'usd', now() - interval '35 days' from public.tenants where slug = 'demo';
```

Comprobar con `/qa`:
- Como `tenant_admin` de `demo`: `/demo/settings/gasto` muestra el total y las dos tablas; "Mes anterior" cambia el período; el link "Gasto →" aparece en `/demo/settings`; a 375 px no hay desborde horizontal de la página.
- Como `tenant_member`: `/demo/settings/gasto` da 404.
- Como `platform_admin`: `/plataforma/gasto` lista las empresas con hoy, mes y mes anterior, y la fila de total; el link "Gasto" aparece en `/plataforma`. Apretar "Mes anterior" en el panel de conciliación: en local el gateway rechaza la consulta y la pantalla muestra "El gateway rechazó la consulta: …" sin romper el resto.
- Sin sesión de plataforma: `/plataforma/gasto` da 404.

Anotar en la línea 21.5 del roadmap, como sub-ítems, qué quedó verificado en el navegador y qué necesita producción, con el mismo formato que la 21.3.

- [ ] **Step 7: PR**

Usar `/ship`. El PR sale de `feat/etapa-21-5-gasto-ia` contra `main` e incluye la spec y este plan.

---

## Cierre en producción (con Mati, después del merge)

No lo ejecuta un agente por su cuenta: aplicar una migración en producción pide confirmación explícita.

- [ ] **Orden de despliegue con la 22.1.** Si `20261022120000` (21.5) llega a producción antes que `20261021120000_asistente_agent` (22.1), `supabase db push` se niega sin `--include-all`. Anotarlo en los pasos de despliegue de la 22.1.
- [ ] **Cuando entre la 22.1:** cablear `modelSelection` en `tenantModel` y copiar `hooks/usage.ts` en cada agente nuevo. `tests/agents/usage-wiring.test.ts` lo exige y falla hasta que estén.
- [ ] Mirar en producción los `agent/step` reales: `meta.model` y `meta.source`, y que el id de modelo tenga el formato esperado con la selección por objeto.
- [ ] Antes de juzgar "Sin etiqueta", revisar si el team de Vercel tiene otro tráfico por el gateway (evals, scripts, previews): el reporte es de todo el team.
- [ ] Reemplazar el texto "desde que se activó esta pantalla" de `/<slug>/settings/gasto` por la fecha real del deploy (spec §5.1).
- [ ] Confirmar en Vercel que el equipo tiene Custom Reporting y cuánto cobra por consulta. Si no lo tiene, seguir igual: solo el botón de conciliar queda sin efecto.
- [ ] `npx supabase migration list`. `db push` aplica todas las pendientes: confirmar cuáles son ajenas antes de aplicar `20261022120000_spend_report`. La migración va antes que el código.
- [ ] Desplegar.
- [ ] Mandar un mensaje real por el chat de `innovas`. Comprobar en la base que hay asientos con `node = 'agent/step'` para ese turno y que `runs.cost_usd` de la corrida los incluye.
- [ ] En los logs del AI Gateway, comprobar que esa llamada tiene el tag `tenant:innovas` y conserva su `sessionId`.
- [ ] Provocar una compactación en una conversación larga, o esperar a que ocurra, y mirar si deja asiento. Si no deja, queda confirmado como causa conocida de diferencia (ya figura en la pantalla).
- [ ] Revisar en `/plataforma/<slug>` el límite diario de `model_usd` de cada empresa. El chat ahora suma contra ese límite: mirar tres días de libro y ajustar para que los procesos automáticos no corten antes de tiempo.
- [ ] Al día siguiente, en `/plataforma/gasto`, conciliar el mes en curso. Terminado cuando cierra dentro de la tolerancia y "Sin etiqueta" está en cero. Si "Sin etiqueta" no es cero, buscar en los logs del gateway las llamadas sin tag: es una puerta que no pasó por `gatewayOptions`.
- [ ] Correr `explain` de `platform_spend_report` contra producción. Si hace un seq scan costoso, agregar en una migración aparte un índice por `(resource, created_at)`.
- [ ] Tildar la 21.5 en el roadmap y pasar su fila de `docs/decisiones/README.md` a `cerrada`.
