---
title: Outreach
category: dominios
status: activo
tags: [outreach, cola, pipeline, contactos, focos, crm, hubspot, gate, executors]
updated: 2026-10-13
sources:
  - lib/outreach
  - agents/outreach/instructions.md
  - agents/outreach/skills
  - agents/outreach/schedules
  - app/[tenant]/cola
  - app/[tenant]/pipeline
  - app/[tenant]/contactos
  - app/[tenant]/cuentas
  - app/[tenant]/focos
  - app/[tenant]/metricas
  - app/[tenant]/settings/outreach
  - lib/connectors/crm/adapter.ts
  - lib/connectors/crm/hubspot-adapter.ts
  - lib/connectors/leads/adapter.ts
  - lib/workflows/registry.ts
  - docs/superpowers/specs/03-agente-outreach-v1.md
  - docs/superpowers/specs/2026-09-16-etapa-4-dashboard-cola-design.md
  - docs/superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md
  - docs/superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md
  - docs/superpowers/specs/2026-09-27-hubspot-crm-sync-design.md
  - docs/superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md
---

# Outreach

## 1. Qué es y para qué

Outreach es el proceso por el que una empresa cliente le escribe en frío a posibles clientes, con un humano que aprueba cada envío. El loop completo es: descubrir o cargar contactos, investigar su empresa, redactar un primer mensaje que pase un gate de estilo, dejarlo en una cola, aprobarlo, enviarlo desde la casilla del ejecutor, registrarlo en la base y en el CRM, escuchar la respuesta y encolar los follow-ups. El juicio lo pone el modelo; los invariantes los hace cumplir el código en el borde de cada tool y nodo, de modo que un modelo que se saltea un paso no pueda romper nada.

Todo lo que es de una empresa (ICP, hooks, vectores, voz, mensajes, vetos de marca) vive en su [brain](brain.md) y en `config_values`; el código y las skills son genéricos. Dos entradas llegan a la misma cola: el chat con el [agente](agentes-eve.md) (CSV pegado, una cuenta puntual) y los workflows desatendidos que arrancan en un foco de búsqueda ([workflows](workflows.md)). Lo que sale siempre pasa por una persona: el nivel 3 (enviar) nunca corre solo. Las reglas de niveles y nodos están en [orquestación](../arquitectura/orquestacion.md).

## 2. Dónde vive en el código

| Ruta | Qué es |
|---|---|
| `lib/outreach/*.ts` | Núcleo puro: `contact-key`, `gate`, `guards`, `stage`, `ficha`, `icp`, `focus`, `listen`, `classify`, `prompt`, `csv`, `events`, `queue-letters`, `domain`, `time` |
| `lib/outreach/canon*.ts`, `gate-blocks.ts`, `marco-reflect.ts` | Lectura del canon del brain (ICP, hooks, vectores, voz, vetos) y reflejo a `config_values` |
| `lib/outreach/services/*.ts` | Los nodos del registro (ver "Nodos") más helpers (`executor`, `research-run`, `generate-*`, `evaluate`) |
| `lib/outreach/workflows/*.ts` | Los cinco workflows de outreach (detalle en [workflows](workflows.md)) |
| `lib/outreach/store.ts` | `OutreachStore` sobre Supabase: todas las lecturas y escrituras de la base |
| `lib/outreach/*-query.ts` | Lecturas normalizadas de cada pantalla (`cola`, `pipeline`, `contactos`, `cuentas`, `focus`, `metricas`, `historial`, `settings`, `outreach-settings`) |
| `lib/outreach/web-context.ts`, `web-session.ts` | Puente para que una server action arme las dependencias que en una tool vienen de eve |
| `lib/outreach/crm-session.ts`, `note-prefixes.ts` | Adapter de CRM del tenant para una tool; prefijos de notas que la app escribe |
| `lib/connectors/crm/`, `lib/connectors/leads/` | `CrmAdapter` (HubSpot por REST) y `LeadsAdapter` (Apollo) |
| `lib/gmail/` | Envío, lectura de hilos, MIME y firma |
| `agents/outreach/skills/` | Cómo trabaja el agente: `outreach-corrida`, `outreach-redaccion`, `outreach-crm`, `outreach-escucha` |
| `app/[tenant]/{cola,pipeline,contactos,cuentas,focos,metricas,settings/outreach}` | Las pantallas |

