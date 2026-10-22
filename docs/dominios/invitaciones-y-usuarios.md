---
title: Invitaciones y usuarios
category: dominios
status: activo
tags: [invitaciones, usuarios, roles, ingreso-por-dominio, memberships, bloqueo]
updated: 2026-10-14
sources:
  - lib/invitations/invite.ts
  - lib/invitations/domain.ts
  - lib/domains/origin.ts
  - lib/auth/join-on-login.ts
  - lib/auth/login-gate.ts
  - lib/auth/magic-link.ts
  - lib/tenants/role-labels.ts
  - lib/tenants/public-email-domains.ts
  - app/api/invitations/route.ts
  - app/[tenant]/settings/usuarios
  - app/[tenant]/settings/actions.ts
  - app/auth/callback/route.ts
  - supabase/migrations/20260912192841_invitations.sql
  - supabase/migrations/20261011120000_memberships_lock_columns.sql
  - supabase/migrations/20261012120000_join_by_domain.sql
  - supabase/migrations/20261014120000_member_blocks.sql
  - docs/superpowers/specs/2026-10-09-etapa-20-login-design.md
  - docs/superpowers/specs/2026-10-09-ingreso-por-dominio-design.md
---

# Invitaciones y usuarios

## 1. Qué es y para qué

Una persona entra a una empresa (tenant) de tres maneras: la **invita** un administrador, **entra sola** porque su correo verificado es de un dominio que la empresa abrió, o la invita plataforma al dar de alta la empresa (el primer administrador es una invitación más). En los tres casos el resultado es una fila en `memberships` con un rol, y esa fila nunca la crea el navegador: la crean funciones `security definer` que corren cuando la persona inicia sesión con un correo verificado. Esta página cubre ese camino y la pantalla donde un administrador gestiona a su gente.

Los roles son tres (`tenant_role`): `platform_admin`, `tenant_admin` y `tenant_member`, que la interfaz muestra en castellano como "Administrador de la plataforma", "Administrador" y "Usuario" (`ROLE_LABELS`, un solo módulo para toda la app). Un administrador puede invitar, cambiar el rol de un miembro, sacarlo o **bloquearlo** (impedirle volver a entrar, incluso por dominio). Qué método de login permite cada empresa se explica en [identidad y acceso](../arquitectura/identidad-y-acceso.md); la landing y la marca en [plataforma](plataforma.md).

## 2. Dónde vive en el código

| Archivo | Qué hace |
|---|---|
| `app/api/invitations/route.ts` | `POST /api/invitations`: invitar con rol; mapea los resultados a códigos HTTP |
| `lib/invitations/invite.ts` | `inviteToTenant` (fila + mail) y `sendInvitationMail` (reutilizable para reenviar) |
| `lib/invitations/domain.ts` | `isAllowedDomain`, `emailDomain` |
| `app/[tenant]/settings/usuarios/` | Pantalla de usuarios: `page.tsx`, `invite-form.tsx`, `row-actions.tsx`, `actions.ts`, `run-row-action.ts` |
| `app/[tenant]/settings/actions.ts` | `updateSignupMode`: abre o cierra el ingreso por dominio |
| `lib/auth/join-on-login.ts` | `joinOnLogin`: corre las invitaciones y después el dominio |
| `lib/auth/login-gate.ts` | `gateLogin`: el corte por método al entrar |
| `app/auth/callback/route.ts`, `app/auth/confirmar/` | Cierran el login y llaman a lo anterior |
| `lib/tenants/role-labels.ts` | Etiquetas de rol |
| `supabase/migrations/20260912192841_invitations.sql`, `20261011120000_memberships_lock_columns.sql`, `20261012120000_join_by_domain.sql`, `20261014120000_member_blocks.sql` | Las tablas, funciones y triggers de abajo |

## 3. Cómo funciona

### Invitar

`POST /api/invitations` (`/api/invitations`) recibe `tenantId`, `email`, `role` (`tenant_admin` o `tenant_member`) y `allowExternal`. Exige sesión, que quien llama sea `tenant_admin` o `platform_admin` de esa empresa (la RLS limita lo que ve) **y** que la sesión se haya abierto con un método que esa empresa permite (`actionAllowsLogin`). Después `inviteToTenant`:

1. Si el correo no es de un dominio de `tenants.allowed_domains` y no vino `allowExternal`, devuelve `dominio_no_permitido` (HTTP 422 con la lista de dominios, para que el formulario ofrezca "permitir correo externo"). Lista vacía significa sin restricción. Con `allowExternal` se deja el evento `invitation.external`.
2. Si la empresa es Free, aplica el tope de usuarios: miembros activos más invitaciones pendientes (una pendiente reserva lugar) deben ser menos de 3, y una empresa suspendida no invita; si no, devuelve `limit:users` o `suspended:<causa>` y no inserta nada (ver [alta self-serve y planes](onboarding.md)). Inserta una fila en `invitations` (`pending`, vence a los 14 días, un correo pendiente por empresa: el índice único parcial devuelve `duplicada`, HTTP 409).
3. Manda el mail de Supabase (`inviteUserByEmail`). Si la persona ya tiene cuenta, Supabase no reinvita (`ya_existe`, igual HTTP 201: la invitación queda pendiente y se acepta en su próximo ingreso). Un fallo real de envío da 502 y la fila queda pendiente.

**A dónde apunta el link.** Si la empresa tiene un dominio propio activo, el link del mail (`/auth/callback?next=/<slug>`) sale con ese dominio y no con el host de quien invita (`invitationOrigin`, `lib/domains/origin.ts`, Etapa 21.6): una persona de plataforma que invita desde el host raíz genera un link al dominio de la empresa. Vale para este endpoint y para el reenvío desde `/settings/usuarios`. Sin dominio propio, o si no se puede leer, sale con el origen de siempre. El link mágico del login no cambia: vuelve al host donde se pidió.

