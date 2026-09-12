---
title: INNOV.AS Agents Platform — Roadmap de etapas (tracking)
fuente: docs/innovas-agents-kickoff.md
estado: v1
fecha: 2026-09-11
---

# Roadmap de etapas

Este documento es el **tracker de ejecución** del kickoff (`docs/innovas-agents-kickoff.md`). Cada etapa de acá abajo es la misma etapa de la §8 del kickoff, pero partida en tareas chequeables para poder:

- Abrir una sesión nueva de Claude Code por etapa, con el modelo que corresponde (ver `Modelo Claude Code` de cada etapa).
- Tildar tareas a medida que se cierran, sin depender de tener toda la conversación anterior en contexto.
- Saber en qué quedó todo aunque hayan pasado varias sesiones o cambiado de modelo en el medio.

## Cómo usar este documento

1. **Antes de arrancar una etapa:** abrí sesión nueva, corré `/context-restore` si venís de una etapa anterior relacionada, y decile a Claude "trabajemos la Etapa N de `docs/01-roadmap-etapas.md`".
2. **Modelo de esa sesión:** el indicado en `Modelo Claude Code` de la etapa (lógica completa en kickoff §3a). Si la etapa mezcla spec y wiring, son **dos sesiones separadas** (spec con Opus, implementación con Sonnet en sesión nueva) — está anotado etapa por etapa.
3. **Proceso dentro de la etapa:** `superpowers:brainstorming` → spec en `docs/superpowers/specs/NN-<etapa>.md` → `superpowers:writing-plans` → plan en `docs/superpowers/plans/NN-<etapa>.md` → TDD/implementación → `superpowers:verification-before-completion` → `/ship`.
4. **Al cerrar la sesión:** tildar las tareas hechas acá, actualizar el `Estado` de la etapa, y correr `/context-save`.
5. **No saltear el criterio "Terminado cuando"** de cada etapa: es la prueba de que sirve para probar, no una lista de archivos creados.

Convención de estado por etapa: `[ ]` no arrancada · `[~]` en curso · `[x]` cerrada (spec + plan + PR mergeado + criterio cumplido).

---

## Etapa 0 · Bootstrap y spike de riesgo — `[x]`

**Modelo Claude Code:** Opus 5, effort `high` (subir a Fable 5.1 solo si el spike de Gmail no destraba en dos intentos).
**Modelo runtime:** `anthropic/claude-sonnet-5` (tool de prueba).
**Spec:** `docs/superpowers/specs/00-bootstrap.md` (aprobada) · **Plan:** `docs/superpowers/plans/00-bootstrap.md`

Objetivo: probar en un día lo único que puede tumbar el diseño — eve dentro de Next.js, login Supabase, y un mail enviado desde Gmail con aprobación, **corriendo en preview de Vercel**.

Decisiones del brainstorming (detalle en la spec): el token de Gmail sale de **Supabase Auth**, no de Vercel Connect (la doc de eve no documenta Google/Gmail en Connect); el criterio se cumple en **preview**, no en localhost; el refresh token se persiste en una tabla `google_tokens` inalcanzable salvo por `service_role`; `eve` se pinnea en **0.54.2** exacto.

Tareas:

- [x] **Accesos primero** (bloquea todo lo demás): proyecto en Google Cloud + client OAuth Web application + pantalla de consentimiento en modo testing con tu mail como test user + redirect URI al callback de Supabase.
- [x] Proyecto Supabase `innovas-agents` con provider Google configurado con ese client.
- [x] Proyecto Vercel linkeado al repo de GitHub, con Supabase enchufado desde el Marketplace (`vercel link && vercel env pull .env.local`).
- [x] Verificar **Node 24+** (lo exige eve).
- [x] Scaffold Next.js 15 App Router (`create-next-app` con ts/app/tailwind) y commit inicial.
- [x] Instalar `eve@0.54.2` **exacto, sin caret**, más `ai`, `zod`, `@supabase/supabase-js`, `@supabase/ssr`.
- [x] Instalar y configurar Biome + Vitest.
- [x] Copiar `CLAUDE.md`, `.claude/settings.json`, `.claude/launch.json`, `.claude/hooks/check-gstack.sh` (contenido en kickoff §7).
- [x] `npx eve@latest init .` y mover `agent/` → `agents/outreach/` (el init genera `agent/` en singular, con `instructions.md`, y `evals/` al lado).
- [x] `next.config.ts` con `withEve(nextConfig, { agents: { outreach: "./agents/outreach" } })`.
- [x] `agents/outreach/agent.ts` con `model: "anthropic/claude-sonnet-5"` (obligatorio si el archivo existe).
- [x] Health en local: `curl localhost:3000/eve/agents/outreach/eve/v1/health` devuelve `{ ok: true, status: "ready" }`. **Ojo:** `npm run dev` ya bootea el dev server de eve; **no** correr `npx eve dev` aparte.
- [x] Migración `google_tokens` con RLS habilitada sin políticas + `revoke` a `anon` y `authenticated`.
- [x] Login con Google por Supabase pidiendo `gmail.send` y `gmail.readonly`, con `access_type=offline` y `prompt=consent`.
- [x] `app/auth/callback/route.ts`: `exchangeCodeForSession` y upsert del `provider_refresh_token`.
- [x] `lib/auth/verifyCaller`: sesión Supabase → `{ userId, email }` o `null`.
- [x] `agents/outreach/channels/eve.ts` con el auth walk y `localDev()` **condicionado por `VERCEL_ENV`** (si queda activo en un deploy, la puerta queda abierta a internet).
- [x] `lib/gmail/mime.ts` con TDD: headers, subject con tildes y eñe en RFC 2047, base64url sin padding.
- [x] `lib/gmail/send.ts`: refresh token → access token → API de Gmail (`users/me`).
- [x] `agents/outreach/tools/send_email.ts` con `approval: always()` y sin campo de credencial en el `inputSchema`.
- [x] Chat web mínimo con `useEveAgent({ agent: "outreach" })` que muestre y resuelva la aprobación (leer la doc local de eve antes de escribirlo).
- [x] Test de rechazo sin cookie contra `/info`, **no** contra `/health` (que es público por diseño).
- [x] Deploy a preview y correr el flujo completo ahí.
- [x] **Prueba de fuego:** un mail real sale de tu Gmail después de aprobarlo en el chat del preview, confirmado contra el evento `input.resolved`.
- [x] `/ship` del PR de bootstrap + `/context-save`. (Nota: el spike se trabajó directo sobre `main` y quedó sincronizado con `origin/main`, sin PR separado — la revisión final de branch se hizo igual sobre los 13 commits antes de cerrar.)

**Terminado cuando:** un mail real sale de tu Gmail después de aprobarlo en el chat web del preview de Vercel. ✅ Cumplido el 2026-09-12: mail real enviado y recibido tras aprobar en el chat del deploy de Vercel; rechazo verificado sin envío; `localDev()` confirmado ausente en el deploy.

---

## Etapa 1 · Esqueleto multi-tenant — `[ ]`

**Modelo Claude Code:** Opus 5, effort `high` para spec + políticas RLS. Sesión nueva con Sonnet 5, effort `medium`, para migraciones/seed/tipos/tests.
**Modelo runtime:** n/a.
**Spec/Plan:** `docs/superpowers/specs/01-multi-tenant.md` · `docs/superpowers/plans/01-multi-tenant.md`

Tareas:

- [ ] (Opus) Spec de RLS y del modelo de datos de kickoff §5, con políticas por `tenant_id` vía `memberships`.
- [ ] (Sonnet, sesión nueva) Migraciones de `tenants`, `memberships`, `executors`, `tenant_connections`, `config_values`, `accounts`, `contacts`, `events`, `queue_items`, `runs`.
- [ ] `seed.sql` con tenant `innovas`, roles y enums (`platform_admin`, `tenant_admin`, `tenant_member`).
- [ ] `lib/auth/verifyCaller`: sesión Supabase → estampa `tenantId` y rol en la sesión eve.
- [ ] `lib/tenants`: carga `tenant.json` + `config_values` en capacidades dinámicas.
- [ ] `agent.ts` e `instructions.ts` con `defineDynamic` (modelo/instrucciones por tenant).
- [ ] Chat web con selector de modelo, estampado en la sesión.
- [ ] Tests de RLS en `supabase/tests/` (incluye caso de fuga entre tenants).
- [ ] **Hallazgo eve:** `queue_items.request_id` en lugar de `approval_call_id` — la pausa se resuelve por `requestId`, no por `callId`.
- [ ] **Hallazgo eve:** validar a mano el ownership de sesión (que un tenant no continúe ni streamee la sesión de otro). El auth de ruta de eve **no** lo hace.
- [ ] **Hallazgo eve:** estampar `tenantId` en `attributes` del auth; se lee con `ctx.session.auth.current?.attributes`.
- [ ] `runs` con `status` (running / ok / failed / cancelled) y `error`, además de lo que ya pide el kickoff §5. Sin estas dos columnas no hay dashboard de ejecuciones posible.
- [ ] **Cablear quién escribe `runs`**: crear la fila al abrir la sesión y cerrarla con status, `finished_at` y `error`, desde `agent/hooks/` o `instrumentation.ts` de eve. Hoy ninguna tool del kickoff la escribe, así que la tabla quedaría vacía.
- [ ] Definir visibilidad por rol: `cost_usd` es costo interno y lo ve solo `platform_admin`. La RLS por `tenant_id` no alcanza porque esto es visibilidad por columna, no por fila.
- [ ] **Enmienda 2026-09-12 (D5):** `conversations` (`tenant_id`, `user_id`, `agent`, `eve_session_id`, `title`, `last_message_at`) para hilos múltiples por usuario y ownership de sesión; `tenant_agents` (`tenant_id`, `agent`, `enabled`, override de modelo, cupos, `config` jsonb); `tenants.self_signup_by_domain` default `false`; `tenants.brand` (`primary`, `secondary`, `logo_url`). `tenant.json` deja de llevar `default_model` y conexiones.
- [ ] **Enmienda 2026-09-12 (D4):** alta de usuarios solo por invitación por mail (magic link de Supabase); `allowed_domains` valida al invitar, no es puerta. Providers: Google + magic link; Microsoft cuando un cliente lo pida. Sin contraseñas.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** dos usuarios de tenants distintos no ven filas ajenas (test automatizado), y el selector cambia el modelo de la sesión sin deploy.

---

## Etapa 2 · Conexiones del tenant `innovas` — `[ ]`

**Modelo Claude Code:** Sonnet 5, effort `high` (Opus solo si el OAuth de HubSpot vía Vercel Connect necesita diseño).
**Modelo runtime:** `anthropic/claude-haiku-4-5` para probar conexiones desde el chat.
**Spec/Plan:** `docs/superpowers/specs/02-conexiones-innovas.md` · `docs/superpowers/plans/02-conexiones-innovas.md`

Tareas:

- [ ] `connections/crm.ts` dinámica: HubSpot MCP (`mcp.hubspot.com`) para `innovas`, `null` para tenants sin CRM.
- [ ] `connections/brain.ts` con la key del tenant (`innovas-brains-mcp`, `x-api-key`).
- [ ] `connections/coldiq.ts`.
- [ ] `connections/places.ts` (Google Places, OpenAPI).
- [ ] `connections/gmail.ts` con `connect("<uid vercel connect>")`, `principalType: user`.
- [ ] Crear propiedades custom de outreach en HubSpot (`contact_key`, `outreach_segmento`, `outreach_canal`, `outreach_hook`, `outreach_status`, `outreach_owner`, `outreach_fecha_msg1`, `outreach_fecha_respuesta`).
- [ ] `tenant_connections` como fuente de URLs y `secret_ref` de cada conexión.
- [ ] **Enmienda 2026-09-12 (D2, D3):** catálogo de conectores por capacidad (`lib/connectors/catalog.ts`: `crm`, `leads`, `enrichment`, `brain`, `mail`) con binding por tenant en `tenant_connections`; llaves de API por tenant en **Supabase Vault** (`secret_ref` = id en Vault), cargadas write-only desde el dashboard por Innovas al inicio; OAuth por Vercel Connect donde exista el proveedor, `defineInteractiveAuthorization` donde no. En env vars de Vercel solo secretos de plataforma. Decidir brain como conexión MCP, memory slot o ambos.
- [ ] **Deuda de Etapa 0:** absorber `google_tokens` en `executors` y mover el refresh token a Supabase Vault.
- [ ] **Deuda de Etapa 0:** verificar la app de Google (en modo testing los refresh tokens caducan a los 7 días) o migrar Gmail a Vercel Connect.
- [ ] Nota: `connect()` exige un principal de tipo user en la sesión, ya estampado desde Etapa 0.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** desde el chat, `crm__search_contacts` y `brain__brain_search` responden para `innovas`, y un tenant de prueba sin CRM no expone la tool.

