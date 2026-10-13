---
title: Workflows
category: dominios
status: activo
tags: [workflows, dispatcher, work_items, runner, outreach]
updated: 2026-10-13
sources:
  - docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md
  - docs/superpowers/plans/2026-09-20-etapa-12-orquestacion.md
  - lib/workflows/registry.ts
  - lib/workflows/enqueue.ts
  - lib/workflows/runner.ts
  - lib/workflows/dispatch.ts
  - lib/workflows/store.ts
  - lib/workflows/config.ts
  - lib/outreach/workflows
  - agents/outreach/schedules/dispatch.ts
  - supabase/migrations/20260921100000_work_items.sql
  - supabase/migrations/20260921110000_tenant_workflows_budgets.sql
---

# Workflows

## 1. Qué es y para qué

Un workflow es una composición determinística de nodos que corre sin que nadie abra el chat: el código itera sobre tenants e ítems, nunca el modelo. Esta página es el mapa del código y de la mecánica: dónde está cada pieza, cómo se reclama y se reintenta un ítem, qué corta una pasada. La ley (la escalera, el contrato del nodo y del workflow, la escala de efectos, las reglas congeladas) y los pasos para escribir uno nuevo están en [orquestación](../arquitectura/orquestacion.md) y en [agregar un nodo o workflow](../guias/agregar-un-nodo-o-workflow.md); acá no se repiten.

Hoy hay cinco workflows, todos del agente `outreach`, que forman una cadena: se descubre un contacto, se lo califica contra el ICP, se revela su email y se asegura la ficha de su cuenta, y se deja una pieza `pending` para que la apruebe una persona. Los workflows se escriben una vez y cada tenant los prende con una fila en `tenant_workflows`; nunca hay uno por cliente.

## 2. Dónde vive en el código

| Ruta | Qué hay |
|---|---|
| `lib/workflows/registry.ts` | El grafo entero: `NODES` (nivel de efecto y tier), `WORKFLOWS` (claims, produces, nodos, recursos, topes, entrada) y `downstreamOf()` |
| `lib/workflows/types.ts` | `MAX_ATTEMPTS`, `WorkItem`, `ItemOutcome` |
| `lib/workflows/enqueue.ts` | `enqueue()`, la única forma de crear una arista |
| `lib/workflows/runner.ts` | `runWorkflowPass()`: una pasada de un workflow para un tenant. Define `WorkflowImpl` y `PassContext` |
| `lib/workflows/dispatch.ts` | `runDispatch()`: un tick; reparte el reloj entre las pasadas. Constantes de tiempo |
| `lib/workflows/config.ts` | Valida la config de `tenant_workflows`; `isDue()` decide si toca |
| `lib/workflows/budget.ts` | Presupuesto diario por recurso y tenant |
| `lib/workflows/store.ts` | El `WorkflowStore` real sobre Supabase (reclamo, cierre de pasadas, política de nodos) |
| `lib/workflows/usage.ts`, `pricing.ts` | `metered()` y precios: asientan el gasto en `usage_entries` |
| `lib/workflows/alerts.ts` | Avisos que suma el resumen que abre el chat |
| `lib/workflows/settings.ts` | Lo que muestran las pantallas de workflows y presupuestos |
| `lib/outreach/workflows/*.ts` | Las cinco `WorkflowImpl` |
| `agents/outreach/schedules/dispatch.ts` | La puerta: cron de eve que arma las dependencias reales y llama a `runDispatch` |

## 3. Cómo funciona

### Las aristas: `work_items` y `enqueue()`

`work_items` es la cola. Una fila dice "este workflow tiene que procesar este sujeto con esta entrada": `workflow`, `subject_type`, `subject_id` (sin FK, es polimórfico), `input_hash`, `status` (`pending`, `running`, `done`, `refused`, `failed`), `attempts`, `next_attempt_at`, `lease_until`, `last_error`, `result_reason` y `run_id`. Es estado operativo y descartable: el resultado vive en la tabla de dominio y el hecho en `events`.

