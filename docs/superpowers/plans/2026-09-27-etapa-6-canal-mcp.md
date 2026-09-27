# Etapa 6 · Canal MCP del agente — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Claude Code y claude.ai puedan invocar al agente `outreach` de un tenant directamente (no solo leer/escribir su brain), reusando el emisor OAuth que la Etapa 11 ya dejó construido y verificado en producción.

**Architecture:** Un canal nuevo de eve (`agents/outreach/channels/mcp.ts`, `mcpChannel` con `oauthResource`) resuelve el tenant desde `?tenant=<slug>` en la URL de conexión — nunca de un argumento — y reusa el mismo verificador de claims y la misma lectura de membresías que ya arma el endpoint del brain, movidos a un módulo compartido. Dos hooks existentes (`runs.ts`, `bind-session.ts`) se ajustan para que una sesión que arranca por este canal quede marcada `trigger: 'mcp'` en `runs` y no cree una fila de `conversations` del dashboard.

**Tech Stack:** eve 0.54.2 (`mcpChannel`, `oauthResource`), Supabase Auth (mismo emisor de la Etapa 11), vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md`. Leerla entera antes de arrancar: este plan argumenta desde ahí y cita sus decisiones como D-MCP-1…D-MCP-5.

## Global Constraints

- Español rioplatense en UI, mensajes de error y docs. Código e identificadores en inglés.
- El tenant de una sesión MCP sale solo de `?tenant=<slug>` en la URL de conexión (D-MCP-1); nunca de un argumento que el modelo pueda mandar.
- Los roles se resuelven **antes** que el tenant (mismo motivo que `access.ts` de la Etapa 11, hallazgo F4): nadie sin acceso puede distinguir un slug que existe de uno inventado.
- Una sesión que arranca por este canal no crea una fila en `conversations` (D-MCP-2); solo `runs` (`trigger: 'mcp'`) y `events`.
- El canal no exige `client_id` en el token (D-MCP-3, al revés de D7 de la Etapa 11): un token de sesión normal del dashboard también puede arrancar una sesión por acá.
- El verificador de claims y la lectura de membresías/tenant se comparten con el endpoint del brain, en un solo lugar (`lib/auth/oauth-principal.ts`), no se duplican (D-MCP-4).
- Sin acceso: `ForbiddenError` con mensaje propio, nunca un 401 genérico (D-MCP-5).
- El canal MCP no lleva `localDev()` ni `evalAuth()` como fallback: siempre pasa por `oauthResource`, igual que el endpoint del brain no tuvo un modo sin auth.
- `verifyMcpChannelToken` (el adaptador, dentro de `lib/agents/mcp-channel-auth.ts`) es el único punto que importa `UnauthenticatedError`/`ForbiddenError` de `eve/channels/auth` en este trabajo — `resolveMcpChannelAuth`, la función pura del mismo archivo, no depende de esas clases, y `agents/outreach/channels/mcp.ts` tampoco las importa directamente.
- Comandos: `npm test`, `npm run typecheck`. `lint:fix` reformatea archivos ajenos (suele ser una veintena, no solo 4): revertirlos con `git checkout -- <archivo>` antes de commitear.
- Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` y el trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Rama actual: `main`, al día con `origin/main` (Etapa 11 ya mergeada). Crear una rama nueva para este trabajo antes de la Task 1.

## Review Focus

1. **Oráculo de slugs.** Alguien sin acceso a ningún tenant no puede distinguir, por el mensaje de error, un slug que existe de uno inventado — solo un `platform_admin` ve el mensaje más específico. Test en Task 2.
2. **El query string de la URL de conexión llega intacto a la función de auth.** `mcpChannel` tiene una ruta fija; si eve normalizara o recortara el `Request` antes de invocar `auth`, `?tenant=` se perdería y ninguna sesión podría resolver tenant. Verificación manual en Task 2 antes de dar la Task por terminada, no solo un test unitario.
3. **Un verificador de claims que explota con un token roto no puede tirar hacia arriba.** Mismo motivo que el fix de la Etapa 11 sobre un token malformado (F1 de esa etapa). Test en Task 2.
4. **`platform_admin` sin fila de membresía propia en el tenant al que se conecta.** Su fila real vive bajo otro tenant (hoy, bajo `innovas`); `role` en los `attributes` de la sesión no puede quedar `undefined`. Test en Task 2.
5. **Una sesión MCP no debe dejar rastro en `conversations`.** Es un cambio en un hook (`bind-session.ts`) que hoy corre para *toda* sesión sin excepción — una regresión ahí haría fallar el turno completo (el hook no tiene `try/catch` a propósito). Test en Task 3.

---

## Mapa de archivos

