---
title: Modelos y costos
category: arquitectura
status: activo
tags: [modelos, ai-gateway, costos, presupuestos, usage]
updated: 2026-10-13
sources:
  - docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md
  - docs/superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md
  - docs/superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md
  - lib/agents/model.ts
  - lib/outreach/config.ts
  - lib/workflows/usage.ts
  - lib/workflows/pricing.ts
  - lib/workflows/budget.ts
  - lib/workflows/runner.ts
  - lib/workflows/registry.ts
  - lib/workflows/settings.ts
  - supabase/migrations/20260921090000_usage_entries.sql
  - supabase/migrations/20260921110000_tenant_workflows_budgets.sql
---

# Modelos y costos

Qué modelo responde cada cosa, cuánto cuesta cada llamada y quién la frena cuando se pasa. Los nodos, workflows y el runner están en [orquestación](orquestacion.md); acá va la parte de plata.

## Por dónde se llama a un modelo

Todo modelo se llama por el **AI Gateway de Vercel**, con ids `proveedor/modelo` (`anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4.5`, `typesafe-ai/jev`). El gateway autentica por OIDC dentro de Vercel; fuera de Vercel (local, scripts, evals) hace falta `AI_GATEWAY_API_KEY` o el `VERCEL_OIDC_TOKEN` en `.env.local` (ver [entornos y deploy](entornos-y-deploy.md)). El team necesita créditos pagos del gateway: sin ellos los modelos responden `Free tier users do not have access to this model`, también en producción.

El gateway informa el costo de cada llamada en `providerMetadata.gateway.cost` (llega como string). Es la fuente primaria de lo que se asienta; la tabla de precios es solo respaldo (ver más abajo).

## Qué modelo usa cada cosa

Hay tres mecanismos, de más general a más específico:

| Qué | Cómo se elige | Dónde |
|---|---|---|
| **El chat del agente** | Override del agente en el tenant (`tenant_agents.model`), después lo que eligió la persona en el hilo (`conversations.model`), después el default del tenant (`tenants.default_model`). Una elección solo vale si está en `tenants.allowed_models`: esa lista es el freno, sin ella cualquiera se manda un Opus por turno. Se resuelve una vez en `session.started`, no por turno, porque el prompt cache es por modelo | `pickModel` y `resolveModelForTenant` en `lib/agents/model.ts`; `agents/outreach/agent.ts` |
| **Los servicios por rol** | `config.models` del tenant, con cuatro roles: `draft_msg1` (Opus 5), `draft_followup` (Sonnet 5), `classify` y `researcher` (Haiku 4.5). Un rol sin override usa el default de la plataforma | `DEFAULT_OUTREACH_MODELS` en `lib/outreach/config.ts`. Se edita en `/<slug>/settings/outreach`, y `set_outreach_config` valida en SQL que cada modelo esté en `allowed_models` |
| **Un nodo con modelo fijo** | El registro declara `model` y el nodo siempre llama al mismo | `outreach/icp-score` y `outreach/verify-fact`, ambos con `typesafe-ai/jev` |

**Tiers.** El registro (`lib/workflows/registry.ts`) etiqueta cada nodo con un tier: `barato` (`outreach/research`), `medio` (`outreach/followups`), `fuerte` (`outreach/draft`) o ninguno. La spec los pensó como defaults por tier que el tenant puede pisar (`barato` Haiku 4.5, `medio` Sonnet 5, `fuerte` Opus 5). Hoy esa resolución **no existe en el código**: nada lee `tier` para elegir un modelo, y los modelos reales salen de `config.models` por rol. El tier es una declaración que sirve para decidir qué se puede abaratar, no una palanca (spec de orquestación §9.1 queda adelantada respecto del código).

