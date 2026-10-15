# Etapa 21.6: dominio propio por empresa (la plataforma se sirve desde el dominio del cliente, MCP incluido)

**Fecha:** 2026-10-14
**Estado:** lista para ejecutar. Las decisiones A1 a A3 están resueltas (§3.1) y no queda nada abierto. Caso de referencia: la empresa `okeefe` en `ai.okeefe.com.ar` (§1).
**Rama:** `feat/etapa-21-6a-resolucion-de-host` (corte a), sale de `main`. Esta spec vive en `docs/etapa-21-6-dominio-por-tenant`.
**Antecedentes:** `01-multi-tenant.md` (D2: el tenant vive en la URL y el dominio se suma después mapeando host a slug, sin tocar el modelo), `2026-09-24-etapa-11-brain-mcp-design.md` (OAuth 2.1 y el recurso protegido del brain), `2026-09-27-etapa-6-canal-mcp-design.md` (canal MCP del agente), `2026-10-09-etapa-19-conectar-design.md` (la pantalla `/conectar` y sus URLs), `2026-10-09-etapa-20-login-design.md` (login y método), `2026-10-05-consola-plataforma-design.md` (consola donde se administra). La entrada del roadmap es **21.6** en `docs/producto/roadmap.md`.

## 0. Para quien la ejecuta

Leé primero las secciones 1 y 2: dicen qué hay hoy y qué se rompe. Las secciones 4 a 6 son el diseño y el orden de trabajo. Todo el código se escribe en cortes chicos que se pueden mergear solos (§5).

Antes de tocar nada, cargá:

- `node_modules/eve/docs/README.md` y `node_modules/eve/docs/channels/mcp.mdx` (el canal MCP del agente es un canal de eve).
- `supabase-postgres-best-practices` antes de escribir la migración del corte b. Toda tabla lleva `tenant_id` y RLS; `events` es append-only.
- `docs/arquitectura/identidad-y-acceso.md` y `docs/arquitectura/entornos-y-deploy.md`: explican el login, el OAuth y las variables que esta spec toca.

Reglas del repo que pegan acá, para no tropezar:

- **Nada específico de un cliente en código.** Un dominio es una fila en la base, nunca una constante ni un `if (host === "cliente.com")`.
- **Un cambio de variable de entorno o de ruta falla `npm run docs:check`** hasta que tenga página (las variables del corte b entran en `docs/arquitectura/entornos-y-deploy.md`). Esta spec ya tiene su fila en `docs/decisiones/README.md`; el código nuevo necesita su página en `docs/dominios/plataforma.md` y `docs/arquitectura/entornos-y-deploy.md`. Cerrá con `/docs-wiki` en verde.
- **El canal de eve no importa `next/*`.** `agents/outreach/channels/mcp.ts` compila con `eve build`, que no puede arrastrar `next/navigation` ni `next/headers`. Todo lo que ese canal toque (la resolución de host y de URL pública) vive en `lib/` sin imports de Next. Los tests de Vitest no ven este error: corré `npx eve build` antes de dar el corte por terminado.
- **Español rioplatense** en pantallas e instrucciones; código e identificadores en inglés.

## 1. Qué resuelve

Hoy todos los clientes entran por el mismo host (`agentes.innov.as`, el valor de `PUBLIC_APP_URL` en producción) y se distinguen por el primer segmento de la ruta: `agentes.innov.as/okeefe/chat`. El cliente ve el nombre de INNOV.AS en la barra de direcciones, en los links de invitación, en el link mágico y, sobre todo, en las URLs que pega en Claude, ChatGPT o Codex para conectar su brain y sus agentes: `https://agentes.innov.as/brain/lagomarsino/mcp`.

Queremos que cada empresa pueda usar su propio dominio apuntado a la plataforma, y que **todo lo que la plataforma le muestra o le manda a esa empresa salga con ese dominio**. El caso de referencia es la empresa `okeefe` (slug `okeefe`) con el dominio `ai.okeefe.com.ar`:

| La persona abre | Qué tiene que pasar |
|---|---|
| `https://ai.okeefe.com.ar/login` | La página de login de okeefe, con su marca |
| `https://ai.okeefe.com.ar/chat` | El chat principal de okeefe |
| `https://ai.okeefe.com.ar/brain/mcp` | El endpoint MCP del brain de okeefe: es la URL que cada persona pega en su Claude |

Y alrededor de esas tres:

- Toda la app se sirve con **URLs limpias, sin el slug**: `/`, `/chat`, `/conectar`, `/brain/mapa`, `/settings/usuarios`. Hoy esas rutas son `/okeefe/chat`, etc.
- El agente por MCP queda en `https://ai.okeefe.com.ar/eve/outreach/v1/mcp`, sin `?tenant=`.
- La metadata OAuth de los dos MCP se publica bajo el mismo dominio, porque los clientes MCP exigen que coincida con la URL a la que se conectaron.
- `/conectar` muestra esas URLs, no las del host raíz.
- Los links que se mandan por correo (invitaciones, link mágico) apuntan a ese dominio.
- La empresa que no tiene dominio propio sigue funcionando exactamente igual que hoy, en `agentes.innov.as/<slug>/...` y `/brain/<slug>/mcp`.

Al cerrar esta entrega:

- Una persona de plataforma carga un dominio en la consola de la empresa, le pasa al cliente el registro DNS que tiene que crear, y el dominio queda activo con certificado, sin tocar el panel de Vercel ni el de Supabase.
- Un cliente conecta Claude a su brain pegando una URL que no nombra a INNOV.AS en ningún lado de lo que él controla o lee.
- Ningún camino cruza empresas: un dominio atado a una empresa nunca sirve datos de otra.

Lo que esta spec **no puede** ocultar, y está dicho con todas las letras en §4.7: el emisor OAuth (el dominio del proyecto de Supabase) y la pantalla de consentimiento (que Supabase arma desde su Site URL) son de la plataforma, no de cada empresa.

## 2. Cómo está hoy (verificado en el código el 2026-10-14)

La URL pública se arma en cuatro lugares y los cuatro suponen un único host:

| Pieza | Dónde | Cómo arma el origen hoy |
|---|---|---|
| Recurso protegido del brain por MCP | `lib/brain/core/mcp-server/handler.ts:65-70` (`resourceUrl`, `metadataUrl`), `:78` (`protectedResourceMetadata`) y `:130` (`resource_metadata` del `WWW-Authenticate`) | Recibe `publicUrl` de `BrainMcpDeps`, que sale de `publicSettings()` |
| `publicSettings()` | `lib/brain/adapters/mcp-production.ts:72-90` | `PUBLIC_APP_URL`, y si falta `https://$VERCEL_URL`. Un solo valor para todo el proceso. `issuer` es `NEXT_PUBLIC_SUPABASE_URL/auth/v1` |
| Metadata OAuth del brain y del agente | `app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts`, `app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts:17-18` | `publicSettings().publicUrl` |
| Canal MCP del agente | `agents/outreach/channels/mcp.ts:12-17` | `publicSettings()` **a nivel de módulo**: `resource` queda congelado al compilar |
| URLs que se le muestran a la persona | `app/[tenant]/conectar/page.tsx:42` → `buildConnectables` en `lib/connect/connectables.ts:44-48, 66, 85` | `publicSettings().publicUrl`. Brain: `<origen>/brain/<slug>/mcp`. Agente: `<origen>/eve/<agente>/v1/mcp?tenant=<slug>` |
| Links de invitación, link mágico, landing | `lib/tenants/origin.ts` (`originFrom`), usado en `app/plataforma/nueva/actions.ts:112`, `app/plataforma/[slug]/page.tsx:211`, `app/[tenant]/settings/usuarios/actions.ts:249`, `app/(auth)/login/actions.ts:71` | Header `origin`, si no `x-forwarded-host`/`host`, si no `PUBLIC_APP_URL`. Con el host que usa quien opera, no con el de la empresa invitada |
| Otros | `app/api/invitations/route.ts:65` (`new URL(request.url).origin`), `app/auth/callback/route.ts` (`requestUrl.origin`) | El origen del request |

