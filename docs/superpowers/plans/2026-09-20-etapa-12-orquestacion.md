# Etapa 12 · Modelo de orquestación — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar en producción los rieles para correr workflows desatendidos por tenant (medición de consumo, cola de trabajo con lease, presupuestos, registry con tests que obligan), probados con un primer workflow que refresca fichas vencidas.

**Architecture:** Los nodos son servicios puros en `lib/`; un workflow es una composición determinística que reclama filas de `work_items` y deja filas para el siguiente. Un único schedule de eve despacha cada 5 minutos. Todo consumo se asienta en `usage_entries`, y un presupuesto diario por tenant corta lo desatendido.

**Tech Stack:** Next.js 16 · eve 0.54.2 (pinneado, no se sube) · `ai` 7 por Vercel AI Gateway · Supabase Postgres con RLS · vitest · pgTAP · Biome.

**Spec:** `docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md`. Leerla entera antes de empezar: este plan argumenta desde ella.

## Alcance de este documento

La spec parte la etapa en cuatro entregas (§2.1). Este plan detalla **E1 (medición) y E2 (rieles)** tarea por tarea, con código. **E3 y E4 quedan con alcance e interfaces fijados** (al final), y se detallan al cerrar E2. Es el mismo criterio que usó el plan de la Etapa 3, y acá tiene dos motivos concretos: E3 depende de un dato que sale de producción (spike S2: cuánto trabajo útil aguanta un tick) y de las interfaces de E2 tal como queden construidas; y E4 es documentación que la propia spec (D14) manda escribir contra código que ya existe.

## Global Constraints

- **eve queda en `0.54.2`.** No se sube en esta etapa (spec D16).
- **En `agents/` los imports son relativos**, nunca `@/`: eve no resuelve los paths de tsconfig en los módulos que compila. En `lib/`, relativos también cuando el archivo lo importa algo de `agents/` (toda la carpeta `lib/workflows/` y `lib/outreach/` lo cumplen). En `tests/` se usa `@/`.
- **Toda tabla nueva lleva `tenant_id` y RLS.** Lectura para `(select public.is_member_of(tenant_id)) or (select public.is_platform_admin())`; `insert/update/delete` revocados a `authenticated` y `anon`. Escribe solo el cliente admin.
- **Antes de tocar SQL, cargar la skill `supabase-postgres-best-practices`.** Ya aplicado en este plan: PK `bigint generated always as identity` en tablas append-only y de cola, índice parcial para el reclamo, índice en cada FK, funciones con `security definer set search_path = ''`, helpers de RLS envueltos en `(select ...)`.
- **`events` y `usage_entries` son append-only.** Nunca `UPDATE` ni `DELETE`.
- **Nada específico de un tenant en código.** Va a `tenants/<slug>/` o a la base.
- **Español rioplatense** en comentarios, mensajes y docs. Código e identificadores en inglés.
- **Rechazo es resultado, no excepción:** `{ ok: false, reason, message }` de `lib/outreach/result.ts`.
- **Commits** con prefijo `feat:` / `fix:` / `docs:` / `refactor:` / `test:`, en castellano. Identidad git: `innovasbuild` / `matias@innov.as`.
- **`npm run lint:fix` reformatea siempre 4 archivos ajenos.** Revertirlos con `git checkout -- <archivo>` antes de commitear.
- **Después de cada tarea:** `npm run typecheck` y `npm test` en verde. Las tareas con SQL suman `npm run db:test` (necesita Docker abierto y `npm run db:start`).
- **Máximo de intentos de un ítem: 3.** La constante vive en dos lugares, SQL (`claim_work_items`) y TypeScript (`MAX_ATTEMPTS`). Si cambia uno, cambia el otro.

## Mapa de archivos

| Archivo | Responsabilidad | Entrega |
|---|---|---|
| `scripts/spike-gateway-cost.mts` | Spike S1: qué devuelve el Gateway en `providerMetadata` | E1 |
| `supabase/migrations/20260921090000_usage_entries.sql` | Libro de consumo + `set_run_cost` | E1 |
| `supabase/tests/12_usage_entries.test.sql` | RLS y visibilidad del costo | E1 |
| `lib/workflows/pricing.ts` | Costo en USD de una llamada al modelo | E1 |
| `lib/workflows/usage.ts` | `createUsageRecorder`, `resolveRunId`, `metered` | E1 |
| `lib/outreach/services/generate-draft.ts` | `generateDraft`, mudado desde la tool | E1 |
| `tests/workflows/model-calls.test.ts` | Todo el que importa `generateText` usa `metered` | E1 |
| `supabase/migrations/20260921100000_work_items.sql` | Cola + `claim_work_items` | E2 |
| `supabase/migrations/20260921110000_tenant_workflows_budgets.sql` | Config por tenant, presupuestos, columnas de `runs`, `usage_sum` | E2 |
| `lib/workflows/types.ts` | Tipos compartidos | E2 |
| `lib/workflows/registry.ts` | `NODES`, `WORKFLOWS`, `SERVICES_EXCLUIDOS` | E2 |
| `lib/workflows/config.ts` | `parseTenantWorkflowConfig` | E2 |
| `lib/workflows/enqueue.ts` | Única forma de crear una arista | E2 |
| `lib/workflows/budget.ts` | Presupuesto diario por recurso | E2 |
| `lib/workflows/runner.ts` | Una pasada de un workflow para un tenant | E2 |
| `lib/workflows/store.ts` | `WorkflowStore` sobre Supabase | E2 |

---

# Entrega 1 · Medición

### Task 1: Spike S1 — qué informa el Gateway

**Files:**
- Create: `scripts/spike-gateway-cost.mts`
- Modify: `docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md` (§13, fila S1)

**Interfaces:**
- Produces: un dato, no código de producción. Decide si el costo del Gateway es la fuente primaria o si manda la tabla de precios. El código de la Task 3 soporta los dos casos, así que ningún resultado bloquea.

- [ ] **Step 1: Escribir el script**

```ts
// scripts/spike-gateway-cost.mts
// Spike S1 (spec orquestación §13): ¿el AI Gateway informa el costo de cada
// llamada en providerMetadata? Se corre a mano, una vez. No es código de
// producción: se borra al cerrar la E1.
import { generateText } from "ai";

const result = await generateText({
	model: "anthropic/claude-haiku-4.5",
	prompt: "Respondé solo: ok",
	maxOutputTokens: 16,
});

const gateway = (result.providerMetadata as Record<string, unknown> | undefined)
	?.gateway as Record<string, unknown> | undefined;

console.log("usage:", JSON.stringify(result.usage));
console.log("providerMetadata keys:", Object.keys(result.providerMetadata ?? {}));
console.log("gateway keys:", Object.keys(gateway ?? {}));
console.log("gateway.cost:", gateway?.cost, typeof gateway?.cost);
```

- [ ] **Step 2: Correrlo**

Run: `node --env-file=.env.local scripts/spike-gateway-cost.mts`

Esperado: cuatro líneas. La que importa es `gateway.cost`: un número, un string numérico, o `undefined`. Si tira `Free tier users do not have access to this model`, faltan créditos del Gateway (spec 03 §13.1 S3): cargarlos y repetir. Si local no tiene credenciales del Gateway, correrlo con `vercel env run -- node scripts/spike-gateway-cost.mts` o diferir la medición real a la Task 7, que verifica contra el deploy.

- [ ] **Step 3: Anotar el resultado en la spec**

En §13 de la spec, reemplazar la celda "Si da que no" de S1 por el resultado, con este formato (completar con lo observado, sin secretos):

```md
| S1 | ... | `usage_entries` | **Resultado (2026-09-DD):** `gateway.cost` = <valor y tipo observados>. <"El Gateway es la fuente primaria; la tabla de precios queda de respaldo." | "El Gateway no informa costo; manda la tabla de precios de `lib/workflows/pricing.ts`."> |
```

- [ ] **Step 4: Commit**

```bash
git add scripts/spike-gateway-cost.mts docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md
git commit -m "docs: resultado del spike S1, costo por llamada del AI Gateway"
```

---

### Task 2: Tabla `usage_entries` y `set_run_cost`

**Files:**
- Create: `supabase/migrations/20260921090000_usage_entries.sql`
- Test: `supabase/tests/12_usage_entries.test.sql`

**Interfaces:**
- Produces: tabla `public.usage_entries (id, tenant_id, run_id, workflow, node, resource, amount, unit, meta, created_at)`; función `public.set_run_cost(p_run uuid) returns numeric`, ejecutable solo por `service_role`, que escribe en `runs.cost_usd` la suma de `model_usd` de esa corrida y la devuelve.

- [ ] **Step 1: Escribir el test que falla**