---

## Etapa 3 · Agente de outreach v1 — `[ ]`

**Modelo Claude Code:** Opus 5, effort `high` para `instructions.ts`, gate de estilo y evals. Sesión nueva con Sonnet 5, effort `high`, para tools/subagente/wiring.
**Modelo runtime:** chat `anthropic/claude-sonnet-5` · `researcher` `anthropic/claude-haiku-4-5` · primer toque en frío `anthropic/claude-opus-5`.
**Spec/Plan:** `docs/superpowers/specs/03-agente-outreach-v1.md` · `docs/superpowers/plans/03-agente-outreach-v1.md`

- [ ] Incorporar el plugin `innovas-outreach` cuando esté disponible; sus skills alimentan `tenants/innovas/skills/`.
- [ ] (Opus) `instructions.ts`: constitución con cinco frenos, cola para frío, claim por persona.
- [ ] `tenants/innovas/skills/`: ICP, redacción, hooks, objeciones (vía `sync-brain`).
- [ ] `tools/research_account.ts` (delega en `researcher`, guarda en `accounts`).
- [ ] `tools/draft_message.ts` (redacción con hook + gate de estilo).
- [ ] `tools/queue_touch.ts` (crea `queue_item` pending).
- [ ] `tools/send_email.ts` con `approval: always()`.
- [ ] `tools/crm_upsert_contact.ts` con `approval: once()`.
- [ ] `tools/log_event.ts` (append a `events`).
- [ ] `tools/read_replies.ts`.
- [ ] `lib/outreach`: `contact_key`, dedup y gate de estilo, con TDD.
- [ ] Subagente `researcher`.
- [ ] Evals del gate de estilo y del claim por persona.
- [ ] **Piloto real:** 5 contactos — CSV → research → redacción → cola → aprobación → envío → `events` + atribución en HubSpot.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** la corrida piloto de 5 contactos reales cierra el flujo completo con evals en verde.

---

## Etapa 4 · Dashboard — `[ ]`

**Modelo Claude Code:** Sonnet 5, effort `medium`. `/design-review` al final, también con Sonnet.
**Modelo runtime:** n/a.
**Spec/Plan:** `docs/superpowers/specs/04-dashboard.md` · `docs/superpowers/plans/04-dashboard.md`

- [ ] **Enmienda 2026-09-12 (D6), antes de la primera pantalla:** design system sobre Tailwind + shadcn/ui, un solo set de componentes; marca por tenant (`tenants.brand`: primario, secundario, logo en Storage) aplicada como CSS variables de shadcn en `app/[tenant]/layout.tsx`, foreground derivado por contraste. Innovas usa su propia marca como un tenant más.
- [ ] `/settings/conexiones`: carga write-only de llaves a Vault por `platform_admin`; el `tenant_admin` ve qué está conectado. Autoservicio del tenant cuando haya más de 5 clientes.
- [ ] `/cola`: aprobar, editar, rechazar (resuelve la pausa de eve).
- [ ] `/pipeline`.
- [ ] `/contactos`.
- [ ] `/cuentas`.
- [ ] `/metricas` (por hook, segmento, canal, ejecutor).
- [ ] `/settings` (modelo default, ejecutores, cupos, conexiones del tenant).
- [ ] Realtime en `/cola` y `/pipeline`.
- [ ] `/qa` en desktop y mobile.
- [ ] `/design-review`.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** `/qa` pasa en desktop y mobile, y una aprobación desde `/cola` dispara el envío igual que desde el chat.

