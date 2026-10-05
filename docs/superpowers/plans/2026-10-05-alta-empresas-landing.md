# Alta de empresas y landing por empresa — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un platform_admin cree una empresa desde `/plataforma/nueva` con marca, métodos de login y primer admin, y que `/login/<slug>` muestre una landing propia con solo los métodos permitidos.

**Architecture:** Una columna `tenants.auth_methods` y una función SQL `create_tenant` que crea tenant y agente juntos. La lógica de invitar sale de la ruta API a `lib/invitations/invite.ts` para que la comparta la action de alta. El formulario de login se vuelve un componente compartido entre `/login` y la landing `/login/[tenant]`, que es pública y lee solo datos de marca con el cliente admin.

**Tech Stack:** Next.js App Router, Supabase (`@supabase/ssr`, service role para lecturas públicas), zod 4, vitest, pgTAP, Tailwind + shadcn.

**Spec:** `docs/superpowers/specs/2026-10-05-alta-empresas-landing-design.md`

## Global Constraints

- Rama `feat/alta-empresas-landing` desde `main` (ya creada). Identidad git `innovasbuild` / `matias@innov.as`.
- Español rioplatense en UI y mensajes. Código e identificadores en inglés.
- Nada específico de un tenant en código.
- Métodos de login válidos en esta etapa: exactamente `email` y `google`.
- La landing es la única ruta donde un slug válido se confirma (spec A4). El resto sigue con 404.
- Antes de tocar SQL: cargar la skill `supabase-postgres-best-practices`.
- `npm run lint:fix` reformatea 4 archivos ajenos: revertirlos con `git checkout -- <archivo>` antes de commitear.
- Después de cada tarea: `npm run typecheck` y `npm test`.
- No aplicar migraciones en producción ni abrir PR sin confirmación de Matías.

## Review Focus

1. **Slug con mayúsculas o espacios** (`Acme SA`): se rechaza con el mensaje del campo antes de llegar a la base. Test en Task 4.
2. **Correo del primer admin con dominio externo sin el tilde**: la empresa NO se crea (la validación es previa al `create_tenant`), para que no quede una empresa sin admin por un error de tipeo. Test en Task 4 y Task 5.
3. **Landing de una empresa con `auth_methods = {email}`**: no aparece el botón de Google, ni el separador "o". Test en Task 3.
4. **Fallo de la invitación después de crear la empresa**: la action devuelve `ok: true` con la advertencia y el detalle la muestra; no devuelve error, porque la empresa ya existe. Test en Task 5.
5. **Ruta `/api/invitations` después del refactor**: mismos códigos HTTP (401, 400, 403, 404, 422, 409, 502, 201) que hoy. Test en Task 2.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261006120000_tenant_auth_methods_create_tenant.sql` | Columna `auth_methods` y función `create_tenant` |
| `supabase/tests/20_auth_methods_create_tenant.test.sql` | pgTAP de ambas |
| `lib/supabase/database.types.ts` | Regenerado (`db:types`) |
| `lib/invitations/invite.ts` | `inviteToTenant`: lógica compartida de invitar |
| `app/api/invitations/route.ts` | Pasa a usar `inviteToTenant`, mismo contrato |
| `lib/tenants/auth-methods.ts` | Tipo `AuthMethod`, lista y rótulos |
| `lib/tenants/public.ts` | `loadPublicTenant(slug)`: datos públicos de la landing |
| `app/(auth)/login/login-form.tsx` | `LoginForm` compartido (client) |
| `app/(auth)/login/page.tsx` | Usa `LoginForm` |
| `app/(auth)/login/[tenant]/page.tsx` | Landing por empresa |
| `lib/tenants/tenant-create.ts` | `readCreateForm`, `createTenantSchema` |
| `app/plataforma/nueva/actions.ts` | `createTenant` |
| `app/plataforma/nueva/page.tsx` + `create-form.tsx` | Pantalla y formulario de alta |
| `app/plataforma/page.tsx` | Botón "Nueva empresa" |
| `app/plataforma/[slug]/page.tsx`, `tenant-form.tsx`, `actions.ts` | Métodos de login, link a la landing, advertencias del alta |
| `lib/tenants/tenant-form.ts` | `authMethods` en el schema de edición |

---

### Task 1: `auth_methods` y `create_tenant`

**Files:**
- Create: `supabase/migrations/20261006120000_tenant_auth_methods_create_tenant.sql`
- Create: `supabase/tests/20_auth_methods_create_tenant.test.sql`
- Modify: `lib/supabase/database.types.ts` (regenerado)

**Interfaces:**
- Produces: columna `tenants.auth_methods text[]`; `public.create_tenant(p_slug text, p_display_name text, p_allowed_domains text[], p_auth_methods text[], p_brand jsonb) returns uuid`.

- [ ] **Step 1: Cargar la skill `supabase-postgres-best-practices`** y verificar Docker (`npm run db:start`).

- [ ] **Step 2: Escribir el test que falla** en `supabase/tests/20_auth_methods_create_tenant.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'admin@innov.as', now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'innovas', 'INNOV.AS'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'platform_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin');

select is(
  (select auth_methods from public.tenants where slug = 'innovas'),
  array['email', 'google'],
  'una fila existente queda con los dos métodos por defecto'
);

select throws_ok(
  $$update public.tenants set auth_methods = '{}' where slug = 'innovas'$$,
  '23514', null, 'auth_methods no puede quedar vacío'
);

select throws_ok(
  $$update public.tenants set auth_methods = '{email,microsoft}' where slug = 'innovas'$$,
  '23514', null, 'auth_methods rechaza un método desconocido'
);

-- platform_admin crea una empresa y su agente en una sola llamada.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select public.create_tenant('acme', 'Acme', '{acme.test}', '{email}', '{"primary":"#112233"}'::jsonb)$$,
  'platform_admin crea una empresa'
);

select is(
  (select count(*)::int from public.tenant_agents ta
     join public.tenants t on t.id = ta.tenant_id
   where t.slug = 'acme' and ta.agent = 'outreach' and ta.enabled),
  1,
  'la empresa nueva nace con el agente outreach activo'
);

select is(
  (select auth_methods from public.tenants where slug = 'acme'),
  array['email'],
  'la empresa nueva guarda los métodos elegidos'
);

select throws_ok(
  $$select public.create_tenant('acme', 'Acme 2', '{}', '{email}', '{}'::jsonb)$$,
  '23505', null, 'un slug repetido falla con unique_violation'
);

