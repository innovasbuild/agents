# Etapa 21.3: configuración de outreach (el brain como fuente, pantallas y presupuestos)

**Fecha:** 2026-10-10
**Estado:** diseño aprobado en conversación; falta la revisión de este documento.
**Rama:** `feat/etapa-21-3-config-outreach`, sale de `main` con la 21.2 mergeada (PR 89).
**Antecedentes:** `2026-10-10-etapa-21-2-settings-cliente-design.md` (patrón de funciones del cliente, S1), `2026-10-10-etapa-21-1-consola-conectores-design.md` (consola y "qué falta"), `2026-09-20-etapa-13-pipeline-gtm-design.md` (D9 y §7, scoring de ICP), `2026-09-20-orquestacion-plataforma-design.md` (§7.2 presupuestos, §10 workflows por tenant), `2026-09-13-brain-design.md` (B6, tags de canon), `03-agente-outreach-v1.md` (§4.3 listas, §5.2 bloques del gate).

## 1. Qué resuelve

Lo que queda de la configuración de outreach se carga con dos scripts y un archivo del repo:

- `npm run outreach:config` lee `tenants/<slug>/outreach.json` y escribe `config_values` (segmentos, hooks, vectores, idiomas) y `tenant_agents.config.outreach` (zona horaria, BCC, deal, empresa que firma, modelos, niveles del ICP).
- `npm run workflows:set` enciende workflows, les cambia cadencia e ítems, y carga `tenant_budgets`.

Además el ICP está en dos lugares: en prosa en el brain (`canon:icp`, lo lee `draft_message`) y como niveles del score en `config.outreach.icp` (lo lee `outreach/icp-score`). Lo mismo pasa con hooks y vectores: el contenido está en el brain (`canon:hooks`) y los identificadores en `config_values`. Editar uno no cambia el otro.

Al cerrar esta entrega:

- El ICP, los hooks y los vectores tienen una sola fuente, el brain de la empresa, y se editan en el editor del brain.
- El administrador del cliente configura segmentos, idiomas, datos de outreach y workflows desde `/<slug>/settings/outreach`, y ve su presupuesto y su gasto.
- INNOV.AS fija los presupuestos desde `/plataforma/<slug>`.
- Los dos scripts y `tenants/innovas/outreach.json` se van.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| O1 | Los niveles del ICP viven en un bloque ` ```icp ` dentro de la página `canon:icp` del brain. `config.outreach.icp` se elimina | El ICP es conocimiento de la empresa, no configuración de un agente. Revierte D9 de la etapa 13: los niveles siguen siendo frases concretas que se sostienen solas, pero escritas en la página, no en un archivo del repo |
| O2 | La revisión del scoring es la huella del bloque normalizado, no el número de revisión de la página | Cambiar un nivel cambia la huella; corregir la prosa de alrededor no. Nadie escribe la revisión a mano. Cada juicio guarda con qué huella se hizo |
| O3 | Hooks y vectores salen de bloques ` ```hooks ` y ` ```vectores ` en páginas `canon:hooks`. `config_values` pasa a ser su reflejo | Los lectores (puerta, Focos, Métricas) no cambian y un valor retirado conserva su rótulo en los reportes viejos |
| O4 | El reflejo corre solo, después de guardar o borrar una página `canon:hooks`, enganchado en `getBrainProvider` | Un solo punto cubre editor, MCP y agente. Con botón manual quedaría un estado donde el brain dice una cosa y el agente usa otra |
| O5 | Un bloque inválido no se refleja: sigue vigente lo último válido y queda un evento de fallo. El guardado de la página nunca falla por el reflejo | El brain no conoce al outreach; la página es de quien la escribe. El aviso llega por el "qué falta" y por settings |
| O6 | Segmentos e idiomas quedan en `config_values` y se editan en settings | Son claves de reporte sin contenido comercial |
| O7 | Un valor de lista nunca se borra, se desactiva | Contactos y focos lo guardan como texto, sin clave foránea |
| O8 | Solo cuentan las páginas con estado `activo` para los bloques | `brain_search_pages` devuelve borradores; una plantilla sin completar no puede calificar a nadie |
| O9 | Al crear el brain desde la consola nacen `comercial/icp` y `comercial/hooks` en borrador, con los bloques a completar | Carpeta y archivo por defecto: la persona sabe dónde va cada cosa |
| O10 | El outreach requiere brain: la consola no deja habilitarlo sin un brain habilitado | Sin brain no hay ICP, ni hooks, ni canon para redactar |
| O11 | Plataforma fija los presupuestos. El cliente enciende workflows y ajusta cadencia e ítems dentro de los topes del registry | `model_usd` sale hoy de la cuenta de INNOV.AS. El gasto del cliente queda acotado por lo que fijó plataforma |
| O12 | El administrador del cliente ve el límite y el gasto del día por recurso, en montos | Decidido el 2026-10-10. Adelanta la parte "gasto visible" de la 21.5. El costo por corrida en `runs` sigue sin exponerse |
| O13 | El cliente escribe por funciones `security definer` que verifican el rol adentro; plataforma, por funciones de `service_role` con `p_actor` | Igual que la 21.2 (S1) y la 21.1 |
| O14 | Una spec, dos planes: 21.3a (brain como fuente) y 21.3b (pantallas, presupuestos y retiro de scripts) | Cada plan deja el sistema funcionando. Los scripts se retiran al final de la 21.3b |

## 3. Bloques de canon (21.3a)

### 3.1 Formato

Mismo formato de líneas que ` ```gate ` (`lib/outreach/gate-blocks.ts`): una entrada por línea, `clave: valor`, `#` comenta, líneas vacías se ignoran.

