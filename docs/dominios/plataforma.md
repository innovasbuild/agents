---
title: Plataforma y settings por empresa
category: dominios
status: activo
tags: [plataforma, consola, tenants, marca, settings, presupuestos]
updated: 2026-10-15
sources:
  - app/plataforma
  - app/(auth)/login/[tenant]/page.tsx
  - app/[tenant]/settings
  - lib/tenants/platform.ts
  - lib/tenants/platform-owner.ts
  - lib/tenants/public.ts
  - lib/tenants/readiness.ts
  - lib/tenants/tenant-create.ts
  - lib/tenants/tenant-form.ts
  - lib/tenants/auth-methods.ts
  - lib/brand/contrast.ts
  - lib/domains
  - docs/superpowers/specs/2026-10-14-etapa-21-6-dominio-por-empresa-design.md
  - lib/tenants/brand-metadata.ts
  - lib/usage/report.ts
  - lib/usage/reconcile.ts
  - lib/agents/catalog.ts
  - supabase/migrations/20261015120000_platform_console.sql
  - supabase/migrations/20261023120000_spend_report.sql
  - supabase/migrations/20261026120000_platform_enable_brain_skills.sql
  - supabase/migrations/20260912195514_brand_bucket.sql
  - docs/superpowers/specs/2026-10-05-consola-plataforma-design.md
  - docs/superpowers/specs/2026-10-05-alta-empresas-landing-design.md
  - docs/superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md
  - docs/superpowers/specs/2026-10-10-etapa-21-2-settings-cliente-design.md
  - docs/superpowers/specs/2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md
---

# Plataforma y settings por empresa

## 1. Qué es y para qué

Hay dos niveles de administración. **Plataforma** es quien opera el producto: da de alta empresas (tenants), les habilita agentes, les crea el brain, les asocia conectores, les fija presupuestos y les carga la marca. Vive en la consola `/plataforma`. **El administrador del cliente** configura su propia empresa desde `/[tenant]/settings`: modelo, ingreso por dominio, ejecutores, aprobaciones, conectores propios y la configuración de outreach. La separación se sostiene en la base, no en la pantalla: las tablas no se escriben directo desde la sesión y cada cambio pasa por una función `security definer` que verifica el rol y deja un evento en `events`.

Nada específico de una empresa está en el código: la diferencia entre empresas es una fila en `tenants` y su brain. La marca (colores y logo) y la landing de login se derivan de esa fila.

## 2. Dónde vive en el código

| Ruta o archivo | Qué hace |
|---|---|
| `/plataforma` (`app/plataforma/page.tsx`) | Listado de empresas: estado, usuarios, "qué falta" por empresa |
| `/plataforma/nueva` | Alta de una empresa (`nueva/actions.ts`, `create-form.tsx`) |
| `/plataforma/[slug]` | Detalle: datos y marca, qué falta, agentes, brain, conectores, presupuestos, usuarios (solo lectura) |
| `/plataforma/gasto` (`app/plataforma/gasto/`) | Gasto en modelos de todas las empresas y conciliación contra el AI Gateway (`page.tsx`, `reconcile-panel.tsx`, `actions.ts`) |
| `app/plataforma/[slug]/console-actions.ts` | Server actions de la consola (agentes, brain, conectores, presupuestos) |
| `app/plataforma/[slug]/actions.ts` | `updateTenant`: nombre, dominios, modelos, métodos de login, colores, logo, activo |
| `/login/[tenant]` | Landing pública de login de cada empresa |
| `/[tenant]/settings` | Settings del administrador del cliente |
| `/[tenant]/settings/usuarios` | Usuarios e invitaciones: ver [invitaciones y usuarios](invitaciones-y-usuarios.md) |
| `/[tenant]/settings/outreach` | Configuración del agente de outreach |
| `/[tenant]/settings/gasto` | Gasto del mes en modelos de IA de la empresa (solo administrador) |
| `lib/tenants/platform.ts`, `platform-owner.ts` | `requirePlatformAdmin`, `platformOwnerSlug` |
| `lib/tenants/public.ts` | `loadPublicTenant` (landing) y `loadOfferedMethods` (`/login`) |
| `lib/tenants/readiness.ts` | "Qué falta" de una empresa, puro |
| `lib/agents/catalog.ts` | `AGENT_CATALOG`: única lista de agentes (nombre, capacidades, si requiere brain) |
| `lib/brand/contrast.ts` | `brandStyle` y `foregroundFor`: marca a variables CSS |

