---
title: INNOV.AS Agents Platform — Kickoff por etapas
estado: v2, listo para arrancar el repo desde cero
fecha: 2026-09-11
autor: Mati + Claude (sesión de planificación)
repo_destino: github.com/<org-innovas>/innovas-agents
---

# INNOV.AS Agents Platform — Kickoff

Plataforma multi-tenant de agentes durables que **INNOV.AS opera para sus clientes**. Cada cliente es un tenant con sus agentes, sus conexiones (CRM, brain, fuentes) y su gente. **`innovas` es el primer tenant**, al mismo nivel que cualquier otro: es el conejillo de indias con el que se arma y prueba todo, no un caso especial en el código. Nada del esquema, de los roles ni de las tools puede asumir "esto es INNOV.AS".

Primer entregable: **agente de outreach del tenant `innovas`** con dashboard de seguimiento, escribiendo en HubSpot.

Este documento está pensado para pegarlo en `docs/00-kickoff.md` del repo nuevo y para que Claude Code lo lea antes de tocar nada. Está organizado en **etapas ejecutables**, cada una con objetivo, entregables, criterio de terminado, y el **modelo de Claude sugerido para correrla** (ver §3 para la lógica de elección).

---

## 1. Decisiones tomadas

| Tema | Decisión | Por qué |
|---|---|---|
| Runtime de agentes | **eve** (Vercel), aunque esté en preview | Sesiones durables, aprobaciones humanas con pausa y reanudación, schedules como Vercel Cron, conexiones MCP/OpenAPI con credenciales que el modelo no ve, canal MCP para exponer agentes a Claude/ChatGPT. Reemplaza a n8n como orquestador para todo lo nuevo. |
| App / dashboard | **Next.js 15 App Router** con `withEve({ agents })` | Un deploy sirve dashboard y agentes; chat web con `useEveAgent`. |
| Base de datos | **Supabase**, proyecto nuevo `innovas-agents` | Postgres + Auth + RLS + Realtime + Storage. Supabase Auth es además servidor OAuth 2.1 con registro dinámico de clientes: cubre el login del dashboard y la conexión de Claude/ChatGPT al canal MCP. Sin Clerk. Neon solo gana en branching por preview; no alcanza. |
| Modelos de los agentes | **Vercel AI Gateway**, string `proveedor/modelo` | Default por agente y por tenant en base; selector en el chat estampado en la sesión. Cambiar modelo no requiere deploy. |
| Superficie de chat | **Chat web en el dashboard** primero | Slack/WhatsApp/Telegram después vía `chatSdkChannel` (Chat SDK), mismo agente. |
| Canal del primer agente | **Email desde la casilla de cada ejecutor** (Gmail vía Vercel Connect, Custom OAuth) | Automatizable de punta a punta con cola de aprobación; entregabilidad de casilla real. LinkedIn queda como cola asistida. |
| CRM | **Por tenant, como conexión MCP.** `innovas` → **HubSpot** (MCP remoto oficial `mcp.hubspot.com`) | El Atomic CRM ya no existe. El agente escribe contactos, notas y atribución de outreach en el CRM del tenant; la plataforma guarda solo lo operativo (cola, eventos, runs). Otro tenant puede traer Tokko, Pipedrive o una planilla sin tocar código. |
| Prospectos | Lista propia (CSV) + **Apollo** + ColdIQ + Google Places | La lista propia destraba el primer envío. Apollo es la fuente del pipeline de GTM (Etapa 13); ColdIQ y Places quedan disponibles por el mismo `LeadsAdapter`. |
| Brain | Capacidad `brain` con proveedor `wiki` sobre Supabase, editable por el cliente; proveedor `mcp` para gbrain u otros | `brain_search`, `brain_read`, `brain_upsert` como tools propias del agente. Spec 2026-09-13-brain-design. |
| Tenancy y acceso | Multi-tenant desde el día uno; entran el equipo de INNOV.AS y gente de cada cliente | Roles `platform_admin` (INNOV.AS opera la plataforma), `tenant_admin`, `tenant_member`. RLS por `tenant_id`. |
| Código | Repo nuevo, aislado de `innovas/site` y de cualquier otro repo | Se integra por MCP/API, nunca por import. |
| Outreach | El plugin `innovas-outreach` de Claude Code aporta el canon y el proceso | Se incorpora en la etapa 3 cuando Mati lo pase; hasta entonces se usa el diseño de referencia (§5). |

