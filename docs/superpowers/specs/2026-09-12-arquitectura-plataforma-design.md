---
title: Arquitectura de la plataforma — validación contra las notas del 2026-09-12
fecha: 2026-09-12
estado: aprobada en brainstorming
fuente: notas de la reunión "Arquitectura Innovas" (Gemini, 2026-09-12) contrastadas con docs/innovas-agents-kickoff.md y docs/01-roadmap-etapas.md
decisiones: 4675461c · 542c40f0 · 5bb1743b · 02ed69fd · c3813dd2 · 0d313b02 (gstack-decision-log)
---

# Arquitectura de la plataforma · enmiendas al kickoff

## 1. Qué valida este documento

Después de cerrar la Etapa 0, Matías planteó la visión completa de la plataforma: 50 a 60 clientes de INNOV.AS (fábricas, inmobiliarias, otros), cada uno con su ecosistema de agentes; agentes outbound (Apollo o ColdIQ → HubSpot → mails de prospección) y agentes inbound (atención de pedidos por web o WhatsApp, calificación de leads, con memoria, despertados por webhook); brain por cliente vía MCP; observabilidad por cliente; derivación de conversaciones pendientes a un comercial dentro de la plataforma; login de Innovas con Google y de clientes con Google, Microsoft o magic link validando el dominio.

Este documento contrasta esa visión con el kickoff y el roadmap, registra las decisiones tomadas y lo que cambia en cada etapa. **No reemplaza al kickoff**: lo enmienda en los puntos que se listan en §3.

## 2. Qué ya estaba cubierto

| Necesidad de la reunión | Dónde está |
|---|---|
| Separación por cliente, roles, Innovas como un tenant más | Etapa 1 (`tenants`, `memberships`, RLS por `tenant_id`) |
| Brain por cliente vía MCP | Etapa 2 (`connections/brain.ts` dinámica) |
| Apollo/ColdIQ → HubSpot → email de prospección | Etapas 2 y 3 |
| Tareas programadas | Etapa 5 |
| Agentes accesibles por MCP desde Claude/ChatGPT | Etapa 6 |
| WhatsApp y Slack | Etapa 8 |
| Observabilidad por cliente | Etapa 9 (puede correr apenas cierre la 5) |
| Login de Innovas con Google | Etapa 0, hecho |

## 3. Decisiones

### D1 · Outbound primero; inbound + handoff como Etapa 10

El roadmap v1 sigue siendo outbound. Los agentes inbound (atención de pedidos por web o WhatsApp, calificación de leads, handoff a un comercial que sigue la conversación desde la plataforma) entran como **Etapa 10**, numerada al final, con su propia observabilidad (conversaciones, tasa de calificación, tiempos de handoff). Se cierra el ciclo completo outbound, incluida la Etapa 9, antes de abrir la segunda familia de agentes.

Consecuencias ahora: la Etapa 1 deja una tabla `conversations` genérica (§3 D5) que inbound va a extender con estado de handoff, y ninguna decisión de canales de las etapas 5 a 8 puede asumir que el agente solo habla hacia afuera.

Costo si está mal: si el primer cliente inbound aparece antes de la Etapa 6, se reordena en ese momento con más información.

### D2 · Conectores adaptables: catálogo por capacidad, binding por tenant

Cada cliente trae su CRM (HubSpot, Tokko, una planilla, ninguno), no todos usan Apollo, algunos van a querer LinkedIn. El diseño:

1. **Catálogo en código** (`lib/connectors/catalog.ts`): una entrada por proveedor soportado. Cada entrada declara la **capacidad** que cubre (`crm`, `leads`, `enrichment`, `brain`, `mail`), el protocolo (MCP, OpenAPI, o adapter propio), la forma de auth (api-key en header, bearer, OAuth) y los campos que hay que cargar. Agregar un proveedor es una entrada más y, si no es MCP ni OpenAPI, un adapter en `lib/connectors/<capacidad>/<proveedor>.ts`.
2. **Binding por tenant** en `tenant_connections`: `capacidad → proveedor + credencial`. Innovas: `crm=hubspot`, `leads=coldiq`. Una inmobiliaria: `crm=tokko`, `leads=csv`. Un tenant puede no tener una capacidad.
3. **Tools escritas contra la capacidad**, no contra el proveedor, para las operaciones con aprobación y atribución: `crm_upsert_contact`, `crm_log_activity`, `leads_search`. Schema estable, despachan al adapter del proveedor del tenant. Así `approval`, dedup por `contact_key` y la atribución en `events` son idénticas para cualquier CRM. Para lecturas exploratorias se expone la conexión cruda del tenant (`crm__*`) y el modelo descubre las tools del proveedor con `connection_search`.

