# Etapa 20: Microsoft, métodos de login impuestos y operación de usuarios: diseño

**Fecha:** 2026-10-09
**Base:** `docs/superpowers/specs/2026-10-09-ingreso-por-dominio-design.md` (`joinOnLogin`, `join_tenants_by_domain`, límites §6), `docs/superpowers/specs/2026-10-05-alta-empresas-landing-design.md` (`auth_methods`, decisión A2, `/auth/confirmar`), migración `20261011120000_memberships_lock_columns.sql` y `docs/2026-10-09-plan-cierre-gap-plataforma.md` (Etapa 20).

## 1. Objetivo y criterio de cierre

Que una empresa del universo Microsoft entre con su cuenta corporativa, que los métodos de login que cada empresa eligió se cumplan al entrar y no solo en la pantalla, y que un administrador pueda bloquear a una persona, cambiarle el rol y reenviar una invitación sin SQL a mano.

Dos entregas, una sesión y un PR cada una:

- **20.1 · Login.** Microsoft como método, corte en el login cuando el método no está permitido y el mismo chequeo en cada página y en el chat.
- **20.2 · Operación de usuarios.** Bloqueo por persona, cambio de rol y reenvío de invitación.

**Terminado cuando (20.1):** en producción, una empresa de prueba con `auth_methods = {microsoft}` y modo abierto recibe sin invitación a una persona con cuenta Microsoft de su dominio; esa misma persona, entrando por Google desde `/login`, queda sin sesión y cae en `/login/<slug>` con el aviso; un miembro de una empresa que solo permite correo no puede entrar por Google; y una persona con dos empresas, logueada por un método que solo una permite, entra a esa y al abrir la otra cae en su landing con el aviso.

**Terminado cuando (20.2):** un administrador bloquea a un miembro de un dominio abierto y esa persona no vuelve a entrar aunque el modo siga abierto; le cambia el rol a otro miembro y el cambio se ve al recargar; y reenvía una invitación pendiente que llega de nuevo por mail.

## 2. Lo que mostró la prueba contra Supabase Auth

Antes de diseñar se probó una sesión por link contra la base local (GoTrue v2.197.0) y se leyó el código de esa versión para OAuth y Azure. Tres hechos condicionan todo lo demás:

1. **El token no dice con qué proveedor se entró.** El claim `amr` trae el método (`otp`, `oauth`, `invite`...) pero no el proveedor: GoTrue solo completa `provider` para SAML. `app_metadata.provider` es el primer proveedor de la cuenta, no el de esta sesión.
2. **Un login OAuth actualiza `auth.identities.last_sign_in_at` de esa identidad; un login por correo no.** Entonces: si `amr` dice `oauth`, el proveedor de esta sesión es la identidad OAuth con el `last_sign_in_at` más nuevo. Si dice un método de correo, es correo.
3. **Si Entra no manda el claim `xms_edov`, GoTrue da el correo por verificado.** Solo lo marca como no verificado cuando el claim viene y es falso. El claim queda guardado en `auth.identities.identity_data -> 'custom_claims'`. Sin ese claim configurado en la app de Entra, alguien con un tenant propio de Microsoft podría presentarse con el correo de otra persona, y GoTrue vincularía esa identidad a la cuenta existente.

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| L1 | El método de la sesión se deriva en SQL, en `public.current_login_method()`, del `amr` del JWT y de `auth.identities`. Nunca de un parámetro | Un parámetro lo manda el navegador. `join_tenants_by_domain` tiene `grant execute` a `authenticated`: con un argumento `p_method`, cualquiera lo llamaría con el valor que le convenga |
| L2 | Lo que no se reconoce da `null` y `null` no está permitido en ninguna empresa | Falla cerrado ante un método nuevo de GoTrue o un `amr` vacío |
| L3 | Microsoft es el valor `microsoft` en `AUTH_METHODS` y en el check de `tenants.auth_methods`; el proveedor de Supabase es `azure` | El nombre que ve el cliente es Microsoft. El mapeo vive en un solo lugar, la función SQL |
| L4 | Una sesión de Microsoft solo cuenta como `microsoft` si su identidad trae `xms_edov` verdadero. Si no, es `null` | Defensa en profundidad del hecho 3. La protección real es configurar el claim en Entra (anexo A), que hace que GoTrue rechace el login; esto cubre el caso de que alguien lo olvide |
| L5 | `accept_pending_invitations` y `join_tenants_by_domain` solo crean membresías en empresas que permiten el método de la sesión | Sin esto, entrar por Google a una empresa solo Microsoft crearía la membresía igual |
| L6 | El corte se decide en SQL, en `public.login_gate()`, y la app solo actúa | Una sola regla, probada con pgTAP. La usan `/auth/callback` y `/auth/confirmar` |
| L7 | Se corta cuando la persona tiene alguna empresa (membresía, invitación pendiente o dominio abierto) y ninguna de sus membresías permite el método. Con una empresa que lo permita alcanza | Opción elegida por Matías: cortar en el login. Quien no tiene ninguna empresa sigue a `/sin-acceso`, como hoy |
| L8 | Si `login_gate` falla, se corta | Es un control de acceso: ante la duda no se entra. Obliga a aplicar la migración antes de desplegar el código (§9) |
| L10 | Además del corte, cada request chequea el método contra la empresa que se está abriendo: `resolveTenantAccess`, `requirePlatformAdmin` y el canal del chat web | Pedido de Matías tras la prueba. El corte del login deja pasar a quien tiene dos empresas y un método que solo una permite, y a quien evita el paso de corte. La sesión la guarda el navegador; el chequeo por request es lo que vale |
| L11 | El chequeo es una función SQL, `public.tenant_allows_login(p_tenant uuid)`, que usa `current_login_method()` | La misma regla que el corte, en un solo lugar |
| L12 | Un administrador de plataforma se chequea contra los métodos del tenant dueño, no contra los de la empresa que visita | Opera empresas ajenas con la cuenta de su propia empresa. Si se le exigiera el método de cada cliente no podría entrar a uno solo Microsoft |
| L13 | Método no permitido en una página: redirect a `/login/<slug>?error=metodo`, sin cerrar la sesión. En el chat: se rechaza como sin acceso | La sesión puede ser válida para otra empresa de la misma persona. El aviso explica qué pasó, cosa que un 404 no hace |
| L9 | El link de una invitación es un login por correo y se le aplica la misma regla | Una empresa solo Microsoft invita por mail; la persona hace clic, queda cortada y cae en la landing con el botón de Microsoft. Al entrar por Microsoft la invitación se acepta, porque se busca por el correo verificado. Dos pasos, sin excepción en la regla |
| U1 | El bloqueo es una tabla `membership_blocks` por empresa y persona, escrita solo por funciones `security definer` | Mismo patrón que las altas de membresía desde el PR 80 |
| U2 | Bloquear borra la membresía y anota el bloqueo en una transacción. `join_tenants_by_domain` salta a los bloqueados | "Sacar" sigue siendo una baja que el dominio revierte; "Bloquear" es la que no |
| U3 | Aceptar una invitación levanta el bloqueo | Una invitación es una decisión explícita y más nueva de un administrador |
| U4 | Una empresa no puede quedarse sin administrador: trigger en `memberships` | Vale para el cambio de rol, para "Sacar" y para "Bloquear", sin repetir el chequeo en cada acción |
| U5 | El reenvío renueva el vencimiento y vuelve a mandar el mail. Si la persona ya tiene cuenta, no se manda nada y la pantalla lo dice | Supabase no reinvita a una cuenta que ya existe; esa persona entra por la landing y la invitación se acepta sola |

## 4. Entrega 20.1 · Base

Migración `20261013120000_login_methods.sql`. Antes de escribirla se carga `supabase-postgres-best-practices`.

### 4.1 Método nuevo

El check de `tenants.auth_methods` pasa a aceptar `email`, `google` y `microsoft`. El default no cambia.

### 4.2 `public.current_login_method()`

`returns text language plpgsql stable security definer set search_path = ''`. `grant execute` a `authenticated`.

1. Sin `auth.uid()`: `null`.
2. Toma del JWT (`auth.jwt() -> 'amr'`) la entrada con el `timestamp` más alto y lee su `method`. Sin entradas: `null`.
3. `otp`, `magiclink`, `invite`, `email/signup` o `recovery`: devuelve `email`.
4. `oauth`: busca en `auth.identities` la fila del usuario con `provider in ('google', 'azure')` y el `last_sign_in_at` más nuevo.
   - `google`: devuelve `google`.
   - `azure`: devuelve `microsoft` solo si `identity_data -> 'custom_claims' ->> 'xms_edov'` es `true` o `1`. Si no, `null`.
   - Sin fila: `null`.
