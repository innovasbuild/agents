---
title: Roadmap de etapas
category: producto
status: activo
tags: [roadmap, etapas]
updated: 2026-10-14
---

# Roadmap de etapas

Este documento es el **tracker de ejecución** del kickoff (`kickoff.md`). Cada etapa de acá abajo es la misma etapa de la §8 del kickoff, pero partida en tareas chequeables para poder:

- Abrir una sesión nueva de Claude Code por etapa, con el modelo que corresponde (ver `Modelo Claude Code` de cada etapa).
- Tildar tareas a medida que se cierran, sin depender de tener toda la conversación anterior en contexto.
- Saber en qué quedó todo aunque hayan pasado varias sesiones o cambiado de modelo en el medio.

## Cómo usar este documento

1. **Antes de arrancar una etapa:** abrí sesión nueva, corré `/context-restore` si venís de una etapa anterior relacionada, y decile a Claude "trabajemos la Etapa N de `docs/producto/roadmap.md`".
2. **Modelo de esa sesión:** el indicado en `Modelo Claude Code` de la etapa (lógica completa en kickoff §3a). Si la etapa mezcla spec y wiring, son **dos sesiones separadas** (spec con Opus, implementación con Sonnet en sesión nueva) — está anotado etapa por etapa.
3. **Proceso dentro de la etapa:** `superpowers:brainstorming` → spec en `docs/superpowers/specs/NN-<etapa>.md` → `superpowers:writing-plans` → plan en `docs/superpowers/plans/NN-<etapa>.md` → TDD/implementación → `superpowers:verification-before-completion` → `/ship`.
4. **Al cerrar la sesión:** tildar las tareas hechas acá, actualizar el `Estado` de la etapa, correr `/docs-wiki` (la wiki tiene que quedar con `npm run docs:check` en verde) y después `/context-save`.
5. **No saltear el criterio "Terminado cuando"** de cada etapa: es la prueba de que sirve para probar, no una lista de archivos creados.

Convención de estado por etapa: `[ ]` no arrancada · `[~]` en curso · `[x]` cerrada (spec + plan + PR mergeado + criterio cumplido).

## Orden de ejecución

**El número de una etapa no es su orden.** Las etapas nuevas se numeran al final para no romper las referencias que ya existen, y se ejecutan donde tienen sentido:

**5 → 12 → 13 → 7**, y después el resto.

**Enmienda 2026-10-09:** las etapas 19 a 23 salen de `docs/producto/plan-cierre-gap-2026-10.md` y van en ese orden: **19 → 20 → 21 → 22 → 23**, con 19 y 20 en paralelo si hay dos sesiones. La 7 se corre dentro de la 21.

- La **12** (orquestación) y la **13** (pipeline de GTM) van **antes** del segundo tenant. La prueba de la Etapa 7 es "corre sin tocar `agents/` ni `lib/`"; hacerla antes validaría con el cliente nuevo la corrida manejada desde el chat, que es justo lo que la 12 y la 13 reemplazan.
- La **9** (observabilidad) conviene después de la 12, que es la que le genera los datos (`runs` con conteos, `usage_entries`).
- La **14** (subida de eve) es independiente de la 12 y la 13: se puede correr en paralelo con cualquiera.
- La **16** no arranca por fecha sino por datos: hace falta historial de piezas aprobadas sin edición.
- Las **6, 8, 10 y 11** no se mueven.

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
- [x] **Enmienda 2026-10-09 (ingreso por dominio):** D4 sigue siendo el modo por defecto. Cada empresa puede abrir el ingreso a quien tenga un correo verificado de sus `allowed_domains` (`self_signup_by_domain`): el admin de la empresa elige el modo en settings, plataforma carga los dominios, el alta es `join_tenants_by_domain()` y deja `membership.joined_by_domain`. Spec: `docs/superpowers/specs/2026-10-09-ingreso-por-dominio-design.md`.
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

## Etapa 3 · Agente de outreach v1 — `[x]`