```sql
-- supabase/tests/12_usage_entries.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'beto@fabrica.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'tenant_member');

insert into public.runs (id, tenant_id, agent, trigger, eve_session_id, status)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
        'outreach', 'chat', 'wrun_ana', 'ok');

insert into public.usage_entries (tenant_id, run_id, node, resource, amount, unit)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'outreach/draft', 'model_usd', 0.0300, 'usd'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'outreach/draft', 'model_usd', 0.0125, 'usd'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'outreach/leads', 'apollo_credits', 3, 'credits'),
  ('aaaaaaaa-0000-0000-0000-000000000003', null, 'outreach/leads', 'apollo_credits', 9, 'credits');

-- Como postgres (equivale a service_role para esto): la suma y la escritura.
select is(
  (select public.set_run_cost('dddddddd-0000-0000-0000-000000000001')),
  0.0425::numeric,
  'set_run_cost suma solo model_usd de esa corrida'
);

select is(
  (select cost_usd from public.runs where id = 'dddddddd-0000-0000-0000-000000000001'),
  0.0425::numeric,
  'set_run_cost deja el total escrito en runs.cost_usd'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.usage_entries),
  1,
  'un tenant_admin ve solo los asientos de su tenant que no son costo interno'
);

select is(
  (select count(*)::int from public.usage_entries where resource = 'model_usd'),
  0,
  'model_usd es costo interno: invisible para quien no es platform_admin'
);

select throws_ok(
  $$insert into public.usage_entries (tenant_id, node, resource, amount, unit)
    values ('aaaaaaaa-0000-0000-0000-000000000002', 'x', 'model_usd', 1, 'usd')$$,
  '42501',
  null,
  'authenticated no asienta consumo'
);

select throws_ok(
  $$update public.usage_entries set amount = 0$$,
  '42501',
  null,
  'usage_entries no acepta update'
);

select throws_ok(
  $$select public.set_run_cost('dddddddd-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'set_run_cost no es ejecutable por authenticated'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `npm run db:test`
Esperado: FALLA en `12_usage_entries.test.sql` con `relation "public.usage_entries" does not exist`.

- [ ] **Step 3: Escribir la migración**

```sql
-- supabase/migrations/20260921090000_usage_entries.sql
-- Libro de consumo (spec orquestación §7.2). Append-only, igual que events:
-- todo nodo que gasta un recurso medido deja su asiento acá. Es la base de
-- los presupuestos y, más adelante, de la facturación por tenant.
create table public.usage_entries (
  -- bigint identity y no uuid: tabla append-only de alto volumen relativo;
  -- un uuid v4 fragmenta el índice y nadie referencia estas filas desde afuera.
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  run_id uuid references public.runs (id) on delete set null,
  workflow text check (workflow is null or length(workflow) between 1 and 100),
  node text not null check (length(node) between 1 and 100),
  resource text not null check (resource ~ '^[a-z][a-z0-9_]{0,40}$'),
  amount numeric(14, 6) not null check (amount >= 0),
  unit text not null check (unit in ('usd', 'credits')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- La consulta caliente es "cuánto gastó este tenant de este recurso desde hoy".
create index usage_entries_tenant_resource_created_idx
  on public.usage_entries (tenant_id, resource, created_at desc);
-- FK sin índice = cascada y joins con seq scan.
create index usage_entries_run_id_idx on public.usage_entries (run_id);

alter table public.usage_entries enable row level security;

-- model_usd es costo interno de INNOV.AS: lo ve solo platform_admin, con el
-- mismo criterio que runs.cost_usd. El resto (créditos de terceros) lo ve el tenant.
create policy usage_entries_select on public.usage_entries
  for select to authenticated
  using (
    (select public.is_platform_admin())
    or ((select public.is_member_of(tenant_id)) and resource <> 'model_usd')
  );

revoke insert, update, delete on public.usage_entries from authenticated, anon;

-- Total de la corrida, escrito al cerrarla. Devuelve el total para no pedir
-- un segundo round-trip.
create or replace function public.set_run_cost(p_run uuid)
returns numeric language sql security definer set search_path = '' as $$
  update public.runs r
     set cost_usd = (
       select coalesce(sum(u.amount), 0)
         from public.usage_entries u
        where u.run_id = p_run and u.resource = 'model_usd'
     )
   where r.id = p_run
  returning r.cost_usd;
$$;

revoke execute on function public.set_run_cost(uuid) from public, anon, authenticated;
grant execute on function public.set_run_cost(uuid) to service_role;
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run db:test`
Esperado: todos los archivos en verde, incluido `12_usage_entries.test.sql` (7 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260921090000_usage_entries.sql supabase/tests/12_usage_entries.test.sql
git commit -m "feat: libro de consumo usage_entries y total por corrida"
```

---

### Task 3: Costo de una llamada y registro de consumo

**Files:**
- Create: `lib/workflows/pricing.ts`
- Create: `lib/workflows/usage.ts`
- Test: `tests/workflows/pricing.test.ts`
- Test: `tests/workflows/usage.test.ts`

**Interfaces:**
- Produces:
  - `modelCostUsd(args: { model: string; usage: unknown; providerMetadata: unknown }): ModelCost`
  - `type ModelCost = { usd: number; source: "gateway" | "tabla" | "sin_precio"; inputTokens: number; outputTokens: number }`
  - `MODEL_PRICES: Record<string, { input: number; output: number }>` (USD por millón de tokens)
  - `interface UsageEntry { tenantId: string; runId: string | null; workflow: string | null; node: string; resource: string; amount: number; unit: "usd" | "credits"; meta: Record<string, unknown> }`
  - `type RecordUsage = (entry: UsageEntry) => Promise<void>`
  - `createUsageRecorder(admin: AdminLike): RecordUsage` — nunca tira
  - `resolveRunId(admin: AdminLike, sessionId: string, turnId: string | null): Promise<string | null>`
  - `metered(fn, opts)` — envuelve una función `generate` y asienta su consumo

- [ ] **Step 1: Test de `pricing` que falla**

```ts
// tests/workflows/pricing.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_OUTREACH_MODELS } from "@/lib/outreach/config";
import { MODEL_PRICES, modelCostUsd } from "@/lib/workflows/pricing";

const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };

describe("modelCostUsd", () => {
	it("usa el costo que informa el Gateway cuando viene", () => {
		const cost = modelCostUsd({
			model: "anthropic/claude-opus-5",
			usage,
			providerMetadata: { gateway: { cost: 0.0421 } },
		});
		expect(cost).toEqual({
			usd: 0.0421,
			source: "gateway",
			inputTokens: 1_000_000,
			outputTokens: 100_000,
		});
	});

	it("acepta el costo del Gateway como string numérico", () => {
		const cost = modelCostUsd({
			model: "anthropic/claude-opus-5",
			usage,
			providerMetadata: { gateway: { cost: "0.5" } },
		});
		expect(cost.usd).toBe(0.5);
		expect(cost.source).toBe("gateway");
	});

	it("sin costo del Gateway calcula con la tabla de precios", () => {
		// Opus 5: 5 USD por millón de entrada, 25 por millón de salida.
		const cost = modelCostUsd({
			model: "anthropic/claude-opus-5",
			usage,
			providerMetadata: undefined,
		});
		expect(cost.usd).toBeCloseTo(5 + 2.5, 6);
		expect(cost.source).toBe("tabla");
	});

	it.each([-1, Number.NaN, "abc", null, {}])(
		"ignora un costo del Gateway inválido (%s) y cae en la tabla",
		(bad) => {
			const cost = modelCostUsd({
				model: "anthropic/claude-haiku-4.5",
				usage,
				providerMetadata: { gateway: { cost: bad } },
			});
			expect(cost.source).toBe("tabla");
		},
	);

	it("un modelo sin precio cuesta 0 y lo dice", () => {
		const cost = modelCostUsd({
			model: "otro/modelo-raro",
			usage,
			providerMetadata: undefined,
		});
		expect(cost).toMatchObject({ usd: 0, source: "sin_precio" });
	});

	it("un usage roto no rompe: cuenta cero tokens", () => {
		const cost = modelCostUsd({
			model: "anthropic/claude-haiku-4.5",
			usage: null,
			providerMetadata: undefined,
		});
		expect(cost).toMatchObject({ usd: 0, inputTokens: 0, outputTokens: 0 });
	});

	it("todo modelo default de outreach tiene precio", () => {
		// Spec §13 S1: si un modelo en uso no tiene precio, el consumo se asienta
		// en cero y el presupuesto deja de proteger. Esto tiene que fallar antes.
		const sinPrecio = Object.values(DEFAULT_OUTREACH_MODELS).filter(
			(model) => !Object.hasOwn(MODEL_PRICES, model),
		);
		expect(sinPrecio).toEqual([]);
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/workflows/pricing.test.ts`
Esperado: FALLA con `Cannot find module '@/lib/workflows/pricing'` o equivalente.

- [ ] **Step 3: Implementar `pricing.ts`**

```ts
// lib/workflows/pricing.ts
// Costo en USD de una llamada al modelo (spec orquestación §7.2 y §13 S1).
// Fuente primaria: lo que informe el AI Gateway en providerMetadata. Respaldo:
// esta tabla, en USD por millón de tokens (kickoff §3). La tabla no descuenta
// tokens cacheados: si se usa, sobreestima. Es el lado seguro para un tope.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
	"anthropic/claude-haiku-4.5": { input: 1, output: 5 },
	"anthropic/claude-sonnet-5": { input: 2, output: 10 },
	"anthropic/claude-opus-5": { input: 5, output: 25 },
	"anthropic/claude-fable-5.1": { input: 10, output: 50 },
};

export interface ModelCost {
	usd: number;
	source: "gateway" | "tabla" | "sin_precio";
	inputTokens: number;
	outputTokens: number;
}

function tokens(usage: unknown, key: "inputTokens" | "outputTokens"): number {
	if (typeof usage !== "object" || usage === null) return 0;
	const value = (usage as Record<string, unknown>)[key];
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: 0;
}

function gatewayCost(providerMetadata: unknown): number | null {
	if (typeof providerMetadata !== "object" || providerMetadata === null)
		return null;
	const gateway = (providerMetadata as Record<string, unknown>).gateway;
	if (typeof gateway !== "object" || gateway === null) return null;
	const raw = (gateway as Record<string, unknown>).cost;
	if (typeof raw !== "number" && typeof raw !== "string") return null;
	const cost = Number(raw);
	return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function modelCostUsd(args: {
	model: string;
	usage: unknown;
	providerMetadata: unknown;
}): ModelCost {
	const inputTokens = tokens(args.usage, "inputTokens");
	const outputTokens = tokens(args.usage, "outputTokens");
	const informed = gatewayCost(args.providerMetadata);
	if (informed !== null) {
		return { usd: informed, source: "gateway", inputTokens, outputTokens };
	}
	if (!Object.hasOwn(MODEL_PRICES, args.model)) {
		return { usd: 0, source: "sin_precio", inputTokens, outputTokens };
	}
	const price = MODEL_PRICES[args.model];
	return {
		usd:
			(inputTokens * price.input + outputTokens * price.output) / 1_000_000,
		source: "tabla",
		inputTokens,
		outputTokens,
	};
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/workflows/pricing.test.ts`
Esperado: PASA (11 tests).

- [ ] **Step 5: Test de `usage` que falla**

```ts
// tests/workflows/usage.test.ts
import { describe, expect, it, vi } from "vitest";
import {
	createUsageRecorder,
	metered,
	resolveRunId,
	type UsageEntry,
} from "@/lib/workflows/usage";

function fakeAdmin(result: { error: { message: string } | null }) {
	const insert = vi.fn(async () => result);
	return { admin: { from: vi.fn(() => ({ insert })) }, insert };
}

const entry: UsageEntry = {
	tenantId: "t1",
	runId: "r1",
	workflow: null,
	node: "outreach/draft",
	resource: "model_usd",
	amount: 0.03,
	unit: "usd",
	meta: { model: "anthropic/claude-opus-5" },
};

describe("createUsageRecorder", () => {
	it("inserta el asiento en usage_entries con los nombres de columna", async () => {
		const { admin, insert } = fakeAdmin({ error: null });
		await createUsageRecorder(admin as never)(entry);
		expect(admin.from).toHaveBeenCalledWith("usage_entries");
		expect(insert).toHaveBeenCalledWith({
			tenant_id: "t1",
			run_id: "r1",
			workflow: null,
			node: "outreach/draft",
			resource: "model_usd",
			amount: 0.03,
			unit: "usd",
			meta: { model: "anthropic/claude-opus-5" },
		});
	});

	it("un fallo al asentar no tira: medir no puede tumbar el trabajo real", async () => {
		const { admin } = fakeAdmin({ error: { message: "db caída" } });
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			createUsageRecorder(admin as never)(entry),
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe("resolveRunId", () => {
	function adminWithRun(data: { id: string } | null) {
		const maybeSingle = vi.fn(async () => ({ data, error: null }));
		const eq2 = vi.fn(() => ({ maybeSingle }));
		const eq1 = vi.fn(() => ({ eq: eq2 }));
		const select = vi.fn(() => ({ eq: eq1 }));
		return { from: vi.fn(() => ({ select })) };
	}

	it("busca la corrida por sesión y turno", async () => {
		const admin = adminWithRun({ id: "run-9" });
		expect(await resolveRunId(admin as never, "s1", "turn1")).toBe("run-9");
	});

	it("sin turno no hay corrida que buscar", async () => {
		const admin = adminWithRun({ id: "run-9" });
		expect(await resolveRunId(admin as never, "s1", null)).toBeNull();
		expect(admin.from).not.toHaveBeenCalled();
	});

	it("si no la encuentra devuelve null", async () => {
		expect(
			await resolveRunId(adminWithRun(null) as never, "s1", "turn1"),
		).toBeNull();
	});
});

describe("metered", () => {
	const base = {
		tenantId: "t1",
		runId: "r1",
		workflow: null,
		node: "outreach/draft",
	};

	it("devuelve el resultado intacto y asienta el costo de la llamada", async () => {
		const record = vi.fn(async () => {});
		const generate = async (_model: string, _system: string) => ({
			output: { subject: "s" },
			usage: { inputTokens: 1_000_000, outputTokens: 0 },
			providerMetadata: undefined,
		});
		const wrapped = metered(generate, {
			model: (model) => model,
			record,
			base,
		});

		const result = await wrapped("anthropic/claude-sonnet-5", "system");

		expect(result.output).toEqual({ subject: "s" });
		expect(record).toHaveBeenCalledWith({
			...base,
			resource: "model_usd",
			amount: 2,
			unit: "usd",
			meta: {
				model: "anthropic/claude-sonnet-5",
				source: "tabla",
				inputTokens: 1_000_000,
				outputTokens: 0,
			},
		});
	});

	it("si la llamada tira, no asienta y relanza", async () => {
		const record = vi.fn(async () => {});
		const generate = async (_model: string) => {
			throw new Error("gateway caído");
		};
		const wrapped = metered(generate, {
			model: (model) => model,
			record,
			base,
		});
		await expect(wrapped("m")).rejects.toThrow("gateway caído");
		expect(record).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 6: Correr y ver fallar**

Run: `npx vitest run tests/workflows/usage.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 7: Implementar `usage.ts`**

```ts
// lib/workflows/usage.ts
// Registro de consumo (spec orquestación §5.1 punto 9 y §7.2). Imports
// relativos: lo importan tools y schedules de eve, que no resuelven "@/".
import { modelCostUsd } from "./pricing";

export interface UsageEntry {
	tenantId: string;
	runId: string | null;
	workflow: string | null;
	node: string;
	resource: string;
	amount: number;
	unit: "usd" | "credits";
	meta: Record<string, unknown>;
}

export type RecordUsage = (entry: UsageEntry) => Promise<void>;

// Lo mínimo del cliente de Supabase que se usa acá, para poder probarlo sin él.
export interface AdminLike {
	// biome-ignore lint/suspicious/noExplicitAny: forma del query builder de supabase-js
	from(table: string): any;
}

/**
 * Nunca tira: la medición no puede tumbar un turno ni una pasada (mismo
 * principio que hooks/runs.ts). Un fallo queda en el log con ruido.
 */
export function createUsageRecorder(admin: AdminLike): RecordUsage {
	return async (entry) => {
		try {
			const { error } = await admin.from("usage_entries").insert({
				tenant_id: entry.tenantId,
				run_id: entry.runId,
				workflow: entry.workflow,
				node: entry.node,
				resource: entry.resource,
				amount: entry.amount,
				unit: entry.unit,
				meta: entry.meta,
			});
			if (error) console.error("usage_entries:", error.message);
		} catch (error) {
			console.error("usage_entries:", error);
		}
	};
}

/** La fila de `runs` de un turno del chat (la abre hooks/runs.ts en turn.started). */
export async function resolveRunId(
	admin: AdminLike,
	sessionId: string,
	turnId: string | null,
): Promise<string | null> {
	if (!turnId) return null;
	const { data } = await admin
		.from("runs")
		.select("id")
		.eq("eve_session_id", sessionId)
		.eq("eve_turn_id", turnId)
		.maybeSingle();
	return (data as { id: string } | null)?.id ?? null;
}

/**
 * Envuelve una función `generate` para que cada llamada al modelo deje su
 * asiento. Se aplica en la puerta (tool, schedule, runner), así los servicios
 * no conocen el libro de consumo. tests/workflows/model-calls.test.ts obliga
 * a que todo archivo que importa `generateText` lo use.
 */
export function metered<
	A extends unknown[],
	R extends { usage?: unknown; providerMetadata?: unknown },
>(
	fn: (...args: A) => Promise<R>,
	opts: {
		model: (...args: A) => string;
		record: RecordUsage;
		base: Pick<UsageEntry, "tenantId" | "runId" | "workflow" | "node">;
	},
): (...args: A) => Promise<R> {
	return async (...args) => {
		const result = await fn(...args);
		const model = opts.model(...args);
		const cost = modelCostUsd({
			model,
			usage: result.usage,
			providerMetadata: result.providerMetadata,
		});
		await opts.record({
			...opts.base,
			resource: "model_usd",
			amount: cost.usd,
			unit: "usd",
			meta: {
				model,
				source: cost.source,
				inputTokens: cost.inputTokens,
				outputTokens: cost.outputTokens,
			},
		});
		return result;
	};
}
```

- [ ] **Step 8: Correr y ver pasar**

Run: `npx vitest run tests/workflows/`
Esperado: PASA (pricing 11 + usage 7).

- [ ] **Step 9: Commit**

```bash
git add lib/workflows/pricing.ts lib/workflows/usage.ts tests/workflows/pricing.test.ts tests/workflows/usage.test.ts
git commit -m "feat: costo por llamada al modelo y registro de consumo"
```

---

### Task 4: Mudar `generateDraft` a `lib/` y medir la redacción

Es la primera mitad de §9.4 de la spec: una tool de eve no contiene llamadas al modelo. Hoy `schedules/followups.ts` importa `generateDraft` **desde una tool**, que es la señal de que hay un nodo escondido en una puerta.

**Files:**
- Create: `lib/outreach/services/generate-draft.ts`
- Modify: `agents/outreach/tools/draft_message.ts` (queda como puerta)
- Modify: `agents/outreach/schedules/followups.ts:49` y `:178`
- Move: `tests/agents/outreach/tools/draft_message.test.ts` → `tests/outreach/services/generate-draft.test.ts`

**Interfaces:**
- Consumes: `metered`, `createUsageRecorder`, `resolveRunId` de la Task 3.
- Produces: `generateDraft(model, system, prompt, deps): Promise<{ output: unknown; usage: unknown; providerMetadata: unknown }>` en `lib/outreach/services/generate-draft.ts`. Misma firma de entrada que hoy; el retorno suma `providerMetadata`.

- [ ] **Step 1: Mudar el test y apuntarlo al destino nuevo**

```bash
git mv tests/agents/outreach/tools/draft_message.test.ts tests/outreach/services/generate-draft.test.ts
```

En `tests/outreach/services/generate-draft.test.ts`, cambiar la línea 8:

```ts
import { generateDraft } from "@/lib/outreach/services/generate-draft";
```

Y agregar al final del `describe("generateDraft", ...)` este caso:

```ts
	it("pasa el providerMetadata de generateText, que es de donde sale el costo", async () => {
		const providerMetadata = { gateway: { cost: 0.01 } };
		const generateText = (async () => ({
			output: { subject: "s", body: "b" },
			usage: usageStub,
			providerMetadata,
		})) as never;

		const result = await generateDraft("m", "system", "prompt", {
			generateText,
		});

		expect(result.providerMetadata).toBe(providerMetadata);
	});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/outreach/services/generate-draft.test.ts`
Esperado: FALLA con `Cannot find module '@/lib/outreach/services/generate-draft'`.

- [ ] **Step 3: Crear el servicio**

Cortar de `agents/outreach/tools/draft_message.ts` la función `generateDraft` con su comentario (líneas 11 a 54) y pegarla en el archivo nuevo, con estos dos cambios: el retorno suma `providerMetadata`, y los imports son los que necesita.

```ts
// lib/outreach/services/generate-draft.ts
// La llamada al modelo de la redacción. Vivía en la tool draft_message y la
// importaba también el schedule de follow-ups: un nodo escondido en una puerta
// (spec orquestación §9.4). Imports relativos: lo usan módulos de eve.
import { type generateText, NoObjectGeneratedError, Output } from "ai";
import { draftOutputSchema } from "../prompt";

/**
 * Llama al modelo y devuelve el objeto que espera `draftMessage`, con
 * `generateText` inyectado para poder probarla sin llamar al modelo real.
 *
 * `generateText` con `Output.object` valida el esquema y, si el JSON viene
 * roto, no cierra o se corta por `maxOutputTokens`, tira `NoObjectGeneratedError`
 * en vez de resolver (ai@7.0.98, ver node_modules/ai/dist/index.js). Ese fallo
 * cuenta como un intento fallido, no como una excepción: si el texto crudo del
 * error resulta parseable devolvemos ese objeto (`draftOutputSchema.safeParse`
 * en draftMessage lo va a rechazar si no cumple el esquema), y si no, `null`.
 * Cualquier otro error se relanza.
 *
 * `usage` y `providerMetadata` viajan para que la puerta asiente el consumo
 * con `metered`: un intento fallido también se pagó.
 */
export async function generateDraft(
	model: string,
	system: string,
	prompt: string,
	deps: { generateText: typeof generateText; abortSignal?: AbortSignal },
): Promise<{ output: unknown; usage: unknown; providerMetadata: unknown }> {
	try {
		const result = await deps.generateText({
			model,
			system,
			prompt,
			maxOutputTokens: 1_200,
			maxRetries: 1,
			abortSignal: deps.abortSignal,
			output: Output.object({ schema: draftOutputSchema }),
		});
		return {
			output: result.output,
			usage: result.usage,
			providerMetadata: result.providerMetadata,
		};
	} catch (error) {
		if (NoObjectGeneratedError.isInstance(error)) {
			let output: unknown = null;
			if (error.text) {
				try {
					output = JSON.parse(error.text);
				} catch {
					output = null;
				}
			}
			return {
				output,
				usage: error.usage ?? null,
				providerMetadata: undefined,
			};
		}
		throw error;
	}
}
```

- [ ] **Step 4: Dejar la tool como puerta, con medición**

Reemplazar `agents/outreach/tools/draft_message.ts` completo:

```ts
import { generateText } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { draftMessage } from "../../../lib/outreach/services/draft";
import { generateDraft } from "../../../lib/outreach/services/generate-draft";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";
import {
	createUsageRecorder,
	metered,
	resolveRunId,
} from "../../../lib/workflows/usage";

// Sin approval: no escribe en ningún lado salvo su asiento de consumo. El
// costo de Opus se acota con maxOutputTokens y a lo sumo 3 intentos.
export default defineTool({
	description:
		"Redacta el primer mensaje por email para un contacto cargado, con la ficha de su cuenta y el canon del cliente, y lo pasa por el gate de estilo (hasta 3 intentos). No encola ni envía: con la pieza aprobada por el gate, usá queue_touch.",
	inputSchema: z.object({
		contactKey: z.string().min(4).max(300),
		kind: z.enum(["msg1"]),
	}),
	async execute({ contactKey, kind }, ctx) {
		const caller = callerFromSession(ctx.session);
		const admin = createAdminClient();
		const brain = await brainForTenant(caller.tenantId);
		const runId = await resolveRunId(
			admin,
			ctx.session.id,
			ctx.session.turn.id,
		);
		return draftMessage(
			{ caller, contactKey, kind },
			{
				store: createSupabaseOutreachStore(admin),
				loadCanon: (slug) => loadCanon(brain, slug),
				generate: metered(
					(model: string, system: string, prompt: string) =>
						generateDraft(model, system, prompt, {
							generateText,
							abortSignal: ctx.abortSignal,
						}),
					{
						model: (model) => model,
						record: createUsageRecorder(admin),
						base: {
							tenantId: caller.tenantId,
							runId,
							workflow: null,
							node: "outreach/draft",
						},
					},
				),
				now: () => new Date(),
			},
		);
	},
});
```

`ctx.session.turn.id` es un `string` no opcional en eve 0.54.2 (`SessionTurn` en `node_modules/eve/dist/src/channel/types.d.ts`). Es el mismo id que `hooks/runs.ts` guarda en `runs.eve_turn_id`, y por eso `resolveRunId` encuentra la fila.

- [ ] **Step 5: Medir también en el schedule de follow-ups**

En `agents/outreach/schedules/followups.ts`:

Línea 49, reemplazar el import desde la tool:

```ts
import { generateDraft } from "../../../lib/outreach/services/generate-draft";
```

Agregar junto a los demás imports de `lib/`:

```ts
import { createUsageRecorder, metered } from "../../../lib/workflows/usage";
```

Alrededor de la línea 178, donde hoy dice `generateDraft(model, system, prompt, { generateText }),` dentro del `generate:` que se le pasa a `draftMessage`, dejar:

```ts
				generate: metered(
					(model: string, system: string, prompt: string) =>
						generateDraft(model, system, prompt, { generateText }),
					{
						model: (model) => model,
						record: createUsageRecorder(admin),
						base: {
							tenantId: caller.tenantId,
							// El schedule no corre dentro de un turno: su fila de runs es la
							// del lock del día y no se enlaza acá. El asiento igual cuenta
							// para el presupuesto diario, que suma por tenant y por fecha.
							runId: null,
							workflow: null,
							node: "outreach/draft",
						},
					},
				),
```

`admin` y `caller` ya existen en ese scope (el archivo crea el cliente admin y arma un `Caller` por ejecutor). Si `admin` no estuviera en scope en ese punto, crearlo con `createAdminClient()` al principio de la función que contiene la llamada, no adentro del `generate`.

- [ ] **Step 6: Correr todo**

Run: `npm run typecheck && npm test`
Esperado: verde. `tests/outreach/services/generate-draft.test.ts` pasa con 6 tests; `tests/outreach/services/draft.test.ts` no se tocó y sigue pasando (el tipo de retorno de `generate` sumó un campo que sus fakes no dan, y `DraftDeps.generate` sigue declarando solo `{ output, usage }`: compatible).

- [ ] **Step 7: Commit**

```bash
git add -A lib/outreach/services/generate-draft.ts agents/outreach/tools/draft_message.ts agents/outreach/schedules/followups.ts tests/outreach/services/generate-draft.test.ts tests/agents/outreach/tools/draft_message.test.ts
git commit -m "refactor: generateDraft pasa a lib y la redacción asienta su consumo"
```

---

### Task 5: Medir el research

`generateResearch` se queda en la tool hasta la E3 (spec §9.4), pero empieza a asentar ya.

**Files:**
- Modify: `agents/outreach/tools/research_account.ts`
- Modify: `tests/agents/outreach/tools/research_account.test.ts`

**Interfaces:**
- Consumes: `metered`, `createUsageRecorder`, `resolveRunId`.
- Produces: `generateResearch(...)` devuelve `{ output, pagesRead, usage, providerMetadata }`.

- [ ] **Step 1: Test que falla**

En `tests/agents/outreach/tools/research_account.test.ts`, agregar dentro del `describe("generateResearch", ...)`:

```ts
	it("devuelve usage y providerMetadata para que la puerta asiente el consumo", async () => {
		const usage = { inputTokens: 100, outputTokens: 20 };
		const providerMetadata = { gateway: { cost: 0.002 } };
		const generateText = (async () => ({
			output: { name: "Acme" },
			usage,
			providerMetadata,
		})) as never;

		const result = await generateResearch(
			{
				model: "anthropic/claude-haiku-4.5",
				system: "s",
				prompt: "p",
				readPage: async () => ({
					ok: false as const,
					reason: "x",
					message: "x",
				}),
			},
			{ generateText },
		);

		expect(result.usage).toBe(usage);
		expect(result.providerMetadata).toBe(providerMetadata);
	});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/agents/outreach/tools/research_account.test.ts`
Esperado: FALLA: `result.usage` es `undefined`.

- [ ] **Step 3: Implementar**

En `agents/outreach/tools/research_account.ts`:

Cambiar la firma de retorno y el `return` de `generateResearch`:

```ts
): Promise<{
	output: unknown;
	pagesRead: number;
	usage: unknown;
	providerMetadata: unknown;
}> {
```

```ts
	return {
		output: result.output,
		pagesRead,
		usage: result.usage,
		providerMetadata: result.providerMetadata,
	};
```

Agregar el import:

```ts
import {
	createUsageRecorder,
	metered,
	resolveRunId,
} from "../../../lib/workflows/usage";
```

En `execute`, reemplazar la creación del store para reusar el cliente admin y resolver la corrida:

```ts
		const caller = callerFromSession(ctx.session);
		const admin = createAdminClient();
		const store = createSupabaseOutreachStore(admin);
```

Y dentro del `try`, antes de `runResearch`, y en sus deps:

```ts
			const runId = await resolveRunId(
				admin,
				ctx.session.id,
				ctx.session.turn.id,
			);
			output = await runResearch(
				{
					domain: prepared.domain,
					name: input.name ?? null,
					model: tenant.config.models.researcher,
					message: prepared.message,
				},
				{
					readPage: (url) =>
						fetchPublicPage(url, { fetchImpl: fetch, resolveHost }),
					generate: metered(
						(args: Parameters<typeof generateResearch>[0]) =>
							generateResearch(args, {
								generateText,
								abortSignal: ctx.abortSignal,
							}),
						{
							model: (args) => args.model,
							record: createUsageRecorder(admin),
							base: {
								tenantId: caller.tenantId,
								runId,
								workflow: null,
								node: "outreach/research",
							},
						},
					),
				},
			);
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run typecheck && npm test`
Esperado: verde.

- [ ] **Step 5: Commit**

```bash
git add agents/outreach/tools/research_account.ts tests/agents/outreach/tools/research_account.test.ts
git commit -m "feat: el research asienta su consumo"
```

---

### Task 6: Que nadie llame al modelo sin medir, y `runs.cost_usd` escrito

**Files:**
- Create: `tests/workflows/model-calls.test.ts`
- Modify: `lib/agents/session-store.ts` (`closeRun`)

**Interfaces:**
- Consumes: `public.set_run_cost(p_run uuid)` de la Task 2.
- Produces: `closeRun` deja `runs.cost_usd` escrito al cerrar cada turno.

- [ ] **Step 1: Test contra el disco**

```ts
// tests/workflows/model-calls.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (name === "node_modules" || name.startsWith(".")) return [];
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

// Importa el VALOR generateText de "ai" (no `type generateText`): es quien
// efectivamente dispara llamadas al modelo.
const IMPORTS_GENERATE_TEXT =
	/import\s*\{[^}]*(?<!type\s)\bgenerateText\b[^}]*\}\s*from\s*"ai"/;

describe("llamadas al modelo", () => {
	it("todo archivo que importa generateText usa metered", () => {
		// Spec orquestación §5.1 punto 9: si gasta, asienta. La medición se
		// engancha en la puerta, así que es fácil olvidarla en una puerta nueva.
		// Esto falla hasta que alguien decida.
		const sinMedir = [...walk("agents"), ...walk("lib"), ...walk("app")]
			.filter((file) => /\.(ts|tsx|mts)$/.test(file))
			.filter((file) => IMPORTS_GENERATE_TEXT.test(readFileSync(file, "utf8")))
			.filter((file) => !/\bmetered\(/.test(readFileSync(file, "utf8")));

		expect(sinMedir).toEqual([]);
	});
});
```

- [ ] **Step 2: Correrlo**

Run: `npx vitest run tests/workflows/model-calls.test.ts`
Esperado: PASA. Las tres puertas que importan `generateText` (`draft_message.ts`, `research_account.ts`, `followups.ts`) ya usan `metered` desde las Tasks 4 y 5. Para comprobar que el test muerde: sacar temporalmente el `metered(` de `research_account.ts`, correr, ver que lista ese archivo, y revertir con `git checkout -- agents/outreach/tools/research_account.ts`.

- [ ] **Step 3: Escribir el costo al cerrar la corrida**

En `lib/agents/session-store.ts`, reemplazar `closeRun`:

```ts
export async function closeRun(input: CloseRunInput): Promise<void> {
	const admin = createAdminClient();
	const { data, error } = await admin
		.from("runs")
		.update({
			status: input.status,
			error: input.error ?? null,
			finished_at: new Date().toISOString(),
		})
		.eq("eve_session_id", input.sessionId)
		.eq("eve_turn_id", input.turnId)
		.select("id")
		.maybeSingle();
	if (error) {
		console.error("closeRun:", error.message);
		return;
	}
	if (!data) return;
	// El total sale del libro de consumo (spec orquestación §7.2). Si falla, la
	// corrida queda cerrada igual y el costo se puede recalcular después.
	const { error: costError } = await admin.rpc("set_run_cost", {
		p_run: data.id,
	});
	if (costError) console.error("closeRun (costo):", costError.message);
}
```

- [ ] **Step 4: Correr todo**

Run: `npm run typecheck && npm test`
Esperado: verde. Si el typecheck se queja de que `set_run_cost` no existe en los tipos generados, es porque `lib/supabase/database.types.ts` se regenera contra el proyecto remoto (`npm run db:types`) y la migración todavía no se aplicó ahí. En ese caso tipar la llamada así, y sacar el cast en la Task 7 después de regenerar:

```ts
	const { error: costError } = await (
		admin.rpc as unknown as (
			fn: string,
			args: Record<string, unknown>,
		) => Promise<{ error: { message: string } | null }>
	)("set_run_cost", { p_run: data.id });
```

- [ ] **Step 5: Commit**

```bash
git add tests/workflows/model-calls.test.ts lib/agents/session-store.ts
git commit -m "feat: runs.cost_usd se escribe al cerrar el turno, y test de que nadie llama al modelo sin medir"
```

---

### Task 7: Cierre de la E1 contra el deploy

**Files:**
- Modify: `lib/supabase/database.types.ts` (regenerado)
- Delete: `scripts/spike-gateway-cost.mts`

- [ ] **Step 1: Aplicar la migración al proyecto remoto y regenerar tipos**

```bash
npx supabase db push
npm run db:types
```

Esperado: `db push` lista `20260921090000_usage_entries.sql` y la aplica. `db:types` reescribe `lib/supabase/database.types.ts` con `usage_entries` y `set_run_cost`. Si en la Task 6 quedó el cast de `admin.rpc`, sacarlo ahora.

- [ ] **Step 2: Verde local y PR**

Run: `npm run typecheck && npm test && npm run db:test`

Abrir el PR con `/ship`. Esperar el deploy de preview.

- [ ] **Step 3: Verificar en el preview (no asumir)**

Desde el chat del preview, con tu usuario de `innovas`: pedir un `research_account` de un dominio sin ficha vigente y después un `draft_message` para un contacto de esa cuenta. Después, en el SQL editor de Supabase:

```sql
select node, resource, amount, unit, meta->>'model' as model, meta->>'source' as source, run_id is not null as con_corrida
from public.usage_entries
order by created_at desc
limit 10;

select id, status, cost_usd, finished_at
from public.runs
where cost_usd is not null
order by finished_at desc
limit 5;
```

Esperado: asientos `outreach/research` y `outreach/draft` con `amount > 0`, `con_corrida = true`, y `source` = `gateway` o `tabla` según el resultado de S1. Al menos una fila de `runs` con `cost_usd > 0`. **Es la primera vez que esa columna tiene un valor.** Si `source` es `sin_precio`, falta un modelo en `MODEL_PRICES`: agregarlo y repetir.

- [ ] **Step 4: Borrar el spike y cerrar**

```bash
git rm scripts/spike-gateway-cost.mts
git add lib/supabase/database.types.ts
git commit -m "chore: tipos regenerados y baja del spike S1"
```

Mergear el PR. **E1 cerrada:** se sabe cuánto cuesta cada turno del chat.

---

# Entrega 2 · Rieles

Todo lo de esta entrega se prueba con dependencias falsas y contra la base local. Nada corre en producción hasta la E3.

### Task 8: Tabla `work_items` y reclamo con lease

**Files:**
- Create: `supabase/migrations/20260921100000_work_items.sql`
- Test: `supabase/tests/13_work_items.test.sql`

**Interfaces:**
- Produces:
  - enum `public.work_item_status`: `pending`, `running`, `done`, `refused`, `failed`
  - tabla `public.work_items (id bigint, tenant_id, workflow, subject_type, subject_id, input_hash, status, attempts, next_attempt_at, lease_until, last_error, result_reason, run_id, created_at, updated_at)`
  - `public.claim_work_items(p_tenant uuid, p_workflow text, p_limit integer, p_lease_seconds integer) returns setof public.work_items`, ejecutable solo por `service_role`

- [ ] **Step 1: Test que falla**

```sql
-- supabase/tests/13_work_items.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_member');

insert into public.work_items (tenant_id, workflow, subject_type, subject_id, input_hash)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000001', 'h1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000002', 'h1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000003', 'h1'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000009', 'h1');

select throws_ok(
  $$insert into public.work_items (tenant_id, workflow, subject_type, subject_id, input_hash)
    values ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 'account', 'cccccccc-0000-0000-0000-000000000001', 'h1')$$,
  '23505',
  null,
  'el mismo sujeto con la misma huella no se encola dos veces'
);

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 2, 60)),
  2,
  'reclama hasta el límite'
);

select is(
  (select count(*)::int from public.work_items
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status = 'running' and attempts = 1 and lease_until > now()),
  2,
  'lo reclamado queda running, con un intento y lease a futuro'
);

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 5, 60)),
  1,
  'el segundo reclamo solo ve lo que quedaba pending: lo tomado está bajo lease'
);

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 5, 60)),
  0,
  'con todo tomado no hay nada que reclamar'
);

select is(
  (select count(*)::int from public.work_items
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000003' and status = 'pending'),
  1,
  'reclamar para un tenant no toca los ítems de otro'
);

-- Proceso muerto: el lease vence y el ítem vuelve a estar disponible.
update public.work_items set lease_until = now() - interval '1 minute'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 5, 60)),
  3,
  'un lease vencido se vuelve a reclamar'
);

-- Tercer intento y otra muerte: no vuelve a entregarse, pasa a failed.
update public.work_items set attempts = 3, lease_until = now() - interval '1 minute'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 5, 60)),
  0,
  'con los intentos agotados no se entrega más'
);

select is(
  (select count(*)::int from public.work_items
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status = 'failed' and last_error = 'lease vencido'),
  3,
  'agotado y con lease vencido pasa a failed: nada queda colgado en running'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.work_items),
  3,
  'un miembro ve solo los ítems de su tenant'
);

select throws_ok(
  $$select public.claim_work_items('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas', 1, 60)$$,
  '42501',
  null,
  'authenticated no puede reclamar trabajo'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run db:test`
Esperado: FALLA en `13_work_items.test.sql` con `relation "public.work_items" does not exist`.

- [ ] **Step 3: Migración**

```sql
-- supabase/migrations/20260921100000_work_items.sql
-- Las aristas del grafo (spec orquestación §6). Una fila es "este workflow
-- tiene que procesar este sujeto". Estado operativo, derivado y descartable:
-- el resultado vive en la tabla de dominio y el hecho en events.
create type public.work_item_status as enum ('pending', 'running', 'done', 'refused', 'failed');

create table public.work_items (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workflow text not null check (length(workflow) between 1 and 100),
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_]{0,40}$'),
  -- Sin FK: el sujeto es polimórfico por subject_type.
  subject_id uuid not null,
  input_hash text not null check (length(input_hash) between 1 and 200),
  status public.work_item_status not null default 'pending',
  attempts smallint not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text check (last_error is null or length(last_error) <= 2000),
  result_reason text check (result_reason is null or length(result_reason) <= 200),
  run_id uuid references public.runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deduplica contra todo lo visto, no solo contra lo confirmado: la fila
  -- queda aunque haya terminado refused o failed (spec §6.3).
  unique (tenant_id, workflow, subject_type, subject_id, input_hash)
);

-- Parcial: el reclamo solo mira lo vivo, y done/refused/failed son la mayoría
-- de la tabla con el tiempo.
create index work_items_claim_idx
  on public.work_items (tenant_id, workflow, next_attempt_at)
  where status in ('pending', 'running');
create index work_items_run_id_idx on public.work_items (run_id);

alter table public.work_items enable row level security;

create policy work_items_select on public.work_items
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

revoke insert, update, delete on public.work_items from authenticated, anon;

-- Reclamo atómico (spec §6.4). El máximo de intentos (3) también vive en
-- lib/workflows/types.ts como MAX_ATTEMPTS: si cambia uno, cambia el otro.
create or replace function public.claim_work_items(
  p_tenant uuid,
  p_workflow text,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.work_items
language plpgsql security definer set search_path = '' as $$
begin
  -- Un proceso que muere cuenta como intento. Agotado y con el lease vencido:
  -- a failed, para que ninguna fila quede reclamable para siempre ni colgada.
  update public.work_items w
     set status = 'failed',
         last_error = 'lease vencido',
         lease_until = null,
         updated_at = now()
   where w.tenant_id = p_tenant
     and w.workflow = p_workflow
     and w.status = 'running'
     and w.lease_until < now()
     and w.attempts >= 3;

  return query
  update public.work_items w
     set status = 'running',
         attempts = w.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where w.id in (
     select c.id
       from public.work_items c
      where c.tenant_id = p_tenant
        and c.workflow = p_workflow
        and c.attempts < 3
        and (
          (c.status = 'pending' and c.next_attempt_at <= now())
          or (c.status = 'running' and c.lease_until < now())
        )
      order by c.next_attempt_at, c.id
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning w.*;
end;
$$;

revoke execute on function public.claim_work_items(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_work_items(uuid, text, integer, integer) to service_role;
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run db:test`
Esperado: verde, `13_work_items.test.sql` con 11 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260921100000_work_items.sql supabase/tests/13_work_items.test.sql
git commit -m "feat: work_items y reclamo atómico con lease"
```

---

### Task 9: `tenant_workflows`, `tenant_budgets`, columnas de `runs` y `usage_sum`

**Files:**
- Create: `supabase/migrations/20260921110000_tenant_workflows_budgets.sql`
- Test: `supabase/tests/14_tenant_workflows_budgets.test.sql`

**Interfaces:**
- Produces:
  - tabla `public.tenant_workflows (tenant_id, workflow, enabled default false, config jsonb, last_run_at, created_at)`, PK `(tenant_id, workflow)`
  - tabla `public.tenant_budgets (tenant_id, resource, daily_limit, updated_by, updated_at)`, PK `(tenant_id, resource)`
  - `runs`: columnas `workflow text`, `items_claimed`, `items_ok`, `items_refused`, `items_failed integer`; valor nuevo `budget_exhausted` en `run_status`
  - `public.usage_sum(p_tenant uuid, p_resource text, p_since timestamptz, p_run uuid default null) returns numeric`, solo `service_role`

- [ ] **Step 1: Test que falla**

```sql
-- supabase/tests/14_tenant_workflows_budgets.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin');

insert into public.tenant_workflows (tenant_id, workflow)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'refresh-fichas');

select is(
  (select enabled from public.tenant_workflows where workflow = 'refresh-fichas'),
  false,
  'un workflow nace apagado: lo desatendido se prende a propósito'
);

insert into public.tenant_budgets (tenant_id, resource, daily_limit)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'model_usd', 5),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'model_usd', 9);

