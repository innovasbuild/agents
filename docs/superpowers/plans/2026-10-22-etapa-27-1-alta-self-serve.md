# Etapa 27.1 · Alta self-serve — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una persona con correo de trabajo cree su cuenta y su empresa sola desde `/empezar`, confirme carpetas propuestas a partir de su sitio, llegue al chat e invite a dos personas, con los topes del plan Free aplicados en el servidor y el estado "suspendida" funcionando.

**Architecture:** Una migración agrega plan, trial y suspensión a `tenants`, una tabla `onboarding_research`, la función `self_serve_create_tenant` y los contadores. Las rutas `/empezar/*` son server components con server actions que usan el cliente admin para los pasos que ya hace la consola de plataforma (bind del brain, carpetas, reglas). El research es un nodo puro en `lib/onboarding/services/` que corre con `after()` desde la action. Los topes viven en `lib/plans/` y los consultan la invitación, la publicación de skills, el chat y el runner.

**Tech Stack:** Next.js App Router (server actions, `after()`), Supabase (Postgres, RLS, pgTAP), Vitest, AI SDK `generateText` con `Output.object`, eve schedules, shadcn/Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-22-etapa-27-onboarding-self-serve-y-planes-design.md` (§3, §4, §5). Diseño de pantallas: `/Users/mok/AI-Memory/innov/diseno/central-ia.pen`, fila "Alta / …" (y=4000) y "Topes / Variantes".

## Enmiendas durante la ejecución

Lo que cambió respecto del texto del plan (el cuerpo no se reescribió; manda lo que dice la spec y el código):

- **R1.** `tenant_counts` funciona también con la service role (no exige `auth.uid()`).
- **R2.** El SQL de perfil (`set_tenant_profile`, `set_tenant_auth_methods`, `set_ai_monthly_limit`) va en una segunda migración, `20261030120000_tenant_profile_settings.sql`.
- **R3.** `canSignUpByDomain` recibe un parámetro de intención (`login` | `signup`).
- **R4.** La propuesta de carpetas admite como máximo 19.
- **R5.** El paso Equipo recibe los planes (para el tope al invitar).
- **R6.** Un research con `hint` devuelve `found = true`.
- **R7.** Un research `running` colgado se trata como error.
- **R8.** Si no hay fila de research, la pantalla la crea con `ensureResearch`.
- **R9.** Después de `folders_from_config`, las carpetas se concilian (reintentos, espera acotada, sin corridas dobles).
- **R10.** La restricción al dominio del paso Acceso es una línea fija, sin interruptor.
- **R11.** El tope de usuarios cuenta miembros activos más invitaciones pendientes al invitar; la cobranza cuenta solo activos.
- **R12.** El chat se corta solo por suspensión y por el crédito Free o el tope Pago; nunca por los presupuestos `tenant_budgets` de Enterprise.

## Global Constraints

- Free: 3 usuarios (membresías `tenant_admin` + `tenant_member`; invitaciones pendientes **no** cuentan), 5 skills publicadas, crédito de IA **USD 5** por mes calendario UTC, dura **3 meses** desde `created_at` (P2, P19, P25).
- Tarjeta al mandar la cuarta invitación; en 27.1 el tope muestra "Hablá con nosotros" (`mailto:hola@innov.as`) (P6, §3).
- Motivos de rechazo, textuales: `limit:users`, `limit:skills`, `limit:ai_credit`, `suspended:trial_vencido`, `suspended:pago_fallido`, `suspended:cancelado` (§3).
- Correo de trabajo obligatorio: dominio en `is_public_email_domain` / `PUBLIC_EMAIL_DOMAINS` no crea empresa (P8).
- `empezar` es slug reservado (§3.1). Toda tabla nueva lleva `tenant_id` y RLS. `events` es append-only.
- Antes de escribir SQL: cargar `supabase-postgres-best-practices`. Funciones con `set search_path = ''`, `revoke ... from public, anon` y grant explícito. Migración: `supabase/migrations/20261029120000_self_serve_onboarding.sql` (la última es `20261028120000`). Después, `npm run db:types`.
- Nodo nuevo registrado en `lib/workflows/registry.ts` con `effect` y `tier`; todo lo que gasta pasa por `metered()`.
- UI y textos en castellano rioplatense; identificadores en inglés. Copys exactos de las pantallas en el `.pen`.
- Nada específico de un tenant en código. Hilos del chat siguen individuales (P15).
- Commits con prefijo `feat:`/`fix:`/`docs:`; identidad git `innovasbuild` / `matias@innov.as`. `npm run lint:fix` reformatea 4 archivos ajenos: revertirlos antes de commitear.
- Docs: `npm run docs:check` en verde al cerrar (rutas, tablas, nodo y schedule nuevos mencionados en `docs/dominios|arquitectura|guias`; fila de la etapa en `docs/decisiones/README.md`; fila del PR en `docs/decisiones/prs.md`).

## Review Focus

1. **Dos pestañas o dos clics en "Crear mi empresa"** → tiene que quedar una sola empresa; la segunda llamada devuelve `domain_taken` y la pantalla manda a la empresa existente. Test en Task 3 (pgTAP) y Task 7.
2. **Correo con mayúsculas o espacios** (`Mati@Lagomarsino.com.ar `) → el dominio se normaliza en minúsculas y coincide con el del correo verificado. Test en Task 3.
3. **Persona que cierra la pestaña en el paso 3 y vuelve por `/<slug>/chat`** → redirige al paso pendiente, no al chat vacío. Test en Task 10.
4. **Research que tarda más de lo que la persona espera o falla** → la pantalla del paso 3 muestra "Investigando" y, si la fila queda en `error`, pasa a "SinSitio"; nunca un spinner infinito. Tests en Task 5 y Task 8.
5. **Empresa Enterprise existente** → nada cambia para ella: sin tope de usuarios ni skills, presupuesto diario como hoy, sin aviso de trial. Tests en Task 2, Task 12, Task 13.

---

## Estructura de archivos

```
supabase/migrations/20261029120000_self_serve_onboarding.sql   columnas, tabla, funciones, triggers, slug reservado
supabase/tests/37_self_serve_onboarding.test.sql                pgTAP
lib/plans/limits.ts            PLAN_LIMITS, tipos Plan/LimitReason, helpers puros
lib/plans/ai-allowance.ts      aiAllowance(): crédito Free / tope Pago / presupuesto Enterprise
lib/plans/trial.ts             expireTrials(): vence trials (lógica del schedule)
lib/plans/store.ts             lecturas con admin client: plan, counts, gasto del mes
lib/onboarding/services/propose-folders.ts   nodo (research de carpetas), salida con schema zod
lib/onboarding/research-run.ts               corre el nodo y guarda en onboarding_research
lib/onboarding/folders-setup.ts              crea brain, carpetas, reglas, página inicial
lib/onboarding/steps.ts                      orden de pasos y redirección
lib/onboarding/slug.ts                       slugFromDomain()
lib/tenants/signup-route.ts                  decide a dónde va quien entra sin membresía
app/empezar/page.tsx                         paso 1 (cuenta)
app/empezar/empresa/page.tsx + actions.ts    paso 2
app/empezar/[slug]/carpetas/page.tsx + actions.ts + carpetas-form.tsx   paso 3 (3 estados)
app/empezar/[slug]/logo/page.tsx + actions.ts                           paso 4
app/empezar/[slug]/acceso/page.tsx + actions.ts                         paso 5
app/empezar/[slug]/equipo/page.tsx + actions.ts                         paso 6
app/empezar/dominio-tomado/page.tsx          P17
app/[tenant]/settings/plan/page.tsx          pestaña Plan
app/[tenant]/settings/perfil-actions.ts      nombre, logo, colores, métodos, tope de IA
components/plan/limit-dialog.tsx             Diálogo de tope (3 variantes + suspendida)
components/plan/invite-dialog.tsx            "Invitá a un colaborador" (envuelve InviteForm)
agents/outreach/schedules/trial-expiry.ts    schedule diario
```

---

### Task 1: Migración — plan, trial, suspensión, research y slug reservado

**Files:**
- Create: `supabase/migrations/20261029120000_self_serve_onboarding.sql`
- Create: `supabase/tests/37_self_serve_onboarding.test.sql`
- Modify: `lib/auth/confirm.ts:43` (`RESERVED_SEGMENTS` + `"empezar"`), `lib/tenants/host-routing.ts:15` (`PLATFORM_ONLY` + `"empezar"`)
- Regenerar: `lib/supabase/database.types.ts` (`npm run db:types`)

**Interfaces:**
- Produces (SQL):
  - `tenants.plan text not null default 'enterprise' check (plan in ('free','pago','enterprise'))`
  - `tenants.trial_ends_at timestamptz null`, `tenants.suspended_reason text null check in ('trial_vencido','pago_fallido','cancelado')`, `tenants.onboarding_step text null check in ('carpetas','logo','acceso','equipo')`, `tenants.onboarding_completed_at timestamptz null`, `tenants.ai_monthly_limit_usd numeric(10,2) null check (>= 0)`
  - `tenants_slug_not_reserved` recreada con `'empezar'` en la lista (con el `do $$` previo que falla si ya existe ese slug)
  - `public.tenant_is_writable(p_tenant uuid) returns boolean` (`stable`, `security definer`, grant a `authenticated`): `active and suspended_reason is null`
  - Trigger `tenant_writable_guard` `before insert or update` en `brain_pages`, `brain_skill_versions`, `brain_folders`, `invitations`: si `not tenant_is_writable(new.tenant_id)` → `raise exception 'la empresa está suspendida' using errcode='42501', hint='suspended'`. Vale para cualquier rol.
  - `public.tenant_counts(p_tenant uuid) returns jsonb` (`stable`, `security definer`, grant a `authenticated` y `service_role`; exige `is_member_of(p_tenant)` o `is_platform_admin()`): `{"users": n, "pending_invitations": n, "published_skills": n}` donde `users` cuenta `memberships` con rol `tenant_admin`/`tenant_member`, `pending_invitations` las `invitations` `pending` no vencidas, `published_skills` las filas de `brain_skill_overview(p_tenant)` con `action = 'publicar'`.
  - Tabla `public.onboarding_research (tenant_id uuid primary key references tenants on delete cascade, status text not null check in ('running','done','error'), hint text null, result jsonb null, error text null, updated_at timestamptz not null default now())`. RLS: select para `has_tenant_role(tenant_id, '{tenant_admin}')` o platform admin; sin insert/update/delete para `authenticated` (escribe la service role).
  - `public.self_serve_create_tenant(p_display_name text, p_domain text) returns jsonb` (`security definer`, grant a `authenticated`) según spec §5.1: devuelve `{"id": uuid, "slug": text}`; errores con `errcode='23514'` y `hint` = `login_method_unknown` | `public_domain` | `domain_mismatch` | `domain_taken`; `42501` sin sesión. Inserta `tenants` (`plan='free'`, `trial_ends_at = now() + interval '3 months'`, `onboarding_step='carpetas'`, `allowed_domains = array[p_domain]`, `auth_methods = array[current_login_method()]`, `self_signup_by_domain=false`), `memberships` (`tenant_admin`), `tenant_agents` (`'asistente'`, config `'{"brain":"read_write"}'`), y eventos `tenant.created` (payload `{slug, agents, origin:'self_serve'}`) y `membership.created` (payload `{role}`).
  - `public.set_onboarding_step(p_tenant uuid, p_step text) returns void` (`security definer`, grant a `authenticated`, abre con `settings_actor`): `p_step` en `('logo','acceso','equipo')` o `null`; con `null` además `onboarding_completed_at = now()`.
  - `public.signup_route() returns text` (`stable`, `security definer`, grant a `authenticated`): para `auth.uid()` sin membresía devuelve `'dominio_tomado'` si su dominio está en `allowed_domains` de un tenant `active` con `self_signup_by_domain=false`; `'sin_acceso'` si el dominio es público; `'empezar'` en otro caso. Con membresía devuelve `'chat'`.
  - Slug: `public.slug_from_domain(p_domain text) returns text` (`immutable`, `security definer`): primera etiqueta del dominio (`lagomarsino.com.ar` → `lagomarsino`), recortada a 39 caracteres, `[a-z0-9-]`, con prefijo `e-` si no empieza por letra. `self_serve_create_tenant` le agrega `-2`, `-3`… hasta encontrar uno libre y no reservado.

- [ ] **Step 1: Escribir el pgTAP que falla** en `supabase/tests/37_self_serve_onboarding.test.sql`, con `pg_temp.login_as(user, amr)` como en `27_login_methods.test.sql:55-61`. Asserts (`select plan(N)`):

```sql
-- columnas y default
select col_default_is('public','tenants','plan',E'\'enterprise\'::text');
select throws_ok($$ insert into public.tenants (slug, display_name) values ('empezar','x') $$, '23514');
-- slug_from_domain
select is(public.slug_from_domain('lagomarsino.com.ar'), 'lagomarsino');
select is(public.slug_from_domain('123molinos.com'), 'e-123molinos');
-- self_serve_create_tenant: usuario otp con correo Mati@Lagomarsino.com.ar (mayúsculas) y p_domain 'lagomarsino.com.ar'
select is((public.self_serve_create_tenant('Molinos Lagomarsino','lagomarsino.com.ar'))->>'slug', 'lagomarsino');
select is((select plan from public.tenants where slug='lagomarsino'), 'free');
select ok((select trial_ends_at from public.tenants where slug='lagomarsino') between now() + interval '89 days' and now() + interval '93 days');
select is((select onboarding_step from public.tenants where slug='lagomarsino'), 'carpetas');
select is((select role::text from public.memberships where tenant_id=... and user_id=...), 'tenant_admin');
select is((select count(*) from public.tenant_agents where tenant_id=... and agent='asistente'), 1::bigint);
select is((select count(*) from public.events where type='tenant.created' and payload->>'origin'='self_serve'), 1::bigint);
-- segunda llamada misma persona/dominio → domain_taken
select throws_ok($$ select public.self_serve_create_tenant('Otra','lagomarsino.com.ar') $$, '23514');
-- dominio público → public_domain; dominio distinto al del correo → domain_mismatch
select throws_ok($$ select public.self_serve_create_tenant('X','gmail.com') $$, '23514');
select throws_ok($$ select public.self_serve_create_tenant('X','otro.com') $$, '23514');
-- método null (login_as con amr azure sin xms_edov) → login_method_unknown
-- slug tomado → sufijo -2 (segundo dominio 'lagomarsino.uy' con otro usuario)
select is((public.self_serve_create_tenant('L Uruguay','lagomarsino.uy'))->>'slug', 'lagomarsino-2');
-- tenant_counts
select is(public.tenant_counts(:tenant), '{"users":1,"pending_invitations":0,"published_skills":0}'::jsonb);
-- signup_route
select is(public.signup_route(), 'chat');            -- con membresía
select is(public.signup_route(), 'dominio_tomado');  -- otro usuario @lagomarsino.com.ar sin membresía
select is(public.signup_route(), 'sin_acceso');      -- usuario @gmail.com
select is(public.signup_route(), 'empezar');         -- usuario @nuevo.com
-- set_onboarding_step: tenant_admin ok, tenant_member 42501, null completa
select is((select onboarding_completed_at is not null from public.tenants where slug='lagomarsino'), true);
-- tenant_is_writable + trigger: con suspended_reason='trial_vencido', insert en brain_folders (como service_role) → 42501
select throws_ok($$ insert into public.brain_folders (tenant_id, path, description) values (..., 'x', '') $$, '42501');
-- onboarding_research: tenant_admin lee su fila; otro tenant no la ve
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm run db:test`
Expected: FAIL en `37_self_serve_onboarding` (funciones y columnas inexistentes).

- [ ] **Step 3: Escribir la migración** con todo lo de Interfaces. `self_serve_create_tenant` normaliza con `lower(btrim(...))` el correo y `p_domain` antes de comparar; lee el correo de `auth.users` con `email_confirmed_at is not null`. El trigger `tenant_writable_guard` se crea una vez por tabla con la misma función `public.tenant_writable_guard()`.

- [ ] **Step 4: Correr pgTAP y verificar que pasa**

Run: `npm run db:test`
Expected: todos los archivos en verde, incluido `37_self_serve_onboarding`.

- [ ] **Step 5: Regenerar tipos y reservar el slug en TS**

Run: `npm run db:types`; agregar `"empezar"` a `RESERVED_SEGMENTS` (`lib/auth/confirm.ts`) y a `PLATFORM_ONLY` (`lib/tenants/host-routing.ts`). Test existente `tests/auth/confirm.test.ts` sigue en verde; agregar un caso que `/empezar/x` no se trate como slug de tenant.

Run: `npm run typecheck && npm test -- tests/auth tests/tenants`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261029120000_self_serve_onboarding.sql supabase/tests/37_self_serve_onboarding.test.sql lib/supabase/database.types.ts lib/auth/confirm.ts lib/tenants/host-routing.ts tests/auth/confirm.test.ts
git commit -m "feat: plan, trial y alta self-serve en la base"
```

