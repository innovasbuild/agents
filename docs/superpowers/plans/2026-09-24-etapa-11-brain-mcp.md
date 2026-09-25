# Etapa 11 · Brain por MCP — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la gente de un tenant lea y escriba su brain desde Claude Code y claude.ai con su propia cuenta, que un tenant pueda tener su brain en un servidor MCP externo, y que las tools del brain se puedan montar en cualquier agente.

**Architecture:** El contrato de las tres tools pasa a `lib/brain/contract.ts` y lo usan dos superficies: las tools de eve (`lib/brain/tools.ts`, montadas por agente según `tenant_agents.config.brain`) y un servidor MCP propio en `app/brain/[tenant]/mcp/route.ts`, construido con `@modelcontextprotocol/sdk` y no con `mcpChannel` de eve. Supabase Auth hace de emisor OAuth 2.1 con registro dinámico; la app pone la pantalla de consentimiento. Un proveedor `mcp` nuevo implementa `BrainProvider` contra un servidor MCP remoto que hable el mismo contrato.

**Tech Stack:** Next 16 App Router, eve 0.54.2, Supabase (Auth OAuth Server en beta, Postgres, pgTAP), `@modelcontextprotocol/sdk` 1.30.x, zod 4, vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md`. Leerla entera antes de arrancar: este plan argumenta desde ahí y cita sus decisiones como D1…D12 y sus verificaciones como V1…V6.

## Global Constraints

- Español rioplatense en UI, mensajes de error, descripciones de tools y docs. Código e identificadores en inglés.
- Toda tabla nueva lleva `tenant_id` y RLS. Cargar `supabase-postgres-best-practices` antes de escribir SQL.
- `events` es append-only: ninguna tarea hace `UPDATE` ni `DELETE` sobre `events`.
- Nada específico de `innovas` en código: el slug solo aparece en tests, docs y datos.
- Los archivos que importa un script de `scripts/*.mts` (Node directo, type stripping) usan imports relativos con extensión `.ts`, sin parameter properties y sin enums: `lib/brain/config.ts`, `lib/brain/limits.ts`, `lib/brain/mcp-config.ts`, `lib/brain/errors.ts`, `lib/connectors/providers.ts`.
- Antes de tocar código de eve, leer `node_modules/eve/docs/README.md` y la guía del slot que se toca.
- Ningún archivo nuevo importa `@vercel/connect`: el único puente es `lib/connectors/auth.ts` (lo hace cumplir `tests/connectors/import-rule.test.ts`).
- Límites: 60 lecturas y 10 escrituras por minuto por usuario y tenant por defecto; request MCP de hasta 1 MiB; `brain_upsert.body` de hasta 100 KB por MCP; `timeoutMs` del proveedor `mcp` entre 1000 y 30000, por defecto 10000.
- Las tools del agente no cambian de nombre (`brain_search`, `brain_read`, `brain_upsert`), así `TOOL_LABELS` y `tests/agents/running-tool.test.ts` no se tocan.
- Comandos: `npm test`, `npm run typecheck`, `npm run db:test` (Docker abierto), `npm run lint:fix`. `lint:fix` reformatea siempre los mismos cuatro archivos ajenos: revertirlos con `git checkout -- <archivo>` antes de commitear.
- Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` y el trailer `Co-Authored-By` que indique la sesión.

## Review Focus

1. **Un token de un tenant leyendo otro tenant.** Una persona con membresía en `a` que llama a `/brain/b/mcp`, o que manda `tenantId: "b"` en los argumentos de una tool, recibe 403 o ve solo lo de `a`. Test en Task 10 (403 por URL) y Task 11 (argumento `tenantId` descartado).
2. **`next` como open redirect.** `/login?next=//evil.com` o `next=https://evil.com` después de loguearse terminan en `/`, no afuera. Test en Task 6.
3. **Servidor remoto que responde basura o no responde.** El agente recibe un error tipado `provider_unavailable`, no un crash de la sesión ni datos a medias. Test en Task 5 (respuesta mal formada, timeout, código desconocido).
4. **Cuerpo de request enorme o sin `content-length`.** Se corta con 413 antes de parsear, venga o no el header. Test en Task 11.
5. **Dar de alta un segundo brain en un tenant que ya tiene uno.** El alta falla con un mensaje en castellano que nombra el brain habilitado, y la sesión del agente nunca ve dos. Test en Task 4 (pgTAP del índice) y Task 4 (mensaje del script).

---

## Mapa de archivos

| Archivo | Responsabilidad | Task |
|---|---|---|
| `lib/brain/contract.ts` | Esquemas de entrada y de resultado de las tres tools, con descripciones | 1 |
| `lib/brain/tools.ts` | `createBrainTools(binding, access)`: tools de eve | 2 |
| `lib/brain/agent-access.ts` | `parseBrainAccess`, `loadAgentBrainAccess` | 2 |
| `lib/brain/provider.ts` | `getBrainProvider(binding)` elige wiki o mcp | 2, 5 |
| `agents/outreach/tools/brain.ts` | Resolver fino: tenant, declaración, binding | 2 |
| `lib/outreach/canon.ts` | Deja de pasar el cliente admin | 2 |
| `supabase/migrations/20260924100000_tenant_agents_brain_access.sql` | Declara `read_write` en `outreach` | 2 |
| `lib/brain/limits.ts` | `McpLimits` y su parser | 3 |
| `lib/brain/config.ts` | Wiki acepta `mcpLimits`; `parseCategories` exportado | 3 |
| `lib/brain/mcp-config.ts` | `McpBrainConfig` y su parser | 3 |
| `lib/brain/resolve.ts` | `BrainBinding` como unión wiki / mcp | 3 |
| `lib/connectors/providers.ts` | Proveedor `mcp` en el catálogo | 3 |
| `scripts/connections-bind-args.ts`, `scripts/connections-bind-config.ts` | Alta de un brain `mcp` | 3 |
| `supabase/migrations/20260924100100_one_brain_per_tenant.sql` | Índice único parcial | 4 |
| `scripts/connections-bind-errors.ts`, `scripts/connections-bind.mts` | Mensaje de brain duplicado | 4 |
| `lib/brain/errors.ts` | `BrainProviderError`, `BrainRateLimited` | 5, 9 |
| `lib/brain/mcp.ts` | Adapter `BrainProvider` sobre un servidor MCP remoto | 5 |
| `lib/auth/next-path.ts` | `safeNextPath` | 6 |
| `app/(auth)/login/page.tsx`, `app/auth/callback/route.ts` | `next` de punta a punta | 6 |
| `app/oauth/consent/page.tsx`, `app/oauth/consent/actions.ts`, `lib/auth/oauth-scopes.ts` | Pantalla de consentimiento | 7 |
| `proxy.ts` | Excluye `brain/` y `.well-known/` | 7 |
| `scripts/oauth-probe.mts`, `scripts/oauth-probe-check.ts` | V1 y V2 automatizadas | 8 |
| `supabase/migrations/20260924100200_brain_mcp_usage.sql` | Contador por minuto y `brain_mcp_hit` | 9 |
| `lib/brain/mcp-server/rate-limit.ts` | `createRateLimiter` | 9 |
| `lib/brain/mcp-server/access.ts` | `resolveMcpAccess` | 10 |
| `lib/brain/mcp-server/supabase.ts` | Verificador de token, store de acceso y `hit` reales | 10 |
| `lib/brain/mcp-server/server.ts` | `buildBrainMcpServer` | 11 |
| `lib/brain/mcp-server/handler.ts` | `handleBrainMcp`, `protectedResourceMetadata` | 11 |
| `lib/brain/mcp-server/production.ts` | Dependencias reales desde el entorno | 11 |
| `app/brain/[tenant]/mcp/route.ts` | Ruta MCP | 11 |
| `app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts` | Metadata RFC 9728 | 11 |
| `docs/brain-mcp-conexion.md` | Doc de conexión para el cliente | 12 |

---

## E1 · Contrato y tools en `lib/`

### Task 1: Contrato del brain

**Files:**
- Create: `lib/brain/contract.ts`
- Test: `tests/brain/contract.test.ts`

**Interfaces:**
- Consumes: `CANON_TAGS`, `MAX_SLUG_LENGTH`, `BRAIN_STATUSES` de `lib/brain/types.ts`.
- Produces:
  - `brainContract(categories: string[]): { search: { description: string; input: ZodObject }, read: {…}, upsert: {…} }`. Tira si `categories` está vacío.
  - `brainResultSchemas: { search: ZodObject<{ ok: literal(true), results: summary[] }>, read: ZodObject<{ ok: literal(true), page }>, upsert: ZodObject<{ ok: literal(true), slug: string, revision: number }> }`.
  - `BRAIN_TOOL_NAMES = { search: "brain_search", read: "brain_read", upsert: "brain_upsert" } as const`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/contract.test.ts
import { describe, expect, it } from "vitest";
import {
	BRAIN_TOOL_NAMES,
	brainContract,
	brainResultSchemas,
} from "@/lib/brain/contract";

describe("brainContract", () => {
	const contract = brainContract(["comercial", "producto"]);

	it("usa las categorías del binding en búsqueda y escritura", () => {
		expect(
			contract.search.input.safeParse({ query: "", category: "comercial" })
				.success,
		).toBe(true);
		expect(
			contract.search.input.safeParse({ query: "", category: "otra" }).success,
		).toBe(false);
		expect(
			contract.upsert.input.safeParse({
				slug: "producto/radar",
				title: "Radar",
				category: "otra",
				status: "activo",
				tags: [],
				body: "x",
				reason: "alta",
			}).success,
		).toBe(false);
	});

	it("descarta claves desconocidas: un tenantId en los argumentos no pasa", () => {
		const parsed = contract.search.input.parse({
			query: "icp",
			tenantId: "otro-tenant",
		});
		expect(parsed).toEqual({ query: "icp" });
		const read = contract.read.input.parse({ slug: "comercial/icp", tenantId: "x" });
		expect(read).toEqual({ slug: "comercial/icp" });
	});

	it("las descripciones no prometen aprobación: eso lo agrega cada superficie", () => {
		expect(contract.upsert.description).not.toMatch(/aprueba/i);
	});

	it("sin categorías no hay contrato", () => {
		expect(() => brainContract([])).toThrow("categoría");
	});

	it("los nombres de las tools son los de siempre", () => {
		expect(BRAIN_TOOL_NAMES).toEqual({
			search: "brain_search",
			read: "brain_read",
			upsert: "brain_upsert",
		});
	});
});

describe("brainResultSchemas", () => {
	it("valida una página leída y rechaza una sin revisión", () => {
		const page = {
			slug: "comercial/icp",
			title: "ICP",
			category: "comercial",
			status: "activo",
			tags: ["canon:icp"],
			frontmatter: {},
			body: "…",
			revision: 3,
			updatedAt: "2026-09-24T00:00:00Z",
		};
		expect(brainResultSchemas.read.safeParse({ ok: true, page }).success).toBe(
			true,
		);
		const { revision: _omitted, ...sinRevision } = page;
		expect(
			brainResultSchemas.read.safeParse({ ok: true, page: sinRevision }).success,
		).toBe(false);
	});

	it("valida el resultado de una escritura", () => {
		expect(
			brainResultSchemas.upsert.safeParse({ ok: true, slug: "a", revision: 1 })
				.success,
		).toBe(true);
		expect(
			brainResultSchemas.upsert.safeParse({ ok: true, slug: "a" }).success,
		).toBe(false);
	});
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run tests/brain/contract.test.ts`
Expected: FAIL, `Cannot find module '@/lib/brain/contract'`.

- [ ] **Step 3: Implementar**

```ts
// lib/brain/contract.ts
// Contrato de las tres tools del brain (spec etapa 11 §8.1). Lo usan las tools
// del agente y el endpoint MCP: un cambio acá cambia las dos superficies.
import { z } from "zod";
import { BRAIN_STATUSES, CANON_TAGS, MAX_SLUG_LENGTH } from "./types.ts";

export const BRAIN_TOOL_NAMES = {
	search: "brain_search",
	read: "brain_read",
	upsert: "brain_upsert",
} as const;

const statusSchema = z.enum(BRAIN_STATUSES as [string, ...string[]]);

const slugSchema = z
	.string()
	.max(MAX_SLUG_LENGTH)
	.describe(
		"Ruta de la página, en minúsculas con guiones, por ejemplo comercial/icp.",
	);

const canon = CANON_TAGS.join(", ");

export function brainContract(categories: string[]) {
	if (categories.length === 0) {
		throw new Error("el brain necesita al menos una categoría");
	}
	const category = z.enum(categories as [string, ...string[]]);

	return {
		search: {
			description: `Busca en el brain de este cliente: canon comercial, ICP, mensajes, voz, hooks, cuentas y producto. Para canon, filtrá por tag: ${canon}. La consulta puede ir vacía si filtrás por tag o categoría.`,
			input: z.object({
				query: z.string().max(500),
				category: category.optional(),
				tag: z.string().max(60).optional(),
				includeArchived: z.boolean().optional(),
				limit: z.number().int().min(1).max(20).optional(),
			}),
		},
		read: {
			description:
				"Lee una página completa del brain de este cliente, con su revisión. Necesitás la revisión para actualizarla con brain_upsert.",
			input: z.object({ slug: slugSchema }),
		},
		upsert: {
			description: `Crea o actualiza una página del brain de este cliente. Para actualizar, leé la página y pasá su revisión en baseRevision; sin baseRevision solo crea páginas nuevas. Nunca borres: para retirar una página, poné status archivado. Explicá el cambio en reason. Categorías válidas: ${categories.join(", ")}. Tags de canon: ${canon}.`,
			input: z.object({
				slug: slugSchema,
				title: z.string().min(1).max(300),
				category,
				status: statusSchema,
				tags: z.array(z.string().min(1).max(60)).max(20),
				body: z
					.string()
					.describe("Cuerpo completo en markdown. Reemplaza al anterior."),
				reason: z.string().min(1).max(500),
				baseRevision: z.number().int().min(1).optional(),
			}),
		},
	};
}

const summarySchema = z.object({
	slug: z.string(),
	title: z.string(),
	category: z.string(),
	status: statusSchema,
	tags: z.array(z.string()),
	snippet: z.string(),
	updatedAt: z.string(),
});

const pageSchema = summarySchema.omit({ snippet: true }).extend({
	frontmatter: z.record(z.string(), z.unknown()),
	body: z.string(),
	revision: z.number().int(),
});

export const brainResultSchemas = {
	search: z.object({ ok: z.literal(true), results: z.array(summarySchema) }),
	read: z.object({ ok: z.literal(true), page: pageSchema }),
	upsert: z.object({
		ok: z.literal(true),
		slug: z.string(),
		revision: z.number().int(),
	}),
};
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run tests/brain/contract.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/brain/contract.ts tests/brain/contract.test.ts
git commit -m "feat: contrato compartido de las tools del brain"
```

---

### Task 2: Tools del brain para cualquier agente

**Files:**
- Create: `lib/brain/tools.ts`, `lib/brain/agent-access.ts`, `supabase/migrations/20260924100000_tenant_agents_brain_access.sql`
- Modify: `lib/brain/provider.ts` (firma nueva), `lib/outreach/canon.ts:153-157`, `agents/outreach/tools/brain.ts` (reescritura)
- Test: `tests/brain/tools.test.ts`, `tests/brain/agent-access.test.ts`

**Interfaces:**
- Consumes: `brainContract` (Task 1), `decideBrainUpsertResponse` (`lib/brain/approval.ts`), `toToolError` (`lib/brain/errors.ts`), `resolveBrainBinding` y `BrainBinding` (`lib/brain/resolve.ts`, hoy solo wiki; la Task 3 lo amplía sin cambiar este uso).
- Produces:
  - `type BrainAccess = "none" | "read" | "read_write"` en `lib/brain/agent-access.ts`.
  - `parseBrainAccess(config: unknown): BrainAccess`.
  - `loadAgentBrainAccess(tenantId: string, agent: string): Promise<BrainAccess>`.
  - `createBrainTools(binding: BrainBinding, access: "read" | "read_write", deps?: { provider?: (binding: BrainBinding) => BrainProvider })` → `{ brain_search, brain_read }` o las tres. `deps.provider` es solo para tests; por defecto `getBrainProvider`.
  - `getBrainProvider(binding: BrainBinding): BrainProvider` (sin segundo argumento).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/brain/agent-access.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBrainAccess } from "@/lib/brain/agent-access";

describe("parseBrainAccess", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	afterEach(() => warn.mockClear());

	it("lee la declaración del agente", () => {
		expect(parseBrainAccess({ brain: "read" })).toBe("read");
		expect(parseBrainAccess({ brain: "read_write" })).toBe("read_write");
		expect(parseBrainAccess({ brain: "none" })).toBe("none");
	});

	it("sin declaración no hay brain, y no avisa", () => {
		expect(parseBrainAccess({})).toBe("none");
		expect(parseBrainAccess(null)).toBe("none");
		expect(warn).not.toHaveBeenCalled();
	});

	it("una declaración inválida vale none y avisa", () => {
		expect(parseBrainAccess({ brain: "todo" })).toBe("none");
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("todo"));
	});
});
```

```ts
// tests/brain/tools.test.ts
import { describe, expect, it, vi } from "vitest";
import type { BrainBinding } from "@/lib/brain/resolve";
import { createBrainTools } from "@/lib/brain/tools";
import type { BrainProvider } from "@/lib/brain/types";

const binding: BrainBinding = {
	id: "b1",
	tenantId: "tenant-a",
	provider: "wiki",
	config: {
		categories: ["comercial"],
		requiredFrontmatter: [],
		search: "fts",
		mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
	},
};

function fakeProvider(): BrainProvider {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(),
		upsert: vi.fn(async () => ({ slug: "a", revision: 1 })),
	};
}

describe("createBrainTools", () => {
	it("con acceso de lectura devuelve solo búsqueda y lectura", () => {
		const tools = createBrainTools(binding, "read", { provider: fakeProvider });
		expect(Object.keys(tools).sort()).toEqual(["brain_read", "brain_search"]);
	});

	it("con lectura y escritura suma brain_upsert, con aprobación", () => {
		const tools = createBrainTools(binding, "read_write", {
			provider: fakeProvider,
		});
		expect(Object.keys(tools).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
		]);
		expect("brain_upsert" in tools && tools.brain_upsert.approval).toBeTruthy();
		expect(tools.brain_search.approval).toBeUndefined();
	});

	it("la descripción de brain_upsert del agente avisa que la aprueba un administrador", () => {
		const tools = createBrainTools(binding, "read_write", {
			provider: fakeProvider,
		});
		const description =
			"brain_upsert" in tools ? String(tools.brain_upsert.description) : "";
		expect(description).toMatch(/aprueba un administrador/);
	});
});
```

> La config wiki del test ya trae `mcpLimits`, que la Task 3 vuelve obligatorio en `WikiConfig`. Para que esta task compile sola, el Step 4 lo agrega ya como opcional, con el tipo inline `{ readsPerMinute: number; writesPerMinute: number }`.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/brain/tools.test.ts tests/brain/agent-access.test.ts`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Implementar `agent-access.ts`**

```ts
// lib/brain/agent-access.ts
// Qué acceso al brain declara cada agente en tenant_agents.config (spec etapa
// 11 §8.3). Sin declaración no hay tools brain_*.
import { createAdminClient } from "../supabase/admin";

export type BrainAccess = "none" | "read" | "read_write";

const VALID: readonly BrainAccess[] = ["none", "read", "read_write"];

export function parseBrainAccess(config: unknown): BrainAccess {
	if (typeof config !== "object" || config === null) return "none";
	const value = (config as Record<string, unknown>).brain;
	if (value === undefined) return "none";
	if (typeof value === "string" && (VALID as readonly string[]).includes(value)) {
		return value as BrainAccess;
	}
	console.warn(
		`brain omitido: declaración inválida en tenant_agents.config.brain: ${JSON.stringify(value)}`,
	);
	return "none";
}

export async function loadAgentBrainAccess(
	tenantId: string,
	agent: string,
): Promise<BrainAccess> {
	const { data, error } = await createAdminClient()
		.from("tenant_agents")
		.select("config")
		.eq("tenant_id", tenantId)
		.eq("agent", agent)
		.maybeSingle();
	if (error) {
		throw new Error(
			`No pude leer la configuración del agente ${agent}: ${error.message}`,
		);
	}
	return parseBrainAccess(data?.config ?? null);
}
```

- [ ] **Step 4: Cambiar la firma de `getBrainProvider` y sus llamadas**

```ts
// lib/brain/provider.ts
import { createAdminClient } from "../supabase/admin";
import type { BrainBinding } from "./resolve.ts";
import type { BrainProvider } from "./types.ts";
import { createWikiProvider } from "./wiki.ts";
import { createSupabaseWikiStore } from "./wiki-store.ts";

export function getBrainProvider(binding: BrainBinding): BrainProvider {
	return createWikiProvider({
		tenantId: binding.tenantId,
		bindingId: binding.id,
		config: binding.config,
		store: createSupabaseWikiStore(createAdminClient()),
	});
}
```

En `lib/outreach/canon.ts`, la función que hoy termina en la línea 156:

```ts
	const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
	return binding ? getBrainProvider(binding) : null;
```

y borrar el import de `createAdminClient` si ya no se usa en ese archivo (`grep -n createAdminClient lib/outreach/canon.ts`).

En `lib/brain/config.ts`, agregar a `WikiConfig`:

```ts
	mcpLimits?: { readsPerMinute: number; writesPerMinute: number };
```

- [ ] **Step 5: Implementar `tools.ts`**

```ts
// lib/brain/tools.ts
// Tools del brain para un agente (spec etapa 11 §8.2). La aprobación de
// brain_upsert vive acá y no en el contrato: por MCP no aplica (D5).
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { decideBrainUpsertResponse } from "./approval.ts";
import { brainContract } from "./contract.ts";
import { toToolError } from "./errors.ts";
import { getBrainProvider } from "./provider.ts";
import type { BrainBinding } from "./resolve.ts";
import type { BrainProvider } from "./types.ts";

export function createBrainTools(
	binding: BrainBinding,
	access: "read" | "read_write",
	deps: { provider?: (binding: BrainBinding) => BrainProvider } = {},
) {
	const provider = () => (deps.provider ?? getBrainProvider)(binding);
	const contract = brainContract(binding.config.categories);

	const brain_search = defineTool({
		description: `${contract.search.description} Usalo antes de investigar o redactar.`,
		inputSchema: contract.search.input,
		execute: async (input) => {
			try {
				return { ok: true as const, results: await provider().search(input) };
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	const brain_read = defineTool({
		description: contract.read.description,
		inputSchema: contract.read.input,
		execute: async ({ slug }) => {
			try {
				return { ok: true as const, page: await provider().read(slug) };
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	if (access === "read") return { brain_search, brain_read };

	const brain_upsert = defineTool({
		description: `${contract.upsert.description} Siempre la aprueba un administrador.`,
		inputSchema: contract.upsert.input,
		approval: {
			request: always(),
			response: ({ responder }) =>
				decideBrainUpsertResponse(responder, binding.tenantId),
		},
		execute: async (input, toolCtx) => {
			const initiator = toolCtx.session.auth.initiator;
			const userId =
				initiator?.principalType === "user" ? initiator.principalId : null;
			try {
				const result = await provider().upsert(input, {
					kind: "agent",
					userId,
					sessionId: toolCtx.session.id,
				});
				return { ok: true as const, ...result };
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	return { brain_search, brain_read, brain_upsert };
}
```

`input.status` sale de un `z.enum` sobre `string`, así que su tipo es `string` y no `BrainStatus`. Si el typecheck se queja en `provider().upsert(input, …)`, castear en el contrato: `z.enum(BRAIN_STATUSES as [BrainStatus, ...BrainStatus[]])` con `import type { BrainStatus }`. Hacerlo en `contract.ts`, no con un `as` acá.

- [ ] **Step 6: Reescribir la tool del agente**

```ts
// agents/outreach/tools/brain.ts
// Tools del brain según lo que declara este agente y el binding del tenant
// (spec etapa 11 §8.3). Sin declaración o sin binding, no hay tools brain_*.
import { defineDynamic } from "eve/tools";
import { loadAgentBrainAccess } from "../../../lib/brain/agent-access";
import { resolveBrainBinding } from "../../../lib/brain/resolve";
import { createBrainTools } from "../../../lib/brain/tools";
import { loadTenantBindings } from "../../../lib/connectors/bindings";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			const tenantId = attribute(auth?.attributes?.tenantId);
			if (!tenantId) return null;

			const access = await loadAgentBrainAccess(tenantId, "outreach");
			if (access === "none") return null;

			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			if (!binding) return null;

			return createBrainTools(binding, access);
		},
	},
});
```

- [ ] **Step 7: Migración de la declaración**

```sql
-- supabase/migrations/20260924100000_tenant_agents_brain_access.sql
-- Spec etapa 11 §8.3 (D11): sin declaración, un agente no ve el brain. outreach
-- ya lo usaba, así que se declara acá como dato, no como default en el código.
update public.tenant_agents
set config = config || '{"brain": "read_write"}'::jsonb
where agent = 'outreach'
  and not (config ? 'brain');
```

No lleva pgTAP propio: `db:test` corre con `--no-seed` y no hay filas de `tenant_agents` en el momento de migrar, así que un test no probaría la migración sino una copia del `update`. Se verifica en producción en la Task 12.

- [ ] **Step 8: Correr tests y typecheck**

Run: `npx vitest run tests/brain && npm run typecheck`
Expected: PASS. Si algún test existente de `tests/brain/` o `tests/tools/` importaba `getBrainProvider` con dos argumentos, ajustarlo a uno.

- [ ] **Step 9: Commit**

```bash
git add lib/brain/tools.ts lib/brain/agent-access.ts lib/brain/provider.ts lib/brain/config.ts lib/outreach/canon.ts agents/outreach/tools/brain.ts supabase/migrations/20260924100000_tenant_agents_brain_access.sql tests/brain/tools.test.ts tests/brain/agent-access.test.ts
git commit -m "refactor: tools del brain en lib y acceso declarado por agente"
```

---

## E2 · Proveedor `mcp`

### Task 3: Binding `mcp` y su configuración

**Files:**
- Create: `lib/brain/limits.ts`, `lib/brain/mcp-config.ts`
- Modify: `lib/brain/config.ts`, `lib/brain/resolve.ts`, `lib/connectors/providers.ts`, `scripts/connections-bind-args.ts`, `scripts/connections-bind-config.ts`
- Test: `tests/brain/limits.test.ts`, `tests/brain/mcp-config.test.ts`, `tests/brain/resolve.test.ts`, `tests/brain/config.test.ts`, `tests/scripts/connections-bind-args.test.ts`

**Interfaces:**
- Produces:
  - `interface McpLimits { readsPerMinute: number; writesPerMinute: number }`, `DEFAULT_MCP_LIMITS`, `parseMcpLimits(value: unknown): McpLimits` en `lib/brain/limits.ts`.
  - `parseCategories(value: unknown): string[]` exportado de `lib/brain/config.ts`; `WikiConfig.mcpLimits: McpLimits` pasa a obligatorio.
  - `interface McpBrainConfig { url: string; tools: { search: string; read: string; upsert: string }; categories: string[]; timeoutMs: number; mcpLimits: McpLimits }` y `parseMcpBrainConfig(value: unknown, nodeEnv?: string): McpBrainConfig`.
  - `type BrainBinding = WikiBrainBinding | McpBrainBinding` con `McpBrainBinding = { id; tenantId; provider: "mcp"; connectorUid: string; config: McpBrainConfig }`.
  - `PROVIDERS.mcp = { capability: "brain", multiple: false, kind: "tool", authKind: "connect_api_key" }`.

- [ ] **Step 1: Tests que fallan**

```ts
// tests/brain/limits.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_MCP_LIMITS, parseMcpLimits } from "@/lib/brain/limits";

describe("parseMcpLimits", () => {
	it("sin valor usa los defaults", () => {
		expect(parseMcpLimits(undefined)).toEqual(DEFAULT_MCP_LIMITS);
		expect(DEFAULT_MCP_LIMITS).toEqual({ readsPerMinute: 60, writesPerMinute: 10 });
	});

	it("completa lo que falta", () => {
		expect(parseMcpLimits({ readsPerMinute: 120 })).toEqual({
			readsPerMinute: 120,
			writesPerMinute: 10,
		});
	});

	it("rechaza valores fuera de rango, no enteros y claves desconocidas", () => {
		expect(() => parseMcpLimits({ readsPerMinute: 0 })).toThrow("readsPerMinute");
		expect(() => parseMcpLimits({ writesPerMinute: 1001 })).toThrow("writesPerMinute");
		expect(() => parseMcpLimits({ readsPerMinute: 1.5 })).toThrow("readsPerMinute");
		expect(() => parseMcpLimits({ otro: 1 })).toThrow("otro");
		expect(() => parseMcpLimits([])).toThrow("objeto");
	});
});
```

```ts
// tests/brain/mcp-config.test.ts
import { describe, expect, it } from "vitest";
import { parseMcpBrainConfig } from "@/lib/brain/mcp-config";

const base = { url: "https://brain.cliente.test/mcp", categories: ["comercial"] };

describe("parseMcpBrainConfig", () => {
	it("completa defaults: nombres del contrato, 10 s y límites", () => {
		expect(parseMcpBrainConfig(base, "production")).toEqual({
			url: "https://brain.cliente.test/mcp",
			tools: { search: "brain_search", read: "brain_read", upsert: "brain_upsert" },
			categories: ["comercial"],
			timeoutMs: 10000,
			mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
		});
	});

	it("acepta un mapeo parcial de nombres", () => {
		expect(
			parseMcpBrainConfig({ ...base, tools: { read: "get_page" } }, "production")
				.tools,
		).toEqual({ search: "brain_search", read: "get_page", upsert: "brain_upsert" });
	});

	it("exige https, salvo localhost fuera de producción", () => {
		expect(() =>
			parseMcpBrainConfig({ ...base, url: "http://brain.cliente.test/mcp" }, "production"),
		).toThrow("https");
		expect(() =>
			parseMcpBrainConfig({ ...base, url: "http://localhost:4000/mcp" }, "production"),
		).toThrow("https");
		expect(
			parseMcpBrainConfig({ ...base, url: "http://localhost:4000/mcp" }, "development")
				.url,
		).toBe("http://localhost:4000/mcp");
	});

	it("valida timeout, nombres de tools, categorías y claves", () => {
		expect(() => parseMcpBrainConfig({ ...base, timeoutMs: 500 }, "production")).toThrow("timeoutMs");
		expect(() => parseMcpBrainConfig({ ...base, timeoutMs: 31000 }, "production")).toThrow("timeoutMs");
		expect(() =>
			parseMcpBrainConfig({ ...base, tools: { search: "con espacios" } }, "production"),
		).toThrow("tools.search");
		expect(() => parseMcpBrainConfig({ url: base.url }, "production")).toThrow("categories");
		expect(() => parseMcpBrainConfig({ ...base, secreto: "x" }, "production")).toThrow("secreto");
	});
});
```

En `tests/brain/resolve.test.ts`:
- Cambiar `wikiConfig` para incluir `mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 }` en el valor esperado del test "con wiki devuelve el binding…" (el input puede seguir sin `mcpLimits`; el esperado lo trae).
- En "un proveedor de brain no construido se omite con aviso", cambiar `provider: "mcp"` por `provider: "gbrain"` y el `stringContaining("mcp")` por `stringContaining("gbrain")`.
- Agregar:

```ts
	it("con mcp devuelve el binding con conector y configuración parseada", async () => {
		const load = vi.fn(async () => [
			binding({
				provider: "mcp",
				connectorUid: "cliente-brain",
				config: { url: "https://brain.cliente.test/mcp", categories: ["comercial"] },
			}),
		]);
		expect(await resolveBrainBinding("tenant-a", load)).toMatchObject({
			provider: "mcp",
			connectorUid: "cliente-brain",
			config: { url: "https://brain.cliente.test/mcp", timeoutMs: 10000 },
		});
	});

	it("un mcp sin conector se omite con aviso", async () => {
		const load = vi.fn(async () => [
			binding({
				provider: "mcp",
				connectorUid: null,
				config: { url: "https://brain.cliente.test/mcp", categories: ["comercial"] },
			}),
		]);
		expect(await resolveBrainBinding("tenant-a", load)).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("conector"));
	});
```

En `tests/brain/config.test.ts`: donde se compara el resultado de `parseWikiConfig` con `toEqual`, sumar `mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 }` al esperado, y agregar:

```ts
	it("acepta mcpLimits", () => {
		expect(
			parseWikiConfig({ categories: ["comercial"], mcpLimits: { writesPerMinute: 5 } })
				.mcpLimits,
		).toEqual({ readsPerMinute: 60, writesPerMinute: 5 });
	});
```

En `tests/scripts/connections-bind-args.test.ts`, agregar:

```ts
	it("acepta un brain mcp con conector y config", () => {
		expect(
			parseBindArgs([
				"--tenant", "cliente", "--capability", "brain", "--provider", "mcp",
				"--connector", "cliente-brain", "--config", "tenants/cliente/brain-mcp.json",
			]),
		).toMatchObject({ provider: "mcp", connector: "cliente-brain", configPath: "tenants/cliente/brain-mcp.json" });
	});

	it("un brain mcp sin config falla", () => {
		expect(() =>
			parseBindArgs([
				"--tenant", "cliente", "--capability", "brain", "--provider", "mcp",
				"--connector", "cliente-brain",
			]),
		).toThrow("--config");
	});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/brain tests/scripts/connections-bind-args.test.ts`
Expected: FAIL en los archivos nuevos y en los casos nuevos.

- [ ] **Step 3: `limits.ts`**

```ts
// lib/brain/limits.ts
// Límites por minuto del endpoint MCP del brain (spec etapa 11 §6.2). Sin
// imports: lo usa scripts/connections-bind.mts con Node directo.

export interface McpLimits {
	readsPerMinute: number;
	writesPerMinute: number;
}

export const DEFAULT_MCP_LIMITS: McpLimits = {
	readsPerMinute: 60,
	writesPerMinute: 10,
};

const KEYS = new Set(["readsPerMinute", "writesPerMinute"]);

function limit(value: unknown, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1000) {
		throw new Error(`mcpLimits.${name} tiene que ser un entero entre 1 y 1000`);
	}
	return value;
}

export function parseMcpLimits(value: unknown): McpLimits {
	if (value === undefined) return { ...DEFAULT_MCP_LIMITS };
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("mcpLimits tiene que ser un objeto JSON");
	}
	const raw = value as Record<string, unknown>;
	const unknownKeys = Object.keys(raw).filter((key) => !KEYS.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(`claves desconocidas en mcpLimits: ${unknownKeys.join(", ")}`);
	}
	return {
		readsPerMinute: limit(raw.readsPerMinute, DEFAULT_MCP_LIMITS.readsPerMinute, "readsPerMinute"),
		writesPerMinute: limit(raw.writesPerMinute, DEFAULT_MCP_LIMITS.writesPerMinute, "writesPerMinute"),
	};
}
```

- [ ] **Step 4: `config.ts` del wiki**

Cambios en `lib/brain/config.ts`:
1. `import { type McpLimits, parseMcpLimits } from "./limits.ts";` (primer import del archivo; actualizar el comentario de cabecera: "Solo imports relativos con extensión .ts").
2. `WikiConfig.mcpLimits: McpLimits` (obligatorio; reemplaza el opcional de la Task 2).
3. `KNOWN_KEYS` suma `"mcpLimits"`.
4. Extraer la validación de categorías a una función exportada y usarla:

```ts
export function parseCategories(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		!value.every((item) => typeof item === "string" && CATEGORY.test(item))
	) {
		throw new Error(
			"categories tiene que ser una lista no vacía de categorías en minúsculas (a-z, 0-9, guiones)",
		);
	}
	if (new Set(value).size !== value.length) {
		throw new Error("categories tiene valores repetidos");
	}
	return [...value] as string[];
}
```

5. El `return` de `parseWikiConfig` suma `mcpLimits: parseMcpLimits(raw.mcpLimits)` y usa `categories: parseCategories(raw.categories)`.

- [ ] **Step 5: `mcp-config.ts`**

```ts
// lib/brain/mcp-config.ts
// Configuración del proveedor mcp del brain (spec etapa 11 §7.1). Sin secretos:
// la llave está en Vercel Connect. Lo usa el script de alta con Node directo.
import { parseCategories } from "./config.ts";
import { type McpLimits, parseMcpLimits } from "./limits.ts";

export interface McpBrainConfig {
	url: string;
	tools: { search: string; read: string; upsert: string };
	categories: string[];
	timeoutMs: number;
	mcpLimits: McpLimits;
}

const KNOWN_KEYS = new Set(["url", "tools", "categories", "timeoutMs", "mcpLimits"]);
const TOOL_KEYS = ["search", "read", "upsert"] as const;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const DEFAULT_TOOLS = { search: "brain_search", read: "brain_read", upsert: "brain_upsert" };
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function parseUrl(value: unknown, nodeEnv: string | undefined): string {
	if (typeof value !== "string") throw new Error("url tiene que ser una URL https");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("url tiene que ser una URL https");
	}
	const localDev =
		nodeEnv !== "production" && url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
	if (url.protocol !== "https:" && !localDev) {
		throw new Error("url tiene que ser https (http solo para localhost fuera de producción)");
	}
	return url.toString();
}

function parseTools(value: unknown): McpBrainConfig["tools"] {
	if (value === undefined) return { ...DEFAULT_TOOLS };
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("tools tiene que ser un objeto con search, read y upsert");
	}
	const raw = value as Record<string, unknown>;
	const tools = { ...DEFAULT_TOOLS };
	for (const key of Object.keys(raw)) {
		if (!(TOOL_KEYS as readonly string[]).includes(key)) {
			throw new Error(`clave desconocida en tools: ${key}`);
		}
		const name = raw[key];
		if (typeof name !== "string" || !TOOL_NAME.test(name)) {
			throw new Error(`tools.${key} tiene que ser un nombre de tool (letras, números, _ . -)`);
		}
		tools[key as (typeof TOOL_KEYS)[number]] = name;
	}
	return tools;
}

function parseTimeout(value: unknown): number {
	if (value === undefined) return 10000;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1000 || value > 30000) {
		throw new Error("timeoutMs tiene que ser un entero entre 1000 y 30000");
	}
	return value;
}

export function parseMcpBrainConfig(
	value: unknown,
	nodeEnv: string | undefined = process.env.NODE_ENV,
): McpBrainConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("la configuración del brain mcp tiene que ser un objeto JSON");
	}
	const raw = value as Record<string, unknown>;
	const unknownKeys = Object.keys(raw).filter((key) => !KNOWN_KEYS.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(`claves desconocidas en la configuración del brain mcp: ${unknownKeys.join(", ")}`);
	}
	return {
		url: parseUrl(raw.url, nodeEnv),
		tools: parseTools(raw.tools),
		categories: parseCategories(raw.categories),
		timeoutMs: parseTimeout(raw.timeoutMs),
		mcpLimits: parseMcpLimits(raw.mcpLimits),
	};
}
```

`new URL("https://brain.cliente.test/mcp").toString()` devuelve la misma cadena, así el test de defaults compara igual. Si un `url` termina sin path (`https://x.test`), `toString()` le agrega `/`; es aceptable.

- [ ] **Step 6: `resolve.ts`**

```ts
// lib/brain/resolve.ts
// Qué brain tiene el tenant de la sesión (spec brain §4.1, etapa 11 §7.2). Sin
// efectos. La base garantiza un solo brain habilitado por tenant (D9).
import type { Binding } from "../connectors/providers.ts";
import { parseWikiConfig, type WikiConfig } from "./config.ts";
import { type McpBrainConfig, parseMcpBrainConfig } from "./mcp-config.ts";

export interface WikiBrainBinding {
	id: string;
	tenantId: string;
	provider: "wiki";
	config: WikiConfig;
}

export interface McpBrainBinding {
	id: string;
	tenantId: string;
	provider: "mcp";
	connectorUid: string;
	config: McpBrainConfig;
}

export type BrainBinding = WikiBrainBinding | McpBrainBinding;

function omit(tenantId: string, reason: string): null {
	console.warn(`brain omitido: ${reason} (tenant ${tenantId})`);
	return null;
}

export async function resolveBrainBinding(
	tenantId: string,
	load: (tenantId: string) => Promise<Binding[]>,
): Promise<BrainBinding | null> {
	if (!tenantId) return null;

	const brain = (await load(tenantId)).find((binding) => binding.capability === "brain");
	if (!brain) return null;

	try {
		if (brain.provider === "wiki") {
			return { id: brain.id, tenantId, provider: "wiki", config: parseWikiConfig(brain.config) };
		}
		if (brain.provider === "mcp") {
			if (!brain.connectorUid) return omit(tenantId, "el brain mcp no tiene conector");
			return {
				id: brain.id,
				tenantId,
				provider: "mcp",
				connectorUid: brain.connectorUid,
				config: parseMcpBrainConfig(brain.config),
			};
		}
		return omit(tenantId, `proveedor ${brain.provider} no construido`);
	} catch (error) {
		return omit(
			tenantId,
			`configuración inválida: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
```

Con la unión, `getBrainProvider` de la Task 2 deja de compilar (pasa un `BrainBinding` mcp a `createWikiProvider`). Arreglo transitorio hasta la Task 5, en `lib/brain/provider.ts`:

```ts
	if (binding.provider === "mcp") {
		throw new Error("el proveedor mcp del brain se conecta en la Task 5");
	}
```

al principio de `getBrainProvider`. La Task 5 lo reemplaza; entre las dos tasks ningún tenant tiene un binding `mcp`, así que no se alcanza.

- [ ] **Step 7: Catálogo y script**

`lib/connectors/providers.ts`, dentro de `PROVIDERS`, después de `wiki`:

```ts
	mcp: {
		capability: "brain",
		multiple: false,
		kind: "tool",
		authKind: "connect_api_key",
	},
```

`scripts/connections-bind-args.ts`: reemplazar las dos condiciones que mencionan `"wiki"` por:

```ts
	const needsConfig = provider === "wiki" || provider === "mcp";
	if (needsConfig && !configPath) {
		throw new Error(`${provider} necesita --config <ruta a tenants/<slug>/brain*.json>`);
	}
	if (!needsConfig && configPath) {
		throw new Error(`${provider} no acepta --config`);
	}
```

y revisar que el test existente del mensaje de wiki sin config siga pasando (busca `"--config"`; si compara el texto exacto, ajustar el esperado).

`scripts/connections-bind-config.ts`:

```ts
import { parseWikiConfig } from "../lib/brain/config.ts";
import { parseMcpBrainConfig } from "../lib/brain/mcp-config.ts";
// …
	if (provider === "wiki") return { ...parseWikiConfig(raw) };
	if (provider === "mcp") return { ...parseMcpBrainConfig(raw, "production") };
```

El script valida siempre como producción: una config que apunta a `http://localhost` no se puede dar de alta en la base.

- [ ] **Step 8: Correr tests y typecheck**

Run: `npx vitest run tests/brain tests/scripts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/brain/limits.ts lib/brain/mcp-config.ts lib/brain/config.ts lib/brain/resolve.ts lib/brain/provider.ts lib/connectors/providers.ts scripts/connections-bind-args.ts scripts/connections-bind-config.ts tests/brain tests/scripts/connections-bind-args.test.ts
git commit -m "feat: binding mcp del brain con su configuración y límites"
```

---

### Task 4: Un solo brain habilitado por tenant

**Files:**
- Create: `supabase/migrations/20260924100100_one_brain_per_tenant.sql`, `supabase/tests/17_one_brain_per_tenant.test.sql`, `scripts/connections-bind-errors.ts`
- Modify: `scripts/connections-bind.mts`
- Test: `tests/scripts/connections-bind-errors.test.ts`

**Interfaces:**
- Produces: índice `tenant_connections_one_brain`; `describeBindError(error: { code?: string; message: string }, enabledBrain: string | null): string`.

- [ ] **Step 1: Cargar la skill** `supabase-postgres-best-practices`.

- [ ] **Step 2: pgTAP que falla**

```sql
-- supabase/tests/17_one_brain_per_tenant.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.tenants (id, slug, display_name)
values ('aaaaaaaa-0000-0000-0000-000000000011', 'cerebro', 'Cerebro');

insert into public.tenant_connections (tenant_id, capability, provider, config, enabled)
values ('aaaaaaaa-0000-0000-0000-000000000011', 'brain', 'wiki', '{"categories":["comercial"]}', true);

select throws_ok(
  $$insert into public.tenant_connections (tenant_id, capability, provider, connector_uid, config, enabled)
    values ('aaaaaaaa-0000-0000-0000-000000000011', 'brain', 'mcp', 'x', '{}', true)$$,
  '23505',
  null,
  'un segundo brain habilitado en el mismo tenant se rechaza'
);

select lives_ok(
  $$insert into public.tenant_connections (tenant_id, capability, provider, connector_uid, config, enabled)
    values ('aaaaaaaa-0000-0000-0000-000000000011', 'brain', 'mcp', 'x', '{}', false)$$,
  'un brain deshabilitado convive con el habilitado'
);

select throws_ok(
  $$update public.tenant_connections set enabled = true
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000011' and provider = 'mcp'$$,
  '23505',
  null,
  'habilitar el segundo brain también se rechaza'
);

select lives_ok(
  $$insert into public.tenant_connections (tenant_id, capability, provider, connector_uid, config, enabled)
    values ('aaaaaaaa-0000-0000-0000-000000000011', 'leads', 'coldiq', 'c1', '{}', true),
           ('aaaaaaaa-0000-0000-0000-000000000011', 'leads', 'apollo', 'a1', '{}', true)$$,
  'el índice no toca otras capacidades'
);

select * from finish();
rollback;
```

Antes de escribirlo, confirmar con `grep -n "create table public.tenant_connections" -A20 supabase/migrations/20260913221734_tenant_connections_executors.sql` qué columnas son obligatorias (`connector_uid`, `config`, `updated_at`) y completar el insert si falta alguna.

Run: `npm run db:test`
Expected: FAIL en el primer y tercer test (hoy la unique es por `tenant_id, capability, provider`).

- [ ] **Step 3: Migración**

```sql
-- supabase/migrations/20260924100100_one_brain_per_tenant.sql
-- Spec etapa 11 D9: un tenant tiene un solo brain habilitado. Antes lo
-- garantizaba resolveBrainBinding descartando en silencio lo que no era wiki.
do $$
begin
  if exists (
    select 1 from public.tenant_connections
    where capability = 'brain' and enabled
    group by tenant_id
    having count(*) > 1
  ) then
    raise exception 'hay tenants con más de un brain habilitado: deshabilitá uno antes de aplicar esta migración';
  end if;
end $$;

create unique index tenant_connections_one_brain
  on public.tenant_connections (tenant_id)
  where capability = 'brain' and enabled;
```

Run: `npm run db:test`
Expected: PASS.

- [ ] **Step 4: Mensaje del script — test que falla**

```ts
// tests/scripts/connections-bind-errors.test.ts
import { describe, expect, it } from "vitest";
import { describeBindError } from "@/scripts/connections-bind-errors";

describe("describeBindError", () => {
	it("un segundo brain nombra el que ya está habilitado", () => {
		expect(
			describeBindError(
				{ code: "23505", message: 'duplicate key value violates unique constraint "tenant_connections_one_brain"' },
				"wiki",
			),
		).toBe(
			"el tenant ya tiene un brain habilitado (wiki): deshabilitalo antes de dar de alta otro",
		);
	});

	it("otro error pasa con su mensaje", () => {
		expect(describeBindError({ code: "42501", message: "permission denied" }, null)).toBe(
			"no pude guardar el binding: permission denied",
		);
	});
});
```

- [ ] **Step 5: Implementar**

```ts
// scripts/connections-bind-errors.ts
// Import con extensión .ts no hace falta: no importa nada. Lo ejecuta Node directo.
export function describeBindError(
	error: { code?: string; message: string },
	enabledBrain: string | null,
): string {
	if (error.code === "23505" && error.message.includes("tenant_connections_one_brain")) {
		return `el tenant ya tiene un brain habilitado (${enabledBrain ?? "desconocido"}): deshabilitalo antes de dar de alta otro`;
	}
	return `no pude guardar el binding: ${error.message}`;
}
```

En `scripts/connections-bind.mts`, importar `describeBindError` desde `"./connections-bind-errors.ts"` y reemplazar el `if (bindError) throw …` por:

```ts
	if (bindError) {
		const { data: enabled } = await admin
			.from("tenant_connections")
			.select("provider")
			.eq("tenant_id", tenant.id)
			.eq("capability", "brain")
			.eq("enabled", true)
			.maybeSingle();
		throw new Error(describeBindError(bindError, enabled?.provider ?? null));
	}
```

- [ ] **Step 6: Correr**

Run: `npx vitest run tests/scripts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260924100100_one_brain_per_tenant.sql supabase/tests/17_one_brain_per_tenant.test.sql scripts/connections-bind-errors.ts scripts/connections-bind.mts tests/scripts/connections-bind-errors.test.ts
git commit -m "feat: un solo brain habilitado por tenant, forzado en la base"
```

---

### Task 5: Adapter del proveedor `mcp`

**Files:**
- Create: `lib/brain/mcp.ts`
- Modify: `lib/brain/errors.ts`, `lib/brain/provider.ts`, `package.json` (dependencia)
- Test: `tests/brain/mcp-provider.test.ts`, `tests/brain/errors.test.ts`

**Interfaces:**
- Consumes: `brainResultSchemas` (Task 1), `McpBrainConfig` y `McpBrainBinding` (Task 3), `apiKeyBearer(connectorUid)` de `lib/connectors/auth.ts`.
- Produces:
  - `class BrainProviderError extends BrainError` con `code = "provider_unavailable"`; `BrainErrorCode` suma `"provider_unavailable"`.
  - `createMcpBrainProvider(options: { config: McpBrainConfig; transport: () => Promise<Transport> }): BrainProvider`.
  - `streamableTransport(url: string, getToken: () => Promise<string>): () => Promise<Transport>`.
  - `getBrainProvider(binding)` resuelve `mcp`.

- [ ] **Step 1: Dependencia**

```bash
npm install --save-exact @modelcontextprotocol/sdk@1.30.1
```

Hoy ya está en `node_modules` como dependencia transitiva de eve (1.30.0); queda como directa y fija. Confirmar con `npm ls @modelcontextprotocol/sdk` que no aparezcan dos versiones incompatibles; si npm deja la de eve aparte, está bien.

- [ ] **Step 2: Test de errores que falla**

En `tests/brain/errors.test.ts`, agregar:

```ts
	it("un error del proveedor sale como provider_unavailable", () => {
		expect(toToolError(new BrainProviderError("el brain remoto no respondió"))).toEqual({
			ok: false,
			error: "provider_unavailable",
			message: "el brain remoto no respondió",
		});
	});
```

(importar `BrainProviderError` junto a los demás).

- [ ] **Step 3: Implementar el error**

En `lib/brain/errors.ts`:

```ts
export type BrainErrorCode =
	| "not_found"
	| "conflict"
	| "validation"
	| "forbidden"
	| "provider_unavailable";
```

y al final de las clases:

```ts
export class BrainProviderError extends BrainError {
	constructor(message: string) {
		super("provider_unavailable", message);
	}
}
```

`toToolError` no cambia: un `BrainProviderError` cae en el `return base`.

Run: `npx vitest run tests/brain/errors.test.ts` → PASS.

- [ ] **Step 4: Test del adapter que falla**

```ts
// tests/brain/mcp-provider.test.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BrainConflict, BrainNotFound, BrainProviderError } from "@/lib/brain/errors";
import { createMcpBrainProvider } from "@/lib/brain/mcp";
import type { McpBrainConfig } from "@/lib/brain/mcp-config";

const page = {
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo",
	tags: ["canon:icp"],
	frontmatter: {},
	body: "…",
	revision: 3,
	updatedAt: "2026-09-24T00:00:00Z",
};

function json(value: unknown, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		structuredContent: value as Record<string, unknown>,
		...(isError ? { isError: true } : {}),
	};
}

type Handlers = Record<string, (args: Record<string, unknown>) => Promise<ReturnType<typeof json>>>;

function remote(handlers: Handlers, calls: { name: string; args: unknown }[] = []) {
	return async () => {
		const server = new McpServer({ name: "remoto", version: "1.0.0" });
		for (const [name, handler] of Object.entries(handlers)) {
			server.registerTool(
				name,
				{ inputSchema: z.object({}).passthrough() },
				async (args) => {
					calls.push({ name, args });
					return handler(args as Record<string, unknown>);
				},
			);
		}
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await server.connect(serverSide);
		return clientSide;
	};
}

const config: McpBrainConfig = {
	url: "https://brain.cliente.test/mcp",
	tools: { search: "brain_search", read: "brain_read", upsert: "brain_upsert" },
	categories: ["comercial"],
	timeoutMs: 1000,
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

describe("createMcpBrainProvider", () => {
	it("busca, lee y escribe contra el servidor remoto", async () => {
		const calls: { name: string; args: unknown }[] = [];
		const provider = createMcpBrainProvider({
			config,
			transport: remote(
				{
					brain_search: async () => json({ ok: true, results: [] }),
					brain_read: async () => json({ ok: true, page }),
					brain_upsert: async () => json({ ok: true, slug: "comercial/icp", revision: 4 }),
				},
				calls,
			),
		});

		expect(await provider.search({ query: "icp" })).toEqual([]);
		expect(await provider.read("comercial/icp")).toEqual(page);
		expect(
			await provider.upsert(
				{ slug: "comercial/icp", title: "ICP", category: "comercial", status: "activo", tags: [], body: "x", reason: "ajuste", baseRevision: 3 },
				{ kind: "agent", userId: null, sessionId: "s1" },
			),
		).toEqual({ slug: "comercial/icp", revision: 4 });

		expect(calls.map((call) => call.name)).toEqual(["brain_search", "brain_read", "brain_upsert"]);
		expect(calls[1]?.args).toEqual({ slug: "comercial/icp" });
		expect(calls[2]?.args).not.toHaveProperty("author");
	});

	it("usa los nombres mapeados en la config", async () => {
		const calls: { name: string; args: unknown }[] = [];
		const provider = createMcpBrainProvider({
			config: { ...config, tools: { ...config.tools, read: "get_page" } },
			transport: remote({ get_page: async () => json({ ok: true, page }) }, calls),
		});
		await provider.read("comercial/icp");
		expect(calls[0]?.name).toBe("get_page");
	});

	it("una respuesta mal formada es un error del proveedor, no un dato a medias", async () => {
		const provider = createMcpBrainProvider({
			config,
			transport: remote({ brain_read: async () => json({ ok: true, page: { slug: "x" } }) }),
		});
		await expect(provider.read("x")).rejects.toBeInstanceOf(BrainProviderError);
	});

	it("traduce los errores tipados del remoto", async () => {
		const provider = createMcpBrainProvider({
			config,
			transport: remote({
				brain_read: async () =>
					json({ ok: false, error: "not_found", message: "no", suggestions: ["comercial/icp-v2"] }, true),
				brain_upsert: async () =>
					json({ ok: false, error: "conflict", message: "cambió", currentRevision: 5 }, true),
			}),
		});
		const notFound = await provider.read("comercial/icp").catch((error) => error);
		expect(notFound).toBeInstanceOf(BrainNotFound);
		expect(notFound.suggestions).toEqual(["comercial/icp-v2"]);

		const conflict = await provider
			.upsert(
				{ slug: "comercial/icp", title: "ICP", category: "comercial", status: "activo", tags: [], body: "x", reason: "r", baseRevision: 3 },
				{ kind: "agent", userId: null, sessionId: "s1" },
			)
			.catch((error) => error);
		expect(conflict).toBeInstanceOf(BrainConflict);
		expect(conflict.currentRevision).toBe(5);
	});

	it("un código de error desconocido es un error del proveedor", async () => {
		const provider = createMcpBrainProvider({
			config,
			transport: remote({ brain_read: async () => json({ ok: false, error: "explotó" }, true) }),
		});
		await expect(provider.read("x")).rejects.toBeInstanceOf(BrainProviderError);
	});

	it("un remoto que no contesta corta por timeout", async () => {
		const provider = createMcpBrainProvider({
			config: { ...config, timeoutMs: 50 },
			transport: remote({ brain_read: () => new Promise(() => {}) }),
		});
		await expect(provider.read("x")).rejects.toBeInstanceOf(BrainProviderError);
	});

	it("un transporte que no conecta es un error del proveedor", async () => {
		const provider = createMcpBrainProvider({
			config,
			transport: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		await expect(provider.search({ query: "" })).rejects.toBeInstanceOf(BrainProviderError);
	});
});
```

Si `z.object({}).passthrough()` no le pasa los argumentos al handler con esta versión del SDK, usar `inputSchema: { slug: z.string().optional(), query: z.string().optional() }` y ajustar las aserciones de `calls` a lo que efectivamente llega. Lo que importa verificar es que el nombre de la tool y el `slug` viajan, y que el autor no.

Run: `npx vitest run tests/brain/mcp-provider.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 5: Implementar el adapter**

```ts
// lib/brain/mcp.ts
// Proveedor mcp del brain (spec etapa 11 §7.3): habla nuestro contrato con un
// servidor MCP remoto. El mapeo de la config solo renombra tools (D10).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { brainResultSchemas } from "./contract.ts";
import {
	BrainConflict,
	BrainError,
	BrainForbidden,
	BrainNotFound,
	BrainProviderError,
	BrainValidation,
} from "./errors.ts";
import type { McpBrainConfig } from "./mcp-config.ts";
import type { BrainProvider } from "./types.ts";

export interface McpBrainProviderOptions {
	config: McpBrainConfig;
	transport: () => Promise<Transport>;
}

const remoteError = z.object({
	error: z.string(),
	message: z.string().optional(),
	suggestions: z.array(z.string()).optional(),
	currentRevision: z.number().int().nullable().optional(),
	fields: z.array(z.string()).optional(),
});

function toBrainError(slug: string, value: unknown): BrainError {
	const parsed = remoteError.safeParse(value);
	if (!parsed.success) return new BrainProviderError("el brain remoto devolvió un error sin forma conocida");
	const error = parsed.data;
	switch (error.error) {
		case "not_found":
			return new BrainNotFound(slug, error.suggestions ?? []);
		case "conflict":
			return new BrainConflict(slug, error.currentRevision ?? null);
		case "validation":
			return new BrainValidation(error.fields ?? []);
		case "forbidden":
			return new BrainForbidden(error.message ?? "el brain remoto rechazó la operación");
		default:
			return new BrainProviderError(`el brain remoto devolvió el error ${error.error}`);
	}
}

export function streamableTransport(
	url: string,
	getToken: () => Promise<string>,
): () => Promise<Transport> {
	return async () =>
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: { authorization: `Bearer ${await getToken()}` } },
		});
}

export function createMcpBrainProvider(options: McpBrainProviderOptions): BrainProvider {
	const { config } = options;

	async function call<T>(
		tool: string,
		args: Record<string, unknown>,
		schema: z.ZodType<T>,
		slug: string,
	): Promise<T> {
		const client = new Client({ name: "innovas-agents-brain", version: "1.0.0" });
		let result: Awaited<ReturnType<Client["callTool"]>>;
		try {
			await client.connect(await options.transport(), { timeout: config.timeoutMs });
			result = await client.callTool({ name: tool, arguments: args }, undefined, {
				timeout: config.timeoutMs,
			});
		} catch (error) {
			throw new BrainProviderError(
				`el brain remoto no respondió: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			await client.close().catch(() => {});
		}

		if (result.isError) throw toBrainError(slug, result.structuredContent);

		const parsed = schema.safeParse(result.structuredContent);
		if (!parsed.success) {
			const field = parsed.error.issues[0]?.path.join(".") || "respuesta";
			throw new BrainProviderError(`el brain remoto devolvió una respuesta inválida en ${field}`);
		}
		return parsed.data;
	}

	return {
		async search(input) {
			const out = await call(config.tools.search, { ...input }, brainResultSchemas.search, "");
			return out.results;
		},
		async read(slug) {
			const out = await call(config.tools.read, { slug }, brainResultSchemas.read, slug);
			return out.page;
		},
		async upsert(write) {
			const out = await call(config.tools.upsert, { ...write }, brainResultSchemas.upsert, write.slug);
			return { slug: out.slug, revision: out.revision };
		},
	};
}
```

El autor no viaja al remoto: el servidor de afuera atribuye con su propia auth (la llave de servicio). Nuestra atribución queda en la aprobación de la sesión.

- [ ] **Step 6: Conectarlo en `getBrainProvider`**

```ts
// lib/brain/provider.ts
import { apiKeyBearer } from "../connectors/auth";
import { createAdminClient } from "../supabase/admin";
import { createMcpBrainProvider, streamableTransport } from "./mcp.ts";
import type { BrainBinding } from "./resolve.ts";
import type { BrainProvider } from "./types.ts";
import { createWikiProvider } from "./wiki.ts";
import { createSupabaseWikiStore } from "./wiki-store.ts";

export function getBrainProvider(binding: BrainBinding): BrainProvider {
	if (binding.provider === "mcp") {
		const bearer = apiKeyBearer(binding.connectorUid);
		return createMcpBrainProvider({
			config: binding.config,
			transport: streamableTransport(binding.config.url, async () => (await bearer.getToken()).token),
		});
	}
	return createWikiProvider({
		tenantId: binding.tenantId,
		bindingId: binding.id,
		config: binding.config,
		store: createSupabaseWikiStore(createAdminClient()),
	});
}
```

Borrar el `throw` transitorio de la Task 3.

- [ ] **Step 7: Correr todo**

Run: `npx vitest run tests/brain tests/connectors && npm run typecheck`
Expected: PASS, incluido `tests/connectors/import-rule.test.ts` (ningún archivo nuevo importa `@vercel/connect`).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/brain/mcp.ts lib/brain/errors.ts lib/brain/provider.ts tests/brain/mcp-provider.test.ts tests/brain/errors.test.ts
git commit -m "feat: proveedor mcp del brain sobre un servidor remoto"
```

---

## E3 · Emisor OAuth

### Task 6: Login que vuelve a donde estaba

**Files:**
- Create: `lib/auth/next-path.ts`
- Modify: `app/(auth)/login/page.tsx`, `app/auth/callback/route.ts`
- Test: `tests/auth/next-path.test.ts`

**Interfaces:**
- Produces: `safeNextPath(raw: string | null | undefined, origin: string): string`.

- [ ] **Step 1: Test que falla**

```ts
// tests/auth/next-path.test.ts
import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/next-path";

const origin = "https://agents.innov.as";

describe("safeNextPath", () => {
	it("acepta un path relativo con query", () => {
		expect(safeNextPath("/oauth/consent?authorization_id=abc", origin)).toBe(
			"/oauth/consent?authorization_id=abc",
		);
	});

	it("sin valor vuelve a la raíz", () => {
		expect(safeNextPath(null, origin)).toBe("/");
		expect(safeNextPath("", origin)).toBe("/");
	});

	it.each([
		"//evil.com",
		"/\\evil.com",
		"https://evil.com",
		"javascript:alert(1)",
		"evil.com",
		"/%2F%2Fevil.com",
	])("rechaza %s", (raw) => {
		const result = safeNextPath(raw, origin);
		expect(new URL(result, origin).origin).toBe(origin);
		expect(result.startsWith("//")).toBe(false);
	});
});
```

El caso `/%2F%2Fevil.com` es un path válido del mismo origen (el navegador no lo decodifica a `//`); el test solo exige que se quede en el origen.

Run: `npx vitest run tests/auth/next-path.test.ts` → FAIL.

- [ ] **Step 2: Implementar**

```ts
// lib/auth/next-path.ts
// Destino después del login (spec etapa 11 §4.3). Solo paths del mismo
// origen: cualquier otra cosa es un open redirect.
export function safeNextPath(raw: string | null | undefined, origin: string): string {
	if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
		return "/";
	}
	try {
		const url = new URL(raw, origin);
		if (url.origin !== origin) return "/";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/";
	}
}
```

Run: `npx vitest run tests/auth/next-path.test.ts` → PASS.

- [ ] **Step 3: Login**

En `app/(auth)/login/page.tsx`, agregar arriba del componente:

```ts
function callbackUrl(): string {
	const next = new URLSearchParams(window.location.search).get("next");
	const base = `${window.location.origin}/auth/callback`;
	return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}
```

y usar `callbackUrl()` en `redirectTo` y en `emailRedirectTo` en lugar de las dos plantillas actuales. No se valida acá: valida el callback, que es quien redirige.

- [ ] **Step 4: Callback**

En `app/auth/callback/route.ts`, importar `safeNextPath` y reemplazar el último `return`:

```ts
	const next = safeNextPath(requestUrl.searchParams.get("next"), requestUrl.origin);
	return NextResponse.redirect(new URL(next, requestUrl.origin));
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npx vitest run tests/auth`
Expected: PASS.

Con `npm run dev` (preview_start `innovas-agents`), abrir `/login?next=/oauth/consent?authorization_id=x` y confirmar en `read_page` que la página carga igual que sin `next`. El login real no se puede completar en este entorno; el recorrido completo se verifica en la Task 12.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/next-path.ts app/\(auth\)/login/page.tsx app/auth/callback/route.ts tests/auth/next-path.test.ts
git commit -m "feat: el login vuelve al destino pedido, solo dentro del mismo origen"
```

---

### Task 7: Pantalla de consentimiento OAuth

**Files:**
- Create: `app/oauth/consent/page.tsx`, `app/oauth/consent/actions.ts`, `lib/auth/oauth-scopes.ts`
- Modify: `proxy.ts:40-42`
- Test: `tests/auth/oauth-scopes.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase` (`lib/supabase/server.ts`), `supabase.auth.oauth.getAuthorizationDetails / approveAuthorization / denyAuthorization` de `@supabase/auth-js`.
- Produces: `describeScopes(scope: string): string[]`; ruta `/oauth/consent`.

- [ ] **Step 1: Test que falla**

```ts
// tests/auth/oauth-scopes.test.ts
import { describe, expect, it } from "vitest";
import { describeScopes } from "@/lib/auth/oauth-scopes";

describe("describeScopes", () => {
	it("traduce los scopes conocidos", () => {
		expect(describeScopes("openid email profile")).toEqual([
			"Saber quién sos",
			"Ver tu mail",
			"Ver tu nombre y tu foto",
		]);
	});

	it("muestra tal cual un scope desconocido, sin duplicar ni dejar vacíos", () => {
		expect(describeScopes("  openid  otro openid ")).toEqual(["Saber quién sos", "otro"]);
	});
});
```

Run: `npx vitest run tests/auth/oauth-scopes.test.ts` → FAIL.

- [ ] **Step 2: Implementar**

```ts
// lib/auth/oauth-scopes.ts
const LABELS: Record<string, string> = {
	openid: "Saber quién sos",
	email: "Ver tu mail",
	profile: "Ver tu nombre y tu foto",
	phone: "Ver tu teléfono",
};

export function describeScopes(scope: string): string[] {
	const unique = [...new Set(scope.split(/\s+/).filter(Boolean))];
	return unique.map((item) => LABELS[item] ?? item);
}
```

Run → PASS.

- [ ] **Step 3: Server actions**

```ts
// app/oauth/consent/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

function authorizationId(formData: FormData): string {
	const value = formData.get("authorization_id");
	return typeof value === "string" ? value : "";
}

async function decide(formData: FormData, approve: boolean): Promise<never> {
	const id = authorizationId(formData);
	const supabase = await createServerSupabase();
	const { data, error } = approve
		? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
		: await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
	if (error || !data) {
		redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}&error=1`);
	}
	redirect(data.redirect_url);
}

export async function approveConsent(formData: FormData): Promise<void> {
	await decide(formData, true);
}

export async function denyConsent(formData: FormData): Promise<void> {
	await decide(formData, false);
}
```

Confirmar en `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` que `denyAuthorization` acepta el mismo `{ skipBrowserRedirect }` que `approveAuthorization` (línea ~2674). Si no lo acepta, llamarlo sin opciones.

- [ ] **Step 4: Página**

```tsx
// app/oauth/consent/page.tsx
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { describeScopes } from "@/lib/auth/oauth-scopes";
import { createServerSupabase } from "@/lib/supabase/server";
import { approveConsent, denyConsent } from "./actions";

function Frame({ children }: { children: React.ReactNode }) {
	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6">{children}</div>
		</main>
	);
}

export default async function ConsentPage({
	searchParams,
}: {
	searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
	const { authorization_id: authorizationId, error: failed } = await searchParams;

	if (!authorizationId) {
		return (
			<Frame>
				<h1 className="text-xl">Falta el pedido de autorización</h1>
				<p className="text-muted-foreground">Volvé a conectar desde tu herramienta.</p>
			</Frame>
		);
	}

	const supabase = await createServerSupabase();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) {
		const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
		redirect(`/login?next=${encodeURIComponent(next)}`);
	}

	const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
	if (error || !data) {
		return (
			<Frame>
				<h1 className="text-xl">El pedido venció o no es válido</h1>
				<p className="text-muted-foreground">Volvé a conectar desde tu herramienta.</p>
			</Frame>
		);
	}
	if ("redirect_url" in data) redirect(data.redirect_url);

	return (
		<Frame>
			<div className="space-y-2">
				<h1 className="text-xl">{data.client.name} quiere conectarse a tu cuenta</h1>
				<p className="text-muted-foreground text-sm">
					Entrás como {data.user.email}. Va a poder usar el brain de los clientes a los que ya tenés
					acceso, con los mismos permisos que tenés en la plataforma.
				</p>
			</div>
			<ul className="list-disc space-y-1 pl-5 text-sm">
				{describeScopes(data.scope).map((label) => (
					<li key={label}>{label}</li>
				))}
			</ul>
			<p className="text-muted-foreground text-xs">Vuelve a: {data.redirect_uri}</p>
			{failed ? (
				<p className="text-destructive text-sm">No se pudo registrar tu respuesta. Probá de nuevo.</p>
			) : null}
			<div className="flex gap-3">
				<form action={approveConsent}>
					<input name="authorization_id" type="hidden" value={authorizationId} />
					<Button type="submit">Permitir</Button>
				</form>
				<form action={denyConsent}>
					<input name="authorization_id" type="hidden" value={authorizationId} />
					<Button type="submit" variant="outline">
						No permitir
					</Button>
				</form>
			</div>
		</Frame>
	);
}
```

`user` queda como posiblemente `null` para TypeScript después del `redirect` si la versión de Next no tipa `redirect` como `never`; en ese caso usar `if (!user) return redirect(...)`.

- [ ] **Step 5: Proxy**

En `proxy.ts`, el matcher:

```ts
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|eve/|brain/|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
	],
```

y en el comentario de cabecera: "Las rutas de eve, del brain por MCP y de discovery quedan afuera: se autentican por bearer o son públicas."

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npx vitest run tests/auth`
Expected: PASS.

Con el dev server: `/oauth/consent` sin parámetro muestra "Falta el pedido de autorización"; `/oauth/consent?authorization_id=x` sin sesión redirige a `/login?next=…` (confirmar la URL final con `read_page` o `javascript_tool` leyendo `location.href`). Screenshot de las dos.

- [ ] **Step 7: Commit**

```bash
git add app/oauth lib/auth/oauth-scopes.ts proxy.ts tests/auth/oauth-scopes.test.ts
git commit -m "feat: pantalla de consentimiento del emisor OAuth"
```

---

### Task 8: Configuración de Supabase y verificación del emisor (V1, V2)

**Files:**
- Create: `scripts/oauth-probe.mts`, `scripts/oauth-probe-check.ts`
- Modify: `package.json` (script `oauth:probe`)
- Test: `tests/scripts/oauth-probe-check.test.ts`

**Interfaces:**
- Produces: `checkAuthServerMetadata(metadata: unknown, expectedIssuer: string): { ok: boolean; problems: string[] }`.

Esta task tiene una parte que hace una persona en el dashboard de Supabase. **Es un punto de control: si V1 o V2 fallan, no se arranca la E4.** Se le avisa a Mati con el resultado y se decide.

- [ ] **Step 1: Test que falla**

```ts
// tests/scripts/oauth-probe-check.test.ts
import { describe, expect, it } from "vitest";
import { checkAuthServerMetadata } from "@/scripts/oauth-probe-check";

const issuer = "https://ref.supabase.co/auth/v1";
const complete = {
	issuer,
	authorization_endpoint: `${issuer}/oauth/authorize`,
	token_endpoint: `${issuer}/oauth/token`,
	registration_endpoint: `${issuer}/oauth/clients/register`,
	jwks_uri: `${issuer}/.well-known/jwks.json`,
	code_challenge_methods_supported: ["S256"],
};

describe("checkAuthServerMetadata", () => {
	it("una metadata completa pasa", () => {
		expect(checkAuthServerMetadata(complete, issuer)).toEqual({ ok: true, problems: [] });
	});

	it("sin registration_endpoint falla con V2", () => {
		const { registration_endpoint: _omit, ...rest } = complete;
		const result = checkAuthServerMetadata(rest, issuer);
		expect(result.ok).toBe(false);
		expect(result.problems).toContain(
			"falta registration_endpoint (V2): los clientes no se pueden registrar solos",
		);
	});

	it("otro issuer o sin S256 falla", () => {
		const result = checkAuthServerMetadata(
			{ ...complete, issuer: "https://otro", code_challenge_methods_supported: ["plain"] },
			issuer,
		);
		expect(result.problems).toEqual([
			`issuer es https://otro, se esperaba ${issuer}`,
			"no anuncia PKCE S256",
		]);
	});

	it("algo que no es un objeto falla", () => {
		expect(checkAuthServerMetadata("<html>", issuer).ok).toBe(false);
	});
});
```

Run → FAIL.

- [ ] **Step 2: Implementar el chequeo**

```ts
// scripts/oauth-probe-check.ts
// Chequeo de la metadata del emisor OAuth (spec etapa 11 V1, V2). Sin imports.
export function checkAuthServerMetadata(
	metadata: unknown,
	expectedIssuer: string,
): { ok: boolean; problems: string[] } {
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
		return { ok: false, problems: ["la metadata no es un objeto JSON (V1)"] };
	}
	const raw = metadata as Record<string, unknown>;
	const problems: string[] = [];
	if (raw.issuer !== expectedIssuer) {
		problems.push(`issuer es ${String(raw.issuer)}, se esperaba ${expectedIssuer}`);
	}
	for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
		if (typeof raw[key] !== "string") problems.push(`falta ${key} (V1)`);
	}
	if (typeof raw.registration_endpoint !== "string") {
		problems.push("falta registration_endpoint (V2): los clientes no se pueden registrar solos");
	}
	const methods = raw.code_challenge_methods_supported;
	if (!Array.isArray(methods) || !methods.includes("S256")) problems.push("no anuncia PKCE S256");
	return { ok: problems.length === 0, problems };
}
```

Run → PASS.

- [ ] **Step 3: Script**

```ts
// scripts/oauth-probe.mts
// Verifica el emisor OAuth de Supabase (spec etapa 11 V1, V2). Uso:
//   npm run oauth:probe
import { checkAuthServerMetadata } from "./oauth-probe-check.ts";

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!base) {
	console.error("falta NEXT_PUBLIC_SUPABASE_URL en .env.local");
	process.exit(1);
}
const issuer = `${base.replace(/\/$/, "")}/auth/v1`;
const url = `${base.replace(/\/$/, "")}/.well-known/oauth-authorization-server/auth/v1`;

const response = await fetch(url);
const text = await response.text();
let metadata: unknown = text;
try {
	metadata = JSON.parse(text);
} catch {}

const result = checkAuthServerMetadata(metadata, issuer);
console.log(`${url} → HTTP ${response.status}`);
if (result.ok) {
	console.log("emisor OK: metadata completa, con registration_endpoint y PKCE S256");
} else {
	for (const problem of result.problems) console.log(`✗ ${problem}`);
	process.exit(1);
}
```

`package.json`, en `scripts`: `"oauth:probe": "node --env-file=.env.local scripts/oauth-probe.mts"`.

- [ ] **Step 4: Configuración en Supabase (la hace una persona)**

Pedirle a Mati, con estos pasos exactos, en el proyecto de producción de `innovas-agents`:
1. **Authentication → OAuth Server**: prender el servidor.
2. **Allow Dynamic OAuth Apps**: prender.
3. **Authorization Path**: `/oauth/consent`.
4. **Authentication → URL Configuration → Redirect URLs**: sumar `https://<dominio de producción>/auth/callback**` y `http://localhost:3000/auth/callback**` (con `**`, para que el callback con `?next=` coincida).

En local: `npx supabase --version` y buscar en la doc de esa versión del CLI si `supabase/config.toml` acepta la sección del OAuth Server. Si la acepta, sumarla con los mismos valores y `npm run db:reset`; si no, E3 y E4 se prueban de punta a punta solo contra el proyecto remoto (spec §4.1), y los tests unitarios no cambian.

- [ ] **Step 5: Correr el probe**

Run: `npm run oauth:probe`
Expected: `emisor OK`. Si falla: **frenar**, mandarle la salida a Mati y decidir (spec §11, V1/V2). No arrancar la Task 9.

- [ ] **Step 6: Commit**

```bash
git add scripts/oauth-probe.mts scripts/oauth-probe-check.ts package.json tests/scripts/oauth-probe-check.test.ts
git commit -m "chore: probe del emisor OAuth de Supabase"
```

---

## E4 · Endpoint del brain

### Task 9: Límite por minuto

**Files:**
- Create: `supabase/migrations/20260924100200_brain_mcp_usage.sql`, `supabase/tests/18_brain_mcp_usage.test.sql`, `lib/brain/mcp-server/rate-limit.ts`
- Modify: `lib/brain/errors.ts`
- Test: `tests/brain/mcp-server/rate-limit.test.ts`, `tests/brain/errors.test.ts`

**Interfaces:**
- Consumes: `McpLimits` (Task 3).
- Produces:
  - Tabla `brain_mcp_usage` y función `brain_mcp_hit(p_tenant_id uuid, p_user_id uuid, p_kind text, p_limit integer) returns table (allowed boolean, retry_after_seconds integer)`.
  - `class BrainRateLimited extends BrainError` con `code = "rate_limited"` y `retryAfterSeconds: number`; `toToolError` le suma `retryable: true` y `retryAfterSeconds`.
  - `type HitFn = (input: { tenantId: string; userId: string; kind: "read" | "write"; limit: number }) => Promise<{ allowed: boolean; retryAfterSeconds: number }>`.
  - `interface RateLimiter { check(kind: "read" | "write"): Promise<void> }` (tira `BrainRateLimited`).
  - `createRateLimiter(input: { tenantId: string; userId: string; limits: McpLimits; hit: HitFn }): RateLimiter`.

- [ ] **Step 1: Cargar la skill** `supabase-postgres-best-practices`.

- [ ] **Step 2: pgTAP que falla**

```sql
-- supabase/tests/18_brain_mcp_usage.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'ana@a.test', now()),
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'beto@b.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000021', 'tenant-a', 'A'),
  ('aaaaaaaa-0000-0000-0000-000000000022', 'tenant-b', 'B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'tenant_member'),
  ('aaaaaaaa-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444444', 'tenant_member');

select is(
  (select allowed from public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'read', 1)),
  true,
  'la primera lectura del minuto pasa'
);

select results_eq(
  $$select allowed, retry_after_seconds > 0 from public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'read', 1)$$,
  $$values (false, true)$$,
  'la segunda con límite 1 se corta y dice cuánto esperar'
);

select is(
  (select allowed from public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'write', 1)),
  true,
  'escrituras y lecturas se cuentan por separado'
);

insert into public.brain_mcp_usage (tenant_id, user_id, window_start, reads)
values ('aaaaaaaa-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444444', date_trunc('minute', now()) - interval '1 minute', 500);

select is(
  (select allowed from public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444444', 'read', 60)),
  true,
  'la ventana nueva arranca de cero'
);

select throws_ok(
  $$select public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'borrar', 1)$$,
  'P0001',
  null,
  'un tipo desconocido tira'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is_empty(
  $$select 1 from public.brain_mcp_usage where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000022'$$,
  'un usuario no ve el contador de otro tenant'
);

select throws_ok(
  $$select public.brain_mcp_hit('aaaaaaaa-0000-0000-0000-000000000021', '33333333-3333-3333-3333-333333333333', 'read', 1000)$$,
  '42501',
  null,
  'authenticated no puede ejecutar brain_mcp_hit'
);

select * from finish();
rollback;
```

Run: `npm run db:test` → FAIL (tabla inexistente).

- [ ] **Step 3: Migración**

```sql
-- supabase/migrations/20260924100200_brain_mcp_usage.sql
-- Spec etapa 11 §6.1 (D8): contador por minuto del endpoint MCP del brain, por
-- usuario y tenant. Escribe solo service_role, a través de brain_mcp_hit.
create table public.brain_mcp_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  reads integer not null default 0,
  writes integer not null default 0,
  primary key (tenant_id, user_id, window_start)
);

alter table public.brain_mcp_usage enable row level security;

revoke all on public.brain_mcp_usage from anon, authenticated;
grant select on public.brain_mcp_usage to authenticated;

create policy brain_mcp_usage_select on public.brain_mcp_usage
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
    or (select public.is_platform_admin())
  );

create function public.brain_mcp_hit(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text,
  p_limit integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  if p_kind not in ('read', 'write') then
    raise exception 'brain_mcp_hit: tipo desconocido %', p_kind;
  end if;

  insert into public.brain_mcp_usage as u (tenant_id, user_id, window_start, reads, writes)
  values (
    p_tenant_id, p_user_id, v_window,
    case when p_kind = 'read' then 1 else 0 end,
    case when p_kind = 'write' then 1 else 0 end
  )
  on conflict (tenant_id, user_id, window_start) do update
    set reads = u.reads + case when p_kind = 'read' then 1 else 0 end,
        writes = u.writes + case when p_kind = 'write' then 1 else 0 end
  returning case when p_kind = 'read' then u.reads else u.writes end into v_count;

  allowed := v_count <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_window + interval '1 minute' - now())))::integer)
  end;
  return next;
end;
$$;

revoke execute on function public.brain_mcp_hit(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.brain_mcp_hit(uuid, uuid, text, integer) to service_role;
```

Run: `npm run db:test`
Expected: PASS, incluidos `06_anon_grants` y `07_authenticated_grants`.

- [ ] **Step 4: Error tipado — test que falla**

En `tests/brain/errors.test.ts`:

```ts
	it("un límite alcanzado es reintentable y dice cuánto esperar", () => {
		expect(toToolError(new BrainRateLimited(12))).toEqual({
			ok: false,
			error: "rate_limited",
			message: "Pasaste el límite de llamadas por minuto. Probá de nuevo en 12 segundos.",
			retryable: true,
			retryAfterSeconds: 12,
		});
	});
```

- [ ] **Step 5: Implementar el error**

En `lib/brain/errors.ts`: sumar `| "rate_limited"` a `BrainErrorCode`, sumar a `BrainToolError` los campos `retryable?: boolean; retryAfterSeconds?: number;`, y:

```ts
export class BrainRateLimited extends BrainError {
	readonly retryAfterSeconds: number;

	constructor(retryAfterSeconds: number) {
		super(
			"rate_limited",
			`Pasaste el límite de llamadas por minuto. Probá de nuevo en ${retryAfterSeconds} segundos.`,
		);
		this.retryAfterSeconds = retryAfterSeconds;
	}
}
```

y en `toToolError`, antes del `return base` final:

```ts
	if (error instanceof BrainRateLimited)
		return { ...base, retryable: true, retryAfterSeconds: error.retryAfterSeconds };
```

- [ ] **Step 6: Limitador — test que falla**

```ts
// tests/brain/mcp-server/rate-limit.test.ts
import { describe, expect, it, vi } from "vitest";
import { BrainRateLimited } from "@/lib/brain/errors";
import { createRateLimiter } from "@/lib/brain/mcp-server/rate-limit";

const limits = { readsPerMinute: 60, writesPerMinute: 10 };

describe("createRateLimiter", () => {
	it("pasa el límite que corresponde al tipo", async () => {
		const hit = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 }));
		const limiter = createRateLimiter({ tenantId: "t", userId: "u", limits, hit });
		await limiter.check("read");
		await limiter.check("write");
		expect(hit.mock.calls.map(([input]) => input)).toEqual([
			{ tenantId: "t", userId: "u", kind: "read", limit: 60 },
			{ tenantId: "t", userId: "u", kind: "write", limit: 10 },
		]);
	});

	it("la llamada 61 se corta con los segundos que faltan", async () => {
		let count = 0;
		const limiter = createRateLimiter({
			tenantId: "t",
			userId: "u",
			limits,
			hit: async ({ limit }) => {
				count += 1;
				return count <= limit
					? { allowed: true, retryAfterSeconds: 0 }
					: { allowed: false, retryAfterSeconds: 17 };
			},
		});
		for (let i = 0; i < 60; i += 1) await limiter.check("read");
		const error = await limiter.check("read").catch((caught) => caught);
		expect(error).toBeInstanceOf(BrainRateLimited);
		expect(error.retryAfterSeconds).toBe(17);
	});
});
```

- [ ] **Step 7: Implementar**

```ts
// lib/brain/mcp-server/rate-limit.ts
// Límite por minuto del endpoint MCP del brain (spec etapa 11 §6).
import { BrainRateLimited } from "../errors.ts";
import type { McpLimits } from "../limits.ts";

export type HitFn = (input: {
	tenantId: string;
	userId: string;
	kind: "read" | "write";
	limit: number;
}) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;

export interface RateLimiter {
	check(kind: "read" | "write"): Promise<void>;
}

export function createRateLimiter(input: {
	tenantId: string;
	userId: string;
	limits: McpLimits;
	hit: HitFn;
}): RateLimiter {
	return {
		async check(kind) {
			const limit = kind === "read" ? input.limits.readsPerMinute : input.limits.writesPerMinute;
			const result = await input.hit({ tenantId: input.tenantId, userId: input.userId, kind, limit });
			if (!result.allowed) throw new BrainRateLimited(result.retryAfterSeconds);
		},
	};
}
```

- [ ] **Step 8: Correr**

Run: `npx vitest run tests/brain && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260924100200_brain_mcp_usage.sql supabase/tests/18_brain_mcp_usage.test.sql lib/brain/errors.ts lib/brain/mcp-server/rate-limit.ts tests/brain/errors.test.ts tests/brain/mcp-server/rate-limit.test.ts
git commit -m "feat: límite por minuto del brain por MCP"
```

---

### Task 10: Acceso al endpoint

**Files:**
- Create: `lib/brain/mcp-server/access.ts`, `lib/brain/mcp-server/supabase.ts`
- Test: `tests/brain/mcp-server/access.test.ts`

**Interfaces:**
- Consumes: `BrainBinding` (Task 3), `resolveBrainBinding` y `loadTenantBindings`, `HitFn` (Task 9), `extractBearerToken` de `eve/channels/auth`.
- Produces:
  - `type ClaimsVerifier = (token: string) => Promise<Record<string, unknown> | null>`.
  - `interface AccessStore { tenantBySlug(slug: string): Promise<{ id: string; active: boolean } | null>; rolesOf(userId: string): Promise<{ tenantId: string; role: string }[]>; brainBinding(tenantId: string): Promise<BrainBinding | null> }`.
  - `type McpAccess = { ok: true; tenantId: string; userId: string; access: "read" | "read_write"; binding: BrainBinding } | { ok: false; status: 401 | 403 | 404; code: "unauthorized" | "invalid_token" | "forbidden" | "tenant_not_found" | "brain_not_configured"; message: string }`.
  - `resolveMcpAccess(input: { authorization: string | null; slug: string }, deps: { verify: ClaimsVerifier; store: AccessStore }): Promise<McpAccess>`.
  - En `supabase.ts`: `supabaseClaimsVerifier(): ClaimsVerifier`, `supabaseAccessStore(): AccessStore`, `supabaseHit(): HitFn`.

- [ ] **Step 1: Test que falla**

```ts
// tests/brain/mcp-server/access.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AccessStore, resolveMcpAccess } from "@/lib/brain/mcp-server/access";
import type { BrainBinding } from "@/lib/brain/resolve";

const binding: BrainBinding = {
	id: "b1",
	tenantId: "tenant-a",
	provider: "wiki",
	config: {
		categories: ["comercial"],
		requiredFrontmatter: [],
		search: "fts",
		mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
	},
};

function store(overrides: Partial<AccessStore> = {}): AccessStore {
	return {
		tenantBySlug: async (slug) =>
			slug === "a" ? { id: "tenant-a", active: true } : slug === "b" ? { id: "tenant-b", active: true } : null,
		rolesOf: async (userId) =>
			userId === "ana"
				? [{ tenantId: "tenant-a", role: "tenant_member" }]
				: userId === "admin"
					? [{ tenantId: "tenant-a", role: "tenant_admin" }]
					: userId === "root"
						? [{ tenantId: "tenant-x", role: "platform_admin" }]
						: [],
		brainBinding: async (tenantId) => (tenantId === "tenant-a" ? binding : null),
		...overrides,
	};
}

const verify = vi.fn(async (token: string) =>
	token === "vencido" ? null : { sub: token, client_id: "claude", role: "authenticated" },
);

function access(authorization: string | null, slug = "a", deps = {}) {
	return resolveMcpAccess({ authorization, slug }, { verify, store: store(), ...deps });
}

describe("resolveMcpAccess", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	afterEach(() => warn.mockClear());

	it("un miembro lee su tenant", async () => {
		expect(await access("Bearer ana")).toEqual({
			ok: true,
			tenantId: "tenant-a",
			userId: "ana",
			access: "read",
			binding,
		});
	});

	it("un tenant_admin escribe", async () => {
		expect(await access("Bearer admin")).toMatchObject({ ok: true, access: "read_write" });
	});

	it("un platform_admin entra a un tenant donde no tiene membresía, y escribe", async () => {
		expect(await access("Bearer root")).toMatchObject({ ok: true, tenantId: "tenant-a", access: "read_write" });
	});

	it("un miembro de a contra la URL de b recibe 403", async () => {
		expect(await access("Bearer ana", "b")).toMatchObject({ ok: false, status: 403, code: "forbidden" });
	});

	it("sin token es 401 unauthorized, token inválido es 401 invalid_token", async () => {
		expect(await access(null)).toMatchObject({ ok: false, status: 401, code: "unauthorized" });
		expect(await access("Basic abc")).toMatchObject({ ok: false, status: 401, code: "unauthorized" });
		expect(await access("Bearer vencido")).toMatchObject({ ok: false, status: 401, code: "invalid_token" });
	});

	it("un token sin client_id no entra, y el aviso nombra los claims sin sus valores", async () => {
		const result = await resolveMcpAccess(
			{ authorization: "Bearer ana", slug: "a" },
			{ verify: async () => ({ sub: "ana", role: "authenticated", email: "ana@a.test" }), store: store() },
		);
		expect(result).toMatchObject({ ok: false, status: 401, code: "invalid_token" });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("sub, role, email"));
		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("ana@a.test"));
	});

	it("un tenant inexistente o inactivo es 404", async () => {
		expect(await access("Bearer ana", "zzz")).toMatchObject({ status: 404, code: "tenant_not_found" });
		const inactive = store({ tenantBySlug: async () => ({ id: "tenant-a", active: false }) });
		expect(await access("Bearer ana", "a", { store: inactive })).toMatchObject({ status: 404, code: "tenant_not_found" });
	});

	it("un tenant sin brain es 404 brain_not_configured, después de chequear acceso", async () => {
		const sinBrain = store({ brainBinding: async () => null });
		expect(await access("Bearer ana", "a", { store: sinBrain })).toMatchObject({
			status: 404,
			code: "brain_not_configured",
		});
		expect(await access("Bearer ana", "b", { store: sinBrain })).toMatchObject({ status: 403 });
	});
});
```

El último caso fija el orden: a alguien sin acceso no se le dice si el tenant tiene brain.

Run → FAIL.

- [ ] **Step 2: Implementar `access.ts`**

```ts
// lib/brain/mcp-server/access.ts
// Quién entra al brain de qué tenant por MCP (spec etapa 11 §5.2, D3, D4, D7).
// El tenant sale de la URL y el usuario del token; nada viene de los argumentos.
import { extractBearerToken } from "eve/channels/auth";
import type { BrainBinding } from "../resolve.ts";

export type ClaimsVerifier = (token: string) => Promise<Record<string, unknown> | null>;

export interface AccessStore {
	tenantBySlug(slug: string): Promise<{ id: string; active: boolean } | null>;
	rolesOf(userId: string): Promise<{ tenantId: string; role: string }[]>;
	brainBinding(tenantId: string): Promise<BrainBinding | null>;
}

type Denied = {
	ok: false;
	status: 401 | 403 | 404;
	code: "unauthorized" | "invalid_token" | "forbidden" | "tenant_not_found" | "brain_not_configured";
	message: string;
};

export type McpAccess =
	| { ok: true; tenantId: string; userId: string; access: "read" | "read_write"; binding: BrainBinding }
	| Denied;

function deny(status: Denied["status"], code: Denied["code"], message: string): Denied {
	return { ok: false, status, code, message };
}

export async function resolveMcpAccess(
	input: { authorization: string | null; slug: string },
	deps: { verify: ClaimsVerifier; store: AccessStore },
): Promise<McpAccess> {
	const token = extractBearerToken(input.authorization);
	if (!token) return deny(401, "unauthorized", "Falta el token de acceso.");

	const claims = await deps.verify(token);
	if (!claims || typeof claims.sub !== "string" || claims.sub === "") {
		return deny(401, "invalid_token", "El token no es válido o venció.");
	}
	if (typeof claims.client_id !== "string" || claims.client_id === "") {
		console.warn(`brain mcp: token sin client_id; claims presentes: ${Object.keys(claims).join(", ")}`);
		return deny(401, "invalid_token", "El token no fue emitido para una aplicación conectada.");
	}
	const userId = claims.sub;

	const tenant = await deps.store.tenantBySlug(input.slug);
	if (!tenant || !tenant.active) return deny(404, "tenant_not_found", "No existe ese cliente.");

	const roles = await deps.store.rolesOf(userId);
	const platformAdmin = roles.some((row) => row.role === "platform_admin");
	const own = roles.find((row) => row.tenantId === tenant.id);
	if (!platformAdmin && !own) return deny(403, "forbidden", "No tenés acceso a este cliente.");

	const access = platformAdmin || own?.role === "tenant_admin" ? "read_write" : "read";

	const binding = await deps.store.brainBinding(tenant.id);
	if (!binding) return deny(404, "brain_not_configured", "Este cliente no tiene brain configurado.");

	return { ok: true, tenantId: tenant.id, userId, access, binding };
}
```

Si `extractBearerToken` no se puede importar en vitest por la resolución de `eve/channels/auth`, confirmar primero con `grep -rn "eve/channels/auth" tests` que otro test ya lo importa; si no, reemplazar por una función local de tres líneas (`/^Bearer\s+(.+)$/i`) y dejar anotado el motivo en el commit.

Run: `npx vitest run tests/brain/mcp-server/access.test.ts` → PASS.

- [ ] **Step 3: Implementar `supabase.ts`**

```ts
// lib/brain/mcp-server/supabase.ts
// Dependencias reales del endpoint: verificador del emisor (D6), lecturas de
// acceso y el contador. Todo con service role salvo la verificación del token.
import { createClient } from "@supabase/supabase-js";
import { loadTenantBindings } from "../../connectors/bindings";
import { createAdminClient } from "../../supabase/admin";
import { resolveBrainBinding } from "../resolve.ts";
import type { AccessStore, ClaimsVerifier } from "./access.ts";
import type { HitFn } from "./rate-limit.ts";

export function supabaseClaimsVerifier(): ClaimsVerifier {
	const client = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{ auth: { persistSession: false, autoRefreshToken: false } },
	);
	return async (token) => {
		const { data, error } = await client.auth.getClaims(token);
		if (error || !data) return null;
		return data.claims as Record<string, unknown>;
	};
}

export function supabaseAccessStore(): AccessStore {
	const admin = createAdminClient();
	return {
		async tenantBySlug(slug) {
			const { data, error } = await admin.from("tenants").select("id, active").eq("slug", slug).maybeSingle();
			if (error) throw new Error(`No pude leer el tenant: ${error.message}`);
			return data ? { id: data.id as string, active: data.active as boolean } : null;
		},
		async rolesOf(userId) {
			const { data, error } = await admin.from("memberships").select("tenant_id, role").eq("user_id", userId);
			if (error) throw new Error(`No pude leer las membresías: ${error.message}`);
			return (data ?? []).map((row) => ({ tenantId: row.tenant_id as string, role: row.role as string }));
		},
		brainBinding: (tenantId) => resolveBrainBinding(tenantId, loadTenantBindings),
	};
}

export function supabaseHit(): HitFn {
	const admin = createAdminClient();
	return async ({ tenantId, userId, kind, limit }) => {
		const { data, error } = await admin
			.rpc("brain_mcp_hit", { p_tenant_id: tenantId, p_user_id: userId, p_kind: kind, p_limit: limit })
			.single();
		if (error || !data) throw new Error(`No pude contar la llamada: ${error?.message ?? "sin fila"}`);
		const row = data as { allowed: boolean; retry_after_seconds: number };
		return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
	};
}
```

Este archivo no tiene test unitario propio: son lecturas directas, y el contador está probado en pgTAP. Se ejercita en la verificación de la Task 12.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/mcp-server/access.ts lib/brain/mcp-server/supabase.ts tests/brain/mcp-server/access.test.ts
git commit -m "feat: acceso al brain por MCP según token, URL y membresía"
```

---

### Task 11: Servidor MCP, rutas y metadata

**Files:**
- Create: `lib/brain/mcp-server/server.ts`, `lib/brain/mcp-server/handler.ts`, `lib/brain/mcp-server/production.ts`, `app/brain/[tenant]/mcp/route.ts`, `app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts`
- Test: `tests/brain/mcp-server/tools.test.ts`, `tests/brain/mcp-server/handler.test.ts`

**Interfaces:**
- Consumes: `brainContract`, `BRAIN_TOOL_NAMES` (Task 1); `toToolError`, `BrainError`, `BrainValidation` (errors); `RateLimiter`, `createRateLimiter`, `HitFn` (Task 9); `resolveMcpAccess`, `ClaimsVerifier`, `AccessStore` (Task 10); `getBrainProvider` (Task 5); `createUnauthorizedResponse` de `eve/channels/auth`.
- Produces:
  - `MCP_MAX_REQUEST_BYTES = 1_048_576`, `MCP_MAX_UPSERT_BODY_BYTES = 102_400`.
  - `buildBrainMcpServer(ctx: { userId: string; access: "read" | "read_write"; categories: string[]; provider: BrainProvider; limiter: RateLimiter }): McpServer`.
  - `interface BrainMcpDeps { verify: ClaimsVerifier; store: AccessStore; hit: HitFn; provider: (binding: BrainBinding) => BrainProvider; publicUrl: string; issuer: string }`.
  - `handleBrainMcp(request: Request, slug: string, deps: BrainMcpDeps): Promise<Response>`.
  - `protectedResourceMetadata(slug: string, deps: Pick<BrainMcpDeps, "publicUrl" | "issuer">): { resource: string; authorization_servers: string[]; bearer_methods_supported: string[] }`.
  - `productionDeps(): BrainMcpDeps`.

- [ ] **Step 1: Tests que fallan**

```ts
// tests/brain/mcp-server/handler.test.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, vi } from "vitest";
import { BrainConflict } from "@/lib/brain/errors";
import type { AccessStore } from "@/lib/brain/mcp-server/access";
import {
	type BrainMcpDeps,
	handleBrainMcp,
	protectedResourceMetadata,
} from "@/lib/brain/mcp-server/handler";
import type { BrainBinding } from "@/lib/brain/resolve";
import type { BrainProvider } from "@/lib/brain/types";

const binding: BrainBinding = {
	id: "b1",
	tenantId: "tenant-a",
	provider: "wiki",
	config: {
		categories: ["comercial"],
		requiredFrontmatter: [],
		search: "fts",
		mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
	},
};

const page = {
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo" as const,
	tags: ["canon:icp"],
	frontmatter: {},
	body: "…",
	revision: 3,
	updatedAt: "2026-09-24T00:00:00Z",
};

function fakeProvider(): BrainProvider {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(async () => page),
		upsert: vi.fn(async () => ({ slug: "comercial/icp", revision: 4 })),
	};
}

const store: AccessStore = {
	tenantBySlug: async (slug) => (slug === "a" ? { id: "tenant-a", active: true } : { id: "tenant-b", active: true }),
	rolesOf: async (userId) =>
		userId === "admin" ? [{ tenantId: "tenant-a", role: "tenant_admin" }] : [{ tenantId: "tenant-a", role: "tenant_member" }],
	brainBinding: async () => binding,
};

function deps(overrides: Partial<BrainMcpDeps> = {}): BrainMcpDeps & { providerInstance: BrainProvider } {
	const providerInstance = fakeProvider();
	return {
		verify: async (token) => ({ sub: token, client_id: "claude" }),
		store,
		hit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
		provider: () => providerInstance,
		publicUrl: "https://agents.test",
		issuer: "https://ref.supabase.co/auth/v1",
		providerInstance,
		...overrides,
	};
}

async function connect(token: string, d: BrainMcpDeps, slug = "a") {
	const client = new Client({ name: "test", version: "1.0.0" });
	const transport = new StreamableHTTPClientTransport(new URL(`https://agents.test/brain/${slug}/mcp`), {
		requestInit: { headers: { authorization: `Bearer ${token}` } },
		fetch: (url, init) => handleBrainMcp(new Request(url, init), slug, d),
	});
	await client.connect(transport);
	return client;
}

describe("handleBrainMcp", () => {
	it("un miembro ve dos tools; un admin, tres", async () => {
		const member = await connect("ana", deps());
		expect((await member.listTools()).tools.map((tool) => tool.name).sort()).toEqual(["brain_read", "brain_search"]);
		const admin = await connect("admin", deps());
		expect((await admin.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
		]);
	});

	it("busca y lee con el resultado del contrato", async () => {
		const client = await connect("ana", deps());
		const read = await client.callTool({ name: "brain_read", arguments: { slug: "comercial/icp" } });
		expect(read.structuredContent).toEqual({ ok: true, page });
		const search = await client.callTool({ name: "brain_search", arguments: { query: "icp" } });
		expect(search.structuredContent).toEqual({ ok: true, results: [] });
	});

	it("un tenantId en los argumentos no llega al proveedor", async () => {
		const d = deps();
		const client = await connect("ana", d);
		await client.callTool({ name: "brain_search", arguments: { query: "icp", tenantId: "tenant-b" } });
		expect(d.providerInstance.search).toHaveBeenCalledWith({ query: "icp" });
	});

	it("un admin escribe como usuario, sin aprobación", async () => {
		const d = deps();
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: { slug: "comercial/icp", title: "ICP", category: "comercial", status: "activo", tags: [], body: "x", reason: "ajuste", baseRevision: 3 },
		});
		expect(result.structuredContent).toEqual({ ok: true, slug: "comercial/icp", revision: 4 });
		expect(d.providerInstance.upsert).toHaveBeenCalledWith(expect.objectContaining({ slug: "comercial/icp" }), {
			kind: "user",
			userId: "admin",
		});
	});

	it("un conflicto sale como error tipado, con isError", async () => {
		const d = deps();
		vi.mocked(d.providerInstance.upsert).mockRejectedValueOnce(new BrainConflict("comercial/icp", 5));
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: { slug: "comercial/icp", title: "ICP", category: "comercial", status: "activo", tags: [], body: "x", reason: "r", baseRevision: 3 },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ ok: false, error: "conflict", currentRevision: 5 });
	});

	it("un cuerpo de más de 100 KB se rechaza sin llegar al proveedor", async () => {
		const d = deps();
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: { slug: "comercial/icp", title: "ICP", category: "comercial", status: "activo", tags: [], body: "x".repeat(102_401), reason: "r" },
		});
		expect(result.structuredContent).toMatchObject({ ok: false, error: "validation", fields: ["body"] });
		expect(d.providerInstance.upsert).not.toHaveBeenCalled();
	});

	it("con el límite alcanzado devuelve cuánto esperar", async () => {
		const client = await connect("ana", deps({ hit: async () => ({ allowed: false, retryAfterSeconds: 9 }) }));
		const result = await client.callTool({ name: "brain_search", arguments: { query: "" } });
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ error: "rate_limited", retryable: true, retryAfterSeconds: 9 });
	});

	it("un error no tipado sale como internal con un id, sin detalle", async () => {
		const d = deps();
		vi.mocked(d.providerInstance.search).mockRejectedValueOnce(new Error("password=hunter2"));
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await connect("ana", d);
		const result = await client.callTool({ name: "brain_search", arguments: { query: "" } });
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).not.toContain("hunter2");
		expect(result.structuredContent).toMatchObject({ ok: false, error: "internal" });
		errorLog.mockRestore();
	});

	it("sin token responde 401 con la URL de la metadata", async () => {
		const response = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", { method: "POST", body: "{}" }),
			"a",
			deps(),
		);
		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toContain(
			'resource_metadata="https://agents.test/.well-known/oauth-protected-resource/brain/a/mcp"',
		);
	});

	it("sin membresía responde 403", async () => {
		const response = await handleBrainMcp(
			new Request("https://agents.test/brain/b/mcp", {
				method: "POST",
				headers: { authorization: "Bearer ana", "content-type": "application/json" },
				body: "{}",
			}),
			"b",
			deps(),
		);
		expect(response.status).toBe(403);
	});

	it("un cuerpo de más de 1 MiB responde 413, con o sin content-length", async () => {
		const big = "x".repeat(1_048_577);
		const withLength = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				headers: { authorization: "Bearer ana", "content-length": String(big.length) },
				body: big,
			}),
			"a",
			deps(),
		);
		expect(withLength.status).toBe(413);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(big));
				controller.close();
			},
		});
		const withoutLength = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				headers: { authorization: "Bearer ana" },
				body: stream,
				// @ts-expect-error: duplex es obligatorio en Node para cuerpos stream
				duplex: "half",
			}),
			"a",
			deps(),
		);
		expect(withoutLength.status).toBe(413);
	});
});

describe("protectedResourceMetadata", () => {
	it("usa la URL pública configurada y el emisor", () => {
		expect(protectedResourceMetadata("a", { publicUrl: "https://agents.test", issuer: "https://ref.supabase.co/auth/v1" })).toEqual({
			resource: "https://agents.test/brain/a/mcp",
			authorization_servers: ["https://ref.supabase.co/auth/v1"],
			bearer_methods_supported: ["header"],
		});
	});
});
```

Run: `npx vitest run tests/brain/mcp-server/handler.test.ts` → FAIL.

- [ ] **Step 2: `server.ts`**

```ts
// lib/brain/mcp-server/server.ts
// Servidor MCP del brain para una persona autenticada (spec etapa 11 §5.3).
// Escribe una persona, no el agente: brain_upsert sin aprobación (D5).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BRAIN_TOOL_NAMES, brainContract } from "../contract.ts";
import { BrainError, BrainValidation, toToolError } from "../errors.ts";
import type { BrainProvider } from "../types.ts";
import type { RateLimiter } from "./rate-limit.ts";

export const MCP_MAX_REQUEST_BYTES = 1_048_576;
export const MCP_MAX_UPSERT_BODY_BYTES = 102_400;

function result(value: Record<string, unknown>, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		structuredContent: value,
		...(isError ? { isError: true } : {}),
	};
}

export function buildBrainMcpServer(ctx: {
	userId: string;
	access: "read" | "read_write";
	categories: string[];
	provider: BrainProvider;
	limiter: RateLimiter;
}): McpServer {
	const server = new McpServer({ name: "innovas-brain", version: "1.0.0" });
	const contract = brainContract(ctx.categories);

	async function run(kind: "read" | "write", work: () => Promise<Record<string, unknown>>) {
		try {
			await ctx.limiter.check(kind);
			return result(await work());
		} catch (error) {
			if (error instanceof BrainError) return result({ ...toToolError(error) }, true);
			const errorId = crypto.randomUUID();
			console.error(`brain mcp: error interno ${errorId}`, error);
			return result({ ok: false, error: "internal", message: `Error interno (${errorId}).`, errorId }, true);
		}
	}

	server.registerTool(
		BRAIN_TOOL_NAMES.search,
		{ description: contract.search.description, inputSchema: contract.search.input },
		async (input) => run("read", async () => ({ ok: true, results: await ctx.provider.search(input) })),
	);

	server.registerTool(
		BRAIN_TOOL_NAMES.read,
		{ description: contract.read.description, inputSchema: contract.read.input },
		async ({ slug }) => run("read", async () => ({ ok: true, page: await ctx.provider.read(slug) })),
	);

	if (ctx.access === "read_write") {
		server.registerTool(
			BRAIN_TOOL_NAMES.upsert,
			{ description: contract.upsert.description, inputSchema: contract.upsert.input },
			async (input) =>
				run("write", async () => {
					if (new TextEncoder().encode(input.body).length > MCP_MAX_UPSERT_BODY_BYTES) {
						throw new BrainValidation(["body"]);
					}
					const written = await ctx.provider.upsert(input, { kind: "user", userId: ctx.userId });
					return { ok: true, ...written };
				}),
		);
	}

	return server;
}
```

Si `registerTool` no acepta un `z.object` como `inputSchema` en la versión instalada (su tipo acepta `AnySchema`, que incluye zod 4), pasar `contract.search.input.shape`. El test "un tenantId en los argumentos no llega al proveedor" es el que confirma que el SDK valida con el esquema y descarta claves de más: si falla, parsear explícitamente con `contract.search.input.parse(input)` dentro del handler.

- [ ] **Step 3: `handler.ts`**

```ts
// lib/brain/mcp-server/handler.ts
// Request al endpoint del brain (spec etapa 11 §5.1, §5.2). Stateless: un
// servidor y un transporte por request, con respuesta JSON.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createUnauthorizedResponse } from "eve/channels/auth";
import type { BrainBinding } from "../resolve.ts";
import type { BrainProvider } from "../types.ts";
import { type AccessStore, type ClaimsVerifier, resolveMcpAccess } from "./access.ts";
import { createRateLimiter, type HitFn } from "./rate-limit.ts";
import { buildBrainMcpServer, MCP_MAX_REQUEST_BYTES } from "./server.ts";

export interface BrainMcpDeps {
	verify: ClaimsVerifier;
	store: AccessStore;
	hit: HitFn;
	provider: (binding: BrainBinding) => BrainProvider;
	publicUrl: string;
	issuer: string;
}

function resourceUrl(publicUrl: string, slug: string): string {
	return `${publicUrl}/brain/${slug}/mcp`;
}

function metadataUrl(publicUrl: string, slug: string): string {
	return `${publicUrl}/.well-known/oauth-protected-resource/brain/${slug}/mcp`;
}

export function protectedResourceMetadata(slug: string, deps: Pick<BrainMcpDeps, "publicUrl" | "issuer">) {
	return {
		resource: resourceUrl(deps.publicUrl, slug),
		authorization_servers: [deps.issuer],
		bearer_methods_supported: ["header"],
	};
}

function tooLarge(): Response {
	return Response.json({ ok: false, code: "payload_too_large", error: "El pedido supera 1 MiB." }, { status: 413 });
}

async function readLimited(request: Request): Promise<string | null> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MCP_MAX_REQUEST_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function handleBrainMcp(request: Request, slug: string, deps: BrainMcpDeps): Promise<Response> {
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MCP_MAX_REQUEST_BYTES) return tooLarge();

	const access = await resolveMcpAccess(
		{ authorization: request.headers.get("authorization"), slug },
		{ verify: deps.verify, store: deps.store },
	);
	if (!access.ok) {
		if (access.status === 401) {
			return createUnauthorizedResponse({
				code: access.code,
				message: access.message,
				challenges: [
					{
						scheme: "Bearer",
						parameters: {
							resource_metadata: metadataUrl(deps.publicUrl, slug),
							...(access.code === "invalid_token" ? { error: "invalid_token" } : {}),
						},
					},
				],
			});
		}
		return Response.json({ ok: false, code: access.code, error: access.message }, { status: access.status });
	}

	const text = await readLimited(request);
	if (text === null) return tooLarge();
	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(text);
	} catch {
		return Response.json({ ok: false, code: "invalid_json", error: "El cuerpo no es JSON." }, { status: 400 });
	}

	const server = buildBrainMcpServer({
		userId: access.userId,
		access: access.access,
		categories: access.binding.config.categories,
		provider: deps.provider(access.binding),
		limiter: createRateLimiter({
			tenantId: access.tenantId,
			userId: access.userId,
			limits: access.binding.config.mcpLimits,
			hit: deps.hit,
		}),
	});
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request, { parsedBody });
	} finally {
		await server.close();
	}
}
```

Orden deliberado: el tope por `content-length` va antes de la auth (no se lee nada), y la lectura con tope va después (no se lee el cuerpo de alguien sin acceso). En el test de 413 sin `content-length`, el token `ana` tiene acceso a `a`, así que llega a la lectura.

Si `handleRequest` con `parsedBody` sigue intentando leer `request.body` ya consumido, pasarle una `new Request(request.url, { method: "POST", headers: request.headers, body: text })` en lugar del original.

- [ ] **Step 4: `production.ts` y rutas**

```ts
// lib/brain/mcp-server/production.ts
import { getBrainProvider } from "../provider.ts";
import type { BrainMcpDeps } from "./handler.ts";
import { supabaseAccessStore, supabaseClaimsVerifier, supabaseHit } from "./supabase.ts";

export function publicSettings(): Pick<BrainMcpDeps, "publicUrl" | "issuer"> {
	const publicUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
	if (!publicUrl || !supabaseUrl) {
		throw new Error("faltan PUBLIC_APP_URL o NEXT_PUBLIC_SUPABASE_URL para el brain por MCP");
	}
	return { publicUrl, issuer: `${supabaseUrl}/auth/v1` };
}

export function productionDeps(): BrainMcpDeps {
	return {
		...publicSettings(),
		verify: supabaseClaimsVerifier(),
		store: supabaseAccessStore(),
		hit: supabaseHit(),
		provider: getBrainProvider,
	};
}
```

```ts
// app/brain/[tenant]/mcp/route.ts
import { handleBrainMcp } from "@/lib/brain/mcp-server/handler";
import { productionDeps } from "@/lib/brain/mcp-server/production";

export async function POST(request: Request, { params }: RouteContext<"/brain/[tenant]/mcp">) {
	const { tenant } = await params;
	return handleBrainMcp(request, tenant, productionDeps());
}

function methodNotAllowed(): Response {
	return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
```

```ts
// app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts
import { protectedResourceMetadata } from "@/lib/brain/mcp-server/handler";
import { publicSettings } from "@/lib/brain/mcp-server/production";

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, HEAD, OPTIONS",
	"access-control-allow-headers": "*",
};

export async function GET(_request: Request, { params }: RouteContext<"/.well-known/oauth-protected-resource/brain/[tenant]/mcp">) {
	const { tenant } = await params;
	return Response.json(protectedResourceMetadata(tenant, publicSettings()), {
		headers: { ...CORS, "cache-control": "public, max-age=300" },
	});
}

export function OPTIONS(): Response {
	return new Response(null, { status: 204, headers: CORS });
}
```

La metadata no consulta la base: devuelve la misma forma para cualquier slug, así no sirve para enumerar tenants. `RouteContext` lo genera `next typegen` (lo corre `npm run typecheck`). Si Next no acepta una carpeta `.well-known` bajo `app/`, moverla a `app/(discovery)/.well-known/...` y confirmar la URL con el dev server.

- [ ] **Step 5: `.env.local` y ejemplo**

Sumar `PUBLIC_APP_URL=http://localhost:3000` a `.env.local` (no se commitea) y, si existe `.env.example`, la misma clave con un valor de ejemplo.

- [ ] **Step 6: Correr**

Run: `npx vitest run tests/brain && npm run typecheck`
Expected: PASS.

Con el dev server: `curl -s localhost:3000/.well-known/oauth-protected-resource/brain/innovas/mcp` devuelve la metadata; `curl -si -X POST localhost:3000/brain/innovas/mcp -d '{}'` devuelve 401 con `www-authenticate` y `resource_metadata`; `curl -si localhost:3000/brain/innovas/mcp` devuelve 405.

- [ ] **Step 7: Commit**

```bash
git add lib/brain/mcp-server app/brain app/.well-known tests/brain/mcp-server
git commit -m "feat: endpoint MCP del brain por tenant, con metadata de recurso protegido"
```

---

## E5 · Doc y cierre

### Task 12: Doc de conexión, verificación contra producción y roadmap

**Files:**
- Create: `docs/brain-mcp-conexion.md`
- Modify: `docs/01-roadmap-etapas.md`, `docs/innovas-agents-kickoff.md`, `docs/superpowers/specs/2026-09-13-brain-design.md`

- [ ] **Step 1: Doc de conexión**

```markdown
# Conectar el brain desde tus herramientas

Cada cliente tiene su brain en una URL propia:

    https://<dominio>/brain/<cliente>/mcp

Entrás con tu cuenta de la plataforma. Si sos administrador del cliente podés leer y escribir; si no, solo leer.

## Claude Code

    claude mcp add --transport http brain-<cliente> https://<dominio>/brain/<cliente>/mcp

Después, dentro de Claude Code, `/mcp`, elegí `brain-<cliente>` y autenticá. Se abre el navegador, entrás con tu cuenta y aprobás el acceso.

## claude.ai

Configuración → Conectores → Agregar conector personalizado. Pegá la URL del brain. Al conectar, se abre la misma pantalla de login y aprobación.

## Qué podés hacer

- `brain_search`: buscar por texto, categoría o tag.
- `brain_read`: leer una página completa con su revisión.
- `brain_upsert` (solo administradores): crear o actualizar una página. Para actualizar, primero leela y pasá su revisión; si alguien la cambió en el medio, vas a recibir un conflicto y tenés que volver a leerla.

Hay un límite de 60 lecturas y 10 escrituras por minuto por persona. Si lo pasás, la respuesta dice cuántos segundos esperar.

## Si algo falla

- **403**: tu cuenta no tiene acceso a ese cliente. Pedile a un administrador que te invite.
- **404**: el cliente no existe o no tiene brain configurado.
- **No se abre el login**: revisá que la URL termine en `/mcp` y que estés usando la de tu cliente.
```

Reemplazar `<dominio>` por el dominio real de producción (`vercel project ls` o el dominio del deploy) antes de commitear.

- [ ] **Step 2: Variables y migraciones en producción (con confirmación)**

1. `PUBLIC_APP_URL` en Vercel, entorno Production, con el dominio real. Pedirle a Mati que la cargue o, con su OK, `vercel env add PUBLIC_APP_URL production`.
2. Antes de aplicar migraciones: `npx supabase migration list`. Hay una migración ajena pendiente, `20260922100000_upsert_discovered_account.sql`, de la Etapa 13 (Apollo en pausa). `db push` aplica **todas** las pendientes. Mostrarle la lista a Mati y **pedir confirmación explícita** de si se aplica esa también o se espera. No correr `db push` sin esa respuesta.
3. Después del push: `select agent, config from tenant_agents where agent = 'outreach';` confirma `"brain": "read_write"` en `innovas`.

- [ ] **Step 3: Deploy y verificación manual (V3 a V6)**

Con la rama deployada en preview o producción, una persona con login real:

| # | Qué | Resultado esperado |
|---|---|---|
| V5 | `claude mcp add --transport http brain-innovas https://<dominio>/brain/innovas/mcp`, `/mcp`, autenticar | Se abre `/oauth/consent`, se aprueba, Claude Code lista `brain_search`, `brain_read` y, si la cuenta es admin, `brain_upsert` |
| V3 | Si la conexión da 401 después de aprobar | Buscar en los logs de Vercel `brain mcp: token sin client_id; claims presentes:` y decidir D7 con esos nombres. **Frenar**, no parchar |
| V4 | Tiempo de respuesta de `brain_search` | Si pasa de 1 s de forma sostenida, el proyecto firma con HS256 y `getClaims` va al servidor: anotarlo como deuda |
| — | `brain_search` con tag `canon:icp` | Devuelve el canon de `innovas` |
| — | La misma cuenta contra `/brain/<otro-slug>/mcp` | 403 |
| — | Una cuenta `tenant_member` | No ve `brain_upsert` |
| — | Un admin escribe una página de prueba | `brain_revisions` tiene la fila con `author_kind = 'user'` y su `user_id`; archivar la página después (status `archivado`, nunca borrar) |
| V6 | claude.ai, conector personalizado con la misma URL | Conecta y lista las tools. Si no completa el registro, anotarlo en la doc y no bloquea |
| — | Chat del agente en `innovas` | `brain_search` sigue funcionando igual que antes |

- [ ] **Step 4: Enmiendas de docs**

- `docs/01-roadmap-etapas.md`, Etapa 11: Spec/Plan con los paths de esta spec y este plan; marcar cada ítem de A, B y C según lo verificado; las "decisiones a confirmar" resueltas por D4, D5 y D9; el "brain aislado" a fuera de alcance. Etapa 6: el primer ítem (Supabase como emisor OAuth 2.1) queda hecho acá, con referencia a esta etapa; siguen pendientes `channels/mcp.ts` y su doc. Etapa 13: E3 y E4 mergeadas en el PR #47.
- `docs/innovas-agents-kickoff.md`, tabla "Estado de avance": fila 11 con el PR de esta etapa; fila 6 "emisor hecho en la 11, falta el canal del agente"; fila 13 con el PR #47.
- `docs/superpowers/specs/2026-09-13-brain-design.md` §4.4: el título pasa a "Proveedor `mcp`" y una línea al principio: "Construido en la Etapa 11: `docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md` §7."

- [ ] **Step 5: Verificación final**

Run: `npm test && npm run typecheck && npm run db:test`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add docs/brain-mcp-conexion.md docs/01-roadmap-etapas.md docs/innovas-agents-kickoff.md docs/superpowers/specs/2026-09-13-brain-design.md
git commit -m "docs: conexión al brain por MCP y cierre de la Etapa 11"
```

- [ ] **Step 7:** `/ship` para el PR y `/context-save` al cerrar la sesión.
