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

## Etapa 1 · Esqueleto multi-tenant — `[x]`

**Modelo Claude Code:** Opus 5, effort `high` para spec + políticas RLS. Sesión nueva con Sonnet 5, effort `medium`, para migraciones/seed/tipos/tests.
**Modelo runtime:** n/a.
**Spec/Plan:** `docs/superpowers/specs/01-multi-tenant.md` · `docs/superpowers/plans/01-multi-tenant.md`

Tareas:

- [x] (Opus) Spec de RLS y del modelo de datos de kickoff §5, con políticas por `tenant_id` vía `memberships`.
- [x] (Sonnet, sesión nueva) Migraciones de `tenants`, `memberships`, `events`, `runs` (`executors`, `tenant_connections`, `config_values`, `accounts`, `contacts`, `queue_items` quedan diferidas a Etapas 2-3 por la decisión D1 de la spec; no existen todavía).
- [x] `seed.sql` con tenant `innovas`, roles y enums (`platform_admin`, `tenant_admin`, `tenant_member`).
- [x] `lib/auth/verifyCaller`: sesión Supabase → estampa `tenantId` y rol en la sesión eve.
- [x] `lib/tenants/resolve.ts`: resuelve el tenant y el rol del caller directo desde las filas de `tenants`/`memberships` (no hay `tenant.json` ni `config_values`; eso queda diferido a Etapas 2-3 por D1).
- [x] `agent.ts` e `instructions.ts` con `defineDynamic` (modelo/instrucciones por tenant).
- [x] Chat web con selector de modelo, estampado en la sesión.
- [x] Tests de RLS en `supabase/tests/` (incluye caso de fuga entre tenants).
- [x] **Hallazgo eve:** `queue_items.request_id` en lugar de `approval_call_id` — la pausa se resuelve por `requestId`, no por `callId`.
- [x] **Hallazgo eve:** validar a mano el ownership de sesión (que un tenant no continúe ni streamee la sesión de otro). El auth de ruta de eve **no** lo hace. Resuelto en código por `resolveChannelContext` (Task 10/11, con mutation testing sobre 5 escenarios de ataque); la verificación E2E contra el deploy con dos usuarios reales autenticados queda como deuda explícita (ver el plan), no cerrada por el test de canal.
- [x] **Hallazgo eve:** estampar `tenantId` en `attributes` del auth; se lee con `ctx.session.auth.current?.attributes`.
- [x] `runs` con `status` (running / ok / failed / cancelled) y `error`, además de lo que ya pide el kickoff §5. Sin estas dos columnas no hay dashboard de ejecuciones posible.
- [x] **Cablear quién escribe `runs`**: crear la fila al abrir la sesión y cerrarla con status, `finished_at` y `error`, desde `agent/hooks/` o `instrumentation.ts` de eve. Hoy ninguna tool del kickoff la escribe, así que la tabla quedaría vacía.
- [x] Definir visibilidad por rol: `cost_usd` es costo interno y lo ve solo `platform_admin`. La RLS por `tenant_id` no alcanza porque esto es visibilidad por columna, no por fila.
- [x] **Enmienda 2026-09-12 (D5):** `conversations` (`tenant_id`, `user_id`, `agent`, `eve_session_id`, `title`, `last_message_at`) para hilos múltiples por usuario y ownership de sesión; `tenant_agents` (`tenant_id`, `agent`, `enabled`, override de modelo, cupos, `config` jsonb); `tenants.self_signup_by_domain` default `false`; `tenants.brand` (`primary`, `secondary`, `logo_url`). `tenant.json` deja de llevar `default_model` y conexiones.
- [x] **Enmienda 2026-09-12 (D4):** alta de usuarios solo por invitación por mail (magic link de Supabase); `allowed_domains` valida al invitar, no es puerta. Providers: Google + magic link; Microsoft cuando un cliente lo pida. Sin contraseñas.
- [x] `/ship` + `/context-save`.

**Terminado cuando:** dos usuarios de tenants distintos no ven filas ajenas (test automatizado), y el selector cambia el modelo de la sesión sin deploy.

✅ Verificación automatizada cumplida el 2026-09-12: tests de RLS de fuga entre tenants en verde (`supabase/tests/`), y contra el deploy de Vercel (`https://agents-six-iota.vercel.app`) `tests/channel/auth.test.ts` pasa completo (3/3). El canal exige sesión tanto para crear como para continuar (verificado contra el deploy); la propiedad de ownership entre usuarios distintos está probada con rigor en Tasks 2-5 (RLS con dos usuarios reales) y Task 10 (`resolveChannelContext`, mutation testing sobre 5 escenarios de ataque) — una verificación E2E de ownership contra el deploy con dos usuarios reales autenticados queda pendiente como deuda explícita (ver el plan), no como parte del criterio de cierre cumplido. Health check del deploy responde `{"ok":true,"status":"ready"}`. HEAD de `main` ya estaba sincronizado con `origin/main` (deploy corriendo el código más reciente).