**Estado:** cerrada según el registro de avance del kickoff (§8, "Estado de avance", PR #27). Las casillas de abajo no se tildaron una por una: su lista fue reemplazada por las entregas de la spec 03 (§14 y §17), y el detalle de lo hecho vive ahí.

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

## Etapa 4 · Dashboard — `[x]`

**Estado:** cerrada según el registro de avance del kickoff (PR #27; entregas en PRs #22 a #24). Las casillas de abajo no se tildaron una por una: el detalle vive en `docs/superpowers/specs/2026-09-16-etapa-4-dashboard-cola-design.md` y sus planes.

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
- [x] Editor del brain: spec y plan `2026-09-27-editor-brain-design`, PR #55. Sin QA visual interactiva todavía (bloqueo del sandbox de desarrollo, ver spec §9); el criterio de cierre real es una edición verificada en producción. El acceso del cliente por MCP desde sus propias tools es la Etapa 11.
- [ ] `/qa` en desktop y mobile.
- [ ] `/design-review`.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** `/qa` pasa en desktop y mobile, y una aprobación desde `/cola` dispara el envío igual que desde el chat.

---

## Etapa 5 · Escucha, follow-ups y fuentes — `[x]`

**Estado:** cerrada según el registro de avance del kickoff (PR #26 y #27). Spec real: `docs/superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md`. Su D1 sacó las fuentes del alcance: ColdIQ y Places como flujo de carga pasan a la **Etapa 13**.

**Modelo Claude Code:** Sonnet 5, effort `high` (Opus para debugging de Cron en Vercel si hace falta).
**Modelo runtime:** `morning-sweep` y clasificación en `anthropic/claude-haiku-4.5` · follow-ups en `anthropic/claude-sonnet-5`.
**Spec/Plan:** `docs/superpowers/specs/05-escucha-followups.md` · `docs/superpowers/plans/05-escucha-followups.md`

- [ ] **Hallazgo eve (leer antes de diseñar):** los schedules son root-only y corren con el principal de la app (`eve:app`, tipo runtime) — no llevan `tenantId` ni pueden parkear esperando aprobación en modo markdown. Hay que usar la forma `run` despachando por un canal autenticado como usuario.
- [ ] `schedules/morning-sweep.ts` iterando tenants activos.
- [ ] `schedules/followups.ts` iterando tenants activos.
- [ ] `read_replies` con clasificación de respuestas.
- ~~Flujo de carga desde el chat con ColdIQ y Places.~~ Movido a la Etapa 13 (D1 de la spec de la Etapa 5).
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** una respuesta real en tu Gmail mueve el contacto a `respondio` sin intervención, y el follow-up vencido aparece en la cola a la mañana.

---

## Etapa 6 · Canal MCP (Claude / ChatGPT) — `[x]`

**Modelo Claude Code:** Opus 5, effort `high` (es auth: `oauthResource` sobre Supabase como emisor OAuth 2.1).
**Modelo runtime:** el del tenant.
**Spec/Plan:** `docs/superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md` · `docs/superpowers/plans/2026-09-27-etapa-6-canal-mcp.md`

**Estado:** verificado contra producción (M1–M5; M6 no bloquea, ver abajo). En el camino apareció un defecto real (no de esta spec, de cómo eve compila tools dinámicas para poder rehidratarlas): `brain_search`/`brain_read`/`brain_upsert` no aparecían en ninguna sesión por MCP porque su `execute` cerraba sobre una función local en vez de datos serializables. Arreglado y verificado en [PR #57](https://github.com/innovasbuild/agents/pull/57) (`lib/brain/tools.ts`).

- [x] Supabase Auth como servidor OAuth 2.1 con registro dinámico de clientes. Hecho y verificado contra producción en la Etapa 11 (`docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md` §4, §11): OAuth Server prendido, Allow Dynamic OAuth Apps, pantalla de consentimiento, `next` seguro en el login, `custom_access_token_hook` confirmado corriendo para tokens de cliente OAuth (V3, V7). Este emisor es genérico y ya sirve para cualquier `resource`, no solo el del brain.
- [x] `channels/mcp.ts` con `oauthResource(verifyMcpChannelToken, { issuer, resource, scopes })`. El tenant sale de `?tenant=<slug>` en la URL de conexión, no de un argumento (la ruta de `mcpChannel` es fija, sin segmento dinámico). Verificado contra producción (M1–M4).
- [x] Docs de conexión (`docs/guias/conectar-agente-por-mcp.md`; claude.ai sin probar, igual que con el brain).
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** conectás el agente desde Claude Code y desde claude.ai, pedís algo simple y el trabajo corre durable en Vercel, con su `run` en `trigger: 'mcp'` y sin fila nueva en `conversations`. Verificado contra producción:

| # | Qué | Resultado |
|---|---|---|
| M1 | Claude Code conecta a `.../eve/agents/outreach/eve/v1/mcp?tenant=innovas`, `agent_start` con un mensaje simple, `agent_get` llega a `completed` | ✅ `agent_start`→`agent_get`→`completed`, con `brain_search`/`brain_read`/`brain_upsert` presentes tras el PR #57 |
| M2 | Sin `?tenant`: error claro, no un 401 de login | ✅ `403 forbidden`, `"Falta el tenant en la URL de conexión: agregá ?tenant=<slug>."` |
| M3 | Un token sin membresía en ese tenant: rechazado | ✅ `403 forbidden` contra un tenant inexistente (`"No existe ese cliente."`). Sin probar en vivo la rama exacta "es miembro de otro tenant real": hoy no hay una segunda cuenta no-admin en la base; queda cubierta solo por el test unitario que fija el mensaje exacto (`tests/agents/mcp-channel-auth.test.ts`) |
| M4 | La fila de `runs` tiene `trigger = 'mcp'`; no hay fila nueva en `conversations` | ✅ confirmado por query directa a la base |
| M5 | Una tool con aprobación (`send_email`, en un tenant de prueba, no `innovas`) llega a `input_required` y se resuelve con `agent_update` | ✅ con `crm_upsert_contact` en `prueba-conexiones` en vez de `send_email`: ese tenant no tiene brain conectado (necesario para `draft_message`/`queue_touch`) ni un ejecutor de outreach dado de alta de antes. `input_required`→`agent_update` (cancelar)→`completed`, sin escribir nada real |
| M6 | claude.ai conecta como conector remoto (no bloquea el cierre si M1 funciona) | Sin probar |

El emisor OAuth que se reusa acá es el mismo que sirve el brain por MCP (Etapa 11): el `resource` cambia, el emisor no.

---

## Etapa 7 · Segundo tenant — `[ ]`

> Se corre dentro de la Etapa 21.4 con Lagomarsino, que usa solo el brain. El piloto de 5 contactos de outreach con un segundo tenant sigue sin probar.

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

## Etapa 11 · Brain por MCP: servirlo a los clientes y consumir brains externos — `[x]`

**Modelo Claude Code:** Opus 5, effort `high` para la spec (es auth y es superficie expuesta a terceros). Sesión nueva con Sonnet 5 para el wiring.
**Modelo runtime:** n/a para el endpoint; el del tenant para el agente.
**Spec/Plan:** `docs/superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md` · `docs/superpowers/plans/2026-09-24-etapa-11-brain-mcp.md` (PR #51 y #52, mergeados)

Agregada el 2026-09-19 a pedido de Matías. El brain de un tenant hoy solo se usa desde el agente. Faltan las dos puntas: que el cliente lo use desde **sus** herramientas (Claude Code, Codex, claude.ai) y que un cliente pueda tener su brain **en un servidor aparte**, aislado de los demás tenants, sin perder las mismas tres tools.

**Depende de:** Etapa 2 (bindings por tenant, ya cerrada), Etapa 6 (Supabase como emisor OAuth 2.1: se reusa ese emisor, no se inventa una segunda auth) y, para que el cliente tenga dónde editar, Etapa 4 (editor del brain).

**Estado: cerrada el 2026-09-27**, verificada contra producción (V1–V5 y V7 de la spec §11; V6, claude.ai, no probado, no bloquea). Las "decisiones a confirmar" de A y B, abajo, quedaron resueltas en la spec por D4, D5 y D9 (rol decide qué tools se listan, `brain_upsert` por MCP escribe sin aprobación, un solo brain habilitado por tenant); el caso "brain aislado" de B pasó a fuera de alcance de esta etapa (spec §12).

### A. Servir el brain desde la plataforma

- [x] Endpoint MCP remoto del brain, por tenant, con `brain_search`, `brain_read` y `brain_upsert`. Es **distinto** del canal MCP de la Etapa 6: ahí se le delega una tarea al agente, acá se leen y escriben páginas directo. Verificado contra producción (V5): Claude Code conectó a `/brain/innovas/mcp` y `brain_search` devolvió el canon real.
- [x] Auth con el emisor OAuth de la Etapa 6. El token resuelve tenant y usuario; la membresía define el alcance. Un token de un tenant nunca ve páginas de otro: se lee por el mismo camino, con `tenant_id` y RLS.
- [x] **Decisión a confirmar en la spec, resuelta por D4 y D5:** por MCP escribe una persona, no el agente, así que `brain_upsert` no pide aprobación (la aprobación existe porque el agente propone). El rol decide qué tools se listan: `tenant_admin` y `platform_admin` ven las tres, `tenant_member` solo lectura. La escritura pasa igual por `brain_upsert_page`, deja revisión con `author_kind: "user"` y evento.
- [x] Rate limit y tamaño de respuesta: es una superficie pública autenticada, no un endpoint interno.
- [x] Doc de conexión para el cliente: Claude Code, Codex y claude.ai (`docs/guias/conectar-brain-por-mcp.md`; Codex sin probar).

### B. Consumir brains externos

- [x] Construir el proveedor `mcp` que la spec del brain ya dejó diseñado (`2026-09-13-brain-design.md` §4.4): binding por tenant con `connector_uid` de Vercel Connect, `config.url` y mapeo de nombres de tools. El adapter traduce al contrato de tres tools y la aprobación de `brain_upsert` sigue siendo nuestra, no del servidor remoto. Probado contra un servidor MCP en proceso; no hay brain externo real todavía, así que sigue sin correr contra uno de verdad.
- [ ] **Caso "brain aislado" — pasa a fuera de alcance (spec §12):** el mismo wiki desplegado aparte, con base propia del cliente, consumido por el proveedor `mcp` y conectado también desde las tools del cliente. Requiere un deploy nuevo y un segundo modo de auth (llave de servicio) en el endpoint, que esta etapa no construye; el proveedor `mcp` ya lo deja conectable el día que alguien lo pida.
- [x] Un brain de terceros (gbrain o a medida) entra por el mismo proveedor, siempre que sea **MCP remoto sobre HTTP**: eve y Connect no hablan con procesos stdio (lección de ColdIQ, Etapa 2). (código)
- [x] **Decisión a confirmar en la spec, resuelta por D9:** un tenant tiene un solo brain habilitado a la vez, forzado con un índice único parcial en la base (antes `resolveBrainBinding` tomaba el `wiki` y descartaba el resto en silencio; ahora el error aparece al dar de alta, no al arrancar una sesión).

### C. Configurable por tenant y por agente

- [x] Hoy el brain se habilita por tenant (`tenant_connections`); las tools se movieron a `lib/brain/adapters/tools.ts` y cada agente las monta declarando su acceso, en vez de tenerlas cableadas dentro de `agents/outreach/tools/brain.ts`.
- [x] Cada agente declara en `tenant_agents.config.brain` si usa brain y con qué alcance (`none`, `read` o `read_write`). Un agente sin brain declarado no expone ninguna tool `brain_*`, igual que hoy pasa con un tenant sin binding. Confirmado en producción: `innovas` y `prueba-conexiones` con `"brain": "read_write"`.

**Cuatro desvíos sobre la spec, encontrados al implementar y al verificar:**
- **Slugs de tenant reservados** (`20260924100050_reserved_tenant_slugs.sql`): un tenant con slug igual a una palabra de ruta de primer nivel de `app/` (`api`, `auth`, `brain`, `eve`, `login`, `oauth`, `sin-acceso`) quedaría tapado por esa ruta estática y fuera del refresh de sesión del proxy. Se reserva la palabra a nivel de base, con `check` y migración que frena si ya hay un tenant en conflicto.
- **Un token malformado da 401, no una excepción del gate:** si el verificador de claims explota con un token roto (JWT mal formado), `resolveMcpAccess` lo captura y devuelve 401 `invalid_token` en vez de dejar que la excepción suba y termine en el 500 genérico.
- **Un error inesperado adentro del endpoint da 500 genérico con un id:** `handleBrainMcp` envuelve todo el request; cualquier excepción no prevista se loguea con un `crypto.randomUUID()` y sale como `{ ok: false, code: "internal", error: "Error interno (<id>)." }`, sin detalle interno en la respuesta.
- **`custom_access_token_hook`** (`20260925120000_oauth_client_role_hook.sql`, PR #52, no estaba en la spec original): los tokens del OAuth Server son JWT comunes del proyecto y, con la anon key, funcionarían contra PostgREST con todos los permisos RLS del usuario. El hook les asigna el rol `oauth_client`, sin ningún grant, cuando el token trae `client_id`. Verificado contra producción (V3, V7): el hook corre para esos tokens y PostgREST responde `403 permission denied`.

**Terminado cuando:** desde el Claude Code de un cliente, con su propia cuenta, `brain_search` y `brain_read` responden su canon y ninguna página de otro tenant; un tenant con brain externo por `mcp` responde las mismas tres tools desde el chat del agente; y un agente que no declara brain no expone esas tools. **Cumplido el 2026-09-27**, con `innovas` en producción: `brain_search` desde Claude Code devolvió el canon real (V5); el caso del brain externo por `mcp` queda probado solo con tests, sin un servidor de terceros real todavía (spec criterio 3).

**Runbook de producción — completado el 2026-09-27:**

1. ✅ `npx supabase migration list`: las migraciones locales coincidían con remoto, sin nada ajeno pendiente (la de Apollo, `20260922100000_upsert_discovered_account.sql`, ya estaba aplicada).
2. ✅ `db push`: las migraciones de la Etapa 11 (incluida la del hook, PR #52) están en producción.
3. ✅ `PUBLIC_APP_URL` cargada en Vercel Production: `https://agentes.innov.as` (dominio real confirmado con el CLI; los docs viejos que decían `agents.innov.as` o `agents-six-iota.vercel.app` estaban desactualizados).
4. ✅ Custom Access Token Hook seleccionado en el dashboard (Authentication → Hooks → `public.custom_access_token_hook`).
5. ✅ OAuth Server prendido (Dynamic OAuth Apps, Authorization Path `/oauth/consent`, Redirect URLs).
6. ✅ Deploy de Vercel de los PR #51 y #52 (el merge a `main` no disparó el deploy solo; hubo que promoverlo a mano desde el dashboard de Vercel — revisar por qué el auto-deploy de Production no se dispara con un push a `main`, es deuda de infraestructura, no de esta etapa).
7. ✅ Verificaciones V1 a V5 y V7 de la spec (§11). Un hallazgo en el camino: la **Site URL** de Supabase seguía en `http://localhost:3000` desde el setup inicial del proyecto (nunca actualizada), lo que mandaba la pantalla de consentimiento a localhost sin importar qué MCP server tuviera configurado el cliente. Corregida a `https://agentes.innov.as`. V6 (claude.ai) no se probó; no bloquea el cierre.

**Cuando haga falta, no ahora:** búsqueda híbrida con embeddings (`2026-09-13-brain-design.md` §6.2), que se activa por tenant con `config.search = "hybrid"` más un backfill. Señal para prenderla: el agente busca algo que existe y no lo encuentra, o el brain de un tenant pasa de unas 150 páginas.

---

## Etapa 12 · Modelo de orquestación — `[x]`

**Modelo Claude Code:** Fable 5.1 para la spec (hecha). Sesión nueva con Sonnet 5, effort `high`, para la implementación.
**Modelo runtime:** el de cada nodo por tier (`barato` → Haiku 4.5, `medio` → Sonnet 5, `fuerte` → Opus 5).
**Spec/Plan:** `docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md` · `docs/superpowers/plans/2026-09-20-etapa-12-orquestacion.md` (PR #29, mergeado)

Agregada el 2026-09-20. Las reglas para que todo lo que se construya después (workflows por tenant, trabajo desatendido) quede ordenado: qué es un nodo, un workflow y un agente, cuándo se usa cada uno, qué contrato cumplen, y una escala de efectos de cuatro niveles que reemplaza la regla binaria de aprobación. **Se ejecuta antes de la 7** (ver "Orden de ejecución").

**Depende de:** Etapa 5.

- [x] **E1 · Medición:** `usage_entries`, los nodos que ya llaman al modelo asientan, `runs.cost_usd` se escribe por primera vez. PR #32.
- [x] **E2 · Rieles:** `work_items` y reclamo con lease, `enqueue()`, registry con tests que obligan, runner, `tenant_workflows`, `tenant_budgets`. PR #35.
- [x] **E3 · Primer workflow:** `refresh-fichas` y el dispatcher, contra producción. Plan `docs/superpowers/plans/2026-09-21-etapa-12-e3-refresh-fichas.md`, PR #37; cierre contra producción el 2026-09-21, PR #39 (spec §2).
- [x] **E4 · La ley:** `docs/arquitectura/orquestacion.md` y el bloque de reglas en `CLAUDE.md`, que se mergea con el código y no antes.
- [x] `/ship` + `/context-save`.

**En producción:** `refresh-fichas` prendido para `innovas` (cadencia 60, 5 ítems por tick, `model_usd` USD 3 por día). Deuda anotada: asentar el consumo cuando la llamada al modelo se corta o tira adentro de `generateText`, y hilar la señal de abort por `lib/` para que la tool del chat también corte las lecturas en curso.

**Terminado cuando:** una ficha vencida se refresca sola en producción, con su fila en `runs` (la cuenta cierra) y sus asientos en `usage_entries`; con el presupuesto en cero corta como `budget_exhausted` sin perder ítems; y los tests del registry fallan cuando se los rompe a propósito.

---

## Etapa 13 · Pipeline de GTM — `[ ]`

**Modelo Claude Code:** Opus 5 para la spec (hecha). Sesión nueva con Sonnet 5, effort `high`, para la implementación.
**Modelo runtime:** calificación y verificación de hechos con `typesafe-ai/jev` por el AI Gateway · redacción con Opus 5 (la que ya existe).
**Spec/Plan:** `docs/superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md` · `docs/superpowers/plans/2026-09-20-etapa-13-pipeline-gtm.md` (PR #30)

Agregada el 2026-09-20. Una persona define un foco de búsqueda y el sistema descubre empresas y personas en Apollo, las califica contra el ICP con Jev, revela el email **solo de las que pasan**, y deja la pieza `pending` en la cola. Califica antes de enriquecer porque buscar cuesta un crédito por página y revelar un email cuesta uno por cabeza. Absorbe el "flujo de carga con ColdIQ y Places" que la Etapa 5 dejó afuera.

**Depende de:** Etapa 12 **implementada** (no alcanza con su spec).

- [x] **E1 · Descubrimiento (código):** `LeadsAdapter` con Apollo (dos llaves, fallback), `search_focuses`, workflow `target-search`, cableado al dispatcher. Tasks 1-9 mergeadas, revisadas y en verde. **Falta la Task 10 (cierre contra producción): a propósito, en pausa.** Mati no quiere pagar Apollo todavía; mientras tanto sigue operando con ColdIQ y carga por CSV. Cuando decida conectar Apollo: cargar las dos llaves en Vercel Connect (`vercel connect create apollo --connection-method api-key --name innovas-apollo-<persona>`, no está en el catálogo de servicios así que usa el método genérico), crear el binding del tenant, aplicar la migración pendiente `20260922100000_upsert_discovered_account.sql` (con confirmación explícita, no `db push` a ciegas — ver `.superpowers/sdd/2026-09-20-etapa-13-pipeline-gtm/progress.md`), presupuesto chico y foco de prueba.
- [x] **E2 · Calificación (código):** workflow `icp-scoring` con Jev, niveles del ICP en la config del tenant, `decideIcp` con tres carriles, nodo `outreach/icp-score` cableado al dispatcher. Tasks 11-15 mergeadas, revisadas y en verde. **Falta la Task 16 (evals + cierre contra producción): en pausa, depende de la Task 10.** Necesita 20 contactos reales descubiertos por Apollo, calificados a mano por Mati — no hay ninguno todavía porque Apollo sigue sin conectar (ver E1). Cuando se retome la Task 10, seguir con la Task 16 en la misma sesión.
- [x] **E3 · Enrichment y pieza (código, PR #47 mergeado):** revelado de email con promoción de `contact_key` (Task 17), workflow `contact-enrichment` (Task 18), `verify-fact` (Task 19), `draft-queue` con cupo diario y reintento por fecha — enmienda D17 (Task 20). Tasks 17-20 mergeadas en el PR #47, revisadas y en verde. **Falta la Task 21 (cierre contra producción): en pausa, depende de la Task 10/Apollo**, igual que E1. Deuda parkeada (severidad media, sin tope): un contacto cuyo ancla no verifica reintenta el mismo ciclo de gasto todos los días, sin carril de descarte permanente — arreglarlo pide trackear el motivo del último intento entre días, hoy no consultable.
- [x] **E4 · Pantallas (código, PR #47 mergeado):** lecturas/escrituras de `/focos` (Task 22), la pantalla (Task 23), la bandeja "para revisar" (Task 24), columna de puntaje en `/contactos` (Task 25), baja del script de CLI (Task 26). Tasks 22-26 mergeadas en el PR #47, revisadas y en verde. Sin QA visual en navegador (la app exige login real, no se pudo probar en este entorno) — compensado con revisión de código más estricta en cada tarea de pantalla. Cierre contra producción también en pausa, depende de la Task 10/Apollo.
- [ ] **Diferido:** LinkedIn (proveedor sin decidir; Unipile es el único con arquitectura de API) y, con él, la cola por canal y la aprobación por lote.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** un foco real descubre contactos en Apollo, Jev los califica, **ningún descartado consume un crédito de email**, y un calificado termina como pieza en `/cola` que sale con su atribución completa en HubSpot.

---

## Etapa 14 · Subida de eve — `[ ]`

**Modelo Claude Code:** Opus 5, effort `high`. Es un framework en preview y nueve versiones menores de salto.
**Modelo runtime:** n/a.
**Spec/Plan:** a escribir al arrancarla.

Agregada el 2026-09-20. De `0.54.2` a la vigente. No es un spike: la 0.58 cambió las rutas de agentes nombrados a `/eve/<name>/v1/*` (hoy se usa `/eve/agents/outreach/eve/v1/`), y eso toca el cliente del chat, los tests de canal y el dispatch de schedules. Adentro va el spike de `defineWorkflowTool` con `ctx.ask` que necesita la Etapa 15, y que en 0.54.2 no corría con el agente en `agents/outreach/` (spec 03 §16).

**Depende de:** Etapa 5. Independiente de la 12 y la 13.

- [ ] Releer `node_modules/eve/docs` completo en la versión nueva.
- [ ] Rutas de agentes nombrados, cliente del chat, tests de canal, dispatch de schedules.
- [ ] Spike: `defineWorkflowTool` con `ctx.ask` en `agents/outreach/`.
- [ ] Volver a correr los criterios de cierre de las Etapas 5 y 12 después de subir.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** producción corre sobre la versión nueva, el chat y los schedules andan igual que antes, y el spike de `defineWorkflowTool` tiene respuesta.

---

## Etapa 15 · Propuesta comercial — `[ ]`

**Modelo Claude Code:** Opus 5 para la spec. Sesión nueva con Sonnet 5 para la implementación.
**Modelo runtime:** a definir en la spec.
**Spec/Plan:** a escribir al arrancarla.

Agregada el 2026-09-20. Un agente conversacional: la persona pide un contacto, el agente levanta el contexto de las interacciones previas, se sube un archivo (normalmente el transcript de una reunión), y con el brain del tenant arma una propuesta en un formato fijo. Es agente y no workflow porque hay alguien conversando y el camino depende de lo que diga el transcript (spec de la Etapa 12, §4.2).

**Depende de:** Etapa 14 si usa `defineWorkflowTool`; si no, de ninguna.

**Terminado cuando:** a partir de un transcript real, sale una propuesta en el formato del tenant, con el contexto del contacto, sin que la persona tenga que pegar nada a mano.

---

## Etapa 16 · Auto-respuesta con umbral — `[ ]`

**Modelo Claude Code:** Opus 5 para la spec (es la excepción del nivel 3: algo le llega a una persona sin click humano).
**Modelo runtime:** a definir en la spec.
**Spec/Plan:** a escribir al arrancarla.

Agregada el 2026-09-20. La escucha de la Etapa 5 responde sola cuando tiene confianza alta en su capacidad de responder, y si no, notifica y espera. Es la excepción del nivel 3 que la Etapa 12 dejó diseñada y apagada (§7.4): se prende por tenant + canal + tipo de pieza.

**Depende de:** Etapa 5 **y** historial suficiente. **No arranca por fecha, arranca por datos:** hace falta una tasa medida de piezas de ese tipo aprobadas sin edición.

- [ ] La confianza la pone un verificador con contexto fresco, nunca el nodo que redactó.
- [ ] Tope diario propio, aparte de los presupuestos.
- [ ] Todo lo que sale solo queda marcado y aparece en una lista de "salió sin aprobación".

**Terminado cuando:** con el interruptor prendido para un tenant y un tipo de respuesta, las que superan el umbral salen solas, las demás esperan a una persona, y todas las automáticas se pueden auditar.

---

## Etapa 17 · Permisos del brain por carpeta y por página — `[ ]`

**Modelo Claude Code:** Fable 5.1 para la spec (hecha) y para 17.2, que toca RLS y el punto de control de acceso. Sonnet 5 en sesión nueva para 17.1 (refactor sin cambio funcional) y 17.3 (UI).
**Modelo runtime:** n/a.
**Spec:** `docs/superpowers/specs/2026-10-05-etapa-17-permisos-brain-design.md` · **Plan:** a escribir por entrega.

Agregada el 2026-10-05. Un administrador del tenant decide quién ve y quién edita cada carpeta y cada página del brain, con herencia hacia abajo como en Drive, y eso vale en el editor web, por MCP y en el chat con el agente. El módulo `lib/brain` queda aislado en `core/` y `adapters/` para poder mudarlo a su propio repo. Por MCP, todos ven las tres tools; el acceso lo decide la configuración del brain.

Tres entregas, una sesión y un PR cada una:

- [x] **17.1 · Aislamiento.** `lib/brain/core` sin imports de afuera, `lib/brain/adapters` con Supabase, Next, eve y la plataforma, test de frontera, `list()` en el provider y el editor leyendo por ahí. Sin cambio visible. Plan: `docs/superpowers/plans/2026-10-05-etapa-17-1-aislamiento-brain.md`. Pendiente antes de dar por buena en producción: humo manual del editor contra una base local (índice, página, historial, edición, mapa, raw), que no se corrió por falta de `.env.local` en el worktree.
- [x] **17.2 · Permisos.** Tabla `brain_access_rules`, revoke del `select` de `authenticated` en `brain_pages` y `brain_revisions` (hoy un miembro puede leer toda la tabla por la API), `resolveAccess` y `withAccess` puros, cableados en editor, MCP y agente. En el chat el agente actúa en nombre de la persona. La raíz nace abierta: nadie pierde nada el día del despliegue. Plan: `docs/superpowers/plans/2026-10-07-etapa-17-2-permisos.md`. **Antes de desplegar:** aplicar la migración `20261007120000_brain_access_rules` a producción primero (corriendo `npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después desplegar el código; al revés, el editor fallaría cerrado por falta de la tabla.
- [x] **17.3 · Árbol y compartir.** Árbol estilo Obsidian en `/brain`, menú de tres puntos por carpeta y página, diálogo de compartir con personas, niveles y acceso general. Plan: `docs/superpowers/plans/2026-10-07-etapa-17-3-arbol-compartir.md`. **Antes de desplegar:** aplicar la migración `20261008120000_brain_access_rule_fns` a producción primero (corriendo `npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después desplegar el código; al revés, el diálogo de compartir falla por falta de las funciones. Pendiente de verificar en navegador (no se pudo por falta de `.env.local` y login sembrado en el worktree): el recorrido del criterio de cierre a 1280 y 375 px, la persistencia del plegado en `localStorage` y la vista de un miembro. Ese chequeo, con el MCP real y el tenant `innovas`, lo hace una persona en producción después del despliegue.

**Terminado cuando:** en producción, un admin restringe una carpeta desde el diálogo y le da lectura a una persona; esa persona la ve en el árbol y por MCP, otro miembro no la ve en el árbol ni por `brain_search`, y tampoco se la saca al agente por el chat.

---

## Etapa 18 · Borrado de páginas y editor visual del brain — `[ ]`

**Modelo Claude Code:** Sonnet 5 en sesión nueva por entrega.
**Modelo runtime:** n/a.
**Specs:** `docs/superpowers/specs/2026-10-08-etapa-18-1-borrado-paginas-brain-design.md` y `docs/superpowers/specs/2026-10-08-etapa-18-2-editor-visual-brain-design.md` · **Plan:** por entrega (18.1: `docs/superpowers/plans/2026-10-08-etapa-18-1-borrado-paginas.md`; 18.2: `docs/superpowers/plans/2026-10-08-etapa-18-2-editor-visual.md`).

Agregada el 2026-10-08. Dos entregas, una sesión y un PR cada una:

- [x] **18.1 · Borrado de páginas.** Un administrador del nodo borra una página desde la web (menú del árbol y vista de la página), con limpieza de los links entrantes y sin papelera; el agente y el MCP no pueden borrar. Plan: `docs/superpowers/plans/2026-10-08-etapa-18-1-borrado-paginas.md`. **Antes de desplegar:** aplicar la migración `20261009120000_brain_delete_page` a producción primero (corriendo `npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después desplegar el código; al revés, el diálogo falla al borrar. Sin verificar en navegador (no se pudo por falta de `.env.local` y login sembrado en el worktree): orden y color del ítem en el menú, contenido del diálogo, redirección tras borrar, la vista de un miembro que no es administrador, 375 px y que el `AlertDialog` abierto desde el menú de la fila no deje `pointer-events` trabado. Ese recorrido, borrando una página enlazada desde otras dos, lo hace una persona en producción después del despliegue.
- [x] **18.2 · Editor visual y vista de papel.** Spec: `docs/superpowers/specs/2026-10-08-etapa-18-2-editor-visual-brain-design.md`. Plan: `docs/superpowers/plans/2026-10-08-etapa-18-2-editor-visual.md`. **Sin migración:** se despliega solo el código. Dependencias nuevas: paquetes de Tiptap 3.31.4, `marked` exacto y `happy-dom` (solo desarrollo). Prueba de ida y vuelta (`tests/brain/editor-roundtrip.test.ts`): pasaron 13 páginas reales y el corpus sintético; se aceptaron normalizaciones de estilo estables (relleno y líneas en blanco alrededor de las tablas, el escape `\[`, líneas en blanco consecutivas) que solo alcanzan a una página que una persona edita (si no toca el cuerpo, se guarda el original). Sin verificar en navegador (no se pudo por falta de `.env.local` y login sembrado en el worktree): entrada en edición o lectura según el rol, la barra de herramientas y su offset sticky `top-28`, las sugerencias de `[[` y la inserción del nodo, el menú de tabla, el interruptor de Markdown, la barra de guardado y su lugar junto al árbol, el flujo de conflicto y diff, Descartar, el layout a 375 px y el scroll de la barra, la hoja blanca en modo oscuro y la sensación de carga de `/brain/p` (medido con `next build`: JS inicial sin comprimir de 1,19 MB contra 0,65 MB del índice `/brain`, unos 540 KB más por Tiptap). No hay edición del alias o destino de un link existente desde la barra; se hace en la vista de código. Ese recorrido (los seis puntos del criterio de cierre de la spec §1) lo hace una persona en producción después del despliegue.

---

## Etapa 19 · "Conectá tus herramientas" y cierre en producción — `[ ]`

**Modelo Claude Code:** Sonnet 5 (UI y docs); Opus 5 solo si la verificación en producción destapa un defecto de permisos.
**Modelo runtime:** n/a.
**Spec/Plan:** `docs/superpowers/specs/2026-10-09-etapa-19-conectar-design.md` · `docs/superpowers/plans/2026-10-09-etapa-19-conectar.md`. Alcance en `docs/producto/plan-cierre-gap-2026-10.md` §2.

Agregada el 2026-10-09 (plan de cierre del gap, G2 y G6). Una página por usuario con lo que tiene disponible para conectar a Claude, ChatGPT, Claude Code, Codex o Cursor, con instrucciones copiables; y la verificación en producción que las etapas 17, 18 e ingreso por dominio dejaron pendiente.

- [x] Página `/<slug>/conectar`: brain, agentes habilitados, lugar reservado para el MCP de herramientas (Etapa 23). Solo lo que la persona puede usar.
- [x] Instrucciones por cliente MCP (Claude Code, claude.ai, ChatGPT, Codex, Cursor) con botón de copiar. Sin tokens: autentica el OAuth de Supabase.
- [ ] Probar claude.ai y ChatGPT contra el brain de `innovas` en producción; decidir si el brain expone `search`/`fetch` para ChatGPT. Lo corre una persona: anexo A de la spec.
- [x] Corregir `docs/guias/conectar-brain-por-mcp.md` (ya no es "solo admins escriben") y `docs/guias/conectar-agente-por-mcp.md`.
- [ ] Verificación en producción: criterio de cierre de la 17, recorrido de la 18, ingreso por dominio con una persona nunca invitada, "Confirm email" prendido en Supabase Auth, `PLATFORM_OWNER_TENANT_SLUG` en Vercel. Marcar 17 y 18 como `[x]`. Lo corre una persona: anexo A de la spec.
- [x] El canal MCP del agente chequea `tenant_agents.enabled` como el canal web.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** un `tenant_member` de `innovas` entra a la página, copia las instrucciones, conecta el brain desde claude.ai y desde ChatGPT y `brain_search` le responde su canon; y las etapas 17 y 18 figuran cerradas con su verificación en producción anotada.

---

## Etapa 20 · Login: Microsoft, imposición de métodos y bloqueo por persona — `[ ]`

**Modelo Claude Code:** Opus 5 para la spec (es auth); Sonnet 5 en sesión nueva para implementar.
**Modelo runtime:** n/a.
**Spec/Plan:** `docs/superpowers/specs/2026-10-09-etapa-20-login-design.md` · 20.1: `docs/superpowers/plans/2026-10-09-etapa-20-1-login.md` · 20.2: `docs/superpowers/plans/2026-10-09-etapa-20-2-usuarios.md`.

Agregada el 2026-10-09 (resto del G3 tras el PR #81). Completa el ingreso por dominio para un cliente del universo Microsoft y cierra los límites declarados en la spec del ingreso por dominio §6.

- [x] **20.1 · Login.** Microsoft como método (`microsoft`, proveedor `azure`), el método de la sesión derivado en la base (`current_login_method`), corte al entrar (`login_gate`) y chequeo en cada página, en la consola y en el chat (`tenant_allows_login`). **Antes de desplegar:** aplicar la migración `20261013120000_login_methods` a producción primero (corriendo `npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después desplegar el código; al revés, `login_gate` no existe y nadie puede entrar. Antes de desplegar, confirmar en producción que `auth_methods` del tenant dueño incluye el método con el que hoy entran los administradores de plataforma, y avisar que quien entraba por Google a una empresa que solo permite correo va a ser rebotado a su landing. Microsoft queda apagado hasta completar el anexo A de la spec (app en Entra con el claim `xms_edov`). Verificado en navegador contra la base local: ingreso por dominio abierto, corte al entrar con la sesión cerrada, corte en cada página con el aviso, y Microsoft visible en `/login` solo cuando una empresa lo tiene. Sin verificar: Google y Microsoft de punta a punta, que necesitan proveedor real; el rechazo del chat por HTTP, porque en desarrollo el canal acepta todo; y el chequeo de un administrador de plataforma en navegador.
- [x] **20.2 · Operación de usuarios.** Bloqueo por persona (`membership_blocks`, `block_member`, `unblock_member`), el dominio abierto no vuelve a unir a un bloqueado y una invitación levanta el bloqueo; una empresa no puede quedar sin administrador (trigger `memberships_keep_one_admin`); cambio de rol y reenvío de invitación desde `/settings/usuarios`. **Antes de desplegar:** aplicar la migración `20261014120000_member_blocks` a producción primero (corriendo `npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después desplegar el código; al revés, la pantalla de usuarios no muestra la sección "Bloqueados" (ignora el error de esa lectura) y bloquear o desbloquear falla porque `block_member` y `unblock_member` todavía no existen. Borrar de Auth a la única administradora de una empresa ahora falla hasta nombrar a otra. Verificado en navegador contra la base local: cambio de rol, selector que vuelve al rol real tras un error, único administrador protegido, bloqueo y desbloqueo con su evento, reenvío con vencimiento renovado y mail, y 375 px sin desborde. Sin verificar: una persona bloqueada intentando entrar con su sesión real (lo cubre pgTAP), y la vista de un administrador de plataforma.

**Terminado cuando:** en producción, una empresa de prueba con `auth_methods = {microsoft}` y modo abierto recibe a una persona con cuenta Microsoft de su dominio sin invitación; esa persona no puede entrar por Google desde `/login`; y una persona bloqueada no vuelve a entrar aunque el modo siga abierto.

---

## Etapa 21 · Configuración de la empresa desde la UI y segundo tenant — `[ ]`

**Modelo Claude Code:** Opus 5 para la spec (decide la frontera plataforma/tenant); Sonnet 5 en sesión nueva para implementar.
**Modelo runtime:** el que defina el tenant.
**Spec/Plan:** 21.1: `docs/superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md` · `docs/superpowers/plans/2026-10-10-etapa-21-1-consola-conectores.md`. 21.2: `docs/superpowers/specs/2026-10-10-etapa-21-2-settings-cliente-design.md` · `docs/superpowers/plans/2026-10-10-etapa-21-2-settings-cliente.md`. 21.3: `docs/superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md` · 21.3a: `docs/superpowers/plans/2026-10-10-etapa-21-3a-brain-como-fuente.md` · 21.3b: `docs/superpowers/plans/2026-10-10-etapa-21-3b-pantallas-outreach.md`. 21.4: `docs/superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md` · 21.4a: `docs/superpowers/plans/2026-10-11-etapa-21-4a-empresa-sin-agentes.md` · 21.4b: a escribir. 21.5: `docs/superpowers/specs/2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md` · `docs/superpowers/plans/2026-10-13-etapa-21-5-gasto-ia-por-empresa.md` 21.6: `docs/superpowers/specs/2026-10-14-etapa-21-6-dominio-por-empresa-design.md` · cierre en producción (checklist): `docs/superpowers/plans/2026-10-14-etapa-21-6c-cierre-en-produccion.md`. Alcance general en `docs/producto/plan-cierre-gap-2026-10.md` §2.

Agregada el 2026-10-09 (G4 y G7). Dar de alta y operar un cliente sin terminal: agentes, conectores, ejecutores y brain desde la consola de plataforma o el settings del tenant. La **Etapa 7** se corre dentro de esta como prueba.

Frontera decidida el 2026-10-10: cada cliente trae sus llaves y su administrador configura sus agentes; INNOV.AS ve el estado de todo y asocia las llaves que el cliente le pasa por un canal seguro (`docs/guias/llaves-de-clientes.md`). Cinco entregas:

- [ ] **21.1 · Consola: conectores y agentes.** Código terminado; falta el cierre en producción: revisar la migración con `migration list` y aplicarla, desplegar, apretar Verificar en cada conector de `innovas`, asociar un conector ColdIQ real y comprobar el rechazo entre empresas. Catálogo de agentes en código; alta de empresa eligiendo agentes; desde `/plataforma/<slug>`, habilitar agentes con su acceso al brain, crear el brain, asociar conectores con verificación contra Vercel, deshabilitar, quitar y verificar; "qué falta" por empresa; `connector_claims` impide que un conector sirva a dos empresas; `tenant_agents` cerrada a `authenticated`; `connections:bind` se va. **Antes de desplegar:** correr en producción la consulta de la spec §9 (ningún conector en dos empresas), aplicar la migración `20261015120000_platform_console` primero (`npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después el código; al revés, el alta de empresas falla. Después del deploy, apretar Verificar en cada conector de `innovas`.
- [ ] **21.2 · Settings del cliente.** Código terminado; falta el cierre en producción (anexo A de la spec: autorizar Gmail y HubSpot desde "Mis cuentas", comprobar que cargar la página no rompe un Gmail ya autorizado, que el dueño de HubSpot se guarda solo, que `auto` deja escribir al workflow y que un conector apagado por plataforma no se puede encender desde el cliente). El administrador del cliente edita ejecutores (con techo de 200 por día y sin poder quitar a quien tiene historial), elige la política de los pasos de nivel 2 y enciende o apaga los conectores que INNOV.AS asoció; cualquier miembro autoriza sus cuentas en `/<slug>/mis-cuentas`. Todo por funciones que verifican en la base que quien llama sea administrador de esa empresa. `executors:set` se va. **Antes de desplegar:** `npx supabase migration list` y aplicar `20261016120000_tenant_settings` antes que el código. Comprobar el punto del anexo A del dueño de HubSpot (el `crm_owner_id` se guarda solo al autorizar) antes de dar por cerrada la entrega; si HubSpot rechaza la consulta, usar el runbook "Cargar el owner de HubSpot a mano" de `docs/guias/llaves-de-clientes.md`.
- [ ] **21.3 · Configuración de outreach.** Código terminado; falta el cierre en producción. El ICP, los hooks y los vectores viven en el brain (bloques `icp`, `hooks` y `vectores` en las páginas de canon; guardar una página `canon:hooks` actualiza `config_values` sola). El administrador del cliente edita segmentos, idiomas, datos de outreach y procesos automáticos en `/<slug>/settings/outreach`, y ve su presupuesto y su gasto del día. INNOV.AS fija los presupuestos en `/plataforma/<slug>`. `outreach:config`, `workflows:set` y `tenants/innovas/outreach.json` se van. **Antes de desplegar:** pegar los bloques en las páginas de canon de `innovas` (spec §10 paso 1), con los niveles del ICP de `git show b5cf2b9:tenants/innovas/outreach.json` (último commit que todavía tiene el archivo; la rama lo borra) y **antes** de que alguien use "Guardar datos" en la pantalla, porque ese primer guardado borra la clave `icp` vieja de `config.outreach`; `npx supabase migration list` y aplicar `20261017120000_outreach_marco_reflect` y `20261018120000_outreach_settings` antes que el código. Después del deploy: "Releer del brain" en `/innovas/settings/outreach` y comprobar que no desactiva nada.
  - Verificado en navegador con la base local (empresa `demo`, usuarios de la semilla): como `platform_admin`, tope de modelos en `/plataforma/demo` ("2,5" rechazado con su mensaje, "2" guardado, "Gastado hoy" visible, créditos de búsqueda en 0); como `tenant_admin`, ICP con sus niveles desde una página `canon:icp` real, hooks y vectores, "Releer del brain" con contadores (repuso un vector borrado), alta, cambio de rótulo y baja de segmentos, rechazo de desactivar el único idioma o segmento, datos de outreach con BCC vacío (sigue vacío al recargar) y zona horaria inválida, encender `target-search` con el aviso "No va a correr…", ítems por encima del tope, presupuesto de hoy en `2,00`, "Última corrida" con fecha sin advertencia de hidratación, sin desborde horizontal a 375 px; como `tenant_member`, 404.
  - Sin verificar (necesita producción): el scoring leyendo el brain real de `innovas` y el reflejo de las páginas de canon sobre ese brain.
- [ ] **21.4 · Segundo tenant.** El segundo tenant es Lagomarsino, que usa solo el brain; el piloto de outreach de la Etapa 7 no aplica. **21.4a (código terminado; falta el cierre en producción):** una empresa puede no tener agentes (alta, aterrizaje en `/<slug>`, menú y pantallas según agentes habilitados), el brain nace sin canon de outreach y con categorías editables desde la consola, y el ingreso por correo acepta un código de 6 a 10 dígitos además del link (se verifica en el navegador y la server action `completeLogin(next)` devuelve el destino), el método de ingreso se exige también en el consentimiento OAuth y en el MCP del brain cuando el token nombra un método, y Conectar marca ChatGPT y Codex como probados. **Antes de desplegar:** `npx supabase migration list`, aplicar `20261019120000_agentless_tenant` antes que el código y pegar las plantillas `supabase/templates/magic_link.html` y `confirmation.html` en el panel de Supabase Auth. **Después del deploy:** verificar en producción el `otp_length` de Supabase Auth (el código acepta de 6 a 10 dígitos; el de la plantilla tiene que coincidir con lo que muestra el correo) y que `/innovas` siga cayendo en el chat. **21.4b:** alta de Lagomarsino desde el navegador, cronometrada.
- [ ] **21.5 · Gasto de IA por empresa.** Mergeada (PR 100, v0.3.0) y desplegada; **cierre en producción a medias (2026-10-14):** ya están aplicadas las cuatro migraciones pendientes con `db push` (`20261020120000_brain_skills`, `20261021120000_asistente_agent`, `20261022120000_skill_packages_bucket` y `20261023120000_spend_report`, con la confirmación del dueño por lo ajeno), el remoto quedó alineado con el local y los permisos de las dos funciones salieron como en local; con eso el Asistente quedó habilitado en las empresas con brain (`innovas`, `lagomarsino`, `okeefe`). **Falta, con acceso a producción:** mandar un mensaje por el chat de `innovas` y comprobar los asientos `agent/step` (hoy no hay ninguno); ver en los logs del AI Gateway el tag `tenant:innovas` con su `sessionId`; confirmar que el reporte del gateway acepta la credencial del deploy (en local respondió); al día siguiente, conciliar en `/plataforma/gasto`; y revisar los límites diarios de `model_usd`: los de hoy son de un dígito de dólares por día, y desde ahora el chat suma contra ellos sin cortarse, así que un chat largo puede frenar a dispatch y followups. `explain` de `platform_spend_report`: con 14 filas hace seq scan, se repite con volumen para confirmar que usa `usage_entries_model_usd_created_idx`. Detalle de lo construido: **Antes de desplegar:** `npx supabase migration list` y aplicar `20261023120000_spend_report` antes que el código; confirmar en Vercel que el equipo tiene Custom Reporting. **Después del deploy:** mandar un mensaje por el chat de `innovas` y comprobar los asientos `agent/step`; revisar el límite diario de `model_usd` de cada empresa, porque el chat (incluido el del Asistente) ahora suma contra él y, como el chat nunca se corta, cualquier miembro puede agotar el límite del día y frenar el despacho y los seguimientos: hay que redimensionar los límites después de tres días de libro; al día siguiente, conciliar. Cambio de alcance del 2026-10-13: se descarta la clave del AI Gateway por cliente y se usan tags (`tenant:<slug>`), sin tope duro ni revocación por cliente en el gateway. Los pasos del agente en el chat empiezan a asentar en `usage_entries` (hoy quedan afuera) y cuentan contra el mismo límite diario de `model_usd`. El cliente ve su mes en curso y el anterior en `/<slug>/settings/gasto`; INNOV.AS ve a todas las empresas en `/plataforma/gasto` y concilia el libro contra el gateway a pedido. **Verificado en el navegador contra la base local (2026-10-14):** `/<slug>/settings/gasto` da 404 a un `tenant_member` y el total, el desglose por origen y por día y el mes anterior salen bien para un `tenant_admin`; el link "Gasto →" aparece en la configuración y a 375 px no hay desborde; `/plataforma/gasto` da 404 sin sesión de plataforma y lista las empresas con hoy, mes y mes anterior; el botón de conciliar llegó al AI Gateway real desde local y devolvió un reporte (en el mes anterior, US$ 14,89 sin etiqueta, tráfico previo a los tags). **Falta verificar solo en producción:** que el chat asiente `agent/step`, que el tag conserve el `sessionId` en los logs del gateway y la conciliación de un día cerrado. **Al cerrar, además:** la 22.1 ya entró y el asistente también sale etiquetado y asentado (`tenantModel` usa `modelSelection` y cada agente exporta `usageHook()`; lo exige `tests/agents/usage-wiring.test.ts`); si la migración de la 22.1 (`20261021120000_asistente_agent`) todavía no se aplicó en producción, `db push` pide `--include-all` por ser anterior a `20261022120000`; revisar `meta.model` y `meta.source` de los `agent/step` reales; ver si el team de Vercel tiene otro tráfico por el gateway (evals, scripts, previews) antes de juzgar "Sin etiqueta"; y poner la fecha real del deploy en el pie de `/<slug>/settings/gasto`.
- [ ] **21.6 · Dominio propio por empresa.** Cada empresa puede servirse desde su dominio (`ia.cliente.com`, un CNAME a la plataforma) y todo lo que la plataforma le muestra o le manda sale con ese dominio: la app completa, las URLs de conexión por MCP (`/brain/mcp` sin slug y `/eve/outreach/v1/mcp`, con su metadata OAuth), `/conectar` y los links de invitación y de link mágico. Spec escrita el 2026-10-14 (reemplaza la idea original de subdominio por cliente, que no oculta INNOV.AS); el host decide la empresa con `proxy.ts` y una tabla `tenant_domains`, `app/[tenant]` no cambia. Caso de referencia: `ai.okeefe.com.ar/login`, `/chat` y `/brain/mcp`, con URLs limpias (sin el slug). Tres cortes: **21.6a** tabla `tenant_domains`, resolución de host, proxy y URLs de MCP; **21.6b** consola, alta en Vercel y en las Redirect URLs de Supabase por API, y links de correo; **21.6c** cierre en producción. **21.6a (código terminado en `feat/etapa-21-6a-resolucion-de-host`; falta el cierre en producción):** tabla `tenant_domains` y `resolve_tenant_by_host`, `proxy.ts` con URLs limpias (308 desde las que llevan slug), URLs de MCP por request (`/brain/mcp`, desafío 401 del agente con `mcpChallenge`) y `/conectar` según el host. Verificado en navegador contra `okeefe.localhost` (login, `/chat`, `/conectar`, `/brain/mapa`, navegación del cliente sin recarga) y con `curl` el MCP y su metadata. **Antes de desplegar:** `npx supabase migration list`, aplicar `20261024120000_tenant_domains` antes que el código (sin la función, el proxy da 503 solo en los hosts de empresa; el host raíz no depende de la base). **Después del deploy:** verificar en Vercel que `x-forwarded-host` llegue al canal MCP del agente (spike S1) y, con el primer dominio real, el login por link mágico y por Google (S4). Decididas el 2026-10-14: el host raíz sigue siendo `agentes.innov.as`, sin subdominio por cliente, y solo plataforma carga dominios. Límite declarado: el consentimiento OAuth del MCP sigue en el host raíz (Supabase tiene una sola Site URL). **21.6b (código terminado en `feat/etapa-21-6b-operacion-de-dominios`, apilada sobre la 21.6a; falta el cierre en producción):** sección Dominio en `/plataforma/<slug>` (agregar, verificar, principal y quitar, con las instrucciones de DNS que devuelve Vercel), línea de solo lectura en `/<slug>/settings`, adaptadores de la API de Vercel y de la Management API de Supabase (la lista de Redirect URLs se conserva, se relee y un dominio no se activa si Supabase no la guarda), barrido `domain-sweep` cada 10 minutos y links de invitación con el dominio de la empresa. Verificado en navegador contra la base local; **los adaptadores no se probaron contra las APIs reales** (solo `fetch` simulado contra los contratos de la documentación). **Antes de activar el primer dominio real:** cargar en Vercel (Production) `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `SUPABASE_ACCESS_TOKEN` y `SUPABASE_PROJECT_REF`, y probar un `PATCH` de `uri_allow_list` en un proyecto que no sea el de producción (la doc no dice cómo separa las entradas).

**Terminado cuando:** un platform_admin da de alta una empresa, le habilita agentes y conectores, y un tenant_admin de esa empresa configura ejecutores y aprobaciones, todo desde el navegador; y el piloto del segundo tenant corre sin cambios de código.

---

## Etapa 22 · Catálogo de agentes y permisos de uso por agente — `[ ]`

**Modelo Claude Code:** Opus 5 para la spec (toca el modelo de permisos); Sonnet 5 en sesión nueva para implementar.
**Modelo runtime:** el del tenant; el segundo agente define los suyos en su spec.
**Spec/Plan:** 22.1: `docs/superpowers/specs/2026-10-13-etapa-22-1-chat-multiagente-design.md` · `docs/superpowers/plans/2026-10-13-etapa-22-1-chat-multiagente.md`. 22.2: a escribir. Alcance en `docs/producto/plan-cierre-gap-2026-10.md` §2.

Agregada el 2026-10-09 (G5). Partida el 2026-10-13 en dos entregas: **22.1**, un chat para todos los agentes y el agente Asistente (solo brain); **22.2**, permisos de uso por agente y reglas de acceso generalizadas. Más de un agente, catálogo por empresa, selector en el chat, y permisos de quién puede usar cada agente. Decisión central: generalizar las reglas del brain a reglas de acceso a recursos (`brain | agent | connection`), que la Etapa 23 reusa.

- [x] Registro de agentes en código (`AGENT_CATALOG`: nombre, descripción, `chat`, `requiresBrain`, `canon`, `mcp`) con test que falla si una carpeta de `agents/` no está registrada. El nivel máximo de efecto por agente queda pendiente: el catálogo no lo tiene.
- [ ] Segundo agente real (candidato: inbound de la Etapa 10, o el que tenga un cliente esperándolo; se elige en el brainstorming). Para la 22.1 es `asistente` (solo brain), en código y con su migración; falta el cierre en producción.
- [x] Chat con selector de agente e hilos por agente.
- [ ] Reglas de acceso generalizadas y permisos de uso por agente (persona o todos los miembros; usar o ninguno). El agente como principal con reglas propias sobre el brain reemplaza `config.brain` (pendiente de la spec 17 §9).
- [ ] Página de la 19, chat y canal MCP muestran y aceptan solo los agentes permitidos.
- [ ] `/ship` + `/context-save`.

**Antes de desplegar (22.1):** `npx supabase migration list` (`db push` aplica todas las pendientes: confirmar las ajenas), desplegar primero el código y recién después aplicar `20261021120000_asistente_agent`. Con el código nuevo y sin la fila, el Asistente existe y nadie lo tiene habilitado; con la migración primero, el código viejo (`lib/connect/connectables.ts`, `app/[tenant]/settings/page.tsx`) mostraría el agente `asistente` fuera de su catálogo, con una URL MCP que no existe. Orden corregido el 2026-10-13 en la revisión final (antes decía migración primero). **Después del deploy:** en `innovas`, abrir un hilo con Asistente, pedirle que liste sus herramientas (tienen que ser `brain_search`, `brain_read` y `brain_upsert`) y confirmar el `run` con `agent = 'asistente'`; abrir un hilo de outreach y confirmar que la firma aparece en la tarjeta del mail; en una empresa solo con brain, confirmar que `/<slug>` cae en el chat sin selector y que su brain no recibió páginas de canon; probar que una conversación de un agente abierta por la ruta del otro da 401, mirar el chat a 375 px, y entrar como `tenant_member` con una carpeta del brain restringida para confirmar que el Asistente no la ve. El chat no tiene tope de presupuesto: el gasto de modelos de una empresa solo con brain lo paga INNOV.AS hasta la 21.5; se apaga desde `/plataforma/<slug>`.

**Terminado cuando:** una empresa tiene dos agentes habilitados; un admin le da uso de uno solo a una persona; esa persona lo ve en el chat, en la página de conexión y por MCP, y el otro no aparece ni responde por ningún canal.

---

## Etapa 23 · MCP de herramientas por tenant con permisos — `[ ]`

**Modelo Claude Code:** Fable 5.1 u Opus 5 `high` para la spec (auth, credenciales, efectos); Sonnet 5 en sesión nueva para implementar.
**Modelo runtime:** n/a (no hay modelo del lado de la plataforma; las tools las llama el cliente MCP de la persona).
**Spec/Plan:** a escribir. Decisiones a cerrar en `docs/producto/plan-cierre-gap-2026-10.md` §2.

Agregada el 2026-10-09 (G1, el gap más grande). Tercera superficie MCP, construida como la del brain sobre `@modelcontextprotocol/sdk` y el mismo emisor OAuth, que publica las tools de las conexiones del tenant que la persona tiene permitidas, ejecuta con su propia cuenta cuando el proveedor es OAuth (subject `tenant:usuario` de Vercel Connect) y respeta los niveles de efecto. `mcpChannel` de eve no sirve para esto: expone solo `agent_*` por diseño.

- [ ] Spec con las cinco decisiones: dónde vive, cómo ejecuta (directo contra los proveedores o vía definiciones de eve), qué tools se publican y con qué nivel de efecto (nivel 3 no se expone; nivel 2 solo con política `auto`), credenciales por persona con link de autorización, uso en `usage_entries` y rate limit.
- [ ] Endpoint, metadata OAuth en `.well-known`, consentimiento reusado.
- [ ] Reglas de acceso por conexión desde la UI (diálogo de compartir del brain, adaptado).
- [ ] Página de la 19 completa con el MCP de herramientas y las tools que esa persona va a ver.
- [ ] Tests de aislamiento entre tenants y entre personas, como los del brain.
- [ ] `/ship` + `/context-save`.

**Terminado cuando:** desde su claude.ai, una persona de `innovas` conecta el MCP de herramientas, ve solo las tools de HubSpot de lectura que le dieron, busca un contacto con su propia cuenta de HubSpot, y otra persona sin ese permiso no ve esas tools; cada llamada aparece en `usage_entries`.

---

## Etapa 24 · Skills de empresa — `[ ]`

**Modelo Claude Code:** Opus 5 para las specs (toca permisos del brain y ejecución de código); Sonnet 5 en sesión nueva para implementar.
**Modelo runtime:** n/a en la 24.1 y la 24.2 (no hay modelo del lado de la plataforma); el del agente en la 24.3.
**Spec/Plan:** 24.1: `docs/superpowers/specs/2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md` · Plan: `docs/superpowers/plans/2026-10-11-etapa-24-1-skills-paquete-publicacion.md`. 24.2a: `docs/superpowers/specs/2026-10-13-etapa-24-2a-skills-por-mcp-design.md` · Plan: `docs/superpowers/plans/2026-10-13-etapa-24-2a-skills-por-mcp.md`. 24.2b: `docs/superpowers/specs/2026-10-14-etapa-24-2b-paquete-por-mcp-design.md` · Plan: `docs/superpowers/plans/2026-10-14-etapa-24-2b-paquete-por-mcp.md`. 24.2c, 24.3 y 24.4: a escribir.

Agregada el 2026-10-11. Que cada empresa publique en su brain skills para sus empleados (procedimiento en markdown más scripts y plantillas, formato Agent Skills) y que se usen, siempre en su última versión publicada, desde el chat de la plataforma y desde Claude, ChatGPT o Codex. Frontera decidida: el agente define qué se puede hacer (tools con nivel de efecto); la skill define cómo se hace una tarea en esa empresa y nunca agrega una tool ni un permiso. Los scripts son cómputo puro, sin red ni credenciales. Seis entregas (la 24.2 se partió en dos el 2026-10-13 y se reordenó el 2026-10-14):

- [ ] **24.1 · Paquete y publicación.** Código terminado; falta el cierre en producción (spec §12). Categoría `skill` bajo `skills/`, archivos por hash en un bucket privado, versión publicada inmutable, revisión y publicación por un administrador de la empresa, republicar y retirar. Las tools del brain dejan afuera `skills/`. Depende de la 21.4 (categorías editables desde la consola).
- [ ] **24.2a · Skills por MCP: listar, cargar y descargar.** Código terminado; falta el cierre en producción (spec §10). Tools `skill_list`, `skill_load` y `skill_file` en el MCP del brain, siempre desde la versión publicada y según los permisos de la persona; la descripción de `skill_load` lista sus skills. Solo archivos de texto por MCP. Descarga del zip publicado desde la web. Evento `brain.skill_loaded`. Sin migración.
- [ ] **24.2b · Paquete completo por MCP y skills en `/conectar`.** Código terminado; falta el cierre en producción (spec §13). Cambió de alcance el 2026-10-14: por MCP ejecuta el cliente, no la plataforma. Tool `skill_package` que devuelve un link firmado de 10 minutos al zip publicado (guardado por digest en un bucket privado), la descarga web redirige a ese zip, evento `brain.skill_package_issued`, y la sección "Tus skills" en `/conectar`. Una migración (el bucket).
- [ ] **24.2c · Dependencias entre skills.** Una skill usa archivos de otra (el caso: la plantilla de `identidad-de-marca`). Se resuelve a la última publicada al usarla; quien ve la skill pero no su dependencia la usa igual, solo para ese uso; aviso al publicar; las dos versiones en el registro. Decisiones en la spec de la 24.2b §12.
- [ ] **24.3 · Skills en el chat interno.** Va **después de la Etapa 22**: las skills de la empresa resueltas por persona como skills dinámicas de eve, con sus archivos en el sandbox de la sesión, sobre cualquier agente. El asistente general (brain, sandbox y skills, sin tools de dominio) es el candidato a segundo agente de la 22. Acá se construye el sandbox propio (Vercel Sandbox sin red, lista fija de bibliotecas, archivos de salida guardados 30 días con link con sesión, nodo nivel 0 con asiento en `usage_entries`): decisiones en la spec de la 24.2b §12.
- [ ] **24.4 · Ejecutar por MCP del lado de la plataforma.** `skill_run` sobre el sandbox de la 24.3, para que claude.ai y ChatGPT web también corran siempre la última versión sin subir el zip a mano.

**Terminado cuando:** un administrador de `innovas` publica una skill con un script; una persona con acceso la corre desde un cliente con salida a internet (Claude Code, Codex o Cursor) y desde el chat de la plataforma; el administrador publica un cambio y la corrida siguiente, por los dos caminos, usa la versión nueva sin que la persona haga nada; y otra persona sin acceso a esa carpeta no la ve por ningún canal. En claude.ai y ChatGPT web la persona sube el zip a mano hasta la 24.4 (límite aceptado el 2026-10-14).

---

## Etapa 25 · Wiki de documentación y harness — `[x]`

**Modelo Claude Code:** Fable 5.1 para spec y plan; Sonnet 5.5 para ejecutar.
**Modelo runtime:** n/a.
**Spec/Plan:** `docs/superpowers/specs/2026-10-13-etapa-25-wiki-documentacion-design.md` · `docs/superpowers/plans/2026-10-13-etapa-25-wiki-documentacion.md`.

La documentación del repo pasa a ser una wiki en `docs/` (arquitectura, dominios, guías, referencia generada, decisiones y producto) con un harness que se pone rojo cuando una tool, nodo, workflow, tabla, ruta, proveedor, variable de entorno, spec o PR mergeado no dejó rastro. El skill `/docs-wiki` es el procedimiento para cerrarlo.

- [x] Fase 0: esqueleto, documentos movidos con `git mv`, `docs/guias/documentar.md`.
- [x] Fase 1: inventario, `npm run docs:sync`, tests de forma y de cobertura.
- [x] Fase 2: README con instalación, `docs:prs`, skill `/docs-wiki`, `VERSION`, `CHANGELOG.md`. El CI quedó afuera hasta habilitar GitHub Actions (contenido en el plan, Task 24).
- [x] Fase 3: tablas de specs y PR, quince páginas de arquitectura y dominios, siete guías nuevas.
- [x] Fase 4: prueba del detector, `/ship` (PR 92, versión 0.1.0).
- [ ] Seguimiento: repetir el README con Docker abierto (el ingreso local por Mailpit no se probó). No bloquea el cierre.
- [ ] Seguimiento: decidir si `.codex/` entra al repo y, cuando se habilite GitHub Actions, sumar el CI (contenido en el plan, Task 24).

**Terminado cuando:** alguien que no conoce el repo levanta la plataforma en local siguiendo solo `README.md`; `npm run docs:check` está verde en `main`; una tool, una tabla y una ruta falsas hacen fallar el check nombrándolas; y `/ship` deja `VERSION` y `CHANGELOG.md` escritos.

---

## Etapa 26 · Carpetas, reglas y estructura del brain — `[ ]`

**Modelo Claude Code:** Opus 5.5 para spec y planes; Sonnet 5.5 para ejecutar, en sesión nueva por entrega.
**Modelo runtime:** n/a.
**Spec:** `docs/superpowers/specs/2026-10-14-etapa-26-carpetas-y-reglas-brain-design.md` · **Plan:** por entrega. 26.1a: `docs/superpowers/plans/2026-10-14-etapa-26-1a-carpetas.md` (cerrada). 26.2a: `docs/superpowers/plans/2026-10-14-etapa-26-2a-reglas-nucleo.md`. 26.1b (mover y renombrar), 26.2b (reglas en el editor) y 26.3, a escribir.

Agregada el 2026-10-14 a pedido de Matías, a partir del brain de O'Keefe: las categorías sin páginas no aparecían, no había forma de renombrarlas ni de crear subcarpetas desde el brain, y las instrucciones del brain y las reglas por carpeta (`operacion/agent`, `operacion/brain`, `talento/personal/00-reglas`) no las lee ni el chat ni el MCP. Tres entregas, cada una depende de la anterior:

- [ ] **26.1 · Carpetas.** Las carpetas pasan a ser filas (`brain_folders`), la categoría es el primer segmento de la ruta, se ven vacías, y un administrador las crea, renombra, mueve y borra (vacías) desde el árbol. Mover y renombrar reescriben los enlaces y dejan alias de las rutas viejas. Reemplaza la lista de categorías de la consola.

  **Orden de despliegue de la 26.1a.** La migración `20261025120000_brain_folders` va **antes que el código**, y el código sale enseguida. Mientras siga vivo el código viejo con la migración aplicada, el "Guardar" de las categorías en la consola falla porque la migración borra `platform_set_brain_categories` (lo ven solo los administradores de plataforma, los minutos que tarde el deploy), y un `createBrain` viejo deja un brain sin filas de carpetas. Al revés es peor: con el código nuevo y sin la migración, `listFolders` en `loadEditorContext` lee una tabla que no existe, el índice y el árbol del brain se rompen en todas las empresas, no se pueden escribir páginas nuevas en subcarpetas y `createBrain` falla. Pasos: correr `npm run brain:folders-report` **sin `--tenant`** con el env de producción, porque el backfill corre para todas las empresas con brain y un bloqueante en cualquiera aborta el `db push` (sale con código 2 si hay bloqueantes: slugs con `/` cuyo primer segmento empieza con un número, pasa de 41 caracteres o es `skill`, o entradas inválidas en `config.categories`; una persona los renombra antes; el reporte nunca se corrió contra una base real); `npx supabase migration list` (porque `db push` aplica todas las pendientes); aplicar la migración y desplegar el código de inmediato.
  **Estado de la 26.1a.** Mergeada (PR 108) y en producción, con la migración `20261025120000_brain_folders` aplicada el 2026-10-14.
  **Pendientes de la 26.1a.** QA en navegador: menú de carpetas, diálogos, índice con carpeta vacía y `?carpeta=`, ancho 375 px, pointer-events del body tras cerrar un diálogo. Cargar la descripción de las ocho categorías de O'Keefe (sale de la tabla "Categorías" de `operacion/brain`). Seguimientos conocidos: acción de plataforma "recrear carpetas" si `createBrain` deja un brain sin carpetas; "Borrar" deshabilitado con el motivo cuando la carpeta no está vacía (spec §3.2); el selector de categoría del editor sigue ofreciendo una categoría que el servidor pisa con la de la ruta; carrera angosta en `brain_ensure_folders`. Mover y renombrar quedan para la 26.1b.
- [ ] **26.2 · Instrucciones y reglas.** `00-reglas` en la raíz y en cada carpeta, en cascada. Llegan solas al chat y al MCP; `brain_rules` nueva; `brain_upsert` exige `rulesRevision` y devuelve la cascada al rechazar.

  Se parte en dos. **26.2a (núcleo):** reservadas, cascada, `brain_rules`, `rulesRevision` en el MCP y en las tools del agente, instrucciones del brain al arrancar el chat y el MCP; sin migraciones; plan `docs/superpowers/plans/2026-10-14-etapa-26-2a-reglas-nucleo.md`. **Estado de la 26.2a:** código terminado en `feat/etapa-26-2a-reglas`, sin mergear y sin desplegar: no está en producción; falta el cierre. No tiene migraciones: se despliega solo el código. **Antes del deploy**, correr `npm run brain:rules-report` sin `--tenant` con el env de producción, para saber qué empresas y carpetas van a empezar a pedir `rulesRevision` (en una empresa con `00-reglas` en la raíz, toda escritura por MCP queda sujeta a reglas). **Después del deploy**, verificar la lista real de tools del agente en producción (memoria del repo: una tool nueva puede quedar invisible) y avisar a quienes usan el brain por MCP (conectores de Claude Desktop o Claude Code) que reconecten: un cliente con el `tools/list` viejo en caché no tiene el campo `rulesRevision` ni la tool `brain_rules`, y queda en un bucle de `rules_required`. **Pendientes de la 26.2a:** correr el eval `agents/asistente/evals/instrucciones-brain.eval.ts` (nunca se ejecutó); etiquetas de `brain_search`, `brain_read` y `brain_upsert` en `TOOL_LABELS` y test contra las claves reales; `requireRules` chequea visibilidad y no nivel `editor` (un lector hace un viaje de más hasta el `forbidden`); en el `brain_upsert` del MCP las reglas se leen antes del limitador; chequear `administrador` sobre la carpeta al borrar una reservada; la aprobación del agente ocurre antes de un `rules_required`. Detalle en [brain](../dominios/brain.md). **26.2b (pantallas):** panel "Reglas que aplican", menú "Instrucciones del brain" y "Reglas de la carpeta", indicador en el árbol e insignia en la búsqueda; plan a escribir.
- [ ] **26.3 · Estructura obligatoria.** Campos declarados en un bloque `campos` de la `00-reglas`, validados en el `frontmatter` al escribir; plantilla por carpeta en `00-plantilla`; vista de cumplimiento.

**Terminado cuando:** en `okeefe`, se ven las ocho categorías aunque estén vacías y un renombre real deja los enlaces bien; por MCP, una escritura en `talento/personal` sin reglas leídas se rechaza con la cascada y la segunda entra; y una ficha sin `reporta_a` se rechaza (spec §1.2).

---

## Fuera de etapas · Sync entrante de HubSpot — `[ ]`

Agregada el 2026-09-28. Hasta ahora la relación con HubSpot era solo de salida: si alguien borraba un contacto duplicado a mano en HubSpot, o reasignaba el owner, o dejaba una nota directo ahí, la base local nunca se enteraba — y un `crm_id` apuntando a un contacto borrado rompía el próximo intento de avanzar etapa o mandar un mail. El nodo `outreach/crm-sync` corre dos veces al día: limpia el `crm_id` huérfano, corrige el owner local si cambió en HubSpot, y refleja en el historial las notas agregadas a mano allá. El sync de `stage`/`dealstage` y los webhooks nativos de HubSpot quedaron fuera de esta pasada — ver la spec para el porqué. Implementado y revisado; falta su primera corrida real en producción y correr `npm run db:reset`/`npm run db:types` (necesitan Docker, no disponible en el entorno donde se construyó esto).

**Spec/Plan:** `docs/superpowers/specs/2026-09-27-hubspot-crm-sync-design.md` · `docs/superpowers/plans/2026-09-27-hubspot-crm-sync.md`

**Terminado cuando:** un contacto borrado en HubSpot deja de romper el próximo envío o avance de etapa (el `crm_id` se limpia solo), un owner reasignado en HubSpot se refleja localmente, y una nota agregada a mano en HubSpot aparece en el historial de `/contactos` — todo sin intervención manual, dos veces al día.

---

## Riesgos a vigilar en cada etapa (kickoff §9)

- eve en preview → pin de versión, releer `node_modules/eve/docs` en cada upgrade.
- Gmail por Vercel Connect → spike en Etapa 0, fallback documentado.
- HubSpot MCP remoto → si la app tarda en aprobarse, arrancar con Private App token y migrar después.
- Fuga entre tenants → tests de RLS desde Etapa 1.
- Acoplamiento a `innovas` → en cada PR: "¿esto funciona para un tenant que no es INNOV.AS?". Etapa 7 es la prueba real.
