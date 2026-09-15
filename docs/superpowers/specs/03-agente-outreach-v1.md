---
title: Etapa 3 · Agente de outreach v1 (spec)
fecha: 2026-09-14
estado: aprobada en brainstorming
modelo: Opus 5 (spec) · Sonnet 5 (implementación, sesión nueva)
fuente: docs/01-roadmap-etapas.md §Etapa 3 y §Etapa 5 · docs/innovas-agents-kickoff.md §1, §3, §5, §6 · docs/superpowers/specs/02-conexiones-innovas.md · docs/superpowers/specs/2026-09-13-brain-design.md §7 · canon de outreach de la bóveda (`brain/comercial/outreach/`) y plugin `innovas-outreach` 1.0.0
---

# Etapa 3 · Agente de outreach v1

## 1. Objetivo y criterio de cierre

Que el agente `outreach` corra el loop completo de outreach por email para cualquier tenant: carga de contactos, research de la cuenta, redacción, cola, aprobación, envío desde la casilla del ejecutor, registro en la base y en el CRM, escucha de respuestas, follow-ups y barrido de oportunidades frenadas. El juicio lo pone el modelo; los invariantes del canon los hace cumplir el código, en el borde de cada tool, de modo que un modelo que se saltea un paso no pueda romperlos.

**Terminado cuando**, contra el deploy de producción:

1. **Primer toque real:** 5 contactos reales repartidos entre al menos 2 ejecutores de `innovas` cierran CSV → research → redacción → cola → aprobación → envío, con `events` completos y, en HubSpot, las 10 propiedades de atribución, la nota `[out · msg1 · email · <vector> · <hook>]` y la task del siguiente toque.
2. **Escucha:** una respuesta controlada (desde una casilla propia, por ejemplo `it@innov.as`, a un toque real) mueve el contacto en `contacts` y en HubSpot al día siguiente, sin intervención humana.
3. **Follow-up:** un contacto de prueba con `next_step_at` vencido aparece a la mañana como `queue_item` pendiente de tipo `followup_2`, en el mismo hilo de Gmail.
4. **Evals** de §11.2 en verde.
5. `npm test`, `npm run typecheck` y `npm run db:test` en verde.

Una respuesta real de un prospecto no se puede garantizar dentro de la ventana de la etapa; por eso 2 y 3 usan casos controlados.

## 2. Decisiones de esta spec

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Loop completo, solo email:** F1 a F6.5 del motor del canon. Absorbe `read_replies` y los schedules `morning-sweep` y `followups` de la Etapa 5 | Elección del usuario. LinkedIn automático sigue fuera de la v1 (kickoff §10) |
| D2 | **Orquestación híbrida:** tools granulares que el modelo encadena, cada una con sus guards en código; schedules en código sin el modelo en el camino crítico | El canon ya aprendió que una regla escrita en el prompt se rompe en silencio (00-constitución §8). Un workflow determinístico único es más rígido y usa la parte menos madura de eve 0.54 (workflow tools estáticas) |
| D3 | **Gate de estilo determinístico, sin chequeo semántico con Haiku.** Revierte la fila "Gate de estilo" del kickoff §3 | El canon lo desaconseja: pedirle a un modelo que revise texto generado falla sin avisar. Lo no mecánico queda como avisos que no bloquean |
| D4 | **`contact_key` del canon:** `em:<email>` → `li:<slug>` → `h:<sha1(nombre\|empresa)>`. Revierte el orden del kickoff §5 | Los contactos que ya existen en HubSpot usan estas claves; cambiar el orden duplica personas |
| D5 | **10 propiedades de atribución**, no 8: se suman `outreach_vector` y `outreach_idioma` | `outreach_vector` es la dimensión de corte principal del canon (24-atribución) |
| D6 | **Un ejecutor por sesión:** la sesión encola, aprueba y envía en nombre de su usuario | El claim y "solo aprueba el dueño de la pieza" salen de la auth de sesión existente, sin políticas de aprobación que consulten la base. Preparar piezas para otro ejecutor queda fuera |
| D7 | **La pieza vive en `queue_items`;** `send_email` recibe el id de la fila | eve no permite editar el payload de una aprobación (solo aprobar o cancelar). Así "B con este cambio" y la edición en `/cola` (Etapa 4) no requieren rediseño |
| D8 | **Todo envío con `approval: always()`** en la v1 | Principio 3 del kickoff. El modo `automatico` del canon (política de emisión por ejecutor) queda fuera; sin columna hasta que entre |
| D9 | **Escucha por el Gmail del ejecutor** (`gmail.readonly` vía Connect). F6.5 usa además los deals del CRM y solo corre con capacidad `crm` | Elección del usuario. Funciona para tenants sin CRM; el scope restringido queda como deuda de verificación con Google (§16) |
| D10 | **Separación del canon:** lo genérico va a `instructions.md`, skills y `lib/outreach`; lo propio del tenant, al brain (páginas con tags `canon:*`), a `config_values` y a `tenant_agents.config` | Principio 6 del kickoff y spec brain §7. Clasificación en §3 |
| D11 | **Research por workflow tool + subagente `researcher`** | La tool espera el resultado tipado (`ctx.agent` con `outputSchema`) y lo guarda; llamar al subagente como tool devuelve un recibo en segundo plano, no la ficha |
| D12 | **El ejecutor se entera al abrir el chat:** el resumen del día entra en las instrucciones de sesión | No hay push al chat hasta la Etapa 8 |
| D13 | **Rechazos como resultado, no como excepción:** toda tool devuelve `{ ok: false, reason }` ante un guard | El modelo cita el `reason` (regla de las instrucciones) en vez de reintentar por otra vía |

## 3. Canon: qué va dónde

Fuente: `brain/comercial/outreach/` (00-constitución, 10-motor, 20-canales, 21-crm, 22-redacción, 23-vectores, 24-atribución, GUIA-EJECUTOR, `voz/`, `scripts/gate.py` v1.2.0, `scripts/pertenencia.py`, `scripts/guards-hubspot.md`) y los 8 skills del plugin `innovas-outreach` 1.0.0. El usuario avisó que el plugin **no está probado de punta a punta**: donde el canon y el plugin difieran, o algo no cierre, la implementación lo reporta en vez de copiarlo.

