# Etapa 5 · Escucha y follow-ups

Fecha: 2026-09-19
Rama: `feat/etapa-5-escucha` (worktree `.claude/worktrees/etapa-5-escucha`, base `origin/main` en `7ac307e`)
Etapa del kickoff: `docs/innovas-agents-kickoff.md` §Etapa 5
Contrato previo: `docs/superpowers/plans/03-agente-outreach-v1.md` §"Entrega 4 · Escucha y follow-ups · Alcance e interfaces"

## 1. Qué problema resuelve

Hoy el agente manda el primer mail y ahí se queda. Si alguien contesta, nadie se entera salvo que abra Gmail a mano: el contacto no se mueve de etapa, no se registra la respuesta, no nace un deal, y el follow-up nunca sale porque no existe. El piloto no puede correr así.

Esta etapa cierra el loop: una respuesta real en Gmail mueve el contacto sin que nadie intervenga, y un follow-up vencido aparece en `/cola` a la mañana.

## 2. Alcance

**Entra:** lectura de Gmail, clasificación de respuestas, reconciliación de piezas trabadas, follow-ups con hilo, los dos schedules y la skill del agente.

**No entra:** ColdIQ y Places como flujo de carga de contactos. El kickoff los nombra en la misma línea que la escucha, pero son otro sistema (traer contactos nuevos de APIs de terceros, no interpretar los que ya están). Queda como etapa propia, decidido explícitamente.

## 3. Decisiones tomadas

| # | Decisión | Por qué |
|---|---|---|
| D1 | Solo escucha y follow-ups; las fuentes quedan afuera | Son dos sistemas sin relación técnica, y esta etapa ya es la más grande hasta ahora (cron en Vercel, clasificación por IA, hilos de Gmail). |
| D2 | El sweep abre un hilo nuevo en `/chat` cada mañana, y si no hay nada no manda nada | Es donde ya se trabaja con el agente, y desde ahí se le puede pedir que actúe sobre lo que encontró. eve soporta entrega condicional en schedules. |
| D3 | La clasificación crea el deal en HubSpot sola, con el origen en `description` | Es lo que hace que el piloto corra sin intervención. El formato del deal ya está fijado en el `CLAUDE.md` del repo. |
| D4 | Handler determinista en TypeScript + sesión del agente solo para interpretar | El task mode de eve no puede parkear para OAuth: un grant vencido sería un fallo seco. Y la iteración sobre tenants no puede quedar en manos del modelo: si se saltea un ejecutor, nadie se entera. |

### Contratos que vienen fijados de la Etapa 3

Del §"Entrega 4" de la spec 03, no se re-litigan acá:

- Lock por `runs.schedule_key`.
- Un ejecutor que falla no frena a los demás.
- Una respuesta duplicada (`23505` o insert descartado) cuenta como ya registrada.
- **Los schedules nunca envían mail.**
- Ningún `tokenForSubject` sin `issuer`.

## 4. Arquitectura

```
agents/outreach/schedules/morning-sweep.ts   handler run, diario
agents/outreach/schedules/followups.ts       handler run, diario, una hora después
agents/outreach/tools/read_replies.ts        wrapper fino para el agente
agents/outreach/skills/outreach-escucha/     cómo clasificar, para el modelo
lib/gmail/read.ts                            hilos, rebotes, búsqueda por rfc822msgid
lib/outreach/listen.ts                       núcleo puro, I/O inyectado
lib/outreach/services/reconcile.ts           confirmar envíos inciertos
lib/connectors/crm/hubspot-adapter.ts        + listOpenDeals, createDeal
lib/gmail/mime.ts                            + In-Reply-To, References
lib/gmail/send.ts                            + threadId
lib/outreach/summary.ts                      + respuestas y oportunidades frenadas
lib/outreach/services/draft.ts               sacar el refuse de followup_no_disponible
```

### 4.1 `morning-sweep`

Handler `run`, `0 10 * * 1-5` (7:00 de Argentina; Vercel evalúa cron en UTC).

Primero, **una vez por corrida**: toma el lock insertando en `runs` con `schedule_key = morning-sweep:<YYYY-MM-DD>`. El índice único ya existe: un segundo disparo del mismo día choca con `23505` y se retira sin hacer nada. El lock es global de la corrida, no por tenant.

Después, por cada tenant con `tenants.active = true`, y dentro de cada uno por cada ejecutor con `gmail_read_authorized_at`:

1. Pide el token con `tokenForSubject(GOOGLE_CONNECTOR_UID, { tenantId, userId, issuer }, [...GMAIL_SCOPES])` — el `issuer` va dentro del subject, que es como lo toma la firma real. Si el grant murió, anota al ejecutor como fallido y sigue con el siguiente.
2. Trae de Gmail **solo los hilos que ya conocemos** (`contacts.gmail_thread_id`), no el buzón entero: más barato y sin necesitar permisos más amplios que los que ya hay.
3. Separa mensajes entrantes nuevos, rebotes y confirmaciones de envíos inciertos.
4. Reconcilia las piezas `approved` colgadas (§4.5).

Cerrado el barrido de un tenant: si quedó algo para interpretar, abre **una** sesión del agente con `to(canal).send(..., { auth: appAuth })`. Esa sesión es el hilo de la mañana. Si no hay nada, no manda nada.

### 4.2 `followups`

Handler `run`, `0 11 * * 1-5`, una hora después del sweep para que ya esté marcado quién respondió anoche y no se encole un follow-up a alguien que contestó.

Recorre contactos con `next_step_at` vencido, `touches < 3` y sin `replied_at`, y encola una pieza `followup_2` o `followup_3` en estado `pending`, completando `reply_to_message_id` y `gmail_thread_id` (§4.4). **No manda nada**: la pieza aparece en `/cola` y sale cuando una persona la aprueba, igual que un msg1.

`nextFollowup()`, `isNoResponse()`, `FOLLOWUP_OFFSETS_DAYS = [4, 10]` y `NO_RESPONSE_AFTER_DAYS = 14` ya existen en `lib/outreach/stage.ts` y no cambian.

### 4.3 El corte entre lo determinista y lo interpretado

Es la decisión central del diseño. **TypeScript registra el hecho; el agente interpreta el significado.**

TypeScript (el sweep) escribe el evento `respuesta` con `gmail_message_id` en el payload, setea `replied_at`, y mueve la etapa a `respuesta_neutra`. El agente, después, decide si eso fue interés, una baja o ruido, y mueve de ahí para arriba.

Si la sesión del modelo falla, quedó registrado que la persona contestó, visible en `/contactos` y en el resumen. Se pierde la interpretación, no el dato. Al revés sería peor.

Esto encaja con la escalera existente sin tocarla: `respuesta_neutra` es rank 2, y `WITHIN_RANK_2` ya permite `respuesta_neutra → no_interesado | en_conversacion`, más `reunion_agendada` y arriba por rank. `canAdvance` ya codifica exactamente las transiciones que la clasificación necesita.

**Clasificación → etapa:**

| Clasificación | Etapa | Efecto extra |
|---|---|---|
| Interés, quiere hablar | `en_conversacion` | deal en HubSpot |
| Reunión concreta | `reunion_agendada` | deal en HubSpot |
| Baja, no le interesa | `no_interesado` | — |
| Ambiguo, "escribime en marzo" | queda en `respuesta_neutra` | — |
| Rebote | no avanza | evento `rebote` |

**Deduplicación:** `events_inbound_message_idx` es único sobre `(tenant_id, payload->>'gmail_message_id')` para `respuesta` y `rebote`. Un mensaje ya registrado choca con `23505`, y eso cuenta como ya procesado. El sweep puede correr dos veces sin duplicar nada.

**Respuestas automáticas:** un "estoy de vacaciones hasta el 3" trae `Auto-Submitted: auto-replied`. Se registra el evento, pero **no** setea `replied_at` ni mueve la etapa, así la cadencia de follow-ups sigue su curso. Sin esto, el responder automático de alguien apaga su propia secuencia.

### 4.4 Follow-ups que caen en el mismo hilo

Para que un `followup_2` no abra una conversación nueva hacen falta tres cosas que hoy no existen: `threadId` en la llamada a Gmail, y los headers `In-Reply-To` y `References`. Toca `lib/gmail/mime.ts` (headers) y `lib/gmail/send.ts` (threadId).

El punto no obvio: esos headers necesitan el `Message-ID` **RFC822** del mensaje original, que no es el `gmail_message_id` guardado. Gmail reescribe el `Message-ID` propio — ya se pagó ese aprendizaje en la Etapa 3. El valor real se lee de Gmail con `read.ts`. Por eso `queue_items.reply_to_message_id` existe desde la Etapa 3, y por eso los follow-ups dependen de la lectura.

### 4.5 Reconciliación, con una regla que no se negocia

La reconciliación solo puede **confirmar** envíos que puede probar: si el mensaje aparece en enviados, la pieza pasa a `sent` con sus ids y se limpia `error`.

