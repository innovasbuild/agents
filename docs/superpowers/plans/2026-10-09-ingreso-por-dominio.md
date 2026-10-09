# Ingreso por dominio de correo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada empresa elija entre ingreso solo por invitación o abierto a quien tenga un correo verificado de sus dominios, y que el admin de la empresa lo cambie desde su configuración.

**Architecture:** Una migración cierra las columnas de `tenants` (trigger) y suma `join_tenants_by_domain()` (`security definer`, mismo patrón que `accept_pending_invitations`). `joinOnLogin` corre las dos funciones en `/auth/callback` y `/auth/confirmar`. Una server action decide si un correo puede crear cuenta; la sección "Ingreso" de settings cambia el modo.

**Tech Stack:** Postgres/pgTAP (Supabase local), Next.js App Router, Vitest, zod 4, Biome.

**Spec:** `docs/superpowers/specs/2026-10-09-ingreso-por-dominio-design.md`

## Global Constraints

- Español rioplatense en UI y mensajes; código e identificadores en inglés.
- Toda tabla lleva `tenant_id` y RLS. `events` es append-only: solo INSERT.
- Nada específico de un tenant en el código.
- Node: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH` antes de cualquier `npm`/`npx`. Si falta `node_modules`: `npm ci`.
- Nunca `git add -A`: se agregan los archivos por nombre. Formateo solo de los archivos tocados con `npx biome check --write <archivos>`; `npm run lint:fix` reformatea 4 archivos ajenos (no usarlo).
- Mensajes de commit con prefijo `feat:`/`fix:`/`docs:`/`refactor:` y terminan con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Verificación de cada tarea: `npm run typecheck` sin errores y los tests de la tarea en verde. Las tareas con SQL corren `npm run db:reset && npm run db:test` (necesitan Docker abierto).
- La migración se llama `supabase/migrations/20261012120000_join_by_domain.sql`. No se corre nada contra la base remota.
- Coincidencia de dominio: exacta, sin subdominios, sin distinguir mayúsculas. Rol del alta: siempre `tenant_member`. Evento: `membership.joined_by_domain`, resumen `Ingreso por dominio`, `payload = {"domain": <dominio>}`.

## Review Focus

- Un correo con mayúsculas, espacios, doble arroba o sin parte local no debe abrir ni dejar crear cuenta (`emailDomain`, `canSignUpByDomain`, la función SQL).
- `ventas.empresa.com` no entra por `empresa.com`; `Empresa.COM` guardado en la tabla sí coincide con `empresa.com` (función SQL y `canSignUpByDomain`).
- Una cuenta sin correo confirmado, o sin correo, no se une a nada.
- Si ya es `tenant_admin` de una empresa, el ingreso por dominio no baja su rol ni deja evento; una invitación se acepta antes y gana.
- Si una de las dos RPC falla, la otra corre igual y el ingreso sigue.
- El admin de una empresa no puede cambiar `allowed_domains`, `slug`, `active`, `allowed_models`, `auth_methods`, `brand` ni `display_name` por la API, pero sí `default_model` y `self_signup_by_domain`.
- Un dominio público ya cargado no se puede abrir desde settings ni desde la consola.

---

### Task 1: Base — candado de `tenants`, restricción y `join_tenants_by_domain()`

**Files:**
- Create: `supabase/migrations/20261012120000_join_by_domain.sql`
- Create: `supabase/tests/26_join_by_domain.test.sql`

**Interfaces:**
- Consumes: `public.is_platform_admin()`, `public.memberships`, `public.events`, `auth.users`.
- Produces: `public.join_tenants_by_domain() returns integer` (ejecutable por `authenticated`); trigger `tenants_guard_columns`; check `tenants_self_signup_needs_domain`.

- [ ] **Step 1: Escribir la prueba pgTAP**

Crear `supabase/tests/26_join_by_domain.test.sql`:

```sql
-- supabase/tests/26_join_by_domain.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c7c7c7c7-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@dom-a.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@dom-a.test', null),
  ('c7c7c7c7-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cami@sub.dom-a.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'Dani@DOM-A.Test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'eva@dom-a.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'adm@other.test', now()),
  ('c7c7c7c7-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'pa@other.test', now());

insert into public.tenants (id, slug, display_name, allowed_domains, self_signup_by_domain, active)
values
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'jd-a', 'JD A', '{dom-a.test}', true, true),
  ('d7d7d7d7-0000-0000-0000-00000000000b', 'jd-b', 'JD B', '{DOM-A.test,dom-x.test}', true, true),
  ('d7d7d7d7-0000-0000-0000-00000000000c', 'jd-c', 'JD C', '{dom-a.test}', false, true),
  ('d7d7d7d7-0000-0000-0000-00000000000d', 'jd-d', 'JD D', '{dom-a.test}', true, false);

insert into public.memberships (tenant_id, user_id, role)
values
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'c7c7c7c7-0000-0000-0000-000000000005', 'tenant_admin'),
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'c7c7c7c7-0000-0000-0000-000000000006', 'tenant_admin'),
  ('d7d7d7d7-0000-0000-0000-00000000000a', 'c7c7c7c7-0000-0000-0000-000000000007', 'platform_admin');

-- 1-3: existencia y privilegios
select has_function('public', 'join_tenants_by_domain', 'existe la función de ingreso por dominio');
select ok(
  not has_function_privilege('anon', 'public.join_tenants_by_domain()', 'execute'),
  'anon no puede ejecutar el ingreso por dominio');
select ok(
  has_function_privilege('authenticated', 'public.join_tenants_by_domain()', 'execute'),
  'authenticated sí puede ejecutar el ingreso por dominio');

-- Ana: dominio exacto, entra a las dos empresas abiertas y a ninguna más.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select public.join_tenants_by_domain()), 2, 'Ana entra a las dos empresas abiertas con su dominio');
reset role;

select is(
  (select count(*)::int from public.memberships
    where user_id = 'c7c7c7c7-0000-0000-0000-000000000001'),
  2, 'Ana quedó con dos membresías');
select is(
  (select count(*)::int from public.memberships
    where user_id = 'c7c7c7c7-0000-0000-0000-000000000001'
      and tenant_id in ('d7d7d7d7-0000-0000-0000-00000000000c', 'd7d7d7d7-0000-0000-0000-00000000000d')),
  0, 'no entra a la empresa cerrada ni a la inactiva');
select is(
  (select count(*)::int from public.memberships
    where user_id = 'c7c7c7c7-0000-0000-0000-000000000001' and role = 'tenant_member'),
  2, 'entra siempre como tenant_member');