El rol de la invitación es el rol de la membership que se crea. El selector Usuario / Administrador del formulario ([#68](https://github.com/innovasbuild/agents/pull/68)) lo manda; antes siempre iba `tenant_member`.

### Aceptar: de invitación a membership

La persona entra por el link del mail. Supabase devuelve la sesión en el fragmento de la URL, que el servidor no ve, así que `/auth/callback` sin `code` sigue a `/auth/confirmar`, una pantalla de navegador que muestra "Vas a entrar como <correo>", espera un clic y abre la sesión (evita que un link con tokens ajenos deje a alguien logueado como otra persona). En ambos caminos corre `completeLogin`: primero `joinOnLogin` y después `gateLogin`.

`accept_pending_invitations()` salta las empresas suspendidas (el trigger `tenant_writable_guard` haría fallar la función entera) y toma el correo **verificado** de `auth.users` (nunca un parámetro), marca como `accepted` las invitaciones vigentes y crea las memberships con `on conflict do nothing`, de modo que dos clics no duplican nada. Solo cuenta en empresas activas que permiten el método de login con el que se abrió la sesión. Una invitación levanta un bloqueo previo y deja el evento `membership.unblocked`: es una decisión explícita y más nueva.

### Ingreso por dominio

`tenants.self_signup_by_domain` en `true` hace que cualquier persona con un correo verificado de `allowed_domains` entre sin invitación como `tenant_member`. Lo abre el administrador de la empresa en la sección Ingreso de `/[tenant]/settings` (`updateSignupMode`); **los dominios los carga plataforma**. Reglas:

- Abrirlo exige al menos un dominio (`tenants_self_signup_needs_domain`) y ninguno de correo público (`is_public_email_domain`, lista en `lib/tenants/public-email-domains.ts`).
- El trigger `tenants_guard_columns` deja a un `tenant_admin` cambiar solo `default_model` y `self_signup_by_domain`; el resto de `tenants` es de plataforma.
- `join_tenants_by_domain()` (`security definer`) crea la membership y deja el evento `membership.joined_by_domain`. Salta a los bloqueados.
- `requestMagicLink` solo permite crear cuenta nueva (`shouldCreateUser`) si el correo es de un dominio abierto en alguna empresa, y responde igual en todos los casos para no confirmar quién tiene acceso. La landing `/login/<slug>` pide el correo del dominio cuando el modo está abierto.
- Condición de producción: "Confirm email" tiene que estar prendido en Supabase Auth, o alguien podría registrarse con el correo de otro ([#81](https://github.com/innovasbuild/agents/pull/81)).

### Pantalla de usuarios: `/[tenant]/settings/usuarios`

Lista a cada miembro con nombre y correo (leídos de `auth.users` con el cliente admin, solo para los `user_id` que la RLS ya devolvió; [#67](https://github.com/innovasbuild/agents/pull/67)) y su rol. Acciones, todas server actions que releen la fila con la sesión del usuario y chequean el método de login contra la empresa de esa fila antes de escribir:

| Acción | Cómo |
|---|---|
| Cambiar rol | `changeMemberRole`: `update` de `role` (a `tenant_admin` o `tenant_member`) |
| Sacar | `revokeMembership`: borra la membership; una baja que la RLS filtra responde "No tenés permiso", no "ok" |
| Bloquear / Desbloquear | RPC `block_member` / `unblock_member`; hay confirmación |
| Reenviar invitación | `resendInvitation`: renueva `expires_at` 14 días y reenvía el mail |
| Revocar invitación | `revokeInvitation`: pone `status = 'revoked'` |
| Invitar | `InviteForm` contra `/api/invitations` |

Una sección "Bloqueados" lista a quienes tienen fila en `membership_blocks`, con la fecha y el botón Desbloquear.

### Lo que protege la base

- **Columnas protegidas de `memberships`** ([#80](https://github.com/innovasbuild/agents/pull/80)): se revocó `insert` y `update` a `authenticated` y `anon`, y se otorgó solo `update (role)`. Antes un `tenant_admin` podía insertar una fila con cualquier `user_id` o cambiar `user_id`/`tenant_id`. Las altas pasan por funciones `security definer`. La policy `memberships_write` sigue impidiendo crear o dejar a alguien como `platform_admin` salvo a plataforma. (No es un trigger: es un revoke más un grant por columna.)
- **Una empresa nunca queda sin administrador**: el trigger `memberships_keep_one_admin` frena un cambio de rol, una baja o un bloqueo que deje la empresa sin `tenant_admin` ni `platform_admin`; serializa con un candado sobre la fila del tenant y deja pasar el borrado en cascada de la empresa entera. La acción lo traduce a "La empresa no puede quedar sin administrador".
- **`membership_blocks`**: RLS solo lectura para administradores; escriben solo `block_member` y `unblock_member`. `block_member` bloquea solo a un miembro actual, nunca a un uuid ajeno; nadie se bloquea a sí mismo; solo plataforma bloquea a un `platform_admin`. `login_gate` no manda a la landing de la empresa que bloqueó a la persona.
- **El método de login se impone en el servidor**: `login_gate()` decide el corte al entrar y `tenant_allows_login()` cada request ([#85](https://github.com/innovasbuild/agents/pull/85)). Ver [identidad y acceso](../arquitectura/identidad-y-acceso.md).

## 4. Cómo se prueba

```bash
npm test -- tests/invitations tests/settings tests/auth
npm run db:test   # 02_invitations, 25_memberships_lock_columns, 26_join_by_domain, 28_member_blocks, 27_login_methods
```

Tests clave: `tests/invitations/{invite,route,domain}.test.ts`, `tests/settings/usuarios-*.test.ts` y `run-row-action.test.ts`, `signup-mode.test.ts`, `tests/auth/{join-on-login,login-gate,can-sign-up-by-domain,magic-link,callback}.test.ts`. En pgTAP, `25_memberships_lock_columns` (9 aserciones) y `28_member_blocks`. La verificación del ingreso completo con Mailpit en navegador quedó pendiente en #81.

## 5. Decisiones

- Specs: [etapa 20 login](../superpowers/specs/2026-10-09-etapa-20-login-design.md) (20.1 y 20.2), [ingreso por dominio](../superpowers/specs/2026-10-09-ingreso-por-dominio-design.md).
- [#67](https://github.com/innovasbuild/agents/pull/67): usuarios con nombre y correo, roles en castellano.
- [#68](https://github.com/innovasbuild/agents/pull/68): elegir el rol al invitar.
- [#80](https://github.com/innovasbuild/agents/pull/80): `memberships` sin INSERT ni UPDATE de `user_id`/`tenant_id`.
- [#81](https://github.com/innovasbuild/agents/pull/81): ingreso por dominio configurable por empresa.
- [#85](https://github.com/innovasbuild/agents/pull/85): Microsoft y métodos de login impuestos en el servidor (20.1).
- [#86](https://github.com/innovasbuild/agents/pull/86): bloqueo por persona, cambio de rol y reenvío (20.2).
- #80 no agregó un trigger: el candado de `memberships` es un revoke más un grant por columna. El trigger `tenants_guard_columns` es de `tenants` y llegó con #81. El `update (role)` que dejó #80 es el que usa el cambio de rol de #86.
