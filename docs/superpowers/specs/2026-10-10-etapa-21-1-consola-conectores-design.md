# Etapa 21.1: conectores y agentes desde la consola de plataforma: diseño

**Fecha:** 2026-10-10
**Base:** `docs/2026-10-09-plan-cierre-gap-plataforma.md` (Etapa 21), `docs/superpowers/specs/02-conexiones-innovas.md` (modelo de conectores, D2 a D5), `docs/superpowers/specs/2026-10-05-consola-plataforma-design.md` (gate `requirePlatformAdmin`), `docs/superpowers/specs/2026-10-05-alta-empresas-landing-design.md` (`create_tenant`), `docs/superpowers/specs/2026-10-09-etapa-20-login-design.md` (L10 a L12).

## 1. Objetivo y criterio de cierre

Que INNOV.AS dé de alta y opere un cliente desde `/plataforma/<slug>` sin terminal: habilitar agentes, asociar los conectores del cliente, crear su brain y ver en qué estado está cada empresa. Reemplaza al script `connections:bind` y saca a `outreach` del alta escrita a mano.

Es la primera de cinco entregas de la Etapa 21. Las otras son: 21.2 lo que configura el administrador del cliente (ejecutores, aprobaciones, qué conector usa cada agente, "Mis cuentas"), 21.3 la configuración de outreach y los presupuestos, 21.4 el segundo tenant como prueba, 21.5 la clave de modelos por empresa.

### 1.1 La frontera, decidida con Matías el 2026-10-10

| Qué | Quién |
|---|---|
| Habilitar qué agentes tiene cada empresa y su acceso al brain | INNOV.AS, desde la consola |
| Asociar los conectores de la empresa (llaves que ya viven en Vercel Connect) | INNOV.AS, desde la consola, con la llave que el cliente le pasó |
| Crear el brain | INNOV.AS, desde la consola |
| Ver el estado de todas las empresas | INNOV.AS |
| Elegir qué conector usa cada agente y configurarlo | El administrador del cliente (21.2) |
| Ejecutores, aprobaciones de nivel 2, ICP y listas | El administrador del cliente (21.2 y 21.3) |
| Clave y presupuesto de modelos | INNOV.AS (21.5) |
| Autorizar la propia cuenta de Gmail o HubSpot | Cada persona (21.2) |

Las llaves son del cliente: cada empresa trae las suyas. Para que entren a Vercel Connect se eligió el **camino 2**: el cliente le pasa la llave a INNOV.AS por un canal seguro, alguien de plataforma crea el conector con la CLI de Vercel desde el proyecto, y la consola guarda solo su identificador. **Ninguna pantalla de la plataforma pide, muestra ni guarda una llave.** La autogestión por una página de Vercel (instalación experimental del SDK) queda para cuando Vercel la habilite.

**Terminado cuando:** en producción, un administrador de plataforma crea una empresa eligiendo sus agentes, le asocia un conector de ColdIQ creado para esa empresa, le crea el brain, y el detalle muestra todo verificado; el intento de asociar ese mismo conector a otra empresa es rechazado; y `npm run connections:bind` ya no existe.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| K1 | Toda escritura de la consola va por una función SQL `security definer` que solo `service_role` puede ejecutar, llamada desde una server action después de `requirePlatformAdmin()`. La función recibe el actor y deja el cambio y su evento en una transacción | `tenant_connections` y `tenant_agents` siguen cerradas a cualquier usuario logueado. La base no conoce el tenant dueño (`is_platform_admin()` acepta una fila en cualquier empresa), así que el gate real es el de la app, y la función no vuelve a decidir permisos: confía en quien la llama con la clave de servicio. Es el mismo patrón que `brain_set_access_rule` |
| K2 | Un conector, una empresa: tabla `connector_claims (connector_uid pk, tenant_id)` que la función mantiene | Asociar a la empresa B el conector de la A es darle las credenciales de A. La clave primaria lo hace imposible por construcción, también para las llaves de respaldo de Apollo, que hoy viajan en `config.connectorUids` sin ninguna unicidad |
| K3 | Al asociar y al verificar, el servidor consulta a Vercel (`getConnectorMetadata`) y guarda `verified_at` y el nombre del conector. En Vercel la verificación es obligatoria; en local se omite y la fila queda "sin verificar" | Un identificador mal tipeado no debe quedar guardado como si anduviera. `getConnectorMetadata` solo responde por conectores adjuntos al proyecto, que es exactamente la condición para que el agente pueda pedirles token |
| K4 | `tenant_agents` se cierra a `authenticated` como `memberships`: `revoke insert, update, delete` | Hoy un administrador de cliente puede cambiar por la API el acceso de su agente al brain. Lo que le corresponda configurar lo recibe en 21.2 por funciones acotadas |
| K5 | `create_tenant` pasa a `security definer`, solo `service_role`, y recibe la lista de agentes; crea el tenant y una fila por agente en la misma transacción | Con K4 la inserción en `tenant_agents` ya no puede hacerse con la sesión. Y el alta deja de hardcodear `outreach` |
| K6 | Catálogo de agentes en código, `lib/agents/catalog.ts`, con un test que lo compara contra `agents/` y `next.config.ts` | La Etapa 22 lo necesita entero; acá nace con lo mínimo: nombre, descripción, capacidades que usa y si tiene brain. `lib/connect/connectables.ts` deja de tener su mapa propio |
| K7 | El brain se crea con una configuración por defecto desde la consola; la importación desde archivos no entra | Un cliente nuevo arranca con el brain vacío y escribe desde el editor. `brain:import` sigue para `innovas` |
| K8 | Quitar un conector borra la fila y su reclamo; deshabilitar la deja. Las dos acciones dejan evento. Quitar el brain no existe | Quitar el brain borraría páginas; eso no va por un botón de la consola |
| K9 | El traspaso de la llave es un procedimiento escrito, `docs/llaves-de-clientes.md` | Es la parte que no es código y la que más pesa en "la seguridad en el manejo de las llaves" |
| K10 | Sin pantalla para agentes o conectores en el settings del cliente todavía | Es 21.2. Esta entrega solo hace que la consola pueda dejar todo listo |

