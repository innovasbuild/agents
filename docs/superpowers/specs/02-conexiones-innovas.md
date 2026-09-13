---
title: Etapa 2 · Conexiones del tenant innovas (spec)
fecha: 2026-09-13
estado: aprobada en brainstorming
modelo: Opus 5 (spec) · Sonnet 5 (implementación, sesión nueva)
fuente: docs/01-roadmap-etapas.md §Etapa 2 · docs/innovas-agents-kickoff.md §2 y §5 · docs/superpowers/specs/2026-09-12-arquitectura-plataforma-design.md §D2 y §D3
---

# Etapa 2 · Conexiones del tenant `innovas`

## 1. Objetivo y criterio de cierre

Que el agente `outreach` use las herramientas externas de cada tenant (CRM, brain, fuentes de prospectos, casilla de mail) sin que haya un solo secreto en el código, en las env vars ni en nuestra base, y sin que un tenant pueda ver o usar las conexiones de otro. Sumar un proveedor tiene que ser una entrada de catálogo; darle una conexión a un tenant, una fila.

**Terminado cuando:**

1. Desde el chat en producción, en el tenant `innovas`, responden la tool de búsqueda de contactos de `crm__*` (con el nombre real que fije el spike, §10) y `brain__brain_search`.
2. Un tenant de prueba sin binding de `crm` no expone ninguna tool `crm__*`: test automatizado del resolver y verificación manual en `connection_search`.
3. `send_email` envía por Vercel Connect y la tabla `google_tokens` ya no existe.
4. El mismo usuario, miembro de dos tenants, no comparte el grant de HubSpot entre ellos: test del subject y verificación manual (el segundo tenant tiene que pedir consentimiento de nuevo).
5. Las 8 propiedades custom de outreach existen en el HubSpot de Innovas, en el grupo `outreach`.
6. `npm run db:test` en verde, con los tests de aislamiento de `tenant_connections` y `executors`.

## 2. Decisiones de esta spec

| # | Decisión | Por qué |
|---|---|---|
| D1 | Alcance completo del roadmap: infraestructura de conexiones, los cinco conectores, Gmail a Connect, `executors` y las propiedades de HubSpot | Elección del usuario. Las propiedades son la única escritura al CRM de la etapa y van detrás de una tool con aprobación |
| D2 | **Todas las credenciales viven en Vercel Connect.** Revierte el carril Vault del diseño de arquitectura (D3) | Sin secretos en nuestra base; cifrado, RBAC y observabilidad por token request los da Vercel; el dashboard de Vercel es la UI de carga mientras Innovas hace el onboarding. Registrado como reemplazo de la decisión anterior en el log de gstack |
| D3 | Llaves de API: **un conector `api-key` por tenant y proveedor**. OAuth: **un conector de plataforma por proveedor**, grants por usuario | Los conectores `api-key` y Custom OAuth de Connect "reach exactly one account": no tienen instalaciones múltiples |
| D4 | **HubSpot por usuario**: cada ejecutor autoriza su propia cuenta | Elección del usuario. Lo que escribe queda a su nombre en HubSpot. Consecuencia: un schedule sin usuario (Etapa 5) no puede tocar el CRM |
| D5 | **El grant OAuth se ata a `tenant:usuario`, nunca solo al usuario** | Connect guarda por defecto `{ type: "user", id }`. Un usuario con memberships en dos tenants usaría el HubSpot de uno dentro del otro. Es un requisito de seguridad, con test |
| D6 | **Brain solo como conexión MCP**, sin memory slot | Un memory slot hace recall en cada turno y capture después de cada turno, es decir que escribiría en el canon del cliente sin aprobación. El canon ya entra por skills versionadas |
| D7 | **Un único resolver dinámico guiado por el catálogo** (`agents/outreach/connections/tenant.ts`) | Una consulta por arranque de sesión; sumar un proveedor es una entrada de catálogo; puede omitir conexiones, cosa que una conexión estática no puede |
| D8 | **Gmail es una tool propia, no una conexión** | Gmail no tiene MCP ni OpenAPI utilizable. `send_email` pide el token a Connect con el mismo helper aislado |

