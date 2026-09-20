---
description: Usar cuando el ejecutor pide revisar las respuestas de la escucha, clasificar lo que contestaron los contactos, o pregunta qué dijeron los que respondieron.
---

# Escucha: clasificar respuestas

`read_replies` trae, tal cual quedaron guardadas, las respuestas de contactos que todavía están en `respuesta_neutra`: la escucha las detectó pero nadie las clasificó. El texto viene sin interpretar — la clasificación la hacés vos, acá.

## Por cada respuesta

Leé el texto completo (no una parte) y decidí en cuál de estas cuatro categorías entra:

| Categoría | Ejemplos | Acción |
|---|---|---|
| Interés o pedido de más info | "contame más", "mandame precios", "sí, me interesa" | `crm_upsert_contact` con `stage: "en_conversacion"` |
| Reunión concreta | propone día/hora, pide agendar una llamada | `crm_upsert_contact` con `stage: "reunion_agendada"` |
| Baja explícita | "no nos interesa", "no contactar más", "bajame de la lista" | `crm_upsert_contact` con `stage: "no_interesado"` |
| Ambiguo, fuera de oficina, "escribime más adelante" | vacaciones, "ahora no puedo", una respuesta que no dice ni sí ni no | Ninguna: se queda en `respuesta_neutra` |

En `crm_upsert_contact` mandá el `contactKey` tal cual lo devolvió `read_replies` y una `note` con el texto de la respuesta citado, no resumido. Un deal en el CRM nace solo cuando pasa a `en_conversacion` o `reunion_agendada`: `crm_upsert_contact` ya lo crea, no hay que pedirlo aparte.

## Ante la duda, no se avanza

Si no estás seguro de en cuál de las cuatro entra, tratala como ambigua y no llames a `crm_upsert_contact`. Quedarse en `respuesta_neutra` es la opción segura: la escalera de etapas nunca retrocede, así que avanzar de más a `en_conversacion` o a `no_interesado` por una lectura apurada no se puede deshacer después. Es preferible mostrarle la respuesta al ejecutor y que decida él antes que clasificar mal.

## Lo que este flujo no hace

`read_replies` no distingue una respuesta real de una auto-respuesta (fuera de oficina, autoreply) que todavía no avanzó de etapa: las dos pueden aparecer en la lista. Si el texto es claramente un auto-reply ("estoy fuera de la oficina hasta el…"), tratalo como ambiguo — no hay acción, sigue en `respuesta_neutra`.