## 2. Arquitectura

```
                     ┌──────────────────────────────────────────────────┐
   Navegador ──────► │  Next.js 15 (Vercel)                             │
   (dashboard,       │  /app/[tenant]/chat · cola · pipeline · contactos│
    chat web)        │  · cuentas · metricas · settings                 │
                     │  withEve({ agents: { outreach, ... } })          │
                     │   └── /eve/agents/<agente>/eve/v1/*  ◄── Claude / ChatGPT (canal MCP, etapa 6)
                     └───────────────┬──────────────────────────────────┘
                                     │ eve runtime: Vercel Workflow · Cron · Sandbox
     ┌───────────────────────────────┼──────────────────────────────────┐
     ▼                               ▼                                  ▼
Supabase innovas-agents      Conexiones dinámicas por tenant       Vercel Connect
Postgres + Auth + RLS        (defineDynamic en session.started)    └─ google-gmail (Custom OAuth,
Realtime + Storage           tenant innovas:                          token por usuario)
tenants · memberships        ├─ crm      → HubSpot MCP (mcp.hubspot.com)
executors · config_values    ├─ brain    → wiki en Supabase (tools propias)
accounts · contacts          ├─ coldiq   → ColdIQ MCP
events · queue_items · runs  └─ places   → Google Places (OpenAPI)
```

**Un agente, N tenants.** El agente `outreach` es uno solo en `agents/outreach/`. Lo que cambia por tenant se resuelve en runtime desde la base: modelo default, instrucciones, conexiones (CRM, fuentes), brain, ejecutores y cupos. eve lo soporta con `defineDynamic` para modelo, instrucciones, tools, conexiones y subagentes. Un tenant nuevo es una fila en `tenants` más su canon en el brain, no una carpeta de código.

Principios:
1. **El agente es el centro, los canales son puertas.** Chat web, MCP, y después Slack o WhatsApp llegan al mismo agente con las mismas tools y aprobaciones.
2. **El modelo nunca ve credenciales.** Todo pasa por `connections/` de eve o por Vercel Connect.
3. **Aprobación según el efecto, en cuatro niveles** (enmienda de la Etapa 12, spec `2026-09-20-orquestacion-plataforma-design.md` §7). Nivel 0, solo la base propia: corre solo. Nivel 1, gasta plata de terceros: corre solo con presupuesto. Nivel 2, escribe en sistemas del tenant (crear contacto en el CRM, crear deal): política por tenant, default `always`. Nivel 3, le llega a una persona de afuera (enviar un mail): aprobación humana siempre, con una única excepción por tenant + canal + tipo que nace apagada. Reemplaza la regla anterior, "todo efecto externo con aprobación", que leída literal impedía cualquier trabajo desatendido. La regla operativa de `CLAUDE.md` cambia junto con el código de la Etapa 12, no antes.
4. **Append-only para la verdad.** `events` no se edita; `contacts` y `queue_items` son estado derivado.
5. **El canon del tenant vive en su brain; los procedimientos, en skills estáticas del agente.** Las skills de `agents/outreach/skills/` dicen qué leer y el agente lo lee con `brain_search` por tags de canon. Sin `sync-brain` ni `tenants/<slug>/skills/` (spec brain B5).
6. **Nada especial para `innovas`.** Si una decisión solo sirve para INNOV.AS, va a datos del tenant, no a código.

## 3. Cómo elegir el modelo de Claude por etapa

Dos decisiones distintas, no confundirlas:

**a) Modelo con el que corrés Claude Code para construir la etapa.** Es el costo de desarrollo. Regla: el modelo caro para decidir y para lo que se rompe feo si sale mal; el modelo medio para implementar sobre una spec cerrada; el modelo chico para lo mecánico.

| Modelo | Precio in/out por MTok | Usalo para |
|---|---|---|
| **Claude Fable 5.1** | $10 / $50 | Solo decisiones de arquitectura irreversibles y debugging de eve cuando Opus no destraba. Efforts `high`. |
| **Claude Opus 5** | $5 / $25 | Diseño y spec de cada etapa, seguridad (RLS, auth de rutas), integración con eve, revisión de PRs, evals. Effort `high`; `xhigh` solo en debugging duro. |
| **Claude Sonnet 5** | $2 / $10 | Implementar sobre spec: migraciones, tools, UI del dashboard, tests, wiring. Es el caballo de batalla. Effort `medium`, `high` para lógica de negocio. |
| **Claude Haiku 4.5** | $1 / $5 | Mecánico: seeds, tipos generados, CSVs, docs, renames masivos, commits, lint. Effort n/a. |