-- tenant_admin no puede crear empresas: lo frena la RLS de tenants.
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select throws_ok(
  $$select public.create_tenant('otra', 'Otra', '{}', '{email}', '{}'::jsonb)$$,
  '42501', null, 'tenant_admin no puede crear una empresa'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npm run db:test`
Expected: FAIL en `20_auth_methods_create_tenant` (columna `auth_methods` inexistente).

- [ ] **Step 4: Escribir la migración**

```sql
-- Spec alta de empresas §3: métodos de login permitidos por empresa y alta
-- atómica de tenant + agente.

alter table public.tenants
  add column auth_methods text[] not null default '{email,google}'
  constraint tenants_auth_methods_valid check (
    cardinality(auth_methods) >= 1
    and auth_methods <@ array['email', 'google']
  );

-- security invoker a propósito: la RLS de tenants y tenant_agents decide quién
-- puede crear. Sin la fila de tenant_agents el canal rechaza todo, por eso las
-- dos inserciones van juntas.
create or replace function public.create_tenant(
  p_slug text,
  p_display_name text,
  p_allowed_domains text[],
  p_auth_methods text[],
  p_brand jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.tenants (slug, display_name, allowed_domains, auth_methods, brand)
  values (p_slug, p_display_name, coalesce(p_allowed_domains, '{}'), p_auth_methods, coalesce(p_brand, '{}'::jsonb))
  returning id into v_id;

  insert into public.tenant_agents (tenant_id, agent, config)
  values (v_id, 'outreach', '{"brain": "read_write"}'::jsonb);

  return v_id;
end;
$$;

revoke execute on function public.create_tenant(text, text, text[], text[], jsonb) from public;
grant execute on function public.create_tenant(text, text, text[], text[], jsonb) to authenticated;
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run db:test`
Expected: PASS, 26 archivos. Si el test de `42501` falla con otro SQLSTATE, leer el error real: la RLS de `tenants_insert` tiene que devolver `insufficient_privilege`.

- [ ] **Step 6: Regenerar tipos y verificar**

Run: `npm run db:types && npm run typecheck && npm test`
Expected: `database.types.ts` incluye `auth_methods` y `create_tenant`; typecheck y tests en verde.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261006120000_tenant_auth_methods_create_tenant.sql supabase/tests/20_auth_methods_create_tenant.test.sql lib/supabase/database.types.ts
git commit -m "feat: métodos de login por empresa y create_tenant"
```

---

### Task 2: `inviteToTenant` compartido

**Files:**
- Create: `lib/invitations/invite.ts`
- Modify: `app/api/invitations/route.ts`
- Test: `tests/invitations/invite.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type InviteOutcome =
    | { kind: "ok" }
    | { kind: "ya_existe" }          // el usuario ya estaba en Auth; invitación pendiente creada
    | { kind: "dominio_no_permitido"; allowedDomains: string[] }
    | { kind: "duplicada" }
    | { kind: "mail_fallo" }
    | { kind: "tenant_inexistente" };
  inviteToTenant(params: {
    admin: SupabaseClient; tenantId: string; email: string;
    role: "tenant_admin" | "tenant_member"; invitedBy: string;
    allowExternal: boolean; origin: string; next?: string;
  }): Promise<InviteOutcome>
  ```

- [ ] **Step 1: Escribir el test que falla** en `tests/invitations/invite.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { inviteToTenant } from "@/lib/invitations/invite";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const state: {
	tenant: { slug: string; allowed_domains: string[] } | null;
	insertError: unknown;
	inviteError: { code?: string; message: string } | null;
	inserts: { table: string; values: Record<string, unknown> }[];
	invites: { email: string; redirectTo?: string }[];
} = {
	tenant: null,
	insertError: null,
	inviteError: null,
	inserts: [],
	invites: [],
};

const admin = {
	from: (table: string) => ({
		select: () => ({
			eq: () => ({ single: async () => ({ data: state.tenant }) }),
		}),
		insert: async (values: Record<string, unknown>) => {
			state.inserts.push({ table, values });
			return { error: table === "invitations" ? state.insertError : null };
		},
	}),
	auth: {
		admin: {
			inviteUserByEmail: async (
				email: string,
				options: { redirectTo?: string },
			) => {
				state.invites.push({ email, redirectTo: options.redirectTo });
				return { error: state.inviteError };
			},
		},
	},
};

const base = {
	// biome-ignore lint/suspicious/noExplicitAny: doble de prueba del cliente admin
	admin: admin as any,
	tenantId: TENANT_ID,
	email: "Ana@Acme.test",
	role: "tenant_admin" as const,
	invitedBy: "u1",
	allowExternal: false,
	origin: "https://app.test",
};

describe("inviteToTenant", () => {
	beforeEach(() => {
		state.tenant = { slug: "acme", allowed_domains: ["acme.test"] };
		state.insertError = null;
		state.inviteError = null;
		state.inserts = [];
		state.invites = [];
	});

	it("invita y manda el mail con el callback del origen", async () => {
		const result = await inviteToTenant(base);

		expect(result).toEqual({ kind: "ok" });
		expect(state.inserts[0]).toEqual({
			table: "invitations",
			values: {
				tenant_id: TENANT_ID,
				email: "ana@acme.test",
				role: "tenant_admin",
				invited_by: "u1",
			},
		});
		expect(state.invites[0]).toEqual({
			email: "ana@acme.test",
			redirectTo: "https://app.test/auth/callback",
		});
	});

	it("suma next al callback cuando viene", async () => {
		await inviteToTenant({ ...base, next: "/acme/chat" });

		expect(state.invites[0]?.redirectTo).toBe(
			"https://app.test/auth/callback?next=%2Facme%2Fchat",
		);
	});

	it("rechaza un dominio externo sin permiso, sin escribir nada", async () => {
		const result = await inviteToTenant({ ...base, email: "ana@gmail.com" });

		expect(result).toEqual({
			kind: "dominio_no_permitido",
			allowedDomains: ["acme.test"],
		});
		expect(state.inserts).toHaveLength(0);
	});

	it("con permiso externo invita y deja el evento de auditoría", async () => {
		const result = await inviteToTenant({
			...base,
			email: "ana@gmail.com",
			allowExternal: true,
		});

		expect(result).toEqual({ kind: "ok" });
		expect(state.inserts.map((i) => i.table)).toEqual(["invitations", "events"]);
		expect(state.inserts[1]?.values).toMatchObject({
			tenant_id: TENANT_ID,
			type: "invitation.external",
		});
	});

	it("contesta duplicada si ya hay una invitación pendiente", async () => {
		state.insertError = { code: "23505" };

		expect(await inviteToTenant(base)).toEqual({ kind: "duplicada" });
		expect(state.invites).toHaveLength(0);
	});

	it("contesta ya_existe si el usuario ya estaba en Auth", async () => {
		state.inviteError = { code: "email_exists", message: "existe" };

		expect(await inviteToTenant(base)).toEqual({ kind: "ya_existe" });
	});

	it("contesta mail_fallo ante otro error del envío", async () => {
		state.inviteError = { message: "smtp caído" };

		expect(await inviteToTenant(base)).toEqual({ kind: "mail_fallo" });
	});

	it("contesta tenant_inexistente sin tenant", async () => {
		state.tenant = null;

		expect(await inviteToTenant(base)).toEqual({ kind: "tenant_inexistente" });
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/invitations/invite.test.ts`
Expected: FAIL, no existe `@/lib/invitations/invite`.

- [ ] **Step 3: Implementar `lib/invitations/invite.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAllowedDomain } from "@/lib/invitations/domain";

export type InviteRole = "tenant_admin" | "tenant_member";

export type InviteOutcome =
	| { kind: "ok" }
	| { kind: "ya_existe" }
	| { kind: "dominio_no_permitido"; allowedDomains: string[] }
	| { kind: "duplicada" }
	| { kind: "mail_fallo" }
	| { kind: "tenant_inexistente" };

/**
 * Invita a un correo a un tenant. Corre con el cliente admin: quien llama ya
 * verificó que puede invitar (RLS en la ruta, requirePlatformAdmin en la
 * consola). La fila de `invitations` se convierte en membership cuando el
 * usuario entra con ese mail (accept_pending_invitations).
 */
export async function inviteToTenant(params: {
	admin: SupabaseClient;
	tenantId: string;
	email: string;
	role: InviteRole;
	invitedBy: string;
	allowExternal: boolean;
	origin: string;
	next?: string;
}): Promise<InviteOutcome> {
	const email = params.email.trim().toLowerCase();

	const { data: tenant } = await params.admin
		.from("tenants")
		.select("slug, allowed_domains")
		.eq("id", params.tenantId)
		.single();
	if (!tenant) return { kind: "tenant_inexistente" };

	const external = !isAllowedDomain(email, tenant.allowed_domains);
	if (external && !params.allowExternal)
		return { kind: "dominio_no_permitido", allowedDomains: tenant.allowed_domains };

	const { error: insertError } = await params.admin.from("invitations").insert({
		tenant_id: params.tenantId,
		email,
		role: params.role,
		invited_by: params.invitedBy,
	});
	if (insertError) return { kind: "duplicada" };

	if (external) {
		// Se registra al crear la invitación, que es cuando se decidió permitir
		// el dominio externo, sin importar si el mail después sale o no.
		await params.admin.from("events").insert({
			tenant_id: params.tenantId,
			actor_user_id: params.invitedBy,
			type: "invitation.external",
			summary: `Invitación fuera de los dominios del cliente: ${email}`,
			payload: { email, role: params.role },
		});
	}

	const redirectTo = params.next
		? `${params.origin}/auth/callback?next=${encodeURIComponent(params.next)}`
		: `${params.origin}/auth/callback`;

	const { error: inviteError } = await params.admin.auth.admin.inviteUserByEmail(
		email,
		{ redirectTo },
	);
	if (!inviteError) return { kind: "ok" };

	const alreadyExists =
		inviteError.code === "email_exists" ||
		inviteError.code === "user_already_exists";
	if (alreadyExists) {
		// Ya está en Auth: no hace falta mail de alta, la invitación pendiente se
		// acepta la próxima vez que entre.
		console.warn("inviteUserByEmail:", inviteError.message);
		return { kind: "ya_existe" };
	}

	// Fallo real (rate limit, SMTP caído): la fila de invitations queda pendiente.
	console.error("inviteUserByEmail:", inviteError.message);
	return { kind: "mail_fallo" };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/invitations/invite.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Hacer que la ruta use el helper.** En `app/api/invitations/route.ts`, reemplazar desde `const admin = createAdminClient();` hasta el final del handler por:

```ts
	const outcome = await inviteToTenant({
		admin: createAdminClient(),
		tenantId,
		email,
		role,
		invitedBy: auth.user.id,
		allowExternal: allowExternal ?? false,
		origin: new URL(request.url).origin,
	});

	// Mismos códigos que antes del refactor: el InviteForm del tenant depende
	// del 422 con allowedDomains para ofrecer "permitir correo externo".
	switch (outcome.kind) {
		case "tenant_inexistente":
			return NextResponse.json({ error: "tenant inexistente" }, { status: 404 });
		case "dominio_no_permitido":
			return NextResponse.json(
				{ error: "dominio_no_permitido", allowedDomains: outcome.allowedDomains },
				{ status: 422 },
			);
		case "duplicada":
			return NextResponse.json(
				{ error: "ya hay una invitación pendiente" },
				{ status: 409 },
			);
		case "mail_fallo":
			return NextResponse.json(
				{ error: "no se pudo enviar el mail de invitación" },
				{ status: 502 },
			);
		case "ok":
		case "ya_existe":
			return NextResponse.json({ ok: true }, { status: 201 });
	}
```

Agregar `import { inviteToTenant } from "@/lib/invitations/invite";` y borrar el import de `isAllowedDomain`, que ya no se usa en la ruta.

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm test`
Expected: PASS. Revisar con `git diff app/api/invitations/route.ts` que los ocho códigos HTTP siguen presentes (401, 400, 403, 404, 422, 409, 502, 201).

- [ ] **Step 7: Commit**

```bash
git add lib/invitations/invite.ts app/api/invitations/route.ts tests/invitations/invite.test.ts
git commit -m "refactor: inviteToTenant compartido entre la ruta y la consola"
```

---

### Task 3: Landing por empresa y `LoginForm` compartido

**Files:**
- Create: `lib/tenants/auth-methods.ts`
- Create: `lib/tenants/public.ts`
- Create: `app/(auth)/login/login-form.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/login/[tenant]/page.tsx`
- Test: `tests/tenants/public.test.ts`, `tests/tenants/auth-methods.test.ts`

**Interfaces:**
- Produces:
  - `type AuthMethod = "email" | "google"`; `AUTH_METHODS: readonly AuthMethod[]`; `AUTH_METHOD_LABELS: Record<AuthMethod, string>`; `isAuthMethod(v: string): v is AuthMethod`.
  - `loadPublicTenant(slug: string, client?: SupabaseClient): Promise<PublicTenant | null>` con `PublicTenant = { slug; displayName; brand: TenantBrand; authMethods: AuthMethod[]; logoUrl: string | null }`.
  - `LoginForm({ methods, next, tenantName? })`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/tenants/auth-methods.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	AUTH_METHOD_LABELS,
	AUTH_METHODS,
	isAuthMethod,
} from "@/lib/tenants/auth-methods";

describe("auth methods", () => {
	it("la etapa 1 ofrece email y google, en ese orden", () => {
		expect(AUTH_METHODS).toEqual(["email", "google"]);
	});

	it("cada método tiene rótulo en castellano", () => {
		expect(AUTH_METHOD_LABELS.email).toBe("Link por correo");
		expect(AUTH_METHOD_LABELS.google).toBe("Google");
	});

	it("isAuthMethod rechaza un valor desconocido", () => {
		expect(isAuthMethod("microsoft")).toBe(false);
		expect(isAuthMethod("google")).toBe(true);
	});
});
```

`tests/tenants/public.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPublicTenant } from "@/lib/tenants/public";

