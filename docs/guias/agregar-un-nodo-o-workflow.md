---
title: Agregar un nodo o un workflow
category: guias
status: activo
tags: [nodos, workflows, orquestacion, registry]
updated: 2026-10-13
sources:
  - lib/workflows/registry.ts
  - lib/workflows/types.ts
  - lib/workflows/usage.ts
  - lib/workflows/runner.ts
  - lib/workflows/enqueue.ts
  - lib/outreach/workflows/refresh-fichas.ts
  - agents/outreach/schedules/dispatch.ts
  - tests/workflows/registry.test.ts
  - tests/workflows/model-calls.test.ts
  - docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md
  - CLAUDE.md
---

# Agregar un nodo o un workflow

Los contratos (qué es un nodo, qué puede hacer un workflow, la escala de efectos 0 a 3) están en [orquestación](../arquitectura/orquestacion.md). Leela antes de crear cualquiera de los dos: acá van los pasos y los archivos. Se sube un escalón (llamada al modelo, nodo, workflow, agente) solo cuando el anterior no alcanza, y siempre por capacidad, nunca por cliente.

## A. Un nodo

1. Escribí el servicio en `lib/<dominio>/services/<archivo>.ts`: un trabajo, dependencias inyectadas (`store`, `generate`, `now`), tenant que viene del caller, salida con forma fija y un rechazo como resultado (`refuse(...)` de `lib/outreach/result.ts`), no como excepción. No importa nada de eve ni de Next, y los imports son relativos. Si llama al modelo, recibe `generate` como dependencia y trae `generateText` solo como tipo (`import { type generateText } from "ai"`).

2. Registralo en `NODES` de `lib/workflows/registry.ts`. La clave es `"<dominio>/<archivo>"`; `effect` es 0 a 3 y `tier` es `barato`, `medio`, `fuerte` o `null`:

   ```ts
   "outreach/research": { effect: 1, tier: "barato" },
   ```

   Un nodo con modelo fijo suma `model` (como `outreach/icp-score`). Si el archivo no es un nodo por sí mismo (un helper, o la llamada al modelo de otro nodo), va a `SERVICES_EXCLUIDOS` con un motivo de diez caracteres o más.

3. En cada puerta que lo use (una tool del chat, un schedule, una server action), envolvé la función `generate` con `metered(...)` de `lib/workflows/usage.ts`, pasando `node`, `tenantId`, `runId` y `workflow`. Así cada llamada deja su asiento en `usage_entries` con el costo que informa el AI Gateway. Si el nodo gasta otra cosa (créditos de un proveedor), el asiento lo escribe la puerta con el `RecordUsage` que arma `createUsageRecorder`.

4. Escribí los tests del servicio con dependencias falsas: éxito, rechazo y excepción (`tests/outreach/fake-store.ts` trae el store falso de outreach).

5. Si lo expone una tool del agente, seguí [agregar una tool](agregar-una-tool.md). Un nodo de nivel 2 o 3 expuesto en el chat lleva `approval` explícito.

6. Regenerá la referencia (`docs/referencia/nodos-y-workflows.md`) y mencioná el nodo por su clave (`outreach/research`) en la página de [workflows](../dominios/workflows.md):

   ```bash
   npm run docs:sync
   ```

## B. Un workflow

1. Registralo en `WORKFLOWS` de `lib/workflows/registry.ts` con `agent`, `subjectType`, `claims`, `produces`, `nodes`, `optionalNodes`, `resources` (los recursos medidos que gasta), `caps` (`itemsPerTick` y `costUsdPerRun`) y `entry`: `seed` si el trabajo nace del paso del tiempo, `door` si lo encola una puerta, `upstream` si lo deja otro workflow. Un workflow nunca referencia un nodo de nivel 3.