Tres hábitos que ahorran más tokens que el modelo elegido:
- **Una sesión por etapa**, con `/context-save` al cerrar y `/context-restore` al abrir. El contexto acumulado de sesiones largas cuesta más que el modelo.
- **Spec primero con Opus, implementación después con Sonnet en sesión nueva.** La spec en `docs/superpowers/specs/` es el único contexto que Sonnet necesita.
- **Subagentes para leer.** Explorar `node_modules/eve/docs`, buscar en el repo, o auditar RLS se delega a un subagente (`Explore`), que devuelve la conclusión y no el volcado de archivos.

**b) Modelo con el que corre el agente en producción**, por tarea, vía AI Gateway (strings `anthropic/...`). Esto va en `tenants.default_model` y en cada subagente/schedule, no en el código.

| Tarea del agente | Modelo runtime | Por qué |
|---|---|---|
| Chat principal con el ejecutor | `anthropic/claude-sonnet-5` (selector permite subir a Opus) | Conversación, decisiones de flujo, tool calls. Sonnet alcanza y es 2.5× más barato que Opus. |
| Subagente `researcher` | `anthropic/claude-haiku-4.5` | Lee mucho, decide poco. Lo caro es el input. |
| Redacción del primer toque en frío | `anthropic/claude-opus-5`, effort `high` | Es el mensaje que decide la tasa de respuesta. Vale el 2.5×. Son pocos tokens de output. |
| Follow-ups y respuestas en hilo abierto | `anthropic/claude-sonnet-5` | Tiene el hilo como contexto; la creatividad pesa menos. |
| Gate de estilo | Código determinístico + `anthropic/claude-haiku-4.5` solo para el chequeo semántico | La lista de vetados es regex. Haiku solo confirma tono e idioma. |
| `morning-sweep` (clasificar respuestas) | `anthropic/claude-haiku-4.5` | Clasificación en pocas categorías, alto volumen. |
| Evals del agente | `anthropic/claude-sonnet-5` como juez | Suficiente para verificar formato, vetados y claim. |

Prompt caching en eve va solo si `instructions.md` y las skills son estables por tenant; por eso el canon se versiona y no se lee de Drive en cada turno.

## 4. Estructura del repo

```
innovas-agents/
├── docs/
│   ├── 00-kickoff.md                 ← este archivo
│   ├── superpowers/specs/            ← una spec por etapa
│   └── superpowers/plans/            ← un plan por etapa
├── app/                              ← Next.js App Router
│   ├── (auth)/login/
│   └── [tenant]/
│       ├── chat/                     ← useEveAgent + selector de modelo
│       ├── cola/                     ← aprobar · editar · rechazar
│       ├── pipeline/  contactos/  cuentas/
│       ├── metricas/
│       └── settings/                 ← modelo default, ejecutores, cupos, conexiones del tenant
├── agents/
│   └── outreach/                     ← UN agente para todos los tenants
│       ├── agent.ts                  ← model: defineDynamic (tenant.default_model o selector)
│       ├── instructions.ts           ← defineDynamic: constitución común + canon del tenant
│       ├── skills/                   ← procedimientos comunes (proceso de outreach, formato de eventos)
│       ├── tools/
│       │   ├── research_account.ts   ← delega en researcher; guarda en accounts
│       │   ├── draft_message.ts      ← redacta con hook + gate de estilo
│       │   ├── queue_touch.ts        ← crea queue_item pending
│       │   ├── send_email.ts         ← approval: always() · Gmail del ejecutor
│       │   ├── crm_upsert_contact.ts ← approval: once() · escribe en el CRM del tenant
│       │   ├── log_event.ts          ← append a events
│       │   └── read_replies.ts       ← lee hilos del ejecutor
│       ├── connections/
│       │   ├── crm.ts                ← defineDynamic → HubSpot MCP para innovas, otro para otros
│       │   ├── brain.ts (en tools/)  ← defineDynamic → tools brain_* según el binding
│       │   ├── coldiq.ts
│       │   ├── places.ts
│       │   └── gmail.ts              ← connect("<uid vercel connect>"), principalType user
│       ├── subagents/researcher/
│       ├── schedules/
│       │   ├── morning-sweep.ts      ← por tenant activo: respuestas, etapas, cola del día
│       │   └── followups.ts
│       ├── channels/
│       │   ├── eve.ts                ← auth de ruta: sesión Supabase → tenantId + rol
│       │   └── mcp.ts                ← etapa 6
│       └── evals/
├── tenants/
│   └── innovas/
│       ├── tenant.json               ← slug, dominios, default_model, conexiones habilitadas
├── lib/
│   ├── supabase/                     ← clientes server/browser, tipos generados
│   ├── auth/                         ← verifyCaller(): sesión Supabase → principal eve
│   ├── db/                           ← consultas tipadas por tenant
│   ├── tenants/                      ← carga de tenant.json + config_values → capacidades dinámicas
│   └── outreach/                     ← contact_key, dedup, gate de estilo (puro, testeable)
├── supabase/
│   ├── config.toml · migrations/ · seed.sql · tests/ (RLS)
├── .claude/  (settings.json · launch.json · hooks/check-gstack.sh)
├── CLAUDE.md · next.config.ts · vercel.ts · biome.json · vitest.config.ts · package.json
```