---

### Task 2: `lib/plans` — topes, lecturas y crédito de IA

**Files:**
- Create: `lib/plans/limits.ts`, `lib/plans/store.ts`, `lib/plans/ai-allowance.ts`
- Test: `tests/plans/limits.test.ts`, `tests/plans/ai-allowance.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/plans/limits.ts
  export type Plan = "free" | "pago" | "enterprise";
  export type SuspendedReason = "trial_vencido" | "pago_fallido" | "cancelado";
  export type LimitReason = "limit:users" | "limit:skills" | "limit:ai_credit" | `suspended:${SuspendedReason}`;
  export const PLAN_LIMITS: Record<Plan, { users: number; skills: number; aiUsdPerMonth: number | null; trialMonths: number | null }>;
  // free {3, 5, 5, 3}; pago {Infinity, Infinity, null, null}; enterprise {Infinity, Infinity, null, null}
  export interface TenantPlan { plan: Plan; suspendedReason: SuspendedReason | null; trialEndsAt: string | null; aiMonthlyLimitUsd: number | null }
  export interface TenantCounts { users: number; pendingInvitations: number; publishedSkills: number }
  export function suspendedReasonOf(t: TenantPlan): LimitReason | null;           // "suspended:<reason>" o null
  export function canInvite(t: TenantPlan, c: TenantCounts): LimitReason | null;   // suspendida primero; free y users >= 3 → "limit:users"
  export function canPublishSkill(t: TenantPlan, c: TenantCounts): LimitReason | null; // free y publishedSkills >= 5 → "limit:skills"
  export function trialWarning(t: TenantPlan, now: Date): { daysLeft: number } | null; // free, trial_ends_at - now <= 14 días y > 0
  export function monthStartUtc(now: Date): Date;
  export function limitMessage(reason: LimitReason): { title: string; body: string }; // copys del .pen "Topes / Variantes"

  // lib/plans/store.ts
  export interface PlanStore {
    tenantPlan(tenantId: string): Promise<TenantPlan | null>;   // select plan, suspended_reason, trial_ends_at, ai_monthly_limit_usd
    counts(tenantId: string): Promise<TenantCounts>;            // rpc tenant_counts
    monthSpendUsd(tenantId: string, since: Date): Promise<number>; // rpc usage_sum {p_tenant, p_resource:"model_usd", p_since}
    dailyLimit(tenantId: string, resource: string): Promise<number>; // tenant_budgets, como lib/workflows/store.ts:170
    usageSince(tenantId: string, resource: string, since: Date): Promise<number>;
  }
  export function createPlanStore(admin: SupabaseClient): PlanStore;

  // lib/plans/ai-allowance.ts
  export type AiAllowance = { ok: true; spent: number; limit: number | null } | { ok: false; reason: "limit:ai_credit" | `suspended:${SuspendedReason}`; spent: number; limit: number | null };
  export async function aiAllowance(input: { tenantId: string; timezone: string }, deps: { store: PlanStore; now: () => Date }): Promise<AiAllowance>;
  ```
  Reglas de `aiAllowance`: plan inexistente → `ok:true`; suspendida → `ok:false` con `suspended:*`; `free` → `monthSpendUsd(monthStartUtc(now)) >= 5` → `limit:ai_credit`; `pago` con `aiMonthlyLimitUsd` → mismo corte contra ese tope, sin tope → `ok`; `enterprise` → `usageSince(hoy en la zona horaria) >= dailyLimit` → `limit:ai_credit` (misma semántica que `budgetStatus` hoy).

