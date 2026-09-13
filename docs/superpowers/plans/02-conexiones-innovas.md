# Etapa 2 · Conexiones del tenant innovas · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el agente `outreach` obtenga CRM, brain, fuentes de prospectos y casilla de mail de cada tenant desde Vercel Connect, resueltas por tenant en runtime, sin secretos en código, env vars ni base.

**Architecture:** Un registro puro de proveedores (`lib/connectors/providers.ts`) y un catálogo que arma definiciones de eve (`lib/connectors/catalog.ts`). Un único resolver `defineDynamic` lee los bindings del tenant de `tenant_connections` y devuelve el mapa de conexiones. Toda credencial sale de Connect a través de `lib/connectors/auth.ts`, el único archivo que importa `@vercel/connect`; los grants OAuth se atan a `tenant:usuario`.

**Tech Stack:** eve 0.54.2 (`eve/connections`, `eve/tools`, `eve/hooks`), `@vercel/connect` 1.0.0 (`getToken`, `connect` de `@vercel/connect/eve`), Supabase Postgres + pgTAP, Next.js 16, vitest 5, zod, Node 24 (type stripping para el script).

**Spec:** `docs/superpowers/specs/02-conexiones-innovas.md`

**Spike aplicado (2026-09-13, spec §10.1).** Este plan ya incorpora el resultado del spike:
- HubSpot sirve por Connect con una MCP auth app; el mismo conector sirve para MCP y para REST, así que no hay `hubspot-api`.
- ColdIQ no tiene MCP remoto: es una conexión OpenAPI con documento inline y Bearer.
- El brain queda aislado en la Task 5B, bloqueada hasta que termine su rediseño.
- Los tokens de Connect duran ~15 min: se le pasa `expiresAt` a eve.
- El team de Vercel está en Hobby y hay que pasarlo a Pro antes de la Entrega 4.
- Conectores que ya existen: `mcp.hubspot.com/hubspot` y `innovas-coldiq`.

## Global Constraints

- Toda tabla lleva `tenant_id` y RLS. `events` es append-only: nunca UPDATE ni DELETE.
- Nada específico de un tenant en código: va a filas de la base.
- Toda tool con efecto externo lleva `approval` explícito.
- El modelo nunca ve credenciales. Ningún agente crea conectores, carga llaves ni lee tokens: eso lo hace el usuario en su terminal.
- **Ningún archivo fuera de `lib/connectors/auth.ts` importa `@vercel/connect` ni `@vercel/connect/eve`.**
- **Todo grant OAuth usa `subject.id = "<tenantId>:<userId>"`** vía `tenantScopedConnect`. Nunca `connect()` directo.
- Imports relativos dentro de `agents/` y en todo `lib/` que importen los agentes o hooks; alias `@/` solo en `app/` y `tests/`.
- Antes de escribir código de eve, leer `node_modules/eve/docs/README.md` y la guía del slot que se toca. Si la API real no coincide con este plan, la fuente de verdad es `node_modules/eve` (docs y `dist/src/**/*.d.ts`); anotar la diferencia en la spec antes de seguir.
- Antes de tocar SQL, cargar la skill `supabase-postgres-best-practices`. Helpers de RLS envueltos en `(select ...)`.
- Supabase da privilegios por defecto a `anon` en todo objeto nuevo de `public`: revocar explícito `from anon`, no alcanza con `from public`.
- `npx supabase db push` lo corre el usuario (pide la contraseña de producción). Nunca un agente.
- Español rioplatense en UI, descripciones para el modelo, mensajes de error y comentarios. Código e identificadores en inglés.
- Comandos: `npm run typecheck` · `npm test` · `npm run lint:fix` · `npm run db:test` (Docker abierto).
- Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:`, `test:` y la línea `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `@vercel/connect` fijado en `1.0.0` exacto (sin `^`).

## File Structure

| Archivo | Responsabilidad | Task |
|---|---|---|
| `lib/connectors/platform.ts` | Constantes de plataforma verificadas en el spike (UIDs, URLs, tools de HubSpot). No secretas | 1 |
| `supabase/migrations/<ts>_tenant_connections_executors.sql` | Enum, `tenant_connections`, `executors`, RLS y grants | 2 |
| `supabase/tests/06_tenant_connections.test.sql` | Aislamiento y bloqueo de escritura | 2 |
| `lib/connectors/providers.ts` | Registro puro de proveedores y `Binding`. Sin imports: lo importa el script de Node | 3 |
| `lib/connectors/auth.ts` | Único puente con Connect: `apiKeyHeaders`, `apiKeyBearer`, `tenantScopedConnect` | 4 |
| `lib/connectors/leads/google-places.openapi.ts` | Documento OpenAPI mínimo de Places | 5 |
| `lib/connectors/leads/coldiq.openapi.ts` | Documento OpenAPI inline de ColdIQ: 7 operaciones individuales de "GTM Verbs" | 5 |
| `lib/connectors/catalog.ts` | Builders por proveedor y `buildTenantConnections` | 5, 5B, 8 |
| `lib/connectors/bindings.ts` | Lectura de bindings con el cliente admin | 6 |
| `lib/connectors/resolve.ts` | `resolveTenantConnections`: lógica del resolver, testeable | 6 |
| `agents/outreach/connections/tenant.ts` | El `defineDynamic` | 6 |
| `scripts/connections-bind.mts` | Alta de bindings sin secretos | 7 |
| `lib/connectors/crm/hubspot.ts` | Esquema de propiedades de outreach y `ensureOutreachProperties` | 9 |
| `agents/outreach/tools/crm_setup_outreach_properties.ts` | Tool con aprobación | 9 |
| `lib/gmail/send.ts` | Envío con access token recibido | 10 |
| `agents/outreach/tools/send_email.ts` | Token de Gmail vía Connect | 10 |
| `lib/connectors/executors.ts` | `markGmailAuthorized` | 11 |
| `agents/outreach/hooks/executors.ts` | Hook de `authorization.completed` | 11 |
| `app/[tenant]/chat/chat-client.tsx` | Render del pedido de autorización | 12 |
| `supabase/migrations/<ts>_drop_google_tokens.sql`, `app/auth/callback/route.ts`, `app/(auth)/login/page.tsx` | Baja de `google_tokens` | 13 |

---

## Entrega 1 · Precondiciones

### Task 1: Gate del spike y constantes de plataforma

**Files:**
- Create: `lib/connectors/platform.ts`
- Test: `tests/connectors/platform.test.ts`

**Interfaces:**
- Consumes: la sección `## 10.1 Resultado del spike` de la spec (commit `a5fd05b`).
- Produces:
  ```ts
  export const HUBSPOT_MCP_URL: string;
  export const HUBSPOT_CONNECTOR_UID: string;
  export const HUBSPOT_READ_TOOLS: readonly string[];
  export const HUBSPOT_SEARCH_CONTACTS_TOOL: string;
  export const GOOGLE_CONNECTOR_UID: string;
  export const COLDIQ_BASE_URL: string;
  ```

El UID del conector de HubSpot sirve también para la API REST (S3): no hay constante aparte. Las operaciones de ColdIQ no viven acá sino en `lib/connectors/leads/coldiq.openapi.ts` (Task 5).

- [ ] **Step 1: Verificar que la tarea de hardening de `anon` está en la rama**

Run: `ls supabase/migrations/ | sort | tail -3 && grep -l "from anon" $(ls supabase/migrations/*.sql | sort | tail -2)`
Expected: existe al menos una migración con timestamp posterior a `20260913014533` que revoca privilegios a `anon`. Si no existe: **STOP**. Reportar BLOCKED: "falta mergear la tarea de hardening de anon antes de escribir migraciones de la Etapa 2".

- [ ] **Step 2: Verificar que el spike está escrito**

Run: `grep -n "## 10.1 Resultado del spike" -A 40 docs/superpowers/specs/02-conexiones-innovas.md`
Expected: una tabla con filas S1 a S6. Si no está: **STOP**. Reportar BLOCKED: "falta traer el commit del spike a la rama".

- [ ] **Step 3: Estado del brain**

El spike no invalidó el diseño: S1 salió positivo y S5 es positivo en la mecánica. Lo único abierto es el brain, cuya arquitectura se rediseña aparte. Revisar spec §6.2:
- Si todavía tiene el aviso **"En suspenso"**, la Task 5B queda BLOCKED y **no se implementa**. El resto de la etapa sigue igual, sin frenar.
- Si §6.2 ya fue reescrita por el rediseño, adaptar la Task 5B a esa sección antes de ejecutarla. Si el brain dejó de ser un MCP remoto con llave, reportar NEEDS_CONTEXT con el texto nuevo de §6.2.

- [ ] **Step 4: Verificar los conectores de plataforma**

Run: `vercel connect list --format json | jq -r '.[] | [.uid, .service, .type] | @tsv'`
Expected: aparecen `mcp.hubspot.com/hubspot` (oauth), `innovas-coldiq` (api-key) y un conector de Google (`service` google, `type` oauth). Si falta el de Google: **STOP**. Reportar NEEDS_CONTEXT: "el usuario tiene que crear y atar el conector de Google según spec §9.2 y pasar su UID". Si el formato de `--format json` no es un array, ajustar el `jq` mirando la salida; no inventar UIDs.

- [ ] **Step 5: Escribir el test de forma**

```ts
// tests/connectors/platform.test.ts
import { describe, expect, it } from "vitest";
import * as platform from "@/lib/connectors/platform";

describe("constantes de plataforma del spike", () => {
	it("tiene UIDs y URLs no vacíos", () => {
		for (const value of [
			platform.HUBSPOT_MCP_URL,
			platform.HUBSPOT_CONNECTOR_UID,
			platform.GOOGLE_CONNECTOR_UID,
			platform.COLDIQ_BASE_URL,
		]) {
			expect(value.trim()).not.toBe("");
		}
	});

	it("las URLs son https", () => {
		expect(platform.HUBSPOT_MCP_URL).toMatch(/^https:\/\//);
		expect(platform.COLDIQ_BASE_URL).toMatch(/^https:\/\//);
	});

	it("la tool de búsqueda de contactos está entre las de lectura", () => {
		expect(platform.HUBSPOT_READ_TOOLS).toContain(
			platform.HUBSPOT_SEARCH_CONTACTS_TOOL,
		);
	});

	it("HubSpot no expone tools de escritura", () => {
		for (const tool of platform.HUBSPOT_READ_TOOLS) {
			expect(tool).not.toMatch(/^(manage_|submit_)/);
		}
	});
});
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `npm test -- tests/connectors/platform.test.ts`
Expected: FAIL, "Cannot find module '@/lib/connectors/platform'".

- [ ] **Step 7: Escribir las constantes**

Todos los valores salen de spec §10.1, salvo `GOOGLE_CONNECTOR_UID`, que sale del Step 4:

```ts
// lib/connectors/platform.ts
// Valores de plataforma verificados en el spike de la Etapa 2
// (docs/superpowers/specs/02-conexiones-innovas.md §10.1). No son secretos:
// son identificadores de conectores de Vercel Connect y nombres de tools.
// Si cambian, se cambian acá y en la spec, en el mismo commit.

export const HUBSPOT_MCP_URL = "https://mcp.hubspot.com/";
// También autoriza la API REST de HubSpot (S3): no hay conector aparte.
export const HUBSPOT_CONNECTOR_UID = "mcp.hubspot.com/hubspot";
export const HUBSPOT_READ_TOOLS = [
	"search_crm_objects",
	"get_crm_objects",
	"get_properties",
	"search_properties",
	"discover_hubspot_schema",
	"search_owners",
	"get_user_details",
] as const satisfies readonly string[];
export const HUBSPOT_SEARCH_CONTACTS_TOOL = "search_crm_objects";

export const GOOGLE_CONNECTOR_UID = "<Step 4>";

export const COLDIQ_BASE_URL = "https://api.coldiq.com";
```

`<Step 4>` es el UID real del conector de Google: el archivo commiteado no puede contener ningún `<`.

- [ ] **Step 8: Correr el test**

Run: `npm test -- tests/connectors/platform.test.ts && grep -c "<" lib/connectors/platform.ts`
Expected: PASS y `0`.

- [ ] **Step 9: Commit**

```bash
git add lib/connectors/platform.ts tests/connectors/platform.test.ts
git commit -m "feat: constantes de plataforma de connect verificadas en el spike"
```

---

## Entrega 2 · Datos y camino API key

### Task 2: Migración de `tenant_connections` y `executors`

**Files:**
- Create: `supabase/migrations/<timestamp>_tenant_connections_executors.sql` (generar con `npx supabase migration new tenant_connections_executors`)
- Test: `supabase/tests/06_tenant_connections.test.sql`

**Interfaces:**
- Consumes: `public.tenants`, `public.is_member_of(tenant uuid)`, `public.is_platform_admin()` (Etapa 1).
- Produces: `public.connector_capability`, `public.tenant_connections`, `public.executors` con las columnas de spec §3.2 y §3.3.

- [ ] **Step 1: Escribir el test pgTAP**

```sql
-- supabase/tests/06_tenant_connections.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a6a6a6a6-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@conexiones-a.test', now()),
  ('a6a6a6a6-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@conexiones-b.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'conexiones-a', 'Conexiones A'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'conexiones-b', 'Conexiones B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000001', 'tenant_admin'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'a6a6a6a6-0000-0000-0000-000000000002', 'tenant_admin');

insert into public.tenant_connections (tenant_id, capability, provider, connector_uid, config)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'brain', 'innovas-brains', 'conexiones-a-brain', '{"url":"https://brain-a.test/mcp"}'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'brain', 'innovas-brains', 'conexiones-b-brain', '{"url":"https://brain-b.test/mcp"}');

insert into public.executors (tenant_id, user_id)
values
  ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000001'),
  ('b6b6b6b6-0000-0000-0000-00000000000b', 'a6a6a6a6-0000-0000-0000-000000000002');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a6a6a6a6-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.tenant_connections where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'),
  1,
  'un miembro ve los bindings de su tenant'
);

