# Etapa 13 · Pipeline de GTM — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una persona defina un foco de búsqueda y el sistema descubra empresas y personas en Apollo, las califique contra el ICP con Jev, revele el email solo de las que pasan, y deje la pieza en la cola que ya existe.

**Architecture:** Cuatro workflows encadenados sobre los rieles de la Etapa 12 (`work_items`, `enqueue()`, runner, dispatcher). Apollo entra por un `LeadsAdapter`, espejo del `CrmAdapter` que ya existe. Jev entra por el AI Gateway como un modelo más, con `evaluate()` en vez de `generateText()`. Ningún workflow pasa de nivel 1: el último deja la pieza `pending` y ahí se frena.

**Tech Stack:** Next.js 16 · eve 0.54.2 (pinneado) · `ai` 7 por Vercel AI Gateway · Supabase Postgres con RLS · vitest · pgTAP · Biome.

**Spec:** `docs/superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md`. Leerla entera antes de empezar.

## Alcance de este documento

La spec parte la etapa en cuatro entregas. Este plan detalla **E1 (descubrimiento) y E2 (calificación)** tarea por tarea, con código. **E3 y E4 quedan con alcance e interfaces fijados** al final, y se detallan al cerrar E2 — E3 depende de lo que E1 y E2 dejen construido, y de los topes reales que salgan del spike S5.

## Global Constraints

- **La Etapa 12 tiene que estar implementada antes de empezar.** Su spec y su plan ya están en `main` (PR #29); lo que falta es el código. Este plan consume `lib/workflows/` (registry, runner, enqueue, types, store), la tabla `work_items`, `tenant_workflows`, `tenant_budgets` y `usage_entries`. Sin eso no hay dónde apoyarse.
- **eve queda en `0.54.2`.** No se sube en esta etapa.
- **En `agents/` los imports son relativos**, nunca `@/`: eve no resuelve los paths de tsconfig en los módulos que compila. Lo mismo en `lib/` para todo lo que importe algo de `agents/`. En `tests/` se usa `@/`.
- **Toda tabla nueva lleva `tenant_id` y RLS.** Lectura para `(select public.is_member_of(tenant_id)) or (select public.is_platform_admin())`; `insert/update/delete` revocados a `authenticated` y `anon`.
- **Antes de tocar SQL, cargar la skill `supabase-postgres-best-practices`.**
- **Rechazo es resultado, no excepción:** `{ ok: false, reason, message }` de `lib/outreach/result.ts`. Una excepción queda para infraestructura caída, que es lo único que el runner reintenta.
- **Ningún secreto en logs ni en mensajes de error.** Los adapters cortan el cuerpo del error a 300 caracteres, como hace `hubspot-adapter`.
- **Español rioplatense** en comentarios, mensajes y docs. Código e identificadores en inglés.
- **Commits** con prefijo `feat:` / `fix:` / `docs:` / `refactor:` / `test:`, en castellano. Identidad git: `innovasbuild` / `matias@innov.as`.
- **`npm run lint:fix` reformatea 4 archivos ajenos.** Revertirlos con `git checkout -- <archivo>` antes de commitear.
- **Después de cada tarea:** `npm run typecheck` y `npm test` en verde. Las tareas con SQL suman `npm run db:test` (necesita Docker y `npm run db:start`).
- **Datos personales de terceros:** las llamadas a Jev van con `providerOptions: { gateway: { zeroDataRetention: true } }`. Nunca un email o nombre de prospecto en un `console.log`.

## Mapa de archivos

| Archivo | Responsabilidad | Entrega |
|---|---|---|
| `scripts/spike-apollo.mts` | S3, S4, S5: forma real de las respuestas de Apollo | E1 |
| `lib/connectors/leads/adapter.ts` | Interfaz `LeadsAdapter` y sus tipos | E1 |
| `lib/connectors/leads/apollo.ts` | Errores tipados de Apollo | E1 |
| `lib/connectors/leads/apollo-adapter.ts` | `createApolloAdapter`, con fallback entre llaves | E1 |
| `supabase/migrations/*_search_focuses.sql` | `search_focuses` + alters de `accounts` y `contacts` | E1 |
| `supabase/tests/15_search_focuses.test.sql` | RLS de lo nuevo | E1 |
| `lib/outreach/focus.ts` | `TargetCriteria`, validación zod, `focusInputHash` | E1 |
| `lib/outreach/services/target-search.ts` | El nodo `leads/search-targets` | E1 |
| `lib/outreach/workflows/target-search.ts` | El `WorkflowImpl` | E1 |
| `scripts/outreach-focus.mts` | Crear un foco por CLI, hasta que exista la pantalla | E1 |
| `lib/workflows/types.ts` (modificar) | `ItemOutcome` admite varios sujetos aguas abajo | E1 |
| `lib/outreach/services/evaluate.ts` | Envoltorio de `evaluate()` con Jev, medido | E2 |
| `lib/outreach/icp.ts` | La política de decisión, función pura | E2 |
| `lib/outreach/services/icp-score.ts` | El nodo `outreach/icp-score` | E2 |
| `lib/outreach/workflows/icp-scoring.ts` | El `WorkflowImpl` | E2 |
| `lib/outreach/config.ts` (modificar) | Los niveles del ICP en la config del tenant | E2 |

---

# Entrega 1 · Descubrimiento

### Task 1: Spike de Apollo (S3, S4, S5)

**Files:**
- Create: `scripts/spike-apollo.mts`
- Modify: `docs/superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md` (§12, filas S3/S4/S5)

**Interfaces:**
- Produces: la forma real de las tres respuestas. La Task 2 escribe el parser contra lo que esto devuelva. **Si la forma difiere de lo que asume la Task 2, gana lo observado acá.**

- [ ] **Step 1: Escribir el script**

```ts
// scripts/spike-apollo.mts
// Spike S3/S4/S5 (spec etapa 13 §12). Corre a mano, una vez, con una llave
// real. No es código de producción: se borra al cerrar E1.
// Uso: APOLLO_KEY=... node scripts/spike-apollo.mts
const KEY = process.env.APOLLO_KEY;
if (!KEY) throw new Error("falta APOLLO_KEY");

async function call(path: string, body: unknown) {
	const response = await fetch(`https://api.apollo.io/api/v1${path}`, {
		method: "POST",
		headers: { "x-api-key": KEY as string, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await response.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* se imprime el texto crudo */
	}
	return { status: response.status, json, text: text.slice(0, 600) };
}

// S5: ¿cuántas empresas y personas devuelve con filtros realistas?
const orgs = await call("/mixed_companies/search", {
	organization_num_employees_ranges: ["50,200"],
	organization_locations: ["Buenos Aires, Argentina"],
	page: 1,
	per_page: 25,
});
console.log("ORG status:", orgs.status);
console.log("ORG top-level keys:", Object.keys((orgs.json as object) ?? {}));
console.log("ORG pagination:", (orgs.json as Record<string, unknown>)?.pagination);
const orgList =
	((orgs.json as Record<string, unknown>)?.organizations as unknown[]) ?? [];
console.log("ORG count:", orgList.length);
console.log("ORG primer registro:", JSON.stringify(orgList[0], null, 2)?.slice(0, 1500));

// S5: personas dentro de esas empresas
const orgIds = orgList
	.slice(0, 3)
	.map((o) => (o as Record<string, unknown>).id)
	.filter(Boolean);
const people = await call("/mixed_people/search", {
	organization_ids: orgIds,
	person_titles: ["owner", "founder", "gerente general", "director"],
	page: 1,
	per_page: 25,
});
console.log("PEOPLE status:", people.status);
console.log("PEOPLE top-level keys:", Object.keys((people.json as object) ?? {}));
const peopleList =
	((people.json as Record<string, unknown>)?.people as unknown[]) ?? [];
console.log("PEOPLE count:", peopleList.length);
console.log("PEOPLE primer registro:", JSON.stringify(peopleList[0], null, 2)?.slice(0, 1500));

// S3: ¿informa créditos consumidos en algún header o campo?
console.log("ORG texto crudo (primeros 600):", orgs.text);
```

- [ ] **Step 2: Correrlo**

Run: `APOLLO_KEY=<tu llave> node scripts/spike-apollo.mts`

Anotar, sin pegar la llave en ningún lado: (a) las claves de primer nivel de cada respuesta — en particular si la búsqueda de empresas devuelve solo `organizations` o también `accounts`; (b) los nombres exactos de los campos de una empresa (`primary_domain`, `estimated_num_employees`, `industry`, …) y de una persona (`title`, `linkedin_url`, `organization_id`); (c) si aparece algún campo o header con créditos consumidos; (d) cuántos resultados devuelve con filtros realistas.

- [ ] **Step 3: Forzar el caso sin créditos (S4)**

Si la cuenta de prueba tiene créditos, este caso no se puede forzar sin gastarlos. Dos caminos, en orden: si Apollo expone el endpoint de uso, consultarlo y anotar el saldo; si no, dejar S4 como **no verificado** y quedarse con la heurística de la Task 3 (4xx no-401 con "credit" o "insufficient" en el cuerpo), anotando en la spec que se ajusta con el primer caso real en producción. No inventar un caso de prueba gastando créditos a propósito.

- [ ] **Step 4: Anotar los resultados en la spec**

En §12, reemplazar las celdas "Si da que no" de S3, S4 y S5 por lo observado, con este formato y sin secretos:

```md
| S3 | ... | `usage_entries` | **Resultado (2026-09-DD):** <lo observado sobre créditos informados>. <consecuencia> |
```

- [ ] **Step 5: Commit**

```bash
git add scripts/spike-apollo.mts docs/superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md
git commit -m "docs: resultado de los spikes de Apollo (S3, S4, S5)"
```

---

### Task 2: `LeadsAdapter` y el adapter de Apollo

**Files:**
- Create: `lib/connectors/leads/adapter.ts`
- Create: `lib/connectors/leads/apollo.ts`
- Create: `lib/connectors/leads/apollo-adapter.ts`
- Test: `tests/connectors/apollo-adapter.test.ts`

**Interfaces:**
- Consumes: la forma real de las respuestas, de la Task 1.
- Produces:
  - `interface LeadOrganization { externalId: string; name: string; domain: string | null; linkedinUrl: string | null; employees: number | null; industry: string | null; location: string | null; foundedYear: number | null }`
  - `interface LeadPerson { externalId: string; name: string; title: string | null; linkedinSlug: string | null; organizationExternalId: string | null }`
  - `interface TargetCriteria { employeeRanges: string[]; locations: string[]; keywords: string[]; titles: string[] }`
  - `interface LeadsAdapter` con `searchOrganizations`, `searchPeople`, `revealEmail` (firmas en el código de abajo)
  - `class ApolloUnauthorizedError extends Error`, `class ApolloOutOfCreditsError extends Error`
  - `createApolloAdapter(keys: string[], fetchImpl?: typeof fetch): LeadsAdapter`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/connectors/apollo-adapter.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ApolloOutOfCreditsError,
	ApolloUnauthorizedError,
} from "@/lib/connectors/leads/apollo";
import { createApolloAdapter } from "@/lib/connectors/leads/apollo-adapter";

afterEach(() => vi.unstubAllGlobals());

const CRITERIA = {
	employeeRanges: ["50,200"],
	locations: ["Buenos Aires, Argentina"],
	keywords: ["envases"],
	titles: ["owner", "gerente general"],
};

const ORG = {
	id: "org1",
	name: "Acme",
	primary_domain: "acme.test",
	website_url: "https://acme.test",
	linkedin_url: "https://linkedin.com/company/acme",
	estimated_num_employees: 120,
	industry: "packaging",
	city: "Rosario",
	country: "Argentina",
	founded_year: 1998,
};

const PERSON = {
	id: "p1",
	name: "Laura Gómez",
	title: "Gerente General",
	linkedin_url: "https://linkedin.com/in/laura-gomez",
	organization_id: "org1",
};

describe("searchOrganizations", () => {
	it("manda la llave en x-api-key y traduce los campos de Apollo", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			Response.json({
				organizations: [ORG],
				pagination: { page: 1, total_pages: 3 },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await createApolloAdapter(["k1"]).searchOrganizations(
			CRITERIA,
			1,
		);

		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toContain("/mixed_companies/search");
		expect(
			(init?.headers as Record<string, string>)["x-api-key"],
		).toBe("k1");
		expect(result.organizations[0]).toEqual({
			externalId: "org1",
			name: "Acme",
			domain: "acme.test",
			linkedinUrl: "https://linkedin.com/company/acme",
			employees: 120,
			industry: "packaging",
			location: "Rosario, Argentina",
			foundedYear: 1998,
		});
		expect(result.hasMore).toBe(true);
		expect(result.creditsUsed).toBe(1);
	});

	it("una empresa sin dominio viaja con domain en null, no se inventa", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({
				organizations: [{ ...ORG, primary_domain: null, website_url: null }],
				pagination: { page: 1, total_pages: 1 },
			}),
		);
		const result = await createApolloAdapter(["k1"]).searchOrganizations(
			CRITERIA,
			1,
		);
		expect(result.organizations[0].domain).toBeNull();
		expect(result.hasMore).toBe(false);
	});

	it("lee también la clave accounts si Apollo la usa", async () => {
		// mixed_companies puede devolver las guardadas en la cuenta aparte.
		vi.stubGlobal("fetch", async () =>
			Response.json({
				accounts: [ORG],
				pagination: { page: 1, total_pages: 1 },
			}),
		);
		const result = await createApolloAdapter(["k1"]).searchOrganizations(
			CRITERIA,
			1,
		);
		expect(result.organizations).toHaveLength(1);
	});
});

describe("searchPeople", () => {
	it("filtra por empresa y cargo, y saca el slug de LinkedIn", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			Response.json({ people: [PERSON], pagination: { page: 1, total_pages: 1 } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await createApolloAdapter(["k1"]).searchPeople(
			CRITERIA,
			["org1"],
			1,
		);

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.organization_ids).toEqual(["org1"]);
		expect(body.person_titles).toEqual(CRITERIA.titles);
		expect(result.people[0]).toEqual({
			externalId: "p1",
			name: "Laura Gómez",
			title: "Gerente General",
			linkedinSlug: "laura-gomez",
			organizationExternalId: "org1",
		});
		// La búsqueda de personas no revela emails: no cuesta crédito de revelado.
		expect(result.creditsUsed).toBe(1);
	});
});

describe("revealEmail", () => {
	it("devuelve el email y cuenta un crédito", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({ person: { id: "p1", email: "laura@acme.test" } }),
		);
		const result = await createApolloAdapter(["k1"]).revealEmail("p1");
		expect(result).toEqual({ email: "laura@acme.test", creditsUsed: 1 });
	});

	it("un email bloqueado de Apollo cuenta como sin email, no como error", async () => {
		// Apollo devuelve este literal cuando no puede revelarlo.
		vi.stubGlobal("fetch", async () =>
			Response.json({ person: { id: "p1", email: "email_not_unlocked@domain.com" } }),
		);
		const result = await createApolloAdapter(["k1"]).revealEmail("p1");
		expect(result.email).toBeNull();
	});
});

describe("errores", () => {
	it("un 401 es ApolloUnauthorizedError", async () => {
		vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
		await expect(
			createApolloAdapter(["k1"]).searchOrganizations(CRITERIA, 1),
		).rejects.toBeInstanceOf(ApolloUnauthorizedError);
	});

	it("un 429 tira un error común, que el runner reintenta con espera", async () => {
		vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429 }));
		await expect(
			createApolloAdapter(["k1"]).searchOrganizations(CRITERIA, 1),
		).rejects.toThrow("429");
	});

	it("el error no filtra la llave ni el cuerpo entero", async () => {
		vi.stubGlobal(
			"fetch",
			async () => new Response("x".repeat(5000), { status: 500 }),
		);
		const error = await createApolloAdapter(["secreta"])
			.searchOrganizations(CRITERIA, 1)
			.catch((e: Error) => e);
		expect(String(error)).not.toContain("secreta");
		expect(String(error).length).toBeLessThan(500);
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/connectors/apollo-adapter.test.ts`
Esperado: FALLA con módulos inexistentes.

