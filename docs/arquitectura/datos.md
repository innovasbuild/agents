---
title: Datos
category: arquitectura
status: activo
tags: [datos, supabase, rls, events, migraciones]
updated: 2026-10-13
sources:
  - docs/superpowers/specs/03-agente-outreach-v1.md
  - docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md
  - docs/superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md
  - supabase/migrations/20260912194530_runs_events.sql
  - supabase/migrations/20260914224230_outreach_core.sql
  - supabase/migrations/20260921090000_usage_entries.sql
  - supabase/migrations/20260921100000_work_items.sql
  - supabase/migrations/20260921110000_tenant_workflows_budgets.sql
  - supabase/migrations/20260916120000_realtime_queue_items.sql
  - supabase/migrations/20260919230000_realtime_contacts.sql
  - supabase/migrations/20260913120000_revoke_anon_public.sql
  - supabase/migrations/20260914010856_drop_google_tokens.sql
  - supabase/tests/06_anon_grants.test.sql
  - lib/outreach/events.ts
  - lib/supabase/database.types.ts
  - package.json
---

# Datos

La base es Postgres en Supabase. Toda tabla de `public` lleva `tenant_id` y RLS; las pantallas leen con la sesión del usuario (la RLS filtra) y escribe el servidor con el cliente admin. Esta página agrupa las tablas por dominio y explica las reglas que las atraviesan. Las columnas no se repiten: están en las migraciones (lista en [migraciones](../referencia/migraciones.md)), en [tablas](../referencia/tablas.md) y en `lib/supabase/database.types.ts`.

## Las tablas por dominio

### Plataforma

| Tabla | Qué guarda |
|---|---|
| `tenants` | Las empresas |
| `memberships` | Persona, empresa y rol |
| `invitations` | Invitaciones por mail |
| `membership_blocks` | Personas bloqueadas por empresa |
| `tenant_agents` | Agentes habilitados por empresa y su `config` |
| `conversations` | Hilos del chat por persona; guardan el cursor de la sesión de eve |

Detalle en [tenancy](tenancy.md).

### Brain

| Tabla | Qué guarda |
|---|---|
| `brain_pages` | Las páginas vigentes del brain de cada empresa, con búsqueda de texto |
| `brain_revisions` | Cada versión anterior de una página; append-only |
| `brain_access_rules` | Reglas de acceso por carpeta o página; las lee y escribe solo el servidor |
| `brain_mcp_usage` | Contador por minuto del endpoint MCP del brain, por persona y empresa |

Ver [brain](../dominios/brain.md).

### Outreach

| Tabla | Qué guarda |
|---|---|
| `accounts` | Cuentas (empresas objetivo) con su ficha de research y vencimiento |
| `contacts` | Personas a contactar, con etapa de la escalera, dueño y `crm_id`. Estado derivado |
| `queue_items` | Piezas de mensaje en la cola de aprobación. Estado derivado |
| `config_values` | Listas del canon por empresa: segmentos, vectores, hooks e idiomas |
| `executors` | Quién ejecuta el outreach: cupo diario, firma, slug y owner del CRM |
| `search_focuses` | Focos de búsqueda: la forma operativa de un vector y la unidad de autorización del gasto en Apollo |

Ver [outreach](../dominios/outreach.md).

### Orquestación

| Tabla | Qué guarda |
|---|---|
| `work_items` | Las aristas del grafo: "este workflow tiene que procesar este sujeto" |
| `runs` | Un turno de chat o una pasada de workflow |
| `usage_entries` | El libro de consumo: un asiento por recurso gastado |
| `tenant_workflows` | Qué workflows corre cada empresa y con qué config. Nacen apagados |
| `tenant_budgets` | Tope diario por recurso y empresa |
| `events` | La verdad append-only |

Ver [orquestación](orquestacion.md) y [workflows](../dominios/workflows.md).

### Auth, conectores y uso

| Tabla | Qué guarda |
|---|---|
| `tenant_connections` | Binding de una empresa con un proveedor (`crm`, `leads`, `brain`, `mail`…). Solo el identificador del conector de Vercel Connect, nunca una credencial |
| `connector_claims` | Un conector pertenece a una sola empresa; la clave primaria lo garantiza |
| `google_tokens` | Ya no existe: la migración `20260914010856_drop_google_tokens` la borró cuando Gmail pasó a Vercel Connect, para que el refresh token nunca llegue a la base. El inventario de `docs:sync` respeta los `drop table` posteriores, así que no figura en [tablas](../referencia/tablas.md). |

Ver [conectores](../dominios/conectores.md). El consumo de modelo y de créditos va en `usage_entries`.

## `events`: la verdad append-only