- [ ] **Step 1: Escribir los tests** `tests/plans/limits.test.ts` (`canInvite` free con 3 usuarios → `limit:users`; free con 2 usuarios y 5 invitaciones pendientes → `null`; pago con 50 → `null`; suspendida → `suspended:trial_vencido` aunque tenga 0; `canPublishSkill` free con 5 → `limit:skills`; `trialWarning` 13 días → `{daysLeft:13}`, 15 → `null`, enterprise → `null`; `monthStartUtc(2026-10-22T03:00-03:00)` → `2026-10-01T00:00:00Z`) y `tests/plans/ai-allowance.test.ts` con un `PlanStore` falso (free gastó 4.99 → ok; 5.00 → `limit:ai_credit`; pago sin tope y gastó 900 → ok; pago con tope 50 y gastó 50 → corte; enterprise con `dailyLimit` 0 → corte; enterprise con 10 y gastó 3 → ok).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/plans`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar los tres módulos** con las firmas de Interfaces. `createPlanStore` sigue el patrón de `lib/workflows/store.ts:157-178`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/plans && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/plans tests/plans
git commit -m "feat: topes por plan y crédito de IA"
```

---

### Task 3: Nodo `onboarding/propose-folders`

**Files:**
- Create: `lib/onboarding/services/propose-folders.ts`, `lib/onboarding/folder-template.ts`
- Modify: `lib/workflows/registry.ts` (`NODES["onboarding/propose-folders"] = { effect: 1, tier: "barato" }`)
- Test: `tests/onboarding/propose-folders.test.ts`, `tests/workflows/registry.test.ts` (ya existe; queda verde al registrar)