- **Única forma de crear una arista: `enqueue()`.** No hay triggers de Postgres. Rechaza un workflow que no está en el registry (`workflow_desconocido`) o un sujeto del tipo equivocado (`sujeto_equivocado`).
- **Deduplicación por huella.** La clave única es `(tenant_id, workflow, subject_type, subject_id, input_hash)`. Un `23505` vuelve como `ya_visto`, no como error. La fila queda aunque el ítem haya terminado `refused` o `failed`, así que no se paga dos veces. Si cambia aquello de lo que depende el resultado, cambia la huella y se vuelve a procesar. La huella tiene un check de menos de 200 caracteres.
- **Claims y produces.** `claims` es la etiqueta de lo que el workflow toma y `produces` la de lo que deja. El runner usa `downstreamOf(produces)`: al terminar un ítem `ok`, encola en cada workflow cuyo `claims` coincida (y esté prendido para el tenant) los sujetos que el ítem declaró en `downstream`. Un ítem puede dejar varios sujetos y de otro tipo que el propio (un foco deja N contactos).
- **`entry`** dice de dónde le llega el trabajo: `seed` (sembrador propio, el trabajo nace del paso del tiempo), `door` (lo encola una puerta) o `upstream` (lo deja otro workflow).

### Reclamo, intentos y reintentos

- La función SQL `claim_work_items` reclama de forma atómica (`for update skip locked`) los ítems `pending` con `next_attempt_at` vencido, o `running` con el lease vencido, y suma un intento. Dos pasadas simultáneas nunca reciben el mismo ítem.
- **`MAX_ATTEMPTS` = 3**, en `lib/workflows/types.ts` y también dentro de `claim_work_items`: si cambia uno, cambia el otro. Un proceso que muere cuenta como intento; con tres agotados y el lease vencido, el ítem pasa a `failed`.
- El runner reclama **de a uno**, para que un corte por reloj, costo o presupuesto nunca deje ítems tomados sin resolver.
- Resultados de `runItem`: `{ ok: true }` cierra el ítem `done`; `{ ok: false, reason, message }` es un rechazo de negocio y lo cierra `refused` (terminal, no se reintenta); una **excepción** es infraestructura caída y se reintenta con espera de 5 minutos tras el primer fallo y 30 tras el segundo (`RETRY_DELAYS_MINUTES`); al tercero, `failed`, visible y sin reintento automático.
- Si el `enqueue()` downstream falla después de que el ítem cerró `done`, se registra el error y no se toca el ítem: se pierde la arista, nunca el trabajo hecho.

### El tick y el dispatcher

`agents/outreach/schedules/dispatch.ts` es un schedule `dispatch` con cron `*/5 * * * *`. Cada 5 minutos arma las dependencias reales (store, tenants activos con el agente de outreach, las cinco implementaciones, los nodos con `metered()`) y llama a `runDispatch`. No manda mails ni escribe en el CRM: ningún nodo que alcanza es de nivel 2 o 3. La cadencia de cada workflow no la pone el cron sino su config por tenant.

`runDispatch` (en `lib/workflows/dispatch.ts`):

1. **Barre las pasadas abandonadas.** Cierra como `failed` las filas de `runs` con `workflow` y estado `running` que arrancaron hace más que el lease. Una función que murió a mitad de camino no llegó a su cierre.
2. **Clasifica** cada fila de `tenant_workflows` prendida: workflow desconocido, de otro agente, sin implementación, config inválida (deja una pasada `failed` con el motivo, como mucho una por cadencia por defecto), "no toca" por cadencia o candidata.
3. **Reparte el reloj.** Ordena las candidatas por antigüedad de `last_run_at` (nunca corrió = la más atrasada) y corre cada una con lo que queda del tick. Con menos de `MIN_PASS_MS` de resto, la pasada queda para el próximo tick (`sin_tiempo`).

Los números (spike S2, timeout de función de 300 s en Vercel) están en la sección 8 de [orquestación](../arquitectura/orquestacion.md). Invariante con test: `TICK_BUDGET_MS + ITEM_TIMEOUT_MS < 300 000`. El tope de un ítem (`ITEM_TIMEOUT_MS`) corta la llamada al modelo y las lecturas de páginas en curso: la puerta combina una `AbortSignal.timeout` con la del `fetch`.

### Una pasada

`runWorkflowPass` abre una fila en `runs` y trabaja bajo `try`, así que la fila siempre se cierra:

1. **Presupuesto antes de tocar nada.** Si algún recurso del workflow (`model_usd`, `apollo_credits`) está agotado en `tenant_budgets` (sin fila el límite es cero), cierra como `budget_exhausted` y deja los ítems intactos.
2. **Siembra** si el workflow tiene `seed`. Un sujeto que falla al encolar se registra y no frena a los demás.
3. **Reclama y procesa de a uno** hasta `sin_trabajo`, `tope_items` (el menor entre el cap del registry y `items_per_tick` del tenant), `tope_costo` (`caps.costUsdPerRun` medido sobre `model_usd` de esa pasada) o `reloj`.
4. **Cierra con la cuenta**: `items_claimed = items_ok + items_refused + items_failed`. Si no cierra, la pasada queda `ok` con un error de aviso (es un bug de la plataforma). Si algo explota, se cierra `failed` y se relanza.

