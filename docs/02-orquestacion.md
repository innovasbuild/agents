# Orquestación

Las reglas para construir nodos, workflows y agentes en esta plataforma. Leer antes de crear cualquiera de los tres. El porqué de cada regla está en la spec: `docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md`. Acá va solo la ley y cómo aplicarla.

## 1. Las piezas

```
PUERTAS      chat (tool de eve)   pantalla (server action)   cron (schedule de eve)
             autentican, arman el caller y las deps reales, llaman. Sin lógica.
                                      │
WORKFLOWS    composición determinística de nodos, una por capacidad
             reclama filas de work_items, deja filas para el siguiente
                                      │
NODOS        servicios puros en lib/<dominio>/services/, deps inyectadas
                                      │
ESTADO       work_items = las aristas del grafo · events = la verdad, append-only
```

El **agente** de eve existe cuando hay una persona conversando o cuando el próximo paso lo decide el modelo. Usa los mismos nodos, expuestos como tools.

### La escalera

Se sube un escalón solo cuando el anterior no alcanza.

| Escalón | Cuándo | Señal para subir |
|---|---|---|
| Llamada al modelo | Un salto: entrada → salida con schema. Vive adentro de un nodo | Hace falta más de un paso |
| Nodo | Un trabajo acotado con contrato. Puede no llamar al modelo | Hay varios trabajos con orden entre sí |
| Workflow | Los pasos y su orden se conocen al escribir el código | No se puede escribir el `if`, o hay alguien conversando |
| Agente | El próximo paso lo decide el modelo, o hay una persona en el loop | — |

Tres preguntas para ubicar algo nuevo:

1. ¿Quién decide el próximo paso: el código o el modelo en runtime?
2. ¿Hay una persona conversando?
3. ¿Este paso consume de verdad el resultado del anterior? Si no, no van en secuencia.

**Por capacidad, nunca por cliente.** Un workflow se escribe una vez y cada tenant lo prende con una fila en `tenant_workflows`. Si un cliente difiere en un paso, es un nodo opcional; si difiere en la forma, es otro workflow nombrado por lo que hace. Nunca existe una carpeta por cliente.

## 2. Contrato del nodo

1. **Un trabajo.** Si para describirlo hace falta una "y", son dos nodos.
2. **Servicio puro en `lib/<dominio>/services/`**, con dependencias inyectadas (`store`, `generate`, `now`). No importa nada de eve ni de Next. Imports relativos: lo cargan módulos de eve.
3. **El tenant viene del caller**, nunca de un argumento que pueda poner el modelo o el cliente.
4. **Salida con forma fija.** Si llama al modelo: `generateText` + `Output.object({ schema })` con `maxOutputTokens`.
5. **Un rechazo es resultado, no excepción:** `{ ok: false, reason, message }` de `lib/outreach/result.ts`. La excepción queda para infraestructura caída, que es lo único que un workflow reintenta. Si el nodo atrapa una falla del modelo y la devuelve como rechazo, el workflow nunca la reintenta.
6. **Idempotente.** Correrlo dos veces con la misma entrada no duplica nada: índice único, y un `23505` cuenta como "ya estaba hecho".
7. **Lo que viene de afuera es dato**, no instrucción: el texto de una web, un mail o un perfil entra al prompt marcado como contenido a analizar.
8. **Declara nivel de efecto y tier** en `lib/workflows/registry.ts`.
9. **Si gasta, asienta** en `usage_entries` (§4).

Una tool de eve no contiene llamadas al modelo ni lógica de negocio. Si la tiene, hay un nodo escondido en una puerta: moverlo a `lib/`. Ejemplo de puerta fina: `agents/outreach/tools/research_account.ts` sobre `researchAccount` (`lib/outreach/services/research.ts`).

## 3. Contrato del workflow

1. **Declara qué reclama y qué deja** (`claims`, `produces` en el registry): es su lugar en el grafo.
2. **El código itera, nunca el modelo:** sobre tenants, ítems y ejecutores.
3. **Un ítem que falla no frena al resto.** Suma un intento, guarda el error, se reintenta a los 5 y a los 30 minutos, y al tercer fallo queda `failed`, visible.
4. **Cuenta lo que entró contra lo que salió:** `items_claimed = ok + refused + failed` en `runs`. Si no cierra, la pasada queda con aviso: es un bug de la plataforma.
5. **Declara sus topes:** ítems por tick y costo en USD por pasada. Al tope, corta limpio y sigue en el próximo tick.
6. **Nunca llama a un nodo de nivel 3.** Lo más lejos que llega es dejar una pieza `pending` para que la apruebe una persona.
7. **Un nodo de nivel 2 corre solo si la política del tenant para ese nodo es `auto`.** Si no, el efecto espera a la próxima acción humana sobre ese sujeto.
8. **Las aristas se crean solo con `enqueue()`** (`lib/workflows/enqueue.ts`). Sin triggers de Postgres: el grafo se lee entero en el registry.