| Archivo | Responsabilidad | Task |
|---|---|---|
| `lib/auth/oauth-principal.ts` | Verificador de claims + lectura de membresías/tenant, compartido | 1 |
| `lib/brain/mcp-server/supabase.ts` | Delega en `oauth-principal.ts`; solo le queda el contador propio del brain | 1 |
| `lib/agents/mcp-channel-auth.ts` | `resolveMcpChannelAuth` (puro) + `verifyMcpChannelToken` (adaptador de eve) | 2 |
| `agents/outreach/channels/mcp.ts` | El canal en sí | 2 |
| `lib/agents/session-store.ts` | `OpenRunInput.trigger` obligatorio | 3 |
| `agents/outreach/hooks/runs.ts` | Decide `trigger` según el `authenticator` | 3 |
| `agents/outreach/hooks/bind-session.ts` | Se salta la atadura a `conversations` para sesiones MCP | 3 |
| `docs/agente-mcp-conexion.md` | Doc de conexión del agente | 4 |
| `docs/brain-mcp-conexion.md` | Fix de paso: dominio desactualizado | 4 |
| `docs/01-roadmap-etapas.md` | Cierre de la Etapa 6 (código hecho, verificación pendiente) | 4 |

---

## Task 1: Verificador de claims y membresías compartidos

**Files:**
- Create: `lib/auth/oauth-principal.ts`
- Modify: `lib/brain/mcp-server/supabase.ts`
- Test: `tests/auth/oauth-principal.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` de `lib/supabase/admin` (ya existe).
- Produces:
  - `createOAuthClaimsVerifier(): (token: string) => Promise<Record<string, unknown> | null>`
  - `loadMemberships(userId: string): Promise<{ tenantId: string; role: string }[]>`
  - `loadTenantBySlug(slug: string): Promise<{ id: string; active: boolean } | null>`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/auth/oauth-principal.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
	createClient: () => ({ auth: { getClaims } }),
}));

const membershipsRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
const tenantRow = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from(table: string) {
			if (table === "memberships") {
				return {
					select: () => ({
						eq: async () => ({ data: membershipsRows.rows, error: null }),
					}),
				};
			}
			if (table === "tenants") {
				return {
					select: () => ({
						eq: () => ({
							maybeSingle: async () => ({ data: tenantRow.value, error: null }),
						}),
					}),
				};
			}
			throw new Error(`tabla inesperada en el mock: ${table}`);
		},
	}),
}));

const { createOAuthClaimsVerifier, loadMemberships, loadTenantBySlug } = await import(
	"@/lib/auth/oauth-principal"
);

beforeEach(() => {
	getClaims.mockReset();
	membershipsRows.rows = [];
	tenantRow.value = null;
});

describe("createOAuthClaimsVerifier", () => {
	it("devuelve los claims cuando el token es válido", async () => {
		getClaims.mockResolvedValue({
			data: { claims: { sub: "user-1", client_id: "claude" } },
			error: null,
		});
		const verify = createOAuthClaimsVerifier();
		expect(await verify("token")).toEqual({ sub: "user-1", client_id: "claude" });
	});

	it("devuelve null si getClaims falla", async () => {
		getClaims.mockResolvedValue({ data: null, error: new Error("vencido") });
		const verify = createOAuthClaimsVerifier();
		expect(await verify("token")).toBeNull();
	});
});

describe("loadMemberships", () => {
	it("mapea tenant_id y role de cada fila", async () => {
		membershipsRows.rows = [
			{ tenant_id: "tenant-a", role: "tenant_admin" },
			{ tenant_id: "tenant-b", role: "platform_admin" },
		];
		expect(await loadMemberships("user-1")).toEqual([
			{ tenantId: "tenant-a", role: "tenant_admin" },
			{ tenantId: "tenant-b", role: "platform_admin" },
		]);
	});

	it("sin filas, lista vacía", async () => {
		expect(await loadMemberships("user-1")).toEqual([]);
	});
});