insert into public.runs (id, tenant_id, agent, trigger, eve_session_id, status, workflow, items_claimed, items_ok, items_refused, items_failed)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
        'outreach', 'schedule', 'wf:refresh-fichas:1', 'budget_exhausted', 'refresh-fichas', 0, 0, 0, 0);

select is(
  (select status::text from public.runs where id = 'dddddddd-0000-0000-0000-000000000001'),
  'budget_exhausted',
  'runs acepta el estado budget_exhausted y las columnas de conteo'
);

insert into public.usage_entries (tenant_id, run_id, node, resource, amount, unit, created_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'n', 'model_usd', 1.5, 'usd', now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'n', 'model_usd', 2, 'usd', now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'n', 'model_usd', 40, 'usd', now() - interval '2 days'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'n', 'apollo_credits', 7, 'credits', now()),
  ('aaaaaaaa-0000-0000-0000-000000000003', null, 'n', 'model_usd', 99, 'usd', now());

select is(
  public.usage_sum('aaaaaaaa-0000-0000-0000-000000000002', 'model_usd', now() - interval '1 day'),
  3.5::numeric,
  'usage_sum suma el recurso del tenant desde la fecha, sin otros tenants ni otros recursos'
);

select is(
  public.usage_sum('aaaaaaaa-0000-0000-0000-000000000002', 'model_usd', now() - interval '1 day', 'dddddddd-0000-0000-0000-000000000001'),
  1.5::numeric,
  'con corrida, usage_sum acota a esa corrida'
);

