---
title: Conectores
category: dominios
status: activo
tags: [conectores, vercel-connect, oauth, api-key, consola]
updated: 2026-10-13
sources:
  - lib/connectors/providers.ts
  - lib/connectors/auth.ts
  - lib/connectors/catalog.ts
  - lib/connectors/bindings.ts
  - lib/connectors/resolve.ts
  - lib/connectors/executors.ts
  - lib/connectors/verify.ts
  - lib/connect/connectables.ts
  - lib/accounts/status.ts
  - agents/outreach/connections/tenant.ts
  - app/[tenant]/conectar/page.tsx
  - app/[tenant]/mis-cuentas/page.tsx
  - supabase/migrations/20260913221734_tenant_connections_executors.sql
  - supabase/migrations/20261015120000_platform_console.sql
  - docs/guias/llaves-de-clientes.md
  - docs/superpowers/specs/02-conexiones-innovas.md
  - docs/superpowers/specs/2026-10-09-etapa-19-conectar-design.md
  - docs/superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md
---

# Conectores

## 1. Qué es y para qué

Un conector es la forma en que una empresa (tenant) le presta al agente una herramienta externa: su CRM, sus fuentes de prospectos, su casilla de mail, su brain. La regla de fondo es que **ningún secreto vive en el código, en las variables de entorno ni en nuestra base**: las credenciales están en Vercel Connect y la base guarda solo el identificador (no secreto) del conector y quién lo usa. Sumar un proveedor es una entrada de catálogo; dárselo a una empresa es una fila.

Hay dos modelos de autenticación. Los proveedores de llave de API (ColdIQ, Apollo, Google Places, el MCP del brain) usan un conector de Connect **por empresa y proveedor**, que Connect entrega como "app". Los de OAuth (HubSpot, Gmail) usan un conector **de plataforma** y el grant es por persona. Alrededor de esto hay tres pantallas: la consola de plataforma asocia conectores a empresas (ver [plataforma](plataforma.md)), `/[tenant]/conectar` le muestra a cada persona qué puede enchufar a su Claude o ChatGPT, y `/[tenant]/mis-cuentas` le deja autorizar sus cuentas OAuth.

## 2. Dónde vive en el código

| Archivo | Qué hace |
|---|---|
| `lib/connectors/providers.ts` | Registro puro de proveedores (capacidad, si admite varios, si es conexión de eve o tool, tipo de auth), `connectionName`, `acceptsManyUids` |
| `lib/connectors/auth.ts` | **Único** archivo que importa `@vercel/connect`: headers de API key, `tenantScopedConnect`, `tokenForSubject`, `startAuthorizationForSubject`, `describeConnector`, predicados de error |
| `lib/connectors/catalog.ts` | Builders por proveedor: devuelven la definición de conexión de eve a partir de un binding |
| `lib/connectors/bindings.ts` | `loadTenantBindings` y `hasEnabledBinding` (lee `tenant_connections` con service role) |
| `lib/connectors/resolve.ts` | `resolveTenantConnections`: bindings a conexiones, sin efectos |
| `agents/outreach/connections/tenant.ts` | El resolver dinámico de eve (`session.started`) |
| `lib/connectors/executors.ts` | `markGmailAuthorized`, `markCrmOwner` sobre `executors` |
| `lib/connectors/verify.ts`, `env.ts` | Verificación contra Vercel antes de asociar; `inVercel()` |
| `lib/connectors/platform.ts` | Identificadores de plataforma verificados en el spike (URL del MCP de HubSpot, uid del conector de HubSpot y de Google, tools de solo lectura) |
| `lib/connect/` | Página Conectar: `connectables.ts` (qué ofrece cada empresa), `instructions.ts` (pasos por cliente), `copy.ts` |
| `lib/accounts/status.ts` | Estado de cada cuenta en Mis cuentas, puro |
| `app/[tenant]/conectar/`, `app/[tenant]/mis-cuentas/` | Las dos pantallas del miembro |
| `app/plataforma/[slug]/console/connections-section.tsx`, `bind-form.tsx`, `console-actions.ts` | La consola que asocia, verifica, deshabilita y quita |

## 3. Cómo funciona

### Capacidades y proveedores

Una capacidad es lo que el agente necesita (`crm`, `leads`, `enrichment`, `brain`, `mail`); un proveedor es quién la cumple. El catálogo `PROVIDERS` tiene siete claves:

| Clave | Capacidad | Tipo | Auth |
|---|---|---|---|
| `hubspot` | `crm` | conexión de eve (MCP, solo lectura) | `connect_oauth` |
| `wiki` | `brain` | tool propia | ninguna (es el brain de la empresa) |
| `mcp` | `brain` | tool propia | `connect_api_key` |
| `coldiq` | `leads` | conexión de eve (OpenAPI) | `connect_api_key` |
| `apollo` | `leads` | conexión de eve | `connect_api_key` |
| `google-places` | `leads` | conexión de eve (OpenAPI, solo `searchText`) | `connect_api_key` |
| `gmail` | `mail` | tool propia (`send_email`, ver [gmail](gmail.md)) | `connect_oauth` |

La clave `provider` de `tenant_connections` es texto validado en código, no un enum: sumar un proveedor no pide migración. Solo `apollo` acepta varios identificadores de Connect (`config.connectorUids`); los demás llevan exactamente uno (regla en la app y en la base, `platform_bind_connection`).

### `tenant_connections` y `connector_claims`

`tenant_connections` es un binding por `(tenant_id, capability, provider)`: `connector_uid`, `config` no secreta, `enabled`, y desde la consola `verified_at`, `verified_name` y `locked_by_platform`. La RLS deja leer a los miembros y no deja escribir a nadie desde la sesión: toda escritura pasa por funciones `security definer` (`platform_bind_connection`, `platform_set_connection_enabled`, `platform_remove_connection`, `platform_mark_connection_verified`, solo `service_role`; y `set_connection_enabled` para el administrador del cliente).

`connector_claims` garantiza que **un identificador de Connect pertenece a una sola empresa**: la clave primaria es el `connector_uid`. Asociar un uid ya reclamado por otra empresa (o por otra conexión de la misma) falla antes de tocar nada. Es la defensa contra pegar la llave de un cliente en otro. Se mantiene sola dentro de `platform_bind_connection` y `platform_remove_connection`.

### Bindings, resolver y qué ve el agente

En cada `session.started` el resolver lee los bindings habilitados del tenant (el tenant sale de la sesión autenticada de eve, nunca de un input del modelo) y arma las conexiones con `buildTenantConnections`. Se omite, con un `console.warn`, todo lo que no cierre: proveedor desconocido, capacidad que no coincide, proveedor que no es una conexión de eve (`wiki`, `mcp`, `gmail`), sin builder, binding incompleto o nombre repetido. Un tenant sin binding de una capacidad simplemente no tiene esa conexión: el agente no ve tools de un CRM que no tiene.