## 3. Base

Migración `20261015120000_platform_console.sql`. Antes de escribirla se carga `supabase-postgres-best-practices`.

### 3.1 Columnas nuevas en `tenant_connections`

- `verified_at timestamptz`, `verified_name text` (nombre del conector en Vercel, no secreto), `updated_by uuid references auth.users on delete set null`.

### 3.2 `connector_claims`

```sql
create table public.connector_claims (
  connector_uid text primary key check (length(connector_uid) between 1 and 200),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null references public.tenant_connections (id) on delete cascade,
  created_at timestamptz not null default now()
);
```

RLS prendida, `select` para `is_platform_admin()`, sin políticas de escritura, `revoke all` a `anon` y `authenticated`. Backfill en la misma migración: una fila por `connector_uid` no nulo y por cada elemento de `config -> 'connectorUids'` de las conexiones existentes. Si el backfill encuentra el mismo identificador en dos empresas, la migración falla con un mensaje que nombra el identificador: lo resuelve una persona antes de desplegar.

### 3.3 Candado de `tenant_agents`

`revoke insert, update, delete on public.tenant_agents from authenticated, anon;`. Las políticas `tenant_agents_insert/update/delete` se borran: sin privilegio no hacen nada y confunden. `tenant_agents_select` queda.

### 3.4 Funciones (todas `security definer set search_path = ''`, `revoke execute from public, anon, authenticated`, `grant execute to service_role`)

- **`platform_create_tenant(p_actor uuid, p_slug, p_display_name, p_allowed_domains, p_auth_methods, p_brand, p_agents text[]) returns uuid`.** Reemplaza a `create_tenant`, que se borra. Exige `cardinality(p_agents) >= 1` y sin repetidos (`23514`). Inserta el tenant, una fila en `tenant_agents` por agente con `config = '{"brain": "read_write"}'`, y el evento `tenant.created` con `actor_user_id = p_actor` y `payload.agents`.
- **`platform_set_agent(p_actor, p_tenant, p_agent, p_enabled boolean, p_brain text) returns void`.** Upsert de `tenant_agents (enabled, config.brain)` conservando el resto de `config`. `p_brain` en `none | read | read_write` (`23514` si no). Evento `agent.updated` con `payload { agent, enabled, brain }`.
- **`platform_bind_connection(p_actor, p_tenant, p_capability, p_provider, p_connector_uids text[], p_config jsonb, p_verified_name text) returns uuid`.** Upsert por `(tenant, capability, provider)`. `connector_uid = p_connector_uids[1]` (nulo si la lista viene vacía); para `apollo`, además `config.connectorUids = p_connector_uids`. Reemplaza los reclamos de esa conexión por los nuevos; un identificador ya reclamado por otra empresa falla con `23505`, y el mensaje del error nombra el identificador. Capacidad `brain`: respeta el índice único `tenant_connections_one_brain` existente y además crea la regla de la raíz (`brain_access_rules`, `on conflict do nothing`). `verified_at = now()` si `p_verified_name` no es nulo. Evento `connection.bound` con el mismo payload de hoy más `actor_user_id`.
- **`platform_set_connection_enabled(p_actor, p_connection uuid, p_enabled boolean)`.** Evento `connection.enabled` o `connection.disabled`.
- **`platform_remove_connection(p_actor, p_connection uuid)`.** Rechaza capacidad `brain` (`23514`). Borra la fila (los reclamos caen en cascada). Evento `connection.removed`.
- **`platform_mark_connection_verified(p_actor, p_connection uuid, p_verified_name text)`.** `verified_at = now()`; con `p_verified_name` nulo, `verified_at = null`. Evento `connection.verified` o `connection.unverified`.