## 3. Modelo de datos

Antes de escribir la primera migración de esta etapa, la tarea de hardening de `anon` (sesión aparte, 2026-09-13) tiene que estar en `main`: las dos tocan `supabase/migrations/` y `supabase/tests/`.

### 3.1 Enum

`connector_capability`: `crm`, `leads`, `enrichment`, `brain`, `mail`.

### 3.2 `tenant_connections`

Un binding de un tenant con un proveedor.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | Es el `instanceKey` de la conexión en eve |
| `tenant_id` | uuid not null → `tenants` on delete cascade | |
| `capability` | `connector_capability` not null | |
| `provider` | text not null | Clave del catálogo (`hubspot`, `innovas-brains`, `coldiq`, `google-places`, `gmail`). Se valida en código contra el catálogo, no con un enum: sumar un proveedor no requiere migración |
| `connector_uid` | text | UID del conector de Connect para proveedores `api-key`. Nulo para proveedores OAuth de plataforma, cuyo UID está en el catálogo. No es secreto |
| `config` | jsonb not null default `'{}'` | Solo datos no secretos: `url` del MCP cuando varía por tenant |
| `enabled` | boolean not null default true | |
| `created_at`, `updated_at` | timestamptz | |

- Único por `(tenant_id, capability, provider)`. Permite dos proveedores de `leads` para el mismo tenant.
- Índice por `tenant_id`.
- **RLS:** `select` para miembros del tenant (`is_member_of`) y `platform_admin`. **Ninguna política de escritura para `authenticated`**, y además `revoke insert, update, delete` a `authenticated` y `anon`: el binding lo escribe solo el servidor con la service role.

### 3.3 `executors`

Quién ejecuta outreach dentro de un tenant.

| Columna | Tipo | Notas |
|---|---|---|
| `tenant_id` | uuid not null → `tenants` on delete cascade | |
| `user_id` | uuid not null → `auth.users` on delete cascade | |
| `daily_quota` | integer not null default 30 | La consume la Etapa 3 |
| `gmail_authorized_at` | timestamptz | La estampa el hook de §7.2 |
| `created_at` | timestamptz | |

- PK `(tenant_id, user_id)`.
- **RLS:** `select` para miembros del tenant. Escritura revocada a `authenticated` y `anon`: la escribe el hook con la service role.

### 3.4 `google_tokens` se elimina

`drop table public.google_tokens`. El refresh token nunca más llega a nuestra base. La deuda de la Etapa 0 "absorber `google_tokens` en `executors` y mover el refresh token a Vault" queda **superada**, no cumplida al pie de la letra: el token vive en Connect.

### 3.5 Eventos

`events.type` suma `connection.bound` y `connection.unbound`, con `payload` `{ capability, provider, connector_uid }` y `actor_user_id` nulo cuando lo escribe el script (§9). `events` sigue siendo append-only.

## 4. Catálogo

`lib/connectors/catalog.ts`. Puro: sin red, sin base, sin eve en tiempo de import más allá de los tipos y factories.

```ts
type Capability = "crm" | "leads" | "enrichment" | "brain" | "mail";

type ConnectorAuth =
  | { kind: "connect_api_key"; scheme: "header"; header: string }
  | { kind: "connect_api_key"; scheme: "bearer" }
  | { kind: "connect_oauth"; connector: string; scopes?: string[] };

type Binding = {
  id: string;
  tenantId: string;
  capability: Capability;
  provider: string;
  connectorUid: string | null;
  config: Record<string, unknown>;
};

type CatalogEntry = {
  provider: string;
  capability: Capability;
  multiple: boolean;          // la capacidad admite varios proveedores por tenant
  auth: ConnectorAuth;
  kind: "connection" | "tool"; // "tool": no produce conexión (Gmail)
  build?: (binding: Binding, tenantId: string) => ConnectionDefinition;
};
```