`failed` en `runs` cuenta *intentos* fallidos (incluidos los que se reintentan), no ítems en `failed`.

### Caps, política de nodos y piezas `pending`

- **Caps** (`caps.itemsPerTick`, `caps.costUsdPerRun` del registry): los fija el código; la config del tenant solo puede bajar los ítems. Los presupuestos diarios por recurso los fija INNOV.AS desde la consola.
- **`ctx.useNode(nombre)`** es donde el runner hace cumplir la escala de efectos: niega un nodo que el workflow no declara, todo nodo de nivel 3 y uno de nivel 2 cuya política no sea `auto`. La política sale de `tenant_agents.config.approvals` (`always` por defecto). Hoy ninguno de los cinco workflows declara un nodo de nivel 2.
- **Piezas `pending`**: lo más lejos que llega un workflow hacia una persona es dejar una pieza `pending` en `queue_items` (`draft-queue`, por medio del nodo `outreach/queue`). Un humano la aprueba en `/[tenant]/cola`; el envío (`outreach/send`, nivel 3) nunca corre desatendido.

### La config del tenant

`tenant_workflows` tiene una fila por `(tenant_id, workflow)`: `enabled` (nace en `false`: un workflow desatendido gasta plata solo), `config` y `last_run_at`. `parseTenantWorkflowConfig` valida `cadence_minutes` (5 a 10 080, por defecto 60), `items_per_tick` y `optional_nodes`; una config rota apaga ese workflow para ese tenant y avisa, nunca corre con valores adivinados. Se edita en `/<slug>/settings/outreach`.