- [ ] **Step 3: Escribir la interfaz**

```ts
// lib/connectors/leads/adapter.ts
// Capacidad leads escrita contra la interfaz, no contra el proveedor
// (arquitectura D2, spec etapa 13 §5.1). Apollo es la primera implementación.

export interface TargetCriteria {
	/** Rangos de Apollo, tal cual: "50,200". */
	employeeRanges: string[];
	locations: string[];
	keywords: string[];
	titles: string[];
}

export interface LeadOrganization {
	externalId: string;
	name: string;
	/** Sin dominio no hay research ni ancla: el nodo la descarta. */
	domain: string | null;
	linkedinUrl: string | null;
	employees: number | null;
	industry: string | null;
	location: string | null;
	foundedYear: number | null;
}

export interface LeadPerson {
	externalId: string;
	name: string;
	title: string | null;
	linkedinSlug: string | null;
	organizationExternalId: string | null;
}

export interface LeadsAdapter {
	searchOrganizations(
		criteria: TargetCriteria,
		page: number,
	): Promise<{
		organizations: LeadOrganization[];
		hasMore: boolean;
		creditsUsed: number;
	}>;
	searchPeople(
		criteria: TargetCriteria,
		organizationExternalIds: string[],
		page: number,
	): Promise<{ people: LeadPerson[]; hasMore: boolean; creditsUsed: number }>;
	/** Revelar un email cuesta un crédito por cabeza: por eso se llama después de calificar. */
	revealEmail(
		personExternalId: string,
	): Promise<{ email: string | null; creditsUsed: number }>;
}
```

```ts
// lib/connectors/leads/apollo.ts
// Errores tipados, en su propio archivo para que los importe quien los
// atrapa sin arrastrar el adapter entero (mismo patrón que crm/hubspot.ts).

export class ApolloUnauthorizedError extends Error {
	constructor() {
		super("Apollo rechazó la llave");
		this.name = "ApolloUnauthorizedError";
	}
}

/** Dispara el fallback a la siguiente llave del tenant. */
export class ApolloOutOfCreditsError extends Error {
	constructor() {
		super("la llave de Apollo se quedó sin créditos");
		this.name = "ApolloOutOfCreditsError";
	}
}
```

- [ ] **Step 4: Escribir el adapter**

```ts
// lib/connectors/leads/apollo-adapter.ts
// Apollo por REST (spec etapa 13 §5.1). Una llave por llamada; el fallback
// entre llaves lo agrega la Task 3 envolviendo esta misma función.
import { linkedinSlug } from "../../outreach/contact-key";
import type {
	LeadOrganization,
	LeadPerson,
	LeadsAdapter,
	TargetCriteria,
} from "./adapter";
import { ApolloOutOfCreditsError, ApolloUnauthorizedError } from "./apollo";

const API = "https://api.apollo.io/api/v1";
const TIMEOUT_MS = 20_000;
export const PER_PAGE = 100;

/** Apollo devuelve este literal cuando no puede revelar el email. */
const LOCKED_EMAIL = "email_not_unlocked";

type Row = Record<string, unknown>;

const str = (row: Row, key: string): string | null => {
	const value = row[key];
	return typeof value === "string" && value.trim() !== "" ? value : null;
};

const num = (row: Row, key: string): number | null => {
	const value = row[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
};

function toOrganization(row: Row): LeadOrganization {
	const city = str(row, "city");
	const country = str(row, "country");
	return {
		externalId: String(row.id ?? ""),
		name: str(row, "name") ?? "",
		domain: str(row, "primary_domain"),
		linkedinUrl: str(row, "linkedin_url"),
		employees: num(row, "estimated_num_employees"),
		industry: str(row, "industry"),
		location: [city, country].filter(Boolean).join(", ") || null,
		foundedYear: num(row, "founded_year"),
	};
}

function toPerson(row: Row): LeadPerson {
	return {
		externalId: String(row.id ?? ""),
		name: str(row, "name") ?? "",
		title: str(row, "title"),
		linkedinSlug: linkedinSlug(str(row, "linkedin_url")),
		organizationExternalId: str(row, "organization_id"),
	};
}

/** Un solo adapter contra una sola llave. */
export function createApolloAdapterForKey(
	key: string,
	fetchImpl: typeof fetch = fetch,
): LeadsAdapter {
	async function call(path: string, body: unknown): Promise<Row> {
		const response = await fetchImpl(`${API}${path}`, {
			method: "POST",
			headers: { "x-api-key": key, "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (response.status === 401 || response.status === 403) {
			throw new ApolloUnauthorizedError();
		}
		if (!response.ok) {
			const text = (await response.text()).slice(0, 300);
			// Heurística de S4: Apollo no documenta un código propio para el
			// agotamiento. Se ajusta con el primer caso real en producción.
			if (/credit|insufficient|quota/i.test(text)) {
				throw new ApolloOutOfCreditsError();
			}
			throw new Error(`Apollo respondió ${response.status} en ${path}: ${text}`);
		}
		return (await response.json()) as Row;
	}

	const hasMore = (json: Row): boolean => {
		const pagination = (json.pagination ?? {}) as Row;
		const page = num(pagination, "page") ?? 1;
		const total = num(pagination, "total_pages") ?? 1;
		return page < total;
	};

	return {
		async searchOrganizations(criteria: TargetCriteria, page: number) {
			const json = await call("/mixed_companies/search", {
				organization_num_employees_ranges: criteria.employeeRanges,
				organization_locations: criteria.locations,
				q_organization_keyword_tags: criteria.keywords,
				page,
				per_page: PER_PAGE,
			});
			// mixed_companies puede devolver las guardadas en la cuenta en otra clave.
			const rows = [
				...(((json.organizations as Row[]) ?? []) as Row[]),
				...(((json.accounts as Row[]) ?? []) as Row[]),
			];
			return {
				organizations: rows.map(toOrganization),
				hasMore: hasMore(json),
				creditsUsed: 1,
			};
		},

		async searchPeople(
			criteria: TargetCriteria,
			organizationExternalIds: string[],
			page: number,
		) {
			const json = await call("/mixed_people/search", {
				organization_ids: organizationExternalIds,
				person_titles: criteria.titles,
				page,
				per_page: PER_PAGE,
			});
			const rows = [
				...(((json.people as Row[]) ?? []) as Row[]),
				...(((json.contacts as Row[]) ?? []) as Row[]),
			];
			return {
				people: rows.map(toPerson),
				hasMore: hasMore(json),
				creditsUsed: 1,
			};
		},

		async revealEmail(personExternalId: string) {
			const json = await call("/people/match", {
				id: personExternalId,
				reveal_personal_emails: false,
			});
			const person = (json.person ?? {}) as Row;
			const email = str(person, "email");
			return {
				email: email && !email.includes(LOCKED_EMAIL) ? email : null,
				creditsUsed: 1,
			};
		},
	};
}

/** Firma pública; la Task 3 le agrega el fallback entre llaves. */
export function createApolloAdapter(
	keys: string[],
	fetchImpl: typeof fetch = fetch,
): LeadsAdapter {
	if (keys.length === 0) throw new Error("createApolloAdapter sin llaves");
	return createApolloAdapterForKey(keys[0], fetchImpl);
}
```

- [ ] **Step 5: Correr y ver pasar**

Run: `npx vitest run tests/connectors/apollo-adapter.test.ts`
Esperado: PASA (9 tests). Si el spike de la Task 1 mostró nombres de campo distintos, corregir `toOrganization`/`toPerson` y los fixtures del test con lo observado — **gana el spike, no este código**.

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/leads/ tests/connectors/apollo-adapter.test.ts
git commit -m "feat: LeadsAdapter y adapter de Apollo"
```

---

### Task 3: Fallback entre las dos llaves

**Files:**
- Modify: `lib/connectors/leads/apollo-adapter.ts` (`createApolloAdapter`)
- Test: `tests/connectors/apollo-fallback.test.ts`

**Interfaces:**
- Consumes: `createApolloAdapterForKey`, `ApolloOutOfCreditsError` (Task 2).
- Produces: `createApolloAdapter(keys, fetchImpl)` prueba las llaves en orden ante `ApolloOutOfCreditsError`.

- [ ] **Step 1: Test que falla**

```ts
// tests/connectors/apollo-fallback.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApolloOutOfCreditsError } from "@/lib/connectors/leads/apollo";
import { createApolloAdapter } from "@/lib/connectors/leads/apollo-adapter";

afterEach(() => vi.unstubAllGlobals());

const CRITERIA = {
	employeeRanges: [],
	locations: [],
	keywords: [],
	titles: [],
};

function fetchByKey(behavior: Record<string, () => Response>) {
	return vi.fn<typeof fetch>(async (_url, init) => {
		const key = (init?.headers as Record<string, string>)["x-api-key"];
		return behavior[key]();
	});
}

