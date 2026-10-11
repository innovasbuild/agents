# Etapa 21.4a: empresa sin agentes y código por correo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una empresa sin agentes se pueda dar de alta, entrar con un código de 6 dígitos y trabajar en su brain sin ver nada de outreach.

**Architecture:** El catálogo de agentes pasa a decir qué agente tiene chat; una función pura decide el aterrizaje y otra filtra el menú por agente habilitado. Un helper cacheado lee los agentes habilitados una vez por request y cierra con 404 las pantallas de un agente que no está. El alta, el brain y el contrato MCP dejan de asumir outreach. El login por correo suma `verifyOtp` sobre el mismo `signInWithOtp`, y el tramo "unir membresías + compuerta" se comparte entre link y código.

**Tech Stack:** Next.js App Router (server components y server actions), Supabase (Postgres, Auth, pgTAP), Zod 4, Vitest (entorno `node`, componentes con `renderToStaticMarkup`), Biome.

**Spec:** `docs/superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md` (§3 a §10). La 21.4b (alta de Lagomarsino, §11) tiene su propio plan.

## Global Constraints

- Rama `feat/etapa-21-4-segundo-tenant`. Identidad git local `innovasbuild` / `matias@innov.as`.
- Nada específico de un tenant en código: ningún `lagomarsino` ni `innovas` en `app/`, `lib/` ni `agents/`.
- La consola y el tenant nunca nombran `outreach` para decidir aterrizaje, siembra o textos del brain: preguntan al catálogo (`lib/agents/catalog.ts`). Las pantallas propias de outreach sí lo nombran en su guard.
- Español rioplatense en UI y mensajes. Código e identificadores en inglés.
- Antes de tocar SQL, cargar la skill `supabase-postgres-best-practices`. `events` es append-only.
- Una sola migración: `supabase/migrations/20261019120000_agentless_tenant.sql`. Las funciones `platform_*` siguen el patrón de la 21.1: `security definer`, `set search_path = ''`, `p_actor` obligatorio, `execute` solo para `service_role`, errores para la persona con `hint = 'consola'`. Que quien llama sea `platform_admin` lo verifica la server action con `requirePlatformAdmin()`.
- Todo `async` con `try/catch` o con el `{ error }` de Supabase leído. Componentes funcionales.
- Después de cada tarea: `npm run typecheck` y `npm test`. `npm run lint:fix` reformatea siempre cuatro archivos ajenos: revertirlos con `git checkout -- <archivo>` antes de commitear.
- Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:` y la línea final `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Base local: `npm run db:start`, `npm run db:reset`, `npm run db:test`, `npm run db:types` (Docker abierto).

## Review Focus

1. **Falla al leer los agentes habilitados.** Si la consulta a `tenant_agents` falla, una empresa con outreach no puede quedarse sin menú ni con todo en 404: se muestra todo y se deja pasar. Test en Task 2.
2. **Empresa sin brain y sin agentes.** El aterrizaje no puede ser un loop ni un 404: va a `/conectar`. Test en Task 1.
3. **Código equivocado, vencido o de otro correo.** La pantalla muestra un solo mensaje y deja pedir otro; no abre sesión ni revela si el correo existe. Test en Task 8.
4. **Método `email` no permitido por la empresa.** Un código válido de alguien cuya empresa solo acepta Microsoft cierra la sesión y manda a la landing, igual que el link. Test en Task 8.
5. **Categorías con espacios, mayúsculas o repetidas.** La consola normaliza (trim, minúsculas, sin repetidas) antes de mandar, y la base rechaza lo que no cumple el patrón. Tests en Task 3 y Task 7.

---

### Task 1: El catálogo dice qué agente tiene chat y `tenantHome` decide el aterrizaje

**Files:**
- Modify: `lib/agents/catalog.ts`
- Create: `lib/tenants/home.ts`
- Test: `tests/tenants/home.test.ts`, `tests/agents/catalog.test.ts`

**Interfaces:**
- Produces: `AgentCatalogEntry.chat: boolean`; `tenantHome(input: { enabledAgents: readonly string[]; brain: boolean }): "/chat" | "/brain" | "/conectar"`.

- [ ] **Step 1: Test que falla**

`tests/tenants/home.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tenantHome } from "@/lib/tenants/home";

describe("tenantHome", () => {
	it("con un agente con chat habilitado, va al chat", () => {
		expect(tenantHome({ enabledAgents: ["outreach"], brain: true })).toBe(
			"/chat",
		);
	});

	it("sin agentes y con brain, va al brain", () => {
		expect(tenantHome({ enabledAgents: [], brain: true })).toBe("/brain");
	});

	it("sin agentes y sin brain, va a Conectar", () => {
		expect(tenantHome({ enabledAgents: [], brain: false })).toBe("/conectar");
	});

	it("un agente que no está en el catálogo no cuenta como chat", () => {
		expect(tenantHome({ enabledAgents: ["soporte"], brain: true })).toBe(
			"/brain",
		);
	});
});
```

En `tests/agents/catalog.test.ts`, dentro del `describe`, agregar:

```ts
	it("el outreach tiene chat", () => {
		expect(AGENT_CATALOG.outreach.chat).toBe(true);
	});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/tenants/home.test.ts tests/agents/catalog.test.ts`
Expected: FAIL, no existe `@/lib/tenants/home` ni `chat` en el catálogo.

- [ ] **Step 3: Implementar**

En `lib/agents/catalog.ts`, agregar a `AgentCatalogEntry` después de `requiresBrain`:

```ts
	/** Si el agente se usa desde la pantalla de chat de la empresa. */
	chat: boolean;
```

y `chat: true,` en la entrada `outreach`.

`lib/tenants/home.ts`:

```ts
// A dónde entra una persona cuando abre su empresa (spec 21.4 §3.2). Puro: quien
// llama le pasa lo que leyó. Ningún lugar más decide un aterrizaje.
import { AGENT_CATALOG, isCatalogAgent } from "../agents/catalog";

export type TenantHome = "/chat" | "/brain" | "/conectar";

export function tenantHome(input: {
	enabledAgents: readonly string[];
	brain: boolean;
}): TenantHome {
	const hasChat = input.enabledAgents.some(
		(agent) => isCatalogAgent(agent) && AGENT_CATALOG[agent].chat,
	);
	if (hasChat) return "/chat";
	return input.brain ? "/brain" : "/conectar";
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/tenants/home.test.ts tests/agents/catalog.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/catalog.ts lib/tenants/home.ts tests/tenants/home.test.ts tests/agents/catalog.test.ts
git commit -m "feat: el aterrizaje de la empresa se decide en un solo lugar"
```

---

### Task 2: Menú por agente habilitado y guard de pantallas

**Files:**
- Create: `lib/tenants/enabled-agents.ts`
- Modify: `lib/tenants/nav.ts`, `app/[tenant]/layout.tsx`
- Modify (guard): `app/[tenant]/chat/page.tsx`, `cola/page.tsx`, `pipeline/page.tsx`, `contactos/page.tsx`, `cuentas/page.tsx`, `focos/page.tsx`, `metricas/page.tsx`, `mis-cuentas/page.tsx`, `settings/outreach/page.tsx`
- Modify: `app/[tenant]/settings/page.tsx`
- Test: `tests/tenants/nav.test.ts`, `tests/tenants/enabled-agents.test.ts`

**Interfaces:**
- Produces:
  - `loadEnabledAgents(tenantId: string): Promise<string[] | null>` — `null` si no se pudo leer.
  - `loadBrainEnabled(tenantId: string): Promise<boolean>`.
  - `requireAgent(tenantId: string, agent: CatalogAgent): Promise<void>` — `notFound()` si se leyó y el agente no está.
  - `visibleNav(role: TenantRole, enabledAgents: readonly string[] | null): NavEntry[]`.
  - `NavLink.agent?: CatalogAgent`.

- [ ] **Step 1: Tests que fallan**

Reemplazar `tests/tenants/nav.test.ts` por:

```ts
import { describe, expect, it } from "vitest";
import { visibleNav } from "@/lib/tenants/nav";

const labels = (
	role: Parameters<typeof visibleNav>[0],
	agents: readonly string[] | null = ["outreach"],
) => visibleNav(role, agents).map((entry) => entry.label);

describe("visibleNav", () => {
	it("con outreach, un miembro ve todo menos Configuración", () => {
		expect(labels("tenant_member")).toEqual([
			"Chat",
			"Outreach",
			"Brain",
			"Métricas",
			"Conectar",
			"Mis cuentas",
		]);
	});

	it("con outreach, un administrador ve además Configuración, al final", () => {
		expect(labels("tenant_admin").at(-1)).toBe("Configuración");
		expect(labels("platform_admin")).toEqual(labels("tenant_admin"));
	});

	it("sin agentes, un miembro ve solo Brain y Conectar", () => {
		expect(labels("tenant_member", [])).toEqual(["Brain", "Conectar"]);
	});

	it("sin agentes, un administrador ve Brain, Conectar y Configuración", () => {
		expect(labels("tenant_admin", [])).toEqual([
			"Brain",
			"Conectar",
			"Configuración",
		]);
	});

	it("si no se pudieron leer los agentes, no se oculta nada", () => {
		expect(labels("tenant_member", null)).toEqual(labels("tenant_member"));
	});

	it("un desplegable sin ítems visibles no se muestra", () => {
		expect(labels("tenant_admin", [])).not.toContain("Outreach");
	});

	it("Conectar apunta a /conectar", () => {
		expect(visibleNav("tenant_member", [])).toContainEqual({
			href: "/conectar",
			label: "Conectar",
		});
	});
});
```

