# Etapa 21.2: settings del cliente (ejecutores, aprobaciones, conectores y "Mis cuentas")

**Fecha:** 2026-10-10
**Estado:** diseño aprobado en conversación; falta la revisión de este documento.
**Rama:** `feat/etapa-21-2-settings-cliente`, sale de `main` con la 21.1 mergeada (PR 87).
**Antecedentes:** `2026-10-10-etapa-21-1-consola-conectores-design.md` (frontera plataforma/cliente, K4 y K10), `2026-10-09-etapa-20-login-design.md` y la entrega 20.2 (patrón `block_member`), `docs/02-orquestacion.md` §4 (escala de efectos), `02-conexiones-innovas.md` (Connect).

## 1. Qué resuelve

Hoy el administrador de un cliente no puede operar su empresa sin INNOV.AS y sin terminal:

- Los ejecutores (quién envía, cupo, firma) se cargan con `npm run executors:set`.
- La política de aprobaciones de nivel 2 (`tenant_agents.config.approvals`) no tiene pantalla, y desde la 21.1 tampoco se puede escribir por la API.
- Los conectores que INNOV.AS asoció no se pueden apagar desde el cliente.
- Una persona se entera de que le falta autorizar Gmail o HubSpot cuando le falla una acción de la cola.

Al cerrar esta entrega, un `tenant_admin` configura ejecutores, aprobaciones y el encendido de sus conectores desde `/<slug>/settings`, y cualquier miembro autoriza sus cuentas desde `/<slug>/mis-cuentas`, todo desde el navegador.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| S1 | El cliente escribe por funciones `security definer` que ejecuta `authenticated` y que verifican adentro el permiso, como `block_member` (20.2) | El permiso es por empresa y SQL lo puede verificar exacto (`has_tenant_role`). Se prueba en pgTAP y un descuido de la pantalla no escribe en otra empresa. Las tablas siguen cerradas a escritura directa |
| S2 | El cliente enciende y apaga conectores ya asociados; no agrega, no quita, no cambia identificadores | La llave la asocia INNOV.AS (21.1). Con un solo agente no hay mapeo conector→agente que decidir: queda para la Etapa 22 |
| S3 | Columna `tenant_connections.locked_by_platform`: plataforma deshabilita ⇒ `true`; plataforma habilita ⇒ `false`. El cliente no puede habilitar un conector bloqueado | Con una sola bandera el cliente podría rehabilitar lo que INNOV.AS apagó por una llave filtrada. Una columna y una función tocada; ningún lector de `enabled` cambia |
| S4 | El brain no se enciende ni apaga desde el cliente | Es de plataforma (21.1). La función rechaza `capability = 'brain'` |
| S5 | Un ejecutor se elige entre los miembros de la empresa; no se invita desde esta pantalla | Igual que el script: exige membresía. Invitar ya vive en Usuarios |
| S6 | El cupo diario tiene techo de 200 dentro de `set_executor` | Un administrador no debe poder quemar la reputación del dominio de envío. Subir el techo es una decisión de plataforma y se cambia en una migración |
| S7 | Quitar un ejecutor borra la fila solo si no tiene historial; con historial se rechaza y se indica cupo 0. El chequeo lo hace la función, explícito | Las claves foráneas no protegen: `queue_items` y `search_focuses` se borran **en cascada** y `contacts.owner_user_id` queda en nulo. Un borrado ingenuo destruiría el historial de envíos. Cupo 0 ya significa "no envía" |
| S8 | `crm_owner_id` y los sellos `gmail_*` no los escribe ninguna función del cliente: los sella el servidor | Son hechos (qué autorizó la persona, quién es en HubSpot), no preferencias |
| S9 | `crm_owner_id` se resuelve solo al autorizar HubSpot, preguntándole a HubSpot quién es la persona | El administrador no escribe un número que no sabe dónde ver |
| S10 | "Mis cuentas" es para cualquier miembro, en `/<slug>/mis-cuentas` | `/<slug>/cuentas` ya existe (cuentas de outreach). HubSpot le sirve también a quien usa el chat, no solo a quien envía |
| S11 | Cargar "Mis cuentas" nunca arranca una autorización; el estado sale de pedir un token | Arrancar una autorización deja el grant anterior sin servir hasta el consentimiento (verificado en producción el 2026-09-15). Pedir token no modifica nada |
| S12 | Las aprobaciones listan los nodos de `effect: 2` del registro; nunca un nodo de nivel 3 | Regla del repo: nivel 3 lleva aprobación humana siempre. Hoy el único nodo es `outreach/crm-record` |
| S13 | Sin edición de ejecutores ni aprobaciones de un cliente desde la consola de plataforma | Un `platform_admin` ya pasa el chequeo de las funciones si entra al settings del cliente. No hace falta una segunda pantalla |
| S14 | Se retira `executors:set` con sus tests. `workflows:set` y `outreach:config` siguen hasta la 21.3 | La pantalla lo reemplaza entero |