5. Cualquier otro método: `null`.

### 4.3 Altas que respetan el método

`accept_pending_invitations()` y `join_tenants_by_domain()` se redefinen con la misma firma. Cada una calcula `v_method := public.current_login_method()` y agrega la condición `v_method = any (t.auth_methods)` sobre el tenant. `accept_pending_invitations` además exige `t.active`. Una invitación a una empresa que no permite el método queda pendiente, sin tocar.

### 4.4 `public.login_gate()`

`returns jsonb language plpgsql stable security definer set search_path = ''`. `grant execute` a `authenticated`. Devuelve `{ "allowed": boolean, "landing": text | null }`.

1. Sin `auth.uid()`: excepción `no authenticated user`.
2. `v_method := public.current_login_method()`.
3. Si existe una membresía del usuario en un tenant activo con `v_method = any (auth_methods)`: `{ allowed: true, landing: null }`.
4. Si no, arma "las empresas que lo esperan", en este orden: tenants activos donde tiene membresía; tenants activos con una invitación `pending` no vencida para su correo verificado; tenants activos con el modo abierto y su dominio.
   - Vacío: `{ allowed: true, landing: null }`. No hay nada que imponer.
   - Si no: `{ allowed: false, landing: <slug del primero> }`.

El correo verificado se lee igual que en `join_tenants_by_domain` (`email_confirmed_at is not null`).

### 4.5 `public.tenant_allows_login(p_tenant uuid)`

`returns boolean language sql stable security definer set search_path = ''`. `grant execute` a `authenticated`. Verdadero si el tenant existe, está activo y `public.current_login_method() = any (auth_methods)`. Con método `null` o tenant inexistente: falso.

## 5. Entrega 20.1 · Aplicación

- **`lib/tenants/auth-methods.ts`:** `AUTH_METHODS = ["email", "google", "microsoft"]`, rótulo "Microsoft". Los formularios de la consola ya iteran la lista.
- **`LoginForm`:** botón "Entrar con Microsoft" cuando `methods` incluye `microsoft`. Llama `signInWithOAuth({ provider: "azure", options: { scopes: "email", redirectTo } })`. El orden de los botones es Microsoft, Google, correo.
- **`/login` general:** deja de mostrar todos los métodos de `AUTH_METHODS`. Muestra los que tiene habilitados al menos una empresa activa (`loadOfferedMethods()` en `lib/tenants/public.ts`, con el cliente admin; si falla, solo correo). Así el botón de Microsoft no aparece hasta que plataforma lo marque en alguna empresa.
- **`lib/auth/login-gate.ts`:** `gateLogin(supabase): Promise<{ ok: true } | { ok: false; landing: string }>`. Llama `rpc("login_gate")`. Con `allowed` en `true` devuelve `ok`. Con `false` devuelve `/login/<slug>?error=metodo`. Si el RPC falla, tira o devuelve algo sin la forma esperada: `{ ok: false, landing: "/login?error=auth_failed" }`.
- **`/auth/callback`:** después de `joinOnLogin`, `gateLogin`. Si no es `ok`: `closeLocalSession(supabase)` y redirect a `landing`.
- **`/auth/confirmar`:** `resolveConfirmation` recibe un paso `gate` que corre después de aceptar invitaciones. Si no es `ok`, cierra la sesión del navegador con `closeLocalSession` y devuelve `landing` como destino.
- **`lib/auth/close-session.ts`:** `closeLocalSession(supabase)` llama `signOut({ scope: "local" })`. El corte cierra solo la sesión recién abierta: sin scope, `signOut` es global y revocaría también la que la persona tenga en otro dispositivo, abierta por un método permitido. Si `signOut` devuelve `{ error }` o tira, queda en el log y el redirect a la landing sale igual.
- **`/login` y `/login/[tenant]`:** con `?error=metodo` muestran arriba del formulario "Tu empresa no permite entrar con ese método. Usá una de estas opciones." Con `?error=auth_failed`, "No pudimos abrir tu sesión. Probá de nuevo."
- **Orden fijo en los dos puntos de entrada:** abrir sesión, `joinOnLogin`, `gateLogin`, redirigir.

### 5.1 Chequeo por request

