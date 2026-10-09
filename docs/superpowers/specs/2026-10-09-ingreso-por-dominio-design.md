# Ingreso por dominio de correo — diseño

**Fecha:** 2026-10-09
**Base:** `docs/superpowers/specs/2026-10-05-alta-empresas-landing-design.md` (landing `/login/[tenant]`, `LoginForm`, `/auth/confirmar`), `docs/superpowers/specs/2026-10-05-consola-plataforma-design.md` (consola `/plataforma`) y la migración `20261011120000_memberships_lock_columns.sql` (las altas de membresía pasan solo por funciones `security definer`).

## 1. Objetivo y criterio de cierre

Que cada empresa elija entre dos modos de ingreso: **solo por invitación** (como hoy) o **todos los del dominio**, donde cualquiera con un correo verificado de un dominio de la empresa entra sin invitación y queda como miembro. El modo lo elige el administrador de la empresa desde su configuración; los dominios los carga un administrador de la plataforma.

`tenants.self_signup_by_domain` y `tenants.allowed_domains` existen desde la primera migración y la consola ya los edita, pero nada los lee al ingresar. Esta entrega los hace valer.

**Terminado cuando:** en producción, con una empresa en modo abierto y un dominio cargado, una persona nunca invitada entra por `/login/<slug>` con un correo de ese dominio, cae en `/<slug>/chat` como `tenant_member`, y el evento `membership.joined_by_domain` queda en `events`.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | El modo lo cambia el `tenant_admin` en `/[tenant]/settings`; los dominios solo plataforma, en `/plataforma/[slug]` | Nadie verifica que un dominio sea de la empresa. Quien carga `gmail.com` o el dominio de un tercero abre el brain a cualquiera; ese control queda en INNOV.AS |
| D2 | Quien coincide entra a **todas** las empresas activas con el modo abierto y su dominio | Los dominios los carga plataforma, así que dos empresas con el mismo dominio (un grupo con dos sociedades) es una decisión, no un accidente. Funciona igual desde `/login`, la landing y Google |
| D3 | El alta es una función `security definer`, `join_tenants_by_domain()`, llamada donde hoy se aceptan las invitaciones | `authenticated` ya no tiene INSERT en `memberships`. Mismo patrón que `accept_pending_invitations` |
| D4 | Rol siempre `tenant_member`; nunca pisa una membresía existente | Un admin se nombra por invitación. Las invitaciones se aceptan antes, así que una invitación como admin gana |
| D5 | Coincidencia exacta de dominio, sin subdominios, sin distinguir mayúsculas | `ventas.empresa.com` no entra por `empresa.com`. Si hace falta, se carga el subdominio |
| D6 | Candado de columnas en `tenants` por trigger: una sesión que no es admin de plataforma solo cambia `default_model` y `self_signup_by_domain` | `tenants_update` hoy deja al `tenant_admin` escribir cualquier columna por la API (`allowed_domains`, `active`, `slug`, `allowed_models`, `auth_methods`, `brand`). Sin esto D1 no se cumple. Grants por columna no sirven: la consola escribe con el mismo rol `authenticated` |
| D7 | El modo abierto exige al menos un dominio, como restricción de la tabla | Hoy solo lo valida el formulario de plataforma |
| D8 | Dominios de correo públicos rechazados en el formulario de plataforma cuando el modo está abierto, y también al activar el modo desde settings | Red contra el error humano. La lista vive en un solo módulo |
| D9 | El ingreso por mail crea la cuenta solo si el dominio está abierto en alguna empresa; lo decide una server action | Hoy `shouldCreateUser: false` deja sin link a quien nunca fue invitado. El mensaje en pantalla no cambia según el resultado |
| D10 | Cada alta deja `membership.joined_by_domain` en `events` | Se tiene que poder ver quién entró sin invitación |

## 3. Base

Una migración, `supabase/migrations/20261012120000_join_by_domain.sql`.

### 3.1 Restricción

```sql
alter table public.tenants add constraint tenants_self_signup_needs_domain
  check (not self_signup_by_domain or cardinality(allowed_domains) >= 1);
```

Antes del `db push`, se confirma en producción que ninguna fila la viola (`self_signup_by_domain` nació en `false`; la consola ya lo validaba).