````markdown
```icp
encaje: No es del universo: rubro ajeno, tamaño fuera de rango, o sin operación propia que coordinar
encaje: Podría ser: entra en tamaño y geografía, pero no se ve el problema de coordinación
encaje: Encaja: tamaño y rubro del ICP, con señales de que la operación creció más rápido que su método
rol: Sin relación con esta decisión
rol: Influye: sufre el problema o lo reporta, pero no aprueba el gasto
rol: Decide: dueño, dirección o gerencia con control sobre el presupuesto
excluir: La empresa es competidora nuestra, ya es cliente, o es proveedora nuestra
```

```hooks
h_crecer_sin_duplicar: Crecer sin duplicar
h_radar_1500: Radar 1500
```

```vectores
v1_familiar_2gen_ar: Empresa familiar de segunda o tercera generación, Argentina => h_metodo_en_la_cabeza
v6_relacion_directa: Relación previa directa del ejecutor con el decisor
```
````

El orden de las líneas `encaje:` y `rol:` es el orden de los niveles, del más bajo al más alto. En ` ```vectores `, lo que sigue a ` => ` es el hook por defecto; sin eso, el vector no tiene.

### 3.2 Parser

`lib/outreach/canon-blocks.ts`, puro, sin excepciones:

```ts
parseIcpBlocks(pages: { slug: string; body: string }[]): { icp: IcpLevels | null; errors: string[] }
parseMarcoBlocks(pages: { slug: string; body: string }[]): { hooks: ListValue[]; vectores: VectorValue[]; errors: string[] }
icpRevision(icp: IcpLevels): string   // sha256 del bloque normalizado, primeros 16 hex
```

Reglas del ICP (las mismas cotas que tenía `outreachConfigSchema.icp`): entre 2 y 10 niveles de `encaje`, entre 2 y 10 de `rol`, cada uno de 10 a 400 caracteres; exactamente una línea `excluir`, de 10 a 400. Tiene que haber exactamente un bloque ` ```icp ` entre todas las páginas: cero es "falta", dos o más es error y nombra las páginas.

Reglas de hooks y vectores: identificador `^[a-z0-9][a-z0-9_]{0,60}$`, rótulo de 1 a 200 caracteres; sin repetidos dentro de su clase aunque estén en páginas distintas; todo hook por defecto tiene que existir entre los hooks; al menos un hook y un vector. Los bloques de varias páginas se suman.

Cada error dice página y línea, en castellano, para mostrarlo tal cual.

### 3.3 Lectura del canon

`lib/outreach/canon.ts` suma `loadIcpLevels(brain)` y `loadMarco(brain)`: leen las páginas del tag, se quedan con las de estado `activo` (O8) y llaman al parser. Devuelven `{ ok: true, ... } | { ok: false; reason: "sin_brain" | "brain_caido" | "falta" | "invalido"; errors }`.

`MAX_PAGES_PER_TAG` (5) sigue valiendo: una empresa con más de cinco páginas `canon:hooks` es un error de carga del canon, no un caso a soportar.