Cómo lo soporta eve (verificado en `node_modules/eve/docs/connections` y `guides/dynamic-capabilities`): `defineDynamic` en `session.started` devuelve un mapa de conexiones por tenant; `auth.getToken` corre en cada intento de conexión y puede leer el secreto de donde sea; `headers` puede ser función del contexto de sesión; toda conexión autenticada dinámica lleva un `instanceKey` estable y no secreto; el modelo nunca ve URL ni credencial.

Avisos:
- **LinkedIn no tiene API oficial** de búsqueda ni mensajería para este uso. Entra, si entra, como proveedor tercero (Unipile, Phantombuster, ColdIQ) de la capacidad `leads` o `mail`, bajo las condiciones de ese tercero. Decisión pendiente para la etapa en que se pida.
- Apollo, ColdIQ y CSV son tres proveedores de la misma capacidad `leads`. El agente no sabe cuál usa el tenant.

### D3 · Llaves: dos carriles, nada por tenant en env vars

Hoy `.env.local` mezcla secretos **de la plataforma** (service role de Supabase, client OAuth de Google, AI Gateway) con secretos **del tenant Innovas** (brain, ColdIQ, HubSpot). Los primeros quedan en env vars de Vercel. Los segundos no: cada cambio de env var exige redeploy, 50 tenants por N conectores no es operable a mano, y viola el principio 6 del kickoff ("nada especial para innovas").

**Carril 1 · llaves de API por tenant** (brain, ColdIQ, Apollo, Places, HubSpot private app): **Supabase Vault**. `tenant_connections.secret_ref` pasa a ser el id del secreto en Vault. Se cargan desde `/settings/conexiones`: se pega la llave una vez, el server la escribe en Vault con el cliente admin, y la fila guarda `configurado el <fecha>` y los últimos 4 caracteres. Nunca se muestra de vuelta; se reemplaza. El resolver dinámico lee `tenant_connections` del tenant de la sesión y `getToken`/`headers` traen el secreto de Vault en el momento de la llamada. Sin redeploys. Las llaves de Innovas migran ahí también.

**Carril 2 · OAuth por usuario o por tenant** (Gmail, HubSpot OAuth, Microsoft si aparece): **Vercel Connect** (`connect("<uid>")`) donde el proveedor esté en su catálogo: consentimiento, guardado cifrado y refresh los hace Connect, y eve pausa el turno con `authorization.required` hasta que el usuario autorice. Donde Connect no tenga el proveedor, `defineInteractiveAuthorization` (OAuth propio) con el token en Vault. Generaliza la migración de Gmail a Connect ya prevista en Etapa 2.

**Quién carga las llaves:** Innovas (`platform_admin`) en el onboarding del cliente al principio; el modelo de permisos nace preparado para autoservicio del `tenant_admin`, y la UI de edición para tenants entra cuando haya más de 5 clientes. Toda carga o reemplazo queda en `events` (quién, cuándo, qué conector; nunca el valor).

**Regla para `CLAUDE.md`:** si una env var tiene nombre de cliente, está en el lugar equivocado.

Costo si está mal: Vault ata todas las llaves de todos los clientes a la service role key de Supabase, que ya es la llave maestra. La rotación es manual. Si hace falta auditoría y rotación automática, se cambia el backend detrás de `secret_ref` sin tocar tools ni resolvers.

### D4 · Alta de usuarios de clientes: solo por invitación

- **Métodos de login:** Google y magic link por mail para todos desde Etapa 1 (providers nativos de Supabase Auth). Microsoft (Azure) se habilita como provider cuando un cliente lo pida: configuración, no código. Sin contraseñas.
- **Regla de alta:** solo por invitación. El `tenant_admin` (o Innovas) invita por mail; Supabase manda el magic link. `tenants.allowed_domains` valida al invitar, **no** es puerta de entrada. Un ex-empleado deja de entrar cuando se le saca la membership, no cuando le cierran el mail.
- **Preparado para después:** `tenants.self_signup_by_domain`, default `false`, modelado desde Etapa 1 para habilitar auto-alta por dominio en clientes grandes sin migrar.

### D5 · Configuración por tenant: híbrido explícito

**En la base, todo lo operativo:** `tenants` (slug, `allowed_domains`, `default_model`, `self_signup_by_domain`, `brand`), `tenant_agents` (`tenant_id`, `agent`, `enabled`, override de modelo, cupos, `config` jsonb), `tenant_connections`, `config_values`, y `conversations` (`tenant_id`, `user_id`, `agent`, `eve_session_id`, `title`, `last_message_at`).