select is(
  (select count(*)::int from public.tenant_connections where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000b'),
  0,
  'un miembro no ve los bindings de otro tenant'
);

select is(
  (select count(*)::int from public.executors where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000b'),
  0,
  'un miembro no ve los ejecutores de otro tenant'
);

select throws_ok(
  $$insert into public.tenant_connections (tenant_id, capability, provider)
     values ('b6b6b6b6-0000-0000-0000-00000000000a', 'crm', 'hubspot')$$,
  '42501', null,
  'ni un tenant_admin puede crear bindings: los escribe solo el servidor'
);

select throws_ok(
  $$update public.tenant_connections set connector_uid = 'conexiones-b-brain'
     where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'$$,
  '42501', null,
  'nadie con rol authenticated puede reapuntar un binding a otro conector'
);

select throws_ok(
  $$delete from public.tenant_connections where tenant_id = 'b6b6b6b6-0000-0000-0000-00000000000a'$$,
  '42501', null,
  'authenticated no puede borrar bindings'
);

select throws_ok(
  $$insert into public.executors (tenant_id, user_id)
     values ('b6b6b6b6-0000-0000-0000-00000000000a', 'a6a6a6a6-0000-0000-0000-000000000002')$$,
  '42501', null,
  'authenticated no puede escribir ejecutores'
);

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.tenant_connections$$,
  '42501', null,
  'anon no puede leer bindings'
);

select throws_ok(
  $$select count(*) from public.executors$$,
  '42501', null,
  'anon no puede leer ejecutores'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm run db:test`
Expected: FAIL en `06_tenant_connections.test.sql` con "relation public.tenant_connections does not exist".

- [ ] **Step 3: Escribir la migración**

Run: `npx supabase migration new tenant_connections_executors`

```sql
-- Bindings de un tenant con un proveedor de conector, y ejecutores de outreach.
-- Las credenciales NO viven acá: `connector_uid` es el identificador (no
-- secreto) de un conector de Vercel Connect. Spec 02 §3.

create type public.connector_capability as enum ('crm', 'leads', 'enrichment', 'brain', 'mail');

create table public.tenant_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  capability public.connector_capability not null,
  -- Se valida contra el registro de lib/connectors/providers.ts en código;
  -- el check solo impide basura. Sumar un proveedor no requiere migración.
  provider text not null check (provider ~ '^[a-z][a-z0-9-]{0,40}$'),
  connector_uid text check (connector_uid is null or length(connector_uid) between 1 and 200),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- La unique tiene tenant_id como primera columna: sirve de índice para la
  -- RLS y para la consulta del resolver, no hace falta otro.
  unique (tenant_id, capability, provider)
);

create table public.executors (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  daily_quota integer not null default 30 check (daily_quota >= 0),
  gmail_authorized_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index executors_user_id_idx on public.executors (user_id);

alter table public.tenant_connections enable row level security;
alter table public.executors enable row level security;

create policy tenant_connections_select on public.tenant_connections
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

create policy executors_select on public.executors
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

-- Sin políticas de escritura y además sin privilegio: un binding reapuntado a
-- otro conector es acceso a las credenciales de otro tenant. Escribe solo el
-- servidor con la service role (scripts/connections-bind.mts, hooks).
revoke insert, update, delete on public.tenant_connections from authenticated, anon;
revoke insert, update, delete on public.executors from authenticated, anon;
revoke select on public.tenant_connections from anon;
revoke select on public.executors from anon;
```

- [ ] **Step 4: Correr los tests**

Run: `npm run db:test`
Expected: PASS, `All tests successful`, incluidos los 9 de `06_tenant_connections.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_tenant_connections_executors.sql supabase/tests/06_tenant_connections.test.sql
git commit -m "feat: tenant_connections y executors con rls y escritura solo del servidor"
```

### Task 3: Registro de proveedores

**Files:**
- Create: `lib/connectors/providers.ts`
- Modify: `tsconfig.json` (agregar `"allowImportingTsExtensions": true` en `compilerOptions`)
- Test: `tests/connectors/providers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Capability = "crm" | "leads" | "enrichment" | "brain" | "mail";
  export interface ProviderInfo { capability: Capability; multiple: boolean; kind: "connection" | "tool"; authKind: "connect_api_key" | "connect_oauth" }
  export const PROVIDERS: { hubspot; "innovas-brains"; coldiq; "google-places"; gmail };
  export type ProviderKey = keyof typeof PROVIDERS;
  export interface Binding { id: string; tenantId: string; capability: Capability; provider: string; connectorUid: string | null; config: Record<string, unknown> }
  export function isProviderKey(value: string): value is ProviderKey;
  export function connectionName(provider: ProviderKey): string;
  ```

Este archivo **no importa nada** y usa solo sintaxis de tipos borrable (sin `enum`, sin `namespace`): lo ejecuta Node directo desde el script de la Task 7.

- [ ] **Step 1: Escribir el test**

```ts
// tests/connectors/providers.test.ts
import { describe, expect, it } from "vitest";
import {
	connectionName,
	isProviderKey,
	PROVIDERS,
} from "@/lib/connectors/providers";

describe("registro de proveedores", () => {
	it("nombra la conexión por capacidad cuando admite un solo proveedor", () => {
		expect(connectionName("hubspot")).toBe("crm");
		expect(connectionName("innovas-brains")).toBe("brain");
	});

	it("nombra capacidad-proveedor cuando admite varios", () => {
		expect(connectionName("coldiq")).toBe("leads-coldiq");
		expect(connectionName("google-places")).toBe("leads-google-places");
	});

	it("todo nombre cumple la regla de eve", () => {
		for (const key of Object.keys(PROVIDERS)) {
			if (!isProviderKey(key)) throw new Error(key);
			expect(connectionName(key)).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
		}
	});

	it("reconoce solo proveedores del registro", () => {
		expect(isProviderKey("hubspot")).toBe(true);
		expect(isProviderKey("salesforce")).toBe(false);
		expect(isProviderKey("toString")).toBe(false);
	});

	it("gmail es una tool, no una conexión", () => {
		expect(PROVIDERS.gmail.kind).toBe("tool");
	});
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -- tests/connectors/providers.test.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Implementar**

```ts
// lib/connectors/providers.ts
// Registro puro de proveedores de conectores (spec 02 §4). Sin imports y solo
// con sintaxis de tipos borrable: scripts/connections-bind.mts lo ejecuta con
// Node directo, sin bundler.

export type Capability = "crm" | "leads" | "enrichment" | "brain" | "mail";

export interface ProviderInfo {
	capability: Capability;
	/** La capacidad admite varios proveedores por tenant. */
	multiple: boolean;
	/** "tool": no produce conexión de eve (Gmail la usa una tool propia). */
	kind: "connection" | "tool";
	authKind: "connect_api_key" | "connect_oauth";
}

export const PROVIDERS = {
	hubspot: {
		capability: "crm",
		multiple: false,
		kind: "connection",
		authKind: "connect_oauth",
	},
	"innovas-brains": {
		capability: "brain",
		multiple: false,
		kind: "connection",
		authKind: "connect_api_key",
	},
	coldiq: {
		capability: "leads",
		multiple: true,
		kind: "connection",
		authKind: "connect_api_key",
	},
	"google-places": {
		capability: "leads",
		multiple: true,
		kind: "connection",
		authKind: "connect_api_key",
	},
	gmail: {
		capability: "mail",
		multiple: false,
		kind: "tool",
		authKind: "connect_oauth",
	},
} as const satisfies Record<string, ProviderInfo>;

export type ProviderKey = keyof typeof PROVIDERS;

export interface Binding {
	id: string;
	tenantId: string;
	capability: Capability;
	provider: string;
	connectorUid: string | null;
	config: Record<string, unknown>;
}

export function isProviderKey(value: string): value is ProviderKey {
	return Object.hasOwn(PROVIDERS, value);
}

export function connectionName(provider: ProviderKey): string {
	const info = PROVIDERS[provider];
	return info.multiple ? `${info.capability}-${provider}` : info.capability;
}
```

- [ ] **Step 4: Habilitar imports con extensión `.ts` para el script**

En `tsconfig.json`, dentro de `compilerOptions`, agregar `"allowImportingTsExtensions": true,` debajo de `"noEmit": true,`. Es válido porque el proyecto ya tiene `noEmit`.

- [ ] **Step 5: Correr test y typecheck**

Run: `npm test -- tests/connectors/providers.test.ts && npm run typecheck`
Expected: PASS y typecheck sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/providers.ts tests/connectors/providers.test.ts tsconfig.json
git commit -m "feat: registro puro de proveedores de conectores"
```

### Task 4: Puente con Vercel Connect

**Files:**
- Create: `lib/connectors/auth.ts`
- Modify: `package.json` (`"@vercel/connect": "1.0.0"`, sin `^`, si hoy tiene rango)
- Test: `tests/connectors/auth.test.ts`, `tests/connectors/import-rule.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function tenantSubjectId(tenantId: string, userId: string): string;
  export function apiKeyHeaders(connectorUid: string, header: string, extra?: Record<string, string>): () => Promise<Record<string, string>>;
  export function apiKeyBearer(connectorUid: string): { getToken: () => Promise<{ token: string; expiresAt: number }> };
  export function tenantScopedConnect(connector: string, tenantId: string, scopes?: string[]): ReturnType<typeof connect>;
  ```

- [ ] **Step 1: Leer la doc del slot**

Leer `node_modules/eve/docs/connections/overview.mdx` (secciones "Headers", "Per-caller auth and headers", "Interactive OAuth via Vercel Connect") y `node_modules/@vercel/connect/dist/eve/connection-authorization.d.ts` (opción `createSubject`).

- [ ] **Step 2: Escribir los tests**

```ts
// tests/connectors/auth.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	getToken: [] as unknown[][],
	connect: [] as Record<string, unknown>[],
}));

vi.mock("@vercel/connect", () => ({
	getToken: async (...args: unknown[]) => {
		calls.getToken.push(args);
		return "llave-simulada";
	},
	getTokenResponse: async (...args: unknown[]) => {
		calls.getToken.push(args);
		return { token: "llave-simulada", expiresAt: 1_789_325_386_769 };
	},
}));

vi.mock("@vercel/connect/eve", () => ({
	connect: (options: Record<string, unknown>) => {
		calls.connect.push(options);
		return { principalType: "user", options };
	},
}));

const { apiKeyBearer, apiKeyHeaders, tenantScopedConnect, tenantSubjectId } =
	await import("@/lib/connectors/auth");

type CreateSubject = (principal: {
	type: "user" | "app";
	id?: string;
	issuer?: string;
}) => { type: string; id: string; issuer?: string };

beforeEach(() => {
	calls.getToken = [];
	calls.connect = [];
});

describe("apiKeyHeaders", () => {
	it("pide la llave al conector del binding como app y la pone en el header", async () => {
		const headers = apiKeyHeaders("innovas-brain", "x-api-key");
		expect(await headers()).toEqual({ "x-api-key": "llave-simulada" });
		expect(calls.getToken[0]).toEqual([
			"innovas-brain",
			{ subject: { type: "app" } },
		]);
	});

	it("suma headers fijos sin pisar la llave", async () => {
		const headers = apiKeyHeaders("innovas-places", "X-Goog-Api-Key", {
			"X-Goog-FieldMask": "places.id",
		});
		expect(await headers()).toEqual({
			"X-Goog-Api-Key": "llave-simulada",
			"X-Goog-FieldMask": "places.id",
		});
	});
});

describe("apiKeyBearer", () => {
	it("devuelve la llave como token con el vencimiento de Connect", async () => {
		expect(await apiKeyBearer("innovas-coldiq").getToken()).toEqual({
			token: "llave-simulada",
			expiresAt: 1_789_325_386_769,
		});
		expect(calls.getToken[0]).toEqual([
			"innovas-coldiq",
			{ subject: { type: "app" } },
		]);
	});
});

describe("tenantScopedConnect", () => {
	it("ata el grant a tenant:usuario", () => {
		tenantScopedConnect("hubspot-mcp", "tenant-a");
		const createSubject = calls.connect[0].createSubject as CreateSubject;
		expect(
			createSubject({ type: "user", id: "user-1", issuer: "https://sb" }),
		).toEqual({ type: "user", id: "tenant-a:user-1", issuer: "https://sb" });
	});

	it("el mismo usuario en dos tenants da dos subjects distintos", () => {
		tenantScopedConnect("hubspot-mcp", "tenant-a");
		tenantScopedConnect("hubspot-mcp", "tenant-b");
		const principal = { type: "user" as const, id: "user-1" };
		const a = (calls.connect[0].createSubject as CreateSubject)(principal);
		const b = (calls.connect[1].createSubject as CreateSubject)(principal);
		expect(a.id).not.toBe(b.id);
	});

	it("rechaza un principal app", () => {
		tenantScopedConnect("hubspot-mcp", "tenant-a");
		const createSubject = calls.connect[0].createSubject as CreateSubject;
		expect(() => createSubject({ type: "app" })).toThrow();
	});

	it("rechaza tenant vacío", () => {
		expect(() => tenantScopedConnect("hubspot-mcp", "")).toThrow();
	});

	it("pasa los scopes a Connect", () => {
		tenantScopedConnect("google", "tenant-a", ["https://mail.google.com/x"]);
		expect(calls.connect[0].tokenParams).toEqual({
			scopes: ["https://mail.google.com/x"],
		});
	});

	it("arma el id del subject con separador fijo", () => {
		expect(tenantSubjectId("t", "u")).toBe("t:u");
	});
});
```

```ts
// tests/connectors/import-rule.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["agents", "app", "lib", "scripts"];
const SKIP = new Set(["node_modules", ".eve", ".next"]);
const ALLOWED = "lib/connectors/auth.ts";

function walk(dir: string, out: string[]): string[] {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.(ts|tsx|mts)$/.test(name)) out.push(path);
	}
	return out;
}