### 3.4 Scoring

`outreach/icp-score` (`lib/outreach/services/icp-score.ts`) recibe `loadIcp: (tenantId) => Promise<...>` en sus dependencias y deja de leer `tenant.config.icp`. Se niega con:

| Motivo | Cuándo |
|---|---|
| `icp_sin_brain` | la empresa no tiene brain habilitado |
| `canon_no_disponible` | el brain no respondió |
| `icp_sin_niveles` | no hay bloque ` ```icp ` en páginas activas |
| `icp_invalido` | el bloque no parsea; el texto lleva el primer error |

`revision` en `contacts.icp` pasa a ser `icpRevision(levels)`: cada juicio guarda con qué ICP se hizo. Hoy ningún código mete esa revisión en el `input_hash` de la cola (el comentario de `lib/outreach/config.ts` lo afirma, pero `enqueue` no la usa), así que cambiar el ICP no recalifica solo a los contactos ya juzgados. Esta entrega no lo agrega (§8).

La puerta (`agents/outreach/schedules/dispatch.ts`) carga el ICP una vez por pasada y lo reusa: no hay una lectura del brain por contacto.

`outreachConfigSchema` pierde `icp`. `parseOutreachConfig` ignora la clave que quede en una fila vieja (zod descarta claves desconocidas). La migración no la borra, para que el código viejo siga calificando hasta el deploy; desaparece la primera vez que el administrador guarda los datos de outreach, porque `set_outreach_config` reemplaza la clave entera.

### 3.5 Reflejo de hooks y vectores

`lib/outreach/marco-reflect.ts`:

```ts
reflectMarco(tenantId, deps: { brain, store, now }): Promise<
  | { ok: true; upserts: number; deactivated: number; unchanged: number }
  | { ok: false; reason: "sin_brain" | "brain_caido" | "falta" | "invalido"; errors: string[] }
>
```

Lee con `loadMarco`, y si es válido llama una sola función de la base (§5.1) que aplica altas, cambios y desactivaciones en una transacción y deja el evento `outreach.marco_reflected`. Si no es válido no escribe `config_values` y deja `outreach.marco_reflect_failed` con los errores. El diff lo hace la función de la base, que devuelve los tres contadores.

**Enganche.** `getBrainProvider` (`lib/brain/adapters/provider.ts`) devuelve el proveedor envuelto por `withCanonReflection`: después de un `upsert` exitoso, si la página guardada tiene o tenía el tag `canon:hooks`, llama `reflectMarco` dentro de un `try/catch` que registra y sigue (O5). El borrado de páginas (`lib/brain/adapters/delete-page.ts`) hace lo mismo después de borrar. El módulo `lib/brain/core` no importa nada de outreach: el envoltorio vive en `adapters/` y recibe la función por parámetro.

**A mano.** Acción `rereadMarco(slug)` en settings (§6.2), para la primera carga después del deploy y para un brain externo por MCP, que se edita fuera de la plataforma.

### 3.6 Páginas por defecto

`createBrain` (`app/plataforma/[slug]/console-actions.ts`), después de asociar el wiki, crea dos páginas con el proveedor, autor `import`, estado `borrador`, categoría `comercial` (está en `DEFAULT_BRAIN_CONFIG`):

- `comercial/icp`, tag `canon:icp`: explicación de qué es cada nivel y un bloque ` ```icp ` con las líneas a completar.
- `comercial/hooks`, tag `canon:hooks`: bloques ` ```hooks ` y ` ```vectores ` con un ejemplo comentado.

Las plantillas van en `lib/outreach/canon-templates.ts`. No nombran a ningún cliente. Si crear las páginas falla, el brain queda creado y la consola avisa "No pude crear las páginas por defecto"; el "qué falta" las va a reclamar igual.

### 3.7 Requisito y "qué falta"

