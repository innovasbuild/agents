## gstack (REQUIRED)
test -d ~/.claude/skills/gstack/bin && echo GSTACK_OK || echo GSTACK_MISSING
Si falta: STOP y pedir instalación.

## Reglas del repo
- Etapas en docs/innovas-agents-kickoff.md. Una sesión por etapa; /context-save al cerrar.
- Antes de escribir código de eve, leer node_modules/eve/docs/README.md y la guía del slot que tocás.
- Antes de tocar SQL, cargar supabase-postgres-best-practices. Toda tabla lleva tenant_id y RLS.
- Toda tool con efecto externo lleva `approval` explícito.
- events es append-only. Nunca UPDATE/DELETE.
- Nada específico de un tenant en código. Va a tenants/<slug>/ o a la base.
- Español rioplatense en UI, instrucciones y skills. Código e identificadores en inglés.
- Tool nueva en `agents/outreach/tools/`: va también su etiqueta en castellano en `TOOL_LABELS` (`lib/agents/running-tool.ts`), que es lo que muestra el indicador de actividad del chat, o entra en `TOOLS_SIN_ETIQUETA` si a propósito no se nombra en pantalla. `tests/agents/running-tool.test.ts` compara la lista contra el disco y falla hasta que alguien decida cuál de las dos.
- Comandos: npm run dev · npm run typecheck · npm test · npm run lint:fix
- Base: npm run db:start · npm run db:reset · npm run db:test · npm run db:types (necesitan Docker abierto)

## CRM de INNOV.AS (HubSpot, portal 51464889)

### Acceso
- HubSpot de INNOV.AS se opera ÚNICAMENTE con el server MCP `hubspot-innov` (tools `mcp__hubspot-innov__*`).
- ColdIQ se opera ÚNICAMENTE con `coldiq-innov` (tools `mcp__coldiq-innov__*`). Sus tools de datos consumen créditos del bucket compartido; el saldo se consulta con `get_credit_balance`.
- Cualquier otro server de HubSpot o Apollo en la sesión (incluido el conector de claude.ai, `mcp__claude_ai_*`) pertenece a otra empresa y está prohibido, aun como fallback. Si `hubspot-innov` está caído: avisar y diferir.
- Al arrancar cualquier tarea de CRM, correr `hubspot-get-user-details`. Si `hubId` ≠ 51464889, frenar. El `ownerId` que devuelve es la identidad del ejecutor.

### Owners
| Email | ownerId | slug |
|---|---|---|
| matias@innov.as | 92296278 | mati |
| marcos@innov.as | 92296386 | marcos |

### Pipeline `default` — se escribe el value, se lee el rótulo
| dealstage | Rótulo | Cuándo |
|---|---|---|
| 1404639148 | On The radar / Prospect | fuera del outreach |
| 1404975950 | Contactado | primera respuesta con interés (acá nace el deal) |
| appointmentscheduled | Cita programada | exploración agendada |
| qualifiedtobuy | Propuesta Enviada | Radar o Mapa cotizado |
| decisionmakerboughtin | En Negociación | discutiendo alcance o precio |
| contractsent | Contrato enviado | |
| closedwon | Ganado | Radar, Mapa u ola aceptada |
| closedlost | Perdido | no explícito con deal en negociación |
| presentationscheduled | Retrasado (stand by) | tres toques sin respuesta con deal abierto |

Los IDs con nombre de otra etapa son herencia; nunca inferir uno del otro. El pipeline no se reconfigura.

### IDs de asociación (HUBSPOT_DEFINED)
contacto→empresa 279 (+1 principal) · deal→contacto 3 · deal→empresa 341 (+5 principal) · nota→contacto 202 · task→contacto 204

### Reglas de escritura
1. Buscar antes de escribir, siempre. Empresa por `domain`; contacto por `email` OR `contact_key` (`em:<email>`) OR slug de LinkedIn. Si existe, se actualiza (`hubspot-batch-update-objects`, `idProperty: "email"`); nunca se duplica.
2. Claim: si la última nota del contacto es de otro owner y tiene menos de 90 días, ese contacto lo lleva esa persona. No se contacta. Entre `outreach_owner` y autoría de notas, gana la autoría.
3. Las diez propiedades de atribución (`contact_key`, `outreach_vector`, `outreach_segmento`, `outreach_canal`, `outreach_hook`, `outreach_idioma`, `outreach_fecha_msg1`, `outreach_status`, `outreach_owner`, más `outreach_fecha_respuesta` al responder) van en la MISMA llamada que crea o actualiza el contacto. Fechas `YYYY-MM-DD`.
4. Toda interacción deja nota (`hubspot-create-engagement`, type NOTE, con `ownerId` del ejecutor). Primera línea: `[out · msgN · canal · vector · hook]` o `[in · ...]`. Después, el texto exacto, citado, sin resumir.
5. Todo follow up es una TASK con `ownerId` y `timestamp` de vencimiento en ms.
6. Deal solo cuando hay respuesta con interés: pipeline `default`, stage `1404975950`, asociado a contacto y empresa, con el origen (vector, hook, canal) repetido en `description`. Nombre: `En Paralelo · <Empresa>`.
7. Para notificar a alguien: task asignada a su `ownerId`, o mail a su casilla @innov.as. Una @mención en una nota por API no notifica.
8. Emails de prospección salen con BCC a `51464889@bcc.hubspot.com`. HubSpot crea el contacto si no existe, así que después del envío el registro es una actualización.

### Límites del MCP
- No fusiona ni borra registros: eso va a mano en la UI de HubSpot.
- `hubspot-create-engagement` crea notas y tasks; emails, llamadas y reuniones entran por otro camino.
- `hubspot-search-objects` pagina de a 100 con `after`.
- Al crear un contacto con email, HubSpot auto-crea una empresa con ese dominio aunque se asocie otra. Después de cada alta, revisar duplicados por dominio.

### Aprobación
Lecturas: libres. Cualquier escritura (crear, actualizar, asociar, mover etapa): mostrar el payload y pedir confirmación antes de ejecutar.

## Skill routing
Diseño nuevo → superpowers:brainstorming · Bug → /investigate · Probar en navegador → /qa · PR → /ship