describe("regla de import de Vercel Connect", () => {
	it("solo lib/connectors/auth.ts importa @vercel/connect", () => {
		const offenders = SCAN.flatMap((dir) => walk(join(ROOT, dir), []))
			.filter((file) =>
				/from\s+["']@vercel\/connect(\/[^"']*)?["']/.test(
					readFileSync(file, "utf8"),
				),
			)
			.map((file) => relative(ROOT, file))
			.filter((file) => file !== ALLOWED);
		expect(offenders).toEqual([]);
	});
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `npm test -- tests/connectors/auth.test.ts tests/connectors/import-rule.test.ts`
Expected: `auth.test.ts` FAIL por módulo inexistente; `import-rule.test.ts` PASS (todavía nadie importa Connect).

- [ ] **Step 4: Implementar**

```ts
// lib/connectors/auth.ts
// Único puente con Vercel Connect (spec 02 §5.2). Ningún otro archivo importa
// @vercel/connect: tests/connectors/import-rule.test.ts lo hace cumplir.
import { getToken, getTokenResponse } from "@vercel/connect";
import { connect } from "@vercel/connect/eve";

export function tenantSubjectId(tenantId: string, userId: string): string {
	return `${tenantId}:${userId}`;
}

// Un conector api-key se pide como app: Connect devuelve la llave cruda, sin
// prefijo (spec 02 §10.1 S5). El SDK la cachea en proceso hasta expiresAt.
const APP_SUBJECT = { subject: { type: "app" } } as const;

/**
 * Headers para un conector `api-key`. Se resuelven en cada llamada: la llave
 * nunca queda en el closure del resolver ni en el estado de la sesión.
 */
export function apiKeyHeaders(
	connectorUid: string,
	header: string,
	extra: Record<string, string> = {},
): () => Promise<Record<string, string>> {
	return async () => ({
		...extra,
		[header]: await getToken(connectorUid, APP_SUBJECT),
	});
}

/** Bearer con `expiresAt`: eve renueva antes de que venza en vez de esperar un 401. */
export function apiKeyBearer(connectorUid: string): {
	getToken: () => Promise<{ token: string; expiresAt: number }>;
} {
	return {
		getToken: async () => {
			const { token, expiresAt } = await getTokenResponse(connectorUid, APP_SUBJECT);
			return { token, expiresAt };
		},
	};
}

/**
 * OAuth por usuario, atado a tenant:usuario. Connect guarda por defecto el
 * grant solo por usuario: sin esto, alguien con memberships en dos tenants
 * usaría la cuenta de un tenant dentro del otro (spec 02 D5).
 */
export function tenantScopedConnect(
	connector: string,
	tenantId: string,
	scopes?: string[],
) {
	if (!tenantId) {
		throw new Error("tenantScopedConnect requiere el tenant de la sesión");
	}
	return connect({
		connector,
		...(scopes ? { tokenParams: { scopes } } : {}),
		createSubject: (principal) => {
			if (principal.type !== "user") {
				throw new Error(
					"las conexiones OAuth por tenant requieren un usuario autenticado",
				);
			}
			return {
				type: "user",
				id: tenantSubjectId(tenantId, principal.id),
				...(principal.issuer ? { issuer: principal.issuer } : {}),
			};
		},
	});
}
```

Si `tsc` rechaza `APP_SUBJECT` contra `ConnectTokenParams`, tiparlo con ese tipo exportado por `@vercel/connect` en lugar de `as const`.

- [ ] **Step 5: Fijar la versión de `@vercel/connect`**

Run: `grep '"@vercel/connect"' package.json`
Si el valor tiene `^` o `~`, dejarlo en `"1.0.0"` y correr `npm install`.

- [ ] **Step 6: Tests y typecheck**

Run: `npm test -- tests/connectors && npm run typecheck`
Expected: PASS y sin errores de tipos.

- [ ] **Step 7: Commit**

```bash
git add lib/connectors/auth.ts tests/connectors/auth.test.ts tests/connectors/import-rule.test.ts package.json package-lock.json
git commit -m "feat: puente con vercel connect con grants atados a tenant y usuario"
```

### Task 5: Catálogo con los conectores de API key

**Files:**
- Create: `lib/connectors/leads/google-places.openapi.ts`, `lib/connectors/leads/coldiq.openapi.ts`, `lib/connectors/catalog.ts`
- Test: `tests/connectors/catalog.test.ts`, `tests/connectors/coldiq-openapi.test.ts`

**Interfaces:**
- Consumes: `Binding`, `PROVIDERS`, `isProviderKey`, `connectionName` (Task 3); `apiKeyHeaders`, `apiKeyBearer` (Task 4); `COLDIQ_BASE_URL` (Task 1).
- Produces:
  ```ts
  export const GOOGLE_PLACES_FIELD_MASK: string;
  export const COLDIQ_OPERATIONS: readonly string[]; // coldiq.openapi.ts
  export const coldiqOpenApi: object;                // coldiq.openapi.ts
  export function buildTenantConnections(bindings: Binding[]): Record<string, DynamicConnectionDefinition>;
  ```

El brain **no** entra en esta task: está en la Task 5B, bloqueada por su rediseño. Mientras no exista su builder, un binding `brain` se omite con el warn de "binding incompleto".

- [ ] **Step 1: Leer la doc**

`node_modules/eve/docs/connections/openapi.mdx` (`spec` inline, `baseUrl`, `operations.allow`, operaciones sin `operationId`) y `node_modules/eve/docs/connections/overview.mdx` §Static-token auth (`expiresAt`).

- [ ] **Step 2: Escribir el test**

```ts
// tests/connectors/catalog.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connectors/auth", () => ({
	apiKeyHeaders: (uid: string, header: string, extra = {}) =>
		Object.assign(async () => ({ ...extra, [header]: `llave:${uid}` }), {
			uid,
			header,
		}),
	apiKeyBearer: (uid: string) => ({ uid, getToken: async () => ({ token: uid }) }),
	tenantScopedConnect: (connector: string, tenantId: string) => ({
		connector,
		tenantId,
	}),
}));

const { buildTenantConnections, GOOGLE_PLACES_FIELD_MASK } = await import(
	"@/lib/connectors/catalog"
);
const platform = await import("@/lib/connectors/platform");
const { COLDIQ_OPERATIONS, coldiqOpenApi } = await import(
	"@/lib/connectors/leads/coldiq.openapi"
);
import type { Binding } from "@/lib/connectors/providers";

type AnyConnection = Record<string, unknown>;

function binding(overrides: Partial<Binding>): Binding {
	return {
		id: "binding-1",
		tenantId: "tenant-a",
		capability: "brain",
		provider: "innovas-brains",
		connectorUid: "tenant-a-brain",
		config: { url: "https://brain.test/mcp" },
		...overrides,
	};
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("leads", () => {
	const coldiq = binding({
		id: "binding-coldiq",
		capability: "leads",
		provider: "coldiq",
		connectorUid: "tenant-a-coldiq",
		config: {},
	});
	const places = binding({
		id: "binding-places",
		capability: "leads",
		provider: "google-places",
		connectorUid: "tenant-a-places",
		config: {},
	});

	it("dos proveedores de leads dan dos conexiones con nombres distintos", () => {
		const result = buildTenantConnections([coldiq, places]);
		expect(Object.keys(result).sort()).toEqual([
			"leads-coldiq",
			"leads-google-places",
		]);
	});

	it("ColdIQ es OpenAPI inline con Bearer del conector del binding", async () => {
		const result = buildTenantConnections([coldiq]) as Record<
			string,
			AnyConnection
		>;
		const connection = result["leads-coldiq"];
		expect(connection.baseUrl).toBe(platform.COLDIQ_BASE_URL);
		expect(connection.spec).toBe(coldiqOpenApi);
		expect(connection.operations).toEqual({ allow: [...COLDIQ_OPERATIONS] });
		expect(connection.instanceKey).toBe("binding-coldiq");
		expect(connection.approval).toBeUndefined();
		const auth = connection.auth as { uid: string };
		expect(auth.uid).toBe("tenant-a-coldiq");
	});

	it("ColdIQ se omite sin conector", () => {
		expect(
			buildTenantConnections([{ ...coldiq, connectorUid: null }]),
		).toEqual({});
		expect(warn).toHaveBeenCalled();
	});

	it("Places expone solo searchText con field mask fijo", async () => {
		const result = buildTenantConnections([places]) as Record<
			string,
			AnyConnection
		>;
		const connection = result["leads-google-places"];
		expect(connection.operations).toEqual({ allow: ["searchText"] });
		expect(connection.baseUrl).toBe("https://places.googleapis.com");
		const headers = connection.headers as () => Promise<Record<string, string>>;
		expect(await headers()).toEqual({
			"X-Goog-Api-Key": "llave:tenant-a-places",
			"X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
		});
	});
});

describe("buildTenantConnections", () => {
	it("omite proveedores desconocidos", () => {
		expect(
			buildTenantConnections([binding({ provider: "salesforce" })]),
		).toEqual({});
		expect(warn).toHaveBeenCalled();
	});

	it("un tenant sin bindings no tiene conexiones", () => {
		expect(buildTenantConnections([])).toEqual({});
	});

	it("omite un binding cuya capacidad no coincide con la del proveedor", () => {
		expect(
			buildTenantConnections([binding({ capability: "crm" })]),
		).toEqual({});
	});
});
```

```ts
// tests/connectors/coldiq-openapi.test.ts
import { describe, expect, it } from "vitest";
import {
	COLDIQ_OPERATIONS,
	coldiqOpenApi,
} from "@/lib/connectors/leads/coldiq.openapi";

type Schema = { type?: string; properties?: Record<string, Schema>; maximum?: number };
type Operation = {
	operationId: string;
	requestBody: { content: { "application/json": { schema: Schema } } };
};
const paths = (coldiqOpenApi as { paths: Record<string, { post: Operation }> }).paths;
const operations = Object.entries(paths).map(([path, item]) => ({ path, op: item.post }));

describe("documento OpenAPI de ColdIQ", () => {
	it("tiene exactamente las operaciones permitidas, con operationId", () => {
		expect(operations.map((o) => o.op.operationId).sort()).toEqual(
			[...COLDIQ_OPERATIONS].sort(),
		);
	});

	it("no incluye operaciones bulk", () => {
		for (const { path } of operations) expect(path).not.toMatch(/bulk|jobs/);
	});

	it("el body solo acepta input individual: sin lotes, proveedor ni tope de créditos", () => {
		for (const { op } of operations) {
			const body = op.requestBody.content["application/json"].schema;
			expect(Object.keys(body.properties ?? {})).toEqual(["input"]);
			expect(body.properties?.input.type).toBe("object");
		}
	});

	it("ningún límite de resultados supera 25", () => {
		for (const { op } of operations) {
			const input = op.requestBody.content["application/json"].schema.properties?.input;
			const limit = input?.properties?.limit;
			if (limit) expect(limit.maximum).toBeLessThanOrEqual(25);
		}
	});
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `npm test -- tests/connectors/catalog.test.ts tests/connectors/coldiq-openapi.test.ts`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 4: Escribir el documento OpenAPI de Places**

```ts
// lib/connectors/leads/google-places.openapi.ts
// Subconjunto escrito a mano de Places API (New): Google no publica OpenAPI.
// Solo searchText; ver spec 02 §6.4 para por qué no está getPlace.
export const googlePlacesOpenApi = {
	openapi: "3.0.3",
	info: { title: "Google Places API (New), subconjunto", version: "1" },
	servers: [{ url: "https://places.googleapis.com" }],
	paths: {
		"/v1/places:searchText": {
			post: {
				operationId: "searchText",
				summary:
					"Busca negocios por texto libre con rubro y zona, por ejemplo 'inmobiliarias en Córdoba'.",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["textQuery"],
								properties: {
									textQuery: {
										type: "string",
										description: "Rubro y zona en lenguaje natural.",
									},
									languageCode: {
										type: "string",
										description: "Idioma de los resultados, por ejemplo es.",
									},
									regionCode: {
										type: "string",
										description: "País en código CLDR de dos letras, por ejemplo AR.",
									},
									pageSize: { type: "integer", minimum: 1, maximum: 20 },
									pageToken: {
										type: "string",
										description: "Token de la página siguiente, si la respuesta anterior lo trajo.",
									},
								},
							},
						},
					},
				},
				responses: { "200": { description: "Lugares encontrados." } },
			},
		},
	},
};
```

- [ ] **Step 4B: Escribir el documento OpenAPI de ColdIQ**

Bajar los esquemas de entrada del spec público (no son secretos):

Run: `curl -s https://api.coldiq.com/openapi.json | jq '.components.schemas | {FindPeopleInput, SearchCompaniesInput, EnrichPersonIdentity, CompanyIdentity, PersonIdentity, EmailIdentity, FindSignalsInput}'`
Expected: siete objetos `type: "object"`, sin `$ref` adentro (verificado en el spike: ninguno tiene dependencias).

Pegar cada uno como constante, con estos cambios y ningún otro:
- En `FindPeopleInput` y `SearchCompaniesInput`, `limit.maximum` pasa de 500 a 25. En `FindSignalsInput`, de 100 a 25.
- Si una operación del spec ya no existe o su `input` pasó a referenciar otro esquema: **STOP** y reportar NEEDS_CONTEXT con la salida, sin adaptar a ciegas.

