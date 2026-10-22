---
title: Alta self-serve y planes
category: dominios
status: activo
tags: [onboarding, planes, free, trial, suspension, tenants, research, topes]
updated: 2026-10-22
sources:
  - app/empezar
  - app/[tenant]/settings/plan
  - app/[tenant]/settings/perfil
  - components/plan
  - components/auth/login-methods-field.tsx
  - lib/plans
  - lib/onboarding
  - lib/tenants/signup-route.ts
  - lib/tenants/session-method.ts
  - agents/outreach/schedules/trial-expiry.ts
  - agents/asistente/hooks/allowance.ts
  - agents/outreach/hooks/allowance.ts
  - supabase/migrations/20261029120000_self_serve_onboarding.sql
  - supabase/migrations/20261030120000_tenant_profile_settings.sql
  - docs/superpowers/specs/2026-10-22-etapa-27-onboarding-self-serve-y-planes-design.md
  - docs/superpowers/plans/2026-10-22-etapa-27-1-alta-self-serve.md
---

# Alta self-serve y planes

## 1. Qué es y para qué

Hasta la Etapa 27 una empresa entraba a Central IA solo si INNOV.AS la daba de alta desde `/plataforma` (ver [alta de una empresa nueva](../guias/alta-de-tenant.md)). La entrega 27.1 agrega el camino sin intervención: una persona con **correo de trabajo** crea su cuenta y su empresa desde `/empezar`, confirma las carpetas de su brain, sube el logo, elige quién entra e invita a su equipo. La empresa nace en el plan **Free**; las que ya existían quedaron en **Enterprise** y siguen entrando por plataforma.

Los planes viven en `tenants.plan` y los topes se aplican en el servidor, nunca solo en pantalla. Esta página cubre la 27.1. El cobro con Stripe (27.2), el setup automático de contenido (27.3) y el ingreso abierto con aprobación (27.4) están en la spec y todavía no existen: hasta la 27.2, cada tope dice "Hablá con nosotros" con un mailto a `hola@innov.as`.

## 2. Dónde vive en el código

| Ruta o archivo | Qué hace |
|---|---|
| `/empezar` (`app/empezar/page.tsx`) | Paso 1, la cuenta: Google, Microsoft o correo. Con sesión, redirige según `signup_route` |
| `/empezar/empresa` | Paso 2: nombre y dominio; llama a `self_serve_create_tenant`, arma el brain y encola el research |
| `/empezar/dominio-tomado` | El dominio ya tiene empresa y no está abierto: "pedile a quien la administra que te invite", sin nombres |
| `/empezar/[slug]/carpetas` | Paso 3: propuesta de carpetas (8 a 19), edición y confirmación |
| `/empezar/[slug]/logo` | Paso 4: PNG, SVG o WebP hasta 1 MB, u omitir |
| `/empezar/[slug]/acceso` | Paso 5: métodos de login y restricción al dominio |
| `/empezar/[slug]/equipo` | Paso 6: invitar a dos personas y marcar el alta como terminada |
| `/[tenant]/settings/plan` | Pestaña Plan: plan, usuarios, skills y crédito del mes contra sus topes, fin del trial |
| `/[tenant]/settings/perfil` | Nombre, logo, colores, métodos de login y tope de IA del plan Pago |
| `lib/plans/limits.ts` | `PLAN_LIMITS`, `canInvite`, `canPublishSkill`, motivos (`LimitReason`); funciones puras |
| `lib/plans/store.ts`, `runtime.ts` | Lecturas de plan, conteos y gasto del mes; dependencias reales |
| `lib/plans/ai-allowance.ts`, `chat-allowance.ts` | Quién puede gastar IA: `aiAllowance` (runner) y `aiAllowanceForChat` (chat) |
| `lib/plans/trial.ts` | `expireTrials`: suspende los Free vencidos |
| `lib/plans/contact.ts` | El mailto de "Hablá con nosotros" |
| `lib/onboarding/steps.ts`, `step-gate.ts` | Orden de los pasos y redirección de quien volvió a medias |
| `lib/onboarding/seats.ts` | Cupos de usuarios del paso 6 y del botón "Invitá a un colaborador" |
| `lib/onboarding/folders-setup.ts`, `folder-template.ts` | Crea carpetas, reglas de acceso y la página inicial; plantilla genérica |
| `lib/onboarding/research-*.ts` | Research de fondo y su tabla (`onboarding_research`) |
| `lib/onboarding/services/propose-folders.ts` | El nodo `onboarding/propose-folders` |
| `lib/tenants/signup-route.ts`, `session-method.ts` | Traducen `signup_route()` a una ruta y leen el método con que se abrió la sesión |
| `components/plan/*` | Diálogo de tope, diálogo de invitación y aviso de plan en la cabecera |
| `components/auth/login-methods-field.tsx` | Selector de métodos compartido por el alta y Configuración |
| `agents/outreach/schedules/trial-expiry.ts` | Schedule diario que vence el Free |
| `agents/asistente/hooks/allowance.ts`, `agents/outreach/hooks/allowance.ts` | Hook eve que corta el turno por suspensión o crédito |