select is(
  public.usage_sum('aaaaaaaa-0000-0000-0000-000000000002', 'otro_recurso', now() - interval '1 day'),
  0::numeric,
  'sin asientos devuelve 0, no null'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.tenant_budgets),
  1,
  'un tenant_admin ve solo el presupuesto de su tenant'
);

select throws_ok(
  $$update public.tenant_budgets set daily_limit = 1000$$,
  '42501',
  null,
  'regla congelada: ni un tenant_admin se sube el presupuesto'
);

select throws_ok(
  $$update public.tenant_workflows set enabled = true$$,
  '42501',
  null,
  'authenticated no prende workflows'
);

select throws_ok(
  $$select public.usage_sum('aaaaaaaa-0000-0000-0000-000000000002', 'model_usd', now() - interval '1 day')$$,
  '42501',
  null,
  'usage_sum no es ejecutable por authenticated: expone costo interno'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run db:test`
Esperado: FALLA con `relation "public.tenant_workflows" does not exist`.

- [ ] **Step 3: Migración**

```sql
-- supabase/migrations/20260921110000_tenant_workflows_budgets.sql
-- Configuración de workflows por tenant (spec orquestación §10), presupuestos
-- (§7.2) y las columnas que runs necesita para una pasada de workflow (§6.6).

-- Espejo de tenant_agents. enabled nace en false, al revés que los agentes:
-- un workflow desatendido gasta plata solo.
create table public.tenant_workflows (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Validado contra lib/workflows/registry.ts en código; sin FK.
  workflow text not null check (length(workflow) between 1 and 100),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, workflow)
);

-- Tabla aparte y no adentro de tenant_workflows: un recurso se comparte entre
-- workflows, y es regla congelada (spec §8.3). Sin fila, el límite es cero.
create table public.tenant_budgets (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  resource text not null check (resource ~ '^[a-z][a-z0-9_]{0,40}$'),
  daily_limit numeric(14, 6) not null check (daily_limit >= 0),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, resource)
);

create index tenant_budgets_updated_by_idx on public.tenant_budgets (updated_by);

alter table public.tenant_workflows enable row level security;
alter table public.tenant_budgets enable row level security;

create policy tenant_workflows_select on public.tenant_workflows
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

create policy tenant_budgets_select on public.tenant_budgets
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

revoke insert, update, delete on public.tenant_workflows from authenticated, anon;
revoke insert, update, delete on public.tenant_budgets from authenticated, anon;

-- Una pasada de workflow en runs. El valor nuevo del enum no se usa en esta
-- misma migración: Postgres no lo permite dentro de la transacción que lo crea.
alter type public.run_status add value if not exists 'budget_exhausted';

alter table public.runs
  add column workflow text check (workflow is null or length(workflow) between 1 and 100),
  add column items_claimed integer check (items_claimed is null or items_claimed >= 0),
  add column items_ok integer check (items_ok is null or items_ok >= 0),
  add column items_refused integer check (items_refused is null or items_refused >= 0),
  add column items_failed integer check (items_failed is null or items_failed >= 0);

-- runs tiene grants por columna (el costo es invisible): las nuevas se otorgan a mano.
grant select (workflow, items_claimed, items_ok, items_refused, items_failed)
  on public.runs to authenticated;

create index runs_tenant_workflow_started_idx
  on public.runs (tenant_id, workflow, started_at desc)
  where workflow is not null;

-- Lo gastado de un recurso desde una fecha; con p_run, acotado a una pasada.
create or replace function public.usage_sum(
  p_tenant uuid,
  p_resource text,
  p_since timestamptz,
  p_run uuid default null
)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(u.amount), 0)
    from public.usage_entries u
   where u.tenant_id = p_tenant
     and u.resource = p_resource
     and u.created_at >= p_since
     and (p_run is null or u.run_id = p_run);
$$;