describe("fallback entre llaves", () => {
	it("si la primera se quedó sin crédito, usa la segunda", async () => {
		const fetchMock = fetchByKey({
			k1: () => new Response("insufficient credits", { status: 402 }),
			k2: () =>
				Response.json({ organizations: [], pagination: { page: 1, total_pages: 1 } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await createApolloAdapter(["k1", "k2"]).searchOrganizations(
			CRITERIA,
			1,
		);

		expect(result.organizations).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("si ninguna tiene crédito, tira para que el runner lo reintente después", async () => {
		vi.stubGlobal(
			"fetch",
			async () => new Response("insufficient credits", { status: 402 }),
		);
		await expect(
			createApolloAdapter(["k1", "k2"]).searchOrganizations(CRITERIA, 1),
		).rejects.toBeInstanceOf(ApolloOutOfCreditsError);
	});

	it("un error que no es de crédito no prueba la otra llave", async () => {
		// Un 500 es un problema de Apollo, no de la llave: gastar la segunda no ayuda.
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response("boom", { status: 500 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			createApolloAdapter(["k1", "k2"]).searchOrganizations(CRITERIA, 1),
		).rejects.toThrow("500");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("el fallback vale para las tres operaciones", async () => {
		const fetchMock = fetchByKey({
			k1: () => new Response("insufficient credits", { status: 402 }),
			k2: () => Response.json({ person: { email: "l@acme.test" } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await createApolloAdapter(["k1", "k2"]).revealEmail("p1");
		expect(result.email).toBe("l@acme.test");
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/connectors/apollo-fallback.test.ts`
Esperado: FALLA: con una sola llave usada, el segundo `fetch` nunca ocurre.

- [ ] **Step 3: Implementar**

Reemplazar `createApolloAdapter` al final de `lib/connectors/leads/apollo-adapter.ts`:

```ts
/**
 * Prueba las llaves del tenant en orden: ante un agotamiento de créditos pasa
 * a la siguiente (spec etapa 13 D5). Cualquier otro error corta acá mismo:
 * un 500 de Apollo no se arregla gastando la otra llave.
 */
export function createApolloAdapter(
	keys: string[],
	fetchImpl: typeof fetch = fetch,
): LeadsAdapter {
	if (keys.length === 0) throw new Error("createApolloAdapter sin llaves");
	const adapters = keys.map((key) => createApolloAdapterForKey(key, fetchImpl));

	async function withFallback<T>(
		operation: (adapter: LeadsAdapter) => Promise<T>,
	): Promise<T> {
		let last: unknown;
		for (const adapter of adapters) {
			try {
				return await operation(adapter);
			} catch (error) {
				if (!(error instanceof ApolloOutOfCreditsError)) throw error;
				last = error;
			}
		}
		throw last;
	}

	return {
		searchOrganizations: (criteria, page) =>
			withFallback((adapter) => adapter.searchOrganizations(criteria, page)),
		searchPeople: (criteria, orgIds, page) =>
			withFallback((adapter) => adapter.searchPeople(criteria, orgIds, page)),
		revealEmail: (personExternalId) =>
			withFallback((adapter) => adapter.revealEmail(personExternalId)),
	};
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/connectors/`
Esperado: PASA todo (adapter + fallback).

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/leads/apollo-adapter.ts tests/connectors/apollo-fallback.test.ts
git commit -m "feat: fallback entre las llaves de Apollo del tenant"
```

---

### Task 4: Migración — `search_focuses` y las columnas nuevas

**Files:**
- Create: `supabase/migrations/20260922090000_search_focuses.sql`
- Test: `supabase/tests/15_search_focuses.test.sql`

**Interfaces:**
- Produces: enum `public.search_focus_status` (`activo`, `agotado`, `cancelado`); tabla `public.search_focuses`; `accounts.firmographics`, `accounts.external_ids`; `contacts.title`, `contacts.search_focus_id`, `contacts.icp`, `contacts.external_ids`; `contacts.source` admite `'apollo'`.

- [ ] **Step 1: Test que falla**

```sql
-- supabase/tests/15_search_focuses.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@lagomarcino.test', now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'beto@fabrica.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lagomarcino', 'Lago Marcino'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'fabrica', 'Fábrica');

insert into public.memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'tenant_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'tenant_member');

insert into public.executors (tenant_id, user_id, slug)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'ana');

insert into public.search_focuses
  (id, tenant_id, created_by, name, criteria, vector, segment, hook, idioma, max_accounts, max_contacts)
values
  ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222', 'Envases GBA',
   '{"employeeRanges":["50,200"]}'::jsonb, 'v1', 'mid_market_ar', 'h1', 'es_ar', 20, 60);

select is(
  (select status::text from public.search_focuses where id = 'ffffffff-0000-0000-0000-000000000001'),
  'activo',
  'un foco nace activo'
);

select throws_ok(
  $$insert into public.search_focuses
      (tenant_id, created_by, name, criteria, vector, segment, hook, idioma, max_accounts, max_contacts)
    values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
            'Tope cero', '{}'::jsonb, 'v1', 'mid_market_ar', 'h1', 'es_ar', 0, 10)$$,
  '23514',
  null,
  'un foco sin tope de empresas no se acepta'
);

select throws_ok(
  $$insert into public.search_focuses
      (tenant_id, created_by, name, criteria, vector, segment, hook, idioma, max_accounts, max_contacts)
    values ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
            'Ajeno', '{}'::jsonb, 'v1', 'mid_market_ar', 'h1', 'es_ar', 5, 5)$$,
  '23503',
  null,
  'el dueño del foco tiene que ser ejecutor de ese tenant'
);

insert into public.accounts (tenant_id, domain, name, ficha, expires_at, firmographics, external_ids)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'acme.test', 'Acme', '{}'::jsonb,
        now() + interval '90 days', '{"employees":120}'::jsonb, '{"apollo":"org1"}'::jsonb);

select is(
  (select firmographics->>'employees' from public.accounts where domain = 'acme.test'),
  '120',
  'accounts guarda los firmográficos de Apollo aparte de la ficha'
);

insert into public.contacts
  (tenant_id, contact_key, name, company, title, source, search_focus_id, icp, external_ids)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'li:laura-gomez', 'Laura', 'Acme',
        'Gerente General', 'apollo', 'ffffffff-0000-0000-0000-000000000001',
        '{"encaje_empresa":{"score":1.8}}'::jsonb, '{"apollo":"p1"}'::jsonb);

select is(
  (select title from public.contacts where contact_key = 'li:laura-gomez'),
  'Gerente General',
  'contacts guarda el cargo'
);

select is(
  (select icp->'encaje_empresa'->>'score' from public.contacts where contact_key = 'li:laura-gomez'),
  '1.8',
  'contacts guarda los juicios crudos del scoring'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*)::int from public.search_focuses),
  0,
  'un miembro de otro tenant no ve los focos ajenos'
);

select throws_ok(
  $$update public.search_focuses set max_contacts = 9999$$,
  '42501',
  null,
  'authenticated no escribe focos: los crean las server actions con el cliente admin'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run db:test`
Esperado: FALLA con `relation "public.search_focuses" does not exist`.

- [ ] **Step 3: Escribir la migración**

```sql
-- supabase/migrations/20260922090000_search_focuses.sql
-- El foco de búsqueda (spec etapa 13 §6 y §8). Es la forma operativa de un
-- vector del canon y la unidad de autorización del gasto en Apollo.
create type public.search_focus_status as enum ('activo', 'agotado', 'cancelado');

create table public.search_focuses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- El dueño define el claim de todo lo que se descubra. La FK compuesta
  -- obliga a que sea ejecutor de ESTE tenant, igual que contacts.owner_user_id.
  created_by uuid not null,
  name text not null check (length(name) between 1 and 200),
  criteria jsonb not null default '{}'::jsonb,
  -- Validados contra config_values por la puerta, no por FK: el valor es
  -- polimórfico por kind, igual que en contacts.
  vector text not null,
  segment text not null,
  hook text not null,
  idioma text not null,
  max_accounts integer not null check (max_accounts > 0),
  max_contacts integer not null check (max_contacts > 0),
  status public.search_focus_status not null default 'activo',
  accounts_found integer not null default 0 check (accounts_found >= 0),
  contacts_found integer not null default 0 check (contacts_found >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, created_by) references public.executors (tenant_id, user_id)
    on delete cascade
);

-- El sembrador del workflow busca por esto en cada pasada.
create index search_focuses_tenant_status_idx
  on public.search_focuses (tenant_id, status)
  where status = 'activo';
create index search_focuses_created_by_idx on public.search_focuses (tenant_id, created_by);

alter table public.search_focuses enable row level security;

create policy search_focuses_select on public.search_focuses
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

revoke insert, update, delete on public.search_focuses from authenticated, anon;

-- Firmográficos de Apollo, aparte de la ficha (que es el research web).
alter table public.accounts
  add column firmographics jsonb not null default '{}'::jsonb,
  add column external_ids jsonb not null default '{}'::jsonb;

alter table public.contacts
  add column title text check (title is null or length(title) between 1 and 200),
  add column search_focus_id uuid references public.search_focuses (id) on delete set null,
  add column icp jsonb not null default '{}'::jsonb,
  add column external_ids jsonb not null default '{}'::jsonb;

create index contacts_search_focus_id_idx on public.contacts (search_focus_id);

-- El origen nuevo. El check viejo solo admitía csv y chat.
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts
  add constraint contacts_source_check check (source in ('csv', 'chat', 'apollo'));
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run db:test`
Esperado: verde, con `15_search_focuses.test.sql` en 8 tests. Si `07_authenticated_grants.test.sql` falla porque enumera columnas o tablas, sumar `search_focuses` a su lista esperada.

- [ ] **Step 5: Regenerar tipos y commitear**

```bash
npx supabase db push
npm run db:types
git add supabase/migrations/20260922090000_search_focuses.sql supabase/tests/15_search_focuses.test.sql lib/supabase/database.types.ts
git commit -m "feat: search_focuses y las columnas de descubrimiento"
```

---

### Task 5: `ItemOutcome` con varios sujetos aguas abajo

Es la enmienda a la Etapa 12 que pide §4.1 de la spec: un foco deja N contactos, no un sujeto por ítem.

**Files:**
- Modify: `lib/workflows/types.ts`
- Modify: `lib/workflows/runner.ts`
- Modify: `docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md` (§9.2)
- Test: `tests/workflows/runner.test.ts` (sumar casos)

**Interfaces:**
- Produces: `type ItemOutcome = { ok: true; downstream?: Array<{ subjectId: string; inputHash: string }> } | { ok: false; reason: string; message: string }`.

- [ ] **Step 1: Sumar los casos al test del runner**

En `tests/workflows/runner.test.ts`, dentro de `describe("runWorkflowPass", ...)`:

```ts
	it("un ítem puede dejar varios ítems aguas abajo", async () => {
		// Un foco deja N contactos: la arista de esta etapa es 1 a N.
		const store = createFakeWorkflowStore(now);
		store.add("foco-1");
		store.enabled.add("icp-scoring");

		await pass(store, {
			runItem: async () => ({
				ok: true,
				downstream: [
					{ subjectId: "contacto-1", inputHash: "h-icp" },
					{ subjectId: "contacto-2", inputHash: "h-icp" },
				],
			}),
		});

		const encolados = store.items.filter((i) => i.workflow === "icp-scoring");
		expect(encolados.map((i) => i.subjectId).sort()).toEqual([
			"contacto-1",
			"contacto-2",
		]);
	});

	it("sin downstream no encola nada aguas abajo", async () => {
		const store = createFakeWorkflowStore(now);
		store.add("acc-1");
		store.enabled.add("icp-scoring");

		await pass(store, { runItem: async () => ({ ok: true }) });

		expect(store.items.filter((i) => i.workflow === "icp-scoring")).toHaveLength(0);
	});
```

Para que el caso corra, el registry de prueba necesita que `refresh-fichas` produzca lo que `icp-scoring` reclama. Si el registry real no lo hace, usar en el test un workflow cuyo `produces` coincida con el `claims` de otro; si no existe tal par, agregar al test un doble del registry en vez de tocar el real.

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/workflows/runner.test.ts`
Esperado: FALLA: `downstream` no existe en el tipo y el runner encola con el `subjectId` del padre.

- [ ] **Step 3: Cambiar el tipo**

En `lib/workflows/types.ts`:

```ts
/**
 * Lo que devuelve procesar un ítem. Una excepción es infraestructura caída y
 * se reintenta.
 *
 * `downstream` es la lista de sujetos que este ítem deja para el workflow de
 * abajo. Suele ser el mismo sujeto (1 a 1), pero una búsqueda de target deja
 * N contactos a partir de un foco (spec etapa 13 §4.1).
 */
export type ItemOutcome =
	| { ok: true; downstream?: Array<{ subjectId: string; inputHash: string }> }
	| { ok: false; reason: string; message: string };
```

- [ ] **Step 4: Cambiar el runner**

En `lib/workflows/runner.ts`, reemplazar el bloque que encola aguas abajo dentro del `if (outcome.ok)`:

```ts
				counts.ok++;
				// Un ítem puede dejar varios sujetos, y de otro tipo que el propio
				// (spec etapa 13 §4.1). Sin `downstream`, no deja nada.
				for (const next of downstreamOf(info.produces)) {
					if (!enabled.has(next)) continue;
					for (const subject of outcome.downstream ?? []) {
						await enqueue(
							{
								tenantId,
								workflow: next,
								subjectType: WORKFLOWS[next].subjectType,
								subjectId: subject.subjectId,
								inputHash: subject.inputHash,
							},
							{ store },
						);
					}
				}
```

- [ ] **Step 5: Correr y ver pasar**

Run: `npm run typecheck && npm test`
Esperado: verde. Si algún `WorkflowImpl` existente devolvía `downstreamHash`, cambiarlo a `downstream: [{ subjectId: item.subjectId, inputHash: ... }]`.

- [ ] **Step 6: Anotar la enmienda en la spec de la Etapa 12**

En §9.2 de `2026-09-20-orquestacion-plataforma-design.md`, cambiar la firma de `ItemOutcome` por la nueva y agregar una línea: *"Un ítem puede dejar varios sujetos aguas abajo (enmienda de la Etapa 13 §15, punto 6)."*

- [ ] **Step 7: Commit**

```bash
git add lib/workflows/types.ts lib/workflows/runner.ts tests/workflows/runner.test.ts docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md
git commit -m "feat: un item puede dejar varios sujetos aguas abajo"
```

---

### Task 6: Lecturas y escrituras del descubrimiento

**Files:**
- Create: `lib/outreach/focus.ts`
- Modify: `lib/outreach/store.ts` (interfaz `OutreachStore` y la implementación)
- Test: `tests/outreach/focus.test.ts`
- Modify: `tests/outreach/fake-store.ts`

**Interfaces:**
- Produces:
  - `targetCriteriaSchema` (zod) y `parseTargetCriteria(raw): TargetCriteria`
  - `focusPageHash(focusId: string, page: number): string`
  - En `OutreachStore`: `listActiveFocuses(tenantId)`, `loadFocus(tenantId, id)`, `updateFocus(tenantId, id, patch)`, `upsertDiscoveredAccount(row)`, `insertDiscoveredContact(row)`
  - `interface FocusRow { id; tenantId; createdBy; name; criteria; vector; segment; hook; idioma; maxAccounts; maxContacts; status; accountsFound; contactsFound }`

- [ ] **Step 1: Test que falla**

```ts
// tests/outreach/focus.test.ts
import { describe, expect, it } from "vitest";
import { focusPageHash, parseTargetCriteria } from "@/lib/outreach/focus";

describe("parseTargetCriteria", () => {
	it("acepta los cuatro filtros y normaliza los vacíos", () => {
		expect(
			parseTargetCriteria({
				employeeRanges: ["50,200"],
				locations: ["Buenos Aires, Argentina"],
			}),
		).toEqual({
			employeeRanges: ["50,200"],
			locations: ["Buenos Aires, Argentina"],
			keywords: [],
			titles: [],
		});
	});

	it("rechaza un rango de empleados con formato ajeno a Apollo", () => {
		expect(() =>
			parseTargetCriteria({ employeeRanges: ["entre 50 y 200"] }),
		).toThrow();
	});

	it("rechaza un criterio vacío: buscar sin filtros trae el universo entero", () => {
		expect(() => parseTargetCriteria({})).toThrow();
	});
});

describe("focusPageHash", () => {
	it("la huella cambia con la página y es estable con la misma", () => {
		expect(focusPageHash("f1", 1)).toBe(focusPageHash("f1", 1));
		expect(focusPageHash("f1", 2)).not.toBe(focusPageHash("f1", 1));
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/outreach/focus.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 3: Escribir `focus.ts`**

```ts
// lib/outreach/focus.ts
// El foco de búsqueda (spec etapa 13 §6). Import relativo: lo usan servicios
// que terminan importados desde agents/.
import { z } from "zod";
import type { TargetCriteria } from "../connectors/leads/adapter";

/** Apollo espera "min,max". Un formato distinto no filtra: trae de más. */
const EMPLOYEE_RANGE = /^\d{1,7},\d{1,7}$/;

export const targetCriteriaSchema = z
	.object({
		employeeRanges: z.array(z.string().regex(EMPLOYEE_RANGE)).default([]),
		locations: z.array(z.string().min(2).max(200)).default([]),
		keywords: z.array(z.string().min(2).max(100)).default([]),
		titles: z.array(z.string().min(2).max(100)).default([]),
	})
	.refine(
		(criteria) =>
			criteria.employeeRanges.length +
				criteria.locations.length +
				criteria.keywords.length >
			0,
		"un foco sin filtros de empresa traería el universo entero",
	);

export function parseTargetCriteria(raw: unknown): TargetCriteria {
	return targetCriteriaSchema.parse(raw ?? {});
}

/** Cada página de resultados es un ítem propio del workflow. */
export function focusPageHash(focusId: string, page: number): string {
	return `${focusId}:p${page}`;
}
```

- [ ] **Step 4: Sumar los métodos al store**

En `lib/outreach/store.ts`, agregar a la interfaz `OutreachStore`:

```ts
	/** Focos activos del tenant, para el sembrador de target-search. */
	listActiveFocuses(tenantId: string): Promise<FocusRow[]>;
	loadFocus(tenantId: string, id: string): Promise<FocusRow | null>;
	updateFocus(
		tenantId: string,
		id: string,
		patch: Partial<
			Pick<FocusRow, "status" | "accountsFound" | "contactsFound">
		>,
	): Promise<void>;
	/** Cuenta descubierta: no pisa la ficha de research si ya existe. */
	upsertDiscoveredAccount(row: {
		tenantId: string;
		domain: string;
		name: string;
		firmographics: Record<string, unknown>;
		externalIds: Record<string, unknown>;
	}): Promise<{ id: string }>;
	/** "duplicado" si ese contact_key ya existe en el tenant. */
	insertDiscoveredContact(row: {
		tenantId: string;
		contactKey: string;
		accountId: string | null;
		ownerUserId: string;
		searchFocusId: string;
		name: string;
		company: string;
		title: string | null;
		linkedinSlug: string | null;
		segment: string;
		vector: string;
		hook: string;
		idioma: string;
		externalIds: Record<string, unknown>;
	}): Promise<{ id: string } | "duplicado">;
```

Con su tipo:

```ts
export interface FocusRow {
	id: string;
	tenantId: string;
	createdBy: string;
	name: string;
	criteria: Record<string, unknown>;
	vector: string;
	segment: string;
	hook: string;
	idioma: string;
	maxAccounts: number;
	maxContacts: number;
	status: "activo" | "agotado" | "cancelado";
	accountsFound: number;
	contactsFound: number;
}
```

La implementación sobre Supabase sigue el patrón del resto del archivo: `select` con las columnas nombradas, mapeo `snake_case` → `camelCase`, y en `insertDiscoveredContact` un `insert` que ante `23505` devuelve `"duplicado"` en vez de tirar. `upsertDiscoveredAccount` usa `upsert` con `onConflict: "tenant_id,domain"` y **no toca `ficha` ni `expires_at`**: si la cuenta ya tiene research, se conserva; si es nueva, `ficha` queda `{}` y `expires_at` en `now()` para que el research la tome como vencida.

Agregar las mismas implementaciones al `FakeStore` de `tests/outreach/fake-store.ts`, con arrays en memoria.

- [ ] **Step 5: Correr y ver pasar**

Run: `npm run typecheck && npm test`
Esperado: verde.

- [ ] **Step 6: Commit**

```bash
git add lib/outreach/focus.ts lib/outreach/store.ts tests/outreach/focus.test.ts tests/outreach/fake-store.ts
git commit -m "feat: foco de búsqueda y lecturas del descubrimiento"
```

---

### Task 7: El nodo `leads/search-targets`

**Files:**
- Create: `lib/outreach/services/target-search.ts`
- Test: `tests/outreach/services/target-search.test.ts`

**Interfaces:**
- Consumes: `LeadsAdapter` (Task 2), `FocusRow` y los métodos del store (Task 6), `contactKey` de `lib/outreach/contact-key.ts`, `claimStatus` de `lib/outreach/guards.ts`.
- Produces: `searchTargetsPage(input, deps): Promise<SearchPageResult>` con
  `SearchPageResult = Refusal | { ok: true; contactIds: string[]; accounts: number; discarded: Record<string, number>; hasMore: boolean; creditsUsed: number }`.

- [ ] **Step 1: Test que falla**

```ts
// tests/outreach/services/target-search.test.ts
import { describe, expect, it, vi } from "vitest";
import type { LeadsAdapter } from "@/lib/connectors/leads/adapter";
import { searchTargetsPage } from "@/lib/outreach/services/target-search";
import { createFakeStore, TENANT, USER } from "../fake-store";

const focus = {
	id: "f1",
	tenantId: TENANT,
	createdBy: USER,
	name: "Envases GBA",
	criteria: { employeeRanges: ["50,200"], locations: [], keywords: [], titles: [] },
	vector: "v1",
	segment: "mid_market_ar",
	hook: "h1",
	idioma: "es_ar",
	maxAccounts: 10,
	maxContacts: 20,
	status: "activo" as const,
	accountsFound: 0,
	contactsFound: 0,
};

const ORG = {
	externalId: "org1",
	name: "Acme",
	domain: "acme.test",
	linkedinUrl: null,
	employees: 120,
	industry: "packaging",
	location: "Rosario, Argentina",
	foundedYear: 1998,
};

const PERSON = {
	externalId: "p1",
	name: "Laura Gómez",
	title: "Gerente General",
	linkedinSlug: "laura-gomez",
	organizationExternalId: "org1",
};

function adapter(overrides: Partial<LeadsAdapter> = {}): LeadsAdapter {
	return {
		searchOrganizations: async () => ({
			organizations: [ORG],
			hasMore: false,
			creditsUsed: 1,
		}),
		searchPeople: async () => ({
			people: [PERSON],
			hasMore: false,
			creditsUsed: 1,
		}),
		revealEmail: async () => ({ email: null, creditsUsed: 1 }),
		...overrides,
	};
}

const deps = (store = createFakeStore(), leads = adapter()) => ({
	store,
	leads,
	crm: null,
	now: () => new Date("2026-09-22T12:00:00Z"),
});

describe("searchTargetsPage", () => {
	it("crea la cuenta y el contacto con la atribución del foco", async () => {
		const store = createFakeStore();
		const result = await searchTargetsPage({ focus, page: 1 }, deps(store));

		expect(result).toMatchObject({ ok: true, accounts: 1 });
		const contact = store.contacts[0];
		expect(contact).toMatchObject({
			contactKey: "li:laura-gomez",
			title: "Gerente General",
			vector: "v1",
			segment: "mid_market_ar",
			hook: "h1",
			idioma: "es_ar",
			ownerUserId: USER,
			source: "apollo",
		});
		expect(contact.email).toBeNull();
	});

	it("una empresa sin dominio se descarta y no se busca gente adentro", async () => {
		const searchPeople = vi.fn(async () => ({
			people: [],
			hasMore: false,
			creditsUsed: 1,
		}));
		const store = createFakeStore();
		const result = await searchTargetsPage(
			{ focus, page: 1 },
			deps(
				store,
				adapter({
					searchOrganizations: async () => ({
						organizations: [{ ...ORG, domain: null }],
						hasMore: false,
						creditsUsed: 1,
					}),
					searchPeople,
				}),
			),
		);

		expect(result).toMatchObject({ ok: true, accounts: 0 });
		expect((result as { discarded: Record<string, number> }).discarded).toMatchObject({
			sin_dominio: 1,
		});
		expect(searchPeople).not.toHaveBeenCalled();
	});

	it("una persona ya trabajada por otro ejecutor se saltea con claim_ajeno", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "li:laura-gomez",
			ownerUserId: "otro-ejecutor",
		});

		const result = await searchTargetsPage({ focus, page: 1 }, deps(store));

		expect((result as { discarded: Record<string, number> }).discarded).toMatchObject({
			claim_ajeno: 1,
		});
		expect(store.contacts).toHaveLength(1);
	});

	it("respeta el tope de contactos del foco", async () => {
		const store = createFakeStore();
		const people = Array.from({ length: 5 }, (_, i) => ({
			...PERSON,
			externalId: `p${i}`,
			linkedinSlug: `persona-${i}`,
		}));

		const result = await searchTargetsPage(
			{ focus: { ...focus, maxContacts: 3, contactsFound: 1 }, page: 1 },
			deps(store, adapter({
				searchPeople: async () => ({ people, hasMore: false, creditsUsed: 1 }),
			})),
		);

		// Quedaban 2 de cupo: entran 2, no 5.
		expect((result as { contactIds: string[] }).contactIds).toHaveLength(2);
	});

	it("suma los créditos de las dos llamadas", async () => {
		const result = await searchTargetsPage({ focus, page: 1 }, deps());
		expect((result as { creditsUsed: number }).creditsUsed).toBe(2);
	});

	it("una persona sin slug ni nombre utilizable se descarta, no rompe la página", async () => {
		const store = createFakeStore();
		const result = await searchTargetsPage(
			{ focus, page: 1 },
			deps(
				store,
				adapter({
					searchPeople: async () => ({
						people: [{ ...PERSON, name: "", linkedinSlug: null }],
						hasMore: false,
						creditsUsed: 1,
					}),
				}),
			),
		);
		expect((result as { discarded: Record<string, number> }).discarded).toMatchObject({
			sin_clave: 1,
		});
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/outreach/services/target-search.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 3: Implementar el nodo**

```ts
// lib/outreach/services/target-search.ts
// Nodo leads/search-targets (spec etapa 13 §5.2): una página de empresas y la
// gente de esas empresas. No revela emails: eso se paga por cabeza y se hace
// después de calificar.
import type { LeadsAdapter } from "../../connectors/leads/adapter";
import type { CrmAdapter } from "../../connectors/crm/adapter";
import { contactKey, ContactKeyError } from "../contact-key";
import { normalizeDomain } from "../domain";
import { parseTargetCriteria } from "../focus";
import { claimStatus } from "../guards";
import { type Refusal, refuse } from "../result";
import type { FocusRow, OutreachStore } from "../store";

export interface TargetSearchDeps {
	store: OutreachStore;
	leads: LeadsAdapter;
	crm: CrmAdapter | null;
	now: () => Date;
}

export type SearchPageResult =
	| Refusal
	| {
			ok: true;
			contactIds: string[];
			accounts: number;
			discarded: Record<string, number>;
			hasMore: boolean;
			creditsUsed: number;
	  };

export async function searchTargetsPage(
	input: { focus: FocusRow; page: number },
	deps: TargetSearchDeps,
): Promise<SearchPageResult> {
	const { focus } = input;
	if (focus.status !== "activo") {
		return refuse("foco_inactivo", `el foco ${focus.name} ya no está activo`);
	}

	let criteria: ReturnType<typeof parseTargetCriteria>;
	try {
		criteria = parseTargetCriteria(focus.criteria);
	} catch (error) {
		return refuse(
			"criterio_invalido",
			`el foco ${focus.name} tiene filtros inválidos: ${error instanceof Error ? error.message : "sin detalle"}`,
		);
	}

	const discarded: Record<string, number> = {};
	const count = (reason: string) => {
		discarded[reason] = (discarded[reason] ?? 0) + 1;
	};

	let creditsUsed = 0;
	const orgs = await deps.leads.searchOrganizations(criteria, input.page);
	creditsUsed += orgs.creditsUsed;

	// Cupo de empresas que queda en el foco.
	const accountsLeft = Math.max(focus.maxAccounts - focus.accountsFound, 0);
	const usable: Array<{ accountId: string; externalId: string; name: string }> = [];

	for (const org of orgs.organizations.slice(0, accountsLeft)) {
		const domain = normalizeDomain(org.domain ?? "");
		if (!domain) {
			count("sin_dominio");
			continue;
		}
		const account = await deps.store.upsertDiscoveredAccount({
			tenantId: focus.tenantId,
			domain,
			name: org.name,
			firmographics: {
				employees: org.employees,
				industry: org.industry,
				location: org.location,
				foundedYear: org.foundedYear,
				linkedinUrl: org.linkedinUrl,
			},
			externalIds: { apollo: org.externalId },
		});
		usable.push({ accountId: account.id, externalId: org.externalId, name: org.name });
	}

	if (usable.length === 0) {
		return {
			ok: true,
			contactIds: [],
			accounts: 0,
			discarded,
			hasMore: orgs.hasMore,
			creditsUsed,
		};
	}

	const people = await deps.leads.searchPeople(
		criteria,
		usable.map((account) => account.externalId),
		1,
	);
	creditsUsed += people.creditsUsed;

	const byExternalId = new Map(usable.map((a) => [a.externalId, a]));
	const contactsLeft = Math.max(focus.maxContacts - focus.contactsFound, 0);
	const contactIds: string[] = [];

	for (const person of people.people) {
		if (contactIds.length >= contactsLeft) break;
		const account = person.organizationExternalId
			? byExternalId.get(person.organizationExternalId)
			: undefined;
		const company = account?.name ?? "";

		let key: string;
		try {
			key = contactKey({
				linkedinUrl: person.linkedinSlug,
				name: person.name,
				company,
			});
		} catch (error) {
			count(error instanceof ContactKeyError ? "sin_clave" : "invalida");
			continue;
		}

		// El claim manda: una persona la trabaja un solo ejecutor.
		const [existing] = await deps.store.findContactsByKeys(focus.tenantId, [key]);
		const claim = claimStatus({
			contact: existing ?? null,
			executorUserId: focus.createdBy,
			now: deps.now(),
		});
		if (claim !== "propio" && claim !== "libre") {
			count("claim_ajeno");
			continue;
		}
		if (existing) {
			count("ya_existia");
			continue;
		}

		const inserted = await deps.store.insertDiscoveredContact({
			tenantId: focus.tenantId,
			contactKey: key,
			accountId: account?.accountId ?? null,
			ownerUserId: focus.createdBy,
			searchFocusId: focus.id,
			name: person.name,
			company,
			title: person.title,
			linkedinSlug: person.linkedinSlug,
			segment: focus.segment,
			vector: focus.vector,
			hook: focus.hook,
			idioma: focus.idioma,
			externalIds: { apollo: person.externalId },
		});
		if (inserted === "duplicado") {
			count("ya_existia");
			continue;
		}
		contactIds.push(inserted.id);
	}

	return {
		ok: true,
		contactIds,
		accounts: usable.length,
		discarded,
		hasMore: orgs.hasMore,
		creditsUsed,
	};
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/outreach/services/target-search.test.ts`
Esperado: PASA (6 tests). `claimStatus` puede tener otra firma: ajustar la llamada a la que exista en `lib/outreach/guards.ts`, sin cambiar la semántica (una persona de otro ejecutor se saltea).

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/services/target-search.ts tests/outreach/services/target-search.test.ts
git commit -m "feat: nodo de búsqueda de targets"
```

---

### Task 8: El workflow `target-search` y su lugar en el registry

**Files:**
- Create: `lib/outreach/workflows/target-search.ts`
- Modify: `lib/workflows/registry.ts`
- Test: `tests/outreach/workflows/target-search.test.ts`

**Interfaces:**
- Consumes: `searchTargetsPage` (Task 7), `WorkflowImpl`/`PassContext` (Etapa 12), `focusPageHash` (Task 6).
- Produces: el `WorkflowImpl` de `target-search`, y las entradas del registry: nodos `leads/search-targets` (efecto 1) y workflow `target-search` (`subjectType: "search_focus"`, `claims: "foco_activo"`, `produces: "contacto_descubierto"`, `resources: ["apollo_credits"]`, `entry: "seed"`).

- [ ] **Step 1: Test que falla**

```ts
// tests/outreach/workflows/target-search.test.ts
import { describe, expect, it, vi } from "vitest";
import { createTargetSearchWorkflow } from "@/lib/outreach/workflows/target-search";

const focus = {
	id: "f1",
	tenantId: "t1",
	createdBy: "u1",
	name: "Envases",
	criteria: {},
	vector: "v1",
	segment: "s1",
	hook: "h1",
	idioma: "es_ar",
	maxAccounts: 10,
	maxContacts: 20,
	status: "activo" as const,
	accountsFound: 0,
	contactsFound: 0,
};

const ctx = {
	tenantId: "t1",
	runId: "run-1",
	workflow: "target-search",
	optionalNodes: new Set<string>(),
	useNode: async () => undefined,
};

describe("workflow target-search", () => {
	it("siembra una página por cada foco activo", async () => {
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [focus],
			loadFocus: async () => focus,
			search: async () => ({
				ok: true,
				contactIds: [],
				accounts: 0,
				discarded: {},
				hasMore: false,
				creditsUsed: 1,
			}),
			updateFocus: async () => {},
			recordCredits: async () => {},
		});

		const seeded = await workflow.seed?.("t1", new Date());
		expect(seeded).toEqual([{ subjectId: "f1", inputHash: "f1:p1" }]);
	});

	it("los contactos descubiertos viajan como downstream", async () => {
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [],
			loadFocus: async () => focus,
			search: async () => ({
				ok: true,
				contactIds: ["c1", "c2"],
				accounts: 1,
				discarded: {},
				hasMore: false,
				creditsUsed: 2,
			}),
			updateFocus: async () => {},
			recordCredits: async () => {},
		});

		const outcome = await workflow.runItem(
			{
				id: 1,
				tenantId: "t1",
				workflow: "target-search",
				subjectType: "search_focus",
				subjectId: "f1",
				inputHash: "f1:p1",
				attempts: 1,
			},
			ctx,
		);

		expect(outcome).toMatchObject({
			ok: true,
			downstream: [
				{ subjectId: "c1", inputHash: "c1" },
				{ subjectId: "c2", inputHash: "c2" },
			],
		});
	});

	it("asienta los créditos gastados aunque la página no traiga a nadie", async () => {
		const recordCredits = vi.fn(async () => {});
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [],
			loadFocus: async () => focus,
			search: async () => ({
				ok: true,
				contactIds: [],
				accounts: 0,
				discarded: { sin_dominio: 3 },
				hasMore: false,
				creditsUsed: 1,
			}),
			updateFocus: async () => {},
			recordCredits,
		});

		await workflow.runItem(
			{
				id: 1,
				tenantId: "t1",
				workflow: "target-search",
				subjectType: "search_focus",
				subjectId: "f1",
				inputHash: "f1:p1",
				attempts: 1,
			},
			ctx,
		);

		expect(recordCredits).toHaveBeenCalledWith(1, "run-1");
	});

	it("cuando no hay más páginas, el foco queda agotado", async () => {
		const updateFocus = vi.fn(async () => {});
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [],
			loadFocus: async () => focus,
			search: async () => ({
				ok: true,
				contactIds: ["c1"],
				accounts: 1,
				discarded: {},
				hasMore: false,
				creditsUsed: 2,
			}),
			updateFocus,
			recordCredits: async () => {},
		});

		await workflow.runItem(
			{
				id: 1,
				tenantId: "t1",
				workflow: "target-search",
				subjectType: "search_focus",
				subjectId: "f1",
				inputHash: "f1:p1",
				attempts: 1,
			},
			ctx,
		);

		expect(updateFocus).toHaveBeenCalledWith(
			"t1",
			"f1",
			expect.objectContaining({ status: "agotado" }),
		);
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/outreach/workflows/target-search.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 3: Implementar el workflow**

```ts
// lib/outreach/workflows/target-search.ts
// Workflow target-search (spec etapa 13 §4.1). El sembrador toma los focos
// activos; cada ítem es una página de resultados.
import type { ItemOutcome, WorkItem } from "../../workflows/types";
import type { PassContext, WorkflowImpl } from "../../workflows/runner";
import { focusPageHash } from "../focus";
import { isRefusal } from "../result";
import type { FocusRow } from "../store";
import type { SearchPageResult } from "../services/target-search";

export interface TargetSearchWorkflowDeps {
	loadFocuses: (tenantId: string) => Promise<FocusRow[]>;
	loadFocus: (tenantId: string, id: string) => Promise<FocusRow | null>;
	search: (focus: FocusRow, page: number) => Promise<SearchPageResult>;
	updateFocus: (
		tenantId: string,
		id: string,
		patch: Partial<
			Pick<FocusRow, "status" | "accountsFound" | "contactsFound">
		>,
	) => Promise<void>;
	recordCredits: (credits: number, runId: string) => Promise<void>;
}

/** De "f1:p3" saca 3. Una huella rota vale como página 1. */
function pageOf(inputHash: string): number {
	const page = Number(inputHash.split(":p")[1]);
	return Number.isInteger(page) && page > 0 ? page : 1;
}

export function createTargetSearchWorkflow(
	deps: TargetSearchWorkflowDeps,
): WorkflowImpl {
	return {
		async seed(tenantId: string) {
			const focuses = await deps.loadFocuses(tenantId);
			return focuses.map((focus) => ({
				subjectId: focus.id,
				inputHash: focusPageHash(focus.id, 1),
			}));
		},

		async runItem(item: WorkItem, ctx: PassContext): Promise<ItemOutcome> {
			const focus = await deps.loadFocus(item.tenantId, item.subjectId);
			if (!focus) {
				return {
					ok: false,
					reason: "foco_inexistente",
					message: `el foco ${item.subjectId} ya no está`,
				};
			}

			const page = pageOf(item.inputHash);
			const result = await deps.search(focus, page);

			// Los créditos se asientan aunque la página no sirva: se gastaron igual.
			if (!isRefusal(result) && result.creditsUsed > 0) {
				await deps.recordCredits(result.creditsUsed, ctx.runId);
			}
			if (isRefusal(result)) return result;

			const accountsFound = focus.accountsFound + result.accounts;
			const contactsFound = focus.contactsFound + result.contactIds.length;
			const agotado =
				!result.hasMore ||
				accountsFound >= focus.maxAccounts ||
				contactsFound >= focus.maxContacts;

			await deps.updateFocus(item.tenantId, focus.id, {
				accountsFound,
				contactsFound,
				...(agotado ? { status: "agotado" as const } : {}),
			});

			// La página siguiente es otro ítem del mismo workflow: lo encola el
			// sembrador de la próxima pasada solo si el foco sigue activo.
			return {
				ok: true,
				downstream: result.contactIds.map((contactId) => ({
					subjectId: contactId,
					inputHash: contactId,
				})),
			};
		},
	};
}
```

**Ojo con el sembrador y las páginas:** con este diseño, el sembrador siembra siempre la página 1, y `enqueue()` la rechaza como `ya_visto` desde la segunda pasada. Para avanzar de página, el sembrador tiene que sembrar la **siguiente** página del foco, no la primera. Cambiar `seed` para que use el progreso del foco:

```ts
		async seed(tenantId: string) {
			const focuses = await deps.loadFocuses(tenantId);
			return focuses.map((focus) => ({
				subjectId: focus.id,
				// Una página por cada 100 empresas ya encontradas: la que sigue.
				inputHash: focusPageHash(
					focus.id,
					Math.floor(focus.accountsFound / 100) + 1,
				),
			}));
		},
```

Ajustar el primer test para que espere `"f1:p1"` con `accountsFound: 0`, y sumar uno que verifique que con `accountsFound: 100` siembra `"f1:p2"`.

- [ ] **Step 4: Registrar nodo y workflow**

En `lib/workflows/registry.ts`, sumar a `NODES`:

```ts
	"leads/target-search": { effect: 1, tier: null },
```

Y a `WORKFLOWS`:

```ts
	"target-search": {
		agent: "outreach",
		subjectType: "search_focus",
		claims: "foco_activo",
		produces: "contacto_descubierto",
		nodes: ["leads/target-search"],
		optionalNodes: [],
		resources: ["apollo_credits"],
		caps: { itemsPerTick: 2, costUsdPerRun: 0 },
		entry: "seed",
	},
```

`costUsdPerRun: 0` porque este workflow no gasta tokens de modelo; su recurso es `apollo_credits` y su tope real es el del foco. Si el test de la Etapa 12 exige `costUsdPerRun > 0` para todo workflow con nodos de efecto ≥ 1, ajustarlo para que la condición sea "declara al menos un recurso", que es lo que realmente importa.

El test del registry va a pedir que `lib/outreach/services/target-search.ts` esté registrado: la clave del nodo es `outreach/target-search` por su ruta, pero el nodo conceptual es de leads. Registrarlo como `outreach/target-search` para respetar la convención de ruta, y usar ese nombre también en `nodes`.

- [ ] **Step 5: Correr y ver pasar**

Run: `npm run typecheck && npm test`
Esperado: verde, incluidos los tests del registry de la Etapa 12.

- [ ] **Step 6: Commit**

```bash
git add lib/outreach/workflows/ lib/workflows/registry.ts tests/outreach/workflows/
git commit -m "feat: workflow de búsqueda de targets en el registry"
```

---

### Task 9: Cablear el dispatcher y crear un foco por CLI

**Files:**
- Modify: `agents/outreach/schedules/dispatch.ts` (registrar el workflow nuevo)
- Create: `scripts/outreach-focus.mts`
- Create: `scripts/outreach-focus-args.ts`
- Modify: `package.json` (script `outreach:focus`)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `npm run outreach:focus -- --tenant innovas --owner mati --file foco.json [--apply]`.

- [ ] **Step 1: Cablear el workflow en el dispatcher**

En el mapa de implementaciones que arma `agents/outreach/schedules/dispatch.ts` (Etapa 12 E3), sumar `target-search` con sus dependencias reales: el store de Supabase, el adapter de Apollo construido desde el binding del tenant, y `recordCredits` escribiendo en `usage_entries` con `resource: "apollo_credits"` y `node: "outreach/target-search"`.

Las llaves salen del binding: `loadTenantBindings(tenantId)` → el binding de capacidad `leads` y proveedor `apollo` → `config.connectorUids` (array) → `getToken(uid, APP_SUBJECT)` por cada uno vía el helper de `lib/connectors/auth.ts`. Si el tenant no tiene ese binding, el workflow no se registra para ese tenant y el dispatcher lo saltea con aviso.

- [ ] **Step 2: Escribir el script**

```ts
// scripts/outreach-focus.mts
// Crea un foco de búsqueda desde la CLI, hasta que exista /focos (E4).
// Uso: npm run outreach:focus -- --tenant innovas --owner mati --file foco.json [--apply]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseFocusArgs } from "./outreach-focus-args.ts";

const args = parseFocusArgs(process.argv.slice(2));
const admin = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL as string,
	process.env.SUPABASE_SERVICE_ROLE_KEY as string,
	{ auth: { persistSession: false } },
);

const payload = JSON.parse(readFileSync(args.file, "utf8"));

const { data: tenant } = await admin
	.from("tenants")
	.select("id")
	.eq("slug", args.tenant)
	.single();
if (!tenant) throw new Error(`no existe el tenant ${args.tenant}`);

const { data: executor } = await admin
	.from("executors")
	.select("user_id")
	.eq("tenant_id", tenant.id)
	.eq("slug", args.owner)
	.single();
if (!executor) throw new Error(`no existe el ejecutor ${args.owner}`);

// Las listas cerradas se validan contra config_values, igual que el resto.
const { data: values } = await admin
	.from("config_values")
	.select("kind, value")
	.eq("tenant_id", tenant.id)
	.eq("active", true);
for (const [kind, value] of [
	["vector", payload.vector],
	["segmento", payload.segment],
	["hook", payload.hook],
	["idioma", payload.idioma],
] as const) {
	const ok = (values ?? []).some((row) => row.kind === kind && row.value === value);
	if (!ok) throw new Error(`${kind} "${value}" no está en config_values de ${args.tenant}`);
}

const row = {
	tenant_id: tenant.id,
	created_by: executor.user_id,
	name: payload.name,
	criteria: payload.criteria,
	vector: payload.vector,
	segment: payload.segment,
	hook: payload.hook,
	idioma: payload.idioma,
	max_accounts: payload.maxAccounts,
	max_contacts: payload.maxContacts,
};

if (!args.apply) {
	console.log("Sin --apply. Se crearía este foco:");
	console.log(JSON.stringify(row, null, 2));
	process.exit(0);
}

const { data, error } = await admin
	.from("search_focuses")
	.insert(row)
	.select("id")
	.single();
if (error) throw new Error(error.message);
console.log(`foco creado: ${data.id}`);
```

`scripts/outreach-focus-args.ts` parsea `--tenant`, `--owner`, `--file` y `--apply`, con el mismo estilo que `scripts/outreach-config-args.ts` (sin dependencias, con un test si ese archivo lo tiene).

En `package.json`:

```json
		"outreach:focus": "node --env-file=.env.local scripts/outreach-focus.mts",
```

- [ ] **Step 3: Probar en local**

```bash
npm run db:start
npm run outreach:focus -- --tenant innovas --owner mati --file /tmp/foco.json
```

Con `/tmp/foco.json`:

```json
{
  "name": "Envases GBA 50-200",
  "criteria": {
    "employeeRanges": ["50,200"],
    "locations": ["Buenos Aires, Argentina"],
    "keywords": ["envases"],
    "titles": ["owner", "founder", "gerente general"]
  },
  "vector": "v1_familiar_2gen_ar",
  "segment": "mid_market_ar",
  "hook": "h_metodo_en_la_cabeza",
  "idioma": "es_ar",
  "maxAccounts": 5,
  "maxContacts": 20
}
```

Esperado: imprime el payload sin escribir. Con `--apply`, imprime el id creado.

- [ ] **Step 4: Verde y commit**

```bash
npm run typecheck && npm test
git add scripts/outreach-focus.mts scripts/outreach-focus-args.ts package.json agents/outreach/schedules/dispatch.ts
git commit -m "feat: crear focos por CLI y cablear target-search al dispatcher"
```

---

### Task 10: Cierre de E1 contra producción

- [ ] **Step 1: Cargar las dos llaves de Apollo en Vercel Connect**

Desde la carpeta del proyecto, crear un conector de llave por persona y anotar sus uid (sin pegar las llaves en el chat ni en un archivo del repo):

```bash
vercel connect create apollo --name innovas-apollo-mati
vercel connect create apollo --name innovas-apollo-marcos
```

Si Apollo no está en el catálogo de servicios de Connect, usar el tipo de llave genérico que ofrezca `vercel connect create --help`. El valor que se pega es la API key de cada cuenta.

- [ ] **Step 2: Crear el binding del tenant**

Una fila en `tenant_connections` para `innovas`: `capability = 'leads'`, `provider = 'apollo'`, `enabled = true`, y en `config`:

```json
{ "connectorUids": ["innovas-apollo-mati", "innovas-apollo-marcos"] }
```

Se carga con el script de bindings que ya existe (`npm run connections:bind`), extendiéndolo si hace falta para aceptar el array.

- [ ] **Step 3: Presupuesto y workflow prendido**

```sql
insert into public.tenant_budgets (tenant_id, resource, daily_limit)
values ('<tenant innovas>', 'apollo_credits', 20);

insert into public.tenant_workflows (tenant_id, workflow, enabled, config)
values ('<tenant innovas>', 'target-search', true, '{"cadence_minutes": 60, "items_per_tick": 1}'::jsonb);
```

Presupuesto de 20 créditos/día a propósito: la cuenta de prueba tiene ~100 al mes.

- [ ] **Step 4: Crear un foco chico y esperar el cron**

`npm run outreach:focus` contra producción, con `maxAccounts: 5` y `maxContacts: 20`.

- [ ] **Step 5: Verificar**

```sql
select status, items_claimed, items_ok, items_refused, items_failed
from public.runs where workflow = 'target-search' order by started_at desc limit 3;

select name, status, accounts_found, contacts_found from public.search_focuses;

select count(*) filter (where source = 'apollo') as descubiertos,
       count(*) filter (where source = 'apollo' and email is null) as sin_email
from public.contacts;

select resource, sum(amount) from public.usage_entries
where workflow = 'target-search' group by resource;
```

Esperado: una corrida `ok` con la cuenta cerrada; el foco con sus contadores; contactos con `source = 'apollo'`, **todos sin email**; créditos asentados en `apollo_credits`.

- [ ] **Step 6: Borrar el spike y cerrar**

```bash
git rm scripts/spike-apollo.mts
git commit -m "chore: baja del spike de Apollo"
```

**E1 cerrada:** hay contactos reales descubiertos, sin haber pagado un solo crédito de email.

---

# Entrega 2 · Calificación

### Task 11: Spike de Jev (S1, S2)

**Files:**
- Create: `scripts/spike-jev.mts`
- Modify: `docs/superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md` (§12, S1 y S2)

**Interfaces:**
- Produces: dónde viene `confidence` y qué forma tienen `usage` y `providerMetadata` en la respuesta de `evaluate()`. La Task 12 lee defensivo de los dos lugares igual; el spike fija cuál es el real en el test.

- [ ] **Step 1: Escribir el script**

```ts
// scripts/spike-jev.mts
// Spike S1/S2 (spec etapa 13 §12): forma real de la respuesta de evaluate()
// con typesafe-ai/jev por el AI Gateway. Se borra al cerrar E2.
import { experimental_evaluate as evaluate } from "ai";

const result = await evaluate({
	model: "typesafe-ai/jev",
	state: {
		persona: { nombre: "Laura Gómez", cargo: "Gerente General" },
		empresa: {
			nombre: "Acme",
			dominio: "acme.test",
			empleados: 120,
			rubro: "envases",
			ubicacion: "Rosario, Argentina",
		},
	},
	questions: {
		encaje_empresa: {
			type: "score",
			instructions: "¿Qué tan bien entra esta empresa en el ICP descrito?",
			criteria: [
				"No es del universo: rubro ajeno o tamaño fuera de rango",
				"Podría ser: entra en tamaño y geografía pero no se ve el problema",
				"Encaja: tamaño, rubro y señales de operación creciendo",
			],
		},
		excluir: {
			type: "noul",
			instructions: "¿Es competidora, ya cliente, o proveedora nuestra?",
		},
	},
	providerOptions: { gateway: { zeroDataRetention: true } },
});

console.log("answers:", JSON.stringify(result.answers, null, 2));
console.log("usage:", JSON.stringify(result.usage));
console.log("providerMetadata:", JSON.stringify(result.providerMetadata, null, 2));
```

- [ ] **Step 2: Correrlo**

Run: `node --env-file=.env.local scripts/spike-jev.mts`

Anotar: (a) si `confidence` viene dentro de cada answer o en `providerMetadata.typesafe`; (b) si `usage` usa `inputTokens`/`outputTokens` (camelCase, como `generateText`) o `input_tokens`; (c) si `providerMetadata.gateway.cost` está presente y en qué tipo (string o número). Si falla por créditos del Gateway, cargarlos y repetir.

- [ ] **Step 3: Anotar en la spec y commitear**

```bash
git add scripts/spike-jev.mts docs/superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md
git commit -m "docs: resultado de los spikes de Jev (S1, S2)"
```

---

### Task 12: El envoltorio de `evaluate()`, medido

**Files:**
- Create: `lib/outreach/services/evaluate.ts`
- Test: `tests/outreach/services/evaluate.test.ts`
- Modify: `tests/workflows/model-calls.test.ts` (que la regla cubra `evaluate`)
- Modify: `lib/workflows/pricing.ts` (precio de Jev como respaldo)

**Interfaces:**
- Consumes: `metered`, `createUsageRecorder` de `lib/workflows/usage.ts` (Etapa 12).
- Produces:
  - `interface JevScore { score: number; confidence: number; probabilities: Record<string, number> }`
  - `interface JevNoul { probability: number }`
  - `runEvaluation(args, deps): Promise<{ answers: Record<string, unknown>; usage: unknown; providerMetadata: unknown }>`
  - `readScore(answers, providerMetadata, key): JevScore | null`
  - `readNoul(answers, key): JevNoul | null`

- [ ] **Step 1: Test que falla**

```ts
// tests/outreach/services/evaluate.test.ts
import { describe, expect, it } from "vitest";
import { readNoul, readScore } from "@/lib/outreach/services/evaluate";

describe("readScore", () => {
	it("lee confidence de adentro de la answer", () => {
		const answers = {
			encaje: {
				type: "score",
				score: 1.8,
				confidence: 0.91,
				probabilities: { "0": 0, "1": 0.2, "2": 0.8 },
			},
		};
		expect(readScore(answers, undefined, "encaje")).toEqual({
			score: 1.8,
			confidence: 0.91,
			probabilities: { "0": 0, "1": 0.2, "2": 0.8 },
		});
	});

	it("lee confidence de providerMetadata.typesafe cuando no viene en la answer", () => {
		// Las dos docs difieren en dónde vive: se lee de los dos lados (S1).
		const answers = {
			encaje: { type: "score", score: 1.8, probabilities: { "1": 0.2, "2": 0.8 } },
		};
		const meta = { typesafe: { confidence: { encaje: 0.77 } } };
		expect(readScore(answers, meta, "encaje")?.confidence).toBe(0.77);
	});

	it("sin confianza en ningún lado devuelve 0: se trata como baja, no como alta", () => {
		const answers = { encaje: { type: "score", score: 2, probabilities: {} } };
		expect(readScore(answers, undefined, "encaje")?.confidence).toBe(0);
	});

	it("una answer que no está o no es score devuelve null", () => {
		expect(readScore({}, undefined, "encaje")).toBeNull();
		expect(
			readScore({ encaje: { type: "noul", noul: 0.9 } }, undefined, "encaje"),
		).toBeNull();
	});
});

describe("readNoul", () => {
	it("lee la probabilidad, venga como noul o como probability", () => {
		expect(readNoul({ excluir: { type: "noul", noul: 0.93 } }, "excluir")).toEqual({
			probability: 0.93,
		});
		expect(
			readNoul({ excluir: { type: "noul", probability: 0.4 } }, "excluir"),
		).toEqual({ probability: 0.4 });
	});

	it("una forma inesperada devuelve null en vez de inventar un número", () => {
		expect(readNoul({ excluir: { type: "noul" } }, "excluir")).toBeNull();
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/outreach/services/evaluate.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// lib/outreach/services/evaluate.ts
// Llamadas a Jev por el AI Gateway (spec etapa 13 §7.1). Se lee defensivo:
// la doc de Vercel y la de TypeSafe difieren en dónde vive `confidence` (S1).
import { experimental_evaluate as evaluate } from "ai";

export interface JevScore {
	score: number;
	confidence: number;
	probabilities: Record<string, number>;
}

export interface JevNoul {
	probability: number;
}

type Row = Record<string, unknown>;

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

function confidenceFromMeta(
	providerMetadata: unknown,
	key: string,
): number | null {
	const typesafe = (providerMetadata as Row | undefined)?.typesafe as
		| Row
		| undefined;
	const confidence = typesafe?.confidence;
	if (typeof confidence === "number") return confidence;
	const byKey = (confidence as Row | undefined)?.[key];
	return typeof byKey === "number" ? byKey : null;
}

export function readScore(
	answers: Row,
	providerMetadata: unknown,
	key: string,
): JevScore | null {
	const answer = answers[key] as Row | undefined;
	if (!answer || answer.type !== "score") return null;
	if (typeof answer.score !== "number") return null;
	return {
		score: answer.score,
		// Sin confianza en ningún lado vale 0: se trata como baja y va al carril
		// humano. Nunca al revés.
		confidence: numberOr(
			answer.confidence ?? confidenceFromMeta(providerMetadata, key),
			0,
		),
		probabilities: (answer.probabilities as Record<string, number>) ?? {},
	};
}

export function readNoul(answers: Row, key: string): JevNoul | null {
	const answer = answers[key] as Row | undefined;
	if (!answer || answer.type !== "noul") return null;
	const probability = answer.noul ?? answer.probability;
	return typeof probability === "number" ? { probability } : null;
}

export interface EvaluationArgs {
	model: string;
	state: unknown;
	questions: Record<string, unknown>;
}

/**
 * `evaluate` inyectado para poder probar sin llamar al modelo. `usage` y
 * `providerMetadata` viajan para que la puerta los asiente con `metered`.
 */
export async function runEvaluation(
	args: EvaluationArgs,
	deps: { evaluate: typeof evaluate; abortSignal?: AbortSignal },
): Promise<{ answers: Row; usage: unknown; providerMetadata: unknown }> {
	const result = await deps.evaluate({
		model: args.model,
		state: args.state,
		questions: args.questions,
		abortSignal: deps.abortSignal,
		// Datos personales de terceros pasando por un modelo.
		providerOptions: { gateway: { zeroDataRetention: true } },
	} as Parameters<typeof evaluate>[0]);

	return {
		answers: (result.answers ?? {}) as Row,
		usage: result.usage,
		providerMetadata: result.providerMetadata,
	};
}
```

- [ ] **Step 4: Precio de respaldo y la regla de medición**

En `lib/workflows/pricing.ts`, sumar a `MODEL_PRICES`:

```ts
	// Modelo de evaluación: la salida no se cobra por token.
	"typesafe-ai/jev": { input: 0.04, output: 0 },
```

En `tests/workflows/model-calls.test.ts`, extender la regla para que también atrape `evaluate`:

```ts
const IMPORTS_MODEL_CALL =
	/import\s*\{[^}]*(?<!type\s)\b(generateText|experimental_evaluate)\b[^}]*\}\s*from\s*"ai"/;
```

y usar `IMPORTS_MODEL_CALL` donde antes usaba `IMPORTS_GENERATE_TEXT`. El archivo nuevo `lib/outreach/services/evaluate.ts` importa `experimental_evaluate` y **no** usa `metered` — la medición se engancha en la puerta, igual que con `generateDraft`. Para que la regla siga siendo cierta, sumar `lib/outreach/services/evaluate.ts` a la lista de excluidos del test, con su motivo, igual que `generate-draft.ts`.

- [ ] **Step 5: Correr y ver pasar**

Run: `npm run typecheck && npm test`
Esperado: verde. Si el spike de la Task 11 mostró que `confidence` viene solo de un lado, dejar igual el lector defensivo y agregar un test que fije la forma observada.

- [ ] **Step 6: Commit**

```bash
git add lib/outreach/services/evaluate.ts lib/workflows/pricing.ts tests/outreach/services/evaluate.test.ts tests/workflows/model-calls.test.ts
git commit -m "feat: llamadas a Jev por el Gateway, con lectura defensiva"
```

---

### Task 13: Los niveles del ICP en la config del tenant

**Files:**
- Modify: `lib/outreach/config.ts`
- Modify: `tenants/innovas/outreach.json`
- Test: `tests/outreach/config.test.ts` (o el archivo que ya prueba `parseOutreachConfig`)

**Interfaces:**
- Produces: `OutreachConfig.icp: { revision: string; encaje_empresa: string[]; rol_decisor: string[]; excluir: string } | null`.

- [ ] **Step 1: Test que falla**

```ts
	it("acepta los niveles del ICP y exige entre 2 y 10 por dimensión", () => {
		const config = parseOutreachConfig({
			icp: {
				revision: "2026-09-22",
				encaje_empresa: ["no entra", "podría", "encaja"],
				rol_decisor: ["sin relación", "influye", "decide"],
				excluir: "Es competidora, ya cliente, o proveedora",
			},
		});
		expect(config.icp?.revision).toBe("2026-09-22");
		expect(config.icp?.encaje_empresa).toHaveLength(3);
	});

	it("un solo nivel no es una escala: se rechaza", () => {
		expect(() =>
			parseOutreachConfig({
				icp: {
					revision: "r1",
					encaje_empresa: ["uno"],
					rol_decisor: ["a", "b"],
					excluir: "x",
				},
			}),
		).toThrow();
	});

	it("sin bloque icp, la config sigue siendo válida y el scoring no corre", () => {
		expect(parseOutreachConfig({}).icp).toBeNull();
	});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/outreach/config.test.ts`
Esperado: FALLA: `icp` no existe en el schema.

- [ ] **Step 3: Extender el schema**

En `lib/outreach/config.ts`, dentro de `outreachConfigSchema`:

```ts
	// Los niveles del score del ICP (spec etapa 13 §7.2). `revision` entra en
	// el input_hash del scoring: tocarla recalifica a todos.
	icp: z
		.object({
			revision: z.string().min(1).max(40),
			encaje_empresa: z.array(z.string().min(10).max(400)).min(2).max(10),
			rol_decisor: z.array(z.string().min(10).max(400)).min(2).max(10),
			excluir: z.string().min(10).max(400),
		})
		.nullable()
		.default(null),
```

- [ ] **Step 4: Cargar los niveles de `innovas`**

En `tenants/innovas/outreach.json`, dentro de `config`:

```json
    "icp": {
      "revision": "2026-09-22",
      "encaje_empresa": [
        "No es del universo: rubro ajeno, tamaño fuera de rango, o sin operación propia que coordinar",
        "Podría ser: entra en tamaño y geografía, pero no se ve el problema de coordinación que resolvemos",
        "Encaja: tamaño y rubro del ICP, con señales de que la operación creció más rápido que su método"
      ],
      "rol_decisor": [
        "Sin relación con esta decisión: otra área, o rol sin injerencia en cómo opera la empresa",
        "Influye: sufre el problema o lo reporta, pero no aprueba el gasto",
        "Decide: dueño, dirección o gerencia con control sobre el presupuesto de operación"
      ],
      "excluir": "La empresa es competidora nuestra, ya es cliente, o es proveedora nuestra"
    }
```

Estos textos son un punto de partida: los ajusta Matías contra el canon real antes de la corrida piloto.

- [ ] **Step 5: Aplicar y commitear**

```bash
npm run outreach:config -- --tenant innovas          # imprime el diff
npm run outreach:config -- --tenant innovas --apply
npm run typecheck && npm test
git add lib/outreach/config.ts tenants/innovas/outreach.json tests/outreach/config.test.ts
git commit -m "feat: niveles del ICP en la config del tenant"
```

---

### Task 14: La política de decisión

**Files:**
- Create: `lib/outreach/icp.ts`
- Test: `tests/outreach/icp.test.ts`

**Interfaces:**
- Consumes: `JevScore`, `JevNoul` (Task 12).
- Produces:
  - `interface IcpJudgments { encaje: JevScore | null; rol: JevScore | null; excluir: JevNoul | null }`
  - `interface IcpThresholds { encaje: number; rol: number; confidence: number; excluir: number }`
  - `DEFAULT_ICP_THRESHOLDS: IcpThresholds`
  - `decideIcp(judgments, thresholds): { lane: "calificado" | "descartado" | "para_revisar"; reason: string }`

- [ ] **Step 1: Test que falla**

```ts
// tests/outreach/icp.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ICP_THRESHOLDS, decideIcp } from "@/lib/outreach/icp";

const alto = { score: 1.8, confidence: 0.9, probabilities: {} };
const bajo = { score: 0.4, confidence: 0.9, probabilities: {} };
const inseguro = { score: 1.9, confidence: 0.4, probabilities: {} };
const sinExcluir = { probability: 0.05 };

describe("decideIcp", () => {
	it("puntaje alto, rol alto y confianza alta: califica", () => {
		expect(
			decideIcp(
				{ encaje: alto, rol: alto, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "calificado" });
	});

	it("puntaje bajo con confianza alta: descarta sin gastar", () => {
		expect(
			decideIcp(
				{ encaje: bajo, rol: alto, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "descartado", reason: "encaje_bajo" });
	});

	it("excluir alto gana sobre cualquier puntaje", () => {
		expect(
			decideIcp(
				{ encaje: alto, rol: alto, excluir: { probability: 0.95 } },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "descartado", reason: "excluido" });
	});

	it("confianza baja en la dimensión que decide: va a revisión, no descarta", () => {
		expect(
			decideIcp(
				{ encaje: inseguro, rol: alto, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "para_revisar", reason: "confianza_baja" });
	});

	it("la confianza que manda es la mínima de las dimensiones que se usaron", () => {
		// Encaje seguro pero rol inseguro: la decisión usa las dos, así que revisa.
		expect(
			decideIcp(
				{ encaje: alto, rol: { score: 1.5, confidence: 0.3, probabilities: {} }, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "para_revisar" });
	});

	it("un excluir inseguro no descarta: revisa", () => {
		expect(
			decideIcp(
				{ encaje: alto, rol: alto, excluir: { probability: 0.6 } },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "para_revisar" });
	});

	it("un juicio que no vino va a revisión, nunca a calificado", () => {
		expect(
			decideIcp(
				{ encaje: null, rol: alto, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "para_revisar", reason: "juicio_incompleto" });
	});

	it("rol bajo con confianza alta descarta", () => {
		expect(
			decideIcp(
				{ encaje: alto, rol: { score: 0.2, confidence: 0.95, probabilities: {} }, excluir: sinExcluir },
				DEFAULT_ICP_THRESHOLDS,
			),
		).toMatchObject({ lane: "descartado", reason: "rol_bajo" });
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/outreach/icp.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// lib/outreach/icp.ts
// La política de decisión del scoring (spec etapa 13 §7.3 y §7.4). Función
// pura sobre los juicios crudos: cambiar un umbral re-decide a todos sin
// volver a llamar a Jev.
import type { JevNoul, JevScore } from "./services/evaluate";

export interface IcpJudgments {
	encaje: JevScore | null;
	rol: JevScore | null;
	excluir: JevNoul | null;
}

export interface IcpThresholds {
	encaje: number;
	rol: number;
	confidence: number;
	excluir: number;
}

/** Conservadores a propósito: no se aflojan hasta tener el contraste con lo
 * que el humano aprobó y el mercado contestó (spec §7.5). */
export const DEFAULT_ICP_THRESHOLDS: IcpThresholds = {
	encaje: 1.5,
	rol: 1.0,
	confidence: 0.7,
	excluir: 0.2,
};

export type IcpLane = "calificado" | "descartado" | "para_revisar";

export function decideIcp(
	judgments: IcpJudgments,
	thresholds: IcpThresholds,
): { lane: IcpLane; reason: string } {
	const { encaje, rol, excluir } = judgments;
	if (!encaje || !rol || !excluir) {
		return { lane: "para_revisar", reason: "juicio_incompleto" };
	}

	// El excluyente se evalúa primero, pero solo decide si viene seguro. Un
	// "puede que sea competidora" con la moneda al aire va a revisión.
	if (excluir.probability >= 0.5) {
		return excluir.probability >= 1 - thresholds.excluir
			? { lane: "descartado", reason: "excluido" }
			: { lane: "para_revisar", reason: "excluir_inseguro" };
	}

	// La confianza que manda es la mínima de las dimensiones que se usaron.
	const confianza = Math.min(encaje.confidence, rol.confidence);
	if (confianza < thresholds.confidence) {
		return { lane: "para_revisar", reason: "confianza_baja" };
	}

	if (encaje.score < thresholds.encaje) {
		return { lane: "descartado", reason: "encaje_bajo" };
	}
	if (rol.score < thresholds.rol) {
		return { lane: "descartado", reason: "rol_bajo" };
	}
	return { lane: "calificado", reason: "encaje_y_rol" };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/outreach/icp.test.ts`
Esperado: PASA (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/icp.ts tests/outreach/icp.test.ts
git commit -m "feat: política de decisión del scoring de ICP"
```

---

### Task 15: El nodo y el workflow de calificación

**Files:**
- Create: `lib/outreach/services/icp-score.ts`
- Create: `lib/outreach/workflows/icp-scoring.ts`
- Modify: `lib/workflows/registry.ts`
- Modify: `lib/outreach/store.ts` (`updateContactIcp`)
- Test: `tests/outreach/services/icp-score.test.ts`

**Interfaces:**
- Consumes: `runEvaluation`, `readScore`, `readNoul` (Task 12); `decideIcp` (Task 14); la config `icp` (Task 13).
- Produces:
  - `scoreContact(input, deps): Promise<Refusal | { ok: true; lane: IcpLane; reason: string; judgments: IcpJudgments }>`
  - `createIcpScoringWorkflow(deps): WorkflowImpl`
  - Registry: nodo `outreach/icp-score` (efecto 1, modelo `typesafe-ai/jev`) y workflow `icp-scoring`.

- [ ] **Step 1: Test que falla**

```ts
// tests/outreach/services/icp-score.test.ts
import { describe, expect, it, vi } from "vitest";
import { scoreContact } from "@/lib/outreach/services/icp-score";
import { createFakeStore, contactRow, TENANT } from "../fake-store";

const ANSWERS = {
	encaje_empresa: { type: "score", score: 1.9, confidence: 0.9, probabilities: {} },
	rol_decisor: { type: "score", score: 1.8, confidence: 0.88, probabilities: {} },
	excluir: { type: "noul", noul: 0.03 },
};

function deps(store = createFakeStore(), answers: unknown = ANSWERS) {
	return {
		store,
		evaluate: vi.fn(async () => ({
			answers: answers as Record<string, unknown>,
			usage: { inputTokens: 400, outputTokens: 20 },
			providerMetadata: { gateway: { cost: 0.000016 } },
		})),
		now: () => new Date("2026-09-22T12:00:00Z"),
	};
}

describe("scoreContact", () => {
	it("manda el estado con la persona y la empresa, sin email", async () => {
		const store = createFakeStore();
		store.contacts.push({ ...contactRow(), title: "Gerente General" });
		store.accounts.push({
			id: "a1",
			tenantId: TENANT,
			domain: "acme.test",
			name: "Acme",
			ficha: {},
			firmographics: { employees: 120, industry: "envases" },
			researchedAt: "2026-09-01T00:00:00Z",
			expiresAt: "2026-12-01T00:00:00Z",
		} as never);
		const d = deps(store);

		await scoreContact({ tenantId: TENANT, contactId: store.contacts[0].id }, d);

		const args = d.evaluate.mock.calls[0][0] as { state: Record<string, unknown> };
		expect(JSON.stringify(args.state)).not.toContain("@");
		expect(JSON.stringify(args.state)).toContain("Gerente General");
	});

	it("guarda los juicios crudos y devuelve el carril", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			deps(store),
		);

		expect(result).toMatchObject({ ok: true, lane: "calificado" });
		expect(store.contacts[0].icp).toMatchObject({
			encaje_empresa: { score: 1.9 },
			lane: "calificado",
		});
	});

	it("sin niveles cargados en el tenant no llama al modelo", async () => {
		const store = createFakeStore();
		store.tenants.set(TENANT, {
			...store.tenants.get(TENANT),
			config: { ...store.tenants.get(TENANT)?.config, icp: null },
		} as never);
		store.contacts.push(contactRow());
		const d = deps(store);

		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			d,
		);

		expect(result).toMatchObject({ ok: false, reason: "icp_sin_niveles" });
		expect(d.evaluate).not.toHaveBeenCalled();
	});

	it("una respuesta con forma inesperada va a revisión, no a calificado", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			deps(store, { encaje_empresa: { type: "score" } }),
		);
		expect(result).toMatchObject({ ok: true, lane: "para_revisar" });
	});
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/outreach/services/icp-score.test.ts`
Esperado: FALLA con módulo inexistente.

- [ ] **Step 3: Implementar el nodo**

```ts
// lib/outreach/services/icp-score.ts
// Nodo outreach/icp-score (spec etapa 13 §7): tres preguntas a Jev en una
// request, sobre lo que la búsqueda ya devolvió gratis. Sin email, sin research.
import { decideIcp, DEFAULT_ICP_THRESHOLDS, type IcpJudgments, type IcpLane } from "../icp";
import { type Refusal, refuse } from "../result";
import type { OutreachStore } from "../store";
import { readNoul, readScore, type runEvaluation } from "./evaluate";

export const JEV_MODEL = "typesafe-ai/jev";

export interface IcpScoreDeps {
	store: OutreachStore;
	evaluate: (
		args: Parameters<typeof runEvaluation>[0],
	) => Promise<Awaited<ReturnType<typeof runEvaluation>>>;
	now: () => Date;
}

export type IcpScoreResult =
	| Refusal
	| { ok: true; lane: IcpLane; reason: string; judgments: IcpJudgments };

export async function scoreContact(
	input: { tenantId: string; contactId: string },
	deps: IcpScoreDeps,
): Promise<IcpScoreResult> {
	const tenant = await deps.store.loadTenantOutreach(input.tenantId);
	const levels = tenant?.config.icp;
	if (!levels) {
		return refuse(
			"icp_sin_niveles",
			"este tenant no tiene los niveles del ICP cargados: no se puede calificar",
		);
	}

	const contact = await deps.store.findContactById(input.tenantId, input.contactId);
	if (!contact) {
		return refuse("contacto_inexistente", `no existe el contacto ${input.contactId}`);
	}
	const account = contact.accountId
		? await deps.store.findAccountById(input.tenantId, contact.accountId)
		: null;

	// El estado: solo lo que vino gratis de la búsqueda. Nada de email.
	const state = {
		persona: { nombre: contact.name, cargo: contact.title },
		empresa: {
			nombre: contact.company,
			dominio: account?.domain ?? null,
			...(account?.firmographics ?? {}),
		},
	};

	const { answers, usage, providerMetadata } = await deps.evaluate({
		model: JEV_MODEL,
		state,
		questions: {
			encaje_empresa: {
				type: "score",
				instructions:
					"¿Qué tan bien entra esta empresa en el perfil de cliente ideal descrito en los niveles?",
				criteria: levels.encaje_empresa,
			},
			rol_decisor: {
				type: "score",
				instructions:
					"¿Qué tanto esta persona está parada donde se decide o se sufre este problema?",
				criteria: levels.rol_decisor,
			},
			excluir: { type: "noul", instructions: levels.excluir },
		},
	});
	void usage;

	const judgments: IcpJudgments = {
		encaje: readScore(answers, providerMetadata, "encaje_empresa"),
		rol: readScore(answers, providerMetadata, "rol_decisor"),
		excluir: readNoul(answers, "excluir"),
	};
	const decision = decideIcp(
		judgments,
		tenant?.config.icpThresholds ?? DEFAULT_ICP_THRESHOLDS,
	);

	await deps.store.updateContactIcp(input.tenantId, contact.id, {
		encaje_empresa: judgments.encaje,
		rol_decisor: judgments.rol,
		excluir: judgments.excluir,
		lane: decision.lane,
		reason: decision.reason,
		model: JEV_MODEL,
		revision: levels.revision,
		judged_at: deps.now().toISOString(),
	});

	return { ok: true, lane: decision.lane, reason: decision.reason, judgments };
}
```

El store suma `findContactById`, `findAccountById` y `updateContactIcp(tenantId, id, icp)` siguiendo el patrón del archivo. `tenant.config.icpThresholds` es opcional: si no está, valen los defaults.

- [ ] **Step 4: El workflow y el registry**

`lib/outreach/workflows/icp-scoring.ts` expone `createIcpScoringWorkflow(deps)` con un `runItem` que llama a `scoreContact` y devuelve:

- `lane === "calificado"` → `{ ok: true, downstream: [{ subjectId: contactId, inputHash: contactId }] }`
- `lane === "descartado"` → `{ ok: false, reason: decision.reason, message: ... }` (es respuesta de negocio, no se reintenta)
- `lane === "para_revisar"` → `{ ok: true }` **sin** `downstream`: no avanza ni se descarta, queda esperando a una persona

Sin sembrador: los ítems los encola `target-search` aguas abajo.

En `lib/workflows/registry.ts`:

```ts
	"outreach/icp-score": { effect: 1, tier: null, model: "typesafe-ai/jev" },
```

```ts
	"icp-scoring": {
		agent: "outreach",
		subjectType: "contact",
		claims: "contacto_descubierto",
		produces: "contacto_calificado",
		nodes: ["outreach/icp-score"],
		optionalNodes: [],
		resources: ["model_usd"],
		caps: { itemsPerTick: 20, costUsdPerRun: 0.5 },
		entry: "upstream",
	},
```

`NodeInfo` suma el campo opcional `model` (enmienda §15 punto 1 de la spec). Anotarla en la spec de la Etapa 12 §9.1 en el mismo commit.

- [ ] **Step 5: Cablear al dispatcher y verde**

En `agents/outreach/schedules/dispatch.ts`, registrar `icp-scoring` con `evaluate` envuelto en `metered` (nodo `outreach/icp-score`, recurso `model_usd`, `runId` de la pasada).

Run: `npm run typecheck && npm test`

- [ ] **Step 6: Commit**

```bash
git add lib/outreach/services/icp-score.ts lib/outreach/workflows/icp-scoring.ts lib/workflows/registry.ts lib/outreach/store.ts agents/outreach/schedules/dispatch.ts tests/outreach/services/icp-score.test.ts docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md
git commit -m "feat: calificación de ICP con Jev"
```

---

### Task 16: Evals del scoring y cierre de E2

**Files:**
- Create: `agents/outreach/evals/icp-score.eval.ts`
- Create: `tests/fixtures/icp-casos.json`

- [ ] **Step 1: Armar los casos etiquetados**

20 contactos reales ya descubiertos por E1, anonimizados (nombre de pila y empresa cambiados, firmográficos intactos), con el veredicto humano de Matías: `calificado` o `descartado`. Es trabajo manual y es el único dato que permite saber si Jev sirve para este dominio.

- [ ] **Step 2: La eval**

Corre `scoreContact` con el `evaluate` real sobre los 20 casos y mide: cuántos coinciden con el veredicto humano, cuántos falsos positivos (calificó a uno que Matías descartó) y cuántos falsos negativos. Falla si la coincidencia baja de un piso que se fija con la primera corrida — no antes, porque inventar un número sin datos es peor que no tener el test.

- [ ] **Step 3: Verificación de E2 contra producción**

```sql
select icp->>'lane' as carril, count(*)
from public.contacts where tenant_id = '<innovas>' and icp ? 'lane'
group by 1;

select sum(amount) from public.usage_entries
where workflow = 'icp-scoring' and resource = 'model_usd';
```

Esperado: los tres carriles poblados, y el costo de calificar un lote entero en el orden de centavos.

- [ ] **Step 4: Borrar el spike y cerrar**

```bash
git rm scripts/spike-jev.mts
git commit -m "chore: baja del spike de Jev"
```

**E2 cerrada:** los contactos descubiertos están calificados y nadie pagó un crédito de email todavía.

---

# Entrega 3 · Enrichment y pieza — alcance e interfaces

Se detalla al cerrar E2. Lo que queda fijado:

| Archivo | Responsabilidad |
|---|---|
| `lib/outreach/services/reveal-email.ts` | Nodo `leads/reveal-email`: revela, promueve la clave (§6.3), refusa `duplicado` y `contacto_ya_tocado` |
| `lib/outreach/workflows/contact-enrichment.ts` | Revela el email y asegura la ficha de la cuenta con el nodo `outreach/research` que ya existe |
| `lib/outreach/services/verify-fact.ts` | Nodo `outreach/verify-fact`: una pregunta `noul` a Jev sobre el hecho que eligió `draft_message` |
| `lib/outreach/workflows/draft-queue.ts` | Redacta, verifica el ancla, encola. Respeta `executors.daily_quota` |

**Decisiones ya tomadas:**

- La promoción de clave va en el nodo de revelado, no en el workflow: es una sola transacción con el revelado.
- `draft-queue` corta por cupo del ejecutor, no por tope del workflow: el cupo es por persona y ya existe en `executors.daily_quota`.
- Un contacto que queda sin cupo no falla: queda `contacto_listo` y lo toma la pasada de mañana.
- `verify-fact` corre **después** de `draft_message` y sobre su ancla, no sobre la ficha entera.
- El `input_hash` de `contact-enrichment` es el `contactId` pelado: revelar un email es irrepetible.

# Entrega 4 · Pantallas — alcance

| Pantalla | Qué |
|---|---|
| `/focos` (nueva) | Formulario de foco (filtros + atribución + topes), lista con contadores, embudo por foco |
| `/focos/<id>/revisar` | La bandeja de baja confianza: puntaje, confianza, razones, y dos botones (calificar / descartar) |
| `/contactos` (crece) | Columna de puntaje ICP y su filtro |

Las server actions siguen el patrón de `/cola`: zod en el borde, `caller` de la sesión, nunca del cliente. Calificar a mano encola el enrichment con `enqueue()`; descartar cierra el contacto con su razón. El formulario reemplaza a `scripts/outreach-focus.mts`, que se borra en esa entrega.

---

## Auto-revisión del plan

**Cobertura de la spec (E1 y E2):**

| Spec | Task |
|---|---|
| §5.1 `LeadsAdapter` + Apollo | 2 |
| §5.1 fallback entre llaves (D5) | 3 |
| §8.1 `search_focuses` · §8.2 y §8.3 alters | 4 |
| §4.1 aristas 1 a N (enmienda) | 5 |
| §6.1 qué guarda el foco · §6.2 claim | 4, 6, 7 |
| §5.2 nodo `leads/search-targets` | 7 |
| §4.1 workflow `target-search` con su `input_hash` | 8 |
| §12 spikes S3/S4/S5 | 1 |
| §7.1 la llamada a Jev · §12 S1/S2 | 11, 12 |
| §7.2 niveles en config | 13 |
| §7.3 política en código · §7.4 tres carriles | 14 |
| §7 nodo y workflow de scoring | 15 |
| §11 evals con veredicto humano | 16 |
| §8.4 `apollo_credits` en presupuestos | 10 |

**Lo que este plan NO cubre y está en E3/E4:** §6.3 promoción de la clave, `verify-fact`, el cupo en `draft-queue`, y las tres pantallas. Todos con alcance fijado arriba.

**Desvíos respecto de la spec, para corregir en la spec al ejecutar:**

1. El nodo se llama `outreach/target-search`, no `leads/search-targets`: la clave del registry sale de la ruta del archivo (`lib/outreach/services/`), y el servicio vive en el dominio de outreach porque usa su store, su `contact_key` y sus guards. La capacidad `leads` sigue siendo del adapter.
2. `NodeInfo` suma `model?: string` (ya previsto como enmienda §15 punto 1, pero conviene hacerlo en la Task 15 y no antes).
3. El test del registry de la Etapa 12 exige `costUsdPerRun > 0` a todo workflow con nodos de efecto ≥ 1. `target-search` no gasta tokens: la condición correcta es "declara al menos un recurso". Se ajusta en la Task 8.

**Consistencia de tipos:** `TargetCriteria` es el mismo tipo en el adapter, en `focus.ts` y en el nodo. `FocusRow` es el mismo en el store, el nodo y el workflow. `JevScore`/`JevNoul` son los mismos en `evaluate.ts`, `icp.ts` e `icp-score.ts`. `ItemOutcome.downstream` tiene la misma forma en `types.ts`, el runner y los dos workflows.
