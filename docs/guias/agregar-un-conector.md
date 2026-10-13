---
title: Agregar un conector (proveedor)
category: guias
status: activo
tags: [conectores, proveedores, vercel-connect, consola]
updated: 2026-10-13
sources:
  - lib/connectors/providers.ts
  - lib/connectors/catalog.ts
  - lib/connectors/platform.ts
  - lib/connectors/auth.ts
  - lib/connectors/leads/coldiq.openapi.ts
  - lib/agents/catalog.ts
  - lib/tenants/readiness.ts
  - app/plataforma/[slug]/console-actions.ts
  - app/plataforma/[slug]/console/bind-form.tsx
  - supabase/migrations/20260913221734_tenant_connections_executors.sql
  - supabase/migrations/20261015120000_platform_console.sql
  - tests/connectors/providers.test.ts
  - tests/connectors/catalog.test.ts
  - tests/connectors/import-rule.test.ts
  - tests/agents/catalog.test.ts
---

# Agregar un conector (proveedor)

Un conector liga a una empresa con un servicio de afuera. El registro puro es `PROVIDERS` en `lib/connectors/providers.ts`; hoy tiene siete proveedores: `hubspot` (CRM, OAuth por persona), `wiki` y `mcp` (brain), `coldiq`, `apollo` y `google-places` (leads, con llave) y `gmail` (mail, OAuth por persona). El modelo completo de conexiones está en [conectores](../dominios/conectores.md); cómo entra la llave de un cliente está en [llaves de clientes](llaves-de-clientes.md).

La llave nunca pasa por el código ni por la base: vive en Vercel Connect y la base guarda solo el identificador (`connector_uid`). Solo `lib/connectors/auth.ts` puede importar `@vercel/connect`.

## Pasos

1. Elegí la forma del proveedor. En `PROVIDERS` cada entrada tiene cuatro campos:

   | Campo | Valores |
   |---|---|
   | `capability` | `crm`, `leads`, `enrichment`, `brain`, `mail` |
   | `multiple` | si la capacidad admite varios proveedores por empresa |
   | `kind` | `connection` (eve la usa como conexión) o `tool` (la usa una tool propia, como `gmail`) |
   | `authKind` | `connect_api_key` (llave del cliente en Connect), `connect_oauth` (cada persona autoriza su cuenta) o `none` |

   La clave tiene que cumplir `^[a-z][a-z0-9-]{0,40}$` (es el `check` de `tenant_connections.provider`). Con `authKind: "connect_oauth"` el nombre de la conexión de eve lleva el id del binding (`connectionName`): es lo que evita que dos empresas compartan un cliente ya autenticado.

2. Si la capacidad es nueva (no está en la lista de arriba), es un valor del enum `connector_capability` en la base: hace falta una migración. Seguí [migraciones a producción](migraciones-a-produccion.md). Si la capacidad ya existe, no hay migración: el `provider` es texto libre validado en código.

3. Agregá la entrada a `PROVIDERS` en `lib/connectors/providers.ts`.

4. Si `kind` es `connection`, agregá su builder en `BUILDERS` de `lib/connectors/catalog.ts`. Cada builder recibe el `Binding` y devuelve la definición de eve, o `null` si el binding no alcanza (por ejemplo, sin `connectorUid`). Hay dos modelos a copiar:
   - API con llave (`coldiq`, `google-places`): `defineOpenAPIConnection` con el spec en `lib/connectors/leads/<proveedor>.openapi.ts`, `instanceKey: binding.id`, la llave por `apiKeyBearer(uid)` o `apiKeyHeaders(uid, header)` y una lista `operations.allow` explícita (solo se exponen las operaciones que se listan).
   - MCP con OAuth por persona (`hubspot`): `defineMcpClientConnection` con `tenantScopedConnect(<uid del conector de plataforma>, binding.tenantId)` y `tools.allow` explícito. Las constantes (URL, uid del conector de plataforma, tools de lectura) viven en `lib/connectors/platform.ts`.

   Un proveedor de `kind: "tool"` no lleva builder: la tool que lo usa pregunta `hasEnabledBinding(tenantId, capability, provider)` (`lib/connectors/bindings.ts`), como hace `send_email` con `gmail`.