| Pieza | Destino |
|---|---|
| Cinco frenos, qué no frena, límites que no existen | `agents/outreach/instructions.md` |
| Guardrails universales (nada en frío sin OK, sin contraseñas ni compras, no inventar datos, no afirmar envíos sin verificar) | `instructions.md` |
| Claim por persona, regla de autoría, 90 días | `instructions.md` (regla) + `lib/outreach/guards.ts` (cumplimiento) |
| Motor F1 a F6.5, orden de chequeos, cadencia 0/+4/+10, dos relojes, regla de 15 días | skills + `lib/outreach` + schedules |
| Cola por letras, revalidación antes de emitir, verificación antes de registrar, Definition of Done | skill `outreach-corrida` + `send_email` |
| Escalera de `outreach_status` | enum `outreach_stage` + `lib/outreach/stage.ts` |
| Mecánica del gate: símbolos, fórmulas genéricas, idioma, largos, códigos 0/1/2 | `lib/outreach/gate.ts` |
| Research con ancla y fuente, vencimiento a 90 días | `researcher` + `research_account` |
| Fórmulas BM/BID/FAO, "asunto sin IA", guardrail de agro trazabilidad | brain de `innovas`, página con tag `canon:gate` |
| Hooks, vectores, ICP, mensajes, objeciones | brain (`canon:hooks`, `canon:icp`, `canon:mensajes`, `canon:objeciones`) + listas en `config_values` |
| Voz y vetos por ejecutor, pares borrador/enviado | brain, `canon:voz` + `executor:<slug>` |
| Portal, owner ids, pipeline de deals, BCC de HubSpot | `executors.crm_owner_id` y `tenant_agents.config.outreach` |
| Run log y colas en archivos | reemplazados por `runs`, `events` y `queue_items` |
| Modalidad con navegador, LinkedIn, pertenencia de conexiones aceptadas | fuera de alcance (§15) |

Las muletillas que lista el skill `-message` y `gate.py` no tiene ("justo lo que", "no es casualidad que", etc.) se suman a la base genérica del gate. Si alguna resulta preferencia de marca, pasa a la página `canon:gate` del tenant.

## 4. Modelo de datos

Toda tabla nueva lleva `tenant_id` y RLS de lectura para `is_member_of(tenant_id)` o `is_platform_admin()`, con `insert/update/delete` revocados a `authenticated` y `anon`: escriben las tools y los schedules con el cliente admin, igual que `events` y `runs` hoy. La Etapa 4 escribirá desde server actions con chequeo de rol. Antes de escribir SQL, cargar `supabase-postgres-best-practices`.

### 4.1 Enums

- `outreach_stage`: `a_contactar`, `msg1_enviado`, `sin_respuesta`, `respuesta_neutra`, `no_interesado`, `en_conversacion`, `reunion_agendada`, `deal_creado`, `cliente`, `sin_atribucion`.
- `queue_item_status`: `pending`, `approved`, `rejected`, `sent`, `failed`, `expired`.
- `queue_item_kind`: `msg1`, `followup_2`, `followup_3`.
- `config_value_kind`: `segmento`, `vector`, `hook`, `idioma`.

### 4.2 `executors` (alter)

| Columna | Tipo | Notas |
|---|---|---|
| `slug` | text | Nullable (hay filas previas). Único parcial `(tenant_id, slug) where slug is not null`. `send_email` y `queue_touch` rechazan si el ejecutor no tiene slug |
| `crm_owner_id` | text | Owner del ejecutor en el CRM del tenant. Nullable |
| `gmail_read_authorized_at` | timestamptz | Lo estampa el hook de autorización cuando el grant incluye `gmail.readonly` (§8.5) |

### 4.3 `config_values`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid | |
| `kind` | `config_value_kind` | |
| `value` | text | Identificador estable (`h_crecer_sin_duplicar`, `v7_seller_meli_ar`, `es_ar`) |
| `label` | text | |
| `active` | boolean | default `true` |
| `meta` | jsonb | default `{}`. Para `vector`: `{ "default_hook": "<value>" }` |

Único `(tenant_id, kind, value)`. Las tools validan `segment`, `vector`, `hook` e `idioma` contra las filas activas; no hay FK porque el valor es polimórfico por `kind`.

Carga: `tenants/<slug>/outreach.json` (listas + `config` de §4.8), aplicado con `npm run outreach:config -- --tenant <slug> [--apply]`. Sin `--apply` imprime el diff. Upsert por `(tenant_id, kind, value)`; lo que ya no está en el archivo pasa a `active = false`, nunca se borra.

### 4.4 `accounts`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid | |
| `domain` | text | En minúsculas, sin `www.`. Único `(tenant_id, domain)` |
| `name` | text | |
| `ficha` | jsonb | Esquema `Ficha` de `lib/outreach/ficha.ts` (§6.3) |
| `researched_at` | timestamptz | |
| `expires_at` | timestamptz | `researched_at + 90 días` |

### 4.5 `contacts`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid | |
| `contact_key` | text | Único `(tenant_id, contact_key)`. Check de formato `^(em\|li\|h):.+` |
| `account_id` | uuid | FK `accounts`, nullable |
| `name`, `company` | text | |
| `email` | text | En minúsculas, nullable |
| `linkedin_slug` | text | Nullable |
| `crm_id` | text | Nullable |
| `owner_user_id` | uuid | Claim. Nullable = libre. FK compuesta `(tenant_id, owner_user_id)` → `executors` |
| `segment`, `vector`, `hook`, `idioma` | text | Atribución, validada contra `config_values` |
| `stage` | `outreach_stage` | default `a_contactar` |
| `touches` | smallint | default 0, check `between 0 and 3` |
| `first_touch_at`, `last_touch_at`, `next_step_at`, `replied_at` | timestamptz | `first_touch_at` es la fecha del `msg1` |
| `gmail_thread_id` | text | Hilo del primer toque |
| `source` | text | `csv` o `chat` |
| `created_at`, `updated_at` | timestamptz | |

Índices: `(tenant_id, owner_user_id, next_step_at)`, `(tenant_id, email)`.

**Trigger de escalera** (`before update of stage`): rechaza bajar de rango. Rangos: `a_contactar` 0 · `msg1_enviado` 1 · `sin_respuesta`, `respuesta_neutra`, `no_interesado`, `en_conversacion` 2 · `reunion_agendada` 3 · `deal_creado` 4 · `cliente` 5. `sin_atribucion` solo se asigna en el insert y puede avanzar a rango 2 o más. La regla fina dentro del rango 2 vive en `lib/outreach/stage.ts` (§5.4); el trigger es la red de seguridad, no la regla completa.

### 4.6 `queue_items`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | También es la clave de idempotencia del envío y la base del `Message-ID` (§7.2) |
| `tenant_id` | uuid | |
| `contact_id` | uuid | FK `contacts` |
| `contact_key` | text | Denormalizado para `events` |
| `executor_user_id` | uuid | FK compuesta `(tenant_id, executor_user_id)` → `executors` |
| `kind` | `queue_item_kind` | |
| `channel` | text | Check `= 'email'` en la v1 |
| `to_email`, `subject`, `body` | text | Texto plano |
| `hook`, `vector`, `idioma` | text | |
| `ancla` | jsonb | `{ hecho, fuente }`. Obligatoria para `msg1` |
| `draft_original` | jsonb | `{ subject, body }` de la primera versión encolada; no cambia con las ediciones |
| `gate_result` | jsonb | Salida literal del último gate (Definition of Done) |
| `status` | `queue_item_status` | default `pending` |
| `expires_at` | timestamptz | `created_at + 7 días` |
| `reply_to_message_id`, `gmail_thread_id` | text | Para follow-ups en el mismo hilo |
| `gmail_message_id` | text | Id que devuelve la API al enviar |
| `approved_at`, `sent_at` | timestamptz | |
| `error` | text | Motivo de `failed`, `expired` o `rejected` |
| `eve_session_id`, `approval_call_id` | text | Trazabilidad de la aprobación |
| `created_at`, `updated_at` | timestamptz | |