Además:

- `proxy.ts` solo refresca la sesión de Supabase. Su `matcher` deja afuera `eve/`, `brain/` y `.well-known/`. Por eso las rutas del MCP **no pasan por el proxy** y cualquier chequeo de host tiene que vivir en el handler.
- El tenant del brain sale del **path** (`/brain/[tenant]/mcp`), el del agente de `?tenant=<slug>` (`lib/agents/mcp-channel-auth.ts`). En los dos casos se valida contra `memberships` por el token. El host no interviene.
- El servidor OAuth es el de Supabase Auth; el consentimiento vive en `/oauth/consent` y Supabase arma su URL como **Site URL + Authorization Path** (`docs/arquitectura/entornos-y-deploy.md`). Hay una sola Site URL por proyecto.
- Las cookies de sesión son por host (Supabase SSR no fija `domain`). Dos hosts distintos son dos sesiones distintas.
- `slug` de tenant: `^[a-z][a-z0-9-]{1,38}$`, con una lista de reservados por constraint (`api`, `auth`, `brain`, `eve`, `login`, `oauth`, `sin-acceso`, `plataforma`).

Qué ya funciona sin tocarlo: `safeNextPath` (`lib/auth/next-path.ts`) y `isSameOrigin` (`lib/brain/core/skills/http.ts`) comparan contra el origen del request, así que son correctos en cualquier host.

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| H1 | El dominio de una empresa es **una fila** en una tabla nueva, `tenant_domains`, no una columna de `tenants` | Una empresa puede tener más de uno (el viejo y el nuevo durante una migración), cada uno tiene estado de verificación, y la regla del repo pide `tenant_id` y RLS en toda tabla. Una columna `custom_domain` (la idea del roadmap) no guarda estado ni permite dos |
| H2 | Un dominio de empresa es siempre un **hostname completo y propio** (`ai.okeefe.com.ar`), nunca un comodín ni un apex | El apex exige registros A y no soporta CNAME en muchos proveedores; un comodín exige delegar los nameservers. Pedimos un subdominio con CNAME: lo puede crear cualquiera con acceso al DNS |
| H3 | El host decide el tenant: **un host atado a una empresa solo sirve esa empresa** | Es el aislamiento. En `ai.okeefe.com.ar` no hay forma de nombrar a otra empresa: el slug sale del host y cualquier ruta que intente nombrar otro da 404 |
| H4 | La **ruta interna no cambia**: `app/[tenant]` queda como está y el proxy hace `rewrite` interno | Es la decisión D2: no se toca el modelo. La barra de direcciones muestra `/chat` y la app ve `/okeefe/chat` |
| H5 | El host raíz (`PUBLIC_APP_URL`) sigue sirviendo todo como hoy, incluido `/plataforma` | Cero regresión para las empresas sin dominio y para el equipo de INNOV.AS |
| H6 | La sesión es **por host**. No se comparte con `cookieOptions.domain` | Se conserva el aislamiento de dos pestañas con dos clientes. Compartir cookie entre `ai.okeefe.com.ar` y `agentes.innov.as` es imposible de todos modos (dominios distintos) y entre subdominios de INNOV.AS cambiaría el modelo de seguridad |
| H7 | El login se completa **en el mismo host** donde empezó. Supabase tiene que conocer ese host en su lista de redirects, y la plataforma la mantiene sola | Si el `redirectTo` no está permitido, Supabase cae a la Site URL y el `code` PKCE llega a otro host, que no tiene el verificador: el login falla. La lista se escribe con la Management API (§4.9) |
| H8 | La URL pública de un request **se deriva del host del request y se valida** contra la tabla; nunca se confía en el header sin mirarlo | Un `Host` arbitrario no puede terminar en la metadata OAuth ni en un link de correo (inyección de host) |
| H9 | Los links que la plataforma manda **por una empresa** (invitación, link mágico) salen con el **dominio primario de esa empresa**, no con el host de quien opera | Una persona de plataforma que invita desde `agentes.innov.as` hoy genera un link a `agentes.innov.as`. Con dominio propio tiene que salir el de la empresa |
| H10 | Alta del dominio en Vercel y en Supabase: **solo `platform_admin`**, por API, desde la consola | Es un privilegio de plataforma (consume cuota del proyecto y toca la configuración de Auth). El administrador de la empresa ve el estado y las instrucciones de DNS, no puede cargar dominios |
| H11 | Las rutas **sin empresa** (`/plataforma`, `/oauth/consent`, `/login` sin slug) se sirven solo desde el host raíz | Son de la plataforma. En un host de empresa, `/plataforma` da 404 |
| H12 | Los callbacks de Connect y de los conectores siguen en el **host raíz**, que es el que está registrado en cada proveedor | Cada callback nuevo es una URL más que registrar en Google, HubSpot, etc., por cliente. No escala y no es necesario |
| H13 | En un host de empresa las **URLs visibles no llevan el slug**. Si llega una con slug, el proxy redirige (308) a la forma limpia | Es lo que se pidió (`/login`, `/chat`, `/brain/mcp`). Hoy hay unos 70 `href` que arman `/${tenant}/...`: con la redirección no se toca ninguno. El costo es un salto extra por navegación interna hasta que exista un helper de links (§8) |
| H14 | El endpoint MCP del brain en un host de empresa es **`/brain/mcp`**, sin slug. La forma `/brain/<slug>/mcp` solo existe en el host raíz | El slug sale del host. Dos formas de decir lo mismo en un mismo host abren la puerta a pedir un slug ajeno |

### 3.1 Decisiones resueltas (Mati, 2026-10-14)

- **A1 · El host raíz sigue siendo `agentes.innov.as`** (`PUBLIC_APP_URL` no cambia). Que el cliente vea ese host en el paso del consentimiento OAuth del MCP (§4.7) es aceptable: la URL que pega, el login y la app van por su dominio. Si algún día se quiere un host raíz neutro del producto, es una tarea de operación (variable, Site URL y Redirect URLs) y no cambia el código de esta entrega.
- **A2 · Sin subdominio por cliente** bajo nuestro dominio en esta entrega. Si lo pide un cliente, es la 21.6d: una fila más en `tenant_domains` y un comodín en Vercel.
- **A3 · Solo plataforma carga dominios** (H10). El administrador de la empresa ve el estado y las instrucciones de DNS. Si más adelante tiene que poder pedirlo, se agrega un estado `requested` y una pantalla en `/settings`, sin cambiar el resto.

