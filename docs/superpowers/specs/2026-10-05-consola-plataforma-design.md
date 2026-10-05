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
| P2 | El tenant dueño de la plataforma se marca con una columna `tenants.platform_owner`, no con el slug `innovas` en código | Regla del repo: nada específico de un tenant en código. Además el seed local usa `innovas-seed`, así que un slug fijo rompería el entorno local |
| P3 | La restricción "platform_admin solo en el tenant dueño" se aplica en la base, con trigger y dentro de `is_platform_admin()` | Las 14 migraciones que ya usan `is_platform_admin()` en su RLS quedan cubiertas sin tocarlas. Un chequeo solo en la UI no protege nada |
| P4 | Sin políticas RLS nuevas para leer ni editar | `tenants_select`, `tenants_update` y `memberships_select` ya incluyen al platform_admin |
| P5 | El slug se muestra y no se edita | Cambiarlo rompe las URLs del cliente y el path de su logo en el bucket `brand` |
| P6 | Quien no es platform_admin recibe 404, no 403 | Mismo criterio que `resolveTenantAccess` |
| P7 | La escritura va por server action con el cliente del usuario; la RLS decide el permiso | Patrón de `app/[tenant]/settings/actions.ts`: cero filas devueltas es "sin permiso" |
| P8 | Fuera de alcance: crear, borrar tenants y gestionar usuarios desde la consola | Pedido explícito: empezar por listado, detalle y edición. Los usuarios ya se gestionan en `/<slug>/settings/usuarios` |

P2 es un desvío de lo conversado (se había hablado de "el tenant `innovas`"): el efecto es el mismo, cambia dónde vive el dato.

## 3. Base de datos

Una migración nueva. Antes de escribirla se carga `supabase-postgres-best-practices`.

1. **Columna** `tenants.platform_owner boolean not null default false`, con índice único parcial `where platform_owner` para que haya a lo sumo un tenant dueño.
2. **Backfill sin slug fijo:** si todas las memberships `platform_admin` existentes pertenecen a un único tenant, ese tenant queda con `platform_owner = true`. Si pertenecen a más de uno, la migración falla con un mensaje que los lista, para resolverlo a mano. Si no hay ninguna, no marca nada.
3. **`is_platform_admin()`** pasa a exigir que la membership `platform_admin` sea de un tenant con `platform_owner`. Misma firma, `security definer`, `search_path = ''`.
4. **Trigger** `before insert or update` en `memberships`: rechaza `role = 'platform_admin'` si el tenant no es el dueño.
5. **`platform_owner` no se edita desde la app:** un trigger en `tenants` rechaza cambiar la columna para el rol `authenticated`. Lo cambia una persona por SQL. Sin esto, `tenants_update` dejaría que un tenant_admin se marque dueño a sí mismo.
6. **El tenant dueño no se puede desactivar** (`check (not platform_owner or active)`): desactivarlo dejaría a todos los platform_admin fuera, sin forma de volver desde la app.
7. **Slug reservado:** `plataforma` se suma a `tenants_slug_not_reserved`, con el mismo chequeo previo de conflicto que la migración `20260924100050`.

`seed.sql` marca `innovas-seed` como `platform_owner`. Después: `npm run db:types`.

**Producción:** `db push` aplica todas las migraciones pendientes. Antes se corre `migration list` y se confirma que el backfill del punto 2 va a encontrar un solo tenant.

## 4. Acceso desde el código

`lib/tenants/platform.ts`: `requirePlatformAdmin()` devuelve el cliente Supabase y el usuario, o `null` si no hay sesión o `rpc("is_platform_admin")` da falso. Las páginas de la consola llaman `notFound()` con `null`.

`resolveTenantAccess` hoy decide el rol de plataforma leyendo `memberships` directo. Pasa a usar `rpc("is_platform_admin")` para que la UI y la RLS no puedan divergir.

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
- Desactivar un tenant lo deja en 404 para todos sus usuarios (`resolveTenantAccess` filtra `active`). El formulario pide confirmación explícita antes de guardar ese cambio. El tenant dueño muestra el control deshabilitado (§3.6).
- El slug aparece como texto, sin input.
- Resultado `{ ok: true } | { ok: false, message }`, mensajes en castellano. Una violación de constraint se traduce a un mensaje del campo; cero filas devueltas es "No tenés permiso".
- Al guardar: `revalidatePath` de `/plataforma`, del detalle y del layout del tenant.

## 7. Tests

**Base** (`supabase/tests/`, `npm run db:test`):
- insertar o promover un `platform_admin` en un tenant que no es dueño falla;
- `is_platform_admin()` da verdadero para uno del tenant dueño y falso para un tenant_admin;
- un tenant_admin no puede cambiar `platform_owner` de su tenant;
- el tenant dueño no se puede desactivar;
- no puede haber dos tenants dueños;
- `plataforma` se rechaza como slug.

**Aplicación** (`npm test`):
- el schema de `updateTenant` rechaza cada input inválido de la tabla de §6;
- la action devuelve "sin permiso" cuando el update no devuelve filas;
- la mezcla de `brand` conserva las claves ajenas.

**Navegador** (`/qa` contra el dev server): como platform_admin, del badge al listado, al detalle, editar y ver el cambio; como tenant_admin, `/plataforma` da 404 y el badge no es link.

## 8. Pendiente, fuera de esta entrega

- Crear y borrar tenants desde la consola.
- Gestión de usuarios y roles entre tenants.
- Métricas de plataforma (uso y gasto por tenant).