**Interfaces:**
- Consumes: `fetchPublicPage`, `WebPageResult` (`lib/outreach/web-page.ts`); `generateText`, `Output`, `tool`, `stepCountIs` (AI SDK) como en `lib/outreach/services/generate-research.ts`; `GatewayOptions` (`lib/workflows/gateway-options.ts`).
- Produces:
  ```ts
  export const PROPOSE_MAX_PAGES = 8;
  export const PROPOSE_SYSTEM: string; // reglas del prompt: 8 a 10 carpetas, incluye siempre direccion y finanzas restringidas, slugs [a-z0-9-] sin acentos, nunca skills|skill|brain, descripciones de una línea que dicen qué va adentro, castellano rioplatense
  export const folderProposalSchema = z.object({
    found: z.boolean(),
    company: z.object({ summary: z.string(), industry: z.string(), sizeHint: z.string().nullable(), location: z.string().nullable(), products: z.array(z.string()) }),
    brand: z.object({ colors: z.array(z.string()), fonts: z.array(z.string()), logoUrl: z.string().nullable() }),
    folders: z.array(z.object({ slug: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/), name: z.string().max(60), description: z.string().max(300), restricted: z.boolean() })).min(8).max(10),
  });
  export type FolderProposal = z.infer<typeof folderProposalSchema>;
  export async function proposeFolders(
    input: { domain: string; displayName: string; hint: string | null; model: string },
    deps: { generateText: typeof generateText; readPage: (url: string) => Promise<WebPageResult>; providerOptions?: GatewayOptions; abortSignal?: AbortSignal },
  ): Promise<{ output: FolderProposal | undefined; pagesRead: number; usage: unknown; providerMetadata: unknown }>;
  // lib/onboarding/folder-template.ts
  export const GENERIC_FOLDERS: FolderProposal["folders"]; // direccion(r), finanzas(r), comercial, operacion, marketing, talento, tecnologia, proyectos
  export function normalizeProposal(p: FolderProposal): FolderProposal; // filtra slugs reservados (skills, skill, brain), deduplica, garantiza una restringida de dirección y una de finanzas, recorta a 10
  ```
  Sin búsqueda web: solo `readPage` con un contador y corte a 8, como `runResearch`. Si `found` es falso en la salida o el modelo no devuelve output, el caller decide (Task 4).

- [ ] **Step 1: Escribir los tests** con un `generateText` falso que devuelve `{ output, steps: [], usage: {} }`: (a) salida válida pasa el schema y `normalizeProposal` conserva 9 carpetas; (b) salida con `skills` y una repetida → quedan filtradas; (c) sin carpeta de finanzas restringida → `normalizeProposal` la agrega; (d) `readPage` se llama con `https://lagomarsino.com.ar` como primera URL y a la novena lectura devuelve `{ok:false, reason:"limite_de_paginas"}`; (e) `hint` presente aparece en el prompt; (f) `NoOutputGeneratedError` → `output: undefined`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/onboarding/propose-folders.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar** `proposeFolders` calcando `generateResearch` (`tools: { leer_pagina }`, `Output.object({ schema: folderProposalSchema })`, `stopWhen: stepCountIs(PROPOSE_MAX_PAGES + 2)`, `maxOutputTokens: 4_000`, `createStepSpend`/`attachSpend`), y `folder-template.ts`. Registrar el nodo.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/onboarding tests/workflows/registry.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding lib/workflows/registry.ts tests/onboarding
git commit -m "feat: nodo onboarding/propose-folders"
```

---

### Task 4: Correr el research de fondo y guardarlo

**Files:**
- Create: `lib/onboarding/research-run.ts`, `lib/onboarding/research-store.ts`
- Test: `tests/onboarding/research-run.test.ts`

**Interfaces:**
- Consumes: `proposeFolders`, `normalizeProposal`, `GENERIC_FOLDERS` (Task 3); `metered`, `createUsageRecorder` (`lib/workflows/usage.ts`); `createGatewayOptions` (`lib/workflows/gateway-options.ts`); `fetchPublicPage`, `resolveHost`.
- Produces:
  ```ts
  // research-store.ts
  export type ResearchRow = { status: "running" | "done" | "error"; hint: string | null; result: FolderProposal | null; error: string | null; updatedAt: string };
  export interface ResearchStore {
    start(tenantId: string, hint: string | null): Promise<void>;        // upsert status running, result null
    finish(tenantId: string, result: FolderProposal): Promise<void>;    // status done
    fail(tenantId: string, error: string): Promise<void>;               // status error
    read(tenantId: string): Promise<ResearchRow | null>;
  }
  export function createResearchStore(admin: SupabaseClient): ResearchStore;
  // research-run.ts
  export async function runFolderResearch(
    input: { tenantId: string; domain: string; displayName: string; hint: string | null; model: string },
    deps: { store: ResearchStore; propose: typeof proposeFolders; readPage: (url: string) => Promise<WebPageResult>; providerOptions?: GatewayOptions },
  ): Promise<void>;
  // start → propose → output?.found === false sin hint → finish con output igual (la pantalla muestra SinSitio); output undefined → fail("sin_salida"); excepción → fail(message). Nunca tira.
  export function folderResearchDeps(tenantId: string): Parameters<typeof runFolderResearch>[1]; // cableado real: admin client, metered(...) con node "onboarding/propose-folders", runId null, workflow null, gatewayOptions del tenant, modelo = default_model del tenant
  ```

- [ ] **Step 1: Escribir los tests** de `runFolderResearch` con store y `propose` falsos: (a) salida con `found: true` → `start` luego `finish` con la propuesta normalizada; (b) `found: false` y `hint: null` → `finish` con `found:false` (la pantalla pedirá el hint); (c) `found: false` y hint presente → `finish` con `folders = GENERIC_FOLDERS`; (d) `propose` tira → `fail` con el mensaje y la función resuelve sin tirar; (e) `output: undefined` → `fail("sin_salida")`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/onboarding/research-run.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar** los dos módulos. `folderResearchDeps` envuelve `propose` con `metered(..., { model: a => a.model, record: createUsageRecorder(admin), base: { tenantId, runId: null, workflow: null, node: "onboarding/propose-folders" } })`, igual que `agents/outreach/tools/research_account.ts:51-70`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/onboarding && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding tests/onboarding
git commit -m "feat: research de carpetas de fondo con onboarding_research"
```

---

### Task 5: Pasos 1 y 2 — `/empezar`, ruta de ingreso y creación de la empresa

**Files:**
- Create: `app/empezar/page.tsx`, `app/empezar/empresa/page.tsx`, `app/empezar/empresa/empresa-form.tsx`, `app/empezar/empresa/actions.ts`, `app/empezar/dominio-tomado/page.tsx`, `lib/tenants/signup-route.ts`, `lib/onboarding/steps.ts`
- Modify: `app/(auth)/login/actions.ts:25` (`canSignUpByDomain` → también `true` si el dominio no es público), `app/page.tsx` (con 0 membresías llama `signup_route()` y redirige), `app/(auth)/login/login-form.tsx` (acepta `mode?: "login" | "signup"` para los copys del `.pen` paso 1), `app/(auth)/login/page.tsx` (sin cambios de comportamiento)
- Test: `tests/auth/can-sign-up-by-domain.test.ts` (ampliar), `tests/tenants/signup-route.test.ts`, `tests/onboarding/empresa-actions.test.ts`, `tests/onboarding/steps.test.ts`

**Interfaces:**
- Consumes: `self_serve_create_tenant`, `signup_route` (Task 1); `folderResearchDeps`, `runFolderResearch` (Task 4); `emailDomain` (`lib/invitations/domain.ts`); `isPublicEmailDomain` (`lib/tenants/public-email-domains.ts`); `requestMagicLink`, `LoginForm`.
- Produces:
  ```ts
  // lib/tenants/signup-route.ts
  export type SignupRoute = "chat" | "empezar" | "dominio_tomado" | "sin_acceso";
  export async function signupRoute(supabase: { rpc(fn: "signup_route"): PromiseLike<{ data: unknown; error: unknown }> }): Promise<SignupRoute>; // error → "sin_acceso"
  export function signupRoutePath(route: SignupRoute, firstSlug: string | null): string; // chat → `/${slug}`, empezar → "/empezar/empresa", dominio_tomado → "/empezar/dominio-tomado", sin_acceso → "/sin-acceso"
  // lib/onboarding/steps.ts
  export type OnboardingStep = "carpetas" | "logo" | "acceso" | "equipo";
  export const STEP_ORDER: OnboardingStep[];
  export function stepPath(slug: string, step: OnboardingStep): string;  // `/empezar/${slug}/${step}`
  export function nextStep(step: OnboardingStep): OnboardingStep | null;
  // app/empezar/empresa/actions.ts
  export type CreateCompanyResult = { ok: true; slug: string } | { ok: false; code: "public_domain" | "domain_mismatch" | "domain_taken" | "login_method_unknown" | "invalid" | "brain_failed" | "generic"; message: string };
  export async function createCompany(formData: FormData): Promise<CreateCompanyResult>;
  // valida {displayName 1..80, domain minúsculas sin @ y no público} con zod; rpc self_serve_create_tenant con el cliente de sesión; traduce hint → code; después (admin client) crea nada del brain todavía (eso es el paso 3); after(() => runFolderResearch(...)) con el modelo default_model del tenant; redirige a stepPath(slug,"carpetas")
  ```
  `/empezar/page.tsx`: sin sesión muestra `LoginForm` con `mode="signup"`, `methods=["microsoft","google","email"]`, `next="/empezar"`; con sesión llama `signupRoute` y redirige con `signupRoutePath`. `/empezar/empresa/page.tsx`: exige sesión; si `signupRoute() !== "empezar"` redirige; precarga `domain = emailDomain(user.email)`.