## 4. Diseño

### 4.1 Modelo de datos (corte a)

Una migración nueva, `supabase/migrations/<timestamp>_tenant_domains.sql`. Cargá `supabase-postgres-best-practices` antes. Hasta el corte b no hay pantalla para cargar filas: se insertan con SQL (service role), y alcanza para probar todo el corte a.

```sql
create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hostname text not null,
  is_primary boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'verifying', 'active', 'failed')),
  last_error text,
  verified_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint tenant_domains_hostname_format
    check (hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
           and char_length(hostname) <= 253),
  constraint tenant_domains_hostname_unique unique (hostname)
);
create unique index tenant_domains_one_primary
  on public.tenant_domains (tenant_id) where is_primary;
create index tenant_domains_tenant_id_idx on public.tenant_domains (tenant_id);
```

Reglas de la migración:

- **RLS prendida.** Lectura para los miembros de la empresa (el administrador ve estado e instrucciones). Escritura: ninguna política para `authenticated`; lo escribe la consola con la service role, como el resto de las escrituras de plataforma. Un pgTAP (`supabase/tests/29_tenant_domains.sql`) prueba que un miembro de otra empresa no lee ni una fila y que nadie con rol `authenticated` inserta.
- **Un hostname, una empresa.** El `unique` cierra que dos empresas reclamen el mismo dominio. El `check` de formato exige minúsculas, sin puerto, sin comodín, sin esquema; la capa de aplicación normaliza antes (minúsculas, `punycode` para IDN, sin punto final).
- **Hostnames prohibidos**, validados en la aplicación (no en SQL, porque dependen de variables): el host raíz de `PUBLIC_APP_URL`, cualquier `*.vercel.app`, cualquier host terminado en el dominio padre del host raíz (hoy `.innov.as`) y `localhost`. Los `*.localhost` (por ejemplo `okeefe.localhost`) se aceptan solo fuera de producción, para probar en local.
- **Un solo primario por empresa**, el que se usa para armar links (H9). El primer dominio activo pasa a primario; cambiarlo es una acción explícita.
- **Función de resolución** `public.resolve_tenant_by_host(p_host text) returns table (slug text, active boolean)`, `security definer`, `stable`, con `search_path` fijado y `execute` solo para `service_role`. Devuelve únicamente dominios `active` de empresas `active`. Es lo único que lee el proxy; no expone la tabla.
- **`events` es append-only.** Alta, verificación y baja de un dominio dejan un evento (`tenant_domain.added`, `tenant_domain.activated`, `tenant_domain.failed`, `tenant_domain.removed`) con el hostname y quién lo hizo. Solo `insert`.
- Correr `npm run db:types` y commitear `lib/supabase/database.types.ts`.

### 4.2 Resolución de host a empresa (corte a)

Un módulo puro, `lib/tenants/host.ts`, **sin imports de Next ni de Supabase**, para que lo usen el proxy, los route handlers y el canal de eve:

```ts
type HostBinding =
  | { kind: "root" }                              // el host de PUBLIC_APP_URL (y localhost en desarrollo)
  | { kind: "tenant"; slug: string }              // un dominio activo de una empresa
  | { kind: "unknown" };                          // cualquier otro

normalizeHost(raw: string | null): string | null  // minúsculas, sin puerto, sin punto final, rechaza lo que no sea hostname
resolveHost(host: string | null, deps: HostDeps): Promise<HostBinding>
requestHost(headers: Headers): string | null      // x-forwarded-host ?? host, normalizado
```

- `HostDeps` inyecta `rootHosts: string[]` (el host de `PUBLIC_APP_URL`, más `localhost` y `127.0.0.1` fuera de producción) y `lookup(host): Promise<string | null>` (el slug, o null). El adaptador de producción (`lib/tenants/host-store.ts`) llama a `resolve_tenant_by_host` con la service role.
- **Caché en memoria** con vencimiento de 60 segundos, que guarda también los "no existe" (si no, un host basura pega contra la base en cada request). Máximo 500 entradas, descarte de la más vieja. Consecuencia declarada: un dominio recién activado o dado de baja tarda hasta un minuto en regir en cada instancia.
- Un host `unknown` **no** se trata como raíz: el proxy responde 404 y los handlers de MCP caen al `PUBLIC_APP_URL` fijo. Esto cubre el caso de un `Host` inventado.
- **Un error del lookup no es un "no existe".** Si la llamada a la base falla, `resolveHost` lanza, el proxy responde 503 para ese host y el error **no se cachea** (si no, una caída de un segundo dejaría un dominio real en 404 durante un minuto). El host raíz nunca consulta la base.

### 4.3 Proxy (corte a)

`proxy.ts` hoy refresca la sesión y listo, y su `matcher` excluye `eve/`, `brain/` y `.well-known/`. Cambia en dos cosas.

**El `matcher` deja de excluir `brain/`.** En un host de empresa las páginas del brain (`/brain/mapa`, `/brain/p/...`) son parte de la app y tienen que pasar por el proxy para reescribirse. Siguen excluidos `_next/static`, `_next/image`, `eve/`, `.well-known/`, `favicon.ico` y las imágenes. Para no cambiar nada en el host raíz, el proxy sale temprano con `NextResponse.next()` (sin tocar Supabase) cuando el host es raíz y la ruta es `/brain/<slug>/mcp`: es el endpoint de hoy, que se autentica por bearer.

**Resolución del host**, antes del refresco de sesión:

1. `requestHost` → `resolveHost`. Si lanza, 503 (§4.2).
2. `root`: sigue como hoy, con la salida temprana de arriba.
3. `unknown`: 404.
4. `tenant(slug)`: aplica la tabla.

Tabla para la empresa `okeefe` (host `ai.okeefe.com.ar`). Se evalúa de arriba abajo:

| Pide el navegador | Qué hace el proxy | La app ve |
|---|---|---|
| `/login/okeefe` | 308 a `/login` | |
| `/okeefe` o `/okeefe/<resto>` | 308 a `/` o `/<resto>`, conservando la query | |
| `/brain/okeefe/mcp` | 404 (H14) | |
| `/plataforma/...`, `/oauth/...` | 404 (H11) | |
| `/` | rewrite | `/okeefe` |
| `/login` | rewrite | `/login/okeefe` |
| `/brain/mcp` | rewrite | `/brain/okeefe/mcp` (el endpoint) |
| `/auth/callback`, `/auth/confirmar`, `/sin-acceso`, `/api/...` | pasa | igual |
| `/chat`, `/conectar`, `/settings/...`, `/brain`, `/brain/mapa`, `/brain/p/...` y cualquier otra | rewrite | `/okeefe/chat`, `/okeefe/brain/mapa`, etc. |
| `/eve/...`, `/.well-known/...` | no pasan por el proxy | El handler resuelve la empresa por host (§4.5) |

Cosas a cuidar:

- **Las redirecciones van primero** y los rewrites son internos: el proxy no se vuelve a ejecutar sobre la ruta reescrita, así que no hay bucle.
- **Los `href` de la app no se tocan** (H13). Un link a `/okeefe/chat` entra, el proxy lo manda a `/chat`, y de ahí al rewrite. También cubre `redirect("/okeefe/...")` de server actions y los destinos que devuelve `completeLogin`. **Spike S5** confirma que la navegación del cliente (`Link`, `router.push`, `redirect()` de una acción) sigue la redirección y deja la URL limpia sin recargar toda la página.
- **`/brain/mcp` y las páginas del brain no chocan**: ninguna página del brain se llama `mcp` (hoy: `editar`, `historial`, `mapa`, `nueva`, `p`, `raw`, `skills`). Si alguna vez se agrega una con ese nombre, hay que elegir otra ruta; un test lo vigila (§6).
- **Los slugs reservados** (`login`, `auth`, `brain`, `eve`, `oauth`, `api`, `sin-acceso`, `plataforma`) son justamente los primeros segmentos que la tabla trata aparte, por eso el constraint de `tenants` ya los prohíbe como slug. Si se agrega una ruta de primer nivel nueva, hay que sumarla a ese constraint y a esta tabla.
- El refresco de sesión de Supabase sigue igual y usa las cookies del host del request.

### 4.4 URL pública por request (corte a)

El corazón del cambio. Se reemplaza el único `publicUrl` global por una resolución por request, en `lib/tenants/public-url.ts` (puro, sin Next):

```ts
// Origen que ve quien llama: el host del request si es raíz o de una empresa; si no, PUBLIC_APP_URL.
publicOriginForRequest(request: Request, deps: HostDeps): Promise<string>

// Origen con el que se manda un link EN NOMBRE de una empresa (H9): su dominio primario activo,
// y si no tiene, PUBLIC_APP_URL.
publicOriginForTenant(tenantId: string, deps: TenantOriginDeps): Promise<string>
```

- `publicOriginForRequest` solo devuelve `https://<host>` cuando `resolveHost` dio `root` o `tenant`. Con `unknown` o sin header devuelve `PUBLIC_APP_URL` (o `https://$VERCEL_URL` como hoy). **Nunca** refleja un host sin validar (H8).
- `publicOriginForTenant` lee el primario de `tenant_domains` (con la misma caché).
- `publicSettings()` pasa a recibir el origen: `publicSettings(origin?: string)`. Sin argumento se comporta exactamente como hoy (lo usa el canal de eve al compilar y las pruebas existentes). Con argumento, `publicUrl = origin`. `issuer` no cambia (§4.7).
- `originFrom(headers)` se mantiene para el caso "link para quien opera" (por ejemplo, la landing que ve una persona de plataforma). Los **links de invitación** (`settings/usuarios/actions.ts` y `api/invitations/route.ts`) pasan a `invitationOrigin(tenantId, fallback)` (`lib/domains/origin.ts`), que devuelve el dominio principal activo de la empresa y, si no tiene o no se puede leer, el origen de siempre. `plataforma/nueva/actions.ts` queda como está: una empresa recién creada no tiene dominio. **El link mágico del login (`(auth)/login/actions.ts`) NO cambia** (corrección a la versión anterior de esta spec): lo pide la persona desde el host donde está y tiene que volver a ese mismo host, porque el verificador PKCE vive en sus cookies; ahí el origen es el del request y lo que hace falta es que ese host esté en las Redirect URLs (§4.9).

### 4.5 URLs de MCP bajo el dominio de la empresa (corte a)

Es el pedido explícito. Para `okeefe`:

| | En su dominio | En el host raíz (como hoy) |
|---|---|---|
| MCP del brain | `https://ai.okeefe.com.ar/brain/mcp` | `https://agentes.innov.as/brain/okeefe/mcp` |
| Metadata OAuth del brain | `https://ai.okeefe.com.ar/.well-known/oauth-protected-resource/brain/mcp` | `.../brain/okeefe/mcp` |
| MCP del agente | `https://ai.okeefe.com.ar/eve/outreach/v1/mcp` | `https://agentes.innov.as/eve/outreach/v1/mcp?tenant=okeefe` |
| Metadata OAuth del agente | `https://ai.okeefe.com.ar/.well-known/oauth-protected-resource/eve/outreach/v1/mcp` | la misma ruta |

El `resource` que publica la metadata tiene que ser **exactamente** la URL a la que el cliente se conectó, y la ruta de la metadata se deriva de la ruta del recurso (RFC 9728). Por eso en un host de empresa el brain publica `resource = https://ai.okeefe.com.ar/brain/mcp` y su metadata vive en `/.well-known/oauth-protected-resource/brain/mcp`. Cinco piezas:

1. **Endpoint del brain.** El proxy ya reescribe `/brain/mcp` a `/brain/okeefe/mcp` (§4.3), así que `app/brain/[tenant]/mcp/route.ts` conserva su ruta. Lo que cambia es el origen y la forma de la URL: `BrainMcpDeps` suma `tenantHost: boolean` y `publicUrl` se calcula por request (`publicOriginForRequest`, §4.4). En `lib/brain/core/mcp-server/handler.ts`, `resourceUrl` y `metadataUrl` (`:65-70`) arman `<publicUrl>/brain/mcp` y `<publicUrl>/.well-known/oauth-protected-resource/brain/mcp` cuando `tenantHost` es verdadero, y las formas con slug de hoy cuando no. `protectedResourceMetadata` (`:78`) y el `WWW-Authenticate` (`:130`) ya consumen esas dos funciones.
2. **Metadata OAuth del brain en un host de empresa.** Ruta nueva, `app/.well-known/oauth-protected-resource/brain/mcp/route.ts`. Es estática y de otra profundidad que `brain/[tenant]/mcp`, así que no choca. Resuelve la empresa por host (`.well-known` no pasa por el proxy); en el host raíz da 404. La ruta con slug de hoy hace lo mismo con el origen por request, hoy lo ignora (`_request`).
3. **Metadata OAuth del agente** (`app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts`): origen por request, sin cambiar la ruta.
4. **Canal MCP del agente.** `agents/outreach/channels/mcp.ts` fija `resource` al origen de la plataforma, como siempre. **No se puede omitir para que eve lo derive** (spike S1, resultado en §6): dentro de eve el `request.url` es el interno (`http://127.0.0.1:<puerto>/eve/v1/mcp` en desarrollo) y la metadata que armaría eve no existe. Lo que depende del dominio es el **desafío 401**: `verifyMcpChannelToken` lo arma con `mcpChallenge` (`lib/agents/mcp-channel-auth.ts`), a partir de `x-forwarded-host`, y apunta `resource_metadata` a `<origen del host>/.well-known/oauth-protected-resource/eve/outreach/v1/mcp`. eve respeta un `resource_metadata` que ya viene en el desafío. La metadata en sí la sigue sirviendo la ruta de Next (punto 3), con el origen por request.
5. **`/conectar`.** `app/[tenant]/conectar/page.tsx:42` pasa el origen por request a `buildConnectables` (`lib/connect/connectables.ts`), que suma `tenantHost: boolean`. En un host de empresa arma `<origen>/brain/mcp` y `<origen>/eve/<agente>/v1/mcp` (sin `?tenant=`); en el host raíz, las de hoy. **Mejora recomendada:** si la empresa tiene dominio primario activo, mostrar siempre las URLs de ese dominio aunque la persona haya entrado por el host raíz (es lo que el cliente va a pegar), con `publicOriginForTenant`. El `id` de cada conectable sigue saliendo del slug (`brain-okeefe`), no del host.

