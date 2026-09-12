---
title: Etapa 0 · Bootstrap y spike de riesgo — Spec de diseño
etapa: 0
fecha: 2026-09-11
estado: aprobada en brainstorming, pendiente de plan
kickoff: docs/innovas-agents-kickoff.md
roadmap: docs/01-roadmap-etapas.md
---

# Etapa 0 · Bootstrap y spike de riesgo

## 1. La pregunta que responde esta etapa

¿Se sostiene el diseño del kickoff? Concretamente: ¿puede eve vivir dentro de Next.js 15, autenticar a un usuario con Supabase, pausar una sesión durable esperando aprobación humana, y mandar un mail real desde la casilla de Gmail de ese usuario — **corriendo en Vercel**, no solo en localhost?

Si la respuesta es sí, las Etapas 1 a 8 son construcción sobre terreno conocido. Si es no, nos enteramos con medio día de código encima en lugar de con tres etapas.

## 2. Alcance

**Entra:**

- Repo funcional con harness de desarrollo (Next.js 15, Biome, Vitest, `CLAUDE.md`, `.claude/`).
- eve montado en Next.js con un agente llamado `outreach`, ruta respondiendo.
- Login con Google vía Supabase Auth, pidiendo scopes de Gmail en el mismo consentimiento.
- Una tabla: `google_tokens`, inaccesible salvo por `service_role`.
- `channels/eve.ts` que rechaza a un caller sin sesión.
- `tools/send_email.ts` con `approval: always()`.
- Chat web mínimo que muestra y resuelve la aprobación.
- Deploy a preview en Vercel y corrida del flujo completo ahí.

**No entra** (y no se empieza "de paso"):

- Esquema multi-tenant (`tenants`, `memberships`, `executors`, `contacts`, `events`, `queue_items`, `runs`) ni RLS por `tenant_id` → Etapa 1.
- Conexiones a HubSpot, brain, ColdIQ, Places → Etapa 2.
- Vercel Connect → Etapa 2.
- Redacción, gate de estilo, `contact_key`, dedup, subagente `researcher` → Etapa 3.
- Dashboard (`/cola`, `/pipeline`, `/metricas`) → Etapa 4.
- Schedules → Etapa 5.

El chat de esta etapa es andamio para probar la aprobación, no la UI del producto.

## 3. Decisiones de este brainstorming

| # | Decisión | Por qué |
|---|---|---|
| D1 | El token de Gmail sale de **Supabase Auth**, no de Vercel Connect | La doc de eve no documenta Google/Gmail en Connect (ver §4). Además un solo client de Google cubre login y envío con un solo consentimiento. Connect entra en Etapa 2 como migración planificada: `gmail.ts` cambia de `auth`, no de forma. |
| D2 | El criterio se cumple en **preview de Vercel**, no en localhost | El riesgo que este spike existe para destrabar es eve sobre el runtime de Vercel. Probarlo solo en local deja el riesgo intacto para que reaparezca en Etapa 3 con más código encima. |
| D3 | El refresh token se **persiste** en `google_tokens`, con acceso solo por `service_role` | Principio 2 del kickoff: el modelo nunca ve credenciales. Si el token viaja en el contexto de la sesión para que la tool lo use, se viola. Persistirlo permite que `send_email` lo resuelva del lado server desde el `principalId`. |
| D4 | Se pinnea **`eve@0.54.2`** exacto (sin `^`) | eve está en beta y la doc no da guía de pinning. Un bump silencioso de minor puede cambiar el contrato de canales o aprobaciones. |

## 4. Hallazgos de la doc de eve que corrigen el kickoff

Verificados contra `https://eve.dev/llms-full.txt` (corpus completo de la doc) y, durante la implementación, contra `node_modules/eve/docs/` de la versión instalada (`0.54.2`). Los primeros cinco vienen del brainstorming original; el sexto se agregó durante la implementación de la Task 9.