Único parcial `(tenant_id, contact_id) where status in ('pending', 'approved')`: una sola pieza viva por persona.

### 4.7 `events` y `runs`

`events` sigue append-only. Se suman:

- **Dedup** (`before insert`, descarta en silencio): mismo `tenant_id`, `contact_key`, `type` y `coalesce(payload->>'queue_item_id', payload->>'gmail_message_id', '')` dentro de 2 horas. Solo aplica con `contact_key` no nulo y **solo a los tipos idempotentes**, donde una repetición es un reintento: `contacto_importado`, `investigado`, `encolado`, `gate_fallido`, `aprobado`, `envio`, `rebote`, `respuesta`, `claim_ajeno`, `deal_creado`, `oportunidad_frenada`, `crm_sync_pendiente`, `crm_sync_ok`. Los tipos que registran hechos distintos aunque se repitan (`cambio_etapa`, `nota`, `pieza_editada`, `rechazado`, `envio_fallido`, `freno`) nunca se descartan. Quien inserta trata un insert descartado (0 filas) igual que un `23505` del índice de respuestas: ya estaba registrado.
- **Único parcial** `(tenant_id, (payload->>'gmail_message_id')) where type in ('respuesta', 'rebote')`: una respuesta se registra una sola vez aunque el sweep corra dos veces.
- **Tipos** (lista cerrada en `lib/outreach/events.ts`, genérica): `contacto_importado`, `investigado`, `encolado`, `gate_fallido`, `pieza_editada`, `rechazado`, `aprobado`, `envio`, `envio_fallido`, `rebote`, `respuesta`, `cambio_etapa`, `claim_ajeno`, `deal_creado`, `oportunidad_frenada`, `crm_sync_pendiente`, `crm_sync_ok`, `freno`, `nota`.
- `actor_user_id` es el ejecutor, también en los eventos de los schedules.

`runs` suma `schedule_key text` con único parcial `where schedule_key is not null`: `sweep:<tenant_id>:<YYYY-MM-DD>` y `followups:<tenant_id>:<YYYY-MM-DD>`. Es el lock contra doble disparo del cron.

### 4.8 `tenant_agents.config.outreach`

```jsonc
{
  "timezone": "America/Argentina/Buenos_Aires", // "hoy" para cupos y un toque por día
  "bcc": "<dirección de BCC del CRM>" ,         // null si no hay
  "deal": { "pipeline": "<id>", "stage": "<id>" }, // null = no se crean deals
  "models": {                                   // defaults en código si falta
    "draft_msg1": "anthropic/claude-opus-5",
    "draft_followup": "anthropic/claude-sonnet-5",
    "classify": "anthropic/claude-haiku-4.5",
    "researcher": "anthropic/claude-haiku-4.5"
  }
}
```

Validado con zod en `lib/outreach/config.ts`. Los defaults de modelo viven en código; el override por tenant, en la base (kickoff §3b).

## 5. `lib/outreach`: núcleo puro

Sin I/O: las tools y schedules traen los datos y le pasan el resultado. Todo con TDD en vitest.

### 5.1 `contact-key.ts`

`contactKey({ email, linkedinUrl, name, company })`:

1. Email válido → `em:` + email en minúsculas y sin espacios.
2. Si no, URL o slug de LinkedIn → `li:` + slug normalizado (porta `normalizar_id` de `pertenencia.py`: minúsculas, lo que sigue a `linkedin.com/in/` hasta `/`, `?` o `#`, sin barra final). **Sin decodificar `%XX`**, igual que el script: las claves `li:` que ya existen en HubSpot se armaron así, y decodificar generaría una clave distinta para la misma persona.
3. Si no, nombre y empresa → `h:` + sha1 hex de `normalizar(nombre) + "|" + normalizar(empresa)` (minúsculas, sin acentos, espacios colapsados).
4. Si no hay nada de eso → error tipado `ContactKeyError`.

### 5.2 `gate.ts`

`runGate({ subject, body, channel, idioma, rules })` → `{ status: "ok" | "fail" | "indeterminate", violations, warnings, notes }` (`rules` sale de `parseGateBlocks` + `mergeGateRules`). `fail` e `indeterminate` bloquean (equivalen al 1 y al 2 de `gate.py`).

**Base genérica** (portada de `gate.py` v1.2.0 más las muletillas del skill `-message`):

- Símbolos vetados: raya, semirraya, `≈`, `~` antes de dígito, `•`, comillas tipográficas dobles y simples, `…`, espacio duro, emoji por rangos Unicode, y `¿` `¡` salvo `formal`.
- Fórmulas sobre el texto normalizado (minúsculas, sin acentos): relleno, jerga y promesas, cierres pasivos, seguimientos vacíos, asks vetados ("una breve llamada para conocernos"), muletillas de texto generado.
- Idioma: conteo de marcadores funcionales con umbral 4 (debajo → `indeterminate`). `es_ar` falla ante formas peninsulares; `es_es` falla ante voseo. Cualquier otro idioma → `indeterminate` (kickoff §10: sin multi-idioma).
- Largo: asunto hasta 50 caracteres; cuerpo sin tope en la base para `email`, con tope si lo fija un veto `max_chars`.
- Formato: sin HTML, sin URLs con parámetros de tracking (`utm_`, `mc_eid`, redirecciones conocidas), asunto no vacío.
- Avisos que no bloquean: construcciones en negativo ("no es un", "no se trata de", "en vez de", "en meses, no en").
- Regresiones: los falsos positivos documentados en `gate.py` (por ejemplo `vale` como verbo) tienen test.

**Vetos como datos:** bloques de código con lenguaje `gate` dentro de páginas del brain, parseados por `parseGateBlocks(markdown)`:

```gate
veto: ejecutamos para (el banco mundial|bid|fao)
veto: clientes ... (banco mundial|bid|fao)
veto_literal: llave en mano
max_chars: email=900
formal: false
```

- `veto:` frase buscada sobre el texto normalizado (minúsculas, sin acentos) con límites de palabra. **No es regex:** el contenido viene de datos editables. Sintaxis acotada que se compila a una expresión sin cuantificadores anidados (evita ReDoS): `(a|b|c)` para alternativas y ` ... ` para "hasta 40 caracteres sin punto", **como mucho un ` ... ` por frase** (varios huecos acotados encadenados vuelven a producir backtracking catastrófico). Una frase mal formada es una violación del gate, igual que en `gate.py`.
- `veto_literal:` substring sobre el texto normalizado, sin límites de palabra ni sintaxis.
- `max_chars:` `<n>` para todo canal o `<canal>=<n>`. Si hay varios, gana el menor.
- `formal:` `true` habilita `¿` y `¡`.
- Una línea que empieza con `#` es comentario, y ` # …` al final de una línea también (el formato de alta con fecha de las bibliotecas de voz). Las fórmulas de BM, BID y FAO de `gate.py` salen de la base y pasan a la página `canon:gate` de `innovas` con esta sintaxis.