- **`lib/tenants/platform.ts`:** `platformOwnerAdminTenantId(supabase, userId): Promise<string | null>` devuelve el id del tenant dueño si la persona es su `platform_admin`. `isPlatformOwnerAdmin` pasa a ser `(await platformOwnerAdminTenantId(...)) !== null`.
- **`resolveTenantAccess(slug)`:** después de resolver el rol, llama `rpc("tenant_allows_login", { p_tenant })` con el id del tenant dueño si es administrador de plataforma (L12) y con el del tenant de la URL si no. Si devuelve falso o falla: `redirect("/login/<slug>?error=metodo")`, donde `<slug>` es el del tenant contra el que se chequeó. Sin sesión, sin tenant o sin rol sigue devolviendo `null`, como hoy.
- **`requirePlatformAdmin()`:** mismo chequeo contra el tenant dueño y mismo redirect.
- **Canal del chat web:** `verifyCaller` devuelve también el cliente de Supabase de esa sesión. `resolveChannelContext` recibe una función `allowsLogin(tenantId)` y devuelve `null` si da falso o tira. El canal la arma con `rpc("tenant_allows_login")` sobre ese cliente.
- **Server actions y API:** lo que no pasa por una página aplica el mismo chequeo con `actionAllowsLogin(supabase, userId, tenantId)` (`lib/tenants/login-check-server.ts`), que es `allowsLogin` contra el tenant dueño si quien llama es administrador de plataforma (L12) y contra la empresa de la acción si no. Lo usan `POST /api/invitations`, `updateDefaultModel` y `updateSignupMode` (`app/[tenant]/settings/actions.ts`), `revokeMembership` y `revokeInvitation` (`app/[tenant]/settings/usuarios/actions.ts`) y crear, renombrar y borrar un hilo (`app/[tenant]/chat/actions.ts`). Las que reciben el id de una fila leen primero su `tenant_id` con el cliente de la sesión; si la fila no se ve, no escriben. Con el método no permitido no redirigen: contestan su "sin permiso" de siempre (403 en la API) y no escriben nada.
- **Guarda del tenant dueño:** `updateTenant` (consola) no guarda los `auth_methods` del tenant dueño si la lista nueva deja afuera el método de la sesión de quien edita (`current_login_method()`), ni si ese método no se puede determinar. Sin esa guarda, sacarlo deja a `requirePlatformAdmin` rebotando a todos a una landing que no pueden usar, y solo se arregla por SQL. Editar cualquier otra empresa no cambia.
- **Costo:** una consulta más por llamada. El layout y la página llaman a `resolveTenantAccess` por separado; se envuelve en `cache()` de React para que el mismo request la resuelva una sola vez.

## 6. Entrega 20.2 · Base

Migración `20261014120000_member_blocks.sql`.

1. **`public.membership_blocks`**: `tenant_id` (fk a `tenants`, cascade), `user_id` (fk a `auth.users`, cascade), `blocked_by uuid`, `created_at timestamptz default now()`, clave primaria `(tenant_id, user_id)`. RLS prendida: `select` para `tenant_admin` y `platform_admin` de ese tenant; sin políticas de escritura y `revoke insert, update, delete` a `authenticated` y `anon`.
2. **`public.block_member(p_tenant uuid, p_user uuid) returns void`**, `security definer`. Exige que quien llama sea administrador de ese tenant o de plataforma; rechaza bloquearse a uno mismo (`42501`); borra la membresía si existe; inserta el bloqueo (`on conflict do nothing`); deja el evento `membership.blocked`.
3. **`public.unblock_member(p_tenant uuid, p_user uuid) returns void`**, mismos permisos. Borra el bloqueo y deja `membership.unblocked`.
4. **`join_tenants_by_domain()`** suma la condición "sin fila en `membership_blocks` para ese tenant y usuario". **`login_gate()`** saca del tercer grupo (dominio abierto) a los tenants donde está bloqueado.
5. **`accept_pending_invitations()`** borra el bloqueo de ese tenant y usuario al aceptar.
6. **Trigger `memberships_keep_one_admin`**, `before update of role or delete on public.memberships for each row`. Si la fila vieja es `tenant_admin` o `platform_admin`, la nueva deja de serlo (o es un borrado), el tenant sigue existiendo y no queda otra fila con esos roles en ese tenant: excepción con `errcode = '23514'`. El chequeo "el tenant sigue existiendo" deja pasar el borrado en cascada de una empresa.

Consecuencia declarada: borrar de Auth a una persona que es la única administradora de una empresa falla hasta nombrar a otra.