- **Nombre de conexión:** `capability` si `multiple` es falso (`crm`, `brain`); `${capability}-${provider}` si es verdadero (`leads-coldiq`, `leads-google-places`). Tiene que cumplir la regla de eve: minúsculas, dígitos y guiones, empieza con letra, hasta 64 caracteres.
- **Descripciones en español**, escritas para el modelo: son la señal principal de `connection_search`.
- **`lib/connectors/auth.ts`** traduce `ConnectorAuth` a lo que eve espera (§5.2). Es el único archivo que importa `@vercel/connect` y `@vercel/connect/eve`.

## 5. Resolver y auth

### 5.1 Resolver

`agents/outreach/connections/tenant.ts`, un `defineDynamic` en `session.started`:

1. `tenantId` sale de `ctx.session.auth.initiator ?? ctx.session.auth.current`, atributo `tenantId`, igual que `agent.ts`. Sin tenant, devuelve `null`.
2. Lee con el cliente admin los bindings `enabled` de ese `tenant_id`. El tenant es confiable: lo fijó `resolveChannelContext` desde `conversations`, no el browser.
3. Por cada binding cuyo `provider` exista en el catálogo con `kind: "connection"`, llama a `build`. Devuelve el mapa `{ [nombre]: definición }`.
4. **Idempotente y sin efectos.** eve lo vuelve a correr al reanudar un turno o reintentar un paso.

**Errores:**
- Si falla la consulta de bindings, el handler tira error y la sesión no arranca. Arrancar callada sin CRM es peor.
- Proveedor desconocido, o binding `connect_api_key` sin `connector_uid`: se omite la conexión con `console.warn` que nombra tenant, capacidad y proveedor. El modelo no ve una tool rota.

### 5.2 Auth por tipo

**`connect_api_key`:** `getToken` de `@vercel/connect` con `binding.connectorUid` y `subject: { type: "app" }`. El valor va en el header que declara la entrada (`headers` como función) o como bearer (`auth.getToken`). El SDK cachea en proceso. El resolver **nunca** elige un `connector_uid` que no venga del binding del tenant de la sesión.

**`connect_oauth`:** `tenantScopedConnect(connector, tenantId, scopes?)` en `lib/connectors/auth.ts`, que envuelve `connect()` de `@vercel/connect/eve`:

```ts
connect({
  connector,
  tokenParams: scopes ? { scopes } : undefined,
  createSubject: (principal) => {
    if (principal.type !== "user") throw new Error("se requiere un usuario");
    return { type: "user", id: `${tenantId}:${principal.id}`, issuer: principal.issuer };
  },
});
```

**Regla dura:** ningún archivo fuera de `lib/connectors/auth.ts` importa `@vercel/connect` o `@vercel/connect/eve`. Un test la verifica recorriendo el repo.

**`instanceKey`:** el `id` del binding. Cambia si se reemplaza el binding, y eso invalida grants o callbacks parqueados contra el binding anterior.

## 6. Conectores

### 6.1 `crm` · HubSpot

- MCP remoto oficial `https://mcp.hubspot.com` (ruta exacta según el spike). `connect_oauth` con el conector de plataforma de HubSpot; `multiple: false`.
- **Solo lectura en esta etapa:** `tools.allow` con las tools de búsqueda y lectura que liste el spike, sin `approval`. Las escrituras con aprobación y atribución son de la Etapa 3.
- `config.url` no se usa: el endpoint es el mismo para todos los tenants.

**Propiedades custom:** tool propia `agents/outreach/tools/crm_setup_outreach_properties.ts`.
- `approval: always()`.
- Rechaza si el rol del caller (atributo `role` del auth) no es `tenant_admin` ni `platform_admin`.
- Rechaza si el tenant no tiene binding `crm` con proveedor `hubspot` habilitado.
- Idempotente: lee las propiedades de contacto existentes y crea solo las que faltan, en el grupo `outreach` (lo crea si no existe).
- Pide el token con `ctx.getToken(tenantScopedConnect(...))`; ante un 401, `ctx.requireAuth(...)`.
- El esquema vive en `lib/connectors/crm/hubspot.ts` y es genérico para cualquier tenant con HubSpot:

| Nombre interno | Tipo HubSpot |
|---|---|
| `contact_key` | string / text |
| `outreach_segmento` | string / text |
| `outreach_canal` | string / text |
| `outreach_hook` | string / text |
| `outreach_status` | string / text |
| `outreach_owner` | string / text |
| `outreach_fecha_msg1` | date / date |
| `outreach_fecha_respuesta` | date / date |

