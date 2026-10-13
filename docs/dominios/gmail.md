---
title: Gmail
category: dominios
status: activo
tags: [gmail, mail, mime, firma, scopes, vercel-connect]
updated: 2026-10-13
sources:
  - lib/gmail/send.ts
  - lib/gmail/mime.ts
  - lib/gmail/read.ts
  - lib/gmail/signature.ts
  - lib/connectors/executors.ts
  - lib/connectors/auth.ts
  - lib/outreach/services/send.ts
  - lib/outreach/services/replies.ts
  - lib/outreach/config.ts
  - agents/outreach/tools/send_email.ts
  - agents/outreach/tools/read_replies.ts
  - agents/outreach/hooks/executors.ts
  - supabase/migrations/20260911234604_google_tokens.sql
  - supabase/migrations/20260914010856_drop_google_tokens.sql
  - docs/superpowers/specs/00-bootstrap.md
  - docs/superpowers/specs/02-conexiones-innovas.md
---

# Gmail

## 1. Qué es y para qué

Gmail es la casilla desde la que el agente de outreach manda y lee mail **a nombre de una persona** (el ejecutor), no de la plataforma. Enviar es siempre una acción con aprobación humana en el chat; leer lo hacen los procesos programados que escuchan las respuestas y los follow-ups. Para el catálogo de conectores Gmail es el proveedor `gmail` de la capacidad `mail`: no es una conexión de eve sino una tool propia, porque Gmail no tiene un MCP ni un OpenAPI utilizable (ver [conectores](conectores.md)).

El token de Gmail no pasa por nuestra base: se pide a Vercel Connect en cada uso, con un grant por persona atado a `tenantId:userId`. Esto no fue siempre así, ver "Decisiones".

## 2. Dónde vive en el código

| Archivo | Qué hace |
|---|---|
| `lib/gmail/send.ts` | `sendMail` contra la API de Gmail, `GMAIL_SCOPES`, `GmailUnauthorizedError`, `GmailUnknownOutcomeError` |
| `lib/gmail/mime.ts` | `buildRawMessage`: arma el mensaje RFC 822 en base64url |
| `lib/gmail/read.ts` | `fetchThread` y `findByRfc822Id`: lectura de hilos, rebotes y respuestas automáticas |
| `lib/gmail/signature.ts` | `composeMail`, `signatureBlock`, `mailText`: firma del ejecutor |
| `agents/outreach/tools/send_email.ts` | La tool `send_email` |
| `agents/outreach/tools/read_replies.ts` | La tool `read_replies` |
| `agents/outreach/hooks/executors.ts` | Hook `authorization.completed`: estampa la autorización en `executors` |
| `lib/connectors/executors.ts` | `markGmailAuthorized` |
| `lib/outreach/services/send.ts` | `sendQueuedEmail`: el servicio de envío (estados de la pieza, guardas) |

## 3. Cómo funciona

### Enviar: `send_email`

La tool recibe `queueItemId`, `to`, `subject` y `body` tal cual los devolvió `list_queue`. Tiene `approval: always()`: la tarjeta de aprobación del chat **es** la confirmación. Antes de nada comprueba que el tenant tenga un binding `mail/gmail` habilitado (`hasEnabledBinding`); si no, responde `sin_gmail`. Pide el token a Connect con `tenantScopedConnect(GOOGLE_CONNECTOR_UID, tenantId, [...GMAIL_SCOPES])` y delega en `sendQueuedEmail`. Un 401 de Gmail (`GmailUnauthorizedError`) devuelve la pieza a pendiente y pide autorizar de nuevo en el chat.

`sendMail` hace un `POST` a `users/me/messages/send` con timeout de 30 s. Distingue tres desenlaces:

- **Salió**: 2xx con `id` y `threadId`.
- **No salió**: cualquier otro estado. Un error de MIME (header inválido) sube tal cual, antes de tocar la red.
- **No se sabe**: sin respuesta (red, abort, timeout), o un 2xx cuyo cuerpo no se puede leer o no trae el id (`GmailUnknownOutcomeError`). La pieza queda `approved` (trabada) con el motivo `envio_incierto`, para que nadie mande un segundo mail al mismo contacto sin mirar antes si el primero salió.

### MIME

`buildRawMessage` arma `To`, `Bcc` (si hay), `Subject`, `Message-ID`, `In-Reply-To`, `References` y `MIME-Version`. Reglas: el asunto no ASCII va codificado (`=?UTF-8?B?...?=`); **ningún header puede contener un salto de línea** (inyección de `Bcc`/`To`), y el asunto se valida crudo antes de codificar; el cuerpo va en base64. Sin HTML sale un `text/plain`; con HTML, `multipart/alternative` con el texto plano como primera parte. Un follow-up con hilo guardado manda `threadId`, `In-Reply-To` y `References` para caer dentro de la conversación; el `Message-ID` propio es `<qi-<id de la pieza>@<dominio del ejecutor>>`, aunque Gmail lo reescribe, por eso el de respuesta se lee de Gmail y no se inventa.

### Firma del ejecutor

