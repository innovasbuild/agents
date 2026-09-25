---
title: Etapa 11 · Brain por MCP — servirlo a los clientes y consumir brains externos (spec)
fecha: 2026-09-24
estado: aprobada en brainstorming, pendiente de revisión escrita
modelo: Opus 5.5 (spec) · Sonnet 5 (implementación, sesión nueva)
etapa: 11, con el emisor OAuth de la Etapa 6 adentro (§3 D1)
fuente: docs/superpowers/specs/2026-09-13-brain-design.md (§3, §4, §5) · docs/01-roadmap-etapas.md (Etapas 6 y 11) · node_modules/eve/docs/channels/mcp.mdx · node_modules/eve/dist/src/public/channels/auth.d.ts · supabase.com/docs/guides/auth/oauth-server
---

# Etapa 11 · Brain por MCP

## 1. Qué problema resuelve

El brain de un tenant hoy solo lo usa el agente, desde el chat de la plataforma. Faltan dos puntas:

- **Servirlo.** Que la gente del cliente lea y escriba su brain desde sus propias herramientas (Claude Code, claude.ai, Codex), con su cuenta, sin pasar por el agente.
- **Consumirlo de afuera.** Que un tenant tenga su brain en otro servidor y el agente lo use con las mismas tres tools.

Y una deuda que aparece al construir la primera: las tools del brain están escritas dentro de `agents/outreach/`, así que un segundo agente o una segunda superficie tendrían que copiarlas.

## 2. Objetivo y criterio de cierre

**Terminado cuando:**

1. Desde Claude Code, con una cuenta de `innovas`, `brain_search` y `brain_read` contra `/brain/innovas/mcp` devuelven su canon, y la misma cuenta contra la URL de otro tenant recibe 403.
2. Una cuenta `tenant_member` no ve `brain_upsert` en la lista de tools. Una `tenant_admin` escribe, y la revisión queda con `author_kind = 'user'` y su `user_id`.
3. Con un tenant apuntado a un brain `mcp`, el agente responde las mismas tres tools. **Probado por tests** contra un servidor MCP en proceso (§10); no hay hoy un brain externo real para probar en producción.
4. Un agente sin brain declarado en `tenant_agents.config` no expone ninguna tool `brain_*`.
5. La llamada 61 de un usuario en un minuto se corta con un error reintentable.
6. La doc de conexión para Claude Code y claude.ai está en `docs/`.
7. `npm test`, `npm run typecheck` y `npm run db:test` en verde.

### 2.1 Entregas

| # | Entrega | Qué deja | Parte del roadmap |
|---|---|---|---|
| E1 | **Contrato y tools en `lib/`** | `lib/brain/contract.ts`, `lib/brain/tools.ts`, declaración por agente, `outreach` migrado | C |
| E2 | **Proveedor `mcp`** | `lib/brain/mcp.ts`, `mcp` en el catálogo, un solo brain habilitado por tenant | B |
| E3 | **Emisor OAuth** | OAuth Server de Supabase prendido, pantalla de consentimiento, login que vuelve a donde estaba | Etapa 6 (1) |
| E4 | **Endpoint del brain** | `/brain/<slug>/mcp`, metadata de recurso protegido, límites por minuto | A |
| E5 | **Doc y cierre** | Doc de conexión, verificación manual, roadmap | A |