`tests/tenants/enabled-agents.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { rows: { agent: string }[] | null; error: unknown } = {
	rows: [],
	error: null,
};

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	cache: <T>(fn: T) => fn,
}));

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					eq: async () => ({ data: state.rows, error: state.error }),
				}),
			}),
		}),
	}),
}));

const notFound = vi.fn(() => {
	throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));

const { loadEnabledAgents, requireAgent } = await import(
	"@/lib/tenants/enabled-agents"
);

beforeEach(() => {
	state.rows = [];
	state.error = null;
	notFound.mockClear();
});

describe("loadEnabledAgents", () => {
	it("devuelve los agentes habilitados", async () => {
		state.rows = [{ agent: "outreach" }];
		expect(await loadEnabledAgents("t1")).toEqual(["outreach"]);
	});

	it("si la consulta falla devuelve null", async () => {
		state.rows = null;
		state.error = { message: "boom" };
		expect(await loadEnabledAgents("t1")).toBeNull();
	});
});

describe("requireAgent", () => {
	it("deja pasar si el agente está habilitado", async () => {
		state.rows = [{ agent: "outreach" }];
		await expect(requireAgent("t1", "outreach")).resolves.toBeUndefined();
	});

	it("da 404 si el agente no está", async () => {
		await expect(requireAgent("t1", "outreach")).rejects.toThrow("NOT_FOUND");
	});

	it("si no se pudo leer, deja pasar", async () => {
		state.rows = null;
		state.error = { message: "boom" };
		await expect(requireAgent("t1", "outreach")).resolves.toBeUndefined();
		expect(notFound).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/tenants/nav.test.ts tests/tenants/enabled-agents.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar el helper**

`lib/tenants/enabled-agents.ts`:

```ts
// Qué agentes tiene habilitados una empresa, leído una vez por request (spec
// 21.4 §3.3 y §3.4). El menú y el guard de cada pantalla comparten la lectura.
// Es navegación, no autorización: los datos los cierra RLS.
import { notFound } from "next/navigation";
import { cache } from "react";
import type { CatalogAgent } from "../agents/catalog";
import { createServerSupabase } from "../supabase/server";

/** `null` si no se pudo leer: quien llama no oculta ni cierra nada. */
export const loadEnabledAgents = cache(
	async (tenantId: string): Promise<string[] | null> => {
		try {
			const supabase = await createServerSupabase();
			const { data, error } = await supabase
				.from("tenant_agents")
				.select("agent")
				.eq("tenant_id", tenantId)
				.eq("enabled", true);
			if (error) {
				console.error("agentes habilitados:", error.message);
				return null;
			}
			return (data ?? []).map((row) => row.agent as string);
		} catch (error) {
			console.error("agentes habilitados:", error);
			return null;
		}
	},
);

export const loadBrainEnabled = cache(
	async (tenantId: string): Promise<boolean> => {
		try {
			const supabase = await createServerSupabase();
			const { data, error } = await supabase
				.from("tenant_connections")
				.select("id")
				.eq("tenant_id", tenantId)
				.eq("capability", "brain")
				.eq("enabled", true)
				.limit(1);
			if (error) {
				console.error("brain habilitado:", error.message);
				return false;
			}
			return (data ?? []).length > 0;
		} catch (error) {
			console.error("brain habilitado:", error);
			return false;
		}
	},
);

/** 404 si la empresa no tiene habilitado el agente dueño de esta pantalla. */
export async function requireAgent(
	tenantId: string,
	agent: CatalogAgent,
): Promise<void> {
	const enabled = await loadEnabledAgents(tenantId);
	if (enabled && !enabled.includes(agent)) notFound();
}
```

- [ ] **Step 4: Implementar el menú**

En `lib/tenants/nav.ts`: importar `import type { CatalogAgent } from "../agents/catalog";`, cambiar el tipo y marcar las entradas:

```ts
export type NavLink = {
	href: string;
	label: string;
	adminOnly?: boolean;
	/** Agente que tiene que estar habilitado para que la entrada exista. */
	agent?: CatalogAgent;
};

export const NAV: NavEntry[] = [
	{ href: "/chat", label: "Chat", agent: "outreach" },
	{
		label: "Outreach",
		items: [
			{ href: "/cola", label: "Cola", agent: "outreach" },
			{ href: "/pipeline", label: "Pipeline", agent: "outreach" },
			{ href: "/contactos", label: "Contactos", agent: "outreach" },
			{ href: "/cuentas", label: "Cuentas", agent: "outreach" },
			{ href: "/focos", label: "Focos", agent: "outreach" },
		],
	},
	{ href: "/brain", label: "Brain" },
	{ href: "/metricas", label: "Métricas", agent: "outreach" },
	{ href: "/conectar", label: "Conectar" },
	{ href: "/mis-cuentas", label: "Mis cuentas", agent: "outreach" },
	// /settings hace notFound() para tenant_member: el link no se muestra,
	// no tiene sentido ofrecer una ruta que va a 404.
	{ href: "/settings", label: "Configuración", adminOnly: true },
];

/** `enabledAgents` en null (no se pudo leer) no oculta nada. */
export function visibleNav(
	role: TenantRole,
	enabledAgents: readonly string[] | null,
): NavEntry[] {
	const show = (link: NavLink) =>
		(!link.adminOnly || role !== "tenant_member") &&
		(!link.agent || enabledAgents === null || enabledAgents.includes(link.agent));

	return NAV.flatMap((entry): NavEntry[] => {
		if (!("items" in entry)) return show(entry) ? [entry] : [];
		const items = entry.items.filter(show);
		return items.length > 0 ? [{ ...entry, items }] : [];
	});
}
```

El test "Conectar apunta a /conectar" compara por igualdad: la entrada de Conectar no lleva `agent`, así que sigue pasando.

En `app/[tenant]/layout.tsx`: importar `loadEnabledAgents` de `@/lib/tenants/enabled-agents`, después de `if (!tenant) notFound();` agregar

```ts
	const enabledAgents = await loadEnabledAgents(tenant.id);
```

y cambiar `visibleNav(tenant.role)` por `visibleNav(tenant.role, enabledAgents)`.

- [ ] **Step 5: Guard en las pantallas**

En cada una de `chat`, `cola`, `pipeline`, `contactos`, `cuentas`, `focos`, `metricas` y `mis-cuentas` (`app/[tenant]/<ruta>/page.tsx`), inmediatamente después de `if (!tenant) notFound();`:

```ts
	await requireAgent(tenant.id, "outreach");
```

con `import { requireAgent } from "@/lib/tenants/enabled-agents";`.

En `app/[tenant]/settings/outreach/page.tsx` se agrega la misma línea en el mismo lugar y se borra el chequeo viejo (`if (!agentError && agent?.enabled !== true) notFound();` y su comentario). La consulta de `config` queda.

Los tests de página existentes (buscar con `grep -rln "page" tests/chat tests/cola tests/settings tests/pipeline tests/focos`) mockean `@/lib/supabase/server`. Si alguno falla por el guard, agregar al archivo de test:

```ts
vi.mock("@/lib/tenants/enabled-agents", () => ({
	requireAgent: async () => {},
	loadEnabledAgents: async () => ["outreach"],
	loadBrainEnabled: async () => true,
}));
```

- [ ] **Step 6: Settings sin agentes**

En `app/[tenant]/settings/page.tsx`, después de calcular `outreachEnabled`:

```ts
	// Sin agentes no hay modelo, ejecutores, aprobaciones ni conectores que
	// configurar: quedan Ingreso y Usuarios (spec 21.4 §3.4). Si no se pudo leer,
	// se muestra todo.
	const hasAgents =
		Boolean(agentsResult.error) ||
		(agentsResult.data ?? []).some((row) => row.enabled === true);