---

## Etapa 5 · Escucha, follow-ups y fuentes — `[ ]`

**Modelo Claude Code:** Sonnet 5, effort `high` (Opus para debugging de Cron en Vercel si hace falta).
**Modelo runtime:** `morning-sweep` y clasificación en `anthropic/claude-haiku-4-5` · follow-ups en `anthropic/claude-sonnet-5`.
**Spec/Plan:** `docs/superpowers/specs/05-escucha-followups.md` · `docs/superpowers/plans/05-escucha-followups.md`

- [ ] **Hallazgo eve (leer antes de diseñar):** los schedules son root-only y corren con el principal de la app (`eve:app`, tipo runtime) — no llevan `tenantId` ni pueden parkear esperando aprobación en modo markdown. Hay que usar la forma `run` despachando por un canal autenticado como usuario.
- [ ] `schedules/morning-sweep.ts` iterando tenants activos.
- [ ] `schedules/followups.ts` iterando tenants activos.
- [ ] `read_replies` con clasificación de respuestas.
- [ ] Flujo de carga desde el chat con ColdIQ y Places.
- [ ] `sync-brain` corriendo en CI.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** una respuesta real en tu Gmail mueve el contacto a `respondio` sin intervención, y el follow-up vencido aparece en la cola a la mañana.

---

## Etapa 6 · Canal MCP (Claude / ChatGPT) — `[ ]`

**Modelo Claude Code:** Opus 5, effort `high` (es auth: `oauthResource` sobre Supabase como emisor OAuth 2.1).
**Modelo runtime:** el del tenant.
**Spec/Plan:** `docs/superpowers/specs/06-canal-mcp.md` · `docs/superpowers/plans/06-canal-mcp.md`

- [ ] Supabase Auth como servidor OAuth 2.1 con registro dinámico de clientes.
- [ ] `channels/mcp.ts` con `oauthResource(verifyToken, { issuer, resource, scopes })`.
- [ ] Docs de conexión (Claude Code y claude.ai).
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** conectás el agente desde Claude Code y desde claude.ai, pedís "armá la cola de hoy" y el trabajo corre durable en Vercel.

---

## Etapa 7 · Segundo tenant — `[ ]`

**Modelo Claude Code:** Sonnet 5, effort `medium`. Si esta etapa necesita Opus, la plataforma no está bien abstraída → volver a Etapa 1.
**Modelo runtime:** el que defina el tenant.
**Spec/Plan:** `docs/superpowers/specs/07-segundo-tenant.md` · `docs/superpowers/plans/07-segundo-tenant.md`

- [ ] `tenants/<cliente>/tenant.json` + skills del nuevo tenant.
- [ ] Conexión CRM distinta (Tokko, planilla o ninguna).
- [ ] Alta de usuarios del cliente con rol `tenant_member`.
- [ ] Medir horas de esta etapa contra la Etapa 3 (referencia de cuánto cuesta sumar un tenant).
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** el segundo tenant corre el piloto de 5 contactos sin tocar `agents/` ni `lib/`.

---

## Etapa 8 · Chat SDK — `[ ]`

**Modelo Claude Code:** Sonnet 5, effort `medium`.
**Modelo runtime:** el del tenant.
**Spec/Plan:** `docs/superpowers/specs/08-chat-sdk.md` · `docs/superpowers/plans/08-chat-sdk.md`

- [ ] `channels/slack.ts` o WhatsApp Cloud API vía `chatSdkChannel`.
- [ ] Aprobaciones como cards con botones.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** una aprobación desde Slack o WhatsApp resuelve la misma pausa que el dashboard.

---

## Etapa 9 · Observabilidad por cliente — `[ ]`

**Modelo Claude Code:** Sonnet 5, effort `medium`. UI sobre esquema cerrado, igual que la Etapa 4.
**Modelo runtime:** n/a.
**Spec/Plan:** `docs/superpowers/specs/09-observabilidad.md` · `docs/superpowers/plans/09-observabilidad.md`