- [ ] **Step 1: Escribir los tests**: `signup-route.test.ts` (mapeo de los 4 valores y error → sin_acceso; paths); `steps.test.ts` (`nextStep("equipo")` → null, `stepPath`); `can-sign-up-by-domain.test.ts` nuevos casos: `ana@nuevo.com` sin tenant abierto → `true`, `x@gmail.com` → `false`; `empresa-actions.test.ts` con `vi.mock("@/lib/supabase/server")`, `vi.mock("@/lib/supabase/admin")`, `vi.mock("next/server", { after })`, `vi.mock("@/lib/onboarding/research-run")`: (a) rpc ok → `{ok:true, slug}` y `runFolderResearch` encolado con `after`; (b) hint `domain_taken` → `code:"domain_taken"`; (c) dominio `gmail.com` no llega a la rpc y devuelve `public_domain`; (d) nombre vacío → `invalid`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/auth/can-sign-up-by-domain.test.ts tests/tenants/signup-route.test.ts tests/onboarding`
Expected: FAIL

- [ ] **Step 3: Implementar** páginas, formulario (copys del `.pen` "Alta / 02 / Empresa"), action, `signup-route.ts`, `steps.ts` y los cambios en `canSignUpByDomain` y `app/page.tsx`. La pantalla `dominio-tomado` es un server component estático con el copy del `.pen` y el botón "Entrar con otro correo" (cierra sesión, como `UserMenu`).

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/auth tests/tenants tests/onboarding && npm run typecheck`
Expected: PASS. Además `tests/server-actions-exports.test.ts` en verde.

- [ ] **Step 5: Commit**

```bash
git add app/empezar app/page.tsx "app/(auth)/login" lib/tenants/signup-route.ts lib/onboarding/steps.ts tests
git commit -m "feat: /empezar con cuenta, ruta de ingreso y creación de la empresa"
```

---

### Task 6: Paso 3 — confirmar carpetas: brain, permisos y página inicial

**Files:**
- Create: `lib/onboarding/folders-setup.ts`, `app/empezar/[slug]/carpetas/page.tsx`, `app/empezar/[slug]/carpetas/carpetas-form.tsx`, `app/empezar/[slug]/carpetas/actions.ts`
- Test: `tests/onboarding/folders-setup.test.ts`, `tests/onboarding/carpetas-actions.test.ts`

**Interfaces:**
- Consumes: `platform_bind_connection`, `brain_folders_from_config`, `platform_enable_brain_skills`, `brain_set_folder_description`, `brain_set_access_rule` (SQL existentes); `brainForTenant` (`lib/outreach/canon.ts`) y `brain.upsert(write, author)` con `author.kind = "import"`; `ResearchStore` (Task 4); `set_onboarding_step`; `validateFolderPath`, `RESERVED_TOP_FOLDERS` (`lib/brain/core/folders.ts`).
- Produces:
  ```ts
  // lib/onboarding/folders-setup.ts
  export interface ConfirmedFolder { slug: string; name: string; description: string; restricted: boolean }
  export interface FoldersSetupDeps {
    rpc(fn: string, args: Record<string, unknown>): Promise<{ error: { message: string; code?: string } | null }>;
    upsertPage(write: { slug: string; title: string; body: string; status: "borrador" }, author: BrainAuthor): Promise<void>; // ignora BrainConflict
  }
  export const ROOT_RULES_BODY: string; // "Cada página empieza con un párrafo que dice para qué sirve. …" (texto del builder, ≤ 12.000 chars)
  export async function setupBrainFolders(
    input: { tenantId: string; actorUserId: string; displayName: string; folders: ConfirmedFolder[]; companySummary: string | null },
    deps: FoldersSetupDeps,
  ): Promise<{ ok: true } | { ok: false; step: "bind" | "folders" | "skills" | "rules" | "page"; message: string }>;
  // orden: platform_bind_connection(p_actor, p_tenant, "brain", "wiki", [], { categories: folders.map(f=>f.slug), requiredFrontmatter: ["title","category","status","updated"], search: "fts" }, null)
  //        → brain_folders_from_config → brain_set_folder_description por carpeta → platform_enable_brain_skills
  //        → brain_set_access_rule(members, ninguno) por carpeta restringida
  //        → upsertPage 00-reglas (ROOT_RULES_BODY) → si companySummary: upsertPage `${primeraCarpetaDeEmpresaOLaPrimera}/que-sabemos` con el summary y el pie "Escrita por Central IA al crear la empresa. Corregila."
  // la "carpeta de empresa" es la primera cuyo slug contiene "empresa" o "direccion"; si no hay, folders[0]
  // app/empezar/[slug]/carpetas/actions.ts
  export async function readResearch(slug: string): Promise<ResearchRow | null>;              // para el polling del cliente cada 2 s
  export async function retryResearch(slug: string, hint: string): Promise<{ ok: boolean }>;  // guarda hint, after(runFolderResearch)
  export async function useGenericFolders(slug: string): Promise<{ ok: boolean }>;            // finish con GENERIC_FOLDERS
  export async function confirmFolders(slug: string, folders: ConfirmedFolder[]): Promise<{ ok: true } | { ok: false; message: string }>;
  // valida 1..20 carpetas, slugs únicos y válidos, ninguno reservado; exige tenant_admin y onboarding_step === "carpetas"; setupBrainFolders con admin client; set_onboarding_step("logo"); redirect a stepPath(slug,"logo")
  ```
  La página tiene tres estados según `ResearchRow`: `running` → "Investigando"; `done` con `found:false` y sin hint → "SinSitio"; `done` con carpetas → "Propuesta" (editable: renombrar, quitar, agregar, Abierta/Restringida); `error` → "SinSitio" con el mensaje de error como nota.

- [ ] **Step 1: Escribir los tests**: `folders-setup.test.ts` con `rpc` y `upsertPage` falsos que registran llamadas: (a) orden exacto de rpcs y args del bind (`categories` = slugs confirmados); (b) dos restringidas → dos `brain_set_access_rule` con `p_principal:"members"`, `p_level:"ninguno"`; (c) `00-reglas` y `direccion/que-sabemos` escritas con `author.kind === "import"`; (d) sin `companySummary` no escribe la segunda página; (e) error en `platform_enable_brain_skills` → `{ok:false, step:"skills"}`. `carpetas-actions.test.ts`: `confirmFolders` rechaza `skills` como slug, rechaza si `onboarding_step !== "carpetas"`, y con todo bien llama `set_onboarding_step` con `"logo"`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/onboarding`
Expected: FAIL

- [ ] **Step 3: Implementar** módulo, page, form (client, copys del `.pen` "Alta / 03 / …", polling de `readResearch` con `setInterval` 2 s mientras `running`) y actions.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/onboarding && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding/folders-setup.ts "app/empezar/[slug]/carpetas" tests/onboarding
git commit -m "feat: paso de carpetas del alta: brain, permisos y página inicial"
```

---

### Task 7: Pasos 4, 5 y 6 — logo, acceso y equipo; y funciones de perfil del tenant

