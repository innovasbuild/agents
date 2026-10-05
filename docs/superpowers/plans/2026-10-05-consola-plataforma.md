# Consola de plataforma — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un platform_admin del tenant dueño entre a `/plataforma` desde el badge de rol, vea todas las empresas, abra una y la edite.

**Architecture:** Zona nueva `app/plataforma/` fuera de `app/[tenant]/`. El acceso lo decide `lib/tenants/platform.ts` leyendo `PLATFORM_OWNER_TENANT_SLUG` y la membership del usuario. La edición es una server action que valida con zod y escribe con el cliente del usuario: la RLS existente (`tenants_update`) decide el permiso.

**Tech Stack:** Next.js App Router, Supabase (`@supabase/ssr`), zod 4, vitest, pgTAP, Tailwind + shadcn (`components/ui`).

**Spec:** `docs/superpowers/specs/2026-10-05-consola-plataforma-design.md`

## Global Constraints

- Rama `feat/consola-plataforma`. Identidad git local `innovasbuild` / `matias@innov.as`.
- Español rioplatense en UI y mensajes. Código e identificadores en inglés.
- Nada específico de un tenant en código: el slug del dueño sale solo de `PLATFORM_OWNER_TENANT_SLUG`.
- Quien no es platform_admin del tenant dueño recibe 404 (`notFound()`), nunca 403.
- El slug del tenant no se edita desde ningún lado.
- Sin políticas RLS nuevas. La única migración reserva el slug `plataforma`.
- Antes de tocar SQL: cargar la skill `supabase-postgres-best-practices`.
- Commits con prefijo `feat:` / `fix:` / `docs:`. Después de cada tarea: `npm run typecheck` y `npm test`.
- `npm run lint:fix` reformatea siempre 4 archivos ajenos: revertirlos (`git checkout -- <archivo>`) antes de commitear.
- No aplicar migraciones en producción ni tocar variables de Vercel sin confirmación de Matías.

## Review Focus

1. **Variable sin configurar en un entorno:** la consola da 404 a todos y nadie queda con rol de plataforma en la UI. Test en Task 2.
2. **Dominios pegados como vienen** (`@Innov.AS, demo.test` con mayúsculas, arroba, comas, saltos de línea, repetidos): se normalizan a minúscula, sin `@`, sin duplicados. Test en Task 3.
3. **Sacar de los permitidos el modelo que está como default:** mensaje claro del campo, no un error genérico de la base. Test en Task 3.
4. **Guardar sin elegir logo:** el input de archivo manda un `File` vacío; el logo actual no se toca ni se sube nada. Test en Task 4.
5. **Abrir el detalle de un tenant inactivo:** tiene que abrirse (es la única forma de reactivarlo), a diferencia de `resolveTenantAccess`, que filtra `active`. Verificación en Task 5, paso de navegador.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261005120000_reserve_plataforma_slug.sql` | Reserva el slug `plataforma` |
| `supabase/tests/17_reserved_tenant_slugs.test.sql` | Suma el caso `plataforma` |
| `lib/tenants/platform.ts` | Slug del dueño y gate `requirePlatformAdmin` |
| `lib/tenants/resolve.ts` | El rol de plataforma pasa a decidirse con `platform.ts` |
| `lib/tenants/tenant-form.ts` | Puro: leer el form, schema zod, mezcla de `brand`, validación del logo |
| `lib/tenants/people.ts` | Nombre y correo de una lista de `user_id` (extraído de `/settings/usuarios`) |
| `app/plataforma/layout.tsx` | Header de la consola |
| `app/plataforma/page.tsx` | Listado |
| `app/plataforma/[slug]/page.tsx` | Detalle |
| `app/plataforma/[slug]/tenant-form.tsx` | Formulario (client) |
| `app/plataforma/[slug]/actions.ts` | `updateTenant` |
| `app/[tenant]/layout.tsx` | Badge como link |
| `next.config.ts` | Límite de body de server actions a 2 MB (logo de 1 MB) |

---

### Task 1: Reservar el slug `plataforma`

**Files:**
- Create: `supabase/migrations/20261005120000_reserve_plataforma_slug.sql`
- Modify: `supabase/tests/17_reserved_tenant_slugs.test.sql`

**Interfaces:**
- Produces: la constraint `tenants_slug_not_reserved` rechaza `plataforma` (SQLSTATE `23514`).

- [ ] **Step 1: Cargar la skill `supabase-postgres-best-practices`** y abrir Docker (`npm run db:start`).

- [ ] **Step 2: Escribir el test que falla.** En `supabase/tests/17_reserved_tenant_slugs.test.sql` cambiar `select plan(3);` por `select plan(4);` y agregar antes de `select * from finish();`:

```sql
select throws_ok(
  $$insert into public.tenants (id, slug, display_name)
    values ('aaaaaaaa-0000-0000-0000-000000000015', 'plataforma', 'Plataforma')$$,
  '23514',
  null,
  'plataforma está reservado por app/plataforma'
);
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npm run db:test`
Expected: FAIL en `17_reserved_tenant_slugs` ("plataforma está reservado por app/plataforma").

- [ ] **Step 4: Escribir la migración**

```sql
-- Spec consola de plataforma §4: app/plataforma es una ruta de primer nivel,
-- así que su palabra entra en la lista de slugs reservados.
do $$
begin
  if exists (select 1 from public.tenants where slug = 'plataforma') then
    raise exception 'hay un tenant con el slug reservado "plataforma". Cambiá el slug antes de aplicar esta migración';
  end if;
end $$;

alter table public.tenants
  drop constraint tenants_slug_not_reserved;

alter table public.tenants
  add constraint tenants_slug_not_reserved
  check (slug not in ('api', 'auth', 'brain', 'eve', 'login', 'oauth', 'plataforma', 'sin-acceso'));
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run db:test`
Expected: PASS, todos los archivos.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261005120000_reserve_plataforma_slug.sql supabase/tests/17_reserved_tenant_slugs.test.sql
git commit -m "feat: reservar el slug plataforma"
```

---

### Task 2: Gate de plataforma por variable de entorno

**Files:**
- Create: `lib/tenants/platform.ts`
- Modify: `lib/tenants/resolve.ts` (bloque `platformAdmin`, hoy líneas 81-97)
- Modify: `.env.local` (no se commitea)
- Test: `tests/tenants/platform.test.ts`

**Interfaces:**
- Produces:
  - `platformOwnerSlug(): string | null`
  - `isPlatformOwnerAdmin(supabase: ServerSupabase, userId: string): Promise<boolean>`
  - `requirePlatformAdmin(): Promise<{ supabase: ServerSupabase; userId: string } | null>`
  - `type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>`
  - `resolveTenantAccess` devuelve `role: "platform_admin"` solo para un platform_admin del tenant dueño.