```ts
// lib/connectors/leads/coldiq.openapi.ts
// Subconjunto escrito a mano de https://api.coldiq.com/openapi.json, tag
// "GTM Verbs" (spec 02 §6.3). El spec público tiene 773 operaciones sin
// operationId: acá van solo las individuales, con operationId propio.
// El body solo expone `input`: sin `inputs` (lotes de hasta 50 por llamada),
// `provider` ni `max_credits`, para que el modelo no dispare lotes ni elija
// proveedores más caros. Los límites de resultados van topeados en 25.

const FindPeopleInput = /* salida de jq, con limit.maximum = 25 */;
const SearchCompaniesInput = /* salida de jq, con limit.maximum = 25 */;
const EnrichPersonIdentity = /* salida de jq */;
const CompanyIdentity = /* salida de jq */;
const PersonIdentity = /* salida de jq */;
const EmailIdentity = /* salida de jq */;
const FindSignalsInput = /* salida de jq, con limit.maximum = 25 */;

function operation(operationId: string, summary: string, input: object) {
	return {
		post: {
			operationId,
			summary,
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { type: "object", required: ["input"], properties: { input } },
					},
				},
			},
			responses: { "200": { description: "Resultado del waterfall de proveedores de ColdIQ." } },
		},
	};
}

export const COLDIQ_OPERATIONS = [
	"findPeople",
	"searchCompanies",
	"enrichPerson",
	"enrichCompany",
	"findEmail",
	"verifyEmail",
	"findSignals",
] as const;

export const coldiqOpenApi = {
	openapi: "3.0.3",
	info: { title: "ColdIQ API, subconjunto GTM Verbs", version: "1" },
	servers: [{ url: "https://api.coldiq.com" }],
	paths: {
		"/v1/people/search": operation("findPeople", "Busca decisores en empresas por cargo, seniority, dominio o URL de LinkedIn de la empresa.", FindPeopleInput),
		"/v1/companies/search": operation("searchCompanies", "Arma listas de cuentas por firmográficos, tecnologías, financiamiento, geografía o palabras clave; también lookalikes desde dominios semilla.", SearchCompaniesInput),
		"/v1/person/enrich": operation("enrichPerson", "Completa el perfil de una persona (cargo, empresa, ubicación) desde email, LinkedIn o nombre y empresa.", EnrichPersonIdentity),
		"/v1/company/enrich": operation("enrichCompany", "Completa firmográficos de una empresa (empleados, facturación, industria, financiamiento, tecnologías) desde dominio, nombre o LinkedIn.", CompanyIdentity),
		"/v1/email/find": operation("findEmail", "Encuentra el email profesional de una persona desde nombre y empresa o dominio, o desde su LinkedIn.", PersonIdentity),
		"/v1/email/verify": operation("verifyEmail", "Verifica si un email es entregable, riesgoso, catch-all o inválido.", EmailIdentity),
		"/v1/signals/find": operation("findSignals", "Busca señales de compra: financiamiento, adquisiciones, búsquedas laborales, cambios de puesto, noticias o intención.", FindSignalsInput),
	},
};
```

Los `/* salida de jq … */` se reemplazan por los objetos literales: el archivo commiteado no puede contener `salida de jq`.

- [ ] **Step 5: Escribir el catálogo**

```ts
// lib/connectors/catalog.ts
// Catálogo de conectores (spec 02 §4 y §6). Cada builder recibe un binding y
// devuelve la definición de eve, o null si el binding no alcanza para armarla.
import {
	type DynamicConnectionDefinition,
	defineOpenAPIConnection,
} from "eve/connections";
import { apiKeyBearer, apiKeyHeaders } from "./auth";
import { COLDIQ_OPERATIONS, coldiqOpenApi } from "./leads/coldiq.openapi";
import { googlePlacesOpenApi } from "./leads/google-places.openapi";
import { COLDIQ_BASE_URL } from "./platform";
import {
	type Binding,
	connectionName,
	isProviderKey,
	PROVIDERS,
	type ProviderKey,
} from "./providers";

export const GOOGLE_PLACES_FIELD_MASK = [
	"places.id",
	"places.displayName",
	"places.formattedAddress",
	"places.websiteUri",
	"places.nationalPhoneNumber",
	"places.rating",
	"places.types",
].join(",");

type Builder = (binding: Binding) => DynamicConnectionDefinition | null;

function requireConnectorUid(binding: Binding): string | null {
	return binding.connectorUid && binding.connectorUid.trim() !== ""
		? binding.connectorUid
		: null;
}

const BUILDERS: Partial<Record<ProviderKey, Builder>> = {
	coldiq: (binding) => {
		const uid = requireConnectorUid(binding);
		if (!uid) return null;
		return defineOpenAPIConnection({
			spec: coldiqOpenApi,
			baseUrl: COLDIQ_BASE_URL,
			description:
				"ColdIQ: búsqueda de personas y empresas, enriquecimiento, emails y señales de compra, de a un registro. Cada llamada consume créditos del cliente.",
			instanceKey: binding.id,
			auth: apiKeyBearer(uid),
			operations: { allow: [...COLDIQ_OPERATIONS] },
		});
	},

	"google-places": (binding) => {
		const uid = requireConnectorUid(binding);
		if (!uid) return null;
		return defineOpenAPIConnection({
			spec: googlePlacesOpenApi,
			baseUrl: "https://places.googleapis.com",
			description:
				"Google Places: negocios por rubro y zona, con dirección, web, teléfono y rating. Cada búsqueda tiene costo.",
			instanceKey: binding.id,
			headers: apiKeyHeaders(uid, "X-Goog-Api-Key", {
				"X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
			}),
			operations: { allow: ["searchText"] },
		});
	},
};

export function buildTenantConnections(
	bindings: Binding[],
): Record<string, DynamicConnectionDefinition> {
	const connections: Record<string, DynamicConnectionDefinition> = {};

	for (const binding of bindings) {
		const where = `tenant ${binding.tenantId}, ${binding.capability}/${binding.provider}`;

		if (!isProviderKey(binding.provider)) {
			console.warn(`conector omitido: proveedor desconocido (${where})`);
			continue;
		}
		const info = PROVIDERS[binding.provider];
		if (info.kind !== "connection") continue;
		if (info.capability !== binding.capability) {
			console.warn(`conector omitido: capacidad no coincide (${where})`);
			continue;
		}

		const build = BUILDERS[binding.provider];
		const definition = build ? build(binding) : null;
		if (!definition) {
			console.warn(`conector omitido: binding incompleto (${where})`);
			continue;
		}
		connections[connectionName(binding.provider)] = definition;
	}

	return connections;
}
```

Si `tsc` rechaza los literales `googlePlacesOpenApi` o `coldiqOpenApi` contra `OpenAPISpecSource`, ajustar el tipado según `node_modules/eve/dist/src/public/definitions/connections/openapi.d.ts`, sin cambiar el comportamiento que prueban los tests.

- [ ] **Step 6: Tests, typecheck y placeholders**

Run: `npm test -- tests/connectors && npm run typecheck && ! grep -n "salida de jq" lib/connectors/leads/coldiq.openapi.ts`
Expected: PASS, sin errores de tipos y sin placeholders.

- [ ] **Step 7: Prueba real de ColdIQ (usuario, opcional)**

Solo si el usuario la pide: consume créditos. Queda para la Entrega 4 si no.

- [ ] **Step 8: Commit**

```bash
git add lib/connectors/catalog.ts lib/connectors/leads/google-places.openapi.ts lib/connectors/leads/coldiq.openapi.ts tests/connectors/catalog.test.ts tests/connectors/coldiq-openapi.test.ts
git commit -m "feat: catalogo de conectores con coldiq y google places"
```

### Task 5B: Brain en el catálogo (BLOQUEADA hasta el rediseño del brain)

**Estado:** no se ejecuta mientras spec §6.2 tenga el aviso "En suspenso". La arquitectura del brain (`innovas-brains-mcp`) se rediseña en una sesión aparte. Lo que sigue es el diseño original, válido solo si el brain termina siendo un **MCP remoto con llave en `x-api-key`**. Si el rediseño cambia eso (por ejemplo, un brain dentro del propio proyecto sobre Supabase, sin llave), reescribir esta task contra la §6.2 nueva antes de ejecutarla.

**Files:**
- Modify: `lib/connectors/catalog.ts`, `tests/connectors/catalog.test.ts`

**Interfaces:**
- Consumes: `apiKeyHeaders` (Task 4), `defineMcpClientConnection`.
- Produces: el builder `"innovas-brains"` dentro de `BUILDERS`.

- [ ] **Step 1: Gate**

Run: `grep -n "En suspenso" docs/superpowers/specs/02-conexiones-innovas.md`
Expected: sin coincidencias. Si aparece: **STOP**, reportar BLOCKED "el brain sigue en rediseño (spec §6.2)".

- [ ] **Step 2: Verificar el conector del brain (usuario)**

El conector `innovas-brain` tiene que existir (spec §9.1). Probarlo con el comando OIDC de spec §9.1 contra un endpoint de lectura del brain, con el header `x-api-key: $TOKEN` en vez de `Authorization`. Expected: `200`. Esto cierra la parte de S5 que quedó pendiente.

- [ ] **Step 3: Agregar los tests**

Al final de `tests/connectors/catalog.test.ts`:

```ts
type Policy = (args: { toolName: string }) => string;

describe("brain", () => {
	it("arma la conexión con la URL del binding e instanceKey = id", () => {
		const { brain } = buildTenantConnections([binding({})]) as Record<string, AnyConnection>;
		expect(brain.url).toBe("https://brain.test/mcp");
		expect(brain.instanceKey).toBe("binding-1");
		expect(brain.tools).toEqual({ allow: ["brain_search", "brain_read", "brain_upsert"] });
	});

	it("pide aprobación solo para brain_upsert, con nombre calificado", () => {
		const { brain } = buildTenantConnections([binding({})]) as Record<string, AnyConnection>;
		const approval = brain.approval as Policy;
		expect(approval({ toolName: "brain__brain_upsert" })).toBe("user-approval");
		expect(approval({ toolName: "brain__brain_search" })).toBe("not-applicable");
	});

	it("usa la llave del conector del binding en x-api-key", async () => {
		const { brain } = buildTenantConnections([binding({})]) as Record<string, AnyConnection>;
		const headers = brain.headers as () => Promise<Record<string, string>>;
		expect(await headers()).toEqual({ "x-api-key": "llave:tenant-a-brain" });
	});

	it("se omite si falta la URL o el conector", () => {
		expect(buildTenantConnections([binding({ config: {} })])).toEqual({});
		expect(buildTenantConnections([binding({ connectorUid: null })])).toEqual({});
		expect(warn).toHaveBeenCalled();
	});
});
```

- [ ] **Step 4: Verificar que falla**

Run: `npm test -- tests/connectors/catalog.test.ts`
Expected: FAIL en "arma la conexión" (sin builder, el binding se omite).

- [ ] **Step 5: Implementar**

En `lib/connectors/catalog.ts`: sumar `defineMcpClientConnection` al import de `eve/connections` y agregar al objeto `BUILDERS`:

```ts
	"innovas-brains": (binding) => {
		const uid = requireConnectorUid(binding);
		const url = typeof binding.config.url === "string" ? binding.config.url : null;
		if (!uid || !url) return null;
		return defineMcpClientConnection({
			url,
			description:
				"Brain del cliente: canon comercial, ICP, tono, hooks y notas de cuentas. Buscá acá antes de investigar o redactar.",
			instanceKey: binding.id,
			headers: apiKeyHeaders(uid, "x-api-key"),
			tools: { allow: ["brain_search", "brain_read", "brain_upsert"] },
			// eve pasa el nombre calificado (<conexión>__<tool>).
			approval: ({ toolName }) =>
				toolName.endsWith("__brain_upsert") ? "user-approval" : "not-applicable",
		});
	},
```

Si `tsc` rechaza la firma de `approval`, ajustarla según `node_modules/eve/dist/src/public/definitions/approval.d.ts`.

- [ ] **Step 6: Tests y typecheck**

Run: `npm test -- tests/connectors && npm run typecheck`
Expected: PASS y sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/connectors/catalog.ts tests/connectors/catalog.test.ts
git commit -m "feat: brain del tenant en el catalogo de conectores"
```

### Task 6: Resolver dinámico de conexiones

**Files:**
- Create: `lib/connectors/bindings.ts`, `lib/connectors/resolve.ts`, `agents/outreach/connections/tenant.ts`
- Test: `tests/connectors/resolve.test.ts`, `tests/connectors/bindings.test.ts`

**Interfaces:**
- Consumes: `buildTenantConnections` (Task 5), `Binding`, `Capability` (Task 3), `createAdminClient` (Etapa 1).
- Produces:
  ```ts
  // bindings.ts
  export async function loadTenantBindings(tenantId: string): Promise<Binding[]>;
  export async function hasEnabledBinding(tenantId: string, capability: Capability, provider: string): Promise<boolean>;
  // resolve.ts
  export async function resolveTenantConnections(tenantId: string, load: (tenantId: string) => Promise<Binding[]>): Promise<Record<string, DynamicConnectionDefinition> | null>;
  ```

- [ ] **Step 1: Leer la doc**

`node_modules/eve/docs/guides/dynamic-capabilities.md` §Dynamic connections (naming, events and recovery).

- [ ] **Step 2: Escribir los tests**

```ts
// tests/connectors/resolve.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connectors/catalog", () => ({
	buildTenantConnections: (bindings: { provider: string }[]) =>
		Object.fromEntries(bindings.map((b) => [b.provider, { built: true }])),
}));

const { resolveTenantConnections } = await import("@/lib/connectors/resolve");