5. Si la capacidad es nueva para un agente, sumala a `capabilities` de su entrada en `lib/agents/catalog.ts`: es lo que le avisa a la consola ("faltan conectores") cuando un agente habilitado no tiene un conector de esa capacidad (`tenantReadiness` en `lib/tenants/readiness.ts`). Un proveedor `connect_api_key` además queda "sin verificar" hasta que alguien apriete Verificar en la consola.

6. Si el proveedor admite varios identificadores por conexión, hoy solo `apollo` lo hace: `acceptsManyUids` en `providers.ts` y la función SQL `platform_bind_connection` (`p_provider <> 'apollo'`) lo tienen escrito a mano, así que otro proveedor con varios identificadores requiere tocar las dos y una migración nueva. No verificado en la práctica: no se hizo todavía.

7. En la consola de plataforma no hay que tocar nada para que el proveedor aparezca: el formulario "Asociar conector" (`app/plataforma/[slug]/console/bind-form.tsx`) arma la lista con `Object.keys(PROVIDERS)` menos los de capacidad `brain`, y la acción `bindConnection` (`console-actions.ts`) decide cuántos identificadores acepta según `authKind` y `acceptsManyUids`. Los de brain (`wiki`, `mcp`) tienen su propio botón y no se asocian desde ese formulario.

8. Tests: en `tests/connectors/providers.test.ts` (nombre de la conexión, `acceptsManyUids`) y `tests/connectors/catalog.test.ts` (qué arma el builder con un binding completo y con uno incompleto). Corré:

   ```bash
   npm test -- tests/connectors
   ```

9. Documentá el proveedor por su nombre en [conectores](../dominios/conectores.md) y regenerá la referencia (`docs/referencia/proveedores.md`):

   ```bash
   npm run docs:sync
   ```

10. Alta para una empresa, ya con el código desplegado: el cliente le pasa la llave a INNOV.AS por un canal seguro, se crea el conector en Vercel y se asocia su identificador desde `/plataforma/[slug]`. El paso a paso, con los comandos de Vercel, está en [llaves de clientes](llaves-de-clientes.md). Para una empresa nueva completa, ver [alta de tenant](alta-de-tenant.md).

## Qué va a fallar si te olvidás de algo

| Te olvidaste de | Falla | Dónde |
|---|---|---|
| Cumplir el formato de nombre de conexión de eve | "todo nombre cumple la regla de eve" | `tests/connectors/providers.test.ts` |
| Actualizar la lista de proveedores sin varios identificadores | "solo Apollo lee varios identificadores por conexión" | `tests/connectors/providers.test.ts` |
| El builder (el binding queda omitido con un `console.warn`: "sin builder todavía") | los casos de `buildTenantConnections` | `tests/connectors/catalog.test.ts` |
| Importar `@vercel/connect` fuera de `lib/connectors/auth.ts` | el test de la regla de importación | `tests/connectors/import-rule.test.ts` |
| Sumar un agente al catálogo sin carpeta o sin `next.config.ts` | "tiene una entrada por carpeta de agents/ y nada más" y "coincide con los agentes que monta next.config.ts" | `tests/agents/catalog.test.ts` |
| Regenerar la referencia | "docs/referencia coincide con lo que genera docs:sync" | `tests/docs/wiki.test.ts` |
| Nombrar el proveedor en la wiki | "toda superficie está mencionada en arquitectura/, dominios/ o guias/…" | `tests/docs/cobertura.test.ts` |
| La migración del enum, si la capacidad es nueva | Nada en `npm test`: falla en la base al asociar. Lo ve `npm run db:test` si agregaste un test pgTAP | `supabase/tests/` |