- [ ] **Step 1: Escribir el test que falla** en `tests/tenants/platform.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	isPlatformOwnerAdmin,
	platformOwnerSlug,
	type ServerSupabase,
} from "@/lib/tenants/platform";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function fakeSupabase(row: unknown) {
	const filters: [string, unknown][] = [];
	let queried = false;
	const builder = {
		select() {
			queried = true;
			return builder;
		},
		eq(column: string, value: unknown) {
			filters.push([column, value]);
			return builder;
		},
		maybeSingle: async () => ({ data: row, error: null }),
	};
	return {
		client: { from: () => builder } as unknown as ServerSupabase,
		filters,
		wasQueried: () => queried,
	};
}

describe("platformOwnerSlug", () => {
	const original = process.env.PLATFORM_OWNER_TENANT_SLUG;
	afterEach(() => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = original;
	});

	it("devuelve el slug configurado", () => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = " innovas ";
		expect(platformOwnerSlug()).toBe("innovas");
	});

	it("devuelve null sin la variable", () => {
		delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		expect(platformOwnerSlug()).toBeNull();
	});

	it("devuelve null con la variable vacía", () => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = "  ";
		expect(platformOwnerSlug()).toBeNull();
	});
});

describe("isPlatformOwnerAdmin", () => {
	const original = process.env.PLATFORM_OWNER_TENANT_SLUG;
	beforeEach(() => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = "innovas";
	});
	afterEach(() => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = original;
	});

	it("falla cerrado sin la variable, sin consultar la base", async () => {
		delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		const fake = fakeSupabase({ id: "m1" });

		expect(await isPlatformOwnerAdmin(fake.client, USER_ID)).toBe(false);
		expect(fake.wasQueried()).toBe(false);
	});

	it("busca una membership platform_admin del usuario en el tenant dueño", async () => {
		const fake = fakeSupabase({ id: "m1" });

		expect(await isPlatformOwnerAdmin(fake.client, USER_ID)).toBe(true);
		expect(fake.filters).toEqual([
			["user_id", USER_ID],
			["role", "platform_admin"],
			["tenants.slug", "innovas"],
		]);
	});

	it("da falso cuando esa membership no existe", async () => {
		const fake = fakeSupabase(null);

		expect(await isPlatformOwnerAdmin(fake.client, USER_ID)).toBe(false);
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/tenants/platform.test.ts`
Expected: FAIL, no existe `@/lib/tenants/platform`.

- [ ] **Step 3: Implementar `lib/tenants/platform.ts`**

```ts
import { createServerSupabase } from "@/lib/supabase/server";

export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Slug del tenant dueño de la plataforma. Sale solo de la variable de
 * entorno: nada específico de un tenant vive en código. Sin la variable no
 * hay dueño y la consola queda cerrada para todos.
 */
export function platformOwnerSlug(): string | null {
	const slug = process.env.PLATFORM_OWNER_TENANT_SLUG?.trim();
	return slug ? slug : null;
}

/**
 * Un platform_admin cuenta como tal solo si su membership es del tenant
 * dueño. La RLS (`is_platform_admin()`) no conoce la variable de entorno y
 * acepta el rol en cualquier tenant: este chequeo es el de la aplicación.
 */
export async function isPlatformOwnerAdmin(
	supabase: ServerSupabase,
	userId: string,
): Promise<boolean> {
	const slug = platformOwnerSlug();
	if (!slug) return false;

	const { data } = await supabase
		.from("memberships")
		.select("id, tenants!inner(slug)")
		.eq("user_id", userId)
		.eq("role", "platform_admin")
		.eq("tenants.slug", slug)
		.maybeSingle();

	return data !== null;
}

/**
 * Gate de la consola. `null` si no hay sesión o el usuario no es
 * platform_admin del tenant dueño: quien llama responde 404.
 */
export async function requirePlatformAdmin(): Promise<{
	supabase: ServerSupabase;
	userId: string;
} | null> {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;
	if (!(await isPlatformOwnerAdmin(supabase, auth.user.id))) return null;

	return { supabase, userId: auth.user.id };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/tenants/platform.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Usar el mismo criterio en `resolveTenantAccess`.** En `lib/tenants/resolve.ts` agregar el import:

```ts
import { isPlatformOwnerAdmin } from "@/lib/tenants/platform";
```

y reemplazar desde el comentario `// El platform_admin entra a cualquier tenant...` hasta `if (!role) return null;` por:

```ts
	// El platform_admin del tenant dueño entra a cualquier tenant aunque no
	// tenga membership ahí, y siempre gana sobre el rol local, igual que en la
	// RLS. Si se resolviera al revés, uno que además tuviera una membership
	// local (tenant_member, por ejemplo) se vería degradado en la UI aunque la
	// base le siga dando acceso completo.
	const platformAdmin = await isPlatformOwnerAdmin(supabase, auth.user.id);

	// Una fila platform_admin fuera del tenant dueño no es rol de plataforma
	// para la aplicación (spec consola §3): acá vale como admin de ese tenant.
	const localRole =
		membership?.role === "platform_admin" ? "tenant_admin" : membership?.role;

	const role = (platformAdmin ? "platform_admin" : localRole) as
		| TenantRole
		| undefined;
	if (!role) return null;
```

- [ ] **Step 6: Configurar la variable local.** Agregar a `.env.local` la línea `PLATFORM_OWNER_TENANT_SLUG=<slug>`, donde `<slug>` es el del tenant de INNOV.AS en la base a la que apunta ese `.env.local` (`innovas-seed` con la base local sembrada). Verificar que `.env.local` sigue fuera de git: `git status --short` no lo lista.

- [ ] **Step 7: Verificar todo**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/tenants/platform.ts lib/tenants/resolve.ts tests/tenants/platform.test.ts
git commit -m "feat: gate de plataforma por PLATFORM_OWNER_TENANT_SLUG"
```

---

### Task 3: Validación del formulario de tenant

**Files:**
- Create: `lib/tenants/tenant-form.ts`
- Test: `tests/tenants/tenant-form.test.ts`

**Interfaces:**
- Produces:
  - `parseList(text: string): string[]` — separa por espacios, comas o saltos de línea; sin vacíos ni duplicados.
  - `readTenantForm(formData: FormData): unknown` — arma el objeto crudo que valida el schema.
  - `tenantInputSchema` — zod; salida `TenantInput`.
  - `type TenantInput = { displayName: string; allowedDomains: string[]; selfSignupByDomain: boolean; allowedModels: string[]; defaultModel: string; primary: string; secondary: string; active: boolean }`
  - `mergeBrand(existing: Record<string, unknown>, next: { primary: string; secondary: string; logoUrl?: string }): Record<string, unknown>`
  - `validateLogo(file: { type: string; size: number }): { ok: true; ext: string } | { ok: false; message: string }`
- Nombres de los campos del form: `display_name`, `allowed_domains`, `self_signup_by_domain`, `allowed_models`, `default_model`, `primary`, `secondary`, `active`, `logo`.

- [ ] **Step 1: Escribir el test que falla** en `tests/tenants/tenant-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	mergeBrand,
	parseList,
	readTenantForm,
	tenantInputSchema,
	validateLogo,
} from "@/lib/tenants/tenant-form";

