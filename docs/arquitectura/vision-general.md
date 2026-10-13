---
title: Visión general
category: arquitectura
status: activo
tags: [arquitectura, eve, multi-tenant, mapa]
updated: 2026-10-13
sources:
  - docs/producto/kickoff.md
  - docs/superpowers/specs/2026-09-12-arquitectura-plataforma-design.md
  - docs/superpowers/specs/00-bootstrap.md
  - docs/superpowers/specs/01-multi-tenant.md
  - docs/diagramas/arquitectura.archify.json
  - package.json
  - next.config.ts
  - agents/outreach/agent.ts
  - agents/outreach/channels/eve.ts
  - agents/outreach/channels/mcp.ts
  - agents/outreach/connections/tenant.ts
  - lib/workflows/registry.ts
  - lib/connectors/providers.ts
  - app/plataforma/page.tsx
  - app/brain/[tenant]/mcp/route.ts
---

# Visión general

La plataforma es un solo deploy de Next.js que sirve el dashboard de cada cliente y los agentes de eve, sobre una base Supabase con RLS por `tenant_id`. Esta página es el mapa: cómo encajan las piezas hoy, los principios que no se rompen y qué hay en cada carpeta. El dibujo original del kickoff (§2, [kickoff](../producto/kickoff.md)) quedó atrás en varios puntos; abajo está redibujado contra el código.

## El dibujo de hoy

```
  Personas                       Clientes MCP (Claude, ChatGPT, Codex)
  (navegador)                    │                      │
  │                              │ OAuth 2.1            │ OAuth 2.1
  │ sesión Supabase              │ (Supabase Auth)      │
  ▼                              ▼                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Next.js 16 en Vercel  ·  withEve({ agents: { outreach } })                   │
│                                                                              │
│  app/[tenant]/…      chat · cola · pipeline · contactos · cuentas · focos    │
│                      metricas · brain · conectar · settings                  │
│  app/plataforma/…    consola de plataforma (solo platform_admin del dueño)   │
│  app/(auth) · auth/  login por empresa, callback, confirmar, oauth/consent   │
│  app/brain/[tenant]/mcp   brain por MCP (por empresa)                       │
│                                                                              │
│  /eve/outreach/v1/*       canal eve (chat web)   ──┐ mismo agente,           │
│  /eve/outreach/v1/mcp     canal MCP del agente   ──┘ mismas tools            │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ eve runtime: sesiones durables · hooks · schedules (Cron)
               ▼
┌──────────────────────────────┐   ┌────────────────────────────────────────┐
│ agents/outreach              │   │ Workflows desatendidos                 │
│  agent.ts  (modelo por       │   │  schedule dispatch (cada 5 min)        │
│   tenant, en session.started)│   │  lib/workflows: runner · registry      │
│  tools/ skills/ hooks/       │   │  work_items = aristas · enqueue()      │
│  connections/tenant.ts       │   │  nodos puros en lib/<dominio>/services │
│   (defineDynamic por tenant) │   │  presupuesto por recurso · usage_entries│
│  schedules/ (morning-sweep,  │   └───────────────────┬────────────────────┘
│   followups, crm-sync,       │                       │
│   dispatch)                  │                       │
└───────┬───────────┬──────────┘                       │
        │           │ pide token                        │
        │           ▼                                   │
        │   Vercel Connect (único puente: lib/connectors/auth.ts)
        │     OAuth y API keys del cliente; el modelo nunca las ve
        │           │
        │           ├─ crm      → HubSpot
        │           ├─ leads    → Apollo · ColdIQ · Google Places
        │           ├─ mail     → Gmail del ejecutor
        │           └─ brain    → wiki propia o MCP externo
        ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Supabase (Postgres · Auth · RLS · Realtime · Storage)                        │
│  plataforma: tenants · memberships · tenant_agents · tenant_connections …    │
│  brain: brain_pages · brain_revisions · brain_access_rules …                 │
│  outreach: accounts · contacts · queue_items · search_focuses …              │
│  orquestación: work_items · runs · usage_entries · tenant_workflows …        │
│  events (append-only) · Realtime en queue_items y contacts                   │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲
        └─ Vercel AI Gateway: el modelo se elige por tenant (lib/agents/model.ts)
```

Qué cambió respecto del kickoff:

| Kickoff | Hoy |
|---|---|
| eve 0.54 con rutas `/eve/agents/<n>/…` | eve 0.67.2 (fijo en `package.json`): rutas con nombre, `/eve/outreach/v1/*` (PR [#60](https://github.com/innovasbuild/agents/pull/60)) |
| Canal MCP "etapa 6" | Existe: `agents/outreach/channels/mcp.ts`, en `/eve/outreach/v1/mcp`. Solo reconoce como plataforma al `platform_admin` del tenant dueño (PR [#82](https://github.com/innovasbuild/agents/pull/82)) |
| Aprobación: "todo efecto externo" | Escala de efectos de cuatro niveles; ver [orquestación](orquestacion.md) (PR [#31](https://github.com/innovasbuild/agents/pull/31)) |
| Solo agente y chat | Además hay workflows desatendidos con `work_items`, presupuesto y `usage_entries` |
| Sin administración | Consola `/plataforma` para altas, agentes, brain y conectores; ver [tenancy](tenancy.md) |
| Brain solo como tools del agente | Brain también por MCP en `/brain/[tenant]/mcp`, con permisos por carpeta y página |
| Credenciales en Vault (D3 de la spec de arquitectura) | Vercel Connect guarda todo; la base solo tiene identificadores de conector (`connector_uid`) |

## Principios

1. **Un agente sirve a N tenants.** `agents/outreach` es uno solo. Lo que cambia por empresa se resuelve en `session.started` desde la base: modelo, conexiones, brain. Un tenant nuevo es una fila y su brain, no una carpeta de código.
2. **Por capacidad, nunca por cliente.** Los agentes, workflows y nodos se nombran por lo que hacen (`outreach`, `draft-queue`). Lo específico de un cliente vive en `tenants/<slug>/` o en la base, no en el código.
3. **`events` es append-only.** Nadie hace `UPDATE` ni `DELETE`: se revocan los grants y escribe solo el servidor. Ver [datos](datos.md).
4. **El modelo nunca ve una credencial.** Toda llave pasa por Vercel Connect; `lib/connectors/auth.ts` es el único archivo que importa `@vercel/connect` (lo hace cumplir `tests/connectors/import-rule.test.ts`). En la base solo hay identificadores.
5. **El agente es el centro, los canales son puertas.** Chat web, canal MCP y los schedules llegan a los mismos nodos y tools con las mismas aprobaciones.
6. **El efecto decide la aprobación.** Nivel 0 corre solo, 1 gasta con presupuesto, 2 escribe en sistemas del tenant, 3 le llega a una persona y exige aprobación humana. Un workflow desatendido nunca llama a un nodo de nivel 3.
7. **Toda tabla lleva `tenant_id` y RLS.** El tenant sale de la URL y se valida contra `memberships` en cada request; un cliente ajeno recibe 404, nunca 403.

## Mapa de carpetas

| Carpeta | Qué hay |
|---|---|
| `agents/` | Los agentes de eve, uno por capacidad. Hoy solo `outreach/` (tools, skills, hooks, schedules, canales, evals, `connections/tenant.ts`) |
| `app/` | Next.js App Router: `[tenant]/` (pantallas del cliente), `plataforma/` (consola), `(auth)/` y `auth/` (login), `brain/[tenant]/mcp` (brain por MCP), `oauth/consent`, `sin-acceso/`, `api/invitations` |
| `components/` | Componentes compartidos: `ui/` (shadcn) y `brain/` (lector, editor visual, permisos) |
| `lib/accounts/` | Estado de las cuentas (`status.ts`) |
| `lib/agents/` | Catálogo de agentes, resolución de modelo por tenant, contexto de canal, auth del canal MCP, sesiones y runs |
| `lib/auth/` | Login (link y código), `login_gate`, principal OAuth, consentimiento |
| `lib/brain/` | Módulo del brain: `core/` (wiki, acceso, MCP, editor) y `adapters/` hacia esta plataforma |
| `lib/brand/` | Contraste de colores para la marca por tenant |
| `lib/connect/` | Qué puede conectar una persona a su cliente MCP (página Conectar) |
| `lib/connectors/` | Registro de proveedores, bindings por tenant, puente con Vercel Connect, adapters de CRM y leads |
| `lib/gmail/` | Armado MIME, envío y lectura de Gmail |
| `lib/invitations/` | Invitar y validar dominios |
| `lib/outreach/` | Dominio de outreach: núcleo puro (gate, claves, etapas), consultas de pantallas y `services/` (los nodos) |
| `lib/supabase/` | Clientes (browser, server, admin) y `database.types.ts` generado |
| `lib/tenants/` | Resolución de tenant y rol, tenant dueño, aterrizaje, navegación, alta de empresas |
| `lib/workflows/` | Rieles de orquestación: `registry.ts`, `runner.ts`, `enqueue.ts`, presupuesto y consumo |
| `supabase/` | `migrations/` (esquema, RLS, funciones), `tests/` (pgTAP), seeds y plantillas de mail |
| `tenants/` | Contenido versionable por cliente (hoy `innovas/` con el canon para importar al brain) |
| `scripts/` | Operación: `brain-import`, `run-evals`, probes, y `docs/` (inventario y sync de la wiki) |
| `tests/` | Vitest, un directorio por dominio, más `tests/docs` que vigila la wiki |
| `docs/` | La wiki: ver el [índice](../README.md) |

Los demás archivos de la raíz: `proxy.ts` refresca la sesión de Supabase en cada navegación (las rutas `eve/`, `brain/` y `.well-known/` quedan afuera porque se autentican por bearer), `next.config.ts` registra el agente con `withEve`.

## Cómo viaja un pedido

1. La persona entra a `/<slug>/chat`. `resolveTenantAccess` traduce el slug a tenant y rol; sin membresía, 404.
2. El chat habla con `/eve/outreach/v1/*`. El `AuthFn` de `agents/outreach/channels/eve.ts` verifica la sesión, valida que la sesión de eve sea de quien pregunta (los hooks de eve son observe-only) y arma el principal con `tenantId`, `tenantSlug` y `role`.
3. En `session.started`, `agent.ts` resuelve el modelo del tenant y `connections/tenant.ts` arma las conexiones según los bindings de `tenant_connections`.
4. Las tools escriben con el cliente admin (`service_role`), nunca con la sesión del usuario, y dejan sus hechos en `events`.
5. Las pantallas leen con la sesión del usuario: la RLS es la que filtra. `queue_items` y `contacts` avisan por Realtime.

## Diagrama

El diagrama navegable está en [arquitectura.html](../diagramas/arquitectura.html) con su fuente [arquitectura.archify.json](../diagramas/arquitectura.archify.json) y se regenera con el skill archify.

Comparado con el dibujo de arriba, al archify le falta o le queda viejo:

- **Consola de plataforma** (`/plataforma`): no figura.
- **Canal MCP del agente** y **brain por MCP**: no figuran; solo está el canal eve.
- **Workflows**: ni `dispatch`, ni `work_items`, ni los nodos, ni el presupuesto.
- **Brain** como componente (wiki propia o MCP externo): no figura.
- **HubSpot** dice "MCP remoto, solo lectura" y hoy el agente también escribe (`crm_upsert_contact`).
- **Apollo** no aparece; el nodo "ColdIQ · Places" quedó corto (ver `lib/connectors/providers.ts`).
- El borde "/eve/outreach" quedó sin el `/v1` que agregó la subida de eve; la revisión fijada (`7ac307e`) es anterior a todo lo anterior.
- **Vercel Connect** sí está, y Realtime sobre la cola también.

## Decisiones

- [Arquitectura de la plataforma](../superpowers/specs/2026-09-12-arquitectura-plataforma-design.md): conectores por capacidad, alta solo por invitación, marca por tenant. Su D3 (llaves en Supabase Vault) quedó atrás: lo que rige es Vercel Connect y la consola de plataforma ([llaves de clientes](../guias/llaves-de-clientes.md)).
- [Bootstrap](../superpowers/specs/00-bootstrap.md) y [multi-tenant](../superpowers/specs/01-multi-tenant.md): el spike de eve y el modelo de datos.
- PR [#31](https://github.com/innovasbuild/agents/pull/31): etapas 12 a 16 en el roadmap y la escala de efectos en el kickoff.
- PR [#43](https://github.com/innovasbuild/agents/pull/43): el diagrama archify.
- PR [#60](https://github.com/innovasbuild/agents/pull/60): eve 0.54.2 a 0.67.2. La URL vieja del MCP devuelve 404 sin redirect, y los schemas de las tools dinámicas tienen que ser inline.
- Lecturas de contexto: PR [#29](https://github.com/innovasbuild/agents/pull/29) y [#42](https://github.com/innovasbuild/agents/pull/42) (la ley de orquestación).
- Ver también: [tenancy](tenancy.md), [datos](datos.md), [orquestación](orquestacion.md).