✅ **Verificación manual cumplida el 2026-09-13** (Step 4 del plan, corrida por el usuario contra el deploy porque requiere login real y una inbox de prueba): login por magic link y redirect al tenant, OK; selector de modelo, OK — el hilo con `anthropic/claude-sonnet-5` respondió end-to-end y quedó su `run`; invitación por mail: link probado, membership creada y el usuario nuevo solo ve su tenant, OK; `/<otro-slug>/chat` con el usuario de prueba da 404, OK.

🔒 **Hallazgo de seguridad de la revisión final (C1), cerrado el 2026-09-13.** La revisión de rama completa encontró que `conversations.eve_session_id` y `conversations.tenant_id` eran escribibles por el dueño de la fila: un usuario podía reapuntar su hilo a la sesión eve de otro tenant y, vía `resolveChannelContext`, continuarla y leer su stream. Los 15 reviews por task no lo habían visto. Se cerró en tres rondas — la primera remediación lo reabrió por el cliente admin (`persistSessionId`, eliminado) y la segunda cubría solo `UPDATE` y no `INSERT`. Cierre definitivo: `20260913014533_lock_conversation_columns.sql` (grants por columna en `UPDATE` e `INSERT` de `conversations`, `memberships_write` con `with check` anti-escalación, `revoke execute ... from anon` en los cinco helpers), más `bind-session.ts` como único escritor de `eve_session_id`. Guardado por `supabase/tests/05_conversation_column_locks.test.sql`. Aplicado en producción el 2026-09-13 junto con `20260912231059_fix_haiku_model_id.sql`; `npx supabase migration list` confirma las 8 migraciones en `remote`, y `npm run db:test` corre en verde sobre ese mismo set (6 archivos, 31 tests).

⚠️ **Deuda anotada al cerrar la etapa:**
- **E2E de ownership de sesión contra el deploy** con dos usuarios reales autenticados. `tests/channel/auth.test.ts` prueba que el canal exige sesión, no que rechaza la sesión de otro; el ownership está probado por RLS (Tasks 2-5) y por mutation testing de `resolveChannelContext` (Task 10), pero no punta a punta contra Vercel. Falta armar el harness que mintea dos JWT reales.
- **Haiku no responde en producción**: `runs.error` = "Free tier users do not have access to this model". Es facturación del Vercel AI Gateway, no un bug del código. Se destraba cargando crédito; el id del modelo ya está corregido (`anthropic/claude-haiku-4.5`, con punto).
- **El primer mensaje de un hilo nuevo no se pinta hasta remontar el componente.** Sonnet respondió bien pero la respuesta apareció recién al switchear de hilo. `eve_session_id` lo escribe `bind-session.ts` de forma asíncrona y el `key={active.id}` remonta con el valor viejo. Molestia de UX, no pérdida de datos: el turno se completa y queda en `runs`.

---

## Etapa 2 · Conexiones del tenant `innovas` — `[x]`

**Modelo Claude Code:** Sonnet 5, effort `high` (Opus solo si el OAuth de HubSpot vía Vercel Connect necesita diseño).
**Modelo runtime:** `anthropic/claude-haiku-4.5` para probar conexiones desde el chat.
**Spec/Plan:** `docs/superpowers/specs/02-conexiones-innovas.md` · `docs/superpowers/plans/02-conexiones-innovas.md`

Tareas:

- [x] `connections/crm.ts` dinámica: HubSpot MCP (`mcp.hubspot.com`) para `innovas`, `null` para tenants sin CRM. (`lib/connectors/catalog.ts`, Task 8)
- [x] Brain `wiki` (plan 2026-09-13-brain, ejecutado por otra sesión — verificado funcionando desde el chat de `innovas` en la verificación manual de esta etapa).
- [x] `connections/coldiq.ts` (Task 5).
- [x] `connections/places.ts` (Google Places, OpenAPI) (Task 5).
- [x] `connections/gmail.ts` con `connect("<uid vercel connect>")`, `principalType: user` (Task 10, reemplaza el `google_tokens` de Etapa 0).
- [x] Crear propiedades custom de outreach en HubSpot (`contact_key`, `outreach_segmento`, `outreach_canal`, `outreach_hook`, `outreach_status`, `outreach_owner`, `outreach_fecha_msg1`, `outreach_fecha_respuesta`) — tool `crm_setup_outreach_properties`, `approval: always()` (Task 9).
- [x] `tenant_connections` como fuente de URLs y `connector_uid` de cada conexión (Task 2; el diseño final usa `connector_uid` de Vercel Connect en vez de `secret_ref`/Vault, ver Enmienda de abajo).
- [x] **Enmienda 2026-09-12 (D2, D3):** catálogo de conectores por capacidad (`lib/connectors/providers.ts`, `lib/connectors/catalog.ts`: `crm`, `leads`, `enrichment`, `brain`, `mail`) con binding por tenant en `tenant_connections`. **Desvío del diseño original:** las llaves no pasan por Supabase Vault — todo secreto (API key u OAuth) vive en Vercel Connect, y `tenant_connections.connector_uid` guarda solo el identificador no-secreto del conector (spec 02 §5.2). El código nunca ve ni loguea una credencial. Brain quedó como tools propias sobre Supabase (spec brain B1), sin conector.
- [x] **Deuda de Etapa 0:** absorbido — `google_tokens` se dio de baja (Task 13) y Gmail pasa por Vercel Connect (Task 10), no por `executors`/Vault.
- [x] **Deuda de Etapa 0:** resuelta migrando Gmail a Vercel Connect (Task 10) en vez de verificar la app de Google original.
- [x] Nota: `connect()` exige un principal de tipo user en la sesión, ya estampado desde Etapa 0.
- [x] PR mergeado (`#3`, `worktree-crm-oauth-entrega3` → `main`) + este cierre.

**Terminado cuando:** desde el chat, `crm__search_crm_objects` y `brain_search` responden para `innovas`, y un tenant de prueba sin CRM no expone la tool.

✅ **Cumplido el 2026-09-14** contra el deploy de producción (`https://agents-six-iota.vercel.app`), verificación manual guiada de los 5 criterios de cierre del plan (Task 14):

1. **CRM + brain + ColdIQ (`innovas`):** pedido de autorización de HubSpot en el primer uso, `crm__search_crm_objects` devolvió un contacto real tras autorizar; `brain_search` respondió con el ICP; `leads-coldiq__findEmail` devolvió un resultado real.
2. **Aislamiento por tenant sin bindings:** tenant de prueba (`prueba-conexiones`) sin ninguna conexión no expuso ninguna tool de CRM/leads/mail — confirmado pidiéndole al agente una búsqueda directa en el CRM, que respondió que no tenía esa capacidad.
3. **Envío de mail real:** `send_email` con `approval: always()`, autorización de Gmail vía Connect, mail recibido; `executors.gmail_authorized_at` estampado en la base.
4. **Aislamiento de grants OAuth entre tenants (S7):** ver hallazgo de seguridad abajo — falló en el primer intento, se corrigió, se re-verificó en producción y ahora pasa.
5. **Propiedades de outreach en HubSpot:** idempotente — la segunda corrida no creó nada nuevo.

🔒 **Hallazgo de seguridad de la verificación de cierre (S7 / Criterio 4), encontrado y cerrado el 2026-09-14.** El mismo usuario, ya autorizado en HubSpot para `innovas`, no volvió a pedir autorización en un segundo tenant de prueba con su propio binding `crm`/`hubspot` — el agente devolvió datos reales de HubSpot del otro tenant sin pedir nada. `tenantScopedConnect` (`lib/connectors/auth.ts`) ata el subject por `tenantId:userId` correctamente y se descartó como causa mediante una réplica directa del request a Vercel Connect (`401 user_authorization_required` para el subject nuevo). Causa raíz real: `ConnectionRegistryImpl.getClient()` de **eve** (`node_modules/eve/dist/src/runtime/connections/registry.js`) cachea el cliente MCP conectado indexado solo por `connectionName`, y `connectionName("hubspot")` devolvía el string fijo `"crm"` para cualquier tenant; con Fluid Compute reutilizando la misma instancia de función tibia entre sesiones, un cliente ya autenticado de un tenant podía servirse a otro. Fix (commit `34a9954`, PR `#6`): `connectionName` ahora incluye `binding.id` para todo proveedor `authKind: "connect_oauth"`, así el nombre de conexión nunca colisiona entre tenants. Verificado con tests (`npm test`, incluye regresión de no-colisión), y **re-verificado en producción** repitiendo el mismo escenario: el segundo tenant volvió a pedir "Autorizar HubSpot" y, tras autorizar, trajo sus propios datos. Detalle completo en `docs/superpowers/specs/02-conexiones-innovas.md` §10.1, fila S7.