`events` registra hechos y nunca se edita. Se cumple por permisos, no por una convención: no hay políticas de escritura, y `INSERT`, `UPDATE` y `DELETE` están revocados a `authenticated` y `anon`. Escribe el servidor (con `service_role`, que no pasa por RLS) y las funciones `security definer`, que dejan su evento en la misma transacción que el cambio. Lectura para miembros de la empresa y `platform_admin`. `contacts` y `queue_items` son estado derivado de los eventos.

Dos protecciones de outreach, en `20260914224230_outreach_core.sql`:

- Un trigger `events_dedup` descarta, en una ventana de 2 horas, un segundo evento idempotente por contacto, tipo, pieza o mensaje, actor y deal. Los tipos son los de `DEDUPED_EVENT_TYPES` en `lib/outreach/events.ts` y tienen que coincidir con el índice y el trigger. Por eso un insert de esos tipos puede devolver cero filas, y quien inserta no usa `.single()`.
- Un índice único por `gmail_message_id` garantiza una sola `respuesta` o `rebote` por mensaje.

### Familias de tipos que se usan

Verificadas con `grep` en `lib/`, `agents/` y las migraciones:

| Familia | Tipos | Quién los escribe |
|---|---|---|
| Outreach (nombre en español, sin punto) | `contacto_importado`, `investigado`, `encolado`, `gate_fallido`, `pieza_editada`, `rechazado`, `aprobado`, `envio`, `envio_fallido`, `rebote`, `respuesta`, `cambio_etapa`, `claim_ajeno`, `deal_creado`, `oportunidad_frenada`, `crm_sync_pendiente`, `crm_sync_ok`, `freno`, `nota`, `crm_id_huerfano`, `crm_owner_actualizado` | Tools y nodos de outreach; la lista cerrada es `OUTREACH_EVENT_TYPES`. El modelo solo puede registrar `freno` y `nota` con `log_event` |
| `tenant.*`, `membership.*`, `invitation.*` | `tenant.created`, `membership.joined_by_domain`, `membership.blocked`, `membership.unblocked`, `invitation.accepted`, `invitation.external` | Funciones SQL de alta, ingreso y bloqueo, y `lib/invitations/invite.ts` |
| `agent.*`, `connection.*`, `executor.*` | `agent.updated`, `connection.bound`, `connection.enabled`, `connection.disabled`, `connection.verified`, `connection.unverified`, `connection.removed`, `executor.updated`, `executor.removed` | Funciones `platform_*` y de ajustes de la empresa |
| `workflow.*`, `approval.*`, `budget.*` | `workflow.updated`, `approval.updated`, `budget.updated` | Funciones de ajustes y presupuesto |
| `brain.*` | `brain.page_upserted`, `brain.page_deleted`, `brain.categories_set`, `brain.access_changed` | Funciones del brain |
| `outreach.*` | `outreach.config_updated`, `outreach.list_value_updated`, `outreach.marco_reflected`, `outreach.marco_reflect_failed` | Ajustes de outreach y el reflejo del marco en el brain |

La convención: lo del dominio de outreach viejo usa nombres en español sin punto; lo de plataforma y ajustes usa `dominio.accion`.

## `work_items`: las aristas del grafo

Una fila de `work_items` es la arista del grafo de workflows: `(tenant_id, workflow, subject_type, subject_id, input_hash)` es única, de modo que se deduplica contra todo lo visto, incluso lo que terminó `refused` o `failed`. `subject_id` es polimórfico (sin FK). Estados: `pending`, `running`, `done`, `refused`, `failed`. Es estado operativo y descartable: el resultado vive en la tabla de dominio y el hecho en `events`.

- **La única forma de crear una arista es `enqueue()`** (`lib/workflows/enqueue.ts`). Nada de triggers.
- **El reclamo es atómico**: `claim_work_items` usa `for update skip locked` y un lease. Un proceso que muere no deja una fila `running` para siempre; a los 3 intentos pasa a `failed`. El máximo vive también en `lib/workflows/types.ts` como `MAX_ATTEMPTS`.

## `runs` y `usage_entries`

- **`runs`** es un turno de chat (`trigger`: `chat`, `schedule`, `mcp`, `webhook`) o una pasada de workflow. Una pasada lleva `workflow` y las cuentas `items_claimed`, `items_ok`, `items_refused` e `items_failed`, que tienen que cerrar. El costo (`cost_usd`) no se puede leer con `select`: tiene grants por columna y solo `platform_admin` lo ve, por `run_cost_usd`. Consecuencia: no se hace `select *` sobre `runs`. `schedule_key` es el lock de los schedules por empresa y día. El estado `budget_exhausted` cierra la pasada que se quedó sin presupuesto.
- **`usage_entries`** es append-only como `events`: un asiento por recurso gastado (`model_usd`, créditos de Apollo…) con nodo y corrida. `model_usd` es costo interno: lo ve solo `platform_admin`. Lo escribe `metered()` envolviendo `generate`; `set_run_cost` suma el total al cerrar el turno. `tests/workflows/model-calls.test.ts` falla si algún archivo importa `generateText` sin `metered`.

