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

1. Desde el chat en producción, en el tenant `innovas`, responden `crm__search_crm_objects` buscando contactos (nombre fijado por S2, §10.1) y `brain__brain_search`.
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

`events.type` suma `connection.bound`, con `payload` `{ capability, provider, connector_uid, binding_id, actor }` y `actor_user_id` nulo cuando lo escribe el script (§9). No hay baja de bindings en esta etapa, así que tampoco hay `connection.unbound`: entra junto con la pantalla de conexiones de la Etapa 4. `events` sigue siendo append-only.

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

**`connect_api_key`:** `getToken` de `@vercel/connect` con `binding.connectorUid` y `subject: { type: "app" }`. Connect devuelve la llave cruda, sin prefijo (§10.1 S5). El valor va en el header que declara la entrada (`headers` como función) o como bearer (`auth.getToken`). El SDK cachea el token en proceso hasta su `expiresAt` (~15 min). Ante un 401 del proveedor, `deleteTokenCacheEntry` con los mismos parámetros y un solo reintento: así una llave rotada (§9.1) no queda rechazada hasta que venza el caché. El resolver **nunca** elige un `connector_uid` que no venga del binding del tenant de la sesión.

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

- MCP remoto oficial `https://mcp.hubspot.com/` (la raíz responde `initialize`). `connect_oauth` con el conector de plataforma `mcp.hubspot.com/hubspot`; `multiple: false`.
- **Solo lectura en esta etapa:** `tools.allow` con `search_crm_objects`, `get_crm_objects`, `get_properties`, `search_properties`, `discover_hubspot_schema`, `search_owners` y `get_user_details`, sin `approval`. Quedan afuera las demás tools de lectura (marketing, AEO, conversaciones, `query_crm_data`) y todas las de escritura (§10.1 S2). Las escrituras con aprobación y atribución son de la Etapa 3.
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

**Desvío resuelto por S3:** el token del conector del MCP sirve contra la API REST (`GET /crm/v3/properties/contacts` → 200), así que **no hay conector `hubspot-api`**: la tool usa el mismo `tenantScopedConnect("mcp.hubspot.com/hubspot", ...)`. Falta probar la escritura (POST de propiedades y grupo) con ese token. Si falla por scope, la alternativa es la tool del MCP `manage_custom_properties` antes que un segundo conector.

### 6.2 `brain` · innovas-brains-mcp

> **En suspenso (§10.1 S5).** `innovas-brains-mcp` no está implementado y su arquitectura (Railway o Vercel + Supabase, contenido en Drive o versionado) se rediseña en una sesión aparte. La mecánica del conector `api-key` quedó probada con ColdIQ. Lo que sigue vale si el brain termina siendo un MCP remoto con llave; si cambia, se reescribe esta sección antes de construirla.

- MCP; URL en `config.url` del binding; `connect_api_key` con header `x-api-key`; `multiple: false`.
- `tools.allow`: `brain_search`, `brain_read`, `brain_upsert`.
- `approval`: política por nombre. `brain_upsert` devuelve `"user-approval"`; el resto, `"not-applicable"`. El nombre llega calificado (`brain__brain_upsert`), así que se compara con `endsWith`.

### 6.3 `leads-coldiq` · ColdIQ

> **Desvío (§10.1 S4):** ColdIQ no tiene MCP remoto. Pasa de conexión MCP a **conexión OpenAPI**, mismo patrón que Google Places.