⚠️ **Deuda anotada al cerrar la etapa:**
- **Task 14 §3 (usuario, fuera de este cierre):** confirmar plan Pro de Vercel (ya estaba desde el 2026-09-13), crear conectores `api-key` faltantes y correr los bindings de `innovas` contra producción — hecho durante esta misma sesión de cierre (`innovas-coldiq`, `innovas-places`, `crm`/`hubspot`, `mail`/`gmail`).
- **App de Google en producción:** confirmado ya publicada ("In production") en Google Cloud, sin verificación completa del scope sensible `gmail.send` — no bloquea la etapa (funciona hasta 100 usuarios con pantalla de advertencia).
- **Bug de UX, no de seguridad, ya encontrado y corregido en la misma sesión:** el primer mensaje de un hilo nuevo podía fallar con 401 y necesitar reenviarlo — causa raíz: carrera entre `bind-session.ts` y la apertura del stream. Fix en commit `8c1850e`, PR `#4`.

---

## Etapa 3 · Agente de outreach v1 — `[ ]`

**Modelo Claude Code:** Opus 5, effort `high` para `instructions.ts`, gate de estilo y evals. Sesión nueva con Sonnet 5, effort `high`, para tools/subagente/wiring.
**Modelo runtime:** chat `anthropic/claude-sonnet-5` · `researcher` `anthropic/claude-haiku-4.5` · primer toque en frío `anthropic/claude-opus-5`.
**Spec/Plan:** `docs/superpowers/specs/03-agente-outreach-v1.md` · `docs/superpowers/plans/03-agente-outreach-v1.md`

- [ ] Incorporar el plugin `innovas-outreach` cuando esté disponible; sus skills alimentan `agents/outreach/skills/` y el canon del brain de Innovas.
- [ ] (Opus) `instructions.ts`: constitución con cinco frenos, cola para frío, claim por persona.
- [ ] Skills estáticas de outreach en `agents/outreach/skills/` que leen el canon del brain por tags `canon:*`.
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
- [ ] Editor del brain (spec 2026-09-13-brain-design §8). El acceso del cliente por MCP desde sus propias tools es la Etapa 11.
- [ ] `/qa` en desktop y mobile.
- [ ] `/design-review`.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** `/qa` pasa en desktop y mobile, y una aprobación desde `/cola` dispara el envío igual que desde el chat.

---

## Etapa 5 · Escucha, follow-ups y fuentes — `[ ]`

**Modelo Claude Code:** Sonnet 5, effort `high` (Opus para debugging de Cron en Vercel si hace falta).
**Modelo runtime:** `morning-sweep` y clasificación en `anthropic/claude-haiku-4.5` · follow-ups en `anthropic/claude-sonnet-5`.
**Spec/Plan:** `docs/superpowers/specs/05-escucha-followups.md` · `docs/superpowers/plans/05-escucha-followups.md`

- [ ] **Hallazgo eve (leer antes de diseñar):** los schedules son root-only y corren con el principal de la app (`eve:app`, tipo runtime) — no llevan `tenantId` ni pueden parkear esperando aprobación en modo markdown. Hay que usar la forma `run` despachando por un canal autenticado como usuario.
- [ ] `schedules/morning-sweep.ts` iterando tenants activos.
- [ ] `schedules/followups.ts` iterando tenants activos.
- [ ] `read_replies` con clasificación de respuestas.
- [ ] Flujo de carga desde el chat con ColdIQ y Places.
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

El emisor OAuth que se arma acá lo reusa la Etapa 11 para servir el brain por MCP. Conviene dejarlo genérico: el `resource` cambia, el emisor no.

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
**Modelo runtime:** calificación de leads en `anthropic/claude-haiku-4.5`; conversación con el prospecto en `anthropic/claude-sonnet-5`.
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

## Etapa 11 · Brain por MCP: servirlo a los clientes y consumir brains externos — `[ ]`

**Modelo Claude Code:** Opus 5, effort `high` para la spec (es auth y es superficie expuesta a terceros). Sesión nueva con Sonnet 5 para el wiring.
**Modelo runtime:** n/a para el endpoint; el del tenant para el agente.
**Spec/Plan:** `docs/superpowers/specs/11-brain-mcp.md` · `docs/superpowers/plans/11-brain-mcp.md`