```

Mover el `<h1>` fuera de la primera `<section>` (queda como primer hijo del `div`) y envolver en `{hasAgents ? (...) : null}` las secciones Modelo default, Ejecutores, Aprobaciones y Conectores. La sección Ingreso y los links de abajo no cambian.

- [ ] **Step 7: Correr todo**

Run: `npm test && npm run typecheck`
Expected: PASS. Si falla un test de página por el guard, aplicar el mock del Step 5.

- [ ] **Step 8: Commit**

```bash
git add lib/tenants app/\[tenant\] tests
git commit -m "feat: el menu y las pantallas dependen de los agentes habilitados"
```

---

### Task 3: Migración (alta sin agentes y categorías del brain)

**Files:**
- Create: `supabase/migrations/20261019120000_agentless_tenant.sql`
- Create: `supabase/tests/33_agentless_tenant.test.sql`
- Modify: `supabase/tests/29_platform_console.test.sql` (el caso "sin agentes no se crea")
- Modify: `lib/supabase/database.types.ts` (regenerado con `npm run db:types`; confirmar la ruta con `grep -n "db:types" package.json`)

**Interfaces:**
- Produces: `platform_create_tenant(...)` acepta `p_agents` vacío; `platform_set_brain_categories(p_actor uuid, p_tenant uuid, p_categories text[]) returns void`.

- [ ] **Step 1: Cargar la skill** `supabase-postgres-best-practices`.

- [ ] **Step 2: Test pgTAP que falla**

`supabase/tests/33_agentless_tenant.test.sql`:

```sql
-- supabase/tests/33_agentless_tenant.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('e3e3e3e3-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'plat@at.test', now());

-- 1-3: alta sin agentes.
select lives_ok(
  $$select public.platform_create_tenant('e3e3e3e3-0000-0000-0000-000000000001', 'at-brain', 'AT Brain', '{at.test}', '{email}', '{}'::jsonb, '{}')$$,
  'crea una empresa sin agentes');
select is(
  (select count(*)::int from public.tenant_agents ta join public.tenants t on t.id = ta.tenant_id where t.slug = 'at-brain'),
  0, 'no nace ninguna fila de agente');
select is(
  (select e.payload -> 'agents' from public.events e join public.tenants t on t.id = e.tenant_id where t.slug = 'at-brain' and e.type = 'tenant.created'),
  '[]'::jsonb, 'el evento dice que nació sin agentes');

-- Brain de la empresa, con una página en la categoría comercial.
select public.platform_bind_connection(
  'e3e3e3e3-0000-0000-0000-000000000001',
  (select id from public.tenants where slug = 'at-brain'),
  'brain', 'wiki', '{}',
  '{"categories": ["empresa", "comercial"], "search": "fts", "requiredFrontmatter": ["title"]}'::jsonb, null);

insert into public.brain_pages (tenant_id, slug, title, category, status, body)
select id, 'comercial/nota', 'Nota', 'comercial', 'activo', 'x' from public.tenants where slug = 'at-brain';

-- 4-6: privilegios.
select ok(not has_function_privilege('authenticated', 'public.platform_set_brain_categories(uuid, uuid, text[])', 'execute'), 'authenticated no cambia categorías');
select ok(not has_function_privilege('anon', 'public.platform_set_brain_categories(uuid, uuid, text[])', 'execute'), 'anon tampoco');
select ok(has_function_privilege('service_role', 'public.platform_set_brain_categories(uuid, uuid, text[])', 'execute'), 'service_role sí');

-- 7-8: guardar.
select lives_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{empresa,trigo,comercial}')$$,
  'agrega una categoría');
select is(
  (select c.config from public.tenant_connections c join public.tenants t on t.id = c.tenant_id where t.slug = 'at-brain' and c.capability = 'brain'),
  '{"categories": ["empresa", "trigo", "comercial"], "search": "fts", "requiredFrontmatter": ["title"]}'::jsonb,
  'cambia solo categories, el resto de config queda igual');

-- 9-14: rechazos.
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{empresa,trigo}')$$,
  '23514', 'la categoría comercial tiene 1 página: movela antes de quitarla', 'no quita una categoría con páginas');
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{}')$$,
  '23514', 'el brain necesita entre 1 y 20 categorías', 'ni cero');
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{comercial,Trigo}')$$,
  '23514', 'la categoría Trigo no es válida: minúsculas, números y guiones, empezando con una letra', 'ni mayúsculas');
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', (select id from public.tenants where slug = 'at-brain'), '{comercial,comercial}')$$,
  '23514', 'la lista de categorías tiene repetidas', 'ni repetidas');
select throws_ok(
  $$select public.platform_set_brain_categories(null, (select id from public.tenants where slug = 'at-brain'), '{comercial}')$$,
  'P0001', 'falta el actor', 'sin actor no corre');
select throws_ok(
  $$select public.platform_set_brain_categories('e3e3e3e3-0000-0000-0000-000000000001', gen_random_uuid(), '{comercial}')$$,
  '23514', 'la empresa no tiene brain', 'sin brain no hay qué cambiar');

select * from finish();
rollback;
```

Antes de correr, confirmar las columnas obligatorias de `brain_pages` con `grep -n "create table public.brain_pages" -A25 supabase/migrations/20260913233557_brain_tables.sql` y completar el `insert` si falta alguna `not null` sin default.

En `supabase/tests/29_platform_console.test.sql`, reemplazar el bloque

```sql
select throws_ok(
  $$select public.platform_create_tenant('c9c9c9c9-0000-0000-0000-000000000001', 'pc-otra', 'Otra', '{}', '{email}', '{}'::jsonb, '{}')$$,
  '23514', 'la empresa necesita al menos un agente', 'sin agentes no se crea');
```

por

```sql
select lives_ok(
  $$select public.platform_create_tenant('c9c9c9c9-0000-0000-0000-000000000001', 'pc-sin', 'Sin agentes', '{}', '{email}', '{}'::jsonb, '{}')$$,
  'sin agentes también se crea (21.4)');
```

El `plan(55)` no cambia: es un caso por otro.

- [ ] **Step 3: Correr y ver que falla**

Run: `npm run db:test`
Expected: FAIL en `33_agentless_tenant` (no existe la función) y en el caso cambiado de `29`.

- [ ] **Step 4: Escribir la migración**

`supabase/migrations/20261019120000_agentless_tenant.sql`:

```sql
-- Etapa 21.4a: una empresa puede no tener agentes, y las categorías de su brain
-- se editan desde la consola (spec 2026-10-11-etapa-21-4 §3.1 y §4.2).