## 3. Base de datos

Migración `20261016120000_tenant_settings.sql`. Antes de escribirla se carga `supabase-postgres-best-practices`.

### 3.1 Columna nueva

```sql
alter table public.tenant_connections
  add column locked_by_platform boolean not null default false;
```

`platform_set_connection_enabled` (21.1) se redefine con `create or replace`: además de lo que hace, deja `locked_by_platform = not p_enabled`. Firma, permisos y evento no cambian. Las filas que hoy estén deshabilitadas quedan con `locked_by_platform = true` en la misma migración (las deshabilitó plataforma: hasta hoy nadie más podía).

### 3.2 Funciones del cliente

Todas: `security definer set search_path = ''`, `revoke execute ... from public, anon`, `grant execute ... to authenticated`. Primera línea de cada una, el permiso:

```sql
v_actor uuid := (select auth.uid());
...
if v_actor is null then raise exception 'no authenticated user'; end if;
if not (
  (select public.has_tenant_role(p_tenant, array['tenant_admin']::public.tenant_role[]))
  or (select public.is_platform_admin())
) then
  raise exception 'solo un administrador puede cambiar esto' using errcode = '42501';
end if;
```

Las reglas de negocio salen con `errcode = '23514'` y `hint = 'settings'`; la app muestra ese mensaje tal cual. Cada escritura deja su evento con `actor_user_id = v_actor` en la misma transacción.

| Función | Qué hace | Reglas (23514 salvo indicación) | Evento |
|---|---|---|---|
| `set_executor(p_tenant uuid, p_user uuid, p_slug text, p_display_name text, p_title text, p_linkedin_url text, p_daily_quota int) returns void` | Alta o edición. `insert ... on conflict (tenant_id, user_id) do update` solo de `slug, display_name, title, linkedin_url, daily_quota` | `p_user` tiene que ser miembro de `p_tenant` ("esa persona no es miembro de la empresa"). `p_daily_quota` entre 0 y 200 ("el cupo diario va de 0 a 200"). Slug repetido en la empresa → 23505 con `hint = 'settings'` ("ese slug ya lo usa otro ejecutor"). Formatos de slug y LinkedIn: los `check` de la tabla, traducidos a un mensaje | `executor.updated` |
| `remove_executor(p_tenant uuid, p_user uuid) returns void` | Borra la fila | Sin fila → `P0002` con hint `settings` ("Esa persona ya no es ejecutora.": otro admin la quitó primero). Con historial (existe una fila suya en `queue_items.executor_user_id`, `search_focuses.created_by` o `contacts.owner_user_id` de esa empresa) → 23514 "tiene historial: ponele cupo 0 para que no envíe", **antes** de borrar: las tres claves foráneas son `on delete cascade` o `set null` y no frenarían nada | `executor.removed` |
| `set_approval(p_tenant uuid, p_agent text, p_node text, p_policy text) returns void` | `config = jsonb_set(config, '{approvals}', coalesce(config->'approvals','{}') || jsonb_build_object(p_node, p_policy))`. No toca `brain` ni otras claves | La fila de `tenant_agents` tiene que existir ("la empresa no tiene ese agente"). `p_policy` en `always, once, auto`. `p_node` con formato `^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$` y prefijo igual a `p_agent` | `approval.updated` con `{agent, node, policy}` |
| `set_connection_enabled(p_tenant uuid, p_connection uuid, p_enabled boolean) returns void` | Cambia `enabled`, `updated_by`, `updated_at`. La función del cliente nunca cambia `locked_by_platform`; solo plataforma lo cambia | La conexión tiene que ser de `p_tenant` (si no, `P0002` con hint `settings`: no se revela que existe). `capability = 'brain'` → "el brain lo maneja INNOV.AS". Habilitar con `locked_by_platform` → "INNOV.AS deshabilitó este conector: pedile que lo habilite". Deshabilitar una fila bloqueada la deja bloqueada | `connection.enabled` / `connection.disabled` con `{connection_id, actor: 'cliente'}` |