El nombre de la conexión es `connectionName(binding)`: la capacidad (`leads-coldiq` si el proveedor admite varios), y para OAuth se le suma el `id` del binding. Eso último es un arreglo de seguridad ([#6](https://github.com/innovasbuild/agents/pull/6)): eve cachea el cliente MCP ya autenticado solo por nombre, y con un nombre fijo un tenant podía recibir el cliente autenticado de otro en una instancia tibia.

### Vercel Connect

- **API key**: `apiKeyHeaders`, `apiKeyBearer` y `apiKeyValues` piden la llave a Connect como "app" en cada llamada; la llave no queda en un closure ni en la sesión.
- **OAuth**: `tenantScopedConnect` ata el grant al sujeto `tenantId:userId`. Sin eso, quien es miembro de dos empresas usaría la cuenta de una dentro de la otra. `tokenForSubject` hace lo mismo sin sesión de eve (los schedules) y `startAuthorizationForSubject` devuelve el link de autorización para una server action.
- `tests/connectors/import-rule.test.ts` hace cumplir que nadie más importe `@vercel/connect`.
- Connect matchea el grant por el **conjunto exacto de scopes**, y arrancar una autorización nueva deja sin servir el grant vigente hasta que se complete. Por eso Mis cuentas jamás arranca una autorización al cargar la página (ver [gmail](gmail.md) para los scopes).

### Verificar

`checkConnectors` le pregunta a Vercel (`describeConnector`) si el uid existe y está adjunto al proyecto. En un deploy de Vercel es obligatorio; en local no hay OIDC y la fila queda "sin verificar". Un 404 o 403 es "no existe o no está adjunto" y no se guarda; un error de red no escribe nada. Procedimiento operativo de alta, rotación y baja: [llaves de clientes](../guias/llaves-de-clientes.md) (no se repite acá).

### Consola de conectores

En `/plataforma/[slug]`, sección Conectores, un administrador de plataforma asocia, verifica, deshabilita y quita conectores. Cada acción es una server action con `requirePlatformAdmin` que llama a una de las funciones de arriba y deja su evento (`connection.bound`, `connection.verified`, `connection.disabled`, `connection.removed`...). La consola también calcula "qué falta" para que una empresa pueda trabajar (`lib/tenants/readiness.ts`). Detalle de la consola en [plataforma](plataforma.md). Ninguna pantalla pide ni muestra llaves.

Cuando plataforma deshabilita un conector queda `locked_by_platform`: el cliente no puede volver a encenderlo desde `/[tenant]/settings` (hay un `check` que impide estar habilitado y bloqueado a la vez, y la función del cliente nunca escribe esa columna).

### Página Conectar: `/[tenant]/conectar`

Visible para todos los roles. `buildConnectables` arma una tarjeta por brain (si hay un binding `brain` habilitado) y una por agente habilitado en `tenant_agents`, con su URL de MCP (`/brain/<slug>/mcp`, `/eve/<agente>/v1/mcp?tenant=<slug>`) y pestañas con los pasos para Claude Code, claude.ai, ChatGPT, Codex y Cursor. Lo que no se probó contra la plataforma lleva la etiqueta "Sin probar" (`tested` en `instructions.ts`). Una tarjeta "próximamente" reserva el lugar de las herramientas de la empresa. Si falla la lectura devuelve "No se pudieron leer tus conexiones" en vez de una lista vacía, que parecería "no tenés nada". El canal MCP del agente rechaza a un agente deshabilitado ([#84](https://github.com/innovasbuild/agents/pull/84)).

### Mis cuentas: `/[tenant]/mis-cuentas`

Cada miembro ve solo lo que le corresponde (`accountsFor`): HubSpot si la empresa tiene CRM habilitado, Gmail si además es ejecutor y hay `mail/gmail`. El estado (`autorizada`, `sin_autorizar`, `no_disponible`, `desconocido`) sale de pedir un token, que no modifica nada; un error que no es de autorización cae en "No pude comprobarlo" y sin botón. La autorización arranca solo por un clic (`startAccountAuthorization`), siempre para el sujeto de la sesión. Al verse una cuenta autorizada, la página sella `executors.gmail_authorized_at` y, para HubSpot, guarda el `crm_owner_id` solo si estaba vacío. `executors` (una fila por ejecutor de outreach) es la tabla donde viven esos sellos, la firma y el cupo diario.

## 4. Cómo se prueba

```bash
npm test -- tests/connectors tests/connect tests/accounts tests/plataforma
npm run db:test        # supabase/tests/06_tenant_connections, 29_platform_console, 30_tenant_settings
```

Tests clave: `import-rule` (aislamiento de `@vercel/connect`), `providers` (nombre de conexión distinto por tenant), `catalog`, `resolve`, `verify`, `describe-connector`, `connectables`, `instructions`, `status`. Lo que solo corre en un deploy (la verificación contra Vercel real y el formulario de Apollo con varios identificadores) no está probado automáticamente según [#87](https://github.com/innovasbuild/agents/pull/87).

## 5. Decisiones

- Specs: [02-conexiones-innovas](../superpowers/specs/02-conexiones-innovas.md), [etapa 19 Conectar](../superpowers/specs/2026-10-09-etapa-19-conectar-design.md), [etapa 21.1 consola de conectores](../superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md).
- [#1](https://github.com/innovasbuild/agents/pull/1): tablas, registro de proveedores, puente único con Connect, resolver dinámico.
- [#3](https://github.com/innovasbuild/agents/pull/3): HubSpot OAuth, Gmail por Connect, baja de `google_tokens`.
- [#6](https://github.com/innovasbuild/agents/pull/6): nombre de conexión OAuth aislado por tenant (fuga de credenciales entre tenants).
- [#84](https://github.com/innovasbuild/agents/pull/84): página Conectar y chequeo de agente habilitado.
- [#87](https://github.com/innovasbuild/agents/pull/87): consola, `connector_claims`, verificación.
- [#89](https://github.com/innovasbuild/agents/pull/89): Mis cuentas y encendido/apagado por el cliente.
- La spec 02 describe `connectionName(provider)`; el código usa `connectionName(binding)` desde #6 (la spec lo documenta en su §10.1).
- Hoy solo existen builders para `coldiq`, `google-places` y `hubspot`; `apollo` no tiene builder: según el comentario de `providers.ts`, quien lee `config.connectorUids` es el schedule `dispatch` (`agents/outreach/schedules/dispatch.ts`).