## 3. Cómo funciona

### Quién es "plataforma": `requirePlatformAdmin`

La consola es solo para quien tenga el rol `platform_admin` **en el tenant dueño**, cuyo slug sale de la variable de entorno `PLATFORM_OWNER_TENANT_SLUG` (`platformOwnerSlug`). Sin la variable no hay dueño y la consola da 404 a todos. `requirePlatformAdmin` devuelve `null` (la página responde 404, no 403: un 403 confirmaría que la consola existe) si no hay sesión o no sos administrador del tenant dueño; y si lo sos pero entraste por un método de login que el tenant dueño no permite, redirige a su landing. La RLS (`is_platform_admin()`) acepta ese rol en cualquier tenant: la restricción al dueño la pone la aplicación, así que ninguna pantalla debe ofrecer el rol `platform_admin` fuera de él. Además el tenant dueño no se puede desactivar ni se le puede sacar el método de login con el que entra quien edita (dejaría la consola sin acceso).

### Alta de una empresa

`/plataforma/nueva` recibe nombre, slug (`^[a-z][a-z0-9-]{1,38}$`, con slugs reservados como `plataforma`), dominios, métodos de login, colores, logo, correo del primer administrador y los agentes del catálogo. La función `platform_create_tenant` crea la fila de `tenants` y una fila de `tenant_agents` por agente, en una sola transacción, y deja el evento `tenant.created`. Lo que no es transaccional va aparte y, si falla, la empresa queda creada y la pantalla lo informa como advertencia: la subida del logo y la invitación al primer administrador (`inviteToTenant`, rol `tenant_admin`; ver [invitaciones y usuarios](invitaciones-y-usuarios.md)). El alta exige al menos un agente; después la empresa puede quedar solo con brain y sin agentes habilitados (`tenantReadiness` lo contempla).

### Marca por empresa y landing

La marca vive en `tenants.brand` (`primary`, `secondary`, `logoUrl`). `brandStyle` la traduce a variables CSS y **calcula el color del texto por contraste** (WCAG): el cliente carga el color, el texto encima no se elige a mano. El logo (PNG, SVG o WebP, hasta 1 MB) va al bucket público `brand` de Supabase Storage, en `brand/<slug>/logo-<timestamp>.<ext>`: la primera carpeta es el slug y las policies de escritura dejan subir solo a un `tenant_admin` de esa empresa o a plataforma. Cada subida usa un nombre nuevo, sin sobrescribir.

El title y el favicon también salen de la marca: `tenantMetadata` (`lib/tenants/brand-metadata.ts`) devuelve `<empresa> - Central IA` como title y el logo como `icons.icon`, y lo usan `app/[tenant]/layout.tsx` y `/login/[tenant]`. Sin logo no pisa nada y queda el ícono de INNOV.AS que declara el `metadata.icons` del root (`app/layout.tsx`, archivos en `public/`; con archivos de convención en `app/` un layout hijo no los reemplazaba y el navegador veía dos `<link rel="icon">`). Una empresa con logo no tiene `apple-touch-icon`, porque iOS no lee SVG y el logo puede serlo.

`/login/[tenant]` es pública: con el cliente admin (`loadPublicTenant`) lee solo lo que la landing muestra (logo o nombre, colores, métodos permitidos y dominios abiertos). Un slug inexistente o una empresa inactiva da 404. Los métodos posibles son `email`, `google` y `microsoft` (`AUTH_METHODS`); `/login` general ofrece solo los que alguna empresa activa tiene habilitados.

