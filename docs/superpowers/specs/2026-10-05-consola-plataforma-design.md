# Consola de plataforma — diseño

**Fecha:** 2026-10-05
**Base:** `docs/superpowers/specs/01-multi-tenant.md` (roles, RLS de `tenants` y `memberships`).

## 1. Objetivo y criterio de cierre

Que un administrador de la plataforma pueda ver todas las empresas (tenants), entrar al detalle de cada una y editarla desde la aplicación, sin SQL a mano.

Pedido de Matías: usar el label de rol de arriba a la derecha como botón hacia una consola de administración; para empezar, listado de empresas, detalle y edición. El rol de administrador de plataforma se da solo a miembros del tenant de INNOV.AS, la empresa que desarrolla la plataforma.

**Terminado cuando:** Matías entra a `/plataforma` en producción desde el badge del header, abre un tenant, le cambia un dato y el cambio se ve en ese tenant.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| P1 | La consola vive en `app/plataforma/`, fuera de `app/[tenant]/` | No es de ningún cliente. No hereda la marca ni la nav del tenant |
| P2 | El tenant dueño de la plataforma se define con la variable de entorno `PLATFORM_OWNER_TENANT_SLUG` | Pedido de Matías. Cumple la regla del repo (nada específico de un tenant en código) y deja que local use `innovas-seed` y producción `innovas` sin tocar la base |
| P3 | La restricción "platform_admin solo en el tenant dueño" se aplica en la aplicación, no en la base | Postgres no ve las variables de entorno de la app. La app no otorga `platform_admin` en ninguna pantalla: hoy ese rol se da solo por SQL. Límite conocido en §3 |
| P4 | Sin políticas RLS nuevas para leer ni editar | `tenants_select`, `tenants_update` y `memberships_select` ya incluyen al platform_admin |
| P5 | El slug se muestra y no se edita | Cambiarlo rompe las URLs del cliente y el path de su logo en el bucket `brand` |
| P6 | Quien no es platform_admin recibe 404, no 403 | Mismo criterio que `resolveTenantAccess` |
| P7 | La escritura va por server action con el cliente del usuario; la RLS decide el permiso | Patrón de `app/[tenant]/settings/actions.ts`: cero filas devueltas es "sin permiso" |
| P8 | Fuera de alcance: crear, borrar tenants y gestionar usuarios desde la consola | Pedido explícito: empezar por listado, detalle y edición. Los usuarios ya se gestionan en `/<slug>/settings/usuarios` |

## 3. Tenant dueño y acceso

`PLATFORM_OWNER_TENANT_SLUG` es una variable solo de servidor (sin `NEXT_PUBLIC_`). Va en `.env.local` (`innovas-seed` contra la base local) y en Vercel para producción y preview (`innovas`).

`lib/tenants/platform.ts`:
- `platformOwnerSlug()` lee la variable. Vacía o ausente devuelve `null`.
- `requirePlatformAdmin()` devuelve el cliente Supabase y el usuario solo si hay sesión y el usuario tiene una membership `platform_admin` en el tenant cuyo slug es el de la variable. En cualquier otro caso devuelve `null` y la página llama `notFound()`.
- Sin la variable configurada la consola da 404 para todos: falla cerrada.

`resolveTenantAccess` usa el mismo criterio para decidir el rol que muestra el badge: un `platform_admin` de otro tenant no ve el link a la consola.

**Límite conocido:** la RLS sigue usando `is_platform_admin()`, que acepta una membership `platform_admin` de cualquier tenant. Lo mismo `lib/agents/mcp-channel-auth.ts` y `lib/brain/mcp-server/access.ts`. Una fila así, creada por SQL fuera del tenant dueño, no entra a la consola pero conserva el acceso de plataforma a nivel de datos. Se acepta porque solo un platform_admin o alguien con acceso a la base puede crear esa fila. Si más adelante la app ofrece dar el rol, esa pantalla tiene que rechazarlo fuera del tenant dueño.

## 4. Base de datos

Una sola migración, chica: `plataforma` se suma a `tenants_slug_not_reserved`, con el mismo chequeo previo de conflicto que la migración `20260924100050`. Antes de escribirla se carga `supabase-postgres-best-practices`. No cambian tablas, funciones ni políticas, así que no hace falta `db:types`.

