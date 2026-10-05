# Alta de empresas y landing por empresa — diseño

**Fecha:** 2026-10-05
**Base:** `docs/superpowers/specs/2026-10-05-consola-plataforma-design.md` (consola `/plataforma`, gate `requirePlatformAdmin`) y `docs/superpowers/specs/01-multi-tenant.md` (invitaciones, RLS de `tenants` y `tenant_agents`).

## 1. Objetivo y criterio de cierre

Que un administrador de la plataforma dé de alta una empresa desde la consola, con su marca, sus métodos de login y su primer administrador, y que los usuarios de esa empresa lleguen a una landing propia (logo, nombre, colores) que ofrece solo los métodos de login permitidos.

Visión de Matías: cada cliente tiene su portal de agentes, tools y brain. Esta etapa es la puerta de entrada. Primer uso: una reunión con un cliente del universo Microsoft, cuyos usuarios entrarían por email.

**Terminado cuando:** Matías crea una empresa en producción desde `/plataforma`, abre `/login/<slug>` y ve la landing con el logo de esa empresa y solo el login por email; el primer admin recibe la invitación y, al aceptarla, cae en `/<slug>/chat`.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| A1 | Métodos de login en `tenants.auth_methods` (`text[]`), valores `email` y `google` | Suficiente para esta etapa. Microsoft después es sumar un valor al check, activar el proveedor en Supabase y un botón |
| A2 | Los métodos se aplican en la pantalla, no se imponen en el servidor | Quien conozca `/login` puede seguir entrando por Google si tiene invitación. La imposición real llega con SSO o Microsoft. Límite declarado en §7 |
| A3 | Landing en `/login/[tenant]`, pública, sin sesión | `login` ya es slug reservado; no hay que reservar nada ni mover rutas. Dominio propio por cliente queda para después |
| A4 | La landing confirma que la empresa existe (slug inexistente o inactivo → 404, pero una activa se muestra) | Es una URL que se le entrega al cliente para compartir. Es la única ruta del repo donde esto es aceptable, a propósito |
| A5 | `create_tenant(...)` en SQL, `security invoker`, crea el tenant y su `tenant_agents` (outreach) en una transacción | Sin la fila de agente el canal rechaza todo: una empresa no puede quedar sin ella. La RLS existente (`tenants_insert`, `tenant_agents_insert`) ya limita a platform_admin; `security invoker` la respeta |
| A6 | El alta no es transaccional de punta a punta: tenant+agente son atómicos, logo e invitación no | Storage y Auth no participan de la transacción. Si fallan, la empresa queda creada y la pantalla lo dice; se completa desde el detalle |
| A7 | Un solo `LoginForm` para `/login` y `/login/[tenant]` | Evita dos copias de la misma lógica de OAuth y OTP |
| A8 | La lógica de invitar sale de `app/api/invitations/route.ts` a `lib/invitations/invite.ts` | La usan la ruta (sin cambios de comportamiento) y la action de alta. Único refactor de la etapa |
| A9 | La invitación del primer admin lleva `next=/<slug>/chat` | Al aceptar cae en su portal, no en el selector de empresas |
| A10 | Fuera: agentes y conectores desde la UI, login con Microsoft, proveedor Outlook, dominio propio | Pedido explícito de Matías: etapa 1 es alta + landing. Conectores siguen por `npm run connections:bind` |

## 3. Base de datos

Una migración. Antes de escribirla se carga `supabase-postgres-best-practices`.

1. `alter table public.tenants add column auth_methods text[] not null default '{email,google}'`, con `check (cardinality(auth_methods) >= 1 and auth_methods <@ array['email','google'])`. Las filas existentes quedan con los dos métodos, que es lo que hoy ofrece `/login`.
2. Función `public.create_tenant(p_slug text, p_display_name text, p_allowed_domains text[], p_auth_methods text[], p_brand jsonb) returns uuid`, `language plpgsql security invoker set search_path = ''`. Inserta en `tenants` y en `tenant_agents (tenant_id, 'outreach', config '{"brain":"read_write"}')`, misma config que el seed, y devuelve el id. Grant `execute` a `authenticated`. Un `tenant_member` que la llame falla por la RLS, no por un chequeo propio.
3. `npm run db:types` después.

**Producción:** `db push` aplica todas las pendientes; antes `migration list`.

## 4. Landing `/login/[tenant]`

`app/(auth)/login/[tenant]/page.tsx`, componente de servidor. Lee con el cliente admin solo `slug, display_name, brand, auth_methods, active` (sin sesión no hay RLS que sirva; se lee lo público y nada más). Slug inexistente o `active = false` → `notFound()`.

Muestra logo (o nombre si no hay), nombre, colores por `brandStyle`, y `LoginForm` con `methods = auth_methods` y `next = /<slug>/chat`. Un método no incluido no se renderiza. Texto: "Entrá con la cuenta con la que te invitaron a <Empresa>".