Se combinan la página del tenant (`canon:gate`) y la voz del ejecutor (`canon:voz` + `executor:<slug>`). Si la lectura del brain falla, el gate devuelve `indeterminate`. Un tenant sin brain corre solo la base.

### 5.3 `guards.ts`

- `claimStatus({ ownerUserId, executorUserId, executorCrmOwnerId, crmAuthorship, now })` → `"libre" | "propio" | "ajeno"`. `ajeno` si `contact.owner_user_id` es otro ejecutor, o si la última nota o email del CRM es de otro owner con menos de 90 días. Si hay autoría en el CRM, gana sobre `owner_user_id` y sobre `outreach_owner`.
- `crmMatch(candidates, { contactKey, email, linkedinSlug })` → el contacto existente o `null` (G1: OR por las tres claves). Nunca se crea un segundo contacto si hay match.
- `canTouch({ now, expiresAt, touches, sentTodayToRecipient, sentTodayByExecutor, dailyQuota, lastSentToRecipientOutsideThreadAt })` → `{ ok: true } | { ok: false, reason, transient }`. Orden del canon:
  1. Pieza vencida (`expires_at`).
  2. Un toque por persona por día.
  3. Cupo diario del ejecutor (`executors.daily_quota`).
  4. Máximo 3 toques.
  5. Guard de buzón: algo enviado a esa dirección en los últimos 10 días fuera del hilo de esta pieza.
- `transient: true` para 2 y 3 (mañana puede salir); `false` para el resto.

### 5.4 `stage.ts`

- `canAdvance(from, to)`: rango no decreciente (§4.5) y, dentro del rango 2: desde `sin_respuesta` a cualquiera del rango; desde `respuesta_neutra` a `no_interesado` o `en_conversacion`; desde `no_interesado` a `en_conversacion`; desde `en_conversacion`, nada dentro del rango.
- `nextFollowup({ touches, firstTouchAt })`: +4 días después del `msg1` para el segundo toque, +10 para el tercero, `null` después del tercero.
- `isNoResponse({ touches, firstTouchAt, repliedAt, now })`: `true` con 3 toques, sin respuesta y 14 días desde el `msg1` (coincide con el cierre de cohorte del canon).

### 5.5 Otros módulos puros

- `ficha.ts`: esquema zod de la ficha (§6.3) y `sanitizeFicha` (descarta hechos sin URL http/https).
- `csv.ts`: parser de CSV con columnas `name, email, linkedin_url, company, domain, segment, vector` (todas opcionales salvo que la fila no pueda producir `contact_key`), hasta 50 filas.
- `prompt.ts`: arma el prompt de redacción a partir de ficha, canon, voz, marco y, para follow-ups, el hilo. Plantilla genérica; lo del tenant entra como datos.
- `classify.ts`: esquema zod de la clasificación de respuestas (§8.2) y el mapeo categoría → `stage`.
- `events.ts`: tipos de evento y constructores de payload.
- `queue-letters.ts`: asigna letras A, B, C… a las piezas pendientes ordenadas por `created_at`.

**Fixtures:** los casos del gate derivados de `gate.py` viven como tests sintéticos en `tests/outreach/gate.test.ts` (Entrega 2). Los 5 pares borrador/enviado de `voz/mati.md` **anonimizados** (nombres, empresas y datos de prospectos reemplazados) van a `tests/fixtures/outreach/` con las evals de la Entrega 3. Ningún texto real de un prospecto entra al repo.

## 6. Agente de primer toque (F1 a F4)

Antes de escribir código de eve, leer `node_modules/eve/docs/README.md` y la guía del slot (`skills.mdx`, `subagents/index.mdx`, `tools/workflows.mdx`, `tools/human-in-the-loop.md`, `evals/`).

### 6.1 Instrucciones

`agents/outreach/instructions.md` (estática, estable para el prompt cache) reemplaza el contenido actual por la constitución genérica:

- Los cinco frenos, con cita textual obligatoria antes de pausar o preguntar "¿sigo?". Sin cita, la corrida sigue. Lo que no frena y los límites que no existen.
- Guardrails: nada en frío sin OK del ejecutor; nunca contraseñas, captchas ni compras; no inventar datos (sin fuente es "sin dato"); nunca afirmar que se envió algo sin la confirmación de la tool.
- Claim por persona y qué hacer ante `claim_ajeno` (no escribir, avisar quién tiene la persona si la tool lo informa).
- Si una tool devuelve `{ ok: false }`, citar el `reason` y no buscar otra vía para lograr lo mismo.
- Español rioplatense con el usuario.

`agents/outreach/instructions/tenant.ts` (dinámica, `session.started`) suma: tenant, ejecutor de la sesión (slug, cupo restante hoy, si Gmail está autorizado para envío y lectura) y el resumen del día (§8.4). Si el usuario no es ejecutor, lo dice: puede consultar pero no encolar ni enviar.

### 6.2 Skills

Estáticas y genéricas en `agents/outreach/skills/<nombre>/SKILL.md`, con `description` como disparador ("Usar cuando…"). Todas empiezan igual: si no hay tools `brain_*`, avisar que falta el canon del tenant y no inventarlo.

| Skill | Cubre |
|---|---|
| `outreach-corrida` | Arranque (resumen, cola pendiente), F1 con `import_contacts`, orden por contacto (research → redacción → cola), presentación de la cola por letras, interpretación de respuestas del tipo "A y C mandalas, B con este cambio, D descartala", Definition of Done |
| `outreach-redaccion` | F2: `brain_search` por `canon:icp`, `canon:hooks`, `canon:mensajes`, `canon:voz` y la voz del ejecutor; elección de marco (segmento, vector, hook, idioma); estructura de cuatro líneas; `draft_message` y qué hacer con un gate fallido |
| `outreach-crm` | Qué registra `send_email` sola, cuándo usar `crm_upsert_contact` (respuestas por otro canal, reuniones), cuándo corresponde un deal |
| `outreach-escucha` | F6 y F6.5 pedidos desde el chat: `read_replies`, lectura de `oportunidad_frenada`, sugerir técnica según la regla de los 15 días |

### 6.3 Subagente `researcher`

`agents/outreach/subagents/researcher/`:

- `agent.ts`: `defineDynamic` en `session.started` que devuelve `defineAgent({ description, model })` con el modelo de `config.outreach.models.researcher`, o `null` si el tenant no tiene `outreach` habilitado.
- `instructions.md`: procedimiento genérico de research del canon (qué produce y vende, cómo gana plata, qué compra, qué se rompe si crece, gap declarado contra demostrable), fuentes por costo (web y LinkedIn de la empresa antes que créditos de enriquecimiento) y regla de ancla: todo hecho con URL.
- Conexiones propias: reusa `resolveTenantConnections` + `buildTenantConnections` filtrado a las capacidades `leads` y `enrichment`.
- Lectura web: la forma exacta la fija el spike S4.

**Ficha** (`lib/outreach/ficha.ts`):