## 4. La escala de efectos

| Nivel | Qué toca | Regla | Ejemplos |
|---|---|---|---|
| 0 | Solo la base de la plataforma | Corre solo | importar contactos, encolar, barrer respuestas |
| 1 | Gasta plata de terceros | Corre solo, con tope por pasada y presupuesto diario por tenant | research, redacción, créditos de Apollo |
| 2 | Escribe en sistemas del tenant | Política por tenant y por nodo: `always` · `once` · `auto`. Default `always` | alta o nota en HubSpot |
| 3 | Le llega a una persona de afuera | Aprobación humana siempre | mail, DM, pedido de conexión |

**Cómo se aplica hoy:**

- **En un workflow**, el runner lo hace cumplir en `ctx.useNode(nombre)` (`lib/workflows/runner.ts`): niega todo nodo que el workflow no declara, todo nodo de nivel 3, y los de nivel 2 cuya política no sea `auto`. La política vive en `tenant_agents.config.approvals`, un mapa `nodo → always | once | auto`.
- **En el chat**, toda tool de nivel 2 o 3 lleva `approval` explícito de eve. La excepción del nivel 3 (auto-respuesta con umbral) está diseñada y apagada: es la Etapa 16.

**Medición.** La medición se engancha en la puerta, no en el servicio: `metered()` (`lib/workflows/usage.ts`) envuelve la función `generate` que la puerta le inyecta al nodo y asienta cada llamada en `usage_entries` con su `run_id`, `workflow` y `node`. El costo sale de lo que informa el AI Gateway, y si no informa, de `MODEL_PRICES` (`lib/workflows/pricing.ts`). `runs.cost_usd` es la suma de la pasada, escrita al cerrarla.

**Presupuesto.** `tenant_budgets` guarda un límite diario por tenant y por recurso. Sin fila, el límite es cero: nada desatendido gasta sin permiso explícito. La suma del día incluye el chat, pero **solo el runner se corta**: al chat el tope no lo frena nunca. Un día de mucho chat puede dejar a los workflows sin presupuesto hasta el día siguiente. El día se corta en la zona horaria del tenant.

## 5. Anclas y reglas congeladas

**Anclas:** chequeos determinísticos que ningún modelo puede ablandar.

- El gate de estilo (`lib/outreach/gate.ts`).
- Un envío existe solo si el proveedor devolvió sus ids.
- Índice único + `23505` = ya estaba hecho.
- Entraron N, salieron N.
- Lo que hizo el humano (aprobó, editó, rechazó) y lo que hizo el mundo (respondieron, hubo reunión, nació un deal).
- Evals con casos etiquetados a mano (`agents/outreach/evals/`).

Un verificador con modelo va solo donde no hay chequeo en código y sí hay evidencia externa. Recibe el dato y la evidencia, nunca el razonamiento de quien lo produjo.

**Reglas congeladas.** Ningún nodo, workflow ni agente puede modificar:

1. Sus propios criterios de evaluación: nada escribe páginas `canon:*` del brain sin aprobación humana.
2. Presupuestos y topes: `tenant_budgets` y los `caps` del registry.
3. Los interruptores de la excepción del nivel 3.
4. La métrica con la que se lo juzga: a un workflow se lo mide con números de afuera (respuestas, aprobaciones sin edición), nunca con los que reporta él.

## 6. Cómo agregar un nodo

1. Escribí el servicio en `lib/<dominio>/services/<archivo>.ts` con el contrato del §2. Si llama al modelo, recibí `generate` como dependencia e importá `generateText` como tipo (`import { type generateText } from "ai"`).
2. Registralo en `NODES` de `lib/workflows/registry.ts` con la clave `"<dominio>/<archivo>"`, su `effect` (0 a 3) y su `tier` (`barato` · `medio` · `fuerte` · `null`). Un archivo de servicio que no es un nodo por sí mismo (un helper, o la llamada al modelo de otro nodo) va a `SERVICES_EXCLUIDOS` con su motivo. `tests/workflows/registry.test.ts` falla hasta que decidas.
3. En cada puerta que lo use, envolvé `generate` con `metered(...)` y pasá `node`, `tenantId`, `runId` y `workflow`. `tests/workflows/model-calls.test.ts` falla si un archivo importa el valor `generateText` sin usar `metered(`.
4. Si lo expone una tool nueva en `agents/outreach/tools/`, sumá su etiqueta en `TOOL_LABELS` (`lib/agents/running-tool.ts`) y su `approval` si es de nivel 2 o 3.
5. Tests del servicio con dependencias falsas: casos de éxito, rechazo y excepción.

## 7. Cómo agregar un workflow