`LoginForm` (`app/(auth)/login/login-form.tsx`, client): props `methods: AuthMethod[]` y `next?: string`. Google llama `signInWithOAuth` con `redirectTo = /auth/callback?next=<next>`; email llama `signInWithOtp` con `shouldCreateUser: false` y `emailRedirectTo` igual. `/login` lo usa con `methods = ["email","google"]` y el `next` de la URL, como hoy. `/auth/callback` ya valida `next` con `safeNextPath`.

## 5. Alta: `/plataforma/nueva`

Botón "Nueva empresa" en el listado. Página con gate `requirePlatformAdmin` (404 si no).

| Campo | Validación |
|---|---|
| Nombre | 1 a 80 caracteres |
| Slug | `^[a-z][a-z0-9-]{1,38}$`; la base rechaza reservados y repetidos |
| Dominios permitidos | misma normalización que la edición (minúscula, sin `@`, sin repetidos) |
| Métodos de login | al menos uno de `email`, `google`; por defecto los dos |
| Colores | `#RRGGBB` o vacío |
| Logo | PNG, SVG o WebP, hasta 1 MB, opcional |
| Correo del primer admin | obligatorio, email válido; fuera de los dominios permitidos requiere el tilde "Permitir correo externo" |

Server action `createTenant(formData)` en `app/plataforma/nueva/actions.ts`:
1. Gate y zod. Reutiliza `parseList`, `validateLogo` y `mergeBrand` de `lib/tenants/tenant-form.ts`; el schema de alta vive en `lib/tenants/tenant-create.ts`.
2. `rpc("create_tenant", ...)`. Errores traducidos: `23505` → "Ya hay una empresa con ese slug", `23514` → "Ese slug está reservado o tiene un formato inválido", cero permiso → "No tenés permiso".
3. Si hay logo: sube a `brand/<slug>/logo-<ts>.<ext>` y actualiza `brand` del tenant recién creado. Si falla, se registra en el resultado y se sigue.
4. Invita al primer admin con `inviteToTenant` (§6), rol `tenant_admin`, `next=/<slug>/chat`. Si falla, se registra y se sigue.
5. Resultado: `{ ok: true, slug, warnings: string[] }` o `{ ok: false, message }`. Con `ok`, redirige al detalle `/plataforma/<slug>` y muestra las advertencias ("La empresa quedó creada, pero no se pudo subir el logo. Subilo desde acá."). `revalidatePath("/plataforma")`.

## 6. Invitaciones compartidas

`lib/invitations/invite.ts`: `inviteToTenant({ admin, tenantId, email, role, invitedBy, allowExternal, origin, next })` con la lógica que hoy está en `app/api/invitations/route.ts`: chequeo de dominio, insert en `invitations`, evento `invitation.external`, `inviteUserByEmail` con `redirectTo = <origin>/auth/callback` más `?next=` si viene. Devuelve un resultado discriminado (`ok`, `dominio_no_permitido`, `duplicada`, `mail_fallo`, `ya_existe`). La ruta lo consume y mapea a los mismos códigos HTTP que hoy; su contrato no cambia.

## 7. Detalle de la empresa

`/plataforma/[slug]` suma: control de métodos de login (dos tildes, al menos uno marcado; `updateTenant` escribe `auth_methods`) y el link a la landing (`/login/<slug>`) con texto copiable, para pasárselo al cliente.

## 8. Límites conocidos

- Los métodos de login no se imponen en el servidor (A2). Un usuario invitado puede entrar por `/login` con Google aunque su empresa solo tenga email.
- Un cliente solo-Microsoft entra y usa chat y brain, pero el agente manda y lee correo solo por Gmail hasta que exista el proveedor Outlook. Conviene decirlo en la reunión.
- Los conectores de la empresa nueva se cargan con `npm run connections:bind`, no desde la UI.

## 9. Tests

**Base** (`npm run db:test`): `auth_methods` rechaza vacío y valores desconocidos; `create_tenant` crea tenant y `tenant_agents` juntos; un `tenant_admin` no puede llamarla (RLS); un slug reservado o repetido falla con el SQLSTATE esperado.

**Aplicación** (`npm test`): schema de alta (cada campo inválido, correo externo sin tilde); `createTenant` traduce `23505`/`23514`, sigue y reporta advertencia si falla logo o invitación, rechaza a quien no es platform_admin; `inviteToTenant` cubre los cinco resultados y arma `redirectTo` con `next`; la ruta de invitaciones conserva sus códigos HTTP; la landing da 404 con slug inexistente o inactivo y renderiza solo los métodos permitidos.

**Navegador** (base local): alta completa con logo y solo email → detalle con advertencias vacías → `/login/<slug>` muestra logo y solo el formulario de email → el link de invitación (Mailpit) lleva a `/<slug>/chat`. Como tenant_admin, `/plataforma/nueva` da 404.

## 10. Pendiente, fuera de esta entrega

- Agentes y conectores desde el detalle de la empresa.
- Login con Microsoft y proveedor de correo Outlook (spec propia).
- Imposición de métodos de login en el servidor.
- Dominio propio por cliente.
