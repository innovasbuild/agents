# Etapa 21.5: gasto de IA por empresa (libro completo, tags en el gateway y reporte mensual)

**Fecha:** 2026-10-13
**Estado:** diseño aprobado en conversación; falta la revisión de este documento.
**Rama:** `feat/etapa-21-5-gasto-ia`, sale de `main`. Esta spec vive en `docs/etapa-21-5-gasto-ia`.
**Antecedentes:** `2026-09-20-orquestacion-plataforma-design.md` (§5.1 punto 9 y §7.2: libro de consumo y presupuestos), `2026-10-10-etapa-21-3-config-outreach-design.md` (O11, O12 y O13: quién fija presupuestos, qué ve el cliente y cómo lee), `2026-10-10-etapa-21-2-settings-cliente-design.md` (S1, funciones del cliente).

## 1. Qué resuelve

INNOV.AS necesita saber cuánto gasta en modelos cada empresa, para facturar y cuidar el margen, y cada empresa necesita ver su propio gasto. Hoy eso falla en tres puntos:

- **El libro está incompleto.** `usage_entries` solo recibe las llamadas envueltas en `metered()` (tools y schedules). Los pasos del propio agente en el chat no asientan nada: `hooks/runs.ts` abre y cierra la corrida, y `closeRun` suma un libro donde esos pasos no están. El "Gastado hoy" y `runs.cost_usd` de un turno de chat dejan afuera el modelo del agente.
- **El gateway no sabe de empresas.** Todas las llamadas salen con la autenticación de la plataforma y sin ninguna marca. En Vercel se ve el gasto total, no el de cada cliente, y no hay contra qué controlar el libro.
- **No hay vista de período.** El cliente ve límite y gasto del día (21.3, O12). Nadie ve el mes, ni INNOV.AS ve a todas las empresas juntas.

La línea original del roadmap pedía una clave del AI Gateway por cliente. Se descarta (G1): con tags se obtiene el mismo corte por empresa sin crear, guardar ni rotar un secreto por cliente.

Al cerrar esta entrega:

- Cada paso del agente en el chat deja su asiento en `usage_entries`.
- Toda llamada al modelo sale con el tag `tenant:<slug>`.
- El administrador del cliente ve su gasto del mes en curso y del anterior, por día y por origen.
- INNOV.AS ve a todas las empresas en una pantalla y puede conciliar el libro contra el gateway.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| G1 | Tags, no una clave del gateway por empresa | Una clave por cliente obliga a crearla, guardarla en Vercel Connect, asociarla en el alta, rotarla y resolver el proveedor en cada llamada. El tag sale del slug. Se pierde el tope duro y la revocación por cliente en el gateway (ver §9) |
| G2 | El libro (`usage_entries`) es la fuente de las dos pantallas. El gateway solo concilia | El libro tiene detalle por corrida y por proceso, es inmediato y es el mismo número que usa el presupuesto. El reporte del gateway es beta, cobra por consulta, demora minutos y no conoce corridas |
| G3 | El gasto del agente en el chat se asienta con un hook en `step.completed` | eve informa ahí `usage.costUsd` y los tokens de cada llamada al modelo. Es el único punto que ve los pasos del agente |
| G4 | Ese gasto es `model_usd` y cuenta contra el mismo límite diario | Decidido el 2026-10-13. Un solo número por empresa. El chat sigue sin cortarse por presupuesto: solo el runner corta (orquestación §7.2) |
| G5 | Un solo tag por llamada: `tenant:<slug>` | Es el único corte que hace falta en el gateway. El detalle por proceso ya está en el libro. El slug vive en las URL y no cambia |
| G6 | El tag se arma en un único helper y un test obliga a usarlo | Una llamada sin tag no se nota hasta conciliar. Mismo mecanismo que hoy obliga a usar `metered` |
| G7 | Las pantallas de período cortan por día en UTC | El gateway reporta en UTC; con otro corte la conciliación nunca cierra. El mes del cliente y el que factura INNOV.AS son el mismo. El presupuesto diario sigue en la zona horaria de la empresa |
| G8 | Período: mes en curso y mes anterior | Decidido el 2026-10-13. Alcanza para facturar |
| G9 | El cliente ve total, por día y por origen (chat y cada proceso automático). No ve costo por corrida | Extiende O12 sin abrir `runs.cost_usd` ni las filas de `usage_entries` |
| G10 | La conciliación es a pedido, con un botón, y no se guarda | Cada consulta al reporte del gateway se cobra. Guardar resultados es una tabla más sin lector |
| G11 | Sin carga de historia | Lo gastado en el chat antes del deploy no está en el libro ni tiene tag en el gateway. El reporte arranca el día del deploy |