describe("resolveTenantConnections", () => {
	it("sin tenant devuelve null y no consulta la base", async () => {
		const load = vi.fn();
		expect(await resolveTenantConnections("", load)).toBeNull();
		expect(load).not.toHaveBeenCalled();
	});

	it("consulta solo el tenant de la sesión", async () => {
		const load = vi.fn(async () => []);
		await resolveTenantConnections("tenant-a", load);
		expect(load).toHaveBeenCalledWith("tenant-a");
	});

	it("tenant sin bindings devuelve null", async () => {
		expect(await resolveTenantConnections("tenant-a", async () => [])).toBeNull();
	});

	it("devuelve el mapa armado por el catálogo", async () => {
		const result = await resolveTenantConnections("tenant-a", async () => [
			{
				id: "1",
				tenantId: "tenant-a",
				capability: "brain",
				provider: "innovas-brains",
				connectorUid: "x",
				config: {},
			},
		]);
		expect(result).toEqual({ "innovas-brains": { built: true } });
	});

	it("si falla la consulta, propaga para que la sesión no arranque", async () => {
		await expect(
			resolveTenantConnections("tenant-a", async () => {
				throw new Error("base caída");
			}),
		).rejects.toThrow("base caída");
	});
});
```

```ts
// tests/connectors/bindings.test.ts
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	filters: [] as [string, unknown][],
	rows: [] as Record<string, unknown>[],
	error: null as { message: string } | null,
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: () => {
				const chain = {
					eq(column: string, value: unknown) {
						state.filters.push([column, value]);
						return chain;
					},
					then(resolve: (value: unknown) => void) {
						resolve({ data: state.rows, error: state.error });
					},
				};
				return chain;
			},
		}),
	}),
}));

const { hasEnabledBinding, loadTenantBindings } = await import(
	"@/lib/connectors/bindings"
);

describe("loadTenantBindings", () => {
	it("filtra por tenant y enabled y mapea a camelCase", async () => {
		state.filters = [];
		state.error = null;
		state.rows = [
			{
				id: "b1",
				tenant_id: "tenant-a",
				capability: "brain",
				provider: "innovas-brains",
				connector_uid: "tenant-a-brain",
				config: { url: "https://x" },
			},
		];
		const bindings = await loadTenantBindings("tenant-a");
		expect(state.filters).toEqual([
			["tenant_id", "tenant-a"],
			["enabled", true],
		]);
		expect(bindings).toEqual([
			{
				id: "b1",
				tenantId: "tenant-a",
				capability: "brain",
				provider: "innovas-brains",
				connectorUid: "tenant-a-brain",
				config: { url: "https://x" },
			},
		]);
	});

	it("tira con el error de la base", async () => {
		state.error = { message: "timeout" };
		await expect(loadTenantBindings("tenant-a")).rejects.toThrow("timeout");
	});
});