-- Copia exacta de platform_create_tenant (21.1) sin el mínimo de un agente.
create or replace function public.platform_create_tenant(
  p_actor uuid,
  p_slug text,
  p_display_name text,
  p_allowed_domains text[],
  p_auth_methods text[],
  p_brand jsonb,
  p_agents text[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_agent text;
  v_agents text[] := coalesce(p_agents, '{}');
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if (select count(distinct a) from unnest(v_agents) a) <> cardinality(v_agents) then
    raise exception 'la lista de agentes tiene repetidos' using errcode = '23514', hint = 'consola';
  end if;

  insert into public.tenants (slug, display_name, allowed_domains, auth_methods, brand)
  values (p_slug, p_display_name, coalesce(p_allowed_domains, '{}'), p_auth_methods, coalesce(p_brand, '{}'::jsonb))
  returning id into v_id;

  foreach v_agent in array v_agents loop
    insert into public.tenant_agents (tenant_id, agent, config)
    values (v_id, v_agent, '{"brain": "read_write"}'::jsonb);
  end loop;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_id, p_actor, 'tenant.created', p_display_name,
          jsonb_build_object('slug', p_slug, 'agents', to_jsonb(v_agents)));

  return v_id;
end;
$$;

create or replace function public.platform_set_brain_categories(
  p_actor uuid,
  p_tenant uuid,
  p_categories text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_categories text[] := coalesce(p_categories, '{}');
  v_connection uuid;
  v_bad text;
  v_used text;
  v_count int;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if cardinality(v_categories) < 1 or cardinality(v_categories) > 20 then
    raise exception 'el brain necesita entre 1 y 20 categorías' using errcode = '23514', hint = 'consola';
  end if;
  -- Mismo patrón que el check de brain_pages.category.
  select c into v_bad from unnest(v_categories) c where c is null or c !~ '^[a-z][a-z0-9-]{0,40}$' limit 1;
  if found then
    raise exception 'la categoría % no es válida: minúsculas, números y guiones, empezando con una letra', coalesce(v_bad, '(vacía)')
      using errcode = '23514', hint = 'consola';
  end if;
  if (select count(distinct c) from unnest(v_categories) c) <> cardinality(v_categories) then
    raise exception 'la lista de categorías tiene repetidas' using errcode = '23514', hint = 'consola';
  end if;

  select c.id into v_connection
  from public.tenant_connections c
  where c.tenant_id = p_tenant and c.capability = 'brain'
  for update;
  if v_connection is null then
    raise exception 'la empresa no tiene brain' using errcode = '23514', hint = 'consola';
  end if;

  select p.category, count(*)::int into v_used, v_count
  from public.brain_pages p
  where p.tenant_id = p_tenant and not (p.category = any (v_categories))
  group by p.category
  order by count(*) desc, p.category
  limit 1;
  if v_used is not null then
    raise exception '%', format(
      'la categoría %s tiene %s página%s: movela%s antes de quitarla',
      v_used, v_count,
      case when v_count = 1 then '' else 's' end,
      case when v_count = 1 then '' else 's' end)
      using errcode = '23514', hint = 'consola';
  end if;

  update public.tenant_connections
  set config = jsonb_set(config, '{categories}', to_jsonb(v_categories)),
      updated_by = p_actor,
      updated_at = now()
  where id = v_connection;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'brain.categories_set', array_to_string(v_categories, ', '),
          jsonb_build_object('categories', to_jsonb(v_categories)));
end;
$$;

revoke execute on function public.platform_set_brain_categories(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.platform_set_brain_categories(uuid, uuid, text[]) to service_role;
```

Notas para quien implementa:

- El mensaje de la categoría en uso sale en singular o plural (`tiene 1 página: movela…`, `tiene 3 páginas: movelas…`). El test del Step 2 fija el singular.
- Confirmar el tipo de evento contra los existentes: `grep -rn "'tenant\.\|'brain\." supabase/migrations | grep "events" | head`. Si `events.type` tiene un check o un enum, agregar `brain.categories_set` en esta misma migración.
- `create or replace` conserva los privilegios de `platform_create_tenant`: no hace falta repetir su `revoke`/`grant`.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run db:test`
Expected: PASS, incluidos `29` y `33`.

- [ ] **Step 6: Regenerar tipos**

Run: `npm run db:types && npm run typecheck`
Expected: aparece `platform_set_brain_categories` en los tipos; typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add supabase lib/supabase
git commit -m "feat: alta de empresa sin agentes y categorias del brain editables en la base"
```

---

### Task 4: El alta acepta cero agentes y la consola la considera lista

**Files:**
- Modify: `lib/tenants/tenant-create.ts:64-66`, `lib/tenants/readiness.ts:68`, `app/plataforma/nueva/actions.ts:113`
- Test: `tests/tenants/tenant-create.test.ts`, `tests/tenants/readiness.test.ts`, `tests/plataforma/create-actions.test.ts`

**Interfaces:**
- Consumes: `platform_create_tenant` con `p_agents` vacío (Task 3).

- [ ] **Step 1: Tests que fallan**

En `tests/tenants/tenant-create.test.ts`, reemplazar el caso `"sin agentes no se crea"` por:

```ts
	it("sin agentes también se crea", () => {
		expect(message({ agents: [] })).toBeNull();
	});
```

(`message` devuelve el primer error o `null`; si en ese archivo devuelve `undefined`, usar `toBeUndefined()`.)

En `tests/tenants/readiness.test.ts`, reemplazar el caso `"sin agentes habilitados"` por:

```ts
	it("sin agentes y con brain, está lista", () => {
		expect(
			tenantReadiness({
				agents: [],
				connections: [
					{ capability: "brain", provider: "wiki", enabled: true, verifiedAt: null },
				],
			}),
		).toEqual({ ready: true, missing: [] });
	});

	it("un agente deshabilitado y brain, está lista", () => {
		expect(
			tenantReadiness({
				agents: [{ agent: "outreach", enabled: false }],
				connections: [
					{ capability: "brain", provider: "wiki", enabled: true, verifiedAt: null },
				],
			}),
		).toEqual({ ready: true, missing: [] });
	});

	it("sin agentes y sin brain, faltan los dos", () => {
		expect(tenantReadiness({ agents: [], connections: [] }).missing).toEqual([
			"agentes",
			"brain",
		]);
	});
```

En `tests/plataforma/create-actions.test.ts`, buscar la aserción sobre `next` (`grep -n "chat" tests/plataforma/create-actions.test.ts`) y cambiar el valor esperado de `/<slug>/chat` a `/<slug>`.

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/tenants/tenant-create.test.ts tests/tenants/readiness.test.ts tests/plataforma/create-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`lib/tenants/tenant-create.ts`: borrar la línea `.min(1, { error: "Elegí al menos un agente." })`.

`lib/tenants/readiness.ts`, reemplazar las dos líneas de `agentes` y `brain`:

```ts
	// Una empresa puede usar solo el brain (spec 21.4 §3.5): sin agentes falta
	// algo solo si tampoco tiene brain.
	const hasBrain = enabled.some((c) => c.capability === "brain");
	if (enabledAgents.length === 0 && !hasBrain) missing.push("agentes");
	if (!hasBrain) missing.push("brain");
```

`app/plataforma/nueva/actions.ts:113`: `next: \`/${input.slug}\`,`.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tenants app/plataforma tests
git commit -m "feat: el alta acepta una empresa sin agentes"
```

---

### Task 5: `/<slug>` aterriza según la empresa

**Files:**
- Create: `app/[tenant]/page.tsx`
- Modify: `app/page.tsx:39,49`, `app/(auth)/login/[tenant]/page.tsx:49`, `app/[tenant]/settings/usuarios/actions.ts:250`, `app/plataforma/[slug]/page.tsx:197`
- Test: `tests/tenants/tenant-home-page.test.ts`; ajustar `tests/auth/tenant-login-page.test.ts`, `tests/settings/usuarios-admin-actions.test.ts`, `tests/plataforma/detail-page.test.ts`, `tests/invitations/invite.test.ts` donde esperen `/chat`

**Interfaces:**
- Consumes: `tenantHome` (Task 1), `loadEnabledAgents`, `loadBrainEnabled` (Task 2).

- [ ] **Step 1: Test que falla**

`tests/tenants/tenant-home-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	tenant: { id: string } | null;
	agents: string[] | null;
	brain: boolean;
} = { tenant: { id: "t1" }, agents: [], brain: true };

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.tenant,
}));
vi.mock("@/lib/tenants/enabled-agents", () => ({
	loadEnabledAgents: async () => state.agents,
	loadBrainEnabled: async () => state.brain,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NOT_FOUND");
	},
	redirect: (path: string) => {
		throw new Error(`REDIRECT ${path}`);
	},
}));

const { default: TenantHomePage } = await import("@/app/[tenant]/page");
const open = () => TenantHomePage({ params: Promise.resolve({ tenant: "acme" }) });

beforeEach(() => {
	state.tenant = { id: "t1" };
	state.agents = [];
	state.brain = true;
});