- `AGENT_CATALOG` suma `requiresBrain: boolean` (`outreach: true`). La acción `setAgent` de la consola rechaza habilitar un agente con `requiresBrain` si la empresa no tiene una conexión `brain` habilitada: "Este agente necesita el brain. Creá el brain primero." Se verifica en la acción porque el catálogo vive en código, como el nivel de efecto en `saveApproval` (21.2 §3.2).
- `platform_set_connection_enabled` y `platform_remove_connection` no cambian: si plataforma apaga el brain con el outreach habilitado, el "qué falta" marca `brain` y los nodos se niegan.
- `tenantReadiness` suma dos motivos, solo cuando la empresa tiene habilitado un agente con `requiresBrain` y tiene brain: `icp` ("falta el ICP en el brain") y `marco` ("faltan hooks y vectores en el brain"). La consola le pasa el resultado de `loadIcpLevels` y `loadMarco`; `readiness.ts` sigue puro. Un brain caído no suma motivo: se muestra "No pude leer el brain" al lado.

## 4. Pantallas (21.3b)

### 4.1 Cliente: `/<slug>/settings/outreach`

Solo administradores (`tenant_member` → 404), con link desde `/<slug>/settings`. Solo aparece si la empresa tiene el agente `outreach` habilitado. Cada sección que falla al leer muestra "No pude leer esta sección".

| Sección | Qué hace |
|---|---|
| **ICP** | Solo lectura: los niveles vigentes, o el motivo por el que no hay. Link a la página en el brain |
| **Hooks y vectores** | Solo lectura: la lista activa de `config_values`, el resultado del último reflejo (evento más reciente) con sus errores si falló, link a las páginas, y el botón "Releer del brain" |
| **Segmentos e idiomas** | Alta, cambio de rótulo, desactivar y reactivar. El idioma se elige entre `SUPPORTED_IDIOMAS` |
| **Datos de outreach** | Zona horaria, BCC, pipeline y etapa del deal, nombre y URL de la empresa que firma, modelo por rol (entre `tenant.allowedModels`; vacío usa el default de la plataforma) |
| **Workflows** | Por cada workflow del registry: encendido, cadencia en minutos, ítems por pasada, última corrida, recursos que usa. Si algún recurso tiene límite 0: "No va a correr: INNOV.AS todavía no cargó presupuesto de <recurso>" |
| **Presupuesto** | Solo lectura: por recurso, límite diario y gastado hoy (día de la zona horaria de la empresa) |

### 4.2 Plataforma: `/plataforma/<slug>`

Sección **Presupuestos**: una fila por recurso que usan los workflows del registry (`model_usd`, `apollo_credits`), con límite diario editable y gastado hoy. Sin fila, muestra 0.

## 5. Base de datos

Dos migraciones, una por plan: `20261017120000_outreach_marco_reflect.sql` (21.3a, solo `outreach_reflect_marco`) y `20261018120000_outreach_settings.sql` (21.3b, el resto). Antes de escribirlas se carga `supabase-postgres-best-practices`. No hay tablas nuevas: todas las que toca ya llevan `tenant_id` y RLS, y siguen cerradas a escritura directa.

### 5.1 Funciones

Del cliente: `security definer set search_path = ''`, `grant execute to authenticated`, primera línea el permiso (administrador de `p_tenant` o `platform_admin`; si no, 42501), reglas con `errcode = '23514'` y `hint = 'settings'`, evento con el actor en la misma transacción. Igual que la 21.2 §3.2.

| Función | Qué hace | Reglas | Evento |
|---|---|---|---|
| `set_list_value(p_tenant uuid, p_kind public.config_value_kind, p_value text, p_label text, p_active boolean)` | Alta o edición en `config_values` | `p_kind` solo `segmento` o `idioma` ("los hooks y vectores se editan en el brain"). No se puede desactivar el último activo de su clase. Formato de valor y rótulo: los `check` de la tabla, traducidos | `outreach.list_value_updated` |
| `set_outreach_config(p_tenant uuid, p_config jsonb)` | `config = jsonb_set(config, '{outreach}', p_config)`. No toca `brain` ni `approvals` | La fila de `tenant_agents` de `outreach` tiene que existir. `p_config` tiene que ser un objeto y no puede traer la clave `icp` | `outreach.config_updated` |
| `set_workflow(p_tenant uuid, p_workflow text, p_enabled boolean, p_cadence_minutes int, p_items_per_tick int)` | `insert ... on conflict (tenant_id, workflow) do update` de `enabled` y de las claves `cadence_minutes` e `items_per_tick` del config, sin tocar las demás | Cadencia entre 5 y 10080, ítems entre 1 y 1000 (las cotas de `platformSchema`) | `workflow.updated` con antes y después |
| `tenant_budget_status(p_tenant uuid, p_resources text[], p_since timestamptz) returns table (resource text, daily_limit numeric, spent numeric)` | Por cada recurso pedido, el límite (0 si no hay fila en `tenant_budgets`) y `usage_sum` desde `p_since` | Solo lectura. Mismo permiso: administrador de la empresa o plataforma | sin evento |