Las listas cerradas (segmento, hook, canal) se convierten en enumeraciones cuando exista `config_values` (Etapa 3).

**Si el spike muestra que el token del MCP no sirve contra la API REST** (`/crm/v3/properties/contacts`): un segundo conector OAuth de plataforma, `hubspot-api`, contra la API REST, con el mismo `tenantScopedConnect`. Se anota como desvío en esta spec antes de seguir.

### 6.2 `brain` · innovas-brains-mcp

- MCP; URL en `config.url` del binding; `connect_api_key` con header `x-api-key`; `multiple: false`.
- `tools.allow`: `brain_search`, `brain_read`, `brain_upsert`.
- `approval`: política por nombre. `brain_upsert` devuelve `"user-approval"`; el resto, `"not-applicable"`. El nombre llega calificado (`brain__brain_upsert`), así que se compara con `endsWith`.

### 6.3 `leads-coldiq` · ColdIQ

- MCP; URL y esquema de la llave según el spike; `connect_api_key`; `multiple: true`.
- `tools.allow` con las operaciones de búsqueda y enriquecimiento individual.
- `approval`: toda tool cuyo nombre termine en `_bulk` devuelve `"user-approval"`.
- Fuera del `allow` quedan, como mínimo, `setup_website_visitors` y `cancel_bulk_job`.

### 6.4 `leads-google-places` · Google Places

- OpenAPI con `spec` inline: un documento OpenAPI 3 escrito a mano en `lib/connectors/leads/google-places.openapi.ts`, con una sola operación, `searchText` (`POST /v1/places:searchText`). `baseUrl` `https://places.googleapis.com`. No se incluye `getPlace`: exige un field mask sin el prefijo `places.`, un header estático no puede tener dos valores, y `searchText` ya devuelve todos los campos que se usan.
- `connect_api_key` con header `X-Goog-Api-Key`; `multiple: true`.
- `X-Goog-FieldMask` fijo como header estático: `places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.types`. No se declara como parámetro en el documento OpenAPI, así que el modelo no puede pedir campos más caros.
- Sin `approval`: son lecturas.

### 6.5 `mail` · Gmail

- Entrada de catálogo con `kind: "tool"` y `connect_oauth` con el conector de plataforma de Google y scope `https://www.googleapis.com/auth/gmail.send`.
- Ver §7.

## 7. Gmail, login y autorización en el chat

### 7.1 `send_email`

- Sigue con `approval: always()` y exige principal `user`.
- Rechaza si el tenant no tiene binding `mail` con proveedor `gmail` habilitado.
- Pide el token con `ctx.getToken(tenantScopedConnect(google, tenantId, [gmail.send]))`. Ante un 401 de Gmail, `ctx.requireAuth(...)`.
- `lib/gmail/send.ts` pierde `getAccessToken` y la lectura de `google_tokens`; recibe el access token como parámetro. `lib/gmail/mime.ts` no cambia.

### 7.2 Hook de autorización

`agents/outreach/hooks/executors.ts`, sobre `authorization.completed`:
- Si `outcome === "authorized"` y la autorización corresponde a Gmail, hace upsert en `executors` de `(tenant_id, user_id)` con `gmail_authorized_at = now()`.
- Con try/catch: es observabilidad, no puede tumbar el turno (mismo criterio que `hooks/runs.ts`).
- La forma de identificar que la autorización es de Gmail (nombre de conexión, `displayName` o el propio evento) se verifica contra `dist/src/protocol/message.d.ts` antes de escribirlo.

### 7.3 Login

`app/auth/callback/route.ts` deja de guardar `provider_refresh_token` y deja de pedir los scopes de Gmail. La página de login pide solo `openid email profile`. Google sigue siendo método de login de Supabase: eso no cambia.

### 7.4 Chat