function clientWith(row: unknown) {
	const filters: [string, unknown][] = [];
	const builder = {
		select: () => builder,
		eq(column: string, value: unknown) {
			filters.push([column, value]);
			return builder;
		},
		maybeSingle: async () => ({ data: row, error: null }),
	};
	// biome-ignore lint/suspicious/noExplicitAny: doble de prueba
	return { client: { from: () => builder } as any, filters };
}

describe("loadPublicTenant", () => {
	const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
	beforeEach(() => {
		process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
	});
	afterEach(() => {
		if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
		else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
	});

	it("filtra por slug y por activo", async () => {
		const fake = clientWith(null);

		await loadPublicTenant("acme", fake.client);

		expect(fake.filters).toEqual([
			["slug", "acme"],
			["active", true],
		]);
	});

	it("devuelve null si no hay fila", async () => {
		expect(await loadPublicTenant("nadie", clientWith(null).client)).toBeNull();
	});

	it("arma marca, métodos y URL del logo", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: { primary: "#112233", logo_url: "acme/logo-1.png" },
			auth_methods: ["email"],
		});

		expect(await loadPublicTenant("acme", fake.client)).toEqual({
			slug: "acme",
			displayName: "Acme",
			brand: { primary: "#112233", logoUrl: "acme/logo-1.png" },
			authMethods: ["email"],
			logoUrl: "https://sb.test/storage/v1/object/public/brand/acme/logo-1.png",
		});
	});

	it("descarta métodos desconocidos y cae a email si no queda ninguno", async () => {
		const fake = clientWith({
			slug: "acme",
			display_name: "Acme",
			brand: {},
			auth_methods: ["microsoft"],
		});

		expect((await loadPublicTenant("acme", fake.client))?.authMethods).toEqual([
			"email",
		]);
	});
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm test -- tests/tenants/auth-methods.test.ts tests/tenants/public.test.ts`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Implementar `lib/tenants/auth-methods.ts`**

```ts
// Métodos de login que una empresa puede ofrecer en su landing (spec alta A1).
// Sumar uno es: agregarlo acá, al check de tenants.auth_methods y un botón en
// LoginForm.
export const AUTH_METHODS = ["email", "google"] as const;