1. **`eve dev` no se corre aparte con Next.js.** `npm run dev` bootea el dev server de eve al lado y reescribe las rutas hacia él. El `npm run dev && npx eve dev` del kickoff §Etapa 0 sobra. Para producción local: `eve build`, después `next build && next start` (eve en puerto `4274`).
2. **`eve init .` genera `agent/` en singular, con `instructions.md`** (markdown, no `instructions.ts`), y `evals/` va **al lado** de `agent/`, no adentro. Hay que mover a `agents/outreach/` para que matchee `withEve({ agents: { outreach: ... } })`.
3. **La pausa se resuelve por `requestId`, no por `callId`.** La columna `queue_items.approval_call_id` del kickoff §5 tiene que ser `request_id`. El `callId` llega en el request pero la respuesta se keyea por `requestId`. → **Deuda para Etapa 1.**
4. **El auth de ruta no valida ownership de sesión.** eve autentica al caller pero no verifica que la sesión que quiere continuar o streamear sea suya. Hay que chequearlo a mano. → **Deuda para Etapas 1 y 4.**
5. **Los schedules corren sin tenant.** Son root-only y arrancan con `principalId: "eve:app"`, `principalType: "runtime"`; en modo markdown no llevan `tenantId` ni pueden parkear esperando aprobación. `morning-sweep` y `followups` necesitan la forma `run` despachando por un canal autenticado como usuario. → **Deuda para Etapa 5.**
6. **El input real de la tool no viaja en `part.toolMetadata.eve.inputRequest`.** Ese objeto (el que muestra el ejemplo de `guides/frontend/overview.mdx`) solo trae `requestId`, `kind`, `prompt`, `options`, `display`, `allowFreeform` — nunca el input de la tool en pausa. El `to`/`subject`/`body` de `send_email` está en `part.input` del propio `dynamic-tool` part cuando `state === "approval-requested"` (confirmado en `node_modules/eve/dist/src/client/message-reducer-types.d.ts`). Un chat de aprobación tiene que combinar ambas fuentes: `inputRequest.requestId` para `respond()`, `part.input` para mostrarle al usuario qué está por aprobar. → Afecta cualquier UI de aprobación futura (Etapa 4 `/cola`).

Dato operativo: eve requiere **Node.js 24+**.

### 4.1 Hallazgos operativos del deploy (Task 10, fuera de la doc de eve)

No son hallazgos de la doc de eve sino de la infraestructura de Vercel/Supabase, descubiertos al desplegar por primera vez. Quedan anotados porque las próximas etapas van a redeployar sobre el mismo proyecto:

- **El proyecto de Vercel se linkeó (Task 1) antes de que existiera el scaffold de Next.js (Task 2).** Vercel lo detectó como Framework Preset "Other" y servía `public/` como sitio estático, dando 404 en cualquier ruta real. Fix: `vercel.json` con `{"framework": "nextjs"}` en la raíz del repo, que fuerza el framework independientemente de la detección automática del proyecto.
- **Las URLs de preview individuales (`agents-<hash>-innovasbuild.vercel.app`) están protegidas por Vercel Deployment Protection (SSO)** por default en proyectos de team — un curl sin sesión de Vercel redirige a `vercel.com/sso-api`. El alias estable de producción (`https://agents-six-iota.vercel.app`) no tiene esa protección y es el que se usó para las verificaciones automatizadas de esta etapa (health check, test de auth contra el deploy real). Deuda para cuando haga falta CI contra previews: usar el bypass token de Vercel (`x-vercel-protection-bypass`) o desactivar la protección para el entorno Preview.
- **Un typo manual en `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` con un project-ref distinto al de las JWT `ANON_KEY`/`SERVICE_ROLE_KEY`)** se corrigió localmente pero no se replicó en las env vars de Vercel, causando `ERR_NAME_NOT_RESOLVED` al clickear "Entrar con Google" en el deploy. Verificar siempre que el `ref` de la URL coincida con el claim `ref` de las JWT antes de dar por buena una configuración de Supabase (se puede decodificar el payload de la anon key, que es pública, sin tocar la service role key).