2. Implementá la `WorkflowImpl` (tipo de `lib/workflows/runner.ts`) en `lib/<dominio>/workflows/<nombre>.ts`, con `runItem(item, ctx)` y, si tiene sembrador, `seed(tenantId, now)`. Pedí cada nodo con `ctx.useNode("<dominio>/<archivo>")`: el runner niega los que el workflow no declara, los de nivel 3 y los de nivel 2 cuya política del tenant no sea `auto`. El modelo de referencia es `lib/outreach/workflows/refresh-fichas.ts`.

3. Elegí la huella (`inputHash`): estable, de menos de 200 caracteres (`work_items.input_hash` tiene un check). Las aristas hacia el próximo workflow se crean solo con `enqueue()` de `lib/workflows/enqueue.ts`, nunca con triggers.

4. Conectalo en el dispatcher del agente, `agents/outreach/schedules/dispatch.ts`: la implementación en `impls` y cada nodo real que use en `nodes`, con `metered`. El schedule `dispatch` corre cada cinco minutos y decide a quién le toca.

5. Tests: la `WorkflowImpl` con el store falso, un caso de punta a punta con el runner real y `tests/workflows/fake-workflow-store.ts`, y, si toca SQL, el pgTAP correspondiente y el test de integración (`npm run test:it:workflows`, que necesita Docker y `.env.eval`).

6. Mencioná el workflow por su nombre (por ejemplo `refresh-fichas`) en [workflows](../dominios/workflows.md) y regenerá la referencia:

   ```bash
   npm run docs:sync
   ```

7. Prendelo para un tenant desde `/[tenant]/settings/outreach` (encendido, cadencia, ítems por pasada); el presupuesto diario lo fija una persona de plataforma desde `/plataforma/[slug]`. Sin fila de presupuesto el límite es cero y nada desatendido gasta.

8. Corré todo:

   ```bash
   npm run typecheck
   ```

   ```bash
   npm test
   ```

El workflow está terminado cuando su primera corrida real aparece en `runs` en producción, con la cuenta que cierra (`items_claimed = ok + refused + failed`) y el costo escrito.

## Qué va a fallar si te olvidás de algo

| Te olvidaste de | Falla | Dónde |
|---|---|---|
| Registrar el servicio nuevo en `NODES` o `SERVICES_EXCLUIDOS` | "todo servicio de lib/*/services está registrado como nodo o excluido con motivo" | `tests/workflows/registry.test.ts` |
| Sacar del registry un servicio que borraste | "no quedan nodos ni excluidos que ya no existen en el disco" | `tests/workflows/registry.test.ts` |
| El motivo de un excluido | "todo excluido explica por qué" | `tests/workflows/registry.test.ts` |
| Un nodo de nivel 3 dentro de un workflow | "ningún workflow referencia un nodo de nivel 3" | `tests/workflows/registry.test.ts` |
| Un nodo que el workflow referencia pero no existe | "todo nodo que un workflow referencia existe" | `tests/workflows/registry.test.ts` |
| Declarar `resources` si hay nodos que gastan | "un workflow con nodos que gastan declara tope de costo y sus recursos" | `tests/workflows/registry.test.ts` |
| Que un `upstream` tenga quién produzca lo que reclama | "todo claims tiene quién lo produzca…" | `tests/workflows/registry.test.ts` |
| `model_usd` en `resources` cuando hay tope en USD | "un workflow con tope de costo por pasada mide model_usd…" | `tests/workflows/registry.test.ts` |
| `metered(` en un archivo que importa `generateText` | "todo archivo que importa generateText o experimental_evaluate usa metered" | `tests/workflows/model-calls.test.ts` |
| Regenerar la referencia | "docs/referencia coincide con lo que genera docs:sync" | `tests/docs/wiki.test.ts` |
| Nombrar el nodo o el workflow en la wiki | "toda superficie está mencionada en arquitectura/, dominios/ o guias/…" | `tests/docs/cobertura.test.ts` |

Lo que ningún test ve: que el dispatcher tenga la implementación en `impls`, que el tenant tenga presupuesto y que el workflow esté encendido en su fila de `tenant_workflows`. Eso se comprueba mirando `runs`.