Ninguna función decide permisos (K1). Todas exigen `p_actor` no nulo.

### 3.5 Tests pgTAP (`29_platform_console.test.sql`)

- `authenticated` y `anon` no ejecutan ninguna de las seis funciones ni escriben `tenant_agents` ni `connector_claims`; `tenant_agents_select` sigue dejando leer a un miembro.
- `platform_create_tenant`: crea tenant y una fila por agente; rechaza lista vacía y repetidos; evento con actor y agentes.
- `platform_bind_connection`: alta y actualización; el mismo identificador en otra empresa falla con `23505` y el mensaje lo nombra; Apollo con tres identificadores reclama los tres; reemplazar la lista libera los viejos; segunda capacidad `brain` falla por el índice único; crear brain crea la regla de la raíz y repetirlo no la pisa; `verified_at` según `p_verified_name`.
- `platform_remove_connection`: borra fila y reclamos; rechaza brain.
- Backfill: con dos conexiones existentes que comparten un identificador, la migración (simulada con la misma consulta) falla nombrándolo.

## 4. Verificación contra Vercel

`lib/connectors/auth.ts` sigue siendo el único archivo que importa `@vercel/connect`. Suma:

```ts
export async function describeConnector(uid: string): Promise<{ name: string; service: string } | null>
```

Llama a `getConnectorMetadata(uid)`. Devuelve `null` si Vercel responde que no existe o no está adjunto (los errores tipados de Connect). Cualquier otro error (red, OIDC) se propaga.

Regla en la acción de asociar y en la de verificar (`lib/connectors/verify.ts`, puro, recibe `describeConnector` inyectado):

- En Vercel (`VERCEL_ENV` definido): si `describeConnector` devuelve `null` para algún identificador, la acción falla con "El conector `<uid>` no existe o no está adjunto a este proyecto en Vercel." y no escribe nada. Si se propaga un error, "No pude verificar el conector en Vercel. Probá de nuevo." y no escribe nada.
- Fuera de Vercel: no se consulta; la fila se guarda con `verified_at = null` y la consola la muestra como "Sin verificar".

## 5. Catálogo de agentes

`lib/agents/catalog.ts`, sin imports:

```ts
export const AGENT_CATALOG = {
  outreach: {
    name: "Agente de outreach",
    description: "Investiga cuentas, redacta mensajes y arma la cola de envíos de tu empresa.",
    capabilities: ["crm", "leads", "mail"] as const,
    brain: true,
  },
} as const satisfies Record<string, AgentCatalogEntry>;
```

`tests/agents/catalog.test.ts`: las claves coinciden con los directorios de `agents/` que tienen `agent.ts` y con las claves de `agents` en `next.config.ts`; cada entrada tiene nombre y descripción en castellano no vacíos. `lib/connect/connectables.ts` lee de acá y el texto genérico para un agente desconocido se mantiene.

## 6. Consola

### 6.1 Alta (`/plataforma/nueva`)

Suma un grupo de casillas "Agentes", una por entrada del catálogo, todas marcadas por defecto, al menos una obligatoria. `createTenant` valida contra el catálogo y llama `platform_create_tenant` con el cliente admin, después de `requirePlatformAdmin()` (que ya aplica el chequeo del método de login). Los demás pasos del alta (logo, invitación) no cambian.

### 6.2 Detalle (`/plataforma/<slug>`), tres secciones nuevas entre el formulario y "Usuarios"

**Agentes.** Una fila por entrada del catálogo: nombre, interruptor habilitado, selector de acceso al brain (Sin acceso, Lectura, Lectura y escritura) visible solo si el agente declara brain. Guardar llama `platform_set_agent`.

**Brain.** Si no hay binding de capacidad `brain`: botón "Crear brain", que llama `platform_bind_connection` con proveedor `wiki` y la configuración por defecto `{ categories: ["empresa", "producto", "comercial", "operacion"], requiredFrontmatter: ["title", "category", "status", "updated"], search: "fts" }`. Si hay: proveedor, categorías, fecha de alta y link a `/<slug>/brain`.

**Conectores.** Tabla de bindings que no son brain: proveedor y capacidad, identificadores (los de Apollo listados), estado (Habilitado, Deshabilitado), verificación ("Verificado el <fecha> · <nombre en Vercel>" o "Sin verificar"), y botones Verificar, Deshabilitar o Habilitar, Quitar (con confirmación nativa). Debajo, el formulario "Asociar conector": selector de proveedor del catálogo de `PROVIDERS` sin `wiki`; campo de identificador solo si `authKind` es `connect_api_key`, con "Agregar otro" solo para proveedores con `multiple`; para `hubspot` no hay campo porque el conector es de plataforma y cada persona autoriza su cuenta. Un texto fijo arriba del campo: "Pegá el identificador del conector creado en Vercel (`vercel connect list`). Acá nunca va la llave."