## 5. Flujo del spike, de punta a punta

```
Browser (preview.vercel.app)
  │
  │ 1. login con Google (Supabase signInWithOAuth)
  │    scopes: openid email profile gmail.send gmail.readonly
  │    access_type=offline · prompt=consent
  ▼
/auth/callback  ── exchangeCodeForSession ──►  session.provider_refresh_token
  │                                                    │
  │                                                    ▼
  │                                    google_tokens (service_role only)
  ▼
/chat  (useEveAgent({ agent: "outreach" }))
  │
  │ 2. "mandale un mail a X diciendo Y"
  ▼
/eve/agents/outreach/eve/v1/session   ── auth walk ──►  supabaseAuth()
  │                                                     principalId = user.id
  │                                                     principalType = "user"
  ▼
agente decide llamar send_email
  │
  │ 3. approval: always()  →  input.requested  →  session.waiting  (durable)
  ▼
el chat muestra la aprobación
  │
  │ 4. aprobar → respond([{ requestId, optionId: "approve" }])
  ▼
send_email.execute
  │  5. userId ← ctx.session.auth.current.principalId
  │  6. refresh_token ← google_tokens (service_role)
  │  7. access_token ← oauth2.googleapis.com/token
  │  8. raw ← buildRawMessage(...)   (función pura, testeada)
  ▼
POST gmail.googleapis.com/gmail/v1/users/me/messages/send
  │
  ▼
mail en la casilla del destinatario + evento input.resolved en la sesión
```

El modelo nunca toca los pasos 6 y 7: recibe `to`, `subject` y `body`, y nada más.

## 6. Componentes y contratos

Un archivo por responsabilidad. Los que llevan lógica pura van en `lib/` para poder testearlos sin red ni base.

Los imports desde `agents/` hacia `lib/` van **relativos**, no con el alias `@/`: eve compila el agente con su propio build, separado del de Next, así que los `paths` del `tsconfig.json` de la app no son confiables ahí.

### Regla de organización: `agents/` por capacidad, `tenants/` por cliente

`agents/` **nunca** lleva una carpeta por cliente. El agente `outreach` es uno solo para todos los tenants (kickoff §2) y lo que cambia por cliente se resuelve en runtime con `defineDynamic`, que en eve alcanza modelo, instrucciones, skills, conexiones, tools y subagentes.

Una carpeta por cliente significaría N copias del mismo código divergiendo, cada fix del gate de estilo aplicado N veces, y la Etapa 7 degradada de "una fila en `tenants` más un `tenant.json`" a "copiar carpetas" — que es justo la prueba que esa etapa existe para hacer fallar. Hay además un costo concreto en eve: cada entrada de `agents` en `withEve` es un **build separado**, con su propio `buildCommand` y `servicePrefix`, así que N clientes × M agentes son N×M builds en cada deploy.

Dónde va cada cosa:

| Carpeta | Qué es | Se agrega una cuando... |
|---|---|---|
| `agents/<capacidad>/` | Código del agente | aparece un agente **genuinamente distinto** (`soporte`, `research`), nunca un cliente |
| `tenants/<slug>/` | Configuración y canon del cliente (`tenant.json`, `skills/`) | entra un cliente nuevo |

Cuando `tools/`, `skills/` y `connections/` crezcan, se ordenan con subcarpetas por dominio **dentro** del agente. Restricción de eve a tener en cuenta ahí: `channels/` y `schedules/` son root-only, no existen dentro de subagentes.

Esto queda escrito acá porque es el error más fácil de cometer y el más caro: una sesión futura que cree `agents/innovas/` contamina toda la plataforma, y recién se nota en la Etapa 7. `CLAUDE.md` lo cubre desde el otro lado ("nada específico de un tenant en código").

