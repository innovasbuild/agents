---
title: Etapa 6 · Canal MCP del agente (Claude Code / claude.ai) — spec
fecha: 2026-09-27
estado: aprobada en brainstorming, pendiente de revisión escrita
modelo: Sonnet 5 (spec y plan; el emisor OAuth y su verificación ya se armaron en la Etapa 11 con Opus 5.5)
etapa: 6
fuente: docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md (emisor OAuth, D6, D7, PUBLIC_APP_URL) · node_modules/eve/docs/channels/mcp.mdx · agents/outreach/channels/eve.ts · agents/outreach/hooks/{runs,bind-session}.ts
---

# Etapa 6 · Canal MCP del agente

## 1. Qué problema resuelve

El agente `outreach` hoy solo se usa desde el chat del dashboard. Falta que se pueda invocar desde las herramientas de la persona — Claude Code, claude.ai — para pedirle tareas de punta a punta ("armá la cola de hoy") sin abrir el navegador. Es distinto de lo que sirve la Etapa 11: ahí se leen y escriben páginas del brain directo; acá se le delega una tarea al agente completo, con su modelo, sus tools y sus aprobaciones.

La Etapa 11 dejó construido y verificado en producción el emisor OAuth 2.1 (Supabase Auth, con `custom_access_token_hook`) que esta etapa reusa sin tocar: el `resource` cambia, el emisor no.

## 2. Objetivo y criterio de cierre

**Terminado cuando:**

1. Conectás el agente desde Claude Code con `.../eve/v1/mcp?tenant=<slug>`, pedís algo simple, y corre durable en Vercel.
2. La fila de `runs` que se crea tiene `trigger = 'mcp'`, y no aparece ninguna fila nueva en `conversations` (M4).
3. Una tool que necesita aprobación (`send_email`) llega a `input_required` y se resuelve con `agent_update`, sin tocar el dashboard (M5).
4. Sin `?tenant` en la URL, o con un token sin membresía en ese tenant, el error es claro y no dice más de lo que corresponde (M2, M3).
5. `npm test`, `npm run typecheck` en verde.

**Fuera de alcance de esta pasada:** claude.ai (documentado, no probado — igual que V6 de la Etapa 11); scopes OAuth enforced más allá de lo que ya advierte `oauthResource`; que una sesión MCP aparezca en `/chat` del dashboard (D-MCP-2).

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D-MCP-1 | El tenant sale de `?tenant=<slug>` en la URL de conexión, nunca de un argumento de la tool. | `mcpChannel` de eve tiene una ruta fija, sin segmento dinámico para el tenant (a diferencia del endpoint del brain, que armamos nosotros). El query string es el único lugar donde la URL de conexión puede llevar esa identidad sin que el modelo la elija. |
| D-MCP-2 | Una sesión que arranca por este canal no crea una fila en `conversations`; solo queda en `runs` (`trigger: 'mcp'`) y en `events`. | `bind-session.ts` ata toda sesión nueva a una conversación del dashboard y hace fallar el turno si no puede — eso no aplica acá. Unificar la visibilidad en `/chat` es tarea de la Etapa 9 si hace falta, no de esta. |
| D-MCP-3 | El canal no exige que el token traiga `client_id` (al revés de D7 en la Etapa 11). | D7 evita que un token de cliente OAuth abra el chat del dashboard, una superficie más amplia que lo aprobado. Acá es al revés: un token de sesión normal de la persona también puede arrancar una sesión por este canal — mismo tenant, mismo rol, y las tools de riesgo siguen pasando por la cola de aprobación sin importar la entrada. |
| D-MCP-4 | El verificador de claims y la lectura de membresías se comparten con el endpoint del brain (`lib/auth/oauth-principal.ts`), en vez de reescribirse. | Es el mismo `getClaims()` y la misma consulta a `memberships` que ya existen en `lib/brain/mcp-server/supabase.ts`, sin nada específico del brain. |
| D-MCP-5 | Falta tenant o sin membresía tira `ForbiddenError` con mensaje propio, no un 401 genérico. | Un 401 ahí parece un problema de login; el problema real es la URL de conexión o el acceso al tenant. |

## 4. El canal

### 4.1 Auth

