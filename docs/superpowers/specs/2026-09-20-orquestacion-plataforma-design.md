---
title: Modelo de orquestación de la plataforma · nodos, workflows y agentes (spec)
fecha: 2026-09-20
estado: aprobada en brainstorming, pendiente de revisión escrita
modelo: Fable 5.1 (spec) · Sonnet 5 (implementación, sesión nueva)
etapa: 12 (nueva, ver §14)
fuente: docs/innovas-agents-kickoff.md §2, §3, §9 · docs/01-roadmap-etapas.md · docs/superpowers/specs/2026-09-12-arquitectura-plataforma-design.md (D2, D3, D5) · docs/superpowers/specs/03-agente-outreach-v1.md (D2, D3, D11, D13, §13.1 S4, §16) · docs/superpowers/specs/2026-09-16-etapa-4-dashboard-cola-design.md (D3) · docs/superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md (D4, §4.3, §4.5) · node_modules/eve/docs (tools/workflows.mdx, schedules.mdx, subagents/index.mdx, patterns/dynamic-scheduling.md, patterns/multi-tenant-approvals.md, concepts/execution-model-and-durability.mdx) · "Graph Engineering" (artículo, 2026) · Anthropic, "Building effective agents"
---

# Modelo de orquestación de la plataforma

## 1. Qué problema resuelve

Hoy la plataforma tiene una sola forma de hacer trabajo: una persona abre el chat, el agente `outreach` encadena tools en línea (importar → investigar → redactar → encolar) y la persona aprueba. La Etapa 5 sumó una segunda forma, los schedules de escucha y follow-ups, y al hacerlo descubrió reglas que no estaban escritas en ningún lado: que itere el código y no el modelo, que un ejecutor que falla no frene al resto, que un schedule nunca envíe mail.

La visión de GTM que sigue (búsqueda de target, enrichment, calificación ICP, aprobación por canal, escucha con respuesta automática, propuesta comercial) son seis flujos, varios sin humano, que corren a velocidades distintas. Y después vienen otros tenants con otros procesos. Sin un modelo común, cada flujo va a reinventar cómo se dispara, cómo reintenta, cuánto puede gastar y qué puede hacer sin pedir permiso.

Esta spec define ese modelo: **qué piezas existen, cuándo se usa cada una, qué contrato cumplen, cómo se conectan y cómo se hace cumplir todo eso.** No construye el pipeline de GTM: construye los rieles y los prueba con un workflow mínimo.

### Partición acordada

| # | Sub-proyecto | Etapa | Estado |
|---|---|---|---|
| A | Modelo de orquestación de la plataforma | 12 | **esta spec** |
| B | Pipeline GTM de `innovas`: target → enrichment → calificación → cola por canal | 13 | spec propia, después de A |
| C | Propuesta comercial · Auto-respuesta con umbral | 15 · 16 | specs propias |

## 2. Objetivo y criterio de cierre

Dejar en producción los rieles de orquestación, probados con un workflow real que no es de GTM: **refrescar fichas de cuentas vencidas** (`accounts.expires_at` ya existe, el nodo de research ya existe, no necesita humano y tiene valor propio).

**Terminado cuando**, contra el deploy de producción:

1. Una ficha vencida de `innovas` se refresca sola, sin que nadie abra el chat.
2. Esa pasada deja su fila en `runs` con `workflow = 'refresh-fichas'` y una cuenta que cierra: `reclamados = ok + rechazados + fallidos`.
3. Cada llamada al modelo de esa pasada deja su asiento en `usage_entries`, y `runs.cost_usd` queda escrito por primera vez.
4. Con el presupuesto diario de `model_usd` del tenant en cero, el workflow cierra la pasada como `budget_exhausted`, no procesa nada y no pierde ningún ítem: al subir el presupuesto, los mismos ítems se procesan.
5. Un ítem forzado a fallar no frena al resto, se reintenta con espera creciente y al tercer intento queda `failed` con su error, visible.
6. Dos pasadas disparadas a la vez no procesan el mismo ítem.
7. Un tenant de prueba sin fila en `tenant_workflows` no corre nada.
8. Los tests de §9.3 existen y fallan cuando corresponde (verificado rompiendo el registry a propósito).
9. `docs/02-orquestacion.md` y las reglas de `CLAUDE.md` (§12) están mergeadas.
10. `npm test`, `npm run typecheck` y `npm run db:test` en verde.