**Validación de host en los handlers** (los endpoints de MCP viven fuera del proxy o detrás de un rewrite; el chequeo no puede depender solo del proxy). `assertHostServesTenant(request, slug)` en `lib/tenants/host.ts`, llamado en:

- `app/brain/[tenant]/mcp/route.ts` (el slug es el que dejó el rewrite),
- `resolveMcpChannelAuth` (`lib/agents/mcp-channel-auth.ts`, el slug es `?tenant=` o el del host),
- y en las rutas `.well-known`.

Regla: si el host es de una empresa, el slug del request **tiene que ser el de esa empresa**; si no, `404` con el mismo cuerpo que "no existe ese cliente" (que no se pueda distinguir de un slug inexistente). Si el host es el raíz, no se valida nada (como hoy). En un host de empresa el `?tenant=` del agente pasa a ser **opcional**: si falta, se toma del host; si viene y no coincide, 404. En el host raíz sigue siendo obligatorio.

### 4.6 Sesión y login por host (corte b)

- La sesión es por host (H6). Una persona que pertenece a dos empresas con dominio propio inicia sesión en cada una. Los links entre empresas (el selector de empresa, si existe) cruzan de host y piden login; es esperado y se documenta.
- **Login por correo con código**: no usa redirect, anda en cualquier host sin cambios.
- **Link mágico y Google/Microsoft**: usan `redirectTo = <origen>/auth/callback?...`. El origen sale de `originFrom`, que en una acción del navegador ya trae el host correcto. Lo que falta es que Supabase **permita** ese host (§4.9).
- `app/auth/callback/route.ts` usa `requestUrl.origin`, que ya es el host del request; no cambia. Hay que probar que `exchangeCodeForSession` encuentra el verificador PKCE en las cookies del host de empresa.
- `completeLogin` (`lib/auth/complete-login.ts`) devuelve una ruta del tipo `/<slug>/...` o `/login/<slug>`. En un host de empresa eso sigue siendo válido (el proxy acepta el prefijo). Verificar que ningún destino lleve a `/plataforma` (la persona de plataforma que entra por un host de empresa cae en la landing de esa empresa, no en la consola).

### 4.7 OAuth del MCP: qué se oculta y qué no

El flujo de un cliente MCP (Claude, ChatGPT, Codex):

1. Pega `https://ai.okeefe.com.ar/brain/mcp`. **Dominio de la empresa.**
2. Pide la metadata en `https://ai.okeefe.com.ar/.well-known/oauth-protected-resource/brain/mcp`. **Dominio de la empresa** (§4.5).
3. La metadata nombra el servidor de autorización: `https://<proyecto>.supabase.co/auth/v1` (`issuer`). **Dominio de Supabase. No es de la empresa ni de INNOV.AS.** La persona normalmente no ve esa URL; el cliente MCP la usa por detrás.
4. Supabase redirige a la pantalla de consentimiento: **Site URL + `/oauth/consent`**, es decir, el host raíz. **Esta pantalla se ve**, y es `agentes.innov.as`. La persona inicia sesión ahí (sesión del host raíz) y aprueba.
5. El código vuelve al cliente MCP; el cliente usa el token contra `https://ai.okeefe.com.ar/brain/mcp`.

Consecuencia: **la URL que se pega y la que usa el cliente MCP son del dominio de la empresa; el paso del consentimiento es el único que pasa por el host raíz.** Esto es una limitación de Supabase (una sola Site URL por proyecto), no de nuestro código. Opciones, de menor a mayor esfuerzo:

- **Aceptarla** (decisión A1). Es lo que se hace.
- Poner un **dominio propio de Supabase** (add-on de pago) para el emisor, para que el paso 3 deje de mostrar `supabase.co`. Es global, no por empresa.
- Emitir tokens con un servidor OAuth propio por host. Fuera de alcance: es construir un servidor de autorización.

El consentimiento no sabe de qué empresa viene el pedido (solo recibe `authorization_id`), así que **no puede** llevar la marca de la empresa. No intentarlo en esta entrega.

### 4.8 Alta del dominio: Vercel y DNS (corte b)

Adaptador `lib/domains/vercel.ts` (con interfaz inyectable, como los demás adaptadores del repo) sobre la API REST de Vercel:

- Agregar el dominio al proyecto, consultar su estado/verificación y quitarlo. Los endpoints concretos y la forma de la respuesta **se confirman contra la documentación vigente de Vercel en el spike S2**, no se asumen de memoria; la API cambia de versión (`v9`/`v10`).
- Variables nuevas, **solo servidor y solo producción**: `VERCEL_API_TOKEN` (token con alcance al proyecto), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`. Se documentan en `docs/arquitectura/entornos-y-deploy.md`. Nunca llegan al navegador ni a un log.
- **Instrucción de DNS para el cliente.** La consola muestra lo que el cliente tiene que crear: un registro `CNAME` de `ai.okeefe.com.ar` al valor que devuelva Vercel para el proyecto (el valor se lee de la API/respuesta, no se escribe a mano en el código). Si Vercel pide además un registro `TXT` de verificación (cuando el dominio ya está en otra cuenta), se muestra también. El texto de la instrucción está en el Anexo A.
- **Estados:** `pending` (cargado, sin registrar en Vercel), `verifying` (en Vercel, esperando DNS), `active` (verificado y con certificado), `failed` (con `last_error` legible). El paso `verifying → active` lo hace una **verificación a pedido** (botón "Verificar ahora") y un **barrido periódico** (un `defineSchedule` de eve, o un cron del proyecto, cada 5 minutos, solo sobre filas `verifying`). Mientras no esté `active`, `resolve_tenant_by_host` no devuelve la fila: el dominio no sirve nada.
- Dar de baja: sacar el dominio de Vercel, borrar la fila, resincronizar Supabase (§4.9) y dejar el evento.

### 4.9 Lista de redirects de Supabase (corte b)

Cada dominio activo tiene que figurar en las Redirect URLs de Supabase Auth (H7). Un adaptador `lib/domains/supabase-auth.ts` usa la Management API (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`; mismas reglas que las variables de Vercel).

Diseño para que no se pise: la lista se escribe **entera, derivada de la base**, nunca "agregar uno":

```
syncAuthRedirectUrls():
  urls = [raíz + "/auth/callback**", raíz + "/oauth/consent**" , ...fijas de hoy]
  para cada tenant_domains con status = 'active':
      urls += "https://<hostname>/auth/callback**"
  PATCH config/auth { uri_allow_list: urls.join(",") }
```

Idempotente y sin carreras: dos altas casi simultáneas escriben la misma lista completa. Se llama al activar y al dar de baja un dominio. **Antes de escribir, leer la lista actual y conservar las entradas que no empiezan con un host de `tenant_domains`** (las que cargó una persona a mano en el panel), para no borrar configuración ajena.