### Detalle de una empresa en la consola

`/plataforma/[slug]` muestra, en orden: el formulario de la empresa, **Qué falta** (`tenantReadiness`: sin agentes, sin brain, faltan conectores, conectores sin verificar, falta el ICP o los hooks en el brain), **Agentes**, **Brain**, **Conectores**, **Dominio**, **Presupuestos** y **Usuarios**.

- **Agentes** (`setAgent`): habilita o deshabilita un agente del catálogo y fija su acceso al brain (`none`, `read`, `read_write`) con `platform_set_agent` (evento `agent.updated`). Un agente que requiere brain no se habilita hasta que exista uno; al prenderse por primera vez se siembran las páginas del canon.
- **Brain** (`createBrain`): crea el binding `brain/wiki` con la configuración por defecto (categorías `empresa`, `producto`, `comercial`, `operacion` y el frontmatter requerido) y una carpeta de primer nivel por categoría (`brain_folders_from_config`). Las categorías se muestran solo en lectura, con el link "Editar en el brain": son las carpetas de primer nivel y se crean y borran desde el árbol del brain (etapa 26.1a). **Habilitar skills** (`enableBrainSkills`): si las categorías no incluyen `skill`, la sección ofrece el botón "Habilitar skills", que llama a `platform_enable_brain_skills` (`security definer`, solo `service_role`). Bloquea el binding, crea la carpeta `skills` con `brain_ensure_folders`, sincroniza `config.categories` (suma `skill`) y deja el evento `brain.skills_enabled`. Es el único camino porque `skills` es una ruta reservada que `brain_create_folder` rechaza. Habilitar de nuevo no cambia nada ni deja otro evento; repone la categoría si la carpeta estaba pero la config no; falla con mensaje de consola si la empresa no tiene brain o ya tiene 20 carpetas de primer nivel. Deshabilitar skills no existe. El contenido del brain se explica en [brain](brain.md).
- **Conectores**: ver [conectores](conectores.md).
- **Dominio** (`addTenantDomain`, `verifyTenantDomain`, `makeTenantDomainPrimary`, `removeTenantDomain`, en `domain-actions.ts`): el dominio propio de la empresa (por ejemplo `ai.okeefe.com.ar`). Cada acción repite `requirePlatformAdmin` y comprueba que el dominio sea de la empresa de la página; el administrador de la empresa solo lo ve, en su `/settings`. El detalle está abajo.
- **Presupuestos** (`setBudget`): límite diario por recurso en `tenant_budgets`, vía `platform_set_budget`. Los recursos salen del registro en código (`budgetResources`), no de la base. Con límite en 0 los procesos que usan ese recurso no corren. El día se corta en UTC.

### Dominio propio de una empresa

`lib/domains/` hace el trabajo y no importa `next/*`, porque lo usa también un schedule de eve. `service.ts` es la máquina de estados (`pending`, `verifying`, `active`, `failed`) con todo lo externo inyectado; `vercel.ts` y `supabase-auth.ts` son los adaptadores de las dos APIs; `store.ts` lee y escribe `tenant_domains` con la service role; `hostname.ts` valida; `view.ts` arma lo que muestra la consola; `origin.ts` decide con qué dominio sale un link de invitación.