## 3. Cómo funciona

### Canon: qué es del código y qué del cliente

- **Genérico, en código:** los cinco frenos y los guardrails (`instructions.md`), el gate base, el motor de etapas, las skills.
- **Del cliente, en el brain** (páginas con tag `canon:*`): `canon:icp`, `canon:hooks`, `canon:mensajes`, `canon:objeciones` (lo que lee la redacción), `canon:gate` (vetos de marca), `canon:voz` y `executor:<slug>` (voz y vetos del ejecutor). Sin brain, el agente avisa que falta el canon y no lo inventa; el brain caído deja `draft_message` en `canon_no_disponible`.
- **Bloques como datos** (etapa 21.3): el ICP vive en un bloque `icp` dentro de la página `canon:icp` (niveles de `encaje` y `rol` y una línea `excluir`); los hooks y vectores, en bloques `hooks` y `vectores` de páginas `canon:hooks`. Solo cuentan páginas con estado `activo`. El parser (`canon-blocks.ts`) nunca tira: devuelve los errores con página y línea. La revisión del scoring es la huella del bloque normalizado (`icpRevision`), no un número escrito a mano. Hay un único bloque `icp` por empresa: dos son un error.
- **Reflejo a `config_values`:** al guardar o borrar una página `canon:hooks`, `marco-reflect.ts` refleja sus bloques en `config_values` (función de base `outreach_reflect_marco`, solo `service_role`). Un bloque inválido no se refleja, deja el evento de fallo y el guardado de la página nunca falla por esto. Nunca borra: un valor retirado se desactiva y conserva su rótulo en los reportes viejos.
- **Settings de outreach** (`/[tenant]/settings/outreach`): segmentos e idiomas se editan en `config_values`; zona horaria, BCC, pipeline y etapa del deal, empresa que firma y modelo por rol, en `tenant_agents.config.outreach`; workflows (encendido, cadencia, ítems por pasada) y presupuesto del día (solo lectura). ICP, hooks y vectores se ven en solo lectura con un botón "Releer del brain". Solo administradores; un miembro recibe 404. Los presupuestos los fija plataforma en `/plataforma/<slug>`. El cliente escribe por funciones `security definer` que verifican el rol adentro. Por esta vía se retiraron los scripts `outreach:config` y `workflows:set`.

### Datos

Toda tabla lleva `tenant_id` y RLS de lectura por miembro; la escritura está revocada a `authenticated` y `anon`: escriben las tools, los schedules y las server actions con el cliente admin o con funciones que verifican el rol.

| Tabla | Qué guarda |
|---|---|
| `contacts` | La persona: `contact_key` único por tenant, cuenta, atribución (`segment`, `vector`, `hook`, `idioma`), `stage`, `touches`, fechas de toque, `gmail_thread_id`, `crm_id`, claim (`owner_user_id`), `icp` (juicios crudos del scoring), `search_focus_id` |
| `accounts` | La empresa por `domain` único por tenant, con su `ficha` (JSON) y su vencimiento a 90 días; desde la etapa 13 suma lo que devolvió la búsqueda |
| `queue_items` | Cada pieza: tipo (`msg1`, `followup_2`, `followup_3`), destinatario, asunto, cuerpo, `ancla`, `draft_original`, `gate_result`, estado, vencimiento |
| `search_focuses` | El foco de búsqueda: criterios, atribución estampada, topes y estado |
| `executors` | Quién envía: `slug`, `crm_owner_id`, permisos de Gmail, cupo diario y datos de la firma (nombre, puesto, LinkedIn) |
| `config_values` | Listas cerradas por tenant: `segmento`, `vector`, `hook`, `idioma` |
| `conversations` | Los hilos del chat donde se trabaja la cola (ver [agentes](agentes-eve.md)) |

`events` es append-only y es la bitácora de todo (importar, investigar, encolar, aprobar, enviar, responder, cambiar de etapa, freno). Sus tipos son una lista cerrada en `lib/outreach/events.ts`; los idempotentes se deduplican a 2 horas y una respuesta se registra una sola vez por mensaje de Gmail.

### Contactos, etapas y claim