**La cadencia se cuenta desde el inicio de la pasada.** `touchLastRun` recibe `startedAt` y `last_run_at` queda igual a `runs.started_at`; si se contara desde el fin, lo que dura la pasada saltearía el turno siguiente y un workflow de 5 minutos salía cada 5 o cada 10 ([#40](https://github.com/innovasbuild/agents/pull/40)).

### Los cinco workflows

| Clave | Sujeto | Claims → produces | Nodos | Recursos | Caps (ítems / USD) | Entrada |
|---|---|---|---|---|---|---|
| `refresh-fichas` | `account` | `ficha_vencida` → `ficha_vigente` | `outreach/research` | `model_usd` | 5 / 1 | `seed` |
| `target-search` | `search_focus` | `foco_activo` → `contacto_descubierto` | `outreach/target-search` | `apollo_credits` | 2 / 0 | `seed` |
| `icp-scoring` | `contact` | `contacto_descubierto` → `contacto_calificado` | `outreach/icp-score` | `model_usd` | 20 / 0,5 | `upstream` |
| `contact-enrichment` | `contact` | `contacto_calificado` → `contacto_listo` | `outreach/reveal-email`, `outreach/research` | `apollo_credits`, `model_usd` | 10 / 0,3 | `upstream` |
| `draft-queue` | `contact` | `contacto_listo` → (nada) | `outreach/draft`, `outreach/verify-fact`, `outreach/queue` | `model_usd` | 15 / 0,3 | `upstream` |

La cadena completa es `target-search` → `icp-scoring` → `contact-enrichment` → `draft-queue`; `refresh-fichas` va aparte y mantiene al día las fichas.

- **`refresh-fichas`**: el sembrador `refresh_fichas_candidates` (función SQL) devuelve las cuentas vencidas todavía no encoladas para ese vencimiento, hasta 50. La huella es `id:vencimiento`; una ficha refrescada vence en otra fecha y eso es una huella nueva. Investiga con `outreach/research`. Una falla del modelo tira (se reintenta); un rechazo de negocio como `sin_ancla` vuelve como resultado.
- **`target-search`**: el sembrador toma los focos activos de `search_focuses` y siembra la página siguiente (una por cada 100 empresas encontradas), porque sembrar siempre la 1 haría que `enqueue()` la rechace como `ya_visto`. Descubre contactos con Apollo y nunca revela un email; cada contacto descubierto va aguas abajo a `icp-scoring`. Asienta los créditos aunque la página no sirva.
- **`icp-scoring`**: sin sembrador. Califica contra el ICP con tres carriles: `calificado` sigue a `contact-enrichment`; `para_revisar` termina `ok` sin downstream y espera a una persona en `/[tenant]/focos/[id]/revisar`; `descartado` se cierra `refused`. El ICP sale del brain (ver [brain](brain.md)); si el brain no responde, lanza y se reintenta.
- **`contact-enrichment`**: sin sembrador. Revela el email, promueve `contact_key` a `em:<email>` y asegura la ficha de la cuenta con `outreach/research`. Si no hay ficha termina `ok` sin avanzar. La huella que deja a `draft-queue` lleva la fecha (`contacto:msg1:YYYY-MM-DD`).
- **`draft-queue`**: redacta, verifica el ancla con `outreach/verify-fact` y encola. Antes de redactar chequea el cupo diario del ejecutor (`executors.daily_quota`): sin cupo, el ítem de hoy se cierra `refused` con `cupo_agotado` y el sembrador diario vuelve a sembrar mañana (por eso la huella lleva fecha). El sembrador excluye a los contactos que ya tienen una pieza `pending` o `approved`, para no gastar en re-redactar.

### Operar

- **Qué está pendiente o trabado:** `work_items` por `workflow` y `status`. Un ítem `failed` no se reintenta solo.
- **Qué corrió y cuánto costó:** `runs` con `workflow`, `items_*` y `cost_usd`; el gasto por llamada, en `usage_entries`.
- **Avisos:** `lib/workflows/alerts.ts` los suma al resumen del chat (presupuestos agotados, ítems y pasadas `failed`, cuentas que no cierran, workflows prendidos que no corrieron en 24 h).
- **Otro cierre de runs:** el schedule `morning-sweep` también abre una fila en `runs`; desde [#66](https://github.com/innovasbuild/agents/pull/66) la cierra con `ok` o `failed` y no la deja huérfana (`runMorningSweep`, `lib/outreach/services/sweep.ts`). No es un workflow y no pasa por `work_items`; el barrido de abandonadas del dispatcher solo mira filas con `workflow` no nulo.

## 4. Cómo se prueba

| Qué | Cómo |
|---|---|
| El registry contra el disco (cada servicio decidido, ningún nivel 3, tope y recursos, `claims` de `upstream` con productor) | `npx vitest run tests/workflows/registry.test.ts` |
| Que toda llamada al modelo esté medida | `tests/workflows/model-calls.test.ts` |
| Runner (reintentos, cuenta, niveles de efecto, downstream) | `tests/workflows/runner.test.ts` con el store falso `tests/workflows/fake-workflow-store.ts` |
| Dispatcher (cadencia, reparto del reloj, abandonadas) | `tests/workflows/dispatch.test.ts` |
| `enqueue`, config, presupuesto, alertas, uso | `tests/workflows/{enqueue,config,budget,alerts,usage,pricing,settings}.test.ts` |
| Cada implementación | `tests/outreach/workflows/*.test.ts` con `tests/outreach/fake-store.ts` |
| Reclamo concurrente contra Postgres real | `npm run test:it:workflows` (Supabase local) |
| SQL | pgTAP `13_work_items`, `14_tenant_workflows_budgets`, `15_refresh_fichas_candidates`, `15_search_focuses`, `16_upsert_discovered_account`: `npm run db:test` |
| Todo | `npm test` y `npm run typecheck` |

Un workflow está terminado cuando su primera corrida real aparece en `runs` en producción.

## 5. Decisiones

- Spec: [orquestación de la plataforma](../superpowers/specs/2026-09-20-orquestacion-plataforma-design.md); plan: [etapa 12](../superpowers/plans/2026-09-20-etapa-12-orquestacion.md).
- [#35](https://github.com/innovasbuild/agents/pull/35): los rieles (`work_items`, `claim_work_items`, `enqueue()`, registry, runner, `tenant_workflows`, `tenant_budgets`).
- [#37](https://github.com/innovasbuild/agents/pull/37): `refresh-fichas`, el dispatcher y su schedule, los avisos del resumen.
- [#40](https://github.com/innovasbuild/agents/pull/40): la cadencia se cuenta desde el inicio de la pasada.
- [#45](https://github.com/innovasbuild/agents/pull/45): `target-search` e `icp-scoring`; `ItemOutcome.downstream` admite varios sujetos aguas abajo.
- [#47](https://github.com/innovasbuild/agents/pull/47): `contact-enrichment` y `draft-queue`; la huella de `draft-queue` lleva fecha porque `ItemOutcome` no tiene un tercer resultado "todavía no, reintentá mañana".
- [#66](https://github.com/innovasbuild/agents/pull/66): cierre de la fila de `runs` de `morning-sweep` (ver "Operar").

Discrepancia: el PR #35 anotaba como pendiente que un `enqueue()` downstream que falla después de cerrar el ítem pierde la arista sin rastro durable. Con cinco workflows encadenados sigue siendo así en el código: solo se registra con `console.error`.