export type AuthMethod = (typeof AUTH_METHODS)[number];

export const AUTH_METHOD_LABELS: Record<AuthMethod, string> = {
	email: "Link por correo",
	google: "Google",
};

export function isAuthMethod(value: string): value is AuthMethod {
	return (AUTH_METHODS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Implementar `lib/tenants/public.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AuthMethod, isAuthMethod } from "@/lib/tenants/auth-methods";
import {
	brandFromRow,
	type TenantBrand,
	type TenantRow,
} from "@/lib/tenants/resolve";

export interface PublicTenant {
	slug: string;
	displayName: string;
	brand: TenantBrand;
	authMethods: AuthMethod[];
	logoUrl: string | null;
}

/**
 * Datos de la landing pública de una empresa. Sin sesión no hay RLS que
 * sirva: se lee con el cliente admin y se expone SOLO lo que la landing
 * muestra. Es la única ruta que confirma que un slug existe (spec alta A4).
 */
export async function loadPublicTenant(
	slug: string,
	client: SupabaseClient = createAdminClient(),
): Promise<PublicTenant | null> {
	const { data } = await client
		.from("tenants")
		.select("slug, display_name, brand, auth_methods")
		.eq("slug", slug)
		.eq("active", true)
		.maybeSingle();
	if (!data) return null;

	const brand = brandFromRow(data as TenantRow);
	const methods = (data.auth_methods as string[]).filter(isAuthMethod);

	return {
		slug: data.slug,
		displayName: data.display_name,
		brand,
		// El check de la base impide una lista vacía; esto cubre un valor que la
		// base acepte y este código todavía no conozca.
		authMethods: methods.length > 0 ? methods : ["email"],
		logoUrl: brand.logoUrl
			? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand/${brand.logoUrl}`
			: null,
	};
}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npm test -- tests/tenants/auth-methods.test.ts tests/tenants/public.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Extraer `LoginForm`** en `app/(auth)/login/login-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AuthMethod } from "@/lib/tenants/auth-methods";

const SCOPES = "openid email profile";

function callbackUrl(next: string | null): string {
	const base = `${window.location.origin}/auth/callback`;
	return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/**
 * Un solo formulario para /login y para la landing de cada empresa. La
 * landing pasa solo los métodos permitidos; un método que no viene no se
 * renderiza (spec alta A2: la restricción es de pantalla).
 */
export function LoginForm({
	methods,
	next,
}: {
	methods: AuthMethod[];
	next: string | null;
}) {
	const supabase = createBrowserSupabase();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);

	const showGoogle = methods.includes("google");
	const showEmail = methods.includes("email");

	async function entrarConGoogle() {
		await supabase.auth.signInWithOAuth({
			provider: "google",
			options: { scopes: SCOPES, redirectTo: callbackUrl(next) },
		});
	}

	async function entrarConMagicLink(event: React.FormEvent) {
		event.preventDefault();
		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: {
				emailRedirectTo: callbackUrl(next),
				// Sin esto, un mail nunca invitado crea igual una fila en auth.users
				// y recibe un link. Un invitado real ya tiene su fila.
				shouldCreateUser: false,
			},
		});
		// No distingue mail existente de inexistente: no confirmamos quién tiene cuenta.
		setSent(!error);
	}

	return (
		<div className="space-y-6 rounded-lg border bg-card p-6">
			{showGoogle ? (
				<Button
					className="w-full"
					onClick={entrarConGoogle}
					size="lg"
					type="button"
				>
					Entrar con Google
				</Button>
			) : null}

			{showGoogle && showEmail ? (
				<div className="flex items-center gap-3 text-muted-foreground text-xs">
					<span className="h-px flex-1 bg-border" />o
					<span className="h-px flex-1 bg-border" />
				</div>
			) : null}

			{showEmail ? (
				<form className="space-y-3" onSubmit={entrarConMagicLink}>
					<label className="block text-sm" htmlFor="email">
						Mail
					</label>
					<Input
						autoComplete="email"
						id="email"
						onChange={(event) => setEmail(event.target.value)}
						placeholder="tu@empresa.com"
						required
						type="email"
						value={email}
					/>
					<Button
						className="w-full"
						type="submit"
						variant={showGoogle ? "outline" : "default"}
					>
						Mandarme un link
					</Button>
				</form>
			) : null}

			{sent ? (
				<p className="text-muted-foreground text-sm" role="status">
					Si ese mail tiene acceso, te llega un link para entrar.
				</p>
			) : null}
		</div>
	);
}
```

- [ ] **Step 7: Reescribir `app/(auth)/login/page.tsx`** para que use el formulario. Pasa a ser un componente de servidor:

```tsx
// app/(auth)/login/page.tsx  → la ruta es /login: (auth) es route group y no aparece en la URL
import { AUTH_METHODS } from "@/lib/tenants/auth-methods";
import { LoginForm } from "./login-form";

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string }>;
}) {
	const { next } = await searchParams;

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-sm space-y-8">
				<div className="space-y-2 text-center">
					<h1 className="text-3xl leading-tight">INNOV.AS Agents</h1>
					<p className="text-muted-foreground">
						Entrá con la cuenta con la que te invitaron.
					</p>
				</div>
				<LoginForm methods={[...AUTH_METHODS]} next={next ?? null} />
			</div>
		</main>
	);
}
```

- [ ] **Step 8: Crear la landing `app/(auth)/login/[tenant]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { brandStyle } from "@/lib/brand/contrast";
import { loadPublicTenant } from "@/lib/tenants/public";
import { LoginForm } from "../login-form";

export default async function TenantLoginPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await loadPublicTenant(slug);
	// Inexistente o inactiva: 404. Una activa sí se muestra (spec alta A4).
	if (!tenant) notFound();

	return (
		<main
			style={brandStyle(tenant.brand)}
			className="flex min-h-screen items-center justify-center bg-background px-4 py-16"
		>
			<div className="w-full max-w-sm space-y-8">
				<div className="space-y-3 text-center">
					{tenant.logoUrl ? (
						// biome-ignore lint/performance/noImgElement: el logo es del cliente, sin loader
						<img
							src={tenant.logoUrl}
							alt={tenant.displayName}
							className="mx-auto h-auto max-h-12 w-auto max-w-[200px]"
						/>
					) : (
						<h1 className="text-3xl leading-tight">{tenant.displayName}</h1>
					)}
					<p className="text-muted-foreground">
						Entrá con la cuenta con la que te invitaron a {tenant.displayName}.
					</p>
				</div>
				<LoginForm methods={tenant.authMethods} next={`/${tenant.slug}/chat`} />
			</div>
		</main>
	);
}
```

- [ ] **Step 9: Verificar**

Run: `npm run typecheck && npm test`
Expected: PASS. Abrir `/login` en el dev server (Task 6 lo levanta) y confirmar que se ve igual que antes.

- [ ] **Step 10: Commit**

```bash
git add lib/tenants/auth-methods.ts lib/tenants/public.ts "app/(auth)/login" tests/tenants/auth-methods.test.ts tests/tenants/public.test.ts
git commit -m "feat: landing de login por empresa con los métodos permitidos"
```

---

