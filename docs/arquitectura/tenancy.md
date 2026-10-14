---
title: Tenancy
category: arquitectura
status: activo
tags: [tenancy, rls, roles, plataforma]
updated: 2026-10-13
sources:
  - docs/superpowers/specs/01-multi-tenant.md
  - docs/superpowers/specs/2026-10-05-consola-plataforma-design.md
  - docs/superpowers/specs/2026-10-05-alta-empresas-landing-design.md
  - docs/superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md
  - supabase/migrations/20260912192239_tenants_memberships.sql
  - supabase/migrations/20260912193318_conversations_tenant_agents.sql
  - supabase/migrations/20261011120000_memberships_lock_columns.sql
  - supabase/migrations/20261012120000_join_by_domain.sql
  - supabase/migrations/20261014120000_member_blocks.sql
  - supabase/migrations/20261015120000_platform_console.sql
  - supabase/migrations/20261019120000_agentless_tenant.sql
  - lib/tenants/platform-owner.ts
  - lib/tenants/platform.ts
  - lib/tenants/resolve.ts
  - lib/tenants/home.ts
  - lib/tenants/enabled-agents.ts
  - lib/invitations/domain.ts
  - lib/agents/catalog.ts
  - supabase/tests/01_tenants_memberships.test.sql
  - app/plataforma/page.tsx
  - app/sin-acceso/page.tsx
---

# Tenancy

Un tenant es una empresa cliente. Todo lo que la plataforma guarda pertenece a un tenant y se filtra por `tenant_id` con RLS. INNOV.AS es un tenant más; lo único que lo distingue es una variable de entorno, no el código.

## Las tablas

| Tabla | Para qué |
|---|---|
| `tenants` | La empresa: `slug` único, `display_name`, `allowed_domains`, `default_model` y `allowed_models`, `self_signup_by_domain`, `auth_methods`, `brand` (colores y logo), `active` |
| `memberships` | Quién pertenece a qué empresa y con qué rol. Única por `(tenant_id, user_id)` |
| `invitations` | Altas por mail: `pending`, `accepted` o `revoked`, con vencimiento a 14 días |
| `tenant_agents` | Qué agentes tiene habilitados una empresa, con su `config` (por ejemplo el acceso al brain: `none`, `read` o `read_write`) |
| `membership_blocks` | Personas bloqueadas en una empresa, para que un dominio abierto no las vuelva a unir |

Las columnas están en las migraciones y en `lib/supabase/database.types.ts`; ver [tablas](../referencia/tablas.md).

## Roles

El enum `tenant_role` tiene tres valores.

| Rol | Qué puede |
|---|---|
| `platform_admin` | Opera la plataforma: ve todas las empresas, las edita, las da de alta, administra agentes, brain y conectores. Solo cuenta en el tenant dueño (ver abajo) |
| `tenant_admin` | Administra su empresa: invita, bloquea, cambia el rol de sus miembros, usa los ajustes de la empresa y lee las conversaciones de su gente |
| `tenant_member` | Usa lo que la empresa tiene habilitado. Ve su propio trabajo; lo del brain depende de las reglas de acceso |

Un `tenant_admin` no puede coronar a nadie como `platform_admin`: el `with check` de `memberships_write` lo impide. Una empresa nunca queda sin administrador: el trigger `memberships_keep_one_admin` frena el `UPDATE` de rol, el `DELETE` y el bloqueo que dejaría la empresa sin `tenant_admin` ni `platform_admin`.

## El tenant dueño y `platform_admin`

`PLATFORM_OWNER_TENANT_SLUG` es una variable solo de servidor (sin `NEXT_PUBLIC_`) que dice cuál tenant es el dueño de la plataforma. La lee `platformOwnerSlug()` en `lib/tenants/platform-owner.ts`, un módulo sin dependencias porque también lo usa el adaptador del brain. En local vale el tenant sembrado; en producción, el de INNOV.AS.

Solo una fila `platform_admin` del tenant dueño es "de plataforma". Esto se aplica en la aplicación, no en la base:

- `requirePlatformAdmin()` (`lib/tenants/platform.ts`) devuelve `null` (y la página responde 404) si no hay sesión, si la variable no está o si la persona no es `platform_admin` del tenant dueño.
- `resolveTenantAccess(slug)` (`lib/tenants/resolve.ts`) deja entrar a cualquier empresa al `platform_admin` del dueño, aunque no tenga membresía ahí, y su rol de plataforma gana sobre el local. Una fila `platform_admin` en otro tenant vale como `tenant_admin` de ese tenant.
- El canal MCP del agente y el endpoint MCP del brain usan el mismo criterio (`loadPlatformOwnerTenantId` en `lib/auth/oauth-principal.ts`). Sin la variable, nadie entra como plataforma por esos canales.