`set_approval` no puede verificar en SQL que el nodo sea de nivel 2: el registro vive en código. Lo verifica la acción (§4.2). Lo que SQL sí garantiza es que nadie escribe una política fuera de los tres valores ni sobre un agente que la empresa no tiene. Una política sobre un nodo de nivel 3 no tendría efecto de todos modos: el runner niega el nivel 3 antes de leer la política.

### 3.3 Tests pgTAP (`30_tenant_settings.test.sql`)

Por cada función: el `tenant_admin` de la empresa puede; el `tenant_admin` de **otra** empresa, un `tenant_member` y `anon` reciben 42501; un `platform_admin` puede. Además: techo y piso del cupo; no miembro; slug repetido; quitar sin historial y con historial (con una pieza en la cola, con un foco y con un contacto propio: en los tres casos se rechaza y las filas siguen ahí); `set_approval` preserva `brain` y las otras políticas, rechaza política desconocida, nodo con prefijo de otro agente y agente inexistente; `set_connection_enabled` rechaza brain, rechaza conexión de otra empresa con `P0002`, respeta `locked_by_platform` en los dos sentidos (plataforma deshabilita ⇒ cliente no habilita, y si el cliente deshabilita igual la fila sigue bloqueada y él sigue sin poder habilitarla; plataforma habilita ⇒ cliente puede deshabilitar y volver a habilitar); backfill de la columna; cada escritura deja su evento con el actor; ningún rol escribe las tablas directo (sigue 42501).

## 4. Aplicación

### 4.1 Lectura pura compartida

- `lib/tenants/approvals.ts`: `approvableNodes(agent): string[]` (nodos de `NODES` con `effect === 2` y prefijo del agente), `POLICIES = ["always","once","auto"]`, `POLICY_LABELS` ("Siempre pedir", "Pedir la primera vez", "Sin pedir") y `readPolicy(config, node)` (lo que hoy hace `nodePolicy`: cualquier cosa que no sea `auto` u `once` es `always`). Un test compara contra `lib/workflows/registry.ts`.
- `lib/outreach/settings-query.ts` se amplía: los ejecutores traen `display_name, title, linkedin_url, crm_owner_id`; las conexiones traen `locked_by_platform` y `verified_at`.

### 4.2 Server actions (`app/[tenant]/settings/config-actions.ts`)

`"use server"`. Cada acción: valida la entrada con zod, resuelve la empresa con `resolveTenantAccess(slug)` (nunca toma el `tenant_id` del formulario), llama la función con el cliente **de la sesión** (`createServerSupabase()`), revalida `/<slug>/settings` y devuelve `{ ok: true } | { ok: false; message }`.

| Acción | Llama |
|---|---|
| `saveExecutor(slug, userId, input)` | `set_executor` |
| `removeExecutor(slug, userId)` | `remove_executor` |
| `saveApproval(slug, agent, node, policy)` | `set_approval`, después de comprobar `approvableNodes(agent).includes(node)`; si no, "Ese paso no admite política" y no llama a la base |
| `toggleConnection(slug, connectionId, enabled)` | `set_connection_enabled` |

Traducción de errores: `hint = 'settings'` → el mensaje de la base; `42501` → "No tenés permiso."; cualquier otro → "No se pudo guardar. Probá de nuevo." con `console.error` del código y el mensaje.

### 4.3 Pantalla `/<slug>/settings`