describe("hasEnabledBinding", () => {
	it("encuentra el binding por capacidad y proveedor", async () => {
		state.error = null;
		state.rows = [
			{ id: "b1", tenant_id: "t", capability: "mail", provider: "gmail", connector_uid: null, config: {} },
		];
		expect(await hasEnabledBinding("t", "mail", "gmail")).toBe(true);
		expect(await hasEnabledBinding("t", "crm", "hubspot")).toBe(false);
	});
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `npm test -- tests/connectors/resolve.test.ts tests/connectors/bindings.test.ts`
Expected: FAIL por módulos inexistentes.

- [ ] **Step 4: Implementar**

```ts
// lib/connectors/bindings.ts
// Import relativo: lo importan tools y hooks de eve.
import { createAdminClient } from "../supabase/admin";
import type { Binding, Capability } from "./providers";

/**
 * Bindings habilitados de un tenant. Usa la service role: el tenant tiene que
 * venir de la sesión de eve (fijado por resolveChannelContext), nunca de un
 * input del modelo ni del browser.
 */
export async function loadTenantBindings(tenantId: string): Promise<Binding[]> {
	const { data, error } = await createAdminClient()
		.from("tenant_connections")
		.select("id, tenant_id, capability, provider, connector_uid, config")
		.eq("tenant_id", tenantId)
		.eq("enabled", true);

	if (error) {
		throw new Error(
			`No pude leer las conexiones del tenant ${tenantId}: ${error.message}`,
		);
	}

	return (data ?? []).map((row) => ({
		id: row.id,
		tenantId: row.tenant_id,
		capability: row.capability,
		provider: row.provider,
		connectorUid: row.connector_uid,
		config: row.config ?? {},
	}));
}

export async function hasEnabledBinding(
	tenantId: string,
	capability: Capability,
	provider: string,
): Promise<boolean> {
	const bindings = await loadTenantBindings(tenantId);
	return bindings.some(
		(binding) =>
			binding.capability === capability && binding.provider === provider,
	);
}
```

```ts
// lib/connectors/resolve.ts
import type { DynamicConnectionDefinition } from "eve/connections";
import { buildTenantConnections } from "./catalog";
import type { Binding } from "./providers";

/**
 * Lógica del resolver de conexiones, separada del defineDynamic para poder
 * probarla. Sin efectos: eve la vuelve a correr al reanudar o reintentar.
 */
export async function resolveTenantConnections(
	tenantId: string,
	load: (tenantId: string) => Promise<Binding[]>,
): Promise<Record<string, DynamicConnectionDefinition> | null> {
	if (!tenantId) return null;
	const connections = buildTenantConnections(await load(tenantId));
	return Object.keys(connections).length > 0 ? connections : null;
}
```

```ts
// agents/outreach/connections/tenant.ts
import { defineDynamic } from "eve/connections";
import { loadTenantBindings } from "../../../lib/connectors/bindings";
import { resolveTenantConnections } from "../../../lib/connectors/resolve";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// Un solo resolver para todas las conexiones del tenant (spec 02 D7). Un
// tenant sin binding de una capacidad simplemente no tiene esa clave.
export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			return resolveTenantConnections(
				attribute(auth?.attributes?.tenantId),
				loadTenantBindings,
			);
		},
	},
});
```

Si `tsc` marca `row` como `any` implícito, tipar la fila con una interfaz local `TenantConnectionRow` en `bindings.ts`.

- [ ] **Step 5: Tests, typecheck y compilación de eve**

Run: `npm test -- tests/connectors && npm run typecheck && npm run build`
Expected: PASS, sin errores de tipos, y el build de Next incluye la conexión dinámica sin error de compilación de eve.

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/bindings.ts lib/connectors/resolve.ts agents/outreach/connections/tenant.ts tests/connectors/resolve.test.ts tests/connectors/bindings.test.ts
git commit -m "feat: resolver dinamico de conexiones por tenant"
```

### Task 7: Script de alta de bindings

**Files:**
- Create: `scripts/connections-bind.mts`, `scripts/connections-bind-args.ts`
- Modify: `package.json` (script `connections:bind`)
- Test: `tests/scripts/connections-bind-args.test.ts`

**Interfaces:**
- Consumes: `PROVIDERS`, `isProviderKey` (Task 3), por import con extensión `.ts`.
- Produces:
  ```ts
  export interface BindArgs { tenant: string; capability: Capability; provider: ProviderKey; connector: string | null; url: string | null }
  export function parseBindArgs(argv: string[]): BindArgs; // tira Error con mensaje en español
  ```

- [ ] **Step 1: Escribir el test**

```ts
// tests/scripts/connections-bind-args.test.ts
import { describe, expect, it } from "vitest";
import { parseBindArgs } from "@/scripts/connections-bind-args";

describe("parseBindArgs", () => {
	it("acepta un binding de API key con conector y URL", () => {
		expect(
			parseBindArgs([
				"--tenant", "innovas",
				"--capability", "brain",
				"--provider", "innovas-brains",
				"--connector", "innovas-brain",
				"--url", "https://brain.test/mcp",
			]),
		).toEqual({
			tenant: "innovas",
			capability: "brain",
			provider: "innovas-brains",
			connector: "innovas-brain",
			url: "https://brain.test/mcp",
		});
	});

	it("acepta un binding OAuth sin conector", () => {
		expect(
			parseBindArgs(["--tenant", "innovas", "--capability", "crm", "--provider", "hubspot"]),
		).toMatchObject({ provider: "hubspot", connector: null });
	});

	it("rechaza un proveedor fuera del catálogo", () => {
		expect(() =>
			parseBindArgs(["--tenant", "innovas", "--capability", "crm", "--provider", "salesforce"]),
		).toThrow(/proveedor/);
	});

	it("rechaza capacidad que no corresponde al proveedor", () => {
		expect(() =>
			parseBindArgs(["--tenant", "innovas", "--capability", "leads", "--provider", "hubspot"]),
		).toThrow(/capacidad/);
	});

	it("exige conector para proveedores de API key", () => {
		expect(() =>
			parseBindArgs(["--tenant", "innovas", "--capability", "leads", "--provider", "coldiq"]),
		).toThrow(/--connector/);
	});

	it("rechaza conector en proveedores OAuth de plataforma", () => {
		expect(() =>
			parseBindArgs([
				"--tenant", "innovas", "--capability", "crm", "--provider", "hubspot",
				"--connector", "algo",
			]),
		).toThrow(/plataforma/);
	});

	it("exige URL https para el brain", () => {
		expect(() =>
			parseBindArgs([
				"--tenant", "innovas", "--capability", "brain", "--provider", "innovas-brains",
				"--connector", "innovas-brain",
			]),
		).toThrow(/--url/);
		expect(() =>
			parseBindArgs([
				"--tenant", "innovas", "--capability", "brain", "--provider", "innovas-brains",
				"--connector", "innovas-brain", "--url", "http://brain.test",
			]),
		).toThrow(/https/);
	});

	it("exige tenant", () => {
		expect(() => parseBindArgs(["--capability", "crm", "--provider", "hubspot"])).toThrow(/--tenant/);
	});
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -- tests/scripts/connections-bind-args.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar el parser**

```ts
// scripts/connections-bind-args.ts
// Import con extensión .ts: este archivo lo ejecuta Node directo (type stripping).
import {
	type Capability,
	isProviderKey,
	PROVIDERS,
	type ProviderKey,
} from "../lib/connectors/providers.ts";

export interface BindArgs {
	tenant: string;
	capability: Capability;
	provider: ProviderKey;
	connector: string | null;
	url: string | null;
}

function flag(argv: string[], name: string): string | null {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return null;
	const value = argv[index + 1];
	return value && !value.startsWith("--") ? value : null;
}

export function parseBindArgs(argv: string[]): BindArgs {
	const tenant = flag(argv, "tenant");
	if (!tenant) throw new Error("falta --tenant <slug>");

	const provider = flag(argv, "provider") ?? "";
	if (!isProviderKey(provider)) {
		throw new Error(`proveedor desconocido: "${provider}". Válidos: ${Object.keys(PROVIDERS).join(", ")}`);
	}
	const info = PROVIDERS[provider];

	const capability = flag(argv, "capability");
	if (capability !== info.capability) {
		throw new Error(`la capacidad de ${provider} es ${info.capability}, no "${capability ?? ""}"`);
	}

	const connector = flag(argv, "connector");
	if (info.authKind === "connect_api_key" && !connector) {
		throw new Error(`${provider} usa API key: falta --connector <uid del conector de Connect>`);
	}
	if (info.authKind === "connect_oauth" && connector) {
		throw new Error(`${provider} usa el conector OAuth de plataforma: no se pasa --connector`);
	}

	const url = flag(argv, "url");
	if (provider === "innovas-brains") {
		if (!url) throw new Error("innovas-brains necesita --url <url del MCP>");
		if (!url.startsWith("https://")) throw new Error("la URL del MCP tiene que ser https");
	}

	return { tenant, capability: info.capability, provider, connector, url };
}
```

- [ ] **Step 4: Implementar el script**

```ts
// scripts/connections-bind.mts
// Alta de un binding de conector para un tenant (spec 02 §9). No maneja
// secretos: la llave ya está en Vercel Connect. Uso:
//   npm run connections:bind -- --tenant innovas --capability leads \
//     --provider coldiq --connector innovas-coldiq
import { userInfo } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { parseBindArgs } from "./connections-bind-args.ts";

async function main(): Promise<void> {
	const args = parseBindArgs(process.argv.slice(2));

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");

	const admin = createClient(url, key, { auth: { persistSession: false } });

	const { data: tenant, error: tenantError } = await admin
		.from("tenants")
		.select("id")
		.eq("slug", args.tenant)
		.maybeSingle();
	if (tenantError) throw new Error(`no pude leer el tenant: ${tenantError.message}`);
	if (!tenant) throw new Error(`no existe el tenant "${args.tenant}"`);

	const { data: binding, error: bindError } = await admin
		.from("tenant_connections")
		.upsert(
			{
				tenant_id: tenant.id,
				capability: args.capability,
				provider: args.provider,
				connector_uid: args.connector,
				config: args.url ? { url: args.url } : {},
				enabled: true,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "tenant_id,capability,provider" },
		)
		.select("id")
		.single();
	if (bindError) throw new Error(`no pude guardar el binding: ${bindError.message}`);

	const { error: eventError } = await admin.from("events").insert({
		tenant_id: tenant.id,
		type: "connection.bound",
		summary: `${args.capability}/${args.provider}`,
		payload: {
			capability: args.capability,
			provider: args.provider,
			connector_uid: args.connector,
			binding_id: binding.id,
			actor: `script:${userInfo().username}`,
		},
	});
	if (eventError) throw new Error(`el binding quedó guardado pero no el evento: ${eventError.message}`);

	console.log(`listo: ${args.tenant} ${args.capability}/${args.provider} (binding ${binding.id})`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
```

En `package.json`, dentro de `scripts`: `"connections:bind": "node --env-file=.env.local scripts/connections-bind.mts"`.

- [ ] **Step 5: Tests, typecheck y prueba contra la base local**

Run: `npm test -- tests/scripts && npm run typecheck && npm run db:reset`

Run (contra la base local; `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` salen de `npx supabase status -o env`, exportadas solo para este comando, sin imprimirlas): `npm run connections:bind -- --tenant innovas-seed --capability crm --provider hubspot`
Expected: `listo: innovas-seed crm/hubspot (binding <uuid>)`. Repetirlo da el mismo uuid (upsert). Si `.env.local` apunta a producción, **no** correrlo contra producción en este step.

- [ ] **Step 6: Commit**

```bash
git add scripts/connections-bind.mts scripts/connections-bind-args.ts tests/scripts/connections-bind-args.test.ts package.json
git commit -m "feat: script de alta de bindings de conectores sin secretos"
```

---

## Entrega 3 · Camino OAuth

### Task 8: HubSpot en el catálogo

**Files:**
- Modify: `lib/connectors/catalog.ts`
- Modify: `tests/connectors/catalog.test.ts`

**Interfaces:**
- Consumes: `tenantScopedConnect` (Task 4), `HUBSPOT_MCP_URL`, `HUBSPOT_CONNECTOR_UID`, `HUBSPOT_READ_TOOLS` (Task 1).
- Produces: el builder `hubspot` dentro de `BUILDERS`.

- [ ] **Step 1: Agregar el test**

Al final de `tests/connectors/catalog.test.ts`:

```ts
describe("crm HubSpot", () => {
	const hubspot = binding({
		id: "binding-crm",
		capability: "crm",
		provider: "hubspot",
		connectorUid: null,
		config: {},
	});

	it("se llama crm y usa el MCP y el allow del spike", () => {
		const { crm } = buildTenantConnections([hubspot]) as Record<string, AnyConnection>;
		expect(crm.url).toBe(platform.HUBSPOT_MCP_URL);
		expect(crm.tools).toEqual({ allow: [...platform.HUBSPOT_READ_TOOLS] });
		expect(crm.instanceKey).toBe("binding-crm");
	});

	it("autoriza con el conector de plataforma atado al tenant del binding", () => {
		const { crm } = buildTenantConnections([hubspot]) as Record<string, AnyConnection>;
		expect(crm.auth).toEqual({
			connector: platform.HUBSPOT_CONNECTOR_UID,
			tenantId: "tenant-a",
		});
	});

	it("es solo lectura: sin política de aprobación", () => {
		const { crm } = buildTenantConnections([hubspot]) as Record<string, AnyConnection>;
		expect(crm.approval).toBeUndefined();
	});

	it("un tenant sin binding de crm no expone crm", () => {
		expect(buildTenantConnections([binding({})])).not.toHaveProperty("crm");
	});

	it("gmail nunca produce conexión", () => {
		expect(
			buildTenantConnections([
				binding({ capability: "mail", provider: "gmail", connectorUid: null, config: {} }),
			]),
		).toEqual({});
	});
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -- tests/connectors/catalog.test.ts`
Expected: FAIL en "se llama crm" (el builder no existe; el binding se omite).

- [ ] **Step 3: Implementar**

En `lib/connectors/catalog.ts`: agregar `defineMcpClientConnection` al import de `eve/connections` (si la Task 5B no lo agregó), `tenantScopedConnect` al import de `./auth`, sumar `HUBSPOT_CONNECTOR_UID`, `HUBSPOT_MCP_URL` y `HUBSPOT_READ_TOOLS` al import de `./platform`, y agregar al objeto `BUILDERS`:

```ts
	hubspot: (binding) =>
		defineMcpClientConnection({
			url: HUBSPOT_MCP_URL,
			description:
				"CRM HubSpot con la cuenta del usuario: buscar y leer contactos, empresas, negocios y actividad. Solo lectura.",
			instanceKey: binding.id,
			auth: tenantScopedConnect(HUBSPOT_CONNECTOR_UID, binding.tenantId),
			tools: { allow: [...HUBSPOT_READ_TOOLS] },
		}),
```

- [ ] **Step 4: Tests y typecheck**

Run: `npm test -- tests/connectors && npm run typecheck`
Expected: PASS y sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/catalog.ts tests/connectors/catalog.test.ts
git commit -m "feat: crm hubspot de solo lectura en el catalogo de conectores"
```

### Task 9: Propiedades custom de outreach en HubSpot

**Files:**
- Create: `lib/connectors/crm/hubspot.ts`, `agents/outreach/tools/crm_setup_outreach_properties.ts`
- Test: `tests/connectors/hubspot.test.ts`, `tests/tools/crm-setup-outreach-properties.test.ts`

**Interfaces:**
- Consumes: `tenantScopedConnect` (Task 4), `hasEnabledBinding` (Task 6), `HUBSPOT_CONNECTOR_UID` (Task 1). El mismo conector del MCP autoriza la API REST (spec §10.1 S3).
- Produces:
  ```ts
  export const OUTREACH_PROPERTY_GROUP: { name: "outreach"; label: string };
  export const OUTREACH_PROPERTIES: readonly { name: string; label: string; type: "string" | "date"; fieldType: "text" | "date" }[];
  export class HubSpotUnauthorizedError extends Error {}
  export async function ensureOutreachProperties(token: string, fetchImpl?: typeof fetch): Promise<{ created: string[]; existing: string[] }>;
  ```

- [ ] **Step 1: Leer la doc**

`node_modules/eve/docs/tools/overview.mdx` (definición de tools, `execute(input, ctx)`) y la sección "Handling a revoked token mid-call" de `node_modules/eve/docs/connections/overview.mdx`.

- [ ] **Step 2: Escribir el test del adapter**

```ts
// tests/connectors/hubspot.test.ts
import { describe, expect, it } from "vitest";
import {
	ensureOutreachProperties,
	HubSpotUnauthorizedError,
	OUTREACH_PROPERTIES,
} from "@/lib/connectors/crm/hubspot";

type Call = { url: string; method: string; body: unknown; auth: string | null };

function fakeHubSpot(options: { existing: string[]; groupExists: boolean; status?: number }) {
	const calls: Call[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const headers = new Headers(init?.headers);
		calls.push({
			url,
			method,
			body: init?.body ? JSON.parse(String(init.body)) : null,
			auth: headers.get("authorization"),
		});
		if (options.status) return new Response("{}", { status: options.status });
		if (method === "GET" && url.endsWith("/groups/outreach")) {
			return new Response("{}", { status: options.groupExists ? 200 : 404 });
		}
		if (method === "GET" && url.endsWith("/crm/v3/properties/contacts")) {
			return Response.json({ results: options.existing.map((name) => ({ name })) });
		}
		return Response.json({}, { status: 201 });
	}) as typeof fetch;
	return { calls, fetchImpl };
}

describe("ensureOutreachProperties", () => {
	it("crea el grupo y las 8 propiedades en un HubSpot vacío", async () => {
		const { calls, fetchImpl } = fakeHubSpot({ existing: [], groupExists: false });
		const result = await ensureOutreachProperties("tok", fetchImpl);
		expect(result.created).toHaveLength(8);
		expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/crm/v3/properties/contacts/groups"))).toBe(true);
		expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
	});

	it("es idempotente: no crea lo que ya existe", async () => {
		const names = OUTREACH_PROPERTIES.map((p) => p.name);
		const { calls, fetchImpl } = fakeHubSpot({ existing: names, groupExists: true });
		const result = await ensureOutreachProperties("tok", fetchImpl);
		expect(result).toEqual({ created: [], existing: names });
		expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
	});

	it("crea solo las faltantes, dentro del grupo outreach", async () => {
		const { calls, fetchImpl } = fakeHubSpot({ existing: ["contact_key"], groupExists: true });
		const result = await ensureOutreachProperties("tok", fetchImpl);
		expect(result.created).not.toContain("contact_key");
		expect(result.created).toHaveLength(7);
		const posts = calls.filter((c) => c.method === "POST");
		expect(posts.every((c) => (c.body as { groupName: string }).groupName === "outreach")).toBe(true);
	});

	it("un 401 se traduce a HubSpotUnauthorizedError", async () => {
		const { fetchImpl } = fakeHubSpot({ existing: [], groupExists: true, status: 401 });
		await expect(ensureOutreachProperties("tok", fetchImpl)).rejects.toBeInstanceOf(HubSpotUnauthorizedError);
	});

	it("otro error tira con el status", async () => {
		const { fetchImpl } = fakeHubSpot({ existing: [], groupExists: true, status: 500 });
		await expect(ensureOutreachProperties("tok", fetchImpl)).rejects.toThrow(/500/);
	});
});
```

- [ ] **Step 3: Verificar que falla**

Run: `npm test -- tests/connectors/hubspot.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 4: Implementar el adapter**

```ts
// lib/connectors/crm/hubspot.ts
// Esquema de atribución de outreach en HubSpot (kickoff §5, spec 02 §6.1).
// Genérico para cualquier tenant con HubSpot: no es específico de Innovas.

const API = "https://api.hubapi.com";

export const OUTREACH_PROPERTY_GROUP = { name: "outreach", label: "Outreach" } as const;

export const OUTREACH_PROPERTIES = [
	{ name: "contact_key", label: "Contact key", type: "string", fieldType: "text" },
	{ name: "outreach_segmento", label: "Outreach · segmento", type: "string", fieldType: "text" },
	{ name: "outreach_canal", label: "Outreach · canal", type: "string", fieldType: "text" },
	{ name: "outreach_hook", label: "Outreach · hook", type: "string", fieldType: "text" },
	{ name: "outreach_status", label: "Outreach · estado", type: "string", fieldType: "text" },
	{ name: "outreach_owner", label: "Outreach · responsable", type: "string", fieldType: "text" },
	{ name: "outreach_fecha_msg1", label: "Outreach · fecha del primer mensaje", type: "date", fieldType: "date" },
	{ name: "outreach_fecha_respuesta", label: "Outreach · fecha de respuesta", type: "date", fieldType: "date" },
] as const;

export class HubSpotUnauthorizedError extends Error {
	constructor() {
		super("HubSpot rechazó el token del usuario");
		this.name = "HubSpotUnauthorizedError";
	}
}

async function call(
	fetchImpl: typeof fetch,
	token: string,
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<Response> {
	const response = await fetchImpl(`${API}${path}`, {
		method: init.method ?? "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			...(init.body ? { "Content-Type": "application/json" } : {}),
		},
		...(init.body ? { body: JSON.stringify(init.body) } : {}),
	});
	if (response.status === 401) throw new HubSpotUnauthorizedError();
	return response;
}

async function expectOk(response: Response, what: string): Promise<void> {
	if (!response.ok) {
		throw new Error(`HubSpot falló al ${what} (${response.status}): ${await response.text()}`);
	}
}

export async function ensureOutreachProperties(
	token: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{ created: string[]; existing: string[] }> {
	const group = await call(fetchImpl, token, `/crm/v3/properties/contacts/groups/${OUTREACH_PROPERTY_GROUP.name}`);
	if (group.status === 404) {
		await expectOk(
			await call(fetchImpl, token, "/crm/v3/properties/contacts/groups", {
				method: "POST",
				body: { ...OUTREACH_PROPERTY_GROUP, displayOrder: -1 },
			}),
			"crear el grupo outreach",
		);
	} else {
		await expectOk(group, "leer el grupo outreach");
	}

	const list = await call(fetchImpl, token, "/crm/v3/properties/contacts");
	await expectOk(list, "listar las propiedades de contacto");
	const present = new Set(
		((await list.json()) as { results?: { name: string }[] }).results?.map((p) => p.name) ?? [],
	);

	const created: string[] = [];
	const existing: string[] = [];
	for (const property of OUTREACH_PROPERTIES) {
		if (present.has(property.name)) {
			existing.push(property.name);
			continue;
		}
		await expectOk(
			await call(fetchImpl, token, "/crm/v3/properties/contacts", {
				method: "POST",
				body: { ...property, groupName: OUTREACH_PROPERTY_GROUP.name },
			}),
			`crear la propiedad ${property.name}`,
		);
		created.push(property.name);
	}

	return { created, existing };
}
```

- [ ] **Step 5: Escribir el test de la tool**

```ts
// tests/tools/crm-setup-outreach-properties.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	hasBinding: true,
	ensureError: null as Error | null,
	requireAuthCalls: 0,
}));

vi.mock("../../lib/connectors/bindings", () => ({
	hasEnabledBinding: async () => state.hasBinding,
}));
vi.mock("../../lib/connectors/auth", () => ({
	tenantScopedConnect: (connector: string, tenantId: string) => ({ connector, tenantId }),
}));
vi.mock("../../lib/connectors/crm/hubspot", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/connectors/crm/hubspot")>();
	return {
		...original,
		ensureOutreachProperties: async () => {
			if (state.ensureError) throw state.ensureError;
			return { created: ["contact_key"], existing: [] };
		},
	};
});

const { default: tool } = await import("@/agents/outreach/tools/crm_setup_outreach_properties");
const { HubSpotUnauthorizedError } = await import("@/lib/connectors/crm/hubspot");

function ctx(role: string, principalType = "user") {
	return {
		session: {
			auth: {
				current: { principalType, principalId: "user-1", attributes: { tenantId: "tenant-a", role } },
			},
		},
		getToken: async () => ({ token: "tok" }),
		requireAuth: () => {
			state.requireAuthCalls += 1;
			throw new Error("auth requerida");
		},
	};
}

// biome-ignore lint/suspicious/noExplicitAny: el ctx de eve se simula parcialmente.
const run = (context: any) => (tool as any).execute({}, context);

beforeEach(() => {
	state.hasBinding = true;
	state.ensureError = null;
	state.requireAuthCalls = 0;
});

describe("crm_setup_outreach_properties", () => {
	it("pide aprobación siempre", () => {
		expect((tool as { approval?: unknown }).approval).toBeDefined();
	});

	it("un tenant_admin crea las propiedades", async () => {
		expect(await run(ctx("tenant_admin"))).toEqual({ created: ["contact_key"], existing: [] });
	});

	it("rechaza a un tenant_member", async () => {
		await expect(run(ctx("tenant_member"))).rejects.toThrow(/tenant_admin/);
	});

	it("rechaza un tenant sin HubSpot", async () => {
		state.hasBinding = false;
		await expect(run(ctx("platform_admin"))).rejects.toThrow(/HubSpot/);
	});

	it("un 401 dispara requireAuth", async () => {
		state.ensureError = new HubSpotUnauthorizedError();
		await expect(run(ctx("tenant_admin"))).rejects.toThrow();
		expect(state.requireAuthCalls).toBe(1);
	});
});
```

- [ ] **Step 6: Implementar la tool**

```ts
// agents/outreach/tools/crm_setup_outreach_properties.ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { tenantScopedConnect } from "../../../lib/connectors/auth";
import { hasEnabledBinding } from "../../../lib/connectors/bindings";
import {
	ensureOutreachProperties,
	HubSpotUnauthorizedError,
} from "../../../lib/connectors/crm/hubspot";
import { HUBSPOT_CONNECTOR_UID } from "../../../lib/connectors/platform";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

const AUTH_OPTIONS = { authKey: "hubspot", displayName: "HubSpot" } as const;

export default defineTool({
	description:
		"Crea en el HubSpot del tenant las propiedades custom de outreach que falten (grupo outreach). Idempotente. Solo para tenant_admin o platform_admin.",
	inputSchema: z.object({}),
	approval: always(),
	async execute(_input, ctx) {
		const auth = ctx.session.auth.current;
		if (auth?.principalType !== "user") {
			throw new Error("crm_setup_outreach_properties requiere un usuario autenticado");
		}
		const tenantId = attribute(auth.attributes?.tenantId);
		const role = attribute(auth.attributes?.role);
		if (!tenantId) throw new Error("la sesión no tiene tenant");
		if (role !== "tenant_admin" && role !== "platform_admin") {
			throw new Error("solo un tenant_admin o platform_admin puede crear las propiedades de outreach");
		}
		if (!(await hasEnabledBinding(tenantId, "crm", "hubspot"))) {
			throw new Error("este tenant no tiene HubSpot conectado");
		}

		const provider = tenantScopedConnect(HUBSPOT_CONNECTOR_UID, tenantId);
		const { token } = await ctx.getToken(provider, AUTH_OPTIONS);
		try {
			return await ensureOutreachProperties(token);
		} catch (error) {
			if (error instanceof HubSpotUnauthorizedError) ctx.requireAuth(provider, AUTH_OPTIONS);
			throw error;
		}
	},
});
```

- [ ] **Step 7: Tests y typecheck**

Run: `npm test -- tests/connectors/hubspot.test.ts tests/tools && npm run typecheck`
Expected: PASS y sin errores.

**Riesgo abierto (spec §6.1):** el spike solo probó lectura REST con el token del MCP. Los scopes de una MCP auth app los fija el MCP de HubSpot, no nosotros. Si en la verificación del criterio 5 (Task 14) la creación del grupo o de una propiedad devuelve **403**, no agregar un conector nuevo: reportar BLOCKED con el cuerpo del error. La alternativa acordada es reescribir `ensureOutreachProperties` sobre la tool del MCP `manage_custom_properties`, lo que requiere revisar esta task.

- [ ] **Step 8: Commit**

```bash
git add lib/connectors/crm/hubspot.ts agents/outreach/tools/crm_setup_outreach_properties.ts tests/connectors/hubspot.test.ts tests/tools/crm-setup-outreach-properties.test.ts
git commit -m "feat: tool con aprobacion para crear las propiedades de outreach en hubspot"
```

### Task 10: `send_email` por Vercel Connect

**Files:**
- Modify: `lib/gmail/send.ts`, `agents/outreach/tools/send_email.ts`
- Test: `tests/gmail/send.test.ts`, `tests/tools/send-email.test.ts`

**Interfaces:**
- Consumes: `tenantScopedConnect` (Task 4), `hasEnabledBinding` (Task 6), `GOOGLE_CONNECTOR_UID` (Task 1).
- Produces:
  ```ts
  export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
  export class GmailUnauthorizedError extends Error {}
  export async function sendMail(accessToken: string, input: { to: string; subject: string; body: string }): Promise<{ id: string; threadId: string }>;
  ```
  Y el `authKey` `"gmail"`, que consume el hook de la Task 11.

- [ ] **Step 1: Escribir los tests**

```ts
// tests/gmail/send.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailUnauthorizedError, sendMail } from "@/lib/gmail/send";

afterEach(() => vi.unstubAllGlobals());

describe("sendMail", () => {
	it("envía con el access token recibido", async () => {
		const fetchMock = vi.fn(async () => Response.json({ id: "m1", threadId: "t1" }));
		vi.stubGlobal("fetch", fetchMock);
		const result = await sendMail("tok", { to: "a@b.test", subject: "Hola", body: "Cuerpo" });
		expect(result).toEqual({ id: "m1", threadId: "t1" });
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
	});

	it("un 401 tira GmailUnauthorizedError", async () => {
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
		await expect(sendMail("tok", { to: "a@b.test", subject: "x", body: "y" })).rejects.toBeInstanceOf(GmailUnauthorizedError);
	});
});
```

```ts
// tests/tools/send-email.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	hasBinding: true,
	sendError: null as Error | null,
	getTokenCalls: [] as unknown[][],
	requireAuthCalls: 0,
}));

vi.mock("../../lib/connectors/bindings", () => ({ hasEnabledBinding: async () => state.hasBinding }));
vi.mock("../../lib/connectors/auth", () => ({
	tenantScopedConnect: (connector: string, tenantId: string, scopes: string[]) => ({ connector, tenantId, scopes }),
}));
vi.mock("../../lib/gmail/send", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/gmail/send")>();
	return {
		...original,
		sendMail: async () => {
			if (state.sendError) throw state.sendError;
			return { id: "m1", threadId: "t1" };
		},
	};
});

const { default: tool } = await import("@/agents/outreach/tools/send_email");
const { GmailUnauthorizedError, GMAIL_SEND_SCOPE } = await import("@/lib/gmail/send");

const context = {
	session: { auth: { current: { principalType: "user", principalId: "user-1", attributes: { tenantId: "tenant-a" } } } },
	getToken: async (...args: unknown[]) => {
		state.getTokenCalls.push(args);
		return { token: "tok" };
	},
	requireAuth: () => {
		state.requireAuthCalls += 1;
		throw new Error("auth requerida");
	},
};
const input = { to: "a@b.test", subject: "Hola", body: "Cuerpo" };
// biome-ignore lint/suspicious/noExplicitAny: el ctx de eve se simula parcialmente.
const run = () => (tool as any).execute(input, context);

beforeEach(() => {
	state.hasBinding = true;
	state.sendError = null;
	state.getTokenCalls = [];
	state.requireAuthCalls = 0;
});

describe("send_email", () => {
	it("pide el token de Gmail atado al tenant con authKey gmail", async () => {
		expect(await run()).toEqual({ id: "m1", threadId: "t1" });
		const [provider, options] = state.getTokenCalls[0] as [{ tenantId: string; scopes: string[] }, { authKey: string }];
		expect(provider.tenantId).toBe("tenant-a");
		expect(provider.scopes).toEqual([GMAIL_SEND_SCOPE]);
		expect(options.authKey).toBe("gmail");
	});

	it("rechaza un tenant sin Gmail habilitado", async () => {
		state.hasBinding = false;
		await expect(run()).rejects.toThrow(/Gmail/);
	});

	it("un 401 dispara requireAuth", async () => {
		state.sendError = new GmailUnauthorizedError();
		await expect(run()).rejects.toThrow();
		expect(state.requireAuthCalls).toBe(1);
	});
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npm test -- tests/gmail/send.test.ts tests/tools/send-email.test.ts`
Expected: FAIL (no existen `GmailUnauthorizedError` ni `GMAIL_SEND_SCOPE`, y la tool todavía lee `google_tokens`).

- [ ] **Step 3: Reescribir `lib/gmail/send.ts`**

```ts
// lib/gmail/send.ts
// El access token lo pide send_email a Vercel Connect (spec 02 §7.1). Este
// módulo ya no toca la base.
import { buildRawMessage } from "./mime";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

type MailInput = { to: string; subject: string; body: string };

export class GmailUnauthorizedError extends Error {
	constructor() {
		super("Gmail rechazó el token del usuario");
		this.name = "GmailUnauthorizedError";
	}
}

export async function sendMail(
	accessToken: string,
	input: MailInput,
): Promise<{ id: string; threadId: string }> {
	const res = await fetch(
		"https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ raw: buildRawMessage(input) }),
		},
	);

	if (res.status === 401) throw new GmailUnauthorizedError();
	if (!res.ok) {
		throw new Error(`Gmail no pudo enviar el mail (${res.status}): ${await res.text()}`);
	}

	return (await res.json()) as { id: string; threadId: string };
}
```

- [ ] **Step 4: Reescribir la tool**

```ts
// agents/outreach/tools/send_email.ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { tenantScopedConnect } from "../../../lib/connectors/auth";
import { hasEnabledBinding } from "../../../lib/connectors/bindings";
import { GOOGLE_CONNECTOR_UID } from "../../../lib/connectors/platform";
import {
	GMAIL_SEND_SCOPE,
	GmailUnauthorizedError,
	sendMail,
} from "../../../lib/gmail/send";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// authKey "gmail" es la identidad del flujo de autorización: la usa
// hooks/executors.ts para reconocer que se autorizó Gmail.
export const GMAIL_AUTH_OPTIONS = { authKey: "gmail", displayName: "Google" } as const;

export default defineTool({
	description: "Envía un email desde la casilla de Gmail del usuario autenticado.",
	inputSchema: z.object({
		to: z.string().email(),
		subject: z.string().min(1),
		body: z.string().min(1),
	}),
	approval: always(),
	async execute(input, ctx) {
		const auth = ctx.session.auth.current;
		if (auth?.principalType !== "user" || !auth.principalId) {
			throw new Error("send_email requiere un usuario autenticado");
		}
		const tenantId = attribute(auth.attributes?.tenantId);
		if (!tenantId) throw new Error("la sesión no tiene tenant");
		if (!(await hasEnabledBinding(tenantId, "mail", "gmail"))) {
			throw new Error("este tenant no tiene Gmail habilitado");
		}

		const provider = tenantScopedConnect(GOOGLE_CONNECTOR_UID, tenantId, [GMAIL_SEND_SCOPE]);
		const { token } = await ctx.getToken(provider, GMAIL_AUTH_OPTIONS);
		try {
			return await sendMail(token, input);
		} catch (error) {
			if (error instanceof GmailUnauthorizedError) ctx.requireAuth(provider, GMAIL_AUTH_OPTIONS);
			throw error;
		}
	},
});
```

Si eve rechaza exports con nombre además del default en archivos de `tools/`, mover `GMAIL_AUTH_OPTIONS` a `lib/gmail/send.ts` y ajustar el import del hook de la Task 11.

- [ ] **Step 5: Tests, typecheck y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS, sin errores, build OK.

- [ ] **Step 6: Commit**

```bash
git add lib/gmail/send.ts agents/outreach/tools/send_email.ts tests/gmail/send.test.ts tests/tools/send-email.test.ts
git commit -m "feat: send_email pide el token de gmail a vercel connect"
```

### Task 11: Hook de ejecutores

**Files:**
- Create: `lib/connectors/executors.ts`, `agents/outreach/hooks/executors.ts`
- Test: `tests/connectors/executors.test.ts`, `tests/hooks/executors.test.ts`

**Interfaces:**
- Consumes: `authKey` `"gmail"` (Task 10), `createAdminClient`.
- Produces: `export async function markGmailAuthorized(tenantId: string, userId: string): Promise<void>;`

- [ ] **Step 1: Verificar el nombre del evento contra eve**

Run: `grep -rn "authKey" node_modules/eve/dist/src/harness/authorization.js node_modules/eve/dist/src/runtime/authorization-context.js | head -20`
Confirmar que `authorization.completed` lleva `data.name` igual al `authKey` pasado a `ctx.getToken`. Si el nombre sale de otra fuente (por ejemplo, el nombre de la tool), usar esa fuente en `isGmailAuthorization` y anotar la diferencia en la spec §7.2 antes de seguir.

- [ ] **Step 2: Escribir los tests**

```ts
// tests/connectors/executors.test.ts
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ upserts: [] as unknown[][] }));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			upsert: async (...args: unknown[]) => {
				calls.upserts.push(args);
				return { error: null };
			},
		}),
	}),
}));

const { markGmailAuthorized } = await import("@/lib/connectors/executors");

describe("markGmailAuthorized", () => {
	it("hace upsert por tenant y usuario con la fecha", async () => {
		await markGmailAuthorized("tenant-a", "user-1");
		const [values, options] = calls.upserts[0] as [Record<string, unknown>, Record<string, unknown>];
		expect(values).toMatchObject({ tenant_id: "tenant-a", user_id: "user-1" });
		expect(typeof values.gmail_authorized_at).toBe("string");
		expect(options).toEqual({ onConflict: "tenant_id,user_id" });
	});
});
```

```ts
// tests/hooks/executors.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ marks: [] as string[][], fail: false }));

vi.mock("../../lib/connectors/executors", () => ({
	markGmailAuthorized: async (tenantId: string, userId: string) => {
		if (calls.fail) throw new Error("base caída");
		calls.marks.push([tenantId, userId]);
	},
}));

const { default: hook } = await import("@/agents/outreach/hooks/executors");
// biome-ignore lint/suspicious/noExplicitAny: evento y ctx de eve simulados.
const handler = (hook as any).events["authorization.completed"];

const ctx = {
	session: { auth: { current: { principalType: "user", principalId: "user-1", attributes: { tenantId: "tenant-a" } } } },
};

beforeEach(() => {
	calls.marks = [];
	calls.fail = false;
});

describe("hook de ejecutores", () => {
	it("estampa la autorización de Gmail", async () => {
		await handler({ data: { name: "gmail", outcome: "authorized" } }, ctx);
		expect(calls.marks).toEqual([["tenant-a", "user-1"]]);
	});

	it("ignora otras autorizaciones y resultados", async () => {
		await handler({ data: { name: "hubspot", outcome: "authorized" } }, ctx);
		await handler({ data: { name: "gmail", outcome: "declined" } }, ctx);
		expect(calls.marks).toEqual([]);
	});

	it("nunca tira: la observabilidad no tumba el turno", async () => {
		calls.fail = true;
		await expect(handler({ data: { name: "gmail", outcome: "authorized" } }, ctx)).resolves.toBeUndefined();
	});
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `npm test -- tests/connectors/executors.test.ts tests/hooks/executors.test.ts`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 4: Implementar**

```ts
// lib/connectors/executors.ts
import { createAdminClient } from "../supabase/admin";

export async function markGmailAuthorized(tenantId: string, userId: string): Promise<void> {
	const { error } = await createAdminClient()
		.from("executors")
		.upsert(
			{ tenant_id: tenantId, user_id: userId, gmail_authorized_at: new Date().toISOString() },
			{ onConflict: "tenant_id,user_id" },
		);
	if (error) throw new Error(`No pude registrar la casilla de Gmail: ${error.message}`);
}
```

```ts
// agents/outreach/hooks/executors.ts
import { defineHook } from "eve/hooks";
import { markGmailAuthorized } from "../../../lib/connectors/executors";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// Mismo criterio que hooks/runs.ts: observabilidad, siempre en try/catch.
// "gmail" es el authKey que usa tools/send_email.ts.
export default defineHook({
	events: {
		async "authorization.completed"(event, ctx) {
			try {
				if (event.data.name !== "gmail" || event.data.outcome !== "authorized") return;
				const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
				const tenantId = attribute(auth?.attributes?.tenantId);
				const userId = auth?.principalType === "user" ? auth.principalId : "";
				if (!tenantId || !userId) return;
				await markGmailAuthorized(tenantId, userId);
			} catch (error) {
				console.error("executors hook (authorization.completed):", error);
			}
		},
	},
});
```

- [ ] **Step 5: Tests, typecheck y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS, sin errores, build OK.

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/executors.ts agents/outreach/hooks/executors.ts tests/connectors/executors.test.ts tests/hooks/executors.test.ts
git commit -m "feat: estampar la casilla de gmail del ejecutor al autorizar"
```

### Task 12: Pedido de autorización en el chat

**Files:**
- Modify: `app/[tenant]/chat/chat-client.tsx`

**Interfaces:**
- Consumes: partes `type: "authorization"` del reducer de `useEveAgent` (`EveAuthorizationPart` en `node_modules/eve/dist/src/client/message-reducer-types.d.ts`): `state` `"required" | "completed"`, `displayName`, `name`, `turnId`, `stepIndex`, `authorization?.{ url, userCode, instructions }`.

Sin test unitario: el repo no tiene setup de tests de React. Se verifica con typecheck, build y a mano en la Task 14.

- [ ] **Step 1: Leer la guía**

`node_modules/eve/docs/guides/client/streaming.mdx` §Authorization pauses.

- [ ] **Step 2: Derivar las autorizaciones pendientes**

En `Thread`, debajo de `pendingApprovals`:

```tsx
	// Mientras haya una autorización pendiente, el turno está parqueado: se
	// muestra el botón y se bloquea el input (guides/client/streaming.mdx).
	const pendingAuthorizations = agent.data.messages.flatMap((message) =>
		message.parts.flatMap((part) =>
			part.type === "authorization" && part.state === "required"
				? [{ key: `${part.turnId}-${part.stepIndex}-${part.name}`, part }]
				: [],
		),
	);
	const isAuthorizing = pendingAuthorizations.length > 0;
```

- [ ] **Step 3: Renderizar el pedido**

Antes del bloque de `pendingApprovals.map(...)`:

```tsx
			{pendingAuthorizations.map(({ key, part }) => (
				<fieldset className="rounded border p-3" key={key}>
					<legend className="px-1 text-sm">
						Autorización pendiente: {part.displayName}
					</legend>
					<p className="text-sm">
						{part.authorization?.instructions ??
							`Para seguir, el agente necesita acceso a ${part.displayName} con tu cuenta.`}
					</p>
					{part.authorization?.userCode ? (
						<p className="text-sm">
							Código: <code>{part.authorization.userCode}</code>
						</p>
					) : null}
					{part.authorization?.url ? (
						<Button asChild className="mt-2">
							<a
								href={part.authorization.url}
								rel="noopener noreferrer"
								target="_blank"
							>
								Autorizar {part.displayName}
							</a>
						</Button>
					) : null}
				</fieldset>
			))}
```

- [ ] **Step 4: Bloquear el input mientras hay autorización pendiente**

En el `onSubmit`, cambiar `if (message.length === 0 || isResuming) return;` por `if (message.length === 0 || isResuming || isAuthorizing) return;`. En el `<input>` y en el `<Button type="submit">`, cambiar `disabled={isResuming}` por `disabled={isResuming || isAuthorizing}`.

- [ ] **Step 5: Typecheck, lint y build**

Run: `npm run typecheck && npm run lint:fix && npm run build`
Expected: sin errores. Si `part.type === "authorization"` no estrecha el tipo, verificar en `message-reducer-types.d.ts` que `EveAuthorizationPart` forma parte de la unión de partes que expone `useEveAgent` y ajustar el guard.

- [ ] **Step 6: Commit**

```bash
git add "app/[tenant]/chat/chat-client.tsx"
git commit -m "feat: mostrar en el chat el pedido de autorizacion de conexiones"
```

### Task 13: Baja de `google_tokens`

**Files:**
- Create: `supabase/migrations/<timestamp>_drop_google_tokens.sql`, `supabase/tests/07_google_tokens_dropped.test.sql`
- Modify: `app/auth/callback/route.ts`, `app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: que ningún código lea `google_tokens` (Task 10 lo quitó de `lib/gmail/send.ts`).

- [ ] **Step 1: Verificar que nadie más la usa**

Run: `grep -rn "google_tokens" app lib agents scripts tests --exclude-dir=.eve`
Expected: solo `app/auth/callback/route.ts` y `lib/supabase/database.types.ts`. Cualquier otro uso: STOP y reportar.

- [ ] **Step 2: Escribir el test pgTAP**

```sql
-- supabase/tests/07_google_tokens_dropped.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select hasnt_table(
  'public', 'google_tokens',
  'el refresh token de Google ya no vive en nuestra base: lo guarda Vercel Connect'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Verificar que falla**

Run: `npm run db:test`
Expected: FAIL en `07_google_tokens_dropped.test.sql`.

- [ ] **Step 4: Escribir la migración**

Run: `npx supabase migration new drop_google_tokens`

```sql
-- Gmail pasa a Vercel Connect (spec 02 §3.4 y §7). El refresh token nunca
-- más llega a nuestra base.
drop table public.google_tokens;
```

- [ ] **Step 5: Limpiar el callback**

En `app/auth/callback/route.ts`: borrar la constante `SCOPES` con su comentario, el bloque `const refreshToken = ...` con el `if (refreshToken) { ... }` completo, el import de `createAdminClient`, y el comentario "No se toca google_tokens: la sesión no se pudo establecer." El resto (intercambio de código, `accept_pending_invitations`, redirects) queda igual.

- [ ] **Step 6: Limpiar el login**

En `app/(auth)/login/page.tsx`: `SCOPES` pasa a `"openid email profile"` y se borra `queryParams: { access_type: "offline", prompt: "consent" }`, que solo servía para obtener el refresh token de Gmail. Si `SCOPES` tiene un comentario sobre Gmail, actualizarlo.

- [ ] **Step 7: Tests, typecheck y build**

Run: `npm run db:test && npm test && npm run typecheck && npm run build`
Expected: todo en verde. `lib/supabase/database.types.ts` todavía menciona `google_tokens`: se regenera en la Task 14 después del push.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/*_drop_google_tokens.sql supabase/tests/07_google_tokens_dropped.test.sql app/auth/callback/route.ts "app/(auth)/login/page.tsx"
git commit -m "feat: baja de google_tokens y del refresh token en el login"
```

---

## Entrega 4 · Verificación contra el deploy

### Task 14: Cierre de la etapa

**Files:**
- Modify: `docs/01-roadmap-etapas.md`, `docs/superpowers/specs/02-conexiones-innovas.md`, `lib/supabase/database.types.ts`

Esta tarea tiene pasos que **solo el usuario** puede hacer: `db push`, carga de llaves, consentimiento OAuth, pasar la app de Google a producción. El agente da cada comando y espera la confirmación.

- [ ] **Step 1: Suite completa**

Run: `npm run db:test && npm test && npm run typecheck && npm run build`
Expected: todo en verde.

- [ ] **Step 2: Migraciones en producción (usuario)**

Pedirle al usuario: `npx supabase db push`. Después verificar con `npx supabase migration list` que las dos migraciones de la etapa figuran en `remote`, y regenerar tipos con `npm run db:types`. Commit de `lib/supabase/database.types.ts`.

- [ ] **Step 3: Conectores, plan de Vercel y bindings de `innovas` (usuario)**

Pedirle al usuario, en este orden, según spec §9:
1. **Pasar el team de Vercel de Hobby a Pro** (spec §13). En Hobby, Connect pausa a los 500 token requests por mes y la verificación puede cortarse a mitad de camino.
2. Conectores `api-key` que falten: `innovas-coldiq` ya existe; crear `innovas-places` con el formulario de `vercel connect create` (spec §9.1: API Key, Shared API Keys, UID a mano). `innovas-brain` solo si la Task 5B se ejecutó. Verificar cada uno con el comando OIDC de spec §9.1, no con `vercel connect token`.
3. Bindings contra producción:
   - `npm run connections:bind -- --tenant innovas --capability leads --provider coldiq --connector innovas-coldiq`
   - `npm run connections:bind -- --tenant innovas --capability leads --provider google-places --connector innovas-places`
   - `npm run connections:bind -- --tenant innovas --capability crm --provider hubspot`
   - `npm run connections:bind -- --tenant innovas --capability mail --provider gmail`
   - Solo con la Task 5B hecha: `npm run connections:bind -- --tenant innovas --capability brain --provider innovas-brains --connector innovas-brain --url <url del brain>`
4. Pasar la app de Google a producción en Google Cloud (spec §9.3, paso 2).

- [ ] **Step 4: Deploy**

Pedirle permiso al usuario para `git push` a `main`. Esperar el build de Vercel y verificar `https://agents-six-iota.vercel.app/eve/agents/outreach/eve/v1/health` con `{"ok":true,...}`.

- [ ] **Step 5: Verificación manual del criterio de cierre (usuario, guiado)**

1. **Criterio 1:** en `/innovas/chat`, hilo nuevo con `anthropic/claude-sonnet-5`, pedir "buscá en el CRM el contacto <mail conocido>". Tiene que aparecer el botón "Autorizar HubSpot"; autorizar; el agente responde usando `crm__search_crm_objects`. Después pedir "buscá en el brain qué dice el ICP" y confirmar `brain__brain_search`. **Si la Task 5B no se ejecutó, la parte del brain queda pendiente:** anotarlo en el cierre como criterio 1 parcial, sin marcar la etapa como terminada.
   - Extra ColdIQ: pedir "buscá el email de <persona conocida> en <empresa>" y confirmar `leads-coldiq__findEmail` con resultado.
2. **Criterio 2:** crear un tenant de prueba sin bindings, entrar con un usuario miembro, pedir "¿qué conexiones tenés?". `connection_search` no puede listar `crm`.
3. **Criterio 3:** pedir un mail de prueba a una casilla propia. Aprobar, autorizar Google, confirmar que llega. Confirmar en la base que `executors.gmail_authorized_at` quedó estampado para ese usuario en `innovas`.
4. **Criterio 4 (S7):** el mismo usuario, miembro también del tenant de prueba con un binding `crm`/`hubspot` creado para esta verificación, abre un hilo ahí y pide una búsqueda en el CRM. **Tiene que volver a pedir "Autorizar HubSpot".** Si no lo pide, es una fuga de grant entre tenants: STOP, reportar como Critical.
5. **Criterio 5:** como `platform_admin` en `innovas`, pedir "creá las propiedades de outreach en HubSpot", aprobar, y verificar en HubSpot el grupo `outreach` con las 8 propiedades. Repetir el pedido: `created` tiene que venir vacío.
6. Borrar el binding `crm` del tenant de prueba.

- [ ] **Step 6: Documentar el cierre**

- En la spec, anotar en §10.1 el resultado de S7 (criterio 4) y, si hubo, el de la escritura de propiedades con el token del MCP (criterio 5).
- En `docs/01-roadmap-etapas.md`, Etapa 2: marcar `[x]`, tildar tareas, aplicar las enmiendas de spec §14 y anotar bajo "Terminado cuando" la fecha y el resultado de cada criterio, incluido S7.

- [ ] **Step 7: Commit**

```bash
git add docs/01-roadmap-etapas.md docs/superpowers/specs/02-conexiones-innovas.md lib/supabase/database.types.ts
git commit -m "docs: cierre de la etapa 2 con verificacion contra el deploy"
```

Después: `/context-save`.

---

## Notas para quien implemente

- **El orden de las Tasks 10 y 13 importa.** `send_email` deja de leer `google_tokens` antes de que la tabla se borre.
- **El brain es la única parte bloqueada.** La Task 5B no se ejecuta hasta que termine el rediseño del brain y spec §6.2 pierda el aviso "En suspenso". El resto de la etapa no depende de ella.
- **Un conector `api-key` no se prueba con `vercel connect token <uid> --subject app`:** falla con "Token subject is not accessible to this requester" porque el subject `app` lo pide el proyecto. Usar el comando OIDC de spec §9.1.
- **Los tokens de Connect duran ~15 min** y el SDK los cachea en proceso. Una llave rotada puede tardar eso en llegar a las instancias vivas: la rotación de spec §9.1 deja convivir las dos llaves ese rato.
- **Los tests con `vi.mock` usan la ruta relativa desde `tests/`** (`../../lib/...`) cuando el módulo bajo prueba importa con ruta relativa, igual que `tests/agents/session-store.test.ts`. Si un mock no toma, revisar que la ruta resuelva al mismo archivo.
- **`.eve/` tiene snapshots compilados** con código viejo (incluido `getAccessToken`). No son fuente: los greps y el test de import los excluyen.
- **Nunca correr `connections:bind` contra producción** fuera de la Task 14, y nunca con valores inventados.
