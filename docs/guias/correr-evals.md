---
title: Correr las evals del agente
category: guias
status: activo
tags: [evals, agente, outreach, eve, local]
updated: 2026-10-13
sources:
  - package.json
  - scripts/run-evals.mts
  - .env.eval.example
  - lib/agents/eval-auth.ts
  - supabase/seed-evals.sql
  - supabase/config.toml
  - agents/outreach/evals/evals.config.ts
  - agents/outreach/evals/support.ts
  - agents/outreach/evals/smoke.eval.ts
  - agents/outreach/evals/aprobar-sin-gmail.eval.ts
  - agents/outreach/evals/brain-tools.eval.ts
  - agents/outreach/evals/claim-ajeno.eval.ts
  - agents/outreach/evals/cola-por-letras.eval.ts
  - agents/outreach/evals/draft-msg1.eval.ts
  - agents/outreach/evals/frenos.eval.ts
  - agents/outreach/evals/research.eval.ts
  - agents/outreach/evals/sin-aprobacion-no-sale.eval.ts
  - agents/asistente/evals/evals.config.ts
  - agents/asistente/evals/support.ts
  - agents/asistente/evals/smoke.eval.ts
  - agents/asistente/evals/brain-tools.eval.ts
  - agents/asistente/evals/sin-dato.eval.ts
  - agents/asistente/evals/sin-otros-agentes.eval.ts
  - agents/asistente/evals/deriva-a-outreach.eval.ts
  - docs/guias/instalacion-local.md
---

# Correr las evals del agente

Las evals le hacen preguntas reales a un agente (`outreach` por defecto; `asistente` con `--agent asistente`) (eve levanta un servidor local y conversa con él) y chequean lo que hizo: qué tools llamó, qué quedó en la base y, en algunos casos, qué dijo (un juez con modelo, `typesafe-ai/jev` por defecto). Son la red de seguridad de los guardrails: que nada salga sin aprobación, que el claim ajeno se respete, que el freno frene. Corren **solo contra la Supabase local** y llaman a un modelo de verdad, así que tardan y gastan tokens.

## Pasos

1. Abrí Docker y levantá la base local (ver [instalación local](instalacion-local.md)):

   ```bash
   npm run db:start
   ```

2. Cargá el seed, que incluye la empresa de evals (`eval-outreach`, con su usuario administrador y el agente `outreach` habilitado; viene de `supabase/seed-evals.sql`). `db:reset` borra y recrea la base local:

   ```bash
   npm run db:reset
   ```

3. Copiá el archivo de entorno de evals:

   ```bash
   cp .env.eval.example .env.eval
   ```