No está en el kickoff original: sale de la pregunta de si cada cliente puede tener observabilidad sobre sus ejecuciones. Va numerada al final para no romper la numeración de la §8 del kickoff, pero **conceptualmente se puede correr en cuanto la Etapa 4 esté lista y haya corridas reales de la Etapa 5** — antes de eso serían pantallas adivinando qué le importa a un cliente que todavía no usó el producto.

Depende de: Etapa 1 (`runs` con `status` y `error`, y alguien escribiéndola), Etapa 4 (dashboard), Etapa 5 (corridas reales que valga la pena mirar).

Tareas:

- [ ] `/ejecuciones`: lista de `runs` del tenant con status, trigger, duración y link a la sesión de eve.
- [ ] Detalle de una ejecución: los `events` de ese `run_id` en orden, con su evidencia.
- [ ] Filtros por fecha, agente y status.
- [ ] Salud: tasa de fallo y latencia (p50 / p95) por agente y por trigger.
- [ ] Visibilidad por rol aplicada en la query, no en el front: `cost_usd` solo para `platform_admin`.
- [ ] Test de que un `tenant_admin` no ve ejecuciones de otro tenant ni el costo.
- [ ] `/qa` en desktop y mobile.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** un `tenant_admin` del segundo tenant entra, ve sus propias ejecuciones con sus fallas, y el test confirma que no ve ni el costo ni nada de otro tenant.

---

## Etapa 10 · Agentes inbound y handoff a un comercial — `[ ]`

**Modelo Claude Code:** Opus 5, effort `high` para la spec (modelo de conversación, handoff, canal entrante). Sesión nueva con Sonnet 5 para tools, canal y UI.
**Modelo runtime:** calificación de leads en `anthropic/claude-haiku-4-5`; conversación con el prospecto en `anthropic/claude-sonnet-5`.
**Spec/Plan:** `docs/superpowers/specs/10-inbound-handoff.md` · `docs/superpowers/plans/10-inbound-handoff.md`

Agregada el 2026-09-12 (`docs/superpowers/specs/2026-09-12-arquitectura-plataforma-design.md`, D1). Segunda familia de agentes: atención de pedidos por sitio web o WhatsApp, calificación de leads, con memoria, despertados por webhook. Se abre recién cerrado el ciclo outbound completo (Etapas 1 a 9). Prerrequisitos que las etapas anteriores dejan listos: `conversations` (Etapa 1), canal WhatsApp vía Chat SDK (Etapa 8), observabilidad por tenant (Etapa 9).

Tareas:

- [ ] Agente `agents/atencion/` por capacidad, nunca por cliente; habilitado por tenant en `tenant_agents`.
- [ ] Canal entrante: WhatsApp Cloud API vía Chat SDK y webhook genérico para el sitio web del cliente.
- [ ] Calificación de leads con criterios del tenant (`config_values`), memoria por conversación y por prospecto (memory slot scoped por tenant).
- [ ] Estado `handoff` en `conversations` e inbox del equipo comercial: un humano sigue la conversación por el mismo canal desde la plataforma.
- [ ] Observabilidad propia: conversaciones por canal, tasa de calificación, tiempo hasta handoff, resolución.
- [ ] Decidir proveedor de LinkedIn (tercero) si un cliente lo pide; no hay API oficial.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** un prospecto escribe por WhatsApp al número de un cliente, el agente lo califica, deriva a un comercial, y el comercial le contesta desde la plataforma sin salir de ella.

---

## Riesgos a vigilar en cada etapa (kickoff §9)

- eve en preview → pin de versión, releer `node_modules/eve/docs` en cada upgrade.
- Gmail por Vercel Connect → spike en Etapa 0, fallback documentado.
- HubSpot MCP remoto → si la app tarda en aprobarse, arrancar con Private App token y migrar después.
- Fuga entre tenants → tests de RLS desde Etapa 1.
- Acoplamiento a `innovas` → en cada PR: "¿esto funciona para un tenant que no es INNOV.AS?". Etapa 7 es la prueba real.