Sigue siendo territorio de administradores (`tenant_member` → 404). Tres secciones dejan de ser solo lectura:

- **Ejecutores.** Tabla con nombre, slug, puesto, cupo, estado de Gmail (sello) y de HubSpot (`crm_owner_id` presente o "Falta autorizar HubSpot"). "Agregar ejecutor": selector con los miembros que todavía no lo son, y los campos slug (sugerido desde el correo), nombre, puesto, LinkedIn y cupo (30 por defecto). Editar en la fila. "Quitar" con confirmación nativa. Se va el texto que manda a correr `executors:set`.
- **Aprobaciones.** Por cada agente habilitado de la empresa, sus nodos de nivel 2 con un selector de política y una frase que explica cada opción. Si el agente no tiene nodos de nivel 2 no aparece.
- **Conectores.** La lista actual más un interruptor por fila. El brain aparece sin interruptor. Un conector con `locked_by_platform` aparece "Deshabilitado por INNOV.AS", sin interruptor.

Si falla la lectura de alguna sección se muestra "No pude leer esta sección" y no su contenido vacío, como en la 21.1.

### 4.4 "Mis cuentas" (`/<slug>/mis-cuentas`)

Entrada "Mis cuentas" en el menú, visible para todos los roles.

`lib/accounts/status.ts`, puro, con sus dependencias inyectadas:

```ts
type AccountKey = "hubspot" | "gmail";
type AccountState = "autorizada" | "sin_autorizar" | "no_disponible" | "desconocido";
accountsFor(input: { connections: {capability, provider, enabled}[]; isExecutor: boolean }): AccountKey[]
probeAccount(key, subject, deps: { token }): Promise<AccountState>
```

- **Qué cuentas ve la persona:** HubSpot si la empresa tiene `crm/hubspot` habilitado; Gmail si tiene `mail/gmail` habilitado **y** la persona es ejecutor.
- **Estado:** `tokenForSubject(connector, { tenantId, userId, issuer: connectSubjectIssuer() }, scopes)`. Devuelve token → `autorizada`. `isConnectAuthError` → `sin_autorizar`. `isConnectorNotInstalledError` → `no_disponible`. Cualquier otro error → `desconocido`, con `console.error`. Gmail pide siempre `GMAIL_SCOPES` completo; HubSpot no pide scopes, como en la cola.
- **Autorizar:** acción `startAccountAuthorization(slug, key)` en `app/[tenant]/mis-cuentas/actions.ts`. Es el único lugar de esta entrega que llama a `startAuthorizationForSubject`, y solo por un clic. Devuelve la URL y el cliente la abre en otra pestaña. Si el estado era `autorizada`, el botón dice "Reautorizar" y pide confirmación: "Hasta que completes el consentimiento, esta cuenta deja de funcionar." La acción vuelve a comprobar que la cuenta le corresponde a la persona (`accountsFor`) antes de llamar a Connect.
- **Reconciliación al cargar** (solo ejecutores, solo con estado `autorizada`): si falta `gmail_authorized_at` se llama `markGmailAuthorized`; si falta `crm_owner_id` se resuelve y se guarda con el cliente admin. Ninguna de las dos falla la página: un error se registra y la pantalla muestra "No pude leer tu usuario de HubSpot".
- **`crm_owner_id`:** se le pregunta a HubSpot por el dueño cuyo correo es el de la sesión, con el token de la persona. Hay dos caminos: `GET /crm/v3/owners?email=` por REST, o la tool `get_user_details` del MCP de HubSpot (ya está en `HUBSPOT_READ_TOOLS`). Cuál funciona con los scopes del conector solo se puede comprobar en un deploy, así que se implementa el de REST (el repo ya llama a esa API con el token de la persona) y el anexo A lo verifica; si HubSpot lo rechaza por permisos, se cambia al otro sin tocar a quien lo llama. Va detrás de `resolveCrmOwnerId(token, email): Promise<string | null>` en `lib/connectors/crm/`.

Textos por estado: "Autorizada", "Sin autorizar", "No disponible: pedile a INNOV.AS que la habilite", "No pude comprobarlo. Recargá la página."

## 5. Seguridad