E1 va primero porque E2 y E4 usan el contrato. E3 va antes que E4 porque sin emisor el endpoint no se puede probar de punta a punta.

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | El emisor OAuth de la Etapa 6 se construye acá. `channels/mcp.ts` (el agente por MCP) queda para la Etapa 6. | La parte A no se puede probar sin emisor. El canal del agente no lo necesita la Etapa 11. |
| D2 | El endpoint del brain **no** es `mcpChannel` de eve. Es una ruta de Next con `@modelcontextprotocol/sdk`. | `mcpChannel` expone solo `agent_start/get/update/cancel`: sirve para delegar una tarea al agente, no para servir tools directas. Meter el brain ahí obligaría a arrancar y consultar una invocación para una búsqueda, y gastaría un turno de modelo en una consulta a Postgres. |
| D3 | Una URL por tenant: `/brain/<slug>/mcp`. | El token dice quién sos, no a qué tenant entrás, y una persona puede estar en varios. Con el tenant en la URL, cada conexión del cliente es un brain, y el modelo del cliente nunca elige el tenant. |
| D4 | El rol decide qué tools se listan. `tenant_admin` y `platform_admin`: las tres. `tenant_member`: `brain_search` y `brain_read`. | Resuelve la "decisión a confirmar" del roadmap. Una tool que no podés usar no aparece; no es un error en runtime. |
| D5 | Por MCP, `brain_upsert` escribe sin aprobación. | Escribe una persona, no el agente. La aprobación existe porque el agente propone. Queda igual la revisión, el evento y el control de `baseRevision`. |
| D6 | El token se verifica con `supabase.auth.getClaims(token)`, detrás de una interfaz inyectable. | Es el verificador nativo del emisor: valida contra el JWKS si el proyecto firma con llaves asimétricas y cae al servidor de Auth si no. En el brainstorming se había propuesto `verifyOidc` de eve; se cambia porque `verifyOidc` depende de que la discovery OIDC esté en la ruta que espera (V4) y devuelve un principal `service` que igual hay que descartar. |
| D7 | Se exige el claim `client_id` en el token. | Separa las superficies: un token de sesión del dashboard no trae `client_id` y no entra por MCP. Si V3 muestra que el claim no viene, se frena y se decide. |
| D8 | Límite por minuto con contador en Postgres, no con el Firewall de Vercel. | El Firewall cuenta por IP o por header, no sabe de usuario ni de tenant. Queda como segunda capa contra abuso bruto, fuera de esta etapa. |
| D9 | Un solo brain habilitado por tenant, forzado en la base. | Hoy `resolveBrainBinding` descarta en silencio lo que no es wiki. Con dos proveedores posibles, el error tiene que aparecer al dar de alta, no al arrancar una sesión. |
| D10 | El proveedor `mcp` habla **nuestro** contrato; el mapeo en config solo renombra tools. | Traducir la forma de un servidor que no vimos es código que se tira. La traducción a medida se escribe con el primer tenant real que la traiga. |
| D11 | Sin declaración en `tenant_agents.config.brain`, el agente no tiene tools del brain. La migración declara `read_write` en las filas existentes de `outreach`. | El default seguro es no exponer. Que `outreach` siga igual es un dato en la base, no una excepción en el código. |
| D12 | La lectura del canon para las instrucciones no depende de la declaración del agente. | La hace la plataforma, no el modelo. Depende de que el tenant tenga brain. |

## 4. Emisor OAuth (E3)

### 4.1 Configuración de Supabase

En el proyecto de producción, **Authentication → OAuth Server**:
- OAuth Server prendido.
- **Allow Dynamic OAuth Apps** prendido: Claude, claude.ai y Codex se registran solos con RFC 7591 la primera vez.
- **Authorization Path**: `/oauth/consent`.

En local, lo mismo en `supabase/config.toml` si la versión del CLI lo soporta; si no, E3 se prueba contra el proyecto remoto (V1).

El emisor queda en `https://<ref>.supabase.co/auth/v1`, con metadata en `/.well-known/oauth-authorization-server/auth/v1`. Es genérico: la Etapa 6 lo reusa cambiando solo el recurso.

### 4.2 Pantalla de consentimiento

`app/oauth/consent/page.tsx`, server component:

1. Lee `authorization_id` de la query. Sin él: página de error, sin llamar a nada.
2. Sin sesión: redirige a `/login?next=/oauth/consent?authorization_id=<id>`.
3. Con sesión: `supabase.auth.oauth.getAuthorizationDetails(authorization_id)` y muestra el nombre del cliente, la URI de redirección y los scopes.
4. Dos botones, cada uno con su server action: `approveAuthorization` y `denyAuthorization`. Cada una redirige a la URL que devuelve Supabase.

La pantalla no muestra tenants: el token identifica a la persona, y el tenant lo pone la URL a la que se conecta el cliente (D3). En español rioplatense, con los componentes del design system.

### 4.3 Login que vuelve