select is(
  (select count(*)::int from public.events
    where actor_user_id = 'c7c7c7c7-0000-0000-0000-000000000001'
      and type = 'membership.joined_by_domain'),
  2, 'cada alta deja su evento');

-- Segunda llamada: idempotente.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select public.join_tenants_by_domain()), 0, 'la segunda llamada no crea nada');
reset role;
select is(
  (select count(*)::int from public.events
    where actor_user_id = 'c7c7c7c7-0000-0000-0000-000000000001'
      and type = 'membership.joined_by_domain'),
  2, 'la segunda llamada no deja eventos');

-- Beto: correo sin confirmar.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select public.join_tenants_by_domain()), 0, 'un correo sin confirmar no se une a nada');

-- Cami: subdominio.
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select public.join_tenants_by_domain()), 0, 'un subdominio no coincide');

-- Dani: correo en mayúsculas contra un dominio guardado en mayúsculas.
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select public.join_tenants_by_domain()), 2, 'mayúsculas en el correo y en la tabla no importan');

-- Eva: ya es tenant_admin de jd-a; solo suma jd-b.
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select public.join_tenants_by_domain()), 1, 'quien ya es miembro no se cuenta de nuevo');
reset role;
select is(
  (select role::text from public.memberships
    where user_id = 'c7c7c7c7-0000-0000-0000-000000000005'
      and tenant_id = 'd7d7d7d7-0000-0000-0000-00000000000a'),
  'tenant_admin', 'el ingreso por dominio no baja el rol de un admin');

-- Sin sesión.
set local role authenticated;
set local "request.jwt.claims" to '{}';
select throws_ok(
  $$select public.join_tenants_by_domain()$$,
  'P0001', 'no authenticated user', 'sin sesión no hay ingreso');
reset role;

-- Candado de columnas: tenant_admin de jd-a (Adm).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000006","role":"authenticated"}';

update public.tenants set default_model = 'anthropic/claude-haiku-4-5' where slug = 'jd-a';
select is((select default_model from public.tenants where slug = 'jd-a'),
  'anthropic/claude-haiku-4-5', 'un tenant_admin cambia el modelo default');

update public.tenants set self_signup_by_domain = false where slug = 'jd-a';
select is((select self_signup_by_domain from public.tenants where slug = 'jd-a'),
  false, 'un tenant_admin cierra el ingreso');

update public.tenants set self_signup_by_domain = true where slug = 'jd-a';
select is((select self_signup_by_domain from public.tenants where slug = 'jd-a'),
  true, 'un tenant_admin abre el ingreso');

