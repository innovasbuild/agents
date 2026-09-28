---
title: Sync entrante de HubSpot — reconciliación periódica de crm_id, owner y notas
fecha: 2026-09-27
estado: aprobada en brainstorming, pendiente de revisión escrita
etapa: fuera del roadmap numerado (higiene de datos del CRM, disparada al investigar la pantalla /contactos)
fuente: conversación de este chat (lectura de app/[tenant]/contactos/page.tsx, lib/connectors/crm/hubspot-adapter.ts, lib/outreach/services/{send,crm-record,sweep}.ts, lib/outreach/stage.ts, lib/connectors/{auth,bindings,catalog,platform}.ts, agents/outreach/schedules/morning-sweep.ts, supabase/migrations/20260914224230_outreach_core.sql)
---

# Sync entrante de HubSpot

## 1. Qué problema resuelve

Hoy la relación con HubSpot es de una sola vía: `lib/connectors/crm/hubspot-adapter.ts` empuja (`upsertContact`, `addNote`, `createDeal`, `createTask`) cuando el agente de outreach manda un mail o alguien avanza una etapa a mano desde el chat. Nada en el otro sentido: si algo cambia en HubSpot directamente (se borra un duplicado, se reasigna el owner, se deja una nota a mano), la tabla local `contacts` nunca se entera. `crm_id` queda apuntando a un registro que puede no existir más.

Esto no es hipotético: encontramos que ya rompe hoy. `PATCH /crm/v3/objects/contacts/{crm_id}` contra un contacto borrado devuelve 404, y:

- En `lib/outreach/services/send.ts` (`recordInCrm`), el error queda atrapado, se dispara un evento `crm_sync_pendiente`, pero el `crm_id` local nunca se corrige — el próximo envío va a fallar exactamente igual.
- En `lib/outreach/services/crm-record.ts` (`recordCrmUpdate`, la tool `crm_upsert_contact` que usa el chat para avanzar etapa o dejar una nota manual), el error **no está atrapado**: la función entera revienta antes de `store.updateContact`, así que ni siquiera se registra el avance de etapa localmente. La persona ve un error crudo de HubSpot en vez de un refusal prolijo.

## 2. Objetivo y criterio de cierre

Un job periódico reconcilia, por tenant, los contactos con `crm_id` cargado contra HubSpot, y corrige lo que encuentra desalineado — sin esperar a que una acción de outreach choque contra el problema.

**Terminado cuando:**

1. Un contacto borrado en HubSpot (duplicado limpiado a mano) hace que su `crm_id` local se limpie solo, sin intervención, en menos de 12 horas.
2. Reasignar el owner de un contacto en HubSpot actualiza `contacts.owner_user_id` en la siguiente corrida.
3. Una nota agregada a mano en HubSpot aparece en el historial local (`events`) de ese contacto.
4. El bug de `crm-record.ts` descrito arriba queda cerrado como consecuencia: con el `crm_id` ya limpiado por el job, la próxima vez que se intente avanzar etapa o mandar un mail, el sistema crea un contacto nuevo en HubSpot en vez de romper contra un 404 (mismo camino que ya existe hoy cuando `crmId` es `null`).
5. Un tenant sin HubSpot conectado, o con el grant vencido, no frena la corrida de los demás tenants.
6. `npm test`, `npm run typecheck` en verde.

**Fuera de alcance de esta pasada:**