**Files:**
- Modify: `supabase/migrations/20261029120000_self_serve_onboarding.sql` (agregar, misma migración si todavía no se aplicó en producción; si no, `20261030120000_tenant_profile_settings.sql`): `set_tenant_profile(p_tenant uuid, p_display_name text, p_brand jsonb) returns void`, `set_tenant_auth_methods(p_tenant uuid, p_methods text[]) returns void`, `set_ai_monthly_limit(p_tenant uuid, p_limit numeric) returns void`; las tres abren con `settings_actor`, validan como la consola (`display_name` 1..80, `brand` solo claves `primary`, `secondary`, `logo_url`; métodos ⊆ `{email,google,microsoft}` y ≥ 1), emiten `tenant.profile_updated` / `tenant.auth_methods_updated` / `budget.updated`, grant a `authenticated`.
- Modify: `supabase/tests/37_self_serve_onboarding.test.sql` (asserts de las tres funciones: admin ok, member 42501, métodos vacíos 23514)
- Create: `app/empezar/[slug]/logo/{page.tsx,logo-form.tsx,actions.ts}`, `app/empezar/[slug]/acceso/{page.tsx,acceso-form.tsx,actions.ts}`, `app/empezar/[slug]/equipo/{page.tsx,equipo-form.tsx,actions.ts}`, `app/[tenant]/settings/perfil-actions.ts`
- Test: `tests/onboarding/logo-actions.test.ts`, `tests/onboarding/acceso-actions.test.ts`, `tests/onboarding/equipo-actions.test.ts`, `tests/settings/perfil-actions.test.ts`

**Interfaces:**
- Consumes: `validateLogo`, `mergeBrand` (`lib/tenants/tenant-form.ts`); bucket `brand` con el cliente de sesión (RLS: tenant_admin, path `${slug}/…`); `inviteToTenant` (Task 8 lo extiende; acá se usa tal cual); `canInvite`, `PlanStore` (Task 2); `set_onboarding_step`; `actionAllowsLogin`.
- Produces:
  ```ts
  // app/[tenant]/settings/perfil-actions.ts  ("use server")
  export async function saveProfile(slug: string, input: { displayName: string; primary: string; secondary: string }): Promise<SettingsResult>;
  export async function saveLogo(slug: string, formData: FormData): Promise<SettingsResult>;     // sube `${slug}/logo-${Date.now()}.${ext}` y set_tenant_profile con brand.logo_url
  export async function saveAuthMethods(slug: string, methods: AuthMethod[]): Promise<SettingsResult>;
  export async function saveAiMonthlyLimit(slug: string, limitUsd: number | null): Promise<SettingsResult>;
  // app/empezar/[slug]/logo/actions.ts
  export async function uploadLogoStep(slug: string, formData: FormData): Promise<{ ok: true } | { ok: false; message: string }>; // saveLogo + set_onboarding_step("acceso") + redirect
  export async function skipLogoStep(slug: string): Promise<void>;                                                             // set_onboarding_step("acceso") + redirect
  // app/empezar/[slug]/acceso/actions.ts
  export async function saveAccessStep(slug: string, input: { methods: AuthMethod[]; restrictToDomain: boolean }): Promise<{ ok: true } | { ok: false; message: string }>;
  // restrictToDomain=false deja allowed_domains como está (la invitación externa se permite con el tilde "Permitir correo externo", como hoy); el radio "Todos los del dominio" no se manda (deshabilitado). set_onboarding_step("equipo")
  // app/empezar/[slug]/equipo/actions.ts
  export async function finishWithInvites(slug: string, invites: { email: string; role: InviteRole }[]): Promise<{ ok: true; failed: string[] } | { ok: false; message: string }>;
  // 0..2 invitaciones; cada una con inviteToTenant (origin = invitationOrigin); una que falla no frena; set_onboarding_step(null); redirect `/${slug}/chat`
  export async function finishWithoutInvites(slug: string): Promise<void>;
  ```
  Todas las actions de `/empezar/[slug]/*` exigen `tenant_admin` del slug y que `onboarding_step` sea el paso de esa ruta; si es otro, redirigen a `stepPath(slug, onboarding_step)`; si es `null`, a `/${slug}/chat`.

- [ ] **Step 1: Escribir los tests** (patrón de `tests/settings/actions.test.ts`: `state` mutable y `vi.mock` de server/admin): `perfil-actions` (rpc con los args esperados; `displayName` de 81 chars → `INVALIDO`; métodos vacíos → mensaje del hint `settings`); `logo-actions` (PNG 2 MB → `{ok:false}` sin subir; SVG 10 KB → upload a `lagomarsino/logo-…svg` y `set_tenant_profile` con `logo_url`; `skipLogoStep` → `set_onboarding_step("acceso")`); `acceso-actions` (métodos `["microsoft"]` → `set_tenant_auth_methods`; paso incorrecto → redirect al paso real); `equipo-actions` (dos correos → dos `inviteToTenant` con `role` y `invitedBy`; uno `mail_fallo` → `failed:[ese]` y sigue; 3 correos → `{ok:false}`; `finishWithoutInvites` → `set_onboarding_step(null)`).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm run db:test` (nuevos asserts) y `npm test -- tests/onboarding tests/settings/perfil-actions.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar** SQL, actions y las tres pantallas con los copys del `.pen` ("Alta / 04", "05", "06"); el contador "N de 3 lugares" se calcula con `tenant_counts.users + invitaciones del formulario`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm run db:test && npm test -- tests/onboarding tests/settings && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase "app/empezar/[slug]" "app/[tenant]/settings/perfil-actions.ts" tests
git commit -m "feat: pasos de logo, acceso y equipo del alta"
```

---

### Task 8: Tope de usuarios en la invitación

**Files:**
- Modify: `lib/invitations/invite.ts` (`InviteOutcome` + `{ kind: "limite"; reason: LimitReason }`; `inviteToTenant` recibe `plans?: PlanStore` y, si lo recibe, antes del insert llama `canInvite(await plans.tenantPlan(tenantId), await plans.counts(tenantId))` → outcome `limite`), `app/api/invitations/route.ts` (409 `{ error: "limite", reason }`), `app/[tenant]/settings/usuarios/invite-form.tsx` (409 con `reason` → abre `LimitDialog`), `app/plataforma/nueva/actions.ts` (pasa sin `plans`: el alta de plataforma no tiene tope)
- Create: `components/plan/limit-dialog.tsx`
- Test: `tests/invitations/invite.test.ts` (ampliar), `tests/invitations/route.test.ts` (ampliar), `tests/plan/limit-dialog.test.ts`

**Interfaces:**
- Consumes: `canInvite`, `limitMessage`, `LimitReason`, `PlanStore` (Task 2).
- Produces:
  ```ts
  // components/plan/limit-dialog.tsx (client)
  export function LimitDialog(props: { reason: LimitReason; open: boolean; onOpenChange(open: boolean): void; contactHref?: string }): JSX.Element;
  // título y cuerpo de limitMessage(reason); primario "Hablá con nosotros" → contactHref ?? "mailto:hola@innov.as?subject=Plan%20de%20Central%20IA"; secundario "Ahora no". Ícono por variante: users / sparkles / zap / triangle-alert (suspendida). Copys del .pen "Topes / Variantes".
  ```

- [ ] **Step 1: Escribir los tests**: `invite.test.ts`: con `plans` falso (free, 3 usuarios) → `{kind:"limite", reason:"limit:users"}` y no inserta; suspendida → `reason:"suspended:trial_vencido"`; sin `plans` → comportamiento actual. `route.test.ts`: outcome `limite` → 409 con `{error:"limite", reason:"limit:users"}`. `limit-dialog.test.ts` (render a string con `react-dom/server`): `limit:users` muestra "Tu equipo creció" y el mailto; `suspended:cancelado` muestra el aviso de suspensión.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/invitations tests/plan`
Expected: FAIL