**Cierre contra producción (2026-09-21, E3, PR #37).** Criterios 1 a 8 y 10 cumplidos; el 9 es la E4.

| # | Evidencia |
|---|---|
| 1 | `rivara.com.ar` (innovas) refrescada sola a las 13:26 UTC, vigente hasta el 2026-12-20. Pasada `c69008cb-1ab5-4ba5-8bff-f95a9f67ff83` |
| 2 | Esa pasada: `items_claimed 1 = ok 1 + refused 0 + failed 0` |
| 3 | Asiento `outreach/research` de USD 0,0125 con el `run_id` de la pasada y `source: gateway`; `runs.cost_usd = 0.0125` |
| 4 | Con tope 0: pasadas `budget_exhausted` desde `9b227c79-dbeb-4b08-abf6-dc3c15476c78` (12:40 UTC), sin tocar ítems. Al subir a USD 3, la siguiente procesó el ítem |
| 5 | Con un modelo inexistente, el ítem 2 falló tres veces (reintento a los 5 y a los 30 minutos) y quedó `failed` con `Model 'anthropic/no-existe' not found`. La mitad "no frena al resto" la prueba `tests/workflows/runner.test.ts` (decisión 9 del plan de la E3) |
| 6 | `npm run test:it:workflows` 7/7 contra Postgres real: dos reclamos simultáneos nunca entregan el mismo ítem (decisión 8 del plan de la E3) |
| 7 | Sin filas en `tenant_workflows`, a más de 10 minutos del deploy no había ninguna pasada de workflow |
| 8 | Tests del registry rotos a propósito en la E2 (Task 10) y reforzados en la E3 (Task 18) |
| 10 | Verde sobre el merge de #37: 924 tests, typecheck limpio, 149 pgTAP |

Config de régimen para innovas: cadencia 60, 5 ítems por tick, `model_usd` USD 3 por día. Cron `dispatch` registrado en el deploy de producción con `*/5 * * * *`.

Visto en producción y pendiente: `last_run_at` se marca al terminar la pasada, así que con cadencia igual al tick se saltea un tick de cada dos, y una cadencia de 60 corre cada 60 a 65 minutos. Se arregla contando la cadencia desde el inicio de la pasada.

### 2.1 Entregas

Cada una deja algo que sirve aunque la siguiente se demore.

| # | Entrega | Qué deja |
|---|---|---|
| E1 | **Medición.** S1, `usage_entries`, los nodos que ya llaman al modelo asientan, `runs.cost_usd` se escribe | Por primera vez se sabe cuánto cuesta una corrida del chat. Vale sola |
| E2 | **Rieles.** `work_items`, `claim_work_items`, `enqueue()`, registry con sus tests, runner, `tenant_workflows`, `tenant_budgets`, columnas de `runs` | Todo probado con `store` falso y tests de base; nada corre en producción todavía |
| E3 | **Primer workflow.** Mover la composición de research a `lib/` (§9.4), `refresh-fichas`, `dispatch.ts`, criterio de cierre contra producción | Los rieles probados de verdad |
| E4 | **La ley.** `docs/02-orquestacion.md` y el bloque de `CLAUDE.md` | Las reglas con domicilio, escritas contra código que ya existe |

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Mismo código, distintos datos.** Un workflow se escribe una vez por capacidad. Un tenant lo habilita y parametriza con una fila en `tenant_workflows` y con su brain. Nunca existe `workflows/<cliente>/` | Principio 6 del kickoff y D5 de la spec de arquitectura: es lo que ya rige para los agentes. La Etapa 7 es la prueba |
| D2 | **Jerarquía de diferencias entre tenants:** nodo opcional (difiere un paso) → workflow nuevo por capacidad (difiere la forma) → nunca carpeta por cliente | Un cliente con un proceso distinto tiene `gtm-outbound` apagado y otro workflow prendido, nombrado por lo que hace. Si entra un segundo cliente parecido, lo prende |
| D3 | **La unidad reutilizable es el nodo, no el workflow.** Un workflow es una composición fina de nodos | Es lo que hace barato el workflow nuevo de D2. Si un workflow nuevo no puede reusar casi nada, los nodos quedaron mal cortados |
| D4 | **Diseñar para decenas de ítems por día por tenant, con cientos como techo.** Lease atómico, topes de costo y conteo de entradas y salidas existen desde el primer workflow aunque hoy no aprieten. Colas dedicadas (Vercel Queues), backpressure y tiempo real quedan afuera | Volumen real de `innovas`. El artículo: un grafo compra anchura, no mejor juicio. Acá el valor no es velocidad: cada etapa corre sola, se verifica sola y falla sola |
| D5 | **Ejecutor por defecto: máquina de estados en Postgres + un cron dispatcher.** `defineWorkflowTool` de eve queda reservado para flujos conversacionales, condicionado al spike S3. El SDK `workflow` directo queda descartado salvo que el default demuestre no alcanzar | El default anda hoy en eve 0.54.2, es lo que la Etapa 5 ya probó, y cada arista se inspecciona con un `select`. `defineWorkflowTool` es una tool que llama el modelo dentro de una sesión: mala forma para trabajo desatendido, y la spec 03 (D11, §16) la descartó por un bug. El SDK directo convive mal con la copia vendorizada que trae eve (`5.0.0-beta`) |
| D6 | **Los nodos son servicios puros en `lib/`; el ejecutor es un adaptador.** Tres puertas sobre el mismo servicio: chat (tool), pantalla (server action) y cron (dispatcher) | Generaliza la D3 de la Etapa 4, que ya lo probó con `/cola`. Si un día conviene envolver un nodo en un `"use step"`, se envuelve sin reescribirlo |
| D7 | **El estado de procesamiento no vive en `contacts.stage`.** Vive en una tabla genérica `work_items` | `stage` es la escalera comercial, tiene un trigger que impide bajar de rango y se espeja en HubSpot. Un contacto `en_conversacion` puede necesitar recalificarse porque cambió el ICP: son dos ejes |
| D8 | **Las aristas se crean solo con `enqueue()`.** Sin triggers de Postgres | Con triggers el grafo queda escondido en el SQL. Con `enqueue()` y el registry se lee entero en un lugar |
| D9 | **Escala de efectos de cuatro niveles** (§7), que reemplaza la regla binaria "toda tool con efecto externo lleva `approval`" | La regla literal impide cualquier trabajo desatendido. La escala la refina sin romperla: lo que le llega a una persona sigue pidiendo un humano |
| D10 | **Pedido de conexión de LinkedIn: nivel 3, aprobado por lote** | Le llega a una persona, pero sin nota no hay texto que revisar. Un click aprueba la lista del día, con posibilidad de sacar nombres. El modo automático dentro del foco queda como la excepción del nivel 3, para después |
| D11 | **Medir antes que presupuestar.** Libro de consumo `usage_entries`, append-only, por recurso | Hallazgo: `runs.cost_usd` existe y nadie la escribe; `draftMessage` recibe el `usage` del modelo y lo descarta. Sin medición el nivel 1 no tiene sobre qué apoyarse |
| D12 | **Primero un ancla determinística; verificador con modelo solo donde no hay chequeo en código y sí hay evidencia externa.** Hoy, un solo verificador obligatorio: el hecho que ancla un mensaje | Reconcilia el artículo con la D3 de la spec 03. Un modelo opinando sobre el estilo de otro no tiene señal real contra la cual chequear; un modelo comparando una afirmación con el texto de su fuente, sí |
| D13 | **Cuatro reglas congeladas** que ningún nodo puede modificar (§8.3) | Goodhart: un optimizador ablanda justo la regla que le impide ganar |
| D14 | **Las reglas viven en tres capas:** tests que fallan, `CLAUDE.md`, y `docs/02-orquestacion.md`. Las de `CLAUDE.md` se mergean con la implementación, no antes | Una regla que vive solo en un documento se pudre. Y una regla que manda registrar nodos en un archivo que todavía no existe confunde a la próxima sesión |
| D15 | **No se migran `morning-sweep` ni `followups` a `work_items`** | Son diarios, tienen su lock por `schedule_key` y funcionan. Migrarlos no compra nada hoy |
| D16 | **La subida de eve es una etapa propia (14), no un spike, y no bloquea ni a A ni a B** | Son nueve versiones menores de un framework en preview; la 0.58 cambió las rutas de agentes nombrados, que tocan el cliente del chat, los tests de canal y el dispatch de schedules |

## 4. Vocabulario y regla de decisión

```
PUERTAS      chat (tool)      pantalla (server action)      cron (dispatcher)
                  \                    |                       /
                   autentican, arman el caller, llaman. Sin lógica.
                                       │
WORKFLOWS    composición determinística de nodos, una por capacidad
             reclama filas en estado X  ──►  deja filas en estado Y
             itera el código, nunca el modelo
                                       │
NODOS        servicios puros en lib/, deps inyectadas, no saben quién los llama
             un trabajo · entrada zod · salida con schema · nivel de efecto 0-3 · tier
                                       │
ESTADO       Postgres: work_items = las aristas del grafo
             events append-only = la verdad
```

Aparte, el **agente** de eve: existe cuando hay una persona conversando o cuando el camino se descubre sobre la marcha. Usa los mismos nodos, expuestos como tools.

### 4.1 La escalera

Se sube un escalón solo cuando el anterior no alcanza.

| Escalón | Cuándo | Señal de que hay que subir |
|---|---|---|
| **Llamada al modelo** | Un salto: entrada → salida con schema. Vive adentro de un nodo | Hace falta más de un paso |
| **Nodo** | Un trabajo acotado con contrato. Puede no llamar al modelo | Hay varios trabajos con orden entre sí |
| **Workflow** | Se conocen los pasos y el orden al escribir el código | No se puede escribir el `if`: depende de lo que aparezca, o hay alguien conversando |
| **Agente** | El próximo paso lo decide el modelo, o hay un humano en el loop conversacional | — |

Tres preguntas para ubicar cualquier cosa nueva:

1. ¿Quién decide el próximo paso: el que escribe el código o el modelo en runtime?
2. ¿Hay una persona conversando?
3. El test de la arista falsa: ¿este paso consume de verdad el resultado del anterior? Si no, no van en secuencia.

Cuándo **no** armar un grafo (del artículo, vale como regla): tarea chica o aislada; necesidad de aprobar cada paso antes del siguiente; trabajo exploratorio donde todavía no se sabe qué se busca; pasos que de verdad dependen uno del otro. Si no aparecen dos trabajos sin arista entre sí, no hay grafo que armar.

### 4.2 Los seis flujos de GTM pasados por la regla

Prueba de que el vocabulario alcanza. El diseño fino es de las specs de B y C.

| Flujo | Qué es | Por qué |
|---|---|---|
| Búsqueda de target | Workflow | Pasos conocidos. El foco es una fila aprobada por una persona; el lote diario de LinkedIn es nivel 3 por lote (D10) |
| Enrichment | Workflow con fan-out | Un contacto no depende de otro: arista falsa, corren en paralelo |
| Calificación ICP | Workflow aparte | Lo dispara un cambio de estado, no el enrichment. Se re-corre solo cuando cambia el ICP (§6.3) |
| Aprobación | **Puerta**, no workflow | Pantalla que lee filas y llama a un nodo. Ya es así en `/cola` |
| Escucha | Workflow + sesión de agente solo para interpretar | Es la Etapa 5: TypeScript registra el hecho, el modelo interpreta |
| Propuesta comercial | **Agente** | Hay una persona conversando, sube un archivo, y el camino depende de lo que diga el transcript |

El agente `outreach` no desaparece: deja de ser quien ejecuta la corrida paso a paso y pasa a ser la puerta conversacional sobre el mismo pipeline.

## 5. Contratos

### 5.1 Contrato del nodo

1. **Un trabajo.** Si para describirlo hace falta una "y", son dos nodos.
2. **Servicio puro en `lib/<dominio>/services/`**, con dependencias inyectadas (`store`, `generate`, `now`). No importa nada de eve ni de Next.
3. **El tenant viene del `caller`, nunca de un argumento.** El `caller` lo arma la puerta desde la sesión. Un nodo que acepta `tenantId` como input del modelo o del cliente es un bug de seguridad.
4. **Salida con forma fija.** Si llama al modelo: `generateText` + `Output.object({ schema })` con `maxOutputTokens`. Texto libre como salida de un nodo está prohibido.
5. **Rechazo es resultado, no excepción:** `{ ok: false, reason, message }`, el formato de `lib/outreach/result.ts` (D13 de la spec 03). Una excepción queda reservada para infraestructura caída, que es lo único que se reintenta.
6. **Idempotente.** Correrlo dos veces con la misma entrada no duplica nada. Mecanismo: índice único; un `23505` cuenta como "ya estaba hecho".
7. **Lo que viene de afuera es dato, no instrucción.** El texto de una web, un mail o un perfil entra al prompt marcado como contenido a analizar.
8. **Declara su nivel de efecto (0 a 3) y su tier de modelo** (`barato` · `medio` · `fuerte` · ninguno) en el registry.
9. **Si gasta, asienta.** Todo consumo de un recurso medido deja su fila en `usage_entries` (§7.2).

### 5.2 Contrato del workflow

1. **Declara qué reclama y qué deja.** Eso es su posición en el grafo.
2. **El código itera, nunca el modelo:** sobre tenants, sobre ítems, sobre ejecutores (D4 de la Etapa 5, vuelta ley).
3. **Un ítem que falla no frena al resto.** Suma un intento, guarda el error, reintenta con espera creciente, y al tercer fallo pasa a `failed`, visible. Nunca desaparece.
4. **Cuenta lo que entró contra lo que salió** y lo escribe en `runs`: `reclamados = ok + rechazados + fallidos`. Si no cierra, la pasada queda marcada con aviso.
5. **Declara sus topes:** ítems por tick y costo por pasada. Al tope, corta limpio y sigue en el próximo tick.
6. **Nunca llama a un nodo de nivel 3.** Lo más lejos que llega es dejar una pieza `pending`. Única salida: la excepción de §7.4.
7. **Un nodo de nivel 2 solo se ejecuta si la política del tenant para ese nodo es `auto`** (§7.3). Si no, el efecto se difiere a la próxima acción humana sobre ese sujeto.

## 6. Las aristas

### 6.1 `work_items`

Una fila es "este workflow tiene que procesar este sujeto". Es estado operativo, derivado y descartable: el resultado va a la tabla de dominio y el hecho se appendea a `events`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity pk | No uuid: es una cola, nadie la referencia desde afuera, y un uuid v4 fragmenta el índice (`supabase-postgres-best-practices`, regla de PK). Mismo criterio que `events` |
| `tenant_id` | uuid | FK `tenants`, cascade |
| `workflow` | text | Validado contra el registry en código; sin FK |
| `subject_type` | text | `account`, `contact`, … Validado contra el registry |
| `subject_id` | uuid | Sin FK: el sujeto es polimórfico por `subject_type` |
| `input_hash` | text | Huella de todo aquello de lo que depende el resultado (§6.3) |
| `status` | enum `work_item_status` | `pending` · `running` · `done` · `refused` · `failed` |
| `attempts` | smallint | default 0 |
| `next_attempt_at` | timestamptz | default `now()`. Espera creciente tras un fallo |
| `lease_until` | timestamptz | Nullable. Vencido = reclamable de nuevo |
| `last_error` | text | Nullable, acotado en largo |
| `result_reason` | text | Nullable. El `reason` de un `refused` |
| `run_id` | uuid | FK `runs`, nullable. Última pasada que lo tocó |
| `created_at`, `updated_at` | timestamptz | |

Único `(tenant_id, workflow, subject_type, subject_id, input_hash)`. Índice para el reclamo: `(tenant_id, workflow, status, next_attempt_at)`.

RLS: lectura para `is_member_of(tenant_id)` o `is_platform_admin()`; `insert/update/delete` revocados a `authenticated` y `anon`. Escribe solo el cliente admin, igual que `events` y `runs`.

Antes de escribir el SQL, cargar `supabase-postgres-best-practices` (regla del repo).

### 6.2 `enqueue()`

Única forma de crear una arista. Vive en `lib/workflows/enqueue.ts`.

```ts
enqueue({ tenantId, workflow, subjectType, subjectId, inputHash }, { store })
// → { enqueued: true } | { enqueued: false, reason: "ya_visto" }
```

La llaman:

- **el runner**, cuando un ítem termina `done`: mira en el registry qué workflows reclaman lo que este deja, y encola para cada uno que el tenant tenga prendido;
- **las puertas**, cuando el cambio viene de afuera: un CSV importado, un contacto editado a mano, una página de canon reescrita en el brain;
- **un sembrador por workflow**, opcional, para trabajo que nace del paso del tiempo y no de un evento (una ficha que venció). Es una función `seed` de la implementación del workflow, que el runner corre antes de reclamar; el registry lo declara con `entry: "seed"`.

Un choque con el índice único (`23505`) devuelve `ya_visto` y no es error.

### 6.3 `input_hash`

Huella estable de las entradas de las que depende el resultado. Cada workflow declara cómo la calcula.

- Da **recálculo gratis**: para la calificación ICP será *(versión del enrichment + revisión de la página `canon:icp`)*. Cambió el ICP → huella nueva → fila nueva → se recalifica solo.
- **Cuida la plata**: no cambió nada → `23505` → no se paga dos veces.
- Cumple la advertencia más fina del artículo: *deduplicar contra todo lo visto, no solo contra lo confirmado.* La fila queda aunque el resultado haya sido `refused` o `failed`, así que no se paga para redescubrir el mismo callejón sin salida.

Para `refresh-fichas`: *(dominio + fecha de vencimiento de la ficha que se reemplaza)*.

### 6.4 Reclamo con lease

Función SQL `claim_work_items(p_tenant, p_workflow, p_limit, p_lease_seconds)`: con `for update skip locked` toma hasta N filas que estén `pending` con `next_attempt_at <= now()`, o `running` con `lease_until < now()`; las marca `running`, les pone `lease_until` y suma `attempts`. `security definer`, `search_path = ''`, `execute` solo para `service_role`.

Dos ticks superpuestos nunca agarran la misma fila. Si un proceso muere, el lease vence y la fila vuelve a estar disponible. Es lo que hace que pasar del volumen de hoy al techo de D4 sea subir un número.

Espera creciente tras un fallo: 5 min, 30 min. Al tercer intento fallido, `failed`.

Un proceso que muere cuenta como intento: el reclamo ya sumó `attempts` antes de que el nodo corriera. La función no vuelve a entregar filas con `attempts >= 3`; las que encuentra `running`, con el lease vencido y los intentos agotados, las pasa a `failed` con `last_error = 'lease vencido'` en la misma llamada. Así ninguna fila queda reclamable para siempre ni colgada en `running`.

### 6.5 Dispatcher

Un solo schedule, `agents/outreach/schedules/dispatch.ts`, handler `run`, cada 5 minutos.

1. Recorre los tenants con `active = true`.
2. Por cada uno, los workflows con `tenant_workflows.enabled = true` cuya cadencia venció.
3. Chequea presupuesto (§7.2). Si está agotado, cierra la pasada como `budget_exhausted` y sigue con el próximo.
4. Corre el sembrador del workflow, si tiene.
5. Reclama **por tenant, con tope**: un cliente ruidoso no deja sin turno a los demás.
6. Procesa cada ítem aislado en su `try/catch`. Deja de reclamar cuando el reloj de la pasada se acerca al límite de la función.
7. Cierra la fila de `runs` con los conteos y el costo.

No lleva lock global: el lease da exclusión mutua por ítem, y dos ticks a la vez son seguros por construcción.

Un workflow pertenece al dominio de un agente, porque el schedule vive en su carpeta y comparte sus nodos. Cuando exista un segundo agente con workflows propios, tendrá su propio `dispatch.ts` sobre el mismo runner de `lib/workflows/`.

### 6.6 `runs`

Columnas nuevas: `workflow` text nullable; `items_claimed`, `items_ok`, `items_refused`, `items_failed` integer nullable. El enum de status suma `budget_exhausted`. `trigger` sigue siendo `schedule` para las pasadas del dispatcher.

## 7. La escala de efectos

| Nivel | Qué toca | Regla | Ejemplos |
|---|---|---|---|
| **0** | Solo la base de la plataforma | Corre solo. Sin aprobación | research, puntaje ICP, borrador, reintentar un ítem |
| **1** | Gasta plata de terceros | Corre solo, con presupuesto por pasada y por tenant por día. Al tope, corta y avisa | tokens del modelo, créditos de Apollo |
| **2** | Escribe en sistemas del tenant | Política por tenant y por nodo: `always` · `once` · `auto`. Default `always` | alta de contacto o empresa en HubSpot |
| **3** | Le llega a una persona de afuera | Aprobación humana siempre. Única salida: excepción explícita por tenant + canal + tipo, apagada por default | mail, DM, auto-respuesta, pedido de conexión |

### 7.1 Qué nivel tienen los nodos de hoy

| Nodo (servicio) | Nivel | Tier |
|---|---|---|
| `importContacts` | 0 | — |
| `prepareResearch` / `runResearch` / `saveResearch` | 1 | barato |
| `draftMessage` | 1 | fuerte (`msg1`) · medio (follow-up) |
| `queueTouch`, `updateQueueItem`, `rejectQueueItem`, `listQueue` | 0 | — |
| `sendQueuedEmail` | 3 | — |
| registro en CRM (`crm-record`) | 2 | — |
| `brain_upsert` | 2 | — |
| barrido de escucha, reconciliación, encolado de follow-ups | 0 | — |
| clasificación de respuestas | 1 | barato |

La lista definitiva sale de recorrer `lib/*/services/` al armar el registry; esta tabla fija el criterio.

### 7.2 Nivel 1: medir y cortar

**`usage_entries`**, append-only:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity pk | Append-only: mismo criterio que `events` |
| `tenant_id` | uuid | |
| `run_id` | uuid | FK `runs`, nullable (un nodo llamado desde el chat también asienta) |
| `workflow` | text | Nullable |
| `node` | text | Nombre del nodo en el registry |
| `resource` | text | `model_usd`, `apollo_credits`, … |
| `amount` | numeric | |
| `unit` | text | `usd`, `credits` |
| `meta` | jsonb | modelo, tokens de entrada y salida, tokens cacheados |
| `created_at` | timestamptz | |

Sin `UPDATE` ni `DELETE`, igual que `events`. Lectura: `amount` de `model_usd` es costo interno y lo ve solo `platform_admin`, con el mismo criterio que `runs.cost_usd`.

`runs.cost_usd` pasa a ser la suma de `model_usd` de la pasada, escrita al cerrarla.

**Dos topes, los dos duros:**

- *Por pasada*, declarado en el registry. Protege contra un bug que itera de más.
- *Por tenant, por día, por recurso*, en `tenant_budgets`. Protege la cuenta. El día se corta en la `timezone` de la config del agente dueño del workflow.

**Qué suma y qué corta.** La suma del día incluye todo el consumo del recurso para ese tenant, venga del chat o de un workflow: el presupuesto protege la cuenta, no una puerta. Pero **solo el runner se corta**. En esta etapa el uso interactivo nunca se bloquea por presupuesto: hay una persona mirando, y dejarla a mitad de una corrida por un tope pensado para lo desatendido sería peor que el gasto. Consecuencia aceptada: un día de mucho chat puede dejar sin presupuesto a los workflows hasta el día siguiente.

Antes de reclamar, el runner suma lo gastado hoy. Al tope: no reclama, los ítems quedan `pending` intactos, la pasada se cierra como `budget_exhausted` y el aviso sale **una vez** por día.

**Dónde se engancha la medición: en la puerta, no en el servicio.** Un envoltorio `metered()` rodea la función `generate` que cada puerta ya le inyecta al servicio, y asienta el costo de cada llamada. Los servicios no conocen el libro de consumo y sus tests no cambian. Como es fácil olvidarlo en una puerta nueva, un test contra el disco obliga: todo archivo que importa `generateText` de `ai` tiene que usar `metered`.

Hoy llaman al modelo tres puertas: las tools `draft_message` y `research_account`, y el schedule `followups` (que redacta los follow-ups). La clasificación de respuestas no es una llamada propia: la hace el agente dentro de su turno. Las tres asientan en esta etapa; sin eso el criterio de cierre 3 no se cumple.

El costo sale de lo que informe el AI Gateway en `providerMetadata` y, si no informa, de una tabla de precios por modelo en código (spike S1).

### 7.3 Nivel 2: política por tenant

`approval` de eve acepta una función async que recibe la sesión y decide (`patterns/multi-tenant-approvals.md`). Un adaptador en `lib/workflows/approval-policy.ts` lee la política del nodo para el tenant de la sesión. Vive en `tenant_agents.config.approvals`, un mapa `nodo → always | once | auto`. Sin entrada: `always`.

Regla para lo desatendido, donde no hay a quién preguntarle: contrato del workflow, punto 7. Es lo que ya pasa hoy: la atribución se escribe en HubSpot cuando se aprueba el mail, no antes.

### 7.4 Nivel 3: aprobación y excepción

**La unidad de aprobación es una fila en la cola, y puede ser una pieza o un lote.** Se aprueba siempre por una puerta, con un click humano, y queda en `events` quién y cuándo. Es la D3 de la Etapa 4 generalizada. El soporte de lotes en `queue_items` se diseña en la spec de B.

**La excepción**, apagada por default, se prende por *tenant + canal + tipo de pieza*. Esta spec fija su forma y sus condiciones; el diseño fino es de la Etapa 16. Para prenderla tienen que cumplirse cuatro cosas:

1. La confianza la pone un verificador con contexto fresco, nunca el nodo que redactó.
2. Hay historial que no se puede discutir: la tasa de piezas de ese tipo aprobadas sin edición (`queue_items.draft_original` contra lo enviado), con un mínimo de piezas y una tasa mínima.
3. Tope diario propio, aparte de los del nivel 1.
4. Todo lo que sale solo queda marcado (`auto: true` en el evento) y aparece en una lista de "salió sin aprobación".

## 8. Verificadores, anclas y reglas congeladas

### 8.1 Dónde va un verificador

Regla: **primero un ancla determinística. Un verificador con modelo solo donde no existe chequeo en código y hay evidencia externa contra la cual contrastar** (D12).

- **Obligatorio: el hecho que ancla un mensaje.** Cada hecho de la ficha trae su URL, pero nadie comprueba que esa página diga eso. El nodo `verify_fact` recibe solo la afirmación y el texto de la página, y devuelve `keep` o `drop` con schema. Se corre sobre el hecho que se va a usar, al redactar; no sobre toda la ficha. Tier barato. **Se implementa en la Etapa 13**, con el pipeline que lo usa; acá queda fijada la regla.
- **Obligatorio cuando se prenda** la excepción del nivel 3.
- **Explícitamente no** en el puntaje ICP: un segundo modelo puntuando es la misma opinión dos veces. Su control son las anclas de §8.2.

"Contexto fresco" se traduce a una prohibición concreta: al verificador nunca se le pasa el razonamiento, la explicación ni la conversación del nodo que produjo el dato. Solo el dato y la evidencia.

### 8.2 Las anclas

| Ancla | Dónde vive |
|---|---|
| El gate de estilo determinístico | `lib/outreach/gate.ts` |
| Un envío existe solo si el proveedor devolvió sus ids | `sendQueuedEmail` |
| La reconciliación confirma solo lo que puede probar | Etapa 5 §4.5 |
| Índice único + `23505` = ya estaba hecho | toda la base |
| Entraron N, salieron N | §5.2 punto 4 |
| Lo que hizo el humano: aprobó, editó, rechazó | `queue_items.draft_original` contra lo enviado |
| Lo que hizo el mundo: respondieron, hubo reunión, nació un deal | `events`, CRM |
| Evals con casos etiquetados a mano | `agents/outreach/evals/` |

### 8.3 Reglas congeladas

Ningún nodo, workflow ni agente puede modificar:

1. **Sus propios criterios de evaluación.** Ningún nodo escribe en páginas `canon:*` del brain sin aprobación humana.
2. **Presupuestos y topes** (`tenant_budgets`, topes del registry).
3. **Los interruptores de la excepción del nivel 3.**
4. **La métrica con la que se lo juzga.** A un workflow se lo mide con números que vienen de afuera (respuestas, aprobaciones sin edición), nunca con los que reporta él mismo. "Piezas encoladas" o "puntaje promedio" no son métricas de éxito.

Cumplimiento: 2 y 3 no tienen tool ni server action que los escriba fuera de `platform_admin`; 1 ya está cubierto por el `approval` de `brain_upsert`.

## 9. Registry y cumplimiento

### 9.1 `lib/workflows/registry.ts`

Un objeto plano. Sin framework ni `defineNode()`.

```ts
export const NODES = {
  "outreach/research": { effect: 1, tier: "barato" },
  "outreach/draft":    { effect: 1, tier: "fuerte" },
  "outreach/send":     { effect: 3, tier: null },
  // …
} as const;

export const WORKFLOWS = {
  "refresh-fichas": {
    agent: "outreach",
    subjectType: "account",
    claims: "ficha_vencida",
    produces: "ficha_vigente",
    nodes: ["outreach/research"],
    optionalNodes: [],
    resources: ["model_usd"],
    caps: { itemsPerTick: 5, costUsdPerRun: 1 },
    entry: "seed",
  },
} as const;
```

`claims` y `produces` son etiquetas del grafo: el runner encola aguas abajo para todo workflow cuyo `claims` coincida con el `produces` del que terminó. `resources` son los recursos medidos que gasta, contra los que se chequea el presupuesto diario. `entry` dice de dónde le llega el trabajo (`seed`, `door` o `upstream`) y es lo que le permite al test 5 de §9.3 distinguir un `claims` huérfano de uno que entra por sembrador o por puerta.

La clave de un nodo es mecánica: `lib/<dominio>/services/<archivo>.ts` → `"<dominio>/<archivo>"`. Un archivo de servicio que no es un nodo por sí mismo (un helper, o la llamada al modelo de otro nodo) va a una lista de excluidos con su motivo.

Los parámetros propios de un workflow no llevan schema en el registry: `parseTenantWorkflowConfig` valida lo que es de la plataforma (cadencia, ítems por tick, nodos opcionales) y le pasa el resto a la implementación como `params`.

### 9.2 Runner

`lib/workflows/runner.ts`: función pura con dependencias inyectadas (`store`, `now`, `budget`, mapa de implementaciones de nodo). Implementa §5.2 y §6.5 pasos 3 a 7. El schedule `dispatch.ts` es una puerta fina que le arma las dependencias reales.

Lo que devuelve procesar un ítem:

```ts
type ItemOutcome =
	| { ok: true; downstream?: Array<{ subjectId: string; inputHash: string }> }
	| { ok: false; reason: string; message: string };
```

Un ítem puede dejar varios sujetos aguas abajo (enmienda de la Etapa 13 §15, punto 6). `downstream` es la lista de sujetos que este ítem deja para el workflow de abajo: suele ser el mismo sujeto (1 a 1), pero una búsqueda de target deja N contactos a partir de un foco (spec etapa 13 §4.1). Sin `downstream`, el ítem no deja nada aguas abajo, aunque haya un workflow habilitado que reclame lo que este produce.

### 9.3 Tests que hacen cumplir

Mismo patrón que `tests/agents/running-tool.test.ts`: comparan contra el disco y fallan hasta que alguien decide.

1. Todo archivo de `lib/*/services/` está en `NODES` o en una lista explícita de excluidos con motivo.
2. Ningún workflow referencia en `nodes` ni en `optionalNodes` un nodo con `effect: 3`.
3. Todo workflow con un nodo `effect >= 1` declara `caps.costUsdPerRun`.
4. `parseTenantWorkflowConfig` rechaza un nodo opcional que el workflow no declara.
5. Todo `claims` tiene quién lo produzca, salvo los que declaren sembrador o entrada por puerta.

### 9.4 Lo que hay que mover para que las puertas queden finas

Hoy dos nodos no son servicios puros: parte de su lógica vive adentro de la tool, que es una puerta.

- `agents/outreach/tools/research_account.ts` contiene `generateResearch` (la llamada al modelo con `leer_pagina`), `resolveHost`, y la composición `prepareResearch → runResearch → saveResearch`. Un workflow no puede importar una tool de eve, así que `refresh-fichas` no tiene qué llamar.
- `agents/outreach/tools/draft_message.ts` contiene `generateDraft`.

Se mueven a `lib/outreach/services/` como un servicio por nodo, con la misma firma de dependencias inyectadas que ya usan, y las tools quedan como puertas: arman el `caller`, arman las dependencias reales, llaman. Es un movimiento, no una reescritura; los tests existentes de `generateResearch` y `generateDraft` se mudan con el código. El de research entra en E3 porque lo necesita el primer workflow; el de draft entra en E1, porque es donde se engancha la medición.

Regla que sale de acá y va a `docs/02-orquestacion.md`: **una tool de eve no contiene llamadas al modelo ni lógica de negocio.** Si la tiene, hay un nodo escondido adentro de una puerta.

## 10. Configuración por tenant y visibilidad

### 10.1 `tenant_workflows`

| Campo | Notas |
|---|---|
| `tenant_id`, `workflow` | PK. `workflow` validado contra el registry, sin FK |
| `enabled` | **Default `false`.** Un workflow desatendido gasta plata solo: se prende a propósito |
| `config` jsonb | Validado por `parseTenantWorkflowConfig`: lo de la plataforma con schema zod, el resto pasa como `params` del workflow |
| `last_run_at` | Para la cadencia |
| `created_at` | |

En `config`: `cadence_minutes`, `items_per_tick` (nunca por encima del tope del registry), `optional_nodes`, y los parámetros propios del workflow.

**Nodos opcionales.** El registry declara cuáles admite cada workflow y en qué posición; el tenant lista los que quiere. Una config que nombra un nodo inexistente falla la validación con ruido.

**Modelos.** El nodo declara un tier; la plataforma tiene defaults por tier (`barato` → Haiku 4.5, `medio` → Sonnet 5, `fuerte` → Opus 5, kickoff §3b); el tenant puede pisar un tier. Los overrides por rol que ya existen en `config.models` siguen valiendo y ganan por más específicos.

### 10.2 `tenant_budgets`

`tenant_id`, `resource`, `daily_limit`, `updated_by`, `updated_at`. PK `(tenant_id, resource)`. Sin fila para un recurso medido, el límite es cero: nada desatendido gasta sin presupuesto explícito. Escribe solo `platform_admin`; cada cambio queda en `events`.

Tabla aparte y no adentro de `tenant_workflows` porque un recurso se comparte entre workflows y porque es regla congelada.

**Quién edita:** INNOV.AS al principio, igual que con las llaves (D3 de la spec de arquitectura). En esta etapa se carga por script, como `npm run outreach:config`; la pantalla es de la Etapa 9.

### 10.3 Qué ve el operador

Esta etapa no construye pantallas. Deja los datos para contestar tres preguntas:

1. **¿Qué hay pendiente o trabado?** → `work_items` agrupado por workflow y estado. Un ítem `failed` se reintenta por una puerta de nivel 0.
2. **¿Qué corrió y cuánto costó?** → `runs` con `workflow` y conteos. Alimenta `/ejecuciones` de la Etapa 9.
3. **¿Por qué este sujeto tiene este resultado?** → `events`. Cada nodo que produce un resultado de negocio appendea su hecho con razones y fuentes en el payload. El detalle de `/contactos` ya lee el historial.

### 10.4 Avisos

Tres condiciones interrumpen: **presupuesto agotado, ítems en `failed`, y cuenta que no cierra.** Van al resumen de la mañana (`lib/outreach/summary.ts`), que la Etapa 5 convirtió en el hilo diario. Sin sistema de notificaciones nuevo.

## 11. Manejo de errores

| Caso | Qué pasa |
|---|---|
| Un nodo devuelve `{ ok: false }` | Ítem `refused` con su `reason`. No se reintenta: es respuesta de negocio |
| Un nodo tira excepción | Ítem vuelve a `pending` con espera creciente. Al tercer intento, `failed` |
| El proceso muere a mitad de una pasada | El lease vence y los ítems vuelven a estar reclamables. La fila de `runs` queda `running`; un barrido al inicio de cada pasada cierra como `failed` las que pasaron su límite |
| Dos ticks a la vez | `skip locked`: cada uno toma ítems distintos |
| Presupuesto agotado | Pasada `budget_exhausted`, ítems intactos, aviso una vez por día |
| Un tenant explota | No frena a los demás |
| Config del tenant inválida | Ese workflow no corre para ese tenant; pasada `failed` con el error de validación; aviso |
| `enqueue()` de algo ya visto | `23505` → `ya_visto`. No es error |
| La cuenta de la pasada no cierra | Pasada con aviso. Es un bug del runner, no un caso operativo |
| Un workflow prendido que ya no existe en el registry | Se saltea con aviso; no rompe el dispatcher |

## 12. Dónde viven las reglas

| Capa | Qué va |
|---|---|
| Tests que fallan | §9.3 |
| `CLAUDE.md` | El bloque de abajo |
| `docs/02-orquestacion.md` | La ley: escalera (§4), contratos (§5), escala de efectos (§7), anclas y reglas congeladas (§8), y cómo agregar un nodo o un workflow paso a paso. Corta, sin historia. Apunta a esta spec para el porqué |

Bloque para `CLAUDE.md`. **Se mergea junto con la implementación**, no antes (D14). Reemplaza la línea *"Toda tool con efecto externo lleva `approval` explícito"*:

```md
## Orquestación (leer docs/02-orquestacion.md antes de crear un nodo, workflow o agente)
- Se sube un escalón (llamada al modelo → nodo → workflow → agente) solo cuando el anterior no alcanza.
- Workflows y agentes por capacidad, nunca por cliente. La diferencia entre tenants es una fila y su brain.
- Nodo = servicio puro en lib/<dominio>/services/: un trabajo, salida con schema, tenant desde el caller.
  Va registrado en lib/workflows/registry.ts con nivel de efecto (0-3) y tier. El test falla si falta.
- Nivel 2 y 3 llevan approval según la política del tenant. Un workflow desatendido nunca llama a un
  nodo de nivel 3: deja una pieza pending.
- En un workflow itera el código, nunca el modelo. Un ítem que falla no frena al resto.
  Se cuenta lo que entró contra lo que salió.
- Las aristas se crean solo con enqueue(). Sin triggers.
- Todo nodo que gasta deja su asiento en usage_entries.
- Un verificador recibe el dato y la evidencia, nunca el razonamiento de quien lo produjo.
- Ningún nodo escribe canon:*, presupuestos ni interruptores de autonomía. Eso lo hace una persona.
- Un workflow está terminado cuando su primera corrida real aparece en runs en producción.
```

Se suma una pregunta a la revisión de cada PR, junto a la del kickoff §9: *"¿qué nivel de efecto tiene cada nodo nuevo, y está en el registry?"*

**Aplicado el 2026-09-21 (E4)** en `CLAUDE.md` y en `docs/02-orquestacion.md`, con un desvío: el adaptador `lib/workflows/approval-policy.ts` de §7.3, que haría que el `approval` de una tool del chat lea la política del tenant, no se construyó. Hoy la política `always | once | auto` la leen solo los workflows (`nodePolicy` en `lib/workflows/store.ts`), y en el chat toda tool de nivel 2 o 3 lleva `approval` explícito. La línea del bloque se ajustó a eso. Se construye cuando algún tenant necesite nivel 2 sin aprobación desde el chat.

## 13. Spikes

| # | Pregunta | Bloquea a | Si da que no |
|---|---|---|---|
| S1 | ¿El AI Gateway devuelve el costo por llamada en los metadatos de la respuesta de `ai` 7? | `usage_entries` | **Resultado (2026-09-20): sí.** `providerMetadata.gateway.cost` viene como **string** (`"0.000033"` para 13 tokens de entrada y 4 de salida con Haiku 4.5), junto a `marketCost`, `gatewayCost` e `inferenceCost`. Coincide al centavo con la tabla de precios ($1/M entrada, $5/M salida). El Gateway es la fuente primaria; la tabla de `lib/workflows/pricing.ts` queda de respaldo, con el test que falla si un modelo en uso no tiene precio |
| S2 | ¿Un handler de schedule aguanta ~200 s de trabajo útil por tick en producción? | Dispatcher | **Resultado (2026-09-21): sí, con margen.** El timeout real de función configurado en Vercel (proyecto `agents`, Settings → Functions) es **300 s**. Los valores de referencia del plan (`clockBudgetMs: 200_000`, `leaseSeconds: 600`) quedan confirmados tal cual: 200 s de presupuesto deja 100 s (33%) de margen contra el techo de 300 s, y el lease de 600 s dobla ese techo, así que ningún ítem puede vencer mientras la función que lo tomó todavía está corriendo. No hizo falta el dato de `morning-sweep` en producción (ese schedule además no cierra su propia fila de `runs` hoy, así que no habría podido medirse desde ahí sin arreglarlo primero) |
| S3 | ¿`defineWorkflowTool` con `ctx.ask` corre en `agents/outreach/` sobre eve vigente? | Solo la Etapa 15 | La propuesta comercial se hace como agente conversacional común, sin workflow tool |

S1 es la primera tarea de la implementación. S3 es parte de la Etapa 14.

## 14. Delta del roadmap

**Aplicado el 2026-09-20** en `docs/01-roadmap-etapas.md` y `docs/innovas-agents-kickoff.md`, en un PR propio posterior al #30 (el #30 se mergeó antes de que este cambio llegara a él), una vez que terminó el hilo que estaba editando el roadmap. Las correcciones de §14.3 también: las Etapas 3, 4 y 5 quedaron `[x]` siguiendo el registro de avance del kickoff (PR #27), y la línea de ColdIQ/Places pasó a la Etapa 13.

### 14.1 Etapas nuevas

| Etapa | Qué es | Depende de |
|---|---|---|
| **12 · Modelo de orquestación** | Esta spec | 5 |
| **13 · Pipeline GTM** | Búsqueda de target con Apollo como proveedor de la capacidad `leads` · enrichment de cuenta y persona · calificación ICP · `verify_fact` · cola por pieza y por lote, con cambio de canal · pantalla del embudo. LinkedIn como sub-entrega, atada a elegir proveedor (D2 de la spec de arquitectura: no hay API oficial). Absorbe la línea "Flujo de carga desde el chat con ColdIQ y Places" que la Etapa 5 dejó afuera en su D1 | 12 |
| **14 · Subida de eve** | 0.54.2 → vigente, con S3 adentro. Releer `node_modules/eve/docs` completo; rutas de agentes nombrados (0.58), cliente del chat, tests de canal, dispatch de schedules | 5 |
| **15 · Propuesta comercial** | Agente conversacional: contexto del contacto + transcript subido + brain → propuesta en formato fijo | 14 si usa workflow tool |
| **16 · Auto-respuesta con umbral** | La excepción del nivel 3 sobre la escucha (§7.4) | 5 **y** historial suficiente: arranca por datos, no por fecha |

### 14.2 Orden recomendado

**5 → 12 → 13 → 7.** La 12 y la 13 van antes del segundo tenant: la prueba de la Etapa 7 es "corre sin tocar `agents/` ni `lib/`", y hacerla antes validaría con el cliente nuevo la corrida manejada desde el chat, que es lo que se está por reemplazar. La 9 conviene después de la 12, que le genera los datos. La 14 es independiente de 12 y 13. Las 6, 8, 10 y 11 no se mueven.

### 14.3 Correcciones al tracker que esta spec no hace

- Las Etapas 3, 4 y 5 figuran `[ ]` con su código mergeado (PRs #22 a #26). No se tildan acá: tildar exige confirmar el "Terminado cuando" de cada una contra producción, y eso lo sabe quien corrió los pilotos.
- La Etapa 5 conserva en su lista la línea de ColdIQ y Places, que su propia spec sacó del alcance. Pasa a la Etapa 13.

### 14.4 Enmiendas a otros documentos

- **Kickoff §2, principio 3** ("todo efecto externo con aprobación"): reemplazado por la escala de §7.
- **Kickoff §10** ("LinkedIn automático" fuera de la v1): sigue fuera de la v1; entra en la Etapa 13 como sub-entrega, por lote y con proveedor tercero.
- **Spec 03, D2** (orquestación híbrida: tools que el modelo encadena): sigue vigente para el chat. Lo desatendido pasa a workflows.
- **Spec 03, D8** (todo envío con `approval: always()`): sigue vigente. La excepción de §7.4 es la única salida y nace apagada.

## 15. Testing

Lógica en funciones puras, que es donde va el TDD:

- `lib/workflows/runner.ts` con `store` falso: un ítem que explota no corta el loop; la cuenta cierra; corta por tope de ítems, de costo y de reloj; nunca invoca un nodo de nivel 3; no ejecuta nivel 2 sin política `auto`.
- `lib/workflows/enqueue.ts`: `23505` → `ya_visto`; encola aguas abajo solo para workflows prendidos.
- `lib/workflows/budget.ts`: suma por día en la zona horaria del tenant; sin fila, límite cero.
- `input_hash` de cada workflow: estable ante el mismo input, distinto ante un cambio relevante.
- `supabase/tests/`: RLS de `work_items`, `usage_entries`, `tenant_workflows`, `tenant_budgets` (fuga entre tenants; `authenticated` no escribe; `model_usd` invisible para un `tenant_admin`); `claim_work_items` con dos sesiones concurrentes no entrega la misma fila; lease vencido se vuelve a reclamar.
- Los tests de §9.3.
- El schedule `dispatch.ts` con dependencias inyectadas, disparado en dev por la ruta de dispatch.

## 16. Fuera de alcance

- El pipeline de GTM, `verify_fact`, Apollo y LinkedIn (Etapa 13).
- Lotes en `queue_items` y cambio de canal en la cola (Etapa 13).
- Pantallas de embudo, ejecuciones y presupuestos (Etapas 13 y 9).
- La subida de eve y `defineWorkflowTool` (Etapa 14).
- Propuesta comercial (Etapa 15) y auto-respuesta (Etapa 16).
- Migrar `morning-sweep` y `followups` a `work_items` (D15).
- Colas dedicadas, backpressure, tiempo real (D4).
- Grafo definido por datos o editor de flujos (kickoff §10).
- Autoservicio del `tenant_admin` para prender workflows y fijar presupuestos.
- Facturación por tenant: `usage_entries` la habilita, no la implementa.

## 17. Riesgos

- **Sobre-ingeniería para el volumen real.** Decenas de ítems por día no necesitan una cola. Mitigación: una tabla, una función SQL y un runner; nada de framework. Si `refresh-fichas` resulta más código de infraestructura que de negocio, revisar antes de la Etapa 13.
- **El registry se desactualiza.** Mitigación: los tests de §9.3 comparan contra el disco.
- **Doble fuente de verdad entre `work_items` y el dominio.** Mitigación: `work_items` nunca guarda resultados, solo estado de procesamiento; borrarla entera no pierde datos de negocio.
- **Costo mal medido.** Si S1 da que no, los precios quedan en código y se desactualizan. Mitigación: test que falla ante un modelo sin precio, y contraste mensual con el tablero del Gateway.
- **El dispatcher como punto único de falla.** Si el cron no se registra en Vercel, nada corre y nadie se entera. Mitigación: criterio de cierre contra producción, confirmar en Settings → Cron Jobs, y aviso en el resumen de la mañana si un workflow prendido no tuvo pasadas en 24 horas.
- **Timeout de la función.** Un ítem lento puede comerse la pasada. Mitigación: reloj de pasada, `abortSignal` por ítem, lease más largo que el timeout.
- **Acoplamiento a `innovas`.** Mitigación: criterio de cierre 7 y la pregunta de cada PR.
- **eve en preview.** El dispatcher depende de la forma `run` de los schedules, que la Etapa 5 ya ejerce en producción. La Etapa 14 tiene que volver a correr el criterio de cierre de esta etapa después de subir la versión.

## 18. Referencias

- "Graph Engineering" (2026): nodos con contrato, aristas falsas, fan-out → reduce → synthesize, verificador con contexto fresco, deduplicar contra todo lo visto, tres condiciones de corte, fallas (colapso de contexto, falsa independencia, nodo que muere en silencio), tiering de modelos, cuándo no armar un grafo, anclas y reglas congeladas, tope primero y escala después.
- Anthropic, "Building effective agents": https://www.anthropic.com/engineering/building-effective-agents — *workflows* (orquestación por caminos de código predefinidos) contra *agents* (el modelo dirige su proceso); cinco patrones; empezar simple y sumar complejidad solo cuando lo simple no alcanza.
- eve 0.54.2, doc local: `tools/workflows.mdx`, `schedules.mdx`, `subagents/index.mdx`, `patterns/dynamic-scheduling.md`, `patterns/multi-tenant-approvals.md`, `concepts/execution-model-and-durability.mdx`.
- eve, changelog: https://github.com/vercel/eve/blob/main/packages/eve/CHANGELOG.md