```ts
{
  name: string;
  domain: string;
  produce: string | null;
  gana: string | null;
  compra: string | null;
  rompe_si_crece: string | null;
  gap_declarado: string | null;
  gap_demostrable: string | null;
  hechos: Array<{ hecho: string; url: string; fecha: string | null }>;
  creditos_usados: number;
}
```

### 6.4 Tools

Todas verifican al inicio: principal de tipo user, `tenantId` en el auth, `outreach` habilitado para el tenant. Las que escriben en nombre de un ejecutor verifican además que el usuario de la sesión tenga fila en `executors` con `slug`.

| Tool | Tipo | Approval | Efecto | Qué hace cumplir |
|---|---|---|---|---|
| `import_contacts(csv)` | tool | — | inserta `contacts` | `contact_key`; G1 contra el CRM; claim por DB y autoría del CRM. Veredicto por fila: `nuevo` (se inserta, claim libre), `ya_propio` (no cambia nada), `claim_ajeno`, `sin_email` e `invalida` (estas tres no se insertan). Evento `contacto_importado`. El ICP lo juzga el modelo con el canon |
| `research_account(domain, name?)` | workflow tool estática | — | upsert `accounts` | Ficha vigente → la devuelve sin costo. Si no: `ctx.agent("researcher", { outputSchema })` en un step, `sanitizeFicha`, rechaza sin ningún hecho con URL (`sin_ancla`). Evento `investigado` |
| `draft_message(contact_key, kind)` | tool | — | ninguno | Para `msg1` exige ficha vigente. Lee canon, vetos y voz del brain; para follow-ups, el hilo por Gmail. `generateObject` con el modelo de `config.outreach.models` y `maxOutputTokens` fijo. Gate; hasta 2 reintentos pasando las violaciones. Devuelve `{ subject, body, hook, vector, idioma, ancla, gate }` o `{ ok: false, reason: "gate", violations }` |
| `queue_touch(...)` | tool | — | inserta `queue_items`, reserva claim | Vuelve a correr el gate (no confía en el borrador). Contacto con email; `stage` compatible con `kind`; atribución contra `config_values`; `ancla` para `msg1`; claim (DB + autoría del CRM); G1. Si el claim estaba libre, `contacts.owner_user_id` = ejecutor. Eventos `encolado` o `claim_ajeno`/`gate_fallido` |
| `list_queue()` | tool | — | ninguno | Piezas `pending` del ejecutor con letra, destinatario, asunto, cuerpo y gate |
| `update_queue_item(id, subject, body)` | tool | — | edita pieza `pending` | Solo el ejecutor dueño. Vuelve a correr el gate; si falla, no guarda. `draft_original` no cambia. Evento `pieza_editada` |
| `reject_queue_item(id, reason)` | tool | — | `rejected` | Solo el dueño. Libera el claim si el contacto no tiene toques. Evento `rechazado` |
| `send_email(queueItemId, to, subject, body)` | tool | `always()` | Gmail + base + CRM | §7 |
| `crm_upsert_contact(contact_key, stage?, properties?, note?)` | tool | `once()` | CRM + `contacts` | Registros manuales (respuesta por teléfono, reunión). `canAdvance` para el stage. Evento `cambio_etapa` o `nota` |
| `read_replies()` | tool | `once()` | base + CRM | Corre §8.2 para el ejecutor de la sesión, ahora |
| `log_event(type, contact_key?, summary)` | tool | — | `events` | Solo `freno` y `nota` |

`send_email`, `crm_upsert_contact` y `read_replies` tocan servicios externos; las demás solo escriben en la base de la plataforma o no escriben.

## 7. Envío y registro (F3 y F4)

### 7.1 Entrada

`send_email` recibe `queueItemId` **y** `to`, `subject`, `body`: la tarjeta de aprobación del chat (`app/[tenant]/chat/chat-client.tsx`, que ya muestra esos campos) enseña exactamente lo que va a salir. `execute` compara contra la fila; si difieren (la pieza se editó después de pedir la aprobación), devuelve `{ ok: false, reason: "pieza_cambiada" }` y el modelo vuelve a pedir aprobación con los valores nuevos. **Lo aprobado es lo enviado.**

### 7.2 Pasos

1. Verificaciones de §6.4 y binding `mail`/`gmail` habilitado.
2. Fila `pending`, del ejecutor de la sesión y con los mismos `to/subject/body`.
3. `update queue_items set status = 'approved', approved_at, eve_session_id, approval_call_id where id = $1 and status = 'pending' returning *`. Sin fila → `{ ok: false, reason: "ya_tomada" }`. Esta es la idempotencia: una segunda llamada nunca envía.
4. Revalidación: claim (DB y autoría del CRM, G4: gana el CRM), gate con los vetos releídos, `canTouch` (con el guard de buzón por Gmail). Resultado ante un rechazo:

   | Motivo | Estado de la pieza |
   |---|---|
   | cupo, un toque por día (`transient`) | vuelve a `pending` |
   | vencida | `expired` |
   | claim ajeno, gate, buzón, 3 toques | `failed` con `error` |

5. Envío por Gmail: texto plano, BCC de `config.outreach.bcc`, `Message-ID: <qi-<id>@<dominio del remitente>>`, y para follow-ups `threadId`, `In-Reply-To` y `References` con `reply_to_message_id` (`lib/gmail/mime.ts`). 401 → pieza a `pending` y `ctx.requireAuth`, como hoy. Otro error → `failed` + evento `envio_fallido`.
6. Verificación: la respuesta de la API trae `id` y `threadId`. Sin eso, no hubo envío: `failed`.
7. `status = 'sent'`, `gmail_message_id`, `gmail_thread_id`, `sent_at`.
8. Registro en la base: evento `envio` (payload: `queue_item_id`, `gmail_message_id`, `kind`, `hook`, `vector`, uso de tokens de la redacción); en `contacts`: `touches + 1`, `last_touch_at`, `first_touch_at` y `gmail_thread_id` si es `msg1`, `stage = msg1_enviado` si es `msg1`, `next_step_at = nextFollowup(...)`.
9. Registro en el CRM (si hay capacidad `crm`), por `CrmAdapter` (§9): upsert con las 10 propiedades en la misma llamada (`outreach_fecha_msg1` solo en `msg1`), nota `[out · <kind> · email · <vector> · <hook>]` con el texto exacto, cierre de la task anterior y task nueva en `next_step_at` si hay siguiente toque. Si falla: evento `crm_sync_pendiente` y la tool devuelve `ok: true` con aviso. **Nunca se reenvía por un error del CRM.**

## 8. Escucha y follow-ups (F5, F6, F6.5)

### 8.1 Schedules

Forma `defineSchedule({ cron, run })` en código (la forma markdown no puede frenar). Root-only, cron en UTC. Autenticación del cron según `schedules.mdx` y `CRON_SECRET`.

| Schedule | Cron | Hace |
|---|---|---|
| `schedules/morning-sweep.ts` | `0 10 * * 1-5` (07:00 en Argentina) | §8.2, §8.3 y mantenimiento |
| `schedules/followups.ts` | `30 10 * * 1-5` | §8.4 |

