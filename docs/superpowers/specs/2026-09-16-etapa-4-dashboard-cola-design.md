# Etapa 4 · Dashboard — Entrega 1: `/cola`

Fecha: 2026-09-16
Rama: `feat/etapa-4-cola` (worktree `.claude/worktrees/etapa-4-dashboard`, base `origin/main` en `fe2ab7c`)
Etapa del kickoff: `docs/innovas-agents-kickoff.md` §Etapa 4

## 1. Qué problema resuelve

Hoy una pieza de outreach solo se puede aprobar desde el chat. El modelo decide
llamar a `send_email`, eve frena el turno con `approval: always()` y la persona
aprieta el botón que resuelve esa pausa. Funciona, pero obliga a abrir un hilo y
a conversar con el agente para hacer algo que es un sí o un no sobre un texto ya
escrito.

La Entrega 1 pone esa decisión en una pantalla: `/cola` lista lo que está por
salir y deja aprobar, editar o rechazar con un click, disparando exactamente el
mismo envío que dispara el chat.

## 2. Decisiones tomadas

| # | Decisión | Por qué |
|---|---|---|
| D1 | La Etapa 4 se parte en tres entregas y `/cola` va primero | Es el único requisito que el kickoff pone como criterio de terminado. El resto es UI sobre esquema cerrado. |
| D2 | Se ve la cola de todo el tenant; se aprueba solo lo propio | La RLS ya permite leer todo el tenant. El mail sale por el Gmail del ejecutor dueño, así que el botón queda atado a la casilla que efectivamente manda. |
| D3 | `/cola` aprueba con una server action sobre el servicio compartido, sin pasar por eve | `sendQueuedEmail` ya es un servicio con dependencias inyectadas, `tokenForSubject` saca el token sin sesión de eve y `CrmAuthContext` es implementable desde la web. Un click no necesita una corrida de modelo. |

### Sobre D3 y la regla de aprobación del repo

`CLAUDE.md` exige que toda tool con efecto externo lleve `approval` explícito.
`send_email` lo conserva: el chat sigue igual. La server action no es una tool y
no la evade, porque el click humano **es** la aprobación, y es más fuerte que la
del chat: la persona leyó el asunto y el cuerpo exactos que van a salir antes de
apretar. Ningún modelo decide un envío en este camino.

## 3. Arquitectura

```
app/[tenant]/cola/page.tsx        lectura (server component, cliente del usuario, RLS)
app/[tenant]/cola/cola-client.tsx UI + Realtime + estados optimistas
app/[tenant]/cola/actions.ts      3 server actions (zod en el borde)
lib/outreach/web-context.ts       puente: arma SendDeps/QueueDeps fuera de eve
supabase/migrations/*_realtime_queue_items.sql
```

### 3.1 Lectura

`page.tsx` lee `queue_items` con estado `pending` y `approved` de todo el tenant
usando `createServerSupabase()` (el cliente del usuario). La RLS
`queue_items_select` ya limita a miembros del tenant, así que la transparencia de
D2 no necesita política nueva. Join a `contacts` (nombre, empresa, `stage`) y a
`executors` (dueño de la pieza). Las policies `contacts_select` y
`executors_select` habilitan los dos joins para cualquier miembro del tenant.

El dueño se muestra por `executors.slug` (`mati`, `marcos`): la tabla no guarda
nombre ni email, y `auth.users` no es legible por RLS desde el cliente. Si más
adelante hace falta un nombre presentable, sale de una columna nueva en
`executors`, no de un join a `auth`.

No se reusa `listQueue` de `lib/outreach/services/queue.ts:251`: filtra por
`caller.userId` y asigna letras A/B/C, que son un concepto conversacional del
chat. La página tiene su propia lectura; el servicio compartido importa para las
escrituras.

### 3.2 Escrituras

`app/[tenant]/cola/actions.ts`, siguiendo el patrón de
`app/[tenant]/chat/actions.ts`: validación zod en el borde, `caller` derivado de
la sesión de Supabase y de `resolveTenantAccess`, nunca de un argumento del
cliente.

| Action | Servicio que llama | Reglas que ya trae el servicio |
|---|---|---|
| `approveAndSend(queueItemId)` | `sendQueuedEmail` | gate, claim, idempotencia `pending → approved`, envío incierto |
| `editItem(queueItemId, subject, body)` | `updateQueueItem` | vuelve a correr el gate; si no pasa, no guarda |
| `rejectItem(queueItemId, reason)` | `rejectQueueItem` | refusa `no_es_tu_pieza` si el ejecutor no es el dueño |

D2 no se implementa de nuevo: `updateQueueItem` y `rejectQueueItem` ya comparan
`item.executorUserId !== caller.userId` y refusan. `sendQueuedEmail` resuelve el
ejecutor por `resolveExecutor`. La UI solo refleja esa regla escondiendo los
botones en las piezas ajenas; la defensa real está en el servicio.

### 3.3 El puente web (`lib/outreach/web-context.ts`)

Única pieza estructuralmente nueva. Arma las dependencias que en una tool vienen
del `ctx` de eve:

- `store`: `createSupabaseOutreachStore(createAdminClient())`
- `sendMail`: `sendMail` de `lib/gmail/send.ts` con el token de
  `tokenForSubject(GOOGLE_CONNECTOR_UID, { tenantId, userId }, GMAIL_SCOPES)`
- `crm` / `crmAfterSend`: `crmForSession` con un `CrmAuthContext` propio de la
  web, cuyo `requireAuth` lanza `WebReauthRequired` en lugar de pausar el turno
- `loadCanon`: `brainForTenant` + `loadCanon`, igual que las tools
- `now`: `() => new Date()`
- `sessionId`: `web:<uuid v4>`; `callId`: el id de la pieza

El `sessionId` con prefijo `web:` deja distinguir en `events` un envío disparado
desde el dashboard de uno disparado desde el chat, sin columna nueva.

`Caller` (`lib/outreach/session.ts:16`) es un objeto plano de cuatro campos, así
que se arma desde la sesión web sin tocar `callerFromSession`, que sigue siendo
el camino de eve.

### 3.4 Realtime

No hay nada configurado en el repo. Hace falta una migración que agregue
`queue_items` a la publicación `supabase_realtime`. La suscripción del cliente
filtra por `tenant_id` y refetchea la lista; la RLS sigue decidiendo qué filas
llegan, así que el filtro del cliente es conveniencia, no seguridad.

## 4. Manejo de errores

| Caso | Qué hace el chat | Qué hace `/cola` |
|---|---|---|
| Sin grant de Gmail | `ctx.requireAuth` pausa el turno y muestra la tarjeta | La action captura `GmailUnauthorizedError` y devuelve `{ needsAuth: true, url }` desde `startAuthorizationForSubject`; la UI muestra "Autorizá Google" |
| Sin grant de HubSpot | ídem | `WebReauthRequired` con la misma forma de respuesta |
| Envío incierto | pieza queda `approved` (trabada) | igual: lo resuelve `sendQueuedEmail`, no la capa web |
| Gate no pasa al editar | refusa y no guarda | igual, con el motivo del gate en pantalla |
| Pieza ajena | refusa `no_es_tu_pieza` | botones ocultos, y el servicio refusa igual si alguien fuerza la action |
| Doble click en Aprobar | n/a | la transición `pending → approved` es la idempotencia; el segundo intento no manda un segundo mail |

Sobre la autorización de Google hay dos cosas ya aprendidas que el código debe
respetar: se pide el conjunto **exacto** `GMAIL_SCOPES`
(`[gmail.send, gmail.readonly]`), porque Connect matchea el grant por conjunto
exacto y un subconjunto falla; y arrancar una autorización nueva deja el grant
vigente sin servir hasta que la persona consiente, así que la UI no debe ofrecer
"reautorizar" como acción decorativa ni dispararla sola.

### Piezas trabadas

Las piezas en `approved` se muestran con badge "trabada" y el motivo de
`queue_items.error` cuando existe. **No hay botón para destrabar**: reencolar
arriesga un segundo mail si el de Gmail sí salió. La reconciliación automática
por `gmail_thread_id` sigue siendo trabajo de la Entrega 4 de la Etapa 3.

## 5. Testing

- Unit de `web-context.ts`: que arme las deps correctas y que `requireAuth`
  lance en vez de pausar.
- Unit de las tres actions con el store fake que ya usan los tests de servicios:
  pieza ajena, gate que no pasa, doble aprobación, `GmailUnauthorizedError`.
- Los servicios (`sendQueuedEmail`, `updateQueueItem`, `rejectQueueItem`) ya
  tienen cobertura de la Etapa 3 y no se re-testean acá.
- `/qa` en desktop y mobile al cierre de la entrega.
- Prueba manual del criterio del kickoff: aprobar desde `/cola` y verificar que
  el mail sale, que la pieza queda `sent` y que el contacto avanza de etapa.

## 6. Terminado cuando

1. `/cola` lista las piezas del tenant con dueño visible, y los botones de
   aprobar, editar y rechazar aparecen solo en las propias.
2. Aprobar desde `/cola` manda el mail por el Gmail del ejecutor y escribe los
   mismos `events` que el chat.
3. Una pieza aprobada en otra pestaña desaparece de la lista sin recargar.
4. Un ejecutor sin grant de Gmail ve el link de autorización y, al volver,
   aprueba sin perder la pieza.
5. `npm run typecheck`, `npm test` y `npm run lint:fix` en verde; `/qa` pasa en
   desktop y mobile.

## 7. Qué NO entra en esta entrega

- `/pipeline` y `/contactos` (Entrega 2), `/cuentas`, `/metricas` y `/settings`
  ampliado (Entrega 3).
- Destrabar piezas `approved`.
- Cambiar `send_email` o el camino del chat.
- Aprobar piezas ajenas (D2 lo descarta explícitamente).
- Navegación completa del dashboard: la Entrega 1 agrega el link a `/cola` en el
  header de `app/[tenant]/layout.tsx` y nada más.