function form(overrides: Record<string, string | null> = {}) {
	const values: Record<string, string | null> = {
		display_name: "INNOV.AS",
		allowed_domains: "innov.as",
		self_signup_by_domain: "on",
		allowed_models: "anthropic/claude-sonnet-5\nanthropic/claude-haiku-4-5",
		default_model: "anthropic/claude-sonnet-5",
		primary: "#1D4ED8",
		secondary: "",
		active: "on",
		...overrides,
	};
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) {
		if (value !== null) data.set(key, value);
	}
	return data;
}

const parse = (overrides?: Record<string, string | null>) =>
	tenantInputSchema.safeParse(readTenantForm(form(overrides)));

const message = (overrides: Record<string, string | null>) => {
	const result = parse(overrides);
	return result.success ? null : result.error.issues[0]?.message;
};

describe("parseList", () => {
	it("separa por comas, espacios y saltos de línea, sin vacíos ni repetidos", () => {
		expect(parseList(" a.com, b.com\n\na.com  c.com ")).toEqual([
			"a.com",
			"b.com",
			"c.com",
		]);
	});

	it("devuelve lista vacía para texto en blanco", () => {
		expect(parseList("  \n ")).toEqual([]);
	});
});

describe("tenantInputSchema", () => {
	it("acepta un formulario válido", () => {
		const result = parse();

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			displayName: "INNOV.AS",
			allowedDomains: ["innov.as"],
			selfSignupByDomain: true,
			allowedModels: [
				"anthropic/claude-sonnet-5",
				"anthropic/claude-haiku-4-5",
			],
			defaultModel: "anthropic/claude-sonnet-5",
			primary: "#1D4ED8",
			secondary: "",
			active: true,
		});
	});

	it("normaliza dominios pegados con arroba, mayúsculas y repetidos", () => {
		const result = parse({ allowed_domains: "@Innov.AS, demo.test\ninnov.as" });

		expect(result.data?.allowedDomains).toEqual(["innov.as", "demo.test"]);
	});

	it("lee un checkbox ausente como falso", () => {
		const result = parse({ active: null, self_signup_by_domain: null });

		expect(result.data?.active).toBe(false);
		expect(result.data?.selfSignupByDomain).toBe(false);
	});

	it("rechaza un nombre vacío", () => {
		expect(message({ display_name: "   " })).toBe(
			"El nombre no puede quedar vacío.",
		);
	});

	it("rechaza un nombre de más de 80 caracteres", () => {
		expect(message({ display_name: "x".repeat(81) })).toBe(
			"El nombre no puede pasar los 80 caracteres.",
		);
	});

	it("rechaza un dominio mal escrito", () => {
		expect(message({ allowed_domains: "innov" })).toBe(
			'"innov" no es un dominio válido.',
		);
	});

	it("rechaza el alta por dominio sin dominios", () => {
		expect(message({ allowed_domains: "" })).toBe(
			"Para permitir el alta por dominio hace falta al menos un dominio.",
		);
	});

	it("rechaza la lista de modelos vacía", () => {
		expect(message({ allowed_models: "" })).toBe(
			"Tiene que haber al menos un modelo permitido.",
		);
	});

	it("rechaza un modelo sin proveedor", () => {
		expect(message({ allowed_models: "claude-sonnet-5" })).toBe(
			'"claude-sonnet-5" no tiene la forma proveedor/modelo.',
		);
	});

	it("rechaza un modelo por defecto que no está entre los permitidos", () => {
		expect(message({ allowed_models: "anthropic/claude-haiku-4-5" })).toBe(
			"El modelo por defecto tiene que estar entre los permitidos.",
		);
	});

	it("rechaza un color que no es #RRGGBB", () => {
		expect(message({ primary: "azul" })).toBe(
			"Los colores van como #RRGGBB.",
		);
	});
});

describe("mergeBrand", () => {
	it("conserva las claves que el formulario no conoce", () => {
		expect(
			mergeBrand(
				{ primary: "#000000", logo_url: "innovas/logo.png", font: "Geist" },
				{ primary: "#1D4ED8", secondary: "#0F172A" },
			),
		).toEqual({
			primary: "#1D4ED8",
			secondary: "#0F172A",
			logo_url: "innovas/logo.png",
			font: "Geist",
		});
	});

	it("saca un color que se dejó vacío", () => {
		expect(
			mergeBrand(
				{ primary: "#000000", secondary: "#111111" },
				{ primary: "", secondary: "#111111" },
			),
		).toEqual({ secondary: "#111111" });
	});

	it("pisa el logo solo cuando llega uno nuevo", () => {
		expect(
			mergeBrand(
				{ logo_url: "innovas/logo.png" },
				{ primary: "", secondary: "", logoUrl: "innovas/logo-2.png" },
			),
		).toEqual({ logo_url: "innovas/logo-2.png" });
	});
});