`agents/outreach/channels/mcp.ts` (nombre obligatorio por convención de eve):

```ts
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

`verifyMcpChannelToken` es el adaptador fino que vive en el mismo archivo que `resolveMcpChannelAuth` (§4.2): arma las dependencias reales, llama a `resolveMcpChannelAuth`, y traduce `ok: false` a `UnauthenticatedError` (`kind: "unauthenticated"`) o `ForbiddenError` (`kind: "forbidden"`) de `eve/channels/auth`. Es el único punto que conoce esas clases; `resolveMcpChannelAuth` no, así que sus tests no dependen de eve.

`PUBLIC_APP_URL` ya está cargada en Vercel (Etapa 11). Sin ella o sin `NEXT_PUBLIC_SUPABASE_URL`, el módulo tira al cargar — mismo criterio que `publicSettings()` en `lib/brain/mcp-server/production.ts`.

### 4.2 Resolución de acceso

`lib/agents/mcp-channel-auth.ts`, testeable sin eve:

```ts
export interface McpChannelAuthDeps {
	verify: (token: string) => Promise<Record<string, unknown> | null>;
	tenantBySlug: (slug: string) => Promise<{ id: string; active: boolean } | null>;
	membershipsOf: (userId: string) => Promise<{ tenantId: string; role: string }[]>;
}

export type McpChannelAuth =
	| { ok: true; sessionAuth: SessionAuthContext }
	| { ok: false; kind: "unauthenticated" | "forbidden"; message: string };

export async function resolveMcpChannelAuth(
	request: Request,
	deps: McpChannelAuthDeps,
): Promise<McpChannelAuth>;

// Adaptador fino para eve. Arma las dependencias reales (§5) y traduce
// McpChannelAuth a un SessionAuthContext o a las excepciones de eve.
export async function verifyMcpChannelToken(request: Request): Promise<SessionAuthContext>;
```

Pasos, en orden — el mismo orden que `resolveMcpAccess` de la Etapa 11 (`lib/brain/mcp-server/access.ts`): **los roles se resuelven antes que el tenant**, porque si no, alguien con un token válido pero sin ningún acceso podría distinguir un slug que existe (403 después de buscarlo) de uno inventado, y usar eso para enumerar qué clientes tiene la plataforma. Es exactamente el hallazgo F4 que la revisión final de la Etapa 11 encontró y corrigió; no se repite acá:

1. `extractBearerToken` (de `eve/channels/auth`) + `deps.verify(token)` **en un try/catch** (un verificador que explota con un token roto no puede tirar hacia arriba — mismo motivo que el fix de la Etapa 11 sobre un token malformado). Sin token, `verify` tira, devuelve `null`, o `claims.sub` no es un string no vacío: `{ ok: false, kind: "unauthenticated", message: "El token no es válido o venció." }`.
2. `slug = new URL(request.url).searchParams.get("tenant")`. Vacío: `{ ok: false, kind: "forbidden", message: "Falta el tenant en la URL de conexión: agregá ?tenant=<slug>." }`.
3. `deps.membershipsOf(claims.sub)`. `platformAdmin` es `true` si alguna fila (de cualquier tenant) tiene `role === "platform_admin"` — `memberships.tenant_id` es `not null`: un `platform_admin` tiene su fila bajo un tenant "de origen" (hoy, Mati la tiene bajo `innovas`), pero eso le da acceso a cualquier otro por `is_platform_admin()`, no por una fila propia ahí.
4. `deps.tenantBySlug(slug)`. Inexistente o inactivo: `{ ok: false, kind: "forbidden", message: platformAdmin ? "No existe ese cliente." : "No tenés acceso a ese cliente." }` — el mensaje más específico solo lo ve alguien que ya es platform_admin, así que no es una fuga nueva; para cualquier otro, el mensaje es igual de genérico exista o no el tenant.
5. `own = ` la fila de membresía cuyo `tenantId` coincide con el tenant ya resuelto. Sin `own` y sin `platformAdmin`: `{ ok: false, kind: "forbidden", message: "No tenés acceso a ese cliente." }`.
6. `role = own?.role ?? "platform_admin"` (si hay `platformAdmin` pero no `own`, expone `"platform_admin"` igual — es el string que ya compara `decideBrainUpsertResponse` y cualquier otra tool que mire `attributes.role`, nunca queda `undefined`).
7. `{ ok: true, sessionAuth: { authenticator: "oauth", issuer, principalId: claims.sub, principalType: "user", subject: claims.sub, attributes: { email: claims.email, tenantId: tenant.id, tenantSlug: slug, role } } }`.

`verifyMcpChannelToken` (§4.1) traduce `kind: "unauthenticated"` a `UnauthenticatedError` y `kind: "forbidden"` a `ForbiddenError`, ambas de `eve/channels/auth`.

### 4.3 Verificación de la Sección 1 pendiente

Antes de dar el diseño por cerrado: confirmar con un test que el `Request` que le llega a `verifyMcpChannelToken` conserva el query string completo (`new URL(request.url).searchParams`). No hay razón para pensar que eve lo recorta, pero no está confirmado — se prueba en la Task de implementación, no se asume.

## 5. Verificador y membresías compartidos

`lib/auth/oauth-principal.ts` (nuevo):

```ts
export function createOAuthClaimsVerifier(): (token: string) => Promise<Record<string, unknown> | null>;
export function loadMemberships(userId: string): Promise<{ tenantId: string; role: string }[]>;
export function loadTenantBySlug(slug: string): Promise<{ id: string; active: boolean } | null>;
```

Mismo cuerpo que hoy tienen `supabaseClaimsVerifier()` y las funciones `tenantBySlug`/`rolesOf` de `supabaseAccessStore()` en `lib/brain/mcp-server/supabase.ts` — se mudan, no se duplican. `createOAuthClaimsVerifier` sigue construyendo el cliente una sola vez (el cache de JWKS entre requests, mismo motivo que en la Etapa 11).

`lib/brain/mcp-server/supabase.ts` pasa a:

```ts
export function supabaseClaimsVerifier(): ClaimsVerifier {
	return createOAuthClaimsVerifier();
}