### `next.config.ts`

```ts
import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};

export default withEve(nextConfig, {
  agents: { outreach: "./agents/outreach" },
});
```

Expone el agente en `/eve/agents/outreach/eve/v1/*`. `GET .../health` es **público** y saltea el auth walk (devuelve `{ ok: true, status: "ready", workflowId }`).

### `agents/outreach/agent.ts`

```ts
import { defineAgent } from "eve";

export default defineAgent({ model: "anthropic/claude-sonnet-5" });
```

`model` es obligatorio cuando el archivo existe. En Etapa 1 pasa a `defineDynamic`.

### `lib/auth/verify-caller.ts`

Contrato: `verifyCaller(request: Request): Promise<{ userId: string; email: string } | null>`.

Lee las cookies de Supabase con `createServerClient` de `@supabase/ssr`, llama `getUser()`, y devuelve `null` si no hay sesión válida. No tira excepciones por falta de sesión: devolver `null` es lo que hace avanzar el auth walk de eve.

### `agents/outreach/channels/eve.ts`

```ts
import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { verifyCaller } from "../../../lib/auth/verify-caller";

function supabaseAuth(): AuthFn<Request> {
  return async (request) => {
    const caller = await verifyCaller(request);
    if (caller === null) return null;
    return {
      authenticator: "app",
      issuer: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      principalId: caller.userId,
      principalType: "user",
      subject: caller.userId,
      attributes: { email: caller.email },
    };
  };
}

export default eveChannel({
  auth: process.env.VERCEL_ENV
    ? [supabaseAuth()]
    : [supabaseAuth(), localDev()],
});
```

`localDev()` acepta cualquier caller, así que **nunca** puede estar activo en un deploy: condicionado por `VERCEL_ENV`, que existe en todos los entornos de Vercel y no en local. `principalType: "user"` no es decorativo — `connect()` de Vercel Connect lo exige en Etapa 2.

En Etapa 0 `attributes` no lleva `tenantId` porque no hay tabla `tenants` todavía; en Etapa 1 se agrega ahí y se lee con `ctx.session.auth.current?.attributes`.

### `supabase/migrations/<ts>_google_tokens.sql`

```sql
create table public.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  scope text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

revoke all on table public.google_tokens from anon, authenticated;
```

RLS habilitada **sin políticas**: nadie pasa. `service_role` bypassea RLS, y es el único camino de lectura. El `revoke` es defensa en profundidad para que un cliente con la anon key no llegue ni a intentarlo.

El `refresh_token` queda en texto plano. Para el spike es aceptable porque la tabla es inalcanzable sin la service key; **deuda anotada para Etapa 2**: mover a Supabase Vault cuando la tabla se absorba en `executors`.

### `app/auth/callback/route.ts`

Route handler que hace `exchangeCodeForSession(code)` y, si la sesión trae `provider_refresh_token`, lo upsertea en `google_tokens` con el cliente de `service_role`. Google devuelve refresh token solo con `access_type=offline` **y** `prompt=consent`; si en un login no viene, no se sobreescribe el guardado.

### `lib/gmail/mime.ts` — función pura

Contrato: `buildRawMessage(input: { to: string; subject: string; body: string }): string`, devuelve el MIME en base64url.

Es el único código con lógica no trivial de esta etapa y el único testeable sin red, así que es donde van los tests:

- Headers `To`, `Subject`, `MIME-Version`, `Content-Type: text/plain; charset="UTF-8"`.
- **Subject con acentos codificado como encoded-word RFC 2047** (`=?UTF-8?B?...?=`). El repo escribe en español rioplatense: un asunto con "ñ" o tildes mal codificado llega roto y es el tipo de bug que no se nota hasta que lo ve un prospecto.
- Body UTF-8, con `Content-Transfer-Encoding: base64` para no depender del quoted-printable.
- base64**url** correcto: sin padding, `-` y `_` en lugar de `+` y `/`. La API de Gmail rechaza base64 estándar.