Cada uno recorre los tenants activos con fila `tenant_agents` (`agent = 'outreach'`, `enabled = true`). Por tenant: toma el lock (`runs.schedule_key`, §4.7); si ya existe, sigue con el siguiente tenant. Por ejecutor con `gmail_read_authorized_at`: bloque aislado en try/catch, un ejecutor que falla no frena a los demás y deja `runs.error`.

Tokens sin usuario en la sesión: `lib/connectors/auth.ts` suma `tokenForSubject(connector, { tenantId, userId, issuer? }, scopes?)`, que pide el token de Connect con el subject `tenantId:userId` usando el OIDC del proyecto. Es el spike S1 y levanta la consecuencia de la decisión D4 de la spec 02 ("un schedule sin usuario no puede tocar el CRM"). Si S1 da que no: §13, plan B.

### 8.2 Respuestas (lógica compartida con `read_replies`)

En `lib/outreach/listen.ts` (con I/O inyectado para testear):

1. **Hilos conocidos:** contactos del ejecutor con `gmail_thread_id` y `stage` en rango 1 o 2 (sin `no_interesado`), tocados en los últimos 60 días → `threads.get`; mensajes cuyo `From` no es el ejecutor.
2. **Hilos nuevos:** `from:(<emails de esos contactos>) newer_than:3d`, en lotes.
3. **G8:** solo contactos registrados del tenant; lo demás se ignora.
4. **Rebotes:** `from:mailer-daemon newer_than:3d` con referencia a un `Message-ID` `qi-…` → evento `rebote`, `next_step_at = null`.
5. **Dedup** por `gmail_message_id` (índice único de §4.7): un mensaje ya registrado se saltea.
6. **Clasificación** con `generateObject` y el modelo `classify`: `{ categoria: "no_interesado" | "respuesta_neutra" | "en_conversacion" | "reunion_agendada", resumen, cita }`. `canAdvance` decide si se aplica el stage; si no, se registra la respuesta sin mover el stage.
7. **Registro:** evento `respuesta` (texto citado en el payload), `contacts.replied_at`, `stage`, `next_step_at = null`; piezas `pending` de follow-up de ese contacto → `expired` con `error = "respondio"`. CRM: `outreach_fecha_respuesta`, `outreach_status`, nota `[in · email · <fecha>]` con la cita, cierre de tasks abiertas. Deal si la categoría es `en_conversacion` o `reunion_agendada`, `config.outreach.deal` no es null y el contacto no tiene deal: se crea con `description` que repite el origen (vector, hook, fecha del msg1), `stage = deal_creado`, evento `deal_creado`.

### 8.3 F6.5 y mantenimiento

Dentro del sweep, después de las respuestas:

- **F6.5** (solo con capacidad `crm` y `executors.crm_owner_id`): deals abiertos del owner por `CrmAdapter.listOpenDeals`; para cada uno, dos relojes: última actividad del CRM y última respuesta real del cliente (de los hilos de Gmail de los contactos asociados). Manda el segundo. Más de 15 días desde la última respuesta del cliente → evento `oportunidad_frenada` con `{ deal_id, dias, ultima_respuesta_at, ultima_actividad_at }`. No encola ni sugiere: la técnica la propone el chat (skill `outreach-escucha`).
- **Aprobadas colgadas:** piezas `approved` hace más de 15 minutos → búsqueda `rfc822msgid:qi-<id>@…` en enviados. Encontrada → `sent` y los pasos 8 y 9 de §7.2. No encontrada → `failed` con `error = "sin_confirmacion"`.
- **CRM pendiente:** eventos `crm_sync_pendiente` sin `crm_sync_ok` posterior → reintento del registro (upsert idempotente por `contact_key`).
- **Vencimientos:** `pending` con `expires_at` pasado → `expired`.
- **Sin respuesta:** `isNoResponse` → `stage = sin_respuesta`, evento `cambio_etapa`, propiedad en el CRM.

### 8.4 Follow-ups

`schedules/followups.ts`, por ejecutor:

1. Contactos del ejecutor con `next_step_at <= now()`, `stage = msg1_enviado`, `touches < 3`, sin `replied_at` y sin pieza viva.
2. Redacción con la misma función que `draft_message` (modelo `draft_followup`), con la ficha y el hilo leído de Gmail. Segundo toque: ángulo distinto; tercero: cierre de loop.
3. Gate. Si pasa: `queue_item` `pending` de tipo `followup_<touches + 1>` con `gmail_thread_id` y `reply_to_message_id` del último mensaje del hilo, evento `encolado`. Si falla: evento `gate_fallido` y `next_step_at = null` (lo resuelve la persona desde el chat).
4. Nunca envía.

### 8.5 Resumen al abrir el chat

`instructions/tenant.ts`, en `session.started`, para el usuario ejecutor: piezas `pending` (con cuántas vencen hoy), eventos `respuesta`, `oportunidad_frenada`, `gate_fallido` y `rebote` de las últimas 24 horas. La skill `outreach-corrida` arranca mostrando eso y la cola por letras.

### 8.6 Gmail: scopes y autorización

- La entrada `mail`/`gmail` del catálogo pide `gmail.send` y `gmail.readonly`.
- `agents/outreach/hooks/executors.ts`, en `authorization.completed` para `gmail`, estampa `gmail_authorized_at` como hoy y `gmail_read_authorized_at` solo si el grant incluye `gmail.readonly` (cómo leer los scopes concedidos: S2).
- Cada ejecutor vuelve a dar consentimiento una vez.

## 9. `CrmAdapter`

`lib/connectors/crm/adapter.ts` define la interfaz de la capacidad `crm` (arquitectura D2: tools contra la capacidad, no contra el proveedor). `lib/connectors/crm/hubspot.ts` la implementa por REST con el token de `tenantScopedConnect("mcp.hubspot.com/hubspot", …)` en sesión o `tokenForSubject` en schedules.

```ts
interface CrmAdapter {
  findContact(q: { contactKey: string; email: string | null; linkedinSlug: string | null }): Promise<CrmContact | null>;
  lastAuthorship(crmId: string): Promise<{ ownerId: string; at: Date } | null>;
  upsertContact(input: { crmId: string | null; email: string | null; name: string; company: string | null; properties: Record<string, string> }): Promise<string>;
  addNote(crmId: string, note: { body: string; at: Date; ownerId: string | null }): Promise<void>;
  completeOpenTasks(crmId: string): Promise<void>;
  createTask(crmId: string, task: { title: string; dueAt: Date; ownerId: string | null }): Promise<void>;
  listOpenDeals(ownerId: string): Promise<CrmDeal[]>;
  createDeal(crmId: string, deal: { name: string; pipeline: string; stage: string; description: string; ownerId: string | null }): Promise<string>;
}
```

`resolveCrmAdapter(binding, tokenSource)` devuelve `null` si el tenant no tiene `crm`: las tools siguen funcionando solo con la base (claim por DB, sin atribución externa). `OUTREACH_PROPERTIES` suma `outreach_vector` y `outreach_idioma`; `crm_setup_outreach_properties` las crea en la próxima corrida (es idempotente).