export function supabaseAccessStore(): AccessStore {
	return {
		tenantBySlug: loadTenantBySlug,
		rolesOf: loadMemberships,
		brainBinding: (tenantId) => resolveBrainBinding(tenantId, loadTenantBindings),
	};
}
```

Los tipos `AccessStore`/`ClaimsVerifier` de `lib/brain/mcp-server/access.ts` no cambian; solo cambia de dónde sale la implementación. Los tests existentes de la Etapa 11 (`tests/brain/mcp-server/access.test.ts`, `tests/brain/mcp-server/handler.test.ts`) siguen pasando sin tocarlos: consumen `AccessStore`/`ClaimsVerifier` por su interfaz, no por dónde vive el código.

## 6. `runs.ts` y `bind-session.ts`

`lib/agents/session-store.ts`: `OpenRunInput` suma `trigger: "chat" | "mcp"` (obligatorio, sin default). `openRun` lo escribe tal cual en vez de hardcodear `"chat"`.

`agents/outreach/hooks/runs.ts`, en `turn.started`:

```ts
const trigger = auth?.authenticator === "oauth" ? "mcp" : "chat";
await openRun({ ...(como hoy), trigger });
```

`agents/outreach/hooks/bind-session.ts`, en `session.started`:

```ts
async "session.started"(_event, ctx) {
	const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
	if (auth?.authenticator === "oauth") return;
	await bindSessionToConversation(
		attribute(auth?.attributes?.conversationId),
		ctx.session.id,
	);
},
```

`lib/workflows/store.ts` no se toca: ya escribe `trigger: "schedule"` por su cuenta, sin pasar por `runs.ts`.

## 7. Doc de conexión

`docs/agente-mcp-conexion.md`, mismo espíritu que `docs/brain-mcp-conexion.md`:

- Cómo agregar el server: `claude mcp add --transport http outreach-<cliente> https://<dominio>/eve/v1/mcp?tenant=<cliente>`.
- Las cuatro tools (`agent_start`, `agent_get`, `agent_update`, `agent_cancel`) y su contrato (tabla de `node_modules/eve/docs/channels/mcp.mdx`: `working` → seguir pidiendo `agent_get`; `input_required` → contestar con `agent_update`; `completed`/`failed`/`cancelled`, terminal).
- Qué significa cada `code` de un tool call rechazado (`invalid_input`, `not_found`, `conflict`, `internal`) — tabla ya documentada por eve, se linkea, no se reescribe.
- Nota sobre `agent_start` no idempotente: si se corta la respuesta, no reintentar solo — preguntarle a la persona.
- claude.ai: mismo mecanismo de conector remoto que el brain; sin probar todavía.