- **Agregar** valida el hostname (subdominio completo; no hosts de la plataforma, `*.vercel.app`, IPs ni `localhost`), inserta la fila, lo agrega al proyecto de Vercel y hace un primer intento de activar.
- **Activar** (`refreshDomain`) pide a Vercel que verifique la propiedad y mira que el DNS apunte a la plataforma y se pueda emitir el certificado; recién después lo suma a las Redirect URLs de Supabase Auth, lo marca `active` y, si es el primero de la empresa, principal. Si falla Supabase no se activa. Un error definitivo de Vercel (dominio en otro proyecto, inválido) lo deja `failed`; uno transitorio, en el estado que tenía.
- **Quitar** lo saca de Vercel (si Vercel falla no borra la fila), de la base y de las Redirect URLs, y promueve otro dominio activo a principal.
- **Barrido**: el schedule `domain-sweep` (cada 10 minutos) activa los que esperan DNS.
- **Links de invitación** salen con el dominio principal activo de la empresa (`invitationOrigin`), también cuando quien invita está en el host raíz. El link mágico del login no: vuelve al host donde se pidió, porque el verificador PKCE vive en sus cookies.

Las instrucciones de DNS que muestra la consola salen de Vercel en cada carga (con un tope de 4 segundos por dominio). Paso a paso para una empresa: [dominio de un cliente](../guias/dominio-de-un-cliente.md).

### Gasto en modelos: `/plataforma/gasto`