### `lib/gmail/send.ts` — server only

Dos funciones, ninguna expuesta al modelo:

- `getAccessToken(userId: string): Promise<string>` — lee `google_tokens` con `service_role`, cambia el refresh token por un access token en `https://oauth2.googleapis.com/token` (`grant_type=refresh_token`). Si no hay fila, tira un error explícito que le dice al usuario que reconecte Google (el agente puede repetir ese mensaje sin filtrar nada).
- `sendMail(userId, { to, subject, body })` — arma el raw con `buildRawMessage` y hace `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` con `{ raw }`. `users/me` resuelve la casilla del dueño del token, así que no hace falta pasar el `From`.

### `agents/outreach/tools/send_email.ts`

```ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { sendMail } from "../../../lib/gmail/send";

export default defineTool({
  description: "Envía un email desde la casilla de Gmail del usuario autenticado.",
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  approval: always(),
  async execute(input, ctx) {
    const userId = ctx.session.auth.current?.principalId;
    if (!userId) throw new Error("send_email requiere un usuario autenticado");
    return sendMail(userId, input);
  },
});
```

El `inputSchema` **no** tiene campo para token, credencial ni casilla de origen: es la barrera estructural que hace cumplir el principio 2.

### `app/chat/page.tsx`

Chat mínimo con `useEveAgent({ agent: "outreach" })` que renderiza los mensajes y, cuando llega un `input.requested`, muestra aprobar / rechazar. Resuelve con `respond([{ requestId, optionId: "approve" | "cancel" }])`.

La forma exacta en que `useEveAgent` expone los input requests **se confirma leyendo `node_modules/eve/docs/guides/frontend/nextjs.mdx` y `human-in-the-loop.md` durante la implementación**, no se asume. El contrato de fondo ya está fijado y no depende de eso: `requestId` + `optionId`, con `"approve"` y `"cancel"` como opciones, y el resultado confirmado contra el evento `input.resolved`.

### `app/(auth)/login/page.tsx`

Botón de login con:

```ts
supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    scopes: "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
    queryParams: { access_type: "offline", prompt: "consent" },
    redirectTo: `${origin}/auth/callback`,
  },
});
```

`gmail.readonly` se pide ahora aunque recién se use en Etapa 5, para no forzar un segundo consentimiento.

## 7. Orden de ejecución

Invertido respecto del kickoff, que deja Google Cloud para el final. El client OAuth con scopes de Gmail es lo más lento y lo único que depende de terceros: va primero.

1. **Accesos** (consolas web, bloquea todo): proyecto en Google Cloud, client OAuth tipo Web application, pantalla de consentimiento en modo testing con tu mail como test user, redirect URI al callback de Supabase. Proyecto Supabase con provider Google configurado con ese client. Proyecto Vercel linkeado al repo de GitHub existente, con Supabase enchufado desde el Marketplace.
2. **Scaffold y harness**: `create-next-app`, Biome, Vitest, `CLAUDE.md`, `.claude/*`, `eve@0.54.2` pinneado, y `engines: { node: ">=24" }` en el `package.json`, `engine-strict=true` en `.npmrc` y `.nvmrc` con `24` (el manejador de versiones del repo es nvm).
3. **eve en Next**: `eve init`, mover `agent/` → `agents/outreach/`, `next.config.ts`, health en local.
4. **Login con scopes** + migración `google_tokens` + persistencia en el callback.
5. **`channels/eve.ts`** con el auth walk y `localDev()` condicionado.
6. **`lib/gmail/*`** con TDD sobre `buildRawMessage`, después `send_email.ts`.
7. **Chat web** con aprobación.
8. **Deploy a preview** y corrida completa ahí.

Los pasos 2 y 3 pueden avanzar mientras el 1 espera aprobaciones de Google.

## 8. Verificación