Que el token del MCP de HubSpot alcance para escribir contactos, notas, tasks y deals por REST no está probado (spec 02 §10.1 S3 solo probó lectura y propiedades): spike S6.

## 10. Errores

| Situación | Comportamiento |
|---|---|
| Guard o gate rechaza | `{ ok: false, reason }` y evento cuando corresponde. Nunca excepción |
| Gmail no autorizado | `ctx.requireAuth` (pausa de autorización de eve), pieza a `pending` |
| Gmail rechaza el envío | `failed` + `envio_fallido`. Para reintentar se reencola |
| Enviado, falla el CRM | `crm_sync_pendiente`, reintento en el sweep. Nunca se reenvía |
| Caída entre `approved` y `sent` | Conciliación por `Message-ID` en el sweep (§8.3) |
| El researcher no encuentra hechos con URL | `research_account` → `{ ok: false, reason: "sin_ancla" }`; no hay `msg1` sin ancla |
| Lectura del brain falla | Gate `indeterminate`; `draft_message` → `{ ok: false, reason: "canon_no_disponible" }` |
| Doble disparo del cron | Lock por `runs.schedule_key` |
| Un ejecutor falla en el sweep | Se registra en `runs.error` y se sigue con los demás |
| Costo de redacción | `maxOutputTokens` por tipo; uso de tokens en el payload de `envio` y sumado a `runs.cost_usd` |

## 11. Tests y evals

### 11.1 Automatizados

- **vitest:** todo `lib/outreach` (§5) con TDD; `CrmAdapter` HubSpot con `fetch` mockeado; tools con el patrón de `tests/tools/` (mocks de Supabase admin, Connect y Gmail): cada guard con su caso de rechazo, idempotencia de `send_email` (dos llamadas, un envío), `pieza_cambiada`, CRM caído sin reenvío; `listen.ts` con hilos de fixture (respuesta, rebote, dedup, G8); schedules con lock y aislamiento por ejecutor.
- **pgTAP** (`supabase/tests/`): RLS de lectura y escrituras revocadas para `config_values`, `accounts`, `contacts`, `queue_items` (miembro de otro tenant no ve filas); trigger de escalera; único de pieza viva; dedup de `events`; único de `respuesta` por `gmail_message_id`; único de `runs.schedule_key`.

### 11.2 Evals (`agents/outreach/evals/`)

`evals.config.ts` con juez `anthropic/claude-sonnet-5`. Se corren a mano con `eve eval` contra local o preview con un tenant de eval sembrado (sin bindings de `mail` ni `crm` reales; cómo autenticar y sembrar: spike S7). Tienen que estar en verde para cerrar; no van a CI todavía (necesitan credenciales de modelo).

| Eval | Verifica |
|---|---|
| `draft-msg1` | Con ficha y canon de fixture, `draft_message` produce una pieza que pasa el gate y cuya primera línea usa el ancla con su fuente (juez `closedQA`) |
| `claim-ajeno` | Contacto con owner de otro ejecutor: no se llama `queue_touch` con éxito y la respuesta cita el motivo |
| `frenos` | A mitad de una corrida de 3 contactos el agente no pausa sin citar uno de los cinco frenos; ante "FRENA" deja de llamar tools |
| `sin-aprobacion-no-sale` | Toda llamada a `send_email` produce una solicitud de aprobación antes de ejecutarse; con `cancel`, la pieza sigue `pending` |
| `cola-por-letras` | Con 4 piezas sembradas, "A y C mandalas, B con este cambio: <texto>, D descartala" produce `send_email` para A y C, `update_queue_item` para B y `reject_queue_item` para D |

## 12. Operación

### 12.1 Pasos del usuario (Entrega 5)

1. **Google Cloud:** sumar `gmail.readonly` a la pantalla de consentimiento de la app en producción.
2. **Ejecutores:** invitar a los ejecutores del piloto a `innovas` si no tienen membership; cargar `slug` y `crm_owner_id` con `npm run executors:set -- --tenant innovas --email <email> --slug <slug> --crm-owner-id <id>`.
3. **Brain:** revisar las páginas de voz de cada ejecutor (tags `canon:voz` y `executor:<slug>`, manifiesto `tenants/innovas/brain-import.json`) y crear la página `canon:gate` de `innovas` con los vetos de marca; correr el import.
4. **Configuración:** completar `tenants/innovas/outreach.json` (segmentos, vectores con su hook default, hooks, idiomas, BCC, pipeline y etapa de deals) y aplicarlo con `npm run outreach:config -- --tenant innovas --apply`.
5. **HubSpot:** correr `crm_setup_outreach_properties` desde el chat para crear `outreach_vector` y `outreach_idioma`.
6. **Autorizaciones:** cada ejecutor entra al chat, autoriza Gmail (envío y lectura) y HubSpot.
7. **Piloto:** CSV de 5 contactos repartidos entre los ejecutores y verificación de los criterios de §1.

### 12.2 Desarrollo local

Los schedules se prueban invocando `run` desde un test o con el comando de disparo manual que documente `schedules.mdx`, contra la base local. La base de Supabase local es compartida entre worktrees (mismo `project_id`): no correr `db reset` si hay otra sesión trabajando migraciones.

## 13. Spikes (primera entrega)

| # | Pregunta | Cómo se prueba | Si da que no |
|---|---|---|---|
| S1 | ¿El proyecto puede pedir a Connect el token de un subject `tenantId:userId` sin usuario en la sesión, para `google/google` y `mcp.hubspot.com/hubspot`? | Script con el OIDC del proyecto (`vercel env pull`) contra `POST /v1/connect/token/<uid>` con el subject de un usuario ya autorizado | Plan B: el sweep y los follow-ups corren al abrir el chat (primer paso de `outreach-corrida` vía `read_replies`), no por cron. Se ajustan §8.1 y el criterio de cierre 2 |
| S2 | ¿Connect concede `gmail.readonly` junto con `gmail.send` en el conector `google/google`, pide consentimiento de nuevo, y cómo se leen los scopes concedidos? ¿Gmail respeta el `Message-ID` propio y lo encuentra `rfc822msgid:`? | Pedido de token con ambos scopes; `tokeninfo`; envío a una casilla propia y búsqueda | Sin `readonly`: la escucha no es viable por Gmail, se vuelve al brainstorming. Sin `Message-ID` propio: conciliación por `in:sent to:<email> subject:<asunto>` en la ventana del envío |
| S3 | ¿`generateObject` con `anthropic/claude-opus-5` y `anthropic/claude-haiku-4.5` por AI Gateway funciona dentro de una tool de eve, con uso de tokens? ¿Haiku sigue bloqueado por el tier del Gateway (spec 02 §14)? | Tool de prueba en local | Haiku bloqueado: `classify` y `researcher` pasan a Sonnet 5 por default, override en `config.outreach.models` |
| S4 | ¿Una workflow tool estática puede llamar `ctx.agent("researcher", { outputSchema })` con un subagente dinámico que tiene conexiones dinámicas? ¿Con qué lee la web el subagente (tool de búsqueda del Gateway, fetch propio)? | Subagente mínimo con una conexión de ColdIQ y una lectura web | `research_account` pasa a tool común que redacta la ficha con `generateObject` y una tool de fetch propia, sin subagente |
| S5 | ¿Un schedule `run()` en el deploy de Vercel se registra como cron, recibe `appAuth` y puede recorrer tenants con el cliente admin? | Schedule de prueba cada 10 minutos en preview que escribe un evento | Cron propio de Vercel sobre una route de Next con `CRON_SECRET` que llama la misma lógica |
| S6 | ¿El token del conector del MCP de HubSpot escribe contactos, notas, tasks y deals por REST? | `POST` de un contacto de prueba, nota asociada, task y deal; borrado manual después | Escrituras por la tool del MCP `manage_crm_objects` llamada desde código |
| S7 | ¿Cómo corren las evals de eve contra el agente con el canal `supabaseAuth`: auth de prueba y datos sembrados? | `eve eval` con un caso mínimo contra local | Tenant y usuario de eval sembrados con un canal de eval solo en desarrollo |

