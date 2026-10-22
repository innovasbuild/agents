---
title: Login con Microsoft para una empresa
category: guias
status: activo
tags: [login, microsoft, entra, azure, supabase, plataforma]
updated: 2026-10-21
sources:
  - docs/superpowers/specs/2026-10-09-etapa-20-login-design.md
  - lib/auth/oauth-providers.ts
  - lib/tenants/auth-methods.ts
  - app/(auth)/login/login-form.tsx
  - supabase/migrations/20261013120000_login_methods.sql
---

# Login con Microsoft para una empresa

Cómo dejar a una empresa del universo Microsoft 365 entrando con su cuenta corporativa desde `/login/<slug>` (o desde su [dominio propio](dominio-de-un-cliente.md)). El código ya está en producción desde la Etapa 20.1 ([#85](https://github.com/innovasbuild/agents/pull/85)): el método `microsoft` existe en `AUTH_METHODS` y en el check de `tenants.auth_methods`, el botón "Entrar con Microsoft" aparece cuando la empresa lo tiene, y `current_login_method()` reconoce la sesión. Lo que falta es **configuración que hace una persona**, una sola vez para toda la plataforma: la app en Microsoft Entra y el proveedor en Supabase Auth. Después, habilitar el método en cada empresa es una casilla en la consola.

El diseño y sus razones están en la [spec de la Etapa 20](../superpowers/specs/2026-10-09-etapa-20-login-design.md) (anexo A) y en [identidad y acceso](../arquitectura/identidad-y-acceso.md).

## Lo que hay que saber antes

- **Microsoft es el proveedor `azure` de Supabase.** El cliente ve "Microsoft"; el mapeo vive en `lib/auth/oauth-providers.ts` y en la función SQL `current_login_method()`.
- **Sin el claim `xms_edov`, nadie entra por Microsoft.** GoTrue da el correo por verificado cuando Entra no manda ese claim, así que alguien con un tenant propio de Microsoft podría presentarse con el correo de otra persona. Por eso `current_login_method()` solo devuelve `microsoft` si la identidad trae `xms_edov` en `true`; si el claim falta, la sesión vale `null`, `login_gate` la corta y la persona cae en la landing con el aviso "Tu empresa no permite entrar con ese método". El paso 3 de abajo no es opcional.
- **La app de Entra es multiinquilino (`common`).** Cualquier cuenta de Microsoft puede autenticarse; la pertenencia a la empresa la decide el dominio del correo (`allowed_domains` con ingreso abierto) o una invitación, igual que con Google. Restringir a un tenant de Entra por empresa quedó fuera de alcance.
- **`/login` general ofrece Microsoft apenas una empresa activa lo tiene habilitado** (`loadOfferedMethods`). Es a propósito: quien entra por `/login` con Microsoft cae en la empresa que lo permite y es rebotado de las que no.

## Pasos

### 1. Registrar la app en Microsoft Entra

En el portal de Azure (Microsoft Entra ID → App registrations → New registration):

1. Nombre: `Central IA` (lo ve la persona en la pantalla de consentimiento).
2. Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)**. Sumar cuentas personales solo si alguna empresa lo necesita.
3. Redirect URI: plataforma **Web**, valor `https://<proyecto>.supabase.co/auth/v1/callback`. El `<proyecto>` es la referencia del proyecto de Supabase de producción (`SUPABASE_PROJECT_REF`). Si el proyecto usa un dominio propio de Supabase Auth, va ese.
4. Guardar y anotar el **Application (client) ID**.
5. Certificates & secrets → New client secret. Anotar el **Value** en el momento: después no se vuelve a mostrar. Elegir un vencimiento y agendar la rotación (24 meses es el máximo del portal).

### 2. Permisos

API permissions → Add a permission → Microsoft Graph → Delegated → marcar `email`, `openid` y `profile` (`User.Read` suele venir marcado por defecto y no molesta). No hace falta consentimiento de administrador: son permisos que cada persona acepta al entrar.

### 3. El claim `xms_edov` en el token (obligatorio)

Token configuration → Add optional claim → tipo **ID** → marcar `email` y, si aparece en la lista, `xms_edov`. Si el portal no lo lista, va por el **Manifest**: en `optionalClaims.idToken` agregar

```json
{ "name": "xms_edov", "source": null, "essential": false, "additionalProperties": [] }
```

y guardar. El claim dice si el dominio del correo está verificado en el tenant de Entra de la persona. Es lo que hace que Supabase marque el correo como verificado o no, y lo que la plataforma mira para aceptar la sesión.

### 4. Prender el proveedor en Supabase Auth

En el panel de Supabase del proyecto de producción, Authentication → Providers → **Azure**:

| Campo | Valor |
|---|---|
| Azure enabled | prendido |
| Application (client) ID | el del paso 1 |
| Secret Value | el secreto del paso 1 |
| Azure Tenant URL | vacío, o `https://login.microsoftonline.com/common` (multiinquilino) |

Confirmar además, en Authentication → Settings, que **Confirm email** sigue prendido: es lo que obliga a que el correo que llega de un proveedor esté verificado.

### 5. Probar con una cuenta real antes de habilitarlo a un cliente

1. En `/plataforma/<slug>` de una empresa de prueba (o de `innovas`), marcar la casilla **Microsoft** en métodos de ingreso y guardar.
2. Entrar a `/login/<slug>` con una cuenta Microsoft de un dominio permitido (o invitada). Tiene que aparecer "Entrar con Microsoft" primero, pedir consentimiento en Microsoft y volver al chat o al brain.
3. En el SQL editor de Supabase, confirmar el claim:

```sql
select identity_data -> 'custom_claims' ->> 'xms_edov' as edov, identity_data ->> 'email'
from auth.identities where provider = 'azure' order by last_sign_in_at desc limit 5;
```

Tiene que decir `true`. Si viene `null`, el paso 3 no quedó bien: la persona vio el consentimiento pero cayó en la landing con el aviso de método.

### 6. Habilitar el método en la empresa

En `/plataforma/<slug>`, marcar **Microsoft** y guardar. Si la empresa va a entrar solo con Microsoft, destildar los demás, con dos cuidados: la consola no deja guardar una combinación que dejaría afuera el método con el que estás logueado, y una invitación por correo sigue siendo un login por correo (la persona hace clic, cae en la landing con el botón de Microsoft, entra por ahí y la invitación se acepta sola).

Si la empresa tiene ingreso abierto por dominio, el dominio de sus cuentas Microsoft tiene que estar en `allowed_domains`; si no, cada persona entra por invitación.

## Qué va a fallar si te olvidás de algo

| Síntoma | Causa |
|---|---|
| El botón no aparece en `/login/<slug>` | La empresa no tiene `microsoft` en sus métodos (paso 6) o está inactiva |
| Microsoft dice `AADSTS50011` (redirect URI mismatch) | La Redirect URI del paso 1 no es exactamente `https://<proyecto>.supabase.co/auth/v1/callback` |
| Microsoft dice `AADSTS700016` o `unauthorized_client` | La app es de un solo tenant: cambiar Supported account types a multiinquilino |
| Vuelve a `/login?error=auth_failed` | El proveedor está apagado en Supabase o el secreto venció o se pegó mal |
| Vuelve a `/login/<slug>?error=metodo` después del consentimiento | Falta el claim `xms_edov` (paso 3): la sesión existe pero vale `null`. Revisar con la consulta del paso 5 |
| Entra pero no ve la empresa | El correo no es de un dominio permitido ni tiene invitación pendiente. La membresía la decide el dominio o la invitación, no Microsoft |
| El login vuelve a `agentes.innov.as` desde un dominio propio | El dominio no está en las Redirect URLs de Supabase ([dominio propio](dominio-de-un-cliente.md)) |

## Cómo se prueba en el código

`npm test -- tests/auth tests/tenants` cubre el botón por combinación de métodos (`LoginForm` con el proveedor `azure`) y el tipo `AuthMethod`; `npm run db:test` corre `27_login_methods` (`microsoft` válido en el check, `current_login_method()` con `xms_edov` verdadero, falso y ausente). El recorrido de punta a punta con Microsoft no se prueba en automático: pide el proveedor real, por eso existe el paso 5.