De plataforma: `grant execute to service_role`, con `p_actor`, `hint = 'consola'`.

| Función | Qué hace | Reglas | Evento |
|---|---|---|---|
| `platform_set_budget(p_actor uuid, p_tenant uuid, p_resource text, p_daily_limit numeric)` | Upsert en `tenant_budgets` con `updated_by = p_actor` | Límite entre 0 y 100000. Formato del recurso: el `check` de la tabla | `budget.updated` con antes y después |
| `outreach_reflect_marco(p_tenant uuid, p_hooks jsonb, p_vectors jsonb) returns jsonb` | En una transacción: upsert de los `hook` y `vector` recibidos (activos, con rótulo y `meta.default_hook`), y `active = false` para los `hook` y `vector` activos que no vinieron | Nunca borra. Nunca toca `segmento` ni `idioma`. Listas vacías se rechazan | `outreach.marco_reflected` con los tres contadores |

Lo que SQL no puede verificar lo verifica la acción antes de llamar: que el workflow y el recurso existan en `lib/workflows/registry.ts`, que los ítems no pasen el tope del workflow, y que `p_config` cumpla `outreachConfigSchema` con modelos dentro de `tenant.allowedModels`. `parseTenantWorkflowConfig` sigue revalidando en cada pasada.

### 5.2 Tests pgTAP (`31_outreach_marco_reflect.test.sql` y `32_outreach_settings.test.sql`)

Por cada función del cliente: puede el `tenant_admin` de la empresa y un `platform_admin`; reciben 42501 el `tenant_admin` de otra empresa, un `tenant_member` y `anon`. Además: `set_list_value` rechaza `hook` y `vector`, y desactivar el último; `set_outreach_config` preserva `brain` y `approvals` y rechaza `icp`; `set_workflow` crea la fila, preserva claves ajenas del config y respeta las cotas; `tenant_budget_status` no muestra otra empresa y suma solo desde `p_since`; `platform_set_budget` no lo ejecuta `authenticated`; `outreach_reflect_marco` desactiva sin borrar, no toca segmentos ni idiomas y rechaza listas vacías; cada escritura deja su evento; las tablas siguen sin escritura directa.

## 6. Aplicación

### 6.1 Lectura

`lib/outreach/outreach-settings-query.ts` normaliza las filas de la pantalla. `lib/workflows/settings.ts`, puro: `workflowRows(registry, tenantWorkflows, budgets)` arma cada fila con su tope y la marca de presupuesto en cero.

### 6.2 Acciones del cliente (`app/[tenant]/settings/outreach/actions.ts`)

Mismo patrón que `config-actions.ts`: zod, `resolveTenantAccess(slug)`, cliente de la sesión, revalidar, `{ ok: true } | { ok: false; message }`, misma traducción de errores.

| Acción | Llama |
|---|---|
| `saveListValue(slug, kind, value, label, active)` | `set_list_value` |
| `saveOutreachConfig(slug, input)` | `set_outreach_config`, después de validar con `outreachConfigSchema` y contra `allowedModels` |
| `saveWorkflow(slug, workflow, input)` | `set_workflow`, después de comprobar `isWorkflow` y el tope de ítems |
| `rereadMarco(slug)` | `reflectMarco` con el cliente admin, después de comprobar que quien llama es administrador. Devuelve los contadores o los errores |

### 6.3 Acción de plataforma (`app/plataforma/[slug]/console-actions.ts`)

`setBudget(slug, tenantId, resource, dailyLimit)`: `requirePlatformAdmin`, recurso dentro de los que usa el registry, `platform_set_budget`.

### 6.4 Lo que se retira

`scripts/outreach-config.mts`, `scripts/outreach-config-args.ts`, `scripts/workflows-set.mts`, `scripts/workflows-set-args.ts`, sus tests, las dos entradas de `package.json`, `tenants/innovas/outreach.json`, y `outreachFileSchema` y `planConfigValues` de `lib/outreach/config.ts`. Se actualizan las menciones en `docs/` y el roadmap.

## 7. Seguridad