describe("validateLogo", () => {
	it("acepta png, svg y webp y devuelve la extensión", () => {
		expect(validateLogo({ type: "image/png", size: 10 })).toEqual({
			ok: true,
			ext: "png",
		});
		expect(validateLogo({ type: "image/svg+xml", size: 10 })).toEqual({
			ok: true,
			ext: "svg",
		});
		expect(validateLogo({ type: "image/webp", size: 10 })).toEqual({
			ok: true,
			ext: "webp",
		});
	});

	it("rechaza otro tipo de archivo", () => {
		expect(validateLogo({ type: "image/jpeg", size: 10 })).toEqual({
			ok: false,
			message: "El logo tiene que ser PNG, SVG o WebP.",
		});
	});

	it("rechaza un archivo de más de 1 MB", () => {
		expect(validateLogo({ type: "image/png", size: 1_048_577 })).toEqual({
			ok: false,
			message: "El logo no puede pesar más de 1 MB.",
		});
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/tenants/tenant-form.test.ts`
Expected: FAIL, no existe `@/lib/tenants/tenant-form`.

- [ ] **Step 3: Implementar `lib/tenants/tenant-form.ts`**

```ts
import { z } from "zod";

// Módulo puro: lo importan la server action y el formulario del cliente.

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MODEL = /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const LOGO_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/svg+xml": "svg",
	"image/webp": "webp",
};
const LOGO_MAX_BYTES = 1_048_576;

export function parseList(text: string): string[] {
	return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

const text = (formData: FormData, key: string) => {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
};

export function readTenantForm(formData: FormData): unknown {
	return {
		displayName: text(formData, "display_name"),
		// Un dominio se pega como venga del mail: con arroba y con mayúsculas.
		allowedDomains: [
			...new Set(
				parseList(text(formData, "allowed_domains")).map((domain) =>
					domain.toLowerCase().replace(/^@/, ""),
				),
			),
		],
		// Un checkbox sin marcar no viaja en el form.
		selfSignupByDomain: formData.has("self_signup_by_domain"),
		allowedModels: parseList(text(formData, "allowed_models")),
		defaultModel: text(formData, "default_model"),
		primary: text(formData, "primary").trim(),
		secondary: text(formData, "secondary").trim(),
		active: formData.has("active"),
	};
}

const color = z
	.string()
	.refine((value) => value === "" || COLOR.test(value), {
		error: "Los colores van como #RRGGBB.",
	});

export const tenantInputSchema = z
	.object({
		displayName: z
			.string()
			.trim()
			.min(1, { error: "El nombre no puede quedar vacío." })
			.max(80, { error: "El nombre no puede pasar los 80 caracteres." }),
		allowedDomains: z
			.array(
				z.string().regex(DOMAIN, {
					error: (issue) => `"${issue.input}" no es un dominio válido.`,
				}),
			)
			.max(50),
		selfSignupByDomain: z.boolean(),
		allowedModels: z
			.array(
				z
					.string()
					.max(200)
					.regex(MODEL, {
						error: (issue) =>
							`"${issue.input}" no tiene la forma proveedor/modelo.`,
					}),
			)
			.min(1, { error: "Tiene que haber al menos un modelo permitido." })
			.max(50),
		defaultModel: z.string(),
		primary: color,
		secondary: color,
		active: z.boolean(),
	})
	.superRefine((input, context) => {
		if (input.selfSignupByDomain && input.allowedDomains.length === 0) {
			context.addIssue({
				code: "custom",
				path: ["allowedDomains"],
				message:
					"Para permitir el alta por dominio hace falta al menos un dominio.",
			});
		}
		if (!input.allowedModels.includes(input.defaultModel)) {
			context.addIssue({
				code: "custom",
				path: ["defaultModel"],
				message: "El modelo por defecto tiene que estar entre los permitidos.",
			});
		}
	});

export type TenantInput = z.infer<typeof tenantInputSchema>;

/**
 * Mezcla sobre lo que la fila ya tiene: `brand` es jsonb libre y puede traer
 * claves que este formulario no conoce.
 */
export function mergeBrand(
	existing: Record<string, unknown>,
	next: { primary: string; secondary: string; logoUrl?: string },
): Record<string, unknown> {
	const brand: Record<string, unknown> = { ...existing };

	for (const key of ["primary", "secondary"] as const) {
		if (next[key]) brand[key] = next[key];
		else delete brand[key];
	}
	if (next.logoUrl) brand.logo_url = next.logoUrl;

	return brand;
}

export function validateLogo(file: {
	type: string;
	size: number;
}): { ok: true; ext: string } | { ok: false; message: string } {
	const ext = LOGO_EXTENSIONS[file.type];
	if (!ext)
		return { ok: false, message: "El logo tiene que ser PNG, SVG o WebP." };
	if (file.size > LOGO_MAX_BYTES)
		return { ok: false, message: "El logo no puede pesar más de 1 MB." };
	return { ok: true, ext };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/tenants/tenant-form.test.ts`
Expected: PASS. Si falla el orden de los mensajes (por ejemplo, "alta por dominio" cuando se esperaba otro), revisar que el test que falla use un único campo inválido: `superRefine` de zod 4 no corre si el objeto base ya falló.

- [ ] **Step 5: Commit**

```bash
git add lib/tenants/tenant-form.ts tests/tenants/tenant-form.test.ts
git commit -m "feat: validación del formulario de tenant"
```

---

### Task 4: Server action `updateTenant`

**Files:**
- Create: `app/plataforma/[slug]/actions.ts`
- Modify: `next.config.ts`
- Test: `tests/plataforma/actions.test.ts`

**Interfaces:**
- Consumes: `requirePlatformAdmin`, `platformOwnerSlug` (Task 2); `readTenantForm`, `tenantInputSchema`, `mergeBrand`, `validateLogo` (Task 3).
- Produces:
  - `type TenantResult = { ok: true } | { ok: false; message: string }`
  - `updateTenant(tenantId: string, formData: FormData): Promise<TenantResult>`

- [ ] **Step 1: Escribir el test que falla** en `tests/plataforma/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const state: {
	admin: boolean;
	current: unknown;
	updateResult: { data: unknown; error: unknown };
	uploadError: unknown;
	updates: Record<string, unknown>[];
	uploads: { path: string; contentType?: string }[];
} = {
	admin: true,
	current: null,
	updateResult: { data: { id: TENANT_ID }, error: null },
	uploadError: null,
	updates: [],
	uploads: [],
};

const supabase = {
	from: () => ({
		select: () => ({
			eq: () => ({ maybeSingle: async () => ({ data: state.current }) }),
		}),
		update(values: Record<string, unknown>) {
			state.updates.push(values);
			return {
				eq: () => ({
					select: () => ({ maybeSingle: async () => state.updateResult }),
				}),
			};
		},
	}),
	storage: {
		from: () => ({
			upload: async (
				path: string,
				_file: unknown,
				options: { contentType?: string },
			) => {
				state.uploads.push({ path, contentType: options.contentType });
				return { error: state.uploadError };
			},
		}),
	},
};

vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { supabase, userId: "u1" } : null,
	platformOwnerSlug: () => "innovas",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateTenant } = await import("@/app/plataforma/[slug]/actions");

function form(overrides: Record<string, string | File | null> = {}) {
	const values: Record<string, string | File | null> = {
		display_name: "Demo",
		allowed_domains: "demo.test",
		allowed_models: "anthropic/claude-sonnet-5",
		default_model: "anthropic/claude-sonnet-5",
		primary: "#059669",
		secondary: "",
		active: "on",
		...overrides,
	};
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) {
		if (value !== null) data.set(key, value);
	}
	return data;
}

describe("updateTenant", () => {
	beforeEach(() => {
		state.admin = true;
		state.current = {
			id: TENANT_ID,
			slug: "demo",
			brand: { primary: "#000000", logo_url: "demo/logo.png", font: "Geist" },
		};
		state.updateResult = { data: { id: TENANT_ID }, error: null };
		state.uploadError = null;
		state.updates = [];
		state.uploads = [];
	});

	it("rechaza a quien no es platform_admin sin tocar la base", async () => {
		state.admin = false;

		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({ ok: false, message: "No tenés permiso." });
		expect(state.updates).toHaveLength(0);
	});

	it("rechaza un tenantId que no es uuid", async () => {
		const result = await updateTenant("no-es-uuid", form());

		expect(result.ok).toBe(false);
		expect(state.updates).toHaveLength(0);
	});

	it("devuelve el mensaje del campo inválido sin tocar la base", async () => {
		const result = await updateTenant(TENANT_ID, form({ display_name: "" }));

		expect(result).toEqual({
			ok: false,
			message: "El nombre no puede quedar vacío.",
		});
		expect(state.updates).toHaveLength(0);
	});

	it("escribe las columnas del formulario y mezcla brand", async () => {
		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({ ok: true });
		expect(state.updates[0]).toEqual({
			display_name: "Demo",
			allowed_domains: ["demo.test"],
			self_signup_by_domain: false,
			allowed_models: ["anthropic/claude-sonnet-5"],
			default_model: "anthropic/claude-sonnet-5",
			active: true,
			brand: { primary: "#059669", logo_url: "demo/logo.png", font: "Geist" },
		});
	});

	it("nunca escribe el slug", async () => {
		await updateTenant(TENANT_ID, form());

		expect(state.updates[0]).not.toHaveProperty("slug");
	});

	it("rechaza desactivar el tenant dueño", async () => {
		state.current = { id: TENANT_ID, slug: "innovas", brand: {} };

		const result = await updateTenant(TENANT_ID, form({ active: null }));

		expect(result).toEqual({
			ok: false,
			message: "El tenant dueño de la plataforma no se puede desactivar.",
		});
		expect(state.updates).toHaveLength(0);
	});

	it("deja desactivar otro tenant", async () => {
		const result = await updateTenant(TENANT_ID, form({ active: null }));

		expect(result).toEqual({ ok: true });
		expect(state.updates[0]?.active).toBe(false);
	});

	it("no toca el logo cuando el input de archivo llega vacío", async () => {
		await updateTenant(TENANT_ID, form({ logo: new File([], "") }));

		expect(state.uploads).toHaveLength(0);
		expect(state.updates[0]?.brand).toMatchObject({
			logo_url: "demo/logo.png",
		});
	});

	it("sube el logo nuevo a la carpeta del slug y guarda su path", async () => {
		const logo = new File(["png"], "marca.png", { type: "image/png" });

		await updateTenant(TENANT_ID, form({ logo }));

		expect(state.uploads).toHaveLength(1);
		expect(state.uploads[0]?.path).toMatch(/^demo\/logo-\d+\.png$/);
		expect(state.uploads[0]?.contentType).toBe("image/png");
		expect(state.updates[0]?.brand).toMatchObject({
			logo_url: state.uploads[0]?.path,
		});
	});

	it("rechaza un logo de tipo no permitido sin subir nada", async () => {
		const logo = new File(["x"], "marca.jpg", { type: "image/jpeg" });

		const result = await updateTenant(TENANT_ID, form({ logo }));

		expect(result).toEqual({
			ok: false,
			message: "El logo tiene que ser PNG, SVG o WebP.",
		});
		expect(state.uploads).toHaveLength(0);
		expect(state.updates).toHaveLength(0);
	});

	it("no guarda si la subida del logo falla", async () => {
		state.uploadError = { message: "boom" };
		const logo = new File(["png"], "marca.png", { type: "image/png" });

		const result = await updateTenant(TENANT_ID, form({ logo }));

		expect(result).toEqual({ ok: false, message: "No se pudo subir el logo." });
		expect(state.updates).toHaveLength(0);
	});

	it("contesta sin permiso si el tenant no se puede leer", async () => {
		state.current = null;

		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({ ok: false, message: "No tenés permiso." });
	});

	it("contesta sin permiso si la RLS filtró el update (sin error, sin fila)", async () => {
		state.updateResult = { data: null, error: null };

		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({ ok: false, message: "No tenés permiso." });
	});

	it("contesta un mensaje genérico si la base devuelve error", async () => {
		state.updateResult = { data: null, error: { code: "23514" } };

		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({
			ok: false,
			message: "No se pudieron guardar los cambios.",
		});
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/plataforma/actions.test.ts`
Expected: FAIL, no existe `@/app/plataforma/[slug]/actions`.

- [ ] **Step 3: Implementar `app/plataforma/[slug]/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { platformOwnerSlug, requirePlatformAdmin } from "@/lib/tenants/platform";
import {
	mergeBrand,
	readTenantForm,
	tenantInputSchema,
	validateLogo,
} from "@/lib/tenants/tenant-form";

const idSchema = z.uuid();

export type TenantResult = { ok: true } | { ok: false; message: string };

const SIN_PERMISO: TenantResult = { ok: false, message: "No tenés permiso." };
const INVALIDO: TenantResult = {
	ok: false,
	message: "No se pudo procesar el pedido.",
};
const NO_GUARDO: TenantResult = {
	ok: false,
	message: "No se pudieron guardar los cambios.",
};

/**
 * Edita un tenant desde la consola de plataforma. El gate de la aplicación es
 * `requirePlatformAdmin`; la RLS `tenants_update` es la segunda puerta: un
 * update que filtra entero no da error, devuelve cero filas.
 */
export async function updateTenant(
	tenantId: string,
	formData: FormData,
): Promise<TenantResult> {
	try {
		const admin = await requirePlatformAdmin();
		if (!admin) return SIN_PERMISO;
		if (!idSchema.safeParse(tenantId).success) return INVALIDO;

		const parsed = tenantInputSchema.safeParse(readTenantForm(formData));
		if (!parsed.success)
			return {
				ok: false,
				message: parsed.error.issues[0]?.message ?? INVALIDO.message,
			};
		const input = parsed.data;

		// Sin filtro por `active`: un tenant inactivo se edita igual, es la única
		// forma de reactivarlo.
		const { data: current } = await admin.supabase
			.from("tenants")
			.select("id, slug, brand")
			.eq("id", tenantId)
			.maybeSingle();
		if (!current) return SIN_PERMISO;

		// Desactivar al dueño deja la consola sin nadie que pueda entrar.
		if (!input.active && current.slug === platformOwnerSlug())
			return {
				ok: false,
				message: "El tenant dueño de la plataforma no se puede desactivar.",
			};

		let logoUrl: string | undefined;
		const logo = formData.get("logo");
		// Un input de archivo sin elegir manda un File vacío.
		if (logo instanceof File && logo.size > 0) {
			const checked = validateLogo(logo);
			if (!checked.ok) return checked;

			// Nombre nuevo en cada subida y sin upsert: pisar un objeto exige
			// policy de select en storage.objects, que el bucket no tiene. De paso
			// la URL cambia y no queda el logo viejo en caché.
			const path = `${current.slug}/logo-${Date.now()}.${checked.ext}`;
			const { error } = await admin.supabase.storage
				.from("brand")
				.upload(path, logo, { contentType: logo.type });
			if (error) return { ok: false, message: "No se pudo subir el logo." };
			logoUrl = path;
		}

		const { data, error } = await admin.supabase
			.from("tenants")
			.update({
				display_name: input.displayName,
				allowed_domains: input.allowedDomains,
				self_signup_by_domain: input.selfSignupByDomain,
				allowed_models: input.allowedModels,
				default_model: input.defaultModel,
				active: input.active,
				brand: mergeBrand(current.brand ?? {}, {
					primary: input.primary,
					secondary: input.secondary,
					logoUrl,
				}),
			})
			.eq("id", tenantId)
			.select("id")
			.maybeSingle();

		if (error) return NO_GUARDO;
		if (!data) return SIN_PERMISO;

		revalidatePath("/plataforma");
		revalidatePath(`/plataforma/${current.slug}`);
		revalidatePath(`/${current.slug}`, "layout");
		return { ok: true };
	} catch {
		return NO_GUARDO;
	}
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/plataforma/actions.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Subir el límite de body de las server actions.** El default de Next es 1 MB y el logo admite hasta 1 MB más los campos. En `next.config.ts`:

```ts
const nextConfig: NextConfig = {
	experimental: {
		// La consola de plataforma sube el logo del tenant (hasta 1 MB) por
		// server action; el default de 1 MB lo cortaría.
		serverActions: { bodySizeLimit: "2mb" },
	},
};
```

- [ ] **Step 6: Verificar todo**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/plataforma/[slug]/actions.ts" tests/plataforma/actions.test.ts next.config.ts
git commit -m "feat: server action para editar un tenant desde la consola"
```

---

### Task 5: Pantallas de la consola y entrada desde el badge

**Files:**
- Create: `lib/tenants/people.ts`
- Create: `app/plataforma/layout.tsx`
- Create: `app/plataforma/page.tsx`
- Create: `app/plataforma/[slug]/page.tsx`
- Create: `app/plataforma/[slug]/tenant-form.tsx`
- Modify: `app/[tenant]/settings/usuarios/page.tsx` (bloque `people`, hoy líneas 34-52)
- Modify: `app/[tenant]/layout.tsx` (el `<span>` del badge, hoy líneas 73-75)

**Interfaces:**
- Consumes: `requirePlatformAdmin`, `platformOwnerSlug` (Task 2); `parseList` (Task 3); `updateTenant`, `TenantResult` (Task 4).
- Produces: `loadPeople(userIds: string[]): Promise<Map<string, { name: string; email?: string }>>`

- [ ] **Step 1: Extraer `lib/tenants/people.ts`**

```ts
import { createAdminClient } from "@/lib/supabase/admin";

export interface Person {
	name: string;
	email?: string;
}

/**
 * Nombre y correo viven en auth.users, que la RLS no expone: se leen con el
 * cliente admin. Quien llama pasa solo `user_id` que una consulta con RLS ya
 * le autorizó a ver.
 */
export async function loadPeople(
	userIds: string[],
): Promise<Map<string, Person>> {
	const admin = createAdminClient();

	return new Map(
		await Promise.all(
			userIds.map(async (userId) => {
				const { data } = await admin.auth.admin.getUserById(userId);
				const meta = data.user?.user_metadata ?? {};
				const name =
					[meta.given_name, meta.family_name].filter(Boolean).join(" ") ||
					meta.full_name ||
					meta.name ||
					"";
				return [
					userId,
					{ name: name as string, email: data.user?.email },
				] as const;
			}),
		),
	);
}
```

- [ ] **Step 2: Usarlo en `/settings/usuarios`.** En `app/[tenant]/settings/usuarios/page.tsx` borrar el import de `createAdminClient`, agregar `import { loadPeople } from "@/lib/tenants/people";` y reemplazar desde el comentario `// Nombre y correo viven en auth.users...` hasta el cierre del `new Map(...)` por:

```ts
	const people = await loadPeople(
		(memberships ?? []).map(({ user_id }) => user_id),
	);
```

- [ ] **Step 3: Crear `app/plataforma/layout.tsx`**

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

// Sin gate acá: un layout no se vuelve a ejecutar en cada navegación. Cada
// página de la consola llama a requirePlatformAdmin().
export default function PlataformaLayout({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 md:px-6">
					<Link
						href="/plataforma"
						className="min-w-0 flex-1 truncate font-semibold tracking-display"
					>
						Plataforma
					</Link>
					<Link
						href="/"
						className="inline-flex min-h-11 shrink-0 items-center text-muted-foreground text-sm hover:text-foreground"
					>
						Volver a los clientes
					</Link>
				</div>
			</header>
			<main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
				{children}
			</main>
		</div>
	);
}
```

- [ ] **Step 4: Crear el listado `app/plataforma/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { platformOwnerSlug, requirePlatformAdmin } from "@/lib/tenants/platform";

interface TenantListRow {
	id: string;
	slug: string;
	display_name: string;
	active: boolean;
	created_at: string;
}

export default async function PlataformaPage() {
	const admin = await requirePlatformAdmin();
	// 404 y no 403: un 403 confirma que la consola existe.
	if (!admin) notFound();

	// La RLS le muestra al platform_admin todos los tenants, activos o no, y
	// todas las memberships: de ahí sale la cantidad de usuarios.
	const [tenantsResult, membershipsResult] = await Promise.all([
		admin.supabase
			.from("tenants")
			.select("id, slug, display_name, active, created_at")
			.order("display_name")
			.returns<TenantListRow[]>(),
		admin.supabase
			.from("memberships")
			.select("tenant_id")
			.returns<{ tenant_id: string }[]>(),
	]);

	const tenants = tenantsResult.data ?? [];
	const users = new Map<string, number>();
	for (const { tenant_id } of membershipsResult.data ?? []) {
		users.set(tenant_id, (users.get(tenant_id) ?? 0) + 1);
	}
	const ownerSlug = platformOwnerSlug();

	return (
		<div className="max-w-3xl">
			<h1 className="mb-4 text-3xl leading-tight">Empresas</h1>
			{tenants.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Todavía no hay empresas cargadas.
				</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{tenants.map((tenant) => (
						<li key={tenant.id}>
							<Link
								href={`/plataforma/${tenant.slug}`}
								className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-muted"
							>
								<div className="min-w-0 flex-1">
									<div className="truncate">{tenant.display_name}</div>
									<div className="truncate text-muted-foreground text-sm">
										{tenant.slug}
									</div>
								</div>
								{tenant.slug === ownerSlug ? (
									<span className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
										Dueño de la plataforma
									</span>
								) : null}
								<span className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
									{tenant.active ? "Activo" : "Inactivo"}
								</span>
								<span className="text-muted-foreground text-sm">
									{users.get(tenant.id) ?? 0} usuarios
								</span>
								<span className="text-muted-foreground text-sm">
									{new Date(tenant.created_at).toLocaleDateString("es-AR")}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
```

- [ ] **Step 5: Crear el formulario `app/plataforma/[slug]/tenant-form.tsx`**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseList } from "@/lib/tenants/tenant-form";
import { updateTenant } from "./actions";

export interface TenantFormValues {
	id: string;
	slug: string;
	displayName: string;
	allowedDomains: string[];
	selfSignupByDomain: boolean;
	allowedModels: string[];
	defaultModel: string;
	primary: string;
	secondary: string;
	logoSrc: string | null;
	active: boolean;
}

export function TenantForm({
	tenant,
	isOwner,
}: {
	tenant: TenantFormValues;
	isOwner: boolean;
}) {
	const formRef = useRef<HTMLFormElement>(null);
	const [models, setModels] = useState(tenant.allowedModels.join("\n"));
	const [defaultModel, setDefaultModel] = useState(tenant.defaultModel);
	const [active, setActive] = useState(tenant.active);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const modelOptions = parseList(models);

	function save() {
		const form = formRef.current;
		if (!form) return;
		const formData = new FormData(form);
		startTransition(async () => {
			const result = await updateTenant(tenant.id, formData);
			setMessage(result.ok ? null : result.message);
			setSaved(result.ok);
		});
	}

	return (
		<form
			ref={formRef}
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				setSaved(false);
				// Desactivar deja al cliente en 404 para todos sus usuarios: se
				// confirma antes de guardar.
				if (tenant.active && !active) setConfirmOpen(true);
				else save();
			}}
		>
			<div className="space-y-1">
				<label htmlFor="display_name" className="text-sm">
					Nombre
				</label>
				<Input
					id="display_name"
					name="display_name"
					defaultValue={tenant.displayName}
					maxLength={80}
					required
				/>
			</div>

			<div className="space-y-1">
				<span className="text-sm">Slug</span>
				<p className="rounded-md border bg-muted px-3 py-2 text-muted-foreground text-sm">
					{tenant.slug}
				</p>
				<p className="text-muted-foreground text-xs">
					No se edita: cambiarlo rompe las direcciones del cliente.
				</p>
			</div>

			<div className="space-y-1">
				<label htmlFor="allowed_domains" className="text-sm">
					Dominios permitidos
				</label>
				<Textarea
					id="allowed_domains"
					name="allowed_domains"
					rows={3}
					defaultValue={tenant.allowedDomains.join("\n")}
				/>
				<p className="text-muted-foreground text-xs">Uno por línea.</p>
			</div>

			<label className="flex min-h-11 items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="self_signup_by_domain"
					defaultChecked={tenant.selfSignupByDomain}
				/>
				Permitir el alta a quien tenga un correo de esos dominios
			</label>

			<div className="space-y-1">
				<label htmlFor="allowed_models" className="text-sm">
					Modelos permitidos
				</label>
				<Textarea
					id="allowed_models"
					name="allowed_models"
					rows={3}
					value={models}
					onChange={(event) => setModels(event.target.value)}
				/>
				<p className="text-muted-foreground text-xs">
					Uno por línea, como proveedor/modelo.
				</p>
			</div>

			<div className="space-y-1">
				<label htmlFor="default_model" className="text-sm">
					Modelo por defecto
				</label>
				<select
					id="default_model"
					name="default_model"
					className="h-11 w-full rounded-md border bg-background px-3 text-sm"
					value={defaultModel}
					onChange={(event) => setDefaultModel(event.target.value)}
				>
					{/* Si el default actual salió de la lista, se sigue mostrando: la
					    action lo rechaza con el mensaje del campo en vez de que el
					    select cambie de valor sin avisar. */}
					{[...new Set([defaultModel, ...modelOptions])].map((model) => (
						<option key={model} value={model}>
							{model}
						</option>
					))}
				</select>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1">
					<label htmlFor="primary" className="text-sm">
						Color primario
					</label>
					<Input
						id="primary"
						name="primary"
						defaultValue={tenant.primary}
						placeholder="#1D4ED8"
					/>
				</div>
				<div className="space-y-1">
					<label htmlFor="secondary" className="text-sm">
						Color secundario
					</label>
					<Input
						id="secondary"
						name="secondary"
						defaultValue={tenant.secondary}
						placeholder="#0F172A"
					/>
				</div>
			</div>

			<div className="space-y-2">
				<label htmlFor="logo" className="text-sm">
					Logo
				</label>
				{tenant.logoSrc ? (
					// biome-ignore lint/performance/noImgElement: el logo es del cliente, sin loader
					<img
						src={tenant.logoSrc}
						alt={`Logo de ${tenant.displayName}`}
						className="h-auto max-h-10 w-auto max-w-[180px]"
					/>
				) : null}
				<input
					id="logo"
					name="logo"
					type="file"
					accept="image/png,image/svg+xml,image/webp"
					className="block text-sm"
				/>
				<p className="text-muted-foreground text-xs">
					PNG, SVG o WebP de hasta 1 MB.
				</p>
			</div>

			<div className="space-y-1">
				<label className="flex min-h-11 items-center gap-2 text-sm">
					{/* disabled saca al checkbox del form: el hidden mantiene `active`. */}
					{isOwner ? <input type="hidden" name="active" value="on" /> : null}
					<input
						type="checkbox"
						name="active"
						checked={active}
						disabled={isOwner}
						onChange={(event) => setActive(event.target.checked)}
					/>
					Activo
				</label>
				{isOwner ? (
					<p className="text-muted-foreground text-xs">
						El tenant dueño de la plataforma no se puede desactivar.
					</p>
				) : null}
			</div>

			<div className="flex flex-wrap items-center gap-3">
				<Button type="submit" size="lg" disabled={isPending}>
					{isPending ? "Guardando…" : "Guardar"}
				</Button>
				{message ? (
					<p role="alert" className="text-destructive text-sm">
						{message}
					</p>
				) : null}
				{saved ? (
					<output className="text-muted-foreground text-sm">
						Cambios guardados.
					</output>
				) : null}
			</div>

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							¿Desactivar {tenant.displayName}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Sus usuarios dejan de poder entrar hasta que lo vuelvas a activar
							desde esta pantalla.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancelar</AlertDialogCancel>
						<AlertDialogAction onClick={save}>Desactivar</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</form>
	);
}
```

- [ ] **Step 6: Crear el detalle `app/plataforma/[slug]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPeople } from "@/lib/tenants/people";
import { platformOwnerSlug, requirePlatformAdmin } from "@/lib/tenants/platform";
import { brandFromRow, type TenantRole } from "@/lib/tenants/resolve";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import { TenantForm } from "./tenant-form";

interface TenantDetailRow {
	id: string;
	slug: string;
	display_name: string;
	allowed_domains: string[];
	self_signup_by_domain: boolean;
	allowed_models: string[];
	default_model: string;
	brand: Record<string, unknown>;
	active: boolean;
}

export default async function TenantDetailPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const admin = await requirePlatformAdmin();
	if (!admin) notFound();

	// Sin filtro por `active`, a diferencia de resolveTenantAccess: un tenant
	// inactivo se abre acá, que es donde se lo reactiva.
	const { data: tenant } = await admin.supabase
		.from("tenants")
		.select(
			"id, slug, display_name, allowed_domains, self_signup_by_domain, allowed_models, default_model, brand, active",
		)
		.eq("slug", slug)
		.maybeSingle<TenantDetailRow>();
	if (!tenant) notFound();

	const { data: memberships } = await admin.supabase
		.from("memberships")
		.select("id, role, user_id")
		.eq("tenant_id", tenant.id)
		.returns<{ id: string; role: TenantRole; user_id: string }[]>();
	const people = await loadPeople(
		(memberships ?? []).map(({ user_id }) => user_id),
	);

	const brand = brandFromRow(tenant);
	const logoSrc = brand.logoUrl
		? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand/${brand.logoUrl}`
		: null;

	return (
		<div className="max-w-3xl space-y-10">
			<section>
				<Link
					href="/plataforma"
					className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
				>
					← Empresas
				</Link>
				<div className="mb-4 flex flex-wrap items-center gap-3">
					<h1 className="text-3xl leading-tight">{tenant.display_name}</h1>
					{tenant.active ? (
						<Link
							href={`/${tenant.slug}/chat`}
							className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
						>
							Abrir
						</Link>
					) : (
						<span className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
							Inactivo
						</span>
					)}
				</div>
				<TenantForm
					// La key fuerza a remontar el form cuando la fila cambia tras
					// guardar: sin eso los defaultValue quedan con lo viejo.
					key={JSON.stringify(tenant)}
					tenant={{
						id: tenant.id,
						slug: tenant.slug,
						displayName: tenant.display_name,
						allowedDomains: tenant.allowed_domains,
						selfSignupByDomain: tenant.self_signup_by_domain,
						allowedModels: tenant.allowed_models,
						defaultModel: tenant.default_model,
						primary: brand.primary ?? "",
						secondary: brand.secondary ?? "",
						logoSrc,
						active: tenant.active,
					}}
					isOwner={tenant.slug === platformOwnerSlug()}
				/>
			</section>

			<section>
				<div className="mb-3 flex flex-wrap items-center gap-3">
					<h2 className="text-lg">Usuarios</h2>
					{tenant.active ? (
						<Link
							href={`/${tenant.slug}/settings/usuarios`}
							className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
						>
							Administrar
						</Link>
					) : null}
				</div>
				{(memberships ?? []).length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Este cliente todavía no tiene usuarios.
					</p>
				) : (
					<ul className="divide-y rounded-lg border bg-card">
						{(memberships ?? []).map((membership) => (
							<li
								key={membership.id}
								className="flex items-center gap-3 px-4 py-3"
							>
								<div className="min-w-0 flex-1">
									<div>{people.get(membership.user_id)?.name || "Sin nombre"}</div>
									<div className="truncate text-muted-foreground text-sm">
										{people.get(membership.user_id)?.email}
									</div>
								</div>
								<span className="text-muted-foreground text-sm">
									{ROLE_LABELS[membership.role]}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
```

- [ ] **Step 7: Volver link el badge.** En `app/[tenant]/layout.tsx` reemplazar el `<span>` del badge (el que muestra `ROLE_LABELS[tenant.role]`) por:

```tsx
					{tenant.role === "platform_admin" ? (
						// Visible también en mobile, a diferencia del badge de los otros
						// roles: es la única entrada a la consola de plataforma.
						<Link
							href="/plataforma"
							className="inline-flex min-h-11 shrink-0 items-center"
						>
							<span className="whitespace-nowrap rounded-full border px-2 py-0.5 text-muted-foreground text-xs transition-colors hover:border-input hover:text-foreground">
								{ROLE_LABELS[tenant.role]}
							</span>
						</Link>
					) : (
						<span className="hidden shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-muted-foreground text-xs sm:inline-block">
							{ROLE_LABELS[tenant.role]}
						</span>
					)}
```

- [ ] **Step 8: Verificar tipos, tests y formato**

Run: `npm run typecheck && npm test && npm run lint:fix`
Expected: PASS. Después de `lint:fix`, `git status --short` y revertir con `git checkout -- <archivo>` todo archivo que no figure en la lista **Files** de este plan.

- [ ] **Step 9: Verificar en el navegador.** Levantar el dev server con `preview_start` (configuración de `.claude/launch.json`; nunca con Bash) y correr `/qa` con estos casos, contra la base local sembrada (`npm run db:reset`, `PLATFORM_OWNER_TENANT_SLUG=innovas-seed`):

1. Como `admin-seed@innov.as`: en `/innovas-seed/chat` el badge "Administrador de la plataforma" es un link; lleva a `/plataforma`.
2. `/plataforma` lista INNOV.AS y Demo, con INNOV.AS marcado como dueño.
3. En `/plataforma/demo`: cambiar el nombre, guardar, ver "Cambios guardados." y el nombre nuevo en `/demo/chat`.
4. Pegar `@Demo.TEST, otro.test` en dominios: se guarda como `demo.test` y `otro.test`.
5. Sacar de los modelos permitidos el que está como default: aparece "El modelo por defecto tiene que estar entre los permitidos."
6. Subir un PNG chico como logo: se ve en el detalle y en el header de `/demo/chat`.
7. Desactivar Demo: pide confirmación; al confirmar, `/demo/chat` da 404 y `/plataforma/demo` sigue abriendo con la marca "Inactivo" (Review Focus 5). Reactivarlo.
8. En `/plataforma/innovas-seed` el checkbox "Activo" está deshabilitado.
9. Como `ana@demo.test` (tenant_admin): `/plataforma` y `/plataforma/demo` dan 404, y en `/demo/chat` el badge no es link.
10. A 375px de ancho: el badge-link se ve en el header de un platform_admin y el listado no desborda.
11. Sin errores en la consola del navegador ni en los logs del server.

- [ ] **Step 10: Commit**

```bash
git add lib/tenants/people.ts app/plataforma "app/[tenant]/layout.tsx" "app/[tenant]/settings/usuarios/page.tsx"
git commit -m "feat: consola de plataforma con listado, detalle y edición de tenants"
```

---

### Task 6: Salida a producción (cada paso con confirmación de Matías)

- [ ] **Step 1: Variable en Vercel.** Mostrarle a Matías el comando y esperar el sí: `PLATFORM_OWNER_TENANT_SLUG` con el slug real del tenant de INNOV.AS en producción, en los entornos production y preview. Tiene que estar cargada **antes** del deploy: sin ella nadie ve el rol de plataforma en la UI y la consola da 404.
- [ ] **Step 2: Migración.** Correr `npx supabase migration list`, mostrarle a Matías todas las pendientes (no solo la de este plan) y aplicar con `db push` solo con su confirmación.
- [ ] **Step 3: PR** con `/ship`.
- [ ] **Step 4: Criterio de cierre del spec.** Matías entra a `/plataforma` en producción desde el badge, abre un tenant, cambia un dato y lo ve reflejado en ese tenant.