select throws_ok($$update public.tenants set allowed_domains = '{gmail.com}' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia allowed_domains');
select throws_ok($$update public.tenants set active = false where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia active');
select throws_ok($$update public.tenants set slug = 'otro' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia slug');
select throws_ok($$update public.tenants set allowed_models = '{anthropic/claude-haiku-4-5}' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia allowed_models');
select throws_ok($$update public.tenants set auth_methods = '{email}' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia auth_methods');
select throws_ok($$update public.tenants set brand = '{"primary":"#112233"}'::jsonb where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia brand');
select throws_ok($$update public.tenants set display_name = 'Otro' where slug = 'jd-a'$$,
  '42501', null, 'un tenant_admin no cambia display_name');

-- El admin de plataforma sí cambia todo.
set local "request.jwt.claims" to '{"sub":"c7c7c7c7-0000-0000-0000-000000000007","role":"authenticated"}';
update public.tenants set allowed_domains = '{dom-a.test,dom-z.test}' where slug = 'jd-a';
select is((select cardinality(allowed_domains) from public.tenants where slug = 'jd-a'),
  2, 'el admin de plataforma cambia allowed_domains');
reset role;

-- El owner de la base (migraciones, scripts) también.
update public.tenants set display_name = 'JD A bis' where slug = 'jd-a';
select is((select display_name from public.tenants where slug = 'jd-a'),
  'JD A bis', 'el owner cambia cualquier columna');

-- Restricción: el modo abierto exige dominios.
select throws_ok($$update public.tenants set allowed_domains = '{}' where slug = 'jd-a'$$,
  '23514', null, 'abrir el ingreso sin dominios viola la restricción');
update public.tenants set allowed_domains = '{}' where slug = 'jd-c';
select is((select cardinality(allowed_domains) from public.tenants where slug = 'jd-c'),
  0, 'con el ingreso cerrado se puede vaciar la lista');

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba y ver que falla**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npm run db:reset 2>&1 | tail -2 && npm run db:test 2>&1 | grep -A12 "26_join_by_domain" | head -20`
Expected: FAIL (no existe `join_tenants_by_domain`; los `throws_ok` del candado no lanzan).

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20261012120000_join_by_domain.sql`:

```sql
-- Ingreso por dominio de correo (spec 2026-10-09-ingreso-por-dominio-design).
--
-- 1. El modo abierto exige al menos un dominio. Antes solo lo validaba el
--    formulario de la consola.
-- 2. Candado de columnas en tenants: tenants_update deja a un tenant_admin
--    escribir cualquier columna de su fila por la API (allowed_domains,
--    active, slug, allowed_models, auth_methods, brand...). Con el ingreso
--    por dominio eso sería abrir la puerta a cualquier correo. Una sesión de
--    usuario que no es admin de plataforma solo cambia default_model y
--    self_signup_by_domain. service_role, postgres y las funciones security
--    definer no son 'authenticated' y pasan. Comparar el jsonb entero hace
--    que una columna nueva de tenants nazca cerrada.
-- 3. join_tenants_by_domain(): mismo patrón que accept_pending_invitations.
--    authenticated ya no puede insertar en memberships (20261011120000), así
--    que el alta es una función security definer.
alter table public.tenants
  add constraint tenants_self_signup_needs_domain
  check (not self_signup_by_domain or cardinality(allowed_domains) >= 1);

create or replace function public.tenants_guard_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if (select public.is_platform_admin()) then
    return new;
  end if;
  if (to_jsonb(new) - 'default_model' - 'self_signup_by_domain')
     is distinct from (to_jsonb(old) - 'default_model' - 'self_signup_by_domain') then
    raise exception 'solo plataforma puede cambiar estas columnas de tenants'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.tenants_guard_columns() from public;

create trigger tenants_guard_columns
  before update on public.tenants
  for each row execute function public.tenants_guard_columns();

create or replace function public.join_tenants_by_domain()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_domain text;
  v_count integer := 0;
  r record;
begin
  if v_user is null then
    raise exception 'no authenticated user';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return 0;
  end if;

  v_domain := split_part(v_email, '@', 2);

  for r in
    select t.id
    from public.tenants t
    where t.active
      and t.self_signup_by_domain
      and v_domain = any (select lower(d) from unnest(t.allowed_domains) d)
  loop
    insert into public.memberships (tenant_id, user_id, role)
    values (r.id, v_user, 'tenant_member')
    on conflict (tenant_id, user_id) do nothing;

    if found then
      insert into public.events (tenant_id, actor_user_id, type, summary, payload)
      values (r.id, v_user, 'membership.joined_by_domain', 'Ingreso por dominio',
              jsonb_build_object('domain', v_domain));
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.join_tenants_by_domain() from public;
revoke execute on function public.join_tenants_by_domain() from anon;
grant execute on function public.join_tenants_by_domain() to authenticated;
```

- [ ] **Step 4: Correr toda la suite de base**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npm run db:reset 2>&1 | tail -2 && npm run db:test 2>&1 | tail -6`
Expected: `All tests successful.` y `26_join_by_domain.test.sql ... ok`. Si algún archivo previo cambió de resultado, es porque escribía `tenants` como `authenticated` sin ser admin de plataforma: se arregla en esa prueba, no en la migración, y se reporta.

- [ ] **Step 5: Revisar los dominios en producción antes de que se aplique la migración**

Anotar en el reporte de la tarea la consulta que el controlador debe correr con `supabase db query --linked` o el SQL editor antes del `db push`: `select slug from public.tenants where self_signup_by_domain and cardinality(allowed_domains) = 0;` (debe devolver cero filas). No se corre contra la base remota desde esta tarea.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261012120000_join_by_domain.sql supabase/tests/26_join_by_domain.test.sql
git commit -m "feat: ingreso por dominio en la base, candado de columnas de tenants y join_tenants_by_domain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Módulos puros — dominios públicos, `emailDomain` y validación de la consola

**Files:**
- Create: `lib/tenants/public-email-domains.ts`
- Create: `tests/tenants/public-email-domains.test.ts`
- Modify: `lib/invitations/domain.ts`
- Modify: `tests/invitations/domain.test.ts`
- Modify: `lib/tenants/tenant-form.ts`
- Modify: `tests/tenants/tenant-form.test.ts`
- Modify: `app/plataforma/[slug]/tenant-form.tsx`

**Interfaces:**
- Produces: `PUBLIC_EMAIL_DOMAINS: readonly string[]`, `isPublicEmailDomain(domain: string): boolean`, `emailDomain(email: string): string | null` (minúsculas; `null` si no es `algo@dominio`).

- [ ] **Step 1: Escribir las pruebas**

Crear `tests/tenants/public-email-domains.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	isPublicEmailDomain,
	PUBLIC_EMAIL_DOMAINS,
} from "@/lib/tenants/public-email-domains";

describe("isPublicEmailDomain", () => {
	it("reconoce los dominios públicos sin importar mayúsculas ni arroba", () => {
		expect(isPublicEmailDomain("gmail.com")).toBe(true);
		expect(isPublicEmailDomain("Gmail.COM")).toBe(true);
		expect(isPublicEmailDomain("@outlook.com")).toBe(true);
		expect(isPublicEmailDomain("  yahoo.com.ar ")).toBe(true);
	});

	it("deja pasar el dominio de una empresa", () => {
		expect(isPublicEmailDomain("innov.as")).toBe(false);
		expect(isPublicEmailDomain("mail.gmail.com.empresa.com")).toBe(false);
	});

	it("la lista está en minúsculas y sin repetidos", () => {
		expect(PUBLIC_EMAIL_DOMAINS.every((d) => d === d.toLowerCase())).toBe(true);
		expect(new Set(PUBLIC_EMAIL_DOMAINS).size).toBe(PUBLIC_EMAIL_DOMAINS.length);
	});
});
```

Agregar a `tests/invitations/domain.test.ts`, importando `emailDomain` junto a `isAllowedDomain`, al final del archivo:

```ts
describe("emailDomain", () => {
	it("devuelve el dominio en minúsculas", () => {
		expect(emailDomain("Ana@Lagomarcino.COM")).toBe("lagomarcino.com");
		expect(emailDomain("  ana@x.com ")).toBe("x.com");
	});

	it("devuelve null si no es algo@dominio", () => {
		expect(emailDomain("ana")).toBeNull();
		expect(emailDomain("@x.com")).toBeNull();
		expect(emailDomain("ana@")).toBeNull();
		expect(emailDomain("a@b@c.com")).toBeNull();
		expect(emailDomain("")).toBeNull();
	});
});
```

Agregar a `tests/tenants/tenant-form.test.ts`, dentro del `describe("tenantInputSchema", ...)` (usar el mismo helper `form()` y el mismo patrón de parseo que los tests vecinos; mirar cómo `rechaza un nombre vacío` arma y lee el resultado y copiarlo):

```ts
	it("rechaza un dominio de correo público cuando el ingreso está abierto", () => {
		const parsed = tenantInputSchema.safeParse(
			readTenantForm(form({ allowed_domains: "innov.as\ngmail.com" })),
		);

		expect(parsed.success).toBe(false);
		expect(JSON.stringify(parsed.error?.issues)).toContain(
			'"gmail.com" es un correo público',
		);
	});

	it("acepta un dominio público si el ingreso está cerrado", () => {
		const data = form({ allowed_domains: "gmail.com" });
		data.delete("self_signup_by_domain");

		expect(tenantInputSchema.safeParse(readTenantForm(data)).success).toBe(
			true,
		);
	});
```

(Si `readTenantForm` no se usa así en los tests vecinos, adaptar al patrón real del archivo: lo que importa son los dos casos y el texto del mensaje.)

- [ ] **Step 2: Correr y ver que fallan**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npx vitest run tests/tenants/public-email-domains.test.ts tests/invitations/domain.test.ts tests/tenants/tenant-form.test.ts`
Expected: FAIL (módulo inexistente, `emailDomain` no exportada, regla ausente).

- [ ] **Step 3: Implementar**

Crear `lib/tenants/public-email-domains.ts`:

```ts
/**
 * Correos que cualquiera puede tener: un dominio de esta lista no puede abrir
 * el ingreso sin invitación (spec ingreso por dominio, D8). Es una red contra
 * el error humano, no una verificación de que el dominio sea de la empresa.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"msn.com",
	"yahoo.com",
	"yahoo.com.ar",
	"icloud.com",
	"me.com",
	"proton.me",
	"protonmail.com",
	"aol.com",
	"gmx.com",
	"zoho.com",
	"yandex.com",
	"fibertel.com.ar",
	"arnet.com.ar",
	"speedy.com.ar",
];

export function isPublicEmailDomain(domain: string): boolean {
	return PUBLIC_EMAIL_DOMAINS.includes(
		domain.trim().toLowerCase().replace(/^@/, ""),
	);
}
```

En `lib/invitations/domain.ts`, agregar al final:

```ts
/** Dominio en minúsculas de `algo@dominio`; null si no tiene esa forma. */
export function emailDomain(email: string): string | null {
	const parts = email.trim().toLowerCase().split("@");
	if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
		return null;
	}
	return parts[1];
}
```

En `lib/tenants/tenant-form.ts`: importar `isPublicEmailDomain` desde `@/lib/tenants/public-email-domains` y, dentro del `superRefine` existente, justo después del `if` de "al menos un dominio", agregar:

```ts
		if (input.selfSignupByDomain) {
			for (const domain of input.allowedDomains) {
				if (isPublicEmailDomain(domain)) {
					context.addIssue({
						code: "custom",
						path: ["allowedDomains"],
						message: `"${domain}" es un correo público: no puede abrir el ingreso.`,
					});
				}
			}
		}
```

En `app/plataforma/[slug]/tenant-form.tsx`, cambiar el texto del checkbox `Permitir el alta a quien tenga un correo de esos dominios` por `Ingreso abierto: entra sin invitación quien tenga un correo de esos dominios`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npx vitest run tests/tenants tests/invitations && npm run typecheck --silent`
Expected: PASS y typecheck sin errores. Si algún test existente de `tenant-form` usaba un dominio de la lista pública con el ingreso abierto, cambiarlo por `innov.as` y anotarlo.

- [ ] **Step 5: Formatear y commit**

```bash
export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH
npx biome check --write lib/tenants/public-email-domains.ts tests/tenants/public-email-domains.test.ts lib/invitations/domain.ts tests/invitations/domain.test.ts lib/tenants/tenant-form.ts tests/tenants/tenant-form.test.ts "app/plataforma/[slug]/tenant-form.tsx"
git add lib/tenants/public-email-domains.ts tests/tenants/public-email-domains.test.ts lib/invitations/domain.ts tests/invitations/domain.test.ts lib/tenants/tenant-form.ts tests/tenants/tenant-form.test.ts "app/plataforma/[slug]/tenant-form.tsx"
git commit -m "feat: dominios públicos no abren el ingreso y emailDomain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `joinOnLogin` en el callback y la confirmación

**Files:**
- Create: `lib/auth/join-on-login.ts`
- Create: `tests/auth/join-on-login.test.ts`
- Modify: `app/auth/callback/route.ts`
- Modify: `tests/auth/callback.test.ts`
- Modify: `app/auth/confirmar/confirmar.tsx`

**Interfaces:**
- Produces: `joinOnLogin(supabase: { rpc(fn: string): PromiseLike<{ error: { message: string } | null }> }): Promise<void>` — llama `accept_pending_invitations` y después `join_tenants_by_domain`; nunca lanza.

- [ ] **Step 1: Escribir las pruebas**

Crear `tests/auth/join-on-login.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { joinOnLogin } from "@/lib/auth/join-on-login";

function client(results: Record<string, "ok" | "error" | "throw">) {
	const calls: string[] = [];
	return {
		calls,
		rpc: async (fn: string) => {
			calls.push(fn);
			const result = results[fn] ?? "ok";
			if (result === "throw") throw new Error("red caída");
			return { error: result === "error" ? { message: "falló" } : null };
		},
	};
}

describe("joinOnLogin", () => {
	afterEach(() => vi.restoreAllMocks());

	it("acepta invitaciones primero y después une por dominio", async () => {
		const supabase = client({});

		await joinOnLogin(supabase);

		expect(supabase.calls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
		]);
	});

	it("si las invitaciones devuelven error, igual une por dominio", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const supabase = client({ accept_pending_invitations: "error" });

		await joinOnLogin(supabase);

		expect(supabase.calls).toContain("join_tenants_by_domain");
	});

	it("si una RPC lanza, la otra corre y no se propaga", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const supabase = client({ accept_pending_invitations: "throw" });

		await expect(joinOnLogin(supabase)).resolves.toBeUndefined();
		expect(supabase.calls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
		]);
	});

	it("si falla el ingreso por dominio no se propaga", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const supabase = client({ join_tenants_by_domain: "error" });

		await expect(joinOnLogin(supabase)).resolves.toBeUndefined();
	});
});
```

En `tests/auth/callback.test.ts`: reemplazar el contador `accepted: number` por `rpcCalls: string[]` (estado inicial `[]`, y en `beforeEach` `state.rpcCalls = []`); el mock de `rpc` pasa a `rpc: async (fn: string) => { state.rpcCalls.push(fn); return { error: null }; }`; las aserciones `expect(state.accepted).toBe(1)` pasan a `expect(state.rpcCalls).toEqual(["accept_pending_invitations", "join_tenants_by_domain"])` y las `toBe(0)` a `toEqual([])`. Cambiar el título del primer test a `con code válido acepta las invitaciones, une por dominio y va al next`.

- [ ] **Step 2: Correr y ver que fallan**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npx vitest run tests/auth/join-on-login.test.ts tests/auth/callback.test.ts`
Expected: FAIL (módulo inexistente; el callback llama una sola RPC).

- [ ] **Step 3: Implementar**

Crear `lib/auth/join-on-login.ts`:

```ts
interface RpcClient {
	rpc(fn: string): PromiseLike<{ error: { message: string } | null }>;
}

/**
 * Convierte en membresías lo que corresponde al mail verificado de quien
 * acaba de entrar: primero las invitaciones pendientes (una invitación como
 * admin gana) y después el ingreso por dominio. Cada paso es independiente:
 * si uno falla se registra y el otro corre igual; la sesión ya está abierta y
 * la próxima entrada reintenta.
 */
export async function joinOnLogin(supabase: RpcClient): Promise<void> {
	for (const fn of ["accept_pending_invitations", "join_tenants_by_domain"]) {
		try {
			const { error } = await supabase.rpc(fn);
			if (error) console.error(`${fn} falló:`, error.message);
		} catch (error) {
			console.error(`${fn} falló:`, error);
		}
	}
}
```

En `app/auth/callback/route.ts`: importar `joinOnLogin` desde `@/lib/auth/join-on-login` y reemplazar todo el bloque desde el comentario `// Alta solo por invitación...` hasta el cierre del `if (acceptError) {...}` por:

```ts
	// Las invitaciones pendientes y el ingreso por dominio de este mail
	// verificado se convierten en memberships acá y en ningún otro lado.
	await joinOnLogin(supabase);
```

En `app/auth/confirmar/confirmar.tsx`: importar `joinOnLogin` y reemplazar el cuerpo de `acceptInvitations` por `acceptInvitations: () => joinOnLogin(supabase),`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npx vitest run tests/auth && npm run typecheck --silent`
Expected: PASS. Si `tsc` rechaza pasar `supabase` a `joinOnLogin`, envolver: `joinOnLogin({ rpc: (fn) => supabase.rpc(fn) })` en las dos llamadas.

- [ ] **Step 5: Formatear y commit**

```bash
export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH
npx biome check --write lib/auth/join-on-login.ts tests/auth/join-on-login.test.ts app/auth/callback/route.ts tests/auth/callback.test.ts app/auth/confirmar/confirmar.tsx
git add lib/auth/join-on-login.ts tests/auth/join-on-login.test.ts app/auth/callback/route.ts tests/auth/callback.test.ts app/auth/confirmar/confirmar.tsx
git commit -m "feat: joinOnLogin une por invitación y por dominio al entrar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ingreso por mail y landing con el modo abierto

**Files:**
- Create: `app/(auth)/login/actions.ts`
- Create: `tests/auth/can-sign-up-by-domain.test.ts`
- Modify: `app/(auth)/login/login-form.tsx`
- Modify: `tests/auth/login-form.test.ts`
- Modify: `lib/tenants/public.ts`
- Modify: `tests/tenants/public.test.ts`
- Modify: `app/(auth)/login/[tenant]/page.tsx`
- Create: `tests/auth/tenant-login-page.test.ts`
- Create: `lib/tenants/domains-phrase.ts`
- Create: `tests/tenants/domains-phrase.test.ts`

**Interfaces:**
- Consumes: `emailDomain` (Task 2).
- Produces: `canSignUpByDomain(email: string): Promise<boolean>`; `PublicTenant.openDomains: string[]` (vacío si el modo está cerrado); `domainsPhrase(domains: string[]): string` en un módulo puro (`lib/tenants/domains-phrase.ts`), porque lo importa también un componente de cliente y `lib/tenants/public.ts` trae el cliente admin.

- [ ] **Step 1: Escribir las pruebas**

Crear `tests/auth/can-sign-up-by-domain.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	rows: { allowed_domains: string[] }[];
	error: unknown;
	filters: [string, unknown][];
	throws: boolean;
} = { rows: [], error: null, filters: [], throws: false };

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from() {
			if (state.throws) throw new Error("sin red");
			const builder = {
				select: () => builder,
				eq(column: string, value: unknown) {
					state.filters.push([column, value]);
					return builder;
				},
				then: (resolve: (value: unknown) => void) =>
					resolve({ data: state.rows, error: state.error }),
			};
			return builder;
		},
	}),
}));

const { canSignUpByDomain } = await import("@/app/(auth)/login/actions");

describe("canSignUpByDomain", () => {
	beforeEach(() => {
		state.rows = [{ allowed_domains: ["empresa.com"] }];
		state.error = null;
		state.filters = [];
		state.throws = false;
	});

	it("true si el dominio está abierto en alguna empresa", async () => {
		expect(await canSignUpByDomain("ana@empresa.com")).toBe(true);
	});

	it("filtra por empresas activas con el ingreso abierto", async () => {
		await canSignUpByDomain("ana@empresa.com");

		expect(state.filters).toEqual([
			["active", true],
			["self_signup_by_domain", true],
		]);
	});

	it("no distingue mayúsculas en el correo ni en la tabla", async () => {
		state.rows = [{ allowed_domains: ["Empresa.COM"] }];

		expect(await canSignUpByDomain("  ANA@empresa.com ")).toBe(true);
	});

	it("false para un subdominio", async () => {
		expect(await canSignUpByDomain("ana@ventas.empresa.com")).toBe(false);
	});

	it("false para un dominio que no está abierto", async () => {
		expect(await canSignUpByDomain("ana@otra.com")).toBe(false);
	});

	it("false para algo que no es un correo, sin consultar", async () => {
		for (const value of ["", "ana", "@empresa.com", "a@b@empresa.com", "ana@empresa.com\n"]) {
			expect(await canSignUpByDomain(value)).toBe(false);
		}
		expect(state.filters).toEqual([]);
	});

	it("false si el valor no es un string", async () => {
		expect(await canSignUpByDomain(undefined as unknown as string)).toBe(false);
	});

	it("false si la consulta devuelve error o lanza", async () => {
		state.error = { message: "falló" };
		expect(await canSignUpByDomain("ana@empresa.com")).toBe(false);

		state.error = null;
		state.throws = true;
		expect(await canSignUpByDomain("ana@empresa.com")).toBe(false);
	});
});
```

Agregar a `tests/tenants/public.test.ts`:
- (sin `domainsPhrase` acá: tiene su propio archivo)
- En el test `arma marca, métodos y URL del logo`: la fila gana `self_signup_by_domain: false, allowed_domains: ["acme.com"]` y el objeto esperado gana `openDomains: []`.
- Dos tests nuevos dentro del `describe`:

```ts
	it("con el ingreso abierto expone los dominios", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: {},
			auth_methods: ["email"],
			self_signup_by_domain: true,
			allowed_domains: ["acme.com", "acme.com.ar"],
		});

		expect((await loadPublicTenant("acme", fake.client))?.openDomains).toEqual([
			"acme.com",
			"acme.com.ar",
		]);
	});

	it("con el ingreso cerrado no expone los dominios", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: {},
			auth_methods: ["email"],
			self_signup_by_domain: false,
			allowed_domains: ["acme.com"],
		});

		expect((await loadPublicTenant("acme", fake.client))?.openDomains).toEqual(
			[],
		);
	});
```
Crear `tests/tenants/domains-phrase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { domainsPhrase } from "@/lib/tenants/domains-phrase";

describe("domainsPhrase", () => {
	it("arma la frase según la cantidad", () => {
		expect(domainsPhrase(["a.com"])).toBe("@a.com");
		expect(domainsPhrase(["a.com", "b.com"])).toBe("@a.com o @b.com");
		expect(domainsPhrase(["a.com", "b.com", "c.com"])).toBe(
			"@a.com, @b.com o @c.com",
		);
	});

	it("con la lista vacía devuelve vacío", () => {
		expect(domainsPhrase([])).toBe("");
	});
});
```

Agregar a `tests/auth/login-form.test.ts` un mock de la action al principio (junto al de `browser`):

```ts
vi.mock("@/app/(auth)/login/actions", () => ({
	canSignUpByDomain: async () => false,
}));
```

Crear `tests/auth/tenant-login-page.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { tenant: unknown } = { tenant: null };

vi.mock("@/lib/tenants/public", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tenants/public")>()),
	loadPublicTenant: async () => state.tenant,
}));
vi.mock("@/app/(auth)/login/login-form", () => ({
	LoginForm: () => null,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: TenantLoginPage } = await import(
	"@/app/(auth)/login/[tenant]/page"
);

const tenant = (openDomains: string[]) => ({
	slug: "acme",
	displayName: "Acme",
	brand: {},
	authMethods: ["email"],
	logoUrl: null,
	openDomains,
});

const render = async () =>
	renderToStaticMarkup(
		createElement(await TenantLoginPage({ params: Promise.resolve({ tenant: "acme" }) })),
	);

describe("landing de la empresa", () => {
	beforeEach(() => {
		state.tenant = tenant([]);
	});

	it("cerrada, pide la cuenta con la que invitaron", async () => {
		expect(await render()).toContain(
			"Entrá con la cuenta con la que te invitaron a Acme.",
		);
	});

	it("abierta, pide el correo del dominio y deja la salida para invitados de afuera", async () => {
		state.tenant = tenant(["acme.com", "acme.com.ar"]);

		const html = await render();

		expect(html).toContain("Entrá con tu correo de @acme.com o @acme.com.ar.");
		expect(html).toContain("Si te invitaron con otro correo, usá ese.");
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npx vitest run tests/auth tests/tenants/public.test.ts`
Expected: FAIL (action, `openDomains` y `domainsPhrase` inexistentes).

- [ ] **Step 3: Implementar**

Crear `app/(auth)/login/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { emailDomain } from "@/lib/invitations/domain";
import { createAdminClient } from "@/lib/supabase/admin";

const emailSchema = z.email().max(254);

/**
 * ¿Puede este mail crear cuenta al pedir el link? Solo si su dominio está
 * abierto en alguna empresa activa (spec ingreso por dominio, D9). La
 * pantalla nunca muestra el resultado: el mensaje es el mismo siempre.
 * Cualquier error responde false, que es el comportamiento de antes.
 */
export async function canSignUpByDomain(email: string): Promise<boolean> {
	if (typeof email !== "string") return false;
	const parsed = emailSchema.safeParse(email.trim());
	if (!parsed.success) return false;
	const domain = emailDomain(parsed.data);
	if (!domain) return false;

	try {
		const { data, error } = await createAdminClient()
			.from("tenants")
			.select("allowed_domains")
			.eq("active", true)
			.eq("self_signup_by_domain", true);
		if (error) return false;

		return (data ?? []).some((row) =>
			(row.allowed_domains as string[]).some(
				(allowed) => allowed.trim().toLowerCase() === domain,
			),
		);
	} catch {
		return false;
	}
}
```

En `app/(auth)/login/login-form.tsx`: importar `import { canSignUpByDomain } from "./actions";` y reemplazar el bloque de `signInWithOtp` por:

```ts
		// Solo un mail de un dominio abierto en alguna empresa puede crear
		// cuenta al pedir el link. Un invitado real ya tiene su fila; a
		// cualquier otro mail no se le crea una ni se le manda nada.
		const shouldCreateUser = await canSignUpByDomain(email).catch(
			() => false,
		);
		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: {
				emailRedirectTo: callbackUrl(next),
				shouldCreateUser,
			},
		});
```

En `lib/tenants/public.ts`:
- `PublicTenant` suma `openDomains: string[];`.
- El `select` pasa a `"slug, display_name, brand, auth_methods, self_signup_by_domain, allowed_domains"`.
- El objeto devuelto suma `openDomains: data.self_signup_by_domain ? (data.allowed_domains as string[]) : [],`.

Crear `lib/tenants/domains-phrase.ts`:

```ts
/** "@a.com", "@a.com o @b.com", "@a.com, @b.com o @c.com". */
export function domainsPhrase(domains: string[]): string {
	const tagged = domains.map((domain) => `@${domain}`);
	if (tagged.length <= 1) return tagged.join("");
	return `${tagged.slice(0, -1).join(", ")} o ${tagged[tagged.length - 1]}`;
}
```

En `app/(auth)/login/[tenant]/page.tsx`: importar `domainsPhrase` desde `@/lib/tenants/domains-phrase` y reemplazar el `<p className="text-muted-foreground">...</p>` por:

```tsx
					<p className="text-muted-foreground">
						{tenant.openDomains.length > 0
							? `Entrá con tu correo de ${domainsPhrase(tenant.openDomains)}. Si te invitaron con otro correo, usá ese.`
							: `Entrá con la cuenta con la que te invitaron a ${tenant.displayName}.`}
					</p>
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npx vitest run tests/auth tests/tenants && npm run typecheck --silent`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Formatear y commit**

```bash
export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH
npx biome check --write lib/tenants/domains-phrase.ts tests/tenants/domains-phrase.test.ts "app/(auth)/login/actions.ts" tests/auth/can-sign-up-by-domain.test.ts "app/(auth)/login/login-form.tsx" tests/auth/login-form.test.ts lib/tenants/public.ts tests/tenants/public.test.ts "app/(auth)/login/[tenant]/page.tsx" tests/auth/tenant-login-page.test.ts
git add lib/tenants/domains-phrase.ts tests/tenants/domains-phrase.test.ts "app/(auth)/login/actions.ts" tests/auth/can-sign-up-by-domain.test.ts "app/(auth)/login/login-form.tsx" tests/auth/login-form.test.ts lib/tenants/public.ts tests/tenants/public.test.ts "app/(auth)/login/[tenant]/page.tsx" tests/auth/tenant-login-page.test.ts
git commit -m "feat: el mail de un dominio abierto puede crear cuenta y la landing lo dice

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sección "Ingreso" en la configuración de la empresa

**Files:**
- Modify: `app/[tenant]/settings/actions.ts`
- Create: `tests/settings/signup-mode.test.ts`
- Create: `app/[tenant]/settings/ingreso-form.tsx`
- Create: `tests/settings/ingreso-form.test.ts`
- Modify: `app/[tenant]/settings/page.tsx`

**Interfaces:**
- Consumes: `isPublicEmailDomain` (Task 2).
- Produces: `updateSignupMode(tenantId: string, open: boolean, slug: string): Promise<SettingsResult>`; componente `IngresoForm({ tenantId, slug, open, domains })`.

- [ ] **Step 1: Escribir las pruebas**

Crear `tests/settings/signup-mode.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	current: { allowed_domains: string[] } | null;
	updates: unknown[];
	updateResult: { data: unknown; error: unknown };
} = { current: null, updates: [], updateResult: { data: null, error: null } };

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from() {
			return {
				select: () => ({
					eq: () => ({ maybeSingle: async () => ({ data: state.current }) }),
				}),
				update(values: unknown) {
					state.updates.push(values);
					return {
						eq: () => ({
							select: () => ({ maybeSingle: async () => state.updateResult }),
						}),
					};
				},
			};
		},
	}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateSignupMode } = await import("@/app/[tenant]/settings/actions");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("updateSignupMode", () => {
	beforeEach(() => {
		state.current = { allowed_domains: ["empresa.com"] };
		state.updates = [];
		state.updateResult = { data: { id: TENANT_ID }, error: null };
	});

	it("rechaza argumentos inválidos sin tocar la base", async () => {
		expect((await updateSignupMode("no-es-uuid", true, "acme")).ok).toBe(false);
		expect((await updateSignupMode(TENANT_ID, "si" as unknown as boolean, "acme")).ok).toBe(false);
		expect((await updateSignupMode(TENANT_ID, true, "Acme!")).ok).toBe(false);
		expect(state.updates).toHaveLength(0);
	});

	it("abre el ingreso cuando hay dominios propios", async () => {
		const result = await updateSignupMode(TENANT_ID, true, "acme");

		expect(result).toEqual({ ok: true });
		expect(state.updates).toEqual([{ self_signup_by_domain: true }]);
	});

	it("rechaza abrirlo sin dominios cargados", async () => {
		state.current = { allowed_domains: [] };

		const result = await updateSignupMode(TENANT_ID, true, "acme");

		expect(result.ok).toBe(false);
		expect(state.updates).toHaveLength(0);
	});

	it("rechaza abrirlo si hay un dominio público cargado", async () => {
		state.current = { allowed_domains: ["empresa.com", "Gmail.com"] };

		const result = await updateSignupMode(TENANT_ID, true, "acme");

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain("Gmail.com");
		expect(state.updates).toHaveLength(0);
	});

	it("cerrarlo no mira los dominios", async () => {
		state.current = { allowed_domains: [] };

		const result = await updateSignupMode(TENANT_ID, false, "acme");

		expect(result).toEqual({ ok: true });
		expect(state.updates).toEqual([{ self_signup_by_domain: false }]);
	});

	it("sin permiso (la RLS filtró todo) devuelve el mensaje de permiso", async () => {
		state.current = null;

		const result = await updateSignupMode(TENANT_ID, true, "acme");

		expect(result.ok).toBe(false);
		expect(state.updates).toHaveLength(0);
	});

	it("un update que no devuelve fila es falta de permiso", async () => {
		state.updateResult = { data: null, error: null };

		const result = await updateSignupMode(TENANT_ID, false, "acme");

		expect(result.ok).toBe(false);
	});

	it("un error de la base no se pasa como éxito", async () => {
		state.updateResult = { data: null, error: { message: "falló" } };

		const result = await updateSignupMode(TENANT_ID, false, "acme");

		expect(result.ok).toBe(false);
	});
});
```

Crear `tests/settings/ingreso-form.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/[tenant]/settings/actions", () => ({
	updateSignupMode: async () => ({ ok: true }),
}));