Hoy el login siempre vuelve a `/`. Se agrega el parámetro `next`, que viaja de `/login` a `emailRedirectTo` y `redirectTo`, y lo aplica `app/auth/callback/route.ts` después de aceptar invitaciones.

`next` se acepta solo si es un path relativo: empieza con `/`, no con `//` ni `/\`, y al resolverlo contra el origen queda en el mismo origen. Si no, se ignora y se vuelve a `/`. Sin esto, `next` es un open redirect.

### 4.4 Proxy

`proxy.ts` refresca la sesión con `getUser()` en cada request. Se excluyen `brain/` y `.well-known/` del matcher: esas rutas se autentican por bearer y no tienen cookies que refrescar.

## 5. Endpoint del brain (E4)

### 5.1 Rutas

| Ruta | Qué hace |
|---|---|
| `app/brain/[tenant]/mcp/route.ts` | `POST`: MCP sobre Streamable HTTP, sin estado. `GET` y `DELETE`: 405. |
| `app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts` | Metadata de recurso protegido (RFC 9728), con CORS abierto para `GET`, `HEAD` y `OPTIONS`. |

La metadata:

```json
{
  "resource": "https://<host>/brain/<slug>/mcp",
  "authorization_servers": ["https://<ref>.supabase.co/auth/v1"],
  "bearer_methods_supported": ["header"]
}
```

Un request sin token válido recibe 401 con `WWW-Authenticate: Bearer resource_metadata="<url de la metadata>"`. Es lo que hace el cliente MCP para descubrir el emisor y abrir el login.

El host público sale de una variable de entorno (`PUBLIC_APP_URL`), no del header `Host`, para que la metadata no dependa de lo que mande el cliente.

### 5.2 Request

`lib/brain/mcp-server/` arma el servidor; la ruta solo lo conecta.

1. **Tamaño.** Cuerpo de más de 1 MiB: 413, sin leerlo entero.
2. **Token.** `extractBearerToken` de `eve/channels/auth`, después el verificador (D6). Falla: 401 con el challenge de §5.1.
3. **Claims.** Sin `client_id`: 401 (D7). `sub` es el `userId`.
4. **Tenant.** El slug de la URL contra `tenants`. Inexistente o inactivo: 404.
5. **Acceso.** `platform_admin` pasa siempre. Si no, la membresía del usuario en ese tenant; sin membresía: 403. El rol define el acceso: `read` o `read_write` (D4).
6. **Binding.** `resolveBrainBinding(tenantId)`. Sin brain: 404 con mensaje claro, no una lista de tools vacía.
7. **Servidor.** Uno nuevo por request, con las tools que corresponden al acceso. Cada tool pasa por el límite (§6) y después por `getBrainProvider(binding)`.

El `tenantId` y el `userId` salen solo de los pasos 3 y 4. Nada de lo que venga en los argumentos de una tool los cambia: los esquemas del contrato no tienen esos campos y el parseo descarta claves desconocidas.

### 5.3 Tools

Las mismas tres, con los esquemas de `lib/brain/contract.ts` (§8.1). Diferencias con las del agente:

- `brain_upsert` no pide aprobación (D5). El autor es `{ kind: "user", userId }`.
- `brain_upsert` rechaza un `body` de más de 100 KB con `BrainValidation`, antes de tocar la base.
- Los errores tipados (`BrainNotFound`, `BrainConflict`, `BrainValidation`, `BrainForbidden`) salen como resultado de tool con `isError: true` y el mismo cuerpo que ve el agente hoy (`toToolError`). Un error no tipado sale como `internal` con un id que se loguea, sin detalle.

Si el tenant tiene un brain `mcp` (§7), el endpoint lo sirve igual: pasa por `getBrainProvider` como cualquier otro.

## 6. Límites (E4)

### 6.1 Contador

Tabla `brain_mcp_usage`:

| Columna | Tipo |
|---|---|
| `tenant_id` | `uuid not null references tenants on delete cascade` |
| `user_id` | `uuid not null` |
| `window_start` | `timestamptz not null` (el minuto, truncado) |
| `reads` | `integer not null default 0` |
| `writes` | `integer not null default 0` |

Clave primaria `(tenant_id, user_id, window_start)`. RLS prendida. Lectura: el propio usuario, `tenant_admin` del tenant y `platform_admin`. Escritura: solo `service_role`, por la función.

Función `brain_mcp_hit(p_tenant_id uuid, p_user_id uuid, p_kind text, p_limit integer)`: hace el upsert del minuto actual, incrementa la columna que corresponde y devuelve `allowed boolean` y `retry_after_seconds integer`, en una sola sentencia. `security definer` con `search_path` fijo; `execute` revocado a `anon` y `authenticated`.

El volumen es una fila por usuario activo por minuto. La limpieza de ventanas viejas queda fuera de esta etapa (§12).

### 6.2 Números

En la config del binding del brain, con defaults si no están:

```json
{ "mcpLimits": { "readsPerMinute": 60, "writesPerMinute": 10 } }
```

`parseWikiConfig` y el parser de config `mcp` los aceptan y validan (enteros entre 1 y 1000).

Al pasarse: resultado de tool con `isError: true`, `code: "rate_limited"`, `retryable: true` y `retryAfterSeconds`. No es un 429 a nivel HTTP porque el request MCP en sí es válido; lo que se corta es la llamada a la tool.

`brain_search` y `brain_read` cuentan como lectura; `brain_upsert` como escritura. Listar tools no cuenta.

### 6.3 Tamaños

| Qué | Tope |
|---|---|
| Request MCP entero | 1 MiB |
| `brain_search` | 20 resultados (el de hoy) |
| `brain_read` | la página entera, sin recortar |
| `brain_upsert.body` | 100 KB |

## 7. Proveedor `mcp` (E2)

### 7.1 Catálogo y binding

`lib/connectors/providers.ts`:

```ts
mcp: { capability: "brain", multiple: false, kind: "tool", authKind: "connect_api_key" }
```

Config del binding, validada por `lib/brain/mcp-config.ts`:

```json
{
  "url": "https://brain.cliente.test/mcp",
  "tools": { "search": "brain_search", "read": "brain_read", "upsert": "brain_upsert" },
  "categories": ["company", "comercial"],
  "timeoutMs": 10000,
  "mcpLimits": { "readsPerMinute": 60, "writesPerMinute": 10 }
}
```

- `url` https obligatorio, salvo `localhost` fuera de producción.
- `tools` opcional; por defecto, los nombres de nuestro contrato.
- `categories` obligatorio: el agente las necesita para el enum de `brain_upsert` antes de hablar con el servidor.
- `timeoutMs` entre 1000 y 30000, por defecto 10000.

`scripts/connections-bind.mts` acepta el proveedor nuevo con la misma validación.

### 7.2 Un solo brain por tenant (D9)

Migración: índice único parcial `on tenant_connections (tenant_id) where capability = 'brain' and enabled`. El script de alta traduce la violación a un mensaje en castellano que nombra el brain que ya está habilitado.

`resolveBrainBinding` pasa a devolver una unión:

```ts
type BrainBinding =
  | { id: string; tenantId: string; provider: "wiki"; config: WikiConfig }
  | { id: string; tenantId: string; provider: "mcp"; connectorUid: string; config: McpBrainConfig };
