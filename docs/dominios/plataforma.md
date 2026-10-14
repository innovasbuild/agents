---
title: Plataforma y settings por empresa
category: dominios
status: activo
tags: [plataforma, consola, tenants, marca, settings, presupuestos]
updated: 2026-10-14
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
  - lib/usage/report.ts
  - lib/usage/reconcile.ts
  - lib/agents/catalog.ts
  - supabase/migrations/20261015120000_platform_console.sql
  - supabase/migrations/20261023120000_spend_report.sql
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

`/login/[tenant]` es pública: con el cliente admin (`loadPublicTenant`) lee solo lo que la landing muestra (logo o nombre, colores, métodos permitidos y dominios abiertos). Un slug inexistente o una empresa inactiva da 404. Los métodos posibles son `email`, `google` y `microsoft` (`AUTH_METHODS`); `/login` general ofrece solo los que alguna empresa activa tiene habilitados.

### Detalle de una empresa en la consola

`/plataforma/[slug]` muestra, en orden: el formulario de la empresa, **Qué falta** (`tenantReadiness`: sin agentes, sin brain, faltan conectores, conectores sin verificar, falta el ICP o los hooks en el brain), **Agentes**, **Brain**, **Conectores**, **Presupuestos** y **Usuarios**.

- **Agentes** (`setAgent`): habilita o deshabilita un agente del catálogo y fija su acceso al brain (`none`, `read`, `read_write`) con `platform_set_agent` (evento `agent.updated`). Un agente que requiere brain no se habilita hasta que exista uno; al prenderse por primera vez se siembran las páginas del canon.
- **Brain** (`createBrain`, `setBrainCategories`): crea el binding `brain/wiki` con la configuración por defecto (categorías `empresa`, `producto`, `comercial`, `operacion` y el frontmatter requerido) y edita las categorías. El contenido del brain se explica en [brain](brain.md).
- **Conectores**: ver [conectores](conectores.md).
- **Presupuestos** (`setBudget`): límite diario por recurso en `tenant_budgets`, vía `platform_set_budget`. Los recursos salen del registro en código (`budgetResources`), no de la base. Con límite en 0 los procesos que usan ese recurso no corren. El día se corta en UTC.

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
npm test -- tests/plataforma tests/tenants tests/brand tests/settings
npm run db:test   # 29_platform_console, 30_tenant_settings, 36_spend_report, 20_auth_methods_create_tenant, 17_reserved_tenant_slugs
```

Tests clave: `tests/plataforma/*` (acciones de la consola, alta, páginas), `tests/tenants/platform.test.ts` (gate), `readiness.test.ts`, `tests/brand/contrast.test.ts`, `tests/settings/*` (config, ingreso, outreach, gasto), `tests/plataforma/gasto-*.test.ts` (pantalla y conciliación). No se probó en automático la verificación contra Vercel real ([#87](https://github.com/innovasbuild/agents/pull/87)).

## 5. Decisiones

- Specs: [gasto de IA (21.5)](../superpowers/specs/2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md), [consola de plataforma](../superpowers/specs/2026-10-05-consola-plataforma-design.md), [alta de empresas y landing](../superpowers/specs/2026-10-05-alta-empresas-landing-design.md), [etapa 21.1](../superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md), [etapa 21.2](../superpowers/specs/2026-10-10-etapa-21-2-settings-cliente-design.md).
- [#14](https://github.com/innovasbuild/agents/pull/14): base de diseño y marca por tenant (`brandStyle`, `--ring`, contraste).
- [#70](https://github.com/innovasbuild/agents/pull/70): consola de plataforma; el dueño sale de `PLATFORM_OWNER_TENANT_SLUG`.
- [#71](https://github.com/innovasbuild/agents/pull/71): alta de empresas y landing `/login/<slug>`. Su cuerpo habla de `create_tenant` y de dos métodos de login; hoy la función es `platform_create_tenant` y hay tres métodos (la spec de alta quedó atrás).
- [#87](https://github.com/innovasbuild/agents/pull/87): agentes, brain y conectores por empresa; `tenant_agents` cerrado a escritura desde la sesión.
- [#89](https://github.com/innovasbuild/agents/pull/89): settings del cliente (ejecutores, aprobaciones, conectores).
- #71 dice que los métodos de login se restringen solo en pantalla; desde la Etapa 20.1 se imponen también en el servidor ([#85](https://github.com/innovasbuild/agents/pull/85), ver [identidad y acceso](../arquitectura/identidad-y-acceso.md)).
- [Etapa 21.5](../superpowers/specs/2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md): gasto de IA por empresa; las dos pantallas de gasto y la conciliación. El detalle de costos está en [modelos y costos](../arquitectura/modelos-y-costos.md).