`composeMail(body, signer, company)` arma el mail final: el cuerpo aprobado más un bloque de firma (`--` y nombre, puesto, empresa y URL, LinkedIn). La firma sale de los datos del ejecutor en `executors` (`display_name`, `title`, `linkedin_url`, que carga el administrador en `/[tenant]/settings`) y de la empresa que firma, de la config de outreach del tenant. **Sin `display_name` no hay firma**: sale el texto plano de siempre, `html: null`. El HTML de la firma no usa imágenes (un logo remoto se cae en varios clientes). Desde [#50](https://github.com/innovasbuild/agents/pull/50) el chat muestra el mail tal cual sale, con firma (`MailPreview`, que usa `signatureBlock`), para que quien aprueba vea lo mismo que se envía.

### BCC

El envío pasa `bcc: tenant.config.bcc`: un correo opcional de la configuración de outreach de la empresa (`outreachConfigSchema`, editable en `/[tenant]/settings/outreach`, sección Datos de outreach). El código **no conoce HubSpot ni ninguna dirección fija**; si una empresa quiere copiar cada envío a su CRM, es un valor de su configuración.

### Leer: hilos y respuestas

`fetchThread(token, threadId, ourEmail)` baja el hilo completo y devuelve por mensaje: remitente, fecha, `Message-ID`, cuerpo en texto plano, `isFromUs` (compara la dirección exacta, no un substring), `isBounce` (remitente `mailer-daemon@`/`postmaster@` o parte `message/delivery-status`) e `isAutoReply` (`Auto-Submitted` distinto de `no`, o `X-Autoreply`). `findByRfc822Id` busca un mensaje por `rfc822msgid:`, lo que usa la reconciliación de envíos inciertos. Los dos tienen el mismo timeout y la misma regla del 401. Los consumen el barrido (`lib/outreach/services/sweep.ts`) y los schedules `morning-sweep` y `followups` del agente, que piden el token sin sesión con `tokenForSubject` (ver [outreach](outreach.md)). Un ejecutor cuyo grant falla cae en los ejecutores fallidos del barrido, visible, en vez de saltearse en silencio.

`read_replies` **no lee Gmail**: devuelve, sin interpretar, las respuestas de contactos que ya quedaron guardadas en `respuesta_neutra` (el barrido las guardó antes), para que el modelo las clasifique con la skill de escucha. No tiene aprobación porque solo lee.

### Scopes y por qué hay uno solo

Todo pedido de token de Gmail usa `GMAIL_SCOPES = [gmail.send, gmail.readonly]`, definido una vez en `lib/gmail/send.ts`. **Connect matchea el grant por el conjunto exacto de scopes, no por subconjunto**: cuando se sumó la lectura, `send_email` siguió pidiendo solo `gmail.send`, no encontró grant y el envío de producción quedó caído ([#20](https://github.com/innovasbuild/agents/pull/20)). Por eso `send_email`, Mis cuentas y los schedules piden la misma lista; hay un test que lo afirma. Costo asumido: enviar pide también permiso de lectura.

El hook `authorization.completed` (`authKey` `gmail`) llama a `markGmailAuthorized`, que estampa a la vez `executors.gmail_authorized_at` y `gmail_read_authorized_at`: el evento no trae los scopes concedidos y el conjunto único garantiza ambos. Ejecutores que autorizaron antes de sumar la lectura quedan estampados aunque su grant real no la tenga; no hay migración que adivine quién tiene qué. Arrancar una autorización nueva deja sin servir el grant vigente hasta que se complete el consentimiento, y por eso ninguna pantalla la arranca sola (ver Mis cuentas en [conectores](conectores.md)).

### `google_tokens` y por qué el token sale de Connect

En el bootstrap el refresh token de Google se guardaba en la tabla `google_tokens` (solo `service_role`), porque el login con Google de Supabase pedía los scopes de Gmail y un solo client cubría login y envío. La Etapa 2 lo migró: la tabla se eliminó con la migración `20260914010856_drop_google_tokens.sql` y el scope de Gmail salió del login ([#3](https://github.com/innovasbuild/agents/pull/3)). Hoy `lib/gmail/send.ts` no toca la base; el refresh token nunca llega a nuestros sistemas y la tabla `google_tokens` ya no existe (solo queda en las migraciones históricas).

## 4. Cómo se prueba

```bash
npm test -- tests/gmail tests/tools/send-email.test.ts tests/hooks/executors.test.ts tests/outreach/services/send.test.ts
```

`tests/gmail/mime.test.ts` (headers, multipart, codificación), `send.test.ts` (los tres desenlaces, el timeout, el hilo), `read.test.ts`, `signature.test.ts` (el bloque es idéntico al que manda `composeMail`) y, en `send-email.test.ts`, que el pedido de token lleva los dos scopes. La tabla eliminada la cubre `supabase/tests/07_google_tokens_dropped.test.sql` (`npm run db:test`). El envío real contra Gmail solo se verifica a mano en producción.

## 5. Decisiones

- Specs: [00-bootstrap](../superpowers/specs/00-bootstrap.md) (token de Supabase Auth y `google_tokens`, decisión D1 que la Etapa 2 revirtió), [02-conexiones-innovas](../superpowers/specs/02-conexiones-innovas.md) (Gmail por Connect, §7).
- [#3](https://github.com/innovasbuild/agents/pull/3): `send_email` por Connect, hook de autorización, baja de `google_tokens`.
- [#20](https://github.com/innovasbuild/agents/pull/20): un único conjunto de scopes (el envío de producción quedó sin token).
- [#48](https://github.com/innovasbuild/agents/pull/48): firma del ejecutor.
- [#50](https://github.com/innovasbuild/agents/pull/50): el chat muestra el mail con firma.
- La spec 00 dice que el token sale de Supabase Auth y que `google_tokens` guarda el refresh token: quedó atrás desde #3.
- El cuerpo de #20 llama "Entrega 4" a la escucha; hoy esa lectura vive en el barrido y los schedules, no en una entrega aparte.