- **`contact_key`:** `em:<email>`, si no `li:<slug de LinkedIn>`, si no `h:<hash de nombre y empresa>`. El orden importa: es el que ya usan los contactos que existen en el CRM. Un contacto descubierto por búsqueda nace sin email y su clave se promueve a `em:` al revelar el email, solo mientras nunca fue tocado; si choca con una existente se descarta como duplicado, nunca se fusiona.
- **Escalera de etapas** (`stage.ts` y un trigger en la base que es la red de seguridad): `a_contactar` → `msg1_enviado` → (`sin_respuesta`, `respuesta_neutra`, `no_interesado`, `en_conversacion`) → `reunion_agendada` → `deal_creado` → `cliente`, y `sin_atribucion` aparte. Nunca baja. El cadencia es +4 y +10 días después del primer mensaje; tres toques y 14 días sin respuesta es `sin_respuesta`.
- **Claim:** una persona la trabaja un solo ejecutor por todos los canales. `claimStatus` da `libre`, `propio` o `ajeno` mirando `owner_user_id` y la autoría reciente (menos de 90 días) en el CRM; la autoría del CRM gana. Un contacto ajeno no se encola ni se toca por ningún camino: la tool devuelve `claim_ajeno`.
- En un tenant con CRM, un ejecutor sin `crm_owner_id` no puede encolar ni enviar (`ejecutor_sin_crm_owner`): su propia nota posterior al `msg1` bloquearía sus follow-ups.

### Cuentas y fichas