### Task 4: Validación del alta

**Files:**
- Create: `lib/tenants/tenant-create.ts`
- Modify: `lib/tenants/tenant-form.ts` (suma `authMethods` al schema de edición)
- Test: `tests/tenants/tenant-create.test.ts`, `tests/tenants/tenant-form.test.ts`

**Interfaces:**
- Produces:
  - `readCreateForm(formData: FormData): unknown`; `createTenantSchema` con salida `CreateTenantInput = { slug; displayName; allowedDomains; authMethods; primary; secondary; adminEmail; allowExternalAdmin }`.
  - En edición: `TenantInput` suma `authMethods: AuthMethod[]`; `readTenantForm` lee `formData.getAll("auth_methods")`.
- Nombres de campos nuevos del form: `slug`, `auth_methods` (checkbox múltiple), `admin_email`, `allow_external_admin`.

- [ ] **Step 1: Escribir el test que falla** en `tests/tenants/tenant-create.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTenantSchema, readCreateForm } from "@/lib/tenants/tenant-create";

function form(overrides: Record<string, string | string[] | null> = {}) {
	const values: Record<string, string | string[] | null> = {
		display_name: "Acme",
		slug: "acme",
		allowed_domains: "acme.test",
		auth_methods: ["email"],
		primary: "#112233",
		secondary: "",
		admin_email: "Ana@Acme.test",
		...overrides,
	};
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) {
		if (value === null) continue;
		if (Array.isArray(value)) for (const v of value) data.append(key, v);
		else data.set(key, value);
	}
	return data;
}

const parse = (o?: Record<string, string | string[] | null>) =>
	createTenantSchema.safeParse(readCreateForm(form(o)));
const message = (o: Record<string, string | string[] | null>) => {
	const r = parse(o);
	return r.success ? null : r.error.issues[0]?.message;
};

describe("createTenantSchema", () => {
	it("acepta un alta válida y normaliza el correo", () => {
		const result = parse();

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			displayName: "Acme",
			slug: "acme",
			allowedDomains: ["acme.test"],
			authMethods: ["email"],
			primary: "#112233",
			secondary: "",
			adminEmail: "ana@acme.test",
			allowExternalAdmin: false,
		});
	});

	it("rechaza un slug con mayúsculas o espacios", () => {
		expect(message({ slug: "Acme SA" })).toBe(
			"El slug va en minúsculas, con números y guiones, y empieza con letra.",
		);
	});

	it("rechaza un slug de una sola letra", () => {
		expect(message({ slug: "a" })).toBe(
			"El slug va en minúsculas, con números y guiones, y empieza con letra.",
		);
	});

	it("exige al menos un método de login", () => {
		expect(message({ auth_methods: null })).toBe(
			"Elegí al menos un método de login.",
		);
	});

	it("rechaza un método desconocido", () => {
		expect(message({ auth_methods: ["microsoft"] })).toBe(
			"Elegí al menos un método de login.",
		);
	});

	it("rechaza un correo de admin inválido", () => {
		expect(message({ admin_email: "ana" })).toBe(
			"El correo del primer administrador no es válido.",
		);
	});

	it("rechaza un admin externo sin el tilde", () => {
		expect(message({ admin_email: "ana@gmail.com" })).toBe(
			"Ese correo no es de los dominios permitidos. Marcá \"Permitir correo externo\" si es a propósito.",
		);
	});

	it("acepta un admin externo con el tilde", () => {
		const result = parse({ admin_email: "ana@gmail.com", allow_external_admin: "on" });

		expect(result.success).toBe(true);
		expect(result.data?.allowExternalAdmin).toBe(true);
	});

	it("sin dominios declarados cualquier correo es interno", () => {
		expect(parse({ allowed_domains: "", admin_email: "ana@gmail.com" }).success).toBe(true);
	});
});
```

Y en `tests/tenants/tenant-form.test.ts`, dentro de `describe("tenantInputSchema")`, agregar `auth_methods: ["email", "google"]` al `form()` de ese archivo (como array, igual que arriba; adaptar el helper para hacer `append` con arrays) y estos tests:

```ts
	it("lee los métodos de login marcados", () => {
		expect(parse({ auth_methods: ["google"] }).data?.authMethods).toEqual(["google"]);
	});

	it("exige al menos un método de login", () => {
		expect(message({ auth_methods: null })).toBe("Elegí al menos un método de login.");
	});
```

y `authMethods: ["email", "google"]` en el `toEqual` del test "acepta un formulario válido".

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm test -- tests/tenants/tenant-create.test.ts tests/tenants/tenant-form.test.ts`
Expected: FAIL (módulo inexistente; en tenant-form, `authMethods` ausente).

- [ ] **Step 3: Sumar `authMethods` a `lib/tenants/tenant-form.ts`.** Exportar un helper y usarlo en el schema de edición:

```ts
import { type AuthMethod, isAuthMethod } from "@/lib/tenants/auth-methods";

export function readAuthMethods(formData: FormData): string[] {
	return formData
		.getAll("auth_methods")
		.filter((v): v is string => typeof v === "string");
}

export const authMethodsSchema = z
	.array(z.string())
	.transform((values) => values.filter(isAuthMethod) as AuthMethod[])
	.refine((values) => values.length > 0, {
		error: "Elegí al menos un método de login.",
	});
```

En `readTenantForm` agregar `authMethods: readAuthMethods(formData),` y en `tenantInputSchema` el campo `authMethods: authMethodsSchema,`.

- [ ] **Step 4: Implementar `lib/tenants/tenant-create.ts`**

```ts
import { z } from "zod";
import { isAllowedDomain } from "@/lib/invitations/domain";
import {
	authMethodsSchema,
	parseList,
	readAuthMethods,
} from "@/lib/tenants/tenant-form";

// Mismo regex que tenants_slug_format en la base.
const SLUG = /^[a-z][a-z0-9-]{1,38}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const text = (formData: FormData, key: string) => {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
};

export function readCreateForm(formData: FormData): unknown {
	return {
		displayName: text(formData, "display_name"),
		slug: text(formData, "slug").trim(),
		allowedDomains: [
			...new Set(
				parseList(text(formData, "allowed_domains")).map((d) =>
					d.toLowerCase().replace(/^@/, ""),
				),
			),
		],
		authMethods: readAuthMethods(formData),
		primary: text(formData, "primary").trim(),
		secondary: text(formData, "secondary").trim(),
		adminEmail: text(formData, "admin_email").trim().toLowerCase(),
		allowExternalAdmin: formData.has("allow_external_admin"),
	};
}

const color = z.string().refine((v) => v === "" || COLOR.test(v), {
	error: "Los colores van como #RRGGBB.",
});