## 3. Cómo funciona

### Planes y topes

| | Free | Pago | Enterprise |
|---|---|---|---|
| Usuarios | 3 lugares | sin tope | sin tope |
| Skills publicadas | 5 | sin tope | sin tope |
| IA | USD 5 por mes calendario (UTC) | por consumo; tope mensual propio opcional | presupuesto de plataforma (`tenant_budgets`), como siempre |
| Duración | 3 meses | mientras pague | — |

El plan **Pago** existe en la base y en los topes, pero nada lo activa hasta la 27.2 (Stripe). Los números salen de `PLAN_LIMITS` y son constantes en código.

- **Usuarios**: son las filas de `memberships` con rol `tenant_admin` o `tenant_member`; las `platform_admin` (soporte) no cuentan. Al **invitar** el tope suma miembros activos más invitaciones pendientes (una pendiente reserva lugar); la facturación futura cuenta solo activos. `tenant_counts(tenant)` devuelve `{ users, pending_invitations, published_skills }` y funciona también con la service role. Dos invitaciones simultáneas pueden pasarse por un lugar: es un tope blando aceptado.
- **Skills**: `published_skills` cuenta las publicadas; la sexta devuelve `limit:skills`.
- **Motivos**: `limit:users`, `limit:skills`, `limit:ai_credit` y `suspended:<causa>`. La acción que choca no se ejecuta; `limit-dialog.tsx` traduce el motivo al diálogo.
- **IA**: el gasto del mes es la suma de `usage_entries` con `resource = 'model_usd'` en el mes UTC, el mismo corte de `tenant_spend_report`. Ver [modelos y costos](../arquitectura/modelos-y-costos.md).

### Suspendida

`tenants.suspended_reason` (`trial_vencido`, `pago_fallido`, `cancelado`) pone la empresa en solo lectura: se lee todo, no se escribe en el brain, no se publican skills, no se invita y el chat no responde. La red está en la base: `tenant_is_writable(tenant)` (`active and suspended_reason is null`) y los triggers `tenant_writable_guard` en `brain_pages`, `brain_skill_versions`, `brain_folders` e `invitations` fallan con `42501` para cualquier rol, también la service role. `accept_pending_invitations()` salta las empresas suspendidas para no fallar entera. En 27.1 la única causa que se produce es `trial_vencido`.

### El schedule `trial-expiry`

`agents/outreach/schedules/trial-expiry.ts` corre a diario (`15 6 * * *`, UTC) y llama a `expireTrials`: marca `trial_vencido` en las Free con `trial_ends_at < now()` y deja el evento `tenant.suspended`. Es de plataforma y vive en el agente de outreach por ser el único con schedules desplegados. Desde 14 días antes del vencimiento la cabecera avisa con la fecha.

### El corte del chat: hook `allowance`

Antes de cada turno, el hook `allowance` del Asistente y de outreach consulta `aiAllowanceForChat`. El chat se corta **solo** por suspensión (cualquier plan) y por el crédito Free o el tope Pago del mes; **nunca** por `tenant_budgets` de Enterprise. El corte es un turno fallido cuyo mensaje empieza con `ai_allowance:<motivo>` (`turn.failed`), no una respuesta fija, así que el canal MCP de una empresa cortada falla también. Si no se puede leer la facturación, el chat sigue (falla abierta). El runner de workflows usa `aiAllowance`, que conserva el presupuesto diario para Enterprise. Falta verificar en vivo que el mensaje de `turn.failed` de eve llegue con el texto `ai_allowance:`.

### El alta paso a paso