## 5. Modelo de datos (Supabase, esquema `public`)

| Tabla | Para qué | Claves |
|---|---|---|
| `tenants` | Un cliente por fila | `slug`, `display_name`, `allowed_domains[]`, `default_model`, `crm_kind` ∈ {hubspot, tokko, sheet, none}, `active` |
| `memberships` | Quién entra a qué tenant | `user_id`, `tenant_id`, `role` ∈ {platform_admin, tenant_admin, tenant_member} |
| `executors` | Quién ejecuta outreach | `tenant_id`, `user_id`, `slug`, `daily_quota`, `gmail_connected_at` |
| `tenant_connections` | Credenciales y URLs por tenant, cifradas | `tenant_id`, `kind` ∈ {crm, brain, coldiq, places}, `url`, `secret_ref` (nombre de env var o Vault), `enabled` |
| `config_values` | Listas cerradas por tenant | `tenant_id`, `kind` ∈ {segmento, hook, canal, etapa, tipo_evento}, `value`, `label`, `active` |
| `accounts` | Research por empresa | `tenant_id`, `domain`, `name`, `signal`, `gap`, `angle`, `source_url`, `researched_at`, `expires_at` |
| `contacts` | Estado por `contact_key` | `tenant_id`, `contact_key` (unique por tenant), `crm_id`, `executor_id`, `segment`, `hook`, `stage`, `next_step_at` |
| `events` | **Append-only, la verdad** | `tenant_id`, `run_id`, `contact_key`, `executor_id`, `channel`, `type`, `summary`, `evidence_url`, `created_at` |
| `queue_items` | Cola de aprobación | `tenant_id`, `contact_key`, `executor_id`, `channel`, `subject`, `body`, `status` ∈ {pending, approved, rejected, sent, failed}, `eve_session_id`, `approval_call_id` |
| `runs` | Trazabilidad | `tenant_id`, `agent`, `trigger` ∈ {chat, schedule, mcp}, `eve_session_id`, `started_at`, `finished_at`, `cost_usd` |

En SQL, no en el prompt: RLS por `tenant_id` vía `memberships` (y `platform_admin` ve todo); `contact_key` determinística (`linkedin_slug` → email minúsculas → `hash(nombre normalizado + dominio)`); trigger de dedup en `events` (mismo `contact_key` + `type` en 2 horas); `events` sin `UPDATE`/`DELETE` salvo `service_role`.

**Atribución en HubSpot.** En el tenant `innovas` se crean propiedades custom de contacto: `contact_key`, `outreach_segmento`, `outreach_canal`, `outreach_hook`, `outreach_status`, `outreach_owner`, `outreach_fecha_msg1`, `outreach_fecha_respuesta`. Es el mismo esquema que tenía el CRM anterior, así los reportes por hook/segmento salen también del lado de HubSpot.

## 6. Flujo del primer entregable, de punta a punta

