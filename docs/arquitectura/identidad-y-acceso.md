---
title: Identidad y acceso
category: arquitectura
status: activo
tags: [auth, supabase, oauth, mcp, login, memberships]
updated: 2026-10-14
sources:
  - docs/superpowers/specs/2026-10-14-etapa-21-6-dominio-por-empresa-design.md
  - lib/tenants/host.ts
  - lib/tenants/host-store.ts
  - lib/tenants/public-url.ts
  - app/.well-known/oauth-protected-resource/brain/mcp
  - docs/superpowers/specs/2026-10-09-etapa-20-login-design.md
  - docs/superpowers/specs/2026-10-09-ingreso-por-dominio-design.md
  - docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md
  - docs/superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md
  - docs/superpowers/specs/2026-10-05-alta-empresas-landing-design.md
  - proxy.ts
  - lib/auth
  - lib/agents/mcp-channel-auth.ts
  - lib/tenants/login-check.ts
  - lib/tenants/login-check-server.ts
  - app/auth
  - app/(auth)/login
  - app/oauth/consent
  - app/.well-known/oauth-protected-resource
  - supabase/migrations/20261013120000_login_methods.sql
  - supabase/migrations/20261014120000_member_blocks.sql
---

# Identidad y acceso

Quién es una persona, a qué empresas (tenants) pertenece y con qué método entró. Hay dos puertas con la misma identidad detrás: el navegador (sesión de Supabase Auth en cookies) y los clientes MCP como Claude Code o claude.ai (token OAuth que emite Supabase). Para el aislamiento por empresa en la base, ver [tenancy](tenancy.md).

## Supabase Auth y las tres variables

Toda la identidad vive en Supabase Auth. El código lee tres variables, cada una con un papel distinto:

| Variable | Quién la lee | Para qué |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Navegador, servidor, `proxy.ts`, los canales de eve | URL del proyecto. También es el `issuer` del emisor OAuth (`<url>/auth/v1`) y de las sesiones de eve |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Navegador, `proxy.ts`, `lib/supabase/server.ts`, `lib/auth/verify-caller.ts`, `lib/auth/oauth-principal.ts` | Clave pública: todo corre bajo la RLS de quien llama |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor: `lib/supabase/admin.ts` (`createAdminClient`) | Salta la RLS. Se usa para leer membresías y tenants desde el canal MCP y el brain, y en los schedules. Nunca llega al navegador |

Los clientes están en `lib/supabase/` (`browser.ts`, `server.ts`, `admin.ts`). Las variables por entorno se explican en [entornos y deploy](entornos-y-deploy.md).

## Cómo se entra

`/login` es el login general; `/login/[tenant]` es la landing pública de una empresa, con su marca y solo los métodos que esa empresa ofrece. Los dos usan el mismo `LoginForm` (`app/(auth)/login/login-form.tsx`). Un método que la empresa no tiene no se dibuja.

| Método | Cómo funciona |
|---|---|
| Google | `signInWithOAuth` (proveedor `google`), vuelve a `/auth/callback` |
| Microsoft | `signInWithOAuth` con el proveedor de Supabase `azure` (`lib/auth/oauth-providers.ts`). Apagado en producción hasta completar el anexo A de la spec (claim `xms_edov` en Entra) |
| Link por correo | `signInWithOtp`; el mail trae un link a `/auth/callback` |
| Código de 6 dígitos | El mismo mail trae un código. Se acepta de 6 a 10 dígitos porque el largo es un ajuste del proyecto en Supabase |

Detalles que importan:

- **El mensaje no revela quién tiene cuenta.** `requestMagicLink` (`lib/auth/magic-link.ts`) resuelve igual con un correo con acceso, sin acceso (Supabase responde 422) o con la red caída ([#83](https://github.com/innovasbuild/agents/pull/83)).
- **El código se verifica en el navegador** (`verifyOtp`), no en el servidor, para que el límite por IP de Supabase cuente la IP de cada persona y no la del servidor. Después una server action, `completeLogin(next)` (`app/(auth)/login/actions.ts`), corre el tramo posterior y devuelve a dónde ir; navega el cliente. No usa `redirect()` porque en Next 16 eso rechaza la promesa de la acción. Si el tramo posterior falla, el cliente cierra la sesión que dejó `verifyOtp` (`lib/auth/email-code.ts`) ([#91](https://github.com/innovasbuild/agents/pull/91)).
- **`next` es solo del mismo origen.** `safeNextPath` (`lib/auth/next-path.ts`) descarta cualquier otra cosa para evitar un open redirect.
- **Rutas del flujo:**

| Ruta | Qué hace |
|---|---|
| `/auth/callback` | Intercambia el `code` por sesión (`exchangeCodeForSession`), corre `completeLogin` y redirige. Sin `code`, manda a `/auth/confirmar` |
| `/auth/confirmar` | Pantalla de navegador para los links de invitación: Supabase deja la sesión en el fragmento `#access_token`, que el servidor no ve. No abre sesión sola: muestra con qué cuenta vas a entrar y espera el clic (evita un login CSRF). Un link vencido ofrece la landing de la empresa (`landingPathFor`) |
| `/` | Sin sesión va a `/login`; sin empresas, a `/sin-acceso`; con una sola, a su `/<slug>` |
| `/sin-acceso` | Persona autenticada sin ninguna empresa |

## Qué pasa justo después de entrar

`completeLogin` (`lib/auth/complete-login.ts`) es el tramo que comparten link, OAuth y código:

1. `joinOnLogin` llama a las funciones SQL `accept_pending_invitations()` y `join_tenants_by_domain()`. Cada paso es independiente: si uno falla se registra y el otro corre igual.
2. `gateLogin` llama a `login_gate()` y decide si la sesión puede quedarse.
3. Si el corte dice que no, `closeLocalSession` cierra **solo** la sesión recién abierta (`signOut({ scope: "local" })`; el global revocaría la que la persona tenga en otro dispositivo) y manda a `/login/<slug>?error=metodo`.

Las altas de membresía solo existen como funciones `security definer`: `authenticated` no puede insertar ni cambiar `user_id` o `tenant_id` en `memberships`, solo el `role` ([#80](https://github.com/innovasbuild/agents/pull/80)). Un tenant_admin ya no puede meter a un usuario ajeno en su empresa.

## Ingreso por dominio

Una empresa puede ser **solo por invitación** o **abierta a todo su dominio**. Está en la tabla `tenants`:

- `allowed_domains`: dominios de correo de la empresa. Los carga plataforma en `/plataforma/<slug>`.
- `self_signup_by_domain`: el modo abierto, que lo activa el admin de la empresa en `/<slug>/settings`. Una restricción de la base exige al menos un dominio para abrirlo, y un trigger (`tenants_guard_columns`) deja que un tenant_admin cambie solo `default_model` y `self_signup_by_domain`, y no abrir el modo con un dominio de correo público (`is_public_email_domain`).
- `join_tenants_by_domain()` crea la membresía de `tenant_member` para quien tenga un correo **verificado** de esos dominios, y deja `joined_by_domain` en la fila.
- `canSignUpByDomain` decide `shouldCreateUser` al pedir el link: solo un correo de un dominio abierto puede crear cuenta.

Condición de despliegue: en Supabase Auth de producción tiene que estar prendido "Confirm email"; si no, alguien podría registrarse por la API con el correo de otro ([#81](https://github.com/innovasbuild/agents/pull/81)).

## Métodos de login impuestos por la empresa

`tenants.auth_methods` (`email`, `google`, `microsoft`; mínimo uno) no es solo de pantalla: el servidor lo hace cumplir ([#85](https://github.com/innovasbuild/agents/pull/85)). La spec de la landing lo había dejado como límite de pantalla; la Etapa 20 lo cambió.

- **`current_login_method()`** deriva en SQL con qué método se abrió *esta* sesión, del claim `amr` del JWT y de `auth.identities`. Nunca llega por parámetro. Una sesión de Azure solo cuenta como `microsoft` si su identidad trae `xms_edov` verdadero. Lo que no reconoce da `null`, y `null` no está permitido en ninguna empresa.
- **`login_gate()`** decide el corte al entrar (`lib/auth/login-gate.ts` traduce el resultado). Corta si la persona tiene alguna empresa (membresía, invitación pendiente o dominio abierto) y ninguna de sus membresías permite el método. Si la función falla, se corta.
- **`tenant_allows_login(p_tenant)`** se chequea en cada request (`lib/tenants/login-check.ts`, `allowsLogin`, falla cerrado): `resolveTenantAccess`, `requirePlatformAdmin`, el canal del chat, las server actions de settings, usuarios y chat, y `POST /api/invitations`. En una página, un método no permitido redirige a `/login/<slug>?error=metodo` sin cerrar la sesión (puede ser válida para otra empresa de la persona). Para lo que no pasa por una página, `actionAllowsLogin` (`lib/tenants/login-check-server.ts`).
- **Un administrador de plataforma se chequea contra el tenant dueño**, no contra la empresa que visita (`PLATFORM_OWNER_TENANT_SLUG`, ver [plataforma](../dominios/plataforma.md)).
- Una empresa dueña no puede perder el método con el que entra quien la edita: quedaría la consola sin acceso.

Límites declarados en la spec §8: la API de datos directa y los tokens MCP ya emitidos no aplican la regla; un cliente solo Microsoft no puede usar el agente de outreach para correo hasta que exista un proveedor Outlook.

## Bloqueo por persona

"Sacar" a alguien de un dominio abierto no alcanza: vuelve a entrar solo. La tabla `membership_blocks` (`tenant_id`, `user_id`, `blocked_by`) lo impide ([#86](https://github.com/innovasbuild/agents/pull/86)):

- Solo la escriben `block_member` y `unblock_member`; los administradores la leen por RLS.
- `join_tenants_by_domain` salta a los bloqueados y `login_gate` no los manda a la landing de la empresa que los bloqueó. Aceptar una invitación levanta el bloqueo y deja el evento `membership.unblocked`.
- El trigger `memberships_keep_one_admin` impide que una empresa quede sin administrador, venga de un cambio de rol, una baja o un bloqueo.
- Las acciones (`revokeMembership`, `changeMemberRole`, `blockMember`, `unblockMember`, `resendInvitation`) viven en `/<slug>/settings/usuarios`. Ver [invitaciones y usuarios](../dominios/invitaciones-y-usuarios.md).

Al sacar a alguien también se van sus reglas de acceso al brain: el trigger `memberships_brain_rules_cleanup` borra sus filas de `brain_access_rules` ([#79](https://github.com/innovasbuild/agents/pull/79), ver [brain](../dominios/brain.md)).

## `proxy.ts`

Refresca el access token de Supabase (`getUser()` con `createServerClient` y cookies) en cada navegación del servidor. Sin esto el token vence a la hora y la persona tiene que volver a entrar. Su `matcher` deja afuera lo que no es sesión de navegador: `_next/static`, `_next/image`, imágenes, `eve/` y `.well-known/`, que se autentican por bearer o son públicas. `brain/` ya no está afuera (21.6): en el dominio de una empresa las páginas del brain tienen que pasar por el proxy, y en el host raíz el endpoint MCP (`/brain/<slug>/mcp`) sale enseguida sin tocar Supabase. Además resuelve el host de cada request para servir el dominio propio de una empresa (ver [tenancy](tenancy.md)). Fuera de eso no decide acceso: eso lo hace cada ruta con `resolveTenantAccess`.

## Supabase como servidor OAuth 2.1 (canal MCP)

Para que Claude Code, claude.ai, Codex o ChatGPT se conecten, Supabase Auth actúa como servidor OAuth 2.1 con registro dinámico de clientes (Etapa 11, [#51](https://github.com/innovasbuild/agents/pull/51)). Nosotros ponemos tres cosas:

- **El emisor** es `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1` (`publicSettings()` en `lib/brain/adapters/mcp-production.ts`, que también exige `PUBLIC_APP_URL` o `VERCEL_URL` para armar la URL pública del recurso).
- **La pantalla de consentimiento**, `/oauth/consent` (`app/oauth/consent`). Pide sesión (si no hay, manda a `/login?next=`), corre antes el chequeo de método (`consentLoginCheck`: el método tiene que estar permitido en **cada** empresa activa de la persona, porque el grant vale para todas y el token no dice con qué método entró) y recién después lee el pedido, porque leerlo puede aprobarlo solo si la app ya tenía consentimiento. Dice sin vueltas que la app va a actuar como la persona. `approveConsent` y `denyConsent` repiten el chequeo: la acción se puede llamar sin pasar por la página.
- **Un rol sin permisos para esos tokens.** Los tokens del emisor son JWT normales del proyecto: con la anon key funcionarían contra PostgREST con la RLS del usuario. `public.custom_access_token_hook` les cambia el claim `role` a `oauth_client`, un rol de Postgres sin ningún grant, cuando el token trae `client_id` ([#52](https://github.com/innovasbuild/agents/pull/52)). Según el PR, que Supabase invoque el hook para los tokens del OAuth Server (y no solo para un login normal) quedaba por confirmar contra producción; el endpoint del brain no depende de eso porque usa `getClaims()` más la service role, nunca PostgREST con el token del usuario.

Dos recursos protegidos usan ese emisor. Cada uno publica su metadata RFC 9728 con una ruta de Next, porque la reescritura de Vercel hacia eve solo reenvía el prefijo del protocolo MCP, nunca `/.well-known/*`:

| Recurso | Metadata | Quién autentica |
|---|---|---|
| Brain por MCP, `/brain/[tenant]/mcp` | `/.well-known/oauth-protected-resource/brain/[tenant]/mcp` | `resolveMcpAccess` (`lib/brain/core/mcp-server/access.ts`) |
| Agente por MCP, `/eve/outreach/v1/mcp` | `/.well-known/oauth-protected-resource/eve/outreach/v1/mcp` | `verifyMcpChannelToken` → `resolveMcpChannelAuth` (`lib/agents/mcp-channel-auth.ts`) |

### URLs de MCP en el dominio de una empresa

El `resource` que publica la metadata tiene que ser exactamente la URL a la que se conectó el cliente MCP, así que las URLs salen del host del request, no de `PUBLIC_APP_URL`. Para la empresa `okeefe` en `ai.okeefe.com.ar`:

| | En su dominio | En el host raíz |
|---|---|---|
| Brain | `https://ai.okeefe.com.ar/brain/mcp` (sin slug) | `https://agentes.innov.as/brain/okeefe/mcp` |
| Metadata del brain | `/.well-known/oauth-protected-resource/brain/mcp` | `.../brain/okeefe/mcp` |
| Agente | `https://ai.okeefe.com.ar/eve/outreach/v1/mcp` (sin `?tenant=`) | `https://agentes.innov.as/eve/outreach/v1/mcp?tenant=okeefe` |

El proxy reescribe `/brain/mcp` a `/brain/okeefe/mcp`, así que el endpoint es la misma ruta de siempre. El canal del agente conserva `resource` fijo (eve lo derivaría del request interno, no del público), pero su desafío 401 lo arma `mcpChallenge` con `x-forwarded-host`, así que apunta a la metadata del dominio por el que llegó la persona. Un host de empresa solo sirve a su empresa (`assertHostServesTenant`; en el canal del agente, `?tenant=` pasa a ser opcional y uno distinto del host se trata como sin acceso). Un `Host` que no resuelve a nada nunca se refleja en la metadata: se usa el origen fijo. `/conectar` muestra estas URLs según el host por el que entró la persona.

Lo que no se puede ocultar: Supabase arma la URL del consentimiento con una sola Site URL, así que `/oauth/consent` siempre se muestra en el host raíz, y el emisor sigue siendo el de Supabase.

Reglas comunes de los dos:

- El **tenant** sale de la URL (`/brain/<slug>/mcp`, o `?tenant=<slug>` en el canal del agente), nunca de un argumento que pueda poner el modelo.
- **Roles antes que tenant**: quien no tiene acceso no distingue qué slugs existen (403 antes de 404; el 404 "no existe" solo lo ve un admin de plataforma).
- **Una fila `platform_admin` solo es de plataforma si es del tenant dueño** (`PLATFORM_OWNER_TENANT_SLUG`); en otro tenant vale como `tenant_admin`. Sin la variable, nadie entra como plataforma ([#79](https://github.com/innovasbuild/agents/pull/79), [#82](https://github.com/innovasbuild/agents/pull/82)). Lo calcula `loadPlatformOwnerTenantId` (`lib/auth/oauth-principal.ts`).
- Los claims los verifica `createOAuthClaimsVerifier` (`getClaims`); membresías y tenants se leen con la service role (`loadMemberships`, `loadTenantBySlug`).
- El brain exige que el token traiga `client_id` y, si el token nombra un método de login, llama a `tokenAllowsLogin` (`tenant_allows_login` con el token de la persona). Un token inválido es 401. Además limita 60 lecturas y 10 escrituras por minuto.
- El canal del agente arma una sesión de eve con el mismo `issuer` que el canal del dashboard (así Connect reconoce la identidad y no pide autorizar Gmail o HubSpot de nuevo) y un `subject` por empresa (`tenantSubjectId(tenantId, userId)`), para que la misma persona en dos empresas no mezcle invocaciones. En el código actual `resolveMcpChannelAuth` no llama a `tenant_allows_login`; el chequeo de método del MCP está en el brain y en el consentimiento.

## `verify-caller`: el chat del dashboard

`verifyCaller` (`lib/auth/verify-caller.ts`) autentica al navegador en el canal de eve (`agents/outreach/channels/eve.ts`), fuera del scope de request de Next: arma una sesión de Supabase a mano desde el header `cookie`. Devuelve `null` ante cualquier falla, para que eve pase al siguiente autenticador, y **rechaza los tokens con `client_id`**: un token del emisor OAuth sirve para el brain por MCP, no para abrir el chat ([#51](https://github.com/innovasbuild/agents/pull/51)). Devuelve también `allowsLogin(tenantId)`, ligado a la sesión de esa persona.

## Cómo se prueba

- `tests/auth/` cubre cada pieza: `callback`, `complete-login`, `complete-login-action`, `email-code`, `login-gate`, `magic-link`, `join-on-login`, `close-session`, `confirm`, `next-path`, `oauth-consent`, `oauth-principal`, `verify-caller`, `verify-caller-oauth`, `login-form`, `login-page`, `tenant-login-page`.
- `tests/agents/mcp-channel-auth.test.ts` (canal del agente), `tests/brain/mcp-server/access.test.ts` (brain) y `tests/tenants/login-check.test.ts`, `login-check-server.test.ts`, `resolve.test.ts`.
- pgTAP en `supabase/tests/`: `19_oauth_client_role`, `25_memberships_lock_columns`, `26_join_by_domain`, `27_login_methods`, `28_member_blocks`.
- Comandos: `npm test -- tests/auth`, `npm run db:test`. Lo que no se prueba en automático: Google y Microsoft de punta a punta (piden proveedor real) y el rechazo del chat por HTTP, porque en desarrollo el canal acepta todo por `localDev()`.

## Decisiones

- Specs: [Etapa 20, login](../superpowers/specs/2026-10-09-etapa-20-login-design.md) · [ingreso por dominio](../superpowers/specs/2026-10-09-ingreso-por-dominio-design.md) · [Etapa 11, brain por MCP](../superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md) · [Etapa 6, canal MCP](../superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md) · [alta de empresas y landing](../superpowers/specs/2026-10-05-alta-empresas-landing-design.md).
- La spec de la landing (A2) decía que los métodos se aplicaban solo en pantalla: quedó atrás desde la Etapa 20, hoy los impone el servidor.
- [#51](https://github.com/innovasbuild/agents/pull/51): emisor OAuth 2.1, consentimiento y brain por MCP.
- [#52](https://github.com/innovasbuild/agents/pull/52): rol `oauth_client` por el Custom Access Token Hook.
- [#54](https://github.com/innovasbuild/agents/pull/54): canal MCP del agente sobre el mismo emisor (ruta de montaje, `issuer` y `subject` por empresa).
- [#79](https://github.com/innovasbuild/agents/pull/79) y [#82](https://github.com/innovasbuild/agents/pull/82): `platform_admin` por MCP solo del tenant dueño.
- [#80](https://github.com/innovasbuild/agents/pull/80): `memberships` sin INSERT ni UPDATE de `user_id`/`tenant_id`.
- [#81](https://github.com/innovasbuild/agents/pull/81): ingreso por dominio.
- [#83](https://github.com/innovasbuild/agents/pull/83): mismo mensaje con o sin acceso.
- [#85](https://github.com/innovasbuild/agents/pull/85) y [#86](https://github.com/innovasbuild/agents/pull/86): Microsoft, métodos impuestos, bloqueo por persona.
- [#91](https://github.com/innovasbuild/agents/pull/91): código por correo y chequeo de método en consentimiento y brain.
- Orden de despliegue: la migración de la Etapa 20.1 tiene que llegar antes que el código; si no, `login_gate` no existe y nadie puede entrar. Ver [entornos y deploy](entornos-y-deploy.md).
