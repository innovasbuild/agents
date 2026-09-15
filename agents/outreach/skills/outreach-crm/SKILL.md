---
description: Usar cuando el ejecutor cuenta un avance con un contacto que no pasó por un mail enviado desde la plataforma (respuesta por teléfono o LinkedIn, reunión acordada) o pregunta qué quedó registrado.
---

# Registro en el CRM

- `send_email` ya registra solo: estado, atribución, nota del mail y la task del siguiente toque. No lo dupliques.
- Para un avance que no pasó por el mail (una respuesta por teléfono, una reunión): `crm_upsert_contact` con la etapa nueva y una nota con lo que contó el ejecutor, citado. La etapa solo avanza.
- Deals: en esta versión no se crean desde el chat. Si hay interés real, decile al ejecutor que lo cree en el CRM.
- Si el tenant no tiene CRM, las herramientas devuelven `sin_crm`: avisalo una vez y seguí con la cola.