revoke execute on function public.usage_sum(uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.usage_sum(uuid, text, timestamptz, uuid) to service_role;
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run db:test`
Esperado: verde, `14_tenant_workflows_budgets.test.sql` con 9 tests. Si `04_runs_events.test.sql` o `07_authenticated_grants.test.sql` fallan por los grants nuevos de `runs`, es que enumeran las columnas visibles: sumar las cinco nuevas a la lista esperada de ese test.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260921110000_tenant_workflows_budgets.sql supabase/tests/14_tenant_workflows_budgets.test.sql
git commit -m "feat: tenant_workflows, tenant_budgets y conteos de pasada en runs"
```

---

### Task 10: Tipos y registry, con los tests que obligan

**Files:**
- Create: `lib/workflows/types.ts`
- Create: `lib/workflows/registry.ts`
- Test: `tests/workflows/registry.test.ts`

**Interfaces:**
- Produces (todo lo que las Tasks 11 a 14 consumen):

```ts
// types.ts
export const MAX_ATTEMPTS = 3;
export type EffectLevel = 0 | 1 | 2 | 3;
export type ModelTier = "barato" | "medio" | "fuerte";
export interface NodeInfo { effect: EffectLevel; tier: ModelTier | null }
export interface WorkflowInfo {
	agent: string;
	subjectType: string;
	claims: string;
	produces: string | null;
	nodes: readonly string[];
	optionalNodes: readonly string[];
	resources: readonly string[];
	caps: { itemsPerTick: number; costUsdPerRun: number };
	entry: "seed" | "door" | "upstream";
}
export interface WorkItem {
	id: number; tenantId: string; workflow: string; subjectType: string;
	subjectId: string; inputHash: string; attempts: number;
}
export type ItemOutcome =
	| { ok: true; downstreamHash?: string }
	| { ok: false; reason: string; message: string };
```

```ts
// registry.ts
export const NODES: Record<string, NodeInfo>;
export const WORKFLOWS: Record<string, WorkflowInfo>;
export const SERVICES_EXCLUIDOS: Record<string, string>; // archivo → motivo
export function isWorkflow(name: string): boolean;
export function downstreamOf(produces: string | null): string[];
```

- [ ] **Step 1: Test que falla**

```ts
// tests/workflows/registry.test.ts
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	downstreamOf,
	isWorkflow,
	NODES,
	SERVICES_EXCLUIDOS,
	WORKFLOWS,
} from "@/lib/workflows/registry";

// lib/<dominio>/services/<archivo>.ts  →  "<dominio>/<archivo>"
function servicesOnDisk(): string[] {
	return readdirSync("lib")
		.filter((domain) => statSync(join("lib", domain)).isDirectory())
		.flatMap((domain) => {
			const dir = join("lib", domain, "services");
			try {
				return readdirSync(dir)
					.filter((file) => file.endsWith(".ts"))
					.map((file) => `${domain}/${file.replace(/\.ts$/, "")}`);
			} catch {
				return [];
			}
		});
}

describe("registry", () => {
	it("todo servicio de lib/*/services está registrado como nodo o excluido con motivo", () => {
		// Mismo patrón que TOOL_LABELS: la tabla es a mano, así que esto falla
		// hasta que alguien decida qué nivel de efecto tiene el servicio nuevo.
		const sinDecidir = servicesOnDisk().filter(
			(name) =>
				!Object.hasOwn(NODES, name) && !Object.hasOwn(SERVICES_EXCLUIDOS, name),
		);
		expect(sinDecidir).toEqual([]);
	});

	it("no quedan nodos ni excluidos que ya no existen en el disco", () => {
		const onDisk = new Set(servicesOnDisk());
		const huerfanos = [
			...Object.keys(NODES),
			...Object.keys(SERVICES_EXCLUIDOS),
		].filter((name) => !onDisk.has(name));
		expect(huerfanos).toEqual([]);
	});

	it("todo excluido explica por qué", () => {
		const sinMotivo = Object.entries(SERVICES_EXCLUIDOS)
			.filter(([, motivo]) => motivo.trim().length < 10)
			.map(([name]) => name);
		expect(sinMotivo).toEqual([]);
	});

	it("ningún workflow referencia un nodo de nivel 3", () => {
		// Un workflow desatendido nunca le llega a una persona de afuera
		// (spec §5.2 punto 6). Lo más lejos que llega es dejar una pieza pending.
		const culpables = Object.entries(WORKFLOWS).flatMap(([name, wf]) =>
			[...wf.nodes, ...wf.optionalNodes]
				.filter((node) => NODES[node]?.effect === 3)
				.map((node) => `${name} → ${node}`),
		);
		expect(culpables).toEqual([]);
	});

	it("todo nodo que un workflow referencia existe", () => {
		const inexistentes = Object.entries(WORKFLOWS).flatMap(([name, wf]) =>
			[...wf.nodes, ...wf.optionalNodes]
				.filter((node) => !Object.hasOwn(NODES, node))
				.map((node) => `${name} → ${node}`),
		);
		expect(inexistentes).toEqual([]);
	});

	it("un workflow con nodos que gastan declara tope de costo y sus recursos", () => {
		const sinTope = Object.entries(WORKFLOWS)
			.filter(([, wf]) =>
				[...wf.nodes, ...wf.optionalNodes].some(
					(node) => (NODES[node]?.effect ?? 0) >= 1,
				),
			)
			.filter(
				([, wf]) => !(wf.caps.costUsdPerRun > 0) || wf.resources.length === 0,
			)
			.map(([name]) => name);
		expect(sinTope).toEqual([]);
	});

	it("todo claims tiene quién lo produzca, o declara que entra por sembrador o por puerta", () => {
		const produced = new Set(
			Object.values(WORKFLOWS)
				.map((wf) => wf.produces)
				.filter((p): p is string => p !== null),
		);
		const huerfanos = Object.entries(WORKFLOWS)
			.filter(([, wf]) => wf.entry === "upstream" && !produced.has(wf.claims))
			.map(([name]) => name);
		expect(huerfanos).toEqual([]);
	});

	it("isWorkflow no se deja engañar por el prototipo", () => {
		expect(isWorkflow("refresh-fichas")).toBe(true);
		expect(isWorkflow("constructor")).toBe(false);
		expect(isWorkflow("no-existe")).toBe(false);
	});

	it("downstreamOf devuelve los workflows que reclaman lo que otro deja", () => {
		expect(downstreamOf(null)).toEqual([]);
		expect(downstreamOf("etiqueta-que-nadie-reclama")).toEqual([]);
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/workflows/registry.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 3: Implementar `types.ts`**

```ts
// lib/workflows/types.ts
// Tipos compartidos de la orquestación (spec §5 y §9). Sin imports: lo usan
// el registry, el runner y los módulos de eve.

/** También vive en SQL, en claim_work_items. Si cambia uno, cambia el otro. */
export const MAX_ATTEMPTS = 3;

/** Spec §7: 0 base propia · 1 gasta plata · 2 escribe en sistemas del tenant · 3 le llega a una persona. */
export type EffectLevel = 0 | 1 | 2 | 3;
export type ModelTier = "barato" | "medio" | "fuerte";

export interface NodeInfo {
	effect: EffectLevel;
	tier: ModelTier | null;
}

export interface WorkflowInfo {
	/** Agente dueño: el schedule que lo despacha vive en su carpeta. */
	agent: string;
	subjectType: string;
	/** Etiquetas del grafo: qué reclama y qué deja. */
	claims: string;
	produces: string | null;
	nodes: readonly string[];
	optionalNodes: readonly string[];
	/** Recursos medidos que gasta: contra estos se chequea el presupuesto diario. */
	resources: readonly string[];
	caps: { itemsPerTick: number; costUsdPerRun: number };
	/** De dónde le llega el trabajo: un sembrador propio, una puerta, u otro workflow. */
	entry: "seed" | "door" | "upstream";
}

export interface WorkItem {
	id: number;
	tenantId: string;
	workflow: string;
	subjectType: string;
	subjectId: string;
	inputHash: string;
	attempts: number;
}

/** Lo que devuelve procesar un ítem. Una excepción es infraestructura caída y se reintenta. */
export type ItemOutcome =
	| { ok: true; downstreamHash?: string }
	| { ok: false; reason: string; message: string };
```

- [ ] **Step 4: Implementar `registry.ts`**

Los niveles salen del criterio de la spec §7.1. Antes de commitear, abrir cada archivo de `lib/outreach/services/` y confirmar que el nivel asignado es cierto para lo que el archivo hace hoy; si no, corregir acá, no en el test.

```ts
// lib/workflows/registry.ts
// El grafo de la plataforma, entero, en un lugar (spec orquestación §9.1).
// Objeto plano a propósito: sin framework ni defineNode(). Los tests de
// tests/workflows/registry.test.ts lo comparan contra el disco y fallan hasta
// que alguien decide.
import type { NodeInfo, WorkflowInfo } from "./types";

// Clave: "<dominio>/<archivo>" de lib/<dominio>/services/<archivo>.ts
export const NODES: Record<string, NodeInfo> = {
	"outreach/import-contacts": { effect: 0, tier: null },
	"outreach/research": { effect: 1, tier: "barato" },
	"outreach/draft": { effect: 1, tier: "fuerte" },
	"outreach/queue": { effect: 0, tier: null },
	// Le llega a una persona: nunca desde un workflow desatendido.
	"outreach/send": { effect: 3, tier: null },
	// Escribe en el CRM del tenant.
	"outreach/crm-record": { effect: 2, tier: null },
	// Lee Gmail y registra hechos en la base propia; no gasta ni escribe afuera.
	"outreach/sweep": { effect: 0, tier: null },
	"outreach/reconcile": { effect: 0, tier: null },
	"outreach/replies": { effect: 0, tier: null },
	// Encola follow-ups redactando con el modelo: gasta.
	"outreach/followups": { effect: 1, tier: "medio" },
};

export const SERVICES_EXCLUIDOS: Record<string, string> = {
	"outreach/executor":
		"helper que resuelve el ejecutor y valida atribución; no es un trabajo por sí mismo",
	"outreach/research-run":
		"la llamada al modelo del nodo outreach/research; se registra junto con él",
	"outreach/generate-draft":
		"la llamada al modelo del nodo outreach/draft; se registra junto con él",
};

export const WORKFLOWS: Record<string, WorkflowInfo> = {
	"refresh-fichas": {
		agent: "outreach",
		subjectType: "account",
		claims: "ficha_vencida",
		produces: "ficha_vigente",
		nodes: ["outreach/research"],
		optionalNodes: [],
		resources: ["model_usd"],
		caps: { itemsPerTick: 5, costUsdPerRun: 1 },
		entry: "seed",
	},
};

export function isWorkflow(name: string): boolean {
	return Object.hasOwn(WORKFLOWS, name);
}

/** Workflows que reclaman lo que otro deja. El runner encola para estos al terminar un ítem. */
export function downstreamOf(produces: string | null): string[] {
	if (produces === null) return [];
	return Object.entries(WORKFLOWS)
		.filter(([, wf]) => wf.claims === produces)
		.map(([name]) => name);
}
```

- [ ] **Step 5: Correr y ver pasar**

Run: `npx vitest run tests/workflows/registry.test.ts`
Esperado: PASA (9 tests). Si el primero lista servicios sin decidir, es que en `lib/` hay un archivo de servicio que esta tabla no contempla (por ejemplo uno que sumó otra rama): decidir su nivel y agregarlo.

- [ ] **Step 6: Comprobar que los tests muerden**

Tres roturas a propósito, una por vez, corriendo el test cada vez y revirtiendo después:

1. Borrar la línea `"outreach/queue"` de `NODES` → falla "todo servicio … está registrado".
2. Agregar `"outreach/send"` a `nodes` de `refresh-fichas` → falla "ningún workflow referencia un nodo de nivel 3".
3. Poner `costUsdPerRun: 0` → falla "declara tope de costo".

Es el criterio de cierre 8 de la spec. Revertir con `git checkout -- lib/workflows/registry.ts` y confirmar verde.

- [ ] **Step 7: Commit**

```bash
git add lib/workflows/types.ts lib/workflows/registry.ts tests/workflows/registry.test.ts
git commit -m "feat: registry de nodos y workflows con tests que obligan"
```

---

### Task 11: Config de un workflow por tenant

**Files:**
- Create: `lib/workflows/config.ts`
- Test: `tests/workflows/config.test.ts`

**Interfaces:**
- Consumes: `WORKFLOWS`, `isWorkflow` de la Task 10.
- Produces:

```ts
export interface TenantWorkflowConfig {
	cadenceMinutes: number;
	itemsPerTick: number;
	optionalNodes: ReadonlySet<string>;
	params: Record<string, unknown>;
}
export type ConfigResult =
	| { ok: true; config: TenantWorkflowConfig }
	| { ok: false; reason: string; message: string };
export function parseTenantWorkflowConfig(workflow: string, raw: unknown): ConfigResult;
export function isDue(lastRunAt: string | null, cadenceMinutes: number, now: Date): boolean;
```

- [ ] **Step 1: Test que falla**

```ts
// tests/workflows/config.test.ts
import { describe, expect, it } from "vitest";
import { isDue, parseTenantWorkflowConfig } from "@/lib/workflows/config";

describe("parseTenantWorkflowConfig", () => {
	it("con config vacía usa los defaults y el tope del registry", () => {
		const result = parseTenantWorkflowConfig("refresh-fichas", {});
		expect(result).toEqual({
			ok: true,
			config: {
				cadenceMinutes: 60,
				itemsPerTick: 5,
				optionalNodes: new Set(),
				params: {},
			},
		});
	});

	it("el tenant puede bajar los ítems por tick pero nunca pasar el tope del registry", () => {
		const menos = parseTenantWorkflowConfig("refresh-fichas", {
			items_per_tick: 2,
		});
		expect(menos.ok && menos.config.itemsPerTick).toBe(2);

		const mas = parseTenantWorkflowConfig("refresh-fichas", {
			items_per_tick: 500,
		});
		expect(mas.ok && mas.config.itemsPerTick).toBe(5);
	});

	it("un nodo opcional que el workflow no declara falla con ruido", () => {
		// Un typo no puede apagar un paso en silencio (spec §10.1).
		const result = parseTenantWorkflowConfig("refresh-fichas", {
			optional_nodes: ["outreach/no-existe"],
		});
		expect(result).toMatchObject({
			ok: false,
			reason: "nodo_opcional_desconocido",
		});
	});

	it("un workflow que no está en el registry se rechaza", () => {
		expect(parseTenantWorkflowConfig("constructor", {})).toMatchObject({
			ok: false,
			reason: "workflow_desconocido",
		});
	});

	it.each([
		{ cadence_minutes: 0 },
		{ cadence_minutes: "5" },
		{ items_per_tick: -1 },
		{ optional_nodes: "outreach/x" },
		"no-es-objeto",
	])("rechaza una config con forma inválida: %j", (raw) => {
		expect(parseTenantWorkflowConfig("refresh-fichas", raw)).toMatchObject({
			ok: false,
			reason: "config_invalida",
		});
	});

	it("lo que no es de la plataforma pasa como params del workflow", () => {
		const result = parseTenantWorkflowConfig("refresh-fichas", {
			cadence_minutes: 30,
			dias_de_gracia: 7,
		});
		expect(result.ok && result.config.params).toEqual({ dias_de_gracia: 7 });
		expect(result.ok && result.config.cadenceMinutes).toBe(30);
	});
});

describe("isDue", () => {
	const now = new Date("2026-09-21T12:00:00Z");

	it("nunca corrió: le toca", () => {
		expect(isDue(null, 60, now)).toBe(true);
	});

	it("corrió hace menos que la cadencia: no le toca", () => {
		expect(isDue("2026-09-21T11:30:00Z", 60, now)).toBe(false);
	});

	it("corrió hace justo la cadencia: le toca", () => {
		expect(isDue("2026-09-21T11:00:00Z", 60, now)).toBe(true);
	});

	it("una fecha rota no lo deja trabado para siempre", () => {
		expect(isDue("no-es-fecha", 60, now)).toBe(true);
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/workflows/config.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// lib/workflows/config.ts
// Config de un workflow para un tenant (spec orquestación §10.1). Se valida
// con ruido: una config rota apaga ese workflow para ese tenant y avisa, nunca
// corre con valores adivinados.
import { z } from "zod";
import { isWorkflow, WORKFLOWS } from "./registry";

const DEFAULT_CADENCE_MINUTES = 60;

const platformSchema = z.looseObject({
	cadence_minutes: z.number().int().min(5).max(10_080).optional(),
	items_per_tick: z.number().int().min(1).optional(),
	optional_nodes: z.array(z.string().min(1).max(100)).optional(),
});

export interface TenantWorkflowConfig {
	cadenceMinutes: number;
	itemsPerTick: number;
	optionalNodes: ReadonlySet<string>;
	/** Todo lo que no es de la plataforma: parámetros propios del workflow. */
	params: Record<string, unknown>;
}

export type ConfigResult =
	| { ok: true; config: TenantWorkflowConfig }
	| { ok: false; reason: string; message: string };

export function parseTenantWorkflowConfig(
	workflow: string,
	raw: unknown,
): ConfigResult {
	if (!isWorkflow(workflow)) {
		return {
			ok: false,
			reason: "workflow_desconocido",
			message: `"${workflow}" no está en el registry`,
		};
	}
	const info = WORKFLOWS[workflow];
	const parsed = platformSchema.safeParse(raw ?? {});
	if (!parsed.success) {
		return {
			ok: false,
			reason: "config_invalida",
			message: `config de ${workflow} inválida: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ")}`,
		};
	}
	const { cadence_minutes, items_per_tick, optional_nodes, ...params } =
		parsed.data;

	const desconocidos = (optional_nodes ?? []).filter(
		(node) => !info.optionalNodes.includes(node),
	);
	if (desconocidos.length > 0) {
		return {
			ok: false,
			reason: "nodo_opcional_desconocido",
			message: `${workflow} no admite estos nodos opcionales: ${desconocidos.join(", ")}`,
		};
	}

	return {
		ok: true,
		config: {
			cadenceMinutes: cadence_minutes ?? DEFAULT_CADENCE_MINUTES,
			itemsPerTick: Math.min(
				items_per_tick ?? info.caps.itemsPerTick,
				info.caps.itemsPerTick,
			),
			optionalNodes: new Set(optional_nodes ?? []),
			params,
		},
	};
}

export function isDue(
	lastRunAt: string | null,
	cadenceMinutes: number,
	now: Date,
): boolean {
	if (!lastRunAt) return true;
	const last = new Date(lastRunAt).getTime();
	if (Number.isNaN(last)) return true;
	return now.getTime() - last >= cadenceMinutes * 60_000;
}
```

`z.looseObject` es la forma de zod 4 de dejar pasar claves extra; el repo está en zod 4.5.4.

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/workflows/config.test.ts`
Esperado: PASA (14 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/workflows/config.ts tests/workflows/config.test.ts
git commit -m "feat: config de workflow por tenant, validada con ruido"
```

---

### Task 12: `enqueue()` y presupuesto

**Files:**
- Create: `lib/workflows/enqueue.ts`
- Create: `lib/workflows/budget.ts`
- Test: `tests/workflows/enqueue.test.ts`
- Test: `tests/workflows/budget.test.ts`

**Interfaces:**
- Consumes: `isWorkflow`, `WORKFLOWS` (Task 10); `dayStart` de `lib/outreach/time.ts`.
- Produces:

```ts
// enqueue.ts
export interface EnqueueStore {
	insertWorkItem(row: {
		tenantId: string; workflow: string; subjectType: string;
		subjectId: string; inputHash: string;
	}): Promise<"inserted" | "ya_visto">;
}
export type EnqueueResult =
	| { enqueued: true }
	| { enqueued: false; reason: "ya_visto" | "workflow_desconocido" | "sujeto_equivocado" };
export function enqueue(
	input: { tenantId: string; workflow: string; subjectType: string; subjectId: string; inputHash: string },
	deps: { store: EnqueueStore },
): Promise<EnqueueResult>;

// budget.ts
export interface BudgetStore {
	usageSince(tenantId: string, resource: string, since: Date, runId?: string): Promise<number>;
	dailyLimit(tenantId: string, resource: string): Promise<number>;
}
export interface BudgetStatus { resource: string; spent: number; limit: number; exhausted: boolean }
export function budgetStatus(
	input: { tenantId: string; resources: readonly string[]; timezone: string },
	deps: { store: BudgetStore; now: () => Date },
): Promise<BudgetStatus[]>;
```

- [ ] **Step 1: Tests que fallan**

```ts
// tests/workflows/enqueue.test.ts
import { describe, expect, it, vi } from "vitest";
import { enqueue } from "@/lib/workflows/enqueue";

const base = {
	tenantId: "t1",
	workflow: "refresh-fichas",
	subjectType: "account",
	subjectId: "acc-1",
	inputHash: "h1",
};

describe("enqueue", () => {
	it("encola un ítem nuevo", async () => {
		const insertWorkItem = vi.fn(async () => "inserted" as const);
		expect(await enqueue(base, { store: { insertWorkItem } })).toEqual({
			enqueued: true,
		});
		expect(insertWorkItem).toHaveBeenCalledWith(base);
	});

	it("algo ya visto no es error: es la deduplicación haciendo su trabajo", async () => {
		const insertWorkItem = vi.fn(async () => "ya_visto" as const);
		expect(await enqueue(base, { store: { insertWorkItem } })).toEqual({
			enqueued: false,
			reason: "ya_visto",
		});
	});

	it("no encola para un workflow que no está en el registry", async () => {
		const insertWorkItem = vi.fn();
		expect(
			await enqueue(
				{ ...base, workflow: "no-existe" },
				{ store: { insertWorkItem } },
			),
		).toEqual({ enqueued: false, reason: "workflow_desconocido" });
		expect(insertWorkItem).not.toHaveBeenCalled();
	});

	it("no encola un sujeto del tipo equivocado para ese workflow", async () => {
		const insertWorkItem = vi.fn();
		expect(
			await enqueue(
				{ ...base, subjectType: "contact" },
				{ store: { insertWorkItem } },
			),
		).toEqual({ enqueued: false, reason: "sujeto_equivocado" });
		expect(insertWorkItem).not.toHaveBeenCalled();
	});
});
```

```ts
// tests/workflows/budget.test.ts
import { describe, expect, it, vi } from "vitest";
import { budgetStatus } from "@/lib/workflows/budget";

const TZ = "America/Argentina/Buenos_Aires";
// 01:30 UTC del 22 = 22:30 del 21 en Buenos Aires: todavía es "hoy 21" allá.
const now = () => new Date("2026-09-22T01:30:00Z");

describe("budgetStatus", () => {
	it("suma desde la medianoche del tenant, no desde la de UTC", async () => {
		const usageSince = vi.fn(async () => 1.25);
		const dailyLimit = vi.fn(async () => 5);

		const [status] = await budgetStatus(
			{ tenantId: "t1", resources: ["model_usd"], timezone: TZ },
			{ store: { usageSince, dailyLimit }, now },
		);

		// Medianoche del 21 en Buenos Aires (UTC-3) = 03:00 UTC del 21.
		expect(usageSince).toHaveBeenCalledWith(
			"t1",
			"model_usd",
			new Date("2026-09-21T03:00:00Z"),
		);
		expect(status).toEqual({
			resource: "model_usd",
			spent: 1.25,
			limit: 5,
			exhausted: false,
		});
	});

	it("gastado igual al límite ya es agotado", async () => {
		const [status] = await budgetStatus(
			{ tenantId: "t1", resources: ["model_usd"], timezone: TZ },
			{
				store: { usageSince: async () => 5, dailyLimit: async () => 5 },
				now,
			},
		);
		expect(status.exhausted).toBe(true);
	});

	it("sin presupuesto cargado el límite es cero: nada desatendido gasta sin permiso", async () => {
		const [status] = await budgetStatus(
			{ tenantId: "t1", resources: ["model_usd"], timezone: TZ },
			{
				store: { usageSince: async () => 0, dailyLimit: async () => 0 },
				now,
			},
		);
		expect(status).toMatchObject({ limit: 0, exhausted: true });
	});

	it("revisa cada recurso que el workflow gasta", async () => {
		const statuses = await budgetStatus(
			{
				tenantId: "t1",
				resources: ["model_usd", "apollo_credits"],
				timezone: TZ,
			},
			{
				store: {
					usageSince: async (_t, resource) =>
						resource === "apollo_credits" ? 100 : 0,
					dailyLimit: async () => 50,
				},
				now,
			},
		);
		expect(statuses.map((s) => [s.resource, s.exhausted])).toEqual([
			["model_usd", false],
			["apollo_credits", true],
		]);
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/workflows/enqueue.test.ts tests/workflows/budget.test.ts`
Esperado: FALLAN con módulos inexistentes.

- [ ] **Step 3: Implementar**

```ts
// lib/workflows/enqueue.ts
// La única forma de crear una arista del grafo (spec orquestación §6.2, D8).
// Sin triggers: quién encola qué se lee acá y en el registry.
import { isWorkflow, WORKFLOWS } from "./registry";

export interface EnqueueStore {
	/** Un 23505 sobre el índice único devuelve "ya_visto", no tira. */
	insertWorkItem(row: {
		tenantId: string;
		workflow: string;
		subjectType: string;
		subjectId: string;
		inputHash: string;
	}): Promise<"inserted" | "ya_visto">;
}

export type EnqueueResult =
	| { enqueued: true }
	| {
			enqueued: false;
			reason: "ya_visto" | "workflow_desconocido" | "sujeto_equivocado";
	  };

export async function enqueue(
	input: {
		tenantId: string;
		workflow: string;
		subjectType: string;
		subjectId: string;
		inputHash: string;
	},
	deps: { store: EnqueueStore },
): Promise<EnqueueResult> {
	if (!isWorkflow(input.workflow)) {
		return { enqueued: false, reason: "workflow_desconocido" };
	}
	if (WORKFLOWS[input.workflow].subjectType !== input.subjectType) {
		return { enqueued: false, reason: "sujeto_equivocado" };
	}
	const result = await deps.store.insertWorkItem(input);
	return result === "inserted"
		? { enqueued: true }
		: { enqueued: false, reason: "ya_visto" };
}
```

```ts
// lib/workflows/budget.ts
// Presupuesto diario por tenant y por recurso (spec orquestación §7.2). La
// suma incluye todo el consumo del día, venga del chat o de un workflow; pero
// solo el runner se corta con esto.
import { dayStart } from "../outreach/time";

export interface BudgetStore {
	usageSince(
		tenantId: string,
		resource: string,
		since: Date,
		runId?: string,
	): Promise<number>;
	/** Sin fila en tenant_budgets devuelve 0. */
	dailyLimit(tenantId: string, resource: string): Promise<number>;
}

export interface BudgetStatus {
	resource: string;
	spent: number;
	limit: number;
	exhausted: boolean;
}

export async function budgetStatus(
	input: { tenantId: string; resources: readonly string[]; timezone: string },
	deps: { store: BudgetStore; now: () => Date },
): Promise<BudgetStatus[]> {
	const since = dayStart(input.timezone, deps.now());
	return Promise.all(
		input.resources.map(async (resource) => {
			const [spent, limit] = await Promise.all([
				deps.store.usageSince(input.tenantId, resource, since),
				deps.store.dailyLimit(input.tenantId, resource),
			]);
			return { resource, spent, limit, exhausted: spent >= limit };
		}),
	);
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/workflows/enqueue.test.ts tests/workflows/budget.test.ts`
Esperado: PASAN (4 + 4).

- [ ] **Step 5: Commit**

```bash
git add lib/workflows/enqueue.ts lib/workflows/budget.ts tests/workflows/enqueue.test.ts tests/workflows/budget.test.ts
git commit -m "feat: enqueue como única forma de crear aristas, y presupuesto diario"
```

---

### Task 13: El runner

El corazón de la etapa. Una función: una pasada de un workflow para un tenant.

**Files:**
- Create: `lib/workflows/runner.ts`
- Test: `tests/workflows/runner.test.ts`
- Test helper: `tests/workflows/fake-workflow-store.ts`

**Interfaces:**
- Consumes: `WorkItem`, `ItemOutcome`, `MAX_ATTEMPTS` (Task 10); `NODES`, `WORKFLOWS`, `downstreamOf` (Task 10); `TenantWorkflowConfig` (Task 11); `enqueue`, `EnqueueStore`, `budgetStatus`, `BudgetStore` (Task 12).
- Produces:

```ts
export interface RunnerStore extends EnqueueStore, BudgetStore {
	openRun(row: { tenantId: string; agent: string; workflow: string; startedAt: Date }): Promise<string>;
	closeRun(runId: string, patch: {
		status: "ok" | "failed" | "budget_exhausted"; error: string | null;
		claimed: number; ok: number; refused: number; failed: number; finishedAt: Date;
	}): Promise<void>;
	claim(tenantId: string, workflow: string, limit: number, leaseSeconds: number): Promise<WorkItem[]>;
	finishItem(id: number, patch: { status: "done" | "refused"; resultReason: string | null; runId: string }): Promise<void>;
	retryItem(id: number, patch: { nextAttemptAt: Date; lastError: string; runId: string }): Promise<void>;
	failItem(id: number, patch: { lastError: string; runId: string }): Promise<void>;
	touchLastRun(tenantId: string, workflow: string, at: Date): Promise<void>;
	enabledWorkflows(tenantId: string): Promise<ReadonlySet<string>>;
	nodePolicy(tenantId: string, node: string): Promise<"always" | "once" | "auto">;
}

export interface PassContext {
	tenantId: string; runId: string; workflow: string;
	optionalNodes: ReadonlySet<string>;
	/** Entrega la implementación de un nodo, o tira si el workflow no puede usarlo. */
	useNode<T>(name: string): Promise<T>;
}

export interface WorkflowImpl {
	seed?(tenantId: string, now: Date): Promise<{ subjectId: string; inputHash: string }[]>;
	runItem(item: WorkItem, ctx: PassContext): Promise<ItemOutcome>;
}

export interface PassResult {
	status: "ok" | "failed" | "budget_exhausted";
	claimed: number; ok: number; refused: number; failed: number;
	stoppedBy: "sin_trabajo" | "tope_items" | "tope_costo" | "reloj" | "presupuesto";
}

export function runWorkflowPass(
	input: { tenant: { id: string; timezone: string }; workflow: string; config: TenantWorkflowConfig },
	deps: {
		store: RunnerStore; impl: WorkflowImpl; nodes: Record<string, unknown>;
		now: () => Date; clockBudgetMs: number; leaseSeconds: number;
	},
): Promise<PassResult>;

export const RETRY_DELAYS_MINUTES: readonly number[]; // [5, 30]
```

- [ ] **Step 1: El store falso para los tests**

```ts
// tests/workflows/fake-workflow-store.ts
import type { RunnerStore } from "@/lib/workflows/runner";
import type { WorkItem } from "@/lib/workflows/types";

export interface FakeItem extends WorkItem {
	status: "pending" | "running" | "done" | "refused" | "failed";
	nextAttemptAt: Date;
	lastError: string | null;
	resultReason: string | null;
}

export interface FakeWorkflowStore extends RunnerStore {
	items: FakeItem[];
	runs: Array<Record<string, unknown>>;
	spent: Map<string, number>;
	limits: Map<string, number>;
	runSpent: number;
	enabled: Set<string>;
	policies: Map<string, "always" | "once" | "auto">;
	lastRun: Date | null;
	add(subjectId: string, workflow?: string, inputHash?: string): FakeItem;
}

export function createFakeWorkflowStore(now: () => Date): FakeWorkflowStore {
	let nextId = 0;
	const store: FakeWorkflowStore = {
		items: [],
		runs: [],
		spent: new Map(),
		limits: new Map([["model_usd", 100]]),
		runSpent: 0,
		enabled: new Set(["refresh-fichas"]),
		policies: new Map(),
		lastRun: null,

		add(subjectId, workflow = "refresh-fichas", inputHash = "h1") {
			const item: FakeItem = {
				id: ++nextId,
				tenantId: "t1",
				workflow,
				subjectType: "account",
				subjectId,
				inputHash,
				attempts: 0,
				status: "pending",
				nextAttemptAt: now(),
				lastError: null,
				resultReason: null,
			};
			store.items.push(item);
			return item;
		},

		async insertWorkItem(row) {
			const dup = store.items.some(
				(i) =>
					i.tenantId === row.tenantId &&
					i.workflow === row.workflow &&
					i.subjectId === row.subjectId &&
					i.inputHash === row.inputHash,
			);
			if (dup) return "ya_visto";
			const item = store.add(row.subjectId, row.workflow, row.inputHash);
			item.tenantId = row.tenantId;
			return "inserted";
		},

		async usageSince(_tenantId, resource, _since, runId) {
			return runId ? store.runSpent : (store.spent.get(resource) ?? 0);
		},
		async dailyLimit(_tenantId, resource) {
			return store.limits.get(resource) ?? 0;
		},

		async openRun(row) {
			store.runs.push({ ...row, id: `run-${store.runs.length + 1}` });
			return `run-${store.runs.length}`;
		},
		async closeRun(runId, patch) {
			const run = store.runs.find((r) => r.id === runId);
			if (run) Object.assign(run, patch);
		},

		async claim(tenantId, workflow, limit) {
			const due = store.items
				.filter(
					(i) =>
						i.tenantId === tenantId &&
						i.workflow === workflow &&
						i.status === "pending" &&
						i.attempts < 3 &&
						i.nextAttemptAt.getTime() <= now().getTime(),
				)
				.slice(0, limit);
			for (const item of due) {
				item.status = "running";
				item.attempts += 1;
			}
			return due.map((i) => ({ ...i }));
		},
		async finishItem(id, patch) {
			const item = store.items.find((i) => i.id === id);
			if (!item) return;
			item.status = patch.status;
			item.resultReason = patch.resultReason;
		},
		async retryItem(id, patch) {
			const item = store.items.find((i) => i.id === id);
			if (!item) return;
			item.status = "pending";
			item.nextAttemptAt = patch.nextAttemptAt;
			item.lastError = patch.lastError;
		},
		async failItem(id, patch) {
			const item = store.items.find((i) => i.id === id);
			if (!item) return;
			item.status = "failed";
			item.lastError = patch.lastError;
		},
		async touchLastRun(_tenantId, _workflow, at) {
			store.lastRun = at;
		},
		async enabledWorkflows() {
			return store.enabled;
		},
		async nodePolicy(_tenantId, node) {
			return store.policies.get(node) ?? "always";
		},
	};
	return store;
}
```

- [ ] **Step 2: Test que falla**

```ts
// tests/workflows/runner.test.ts
import { describe, expect, it, vi } from "vitest";
import type { TenantWorkflowConfig } from "@/lib/workflows/config";
import {
	RETRY_DELAYS_MINUTES,
	runWorkflowPass,
	type WorkflowImpl,
} from "@/lib/workflows/runner";
import { createFakeWorkflowStore } from "./fake-workflow-store";

const NOW = new Date("2026-09-21T12:00:00Z");
const now = () => NOW;
const tenant = { id: "t1", timezone: "America/Argentina/Buenos_Aires" };
const config: TenantWorkflowConfig = {
	cadenceMinutes: 60,
	itemsPerTick: 5,
	optionalNodes: new Set(),
	params: {},
};
const okImpl: WorkflowImpl = { runItem: async () => ({ ok: true }) };

function pass(
	store: ReturnType<typeof createFakeWorkflowStore>,
	impl: WorkflowImpl,
	overrides: Partial<{
		config: TenantWorkflowConfig;
		nodes: Record<string, unknown>;
		now: () => Date;
		clockBudgetMs: number;
	}> = {},
) {
	return runWorkflowPass(
		{
			tenant,
			workflow: "refresh-fichas",
			config: overrides.config ?? config,
		},
		{
			store,
			impl,
			nodes: overrides.nodes ?? {},
			now: overrides.now ?? now,
			clockBudgetMs: overrides.clockBudgetMs ?? 200_000,
			leaseSeconds: 600,
		},
	);
}

describe("runWorkflowPass", () => {
	it("procesa lo pendiente, deja la cuenta cerrada y marca la última corrida", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		store.add("acc-2");

		const result = await pass(store, okImpl);

		expect(result).toEqual({
			status: "ok",
			claimed: 2,
			ok: 2,
			refused: 0,
			failed: 0,
			stoppedBy: "sin_trabajo",
		});
		expect(store.items.map((i) => i.status)).toEqual(["done", "done"]);
		expect(store.runs[0]).toMatchObject({
			workflow: "refresh-fichas",
			status: "ok",
			claimed: 2,
			ok: 2,
		});
		expect(store.lastRun).toEqual(NOW);
	});

	it("un rechazo es respuesta de negocio: queda refused y no se reintenta", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");

		const result = await pass(store, {
			runItem: async () => ({
				ok: false,
				reason: "sin_ancla",
				message: "no hay hechos con fuente",
			}),
		});

		expect(result).toMatchObject({ refused: 1, ok: 0, failed: 0 });
		expect(store.items[0]).toMatchObject({
			status: "refused",
			resultReason: "sin_ancla",
		});
	});

	it("un ítem que explota no frena al resto, y vuelve a pending con espera", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-rota");
		store.add("acc-sana");

		const result = await pass(store, {
			runItem: async (item) => {
				if (item.subjectId === "acc-rota") throw new Error("gateway caído");
				return { ok: true };
			},
		});

		expect(result).toMatchObject({ claimed: 2, ok: 1, failed: 1 });
		const rota = store.items[0];
		expect(rota.status).toBe("pending");
		expect(rota.lastError).toBe("gateway caído");
		expect(rota.nextAttemptAt.getTime()).toBe(
			NOW.getTime() + RETRY_DELAYS_MINUTES[0] * 60_000,
		);
		expect(store.items[1].status).toBe("done");
	});

	it("al tercer intento fallido queda failed, visible, y no vuelve a la cola", async () => {
		const store = createFakeWorkflowStore(now);
		const item = store.add("acc-rota");
		item.attempts = 2;

		await pass(store, {
			runItem: async () => {
				throw new Error("sigue caído");
			},
		});

		expect(store.items[0]).toMatchObject({
			status: "failed",
			lastError: "sigue caído",
			attempts: 3,
		});
	});

	it("con el presupuesto agotado no reclama nada y no pierde ningún ítem", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		store.limits.set("model_usd", 0);
		const runItem = vi.fn(async () => ({ ok: true as const }));

		const result = await pass(store, { runItem });

		expect(result).toMatchObject({
			status: "budget_exhausted",
			claimed: 0,
			stoppedBy: "presupuesto",
		});
		expect(runItem).not.toHaveBeenCalled();
		expect(store.items[0]).toMatchObject({ status: "pending", attempts: 0 });
		expect(store.runs[0]).toMatchObject({ status: "budget_exhausted" });
	});

	it("corta al llegar al tope de ítems por tick", async () => {
		const store = createFakeWorkflowStore(now);
		for (let i = 0; i < 4; i++) store.add(`acc-${i}`);

		const result = await pass(store, okImpl, {
			config: { ...config, itemsPerTick: 2 },
		});

		expect(result).toMatchObject({ claimed: 2, stoppedBy: "tope_items" });
		expect(store.items.filter((i) => i.status === "pending")).toHaveLength(2);
	});

	it("corta cuando la pasada supera su tope de costo", async () => {
		const store = createFakeWorkflowStore(now);
		for (let i = 0; i < 3; i++) store.add(`acc-${i}`);

		const result = await pass(store, {
			runItem: async () => {
				store.runSpent += 0.6; // tope de refresh-fichas: 1 USD por pasada
				return { ok: true };
			},
		});

		expect(result).toMatchObject({ claimed: 2, stoppedBy: "tope_costo" });
		expect(store.items[2].status).toBe("pending");
	});

	it("corta cuando se le acaba el reloj, sin dejar ítems tomados", async () => {
		const store = createFakeWorkflowStore(now);
		for (let i = 0; i < 3; i++) store.add(`acc-${i}`);
		let t = NOW.getTime();
		const clock = () => new Date(t);

		const result = await pass(
			store,
			{
				runItem: async () => {
					t += 150_000;
					return { ok: true };
				},
			},
			{ now: clock, clockBudgetMs: 200_000 },
		);

		expect(result).toMatchObject({ claimed: 2, stoppedBy: "reloj" });
		expect(store.items.filter((i) => i.status === "running")).toHaveLength(0);
	});

	it("siembra antes de reclamar, y sembrar lo ya visto no duplica", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1", "refresh-fichas", "h-vencida");
		const seed = vi.fn(async () => [
			{ subjectId: "acc-1", inputHash: "h-vencida" },
			{ subjectId: "acc-2", inputHash: "h-vencida" },
		]);

		const result = await pass(store, { ...okImpl, seed });

		expect(seed).toHaveBeenCalledWith("t1", NOW);
		expect(store.items).toHaveLength(2);
		expect(result.claimed).toBe(2);
	});

	it("useNode entrega un nodo que el workflow declara", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		const research = vi.fn();

		await pass(
			store,
			{
				runItem: async (_item, ctx) => {
					const node = await ctx.useNode<typeof research>("outreach/research");
					node();
					return { ok: true };
				},
			},
			{ nodes: { "outreach/research": research } },
		);

		expect(research).toHaveBeenCalled();
	});

	it("useNode se niega a entregar un nodo que el workflow no declara", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");

		await pass(
			store,
			{
				runItem: async (_item, ctx) => {
					await ctx.useNode("outreach/send");
					return { ok: true };
				},
			},
			{ nodes: { "outreach/send": vi.fn() } },
		);

		expect(store.items[0].status).toBe("pending");
		expect(store.items[0].lastError).toContain("no declara el nodo");
	});

	it("si falla abrir la corrida, tira: sin fila en runs no hay pasada", async () => {
		const store = createFakeWorkflowStore(now);
		store.openRun = async () => {
			throw new Error("db caída");
		};
		await expect(pass(store, okImpl)).rejects.toThrow("db caída");
	});
});
```

- [ ] **Step 3: Correr y ver fallar**

Run: `npx vitest run tests/workflows/runner.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 4: Implementar el runner**

```ts
// lib/workflows/runner.ts
// Una pasada de un workflow para un tenant (spec orquestación §5.2 y §6.5).
// Función pura con dependencias inyectadas: el schedule dispatch.ts es una
// puerta fina que le arma las reales. Acá itera el código, nunca el modelo.
import { type BudgetStore, budgetStatus } from "./budget";
import type { TenantWorkflowConfig } from "./config";
import { type EnqueueStore, enqueue } from "./enqueue";
import { downstreamOf, NODES, WORKFLOWS } from "./registry";
import { type ItemOutcome, MAX_ATTEMPTS, type WorkItem } from "./types";

/** Espera antes del reintento N+1. Al tercer fallo no hay reintento: failed. */
export const RETRY_DELAYS_MINUTES: readonly number[] = [5, 30];

export interface RunnerStore extends EnqueueStore, BudgetStore {
	openRun(row: {
		tenantId: string;
		agent: string;
		workflow: string;
		startedAt: Date;
	}): Promise<string>;
	closeRun(
		runId: string,
		patch: {
			status: "ok" | "failed" | "budget_exhausted";
			error: string | null;
			claimed: number;
			ok: number;
			refused: number;
			failed: number;
			finishedAt: Date;
		},
	): Promise<void>;
	claim(
		tenantId: string,
		workflow: string,
		limit: number,
		leaseSeconds: number,
	): Promise<WorkItem[]>;
	finishItem(
		id: number,
		patch: {
			status: "done" | "refused";
			resultReason: string | null;
			runId: string;
		},
	): Promise<void>;
	retryItem(
		id: number,
		patch: { nextAttemptAt: Date; lastError: string; runId: string },
	): Promise<void>;
	failItem(
		id: number,
		patch: { lastError: string; runId: string },
	): Promise<void>;
	touchLastRun(tenantId: string, workflow: string, at: Date): Promise<void>;
	enabledWorkflows(tenantId: string): Promise<ReadonlySet<string>>;
	nodePolicy(
		tenantId: string,
		node: string,
	): Promise<"always" | "once" | "auto">;
}

export interface PassContext {
	tenantId: string;
	runId: string;
	workflow: string;
	optionalNodes: ReadonlySet<string>;
	/** Entrega la implementación de un nodo, o tira si el workflow no puede usarlo. */
	useNode<T>(name: string): Promise<T>;
}

export interface WorkflowImpl {
	/** Trabajo que nace del paso del tiempo y no de un evento (spec §6.2). */
	seed?(
		tenantId: string,
		now: Date,
	): Promise<{ subjectId: string; inputHash: string }[]>;
	runItem(item: WorkItem, ctx: PassContext): Promise<ItemOutcome>;
}

export interface PassResult {
	status: "ok" | "failed" | "budget_exhausted";
	claimed: number;
	ok: number;
	refused: number;
	failed: number;
	stoppedBy:
		| "sin_trabajo"
		| "tope_items"
		| "tope_costo"
		| "reloj"
		| "presupuesto";
}

function errorText(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.slice(0, 2000);
}

export async function runWorkflowPass(
	input: {
		tenant: { id: string; timezone: string };
		workflow: string;
		config: TenantWorkflowConfig;
	},
	deps: {
		store: RunnerStore;
		impl: WorkflowImpl;
		nodes: Record<string, unknown>;
		now: () => Date;
		clockBudgetMs: number;
		leaseSeconds: number;
	},
): Promise<PassResult> {
	const { store } = deps;
	const info = WORKFLOWS[input.workflow];
	const tenantId = input.tenant.id;
	const startedAt = deps.now();

	// Si esto tira, tira la pasada: sin fila en runs no hay forma de contar
	// nada, y es preferible un error ruidoso a trabajo invisible.
	const runId = await store.openRun({
		tenantId,
		agent: info.agent,
		workflow: input.workflow,
		startedAt,
	});

	const counts = { claimed: 0, ok: 0, refused: 0, failed: 0 };
	const close = async (
		status: PassResult["status"],
		stoppedBy: PassResult["stoppedBy"],
		error: string | null,
	): Promise<PassResult> => {
		const finishedAt = deps.now();
		await store.closeRun(runId, { status, error, ...counts, finishedAt });
		await store.touchLastRun(tenantId, input.workflow, finishedAt);
		return { status, ...counts, stoppedBy };
	};

	// Presupuesto antes de tocar nada: agotado, los ítems quedan intactos.
	const budgets = await budgetStatus(
		{
			tenantId,
			resources: info.resources,
			timezone: input.tenant.timezone,
		},
		{ store, now: deps.now },
	);
	const agotado = budgets.find((b) => b.exhausted);
	if (agotado) {
		return close(
			"budget_exhausted",
			"presupuesto",
			`${agotado.resource}: gastado ${agotado.spent} de ${agotado.limit}`,
		);
	}

	if (deps.impl.seed) {
		for (const seeded of await deps.impl.seed(tenantId, startedAt)) {
			await enqueue(
				{
					tenantId,
					workflow: input.workflow,
					subjectType: info.subjectType,
					...seeded,
				},
				{ store },
			);
		}
	}

	const allowed = new Set([
		...info.nodes,
		...info.optionalNodes.filter((n) => input.config.optionalNodes.has(n)),
	]);
	const ctx: PassContext = {
		tenantId,
		runId,
		workflow: input.workflow,
		optionalNodes: input.config.optionalNodes,
		async useNode<T>(name: string): Promise<T> {
			if (!allowed.has(name)) {
				throw new Error(`${input.workflow} no declara el nodo ${name}`);
			}
			const effect = NODES[name]?.effect ?? 3;
			// Defensa en profundidad: el test del registry ya lo impide en frío.
			if (effect === 3) {
				throw new Error(
					`${name} es nivel 3: un workflow desatendido no le llega a una persona`,
				);
			}
			if (effect === 2 && (await store.nodePolicy(tenantId, name)) !== "auto") {
				throw new Error(
					`${name} es nivel 2 y la política de este tenant no es auto`,
				);
			}
			if (!Object.hasOwn(deps.nodes, name)) {
				throw new Error(`falta la implementación del nodo ${name}`);
			}
			return deps.nodes[name] as T;
		},
	};

	const enabled = await store.enabledWorkflows(tenantId);
	let stoppedBy: PassResult["stoppedBy"] = "sin_trabajo";

	// De a uno: así un corte por reloj, costo o tope nunca deja ítems tomados
	// sin procesar. Al volumen de diseño (spec D4) el costo extra es nulo.
	for (;;) {
		if (counts.claimed >= input.config.itemsPerTick) {
			stoppedBy = "tope_items";
			break;
		}
		if (deps.now().getTime() - startedAt.getTime() >= deps.clockBudgetMs) {
			stoppedBy = "reloj";
			break;
		}
		if (info.caps.costUsdPerRun > 0) {
			const spent = await store.usageSince(
				tenantId,
				"model_usd",
				startedAt,
				runId,
			);
			if (spent >= info.caps.costUsdPerRun) {
				stoppedBy = "tope_costo";
				break;
			}
		}

		const [item] = await store.claim(
			tenantId,
			input.workflow,
			1,
			deps.leaseSeconds,
		);
		if (!item) break;
		counts.claimed++;

		try {
			const outcome = await deps.impl.runItem(item, ctx);
			if (outcome.ok) {
				await store.finishItem(item.id, {
					status: "done",
					resultReason: null,
					runId,
				});
				counts.ok++;
				for (const next of downstreamOf(info.produces)) {
					if (!enabled.has(next)) continue;
					await enqueue(
						{
							tenantId,
							workflow: next,
							subjectType: WORKFLOWS[next].subjectType,
							subjectId: item.subjectId,
							inputHash: outcome.downstreamHash ?? item.inputHash,
						},
						{ store },
					);
				}
			} else {
				await store.finishItem(item.id, {
					status: "refused",
					resultReason: outcome.reason,
					runId,
				});
				counts.refused++;
			}
		} catch (error) {
			counts.failed++;
			const lastError = errorText(error);
			if (item.attempts >= MAX_ATTEMPTS) {
				await store.failItem(item.id, { lastError, runId });
			} else {
				const delay =
					RETRY_DELAYS_MINUTES[item.attempts - 1] ??
					RETRY_DELAYS_MINUTES[RETRY_DELAYS_MINUTES.length - 1];
				await store.retryItem(item.id, {
					nextAttemptAt: new Date(deps.now().getTime() + delay * 60_000),
					lastError,
					runId,
				});
			}
		}
	}

	const cierra =
		counts.claimed === counts.ok + counts.refused + counts.failed;
	return close(
		"ok",
		stoppedBy,
		cierra
			? null
			: `la cuenta no cierra: ${counts.claimed} reclamados, ${counts.ok + counts.refused + counts.failed} resueltos`,
	);
}
```

- [ ] **Step 5: Correr y ver pasar**

Run: `npx vitest run tests/workflows/runner.test.ts`
Esperado: PASA (12 tests).

- [ ] **Step 6: Todo verde**

Run: `npm run typecheck && npm test`

- [ ] **Step 7: Commit**

```bash
git add lib/workflows/runner.ts tests/workflows/runner.test.ts tests/workflows/fake-workflow-store.ts
git commit -m "feat: runner de una pasada de workflow con topes, presupuesto y aislamiento de fallos"
```

---

### Task 14: `WorkflowStore` sobre Supabase, y la prueba de concurrencia real

**Files:**
- Create: `lib/workflows/store.ts`
- Test: `tests/workflows/store.it.test.ts`
- Modify: `package.json` (script `test:it:workflows`)

**Interfaces:**
- Consumes: `RunnerStore` (Task 13); las tablas y funciones de las Tasks 2, 8 y 9.
- Produces: `createSupabaseWorkflowStore(admin): RunnerStore & { listEnabled(tenantId): Promise<{ workflow: string; config: unknown; lastRunAt: string | null }[]> }`.

- [ ] **Step 1: Test de integración que falla**

Sigue el patrón de `tests/outreach/store.it.test.ts`: corre solo con una variable de entorno, contra la Supabase **local**.

```ts
// tests/workflows/store.it.test.ts
// Integración contra la Supabase local (npm run db:start). No corre en
// `npm test`: se dispara con `npm run test:it:workflows`. Es la prueba del
// criterio de cierre 6 de la spec: dos pasadas a la vez no procesan lo mismo.
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseWorkflowStore } from "@/lib/workflows/store";

const enabled = process.env.WORKFLOWS_IT === "1";
const TENANT = "aaaaaaaa-0000-0000-0000-0000000000f1";

describe.skipIf(!enabled)("WorkflowStore contra Postgres", () => {
	const admin = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
		process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
		{ auth: { persistSession: false } },
	);
	const store = createSupabaseWorkflowStore(admin);

	beforeAll(async () => {
		await admin.from("tenants").delete().eq("id", TENANT);
		const { error } = await admin
			.from("tenants")
			.insert({ id: TENANT, slug: "it-workflows", display_name: "IT" });
		if (error) throw new Error(error.message);
	});

	afterAll(async () => {
		await admin.from("tenants").delete().eq("id", TENANT);
	});

	it("insertWorkItem deduplica por huella", async () => {
		const row = {
			tenantId: TENANT,
			workflow: "refresh-fichas",
			subjectType: "account",
			subjectId: "cccccccc-0000-0000-0000-000000000001",
			inputHash: "h1",
		};
		expect(await store.insertWorkItem(row)).toBe("inserted");
		expect(await store.insertWorkItem(row)).toBe("ya_visto");
	});

	it("dos reclamos simultáneos nunca entregan el mismo ítem", async () => {
		for (let i = 2; i <= 9; i++) {
			await store.insertWorkItem({
				tenantId: TENANT,
				workflow: "refresh-fichas",
				subjectType: "account",
				subjectId: `cccccccc-0000-0000-0000-00000000000${i}`,
				inputHash: "h1",
			});
		}
		const [a, b] = await Promise.all([
			store.claim(TENANT, "refresh-fichas", 5, 60),
			store.claim(TENANT, "refresh-fichas", 5, 60),
		]);
		const ids = [...a, ...b].map((item) => item.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.length).toBe(9);
	});

	it("sin presupuesto cargado el límite es cero", async () => {
		expect(await store.dailyLimit(TENANT, "model_usd")).toBe(0);
	});

	it("abre y cierra una corrida con sus conteos", async () => {
		const runId = await store.openRun({
			tenantId: TENANT,
			agent: "outreach",
			workflow: "refresh-fichas",
			startedAt: new Date(),
		});
		await store.closeRun(runId, {
			status: "ok",
			error: null,
			claimed: 3,
			ok: 2,
			refused: 1,
			failed: 0,
			finishedAt: new Date(),
		});
		const { data } = await admin
			.from("runs")
			.select("workflow, status, items_claimed, items_ok, items_refused")
			.eq("id", runId)
			.single();
		expect(data).toEqual({
			workflow: "refresh-fichas",
			status: "ok",
			items_claimed: 3,
			items_ok: 2,
			items_refused: 1,
		});
	});
});
```

En `package.json`, junto a `test:it`:

```json
		"test:it:workflows": "WORKFLOWS_IT=1 node --env-file=.env.eval ./node_modules/vitest/vitest.mjs run tests/workflows/store.it.test.ts",
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run db:start && npm run db:reset && npm run test:it:workflows`
Esperado: FALLA con `Cannot find module '@/lib/workflows/store'`.

- [ ] **Step 3: Implementar el store**

```ts
// lib/workflows/store.ts
// WorkflowStore sobre Supabase, con el cliente admin (las tablas de
// orquestación no aceptan escritura de authenticated). Imports relativos.
import type { AdminLike } from "./usage";
import type { RunnerStore } from "./runner";
import type { WorkItem } from "./types";

type Row = Record<string, unknown>;
const UNIQUE_VIOLATION = "23505";

const toWorkItem = (r: Row): WorkItem => ({
	id: Number(r.id),
	tenantId: r.tenant_id as string,
	workflow: r.workflow as string,
	subjectType: r.subject_type as string,
	subjectId: r.subject_id as string,
	inputHash: r.input_hash as string,
	attempts: r.attempts as number,
});

function must(error: { message: string } | null, what: string): void {
	if (error) throw new Error(`${what}: ${error.message}`);
}

export interface EnabledWorkflowRow {
	workflow: string;
	config: unknown;
	lastRunAt: string | null;
}

export function createSupabaseWorkflowStore(
	// biome-ignore lint/suspicious/noExplicitAny: cliente de supabase-js; rpc no está en AdminLike
	admin: AdminLike & { rpc: (fn: string, args: Row) => any },
): RunnerStore & {
	listEnabled(tenantId: string): Promise<EnabledWorkflowRow[]>;
} {
	return {
		async insertWorkItem(row) {
			const { error } = await admin.from("work_items").insert({
				tenant_id: row.tenantId,
				workflow: row.workflow,
				subject_type: row.subjectType,
				subject_id: row.subjectId,
				input_hash: row.inputHash,
			});
			if (!error) return "inserted";
			if (error.code === UNIQUE_VIOLATION) return "ya_visto";
			throw new Error(`insertWorkItem: ${error.message}`);
		},

		async claim(tenantId, workflow, limit, leaseSeconds) {
			const { data, error } = await admin.rpc("claim_work_items", {
				p_tenant: tenantId,
				p_workflow: workflow,
				p_limit: limit,
				p_lease_seconds: leaseSeconds,
			});
			must(error, "claim_work_items");
			return ((data as Row[] | null) ?? []).map(toWorkItem);
		},

		async finishItem(id, patch) {
			const { error } = await admin
				.from("work_items")
				.update({
					status: patch.status,
					result_reason: patch.resultReason,
					run_id: patch.runId,
					lease_until: null,
					updated_at: new Date().toISOString(),
				})
				.eq("id", id);
			must(error, "finishItem");
		},

		async retryItem(id, patch) {
			const { error } = await admin
				.from("work_items")
				.update({
					status: "pending",
					next_attempt_at: patch.nextAttemptAt.toISOString(),
					last_error: patch.lastError,
					run_id: patch.runId,
					lease_until: null,
					updated_at: new Date().toISOString(),
				})
				.eq("id", id);
			must(error, "retryItem");
		},

		async failItem(id, patch) {
			const { error } = await admin
				.from("work_items")
				.update({
					status: "failed",
					last_error: patch.lastError,
					run_id: patch.runId,
					lease_until: null,
					updated_at: new Date().toISOString(),
				})
				.eq("id", id);
			must(error, "failItem");
		},

		async openRun(row) {
			const { data, error } = await admin
				.from("runs")
				.insert({
					tenant_id: row.tenantId,
					agent: row.agent,
					trigger: "schedule",
					// runs.eve_session_id es NOT NULL y una pasada no tiene sesión de
					// eve. Mismo recurso que el lock de la Etapa 5: un identificador propio.
					eve_session_id: `wf:${row.workflow}:${row.startedAt.toISOString()}:${crypto.randomUUID()}`,
					workflow: row.workflow,
					status: "running",
					started_at: row.startedAt.toISOString(),
				})
				.select("id")
				.single();
			must(error, "openRun");
			return (data as { id: string }).id;
		},

		async closeRun(runId, patch) {
			const { error } = await admin
				.from("runs")
				.update({
					status: patch.status,
					error: patch.error,
					items_claimed: patch.claimed,
					items_ok: patch.ok,
					items_refused: patch.refused,
					items_failed: patch.failed,
					finished_at: patch.finishedAt.toISOString(),
				})
				.eq("id", runId);
			must(error, "closeRun");
			const { error: costError } = await admin.rpc("set_run_cost", {
				p_run: runId,
			});
			if (costError) console.error("closeRun (costo):", costError.message);
		},

		async touchLastRun(tenantId, workflow, at) {
			const { error } = await admin
				.from("tenant_workflows")
				.update({ last_run_at: at.toISOString() })
				.eq("tenant_id", tenantId)
				.eq("workflow", workflow);
			must(error, "touchLastRun");
		},

		async usageSince(tenantId, resource, since, runId) {
			const { data, error } = await admin.rpc("usage_sum", {
				p_tenant: tenantId,
				p_resource: resource,
				p_since: since.toISOString(),
				p_run: runId ?? null,
			});
			must(error, "usage_sum");
			return Number(data ?? 0);
		},

		async dailyLimit(tenantId, resource) {
			const { data, error } = await admin
				.from("tenant_budgets")
				.select("daily_limit")
				.eq("tenant_id", tenantId)
				.eq("resource", resource)
				.maybeSingle();
			must(error, "dailyLimit");
			return Number((data as { daily_limit: unknown } | null)?.daily_limit ?? 0);
		},

		async enabledWorkflows(tenantId) {
			const rows = await this.listEnabled(tenantId);
			return new Set(rows.map((row) => row.workflow));
		},

		async nodePolicy(tenantId, node) {
			// Spec §7.3: tenant_agents.config.approvals, mapa nodo → política.
			// El agente dueño del nodo es su prefijo de dominio.
			const agent = node.split("/")[0];
			const { data, error } = await admin
				.from("tenant_agents")
				.select("config")
				.eq("tenant_id", tenantId)
				.eq("agent", agent)
				.maybeSingle();
			must(error, "nodePolicy");
			const approvals = (data as { config?: { approvals?: Row } } | null)
				?.config?.approvals;
			const policy = approvals?.[node];
			return policy === "auto" || policy === "once" ? policy : "always";
		},

		async listEnabled(tenantId) {
			const { data, error } = await admin
				.from("tenant_workflows")
				.select("workflow, config, last_run_at")
				.eq("tenant_id", tenantId)
				.eq("enabled", true);
			must(error, "listEnabled");
			return ((data as Row[] | null) ?? []).map((r) => ({
				workflow: r.workflow as string,
				config: r.config,
				lastRunAt: (r.last_run_at as string | null) ?? null,
			}));
		},
	};
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run test:it:workflows`
Esperado: PASA (4 tests). El de reclamos simultáneos es el que prueba `for update skip locked` de verdad: si fallara por ids repetidos, el problema está en `claim_work_items`, no en el store.

- [ ] **Step 5: Todo verde**

Run: `npm run typecheck && npm test && npm run db:test`

- [ ] **Step 6: Commit**

```bash
git add lib/workflows/store.ts tests/workflows/store.it.test.ts package.json
git commit -m "feat: WorkflowStore sobre Supabase y prueba de reclamo concurrente"
```

**E2 cerrada.** Los rieles existen y están probados; nada corre en producción todavía. PR con `/ship`.

---

# Entrega 3 · Primer workflow — alcance e interfaces

**Detallada tarea por tarea en `docs/superpowers/plans/2026-09-21-etapa-12-e3-refresh-fichas.md` (Tasks 15 a 23).** Ese plan manda: donde difiere de lo que sigue (por ejemplo, el reloj es del tick y no de la pasada, y el sembrador pregunta a una función SQL), la versión detallada es la vigente. Lo que quedó fijado al cerrar la E2:

**Archivos**

| Archivo | Responsabilidad |
|---|---|
| `lib/outreach/services/research.ts` | Suma `researchAccount(input, deps)`: la composición `prepareResearch → runResearch → saveResearch` que hoy vive en la tool. Es el nodo `outreach/research` |
| `lib/outreach/services/generate-research.ts` | `generateResearch`, mudado desde la tool (spec §9.4). Entra en `SERVICES_EXCLUIDOS` con su motivo |
| `agents/outreach/tools/research_account.ts` | Queda como puerta: arma `caller`, arma deps, llama a `researchAccount` |
| `lib/outreach/workflows/refresh-fichas.ts` | `WorkflowImpl`: `seed` lista cuentas con `expires_at <= now`; `runItem` llama al nodo vía `ctx.useNode` |
| `lib/outreach/store.ts` | Suma `listExpiredAccounts(tenantId, now, limit)` y `findAccountById(tenantId, id)` |
| `lib/workflows/dispatch.ts` | `runDispatch(deps)`: recorre tenants y workflows prendidos, valida config, chequea cadencia, llama a `runWorkflowPass`. Un tenant o un workflow que explota no frena al resto |
| `agents/outreach/schedules/dispatch.ts` | Puerta: `cron: "*/5 * * * *"`, arma deps reales, llama a `runDispatch` |
| `lib/outreach/summary.ts` | Suma los tres avisos de la spec §10.4 y "workflow prendido sin pasadas en 24 h" |
| `scripts/workflows-set.mts` | Prende un workflow y carga un presupuesto por tenant, con `--apply` como `outreach:config` |

**Interfaces que E3 consume de E2, tal como quedaron en este plan:** `runWorkflowPass`, `WorkflowImpl`, `PassContext.useNode`, `createSupabaseWorkflowStore(...).listEnabled`, `parseTenantWorkflowConfig`, `isDue`, `metered` + `createUsageRecorder` con `base.workflow = "refresh-fichas"` y `base.runId = ctx.runId`.

**Decisiones ya tomadas**

- `input_hash` de `refresh-fichas` = `${domain}:${expiresAt}` de la ficha que se reemplaza (spec §6.3).
- El `actor_user_id` del evento `investigado` que escribe `saveResearch` es `null` cuando corre desatendido: `saveResearch` hoy exige `userId: string`, hay que aflojarlo a `string | null`.
- El modelo sale de `tenant.config.models.researcher`, igual que en la tool.
- `clockBudgetMs: 200_000` y `leaseSeconds: 600` — confirmados por el spike S2 (spec §13): el timeout real de función en Vercel es 300 s, así que el presupuesto deja 100 s de margen y el lease dobla el techo. No son punto de partida, son el valor a usar.
- El dispatcher **no** toma lock global (spec §6.5): el lease da exclusión por ítem.
- El dispatcher abre su propia pasada por cada `(tenant, workflow)`; no hay fila de `runs` para el tick en sí.

**Criterio de cierre:** los puntos 1 a 8 de la spec §2, contra producción. Verificar que el cron aparece en Vercel → Settings → Cron Jobs (antecedente: una tool mergeada que nunca apareció en el agente deployado).

# Entrega 4 · La ley — alcance

Se escribe contra el código ya mergeado (spec D14).

- `docs/02-orquestacion.md`: la escalera (spec §4), los contratos (§5), la escala de efectos (§7), anclas y reglas congeladas (§8), y una receta paso a paso de "cómo agregar un nodo" y "cómo agregar un workflow" con los nombres de archivo reales que dejaron E1 a E3. Corto, sin historia; apunta a la spec para el porqué.
- `CLAUDE.md`: el bloque de la spec §12, reemplazando la línea *"Toda tool con efecto externo lleva `approval` explícito"*.
- `docs/01-roadmap-etapas.md`: aplicar el delta de la spec §14 como commit aparte.
- `docs/innovas-agents-kickoff.md`: las enmiendas de la spec §14.4.

---

## Auto-revisión del plan

**Cobertura de la spec (E1 y E2):**

| Spec | Task |
|---|---|
| §7.2 `usage_entries`, append-only, costo interno invisible | 2 |
| §7.2 `runs.cost_usd` escrito | 2, 6 |
| §13 S1 | 1, 3 (soporta los dos resultados) |
| §5.1 punto 9, "si gasta, asienta" | 3, 4, 5, 6 (test contra el disco) |
| §9.4 `generateDraft` a `lib/` | 4 |
| §6.1 `work_items` · §6.4 reclamo con lease y agotados | 8 |
| §10.1 `tenant_workflows` · §10.2 `tenant_budgets` · §6.6 `runs` | 9 |
| §9.1 registry · §9.3 tests 1, 2, 3, 5 | 10 |
| §9.3 test 4 · §10.1 nodos opcionales con ruido | 11 |
| §6.2 `enqueue()` · §7.2 presupuesto por zona horaria del tenant | 12 |
| §5.2 contrato del workflow, los 7 puntos · §11 errores | 13 |
| §2 criterio 6, dos pasadas a la vez | 8 (semántica), 14 (concurrencia real) |
| §7.3 política de nivel 2 por tenant | 13 (`useNode`), 14 (`nodePolicy`) |

**Desvíos respecto de la primera versión de la spec, ya corregidos en ella en el mismo commit que este plan:**

1. `usage_entries.id` y `work_items.id` son `bigint identity`, no `uuid` (regla de PK de `supabase-postgres-best-practices`; mismo criterio que `events`).
2. La medición se engancha en la puerta con `metered()`, no adentro del servicio. Los servicios no conocen el libro de consumo, y `tests/workflows/model-calls.test.ts` obliga.
3. La spec §7.2 lista tres nodos que llaman al modelo; en el código son tres **puertas** (`draft_message`, `research_account`, `schedules/followups`). La clasificación de respuestas la hace el agente en sesión, no una llamada propia: no hay nada que medir ahí más allá del turno.
4. `WorkflowInfo` suma `resources` y `entry`, que la spec §9.1 no tenía.

**Consistencia de tipos:** `WorkItem.id` es `number` en types, store falso, store real y runner. `RunnerStore` extiende `EnqueueStore` y `BudgetStore`, así que `enqueue` y `budgetStatus` reciben el mismo objeto. `TenantWorkflowConfig.optionalNodes` es `ReadonlySet<string>` en config, runner y tests. `RecordUsage` y `UsageEntry` son los mismos en `usage.ts`, las tools y el plan de E3.