describe("loadTenantBySlug", () => {
	it("devuelve id y active cuando existe", async () => {
		tenantRow.value = { id: "tenant-a", active: true };
		expect(await loadTenantBySlug("a")).toEqual({ id: "tenant-a", active: true });
	});

	it("null cuando no existe", async () => {
		expect(await loadTenantBySlug("zzz")).toBeNull();
	});
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run tests/auth/oauth-principal.test.ts`
Expected: FAIL, `Cannot find module '@/lib/auth/oauth-principal'`.

- [ ] **Step 3: Implementar**

```ts
// lib/auth/oauth-principal.ts
// Verificación de tokens del emisor OAuth y lectura de membresías/tenants,
// compartido entre el endpoint del brain (Etapa 11) y el canal MCP del
// agente (Etapa 6). Sin nada específico de ninguno de los dos.
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";

export function createOAuthClaimsVerifier(): (
	token: string,
) => Promise<Record<string, unknown> | null> {
	const client = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{ auth: { persistSession: false, autoRefreshToken: false } },
	);
	return async (token) => {
		const { data, error } = await client.auth.getClaims(token);
		if (error || !data) {
			if (error) console.warn(`oauth: getClaims falló (${error.name})`);
			return null;
		}
		return data.claims as Record<string, unknown>;
	};
}

export async function loadMemberships(
	userId: string,
): Promise<{ tenantId: string; role: string }[]> {
	const { data, error } = await createAdminClient()
		.from("memberships")
		.select("tenant_id, role")
		.eq("user_id", userId);
	if (error) throw new Error(`No pude leer las membresías: ${error.message}`);
	return (data ?? []).map((row) => ({
		tenantId: row.tenant_id as string,
		role: row.role as string,
	}));
}

export async function loadTenantBySlug(
	slug: string,
): Promise<{ id: string; active: boolean } | null> {
	const { data, error } = await createAdminClient()
		.from("tenants")
		.select("id, active")
		.eq("slug", slug)
		.maybeSingle();
	if (error) throw new Error(`No pude leer el tenant: ${error.message}`);
	return data
		? { id: data.id as string, active: data.active as boolean }
		: null;
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run tests/auth/oauth-principal.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Refactorizar `lib/brain/mcp-server/supabase.ts` para delegar**

Reemplazar `supabaseClaimsVerifier` y `supabaseAccessStore` (dejar `supabaseHit` tal cual está):

```ts
// Dependencias reales del endpoint: el verificador del emisor y las lecturas
// de acceso viven en lib/auth/oauth-principal.ts (compartido con el canal
// MCP del agente, Etapa 6); acá solo queda lo específico del brain.
import { loadTenantBindings } from "../../connectors/bindings";
import {
	createOAuthClaimsVerifier,
	loadMemberships,
	loadTenantBySlug,
} from "../../auth/oauth-principal";
import { createAdminClient } from "../../supabase/admin";
import { resolveBrainBinding } from "../resolve.ts";
import type { AccessStore, ClaimsVerifier } from "./access.ts";
import type { HitFn } from "./rate-limit.ts";

export function supabaseClaimsVerifier(): ClaimsVerifier {
	return createOAuthClaimsVerifier();
}

export function supabaseAccessStore(): AccessStore {
	return {
		tenantBySlug: loadTenantBySlug,
		rolesOf: loadMemberships,
		brainBinding: (tenantId) =>
			resolveBrainBinding(tenantId, loadTenantBindings),
	};
}
```

- [ ] **Step 6: Correr toda la suite del brain y el typecheck — no debería cambiar nada**

Run: `npx vitest run tests/brain && npm run typecheck`
Expected: PASS, exactamente los mismos tests que antes (los tests de `access.test.ts`/`handler.test.ts` consumen `AccessStore`/`ClaimsVerifier` por su interfaz, no les importa de dónde sale la implementación).

- [ ] **Step 7: Commit**

```bash
git add lib/auth/oauth-principal.ts lib/brain/mcp-server/supabase.ts tests/auth/oauth-principal.test.ts
git commit -m "$(cat <<'EOF'
refactor: verificador de claims y membresías compartido

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: El canal MCP del agente

**Files:**
- Create: `lib/agents/mcp-channel-auth.ts`, `agents/outreach/channels/mcp.ts`
- Test: `tests/agents/mcp-channel-auth.test.ts`

**Interfaces:**
- Consumes: `createOAuthClaimsVerifier`, `loadMemberships`, `loadTenantBySlug` (Task 1); `extractBearerToken`, `UnauthenticatedError`, `ForbiddenError`, `AuthFn` de `eve/channels/auth`; `mcpChannel`, `oauthResource` de `eve/channels/mcp` y `eve/channels/auth`.
- Produces:
  - `type McpChannelAuthDeps = { verify: (token: string) => Promise<Record<string, unknown> | null>; tenantBySlug: (slug: string) => Promise<{ id: string; active: boolean } | null>; membershipsOf: (userId: string) => Promise<{ tenantId: string; role: string }[]> }`.
  - `type McpChannelAuth = { ok: true; sessionAuth: SessionAuthContext } | { ok: false; kind: "unauthenticated" | "forbidden"; message: string }`.
  - `resolveMcpChannelAuth(request: Request, deps: McpChannelAuthDeps): Promise<McpChannelAuth>`.
  - `verifyMcpChannelToken(request: Request): Promise<SessionAuthContext>` (throws `UnauthenticatedError`/`ForbiddenError`).

**Nota de tipos:** `SessionAuthContext` no está exportado por su nombre desde `eve/channels/auth` (solo aparece usado dentro de otras firmas, como `AuthFn`). Se deriva así, sin depender de un export que no existe:

```ts
import type { AuthFn } from "eve/channels/auth";
type SessionAuthContext = Exclude<Awaited<ReturnType<AuthFn<Request>>>, null | undefined>;
```

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/agents/mcp-channel-auth.test.ts
import { describe, expect, it, vi } from "vitest";
import {
	type McpChannelAuthDeps,
	resolveMcpChannelAuth,
} from "@/lib/agents/mcp-channel-auth";

function deps(overrides: Partial<McpChannelAuthDeps> = {}): McpChannelAuthDeps {
	return {
		verify: async (token) =>
			token === "vencido" ? null : { sub: token, email: `${token}@a.test` },
		tenantBySlug: async (slug) =>
			slug === "a"
				? { id: "tenant-a", active: true }
				: slug === "inactivo"
					? { id: "tenant-inactivo", active: false }
					: null,
		membershipsOf: async (userId) =>
			userId === "ana"
				? [{ tenantId: "tenant-a", role: "tenant_member" }]
				: userId === "admin"
					? [{ tenantId: "tenant-a", role: "tenant_admin" }]
					: userId === "root"
						? [{ tenantId: "tenant-x", role: "platform_admin" }]
						: [],
		...overrides,
	};
}

function request(bearer: string | null, tenant: string | null) {
	const url = new URL("https://agentes.innov.as/eve/v1/mcp");
	if (tenant !== null) url.searchParams.set("tenant", tenant);
	const headers = new Headers();
	if (bearer !== null) headers.set("authorization", `Bearer ${bearer}`);
	return new Request(url, { headers });
}

describe("resolveMcpChannelAuth", () => {
	it("un miembro entra a su tenant, con su role", async () => {
		expect(await resolveMcpChannelAuth(request("ana", "a"), deps())).toEqual({
			ok: true,
			sessionAuth: {
				authenticator: "oauth",
				issuer: expect.any(String),
				principalId: "ana",
				principalType: "user",
				subject: "ana",
				attributes: {
					email: "ana@a.test",
					tenantId: "tenant-a",
					tenantSlug: "a",
					role: "tenant_member",
				},
			},
		});
	});

	it("un platform_admin sin fila propia en ese tenant igual entra, con role platform_admin", async () => {
		const result = await resolveMcpChannelAuth(request("root", "a"), deps());
		expect(result).toMatchObject({
			ok: true,
			sessionAuth: { attributes: { tenantId: "tenant-a", role: "platform_admin" } },
		});
	});

	it("sin token es unauthenticated", async () => {
		expect(await resolveMcpChannelAuth(request(null, "a"), deps())).toEqual({
			ok: false,
			kind: "unauthenticated",
			message: expect.any(String),
		});
	});

	it("un token que el verificador rechaza es unauthenticated", async () => {
		expect(await resolveMcpChannelAuth(request("vencido", "a"), deps())).toMatchObject({
			ok: false,
			kind: "unauthenticated",
		});
	});

	it("un verificador que explota es unauthenticated, no una excepción", async () => {
		const throwing = deps({
			verify: async () => {
				throw new SyntaxError("token roto");
			},
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await resolveMcpChannelAuth(request("roto", "a"), throwing);
		expect(result).toMatchObject({ ok: false, kind: "unauthenticated" });
		expect(JSON.stringify(result)).not.toContain("token roto");
		warn.mockRestore();
	});

	it("sin ?tenant en la URL es forbidden con mensaje propio", async () => {
		expect(await resolveMcpChannelAuth(request("ana", null), deps())).toEqual({
			ok: false,
			kind: "forbidden",
			message: expect.stringContaining("tenant"),
		});
	});

	it("un tenant inexistente o inactivo da el mismo mensaje para quien no es platform_admin", async () => {
		const inexistente = await resolveMcpChannelAuth(request("ana", "zzz"), deps());
		const inactivo = await resolveMcpChannelAuth(request("ana", "inactivo"), deps());
		expect(inexistente).toMatchObject({ ok: false, kind: "forbidden" });
		expect(inactivo).toMatchObject({ ok: false, kind: "forbidden" });
		expect((inexistente as { message: string }).message).toBe(
			(inactivo as { message: string }).message,
		);
	});

	it("un platform_admin sí distingue el tenant inexistente (oráculo solo para quien ya tiene el máximo acceso)", async () => {
		const noAdmin = await resolveMcpChannelAuth(request("ana", "zzz"), deps());
		const admin = await resolveMcpChannelAuth(request("root", "zzz"), deps());
		expect((noAdmin as { message: string }).message).not.toBe(
			(admin as { message: string }).message,
		);
	});

	it("sin membresía en un tenant que sí existe: forbidden", async () => {
		// ana solo tiene membresía en tenant-a (ver deps()); acá se conecta a un
		// tenant-b real donde no tiene ninguna fila.
		const sinMembresiaAhi = deps({
			tenantBySlug: async (slug) =>
				slug === "b" ? { id: "tenant-b", active: true } : null,
		});
		expect(
			await resolveMcpChannelAuth(request("ana", "b"), sinMembresiaAhi),
		).toMatchObject({ ok: false, kind: "forbidden" });
	});
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run tests/agents/mcp-channel-auth.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar `lib/agents/mcp-channel-auth.ts`**

```ts
// lib/agents/mcp-channel-auth.ts
// Acceso al canal MCP del agente (spec etapa 6 §4.2, D-MCP-1, D-MCP-3,
// D-MCP-5). El tenant sale de ?tenant= en la URL de conexión, nunca de un
// argumento. Los roles se resuelven antes que el tenant: mismo motivo que
// access.ts de la Etapa 11 (F4) — nadie sin acceso distingue qué slugs
// existen por el mensaje de error.
import {
	type AuthFn,
	extractBearerToken,
	ForbiddenError,
	UnauthenticatedError,
} from "eve/channels/auth";
import { createOAuthClaimsVerifier, loadMemberships, loadTenantBySlug } from "../auth/oauth-principal";

type SessionAuthContext = Exclude<Awaited<ReturnType<AuthFn<Request>>>, null | undefined>;

export interface McpChannelAuthDeps {
	verify: (token: string) => Promise<Record<string, unknown> | null>;
	tenantBySlug: (slug: string) => Promise<{ id: string; active: boolean } | null>;
	membershipsOf: (userId: string) => Promise<{ tenantId: string; role: string }[]>;
}

export type McpChannelAuth =
	| { ok: true; sessionAuth: SessionAuthContext }
	| { ok: false; kind: "unauthenticated" | "forbidden"; message: string };

function deny(kind: "unauthenticated" | "forbidden", message: string): McpChannelAuth {
	return { ok: false, kind, message };
}

export async function resolveMcpChannelAuth(
	request: Request,
	deps: McpChannelAuthDeps,
): Promise<McpChannelAuth> {
	const token = extractBearerToken(request.headers.get("authorization"));
	if (!token) return deny("unauthenticated", "El token no es válido o venció.");

	let claims: Record<string, unknown> | null;
	try {
		claims = await deps.verify(token);
	} catch (error) {
		console.warn(
			`canal mcp: el verificador rechazó el token (${error instanceof Error ? error.name : "desconocido"})`,
		);
		return deny("unauthenticated", "El token no es válido o venció.");
	}
	if (!claims || typeof claims.sub !== "string" || claims.sub === "") {
		return deny("unauthenticated", "El token no es válido o venció.");
	}
	const userId = claims.sub;

	const slug = new URL(request.url).searchParams.get("tenant");
	if (!slug) {
		return deny(
			"forbidden",
			"Falta el tenant en la URL de conexión: agregá ?tenant=<slug>.",
		);
	}

	const roles = await deps.membershipsOf(userId);
	const platformAdmin = roles.some((row) => row.role === "platform_admin");

	const tenant = await deps.tenantBySlug(slug);
	if (!tenant || !tenant.active) {
		return deny(
			"forbidden",
			platformAdmin ? "No existe ese cliente." : "No tenés acceso a ese cliente.",
		);
	}

	const own = roles.find((row) => row.tenantId === tenant.id);
	if (!platformAdmin && !own) {
		return deny("forbidden", "No tenés acceso a ese cliente.");
	}

	const role = own?.role ?? "platform_admin";

	return {
		ok: true,
		sessionAuth: {
			authenticator: "oauth",
			issuer: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`,
			principalId: userId,
			principalType: "user",
			subject: userId,
			attributes: {
				email: typeof claims.email === "string" ? claims.email : "",
				tenantId: tenant.id,
				tenantSlug: slug,
				role,
			},
		},
	};
}

let cachedVerify: ((token: string) => Promise<Record<string, unknown> | null>) | undefined;

export async function verifyMcpChannelToken(request: Request): Promise<SessionAuthContext> {
	if (!cachedVerify) cachedVerify = createOAuthClaimsVerifier();
	const result = await resolveMcpChannelAuth(request, {
		verify: cachedVerify,
		tenantBySlug: loadTenantBySlug,
		membershipsOf: loadMemberships,
	});
	if (result.ok) return result.sessionAuth;
	if (result.kind === "unauthenticated") {
		throw new UnauthenticatedError({ message: result.message });
	}
	throw new ForbiddenError({ message: result.message });
}
```

`cachedVerify` construye el cliente de Supabase una sola vez por proceso — mismo motivo que `productionDeps()` de la Etapa 11: el cache de JWKS de `getClaims` tiene que sobrevivir entre requests.

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run tests/agents/mcp-channel-auth.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Implementar el canal**

```ts
// agents/outreach/channels/mcp.ts
// Canal MCP del agente (spec etapa 6). Reusa el emisor OAuth que la Etapa 11
// dejó construido y verificado en producción — el resource cambia, el
// emisor no.
import { oauthResource } from "eve/channels/auth";
import { mcpChannel } from "eve/channels/mcp";
import { verifyMcpChannelToken } from "../../../lib/agents/mcp-channel-auth";

const issuer = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
const resource = `${process.env.PUBLIC_APP_URL}/eve/v1/mcp`;

export default mcpChannel({
	auth: oauthResource(verifyMcpChannelToken, {
		issuer,
		resource,
		scopes: ["agent:invoke"],
	}),
});
```

Sin `NEXT_PUBLIC_SUPABASE_URL` o `PUBLIC_APP_URL`, `issuer`/`resource` quedan como `"undefined/auth/v1"` — no tira al cargar, pero produce una metadata rota. Si al correr `npm run typecheck` o el dev server aparece algo raro acá, confirmar que las dos variables estén en `.env.local` (ya deberían estarlo, de la Etapa 11).

- [ ] **Step 6: Verificación manual — el query string llega intacto**

Antes de dar la task por terminada: levantar el dev server (`npx eve dev` o `npm run dev`, según cómo se pruebe localmente en este repo) y confirmar que una request a `/eve/v1/mcp?tenant=innovas` efectivamente le llega a `verifyMcpChannelToken` con esa query string — por ejemplo, agregando un `console.log(request.url)` temporal adentro de `verifyMcpChannelToken`, pegándole con `curl -X POST localhost:3000/eve/v1/mcp?tenant=innovas -H "content-type: application/json" -d '{}'` (sin token, alcanza con ver el log antes de que falle la auth), y **sacando el `console.log` antes de commitear**. Si el query string no llega, es un bloqueante: hay que revisar si `mcpChannel` expone alguna opción para pasarlo, o si hace falta otro mecanismo (avisar y no seguir adivinando).

- [ ] **Step 7: Typecheck y suite completa**

Run: `npx vitest run tests/agents tests/brain && npm run typecheck && npm test`
Expected: todo en verde.

- [ ] **Step 8: Commit**

```bash
git add lib/agents/mcp-channel-auth.ts agents/outreach/channels/mcp.ts tests/agents/mcp-channel-auth.test.ts
git commit -m "$(cat <<'EOF'
feat: canal MCP del agente, con el tenant desde la URL de conexión

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `trigger: 'mcp'` en `runs`, sin fila en `conversations`

**Files:**
- Modify: `lib/agents/session-store.ts`, `agents/outreach/hooks/runs.ts`, `agents/outreach/hooks/bind-session.ts`
- Test: `tests/agents/session-store.test.ts` (existente, ajustar), `tests/hooks/runs.test.ts` (nuevo), `tests/hooks/bind-session.test.ts` (nuevo)

**Interfaces:**
- Consumes: `authenticator` de `ctx.session.auth.current ?? ctx.session.auth.initiator` (ya lo estampan `agents/outreach/channels/eve.ts` con `"app"` y el canal de la Task 2 con `"oauth"`).
- Produces: `OpenRunInput.trigger: "chat" | "mcp"` (obligatorio, sin default).

- [ ] **Step 1: Ajustar el test existente de `openRun` — verlo fallar**

En `tests/agents/session-store.test.ts`, el `describe("openRun")` actual pasa a:

```ts
describe("openRun", () => {
	it("inserta el run en estado running, con el trigger que le pasan", async () => {
		await openRun({
			tenantId: "tenant-1",
			conversationId: "conv-1",
			agent: "outreach",
			sessionId: "wrun_A",
			turnId: "turn-1",
			trigger: "chat",
		});

		expect(calls.inserts[0]).toMatchObject({
			tenant_id: "tenant-1",
			agent: "outreach",
			trigger: "chat",
			eve_session_id: "wrun_A",
			eve_turn_id: "turn-1",
			status: "running",
		});
	});

	it("acepta trigger mcp", async () => {
		await openRun({
			tenantId: "tenant-1",
			conversationId: null,
			agent: "outreach",
			sessionId: "wrun_B",
			turnId: "turn-2",
			trigger: "mcp",
		});

		expect(calls.inserts[0]).toMatchObject({ trigger: "mcp" });
	});
});
```

Run: `npx vitest run tests/agents/session-store.test.ts`
Expected: FAIL — `trigger` no existe todavía en `OpenRunInput`, TypeScript se queja (o, si vitest no chequea tipos, el insert real sigue mandando `"chat"` hardcodeado y el segundo test falla).

- [ ] **Step 2: Implementar el cambio en `session-store.ts`**

```ts
export interface OpenRunInput {
	tenantId: string;
	conversationId: string | null;
	agent: string;
	sessionId: string;
	turnId: string;
	trigger: "chat" | "mcp";
}

export async function openRun(input: OpenRunInput): Promise<void> {
	const admin = createAdminClient();
	const { error } = await admin.from("runs").insert({
		tenant_id: input.tenantId,
		agent: input.agent,
		trigger: input.trigger,
		eve_session_id: input.sessionId,
		eve_turn_id: input.turnId,
		conversation_id: input.conversationId,
		status: "running",
	});
	if (error) console.error("openRun:", error.message);
}
```

- [ ] **Step 3: Correr y ver que pasa**

Run: `npx vitest run tests/agents/session-store.test.ts`
Expected: PASS.

- [ ] **Step 4: Actualizar `runs.ts` — test que falla primero**

```ts
// tests/hooks/runs.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ opens: [] as unknown[] }));

vi.mock("../../lib/agents/session-store", () => ({
	openRun: async (input: unknown) => {
		calls.opens.push(input);
	},
	closeRun: async () => {},
}));

const { default: hook } = await import("@/agents/outreach/hooks/runs");
// biome-ignore lint/suspicious/noExplicitAny: evento y ctx de eve simulados.
const turnStarted = (hook as any).events["turn.started"];

function ctx(authenticator: string | undefined) {
	return {
		agent: { name: "outreach" },
		session: {
			id: "wrun_A",
			auth: {
				current: {
					authenticator,
					attributes: { tenantId: "tenant-1" },
				},
			},
		},
	};
}

beforeEach(() => {
	calls.opens = [];
});

describe("hook de runs — trigger", () => {
	it("authenticator oauth abre el run con trigger mcp", async () => {
		await turnStarted({ data: { turnId: "turn-1" } }, ctx("oauth"));
		expect(calls.opens).toEqual([
			expect.objectContaining({ trigger: "mcp" }),
		]);
	});

	it("authenticator app abre el run con trigger chat", async () => {
		await turnStarted({ data: { turnId: "turn-1" } }, ctx("app"));
		expect(calls.opens).toEqual([
			expect.objectContaining({ trigger: "chat" }),
		]);
	});

	it("sin authenticator, trigger chat", async () => {
		await turnStarted({ data: { turnId: "turn-1" } }, ctx(undefined));
		expect(calls.opens).toEqual([
			expect.objectContaining({ trigger: "chat" }),
		]);
	});
});
```

Run: `npx vitest run tests/hooks/runs.test.ts`
Expected: FAIL (`openRun` mock recibe el objeto sin `trigger`, o `trigger` sale `undefined`).

- [ ] **Step 5: Implementar el cambio en `runs.ts`**

En `agents/outreach/hooks/runs.ts`, dentro de `"turn.started"`:

```ts
async "turn.started"(event, ctx) {
	try {
		const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
		const tenantId = attribute(auth?.attributes?.tenantId);
		if (!tenantId) return;

		await openRun({
			tenantId,
			conversationId: attribute(auth?.attributes?.conversationId) || null,
			agent: ctx.agent.name,
			sessionId: ctx.session.id,
			turnId: event.data.turnId,
			trigger: auth?.authenticator === "oauth" ? "mcp" : "chat",
		});
	} catch (error) {
		console.error("runs hook (turn.started):", error);
	}
},
```

- [ ] **Step 6: Correr y ver que pasa**

Run: `npx vitest run tests/hooks/runs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: `bind-session.ts` — test que falla primero**

```ts
// tests/hooks/bind-session.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ binds: [] as unknown[] }));

vi.mock("../../lib/agents/session-store", () => ({
	bindSessionToConversation: async (conversationId: string, sessionId: string) => {
		calls.binds.push([conversationId, sessionId]);
	},
}));

const { default: hook } = await import("@/agents/outreach/hooks/bind-session");
// biome-ignore lint/suspicious/noExplicitAny: ctx de eve simulado.
const sessionStarted = (hook as any).events["session.started"];

function ctx(authenticator: string | undefined, conversationId?: string) {
	return {
		session: {
			id: "wrun_A",
			auth: {
				initiator: {
					authenticator,
					attributes: { conversationId },
				},
			},
		},
	};
}

beforeEach(() => {
	calls.binds = [];
});

describe("hook de bind-session", () => {
	it("una sesión oauth no ata ninguna conversación", async () => {
		await sessionStarted({}, ctx("oauth", "conv-1"));
		expect(calls.binds).toEqual([]);
	});

	it("una sesión del dashboard sigue atando como siempre", async () => {
		await sessionStarted({}, ctx("app", "conv-1"));
		expect(calls.binds).toEqual([["conv-1", "wrun_A"]]);
	});
});
```

Run: `npx vitest run tests/hooks/bind-session.test.ts`
Expected: FAIL (la sesión `"oauth"` también intenta atar y explota, porque `bindSessionToConversation` tira sin `conversationId` real de fila — o, si el mock no tira, el primer test falla porque `calls.binds` no está vacío).

- [ ] **Step 8: Implementar el cambio en `bind-session.ts`**

```ts
export default defineHook({
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
```

- [ ] **Step 9: Correr y ver que pasa**

Run: `npx vitest run tests/hooks/bind-session.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Suite completa**

Run: `npm test && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 11: Commit**

```bash
git add lib/agents/session-store.ts agents/outreach/hooks/runs.ts agents/outreach/hooks/bind-session.ts tests/agents/session-store.test.ts tests/hooks/runs.test.ts tests/hooks/bind-session.test.ts
git commit -m "$(cat <<'EOF'
feat: runs distingue trigger mcp, bind-session no ata sesiones oauth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Doc de conexión y cierre

**Files:**
- Create: `docs/agente-mcp-conexion.md`
- Modify: `docs/brain-mcp-conexion.md` (dominio desactualizado), `docs/01-roadmap-etapas.md`

- [ ] **Step 1: Doc de conexión del agente**

```markdown
# Conectar el agente por MCP

Cada tenant usa la misma URL del agente, con el tenant como parámetro de conexión:

    https://agentes.innov.as/eve/v1/mcp?tenant=<cliente>

Entrás con tu cuenta de la plataforma — la misma que usás para el brain o el dashboard.

## Claude Code

    claude mcp add --transport http outreach-<cliente> "https://agentes.innov.as/eve/v1/mcp?tenant=<cliente>"

Después, `/mcp`, elegí `outreach-<cliente>` y autenticá. Se abre el navegador, entrás con tu cuenta y aprobás el acceso — misma pantalla que la del brain.

## claude.ai

Configuración → Conectores → Agregar conector personalizado. Pegá la URL de arriba. Sin probar todavía (igual que con el brain).

## Cómo se usa

El agente expone cuatro tools, las mismas para cualquier agente conectado por MCP:

- `agent_start`: le mandás un mensaje, te devuelve un `invocationId` al toque. El trabajo sigue corriendo aunque cierres la conexión.
- `agent_get`: con el `invocationId`, el estado actual. Mientras esté `working`, seguí preguntando cada tanto.
- `agent_update`: si el estado es `input_required` (por ejemplo, una tool que necesita que apruebes algo), contestás acá.
- `agent_cancel`: pide cancelar un trabajo en curso.

Un `agent_start` no es para reintentar solo: si se corta la respuesta, preguntale a la persona antes de mandar el mismo pedido dos veces.

## Si algo falla

- **403 sin mensaje sobre el tenant:** revisá que la URL tenga `?tenant=<slug>` — sin eso, no hay forma de saber a qué cliente te conectás.
- **403 "no tenés acceso a ese cliente":** tu cuenta no tiene membresía ahí. Pedile a un administrador que te invite.
- **No se abre el login:** la URL tiene que apuntar a `/eve/v1/mcp`, con el `?tenant=` de tu cliente.
```

- [ ] **Step 2: Arreglar el dominio viejo en `docs/brain-mcp-conexion.md`**

Reemplazar las tres apariciones de `agents-six-iota.vercel.app` por `agentes.innov.as` (el dominio real, confirmado con el CLI de Vercel en la Etapa 11 — el otro quedó de un momento anterior a que se cargara `PUBLIC_APP_URL`).

- [ ] **Step 3: Cerrar la Etapa 6 en el roadmap**

En `docs/01-roadmap-etapas.md`, reemplazar el bloque completo de la sección "Etapa 6" (desde `## Etapa 6 · Canal MCP (Claude / ChatGPT) — \`[ ]\`` hasta la línea "El emisor OAuth que se arma acá lo reusa la Etapa 11..." inclusive) por:

```markdown
## Etapa 6 · Canal MCP (Claude / ChatGPT) — `[ ]`

**Modelo Claude Code:** Opus 5, effort `high` (es auth: `oauthResource` sobre Supabase como emisor OAuth 2.1).
**Modelo runtime:** el del tenant.
**Spec/Plan:** `docs/superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md` · `docs/superpowers/plans/2026-09-27-etapa-6-canal-mcp.md`

**Estado:** código hecho, verificación contra producción pendiente (Steps M1–M6 de abajo, spec §9). El título pasa a `[x]` cuando M1 y M5 estén confirmados.

- [x] Supabase Auth como servidor OAuth 2.1 con registro dinámico de clientes. Hecho y verificado contra producción en la Etapa 11 (`docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md` §4, §11): OAuth Server prendido, Allow Dynamic OAuth Apps, pantalla de consentimiento, `next` seguro en el login, `custom_access_token_hook` confirmado corriendo para tokens de cliente OAuth (V3, V7). Este emisor es genérico y ya sirve para cualquier `resource`, no solo el del brain.
- [x] `channels/mcp.ts` con `oauthResource(verifyMcpChannelToken, { issuer, resource, scopes })`. El tenant sale de `?tenant=<slug>` en la URL de conexión, no de un argumento (la ruta de `mcpChannel` es fija, sin segmento dinámico). (código; sin verificar contra producción)
- [x] Docs de conexión (`docs/agente-mcp-conexion.md`; claude.ai sin probar, igual que con el brain).
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** conectás el agente desde Claude Code y desde claude.ai, pedís algo simple y el trabajo corre durable en Vercel, con su `run` en `trigger: 'mcp'` y sin fila nueva en `conversations`. **Sin verificar todavía**, contra producción:

| # | Qué |
|---|---|
| M1 | Claude Code conecta a `.../eve/v1/mcp?tenant=innovas`, `agent_start` con un mensaje simple, `agent_get` llega a `completed` |
| M2 | Sin `?tenant`: error claro, no un 401 de login |
| M3 | Un token sin membresía en ese tenant: rechazado |
| M4 | La fila de `runs` tiene `trigger = 'mcp'`; no hay fila nueva en `conversations` |
| M5 | Una tool con aprobación (`send_email`, en un tenant de prueba, no `innovas`) llega a `input_required` y se resuelve con `agent_update` |
| M6 | claude.ai conecta como conector remoto (no bloquea el cierre si M1 funciona) |

El emisor OAuth que se reusa acá es el mismo que sirve el brain por MCP (Etapa 11): el `resource` cambia, el emisor no.
```

- [ ] **Step 4: Verificación final**

Run: `npm test && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add docs/agente-mcp-conexion.md docs/brain-mcp-conexion.md docs/01-roadmap-etapas.md
git commit -m "$(cat <<'EOF'
docs: conexión del agente por MCP, dominio corregido en el doc del brain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6:** `/ship` para el PR. La verificación M1–M6 contra producción (spec §9) la corre una persona con login real, después del deploy — igual que se hizo con la Etapa 11.