La RLS, en cambio, usa `is_platform_admin()`, que acepta una fila `platform_admin` de cualquier tenant. Es un límite conocido: una fila así creada por SQL fuera del dueño no abre la consola pero conserva acceso a nivel de datos. Por eso la app nunca otorga el rol desde una pantalla.

## Cómo se entra

| Ruta | Qué es |
|---|---|
| `/login` | Login general (link o código por mail, Google) |
| `/login/[tenant]` | Landing pública de la empresa, con su logo y colores y solo los métodos de login que permite (`auth_methods`). Slug inexistente o empresa inactiva: 404 |
| `/auth/callback`, `/auth/confirmar` | Cierran el login y aceptan invitaciones |
| `/[tenant]` | No tiene portada: redirige a lo que la empresa tenga. `tenantHome` elige `/chat` si hay un agente con chat habilitado, si no `/brain`, si no `/conectar` |
| `/sin-acceso` | Cuenta creada que no pertenece a ninguna empresa |
| `/plataforma` | Consola: listado de empresas con usuarios, estado y "qué falta" |
| `/plataforma/[slug]` | Detalle y edición de una empresa; agentes, brain y conectores |
| `/plataforma/nueva` | Alta de empresa, con sus agentes y el correo del primer administrador |

Reglas del acceso a un tenant, en `resolveTenantAccess`:

1. El tenant sale de la URL y se valida contra `memberships` en cada request. Sin sesión, sin membresía o tenant inactivo: `null`, y la página responde 404. Nunca 403, porque un 403 confirma que el cliente existe.
2. El método con el que se abrió la sesión tiene que estar en `auth_methods` de la empresa; si no, se redirige a su landing. El `platform_admin` se chequea contra el tenant dueño, no contra la que visita.
3. La alta es solo por invitación. `allowed_domains` valida al invitar (`isAllowedDomain`; lista vacía es sin restricción). Con `self_signup_by_domain` en `true` además es puerta de entrada: la función `join_tenants_by_domain` une como `tenant_member` a quien tenga correo de un dominio permitido.

### Dominios permitidos

El modo abierto exige al menos un dominio (`tenants_self_signup_needs_domain`). El trigger `tenants_guard_columns` hace tres cosas: un `tenant_admin` solo puede cambiar `default_model` y `self_signup_by_domain` de su fila, el resto es de plataforma; no se puede abrir el ingreso con un dominio de correo público (gmail.com y similares, lista en `lib/tenants/public-email-domains.ts` y su espejo en SQL, comparados por un test); y una columna nueva de `tenants` nace cerrada porque compara el `jsonb` entero.

### Bloqueos

`block_member` y `unblock_member` (solo administradores) sacan y reponen a una persona. Un bloqueado no vuelve por dominio abierto ni se le ofrece la landing; aceptar una invitación levanta el bloqueo, porque es una decisión explícita y más nueva. Nadie se bloquea a sí mismo y solo plataforma bloquea a un `platform_admin`.

## Slugs reservados

El slug de un tenant es la primera palabra de la URL, así que no puede coincidir con una ruta de primer nivel de `app/`. La constraint `tenants_slug_not_reserved` reserva `api`, `auth`, `brain`, `eve`, `login`, `oauth`, `plataforma` y `sin-acceso`. Agregar una ruta de primer nivel a `app/` exige sumar su palabra a esa constraint (hay una migración por palabra nueva) y a su test, `supabase/tests/17_reserved_tenant_slugs.test.sql`. El formato del slug es `^[a-z][a-z0-9-]{1,38}$`.

## RLS por `tenant_id`

El patrón es uniforme: `select` para miembros del tenant o `platform_admin`, escritura cerrada a `authenticated` y hecha por el servidor.