Agregada el 2026-09-19 a pedido de Matías. El brain de un tenant hoy solo se usa desde el agente. Faltan las dos puntas: que el cliente lo use desde **sus** herramientas (Claude Code, Codex, claude.ai) y que un cliente pueda tener su brain **en un servidor aparte**, aislado de los demás tenants, sin perder las mismas tres tools.

**Depende de:** Etapa 2 (bindings por tenant, ya cerrada), Etapa 6 (Supabase como emisor OAuth 2.1: se reusa ese emisor, no se inventa una segunda auth) y, para que el cliente tenga dónde editar, Etapa 4 (editor del brain).

### A. Servir el brain desde la plataforma

- [ ] Endpoint MCP remoto del brain, por tenant, con `brain_search`, `brain_read` y `brain_upsert`. Es **distinto** del canal MCP de la Etapa 6: ahí se le delega una tarea al agente, acá se leen y escriben páginas directo.
- [ ] Auth con el emisor OAuth de la Etapa 6. El token resuelve tenant y usuario; la membresía define el alcance. Un token de un tenant nunca ve páginas de otro: se lee por el mismo camino, con `tenant_id` y RLS.
- [ ] **Decisión a confirmar en la spec:** por MCP escribe una persona, no el agente, así que `brain_upsert` no pide aprobación (la aprobación existe porque el agente propone). Propuesta: escriben `tenant_admin` y `platform_admin`, los demás miembros solo leen. La escritura pasa igual por `brain_upsert_page`, deja revisión con `author_kind: "user"` y evento.
- [ ] Rate limit y tamaño de respuesta: es una superficie pública autenticada, no un endpoint interno.
- [ ] Doc de conexión para el cliente: Claude Code, Codex y claude.ai.

### B. Consumir brains externos

- [ ] Construir el proveedor `mcp` que la spec del brain ya dejó diseñado (`2026-09-13-brain-design.md` §4.4): binding por tenant con `connector_uid` de Vercel Connect, `config.url` y mapeo de nombres de tools. El adapter traduce al contrato de tres tools y la aprobación de `brain_upsert` sigue siendo nuestra, no del servidor remoto.
- [ ] **Caso "brain aislado":** el mismo wiki desplegado aparte, con base propia del cliente, consumido por el proveedor `mcp` y conectado también desde las tools del cliente. Requiere empaquetar el wiki como servicio desplegable. Es lo que hacía `innovas-brains-mcp` en Railway, ahora como opción de aislamiento para quien la pida y no como forma default.
- [ ] Un brain de terceros (gbrain o a medida) entra por el mismo proveedor, siempre que sea **MCP remoto sobre HTTP**: eve y Connect no hablan con procesos stdio (lección de ColdIQ, Etapa 2).
- [ ] **Decisión a confirmar en la spec:** si un tenant puede tener dos brains a la vez (wiki propio más MCP externo) o sigue siendo uno solo. Hoy `resolveBrainBinding` toma el `wiki` y descarta el resto con un aviso.

### C. Configurable por tenant y por agente

- [ ] Hoy el brain se habilita por tenant (`tenant_connections`) pero las tools están cableadas dentro de `agents/outreach/tools/brain.ts`: cualquier agente nuevo que lo necesite tendría que repetir ese archivo. Mover la tool a `lib/` y que cada agente la monte.
- [ ] Que cada agente declare en `tenant_agents.config` si usa brain y con qué alcance (solo lectura, o lectura y escritura). Un agente sin brain declarado no expone ninguna tool `brain_*`, igual que hoy pasa con un tenant sin binding.

**Terminado cuando:** desde el Claude Code de un cliente, con su propia cuenta, `brain_search` y `brain_read` responden su canon y ninguna página de otro tenant; un tenant con brain externo por `mcp` responde las mismas tres tools desde el chat del agente; y un agente que no declara brain no expone esas tools.

**Cuando haga falta, no ahora:** búsqueda híbrida con embeddings (`2026-09-13-brain-design.md` §6.2), que se activa por tenant con `config.search = "hybrid"` más un backfill. Señal para prenderla: el agente busca algo que existe y no lo encuentra, o el brain de un tenant pasa de unas 150 páginas.

---

## Riesgos a vigilar en cada etapa (kickoff §9)

- eve en preview → pin de versión, releer `node_modules/eve/docs` en cada upgrade.
- Gmail por Vercel Connect → spike en Etapa 0, fallback documentado.
- HubSpot MCP remoto → si la app tarda en aprobarse, arrancar con Private App token y migrar después.
- Fuga entre tenants → tests de RLS desde Etapa 1.
- Acoplamiento a `innovas` → en cada PR: "¿esto funciona para un tenant que no es INNOV.AS?". Etapa 7 es la prueba real.