export const createTenantSchema = z
	.object({
		displayName: z
			.string()
			.trim()
			.min(1, { error: "El nombre no puede quedar vacío." })
			.max(80, { error: "El nombre no puede pasar los 80 caracteres." }),
		slug: z.string().regex(SLUG, {
			error:
				"El slug va en minúsculas, con números y guiones, y empieza con letra.",
		}),
		allowedDomains: z.array(z.string()).max(50),
		authMethods: authMethodsSchema,
		primary: color,
		secondary: color,
		adminEmail: z.email({
			error: "El correo del primer administrador no es válido.",
		}),
		allowExternalAdmin: z.boolean(),
	})
	.superRefine((input, context) => {
		// Se valida ANTES de crear la empresa: un error acá no puede dejar una
		// empresa sin admin.
		if (
			!input.allowExternalAdmin &&
			!isAllowedDomain(input.adminEmail, input.allowedDomains)
		) {
			context.addIssue({
				code: "custom",
				path: ["adminEmail"],
				message:
					'Ese correo no es de los dominios permitidos. Marcá "Permitir correo externo" si es a propósito.',
			});
		}
	});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npm test -- tests/tenants/tenant-create.test.ts tests/tenants/tenant-form.test.ts`
Expected: PASS. El test de la action de edición (`tests/plataforma/actions.test.ts`) va a fallar hasta Task 6 por el campo nuevo: anotarlo, no "arreglar" el schema.

- [ ] **Step 6: Commit**

```bash
git add lib/tenants/tenant-create.ts lib/tenants/tenant-form.ts tests/tenants/tenant-create.test.ts tests/tenants/tenant-form.test.ts
git commit -m "feat: validación del alta de empresas y métodos de login en la edición"
```

---

### Task 5: Server action `createTenant`

**Files:**
- Create: `app/plataforma/nueva/actions.ts`
- Test: `tests/plataforma/create-actions.test.ts`

**Interfaces:**
- Consumes: `requirePlatformAdmin` (consola), `createTenantSchema`/`readCreateForm` (Task 4), `validateLogo`/`mergeBrand` (edición), `inviteToTenant` (Task 2).
- Produces: `type CreateResult = { ok: true; slug: string; warnings: string[] } | { ok: false; message: string }`; `createTenant(formData: FormData): Promise<CreateResult>`.

- [ ] **Step 1: Escribir el test que falla** en `tests/plataforma/create-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const NEW_ID = "22222222-2222-4222-8222-222222222222";

const state: {
	admin: boolean;
	rpc: { data: unknown; error: { code?: string; message: string } | null };
	rpcCalls: { fn: string; args: Record<string, unknown> }[];
	updates: Record<string, unknown>[];
	uploads: string[];
	uploadError: unknown;
	invite: { kind: string; allowedDomains?: string[] };
	inviteCalls: Record<string, unknown>[];
} = {
	admin: true,
	rpc: { data: NEW_ID, error: null },
	rpcCalls: [],
	updates: [],
	uploads: [],
	uploadError: null,
	invite: { kind: "ok" },
	inviteCalls: [],
};

const supabase = {
	rpc: async (fn: string, args: Record<string, unknown>) => {
		state.rpcCalls.push({ fn, args });
		return state.rpc;
	},
	from: () => ({
		update(values: Record<string, unknown>) {
			state.updates.push(values);
			return { eq: async () => ({ error: null }) };
		},
	}),
	storage: {
		from: () => ({
			upload: async (path: string) => {
				state.uploads.push(path);
				return { error: state.uploadError };
			},
		}),
	},
};

vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { supabase, userId: "u1" } : null,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/invitations/invite", () => ({
	inviteToTenant: async (params: Record<string, unknown>) => {
		state.inviteCalls.push(params);
		return state.invite;
	},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
	headers: async () => new Map([["origin", "https://app.test"]]),
}));

const { createTenant } = await import("@/app/plataforma/nueva/actions");

function form(overrides: Record<string, string | File | null> = {}) {
	const values: Record<string, string | File | null> = {
		display_name: "Acme",
		slug: "acme",
		allowed_domains: "acme.test",
		auth_methods: "email",
		primary: "#112233",
		secondary: "",
		admin_email: "ana@acme.test",
		...overrides,
	};
	const data = new FormData();
	for (const [k, v] of Object.entries(values)) if (v !== null) data.set(k, v);
	return data;
}