## 7. Entrega 20.2 · Aplicación

`app/[tenant]/settings/usuarios/`:

- **Por miembro:** selector de rol (Usuario o Administrador), "Sacar" y "Bloquear". Una fila `platform_admin` muestra el rol como texto, sin selector ni "Bloquear". La propia fila no ofrece "Bloquear".
- **Sección "Bloqueados":** nombre, correo, fecha y "Desbloquear". Vacía, no se muestra.
- **Por invitación pendiente:** "Reenviar" y "Revocar".

Server actions en `actions.ts`, todas con resultado `{ ok: true } | { ok: false; message }` y mensajes en castellano:

- `changeMemberRole(membershipId, role, slug)`: valida que `role` sea `tenant_admin` o `tenant_member`, actualiza con la sesión del usuario (la RLS y el `grant update (role)` deciden). Cero filas: "No tenés permiso". `23514`: "La empresa no puede quedar sin administrador."
- `blockMember(tenantId, userId, slug)` y `unblockMember(...)`: `rpc`. `42501`: "No tenés permiso". `23514`: el mismo mensaje del administrador.
- `revokeMembership` pasa a devolver resultado y a traducir `23514`. Hoy ignora el error.
- `resendInvitation(invitationId, slug)`: lee la invitación con la sesión del usuario, renueva `expires_at` a 14 días y llama a la parte de `lib/invitations/invite.ts` que manda el mail, extraída a `sendInvitationMail`. Resultados: enviado; "Esa persona ya tiene cuenta. Pasale el link de ingreso de la empresa."; "No se pudo mandar el mail. Probá de nuevo."

## 8. Límites declarados

- **Una sesión abierta sobrevive al cambio de métodos de la empresa solo hasta el próximo request**: el chequeo por request (L10) la frena en la web y en el chat.
- **La API de datos no aplica la regla.** La RLS sigue mirando membresía, no método: quien llame a PostgREST directo con su token no pasa por el chequeo.
- **Los canales MCP** piden consentimiento con una sesión web, así que pasan por el corte al entrar, pero un token ya emitido no se revisa.
- **`xms_edov` es condición de despliegue**, no algo que el código pueda garantizar solo (anexo A, paso 3). L4 limita el daño a "no entra", pero la vinculación de identidades la hace GoTrue antes de que corra nuestro código.
- **Un cliente solo Microsoft no puede usar el agente de outreach** para mandar o leer correo: sigue dependiendo de Gmail. El proveedor Outlook es otra etapa.
- **El método de Microsoft acepta cualquier tenant de Entra** (`common`). La pertenencia a la empresa la decide el dominio del correo o la invitación, igual que con Google.
- **Dos identidades OAuth vinculadas** (Google y Microsoft con el mismo correo): gana la del `last_sign_in_at` más nuevo. Dos logins casi simultáneos podrían cruzarse; el efecto es un corte de más, no un acceso de más.

## 9. Despliegue

1. Aplicar la migración de la entrega **antes** de desplegar su código (`npx supabase migration list` primero: `db push` aplica todas las pendientes). Al revés, `login_gate` no existe y nadie puede entrar (L8).
2. La 20.1 se puede desplegar sin Microsoft configurado: el botón solo aparece en empresas que tengan `microsoft` en `auth_methods`, y ninguna lo tiene hasta que plataforma lo marque.
3. Antes de marcar `microsoft` en una empresa: anexo A completo.
4. Antes de desplegar, confirmar en producción que `auth_methods` del tenant dueño incluye el método con el que hoy entran los administradores de plataforma, y avisar que quien entraba por Google a una empresa que solo permite correo va a ser rebotado a su landing.

## 10. Pruebas

**Base** (`npm run db:test`), archivo `27_login_methods.test.sql`:

- `current_login_method`: `otp`, `magiclink` e `invite` dan `email`; `oauth` con identidad Google da `google`; `oauth` con Azure y `xms_edov` verdadero da `microsoft`; con `xms_edov` falso o ausente da `null`; con Google y Azure vinculadas gana la del `last_sign_in_at` más nuevo; `amr` vacío, método desconocido o sin sesión dan `null`; con dos entradas en `amr` gana la del `timestamp` más alto.
- El check acepta `microsoft` y sigue rechazando valores desconocidos.
- `join_tenants_by_domain` no une a una empresa que no permite el método, y sí a otra que lo permite, en la misma llamada.
- `accept_pending_invitations` deja pendiente la invitación de una empresa que no permite el método y de una inactiva.
- `tenant_allows_login`: permitido; no permitido; tenant inactivo; tenant inexistente; método `null`.
- `login_gate`: miembro con método permitido; miembro sin método permitido (devuelve su slug); miembro de dos empresas donde una lo permite; sin empresas; solo con invitación pendiente a una empresa que no lo permite; solo con dominio abierto en una empresa que no lo permite; método `null`.