| Qué | Cómo |
|---|---|
| eve vive en Next | `curl .../eve/agents/outreach/eve/v1/health` devuelve `{ ok: true, status: "ready" }`, en local **y** en preview |
| El canal rechaza sin sesión | Test contra `/eve/agents/outreach/eve/v1/info` sin cookie → 401/403. **No** contra `/health`, que es público por diseño y no prueba nada |
| `localDev()` no quedó en el deploy | El mismo test de arriba, corrido contra la URL de preview |
| MIME correcto | Vitest sobre `buildRawMessage`: headers, subject con tildes y "ñ" en RFC 2047, base64url sin padding |
| El verificador falla cerrado | Vitest: `verifyCaller` devuelve `null` sin cookies |
| Tipos | `npx tsc --noEmit` (ya cableado en el hook `Stop`) |
| **Criterio de cierre** | Un mail real sale de tu Gmail después de aprobarlo en el chat del **preview**, confirmado contra el evento `input.resolved` de la sesión, no contra lo que muestre la UI |

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **App de Google en modo testing caduca los refresh tokens a los 7 días** | Alcanza para el spike. Etapa 2 tiene que resolver verificación de la app o migrar a Connect. Anotado como deuda, no como sorpresa. |
| `gmail.send` es scope sensible | En testing con test users no requiere verificación. Al salir de testing sí: entra en el alcance de Etapa 2. |
| eve en beta | `0.54.2` exacto; releer `node_modules/eve/docs` en cada bump; el health check y el test de auth son el canario. |
| `localDev()` colado en un deploy | Condicionado por `VERCEL_ENV` **y** cubierto por un test que corre contra el preview. |
| Node 24 obligatorio | Declarado en `engines: { node: ">=24" }` más `engine-strict=true` en `.npmrc`, para que npm **falle** en lugar de solo advertir. Sin eso, correr con Node 22 se manifiesta como un error raro de eve. |
| Refresh token en texto plano | RLS sin políticas + `revoke` a `anon`/`authenticated`. Vault en Etapa 2. |
| La API de `useEveAgent` para aprobaciones no está confirmada | Se lee la doc local antes de escribir el chat. El contrato de fondo (`requestId` + `optionId`) no depende de eso. |

## 10. Variables de entorno

Del kickoff, solo las que esta etapa usa de verdad:

```
AI_GATEWAY_API_KEY              # o VERCEL_OIDC_TOKEN
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY       # solo server: lectura de google_tokens
GOOGLE_OAUTH_CLIENT_ID          # el mismo client que usa Supabase Auth
GOOGLE_OAUTH_CLIENT_SECRET      # para el refresh_token grant
```

Las de HubSpot, brain, ColdIQ, Places y `CRON_SECRET` entran en sus etapas.

## 11. Deuda que esta etapa deja anotada

| Para | Qué |
|---|---|
| Etapa 1 | `queue_items.request_id` en lugar de `approval_call_id` (hallazgo 3) |
| Etapa 1 | Validar ownership de sesión a mano; eve no lo hace (hallazgo 4) |
| Etapa 1 | `tenantId` en `attributes` del auth, y `agent.ts` a `defineDynamic` |
| Etapa 1 | `runs` con `status` y `error`, y la fila escrita desde `hooks/` o `instrumentation.ts`: hoy ninguna tool la escribe |
| Etapa 1 | `cost_usd` visible solo para `platform_admin` (visibilidad por columna, que la RLS por fila no cubre) |
| Etapa 9 | Dashboard de ejecuciones por cliente, distinto del `/metricas` de negocio de la Etapa 4 |
| Etapa 2 | `google_tokens` se absorbe en `executors`; refresh token a Vault |
| Etapa 2 | Verificación de la app de Google o migración a Vercel Connect |
| Etapa 5 | Los schedules no llevan tenant ni parkean: forma `run` por canal autenticado (hallazgo 5) |