1. **Carga.** CSV de cuentas y contactos, o pedido a ColdIQ / Places desde el chat.
2. **Research.** `researcher` investiga cada cuenta y guarda en `accounts` con vencimiento a 90 días.
3. **Redacción.** `draft_message` elige hook según segmento, redacta en es-AR con el canon del tenant y pasa el **gate de estilo**. Si el gate falla, no se encola.
4. **Cola.** `queue_touch` crea el `queue_item`. `send_email` tiene `approval: always()`: la sesión eve queda en `session.waiting`.
5. **Aprobación.** El ejecutor aprueba, edita o rechaza en `/cola` o dentro del chat.
6. **Envío.** Sale desde el Gmail del ejecutor. `events.type = envio`, y `crm_upsert_contact` escribe la atribución en HubSpot.
7. **Escucha.** `morning-sweep` lee los hilos, detecta respuestas, appendea `respuesta`, mueve `stage`, avisa en el chat.
8. **Follow-up.** `followups` encola el segundo toque a los N días. Entra a la cola como cualquier toque.
9. **Métricas.** Tasa de respuesta por hook, segmento, canal y ejecutor; cola pendiente; pipeline por etapa.

## 7. Harness de desarrollo

**gstack + superpowers + plugins oficiales de Vercel y Supabase.** Cada uno cubre una capa distinta y ya los tenés instalados.

| Capa | Herramienta | Qué aporta |
|---|---|---|
| Proceso | **superpowers** (brainstorming → spec → writing-plans → TDD → verification) | Spec antes de código, evidencia antes de "listo". |
| Operación | **gstack** (`/qa`, `/review`, `/ship`, `/investigate`, `/browse`, `/design-review`, `/context-save`) | QA en navegador real, review pre-landing, ship con changelog. |
| Plataforma | **plugin vercel** (skills `eve`, `chat-sdk`, `ai-gateway`, `vercel-connect`, `workflow`) | El skill `eve` obliga a leer `node_modules/eve/docs` antes de escribir. |
| Datos | **plugin supabase** (`supabase`, `supabase-postgres-best-practices`) | Migraciones, RLS, tipos, revisión de queries. |
| Calidad | **Biome** · **vitest** · `tsc --noEmit` en hook de Stop | Un binario para lint y formato; tests para `lib/` puro. |
| Agentes | `eve dev` (TUI) · `evals/` · **Agent Runs** en Vercel | Probar en terminal antes del dashboard; trazas de cada run en producción. |

`CLAUDE.md` (raíz):
```md
## gstack (REQUIRED)
test -d ~/.claude/skills/gstack/bin && echo GSTACK_OK || echo GSTACK_MISSING
Si falta: STOP y pedir instalación.

## Reglas del repo
- Etapas en docs/00-kickoff.md. Una sesión por etapa; /context-save al cerrar.
- Antes de escribir código de eve, leer node_modules/eve/docs/README.md y la guía del slot que tocás.
- Antes de tocar SQL, cargar supabase-postgres-best-practices. Toda tabla lleva tenant_id y RLS.
- Toda tool con efecto externo lleva `approval` explícito.
- events es append-only. Nunca UPDATE/DELETE.
- Nada específico de un tenant en código. Va a tenants/<slug>/ o a la base.
- Español rioplatense en UI, instrucciones y skills. Código e identificadores en inglés.
- Comandos: npm run dev · npm run typecheck · npm test · npm run db:types · npm run lint:fix

## Skill routing
Diseño nuevo → superpowers:brainstorming · Bug → /investigate · Probar en navegador → /qa · PR → /ship
```

`.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": ".claude/hooks/check-gstack.sh" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "npm run typecheck --silent" }] }]
  },
  "permissions": {
    "allow": ["Bash(npm run *)", "Bash(npx supabase *)", "Bash(npx eve *)", "Bash(git status*)", "Bash(git diff*)"]
  }
}
```

`.claude/launch.json`:
```json
{ "version": "0.0.1", "configurations": [
  { "name": "innovas-agents", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3000 }
] }
```

---

## 8. Etapas

Cada etapa se corre en **una sesión nueva de Claude Code**, con el modelo indicado, y termina con spec y plan en `docs/superpowers/`, PR vía `/ship`, y `/context-save`. El "modelo runtime" es el que usa el agente en producción para lo que esa etapa habilita.

### Estado de avance