- Sync de `stage`/`dealstage`. El `stage` local (`lib/outreach/stage.ts`: `a_contactar → … → deal_creado → cliente`) y el `dealstage` de HubSpot (que vive en el **deal**, no en el contacto, con estados como `closedlost` o `presentationscheduled` = "Retrasado") no comparten vocabulario — no hay "perdido" ni "en espera" en el modelo local, y `canAdvance()` no deja retroceder salvo los casos ya cableados. Mapear esto bien es una decisión de producto aparte (¿se agregan estados nuevos? ¿se acepta perder precisión con un mapeo mínimo?), no algo para resolver de paso acá.
- Webhooks nativos de HubSpot. La conexión de cada tenant es un OAuth de **Vercel Connect** contra una app que no es nuestra (`lib/connectors/catalog.ts`, `HUBSPOT_CONNECTOR_UID = "mcp.hubspot.com/hubspot"`) — no podemos suscribir esa app a eventos como `contact.deletion`. Los Workflows de HubSpot tampoco sirven para el caso de borrado (no corren sobre objetos eliminados). Por eso todo el diseño es polling, no push.
- Companies/deals como objetos de primera clase en el sync — solo lo que cuelga de `contacts`.

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | Nodo nuevo `outreach/crm-sync`, efecto 0 (solo lee de HubSpot y escribe en la base propia), corrido por un `defineSchedule` de eve dos veces al día. | Mismo nivel que `outreach/sweep` en `lib/workflows/registry.ts` ("lee Gmail y registra hechos en la base propia; no gasta ni escribe afuera") — acá es leer HubSpot en vez de Gmail, misma clase de efecto. |
| D2 | Contacto no encontrado en el batch read → `crm_id` a `null` + evento `crm_id_huerfano`. Nunca se borra la fila de `contacts`. | Preserva el historial local (`touches`, `stage`, `events`). Poner `crm_id` en `null` reusa el camino que ya existe en `upsertContact`: la próxima acción crea un contacto nuevo en HubSpot en vez de romper. |
| D3 | El owner se corrige comparando `hubspot_owner_id` contra `executors.crm_owner_id` del mismo tenant, sin pasar por la lógica de "claim" de 90 días. | El claim (`lib/outreach/services/queue.ts`, CLAUDE.md regla 2) existe para *inferir* dueño implícito por autoría de nota cuando no hay señal explícita. Acá HubSpot ya dice quién es el owner explícitamente — no hay nada que inferir. Si el `hubspot_owner_id` no matchea ningún `crm_owner_id` conocido del tenant, no se toca nada y queda un evento informativo (puede ser un usuario de HubSpot que no es ejecutor de outreach). |
| D4 | Notas nuevas se insertan en `events` con `type: "nota"` (el mismo tipo que ya usa el chat para notas manuales), `contact_key` del contacto, `actor_user_id: null`, primer renglón `[in · hubspot · nota]`. | Convención ya establecida en CLAUDE.md ("primera línea: `[out · …]` o `[in · …]`") — acá el origen es HubSpot, no un canal de outreach, así que el prefijo lo deja explícito sin inventar un tipo de evento nuevo para algo que semánticamente ya es una nota. |
| D5 | El batch check contra HubSpot usa `POST /crm/v3/objects/contacts/batch/read` (hasta 100 IDs por llamada, con `hubspot_owner_id` en `properties`), no `findContacts` en loop. | Es el mismo costo que hoy paga `searchAssociated`, pero para *existencia + owner* de N contactos a la vez en vez de una llamada por contacto — con 7 contactos no importa, pero es el patrón correcto para cuando la base crezca. HubSpot devuelve los IDs no encontrados en `errors[].context.ids` con `category: "OBJECT_NOT_FOUND"`, con HTTP 200 en la llamada — no hay que interpretar 404 por ítem. |
| D6 | El token de HubSpot para el job sale de `tokenForSubject(HUBSPOT_CONNECTOR_UID, {tenantId, userId, issuer}, scopes)` (mismo mecanismo "sin sesión de eve" que ya usa `morning-sweep.ts` para Gmail), probando los ejecutores del tenant con `crm_owner_id` cargado en orden hasta encontrar uno con grant vigente. | El grant de Connect es por `tenant:usuario` aunque el conector se llame "tenant-scoped" (`lib/connectors/auth.ts` línea 62-86: `tenantSubjectId`) — no hay un token "del tenant" sin un usuario detrás. No importa cuál ejecutor presta el token: la API de HubSpot no ata la llamada a "actuar como esa persona", solo autoriza contra el portal. Si ningún ejecutor tiene grant vigente, el tenant se saltea con `crm_sync_pendiente` y se sigue con el resto (D1, criterio 5). |
| D7 | Columna nueva `contacts.crm_synced_at timestamptz null` — marca de agua por contacto para pedir notas de HubSpot solo desde la última corrida. | Sin esto, cada corrida (2 veces al día) volvería a traer y re-insertar en `events` las mismas notas ya vistas. Los tipos de evento (`OUTREACH_EVENT_TYPES` en `lib/outreach/events.ts`) son un `text` sin constraint en la base — agregar `crm_id_huerfano` y `crm_owner_actualizado` ahí no pide migración, pero la marca de agua sí es una columna nueva. |

## 4. Componentes

### 4.1 `lib/connectors/crm/adapter.ts`

Dos métodos nuevos en `CrmAdapter`:

```ts
export interface CrmContactCheck {
	id: string;
	found: boolean;
	ownerId: string | null; // null si found es false
}

export interface CrmActivityNote {
	id: string;
	body: string;
	at: Date;
	ownerId: string | null;
}

export interface CrmAdapter {
	// ... lo que ya existe ...
	batchCheckContacts(crmIds: string[]): Promise<CrmContactCheck[]>;
	listNotesSince(crmId: string, sinceIso: string | null): Promise<CrmActivityNote[]>;
}
```

`withReauth` en `lib/outreach/crm-session.ts` suma los dos nombres a la lista de métodos envueltos (no lo usa este job — usa el token directo de D6 — pero la interfaz es una sola y `crm-session.ts` la implementa completa).

### 4.2 `lib/connectors/crm/hubspot-adapter.ts`

- `batchCheckContacts`: parte `crmIds` en tandas de 100, `POST /crm/v3/objects/contacts/batch/read` con `properties: ["hubspot_owner_id"]`. Arma la lista de `CrmContactCheck` combinando `results` (found: true) y los IDs de `errors[].context.ids` con `category: "OBJECT_NOT_FOUND"` (found: false). Un ID que no aparece en ninguna de las dos listas (otro tipo de error) se trata como found: false + se loguea, nunca se asume encontrado por default.
- `listNotesSince`: extiende el `searchAssociated("notes", crmId, extraFilters, properties, limit)` que ya existe, agregando un filtro `hs_timestamp GT sinceIso` cuando `sinceIso` no es null, propiedades `["hs_note_body", "hs_timestamp", "hubspot_owner_id"]`, límite 20 (una corrida cada 12h no debería acumular más notas que eso por contacto; si pasa, quedan para la próxima).

### 4.3 `lib/outreach/services/crm-sync.ts` (nuevo, nodo puro)

Firma en el estilo de `sweep.ts`/`reconcile.ts`: función pura con deps inyectadas, sin importar Supabase ni HubSpot directamente — eso lo arma el wiring del schedule (§4.5).

```ts
export interface CrmSyncDeps {
	listContactsWithCrmId(tenantId: string): Promise<
		{ id: string; contactKey: string; crmId: string; ownerUserId: string | null; crmSyncedAt: string | null }[]
	>;
	listExecutorsWithCrmOwner(tenantId: string): Promise<{ userId: string; crmOwnerId: string }[]>;
	updateContact(tenantId: string, id: string, patch: ContactPatch): Promise<void>;
	insertEvents(rows: OutreachEventInsert[]): Promise<void>;
	crm: CrmAdapter;
	now: () => Date;
}

export interface CrmSyncResult {
	revisados: number;
	huerfanosLimpiados: number;
	ownersActualizados: number;
	notasAgregadas: number;
}

export async function runCrmSync(tenantId: string, deps: CrmSyncDeps): Promise<CrmSyncResult>;
```

Lógica, por tenant:

1. `contacts = await deps.listContactsWithCrmId(tenantId)`. Si está vacío, retorna todo en 0 sin llamar a HubSpot.
2. `checks = await deps.crm.batchCheckContacts(contacts.map(c => c.crmId))`.
3. `executors = await deps.listExecutorsWithCrmOwner(tenantId)` → `Map<crmOwnerId, userId>`.
4. Por cada contacto, cruzando con su `check`:
   - `!check.found` → `updateContact(tenantId, contact.id, { crmId: null })` + evento `crm_id_huerfano` (`contact_key`, `summary: "crm_id ya no existe en HubSpot, limpiado"`, `payload: { crm_id_anterior: contact.crmId }`).
   - `check.found && check.ownerId` y `executors.get(check.ownerId) !== contact.ownerUserId`:
     - Si `executors.has(check.ownerId)` → `updateContact(..., { ownerUserId: executors.get(check.ownerId) })` + evento `crm_owner_actualizado`.
     - Si no → evento `crm_sync_pendiente` (tipo ya existente — nada se actualizó, así que no corresponde `crm_owner_actualizado`), `payload: { hubspot_owner_id: check.ownerId, motivo: "sin ejecutor con ese crm_owner_id" }`, sin tocar `ownerUserId`.
   - Notas: `notas = await deps.crm.listNotesSince(contact.crmId, contact.crmSyncedAt)`. Por cada una, `insertEvents([...])` con `type: "nota"`, `summary` el `hs_note_body` recortado, `payload: { hubspot_note_id, hubspot_owner_id }`. Al final del contacto, `updateContact(..., { crmSyncedAt: deps.now().toISOString() })` — incluso si no hubo notas nuevas, para no volver a pedir el mismo rango la próxima vez.