describe("/<slug>", () => {
	it("sin agentes va al brain", async () => {
		await expect(open()).rejects.toThrow("REDIRECT /acme/brain");
	});

	it("con outreach va al chat", async () => {
		state.agents = ["outreach"];
		await expect(open()).rejects.toThrow("REDIRECT /acme/chat");
	});

	it("sin agentes ni brain va a Conectar", async () => {
		state.brain = false;
		await expect(open()).rejects.toThrow("REDIRECT /acme/conectar");
	});

	it("si no se pudieron leer los agentes, va al brain y no al chat", async () => {
		state.agents = null;
		await expect(open()).rejects.toThrow("REDIRECT /acme/brain");
	});

	it("sin acceso da 404", async () => {
		state.tenant = null;
		await expect(open()).rejects.toThrow("NOT_FOUND");
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/tenants/tenant-home-page.test.ts`
Expected: FAIL, no existe la página.

- [ ] **Step 3: Implementar**

`app/[tenant]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { loadBrainEnabled, loadEnabledAgents } from "@/lib/tenants/enabled-agents";
import { tenantHome } from "@/lib/tenants/home";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// La empresa no tiene portada propia: se entra a lo que tenga habilitado
// (spec 21.4 §3.2).
export default async function TenantHomePage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const [enabledAgents, brain] = await Promise.all([
		loadEnabledAgents(tenant.id),
		loadBrainEnabled(tenant.id),
	]);
	redirect(`/${slug}${tenantHome({ enabledAgents: enabledAgents ?? [], brain })}`);
}
```

Cambiar a `/<slug>` (sin `/chat`) los cinco destinos:

- `app/page.tsx:39`: `redirect(\`/${tenants[0].slug}\`)`; `:49`: `href={\`/${tenant.slug}\`}`.
- `app/(auth)/login/[tenant]/page.tsx:49`: `next={\`/${tenant.slug}\`}`.
- `app/[tenant]/settings/usuarios/actions.ts:250`: `next: tenant?.slug ? \`/${tenant.slug}\` : undefined,`.
- `app/plataforma/[slug]/page.tsx:197`: `href={\`/${tenant.slug}\`}`.

- [ ] **Step 4: Ajustar tests que esperaban `/chat`**

Run: `npm test`
Para cada falla que espere `/<slug>/chat` como destino de ingreso (no como ruta de la pantalla de chat), cambiar el valor esperado a `/<slug>`. No tocar `tests/chat/*`, `tests/outreach/*` ni `tests/auth/callback.test.ts` si usan `/chat` como un `next` cualquiera.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app tests
git commit -m "feat: la empresa aterriza en el chat, el brain o Conectar segun lo que tenga"
```

---

### Task 6: Brain neutro (canon solo con un agente que lo usa)

**Files:**
- Modify: `app/plataforma/[slug]/console-actions.ts` (`setAgent`, `createBrain`)
- Modify: `lib/brain/core/contract.ts`, `lib/brain/core/mcp-server/server.ts`, `lib/brain/core/mcp-server/handler.ts`, `lib/brain/adapters/mcp-production.ts`
- Modify: `app/[tenant]/brain/page.tsx:160-170`
- Test: `tests/plataforma/console-actions.test.ts`, `tests/brain/contract.test.ts`, `tests/brain/mcp-server/*` (el que arma `BrainMcpDeps`)

**Interfaces:**
- Consumes: `agentsNeedCanon(enabledAgents: ReadonlyArray<{ agent: string }>): boolean` de `lib/tenants/readiness.ts` (ya existe; usa `requiresBrain` del catálogo). `loadEnabledAgents` (Task 2).
- Produces: `brainContract(categories: string[], options?: { canon?: boolean })` (default `true`); `buildBrainMcpServer(ctx)` con `ctx.canon: boolean`; `BrainMcpDeps.usesCanon(tenantId: string): Promise<boolean>`.

- [ ] **Step 1: Tests que fallan**

En `tests/brain/contract.test.ts`, agregar:

```ts
	it("con canon, las descripciones nombran los tags de canon", () => {
		const withCanon = brainContract(["comercial"]);
		expect(withCanon.search.description).toContain("canon:icp");
		expect(withCanon.upsert.description).toContain("Tags de canon");
	});

	it("sin canon, las descripciones son generales", () => {
		const neutral = brainContract(["empresa", "trigo"], { canon: false });
		for (const tool of [neutral.search, neutral.read, neutral.upsert]) {
			expect(tool.description).not.toMatch(/canon|ICP|hooks|comercial/i);
		}
		expect(neutral.upsert.description).toContain(
			"Categorías válidas: empresa, trigo.",
		);
	});
```

En `tests/plataforma/console-actions.test.ts`, mirar cómo el archivo mockea `createAdminClient`, `requirePlatformAdmin` y `seedCanonPagesForTenant` (`sed -n 1,80p`), y con ese mismo armado agregar cuatro casos:

1. `createBrain` en una empresa sin agentes habilitados: responde `{ ok: true }` y **no** llama a `seedCanonPagesForTenant`.
2. `createBrain` en una empresa con `outreach` habilitado: llama a `seedCanonPagesForTenant` una vez.
3. `setAgent(slug, tenantId, "outreach", true, "read_write")` con brain habilitado: llama a `seedCanonPagesForTenant` una vez, después de `platform_set_agent`.
4. `setAgent(..., false, ...)`: no la llama.

Cada caso con su `expect(seed).toHaveBeenCalledTimes(n)`.

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/brain/contract.test.ts tests/plataforma/console-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Contrato**

En `lib/brain/core/contract.ts`, cambiar la firma y las tres descripciones:

```ts
export function brainContract(
	categories: string[],
	// Sin canon cuando la empresa no tiene un agente que lo use (spec 21.4 §4.3).
	{ canon: withCanon = true }: { canon?: boolean } = {},
) {
	if (categories.length === 0) {
		throw new Error("el brain necesita al menos una categoría");
	}
	const category = z.enum(categories as [string, ...string[]]);
	const valid = `Categorías válidas: ${categories.join(", ")}.`;

	return {
		search: {
			description: withCanon
				? `Busca en el brain de este cliente: canon comercial, ICP, mensajes, voz, hooks, cuentas y producto. Para canon, filtrá por tag: ${canon}. La consulta puede ir vacía si filtrás por tag o categoría.`
				: `Busca en el brain de esta empresa por texto, categoría o tag. La consulta puede ir vacía si filtrás por tag o categoría. ${valid}`,
```

`read.description` pasa a `"Lee una página completa del brain de esta empresa, con su revisión. Necesitás la revisión para actualizarla con brain_upsert."` en los dos casos (no nombra canon; verificar que ningún test fije el texto viejo con `grep -rn "de este cliente, con su revisión" tests`).

`upsert.description`:

```ts
			description: `Crea o actualiza una página del brain de esta empresa. Para actualizar, leé la página y pasá su revisión en baseRevision; sin baseRevision solo crea páginas nuevas. Nunca borres: para retirar una página, poné status archivado. Explicá el cambio en reason. ${valid}${withCanon ? ` Tags de canon: ${canon}.` : ""}`,
```

`lib/brain/adapters/tools.ts` no cambia: el agente usa el default.

- [ ] **Step 4: Servidor MCP**

`lib/brain/core/mcp-server/server.ts`: agregar `canon: boolean;` a `ctx` y cambiar a `brainContract(ctx.categories, { canon: ctx.canon })`.

`lib/brain/core/mcp-server/handler.ts`: agregar a `BrainMcpDeps`

```ts
	/** Si la empresa tiene un agente que usa el canon comercial del brain. */
	usesCanon: (tenantId: string) => Promise<boolean>;
```

y en la llamada a `buildBrainMcpServer`, `canon: await deps.usesCanon(access.tenantId),`.

`lib/brain/adapters/mcp-production.ts`, en `productionDeps()`:

```ts
		usesCanon: async (tenantId) => {
			// Si no se puede leer, descripciones generales: es solo texto de ayuda.
			try {
				const { data, error } = await createAdminClient()
					.from("tenant_agents")
					.select("agent")
					.eq("tenant_id", tenantId)
					.eq("enabled", true);
				if (error) return false;
				return agentsNeedCanon(data ?? []);
			} catch {
				return false;
			}
		},
```

con los imports relativos que use el archivo para `createAdminClient` y `agentsNeedCanon` (`../../tenants/readiness.ts`). Correr `npm test -- tests/brain/boundary.test.ts`: si la frontera del brain no deja que `adapters/` importe `lib/tenants`, mover `agentsNeedCanon` a `lib/agents/catalog.ts` (y reexportarlo desde `readiness.ts` para no tocar sus consumidores).

En los tests de `tests/brain/mcp-server/` que construyen `BrainMcpDeps` o llaman a `buildBrainMcpServer`, agregar `usesCanon: async () => false` y `canon: false` respectivamente.

- [ ] **Step 5: Consola**

En `app/plataforma/[slug]/console-actions.ts`, importar `agentsNeedCanon` de `@/lib/tenants/readiness` y agregar arriba de `setAgent`:

```ts
const SIN_CANON: ConsoleResult = {
	ok: false,
	message:
		"Quedó guardado, pero no pude crear las páginas por defecto. Crealas a mano en comercial/icp y comercial/hooks.",
};

/** Si algún agente habilitado de la empresa usa el canon del brain. */
async function tenantUsesCanon(tenantId: string): Promise<boolean> {
	const { data, error } = await createAdminClient()
		.from("tenant_agents")
		.select("agent")
		.eq("tenant_id", tenantId)
		.eq("enabled", true);
	if (error) {
		console.error("consola: no pude leer los agentes:", error.message);
		return false;
	}
	return agentsNeedCanon(data ?? []);
}
```

Final de `setAgent` (reemplaza el `return call(...)`):

```ts
	const saved = await call(slug, "platform_set_agent", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_agent: agent,
		p_enabled: enabled === true,
		p_brain: brain,
	});
	// Las páginas del canon nacen cuando hay un agente que las usa, no con el
	// brain (spec 21.4 §4.1). El brain ya existe: se verificó arriba. Una página
	// que ya está no se pisa.
	if (saved.ok && enabled === true && AGENT_CATALOG[agent].requiresBrain) {
		const seeded = await seedCanonPagesForTenant(tenantId, admin.userId);
		if (!seeded) return SIN_CANON;
	}
	return saved;
```

Final de `createBrain` (reemplaza desde el comentario "Carpeta y archivo por defecto"):

```ts
	// Sin un agente que use el canon, el brain nace vacío (spec 21.4 §4.1).
	if (!(await tenantUsesCanon(tenantId))) return created;
	const seeded = await seedCanonPagesForTenant(tenantId, admin.userId);
	return seeded ? created : SIN_CANON;
```

- [ ] **Step 6: Chips del índice**

En `app/[tenant]/brain/page.tsx`, importar `loadEnabledAgents` y `agentsNeedCanon`, y antes del `return`:

```ts
	// Los tags de canon son de outreach: sin un agente que los use no se ofrecen.
	const tenantAccess = await resolveTenantAccess(slug);
	const enabledAgents = tenantAccess
		? await loadEnabledAgents(tenantAccess.id)
		: null;
	const showCanon =
		enabledAgents === null ||
		agentsNeedCanon(enabledAgents.map((agent) => ({ agent })));
```

(`resolveTenantAccess` está cacheada por request; si `ctx` ya expone el id de la empresa, usar ese y no resolver de nuevo.) Envolver el `<div className="flex flex-wrap gap-2 text-sm">` de los chips en `{showCanon ? (...) : null}`.

- [ ] **Step 7: Correr y ver que pasa**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app lib tests
git commit -m "feat: el brain de una empresa sin outreach nace y se describe sin canon comercial"
```

---

### Task 7: Categorías del brain editables en la consola

**Files:**
- Create: `lib/brain/core/categories.ts`
- Modify: `app/plataforma/[slug]/console-actions.ts`, `app/plataforma/[slug]/console/brain-section.tsx`
- Test: `tests/brain/categories.test.ts`, `tests/plataforma/console-actions.test.ts`, `tests/plataforma/console-sections.test.ts`

**Interfaces:**
- Consumes: `platform_set_brain_categories` (Task 3).
- Produces: `parseCategories(raw: string): { ok: true; categories: string[] } | { ok: false; message: string }`; server action `setBrainCategories(slug: string, tenantId: string, raw: string): Promise<ConsoleResult>`.

- [ ] **Step 1: Tests que fallan**

`tests/brain/categories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCategories } from "@/lib/brain/core/categories";

describe("parseCategories", () => {
	it("separa por coma, recorta, pasa a minúsculas y saca repetidas", () => {
		expect(parseCategories(" Empresa, trigo ,trigo,\ncomercial ")).toEqual({
			ok: true,
			categories: ["empresa", "trigo", "comercial"],
		});
	});

	it("rechaza la lista vacía", () => {
		expect(parseCategories(" , ")).toEqual({
			ok: false,
			message: "El brain necesita al menos una categoría.",
		});
	});

	it("rechaza espacios, acentos y símbolos, y dice cuál", () => {
		expect(parseCategories("empresa, compras de trigo")).toEqual({
			ok: false,
			message:
				"«compras de trigo» no es válida: usá minúsculas, números y guiones, empezando con una letra.",
		});
		expect(parseCategories("operación").ok).toBe(false);
		expect(parseCategories("2026").ok).toBe(false);
	});

	it("rechaza más de 20", () => {
		const many = Array.from({ length: 21 }, (_, i) => `c${i}`).join(",");
		expect(parseCategories(many)).toEqual({
			ok: false,
			message: "Son demasiadas categorías: el máximo es 20.",
		});
	});
});
```

En `tests/plataforma/console-actions.test.ts`, con el armado del archivo, tres casos para `setBrainCategories`:

1. Sin `platform_admin` responde `{ ok: false, message: "No tenés permiso." }` y no llama al rpc.
2. Con `"Empresa, trigo"` llama al rpc `platform_set_brain_categories` con `{ p_actor, p_tenant, p_categories: ["empresa", "trigo"] }` y responde `{ ok: true }`.
3. Con `"compras de trigo"` responde el mensaje de `parseCategories` y no llama al rpc.

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/brain/categories.test.ts tests/plataforma/console-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar el parser**

`lib/brain/core/categories.ts`:

```ts
// Lee la lista de categorías que escribe una persona en la consola (spec 21.4
// §4.2). El patrón es el del check de brain_pages.category; la base lo repite.
const CATEGORY = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_CATEGORIES = 20;

export type ParsedCategories =
	| { ok: true; categories: string[] }
	| { ok: false; message: string };

export function parseCategories(raw: string): ParsedCategories {
	const categories = [
		...new Set(
			raw
				.split(/[,\n]/)
				.map((item) => item.trim().toLowerCase())
				.filter((item) => item.length > 0),
		),
	];
	if (categories.length === 0) {
		return { ok: false, message: "El brain necesita al menos una categoría." };
	}
	if (categories.length > MAX_CATEGORIES) {
		return {
			ok: false,
			message: `Son demasiadas categorías: el máximo es ${MAX_CATEGORIES}.`,
		};
	}
	const bad = categories.find((item) => !CATEGORY.test(item));
	if (bad) {
		return {
			ok: false,
			message: `«${bad}» no es válida: usá minúsculas, números y guiones, empezando con una letra.`,
		};
	}
	return { ok: true, categories };
}
```

- [ ] **Step 4: Server action**

En `app/plataforma/[slug]/console-actions.ts`: agregar `"platform_set_brain_categories"` a la unión de `fn` en `call`, importar `parseCategories`, y debajo de `createBrain`:

```ts
export async function setBrainCategories(
	slug: string,
	tenantId: string,
	raw: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	if (typeof raw !== "string" || raw.length > 2000) return INVALIDO;

	const parsed = parseCategories(raw);
	if (!parsed.ok) return { ok: false, message: parsed.message };

	return call(slug, "platform_set_brain_categories", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_categories: parsed.categories,
	});
}
```

- [ ] **Step 5: Formulario**

En `app/plataforma/[slug]/console/brain-section.tsx`, reemplazar la línea de solo lectura `Categorías: {…}` por un componente en el mismo archivo:

```tsx
function CategoriesForm({
	slug,
	tenantId,
	categories,
}: {
	slug: string;
	tenantId: string;
	categories: string[];
}) {
	const [value, setValue] = useState(categories.join(", "));
	return (
		<div className="mt-2 flex flex-wrap items-center gap-2">
			<label className="text-muted-foreground text-xs" htmlFor="brain-categories">
				Categorías
			</label>
			<Input
				className="h-8 min-w-0 flex-1 text-xs"
				id="brain-categories"
				onChange={(event) => setValue(event.target.value)}
				value={value}
			/>
			<ConsoleButton
				label="Guardar"
				run={() => setBrainCategories(slug, tenantId, value)}
			/>
		</div>
	);
}
```

con `import { useState } from "react";`, `import { Input } from "@/components/ui/input";` y `setBrainCategories` en el import de `../console-actions`. Usarlo donde estaba la línea: `<CategoriesForm categories={brain.categories} slug={slug} tenantId={tenantId} />`. Debajo, una línea de ayuda: `<p className="text-muted-foreground text-xs">Separadas por coma. No se puede quitar una que tenga páginas.</p>`.

Cambiar también el texto de "sin brain" a: `La empresa todavía no tiene brain. Nace con permisos de lectura para sus miembros.` (ya no es cierto que nazca "vacío" si hay un agente que usa canon).

En `tests/plataforma/console-sections.test.ts`, ajustar las aserciones de `BrainSection` que esperen el texto `Categorías: a, b` al nuevo marcado (el `value` del input) y agregar una que confirme el botón `Guardar`.

- [ ] **Step 6: Correr y ver que pasa**

Run: `npm test && npm run typecheck`
Expected: PASS (incluido `tests/server-actions-exports.test.ts`: `console-actions.ts` sigue exportando solo funciones async y tipos).

- [ ] **Step 7: Commit**

```bash
git add app lib tests
git commit -m "feat: la consola edita las categorias del brain de una empresa"
```

---

### Task 8: Código por correo

**Files:**
- Create: `lib/auth/complete-login.ts`, `supabase/templates/magic_link.html`, `supabase/templates/confirmation.html`
- Modify: `app/auth/callback/route.ts`, `app/(auth)/login/actions.ts`, `app/(auth)/login/login-form.tsx`, `lib/tenants/auth-methods.ts:9`, `supabase/config.toml`
- Test: `tests/auth/complete-login.test.ts`, `tests/auth/verify-email-code.test.ts`, `tests/auth/login-form.test.ts`, `tests/tenants/auth-methods.test.ts`

**Interfaces:**
- Produces:
  - `completeLogin(supabase): Promise<{ ok: true } | { ok: false; landing: string }>` — corre `joinOnLogin` y `gateLogin`; si la compuerta corta, cierra la sesión local.
  - Server action `verifyEmailCode(email: string, code: string, next: string | null): Promise<{ ok: false; message: string }>` — con éxito no devuelve: redirige.

- [ ] **Step 1: Tests que fallan**

`tests/auth/complete-login.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { completeLogin } from "@/lib/auth/complete-login";

function client(gate: unknown) {
	const calls: string[] = [];
	return {
		calls,
		rpc: async (fn: string) => {
			calls.push(fn);
			return { data: fn === "login_gate" ? gate : 1, error: null };
		},
		auth: {
			signOut: async () => {
				calls.push("signOut");
				return { error: null };
			},
		},
	};
}

describe("completeLogin", () => {
	it("une membresías y después pasa la compuerta", async () => {
		const supabase = client({ allowed: true, landing: null });
		expect(await completeLogin(supabase)).toEqual({ ok: true });
		expect(supabase.calls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
			"login_gate",
		]);
	});

	it("si la compuerta corta, cierra la sesión y devuelve la landing", async () => {
		const supabase = client({ allowed: false, landing: "acme" });
		expect(await completeLogin(supabase)).toEqual({
			ok: false,
			landing: "/login/acme?error=metodo",
		});
		expect(supabase.calls.at(-1)).toBe("signOut");
	});
});
```

`tests/auth/verify-email-code.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	verify: { data: { session: unknown }; error: unknown };
	gate: unknown;
	verified: unknown[];
	calls: string[];
} = {
	verify: { data: { session: {} }, error: null },
	gate: { allowed: true, landing: null },
	verified: [],
	calls: [],
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			verifyOtp: async (args: unknown) => {
				state.verified.push(args);
				return state.verify;
			},
			signOut: async () => {
				state.calls.push("signOut");
				return { error: null };
			},
		},
		rpc: async (fn: string) => {
			state.calls.push(fn);
			return { data: fn === "login_gate" ? state.gate : 1, error: null };
		},
	}),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/headers", () => ({
	headers: async () => new Headers({ host: "app.test", "x-forwarded-proto": "https" }),
}));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		throw new Error(`REDIRECT ${path}`);
	},
}));

const { verifyEmailCode } = await import("@/app/(auth)/login/actions");

const WRONG = {
	ok: false,
	message: "El código no es correcto o ya venció. Pedí otro.",
};

beforeEach(() => {
	state.verify = { data: { session: {} }, error: null };
	state.gate = { allowed: true, landing: null };
	state.verified = [];
	state.calls = [];
});

describe("verifyEmailCode", () => {
	it("con un código válido redirige a next", async () => {
		await expect(
			verifyEmailCode(" Ana@Acme.com ", "123 456", "/acme"),
		).rejects.toThrow("REDIRECT /acme");
		expect(state.verified).toEqual([
			{ email: "ana@acme.com", token: "123456", type: "email" },
		]);
	});

	it("un next de otro origen cae en /", async () => {
		await expect(
			verifyEmailCode("ana@acme.com", "123456", "//evil.test"),
		).rejects.toThrow("REDIRECT /");
	});

	it("un código que no son 6 dígitos no llega a Supabase", async () => {
		expect(await verifyEmailCode("ana@acme.com", "12345", null)).toEqual(WRONG);
		expect(await verifyEmailCode("ana@acme.com", "abcdef", null)).toEqual(WRONG);
		expect(state.verified).toEqual([]);
	});

	it("un correo inválido responde lo mismo", async () => {
		expect(await verifyEmailCode("no-es-mail", "123456", null)).toEqual(WRONG);
		expect(state.verified).toEqual([]);
	});

	it("código equivocado o vencido: un solo mensaje", async () => {
		state.verify = { data: { session: null }, error: { message: "expired" } };
		expect(await verifyEmailCode("ana@acme.com", "123456", null)).toEqual(WRONG);
	});

	it("si la empresa no acepta correo, cierra la sesión y va a la landing", async () => {
		state.gate = { allowed: false, landing: "acme" };
		await expect(
			verifyEmailCode("ana@acme.com", "123456", "/acme"),
		).rejects.toThrow("REDIRECT /login/acme?error=metodo");
		expect(state.calls).toContain("signOut");
	});
});
```

En `tests/auth/login-form.test.ts`: reemplazar todas las apariciones de `"Mandarme un link"` por `"Mandarme un código"` y sumar al mock de `@/app/(auth)/login/actions` la clave `verifyEmailCode: async () => ({ ok: false, message: "" })`.

En `tests/tenants/auth-methods.test.ts`: donde se espere `"Link por correo"`, pasa a `"Código por correo"` (si el rótulo no está testeado, agregar `expect(AUTH_METHOD_LABELS.email).toBe("Código por correo")`).

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/auth tests/tenants/auth-methods.test.ts`
Expected: FAIL.

- [ ] **Step 3: Tramo compartido**

`lib/auth/complete-login.ts`:

```ts
// Lo que pasa después de verificar a la persona, venga por link, por OAuth o
// por código (spec 21.4 §5.1): se convierten en membresías sus invitaciones y
// su dominio, y recién después corre la compuerta de método. Si corta, la
// sesión recién abierta se cierra.
import { closeLocalSession } from "./close-session";
import { joinOnLogin } from "./join-on-login";
import { type GateResult, gateLogin } from "./login-gate";

type Client = Parameters<typeof joinOnLogin>[0] &
	Parameters<typeof gateLogin>[0] &
	Parameters<typeof closeLocalSession>[0];

export async function completeLogin(supabase: Client): Promise<GateResult> {
	await joinOnLogin(supabase);
	const gate = await gateLogin(supabase);
	if (!gate.ok) await closeLocalSession(supabase);
	return gate;
}
```

En `app/auth/callback/route.ts`, reemplazar el bloque desde `await joinOnLogin(supabase);` hasta el cierre del `if (!gate.ok)` por:

```ts
	// Las invitaciones pendientes y el ingreso por dominio de este mail
	// verificado se convierten en memberships acá, y después corre la compuerta
	// de método: una membresía nueva puede ser la que lo permite.
	const gate = await completeLogin(supabase);
	if (!gate.ok) {
		return NextResponse.redirect(new URL(gate.landing, requestUrl.origin));
	}
```

y dejar solo los imports que se usan. `tests/auth/callback.test.ts` tiene que seguir pasando sin cambios: fija el orden de las llamadas.

- [ ] **Step 4: Server action**

En `app/(auth)/login/actions.ts`, agregar:

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { completeLogin } from "@/lib/auth/complete-login";
import { safeNextPath } from "@/lib/auth/next-path";
import { createServerSupabase } from "@/lib/supabase/server";
import { originFrom } from "@/lib/tenants/origin";

const CODIGO_INVALIDO = {
	ok: false as const,
	message: "El código no es correcto o ya venció. Pedí otro.",
};

/**
 * Entra con el código de 6 dígitos del mail (spec 21.4 §5). Un solo mensaje
 * para código mal escrito, equivocado, vencido o de otro correo: la pantalla
 * no confirma quién tiene cuenta. Con éxito no devuelve: redirige.
 */
export async function verifyEmailCode(
	email: string,
	code: string,
	next: string | null,
): Promise<{ ok: false; message: string }> {
	if (typeof email !== "string" || typeof code !== "string") {
		return CODIGO_INVALIDO;
	}
	const parsedEmail = emailSchema.safeParse(email.trim().toLowerCase());
	const token = code.replace(/\s+/g, "");
	if (!parsedEmail.success || !/^\d{6}$/.test(token)) return CODIGO_INVALIDO;

	let target: string;
	try {
		const supabase = await createServerSupabase();
		const { data, error } = await supabase.auth.verifyOtp({
			email: parsedEmail.data,
			token,
			type: "email",
		});
		if (error || !data.session) return CODIGO_INVALIDO;

		const gate = await completeLogin(supabase);
		target = gate.ok
			? safeNextPath(
					typeof next === "string" ? next : null,
					originFrom(await headers()),
				)
			: gate.landing;
	} catch (error) {
		console.error("verifyEmailCode falló:", error);
		return CODIGO_INVALIDO;
	}
	// Fuera del try: redirect() tira para cortar la acción.
	redirect(target);
}
```

`CODIGO_INVALIDO` no se exporta (`tests/server-actions-exports.test.ts`). Confirmar con `sed -n 1,20p lib/tenants/origin.ts` qué headers lee `originFrom` y ajustar el mock de `next/headers` del test si usa otros.

- [ ] **Step 5: Formulario**

En `app/(auth)/login/login-form.tsx`:

- Importar `verifyEmailCode` junto a `canSignUpByDomain`.
- Estado nuevo: `const [code, setCode] = useState("");`, `const [codeError, setCodeError] = useState<string | null>(null);`, `const [checking, setChecking] = useState(false);`.
- Renombrar `entrarConMagicLink` a `pedirCodigo`; al final, además de `setSent(true)`, `setCode("")` y `setCodeError(null)`.
- Nueva función:

```ts
	async function entrarConCodigo(event: React.FormEvent) {
		event.preventDefault();
		setChecking(true);
		setCodeError(null);
		try {
			// Con éxito la acción redirige y esta promesa no vuelve.
			const result = await verifyEmailCode(email, code, next);
			if (result && !result.ok) setCodeError(result.message);
		} finally {
			setChecking(false);
		}
	}
```

- Reemplazar el bloque `{showEmail ? (<form …>) : null}` y el `{sent ? …}` por:

```tsx
			{showEmail && !sent ? (
				<form className="space-y-3" onSubmit={pedirCodigo}>
					<label className="block text-sm" htmlFor="email">
						Mail
					</label>
					<Input
						autoComplete="email"
						id="email"
						onChange={(event) => setEmail(event.target.value)}
						placeholder="tu@empresa.com"
						required
						type="email"
						value={email}
					/>
					<Button
						className="w-full"
						type="submit"
						variant={oauthMethods.length > 0 ? "outline" : "default"}
					>
						Mandarme un código
					</Button>
				</form>
			) : null}

			{showEmail && sent ? (
				<form className="space-y-3" onSubmit={entrarConCodigo}>
					<p className="text-muted-foreground text-sm" role="status">
						Si {email} tiene acceso, le llega un correo con un código de 6
						dígitos y un link. Usá cualquiera de los dos.
					</p>
					<label className="block text-sm" htmlFor="code">
						Código
					</label>
					<Input
						autoComplete="one-time-code"
						id="code"
						inputMode="numeric"
						maxLength={7}
						onChange={(event) => setCode(event.target.value)}
						placeholder="123456"
						required
						value={code}
					/>
					{codeError ? (
						<p className="text-destructive text-sm" role="alert">
							{codeError}
						</p>
					) : null}
					<Button className="w-full" disabled={checking} type="submit">
						Entrar
					</Button>
					<div className="flex justify-between text-sm">
						<button
							className="underline underline-offset-4"
							onClick={pedirCodigo}
							type="button"
						>
							Mandar otro
						</button>
						<button
							className="underline underline-offset-4"
							onClick={() => setSent(false)}
							type="button"
						>
							Usar otro correo
						</button>
					</div>
				</form>
			) : null}
```

`pedirCodigo` recibe un `FormEvent` y también se usa en un `onClick`: tiparlo como `(event: React.SyntheticEvent)`.

- [ ] **Step 6: Rótulo y plantillas**

`lib/tenants/auth-methods.ts`: `email: "Código por correo",`.

`supabase/templates/magic_link.html`:

```html
<h2>Tu código para entrar</h2>
<p>Escribí este código en la pantalla de ingreso:</p>
<p style="font-size: 28px; letter-spacing: 6px; font-weight: 600;">{{ .Token }}</p>
<p>O entrá directo con este link:</p>
<p><a href="{{ .ConfirmationURL }}">Entrar</a></p>
<p>El código y el link vencen en una hora. Si no pediste entrar, ignorá este correo.</p>
```

`supabase/templates/confirmation.html`: el mismo contenido (es el correo que recibe quien entra por primera vez con un dominio abierto).

En `supabase/config.toml`, después del bloque comentado de `[auth.email.template.invite]`:

```toml
# El correo de ingreso trae el código de 6 dígitos y el link (spec 21.4 §5.2).
# En producción estas dos plantillas se pegan a mano en el panel de Supabase Auth.
[auth.email.template.magic_link]
subject = "Tu código para entrar"
content_path = "./supabase/templates/magic_link.html"

[auth.email.template.confirmation]
subject = "Tu código para entrar"
content_path = "./supabase/templates/confirmation.html"
```

- [ ] **Step 7: Correr y ver que pasa**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Probar contra Supabase local**

Run: `npm run db:start` (reiniciar si ya estaba: `npx supabase stop && npm run db:start`, para que tome las plantillas) y levantar la app con `preview_start`.

Con el correo local (Mailpit, `http://127.0.0.1:54324`) verificar los tres casos y anotar el resultado en el mensaje de commit:

1. **Usuario existente:** pedir código con un usuario de la semilla; el mail trae código y link; el código entra.
2. **Usuario nuevo por dominio abierto:** con una empresa local con ingreso abierto, pedir código con un correo nuevo de ese dominio; llega la plantilla de confirmación con código; el código entra y queda como miembro.
3. **Invitación gastada (spec §5.4):** invitar a un correo desde `/<slug>/settings/usuarios`, no abrir el link de invitación, ir a `/login/<slug>`, pedir código con ese correo y entrar. Tiene que quedar con la membresía de la invitación.

Si el caso 2 o el 3 no entran con `type: "email"`: leer el error de `verifyOtp` en la consola del servidor. Si Supabase pide otro tipo para un usuario sin confirmar, `verifyEmailCode` reintenta una sola vez con `type: "signup"` (caso 2) o `type: "invite"` (caso 3) cuando el primer intento falla, y se agrega el test correspondiente en `tests/auth/verify-email-code.test.ts`. Si el caso 3 no manda correo porque `signInWithOtp` no acepta a un invitado sin confirmar, frenar y avisar: es una decisión de diseño (la spec §5.4 lo marca como requisito de la 21.4a).

- [ ] **Step 9: Commit**

```bash
git add app lib supabase tests
git commit -m "feat: el ingreso por correo acepta un codigo de 6 digitos ademas del link"
```

---

### Task 9: Conectar marca Codex y ChatGPT como probados

**Files:**
- Modify: `lib/connect/instructions.ts`
- Test: `tests/connect/instructions.test.ts`

- [ ] **Step 1: Confirmar los pasos de ChatGPT con Mati**

Antes de tocar el archivo, preguntarle a Mati dos cosas sobre su conexión del 2026-10-10 (cuenta personal, brain de `innovas`): si tuvo que activar el Modo desarrollador en Ajustes avanzados antes de crear el conector, y si ChatGPT pudo escribir con `brain_upsert`. Corregir los `steps` de `chatgpt` según lo que responda. Si no activó nada, se borra el paso del Modo desarrollador y la frase "Hace falta un plan con Modo desarrollador".

- [ ] **Step 2: Test que falla**

En `tests/connect/instructions.test.ts`, reemplazar el caso `"solo Claude Code está probado"` por:

```ts
	it("Claude Code, ChatGPT y Codex están probados", () => {
		expect(
			CLIENTS.filter((client) => instructionsFor(client, target).tested),
		).toEqual(["claude-code", "chatgpt", "codex"]);
	});

	it("ChatGPT avisa que el espacio de trabajo corporativo no está probado", () => {
		expect(instructionsFor("chatgpt", target).steps.at(-1)).toBe(
			"En un espacio de trabajo corporativo puede hacer falta que un administrador permita conectores propios. Ese caso todavía no lo probamos.",
		);
	});
```

Run: `npm test -- tests/connect/instructions.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

En `lib/connect/instructions.ts`: `tested: true` en `chatgpt` y en `codex`; el último paso de `chatgpt` pasa a ser la frase del test; el resto de los pasos, según el Step 1.

- [ ] **Step 4: Correr y commitear**

Run: `npm test && npm run typecheck` → PASS.

```bash
git add lib/connect tests/connect
git commit -m "docs: ChatGPT y Codex figuran como probados en Conectar"
```

---

### Task 10: Recorrido en navegador y roadmap

**Files:**
- Modify: `docs/01-roadmap-etapas.md` (Etapa 21, línea `**Spec/Plan:**` y viñeta 21.4; Etapa 7)

- [ ] **Step 1: Base limpia y app arriba**

Run: `npm run db:reset`, después `preview_start` con la configuración del dev server de `.claude/launch.json`.

- [ ] **Step 2: Recorrido (spec §10), con los usuarios de la semilla**

Como `platform_admin`:

1. `/plataforma/nueva`: crear la empresa `solo-brain` con el agente destildado, método código por correo y un primer administrador. No da error.
2. `/plataforma/solo-brain`: "Crear brain". La sección Agentes no tiene nada habilitado y la empresa figura lista. El brain no tiene `comercial/icp` ni `comercial/hooks`.
3. Categorías: cambiar a `empresa, trigo, comercial, operacion` y guardar. Crear una página en `trigo`, intentar quitar `trigo`: rechaza con el mensaje de la base. Probar `Compras de Trigo`: rechaza con el mensaje del parser.

Como el administrador invitado de `solo-brain` (código leído de Mailpit):

4. Aterriza en `/solo-brain/brain`. El menú muestra Brain, Conectar y Configuración.
5. `/solo-brain/chat`, `/solo-brain/cola` y `/solo-brain/mis-cuentas` dan 404.
6. `/solo-brain/settings` muestra Ingreso y el link a Usuarios; no muestra Modelo, Ejecutores, Aprobaciones ni Conectores.
7. El índice del brain no muestra los chips `canon:*`.
8. Código equivocado: muestra "El código no es correcto o ya venció. Pedí otro." y no entra.

Como un usuario de `demo` (con outreach):

9. Aterriza en `/demo/chat` y ve el menú completo, igual que antes.

De vuelta como `platform_admin`:

10. En `/plataforma/solo-brain`, habilitar outreach: aparecen `comercial/icp` y `comercial/hooks` en borrador, y el menú de la empresa suma Chat y Outreach.

A 375 px de ancho, el login con el campo de código y la sección Brain de la consola no desbordan.

Revisar `read_console_messages` y `preview_logs` sin errores. Sacar captura del paso 4 y del formulario de código.

- [ ] **Step 3: Verificación final**

Run: `npm run typecheck && npm test && npm run db:test && npm run lint:fix`
Expected: todo en verde. Revertir los archivos ajenos que `lint:fix` haya reformateado.

- [ ] **Step 4: Roadmap**

En `docs/01-roadmap-etapas.md`, sección "## Etapa 21":

1. En la línea `**Spec/Plan:**`, reemplazar `21.4 y 21.5: a escribir.` por `21.4: \`docs/superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md\` · 21.4a: \`docs/superpowers/plans/2026-10-11-etapa-21-4a-empresa-sin-agentes.md\` · 21.4b: a escribir. 21.5: a escribir.`
2. Reemplazar la viñeta 21.4 por:

```markdown
- [ ] **21.4 · Segundo tenant.** El segundo tenant es Lagomarsino, que usa solo el brain; el piloto de outreach de la Etapa 7 no aplica. **21.4a (código terminado; falta el cierre en producción):** una empresa puede no tener agentes (alta, aterrizaje en `/<slug>`, menú y pantallas según agentes habilitados), el brain nace sin canon de outreach y con categorías editables desde la consola, y el ingreso por correo acepta un código de 6 dígitos. **Antes de desplegar:** `npx supabase migration list`, aplicar `20261019120000_agentless_tenant` antes que el código y pegar las plantillas `supabase/templates/magic_link.html` y `confirmation.html` en el panel de Supabase Auth. **21.4b:** alta de Lagomarsino desde el navegador, cronometrada.
```

3. En "## Etapa 7", debajo del título, agregar: `> Se corre dentro de la Etapa 21.4 con Lagomarsino, que usa solo el brain. El piloto de 5 contactos de outreach con un segundo tenant sigue sin probar.`

- [ ] **Step 5: Commit**

```bash
git add docs/01-roadmap-etapas.md
git commit -m "docs: roadmap con la 21.4a terminada en codigo"
```

Después: `/ship` para el PR y `/context-save`.