El detalle calcula "Qué falta" con una función pura `tenantReadiness(agents, connections)` y lo muestra arriba: sin agentes habilitados, sin brain, agente habilitado que necesita una capacidad sin conector habilitado y verificado, conector sin verificar.

### 6.3 Listado (`/plataforma`)

Suma una columna con el resumen de `tenantReadiness`: "Listo" o "Faltan: brain, conectores".

### 6.4 Server actions (`app/plataforma/[slug]/console-actions.ts`)

`setAgent`, `createBrain`, `bindConnection`, `setConnectionEnabled`, `removeConnection`, `verifyConnection`. Todas: `requirePlatformAdmin()` fuera de cualquier `try` (ver 20.1), validación con zod, cliente admin, `rpc` a la función, traducción de errores (`23505` → "Ese conector ya está asociado a otra empresa: `<uid>`"; `23514` → el mensaje de la regla; otro → "No se pudo guardar. Probá de nuevo." con el detalle en el log), `revalidatePath` del detalle y del listado. Resultado `{ ok: true } | { ok: false; message }`.

## 7. Script y docs

- `scripts/connections-bind*.ts` y `connections-bind.mts` se borran, junto con su entrada en `package.json` y sus tests. `brain:import` queda.
- `docs/llaves-de-clientes.md` (nuevo): por qué canal manda la llave el cliente (nunca por mail ni chat: un gestor de secretos compartido o una llamada), cómo se crea el conector desde el proyecto con un nombre `<slug>-<proveedor>`, cómo se adjunta, cómo se borra la copia local, cómo se asocia desde la consola, cómo se rota (crear el nuevo, asociar, quitar el viejo en Vercel) y cómo se da de baja. Deja claro que el identificador no es secreto y la llave sí.
- `CLAUDE.md`: la línea de comandos cambia; la regla "nada de un tenant en código" no cambia.
- Roadmap: Etapa 21 con las cinco entregas.

## 8. Límites declarados

- `is_platform_admin()` en la base sigue aceptando una fila `platform_admin` de cualquier tenant; por eso K1 no le da permisos a esa función y todo el gate está en la app.
- La verificación prueba que el conector existe y está adjunto; no prueba que la llave funcione contra el proveedor. Eso se ve en la primera corrida del agente.
- Sin dominio propio por cliente ni autogestión de llaves.
- `scripts/executors-set`, `outreach-config` y `workflows-set` siguen hasta 21.2 y 21.3.
- Las conexiones de `innovas` ya cargadas quedan "Sin verificar" hasta que alguien apriete Verificar.

## 9. Despliegue

1. Antes de `db push`: en producción, `select connector_uid, count(distinct tenant_id) from public.tenant_connections where connector_uid is not null group by 1 having count(distinct tenant_id) > 1;` debe dar cero filas. Lo mismo para los `connectorUids` de Apollo. Si no, la migración falla a propósito.
2. Migración antes que el código: el alta llama a `platform_create_tenant`, que no existe hasta aplicarla. Al revés, `/plataforma/nueva` falla al guardar.
3. Después del deploy: entrar al detalle de `innovas` y apretar Verificar en cada conector.

## 10. Pruebas

**Base:** §3.5.

**Aplicación:**
- `describeConnector`: devuelve nombre y servicio; `null` ante los dos errores tipados; propaga el resto.
- `lib/connectors/verify.ts`: en Vercel, un `null` corta con el mensaje que nombra el identificador y un error corta con el genérico; fuera de Vercel no consulta.
- Catálogo: coincide con `agents/` y `next.config.ts`.
- `tenantReadiness`: cada causa y "Listo".
- Acciones: cada una exige plataforma, valida, traduce `23505` y `23514`, revalida; `bindConnection` no escribe si la verificación corta; para `hubspot` no acepta identificador; para `apollo` acepta varios y para los demás uno; `removeConnection` rechaza brain antes de llamar.
- `createTenant`: pasa la lista de agentes; rechaza vacía y desconocidos.
- Páginas: el detalle muestra las tres secciones y "Qué falta"; el listado muestra el resumen; `connectables` usa el catálogo.

**Navegador** (base local): alta con un agente, crear brain, asociar un conector (queda "Sin verificar"), deshabilitar, quitar, y el rechazo del mismo identificador en otra empresa.

**Producción** (anexo, lo corre una persona): el criterio de cierre completo, con un conector real de ColdIQ.