**Producción:** `db push` aplica todas las migraciones pendientes; antes se corre `migration list`.

## 5. Pantallas

| Ruta | Qué muestra |
|---|---|
| `/plataforma` | Listado de todos los tenants, activos e inactivos: nombre, slug, estado, cantidad de usuarios, fecha de alta. La fila lleva al detalle. El tenant dueño lleva una marca |
| `/plataforma/[slug]` | Detalle: formulario de edición (§6), usuarios del tenant en solo lectura (nombre, correo, rol) con link a `/<slug>/settings/usuarios`, y link "Abrir" a `/<slug>/chat` si está activo |

`app/plataforma/layout.tsx`: header propio con el título "Plataforma", sin marca de tenant, y un link de vuelta a `/`.

**Entrada:** en `app/[tenant]/layout.tsx` el badge de rol se vuelve `<Link href="/plataforma">` cuando `tenant.role === "platform_admin"`. Para los otros roles sigue siendo texto. Hoy el badge se oculta por debajo de `sm`; cuando es link se muestra siempre, porque si no en el celular no hay forma de llegar.

Textos en español rioplatense. Componentes de `components/ui` (shadcn) ya presentes.

## 6. Edición

Un formulario, una server action `updateTenant(tenantId, input)` en `app/plataforma/[slug]/actions.ts`, validada con zod en el borde.

| Campo | Columna | Validación |
|---|---|---|
| Nombre | `display_name` | 1 a 80 caracteres |
| Dominios permitidos | `allowed_domains` | lista de dominios en minúscula, sin `@` ni duplicados |
| Alta por dominio | `self_signup_by_domain` | booleano. Se rechaza en `true` con la lista de dominios vacía |
| Modelos permitidos | `allowed_models` | lista no vacía de ids `proveedor/modelo` |
| Modelo por defecto | `default_model` | tiene que estar entre los permitidos (también lo exige `tenants_default_model_allowed`) |
| Color primario y secundario | `brand.primary`, `brand.secondary` | `#RRGGBB` o vacío |
| Logo | `brand.logo_url` | PNG, SVG o WebP de hasta 1 MB. Se sube a `brand/<slug>/logo.<ext>`; las policies del bucket ya admiten al platform_admin |
| Activo | `active` | booleano |

- `brand` se escribe mezclando con lo que ya tiene la fila, para no pisar claves que el formulario no conoce.
- Desactivar un tenant lo deja en 404 para todos sus usuarios (`resolveTenantAccess` filtra `active`). El formulario pide confirmación explícita antes de guardar ese cambio. El tenant dueño muestra el control deshabilitado y la action rechaza desactivarlo: dejaría la consola sin nadie que pueda entrar.
- El slug aparece como texto, sin input.
- Resultado `{ ok: true } | { ok: false, message }`, mensajes en castellano. Una violación de constraint se traduce a un mensaje del campo; cero filas devueltas es "No tenés permiso".
- Al guardar: `revalidatePath` de `/plataforma`, del detalle y del layout del tenant.

## 7. Tests

**Base** (`supabase/tests/`, `npm run db:test`):
- `plataforma` se rechaza como slug.

**Aplicación** (`npm test`):
- `requirePlatformAdmin` da `null` sin la variable, con un `platform_admin` de otro tenant y con un tenant_admin del tenant dueño; devuelve el usuario con un `platform_admin` del tenant dueño;
- el schema de `updateTenant` rechaza cada input inválido de la tabla de §6;
- la action rechaza desactivar el tenant dueño;
- la action devuelve "sin permiso" cuando el update no devuelve filas;
- la mezcla de `brand` conserva las claves ajenas.

**Navegador** (`/qa` contra el dev server): como platform_admin, del badge al listado, al detalle, editar y ver el cambio; como tenant_admin, `/plataforma` da 404 y el badge no es link.

## 8. Pendiente, fuera de esta entrega

- Crear y borrar tenants desde la consola.
- Gestión de usuarios y roles entre tenants.
- Métricas de plataforma (uso y gasto por tenant).