- Ninguna acción toma la empresa del formulario: resuelve por `slug` con la sesión y la base vuelve a verificar el rol.
- El cliente no escribe `tenant_budgets` por ningún camino: no existe función de `authenticated` que lo haga.
- `rereadMarco` usa el cliente admin, así que la acción verifica el rol antes; no acepta contenido del navegador, solo relee el brain de esa empresa.
- El reflejo escribe solo `hook` y `vector` de la empresa cuyo brain se guardó; el `tenantId` sale del binding, nunca de la página.
- Los bloques son datos: los identificadores pasan por la misma expresión que el `check` de la tabla y los rótulos se muestran como texto.
- `tenant_budget_status` expone montos agregados por recurso al administrador (O12). `usage_entries` y el costo por corrida siguen cerrados.
- La regla "ningún nodo escribe `canon:*`, presupuestos ni interruptores de autonomía" se mantiene: las páginas por defecto las crea la acción de un `platform_admin`, los presupuestos una persona desde la consola, y el reflejo escribe `config_values`, no canon.

## 8. Qué no entra

- Umbrales del ICP (`DEFAULT_ICP_THRESHOLDS`): siguen en código.
- Recalificar solos a los contactos ya juzgados cuando cambia el ICP: hoy no existe y no se agrega. Un contacto se vuelve a calificar cuando vuelve a entrar a la cola de `icp-scoring`.
- `canon:gate`, voz y mensajes: ya viven en el brain.
- Presupuesto fijado por el cliente o techo por recurso.
- Clave de modelos por empresa y facturación (21.5).
- Nodos opcionales de un workflow (`optional_nodes`): ningún workflow tiene hoy.
- Validar los bloques al guardar dentro del editor del brain: el aviso llega después, por settings y el "qué falta".
- Reflejo automático para un brain externo por MCP editado fuera de la plataforma: se usa "Releer del brain".

## 9. Pruebas

- **pgTAP:** §5.2.
- **vitest:** parser (cada regla, error con página y línea, bloques repartidos en varias páginas, borradores ignorados); `icpRevision` estable ante espacios y cambia con un nivel; `icp-score` con cada negativa y sin leer `config.icp`; `reflectMarco` válido, inválido (no llama a la base) y con brain caído; el envoltorio refleja solo páginas `canon:hooks`, también cuando el tag se quitó, y **un reflejo que tira no hace fallar el `upsert`**; `createBrain` crea las dos páginas y sobrevive a que fallen; `setAgent` rechaza outreach sin brain; `tenantReadiness` con los motivos nuevos; acciones con el cliente doblado afirmando nombre y argumentos de cada `rpc`; las plantillas por defecto parsean una vez completadas y no nombran a ningún tenant.
- **Guardias existentes:** `tests/server-actions-exports.test.ts` y el test del registry siguen pasando.
- **Navegador, base local:** crear un brain y ver las dos páginas en borrador; completar y activar el ICP y ver que el "qué falta" lo suelta; editar hooks en el brain y verlos en Focos; romper un bloque y ver el error en settings con la lista anterior intacta; segmentos, datos y workflows como administrador; `/settings/outreach` da 404 a un miembro; presupuesto desde la consola y su reflejo en el cliente; 375 px.

## 10. Despliegue

Orden, para que INNOV.AS no quede sin calificar ni sin hooks:

1. **Antes del deploy, en el brain de `innovas`:** pegar el bloque ` ```icp ` en su página `canon:icp` con los niveles de `tenants/innovas/outreach.json`, y los bloques ` ```hooks ` y ` ```vectores ` en `comercial/outreach/22-redaccion` y `23-vectores`. El código viejo los ignora.
2. `npx supabase migration list`, y aplicar `20261017120000_outreach_marco_reflect` y `20261018120000_outreach_settings` antes que el código. El código viejo contra la base nueva sigue andando: la migración solo agrega funciones.
3. Desplegar el código.
4. En `/innovas/settings/outreach`: "Releer del brain" y comprobar que no desactiva nada (los identificadores pegados son los mismos).

**Terminado cuando**, en producción: un administrador de `innovas` cambia un nivel del ICP en el brain y el siguiente contacto calificado queda con la huella nueva; agrega un hook en el brain y aparece en Focos sin tocar nada más; apaga y enciende un workflow desde settings; y un `platform_admin` cambia un presupuesto desde la consola y el cliente lo ve.
