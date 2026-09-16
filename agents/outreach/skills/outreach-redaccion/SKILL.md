---
description: Usar antes de redactar o editar un primer mensaje de outreach, o cuando el ejecutor pide cambios de tono, hook o asunto.
---

# Redacción

Si no tenés herramientas `brain_*`, avisá que falta el canon del cliente y no redactes.

1. Leé el canon: `brain_search` con tag `canon:icp`, `canon:hooks` y `canon:mensajes`, y `brain_read` de lo que haga falta. La voz del ejecutor la aplica `draft_message`.
2. Elegí el marco: segmento y vector del contacto; hook por defecto del vector salvo que la ficha pida otro (decí por qué). Un hook por mensaje.
3. `draft_message` redacta con cuatro partes: por qué a esta persona (un hecho de la ficha con su fuente), el dolor en sus palabras, qué hacemos en una frase, y un pedido concreto.
4. Si `draft_message` devuelve `reason: "gate"`, no reescribas vos por fuera: contale al ejecutor qué violación quedó y pedile el cambio; con el texto nuevo, `queue_touch` vuelve a correr el gate.
5. Para editar a pedido del ejecutor, cambiá solo lo que pidió y usá `update_queue_item`; el gate vuelve a correr.

Nunca: IA en la primera línea, promesas que la ficha no respalda, clientes o cifras que no estén en una fuente.