El `Site URL` **no cambia** (queda el host raíz).

### 4.10 Consola (corte b)

En `app/plataforma/[slug]/page.tsx`, una sección **"Dominio"** (entre "Brain" y "Conectores"), solo para `platform_admin`:

- Lista de dominios de la empresa con su estado, el primario marcado y el último error.
- "Agregar dominio": un campo, validación en el servidor (§4.1), llamada a Vercel, fila en `verifying`, y muestra la instrucción de DNS (Anexo A) para copiar.
- "Verificar ahora", "Hacer primario", "Quitar".
- Todas son server actions que re-verifican el rol en el servidor (no solo ocultan el botón) y dejan su evento.

En `/[tenant]/settings` (administrador de la empresa), una línea **solo lectura**: "Tu dominio: ai.okeefe.com.ar (activo)". Sin acciones (A3).

Textos en español rioplatense. Una pantalla nueva sigue la guía `docs/guias/agregar-una-pantalla.md`; probarla en 375 px.

### 4.11 Seguridad: lo que hay que no romper

- **Host header.** Ningún origen se arma con un host sin validar (H8). Test: `Host: evil.com` contra `/.well-known/...` devuelve la URL de `PUBLIC_APP_URL`, nunca `evil.com`.
- **Cross-tenant por host.** En `ai.okeefe.com.ar`, `/lagomarsino/chat` termina en 404 (el proxy lo lee como una ruta de okeefe que no existe), `/brain/okeefe/mcp` da 404 (H14) y un pedido directo al handler con otro slug da 404 por `assertHostServesTenant` (§4.5). Test explícito de los tres.
- **Takeover de dominio.** Quitar el dominio de Vercel al darlo de baja. Un hostname cargado pero no verificado no sirve nada (H3 + la función solo devuelve `active`). Un cliente no puede cargar el dominio de otro: lo carga plataforma y el `unique` lo corta.
- **Cookies.** No se fija `domain` en las cookies de Supabase. Verificar que no se haga en ningún `createServerClient`.
- **Server actions.** Next compara `Origin` contra el host del request; con un dominio propio detrás del proxy de Vercel hay que probar que las acciones (login, invitaciones, settings) siguen aceptándose. Si fallara, el ajuste va en `serverActions.allowedOrigins`, que se alimenta de la misma tabla (no de una lista fija en `next.config.ts`).
- **`safeNextPath`** sigue descartando todo lo que no sea del mismo origen. No relajarlo.
- **Caché de la resolución**: lo único que se cachea es host → slug. Nunca datos de la empresa.

## 5. Entrega en tres cortes

Cada corte se mergea solo y deja el producto andando. El corte a concentra el riesgo y deja todo el comportamiento de cara al cliente funcionando; el b lo vuelve operable sin terminal.

### 21.6a · Tabla, resolución de host, proxy y URLs de MCP

Es el corte más grande y el que más riesgo de regresión tiene. No necesita las decisiones abiertas. Sin filas en `tenant_domains` no cambia nada en producción.

1. Migración `tenant_domains` y `resolve_tenant_by_host`, eventos, pgTAP, `db:types` (§4.1).
2. `lib/tenants/host.ts`, `lib/tenants/public-url.ts` y `lib/tenants/host-store.ts` (§4.2, §4.4), puros y con tests de unidad.
3. `proxy.ts`: matcher y tabla de §4.3.
4. Los cinco puntos de §4.5, incluido el nuevo `app/.well-known/oauth-protected-resource/brain/mcp/route.ts`, y el canal de eve según el spike S1.
5. `assertHostServesTenant` en los endpoints de MCP y en las rutas `.well-known`.
6. `/conectar` con el origen por request y `tenantHost`.
7. Tests (§6). Los existentes (`tests/brain/mcp-server/production.test.ts`, `tests/tenants/origin.test.ts`) siguen verdes sin modificarse: `publicSettings()` sin argumento no cambia.

Se prueba de punta a punta en local con `okeefe.localhost` y una fila insertada a mano (§6). En producción, el primer cliente se puede habilitar ya con el dominio cargado a mano en Vercel y en las Redirect URLs de Supabase y la fila por SQL, si no se quiere esperar al corte b.

### 21.6b · Operación sin terminal: consola, Vercel, Supabase y correos

Sin decisiones pendientes (A1 a A3 resueltas, §3.1).

1. Adaptadores de Vercel y de Supabase Auth (§4.8, §4.9) con interfaces inyectables y dobles de prueba.
2. Sección "Dominio" en la consola y línea de solo lectura en settings (§4.10).
3. Verificación a pedido y barrido periódico.
4. Links por correo con el dominio de la empresa (H9), solo en las invitaciones.

### 21.6c · Cierre en producción

Operación, no código (§7): variables, primer dominio real, verificación de punta a punta y la página de la wiki.

## 6. Tests y spikes

**Spikes (se hacen antes de escribir el código que depende de cada uno; el resultado se anota en un párrafo al pie de este apartado, con fecha):**