| Etapa | Estado | PR(s) |
|---|---|---|
| 0 · Bootstrap y spike de riesgo | ✅ hecho | — |
| 1 · Esqueleto multi-tenant | ✅ hecho | — |
| 2 · Conexiones del tenant `innovas` | ✅ hecho | — |
| 3 · Agente de outreach v1 | ✅ hecho | #15 y previos |
| 4 · Dashboard | ✅ hecho | #23, #24 |
| 5 · Escucha, follow-ups y fuentes | ✅ hecho — falta ColdIQ/Places como flujo de carga (deferido, etapa propia) | #26 |
| 6 · Canal MCP (Claude / ChatGPT) | 🔧 emisor hecho en la 11, falta el canal del agente | — |
| 7 · Segundo tenant | ⬜ no arrancada — va después de la 12 y la 13 | — |
| 8 · Chat SDK | ⬜ no arrancada | — |
| 9 · Observabilidad por cliente | ⬜ no arrancada — conviene después de la 12 | — |
| 10 · Agentes inbound y handoff | ⬜ no arrancada | — |
| 11 · Brain por MCP | 🔧 código hecho, verificación pendiente | #25 (spec) · sin PR de implementación todavía |
| 12 · Modelo de orquestación | ✅ hecho — `refresh-fichas` en producción para `innovas`; la ley en `docs/02-orquestacion.md` | #29, #32, #35, #36, #37, #39 y el de la E4 |
| 13 · Pipeline de GTM | 📝 spec y plan listos, sin implementar | #30, #47 |
| 14 · Subida de eve | ⬜ no arrancada | — |
| 15 · Propuesta comercial | ⬜ no arrancada | — |
| 16 · Auto-respuesta con umbral | ⬜ no arrancada — arranca por datos, no por fecha | — |

**Orden de ejecución:** 5 → 12 → 13 → 7. El número de una etapa no es su orden; el detalle está en `docs/01-roadmap-etapas.md`, "Orden de ejecución".

Detalle y deuda conocida de la Etapa 5: `.superpowers/sdd/2026-09-19-etapa-5-escucha/progress.md` en el worktree que la corrió (gitignored, no viaja con el repo).

### Etapa 0 · Bootstrap y spike de riesgo (1 día)

**Modelo Claude Code:** Opus 5, effort `high`. Es la etapa con más decisiones y menos código. Si el spike de Gmail no destraba en dos intentos, subir a Fable 5.1 solo para ese problema.
**Modelo runtime:** `anthropic/claude-sonnet-5` (una tool de prueba).

Objetivo: probar en un día lo único que puede tumbar el diseño: eve dentro de Next.js, login Supabase, y un mail enviado desde tu Gmail con aprobación en el chat web.

```bash
# Prerrequisitos: Node 24, Docker Desktop, npm i -g vercel@latest supabase
mkdir -p ~/Sites/innovas/agents && cd ~/Sites/innovas/agents
npx create-next-app@latest . --ts --app --tailwind --src-dir=false --import-alias "@/*" --use-npm
git init && git add -A && git commit -m "chore: next scaffold"

npm install eve@latest ai zod @supabase/supabase-js @supabase/ssr
npx eve@latest init outreach --model anthropic/claude-sonnet-5     # mover a agents/outreach/
npx eve link --project innovas-agents

npx supabase init && npx supabase start
npx supabase link --project-ref <ref>
vercel link && vercel env pull .env.local                            # Supabase desde el Marketplace

vercel connect create google-gmail --type custom-oauth               # client de Google Cloud; scopes gmail.send gmail.readonly

npm install -D @biomejs/biome vitest && npx @biomejs/biome init
# copiar CLAUDE.md, .claude/*, docs/00-kickoff.md
npm run dev && npx eve dev && curl localhost:3000/eve/agents/outreach/eve/v1/health
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";
import { withEve } from "eve/next";
export default withEve({} satisfies NextConfig, { agents: { outreach: "./agents/outreach" } });
```

Entregables: repo con harness, `withEve` funcionando, login Google por Supabase, `channels/eve.ts` que rechaza a un usuario sin sesión, `tools/send_email.ts` con `approval: always()` enviando desde tu casilla.
**Terminado cuando:** un mail real sale de tu Gmail después de aprobarlo en el chat web. Si Vercel Connect con Google traba: fallback con `provider_refresh_token` de Supabase Auth, documentado en la spec.

Variables de entorno:
```
AI_GATEWAY_API_KEY (o OIDC)          SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY
INNOVAS_BRAINS_MCP_URL · INNOVAS_BRAINS_API_KEY
HUBSPOT_CLIENT_ID · HUBSPOT_CLIENT_SECRET (o HUBSPOT_PRIVATE_APP_TOKEN)
COLDIQ_API_KEY · GOOGLE_PLACES_API_KEY · CRON_SECRET
```