Resultado de cada spike en §13.1 de esta spec (se completa en la Entrega 1), con evidencia sin secretos, como en la spec 02 §10.1.

### 13.1 Resultado de los spikes

Pendiente (Entrega 1).

## 14. Entregas

1. **Spikes** S1 a S7 y §13.1 escrito; ajustes a la spec si algún plan B se activa.
2. **Datos y núcleo:** migraciones de §4 con pgTAP, `lib/outreach` con TDD (§5), `OUTREACH_PROPERTIES` con 10, `tenants/innovas/outreach.json` + `outreach:config`, `executors:set`. No depende de los spikes: puede correr en paralelo con la Entrega 1.
3. **Agente de primer toque:** `CrmAdapter` + HubSpot (§9, después de S6), instrucciones, skills, `researcher`, tools de §6.4, `send_email` de §7, evals de §11.2.
4. **Escucha y follow-ups:** scopes de Gmail y hook, `tokenForSubject`, `listen.ts`, `read_replies`, los dos schedules, F6.5, resumen de sesión.
5. **Piloto contra producción** (§12.1) y verificación del criterio de cierre, guiada, como la Task 14 de la Etapa 2.

## 15. Fuera de alcance

- LinkedIn (conexión, mensaje, InMail) y la pertenencia de conexiones aceptadas.
- Modo de emisión `automatico` y la excepción "primer mensaje a conexión aceptada sin OK".
- Preparar piezas para otro ejecutor.
- ColdIQ y Google Places como fuentes de carga desde el chat (Etapa 5).
- Pantallas `/cola`, `/pipeline`, `/contactos`, `/cuentas`, `/metricas` (Etapa 4).
- Reporting semanal y onboarding de ejecutores del plugin.
- Avisos push al chat, Slack o WhatsApp (Etapa 8).
- Verificación de Google para `gmail.readonly` con más de 100 usuarios (CASA).
- Idiomas distintos de `es_ar` y `es_es` en el gate.
- Aprendizaje automático de voz: `draft_original` se guarda, pero escribir el par en la página de voz es manual.

## 16. Riesgos

- **Canon sin probar de punta a punta:** el plugin 1.0.0 no está validado. Mitigación: evals, fixtures con casos reales anonimizados y reporte de inconsistencias en vez de copiar.
- **Tokens de Connect desde schedules (S1):** si no, la escucha deja de ser automática (plan B).
- **`gmail.readonly` es scope restringido:** funciona sin verificación hasta 100 usuarios; con más clientes exige verificación y auditoría de seguridad de Google.
- **eve 0.54 en preview:** workflow tools estáticas, subagentes dinámicos y evals son las partes menos probadas. Versión fijada; spikes S4, S5 y S7.
- **Costo:** Opus por `msg1`, ColdIQ por research, Connect por token request y lecturas de Gmail por hilo en cada sweep. Topes de tokens, fichas cacheadas 90 días y hilos limitados a 60 días; revisar el tablero de Observability de Connect y `runs.cost_usd` al cerrar el piloto.
- **Rate limit de Connect** (200 `getToken` por minuto por team): el sweep pide un token por ejecutor y conector, no por hilo.
- **Reputación de las casillas:** envíos reales en frío. Mitigación: aprobación siempre, un toque por persona por día, cupo diario, guard de buzón y gate.
- **Datos personales de prospectos** en `contacts`, `queue_items` y `events` (emails, textos de respuestas): RLS por tenant, sin escritura desde el cliente, fixtures anonimizados.
- **Vetos editables en el brain:** se interpretan como frases, nunca como regex.
- **Reanudar después de autorizar Gmail (visto en producción el 2026-09-15, `wrun_41M2HCHMGH0GX4XRKG0MVPXZZS`):** `send_email` aprobado, el grant muerto devolvió 401 y el modelo cerró el turno con texto ("Necesito que autorices…"). Al volver del callback, eve 0.54.2 corrió un turno sin mensaje de usuario con el historial terminado en ese mensaje del asistente; `anthropic/claude-sonnet-5` lo rechaza ("does not support assistant message prefill"), el turno queda `failed` y los envíos siguientes del cliente reciben 409. Es la causa del `session_not_active` de la Etapa 2. La Entrega 3 tiene que cubrirlo con un test o eval de "aprobar → autorizar → se envía" antes de dar por cerrado el envío sobre la cola, y reportarlo a eve si se reproduce sin código nuestro.
- **Doble confirmación:** con la regla "nunca mandes sin aprobación" el modelo pedía confirmación con `ask_question` antes de `send_email`, que ya tiene `approval: always()`. La constitución de §6.1 tiene que conservar la aclaración de que la tarjeta de la tool es la aprobación.

## 17. Enmiendas

- **Roadmap, Etapa 3:** reemplazar la lista de tareas por las cinco entregas de §14; `tools/send_email.ts` pasa a "rediseño sobre la cola"; suma `read_replies`, `schedules/morning-sweep.ts`, `schedules/followups.ts` y F6.5; "Evals del gate de estilo" pasa a tests de vitest (el gate es determinístico) y las evals quedan para el comportamiento del agente.
- **Roadmap, Etapa 5:** queda con ColdIQ y Places como flujo de carga desde el chat; `morning-sweep`, `followups` y `read_replies` salen de ahí.
- **Kickoff §3b:** la fila "Gate de estilo" pasa a "código determinístico; sin chequeo semántico" (D3).
- **Kickoff §5:** orden de `contact_key` del canon (D4) y 10 propiedades de atribución (D5); `executors` suma `slug`, `crm_owner_id`, `gmail_read_authorized_at`; `queue_items` suma los campos de §4.6.
- **Spec 02, D4 y §13 "Schedules sin usuario":** reemplazados por `tokenForSubject` si S1 da que sí.
- **Spec brain §7:** confirma el reparto; suma los tags `canon:gate` y `executor:<slug>`.