Si **no** aparece, no concluye nada: la pieza queda trabada y se reporta en el resumen para que decida una persona. Nunca reencola, nunca reintenta. Destrabar automáticamente puede significar un segundo mail al mismo contacto, que es el peor error posible en esta herramienta. Esa fue la decisión explícita de la Etapa 3 y sigue vigente.

### 4.6 `lib/gmail/read.ts`

Espejo de `send.ts`: recibe un token, devuelve tipos, tira `GmailUnauthorizedError` en un 401 para que el llamador lo trate igual que en el envío. Tres capacidades y nada más:

- traer un hilo por `gmail_thread_id`;
- separar mensajes nuestros de ajenos, y detectar rebotes (`mailer-daemon`/`postmaster`, parte `message/delivery-status`) y auto-replies (`Auto-Submitted`);
- buscar por `rfc822msgid:` para la reconciliación.

### 4.7 Deals y oportunidades frenadas

El agente aplica la clasificación por el camino de CRM que ya existe (`lib/outreach/services/crm-record.ts`, que ya emite `cambio_etapa` y deja nota), extendido con `listOpenDeals` y `createDeal` en el adapter de HubSpot.

`listOpenDeals` es lo que habilita `oportunidad_frenada`: tres toques sin respuesta **con deal abierto** es el "Retrasado (stand by)" de la tabla de pipeline del `CLAUDE.md`. El deal se crea con el formato que ese mismo archivo fija: pipeline `default`, stage `1404975950`, asociado a contacto y empresa, con vector, hook y canal repetidos en `description`, y nombre `En Paralelo · <Empresa>`.

## 5. Manejo de errores

| Caso | Qué pasa |
|---|---|
| Grant de Gmail vencido en un ejecutor | Se anota como fallido, el sweep sigue con el resto. Aparece en el resumen de la mañana. |
| Un tenant explota | No frena a los otros tenants. |
| Segundo disparo del mismo día | `23505` sobre `runs.schedule_key`, se retira sin hacer nada. |
| Mensaje entrante ya registrado | `23505` sobre `events_inbound_message_idx`, cuenta como ya procesado. |
| La sesión del modelo falla | Los hechos ya están escritos: se pierde la interpretación, no el dato. |
| Pieza trabada que no aparece en enviados | Queda trabada y se reporta. Nunca se reencola. |

## 6. Testing

El grueso de la lógica vive en funciones puras, que es donde va el TDD:

- `lib/outreach/listen.ts`: qué es una respuesta nueva, qué es un rebote, qué es un auto-reply, qué transición corresponde.
- `lib/outreach/services/reconcile.ts`: confirmado / no encontrado / vencido → acción.
- `lib/gmail/mime.ts`: armado de headers de hilo.
- `lib/gmail/read.ts`: parsing contra fixtures de respuestas reales de la API de Gmail, con `fetch` mockeado, igual que `send.ts`.
- Los schedules, con deps inyectadas: que un ejecutor que explota no corte el loop, que el lock haga bail, y que **nada mande un mail**.

No hay runner de componentes React en el repo, pero esta etapa no agrega UI.

## 7. Verificar en vivo, no asumir

1. **Que el schedule aparezca en producción.** Este proyecto ya tiene el antecedente de una tool mergeada y deployada que nunca apareció en el agente de producción. Los schedules en Vercel se registran como cron en el Build Output: confirmarlo en Settings → Cron Jobs después del deploy.
2. **La ruta de dispatch en dev.** `eve dev` nunca dispara cron; se disparan a mano con `POST /eve/v1/dev/schedules/<id>`. Con `withEve` embebido en Next.js el prefijo cambia (`/eve/agents/outreach/...`): encontrar la ruta exacta antes de depender de ella.

## 8. Terminado cuando

1. Una respuesta real en Gmail mueve el contacto a `respuesta_neutra` y registra el evento, sin intervención.
2. El agente clasifica esa respuesta y, si hay interés, crea el deal en HubSpot con el formato del `CLAUDE.md`.
3. Un follow-up vencido aparece en `/cola` a la mañana, y al aprobarlo cae en el mismo hilo de Gmail que el primer mensaje.
4. Un auto-reply de vacaciones no apaga la cadencia de follow-ups.
5. Una pieza trabada que sí se había enviado queda reconciliada como `sent`; una que no, queda trabada y reportada.
6. Un ejecutor sin grant no frena al resto del sweep.
7. `npm run typecheck`, `npm test` y `npm run lint:fix` en verde.