### Etapa 1 · Esqueleto multi-tenant

**Modelo Claude Code:** Opus 5 para la spec y las políticas RLS (effort `high`); **Sonnet 5** en sesión nueva para migraciones, seed, tipos y tests (effort `medium`).
**Modelo runtime:** n/a.

Entregables: migraciones de §5 con RLS; `seed.sql` con tenant `innovas`, roles y enums; `lib/auth/verifyCaller` que estampa `tenantId` y rol en la sesión eve; `lib/tenants` que carga `tenant.json` + `config_values`; `agent.ts` e `instructions.ts` con `defineDynamic`; chat web con selector de modelo; tests de RLS en `supabase/tests/`.
**Terminado cuando:** dos usuarios de tenants distintos no ven filas ajenas (test automatizado), y el selector cambia el modelo de la sesión sin deploy.

### Etapa 2 · Conexiones del tenant `innovas`

**Modelo Claude Code:** **Sonnet 5**, effort `high`. Es wiring sobre docs conocidas. Opus solo si el OAuth de HubSpot vía Vercel Connect necesita diseño.
**Modelo runtime:** `anthropic/claude-haiku-4.5` para probar las conexiones desde el chat.

Entregables: `connections/crm.ts` dinámica (HubSpot MCP para `innovas`, `null` para tenants sin CRM); `connections/brain.ts` con la key del tenant; `coldiq.ts`; `places.ts`; `gmail.ts` con `connect("<uid>")`; propiedades custom de outreach creadas en HubSpot; `tenant_connections` como fuente de las URLs y refs de secretos.
**Terminado cuando:** desde el chat, `crm__search_contacts` y `brain_search` responden para `innovas`, y un tenant de prueba sin CRM no expone la tool.

### Etapa 3 · Agente de outreach v1

**Modelo Claude Code:** Opus 5 para `instructions.ts`, el gate de estilo y las evals (effort `high`); **Sonnet 5** en sesión nueva para tools, subagente y wiring (effort `high`). Incorporar acá el plugin `innovas-outreach` cuando Mati lo pase: sus skills alimentan `agents/outreach/skills/` y el canon del brain de Innovas.
**Modelo runtime:** chat `anthropic/claude-sonnet-5`; `researcher` `anthropic/claude-haiku-4.5`; redacción del primer toque `anthropic/claude-opus-5`.

Entregables: constitución en `instructions.ts` (cinco frenos, cola para frío, claim por persona); skills estáticas en `agents/outreach/skills/` que leen el canon del brain por tags `canon:*`; tools de §4; `lib/outreach` con `contact_key`, dedup y gate (TDD); subagente `researcher`; evals del gate y del claim.
**Terminado cuando:** corrida piloto de **5 contactos reales**: CSV → research → redacción → cola → aprobación → envío → `events` + atribución en HubSpot, con evals en verde.

### Etapa 4 · Dashboard

**Modelo Claude Code:** **Sonnet 5**, effort `medium`. UI sobre esquema cerrado. `/design-review` al final con Sonnet.
**Modelo runtime:** n/a.

Entregables: `/cola` (aprobar, editar, rechazar; resuelve la pausa de eve), `/pipeline`, `/contactos`, `/cuentas`, `/metricas` (por hook, segmento, canal, ejecutor), `/settings` (modelo default, ejecutores, cupos, conexiones), Realtime en cola y pipeline.
**Terminado cuando:** `/qa` pasa en desktop y mobile, y una aprobación desde `/cola` dispara el envío igual que desde el chat.

### Etapa 5 · Escucha, follow-ups y fuentes

**Modelo Claude Code:** **Sonnet 5**, effort `high`. Debugging de Cron en Vercel con Opus si hace falta.
**Modelo runtime:** `morning-sweep` y clasificación `anthropic/claude-haiku-4.5`; follow-ups `anthropic/claude-sonnet-5`.

Entregables: `schedules/morning-sweep.ts` y `schedules/followups.ts` iterando tenants activos; `read_replies` con clasificación de respuestas; ColdIQ y Places como flujo de carga desde el chat.
**Terminado cuando:** una respuesta real en tu Gmail mueve el contacto a `respondio` sin intervención, y el follow-up vencido aparece en la cola a la mañana.