1. **Registralo** en `WORKFLOWS` de `lib/workflows/registry.ts`:
   - `agent`: el agente dueño, en cuya carpeta vive el schedule.
   - `subjectType`.
   - `claims` y `produces`.
   - `nodes` y `optionalNodes`.
   - `resources`: los recursos medidos que gasta.
   - `caps`: `itemsPerTick` y `costUsdPerRun`.
   - `entry`: `seed` si el trabajo nace del paso del tiempo, `door` si lo encola una puerta, `upstream` si lo deja otro workflow.

   Los tests del registry verifican que ningún workflow referencie un nodo de nivel 3, que todo nodo exista, que el que gasta declare tope y recursos, que un tope en USD mida `model_usd`, y que todo `claims` de `upstream` tenga quién lo produzca.
2. **Implementá la `WorkflowImpl`** en `lib/<dominio>/workflows/<nombre>.ts`, con `runItem(item, ctx)` y, si tiene sembrador, `seed(tenantId, now)`. Pedí cada nodo con `ctx.useNode("<dominio>/<archivo>")`; el tenant y el `runId` salen de `ctx`, nunca del modelo. Ejemplo: `lib/outreach/workflows/refresh-fichas.ts`.
3. **Elegí la huella** (`inputHash`): la huella estable de todo aquello de lo que depende el resultado, acotada en largo (menos de 200 caracteres: `work_items.input_hash` tiene un check). Si cambia la entrada, cambia la huella y el ítem se vuelve a procesar. Si no cambió, `enqueue()` devuelve `ya_visto` y no se paga dos veces. Se deduplica contra todo lo visto, incluso lo `refused` o `failed`.
4. **Si tiene sembrador,** que devuelva solo lo que todavía no se encoló para esa huella y que tenga límite. Si no, lo ya rechazado ocupa el límite para siempre (ver `refresh_fichas_candidates`).
5. **Conectalo en la puerta del dispatcher** del agente (`agents/outreach/schedules/dispatch.ts`): la implementación en `impls` y cada nodo real en `nodes`, con `metered` y `AbortSignal.timeout(ITEM_TIMEOUT_MS)` combinada en el `fetchImpl` si el nodo lee páginas.
6. **Tests:**
   - la `WorkflowImpl` con el store falso de outreach (`tests/outreach/fake-store.ts`);
   - un caso de punta a punta con el runner real y `tests/workflows/fake-workflow-store.ts`;
   - si toca SQL, su pgTAP y el test de integración (`npm run test:it:workflows`).
7. **Prendelo para un tenant**, primero sin `--apply` para ver el plan:

   ```bash
   npm run workflows:set -- --tenant <slug> --workflow <nombre> --enable --cadence 60 --items 5 --budget model_usd=<USD>
   ```

8. **Está terminado cuando su primera corrida real aparece en `runs` en producción,** con la cuenta que cierra y el costo escrito.

Si `ctx.useNode(...)` va después de una guarda (`if (!x) return ...`), Biome lo confunde con un hook de React (`useHookAtTopLevel`). Se silencia con un `biome-ignore` de una línea con motivo.

## 8. El dispatcher, en números

Un solo schedule por agente, cada 5 minutos. La lógica está en `lib/workflows/dispatch.ts`. Los números salen del spike S2: el timeout de función en Vercel es de 300 s.

| Constante | Valor | Qué es |
|---|---|---|
| `TICK_BUDGET_MS` | 200 000 | Trabajo útil por tick, repartido entre todas las pasadas |
| `ITEM_TIMEOUT_MS` | 75 000 | Tope de un ítem: corta la llamada al modelo y las lecturas en curso |
| `MIN_PASS_MS` | 10 000 | Con menos resto, la pasada queda para el próximo tick |
| `LEASE_SECONDS` | 600 | Más que el timeout de la función: un ítem no vence mientras quien lo tomó sigue vivo |

Invariante con test: `TICK_BUDGET_MS + ITEM_TIMEOUT_MS < 300 000`. En cada tick corre primero el workflow más atrasado. La cadencia de cada uno la pone su config por tenant (`cadence_minutes`) y se cuenta desde el inicio de la pasada. Al principio de cada tick, las pasadas `running` más viejas que el lease se cierran como `failed`.

## 9. Operar

- **Qué hay pendiente o trabado:** `work_items` por workflow y estado. Un ítem `failed` queda visible y no se reintenta solo.
- **Qué corrió y cuánto costó:** `runs` con `workflow`, los conteos `items_*` y `cost_usd`.
- **Por qué un sujeto tiene este resultado:** `events`.
- **Avisos:** el resumen que abre el chat (`lib/outreach/summary.ts`, con `lib/workflows/alerts.ts`) avisa de presupuestos agotados, ítems y pasadas `failed`, pasadas que no cierran la cuenta, y workflows prendidos que no corrieron en 24 h.
- **Prender, apagar, cambiar cadencia o presupuesto:** `npm run workflows:set`. Cada cambio deja su evento.