- Ninguna función ni acción toma la empresa de un dato que mande el navegador sin verificarlo: las acciones resuelven por `slug` con la sesión y la base vuelve a verificar el rol sobre `p_tenant`.
- `set_connection_enabled` no revela si una conexión de otra empresa existe.
- El cliente nunca ve ni cambia `connector_uid`, `config` ni los reclamos. La pantalla de conectores muestra proveedor, capacidad y estado.
- "Mis cuentas" trabaja siempre con el sujeto de la sesión (`tenantId:userId` con el mismo `issuer` que el chat y la cola); no hay parámetro para actuar por otra persona.
- La URL de autorización se devuelve solo a quien la pidió y no se registra en logs ni eventos.
- Ningún token se guarda, se devuelve al navegador ni se registra: el sondeo descarta el token apenas confirma que existe.
- `is_platform_admin()` acepta una fila `platform_admin` de cualquier empresa (límite conocido, spec 21.1 K1). Es la misma postura que `block_member` y que la RLS de lectura; el menú y las páginas del cliente ya exigen membresía o plataforma para llegar a la pantalla.
- `locked_by_platform` solo lo cambian las funciones de `service_role` (plataforma); la función del cliente nunca lo escribe.

## 6. Qué no entra

- Agregar o quitar conectores, o cambiar identificadores, desde el cliente (consola, 21.1).
- Mapeo conector→agente y permisos de uso por agente (Etapa 22).
- ICP, listas y presupuestos (21.3); `workflows:set` y `outreach:config` siguen.
- La política `once` no cambia de significado: se guarda y el runner la trata como hoy.
- Outlook u otro proveedor de correo.
- Desautorizar (revocar) una cuenta desde la plataforma: se hace en Google o HubSpot.

## 7. Pruebas

- **pgTAP:** §3.3.
- **vitest:** acciones con el cliente doblado, afirmando nombre y argumentos exactos de cada `rpc` (en este repo `rpc()` no está tipado); permisos (`tenant_member` → sin llamada); `saveApproval` rechaza un nodo que no es de nivel 2 sin llamar a la base; `accountsFor` y `probeAccount` con cada tipo de error; **cargar "Mis cuentas" no llama a `startAuthorizationForSubject`** (test explícito con el doble contando llamadas); reconciliación que falla no rompe la página; páginas con error de lectura.
- **Guardia de `"use server"`:** `tests/server-actions-exports.test.ts` pasa a recorrer todo `app/`. El error de la 21.1 (exportar un objeto desde un archivo de acciones) apareció recién en el navegador.
- **Navegador, base local:** como administrador, alta, edición y baja de un ejecutor, techo del cupo, cambio de política, apagar y encender un conector, conector bloqueado por plataforma; como miembro, `/settings` da 404 y "Mis cuentas" muestra lo que le corresponde; 375 px.

## 8. Lo que no se puede probar en local

La autorización real contra Google y HubSpot y la resolución del `crm_owner_id` necesitan el OIDC de Vercel. Anexo A.

### Anexo A: verificación en producción

1. Como miembro de `innovas` sin Gmail autorizado: "Mis cuentas" muestra "Sin autorizar" y, después de autorizar, "Autorizada" con el sello en ejecutores.
2. Con Gmail ya autorizado: cargar "Mis cuentas" diez veces y enviar una pieza de la cola. El envío tiene que seguir funcionando (prueba de S11).
3. Autorizar HubSpot: el ejecutor queda con su `crm_owner_id` y coincide con el de la tabla de owners del `CLAUDE.md`.
4. Un `tenant_admin` cambia `outreach/crm-record` a `auto` y la siguiente pasada del workflow escribe en HubSpot sin pedir; lo vuelve a `always`.
5. Plataforma deshabilita un conector desde la consola: el cliente lo ve "Deshabilitado por INNOV.AS" y no lo puede habilitar.

## 9. Despliegue

La migración va antes que el código: el código nuevo llama funciones que la base vieja no tiene y fallaría con el mensaje genérico. El código viejo contra la base nueva sigue funcionando (la columna tiene valor por defecto y la función redefinida conserva su firma). `npx supabase migration list` antes de `db push`.