## 8. Tests

| Archivo | Qué prueba |
|---|---|
| `tests/agents/mcp-channel-auth.test.ts` | `resolveMcpChannelAuth` con dobles: sin `?tenant`, tenant inexistente/inactivo, sin membresía, `platform_admin`, `tenant_admin`/`tenant_member`, `verify` que devuelve `null` |
| `tests/lib/auth/oauth-principal.test.ts` | Las tres funciones, con el mismo doble de Supabase que ya usaban los tests movidos de `lib/brain/mcp-server/supabase.ts` |
| `tests/agents/session-store.test.ts` (existente) | Sumar el caso `trigger: "mcp"`; el caso existente de `openRun` pasa `trigger: "chat"` explícito |
| `tests/hooks/runs.test.ts` (nuevo, patrón de `tests/hooks/executors.test.ts`) | `authenticator: "oauth"` → `trigger: "mcp"`; `"app"` o ausente → `"chat"` |
| `tests/hooks/bind-session.test.ts` (nuevo) | `authenticator: "oauth"` → no llama a `bindSessionToConversation`; `"app"` → sí, como siempre |
| `tests/brain/mcp-server/supabase.test.ts` (si no existe, se crea; si existe, se ajusta) | Sigue devolviendo lo mismo después de delegar a `lib/auth/oauth-principal.ts` |

## 9. Verificación contra el proyecto real

Reusa el emisor de la Etapa 11: V1, V2 y V4 (metadata, `getClaims`) no se repiten, ya están confirmados. Nuevas, de este canal:

| # | Qué | Si falla |
|---|---|---|
| M1 | Claude Code conecta a `.../eve/v1/mcp?tenant=innovas`, `agent_start` con un mensaje simple, `agent_get` llega a `completed` | Es el criterio 1 |
| M2 | Sin `?tenant`: error claro (D-MCP-5), no un 401 de login | Revisar D-MCP-5 |
| M3 | Un token sin membresía en ese tenant: rechazado | — |
| M4 | La fila de `runs` tiene `trigger = 'mcp'`; no hay fila nueva en `conversations` | Revisar §6 |
| M5 | Una tool con aprobación (`send_email`, en un tenant de prueba, no `innovas`) llega a `input_required` y se resuelve con `agent_update` | Esto es de eve, no de esta etapa — si falla, es un problema de versión de eve, no de este canal |
| M6 | claude.ai conecta como conector remoto | No bloquea el cierre si M1 funciona (mismo criterio que V6 de la Etapa 11) |

## 10. Fuera de alcance

- claude.ai probado de punta a punta (M6, documentado igual).
- Enforcement de scopes más allá de lo que `oauthResource` ya advierte.
- Que una sesión MCP aparezca en `/chat` del dashboard (D-MCP-2) — Etapa 9 si hace falta.
- Rate limit propio de este canal: las tools de riesgo ya pasan por la cola de aprobación y por los presupuestos de la Etapa 12 (`tenant_budgets`); un límite de invocaciones por minuto queda para cuando haga falta.

## 11. Riesgos

- **Confiar en que eve preserva el query string del `Request` en `oauthResource`/`mcpChannel`.** Mitigación: test de la Sección 4.3 antes de dar el diseño por cerrado en la implementación.
- **`eve` 0.54.2 tiene una superficie de MCP relativamente nueva.** Mitigación: M1 y M5 contra producción antes de cerrar; si `agent_update` no resuelve una aprobación pendiente, es un problema de versión de eve (Etapa 14), no algo para parchear acá.

## 12. Enmiendas

- **`docs/01-roadmap-etapas.md`**: Etapa 6 con esta spec y su plan; el ítem de `channels/mcp.ts` deja de estar pendiente cuando se implemente.