## Realtime

Solo dos tablas están en la publicación `supabase_realtime`: `queue_items` (para `/[tenant]/cola`) y `contacts` (para `/[tenant]/pipeline`). Ambas con `replica identity full`, para que el payload de un `UPDATE` traiga la fila vieja y Realtime pueda evaluar la política de lectura. La autorización sigue siendo la RLS: cada persona recibe solo los cambios de su empresa. Los consumidores son `cola-client.tsx` y `pipeline-client.tsx`.

## Convenciones de migraciones

Verificadas contra las migraciones de tenancy, usage, work_items, tenant_workflows, brain_mcp_usage, platform_console, member_blocks y ajustes (cada función `security definer` de esas lleva `set search_path = ''`; en `memberships_lock_columns` y `revoke_authenticated_extra_grants` la frase solo aparece en comentarios):

- **Toda función `security definer` lleva `set search_path = ''`** y nombra los objetos calificados (`public.memberships`). Es lo que hace segura la ejecución con los privilegios del dueño.
- **Se revoca `execute` a `public` y se otorga al rol que corresponde.** Postgres le da `execute` a `public` sobre toda función nueva, y `anon` lo hereda, así que `revoke execute … from public` es el idiom (y de paso `anon`, `authenticated` cuando no corresponde). Las funciones del servidor (`claim_work_items`, `set_run_cost`, `usage_sum`, `brain_mcp_hit`, las `platform_*`) se otorgan solo a `service_role`; las que usa la sesión del usuario (`is_platform_admin`, `block_member`, `set_workflow`…) a `authenticated`.
- **`anon` no tiene nada en `public`.** La migración `20260913120000_revoke_anon_public.sql` lo revoca y corta los default privileges; `supabase/tests/06_anon_grants.test.sql` barre todas las tablas y falla si alguna lo vuelve a tener.
- **La escritura de `authenticated` se revoca tabla por tabla** (`revoke insert, update, delete`) y se otorga por columna cuando hace falta (`grant update (role)` en `memberships`).
- **Las FK llevan índice** y las que cruzan tablas incluyen `tenant_id`, para que una pieza no pueda apuntar a una fila de otro tenant.
- **Una columna nueva se otorga a mano en `runs`**, porque tiene grants por columna.
- **Una migración que depende de datos falla con un mensaje** (`do $$ … raise exception`), como la reserva de slugs y los conectores en dos empresas.
- Antes de tocar SQL se carga el skill `supabase-postgres-best-practices` (regla del repo).

En producción, `npx supabase db push` aplica todas las migraciones pendientes, no solo las propias: se corre `migration list` antes.

## Tipos y pruebas

- `npm run db:types` regenera `lib/supabase/database.types.ts` desde la instancia local (`--local`, no `--linked`): genera a un archivo temporal, lo mueve solo si el comando salió bien y lo formatea con Biome. Un fallo ya no vacía el archivo (PR [#63](https://github.com/innovasbuild/agents/pull/63)). Necesita Docker y `npm run db:start`.
- `npm run db:test` resetea la base local sin seed y corre los tests de pgTAP de `supabase/tests/`. Necesita Docker.
- `npm run db:reset` deja la base con migraciones y seed.

## Decisiones

- [Agente de outreach v1](../superpowers/specs/03-agente-outreach-v1.md) y PR [#8](https://github.com/innovasbuild/agents/pull/8): el núcleo de datos (`accounts`, `contacts`, `queue_items`, `config_values`), la escalera que no retrocede y la dedup de eventos.
- [Orquestación de la plataforma](../superpowers/specs/2026-09-20-orquestacion-plataforma-design.md): `work_items`, `usage_entries`, presupuestos. PR [#32](https://github.com/innovasbuild/agents/pull/32) (medición) y [#35](https://github.com/innovasbuild/agents/pull/35) (los rieles).
- [Escucha y follow-ups](../superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md): los eventos de respuestas y `contacts` en Realtime.
- PR [#61](https://github.com/innovasbuild/agents/pull/61): el sync entrante de HubSpot, con `crm_id_huerfano` y `crm_owner_actualizado`.
- PR [#63](https://github.com/innovasbuild/agents/pull/63): `db:types` contra la base local.
- Ver también: [tenancy](tenancy.md), [vision-general](vision-general.md).