## 3. Asiento del chat

Hook nuevo `agents/outreach/hooks/usage.ts`, suscripto a `step.completed`.

- Resuelve el tenant igual que `hooks/runs.ts`: `ctx.session.auth.current ?? initiator`, atributo `tenantId`. Sin tenant no asienta.
- Resuelve la corrida con `resolveRunId(admin, ctx.session.id, event.data.turnId)`, que ya existe en `lib/workflows/usage.ts`.
- Asienta con `createUsageRecorder`:

| Campo | Valor |
|---|---|
| `resource` | `model_usd` |
| `unit` | `usd` |
| `workflow` | `null` |
| `node` | `agent/step` |
| `amount` | `usage.costUsd`; si falta, el de la tabla de precios (`modelCostUsd`) con los tokens del paso |
| `meta` | `agent`, `model`, `source` (`gateway` o `tabla`), `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `stepIndex` |

- Nunca tira: todo el cuerpo va en `try/catch`, igual que `hooks/runs.ts`. La medición no puede tumbar un turno.
- No duplica. Las llamadas que hacen las tools por dentro (`generateText`, `evaluate`) son llamadas aparte que ya asienta `metered`; no son pasos del agente y no emiten `step.completed`.
- `closeRun` no cambia: `set_run_cost` ya suma todo `model_usd` de la corrida, y ahora incluye los pasos del agente.
- Un paso que falla (`step.failed`) no trae consumo y no se asienta. Es una causa conocida de diferencia con el gateway (§5.3).

El trabajo de asentar va en una función pura en `lib/agents/` que recibe el evento, el tenant y el `record`; el hook solo la llama. Así se prueba sin eve.

## 4. Tags

### 4.1 Helper

`lib/workflows/gateway-options.ts`:

- `tenantTag(slug)` devuelve `tenant:<slug>`.
- `gatewayOptions(slug, extra?)` devuelve `{ gateway: { tags: [tenantTag(slug)], ...extra } }`, listo para `providerOptions`.

Imports relativos, porque lo usan tools y schedules de eve.

### 4.2 Servicios y workflows

Los servicios que llaman al modelo (`generate-draft`, `generate-research`, `evaluate`) reciben las opciones del gateway como argumento y las pasan a `providerOptions`. La puerta (tool, schedule, runner), que ya conoce al tenant, las arma con `gatewayOptions`. `evaluate` conserva `zeroDataRetention` pasándolo como `extra`.

Los servicios siguen sin conocer al tenant: reciben un objeto de opciones, no un slug.

### 4.3 Chat

`agents/outreach/agent.ts` ya resuelve el modelo en `session.started` con el tenant a mano. Pasa a devolver un objeto de selección: `{ model, modelOptions: { providerOptions: gatewayOptions(slug) } }`. El slug sale del atributo `tenantSlug` de la sesión, que el canal ya carga. Sin tenant devuelve solo el modelo, como hoy.

eve agrega por su cuenta `providerOptions.gateway.sessionId`. Se verifica que conviva con los tags (§12).

### 4.4 Test

`tests/workflows/model-calls.test.ts` se extiende: todo archivo que importa el valor de `generateText` o `experimental_evaluate` tiene que usar `gatewayOptions(`, además de `metered(`. Un test aparte verifica que el modelo dinámico del agente devuelve el tag cuando la sesión trae tenant.

## 5. Pantallas

### 5.1 Cliente: `/<slug>/settings/gasto`

Solo `tenant_admin`; para cualquier otro, 404. Link desde `/<slug>/settings`.

- Selector de período: mes en curso o mes anterior.
- Total del período en USD.
- Tabla por día: fecha y monto.
- Tabla por origen: "Chat" y cada proceso automático con su rótulo, con monto.
- Una línea que aclara que los días cortan en UTC y que el gasto se registra desde la fecha del deploy.
- Empresa sin gasto en el período: estado vacío, no una tabla en cero.

El origen es `workflow` cuando el asiento lo trae; si no, "Chat".

### 5.2 Plataforma: `/plataforma/gasto`

Solo `platform_admin`; si no, 404, como el resto de la consola. Link desde `/plataforma`.

- Una fila por empresa: gasto de hoy, del mes en curso y del mes anterior.
- Fila de total.
- Cada empresa linkea a `/plataforma/<slug>`, donde está su presupuesto.

### 5.3 Conciliación

En `/plataforma/gasto`, un botón "Conciliar con el gateway" con selector de período (mes en curso hasta ayer, o mes anterior). Hoy no entra: el gateway demora en ingerir.

Al apretarlo, una server action:

1. Pide al gateway el gasto por tag del período (`getSpendReport` con `groupBy: 'tag'`) y el total sin filtrar.
2. Lee del libro el `model_usd` por empresa del mismo período, en UTC.
3. Muestra por empresa: libro, gateway, diferencia en USD y en porcentaje.
4. Agrega una fila "Sin etiqueta": total del gateway menos la suma de los tags `tenant:*`. Si es mayor que cero, alguna llamada salió sin tag.

Una diferencia se marca solo si supera el mayor entre US$ 1 y el 5 % del gateway. Por debajo se muestra sin marca. Causas conocidas de diferencia, listadas en la pantalla:

- Pasos abortados o fallidos, que el gateway cobra y nadie informa al libro.
- Asientos con precio de tabla (`source: tabla`), que sobreestiman.
- Demora de ingesta del gateway.

Si el gateway rechaza la consulta (plan sin Custom Reporting, credencial sin permiso), la pantalla muestra el motivo y el resto sigue funcionando.

La comparación va en una función pura en `lib/usage/reconcile.ts`: recibe las filas del libro y las del gateway y devuelve la tabla. La server action solo junta los datos.

## 6. Base de datos

No hay tablas nuevas. Dos funciones de lectura, en una migración. Antes de escribirla se carga `supabase-postgres-best-practices`.

- `tenant_spend_report(p_tenant uuid, p_from timestamptz, p_to timestamptz)` devuelve `(day date, origin text, amount numeric)` de `model_usd`, con el día en UTC y `origin = coalesce(workflow, 'chat')`. `security definer`, `search_path = ''`, y adentro `perform public.settings_actor(p_tenant)`, igual que `tenant_budget_status`. Rechaza rangos de más de 92 días.
- `platform_spend_report(p_from timestamptz, p_to timestamptz)` devuelve `(tenant_id uuid, day date, amount numeric)` de `model_usd`. Solo `service_role`; la pantalla la llama después de `requirePlatformAdmin`.

`usage_entries` sigue siendo solo de inserción y su RLS no cambia: el cliente no lee filas, lee el agregado.

El índice `(tenant_id, resource, created_at desc)` cubre la consulta del cliente. La de plataforma cruza empresas: se mira el plan con `explain` sobre datos reales y se agrega un índice por `(resource, created_at)` solo si hace falta.

## 7. Aplicación

| Archivo | Cambio |
|---|---|
| `agents/outreach/hooks/usage.ts` | Nuevo. Hook de `step.completed` |
| `lib/agents/step-usage.ts` | Nuevo. Arma el asiento a partir del evento |
| `lib/workflows/gateway-options.ts` | Nuevo. `tenantTag` y `gatewayOptions` |
| `agents/outreach/agent.ts` | Devuelve selección con `modelOptions` |
| `lib/outreach/services/{generate-draft,generate-research,evaluate}.ts` | Reciben y pasan las opciones del gateway |
| Puertas en `agents/outreach/tools/` y `agents/outreach/schedules/` | Arman las opciones con `gatewayOptions` |
| `lib/usage/reconcile.ts` | Nuevo. Comparación libro contra gateway |
| `lib/usage/report.ts` | Nuevo. Rangos de mes en UTC y armado de las tablas |
| `app/[tenant]/settings/gasto/page.tsx` | Nueva pantalla del cliente |
| `app/plataforma/gasto/{page.tsx,actions.ts}` | Nueva pantalla y acción de conciliar |
| `supabase/migrations/<fecha>_spend_report.sql` | Las dos funciones |
| `tests/workflows/model-calls.test.ts` | Exige `gatewayOptions` |

La etapa 22.1 (chat multiagente) está en una rama sin mergear y suma agentes. El hook y la selección de modelo son por agente; la función de `lib/agents/step-usage.ts` y el helper de tags son compartidos para que el segundo agente los use sin copiar. Si la 22.1 entra antes, el plan los engancha en cada agente.

## 8. Seguridad

- El cliente nunca lee `usage_entries` ni `runs.cost_usd`. Lee un agregado por día y por origen, por una función que verifica adentro que quien llama es administrador de esa empresa.
- La función de plataforma es de `service_role` y la pantalla exige `platform_admin`.
- El tag lleva el slug, que ya es público en las URL. No viaja ningún dato personal al gateway por esta vía.
- La consulta al reporte usa la credencial de plataforma del gateway. No se loguea ni se muestra.
- El hook no escribe presupuestos ni interruptores: solo inserta en el libro.

## 9. Qué no entra

- Clave del gateway por empresa, tope duro por empresa en el gateway y revocación de una sola empresa. Si un cliente pide tope duro, se vuelve a abrir G1.
- Cortar el chat por presupuesto.
- Carga de la historia anterior al deploy.
- Costo por corrida visible para el cliente.
- Desglose por modelo o por persona.
- Conciliación automática o alertas por diferencia.
- Créditos de terceros (`credits`): el reporte es de `model_usd`.

## 10. Pruebas

- **Asiento del paso:** con `costUsd` asienta ese monto y `source: gateway`; sin él usa la tabla; sin tenant no asienta; si `record` tira, la función no tira.
- **Tags:** `gatewayOptions` conserva los extras; el modelo dinámico devuelve el tag con tenant y solo el modelo sin él; `model-calls.test.ts` falla si una puerta no usa el helper.
- **Conciliación:** empresa que cierra, empresa con diferencia sobre la tolerancia, empresa en el libro sin tag en el gateway, tag sin empresa, fila "Sin etiqueta".
- **Base (`npm run db:test`):** `tenant_spend_report` rechaza a un miembro que no es administrador y a un administrador de otra empresa; agrupa por día en UTC y por origen; `platform_spend_report` no es ejecutable por `authenticated`.
- **Navegador, con la base local:** como `tenant_admin`, mes en curso y anterior, estado vacío, sin desborde a 375 px; como `tenant_member`, 404; como `platform_admin`, tabla de empresas y mensaje claro cuando el gateway rechaza la conciliación.

## 11. Despliegue

Antes:

1. Confirmar en Vercel que el equipo tiene Custom Reporting (plan Pro o Enterprise) y cuánto cobra por consulta. Si no lo tiene, se despliega igual: el botón de conciliar muestra el rechazo y el resto no depende de él.
2. `npx supabase migration list` y aplicar la migración antes que el código.

Después:

3. Mandar un mensaje real por el chat de `innovas` y comprobar que aparecen asientos `agent/step` en `usage_entries` y que `runs.cost_usd` del turno los incluye.
4. Comprobar en el dashboard del AI Gateway que la llamada salió con `tenant:innovas`.
5. Revisar el límite diario de `model_usd` de cada empresa en `/plataforma/<slug>`. El chat ahora suma contra ese límite (G4): con el límite de antes, los procesos automáticos pueden cortar más temprano. Mirar tres días de libro y ajustar.
6. Al día siguiente, conciliar el día anterior.

**Terminado cuando:** un turno real del chat deja sus asientos en `usage_entries` en producción, el administrador de `innovas` ve su mes en `/innovas/settings/gasto`, `/plataforma/gasto` lista a todas las empresas, y la conciliación de un día completo cierra dentro de la tolerancia con la fila "Sin etiqueta" en cero.

## 12. A confirmar en el plan

Son verificaciones contra el código instalado, no decisiones abiertas. Antes de escribir código de eve se lee `node_modules/eve/docs/README.md` y la guía de hooks.

1. Que un hook puede suscribirse a `step.completed`. El evento está en el protocolo (`dist/src/protocol/message.d.ts`) y la guía dice que se puede suscribir a cualquier evento del stream; falta probarlo.
2. De dónde sale el id del modelo para el respaldo por tabla: `step.completed` no lo trae y `step.started` sí.
3. Si la compactación emite `step.completed`. Si no, ese consumo queda fuera del libro y entra como causa conocida de diferencia.
4. Que `modelOptions.providerOptions.gateway.tags` se combina con el `sessionId` que agrega eve en vez de reemplazarlo.
5. Que las sesiones que entran por MCP (`authenticator: oauth`) traen `tenantSlug`.
6. Que `getSpendReport` acepta la autenticación por OIDC del deploy. Si exige una clave, se agrega una variable de entorno de plataforma y su página en la wiki.
7. Si `node: "agent/step"` tiene que registrarse en `lib/workflows/registry.ts` o el test del registry solo mira nodos de workflow.