describe("createTenant", () => {
	beforeEach(() => {
		state.admin = true;
		state.rpc = { data: NEW_ID, error: null };
		state.rpcCalls = [];
		state.updates = [];
		state.uploads = [];
		state.uploadError = null;
		state.invite = { kind: "ok" };
		state.inviteCalls = [];
	});

	it("rechaza a quien no es platform_admin sin tocar la base", async () => {
		state.admin = false;

		expect(await createTenant(form())).toEqual({ ok: false, message: "No tenés permiso." });
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("devuelve el mensaje del campo sin crear nada", async () => {
		const result = await createTenant(form({ admin_email: "ana@gmail.com" }));

		expect(result).toEqual({
			ok: false,
			message:
				'Ese correo no es de los dominios permitidos. Marcá "Permitir correo externo" si es a propósito.',
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("crea la empresa con create_tenant e invita al admin hacia su chat", async () => {
		const result = await createTenant(form());

		expect(result).toEqual({ ok: true, slug: "acme", warnings: [] });
		expect(state.rpcCalls[0]).toEqual({
			fn: "create_tenant",
			args: {
				p_slug: "acme",
				p_display_name: "Acme",
				p_allowed_domains: ["acme.test"],
				p_auth_methods: ["email"],
				p_brand: { primary: "#112233" },
			},
		});
		expect(state.inviteCalls[0]).toMatchObject({
			tenantId: NEW_ID,
			email: "ana@acme.test",
			role: "tenant_admin",
			invitedBy: "u1",
			allowExternal: false,
			origin: "https://app.test",
			next: "/acme/chat",
		});
	});

	it("traduce un slug repetido", async () => {
		state.rpc = { data: null, error: { code: "23505", message: "dup" } };

		expect(await createTenant(form())).toEqual({
			ok: false,
			message: "Ya hay una empresa con ese slug.",
		});
	});

	it("traduce un slug reservado", async () => {
		state.rpc = { data: null, error: { code: "23514", message: "check" } };

		expect(await createTenant(form())).toEqual({
			ok: false,
			message: "Ese slug está reservado o tiene un formato inválido.",
		});
	});

	it("traduce falta de permiso de la RLS", async () => {
		state.rpc = { data: null, error: { code: "42501", message: "rls" } };

		expect(await createTenant(form())).toEqual({ ok: false, message: "No tenés permiso." });
	});

	it("sube el logo después de crear y lo guarda en brand", async () => {
		const logo = new File(["png"], "l.png", { type: "image/png" });

		const result = await createTenant(form({ logo }));

		expect(result.ok).toBe(true);
		expect(state.uploads[0]).toMatch(/^acme\/logo-\d+\.png$/);
		expect(state.updates[0]?.brand).toMatchObject({
			primary: "#112233",
			logo_url: state.uploads[0],
		});
	});

	it("si falla el logo, la empresa queda creada y se avisa", async () => {
		state.uploadError = { message: "boom" };
		const logo = new File(["png"], "l.png", { type: "image/png" });

		const result = await createTenant(form({ logo }));

		expect(result).toEqual({
			ok: true,
			slug: "acme",
			warnings: ["No se pudo subir el logo. Subilo desde esta pantalla."],
		});
		expect(state.inviteCalls).toHaveLength(1);
	});

	it("si falla la invitación, la empresa queda creada y se avisa", async () => {
		state.invite = { kind: "mail_fallo" };

		expect(await createTenant(form())).toEqual({
			ok: true,
			slug: "acme",
			warnings: [
				"No se pudo mandar la invitación al administrador. Invitalo desde Usuarios.",
			],
		});
	});

	it("si el admin ya existía en Auth no es advertencia", async () => {
		state.invite = { kind: "ya_existe" };

		expect(await createTenant(form())).toEqual({ ok: true, slug: "acme", warnings: [] });
	});

	it("un logo inválido frena antes de crear", async () => {
		const logo = new File(["x"], "l.jpg", { type: "image/jpeg" });

		expect(await createTenant(form({ logo }))).toEqual({
			ok: false,
			message: "El logo tiene que ser PNG, SVG o WebP.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/plataforma/create-actions.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar `app/plataforma/nueva/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { inviteToTenant } from "@/lib/invitations/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import { createTenantSchema, readCreateForm } from "@/lib/tenants/tenant-create";
import { mergeBrand, validateLogo } from "@/lib/tenants/tenant-form";

type Failure = { ok: false; message: string };
export type CreateResult =
	| { ok: true; slug: string; warnings: string[] }
	| Failure;

const SIN_PERMISO: Failure = { ok: false, message: "No tenés permiso." };
const NO_CREO: Failure = { ok: false, message: "No se pudo crear la empresa." };

const LOGO_WARNING = "No se pudo subir el logo. Subilo desde esta pantalla.";
const INVITE_WARNING =
	"No se pudo mandar la invitación al administrador. Invitalo desde Usuarios.";

/**
 * Alta de una empresa (spec alta §5). Tenant + agente son atómicos (SQL);
 * logo e invitación no: si fallan, la empresa queda creada y se informa.
 */
export async function createTenant(formData: FormData): Promise<CreateResult> {
	try {
		const admin = await requirePlatformAdmin();
		if (!admin) return SIN_PERMISO;

		const parsed = createTenantSchema.safeParse(readCreateForm(formData));
		if (!parsed.success)
			return {
				ok: false,
				message: parsed.error.issues[0]?.message ?? NO_CREO.message,
			};
		const input = parsed.data;

		// El logo se valida ANTES de crear: un archivo inválido no deja una
		// empresa a medias.
		const logo = formData.get("logo");
		const hasLogo = logo instanceof File && logo.size > 0;
		const checkedLogo = hasLogo ? validateLogo(logo) : null;
		if (checkedLogo && !checkedLogo.ok) return checkedLogo;

		const brand = mergeBrand({}, {
			primary: input.primary,
			secondary: input.secondary,
		});

		const { data: tenantId, error } = await admin.supabase.rpc("create_tenant", {
			p_slug: input.slug,
			p_display_name: input.displayName,
			p_allowed_domains: input.allowedDomains,
			p_auth_methods: input.authMethods,
			p_brand: brand,
		});
		if (error || !tenantId) {
			if (error?.code === "23505")
				return { ok: false, message: "Ya hay una empresa con ese slug." };
			if (error?.code === "23514")
				return {
					ok: false,
					message: "Ese slug está reservado o tiene un formato inválido.",
				};
			if (error?.code === "42501") return SIN_PERMISO;
			return NO_CREO;
		}

		const warnings: string[] = [];

		if (hasLogo && checkedLogo?.ok) {
			const path = `${input.slug}/logo-${Date.now()}.${checkedLogo.ext}`;
			const { error: uploadError } = await admin.supabase.storage
				.from("brand")
				.upload(path, logo, { contentType: logo.type });
			if (uploadError) warnings.push(LOGO_WARNING);
			else
				await admin.supabase
					.from("tenants")
					.update({ brand: mergeBrand(brand, { primary: input.primary, secondary: input.secondary, logoUrl: path }) })
					.eq("id", tenantId as string);
		}

		const origin = (await headers()).get("origin") ?? process.env.PUBLIC_APP_URL ?? "";
		const outcome = await inviteToTenant({
			admin: createAdminClient(),
			tenantId: tenantId as string,
			email: input.adminEmail,
			role: "tenant_admin",
			invitedBy: admin.userId,
			allowExternal: input.allowExternalAdmin,
			origin,
			next: `/${input.slug}/chat`,
		});
		if (outcome.kind !== "ok" && outcome.kind !== "ya_existe")
			warnings.push(INVITE_WARNING);

		revalidatePath("/plataforma");
		return { ok: true, slug: input.slug, warnings };
	} catch {
		return NO_CREO;
	}
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/plataforma/create-actions.test.ts`
Expected: PASS (11 tests). Si `headers()` tipa mal el mock, ajustar el mock a `{ get: () => "https://app.test" }`, no la action.

- [ ] **Step 5: Verificar y commitear**

Run: `npm run typecheck && npm test -- tests/plataforma/create-actions.test.ts tests/invitations`
Expected: PASS.

```bash
git add app/plataforma/nueva/actions.ts tests/plataforma/create-actions.test.ts
git commit -m "feat: server action de alta de empresas"
```

---

### Task 6: Pantallas y verificación en navegador

**Files:**
- Create: `app/plataforma/nueva/page.tsx`, `app/plataforma/nueva/create-form.tsx`
- Modify: `app/plataforma/page.tsx` (botón)
- Modify: `app/plataforma/[slug]/page.tsx`, `app/plataforma/[slug]/tenant-form.tsx`, `app/plataforma/[slug]/actions.ts`
- Modify: `tests/plataforma/actions.test.ts` (campo `auth_methods` en el form de prueba y en el `toEqual` del update)

**Interfaces:**
- Consumes: `createTenant` (Task 5), `AUTH_METHODS`/`AUTH_METHOD_LABELS` (Task 3), `TenantInput.authMethods` (Task 4).

- [ ] **Step 1: Actualizar la edición.** En `app/plataforma/[slug]/actions.ts`, el `update` suma `auth_methods: input.authMethods`. En `tests/plataforma/actions.test.ts`, el helper `form()` suma `auth_methods: "email"` y el `toEqual` del test "escribe las columnas" suma `auth_methods: ["email"]`. Correr `npm test -- tests/plataforma/actions.test.ts` y ver PASS.

- [ ] **Step 2: Métodos de login y link a la landing en el detalle.** En `tenant-form.tsx`, `TenantFormValues` suma `authMethods: AuthMethod[]`, y antes del bloque de colores va:

```tsx
			<fieldset className="space-y-1">
				<legend className="text-sm">Métodos de login</legend>
				{AUTH_METHODS.map((method) => (
					<label key={method} className="flex min-h-11 items-center gap-2 text-sm">
						<input
							type="checkbox"
							name="auth_methods"
							value={method}
							defaultChecked={tenant.authMethods.includes(method)}
						/>
						{AUTH_METHOD_LABELS[method]}
					</label>
				))}
				<p className="text-muted-foreground text-xs">
					Son los que ofrece la landing de la empresa. Al menos uno.
				</p>
			</fieldset>
```

En `page.tsx` del detalle, `TenantDetailRow` suma `auth_methods: string[]`, el `select` lo incluye, y se pasa `authMethods: tenant.auth_methods.filter(isAuthMethod)`. Debajo del título, un bloque:

```tsx
				<p className="mb-4 text-muted-foreground text-sm">
					Landing de login:{" "}
					<code className="rounded bg-muted px-1 py-0.5 text-xs">
						/login/{tenant.slug}
					</code>
				</p>
```

- [ ] **Step 3: Botón en el listado.** En `app/plataforma/page.tsx`, el `<h1>` pasa a una fila con el botón:

```tsx
			<div className="mb-4 flex items-center justify-between gap-3">
				<h1 className="text-3xl leading-tight">Empresas</h1>
				<Button asChild size="lg">
					<Link href="/plataforma/nueva">Nueva empresa</Link>
				</Button>
			</div>
```

con `import { Button } from "@/components/ui/button";`.

- [ ] **Step 4: Página de alta `app/plataforma/nueva/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import { CreateForm } from "./create-form";

export default async function NuevaEmpresaPage() {
	const admin = await requirePlatformAdmin();
	if (!admin) notFound();

	return (
		<div className="max-w-3xl space-y-6">
			<Link
				href="/plataforma"
				className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
			>
				← Empresas
			</Link>
			<h1 className="text-3xl leading-tight">Nueva empresa</h1>
			<CreateForm />
		</div>
	);
}
```

- [ ] **Step 5: Formulario `app/plataforma/nueva/create-form.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AUTH_METHOD_LABELS, AUTH_METHODS } from "@/lib/tenants/auth-methods";
import { createTenant } from "./actions";

export function CreateForm() {
	const router = useRouter();
	const formRef = useRef<HTMLFormElement>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	return (
		<form
			ref={formRef}
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				const form = formRef.current;
				if (!form) return;
				const formData = new FormData(form);
				startTransition(async () => {
					const result = await createTenant(formData);
					if (!result.ok) {
						setMessage(result.message);
						return;
					}
					// Las advertencias viajan en la URL: la pantalla de destino es
					// un server component y no comparte estado con este form.
					const params = new URLSearchParams();
					for (const w of result.warnings) params.append("aviso", w);
					const query = params.toString();
					router.push(`/plataforma/${result.slug}${query ? `?${query}` : ""}`);
				});
			}}
		>
			<div className="space-y-1">
				<label htmlFor="display_name" className="text-sm">Nombre</label>
				<Input id="display_name" name="display_name" maxLength={80} required />
			</div>

			<div className="space-y-1">
				<label htmlFor="slug" className="text-sm">Slug</label>
				<Input id="slug" name="slug" placeholder="acme" required />
				<p className="text-muted-foreground text-xs">
					Va en la dirección: /<strong>slug</strong>/chat y /login/<strong>slug</strong>. Minúsculas, números y guiones. No se cambia después.
				</p>
			</div>

			<div className="space-y-1">
				<label htmlFor="allowed_domains" className="text-sm">Dominios permitidos</label>
				<Textarea id="allowed_domains" name="allowed_domains" rows={2} placeholder="acme.com" />
				<p className="text-muted-foreground text-xs">Uno por línea. Vacío: sin restricción.</p>
			</div>

			<fieldset className="space-y-1">
				<legend className="text-sm">Métodos de login</legend>
				{AUTH_METHODS.map((method) => (
					<label key={method} className="flex min-h-11 items-center gap-2 text-sm">
						<input type="checkbox" name="auth_methods" value={method} defaultChecked />
						{AUTH_METHOD_LABELS[method]}
					</label>
				))}
			</fieldset>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1">
					<label htmlFor="primary" className="text-sm">Color primario</label>
					<Input id="primary" name="primary" placeholder="#1D4ED8" />
				</div>
				<div className="space-y-1">
					<label htmlFor="secondary" className="text-sm">Color secundario</label>
					<Input id="secondary" name="secondary" placeholder="#0F172A" />
				</div>
			</div>

			<div className="space-y-1">
				<label htmlFor="logo" className="text-sm">Logo</label>
				<input id="logo" name="logo" type="file" accept="image/png,image/svg+xml,image/webp" className="block text-sm" />
				<p className="text-muted-foreground text-xs">PNG, SVG o WebP de hasta 1 MB. Opcional.</p>
			</div>

			<div className="space-y-1">
				<label htmlFor="admin_email" className="text-sm">Correo del primer administrador</label>
				<Input id="admin_email" name="admin_email" type="email" required />
				<label className="flex min-h-11 items-center gap-2 text-sm">
					<input type="checkbox" name="allow_external_admin" />
					Permitir correo externo a los dominios
				</label>
			</div>

			<div className="flex flex-wrap items-center gap-3">
				<Button type="submit" size="lg" disabled={isPending}>
					{isPending ? "Creando…" : "Crear empresa"}
				</Button>
				{message ? (
					<p role="alert" className="text-destructive text-sm">{message}</p>
				) : null}
			</div>
		</form>
	);
}
```

- [ ] **Step 6: Mostrar las advertencias en el detalle.** `app/plataforma/[slug]/page.tsx` recibe `searchParams: Promise<{ aviso?: string | string[] }>` y, si hay avisos, los muestra arriba del formulario:

```tsx
			{avisos.length > 0 ? (
				<ul role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
					<li>La empresa quedó creada, pero:</li>
					{avisos.map((aviso) => (
						<li key={aviso}>· {aviso}</li>
					))}
				</ul>
			) : null}
```

con `const { aviso } = await searchParams; const avisos = aviso ? (Array.isArray(aviso) ? aviso : [aviso]) : [];`.

- [ ] **Step 7: Verificar tipos, tests y formato**

Run: `npm run typecheck && npm test && npm run lint:fix`
Expected: PASS. Después de `lint:fix`, revertir con `git checkout -- <archivo>` todo archivo que no esté en la lista **Files** de este plan.

- [ ] **Step 8: Verificar en el navegador.** Base local sembrada (`npm run db:reset`). El `.env.local` apunta a la nube: armar un `.env.development.local` (git-ignorado) con la URL y las llaves locales de `npx supabase status -o env` y `PLATFORM_OWNER_TENANT_SLUG=innovas-seed`. Si el puerto 3000 lo tiene otra sesión, usar un worktree en el scratchpad con una entrada propia en `.claude/launch.json` (revertirla al final). Sesión de `admin-seed@innov.as` como en la etapa anterior. Casos:

1. `/plataforma` muestra "Nueva empresa"; lleva a `/plataforma/nueva`.
2. Alta con slug `Acme SA` → mensaje del slug, nada creado.
3. Alta con admin `ana@gmail.com` y dominios `acme.test` sin tilde → mensaje del correo, nada creado.
4. Alta válida: nombre Acme, slug `acme`, dominio `acme.test`, solo "Link por correo", color `#7C3AED`, logo PNG, admin `ana@acme.test` → redirige a `/plataforma/acme` sin avisos; `tenant_agents` tiene la fila `outreach` (consulta en psql).
5. `/login/acme` muestra el logo, el color y solo el formulario de email; no hay botón de Google ni separador.
6. `/login/no-existe` → 404. Desactivar `acme` desde el detalle → `/login/acme` 404. Reactivar.
7. Mailpit (`http://127.0.0.1:54324`): el mail de invitación a `ana@acme.test` tiene un link cuyo `redirect_to` termina en `/auth/callback?next=%2Facme%2Fchat`.
8. En el detalle de `acme`: destildar "Link por correo", tildar Google, guardar → `/login/acme` ahora muestra solo Google.
9. `/login` genérico se ve igual que antes (Google, "o", email).
10. Como `ana@demo.test`: `/plataforma/nueva` → 404.
11. 375px: `/login/acme` y `/plataforma/nueva` sin desborde. Sin errores en consola ni en logs del server.

- [ ] **Step 9: Commit**

```bash
git add app/plataforma tests/plataforma/actions.test.ts
git commit -m "feat: alta de empresas desde la consola con métodos de login y primer admin"
```

---

### Task 7: Salida a producción (cada paso con confirmación de Matías)

- [ ] **Step 1: Migración.** `npx supabase migration list`; mostrar las pendientes (no solo la de este plan) y aplicar con `db push` solo con confirmación.
- [ ] **Step 2: PR** hacia `main` con el resumen, los límites de la spec §8 y el estado de la migración.
- [ ] **Step 3: Criterio de cierre.** Matías crea la empresa del cliente en producción, abre `/login/<slug>` y ve su logo con solo email; el primer admin recibe la invitación y cae en `/<slug>/chat`.