`app/[tenant]/chat/chat-client.tsx` tiene que mostrar el pedido de autorización. Según `guides/client/streaming.mdx` §Authorization pauses: renderizar el prompt (botón "Autorizar <displayName>" que abre `authorization.url` en pestaña nueva, y `userCode` si viene), deshabilitar el input mientras está pendiente, y dejar que la respuesta activa siga enganchada hasta que la autorización resuelva. Cómo expone `useEveAgent` el evento se verifica contra sus tipos antes de escribirlo.

## 8. Tests

**pgTAP** (`supabase/tests/06_tenant_connections.test.sql`):
- Un miembro de A no ve bindings ni ejecutores de B.
- `authenticated` no puede insertar, actualizar ni borrar en `tenant_connections` ni en `executors` (42501).
- `anon` no lee nada de las dos tablas.
- `google_tokens` no existe.

**vitest, sin red:**
- `build` de cada entrada del catálogo: nombre de conexión, `allow`/`operations`, política de `approval` (con nombres calificados), `instanceKey` igual al id del binding.
- Resolver con bindings simulados: tenant sin `crm` no tiene clave `crm`; dos proveedores de `leads` dan dos nombres; proveedor desconocido y `api-key` sin UID se omiten; sin `tenantId` devuelve `null`; error de consulta propaga.
- `tenantScopedConnect`: mismo usuario en dos tenants da dos `subject.id` distintos; principal `app` tira error.
- Regla de import: solo `lib/connectors/auth.ts` importa `@vercel/connect`.
- `crm_setup_outreach_properties`: con fetch simulado crea solo las faltantes; rechaza `tenant_member`; rechaza tenant sin binding.
- `send_email`: rechaza tenant sin binding `mail`; 401 dispara `requireAuth`.

## 9. Operación

### 9.1 Alta de un conector de API key (lo corre el usuario)

```bash
vercel connect create <servicio> --connection-method api-key --name innovas-brain --data @-
vercel connect attach innovas-brain
npm run connections:bind -- --tenant innovas --capability brain --provider innovas-brains --connector innovas-brain --url <url del MCP>
```

- La llave entra por stdin a la CLI de Vercel: no queda en el historial ni pasa por el agente.
- Convención de UID: `<slug del tenant>-<proveedor>`.
- `scripts/connections-bind.ts` valida `provider` contra el catálogo, hace upsert del binding con la service role y agrega `connection.bound` a `events`. No maneja secretos.

### 9.2 Conectores de plataforma (una vez)

- HubSpot: primero `vercel connect create mcp.hubspot.com`; si Connect no registra el cliente solo, app en el developer portal de HubSpot y `--data @archivo`.
- Google: `vercel connect create google --connection-method oauth --data @archivo` con el client que ya existe, Gmail API habilitada.
- Los dos: `vercel connect attach`. Sus UIDs quedan en el catálogo.
- Bindings OAuth de `innovas`: `npm run connections:bind -- --tenant innovas --capability crm --provider hubspot` y lo mismo para `mail`/`gmail`.

### 9.3 Pasos del usuario fuera del código

1. Conectores de plataforma (§9.2).
2. **Pasar la app de Google a producción** en Google Cloud. Con la app en "testing" los refresh tokens vencen a los 7 días, también dentro de Connect. `gmail.send` es scope sensible: sin verificación funciona hasta 100 usuarios con pantalla de advertencia. La verificación completa no bloquea la etapa.
3. Conectores `api-key` de brain, ColdIQ y Places para `innovas` (§9.1).
4. `npx supabase db push`.

### 9.4 Desarrollo local

Connect autentica con el OIDC token del proyecto. En local sale de `vercel env pull` (`VERCEL_OIDC_TOKEN` en `.env.local`) y vence: si `getToken` falla con error de autenticación, repetir el pull. Los conectores se atan también al entorno `development`.

## 10. Spike obligatorio (primera tarea del plan)

Nada del §6 se construye hasta cerrar el spike. Cada punto decide algo concreto y su resultado se escribe en esta spec, en una sección "Resultado del spike".