1. **Cuenta.** `/empezar`. Tras el login, `signup_route()` decide: `chat` (ya tiene membresía), `dominio_tomado` (su dominio está en una empresa activa no abierta), `sin_acceso` (correo público) o `empezar`. La regla del correo de trabajo está en [identidad y acceso](../arquitectura/identidad-y-acceso.md).
2. **Empresa.** `self_serve_create_tenant(display_name, domain)` valida que el correo esté verificado, que su dominio coincida y no sea público, que el método de login sea conocido (`login_method_unknown`) y que el dominio no esté tomado (`domain_taken`). Crea la fila (`plan = 'free'`, `trial_ends_at = now() + 3 meses`, `allowed_domains = [dominio]`, `self_signup_by_domain = false`), la membresía `tenant_admin`, el agente Asistente y los eventos `tenant.created` (con `origin = 'self_serve'`) y `membership.created`. El slug sale del dominio (`slug_from_domain`), con sufijo si está tomado. Después la server action crea el brain wiki **sin carpetas**, habilita las skills y encola el research.
3. **Carpetas.** Muestra la propuesta del research; la persona renombra, saca o agrega (hasta 19) y marca cuáles son restringidas. Al confirmar, `folders-setup` crea las carpetas, a las restringidas les pone la regla `members → ninguno`, escribe `00-reglas` y la página `que-sabemos` de la carpeta de empresa con el resumen, firmada por Central IA. Es idempotente: concilia reintentos y no se traba con carpetas que ya tienen páginas.
4. **Logo.** Opcional; los colores quedan para Configuración.
5. **Acceso.** Métodos de login (al menos uno) y la restricción al dominio de la empresa, que es una línea fija sin interruptor. "Todos los del dominio" no se ofrece: el ingreso abierto sigue deshabilitado fuera de Enterprise hasta la 27.4.
6. **Equipo.** Invita a dos personas (o saltea) y marca `onboarding_completed_at`.

`set_onboarding_step(tenant, step)` guarda el avance en `tenants.onboarding_step` (`logo`, `acceso`, `equipo`; `null` lo da por terminado). Con el alta sin completar, cualquier ruta de la empresa redirige al paso que falta (`step-gate`); el de carpetas se deduce de que no haya carpetas.

### El research: nodo `onboarding/propose-folders`

Nodo de efecto 1 y tier `barato`, registrado en `lib/workflows/registry.ts`. Entra `{ domain, displayName, hint? }` y sale `{ found, company, brand, folders }` con schema. Lee el sitio con `fetchPublicPage` (home y hasta 8 páginas enlazadas) y propone carpetas; siempre incluye dirección y finanzas, restringidas. `normalizeProposal` rellena hasta 8 con la plantilla genérica. Sin sitio legible devuelve `found = false`; con un `hint` (tres líneas del usuario) devuelve `found = true`.

El research corre de fondo y se guarda en `onboarding_research` (una fila por empresa; estado, propuesta y código de error, no el mensaje crudo). Un research en `running` que quedó colgado cuenta como error; si no hay fila, la pantalla la crea (`ensureResearch`). Gasta con `metered()` y asienta en `usage_entries`, así que cuenta contra el crédito de Free.

### Configuración

`set_tenant_profile` (nombre, logo y colores), `set_tenant_auth_methods` y `set_ai_monthly_limit` son funciones `security definer` con `settings_actor`, el patrón de la 21.2: el `tenant_admin` edita su perfil sin abrir el trigger `tenants_guard_columns`. `plan`, `trial_ends_at`, `suspended_reason` y `onboarding_completed_at` las escriben solo funciones propias o la service role. `allowed_domains` sigue siendo de plataforma.

## 4. Cómo se prueba

```bash
npm test -- tests/plans tests/onboarding tests/tenants tests/settings
npm run db:test   # 37_self_serve_onboarding, 38_tenant_profile_settings
```

`tests/plans/*` cubre topes, crédito y trial; `tests/onboarding/*`, las acciones de cada paso, el research y la conciliación de carpetas. Las pruebas de la base ejercitan `self_serve_create_tenant`, `signup_route`, los triggers de escritura y las funciones de perfil. Quedan pendientes en producción: un alta real con un correo de trabajo ajeno a INNOV.AS y la verificación del mensaje `ai_allowance:`.

## 5. Decisiones

- Spec: [Etapa 27, onboarding self-serve y planes](../superpowers/specs/2026-10-22-etapa-27-onboarding-self-serve-y-planes-design.md). Plan: [27.1, alta self-serve](../superpowers/plans/2026-10-22-etapa-27-1-alta-self-serve.md), con sus enmiendas durante la ejecución.
- El crédito de Free son USD 5 por mes (P19) y manda por encima de `tenant_budgets`, que Free no usa.
- El chat nunca se corta por el presupuesto de Enterprise (se mantiene G4 de la 21.5).
- Una invitación pendiente reserva lugar al invitar; la cobranza cuenta solo activos (P25).
- Login con Microsoft ya estaba en `main` (Etapa 20.1, [#85](https://github.com/innovasbuild/agents/pull/85)); su guía de configuración es el PR 135.