**Jev.** `typesafe-ai/jev` es un modelo de evaluación, no de generación: responde preguntas de tipo booleano o probabilidad con una confianza. `outreach/icp-score` le hace tres preguntas a Jev sobre lo que la búsqueda ya trajo gratis, y `outreach/verify-fact` le pregunta si la fuente que citó el borrador respalda el hecho. Se llama con `experimental_evaluate` del AI SDK, que solo admite `choice`, `score` y `boolean`; el plan de la Etapa 13 asumía un tipo que no existe y se corrigió leyendo los tipos instalados ([#45](https://github.com/innovasbuild/agents/pull/45)). Un nodo de Jev se asienta como `model_usd` igual que uno de texto; su precio de tabla es USD 0,04 por millón de tokens de entrada y nada por la salida.

## El libro de consumo: `usage_entries`

`usage_entries` es append-only, igual que `events`: una fila por consumo, con `tenant_id`, `run_id`, `workflow`, `node`, `resource`, `amount`, `unit` (`usd` o `credits`) y `meta`. Nadie la actualiza ni la borra desde la sesión. Es la base de los presupuestos, del `runs.cost_usd` y de una facturación por tenant futura.

Visibilidad por RLS: el `model_usd` es costo interno de INNOV.AS y lo ve solo `platform_admin`; el resto (créditos de terceros) lo ve el tenant. Es el mismo criterio que `runs.cost_usd`, que `set_run_cost` escribe sumando los asientos `model_usd` de la corrida al cerrarla.

### `metered()`

Ningún servicio conoce el libro. La **puerta** (tool, schedule o runner) envuelve la función `generate` que le inyecta al nodo con `metered(fn, { model, record, base })`, y cada llamada deja su asiento con `node`, `workflow` y `run_id`. El costo sale del gateway; si no lo informa, de `MODEL_PRICES` (`lib/workflows/pricing.ts`: Haiku 4.5, Sonnet 5, Opus 5, Fable 5.1 y Jev), y si el modelo no está en la tabla queda en cero con `source: sin_precio`. `meta.source` dice cuál fue (`gateway`, `tabla`, `sin_precio`). La tabla no descuenta tokens cacheados, así que cuando se usa sobreestima, que es el lado seguro para un tope.

Tres propiedades:

- **Asienta aun cuando la llamada tira.** Si `generateText` falla después de cerrar pasos (un abort por `ITEM_TIMEOUT_MS`, un error del proveedor en el loop de herramientas), esos tokens ya están pagados. El servicio cuelga el consumo del error con `attachSpend`, acumulado paso a paso con `createStepSpend().onStepEnd`, y `metered` lo asienta con `meta.failed: true` y relanza **el mismo** error, que el runner necesita para reintentar. Sin esto el gasto era invisible para el tope y el presupuesto, y el runner reintenta hasta 3 veces por ítem ([#41](https://github.com/innovasbuild/agents/pull/41)). Límite: un paso cortado a la mitad por el abort no se puede asentar, porque el proveedor no informa esos tokens.
- **Nunca tumba un turno.** `createUsageRecorder` atrapa y loguea cualquier falla al escribir; la medición no puede romper una pasada.
- **Está obligada por test.** `tests/workflows/model-calls.test.ts` recorre `agents/`, `lib/` y `app/` y falla si un archivo importa el valor `generateText` sin usar `metered(`.

Lo que hoy pasa por `metered`: `research_account`, `draft_message`, el schedule `followups` y cuatro puertas del schedule `dispatch` (research, `icp-score`, `draft` y `verify-fact`). Las llamadas que hace el modelo principal del chat para conversar no pasan por ahí: lo que se asienta es lo que gastan los servicios que el chat invoca como tools. No encontré en el código otro punto que asiente los tokens del propio turno de conversación.

## Presupuestos: `tenant_budgets`

`tenant_budgets` guarda un límite diario por tenant y **por recurso** (`tenant_id`, `resource`, `daily_limit`, `updated_by`). Vive aparte de `tenant_workflows` porque un recurso se comparte entre workflows. Los recursos medidos hoy son `model_usd` y `apollo_credits` (`lib/workflows/settings.ts` les pone rótulo en castellano).

- **Sin fila, el límite es cero.** Nada desatendido gasta sin permiso explícito.
- **Quién lo fija.** INNOV.AS, en `/plataforma/<slug>` (función `platform_set_budget`, solo `service_role`). El cliente lo ve, con su gasto del día, en `/<slug>/settings/outreach`, pero no lo cambia ([#90](https://github.com/innovasbuild/agents/pull/90)). Es una regla congelada: ningún nodo ni workflow modifica presupuestos ni topes.
- **Cómo se mide.** `budgetStatus` (`lib/workflows/budget.ts`) suma `usage_entries` del recurso desde el comienzo del día en la zona horaria del tenant (`usage_sum`) y compara con el límite. La suma incluye el consumo del chat y de los workflows.
- **Quién se corta.** Solo el runner. Antes de tocar nada, si algún recurso del workflow está agotado, la pasada cierra como `budget_exhausted` y los ítems quedan intactos: al subir el límite se procesan los mismos. Al chat el tope no lo frena nunca, así que un día de mucho chat puede dejar a los workflows sin presupuesto hasta el día siguiente.
- **Avisos.** El resumen que abre el chat (`lib/workflows/alerts.ts`) avisa de los workflows frenados por presupuesto en las últimas 24 horas. En la pantalla de settings, un workflow con un recurso en cero figura como `unfunded`: con uno solo, no corre.

## Topes por workflow

Cada workflow declara en el registro dos topes (`caps`), además de los recursos que gasta:

| Tope | Qué corta |
|---|---|
| `itemsPerTick` | Cuántos ítems procesa por pasada. El tenant puede bajarlo en su config (`items_per_tick`, nunca subirlo por encima del declarado) |
| `costUsdPerRun` | Cuántos USD de `model_usd` puede gastar una sola pasada. Al llegar, la pasada corta limpio (`stoppedBy: tope_costo`) y sigue en el próximo tick. Cero significa que no aplica |

Los valores actuales están en la tabla de [orquestación](orquestacion.md#lo-que-existe-hoy). `target-search` declara `costUsdPerRun: 0` porque gasta créditos de Apollo y no modelo: un tope en USD sobre un workflow que no gasta modelo nunca dispararía, y un test del registro exige que un tope en USD mida `model_usd`. Además, el runner corta por reloj (`TICK_BUDGET_MS`) y por tope de ítems antes de reclamar el siguiente.

## Apollo: créditos como recurso medido

Apollo no cobra por tokens sino por créditos, y eso también se asienta. `target-search` y `contact-enrichment` declaran `apollo_credits` en `resources`; el dispatcher (`agents/outreach/schedules/dispatch.ts`) recibe la cantidad que usó cada ítem y la deja con `resource: "apollo_credits"` y `unit: "credits"`. Un crédito por cabeza revelada (`outreach/reveal-email`); la búsqueda de empresas y personas cuenta los suyos. Se frena con el mismo `tenant_budgets` por recurso, y la consola de plataforma muestra "Créditos de búsqueda" junto a "Modelos de IA (USD)".

El acceso a Apollo usa hasta dos llaves por conector, con fallback ante agotamiento de créditos (`ApolloOutOfCreditsError`); las llaves son del cliente y viven en Vercel Connect ([llaves de clientes](../guias/llaves-de-clientes.md)). Según los PR, el cierre contra producción de la búsqueda y de lo que depende de ella quedó en pausa porque todavía no se conectó Apollo: el código está mergeado pero no hay contactos reales descubiertos ([#45](https://github.com/innovasbuild/agents/pull/45), [#47](https://github.com/innovasbuild/agents/pull/47)).

## Cómo se prueba

- `tests/workflows/usage.test.ts`: `metered` asienta el consumo colgado de un error y relanza el mismo; un `record` que falla no tapa el error original; `attachSpend` y `createStepSpend` (suma de pasos, costo de gateway incompleto).
- `tests/workflows/pricing.test.ts`: gateway primero, tabla de respaldo, `sin_precio`.
- `tests/workflows/budget.test.ts` y `runner.test.ts`: presupuesto agotado sin perder ítems, tope de costo, tope de ítems.
- `tests/workflows/model-calls.test.ts`: ningún `generateText` sin `metered(`.
- `tests/workflows/registry.test.ts`: un workflow que gasta declara recursos y un tope en USD mide `model_usd`.
- `tests/agents/model.test.ts`: la precedencia de `pickModel`.
- `tests/outreach/services/generate-research.test.ts`: con el `generateText` real de `ai@7` y un modelo simulado, el paso 1 cierra, el paso 2 lo corta el `AbortSignal` y el asiento del paso 1 queda.
- `npm test -- tests/workflows` y `npm run db:test` (`12_usage_entries`, `14_tenant_workflows_budgets`).

## Decisiones

- Specs: [orquestación de la plataforma](../superpowers/specs/2026-09-20-orquestacion-plataforma-design.md) (§7.2 medición y presupuesto, §9.1 tiers) · [pipeline de GTM](../superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md) (Jev, créditos de Apollo) · [configuración de outreach (21.3)](../superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md) (presupuestos en pantalla).
- [#32](https://github.com/innovasbuild/agents/pull/32): `usage_entries`, `metered()` y `runs.cost_usd`; el costo sale del gateway y la tabla es respaldo.
- [#41](https://github.com/innovasbuild/agents/pull/41): `metered` asienta el consumo de las llamadas que tiran.
- [#43](https://github.com/innovasbuild/agents/pull/43): el script `jev:probe` para probar a Jev contra el gateway con `AI_GATEWAY_API_KEY`.
- [#45](https://github.com/innovasbuild/agents/pull/45): `target-search` e `icp-score`, con créditos de Apollo y Jev como recursos medidos.
- [#90](https://github.com/innovasbuild/agents/pull/90): presupuestos con límite y gasto del día en pantalla, fijados por plataforma.
- Deuda declarada: el "hoy" del gasto es UTC en la consola de plataforma y la zona del tenant en la pantalla del cliente ([#90](https://github.com/innovasbuild/agents/pull/90)).
