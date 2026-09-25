---
description: Usar cuando el ejecutor pide armar o seguir una corrida de outreach por email, cargar contactos, ver o resolver la cola.
---

# Corrida de outreach

Si no tenés herramientas `brain_*`, avisá que falta el canon del cliente y no redactes.

## Arranque

1. Si el resumen de la sesión dice que hay piezas pendientes o trabadas, mostrá la cola con `list_queue` antes de cargar nada nuevo.
2. Preguntá solo lo que falte para arrancar: la lista de contactos (CSV) y el objetivo de la corrida (cuántas piezas, qué vector).

## Por contacto, sin pedir OK entre pasos

1. `import_contacts` con el CSV. Salteá `claim_ajeno`, `sin_email` e `invalida`, y contá cuántas quedaron.
2. Juzgá si cada contacto nuevo calza con el ICP (`brain_search` con tag `canon:icp`). Si no calza, salteálo y decí por qué en una línea.
3. `research_account` con el dominio de la empresa. Sin hechos con fuente no hay primer mensaje: salteá la cuenta.
4. `draft_message` con `kind: "msg1"`.
5. `queue_touch` con la pieza tal cual la devolvió `draft_message`.

## Mostrar la cola por letras

`list_queue` dibuja una tarjeta por pieza con el mail tal cual sale, firma incluida. No repitas el cuerpo ni el asunto en tu texto: alcanza con nombrar las letras y preguntar qué hacer, por ejemplo: "Tenés A, B y C listas. A y C mandalas, B con este cambio, D descartala".

Interpretá la respuesta así:
- "mandala" o "mandá A" → `send_email` con el `queueItemId` y exactamente el to, subject y body de esa letra. Si hay varias, una llamada por pieza.
- "B con este cambio: …" → `update_queue_item` con el texto nuevo; después volvé a llamar a `list_queue` para que la tarjeta muestre la pieza editada, y esperá el OK.
- "descartala" → `reject_queue_item` con el motivo.
- "mandá todo" vale solo si ya mostraste todas las piezas.

## Piezas trabadas

Una pieza con `trabada: true` quedó entre la aprobación y el envío: no se edita, no se rechaza y no se reenvía. Revisá en Gmail si el mail salió y avisale al ejecutor.

## Definition of Done de un envío

Un envío está hecho cuando `send_email` devolvió `ok: true`. Si devolvió `crm: "pendiente"`, avisá que el registro en el CRM quedó para reintentar. Nunca digas que se envió sin ese resultado.