4. Pedile a Supabase las llaves locales:

   ```bash
   npx supabase status -o env
   ```

   Copiá `ANON_KEY` a `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SERVICE_ROLE_KEY` a `SUPABASE_SERVICE_ROLE_KEY` en `.env.eval`. El resto (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` y las `EVE_EVAL_*` que describen al usuario y la empresa de evals) ya viene en el ejemplo.

5. El agente necesita llegar al modelo: `.env.local` tiene que tener `VERCEL_OIDC_TOKEN` (o `AI_GATEWAY_API_KEY`), que sale de `vercel env pull .env.vercel`. Ojo con no usar ese archivo entero como `.env.local`: apunta a la base de la nube. El token vence a las pocas horas. Detalle en [instalación local](instalacion-local.md).

6. Corré todas las evals:

   ```bash
   npm run evals
   ```

   El script (`scripts/run-evals.mts`) carga `.env.local` y después `.env.eval`, y ejecuta `eve eval --agent <agente>` (`outreach` si no pasás `--agent`). **Se niega a correr si `NEXT_PUBLIC_SUPABASE_URL` no es local** (`127.0.0.1` o `localhost`, `isLocalSupabaseUrl` en `lib/agents/eval-auth.ts`) y sale con código 1. Lo mismo hace el principal fijo de las evals: en un deploy de Vercel o contra una base remota no autentica.

7. Para correr una sola, pasá su id después de `--` (los argumentos van a `eve eval`):

   ```bash
   npm run evals -- smoke
   ```

   El id es el nombre del archivo sin `.eval.ts`. No verificado: no corrí `eve eval` en esta máquina. `eve eval --list` imprime las evals descubiertas sin correrlas y `--verbose` muestra los logs de cada una; ver `node_modules/eve/docs/evals/running.mdx`. Los resultados quedan en `.eve/evals/<fecha>/`.

## Las evals de `outreach`

Están en `agents/outreach/evals/`. Todas empiezan con `resetEvalTenant()` (`support.ts`), que deja la empresa de evals en un estado conocido; por eso la concurrencia es 1 (`evals.config.ts`).

| Eval | Qué comprueba |
|---|---|
| `smoke` | El agente responde con la auth de eval y no manda nada sin que se lo pidan (`send_email` no se llama) |
| `aprobar-sin-gmail` | Aprobar `send_email` sin permiso de Gmail pide autorización, el turno no queda fallido y la pieza sigue pendiente |
| `brain-tools` | `brain_search`, `brain_read` y `brain_upsert` existen y corren en el agente compilado, y `brain_upsert` pide aprobación |
| `claim-ajeno` | Un contacto con claim de otro ejecutor no se encola y el agente cita el motivo |
| `cola-por-letras` | "A y C mandalas, B con este cambio, D descartala" produce `send_email` para A y C, `update_queue_item` para B y `reject_queue_item` para D |
| `draft-msg1` | `draft_message` produce un primer mensaje que pasa el gate de estilo y abre con el hecho de la ficha (lo juzga el modelo, con umbral 0,7) |
| `frenos` | Ante FRENA el agente frena, lo deja registrado con `log_event` y no sigue redactando ni encolando |
| `research` | `research_account` lee la web y guarda una ficha con hechos con URL (necesita salida a internet) |
| `sin-aprobacion-no-sale` | `send_email` pide aprobación en el primer turno, sin confirmación previa; si se cancela, la pieza sigue pendiente |

## Las evals del `asistente`

Están en `agents/asistente/evals/` y se corren con `--agent asistente`; los ids que siguen son opcionales:

```bash
npm run evals -- --agent asistente
npm run evals -- --agent asistente smoke
```

Sin `--agent` el script corre las de `outreach`. Comparten con ellas el tenant de evals (`eval-outreach`), por eso la concurrencia es 1 también acá, y dos de las del Asistente prenden y apagan el agente de outreach de ese tenant (`setOutreachEnabled` en su `support.ts`) y lo dejan prendido al terminar.

| Eval | Qué comprueba |
|---|---|
| `smoke` | El asistente responde con la auth de eval |
| `brain-tools` | `brain_search`, `brain_read` y `brain_upsert` existen en el agente compilado |
| `sin-dato` | Si el brain no tiene la respuesta, busca, lo dice y no inventa |
| `sin-otros-agentes` | Con outreach apagado, ante un pedido de mail dice que no está disponible y no promete otro agente |
| `deriva-a-outreach` | Con outreach habilitado, ante un pedido de mail nombra a ese agente y no dice haber enviado nada |

## Agregar una eval

1. Creá `agents/<agente>/evals/<nombre>.eval.ts` con un `defineEval` de `eve/evals`: `description`, `timeoutMs` (si no, usa el de `evals.config.ts`, 240 s) y `async test(t)`. Copiá la más parecida a lo que querés probar (`smoke.eval.ts` es la más corta).

2. Arrancá con `await resetEvalTenant();` y usá los helpers de `support.ts` para sembrar el estado (`seedPendingPiece`, `ensureContact`, `enableEvalGmailBinding`...). Si cambiaste algo global, restauralo en un `finally`, como hace `aprobar-sin-gmail`.

3. Conversá con `t.send("...")` y afirmá sobre lo que pasó: `t.calledTool`, `t.notCalledTool`, `t.succeeded()`, `t.messageIncludes`, `t.judge(criterio, { on: turn.message }).atLeast(0.7)` y consultas directas a la base con `createAdminClient()`. Cuando una aprobación está en juego, cancelá con `respondAll("cancel")`: así nada sale. Los datos de prueba usan dominios `.test` y nunca de clientes reales.

4. Correla sola hasta que pase, y después con el resto:

   ```bash
   npm run evals -- [--agent <agente>] <nombre>
   ```

5. Regenerá la referencia, que lista las evals (`docs/referencia/evals.md`), y sumá la fila a la tabla de arriba:

   ```bash
   npm run docs:sync
   ```

## Qué va a fallar si te olvidás de algo

| Te olvidaste de | Qué pasa |
|---|---|
| `.env.eval` o las llaves de Supabase | `createAdminClient` no arranca y toda eval falla en `resetEvalTenant` |
| Que `NEXT_PUBLIC_SUPABASE_URL` sea local | `npm run evals` sale con "solo corre contra la Supabase local" |
| El seed (`db:reset`) | El usuario y la empresa de evals no existen y las evals fallan al resetear |
| `resetEvalTenant()` al principio | La eval depende de lo que dejó la anterior y falla de forma intermitente |
| Un token de modelo vigente | El agente no puede llamar al modelo y el turno falla |
| Regenerar la referencia al agregar una eval | "docs/referencia coincide con lo que genera docs:sync" (`tests/docs/wiki.test.ts`) |

Las evals no están en `npm test` ni en CI (`.github/workflows/ci.yml`): hay que correrlas a mano antes de tocar tools, instrucciones o skills del agente.

No verificados en esta máquina (Docker apagado al escribir la guía): `npm run db:start`, `db:reset`, `npx supabase status -o env` y `npm run evals`.