**En el repo, solo contenido versionable:** `tenants/<slug>/skills/` (canon que baja `sync-brain`) y plantillas de instrucciones por vertical. `tenant.json` se reduce a `{ slug }` o desaparece. Enmienda al kickoff §4: `default_model` y "conexiones habilitadas" ya no viven en `tenant.json`.

**Agentes por tenant:** los agentes se definen en código por capacidad (`outreach` hoy, `atencion` en Etapa 10); cada entrada de `withEve({ agents })` es un build separado. Que un tenant "tenga" un agente es una fila en `tenant_agents`; los resolvers dinámicos devuelven `null` y el canal rechaza cuando no está habilitado. Nunca `agents/<cliente>/`.

Por qué el canon sigue en el repo: el prompt caching exige instrucciones estables por tenant (kickoff §3) y el brain no es fuente de arranque en producción (principio 5). Si un cliente quiere editar su canon desde el dashboard, pasa a la base versionado ahí.

### D6 · Design system del dashboard con marca por tenant

Antes de empezar cualquier trabajo de UX (Etapa 4): design system limpio sobre **Tailwind + shadcn/ui**, un solo set de componentes para todos los clientes. Theming por tenant sin variantes de componentes: `tenants.brand` (`primary`, `secondary`, `logo_url` en un bucket de Supabase Storage con RLS por tenant) se aplica como CSS variables de shadcn (`--primary`, `--secondary`, con los `-foreground` derivados por contraste) en `app/[tenant]/layout.tsx`. Al entrar, el cliente ve su logo y sus colores. Innovas es un tenant más con su propia marca (skill `anthropic-skills:innov-design-system` como referencia cuando toque).

## 4. eve: contexto, hilos y memoria (verificado en la doc local)

- **Contexto de una conversación:** lo maneja eve. Sesión durable server-side con historial completo; los follow-ups reusan la sesión. 30 días por default (`limits.sessionTimeoutMs`, o `false`); al vencer no se borra nada, solo no se puede continuar. `compact`, `clear`, `reset`; el stream se reconecta desde un cursor.
- **Hilos múltiples por usuario:** eve no lista sesiones ni sabe de quién son. La app guarda un cursor por hilo (`conversations`) y remonta el chat con `useEveAgent({ initialSession, resume: true })` y `key={conversation.id}`. La misma tabla resuelve el ownership de sesión que eve no valida (spec 00 §4 hallazgo 4).
- **Memoria entre conversaciones:** memory slots (`defineMemory`) con scope `[tenantId, principalId]` y provider (archivo en Vercel Blob, Supermemory, Upstash, o propio). Es la forma natural de conectar el brain del tenant como memoria automática. **Pendiente para la spec de Etapa 2:** brain como conexión MCP (tools explícitas), como memory slot (recall automático por turno), o ambos.

## 5. Impacto por etapa

| Etapa | Qué cambia |
|---|---|
| 1 | Suma `conversations`, `tenant_agents`, `tenants.self_signup_by_domain`, `tenants.brand`; invitaciones por mail como único alta; Google + magic link. `tenant.json` deja de llevar modelo y conexiones. |
| 2 | Supabase Vault para llaves de API por tenant; `tenant_connections.secret_ref` apunta a Vault; catálogo de conectores por capacidad; Vercel Connect para OAuth. Decidir brain como conexión, memory slot o ambos. |
| 3 | Tools de escritura del CRM contra la capacidad (`crm_upsert_contact`) con adapters por proveedor. |
| 4 | Design system Tailwind + shadcn con marca por tenant antes de la primera pantalla; `/settings/conexiones` (carga por Innovas, lectura para el tenant). |
| 9 | Sin cambios; sigue pudiendo correr apenas cierre la 5. |
| 10 | Nueva: inbound + handoff, con su observabilidad. |

## 6. Lo que sigue

Este documento cierra la validación de arquitectura. **No dispara un plan de implementación propio**: cada etapa mantiene su ciclo (brainstorming → spec → plan → implementación), en sesión nueva y con el modelo que indica el roadmap. Lo inmediato es la **Etapa 1** con Opus para la spec de RLS y el modelo de datos, incorporando §5.

Preguntas que quedan para las specs de cada etapa, no para hoy:
- Etapa 2: brain como conexión, memory slot o ambos; qué CRMs y fuentes de leads tienen los primeros tres clientes reales (define el orden de los adapters); si Vercel Connect tiene HubSpot y Google en su catálogo o hace falta OAuth propio.
- Etapa 4: accesibilidad del theming por tenant (contraste mínimo cuando el color primario del cliente no da), modo oscuro.
- Etapa 10: canal entrante (WhatsApp Cloud API vía Chat SDK, webhook genérico), estado `handoff` en `conversations`, inbox del equipo comercial, qué proveedor de LinkedIn si se pide.