5. Un error de HubSpot al procesar un contacto puntual (no el batch inicial) se atrapa, se loguea con `console.error`, y sigue con el resto — un contacto no puede trabar a los demás del mismo tenant, mismo criterio que "un ítem que falla no frena al resto" (CLAUDE.md, orquestación).

### 4.4 `lib/outreach/store.ts`

- `ContactRow`/`ContactPatch` suman `crmSyncedAt: string | null`. `CONTACT_PATCH_COLUMNS` mapea a la columna nueva.
- Método nuevo `listContactsWithCrmId(tenantId)`: `select id, contact_key, crm_id, owner_user_id, crm_synced_at from contacts where tenant_id = ? and crm_id is not null`.
- Método nuevo `listExecutorsWithCrmOwner(tenantId)`: `select user_id, crm_owner_id from executors where tenant_id = ? and crm_owner_id is not null` (mismo patrón que `listExecutorsWithGmailRead`).

### 4.5 `lib/workflows/registry.ts`

```ts
"outreach/crm-sync": { effect: 0, tier: null },
```

### 4.6 `agents/outreach/schedules/crm-sync.ts`

Calco de `morning-sweep.ts` en estructura:

- `cron`: dos corridas por día (a definir horario exacto en la Task de implementación, ej. `"0 12,21 * * *"` UTC ≈ 9:00 y 18:00 Argentina — Vercel evalúa en UTC igual que `morning-sweep`).
- Lock con `takeScheduleLock`/`scheduleKeyFor`, mismo patrón, `scheduleKey = scheduleKeyFor("crm-sync", now)`.
- Itera `store.listActiveTenants()`, filtra con `hasEnabledBinding(tenantId, "crm", "hubspot")` (el mismo helper que usa `crmForSession`).
- Por tenant: resuelve el token probando, en el orden que devuelve `listExecutorsWithCrmOwner`, `tokenForSubject(HUBSPOT_CONNECTOR_UID, {tenantId, userId, issuer}, [])` hasta que uno no tire `isConnectAuthError`; si ninguno sirve, evento `crm_sync_pendiente` a nivel tenant (sin `contact_key`) y sigue con el próximo tenant.
- Corre `runCrmSync(tenantId, deps)` con el adapter armado a partir de ese token (`createHubSpotAdapter(token)`, sin `withReauth` — no hay `ctx.requireAuth` en un schedule, un 401 acá se trata como grant vencido y cae en el mismo camino que "ningún ejecutor sirve").
- Sin handoff a un agente (a diferencia de `morning-sweep`): esto es housekeeping silencioso, no algo que alguien necesite leer en el chat todos los días. El resultado (`CrmSyncResult` sumado de todos los tenants) se loguea a consola para debugging; si en el futuro hace falta visibilidad humana, se lee del historial de `events` filtrando por tipo, sin necesidad de un resumen aparte.

### 4.7 Migración

`supabase/migrations/<timestamp>_contacts_crm_synced_at.sql`:

```sql
alter table public.contacts add column crm_synced_at timestamptz;
```

Sin default, sin backfill: `null` significa "nunca sincronizado", que es exactamente el estado real de todo contacto existente hoy.

### 4.8 `lib/outreach/events.ts`

`OUTREACH_EVENT_TYPES` suma `"crm_id_huerfano"` y `"crm_owner_actualizado"`. No entran en `DEDUPED_EVENT_TYPES` (no hay riesgo de duplicado por reintento humano, es un job) ni en `MODEL_LOGGABLE_EVENT_TYPES` (no los inserta el modelo).

## 5. Tests

| Archivo | Qué prueba |
|---|---|
| `tests/outreach/services/crm-sync.test.ts` (nuevo) | `runCrmSync` con un `CrmAdapter` fake: contacto borrado → `crmId: null` + evento; owner distinto y conocido → se actualiza; owner distinto y desconocido → no se toca, evento informativo; notas nuevas → se insertan con el prefijo correcto y se actualiza `crmSyncedAt`; sin notas nuevas → igual actualiza `crmSyncedAt`; un contacto que tira error no frena al resto del mismo tenant |
| `tests/connectors/crm/hubspot-adapter.test.ts` (extiende el existente si existe, o nuevo) | `batchCheckContacts` con fetch fake: separa `results` de `errors[].context.ids`, parte en tandas de 100; `listNotesSince` arma bien el filtro `hs_timestamp GT` cuando hay marca de agua y lo omite cuando es `null` |
| `tests/workflows/registry.test.ts` (existente) | Ya falla solo si falta `outreach/crm-sync` en el registry — no hace falta tocarlo |
| `tests/outreach/store.test.ts` (si existe, o el que corresponda) | `listContactsWithCrmId` y `listExecutorsWithCrmOwner` devuelven lo esperado contra el fake/fixture de store |