```

Un binding `mcp` sin `connector_uid` o con config inválida se omite con `console.warn`, igual que hoy una config wiki inválida.

### 7.3 Adapter

`lib/brain/mcp.ts` implementa `BrainProvider`:

- Cliente de `@modelcontextprotocol/sdk` sobre Streamable HTTP, uno por operación. El bearer sale de `apiKeyBearer(connectorUid)` en cada llamada; la llave nunca queda en el closure ni en el estado de la sesión.
- Llama a la tool remota con el nombre mapeado y los mismos argumentos del contrato.
- Valida `structuredContent` con zod contra los tipos de `lib/brain/types.ts`. Una respuesta que no valida es `BrainProviderError` con el nombre del campo, no un dato a medias.
- Un resultado remoto con `isError` y un `code` conocido (`not_found`, `conflict`, `validation`, `forbidden`) se traduce al error tipado equivalente. Otro código, timeout o error de red: `BrainProviderError`.
- `upsert` del agente sigue pasando por la aprobación de siempre: esa decisión es nuestra, no del servidor remoto.

`BrainProviderError` es nuevo en `lib/brain/errors.ts` y `toToolError` lo convierte en `{ ok: false, code: "provider_unavailable" }`.

### 7.4 `getBrainProvider`

Pasa a `getBrainProvider(binding)`. Para `wiki` crea el cliente admin adentro; para `mcp`, el adapter. `lib/outreach/canon.ts` y las tools dejan de pasar el cliente.

## 8. Tools para cualquier agente (E1)

### 8.1 Contrato

`lib/brain/contract.ts` exporta, por tool, el esquema zod de entrada y su descripción, parametrizados por las categorías del binding:

```ts
brainContract(categories: string[]): {
  search: { description: string; input: ZodObject };
  read:   { description: string; input: ZodObject };
  upsert: { description: string; input: ZodObject };
}
```

Las descripciones de hoy mencionan la aprobación del administrador; esa frase pasa a la superficie del agente, no al contrato, porque por MCP no aplica (D5).

### 8.2 Tools de eve

`lib/brain/tools.ts`:

```ts
createBrainTools(binding: BrainBinding, access: "read" | "read_write")
```

Devuelve `{ brain_search, brain_read }` o las tres, con `brain_upsert` con `approval: { request: always(), response: decideBrainUpsertResponse(...) }`, igual que hoy.

### 8.3 Declaración por agente

`tenant_agents.config.brain`: `"none" | "read" | "read_write"`. Se lee con el lector que ya usan `lib/agents/model.ts` y `channel-context.ts`, validado con zod. Ausente o inválido: `"none"`, con `console.warn` en el caso inválido.

`agents/outreach/tools/brain.ts` queda así: resolver tenant, leer la declaración, `"none"` o sin binding devuelve `null`, si no `createBrainTools(binding, access)`.

Migración: `update tenant_agents set config = config || '{"brain":"read_write"}' where agent = 'outreach' and not config ? 'brain'`.

## 9. Datos: resumen de migraciones

| Migración | Qué hace |
|---|---|
| `…_tenant_agents_brain_access.sql` | Declara `read_write` en las filas de `outreach` (§8.3) |
| `…_one_brain_per_tenant.sql` | Índice único parcial (§7.2). Antes de crearlo, la migración falla con mensaje claro si algún tenant ya tiene dos brains habilitados |
| `…_brain_mcp_usage.sql` | Tabla, RLS, grants y `brain_mcp_hit` (§6.1) |

Ninguna toca `events`. Todas llevan su test en `supabase/tests/`.

## 10. Tests

**vitest:**

| Archivo | Qué prueba |
|---|---|
| `tests/brain/contract.test.ts` | Categorías del binding en el enum; claves desconocidas descartadas (`tenantId` en los argumentos no pasa) |
| `tests/brain/tools.test.ts` | `none` sin tools, `read` dos, `read_write` tres con aprobación |
| `tests/brain/resolve.test.ts` (existente) | Suma `mcp` válido, `mcp` sin conector, `mcp` con config inválida |
| `tests/brain/mcp-provider.test.ts` | Servidor MCP en proceso con nuestro contrato: las tres operaciones, mapeo de nombres, respuesta mal formada, error remoto tipado, timeout |
| `tests/brain/mcp-server/access.test.ts` | Verificador inyectado: token válido con membresía, sin membresía (403), `platform_admin` en tenant ajeno, `tenant_member` (dos tools), token inválido (401 con challenge), sin `client_id` (401), tenant inexistente (404), tenant sin brain (404) |
| `tests/brain/mcp-server/tools.test.ts` | Cliente del SDK contra el handler: search, read, upsert con autor `user`, conflicto por `baseRevision`, body de más de 100 KB, límite alcanzado con `retryAfterSeconds` |
| `tests/brain/mcp-server/metadata.test.ts` | Forma de la metadata y host desde `PUBLIC_APP_URL` |
| `tests/auth/next-param.test.ts` | `next` relativo aceptado; `//evil`, `/\evil`, `https://evil` y `javascript:` rechazados |
| `tests/agents/running-tool.test.ts` (existente) | Sigue en verde: las tools del brain no cambian de nombre |