- OpenAPI con `spec` inline escrito a mano en `lib/connectors/leads/coldiq.openapi.ts`, a partir del tag "GTM Verbs" de `https://api.coldiq.com/openapi.json`. No se usa la URL del spec: tiene 773 operaciones sin `operationId`, y eve derivaría nombres de método y ruta. El documento inline pone `operationId` propios.
- `baseUrl` `https://api.coldiq.com`. `connect_api_key` con `scheme: "bearer"`; `multiple: true`. Conector del tenant `innovas`: `innovas-coldiq`.
- Operaciones, todas `POST` e individuales: `findPeople` (`/v1/people/search`), `searchCompanies` (`/v1/companies/search`), `enrichPerson` (`/v1/person/enrich`), `enrichCompany` (`/v1/company/enrich`), `findEmail` (`/v1/email/find`), `verifyEmail` (`/v1/email/verify`), `findSignals` (`/v1/signals/find`).
- **Las operaciones bulk (`/bulk/submit`, resultados y cancelación) no entran al documento en esta etapa:** sin cupos por tenant (Etapa 3) no hay forma segura de acotar su costo. Sin bulk, tampoco hace falta la política de `approval` por sufijo `_bulk`.
- Sin `approval`: son lecturas, aunque consumen créditos (§13).

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
vercel connect create <url base del servicio> --name innovas-coldiq
npm run connections:bind -- --tenant innovas --capability leads --provider coldiq --connector innovas-coldiq
```

- `create` abre el formulario de Connect: elegir **API Key**, **Shared API Keys**, UID `<slug del tenant>-<proveedor>` (reemplazar el que propone, `<host>/<nombre>`), Scope y Expiration vacíos. La llave se pega en el formulario del navegador: no pasa por la terminal ni por el agente. `create` ya ata el conector a los tres entornos del proyecto.
- Convención de UID: `<slug del tenant>-<proveedor>`.
- `scripts/connections-bind.ts` valida `provider` contra el catálogo, hace upsert del binding con la service role y agrega `connection.bound` a `events`. No maneja secretos.

**Probar un conector `api-key` desde la terminal.** `vercel connect token <uid> --subject app` falla con `Token subject is not accessible to this requester`: el subject `app` lo pide el proyecto, no un usuario. Se prueba igual que en runtime, con el OIDC del proyecto, sin imprimir la llave:

```bash
DIR=$(mktemp -d); vercel env pull "$DIR/.env" --environment=development --yes >/dev/null 2>&1; OIDC=$(grep '^VERCEL_OIDC_TOKEN=' "$DIR/.env" | cut -d= -f2- | tr -d '"'); rm -rf "$DIR"; TOKEN=$(curl -s -X POST https://api.vercel.com/v1/connect/token/<uid> -H "Authorization: Bearer $OIDC" -H "Content-Type: application/json" -d '{"subject":{"type":"app"}}' | jq -r '.token // empty'); curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" <endpoint de lectura del proveedor>
```

**Rotación.** Se genera la llave nueva en el proveedor; en Vercel, Connect → conector → Settings → API Keys → New API Key, y guardar; se borra la llave vieja en el proveedor. No cambia el UID ni el binding. Connect entrega la llave nueva en el próximo pedido, pero las instancias en ejecución pueden seguir usando la vieja hasta que vence su token cacheado (~15 min) o hasta el primer 401 (§5.2).

### 9.2 Conectores de plataforma (una vez)

- HubSpot (hecho, UID `mcp.hubspot.com/hubspot`): con el usuario admin de la cuenta, en HubSpot → Development → MCP Auth Apps → Create MCP auth app, con Redirect URL `https://connect.vercel.com/callback`. Después, `vercel connect create https://mcp.hubspot.com` (sin `--connection-method`), nombre `hubspot`, y en el formulario OAuth pegar Client ID y Client Secret de esa app. Cada usuario autoriza su cuenta la primera vez que se pide un token.
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

## 10.1 Resultado del spike (2026-09-13)

S1 a S6 se corrieron con el usuario en su terminal; el agente no vio llaves ni tokens. **S7 no se corrió:** exige `tenantScopedConnect`, que no existe todavía. Queda para la verificación de la Entrega 3 (criterio de cierre 4).

**Conectores creados.** Son definitivos y están atados al proyecto `agents` en production, preview y development (`vercel connect attach` respondió "Nothing to do": `create` ya los ata con `autoinstall=true`).

| UID | id | Tipo | Alcance |
|---|---|---|---|
| `mcp.hubspot.com/hubspot` | `scl_Q2pqnG5s8T8GnXWUNIvlxg` | OAuth Customer Owned contra `https://mcp.hubspot.com` | Plataforma; grants por usuario |
| `innovas-coldiq` | `scl_Vy4XBaAvB7QwpRrGeqw` | `api-key`, Shared API Keys, contra `https://api.coldiq.com` | Tenant `innovas` |

| # | Respuesta | Evidencia (sin secretos) | Qué cambia |
|---|---|---|---|
| S1 | **Sí, con app propia.** Connect descubre los endpoints de authorize y token, pero no registra el cliente: pide Client ID y Client Secret. HubSpot exige una **MCP auth app** (no una app OAuth común). Los scopes no se declaran: los fija el MCP según sus tools y lo que acepta quien autoriza. El admin de la cuenta de HubSpot autoriza primero. Connect resuelve el PKCE que exige HubSpot | `vercel connect create https://mcp.hubspot.com --connection-method oauth` → `doesn't publish connection methods`. Sin el flag abre el formulario OAuth con `/oauth/authorize/user` y `/oauth/v3/token` precargados → `connector created: scl_Q2pqnG5s8T8GnXWUNIvlxg (UID mcp.hubspot.com/hubspot)`. Primer `vercel connect token` → `User authorization required` y consentimiento en el navegador; después, `initialize` → `HTTP/2 200` y `notifications/initialized` → `202` | §9.2 reescrito |
| S2 | **28 tools: 17 de lectura y 11 de escritura** (según `annotations.readOnlyHint`). No hay `search_contacts`: la búsqueda de contactos es `search_crm_objects` con `objectType` de contacto. En eve queda `crm__search_crm_objects` | `tools/list` filtrado con `jq`. Lectura: `discover_hubspot_schema`, `get_aeo_metrics`, `get_campaign_attribution_reports`, `get_content_analytics_report`, `get_conversation_channel_metadata`, `get_crm_objects`, `get_marketing_email_analytics`, `get_organization_details`, `get_properties`, `get_user_details`, `query_crm_data`, `read_campaign_data`, `search_conversations`, `search_crm_objects`, `search_owners`, `search_properties`, `tool_guidance`. Escritura: `manage_aeo_prompts`, `manage_aeo_recommendations`, `manage_campaign_objects`, `manage_crm_objects`, `manage_custom_pipelines`, `manage_custom_properties`, `manage_landing_page`, `manage_marketing_email`, `manage_onboarding`, `manage_segment`, `submit_feedback` | §1 criterio 1, §6.1 `tools.allow`, §14 |
| S3 | **Sí.** El token del conector del MCP sirve contra la API REST. **Desvío:** no hace falta el conector `hubspot-api`. Solo se probó lectura; la creación de propiedades (POST) se verifica en la Entrega 3 | `GET https://api.hubapi.com/crm/v3/properties/contacts` con el token de `mcp.hubspot.com/hubspot` → `http_status: 200` | §6.1 |
| S4 | **ColdIQ no tiene MCP remoto.** Publica un paquete MCP local por stdio (`@coldiq/mcp`) y una API REST en `https://api.coldiq.com` con auth **Bearer** (`securitySchemes.bearerAuth`, `http`/`bearer`). El OpenAPI (`/openapi.json`) tiene 773 operaciones y **ninguna tiene `operationId`**. Las operaciones de alto nivel están bajo el tag "GTM Verbs". **Desvío:** conexión OpenAPI con documento inline, no MCP | Dashboard de ColdIQ: solo API key, nada de MCP. `/openapi.json` → `200`. Con el conector `innovas-coldiq`, `GET /v1/me/credits` → `200` | §6.3 reescrito |
| S5 | **Sí, en la mecánica.** Un conector `api-key` acepta cualquier URL y `getToken` con `subject: { type: "app" }` devuelve la **llave cruda**, sin prefijo: el header (`x-api-key` o `Bearer`) lo arma nuestro código. **No se pudo probar contra el brain:** `innovas-brains-mcp` no está implementado y se rediseña en una sesión aparte | `POST https://api.vercel.com/v1/connect/token/innovas-coldiq` con el OIDC del proyecto y `subject app` → `{"tokenId":"stk_…","connector":{"uid":"innovas-coldiq","type":"api-key"}}`, largo 41, `sin prefijo`, y como Bearer contra ColdIQ → `200`. `vercel connect token innovas-coldiq --subject app` desde la CLI → `Token subject is not accessible to this requester`: el subject `app` solo lo pide el proyecto con su OIDC, no un usuario | §6.2 en suspenso, §9.1 |
| S6 | **Se edita en el lugar.** Connect → conector → Settings → API Keys → New API Key ("Leave blank to keep the current key"); también hay Add Key para convivir con dos llaves. La CLI no rota (`vercel connect update` solo cambia la marca). El cambio rige al instante en Connect; el token vive ~15 minutos y el SDK lo cachea en proceso hasta entonces | Llave nueva cargada y la vieja borrada en ColdIQ → nuevo pedido con otro `expiresAt` y `credits status: 200` | §9.1 rotación, §5.2, §13 |

**Hallazgos laterales:**
- El team de Vercel está en plan **Hobby**: Connect incluye 500 token requests cada 30 días y pausa el uso al llegar. §13 asumía Pro; se agrega el riesgo.
- Probar un conector `api-key` desde la terminal requiere el OIDC del proyecto (`vercel env pull`), no `vercel connect token` (§9.1).

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

- **Plan del team (§10.1):** el team de Vercel de Innovas está en **Hobby**, con 500 token requests cada 30 días; al llegar al límite Connect pausa el uso. Alcanza para desarrollo, pero con tokens de ~15 min y varios usuarios no alcanza para producción. Pasar el team a Pro antes de la verificación contra el deploy (Entrega 4).
- **Costo por token request:** $3 cada 1.000 en Pro. El SDK cachea en proceso; se revisa el tablero de Observability de Connect al cerrar la etapa.
- **Rate limit:** 200 `getToken` por minuto por team, compartido entre todos los conectores. Sin problema a este volumen; hay que mirarlo cuando lleguen los schedules.
- **ColdIQ y Places cuestan por llamada** y no hay cupo hasta la Etapa 3: ColdIQ sin operaciones bulk (§6.3) y Places con field mask fijo.
- **CLI de Connect en beta** y adapter de eve con API reciente (`principalToSubject` ya deprecado). `@vercel/connect` queda fijado en versión exacta.
- **Schedules sin usuario** (Etapa 5) no pueden usar HubSpot ni Gmail por D4. Tendrán que despachar por un canal autenticado como usuario.
- **Sin autoservicio:** cargar o rotar una llave requiere acceso al team de Vercel de Innovas. Si aparece autoservicio real, se suma un segundo backend de secretos detrás de `ConnectorAuth` sin tocar tools ni resolver.

## 14. Enmiendas al roadmap

- Modelo de runtime para probar la etapa: `anthropic/claude-sonnet-5` (Haiku sigue bloqueado por el free tier del AI Gateway).
- `crm__search_contacts` en el criterio de cierre se reemplaza por `crm__search_crm_objects` (S2).
- La tarea "`tenant_connections` como fuente de URLs y `secret_ref`" pasa a `connector_uid` y `config.url`.
- La enmienda D2/D3 del roadmap ("llaves en Supabase Vault") queda reemplazada por D2 de esta spec.
- La deuda "absorber `google_tokens` en `executors` y mover el refresh token a Vault" queda superada por Connect.
- La deuda "verificar la app de Google" se reescribe como "pasar la app de Google a producción" (§9.3).