- [ ] **Step 3: Implementar.** La ruta construye `createPlanStore(admin)` y lo pasa. La UI de usuarios, al 409, abre el diálogo.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/invitations tests/plan tests/settings && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/invitations app/api/invitations "app/[tenant]/settings/usuarios" app/plataforma/nueva/actions.ts components/plan tests
git commit -m "feat: tope de usuarios del plan Free al invitar"
```

---

### Task 9: Tope de skills en la publicación

**Files:**
- Modify: `lib/brain/core/skills/publish.ts` (`SkillFailure.code` + `"limite"` y campo `reason?: LimitReason`; `PublishDeps` + `plan(tenantId): Promise<TenantPlan | null>`; en `publishSkill` y `republishSkill`, si la página no está publicada hoy (`overview` sin `current.action === "publicar"` para ese slug), `canPublishSkill(plan, { publishedSkills: cantidad de filas con action publicar, users: 0, pendingInvitations: 0 })` → `{ok:false, code:"limite", reason}`), `lib/brain/adapters/skills.ts:61` (`publishDeps()` + `plan` con `createPlanStore(createAdminClient()).tenantPlan`), `app/[tenant]/brain/skill-actions.ts` (devuelve `reason` al cliente) y el componente que muestra el error de publicación (abre `LimitDialog`)
- Test: `tests/brain/skills-publish.test.ts` (ampliar)

**Interfaces:**
- Consumes: `canPublishSkill`, `TenantPlan` (Task 2); `LimitDialog` (Task 8).

- [ ] **Step 1: Escribir los tests**: free con 5 publicadas y una sexta en borrador → `{ok:false, code:"limite", reason:"limit:skills"}` y `store.publish` no se llama; free con 5 publicadas y `republishSkill` de una ya publicada → ok (no suma); pago con 40 → ok; `plan` devuelve null → ok.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/brain/skills-publish.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/brain && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/brain "app/[tenant]/brain" tests/brain
git commit -m "feat: tope de skills publicadas del plan Free"
```

---

### Task 10: Redirección a medias, cabecera con "Invitá a un colaborador" y avisos

**Files:**
- Create: `components/plan/invite-dialog.tsx`, `components/plan/tenant-banner.tsx`
- Modify: `app/[tenant]/layout.tsx` (lee `plan, suspended_reason, trial_ends_at, onboarding_step` del tenant: si `onboarding_step` no es null y el rol es `tenant_admin` → `redirect(stepPath(slug, step))`; entre la nav y `UserMenu`, `<InviteDialog tenantId slug />` solo para `tenant_admin`; debajo del header `<TenantBanner … />`), `lib/tenants/resolve.ts` o donde `resolveTenantAccess` arma `tenant` (agregar esos cuatro campos al select y al tipo)
- Test: `tests/tenants/resolve.test.ts` (ampliar si existe; si no, `tests/tenants/tenant-banner.test.ts`), `tests/plan/tenant-banner.test.ts`, `tests/onboarding/layout-redirect.test.ts`

**Interfaces:**
- Consumes: `stepPath` (Task 5); `trialWarning`, `suspendedReasonOf`, `limitMessage` (Task 2); `InviteForm` (`app/[tenant]/settings/usuarios/invite-form.tsx`); `LimitDialog` (Task 8).
- Produces:
  ```ts
  export function InviteDialog(props: { tenantId: string; slug: string }): JSX.Element;  // botón outline "Invitá a un colaborador" (lucide user-plus) que abre un Dialog de shadcn con <InviteForm tenantId/>; al 409 muestra LimitDialog
  export function TenantBanner(props: { plan: Plan; suspendedReason: SuspendedReason | null; trialEndsAt: string | null; isAdmin: boolean; now?: Date }): JSX.Element | null;
  // suspendida → franja $warn con el copy del .pen "Aviso de suspensión" (texto según motivo) y, si isAdmin, botón "Hablá con nosotros"; free con trialWarning → franja gris "El plan gratis termina el <d de mes>" y link "Ver mi plan" a /settings/plan; si no, null
  ```

- [ ] **Step 1: Escribir los tests**: `tenant-banner.test.ts` (render a string): suspendida `trial_vencido` → contiene "Se terminaron los 3 meses"; free con `trial_ends_at` en 10 días → contiene "termina el" y la fecha; enterprise → `null`; miembro suspendido → sin botón. `layout-redirect.test.ts`: con `onboarding_step:"logo"` y rol admin, el layout llama `redirect("/empezar/lagomarsino/logo")`; con `null` no redirige.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/plan tests/onboarding/layout-redirect.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/plan tests/onboarding tests/tenants && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/plan "app/[tenant]/layout.tsx" lib/tenants tests
git commit -m "feat: invitar desde la cabecera, avisos de plan y vuelta al alta a medias"
```

---

### Task 11: Crédito de IA en el chat y en el runner

**Files:**
- Modify: `app/[tenant]/chat/page.tsx` (calcula `aiAllowance` con `createPlanStore(createAdminClient())` y la zona horaria del tenant; pasa `aiBlock: LimitReason | null` a `ChatClient`), `app/[tenant]/chat/chat-client.tsx` (con `aiBlock`: `Composer blocked`, `LimitDialog` abierto al intentar enviar, y el `<p role="alert">` del hilo con `limitMessage(reason).title`), `app/[tenant]/chat/actions.ts:35` (`createConversation` devuelve `null` si `aiAllowance` no es ok), `agents/asistente/hooks/allowance.ts` (nuevo hook en `turn.started`: si `aiAllowance` no es ok, tira `new Error("ai_allowance:" + reason)`; el cliente mapea ese error a `LimitDialog`), `agents/asistente/agent.ts` (registra el hook), `lib/workflows/runner.ts:148` (antes de `budgetStatus`, `aiAllowance`; si no es ok, `close("budget_exhausted", "presupuesto", reason)` y no sigue; `budgetStatus` queda solo para `enterprise`)
- Test: `tests/chat/chat-page-allowance.test.ts`, `tests/agents/allowance-hook.test.ts`, `tests/workflows/runner.test.ts` (ampliar)

**Interfaces:**
- Consumes: `aiAllowance`, `createPlanStore` (Task 2); `LimitDialog` (Task 8).
- Produces: `export function allowanceHook(): Hook` en `agents/asistente/hooks/allowance.ts`, con la lógica pura en `lib/agents/allowance-check.ts`: `export async function checkTurnAllowance(input: { tenantId: string | null; timezone: string }, deps: { allowance: typeof aiAllowance; store: PlanStore; now: () => Date }): Promise<void>` (sin tenant no hace nada; tira con el prefijo `ai_allowance:`).

- [ ] **Step 1: Escribir los tests**: hook: free con crédito agotado → tira `Error("ai_allowance:limit:ai_credit")`; ok → resuelve; sin tenant → resuelve. Runner: tenant free con gasto 5 → corrida cerrada `budget_exhausted` sin tocar ítems; tenant enterprise sigue usando `budgetStatus` (caso existente en verde). Chat page: `aiBlock` llega al cliente cuando el store dice agotado.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/chat tests/agents tests/workflows/runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar.** `TOOL_LABELS` no cambia (no hay tool nueva). El hook sigue el patrón de `agents/asistente/hooks/usage.ts` pero este sí tira a propósito (es el corte); documentar en el comentario de cabecera que es la excepción a "observe-only".

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test && npm run typecheck`
Expected: PASS completo.

- [ ] **Step 5: Commit**

```bash
git add "app/[tenant]/chat" agents/asistente lib/agents lib/workflows/runner.ts tests
git commit -m "feat: crédito de IA del plan Free corta el chat y el runner"
```

---

### Task 12: Vencimiento del trial (schedule diario)