### 3.2 Candado de columnas

Función `public.tenants_guard_columns()` (invoker, `search_path = ''`) y trigger `tenants_guard_columns` `before update on public.tenants for each row`.

- Si `current_user <> 'authenticated'` (service_role, postgres, o una función `security definer` que corre como owner): pasa.
- Si `(select public.is_platform_admin())`: pasa.
- Si no: `new` tiene que ser igual a `old` en todas las columnas salvo `default_model` y `self_signup_by_domain`. Se compara `to_jsonb(new) - 'default_model' - 'self_signup_by_domain'` contra lo mismo de `old`, así una columna que se agregue a `tenants` más adelante nace cerrada. Si difieren: `raise exception ... using errcode = '42501'`.

`tenants_update` no cambia: sigue decidiendo sobre qué filas puede escribir cada uno. El trigger decide qué columnas.

### 3.3 `join_tenants_by_domain()`

`returns integer language plpgsql security definer set search_path = ''`. `revoke execute ... from public, anon`; `grant execute ... to authenticated`.

1. `auth.uid()` nulo → excepción `no authenticated user` (igual que `accept_pending_invitations`).
2. Lee `lower(email)` de `auth.users` donde `email_confirmed_at is not null`. Sin fila → devuelve 0.
3. Dominio = `split_part(email, '@', 2)`. Vacío → 0.
4. Por cada tenant con `active`, `self_signup_by_domain` y el dominio en `allowed_domains` (comparando en minúsculas): `insert into memberships (tenant_id, user_id, role) values (..., 'tenant_member') on conflict (tenant_id, user_id) do nothing`. Solo si la fila se insertó, agrega el evento `membership.joined_by_domain`, resumen `Ingreso por dominio`, `payload = {"domain": <dominio>}`, `actor_user_id` el usuario, y suma al contador.
5. Devuelve la cantidad de membresías creadas.

Una segunda llamada no crea nada ni deja eventos.

## 4. Ingreso

### 4.1 Dónde se llama

`lib/auth/join-on-login.ts` exporta `joinOnLogin(supabase)`: llama `accept_pending_invitations` y después `join_tenants_by_domain`, cada una en su `try/catch`; un error de una no impide la otra ni el ingreso, y se registra con `console.error`. La usan `/auth/callback` (reemplaza la llamada directa actual) y `/auth/confirmar` (el `acceptInvitations` de `resolveConfirmation`).

### 4.2 Ingreso por mail

`app/(auth)/login/actions.ts`, server action `canSignUpByDomain(email: string): Promise<boolean>`. Valida el correo con zod, saca el dominio y consulta con el cliente admin si existe algún tenant activo con `self_signup_by_domain` y ese dominio. Cualquier error → `false`.

`LoginForm.entrarConMagicLink` llama la action y pasa su resultado como `shouldCreateUser`. Si la action falla, sigue con `false`. El texto de "te mandamos un link" es el mismo en todos los casos.

La regla de coincidencia de dominio en TypeScript vive en `lib/invitations/domain.ts` (`emailDomain(email)` nuevo, reusado por `isAllowedDomain`).

### 4.3 Google

Sin cambios: la cuenta ya se crea y `joinOnLogin` la une.

## 5. Pantallas

### 5.1 `/[tenant]/settings`

Sección **Ingreso**, después de "Modelo default": `app/[tenant]/settings/ingreso-form.tsx` (cliente), dos opciones de radio.

- **Solo por invitación.** "Entra únicamente quien recibió una invitación."
- **Todos los del dominio.** "Cualquiera con un correo de @a.com, @b.com entra sin invitación, como miembro."

Debajo, los dominios en solo lectura y la línea "Los dominios los carga INNOV.AS. Escribinos a hola@innov.as para cambiarlos." Sin dominios cargados, la segunda opción queda deshabilitada.

Si el modo está abierto, una nota: "Sacar a alguien de Usuarios no le impide volver a entrar mientras este modo siga activo."