Desde `/plataforma` el link "Gasto" lleva a una tabla con una fila por empresa (hoy, mes en curso y mes anterior, todo en UTC) y la fila de total. La página llama a `requirePlatformAdmin` (404 si no) y recién después lee con `service_role` la función `platform_spend_report`, que no es ejecutable por `authenticated` y devuelve una fila por empresa y rango (la página pide tres: hoy, mes en curso y mes anterior). Debajo está el panel de conciliación: un botón por período (mes en curso o anterior) que dispara la server action `reconcileSpend`, la cual vuelve a comprobar `requirePlatformAdmin`, pide al AI Gateway el gasto por tag y por día, y lo compara con el libro. Se marca una diferencia mayor a US$ 1 o al 5 % del gateway, la que sea más grande; una fila "Sin etiqueta" muestra lo que el gateway cobró sin tag de empresa. Si el gateway rechaza la consulta, la pantalla lo dice y el resto sigue funcionando. Cómo se calcula, el tag `tenant:<slug>` y las causas conocidas de diferencia están en [modelos y costos](../arquitectura/modelos-y-costos.md#reporte-por-período-y-conciliación).

### Settings del cliente

`/[tenant]/settings` es territorio de administrador: un `tenant_member` recibe 404 aunque la RLS le dejaría leer. Las secciones que muestra la página:

| Sección | Qué permite |
|---|---|
| Modelo default | Elegir entre los modelos que plataforma permitió (`allowed_models`); solo si la empresa tiene agentes |
| Ingreso | Abrir o cerrar el ingreso por dominio; los dominios los carga plataforma (ver [invitaciones y usuarios](invitaciones-y-usuarios.md)) |
| Ejecutores | Solo si la empresa tiene outreach habilitado. Alta, edición (slug, firma, puesto, LinkedIn, cupo diario hasta 200) y baja de ejecutores en `executors`; no se quita a quien tiene historial |
| Aprobaciones | Solo con outreach o algún agente con pasos para aprobar. Política de los pasos de nivel 2 por agente: siempre pedir, pedir la primera vez, sin pedir |
| Conectores | Encender y apagar los que plataforma asoció; sin ver `connector_uid` ni `config` |

Ejecutores, aprobaciones y conectores usan las funciones `set_executor`, `remove_executor`, `set_approval` y `set_connection_enabled`, ejecutables por `authenticated` pero que verifican adentro `tenant_admin` de esa empresa o plataforma. Las server actions resuelven la empresa por `slug` con la sesión y nunca toman un `tenant_id` del navegador. Un `tenant_admin` solo puede escribir `default_model` y `self_signup_by_domain` en `tenants` (trigger `tenants_guard_columns`).

`/[tenant]/settings/gasto` es la vista del administrador de su propio gasto: mes en curso o anterior (`?periodo=anterior`), total, tabla por día y por origen (chat, procesos programados o el workflow). Lee con la sesión la función `tenant_spend_report`, que verifica adentro `tenant_admin` de esa empresa o plataforma; un `tenant_member` recibe 404. Se llega desde el link "Gasto →" de la página de settings.

`/[tenant]/settings/outreach` (requiere el agente `outreach` habilitado) muestra: Cliente ideal (ICP) y Hooks y vectores (resumen leído del brain, con relectura), Segmentos e idiomas y Datos de outreach (zona horaria, BCC, pipeline y etapa de negocio, empresa que firma, modelos), Procesos automáticos y Presupuesto de hoy. Lee `config_values` (listas de segmentos, idiomas, hooks y vectores) y `tenant_workflows` (qué procesos automáticos corre la empresa), y escribe con `set_list_value`, `set_outreach_config` y `set_workflow`. Los workflows en sí se explican en [workflows](workflows.md) y el agente en [outreach](outreach.md).

## 4. Cómo se prueba

```bash
npm test -- tests/plataforma tests/tenants tests/brand tests/settings tests/domains
npm run db:test   # 29_platform_console, 38_platform_enable_brain_skills, 30_tenant_settings, 36_spend_report, 37_tenant_domains, 20_auth_methods_create_tenant, 17_reserved_tenant_slugs
```

Tests clave: `tests/plataforma/*` (acciones de la consola, alta, páginas), `tests/tenants/platform.test.ts` (gate), `readiness.test.ts`, `tests/brand/contrast.test.ts`, `tests/settings/*` (config, ingreso, outreach, gasto), `tests/plataforma/gasto-*.test.ts` (pantalla y conciliación). `tests/domains/*` cubre las dos APIs con `fetch` simulado contra los contratos documentados, la máquina de estados y la vista. No se probó en automático la verificación contra Vercel real ([#87](https://github.com/innovasbuild/agents/pull/87)), ni los adaptadores de dominios contra la API real de Vercel y de Supabase.

## 5. Decisiones

- Specs: [gasto de IA (21.5)](../superpowers/specs/2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md), [consola de plataforma](../superpowers/specs/2026-10-05-consola-plataforma-design.md), [alta de empresas y landing](../superpowers/specs/2026-10-05-alta-empresas-landing-design.md), [etapa 21.1](../superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md), [etapa 21.2](../superpowers/specs/2026-10-10-etapa-21-2-settings-cliente-design.md).
- [#14](https://github.com/innovasbuild/agents/pull/14): base de diseño y marca por tenant (`brandStyle`, `--ring`, contraste).
- [#70](https://github.com/innovasbuild/agents/pull/70): consola de plataforma; el dueño sale de `PLATFORM_OWNER_TENANT_SLUG`.
- [#71](https://github.com/innovasbuild/agents/pull/71): alta de empresas y landing `/login/<slug>`. Su cuerpo habla de `create_tenant` y de dos métodos de login; hoy la función es `platform_create_tenant` y hay tres métodos (la spec de alta quedó atrás).
- [#87](https://github.com/innovasbuild/agents/pull/87): agentes, brain y conectores por empresa; `tenant_agents` cerrado a escritura desde la sesión.
- [#89](https://github.com/innovasbuild/agents/pull/89): settings del cliente (ejecutores, aprobaciones, conectores).
- #71 dice que los métodos de login se restringen solo en pantalla; desde la Etapa 20.1 se imponen también en el servidor ([#85](https://github.com/innovasbuild/agents/pull/85), ver [identidad y acceso](../arquitectura/identidad-y-acceso.md)).
- [Etapa 21.6](../superpowers/specs/2026-10-14-etapa-21-6-dominio-por-empresa-design.md): dominio propio por empresa. Corte b: la sección Dominio de la consola, las APIs de Vercel y de Supabase, el barrido y los links de invitación.
- [Etapa 21.5](../superpowers/specs/2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md): gasto de IA por empresa; las dos pantallas de gasto y la conciliación. El detalle de costos está en [modelos y costos](../arquitectura/modelos-y-costos.md).