- Helpers `security definer` con `set search_path = ''`: `is_platform_admin()`, `is_member_of(tenant)` y `has_tenant_role(tenant, roles)`. Rompen la recursión de las políticas de `memberships` sobre sí misma y se ejecutan fuera de la RLS del que llama.
- `memberships`: `authenticated` ya no puede hacer `INSERT` ni `UPDATE` salvo de la columna `role` (PR [#80](https://github.com/innovasbuild/agents/pull/80)). Las altas pasan por `accept_pending_invitations` y `join_tenants_by_domain`.
- `tenant_agents`: desde la consola 21.1 se cierra a escritura desde la sesión; todo cambio va por funciones `platform_*` que solo ejecuta `service_role` y dejan su evento. La política `tenant_agents_select` sigue.
- `conversations`: el dueño lee y escribe lo suyo; el admin lee las del tenant, pero continuar una sesión de eve exige ser el dueño, y eso lo valida el canal.
- `runs`: grants por columna; el costo solo lo ve plataforma. No se hace `select *`.

Una empresa sin `tenant_agents` es válida (PR [#91](https://github.com/innovasbuild/agents/pull/91)).

## Empresa sin agentes: solo brain

`platform_create_tenant` acepta cero agentes. Sin agentes habilitados:

- `/[tenant]` aterriza en `/brain` si hay brain, si no en `/conectar`.
- Las pantallas de outreach dan 404 (`requireAgent` / `requireChatAgent` en `lib/tenants/enabled-agents.ts`; `AGENT_CATALOG` en `lib/agents/catalog.ts` dice qué agente es dueño de cada pantalla) y el menú las oculta.
- Configuración oculta Modelo, Ejecutores, Aprobaciones y Conectores.
- El brain nace sin canon de outreach: las páginas de canon se siembran al prender un agente que las usa, plantilla por plantilla y sin pisar nada.
- Si no se pueden leer los agentes habilitados, no se oculta ni se bloquea nada. Una falla de lectura no degrada a una empresa que sí los tiene.

`loadBrainEnabled` mira `tenant_connections` (capacidad `brain` habilitada); si falla la lectura asume que el brain está.

## Cómo se prueba

- **pgTAP** (`npm run db:test`, necesita Docker): `01_tenants_memberships` (aislamiento entre tenants y escalada de rol), `02_invitations`, `17_reserved_tenant_slugs`, `25_memberships_lock_columns`, `26_join_by_domain`, `28_member_blocks`, `29_platform_console`, `33_agentless_tenant`. Además `06_anon_grants` barre todas las tablas de `public` y falla si `anon` tiene algún privilegio; `07_authenticated_grants` hace lo mismo con los privilegios que `authenticated` no usa (`TRUNCATE`, `TRIGGER`, `REFERENCES`). Una tabla nueva no hace falta agregarla a mano.
- **Vitest** (`npm test`): `tests/tenants/` (resolución, tenant dueño, aterrizaje, agentes habilitados), `tests/plataforma/` (acciones y secciones de la consola), `tests/invitations/`, `tests/agents/mcp-channel-auth.test.ts`.
- Navegador: `/qa` contra el dev server, como `platform_admin` y como `tenant_admin` (este último recibe 404 en `/plataforma`).

## Decisiones

- [Multi-tenant](../superpowers/specs/01-multi-tenant.md): modelo de datos y RLS. Quedó atrás en que el `tenant_admin` puede insertar membresías y actualizar `brand` o `allowed_models` de su fila (hoy no, PR [#80](https://github.com/innovasbuild/agents/pull/80) y `tenants_guard_columns`).
- [Consola de plataforma](../superpowers/specs/2026-10-05-consola-plataforma-design.md), PR [#70](https://github.com/innovasbuild/agents/pull/70): la consola, `PLATFORM_OWNER_TENANT_SLUG` y el slug `plataforma`. Su límite sobre `mcp-channel-auth` lo cerró el PR [#82](https://github.com/innovasbuild/agents/pull/82), y "no crear tenants" (P8) lo superó el PR 71.
- [Alta de empresas y landing](../superpowers/specs/2026-10-05-alta-empresas-landing-design.md), PR [#71](https://github.com/innovasbuild/agents/pull/71): `/plataforma/nueva` y `/login/<slug>`. La función `create_tenant` que cita fue reemplazada por `platform_create_tenant` en la 21.1 (PR [#87](https://github.com/innovasbuild/agents/pull/87)).
- [Etapa 21.4](../superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md), PR [#91](https://github.com/innovasbuild/agents/pull/91): empresa sin agentes e ingreso por código.
- Ingreso por dominio y bloqueos: PR [#80](https://github.com/innovasbuild/agents/pull/80) cerró el hueco de `memberships`.
- Ver también: [vision-general](vision-general.md), [datos](datos.md), [plataforma](../dominios/plataforma.md), [invitaciones y usuarios](../dominios/invitaciones-y-usuarios.md), [alta de tenant](../guias/alta-de-tenant.md).