**`supabase/tests/`:** RLS de `brain_mcp_usage` (un usuario no lee el contador de otro tenant; `authenticated` no ejecuta `brain_mcp_hit`); la ventana nueva resetea el conteo; el índice rechaza un segundo brain habilitado y acepta uno deshabilitado; la migración de `tenant_agents`.

## 11. Verificaciones contra el proyecto real

Las corre una persona, con login real. Si alguna falla, **se frena y se decide**; no se parcha sobre la marcha.

| # | Qué | Si falla |
|---|---|---|
| V1 | OAuth Server y Dynamic OAuth Apps prendidos; la metadata del emisor responde JSON | Sin esto no hay E3 |
| V2 | La metadata trae `registration_endpoint` | Hay reportes de que falta en algunos proyectos. Sin él, los clientes que descubren por metadata no se registran: evaluar registro manual por cliente |
| V3 | Claims del access token: `sub`, `aud`, `client_id`, `role` | Si falta `client_id`, revisar D7. Si hace falta atar `aud` al recurso, evaluar un Custom Access Token Hook |
| V4 | `getClaims` valida un token de OAuth del proyecto | Si el proyecto firma con HS256, `getClaims` consulta al servidor de Auth en cada request: medir latencia |
| V5 | Claude Code conecta a `/brain/innovas/mcp`, abre el consentimiento y lista las tools | Es el criterio 1 |
| V6 | claude.ai conecta como conector remoto | Si claude.ai no completa el registro, se documenta y no bloquea el cierre si Claude Code funciona |