`research_account` (nodo `outreach/research`) lee páginas públicas del dominio con protección SSRF (solo http y https, puertos estándar, host que resuelve a IPs públicas, hasta 3 redirecciones, 10 s de timeout) y arma la ficha: qué produce, cómo gana, qué compra, qué se rompe si crece, el gap declarado contra el demostrable, los dolores (de 3 a 5, con su beneficio) y los hechos, cada uno con URL. Un hecho sin URL se descarta; sin ningún hecho con fuente no hay ficha (`sin_ancla`). La ficha vigente se reutiliza 90 días sin costo, y una ficha vieja sin dolores se vuelve a investigar ([#38](https://github.com/innovasbuild/agents/pull/38)). Se ve en `/[tenant]/cuentas`, de solo lectura. Aclaración: `/[tenant]/mis-cuentas` no es de esta página; es la pantalla donde cada persona ve y autoriza sus propias conexiones (Gmail, HubSpot).

### Redacción y gate

`draft_message` (nodo `outreach/draft`) arma el prompt con la ficha, el canon y la voz del ejecutor (`prompt.ts`). Las reglas son fijas; la estructura es por defecto y la voz del ejecutor puede cambiarla ([#46](https://github.com/innovasbuild/agents/pull/46)). El resultado pasa por el gate (`gate.ts`):

- **Determinístico, sin chequeo semántico con un modelo:** símbolos vetados, fórmulas de relleno y de texto generado, asks vetados, idioma por marcadores funcionales, largo del asunto, sin HTML ni tracking, y recitar la investigación ("vi que", "según su sitio") está vetado.
- **Vetos como datos:** bloques `gate` dentro de páginas del brain (`veto:`, `veto_literal:`, `max_chars:`, `formal:`), interpretados como frases acotadas, nunca como regex (evita ReDoS).
- Resultado `ok`, `fail` o `indeterminate`; los dos últimos bloquean. Si el brain falla, el gate es `indeterminate`.
- `queue_touch` y `update_queue_item` vuelven a correr el gate: no confían en el borrador del modelo.

### Guards de envío

`canTouch` decide, en orden: pieza vencida, un toque por persona por día, cupo diario del ejecutor (`executors.daily_quota`), máximo 3 toques, y guard de buzón (algo enviado a esa dirección en los últimos 10 días fuera del hilo). Cupo y un-toque-por-día son transitorios (la pieza vuelve a `pending`); el resto la deja `failed` o `expired`. `sendQueuedEmail` (nodo `outreach/send`) toma la pieza con `pending → approved` (esa es la idempotencia: una segunda llamada nunca envía), revalida claim, gate y guards, envía por Gmail con texto plano, BCC del CRM si hay, y registra. Si el CRM falla después de enviar, queda `crm_sync_pendiente` y se reintenta en el barrido: **nunca se reenvía por un error del CRM.** Una pieza que queda en `approved` sin confirmación se muestra como trabada y no tiene botón para destrabar.

### Cola y piezas (`queue_items`)

Una sola pieza viva (`pending` o `approved`) por persona. Hay dos puertas a la misma lógica:

- **Chat:** el modelo llama `send_email` (con `approval`).
- **`/[tenant]/cola`:** una server action llama el mismo `sendQueuedEmail` sin pasar por eve: el click humano es la aprobación, y comparte gate, claim, cupo e idempotencia. Se ve la cola de todo el tenant, pero editar, rechazar y aprobar es solo de las piezas propias. Sin grant de Gmail, la action devuelve el enlace de autorización. Se actualiza por Realtime y distingue un envío web de uno del chat por el prefijo `web:` del id de sesión ([#23](https://github.com/innovasbuild/agents/pull/23)).

### Pipeline y contactos

`/[tenant]/pipeline` muestra el embudo por etapa (conteo, porcentaje, movimiento de los últimos 7 días; `sin_atribucion` aparte, fuera de la escalera) y enlaza a `/[tenant]/contactos`, una tabla con búsqueda y filtros por etapa, ejecutor, vector y hook que viven en la URL, y el historial de `events` de cada fila con etiquetas en castellano ([#24](https://github.com/innovasbuild/agents/pull/24)). `/[tenant]/metricas` cruza `contacts` con `events` para ver qué hook, vector, segmento y ejecutor funcionan mejor. El menú agrupa Cola, Pipeline, Contactos, Cuentas y Focos bajo "Outreach" ([#69](https://github.com/innovasbuild/agents/pull/69)).

### Focos y búsqueda de objetivos

Un foco (`search_focuses`) es la forma operativa de un vector: criterios de búsqueda, atribución estampada en cada contacto, topes de cuentas y contactos, y un ejecutor dueño. Crearlo desde `/[tenant]/focos` **es** la autorización del gasto; el presupuesto del tenant es la red de abajo. Todo contacto descubierto nace con el claim del ejecutor del foco. El embudo de la etapa 13:

1. `target-search` (nodo `outreach/target-search`, `LeadsAdapter` sobre `apollo`, con fallback entre dos llaves): descubre cuentas y personas, sin email. Gasta créditos de Apollo.
2. `icp-scoring` (nodo `outreach/icp-score`): Jev responde tres preguntas sobre lo que la búsqueda ya trajo gratis. Se guardan los juicios crudos en `contacts.icp` y una función pura (`decideIcp`) los pasa a uno de tres carriles: `calificado`, `descartado` o `para_revisar`. Cambiar un umbral re-decide sin volver a pagar. Los umbrales de arranque son conservadores y están en código.
3. `contact-enrichment` (nodos `outreach/reveal-email` y `outreach/research`): revela el email solo de los calificados, así que un descartado nunca consume un crédito de revelado.
4. `draft-queue` (nodos `outreach/draft`, `outreach/verify-fact` y `outreach/queue`): redacta, verifica que la fuente respalde el ancla y deja la pieza `pending` en la cola, respetando el cupo diario.

Los de baja confianza se revisan en `/[tenant]/focos/[id]/revisar`, con dos botones que mueven el contacto. Ningún workflow pasa de nivel 1: el último paso humano es siempre `/cola`. El detalle de cada workflow, cadencias y presupuestos está en [workflows](workflows.md).

### Escucha y follow-ups

- **`morning-sweep`** (nodos `outreach/sweep` y `outreach/reconcile`, nivel 0): por cada ejecutor con lectura de Gmail autorizada trae los hilos conocidos y los mensajes nuevos, separa respuestas reales, rebotes y respuestas automáticas, y registra el hecho: evento `respuesta`, `replied_at`, etapa `respuesta_neutra`. **El código registra el hecho; el agente interpreta el significado.** Una respuesta automática no apaga la cadencia. Reconcilia las piezas `approved` colgadas: solo puede confirmar un envío que puede probar; si no aparece, la deja trabada. Nunca reencola.
- **`read_replies`** (nodo `outreach/replies`) le trae al agente las respuestas sin clasificar; la skill `outreach-escucha` las lleva a `en_conversacion`, `reunion_agendada` o `no_interesado`, y crea el deal cuando corresponde. También detecta `oportunidad_frenada`: un deal abierto sin respuesta del cliente hace más de 15 días.
- **`followups`** (nodo `outreach/followups`, nivel 1): encola `followup_2` y `followup_3` `pending` en el mismo hilo de Gmail, una hora después del sweep. No manda nada: no tiene ninguna dependencia de envío.

### CRM

El CRM entra por la capacidad `crm` (`CrmAdapter`, con `hubspot` por REST; el tenant sin CRM sigue funcionando solo con la base). Lo conecta cada persona por Connect, no hay token del tenant.

- **`crm_upsert_contact`** (nodo `outreach/crm-record`, nivel 2): registra avances fuera del mail (llamada, LinkedIn, reunión); mueve la etapa solo hacia adelante y deja una nota. `send_email` registra solo lo del envío: las propiedades de atribución en la misma llamada que el upsert, la nota con el texto exacto y la task del siguiente toque.
- **Sync entrante** (nodo `outreach/crm-sync`, nivel 0, schedule `crm-sync` dos veces por día): reconcilia contra HubSpot lo que cambia por afuera. Un contacto borrado allá deja `crm_id` en null y un evento `crm_id_huerfano`; un owner reasignado actualiza `owner_user_id` (`crm_owner_actualizado`) solo si coincide con un ejecutor conocido; una nota agregada a mano entra a `events`. Filtra por prefijo las notas que la app ya escribió, para no reimportarlas. Solo lee de HubSpot y escribe en la base propia. No sincroniza etapas de deal (los vocabularios no mapean) y es polling, porque la conexión no es una app propia. Un tenant sin grant vigente se saltea sin frenar a los demás.
- **`crm_setup_outreach_properties`** crea las propiedades custom de outreach que falten, con aprobación y solo para administradores.

### Ejecutores y su voz

Un ejecutor (`executors`) es el usuario de un tenant que envía: tiene `slug`, `crm_owner_id`, cupo diario y datos de firma. Una sesión actúa por un solo ejecutor: encola, aprueba y envía en su nombre. Su voz (y sus vetos) son páginas del brain con tag `canon:voz` y `executor:<slug>`. La firma sale del mismo lugar para el envío y para la previsualización del chat ([#48](https://github.com/innovasbuild/agents/pull/48)), y la empresa que firma se configura en settings.

### Nodos

Todos los nodos de `lib/outreach/services/` están en `lib/workflows/registry.ts` con su nivel de efecto y tier. Un nodo es un servicio puro con dependencias inyectadas, tenant desde el caller.

| Nodo | Nivel | Qué hace |
|---|---|---|
| `outreach/import-contacts` | 0 | CSV a contactos, veredicto por fila |
| `outreach/research` | 1 | Ficha de una cuenta |
| `outreach/draft` | 1 | Primer mensaje o follow-up con gate |
| `outreach/queue` | 0 | Encolar, listar, editar y rechazar piezas |
| `outreach/send` | 3 | Enviar una pieza aprobada (nunca desde un workflow) |
| `outreach/crm-record` | 2 | Escribir un avance en el CRM |
| `outreach/sweep` | 0 | Barrido de respuestas y rebotes |
| `outreach/reconcile` | 0 | Confirmar envíos inciertos |
| `outreach/crm-sync` | 0 | Sync entrante de HubSpot |
| `outreach/replies` | 0 | Respuestas pendientes de clasificar |
| `outreach/followups` | 1 | Encolar follow-ups |
| `outreach/target-search` | 1 | Descubrir cuentas y personas |
| `outreach/icp-score` | 1 | Calificar contra el ICP |
| `outreach/reveal-email` | 1 | Revelar un email |
| `outreach/verify-fact` | 1 | Verificar que la fuente respalde el ancla |

Un verificador recibe el dato y la evidencia, nunca el razonamiento de quien lo produjo.

### Lo que nunca se hace

- Enviar sin aprobación, o desde un workflow o schedule.
- Escribir `canon:*`, presupuestos o interruptores de autonomía desde un nodo: lo hace una persona.
- Tocar a una persona con claim ajeno, o crear un segundo contacto si el CRM ya tiene match por email, `contact_key` o LinkedIn.
- Reencolar o reenviar una pieza trabada sin que una persona confirme que el mail no salió.
- Inventar un dato: un hecho sin fuente es "sin dato".
- Dejar datos de un cliente en el código: va a su brain o a `config_values`.

## 4. Cómo se prueba

| Qué | Dónde |
|---|---|
| Núcleo puro (gate, guards, stage, contact-key, csv, ficha, icp, focus, listen, canon-blocks, marco-reflect) | `tests/outreach/*.test.ts` |
| Nodos | `tests/outreach/services/*.test.ts` |
| Workflows | `tests/outreach/workflows/*.test.ts` |
| Schedules | `tests/outreach/schedules/{dispatch,followups}.test.ts`, `tests/outreach/services/sweep.test.ts` |
| Pantallas y acciones | `tests/cola`, `tests/pipeline`, `tests/focos`, `tests/accounts`, `tests/settings` |
| Registro de nodos | `tests/workflows/registry.test.ts` (falla si falta un nodo) |
| Base (RLS, trigger de escalera, dedup de eventos, funciones de settings) | `npm run db:test` (pgTAP; necesita Docker) |
| Comportamiento del agente | las evals: ver [agentes eve](agentes-eve.md) y [correr evals](../guias/correr-evals.md) |

```bash
npm test -- tests/outreach
npm run db:test
```

## 5. Decisiones

- [03-agente-outreach-v1](../superpowers/specs/03-agente-outreach-v1.md): tools granulares con guards en código, gate determinístico, `contact_key` con el orden del canon, escucha por el Gmail del ejecutor, todo envío con aprobación. La spec quedó atrás en: el `followups` corre a las 11:00 UTC y no a las 10:30; el research tiene dolores además de hechos (#38); `read_replies` no lleva aprobación.
- [Etapa 4](../superpowers/specs/2026-09-16-etapa-4-dashboard-cola-design.md): la cola aprueba con una server action sobre el servicio compartido, sin pasar por eve.
- [Etapa 5](../superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md): TypeScript registra el hecho, el agente interpreta el significado; la reconciliación solo confirma.
- [Etapa 13](../superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md): calificar antes de enriquecer, cuatro workflows, el foco como unidad de autorización del gasto. La spec guardaba los niveles del ICP en `tenants/<slug>/outreach.json`; la 21.3 lo revirtió (ahora son un bloque del brain).
- [Sync entrante de HubSpot](../superpowers/specs/2026-09-27-hubspot-crm-sync-design.md): polling, sin sync de etapas. Quedó atrás en el filtro de notas propias por prefijo (#61) y en que solo `OBJECT_NOT_FOUND` cuenta como borrado.
- [Etapa 21.3](../superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md): el brain como única fuente de ICP, hooks y vectores; pantalla de settings; presupuestos fijados por plataforma.
- PR: [#8](https://github.com/innovasbuild/agents/pull/8) (datos y núcleo), [#15](https://github.com/innovasbuild/agents/pull/15) (agente de primer toque), [#23](https://github.com/innovasbuild/agents/pull/23) (cola), [#24](https://github.com/innovasbuild/agents/pull/24) (pipeline y contactos), [#26](https://github.com/innovasbuild/agents/pull/26) (escucha y follow-ups), [#38](https://github.com/innovasbuild/agents/pull/38) (dolores en la ficha), [#45](https://github.com/innovasbuild/agents/pull/45) y [#47](https://github.com/innovasbuild/agents/pull/47) (pipeline de GTM), [#46](https://github.com/innovasbuild/agents/pull/46) (la voz define la estructura), [#48](https://github.com/innovasbuild/agents/pull/48) (firma), [#61](https://github.com/innovasbuild/agents/pull/61) (sync entrante), [#66](https://github.com/innovasbuild/agents/pull/66) (runs del sweep), [#69](https://github.com/innovasbuild/agents/pull/69) (menú), [#90](https://github.com/innovasbuild/agents/pull/90) (etapa 21.3).
- Ruta del chat: `/[tenant]/chat` es donde se trabaja la cola con el agente; su funcionamiento está en [agentes eve](agentes-eve.md).