const { IngresoForm } = await import("@/app/[tenant]/settings/ingreso-form");

const render = (props: { open: boolean; domains: string[] }) =>
	renderToStaticMarkup(
		createElement(IngresoForm, {
			tenantId: "11111111-1111-4111-8111-111111111111",
			slug: "acme",
			...props,
		}),
	);

describe("IngresoForm", () => {
	it("sin dominios deshabilita la opción abierta y explica por qué", () => {
		const html = render({ open: false, domains: [] });

		expect(html).toContain("Solo por invitación");
		expect(html).toContain("Todos los del dominio");
		expect(html).toContain("disabled");
		expect(html).toContain("hola@innov.as");
	});

	it("con dominios muestra cuáles son, en solo lectura", () => {
		const html = render({ open: false, domains: ["acme.com", "acme.com.ar"] });

		expect(html).toContain("@acme.com o @acme.com.ar");
		expect(html).not.toContain("<textarea");
	});

	it("abierto avisa que sacar a alguien de Usuarios no lo bloquea", () => {
		const html = render({ open: true, domains: ["acme.com"] });

		expect(html).toContain("no le impide volver a entrar");
	});

	it("cerrado no muestra ese aviso", () => {
		expect(render({ open: false, domains: ["acme.com"] })).not.toContain(
			"no le impide volver a entrar",
		);
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npx vitest run tests/settings`
Expected: FAIL (`updateSignupMode` e `IngresoForm` inexistentes).

- [ ] **Step 3: Implementar**

En `app/[tenant]/settings/actions.ts`: importar `import { isPublicEmailDomain } from "@/lib/tenants/public-email-domains";` y agregar al final:

```ts
/**
 * Abre o cierra el ingreso por dominio. Los dominios los carga plataforma;
 * acá solo se elige el modo. Abrirlo exige dominios propios (nada vacío ni de
 * correo público: el candado de la base ya impide lo primero, esto da el
 * mensaje). La RLS y el trigger tenants_guard_columns dejan escribir a un
 * tenant_admin solo default_model y self_signup_by_domain.
 */
export async function updateSignupMode(
	tenantId: string,
	open: boolean,
	slug: string,
): Promise<SettingsResult> {
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	if (typeof open !== "boolean") return INVALIDO;
	if (!slugSchema.safeParse(slug).success) return INVALIDO;

	const sinPermiso: SettingsResult = {
		ok: false,
		message: "No tenés permiso para cambiar el ingreso.",
	};
	const supabase = await createServerSupabase();

	if (open) {
		const { data: current } = await supabase
			.from("tenants")
			.select("allowed_domains")
			.eq("id", tenantId)
			.maybeSingle();
		if (!current) return sinPermiso;

		const domains = current.allowed_domains as string[];
		if (domains.length === 0)
			return {
				ok: false,
				message:
					"Este cliente no tiene dominios cargados. Escribinos a hola@innov.as para que los carguemos.",
			};
		const publico = domains.find(isPublicEmailDomain);
		if (publico)
			return {
				ok: false,
				message: `"${publico}" es un correo público: no puede abrir el ingreso. Escribinos a hola@innov.as.`,
			};
	}

	const { data, error } = await supabase
		.from("tenants")
		.update({ self_signup_by_domain: open })
		.eq("id", tenantId)
		.select("id")
		.maybeSingle();

	if (error) return { ok: false, message: "No se pudo guardar el ingreso." };
	if (!data) return sinPermiso;

	revalidatePath(`/${slug}/settings`);
	return { ok: true };
}
```

Crear `app/[tenant]/settings/ingreso-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { domainsPhrase } from "@/lib/tenants/domains-phrase";
import { updateSignupMode } from "./actions";

export function IngresoForm({
	tenantId,
	slug,
	open,
	domains,
}: {
	tenantId: string;
	slug: string;
	open: boolean;
	domains: string[];
}) {
	const [value, setValue] = useState(open);
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const sinDominios = domains.length === 0;

	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				startTransition(async () => {
					const result = await updateSignupMode(tenantId, value, slug);
					setMessage(result.ok ? null : result.message);
				});
			}}
		>
			<label className="flex min-h-11 items-start gap-2 text-sm">
				<input
					type="radio"
					name="ingreso"
					className="mt-1"
					checked={!value}
					disabled={isPending}
					onChange={() => setValue(false)}
				/>
				<span>
					<strong>Solo por invitación.</strong> Entra únicamente quien recibió
					una invitación.
				</span>
			</label>
			<label className="flex min-h-11 items-start gap-2 text-sm">
				<input
					type="radio"
					name="ingreso"
					className="mt-1"
					checked={value}
					disabled={isPending || sinDominios}
					onChange={() => setValue(true)}
				/>
				<span>
					<strong>Todos los del dominio.</strong>{" "}
					{sinDominios
						? "Entra sin invitación quien tenga un correo de los dominios de la empresa."
						: `Cualquiera con un correo de ${domainsPhrase(domains)} entra sin invitación, como miembro.`}
				</span>
			</label>

			<p className="text-muted-foreground text-sm">
				{sinDominios
					? "Todavía no hay dominios cargados. Escribinos a hola@innov.as para que los carguemos."
					: "Los dominios los carga INNOV.AS. Escribinos a hola@innov.as para cambiarlos."}
			</p>
			{value ? (
				<p className="text-muted-foreground text-sm">
					Sacar a alguien de Usuarios no le impide volver a entrar mientras este
					modo siga activo.
				</p>
			) : null}

			<Button type="submit" size="lg" disabled={isPending || value === open}>
				Guardar
			</Button>
			{message ? <p className="text-destructive text-sm">{message}</p> : null}
		</form>
	);
}
```

Atención: el test espera la frase `no le impide volver a entrar` completa en una sola cadena de texto en el HTML. Como JSX parte el texto en un salto de línea, escribir ese párrafo como una sola expresión de string, por ejemplo `{"Sacar a alguien de Usuarios no le impide volver a entrar mientras este modo siga activo."}`, para que `renderToStaticMarkup` no inserte comentarios entre nodos.

En `app/[tenant]/settings/page.tsx`: importar `IngresoForm` desde `./ingreso-form`; agregar al `Promise.all` una tercera consulta `supabase.from("tenants").select("allowed_domains, self_signup_by_domain").eq("id", tenant.id).maybeSingle()` (resultado `signupResult`); y después de la `<section>` del modelo agregar:

```tsx
			<section>
				<h2 className="mb-3 text-lg">Ingreso</h2>
				<IngresoForm
					tenantId={tenant.id}
					slug={slug}
					open={signupResult.data?.self_signup_by_domain ?? false}
					domains={(signupResult.data?.allowed_domains as string[] | undefined) ?? []}
				/>
			</section>
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH && npx vitest run tests/settings && npm run typecheck --silent`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Formatear y commit**

```bash
export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH
npx biome check --write "app/[tenant]/settings/actions.ts" "app/[tenant]/settings/ingreso-form.tsx" "app/[tenant]/settings/page.tsx" tests/settings/signup-mode.test.ts tests/settings/ingreso-form.test.ts
git add "app/[tenant]/settings/actions.ts" "app/[tenant]/settings/ingreso-form.tsx" "app/[tenant]/settings/page.tsx" tests/settings/signup-mode.test.ts tests/settings/ingreso-form.test.ts
git commit -m "feat: el admin de la empresa elige el modo de ingreso en settings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentación y verificación de cierre

**Files:**
- Modify: `lib/invitations/domain.ts` (solo el comentario de cabecera)
- Modify: `docs/01-roadmap-etapas.md`

- [ ] **Step 1: Actualizar el comentario de `isAllowedDomain`**

Reemplazar el comentario JSDoc de `isAllowedDomain` por:

```ts
/**
 * `allowed_domains` valida al invitar. Con `self_signup_by_domain` en true
 * además es puerta de entrada (join_tenants_by_domain); cerrado, no lo es.
 * Quien deja el cliente pierde acceso cuando se le saca la membership, no
 * cuando le cierran el mail. Lista vacía significa sin restricción.
 */
```

- [ ] **Step 2: Enmienda en el roadmap**

En `docs/01-roadmap-etapas.md`, debajo de la línea `- [x] **Enmienda 2026-09-12 (D4):** ...`, agregar:

```
- [x] **Enmienda 2026-10-09 (ingreso por dominio):** D4 sigue siendo el modo por defecto. Cada empresa puede abrir el ingreso a quien tenga un correo verificado de sus `allowed_domains` (`self_signup_by_domain`): el admin de la empresa elige el modo en settings, plataforma carga los dominios, el alta es `join_tenants_by_domain()` y deja `membership.joined_by_domain`. Spec: `docs/superpowers/specs/2026-10-09-ingreso-por-dominio-design.md`.
```

- [ ] **Step 3: Verificación completa**

Run:
```bash
export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH
npm run db:reset 2>&1 | tail -1 && npm run db:test 2>&1 | tail -3
npm run typecheck --silent && npm test 2>&1 | tail -6
npx biome check lib app tests 2>&1 | tail -5
```
Expected: pgTAP `All tests successful`, typecheck sin salida, vitest sin fallas. `biome check` puede señalar los 4 archivos ajenos que ya señala en `main`: no tocarlos; cualquier otro hallazgo en archivos de esta rama se corrige.

- [ ] **Step 4: Commit**

```bash
git add lib/invitations/domain.ts docs/01-roadmap-etapas.md
git commit -m "docs: enmienda del roadmap por el ingreso por dominio

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