## 6. Verificación contra el proyecto real

| # | Qué | Si falla |
|---|---|---|
| V1 | Borrar a mano un contacto de prueba en el HubSpot de INNOV.AS (portal 51464889) y correr el schedule manualmente: el `crm_id` local se limpia y queda el evento `crm_id_huerfano` | Revisar D2/D7 |
| V2 | Reasignar el owner de un contacto de prueba en HubSpot: la siguiente corrida actualiza `owner_user_id` | Revisar D3 |
| V3 | Agregar una nota a mano en HubSpot sobre un contacto de prueba: aparece en el historial de `/contactos` con el prefijo `[in · hubspot · nota]` | Revisar D4/D7 |
| V4 | Correr el schedule con el grant de HubSpot vencido/revocado para el tenant: no explota, deja `crm_sync_pendiente` y sigue con otros tenants | Revisar D6 |
| V5 | `npm test`, `npm run typecheck` en verde | — |

## 7. Riesgos

- **Rate limits de HubSpot.** El batch read es barato (1 llamada cada 100 contactos), pero `listNotesSince` es una llamada por contacto con `crm_id`. Con 7 contactos hoy no importa; si la base crece a cientos, dos corridas diarias podrían acercarse a límites del plan de HubSpot del tenant. Mitigación: no hace falta ahora, pero si se vuelve un problema, agrupar la búsqueda de notas también en batch (`searchAssociated` no lo soporta hoy, requeriría el endpoint de engagements con filtro por lista de IDs).
- **Elegir qué ejecutor presta el token (D6).** Si el ejecutor elegido pierde el grant a mitad de una corrida (no antes), esa corrida puede quedar a mitad de camino para ese tenant. Mitigación: cada contacto se procesa y persiste independientemente (§4.3 punto 5), así que lo ya hecho no se pierde — la próxima corrida retoma desde donde el `crm_synced_at` quedó.
- **`hs_note_body` puede traer HTML o texto largo.** El evento guarda el texto tal cual (mismo criterio que las notas del chat, "sin resumir" — CLAUDE.md regla 4), pero si HubSpot devuelve HTML de un editor rico, el historial de `/contactos` lo va a mostrar crudo. Fuera de alcance de esta pasada; se revisa si molesta en la práctica.

## 8. Enmiendas

- **Filtro de ids inciertos de HubSpot (enmienda de implementación).** El §5 D5 original decía "se trata como found: false" para cualquier id no confirmado; la implementación real (`lib/connectors/crm/hubspot-adapter.ts`, `batchCheckContacts`) es más estricta: solo `category: "OBJECT_NOT_FOUND"` cuenta como borrado confirmado, cualquier otro error dejaría afuera el id del resultado (ni found ni not-found) y el nodo lo salta entero sin tocar nada — evita que un error transitorio de HubSpot le limpie el `crm_id` a un contacto que sigue existiendo.
- **Clave del lock del schedule (enmienda de implementación).** El §4.6 asumía reusar `scheduleKeyFor` de `sweep.ts`; como esa función trunca a fecha y el schedule corre dos veces al día, se usa una `hourlyScheduleKey` propia (trunca a fecha+hora) para que las dos corridas del día no se bloqueen entre sí.
- **Paginación y dedup de notas por id, diferido.** `listNotesSince` trae como máximo 100 notas por corrida, ordenadas por `hs_timestamp` descendente, sin paginar más allá de eso, y no deduplica por `hubspot_note_id` contra lo ya insertado en `events`. Con el volumen actual (unos pocos contactos, notas manuales esporádicas) el riesgo es despreciable — el §7 de este documento ya lo anticipaba ("si se vuelve un problema, agrupar la búsqueda de notas también en batch"). Si el volumen crece lo suficiente como para que un contacto reciba más de 100 notas manuales entre dos corridas (9-15h de diferencia), hay que paginar de verdad y guardar los `hubspot_note_id` ya procesados para deduplicar.