| # | Pregunta | Qué decide |
|---|---|---|
| S1 | ¿`vercel connect create mcp.hubspot.com` crea un conector que el MCP acepta? Si no, ¿qué app de HubSpot hace falta? | Pasos de §9.2 |
| S2 | Nombres reales de las tools del MCP de HubSpot (`tools/list`) | `tools.allow` de §6.1 y el nombre del criterio de cierre 1 |
| S3 | ¿El token del MCP de HubSpot sirve contra `/crm/v3/properties/contacts`? | Si hace falta el conector `hubspot-api` (§6.1) |
| S4 | URL del MCP de ColdIQ, esquema de la llave y nombres de sus tools | §6.3 |
| S5 | ¿Un conector `api-key` funciona para un servicio propio (brain en Railway) y `getToken` devuelve la llave tal cual? | Si el brain puede ir por Connect o necesita otro camino |
| S6 | ¿Cómo se rota la llave de un conector `api-key` (editar en el dashboard o recrear)? | Procedimiento de rotación en §9.1 |
| S7 | Con `createSubject` por `tenant:usuario`, el mismo usuario en un segundo tenant ¿dispara consentimiento nuevo? | Confirma D5 en la práctica |

S1, S3, S4 y S5 necesitan pasos del usuario (crear conectores, cargar llaves). El agente no crea conectores ni maneja llaves.

## 11. Entregas

1. **Spike** (§10) y resultado escrito en la spec.
2. **Datos y camino API key:** migración de `tenant_connections` y `executors`, pgTAP, catálogo, `lib/connectors/auth.ts`, resolver, `brain`, `leads-coldiq`, `leads-google-places`, `scripts/connections-bind.ts`.
3. **Camino OAuth:** `tenantScopedConnect`, `crm` HubSpot, `crm_setup_outreach_properties`, `send_email` por Connect, hook de `executors`, autorización en el chat, baja de `google_tokens` y limpieza del callback.
4. **Verificación contra el deploy** del criterio de cierre, a mano donde requiere login real y consentimiento OAuth.

## 12. Fuera de alcance

- Escrituras al CRM con aprobación y atribución (`crm_upsert_contact`, `crm_log_activity`): Etapa 3.
- Tools escritas contra la capacidad con adapters por proveedor: Etapa 3.
- `config_values` y enumeraciones de HubSpot: Etapa 3.
- Pantalla `/settings/conexiones`: Etapa 4.
- Autoservicio de llaves para `tenant_admin`.
- Cupos diarios por tenant para ColdIQ y Places.
- Memory slot del brain.
- `read_replies` y el scope `gmail.readonly`: Etapa 5.

## 13. Riesgos

- **Costo por token request:** $3 cada 1.000 en Pro. El SDK cachea en proceso; se revisa el tablero de Observability de Connect al cerrar la etapa.
- **Rate limit:** 200 `getToken` por minuto por team, compartido entre todos los conectores. Sin problema a este volumen; hay que mirarlo cuando lleguen los schedules.
- **ColdIQ y Places cuestan por llamada** y no hay cupo hasta la Etapa 3: bulk con aprobación y field mask fijo.
- **CLI de Connect en beta** y adapter de eve con API reciente (`principalToSubject` ya deprecado). `@vercel/connect` queda fijado en versión exacta.
- **Schedules sin usuario** (Etapa 5) no pueden usar HubSpot ni Gmail por D4. Tendrán que despachar por un canal autenticado como usuario.
- **Sin autoservicio:** cargar o rotar una llave requiere acceso al team de Vercel de Innovas. Si aparece autoservicio real, se suma un segundo backend de secretos detrás de `ConnectorAuth` sin tocar tools ni resolver.

## 14. Enmiendas al roadmap

- Modelo de runtime para probar la etapa: `anthropic/claude-sonnet-5` (Haiku sigue bloqueado por el free tier del AI Gateway).
- `crm__search_contacts` en el criterio de cierre se reemplaza por el nombre real que fije S2.
- La tarea "`tenant_connections` como fuente de URLs y `secret_ref`" pasa a `connector_uid` y `config.url`.
- La enmienda D2/D3 del roadmap ("llaves en Supabase Vault") queda reemplazada por D2 de esta spec.
- La deuda "absorber `google_tokens` en `executors` y mover el refresh token a Vault" queda superada por Connect.
- La deuda "verificar la app de Google" se reescribe como "pasar la app de Google a producción" (§9.3).