## 12. Fuera de alcance

- `channels/mcp.ts`: el agente por MCP. Etapa 6.
- **Brain aislado**: el wiki deployado aparte con base propia. Requiere un deploy nuevo y un segundo modo de auth (llave de servicio) en el endpoint. El proveedor `mcp` ya lo deja conectable.
- Traducción a medida para gbrain u otro servidor con otra forma (D10).
- Dos brains a la vez en un tenant (D9).
- Rate limit del Firewall de Vercel (D8).
- Limpieza de ventanas viejas de `brain_mcp_usage`.
- Scopes propios (`brain:read`, `brain:write`): el rol en la membresía ya decide. Se evalúan si un cliente necesita tokens con menos permisos que su rol.
- Búsqueda híbrida con embeddings (spec del brain §6.2).
- Pantalla para ver o revocar los clientes OAuth registrados. Se hace desde el dashboard de Supabase.

## 13. Riesgos

- **El OAuth Server de Supabase está en beta.** Mitigación: V1 a V4 antes de construir E4 sobre supuestos, y el verificador detrás de una interfaz para cambiarlo sin tocar el endpoint.
- **Registro dinámico abierto**: cualquier cliente MCP puede registrarse en el proyecto. No da acceso a nada sin una persona que apruebe en la pantalla de consentimiento y sin membresía en el tenant. Revisar los clientes registrados es tarea de operación.
- **Superficie pública nueva.** Mitigación: tenant y usuario solo desde token y URL, límites por minuto, topes de tamaño, errores sin detalle interno, y en cada PR la pregunta de si algo se puede leer cruzando tenants.
- **`@modelcontextprotocol/sdk` cambia rápido.** Mitigación: versión fija, y el transporte usado queda en un solo archivo.

## 14. Enmiendas

- **`docs/01-roadmap-etapas.md`**: Etapa 11 con esta spec y su plan; sus "decisiones a confirmar" quedan resueltas por D4, D5 y D9; el "brain aislado" pasa a fuera de alcance. Etapa 6: el emisor queda hecho acá, falta `channels/mcp.ts`. Etapa 13: E3 y E4 mergeadas en el PR #47 (el roadmap todavía decía "sin PR").
- **`docs/innovas-agents-kickoff.md`**: la tabla de avance, en el mismo sentido.
- **`docs/superpowers/specs/2026-09-13-brain-design.md`**: §4.4 pasa de "diseñado, no se construye" a construido, con referencia a esta spec.