- **S1 · `resource` del canal de eve.** ¿`oauthResource` sin `resource` deriva la URL del request, detrás del reverse proxy de Vercel, con el host público? Probar con `eve build` + una request con `X-Forwarded-Host`. Decide si §4.5 punto 4 es "omitir `resource`" o un `AuthFn` propio. **Resultado (2026-10-14, desarrollo): no sirve omitirlo.** Sin `resource`, eve deriva el origen y la ruta del request interno (`http://127.0.0.1:63104/eve/v1/mcp`), no del público; el 401 apuntaba a una metadata inexistente. Al canal solo le llega `x-forwarded-host` con el host público (sin `x-forwarded-proto`). Se resolvió armando el desafío en `mcpChallenge` y dejando `resource` fijo. **Verificado en producción (2026-10-15, con `ai.okeefe.com.ar`):** `POST /eve/outreach/v1/mcp` sin token devuelve 401 con `resource_metadata="https://ai.okeefe.com.ar/.well-known/oauth-protected-resource/eve/outreach/v1/mcp"`, o sea que `x-forwarded-host` llega al canal también en Vercel.
- **S2 · API de dominios de Vercel.** Endpoints vigentes, forma de la respuesta de verificación, qué valor de CNAME devuelve, límites de dominios por proyecto y si el plan actual del equipo permite el volumen esperado. Confirmar contra la doc oficial, no contra memoria. **Resultado (2026-10-14, documentación oficial vigente):** agregar es `POST /v10/projects/{id}/domains` (`{name}`; devuelve `verified` y, si falta, `verification[]` con el desafío TXT; un dominio ya presente en el proyecto devuelve 400 y uno de otro proyecto 409); consultar, `GET /v9/projects/{id}/domains/{domain}`; verificar, `POST /v9/.../verify` (400 si todavía no hay TXT); quitar, `DELETE /v9/.../{domain}`; y la configuración de DNS, `GET /v6/domains/{domain}/config?projectIdOrName=`, que devuelve `recommendedCNAME[]` (rank 1 es el preferido), `configuredBy` (null si no resuelve a Vercel) y `misconfigured` (falso solo si está configurado **y** se puede emitir el certificado). Todos aceptan `teamId`. Un dominio está listo cuando `verified` y `configuredBy != null` y `!misconfigured`. **Verificado en producción (2026-10-15):** el alta con el token real anduvo; Vercel devolvió el `CNAME` (`<id>.vercel-dns-017.com`) y, porque `okeefe.com.ar` ya figuraba en otra cuenta, el desafío `TXT` `_vercel` que la consola muestra al cliente. Sin verificar: el límite de dominios por proyecto del plan del equipo.
- **S3 · Management API de Supabase Auth.** Confirmar el campo de la lista de redirects, que el `PATCH` reemplaza la lista completa y que el token requerido es el de cuenta (no el service role). **Resultado (2026-10-14):** `GET` y `PATCH /v1/projects/{ref}/config/auth`, campo `uri_allow_list` (string), con el scope `auth_config_write` y bearer de cuenta. La doc **no dice** si el `PATCH` reemplaza el valor entero ni cómo se separan las entradas: se asume reemplazo y coma (como GoTrue), y por eso el adaptador lee, conserva lo ajeno, escribe y **vuelve a leer para confirmar**; si Supabase no guardó lo pedido falla y el dominio no se activa. **Verificado en producción (2026-10-15), al activar el primer dominio:** el `PATCH` conserva las entradas existentes y agrega la nueva: las cuatro `https://` que se anotaron antes siguen y la lista quedó en 8 (con `https://ai.okeefe.com.ar/auth/callback**` al final; las de `localhost` no se habían anotado antes de activar) y la Site URL quedó en `https://agentes.innov.as`. El adaptador releyó y confirmó antes de activar. No se hizo la prueba aislada en un proyecto aparte: el primer dominio real fue la prueba, con la lista anterior anotada del dashboard como respaldo.
- **S4 · PKCE en un host propio.** Con un dominio de prueba real, completar un login con link mágico y con Google, y confirmar que `exchangeCodeForSession` encuentra el verificador. Es el riesgo funcional más grande de la entrega. **Resultado (2026-10-15, `ai.okeefe.com.ar`): el login con Google anda** (lo confirmó Mati; `/login` sirve la landing de O'Keefe con su marca) **y la conexión de Claude por MCP anda** (también según Mati, que no precisó si fue al brain, al agente o a ambos). No se registró dónde aterrizó el consentimiento OAuth. **Sin verificar: el link mágico**, porque la landing de okeefe solo ofrece Google; cuando una empresa con código por correo cargue su dominio hay que probarlo (la entrada `/auth/callback**` ya queda en la lista).
- **S5 · Redirección a la URL limpia.** En un host de empresa, probar que un `Link` a `/okeefe/chat`, un `router.push` y el `redirect()` de una server action terminan en `/chat` sin recarga completa, que un `POST` de server action sobre una URL con slug conserva método y cuerpo, y cuánto cuesta el salto extra. Si la navegación del cliente no lo maneja bien, el plan B es el helper de links que está en §8 y pasa a ser parte del corte a. **Resultado (2026-10-14, navegador contra `okeefe.localhost`): anda.** Un clic en un link a `/okeefe/conectar` termina en `/conectar` con la página sin recargar (un marcador en `window` sobrevive), una entrada directa a `/okeefe/conectar` termina en `/conectar`, y el login por código aterriza en `/chat`. Sin verificar: el `POST` de una server action sobre una URL con slug y el costo medido del salto.

**Tests automáticos (Vitest, en `tests/tenants/` y `tests/brain/mcp-server/`):**

- `normalizeHost`: mayúsculas, puerto, punto final, IDN, entradas basura (`""`, `"a b"`, `"a/b"`, `"host:80:90"`).
- `resolveHost`: raíz (no consulta la base), empresa, desconocido; la caché devuelve sin ir a la base; la caché negativa; vencimiento a los 60 s; tope de 500 entradas.
- `publicOriginForRequest`: host raíz, host de empresa, host inventado (devuelve `PUBLIC_APP_URL`), sin header, `x-forwarded-host` con varios valores.
- Metadata del brain y del agente por host: en un host de empresa, `resource` es `<host>/brain/mcp` (y `<host>/eve/outreach/v1/mcp`) y `resource_metadata` el `.well-known` correspondiente; en el host raíz, la forma con slug de hoy; con un host inventado, la del `PUBLIC_APP_URL`.
- `assertHostServesTenant`: host de empresa + slug propio pasa; + slug ajeno da 404 indistinguible de "no existe"; host raíz no valida.
- `buildConnectables`: con `tenantHost`, la URL del brain es `<origen>/brain/mcp` y la del agente no lleva `?tenant=`; sin él, las de hoy.
- `resolveMcpChannelAuth`: `?tenant=` ausente en un host de empresa se toma del host; ausente en el raíz sigue dando el error actual.
- Que cada link de invitación use el dominio de la empresa (`invitationOrigin`): la ruta `/api/invitations` y el reenvío desde `/settings/usuarios`. El link mágico del login **no** (§4.4).
- `proxy.ts`: la tabla de §4.3, fila por fila (incluye las dos redirecciones 308 con query, `/plataforma` y `/brain/okeefe/mcp` dando 404, y que en el host raíz `/brain/<slug>/mcp` sale temprano sin tocar Supabase).
- Que no exista una página del brain llamada `mcp` (lista los directorios de `app/[tenant]/brain/`): `/brain/mcp` quedaría ambiguo.

**pgTAP:** `supabase/tests/29_tenant_domains.sql` (RLS, `unique`, un solo primario, `resolve_tenant_by_host` solo devuelve `active` de empresas activas, `anon` y `authenticated` no ejecutan la función).

**Navegador (verificación obligatoria, no se da por hecho con los tests):**

- Los hosts `*.localhost` resuelven a `127.0.0.1` sin tocar `/etc/hosts`. Con `npm run dev`, un tenant de prueba y una fila en `tenant_domains` (`okeefe.localhost`), probar en `http://okeefe.localhost:3000`: `/login` (login de okeefe), `/chat` (el chat), `/brain/mapa`, `/conectar` (las URLs tienen que ser `http://okeefe.localhost:3000/brain/mcp` y `.../eve/outreach/v1/mcp`), que `/okeefe/chat` termine en `/chat`, un slug ajeno (404), `/plataforma` (404), y el host raíz sin regresión (`localhost:3000/okeefe/chat` y `/brain/okeefe/mcp` como hoy).
- `npx eve build` limpio.
- Un cliente MCP real (Claude Code: `claude mcp add --transport http okeefe-brain https://ai.okeefe.com.ar/brain/mcp`) contra el dominio de prueba, hasta el consentimiento. Anotar en qué host aterriza el consentimiento (§4.7).
- 375 px en la sección nueva de la consola.

## 7. Cierre en producción (21.6c)

Lo hace una persona con acceso, en este orden:

1. `npx supabase migration list` y revisar que no haya ajenas pendientes (`db push` aplica todas). **Migración antes que código** (corte a): la función `resolve_tenant_by_host` tiene que existir antes de que el proxy nuevo la llame; con el código nuevo y la base vieja, el lookup falla.
   - Aun así, el host raíz no depende de la base (§4.2): con el código nuevo y la base vieja, las empresas sin dominio siguen andando; solo fallan (503) los hosts de empresa, que todavía no existen.
2. Cargar en Vercel (solo Production) `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (las cinco son del corte b).
3. Desplegar el corte a y verificar que el host raíz y las empresas sin dominio siguen igual (regresión).
4. Cargar el primer dominio real desde la consola, pasarle el Anexo A al cliente y esperar `active`.
5. Recorrer en ese dominio: login (código y link), chat, `/conectar`, conexión real de Claude al brain, y una invitación (el link tiene que salir con el dominio de la empresa).
6. Documentar en la wiki (`docs/dominios/plataforma.md`, `docs/arquitectura/entornos-y-deploy.md`, `docs/arquitectura/identidad-y-acceso.md`) y una guía `docs/guias/dominio-de-un-cliente.md` con el Anexo A. `/docs-wiki` en verde.

Una etapa no se cierra sin eso. El estado de la fila de esta spec en `docs/decisiones/README.md` pasa de "en curso" a "cerrada" con las páginas de la wiki nombradas.

## 8. Fuera de alcance

- Subdominio por cliente bajo un dominio de la plataforma (A2); comodines y apex.
- Un helper de links (`appHref(tenant, path)`) que emita las URLs limpias directamente y evite el salto 308 de H13. Pasa a ser parte del corte a si el spike S5 lo exige.
- Marca de la empresa en la pantalla de consentimiento (§4.7).
- Correo de Supabase Auth con remitente y dominio de la empresa (SMTP propio por cliente).
- Servidor OAuth propio por host.
- Que el administrador de la empresa cargue su dominio (A3).
- Certificados propios: los emite Vercel.

## 9. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El canal MCP de eve deriva mal el `resource` detrás del proxy | Los clientes MCP rechazan la conexión en dominios propios | Spike S1 antes de escribir el corte a; plan B con `AuthFn` propio |
| `redirectTo` no permitido: el link mágico o Google cae en el host raíz | Login roto en un dominio nuevo | Sincronización completa de la lista (§4.9) y spike S4 con un dominio real |
| El lookup del proxy depende de la base en cada navegación | Una caída de la base tira las empresas con dominio propio (503) | Caché de 60 s que no guarda errores; el host raíz nunca consulta la base (§4.2) |
| `/brain/mcp` ambiguo con las páginas del brain, y el `matcher` ahora incluye `brain/` | Una página del brain inalcanzable, o el MCP del host raíz pasando por Supabase | `/brain/mcp` es el endpoint y no existe una página con ese nombre (test); el host raíz sale temprano en `/brain/<slug>/mcp` (§4.3) |
| El 308 a la URL limpia no lo sigue bien la navegación del cliente | Recargas completas o URLs con slug visibles | Spike S5; plan B: helper de links (§8) |
| El consentimiento OAuth muestra el host raíz | El cliente ve `agentes.innov.as` en un paso | Decisión A1 y §4.7; aceptado, documentado en la guía del cliente |
| `PATCH` de Redirect URLs pisa entradas manuales | Se rompe un redirect que no es nuestro | Escribir conservando las entradas que no son de `tenant_domains` (§4.9) |
| Cuota de dominios del plan de Vercel | No se pueden cargar más dominios | Spike S2: confirmar el límite antes de comprometerse con un cliente |

## Anexo A · Qué le decimos al cliente

> **Para usar la plataforma desde tu propio dominio**
>
> 1. Elegí un subdominio de tu empresa, por ejemplo `ia.tuempresa.com`. No uses el dominio sin subdominio (`tuempresa.com`).
> 2. Pedile a quien administra tu DNS que cree este registro:
>    - Tipo: `CNAME`
>    - Nombre: `ia`
>    - Valor: _(el que muestra la consola de plataforma para tu empresa)_
>    - Si tu proveedor de DNS lo pide, TTL de 5 minutos.
> 3. Avisanos cuando esté creado. En unos minutos el dominio queda activo con su certificado.
> 4. A partir de ahí tu equipo entra por `https://ia.tuempresa.com` y las conexiones a Claude o ChatGPT usan esa dirección.
>
> Una cosa a tener en cuenta: cuando alguien conecta Claude o ChatGPT por primera vez, la pantalla de autorización que aparece es la de la plataforma (no la de tu dominio). Es normal y pasa una sola vez por persona.

## Anexo B · Inventario de lugares que hay que tocar

| Archivo | Cambio | Corte |
|---|---|---|
| `lib/tenants/host.ts` (nuevo) | `normalizeHost`, `resolveHost`, `requestHost`, `assertHostServesTenant`, caché | a |
| `lib/tenants/public-url.ts` (nuevo) | `publicOriginForRequest`, `publicOriginForTenant` | a |
| `lib/tenants/host-store.ts` (nuevo) | Lookup contra `resolve_tenant_by_host` | a |
| `lib/brain/adapters/mcp-production.ts` | `publicSettings(origin?)`, `productionDeps({ publicUrl })` | a |
| `app/brain/[tenant]/mcp/route.ts`, `lib/brain/core/mcp-server/handler.ts` | Origen por request, `tenantHost` (`resourceUrl`/`metadataUrl` sin slug) y `assertHostServesTenant` | a |
| `app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts` | Origen por request | a |
| `app/.well-known/oauth-protected-resource/brain/mcp/route.ts` (nuevo) | Metadata del brain en un host de empresa | a |
| `app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts` | Origen por request | a |
| `agents/outreach/channels/mcp.ts`, `lib/agents/mcp-channel-auth.ts` | `resource` fijo; el desafío 401 sale por request con `mcpChallenge` (S1). Sin `next/*` | a |
| `lib/agents/mcp-channel-auth.ts` | `?tenant=` opcional en host de empresa; `assertHostServesTenant` | a |
| `lib/connect/connectables.ts`, `app/[tenant]/conectar/page.tsx` | Origen por request; `tenantHost`; brain en `/brain/mcp` y agente sin `?tenant=` | a |
| `proxy.ts` | `matcher` sin `brain/`, resolución de host, redirecciones y rewrites (§4.3) | a |
| `supabase/migrations/<ts>_tenant_domains.sql`, `supabase/tests/29_tenant_domains.sql` | Tabla, RLS, función, pgTAP | a |
| `lib/domains/vercel.ts`, `lib/domains/supabase-auth.ts` (nuevos) | Adaptadores con interfaz inyectable | b |
| `app/plataforma/[slug]/page.tsx` y sus actions | Sección "Dominio" | b |
| `app/[tenant]/settings/` | Línea de solo lectura | b |
| `app/[tenant]/settings/usuarios/actions.ts`, `app/api/invitations/route.ts` | `invitationOrigin` (`lib/domains/origin.ts`) en los links de invitación | b |
| `docs/dominios/plataforma.md`, `docs/arquitectura/entornos-y-deploy.md`, `docs/arquitectura/identidad-y-acceso.md`, `docs/guias/dominio-de-un-cliente.md` | Documentación | c |