Archivo `28_member_blocks.test.sql`:

- Un miembro común no puede bloquear ni desbloquear; un administrador de otra empresa tampoco.
- Bloquear borra la membresía, crea el bloqueo y deja el evento; repetirlo no falla.
- `join_tenants_by_domain` no vuelve a unir a un bloqueado y sí lo une tras desbloquear.
- Aceptar una invitación levanta el bloqueo.
- Nadie se bloquea a sí mismo.
- El último administrador no se puede degradar, sacar ni bloquear; con dos administradores sí. Borrar la empresa entera pasa.
- `authenticated` no puede escribir `membership_blocks` por la API.

**Aplicación** (`npm test`):

- `gateLogin`: permitido; cortado con landing; RPC con error; RPC que tira; respuesta sin forma.
- Callback: con el gate cortado cierra la sesión y redirige a la landing; el orden es unir y después chequear; con el gate permitido sigue al `next`.
- `resolveConfirmation`: con el gate cortado cierra la sesión y devuelve la landing; si el gate tira, corta.
- `resolveTenantAccess`: método no permitido redirige a la landing de esa empresa; un administrador de plataforma se chequea contra el tenant dueño y entra a una empresa que no permite su método; si el RPC falla, redirige; sin sesión o sin rol sigue dando `null` sin llamar al RPC.
- `requirePlatformAdmin`: método no permitido en el tenant dueño redirige.
- Canal del chat: `allowsLogin` en falso o tirando da `null`; se consulta con el tenant de la conversación.
- `loadOfferedMethods`: une los métodos de las empresas activas en el orden de `AUTH_METHODS`; ignora valores desconocidos; con error o sin empresas devuelve solo correo.
- `LoginForm`: qué botones aparecen para cada combinación de los tres métodos; Microsoft usa el proveedor `azure`.
- Landing y `/login`: los dos avisos de `error`.
- `auth-methods`: los tres valores en orden y sus rótulos.
- Acciones de usuarios: cada resultado y cada traducción de error; `changeMemberRole` rechaza `platform_admin` y valores desconocidos; `resendInvitation` cubre sus tres resultados y renueva el vencimiento.
- Página de usuarios: una fila `platform_admin` no tiene selector ni "Bloquear"; la propia fila no tiene "Bloquear"; la sección de bloqueados no aparece vacía.

**Navegador** (base local): Google y Microsoft no se pueden probar sin proveedor configurado. Se prueba el corte con correo: una empresa de prueba sin `email` en `auth_methods`, entrar por link y caer en la landing con el aviso. Y el recorrido completo de la 20.2.

## 11. Fuera de alcance

- Proveedor de correo Outlook para el agente.
- SSO por SAML y restringir Microsoft a un tenant de Entra por empresa.
- Imponer el método en la RLS, en la API de datos o en los tokens MCP ya emitidos.
- Dominio propio por cliente.
- Cerrar las sesiones abiertas cuando una empresa cambia sus métodos.

## Anexo A: Microsoft en producción (lo hace una persona)

1. En Entra, registrar una app web multiinquilino con redirect URI `https://<proyecto>.supabase.co/auth/v1/callback`. Crear un secreto de cliente.
2. En API permissions, sumar `email` de Microsoft Graph.
3. **En el Manifest, agregar el claim opcional `xms_edov` al `idToken`.** Sin este paso, Microsoft queda apagado: la plataforma no reconoce esas sesiones (L4).
4. En Supabase Auth, activar el proveedor Azure con el cliente, el secreto y el tenant `common`.
5. Con una cuenta de prueba, entrar por Microsoft y confirmar en `auth.identities` que `identity_data -> 'custom_claims'` trae `xms_edov` en `true`.
6. Marcar `microsoft` en una empresa de prueba desde `/plataforma/<slug>` y correr el criterio de cierre de la 20.1.
7. Confirmar que "Confirm email" sigue prendido en Supabase Auth.