**Files:**
- Create: `lib/plans/trial.ts`, `agents/outreach/schedules/trial-expiry.ts`
- Test: `tests/plans/trial.test.ts`, `tests/outreach/schedules/trial-expiry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/plans/trial.ts
  export interface TrialStore {
    listExpired(now: Date, limit: number): Promise<{ id: string; slug: string }[]>; // plan='free', suspended_reason is null, trial_ends_at < now
    suspend(tenantId: string, reason: "trial_vencido"): Promise<void>;             // update suspended_reason + insert events tenant.suspended {reason}
  }
  export function createTrialStore(admin: SupabaseClient): TrialStore;
  export async function expireTrials(deps: { store: TrialStore; now: () => Date }, limit = 100): Promise<{ checked: number; suspended: number }>; // try/catch por fila
  ```
  Schedule: `defineSchedule({ cron: "15 6 * * *", async run() { const r = await expireTrials({ store: createTrialStore(createAdminClient()), now: () => new Date() }); if (r.checked > 0) console.log(`trial-expiry: ${r.checked} revisados, ${r.suspended} suspendidos`); } })`, imports relativos, sin `@/` ni `next/*`.

- [ ] **Step 1: Escribir los tests**: `trial.test.ts` con store falso: dos vencidas → dos `suspend`; una que tira → la otra igual se suspende y `suspended:1`; ninguna → `{0,0}`. `trial-expiry.test.ts` como `domain-sweep.test.ts`: regex del cron, sin `from "@/`, sin `from "next`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/plans/trial.test.ts tests/outreach/schedules/trial-expiry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/plans tests/outreach/schedules && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/plans/trial.ts agents/outreach/schedules/trial-expiry.ts tests
git commit -m "feat: schedule que vence el plan Free a los 3 meses"
```

---

### Task 13: Pestaña Plan y edición de perfil en Configuración

**Files:**
- Create: `app/[tenant]/settings/plan/page.tsx`, `app/[tenant]/settings/plan/ai-limit-form.tsx`, `app/[tenant]/settings/perfil/page.tsx`, `app/[tenant]/settings/perfil/perfil-form.tsx`
- Modify: `app/[tenant]/settings/page.tsx` (links "Plan →" y "Perfil →" junto a "Usuarios →" y "Gasto →"; la sección "Ingreso" oculta "Todos los del dominio" con la insignia "Disponible pronto" cuando `plan !== "enterprise"`), `app/[tenant]/settings/actions.ts` (`updateSignupMode` rechaza `open=true` si `plan !== "enterprise"`)
- Test: `tests/settings/plan-page.test.ts`, `tests/settings/signup-mode.test.ts` (ampliar), `tests/settings/perfil-page.test.ts`

**Interfaces:**
- Consumes: `PLAN_LIMITS`, `trialWarning`, `createPlanStore` (Task 2); `saveProfile`, `saveLogo`, `saveAuthMethods`, `saveAiMonthlyLimit` (Task 7); `tenant_counts`.
- Plan page muestra: plan actual (Free / Pago / Enterprise), fila por tope "Usuarios 2 de 3", "Skills publicadas 1 de 5", "IA este mes USD 1,20 de 5", fecha de fin del trial, y el botón "Hablá con nosotros" (mailto) para Free; Pago muestra `ai-limit-form` (tope mensual opcional); Enterprise muestra solo el gasto y el link a Gasto.

- [ ] **Step 1: Escribir los tests** (patrón `tests/settings/gasto-page.test.ts`): free con counts `{users:2, publishedSkills:1}` y gasto 1.2 → el HTML contiene "2 de 3", "1 de 5" y "USD 1,20 de 5"; enterprise → no contiene "de 3"; `updateSignupMode(open=true)` en free → `{ok:false}` con mensaje "Disponible pronto…"; perfil: `saveProfile` con el form.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/settings`
Expected: FAIL

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- tests/settings && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/[tenant]/settings" tests/settings
git commit -m "feat: pestaña Plan y perfil de la empresa en Configuración"
```

---

### Task 14: Documentación, roadmap y verificación completa

**Files:**
- Create: `docs/dominios/onboarding.md` (rutas `/empezar/*`, tabla `onboarding_research`, nodo `onboarding/propose-folders`, schedule `trial-expiry`, columnas nuevas de `tenants`, funciones SQL, topes y motivos)
- Modify: `docs/dominios/tenants.md` o la página que describa `tenants` (columnas `plan`, `trial_ends_at`, `suspended_reason`, `onboarding_step`, `onboarding_completed_at`, `ai_monthly_limit_usd`), `docs/arquitectura/identidad-y-acceso.md` (ruta de ingreso `signup_route`, correo de trabajo obligatorio), `docs/decisiones/README.md` (fila `| 2026-10-22 | 27 | [spec](...) | [plan](...) | en curso | onboarding, tenants |`), `docs/producto/roadmap.md` (sección "Etapa 27 · Onboarding self-serve y planes — `[~]`" con las cuatro entregas y el criterio "Terminado cuando" de la spec §5), `docs/README.md` si indexa dominios

- [ ] **Step 1: Correr `npm run docs:check` y leer qué falta**

Run: `npm run docs:check`
Expected: FAIL listando rutas, tabla, nodo, schedule y spec sin fila.

- [ ] **Step 2: Escribir las páginas y filas** hasta que el test quede en verde. Sin exclusiones en `docs/_meta/cobertura.ts` salvo con motivo real.

- [ ] **Step 3: Verificación completa**

Run: `npm run typecheck && npm test && npm run docs:check && npm run lint:fix && git status`
Expected: todo en verde; revertir los 4 archivos ajenos que biome reformatea antes del commit.

- [ ] **Step 4: Prueba manual contra la base local** (Docker abierto, `npm run db:reset`, `npm run dev`): crear una empresa desde `/empezar` con un correo de trabajo de prueba (otro dominio que `innov.as`), confirmar carpetas, ver `/<slug>/chat`, invitar a dos, intentar la tercera invitación y ver el diálogo "Tu equipo creció". Anotar en el PR qué se probó.

- [ ] **Step 5: Commit y PR**

```bash
git add docs
git commit -m "docs: etapa 27.1, alta self-serve"
```

Abrir el PR con `/ship` contra `main`; agregar la fila en `docs/decisiones/prs.md` con el número que devuelve `gh pr create`. Orden de deploy en producción: `supabase migration list` → confirmar que solo la 27.1 está pendiente → `db push` → código. Después del deploy, correr el criterio de cierre de la spec §5 con una persona ajena a INNOV.AS.

---

## Self-review

- **Cobertura de la spec §3–§5:** base (T1), topes y crédito (T2, T8, T9, T11), research (T3, T4), pasos 1–6 (T5, T6, T7), P17 (T5), vuelta a medias (T10), invitar desde el chat (T10), trial y suspensión (T1, T12, T10), configuración y pestaña Plan (T7, T13), docs (T14). Fuera: el aviso "Estamos armando tu brain" del chat, que es de la 27.3.
- **Tipos consistentes:** `LimitReason`, `TenantPlan`, `TenantCounts`, `PlanStore` definidos en T2 y usados con ese nombre en T8–T13; `ConfirmedFolder` y `FolderProposal["folders"]` comparten forma (`slug, name, description, restricted`); `OnboardingStep` y `set_onboarding_step` aceptan los mismos cuatro valores más null.
- **Review Focus:** 1 → T1 (`domain_taken` en pgTAP) y T5 (`code:"domain_taken"`); 2 → T1 (`Mati@Lagomarsino.com.ar`); 3 → T10; 4 → T4 (`fail`) y T6 (estado `error` → SinSitio); 5 → T2 (enterprise en `aiAllowance`), T12 (`listExpired` solo free), T13 (enterprise sin "de 3").
- **Proporción:** el plan fija firmas, valores y tests; no transcribe cuerpos.