Action `updateSignupMode(tenantId, open, slug)` en `app/[tenant]/settings/actions.ts`, mismo molde que `updateDefaultModel`: valida en el borde, escribe con el cliente de sesión, cero filas devueltas → sin permiso. Antes de abrir el modo lee `allowed_domains` y rechaza si está vacío o contiene un dominio público (D8). `resolveTenantAccess` no cambia; la página lee `allowed_domains` y `self_signup_by_domain` con una consulta propia.

### 5.2 `/plataforma/[slug]`

`lib/tenants/tenant-form.ts`: con `selfSignupByDomain` en `true`, cada dominio de `allowedDomains` que esté en la lista de públicos agrega un error en `allowedDomains`: `"<dominio>" es un correo público: no puede abrir el ingreso.` El rótulo del tilde pasa a "Ingreso abierto para estos dominios (sin invitación)".

La lista vive en `lib/tenants/public-email-domains.ts` (`PUBLIC_EMAIL_DOMAINS`, `isPublicEmailDomain`): gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, msn.com, yahoo.com, yahoo.com.ar, icloud.com, me.com, proton.me, protonmail.com, aol.com, gmx.com, zoho.com, yandex.com, fibertel.com.ar, arnet.com.ar, speedy.com.ar.

### 5.3 `/login/[tenant]`

`loadPublicTenant` suma `selfSignupByDomain` y `allowedDomains`. Con el modo abierto, el texto pasa a "Entrá con tu correo de @a.com" (varios dominios separados por coma y "o" antes del último). Cerrado, queda el texto actual.

## 6. Límites declarados

- Sacarle la membresía a alguien del dominio no lo bloquea mientras el modo siga abierto. Bloquear a una persona puntual es otra entrega.
- No se verifica por DNS que el dominio sea de la empresa. El control es quien lo carga en plataforma.
- `canSignUpByDomain` revela si un dominio está abierto en alguna empresa. La landing ya confirma que la empresa existe.
- `shouldCreateUser` es un parámetro del cliente: quien llame directo a Supabase puede crear una cuenta con cualquier correo, como ya puede hoy con Google. Una cuenta sin membresía no ve nada.
- `is_platform_admin()` en la base acepta el rol en cualquier tenant (límite ya conocido de la consola); el candado de columnas hereda esa definición.
- Cerrar el modo no saca a quienes ya entraron.
- En producción hay que confirmar que Supabase Auth permite el alta de usuarios por mail.

## 7. Pruebas

**Base** (`supabase/tests/26_join_by_domain.test.sql`, pgTAP):

- Función: modo cerrado no une; correo sin confirmar no une; empresa inactiva no une; dominio en mayúsculas une; subdominio no une; dos empresas con el mismo dominio → dos membresías y dos eventos; membresía previa como `tenant_admin` queda intacta y sin evento; segunda llamada devuelve 0; `anon` no puede ejecutar; sin sesión lanza excepción.
- Candado: como `tenant_admin`, cambiar `default_model` y `self_signup_by_domain` funciona; cambiar `allowed_domains`, `active`, `slug`, `allowed_models`, `auth_methods`, `brand` y `display_name` falla con `42501`; como admin de plataforma y sin sesión (owner) todo funciona.
- Restricción: abrir el modo sin dominios falla con `23514`.

**Aplicación** (`npm test`): `isPublicEmailDomain` y `emailDomain`; el schema de plataforma rechaza un dominio público con el modo abierto y lo acepta con el modo cerrado; `updateSignupMode` (entrada inválida, sin dominios, dominio público, sin permiso, éxito); `canSignUpByDomain` (correo inválido, dominio abierto, cerrado, error de base); `joinOnLogin` llama las dos funciones aunque la primera falle; el texto de la landing en los dos modos.

**Navegador** (base local): con una empresa en modo abierto, un correo nuevo del dominio pide link en `/login/<slug>`, lo abre desde Mailpit y cae en `/<slug>/chat`; aparece en `/settings/usuarios` como miembro. Con un correo de otro dominio no llega link. Como `tenant_admin`, el modo se cambia desde settings; como `tenant_member`, settings da 404.

## 8. Fuera de alcance

- Bloqueo o lista de exclusión por persona.
- Verificación de propiedad del dominio.
- Aviso al admin cuando alguien entra por dominio.
- Rol por defecto configurable.
- Imposición de `auth_methods` en el servidor.
- Pantalla para ver los eventos de ingreso.