### Etapa 6 · Canal MCP (Claude / ChatGPT)

**Modelo Claude Code:** Opus 5, effort `high`. Es auth: `oauthResource` sobre Supabase como emisor OAuth 2.1.
**Modelo runtime:** el del tenant.

Entregables: Supabase Auth como servidor OAuth 2.1 con registro dinámico; `channels/mcp.ts` con `oauthResource(verifyToken, { issuer, resource, scopes })`; docs de conexión.
**Terminado cuando:** conectás el agente desde Claude Code y desde claude.ai, pedís "armá la cola de hoy" y el trabajo corre durable en Vercel.

### Etapa 7 · Segundo tenant

**Modelo Claude Code:** **Sonnet 5**, effort `medium`. Si esta etapa necesita Opus, la plataforma no está bien abstraída: volver a etapa 1.
**Modelo runtime:** el que defina el tenant.

Entregables: `tenants/<cliente>/` con `tenant.json` y skills; conexión CRM distinta (Tokko, planilla o ninguna); usuarios del cliente con `tenant_member`.
**Terminado cuando:** el segundo tenant corre el piloto de 5 contactos sin tocar `agents/` ni `lib/`, y medís horas contra la etapa 3.

### Etapa 8 · Chat SDK

**Modelo Claude Code:** **Sonnet 5**, effort `medium`.
**Modelo runtime:** el del tenant.

Entregables: `channels/slack.ts` o WhatsApp Cloud API vía `chatSdkChannel`, con aprobaciones como cards con botones.
**Terminado cuando:** una aprobación desde Slack o WhatsApp resuelve la misma pausa que el dashboard.

---

## 9. Riesgos y cómo se acotan

- **eve en preview.** Pin de versión; releer `node_modules/eve/docs` en cada upgrade; evals que fallen si cambia el contrato.
- **Gmail por Vercel Connect.** Custom OAuth con client propio de Google Cloud; pantalla de consentimiento verificada si se sale de "testing". Spike en etapa 0 y fallback documentado.
- **HubSpot MCP remoto.** Usa OAuth; si la app de HubSpot demora la aprobación, arrancar con Private App token por header y migrar a Connect después. Mismo archivo, distinto `auth`.
- **Costo de Connect.** Por token request, cacheado por step. Vigilar cuando entren tenants con muchos ejecutores.
- **Entregabilidad.** Cupo diario por ejecutor (piso 5, techo por medir), warm-up progresivo, gate obligatorio.
- **Fuga entre tenants.** Tests de RLS por tabla desde etapa 1; `platform_admin` es el único rol que cruza tenants y se audita en `runs`.
- **Acoplamiento a `innovas`.** Revisión explícita en cada PR: "¿esto funciona para un tenant que no es INNOV.AS?". Etapa 7 es la prueba.

## 10. Qué NO entra en la v1

- Editor visual de flujos.
- `innovas-brains-mcp` se archiva sin desplegar (spec brain B4).
- LinkedIn automático. Sin API oficial, entra por un proveedor tercero que todavía no se eligió (Unipile es el único con arquitectura de API para integrar desde un backend propio). Tiene su lugar previsto y apagado en la Etapa 13, con la aprobación por lote y la cola por canal que dependen de él.
- Multi-idioma. es-AR único, con el chequeo cableado en el gate.
- Facturación por tenant. Se mide `runs.cost_usd`; se cobra después.

## 11. Referencias

- eve: `node_modules/eve/docs/README.md`, `guides/dynamic-capabilities.md`, `patterns/multi-tenant-auth.md`, `channels/mcp.mdx`, `connections/overview.mdx`, `guides/frontend/nextjs.mdx`, `tools/human-in-the-loop.md`, `schedules.mdx`
- Vercel Connect: https://vercel.com/docs/connect (GA; Google y HubSpot vía Custom OAuth)
- Supabase OAuth 2.1 server: https://supabase.com/docs/guides/auth/oauth-server
- HubSpot MCP remoto: https://mcp.hubspot.com
- Chat SDK: https://chat-sdk.dev (etapa 8)
- Diseño de outreach de referencia: `brain/comercial/outreach/00-fase0-descubrimiento.md` (Plunkton); plugin `innovas-outreach` (a incorporar en etapa 3)
- Activo existente: `~/Sites/innovas/brains` (MCP brain + Workspace, Railway) · archivado, no se despliega
