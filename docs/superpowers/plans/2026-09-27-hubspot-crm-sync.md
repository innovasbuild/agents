# Sync entrante de HubSpot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un job periódico (dos veces al día) que reconcilia, por tenant, los contactos con `crm_id` cargado contra HubSpot: limpia `crm_id` cuando el contacto fue borrado en HubSpot, corrige el owner local cuando cambió en HubSpot, y refleja en el historial las notas agregadas a mano en HubSpot.

**Architecture:** Un nodo puro nuevo (`lib/outreach/services/crm-sync.ts`, efecto 0) recibe deps inyectadas (store + `CrmAdapter` ya resuelto) y reconcilia un tenant. Un `defineSchedule` de eve (`agents/outreach/schedules/crm-sync.ts`) es la única parte que conoce Supabase/HubSpot reales: itera tenants activos con HubSpot conectado, resuelve el token con el mismo mecanismo "sin sesión" que ya usa `morning-sweep.ts` para Gmail, arma el adapter, y llama al nodo — sin test directo, igual que `morning-sweep.ts` (toda la lógica queda en el nodo, testeado con fakes).

**Tech Stack:** TypeScript, Next.js/eve, Supabase (Postgres + `@supabase/supabase-js`), Vitest, `@vercel/connect` para el token OAuth de HubSpot.

**Spec:** `docs/superpowers/specs/2026-09-27-hubspot-crm-sync-design.md`

## Global Constraints

- El nodo `outreach/crm-sync` es efecto 0: nunca escribe hacia HubSpot, solo lee de HubSpot y escribe en la base propia (spec D1).
- Nunca se borra una fila de `contacts`, ni se toca `stage` (spec §2 criterio 4, D2).
- Contacto no encontrado en HubSpot → `crm_id` a `null` + evento `crm_id_huerfano` (spec D2).
- El owner se corrige por `hubspot_owner_id` ↔ `executors.crm_owner_id`, sin pasar por la lógica de "claim" de 90 días (spec D3).
- Todo evento nuevo de este job usa `channel: null` (mismo criterio que los eventos de `cambio_etapa`/`nota` en `crm-record.ts` — no son de un canal de outreach).
- Notas nuevas de HubSpot van a `events` con `type: "nota"`, primer renglón `[in · hubspot · nota]` (spec D4).
- El batch check usa `POST /crm/v3/objects/contacts/batch/read`, no una llamada por contacto (spec D5).
- Un tenant que falla (sin grant válido, error de HubSpot) no frena a los demás tenants (spec §2 criterio 5).
- Fuera de alcance: sync de `stage`/`dealstage`, webhooks nativos de HubSpot, companies/deals como objetos propios (spec §2).
- `npm test` y `npm run typecheck` en verde al final de cada task.

## Review Focus

- **Más de 100 contactos con `crm_id` en un tenant.** `POST /crm/v3/objects/contacts/batch/read` acepta como máximo 100 IDs por llamada — sin particionar, HubSpot devuelve un error y el tenant entero queda sin reconciliar. Cubierto en Task 2.
- **Un ID de HubSpot que aparece en `errors` con una categoría distinta de `OBJECT_NOT_FOUND`** (rate limit, permiso, timeout parcial del lado de HubSpot). El spec dice "nunca se asume encontrado por default" para lo no confirmado; hay que aplicar el mismo criterio al revés — nunca se asume **borrado** por default. Si se tratara como borrado, un problema transitorio de HubSpot le limpiaría el `crm_id` a un contacto que sigue existiendo. Cubierto en Task 2: esos IDs quedan fuera del resultado (ni found:true ni found:false), y el nodo los salta sin tocar nada.
- **Un tenant sin ningún contacto con `crm_id` cargado.** No debe llamar a HubSpot en absoluto (ni gastar una llamada de batch read con lista vacía). Cubierto en Task 4.
- **El `hubspot_owner_id` de un contacto no coincide con el `crm_owner_id` de ningún ejecutor del tenant** (owner de HubSpot que no es ejecutor de outreach, o tenant recién dado de alta sin `crm_owner_id` cargado en ningún ejecutor). No debe tocar `ownerUserId` ni inventar un valor. Cubierto en Task 4.
- **Un contacto puntual cuyo procesamiento (ej. `listNotesSince`) tira una excepción.** No puede frenar al resto de los contactos del mismo tenant — mismo criterio que ya sigue `sweep.ts` para respuestas de Gmail. Cubierto en Task 4.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/<timestamp>_contacts_crm_synced_at.sql` | Columna nueva `crm_synced_at` |
| `lib/connectors/crm/adapter.ts` | Interfaz `CrmAdapter` — dos métodos nuevos |
| `lib/connectors/crm/hubspot-adapter.ts` | Implementación REST de los dos métodos nuevos |
| `lib/outreach/crm-session.ts` | `withReauth` envuelve los dos métodos nuevos |
| `tests/outreach/fake-store.ts` | `fakeCrm()` con default de los dos métodos nuevos |
| `lib/outreach/store.ts` | `crmSyncedAt` en `ContactRow`/`ContactPatch`, dos métodos de lectura nuevos |
| `lib/outreach/events.ts` | Dos tipos de evento nuevos |
| `lib/outreach/services/crm-sync.ts` | Nodo puro `runCrmSync` (nuevo) |
| `lib/workflows/registry.ts` | Registro del nodo `outreach/crm-sync` |
| `agents/outreach/schedules/crm-sync.ts` | Wiring del schedule (cron, tokens, Supabase real) |

---

## Task 1: Migración — columna `contacts.crm_synced_at`

**Files:**
- Create: `supabase/migrations/20260927130000_contacts_crm_synced_at.sql`
- Modify: `lib/supabase/database.types.ts` (regenerado, no a mano)

**Interfaces:**
- Produces: columna `public.contacts.crm_synced_at` (`timestamptz`, nullable, sin default) — la consume `lib/outreach/store.ts` en la Task 3.

- [ ] **Step 1: Escribir la migración**

```sql
-- lib/outreach/services/crm-sync.ts (Task 4) la usa como marca de agua para no
-- volver a traer notas de HubSpot ya vistas en una corrida anterior. Sin
-- default: `null` es exactamente el estado real de todo contacto existente
-- hoy ("nunca sincronizado"). Sin default tampoco hay reescritura de tabla
-- (Postgres 11+ agrega una columna nullable sin default como metadata pura).
alter table public.contacts add column crm_synced_at timestamptz;
```

Guardar en `supabase/migrations/20260927130000_contacts_crm_synced_at.sql`.

- [ ] **Step 2: Aplicar la migración local y regenerar tipos**

Requiere Docker abierto (Supabase local).

```bash
npm run db:reset
npm run db:types
```

- [ ] **Step 3: Confirmar que el tipo generado tiene la columna**

```bash
grep -n "crm_synced_at" lib/supabase/database.types.ts
```

Expected: al menos una línea con `crm_synced_at: string | null` bajo `contacts` (`Row`, `Insert` y `Update`).

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: sin errores nuevos (la columna todavía no la usa nadie).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260927130000_contacts_crm_synced_at.sql lib/supabase/database.types.ts
git commit -m "feat: agrega contacts.crm_synced_at para el sync entrante de HubSpot"
```

---

## Task 2: `CrmAdapter` — `batchCheckContacts` y `listNotesSince`

**Files:**
- Modify: `lib/connectors/crm/adapter.ts`
- Modify: `lib/connectors/crm/hubspot-adapter.ts`
- Modify: `lib/outreach/crm-session.ts:50-59` (`withReauth`)
- Modify: `tests/outreach/fake-store.ts:98-110` (`fakeCrm`)
- Test: `tests/connectors/hubspot-adapter.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (independiente de la migración).
- Produces:
  - `CrmContactCheck { id: string; found: boolean; ownerId: string | null }`
  - `CrmAdapter.batchCheckContacts(crmIds: string[]): Promise<CrmContactCheck[]>` — el array de salida **puede tener menos elementos que `crmIds`**: un ID cuyo estado no se pudo confirmar (ni en `results`, ni en `errors` con `category: "OBJECT_NOT_FOUND"`) queda afuera, nunca se inventa `found: true` ni `found: false` para él.
  - `CrmActivityNote { id: string; body: string; at: Date; ownerId: string | null }`
  - `CrmAdapter.listNotesSince(crmId: string, sinceIso: string | null): Promise<CrmActivityNote[]>`
  - Task 4 (`crm-sync.ts`) consume ambos.

- [ ] **Step 1: Escribir el test que falla — `batchCheckContacts` separa found/no-found y parte en tandas de 100**

Agregar al final de `tests/connectors/hubspot-adapter.test.ts` (antes del `});` de cierre del `describe`):

```ts
	it("batchCheckContacts separa encontrados, borrados e inciertos, y parte en tandas de 100", async () => {
		const { calls, fetchImpl } = fakeHubSpot([
			{
				json: {
					results: [{ id: "1", properties: { hubspot_owner_id: "9" } }],
					numErrors: 2,
					errors: [
						{
							status: "error",
							category: "OBJECT_NOT_FOUND",
							message: "not found",
							context: { ids: ["2"] },
						},
						{
							status: "error",
							category: "RATE_LIMITS",
							message: "too many requests",
							context: { ids: ["3"] },
						},
					],
				},
			},
		]);
		const checks = await createHubSpotAdapter("tok", fetchImpl).batchCheckContacts(
			["1", "2", "3"],
		);
		// "3" quedó afuera: category RATE_LIMITS no confirma que esté borrado, y
		// no está en `results`, así que nunca se asume ni found ni not-found.
		expect(checks).toEqual([
			{ id: "1", found: true, ownerId: "9" },
			{ id: "2", found: false, ownerId: null },
		]);
		expect(calls[0]).toMatchObject({
			method: "POST",
			url: "https://api.hubapi.com/crm/v3/objects/contacts/batch/read",
			body: {
				properties: ["hubspot_owner_id"],
				inputs: [{ id: "1" }, { id: "2" }, { id: "3" }],
			},
		});

		// 150 IDs: dos llamadas, la primera con 100, la segunda con 50.
		const batched = fakeHubSpot([
			{ json: { results: [], errors: [] } },
			{ json: { results: [], errors: [] } },
		]);
		const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
		await createHubSpotAdapter("tok", batched.fetchImpl).batchCheckContacts(ids);
		expect(batched.calls).toHaveLength(2);
		expect(
			(batched.calls[0].body as { inputs: unknown[] }).inputs,
		).toHaveLength(100);
		expect(
			(batched.calls[1].body as { inputs: unknown[] }).inputs,
		).toHaveLength(50);
	});

	it("batchCheckContacts con lista vacía no llama a HubSpot", async () => {
		const { calls, fetchImpl } = fakeHubSpot([]);
		const checks = await createHubSpotAdapter("tok", fetchImpl).batchCheckContacts(
			[],
		);
		expect(checks).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it("listNotesSince pide notas del contacto, con filtro de fecha solo si hay marca de agua", async () => {
		const { calls, fetchImpl } = fakeHubSpot([
			{
				json: {
					results: [
						{
							id: "n1",
							properties: {
								hs_note_body: "Llamó y quedó en pensarlo",
								hs_timestamp: "2026-09-20T10:00:00Z",
								hubspot_owner_id: "9",
							},
						},
					],
				},
			},
		]);
		const notes = await createHubSpotAdapter("tok", fetchImpl).listNotesSince(
			"101",
			"2026-09-19T00:00:00Z",
		);
		expect(notes).toEqual([
			{
				id: "n1",
				body: "Llamó y quedó en pensarlo",
				at: new Date("2026-09-20T10:00:00Z"),
				ownerId: "9",
			},
		]);
		const filters = (
			calls[0].body as { filterGroups: Array<{ filters: unknown[] }> }
		).filterGroups[0].filters;
		expect(filters).toContainEqual({
			propertyName: "hs_timestamp",
			operator: "GT",
			value: "2026-09-19T00:00:00Z",
		});

		const sinMarca = fakeHubSpot([{ json: { results: [] } }]);
		await createHubSpotAdapter("tok", sinMarca.fetchImpl).listNotesSince(
			"101",
			null,
		);
		const filtersSinMarca = (
			sinMarca.calls[0].body as {
				filterGroups: Array<{ filters: unknown[] }>;
			}
		).filterGroups[0].filters;
		expect(filtersSinMarca).not.toContainEqual(
			expect.objectContaining({ propertyName: "hs_timestamp" }),
		);
	});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

```bash
npx vitest run tests/connectors/hubspot-adapter.test.ts
```

Expected: FAIL — `batchCheckContacts is not a function` / `listNotesSince is not a function`.

- [ ] **Step 3: Sumar los tipos y las firmas a la interfaz**

En `lib/connectors/crm/adapter.ts`, después de `CrmContactMatch` y antes de `CrmAdapter`:

```ts
export interface CrmContactCheck {
	id: string;
	/** true = existe en HubSpot; false = borrado, confirmado por HubSpot
	 * (category OBJECT_NOT_FOUND). Un id que no aparece en el array de salida
	 * de batchCheckContacts no es ninguna de las dos cosas: su estado no se
	 * pudo confirmar en esta corrida. */
	found: boolean;
	ownerId: string | null;
}

export interface CrmActivityNote {
	id: string;
	body: string;
	at: Date;
	ownerId: string | null;
}
```

Y dentro de `CrmAdapter`, después de `createDeal`:

```ts
	/** Existencia + owner de hasta 100 contactos por llamada. Los ids que no se
	 * puedan confirmar como existentes ni como borrados quedan fuera del
	 * resultado (nunca se asume ninguna de las dos cosas por default). */
	batchCheckContacts(crmIds: string[]): Promise<CrmContactCheck[]>;
	/** Notas del contacto más nuevas que `sinceIso` (todas si es null). */
	listNotesSince(crmId: string, sinceIso: string | null): Promise<CrmActivityNote[]>;
```

- [ ] **Step 4: Implementar en `hubspot-adapter.ts`**

Agregar el import de los tipos nuevos junto al de `CrmAdapter`, `CrmContactMatch`:

```ts
import type {
	CrmActivityNote,
	CrmAdapter,
	CrmContactCheck,
	CrmContactMatch,
} from "./adapter";
```

Agregar, dentro de `createHubSpotAdapter`, dos métodos nuevos al objeto que retorna (junto a `createDeal`):

```ts
		async batchCheckContacts(crmIds) {
			const checks: CrmContactCheck[] = [];
			for (let i = 0; i < crmIds.length; i += 100) {
				const batch = crmIds.slice(i, i + 100);
				if (batch.length === 0) continue;
				const data = (await call("/crm/v3/objects/contacts/batch/read", {
					method: "POST",
					body: {
						properties: ["hubspot_owner_id"],
						inputs: batch.map((id) => ({ id })),
					},
				})) as {
					results?: Array<{
						id: string;
						properties: { hubspot_owner_id?: string | null };
					}>;
					errors?: Array<{
						category: string;
						context?: { ids?: string[] };
					}>;
				};
				for (const row of data.results ?? []) {
					checks.push({
						id: row.id,
						found: true,
						ownerId: row.properties.hubspot_owner_id ?? null,
					});
				}
				for (const error of data.errors ?? []) {
					if (error.category !== "OBJECT_NOT_FOUND") continue;
					for (const id of error.context?.ids ?? []) {
						checks.push({ id, found: false, ownerId: null });
					}
				}
			}
			return checks;
		},

		async listNotesSince(crmId, sinceIso) {
			const data = await searchAssociated(
				"notes",
				crmId,
				sinceIso
					? [{ propertyName: "hs_timestamp", operator: "GT", value: sinceIso }]
					: [],
				["hs_note_body", "hs_timestamp", "hubspot_owner_id"],
				20,
			);
			const notes: CrmActivityNote[] = [];
			for (const row of data.results ?? []) {
				const body = row.properties.hs_note_body;
				const timestamp = row.properties.hs_timestamp;
				if (!body || !timestamp) continue;
				notes.push({
					id: row.id,
					body,
					at: new Date(timestamp),
					ownerId: row.properties.hubspot_owner_id ?? null,
				});
			}
			return notes;
		},
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

```bash
npx vitest run tests/connectors/hubspot-adapter.test.ts
```

Expected: PASS, todos los tests del archivo.

- [ ] **Step 6: Sumar los dos métodos a `withReauth`**

En `lib/outreach/crm-session.ts`, dentro de `withReauth`, en el objeto que retorna (junto a `createDeal: guard(adapter.createDeal)`):

```ts
		batchCheckContacts: guard(adapter.batchCheckContacts),
		listNotesSince: guard(adapter.listNotesSince),
```

- [ ] **Step 7: Sumar el default a `fakeCrm()`**

En `tests/outreach/fake-store.ts`, dentro de `fakeCrm()` (junto a `createDeal: async () => ({ id: "deal-1" })`):

```ts
		batchCheckContacts: async () => [],
		listNotesSince: async () => [],
```

- [ ] **Step 8: Typecheck y suite completa**

```bash
npm run typecheck
npm test
```

Expected: sin errores — `withReauth` y `fakeCrm` ya satisfacen la interfaz ampliada, así que ningún test existente que use `fakeCrm()` se rompe.

- [ ] **Step 9: Commit**

```bash
git add lib/connectors/crm/adapter.ts lib/connectors/crm/hubspot-adapter.ts lib/outreach/crm-session.ts tests/outreach/fake-store.ts tests/connectors/hubspot-adapter.test.ts
git commit -m "feat: CrmAdapter.batchCheckContacts y listNotesSince para el sync entrante"
```

---

## Task 3: `OutreachStore` — `crmSyncedAt` y dos lecturas nuevas

**Files:**
- Modify: `lib/outreach/store.ts`
- Modify: `tests/outreach/fake-store.ts`
- Test: `tests/outreach/store-lecturas.test.ts` (si no existe una sección para esto, se agrega al final del archivo — revisar su `describe` raíz antes de agregar)

**Interfaces:**
- Consumes: columna `contacts.crm_synced_at` (Task 1).
- Produces:
  - `ContactRow.crmSyncedAt: string | null`
  - `ContactPatch` acepta `crmSyncedAt`
  - `OutreachStore.listContactsWithCrmId(tenantId: string): Promise<ContactRow[]>`
  - `OutreachStore.listExecutorsWithCrmOwner(tenantId: string): Promise<ExecutorRow[]>`
  - Task 4 (`crm-sync.ts`) consume los dos métodos y el campo nuevo.

- [ ] **Step 1: Ver qué archivo de test de lecturas usa `createFakeStore()` para copiar el estilo**

```bash
head -30 tests/outreach/store-lecturas.test.ts
```

(Confirmar el import de `createFakeStore`, `contactRow`, `TENANT` desde `../fake-store` antes de escribir el test — mismo patrón que el resto del archivo.)

- [ ] **Step 2: Escribir el test que falla**

Agregar al final de `tests/outreach/store-lecturas.test.ts`:

```ts
describe("listContactsWithCrmId", () => {
	it("solo trae contactos con crm_id cargado, de ese tenant", async () => {
		const store = createFakeStore();
		store.contacts.push(
			contactRow({ id: "c1", crmId: "101" }),
			contactRow({ id: "c2", crmId: null }),
			contactRow({ id: "c3", tenantId: "otro-tenant", crmId: "202" }),
		);
		const result = await store.listContactsWithCrmId(TENANT);
		expect(result.map((c) => c.id)).toEqual(["c1"]);
	});
});

describe("listExecutorsWithCrmOwner", () => {
	it("solo trae ejecutores con crm_owner_id cargado, de ese tenant", async () => {
		const store = createFakeStore();
		store.executors.push(
			{
				tenantId: TENANT,
				userId: "user-con-owner",
				slug: "marcos",
				crmOwnerId: "92296386",
				dailyQuota: 30,
				gmailAuthorizedAt: null,
				gmailReadAuthorizedAt: null,
				displayName: null,
				title: null,
				linkedinUrl: null,
			},
			{
				tenantId: "otro-tenant",
				userId: "user-otro-tenant",
				slug: "x",
				crmOwnerId: "1",
				dailyQuota: 30,
				gmailAuthorizedAt: null,
				gmailReadAuthorizedAt: null,
				displayName: null,
				title: null,
				linkedinUrl: null,
			},
		);
		const result = await store.listExecutorsWithCrmOwner(TENANT);
		// El ejecutor "ana" del store base tiene crmOwnerId: null (fake-store.ts):
		// no debería aparecer.
		expect(result.map((e) => e.userId)).toEqual(["user-con-owner"]);
	});
});
```

- [ ] **Step 3: Correr y confirmar que falla**

```bash
npx vitest run tests/outreach/store-lecturas.test.ts
```

Expected: FAIL — `store.listContactsWithCrmId is not a function`.

- [ ] **Step 4: Sumar `crmSyncedAt` a `ContactRow` y `ContactPatch`**

En `lib/outreach/store.ts`, en la interfaz `ContactRow` (después de `externalIds: Record<string, unknown>;`):

```ts
	/** Última vez que el sync entrante de HubSpot revisó este contacto; null =
	 * nunca. Marca de agua para no repetir notas ya vistas (docs/superpowers/
	 * specs/2026-09-27-hubspot-crm-sync-design.md D7). */
	crmSyncedAt: string | null;
```

En `ContactPatch` (dentro del `Pick<ContactRow, ...>`, junto a `"gmailThreadId"`):

```ts
		| "gmailThreadId"
		| "crmSyncedAt"
```

- [ ] **Step 5: Sumar la columna a `CONTACT_COLUMNS`, `toContact` y `CONTACT_PATCH_COLUMNS`**

En `CONTACT_COLUMNS` (línea ~429), agregar `crm_synced_at` al final del string.

En `toContact` (línea ~437), agregar antes del cierre `});`:

```ts
	crmSyncedAt: (r.crm_synced_at as string | null) ?? null,
```

En `CONTACT_PATCH_COLUMNS` (línea ~544), agregar:

```ts
	crmSyncedAt: "crm_synced_at",
```

- [ ] **Step 6: Sumar los dos métodos a la interfaz `OutreachStore`**

Después de `listExecutorsWithGmailRead(tenantId: string): Promise<ExecutorRow[]>;` (línea ~313):

```ts
	/** Contactos del tenant con crm_id cargado — universo del sync entrante de
	 * HubSpot. */
	listContactsWithCrmId(tenantId: string): Promise<ContactRow[]>;
	/** Ejecutores del tenant con owner de HubSpot cargado — para mapear
	 * hubspot_owner_id a un usuario local. */
	listExecutorsWithCrmOwner(tenantId: string): Promise<ExecutorRow[]>;
```

- [ ] **Step 7: Implementar en `createSupabaseOutreachStore`**

Después de `listExecutorsWithGmailRead` (línea ~979), calcando su estilo:

```ts
		async listContactsWithCrmId(tenantId) {
			const { data, error } = await client
				.from("contacts")
				.select(CONTACT_COLUMNS)
				.eq("tenant_id", tenantId)
				.not("crm_id", "is", null)
				// Orden estable: mismo motivo que listContactsWithThread.
				.order("contact_key", { ascending: true });
			if (error) fail("listar contactos con crm_id", error);
			return (data ?? []).map(toContact);
		},

		async listExecutorsWithCrmOwner(tenantId) {
			const { data, error } = await client
				.from("executors")
				.select(
					"tenant_id, user_id, slug, crm_owner_id, daily_quota, gmail_authorized_at, gmail_read_authorized_at, display_name, title, linkedin_url",
				)
				.eq("tenant_id", tenantId)
				.not("crm_owner_id", "is", null);
			if (error) fail("listar ejecutores con owner de CRM", error);
			return (data ?? []).map((r) => ({
				tenantId: r.tenant_id,
				userId: r.user_id,
				slug: r.slug ?? null,
				crmOwnerId: r.crm_owner_id ?? null,
				dailyQuota: r.daily_quota,
				gmailAuthorizedAt: r.gmail_authorized_at ?? null,
				gmailReadAuthorizedAt: r.gmail_read_authorized_at ?? null,
				displayName: r.display_name ?? null,
				title: r.title ?? null,
				linkedinUrl: r.linkedin_url ?? null,
			}));
		},
```

- [ ] **Step 8: Sumar los dos métodos a `createFakeStore()` en `tests/outreach/fake-store.ts`**

Después de `listExecutorsWithGmailRead` (línea ~409):

```ts
		async listContactsWithCrmId(tenantId) {
			return store.contacts.filter(
				(c) => c.tenantId === tenantId && c.crmId !== null,
			);
		},

		async listExecutorsWithCrmOwner(tenantId) {
			return store.executors.filter(
				(e) => e.tenantId === tenantId && e.crmOwnerId !== null,
			);
		},
```

Y en `contactRow()` (línea ~112), agregar `crmSyncedAt: null,` al objeto por defecto (junto a `externalIds: {},`).

- [ ] **Step 9: Correr el test y confirmar que pasa**

```bash
npx vitest run tests/outreach/store-lecturas.test.ts
```

Expected: PASS.

- [ ] **Step 10: Typecheck y suite completa**

```bash
npm run typecheck
npm test
```

Expected: sin errores. Si algún test de integración (`store.it.test.ts`) referencia `CONTACT_COLUMNS` a mano, no debería — usa la store real.

- [ ] **Step 11: Commit**

```bash
git add lib/outreach/store.ts tests/outreach/fake-store.ts tests/outreach/store-lecturas.test.ts
git commit -m "feat: OutreachStore.listContactsWithCrmId y listExecutorsWithCrmOwner"
```

---

## Task 4: El nodo `outreach/crm-sync`

**Files:**
- Create: `lib/outreach/services/crm-sync.ts`
- Modify: `lib/outreach/events.ts`
- Modify: `lib/workflows/registry.ts`
- Test: `tests/outreach/services/crm-sync.test.ts`

**Interfaces:**
- Consumes:
  - `CrmAdapter.batchCheckContacts`, `CrmAdapter.listNotesSince` (Task 2)
  - `OutreachStore.listContactsWithCrmId`, `OutreachStore.listExecutorsWithCrmOwner`, `updateContact`, `insertEvents` (Task 3 y ya existentes)
  - `ContactRow`, `ContactPatch`, `ExecutorRow` de `lib/outreach/store.ts`
  - `outreachEvent`, `OutreachEventInsert` de `lib/outreach/events.ts`
- Produces:
  - `export interface CrmSyncDeps { listContactsWithCrmId; listExecutorsWithCrmOwner; updateContact; insertEvents; crm: CrmAdapter; now: () => Date }`
  - `export interface CrmSyncResult { revisados: number; huerfanosLimpiados: number; ownersActualizados: number; notasAgregadas: number }`
  - `export async function runCrmSync(tenantId: string, deps: CrmSyncDeps): Promise<CrmSyncResult>` — la consume Task 5 (`agents/outreach/schedules/crm-sync.ts`).

- [ ] **Step 1: Sumar los dos tipos de evento nuevos**

En `lib/outreach/events.ts`, en `OUTREACH_EVENT_TYPES` (agregar al final del array, antes de `] as const;`):

```ts
	"crm_id_huerfano",
	"crm_owner_actualizado",
```

No van en `DEDUPED_EVENT_TYPES` (no hay riesgo de duplicado por reintento humano — los inserta un job, no una persona) ni en `MODEL_LOGGABLE_EVENT_TYPES` (no los inserta el modelo).

- [ ] **Step 2: Escribir el test que falla — el archivo completo de `crm-sync.test.ts`**

Crear `tests/outreach/services/crm-sync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CrmContactCheck } from "@/lib/connectors/crm/adapter";
import { fakeCrm } from "../fake-store";
import type { OutreachEventInsert } from "@/lib/outreach/events";
import { runCrmSync } from "@/lib/outreach/services/crm-sync";
import type { ContactPatch, ContactRow, ExecutorRow } from "@/lib/outreach/store";

const NOW = new Date("2026-09-27T12:00:00Z");

const TENANT = "tenant-1";

function contact(overrides: Partial<ContactRow> = {}): ContactRow {
	return {
		id: "c1",
		tenantId: TENANT,
		contactKey: "em:laura@acme.test",
		accountId: null,
		name: "Laura Gómez",
		company: "Acme",
		title: null,
		email: "laura@acme.test",
		domain: null,
		linkedinSlug: null,
		crmId: "101",
		ownerUserId: "user-mati",
		segment: "mid_market_ar",
		vector: "v1",
		hook: "h1",
		idioma: "es_ar",
		stage: "en_conversacion",
		touches: 1,
		firstTouchAt: null,
		lastTouchAt: null,
		nextStepAt: null,
		repliedAt: null,
		gmailThreadId: null,
		source: "csv",
		icp: null,
		externalIds: {},
		crmSyncedAt: null,
		...overrides,
	};
}

function executor(overrides: Partial<ExecutorRow> = {}): ExecutorRow {
	return {
		tenantId: TENANT,
		userId: "user-mati",
		slug: "mati",
		crmOwnerId: "92296278",
		dailyQuota: 30,
		gmailAuthorizedAt: null,
		gmailReadAuthorizedAt: null,
		displayName: null,
		title: null,
		linkedinUrl: null,
		...overrides,
	};
}

/** Deps con estado en memoria — más simple que reusar createFakeStore() acá:
 * este nodo solo necesita cuatro métodos del store, no los ~30 de
 * OutreachStore. */
function buildDeps(input: {
	contacts: ContactRow[];
	executors: ExecutorRow[];
	checks?: CrmContactCheck[];
	notesByContact?: Record<string, { id: string; body: string; at: Date; ownerId: string | null }[]>;
	failNotesFor?: string;
}) {
	const patches: { tenantId: string; id: string; patch: ContactPatch }[] = [];
	const events: OutreachEventInsert[] = [];
	const crm = fakeCrm({
		batchCheckContacts: async () => input.checks ?? [],
		listNotesSince: async (crmId) => {
			if (input.failNotesFor === crmId) throw new Error("boom");
			return input.notesByContact?.[crmId] ?? [];
		},
	});
	const deps = {
		listContactsWithCrmId: async (tenantId: string) =>
			input.contacts.filter((c) => c.tenantId === tenantId),
		listExecutorsWithCrmOwner: async (tenantId: string) =>
			input.executors.filter((e) => e.tenantId === tenantId),
		updateContact: async (tenantId: string, id: string, patch: ContactPatch) => {
			patches.push({ tenantId, id, patch });
		},
		insertEvents: async (rows: OutreachEventInsert[]) => {
			events.push(...rows);
		},
		crm,
		now: () => NOW,
	};
	return { deps, patches, events };
}

describe("runCrmSync", () => {
	it("sin contactos con crm_id, no llama a HubSpot", async () => {
		let called = false;
		const { deps } = buildDeps({ contacts: [], executors: [] });
		deps.crm.batchCheckContacts = async () => {
			called = true;
			return [];
		};
		const result = await runCrmSync(TENANT, deps);
		expect(called).toBe(false);
		expect(result).toEqual({
			revisados: 0,
			huerfanosLimpiados: 0,
			ownersActualizados: 0,
			notasAgregadas: 0,
		});
	});

	it("contacto borrado en HubSpot: limpia crm_id y deja evento crm_id_huerfano", async () => {
		const { deps, patches, events } = buildDeps({
			contacts: [contact()],
			executors: [executor()],
			checks: [{ id: "101", found: false, ownerId: null }],
		});
		const result = await runCrmSync(TENANT, deps);
		expect(result.huerfanosLimpiados).toBe(1);
		expect(patches).toEqual([
			{ tenantId: TENANT, id: "c1", patch: { crmId: null } },
		]);
		expect(events).toEqual([
			expect.objectContaining({
				type: "crm_id_huerfano",
				contact_key: "em:laura@acme.test",
				channel: null,
				payload: { crm_id_anterior: "101" },
			}),
		]);
	});

	it("owner de HubSpot conocido y distinto: actualiza owner_user_id", async () => {
		const { deps, patches, events } = buildDeps({
			contacts: [contact({ ownerUserId: "user-viejo" })],
			executors: [executor({ userId: "user-mati", crmOwnerId: "92296278" })],
			checks: [{ id: "101", found: true, ownerId: "92296278" }],
		});
		const result = await runCrmSync(TENANT, deps);
		expect(result.ownersActualizados).toBe(1);
		expect(patches).toContainEqual({
			tenantId: TENANT,
			id: "c1",
			patch: { ownerUserId: "user-mati" },
		});
		expect(events).toContainEqual(
			expect.objectContaining({ type: "crm_owner_actualizado" }),
		);
	});

	it("owner de HubSpot que no matchea a ningún ejecutor: no toca owner_user_id", async () => {
		const { deps, patches, events } = buildDeps({
			contacts: [contact({ ownerUserId: "user-viejo" })],
			executors: [executor({ crmOwnerId: "otro-owner" })],
			checks: [{ id: "101", found: true, ownerId: "owner-desconocido" }],
		});
		const result = await runCrmSync(TENANT, deps);
		expect(result.ownersActualizados).toBe(0);
		expect(patches.find((p) => "ownerUserId" in p.patch)).toBeUndefined();
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "crm_sync_pendiente",
				payload: expect.objectContaining({ hubspot_owner_id: "owner-desconocido" }),
			}),
		);
	});

	it("notas nuevas se insertan con el prefijo y se actualiza crm_synced_at", async () => {
		const { deps, patches, events } = buildDeps({
			contacts: [contact({ crmSyncedAt: "2026-09-20T00:00:00Z" })],
			executors: [executor()],
			checks: [{ id: "101", found: true, ownerId: "92296278" }],
			notesByContact: {
				"101": [
					{
						id: "n1",
						body: "Llamó y quedó en pensarlo",
						at: new Date("2026-09-26T10:00:00Z"),
						ownerId: "92296278",
					},
				],
			},
		});
		const result = await runCrmSync(TENANT, deps);
		expect(result.notasAgregadas).toBe(1);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "nota",
				channel: null,
				contact_key: "em:laura@acme.test",
				summary: expect.stringContaining("[in · hubspot · nota]"),
			}),
		);
		expect(patches).toContainEqual({
			tenantId: TENANT,
			id: "c1",
			patch: { crmSyncedAt: NOW.toISOString() },
		});
	});

	it("sin notas nuevas, igual actualiza crm_synced_at", async () => {
		const { deps, patches } = buildDeps({
			contacts: [contact()],
			executors: [executor()],
			checks: [{ id: "101", found: true, ownerId: "92296278" }],
		});
		await runCrmSync(TENANT, deps);
		expect(patches).toContainEqual({
			tenantId: TENANT,
			id: "c1",
			patch: { crmSyncedAt: NOW.toISOString() },
		});
	});

	it("un id que batchCheckContacts no confirma (ambiguo) se salta entero, sin tocar nada", async () => {
		const { deps, patches, events } = buildDeps({
			contacts: [contact()],
			executors: [executor()],
			checks: [], // "101" no aparece: estado no confirmado
		});
		const result = await runCrmSync(TENANT, deps);
		expect(result).toEqual({
			revisados: 1,
			huerfanosLimpiados: 0,
			ownersActualizados: 0,
			notasAgregadas: 0,
		});
		expect(patches).toEqual([]);
		expect(events).toEqual([]);
	});

	it("un contacto que tira error en listNotesSince no frena a los demás del tenant", async () => {
		const otro = contact({ id: "c2", crmId: "202", contactKey: "em:otro@acme.test" });
		const { deps, patches } = buildDeps({
			contacts: [contact(), otro],
			executors: [executor()],
			checks: [
				{ id: "101", found: true, ownerId: "92296278" },
				{ id: "202", found: true, ownerId: "92296278" },
			],
			failNotesFor: "101",
		});
		const result = await runCrmSync(TENANT, deps);
		expect(result.revisados).toBe(2);
		// c2 sí llegó a actualizar su marca de agua; c1 no, porque tiró antes.
		expect(patches).toContainEqual({
			tenantId: TENANT,
			id: "c2",
			patch: { crmSyncedAt: NOW.toISOString() },
		});
		expect(patches.find((p) => p.id === "c1")).toBeUndefined();
	});
});
```

- [ ] **Step 3: Correr y confirmar que falla**

```bash
npx vitest run tests/outreach/services/crm-sync.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/outreach/services/crm-sync'`.

- [ ] **Step 4: Implementar `lib/outreach/services/crm-sync.ts`**

```ts
// Sync entrante de HubSpot (spec docs/superpowers/specs/2026-09-27-hubspot-crm-sync-design.md):
// el contacto local es la fuente de verdad, pero HubSpot puede cambiar por
// fuera (se borra un duplicado, se reasigna el owner, se deja una nota a
// mano) y hoy nada se entera. Efecto 0: solo lee de HubSpot y escribe acá.
import type { CrmAdapter } from "../../connectors/crm/adapter";
import { outreachEvent, type OutreachEventInsert } from "../events";
import type { ContactPatch, ContactRow, ExecutorRow } from "../store";

export interface CrmSyncDeps {
	listContactsWithCrmId(tenantId: string): Promise<ContactRow[]>;
	listExecutorsWithCrmOwner(tenantId: string): Promise<ExecutorRow[]>;
	updateContact(
		tenantId: string,
		id: string,
		patch: ContactPatch,
	): Promise<unknown>;
	insertEvents(rows: OutreachEventInsert[]): Promise<void>;
	crm: CrmAdapter;
	now: () => Date;
}

export interface CrmSyncResult {
	revisados: number;
	huerfanosLimpiados: number;
	ownersActualizados: number;
	notasAgregadas: number;
}

export async function runCrmSync(
	tenantId: string,
	deps: CrmSyncDeps,
): Promise<CrmSyncResult> {
	const result: CrmSyncResult = {
		revisados: 0,
		huerfanosLimpiados: 0,
		ownersActualizados: 0,
		notasAgregadas: 0,
	};

	const contacts = await deps.listContactsWithCrmId(tenantId);
	if (contacts.length === 0) return result;

	const checks = await deps.crm.batchCheckContacts(
		contacts.map((c) => c.crmId as string),
	);
	const checkById = new Map(checks.map((c) => [c.id, c]));

	const executors = await deps.listExecutorsWithCrmOwner(tenantId);
	const executorByOwnerId = new Map(
		executors.map((e) => [e.crmOwnerId as string, e.userId]),
	);

	for (const contact of contacts) {
		result.revisados++;
		try {
			await syncOneContact(tenantId, contact, {
				check: checkById.get(contact.crmId as string) ?? null,
				executorByOwnerId,
				deps,
				result,
			});
		} catch (error) {
			console.error(
				`crm-sync: contacto ${contact.contactKey} del tenant ${tenantId}:`,
				error,
			);
		}
	}

	return result;
}

async function syncOneContact(
	tenantId: string,
	contact: ContactRow,
	ctx: {
		check: { found: boolean; ownerId: string | null } | null;
		executorByOwnerId: Map<string, string>;
		deps: CrmSyncDeps;
		result: CrmSyncResult;
	},
): Promise<void> {
	const { check, executorByOwnerId, deps, result } = ctx;
	// check === null: batchCheckContacts no pudo confirmar ni found ni
	// not-found para este id (error ambiguo de HubSpot) — se salta entero,
	// nunca se asume borrado ni se pide notas de un id en duda.
	if (!check) return;

	if (!check.found) {
		await deps.updateContact(tenantId, contact.id, { crmId: null });
		await deps.insertEvents([
			outreachEvent({
				tenant_id: tenantId,
				actor_user_id: null,
				contact_key: contact.contactKey,
				channel: null,
				type: "crm_id_huerfano",
				summary: "crm_id ya no existe en HubSpot, limpiado",
				payload: { crm_id_anterior: contact.crmId },
			}),
		]);
		result.huerfanosLimpiados++;
		return;
	}

	if (check.ownerId) {
		const localUserId = executorByOwnerId.get(check.ownerId);
		if (localUserId && localUserId !== contact.ownerUserId) {
			await deps.updateContact(tenantId, contact.id, {
				ownerUserId: localUserId,
			});
			await deps.insertEvents([
				outreachEvent({
					tenant_id: tenantId,
					actor_user_id: null,
					contact_key: contact.contactKey,
					channel: null,
					type: "crm_owner_actualizado",
					summary: "owner actualizado desde HubSpot",
					payload: { hubspot_owner_id: check.ownerId },
				}),
			]);
			result.ownersActualizados++;
		} else if (!localUserId) {
			await deps.insertEvents([
				outreachEvent({
					tenant_id: tenantId,
					actor_user_id: null,
					contact_key: contact.contactKey,
					channel: null,
					type: "crm_sync_pendiente",
					summary: "owner de HubSpot sin ejecutor local con ese crm_owner_id",
					payload: { hubspot_owner_id: check.ownerId },
				}),
			]);
		}
	}

	const notes = await deps.crm.listNotesSince(
		contact.crmId as string,
		contact.crmSyncedAt,
	);
	if (notes.length > 0) {
		await deps.insertEvents(
			notes.map((note) =>
				outreachEvent({
					tenant_id: tenantId,
					actor_user_id: null,
					contact_key: contact.contactKey,
					channel: null,
					type: "nota",
					summary: `[in · hubspot · nota]\n\n${note.body}`,
					payload: { hubspot_note_id: note.id, hubspot_owner_id: note.ownerId },
				}),
			),
		);
		result.notasAgregadas += notes.length;
	}
	await deps.updateContact(tenantId, contact.id, {
		crmSyncedAt: deps.now().toISOString(),
	});
}
```

- [ ] **Step 5: Correr y confirmar que pasa**

```bash
npx vitest run tests/outreach/services/crm-sync.test.ts
```

Expected: PASS, los 8 tests.

- [ ] **Step 6: Registrar el nodo**

En `lib/workflows/registry.ts`, dentro de `NODES` (junto a `"outreach/reconcile"`):

```ts
	// Lee HubSpot y corrige la base propia (crm_id huérfano, owner, notas);
	// nunca escribe hacia HubSpot.
	"outreach/crm-sync": { effect: 0, tier: null },
```

- [ ] **Step 7: Typecheck y suite completa**

```bash
npm run typecheck
npm test
```

Expected: sin errores. `tests/workflows/registry.test.ts` pasa porque el nodo ya quedó registrado en el mismo paso que se creó el archivo.

- [ ] **Step 8: Commit**

```bash
git add lib/outreach/events.ts lib/outreach/services/crm-sync.ts lib/workflows/registry.ts tests/outreach/services/crm-sync.test.ts
git commit -m "feat: nodo outreach/crm-sync — reconcilia crm_id, owner y notas contra HubSpot"
```

---

## Task 5: Wiring del schedule

**Files:**
- Create: `agents/outreach/schedules/crm-sync.ts`

**Interfaces:**
- Consumes:
  - `runCrmSync`, `CrmSyncDeps` de `lib/outreach/services/crm-sync.ts` (Task 4)
  - `createSupabaseOutreachStore` de `lib/outreach/store.ts`
  - `createAdminClient` de `lib/supabase/admin.ts`
  - `takeScheduleLock`, `RunLockDeps` de `lib/outreach/services/sweep.ts`
  - `hasEnabledBinding` de `lib/connectors/bindings.ts`
  - `tokenForSubject`, `isConnectAuthError` de `lib/connectors/auth.ts`
  - `HUBSPOT_CONNECTOR_UID` de `lib/connectors/platform.ts`
  - `createHubSpotAdapter` de `lib/connectors/crm/hubspot-adapter.ts`
  - `outreachEvent` de `lib/outreach/events.ts`
  - `defineSchedule` de `eve/schedules`
- Produces: nada que otra task consuma — es el punto de entrada del cron. Sin test directo (mismo criterio que `agents/outreach/schedules/morning-sweep.ts`, que tampoco tiene uno: la lógica que vale la pena testear ya quedó en `runCrmSync`, Task 4).

- [ ] **Step 1: Escribir `agents/outreach/schedules/crm-sync.ts`**

```ts
// Cableado del sync entrante de HubSpot. Toda la lógica vive en
// lib/outreach/services/crm-sync.ts, con dependencias inyectadas y testeada;
// acá solo se arman las deps reales y se resuelve el token — mismo criterio
// que morning-sweep.ts (docs/superpowers/specs/2026-09-27-hubspot-crm-sync-design.md §4.6).
//
// Imports relativos y no "@/": eve no resuelve los paths de tsconfig en los
// módulos que compila (mismo motivo que morning-sweep.ts).
import { defineSchedule } from "eve/schedules";
import {
	isConnectAuthError,
	tokenForSubject,
} from "../../../lib/connectors/auth";
import { hasEnabledBinding } from "../../../lib/connectors/bindings";
import { createHubSpotAdapter } from "../../../lib/connectors/crm/hubspot-adapter";
import { HUBSPOT_CONNECTOR_UID } from "../../../lib/connectors/platform";
import { outreachEvent } from "../../../lib/outreach/events";
import { runCrmSync } from "../../../lib/outreach/services/crm-sync";
import { takeScheduleLock } from "../../../lib/outreach/services/sweep";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

const AGENT = "outreach";
const SCHEDULE = "crm-sync";

/** scheduleKeyFor (sweep.ts) trunca a fecha, así que no sirve acá: esto corre
 * dos veces por día y con esa granularidad la segunda corrida del día
 * chocaría contra el lock de la primera. La clave local trunca a fecha+hora
 * (ISO 8601 hasta el bloque de hora, ej. "2026-09-27T12"): un slot por hora
 * alcanza para evitar dos corridas superpuestas del mismo disparo de cron,
 * sin bloquear la corrida de otro horario del mismo día. */
function hourlyScheduleKey(now: Date): string {
	return `${SCHEDULE}:${now.toISOString().slice(0, 13)}`;
}

export default defineSchedule({
	// 9:00 y 18:00 de Argentina (UTC-3) ≈ 12:00 y 21:00 UTC. Vercel evalúa cron
	// en UTC, igual que morning-sweep.
	cron: "0 12,21 * * *",
	async run() {
		const admin = createAdminClient();
		const store = createSupabaseOutreachStore(admin);
		const now = new Date();
		const scheduleKey = hourlyScheduleKey(now);

		const tenants = await store.listActiveTenants();
		const anyTenant = tenants[0];
		if (!anyTenant) return;

		const gotLock = await takeScheduleLock(
			{
				insertRun: async (row) => {
					const { error } = await admin.from("runs").insert(row);
					return { error };
				},
			},
			{ scheduleKey, tenantId: anyTenant.id, agent: AGENT },
		);
		if (!gotLock) return;

		for (const tenant of tenants) {
			if (!(await hasEnabledBinding(tenant.id, "crm", "hubspot"))) continue;

			const executors = await store.listExecutorsWithCrmOwner(tenant.id);
			let token: string | null = null;
			for (const executor of executors) {
				try {
					const { token: t } = await tokenForSubject(
						HUBSPOT_CONNECTOR_UID,
						{
							tenantId: tenant.id,
							userId: executor.userId,
							issuer: process.env.NEXT_PUBLIC_SUPABASE_URL,
						},
						[],
					);
					token = t;
					break;
				} catch (error) {
					if (!isConnectAuthError(error)) throw error;
				}
			}

			if (!token) {
				await store.insertEvents([
					outreachEvent({
						tenant_id: tenant.id,
						actor_user_id: null,
						contact_key: null,
						channel: null,
						type: "crm_sync_pendiente",
						summary: "sin grant de HubSpot vigente para ningún ejecutor",
						payload: {},
					}),
				]);
				continue;
			}

			// Sin withReauth: un schedule no tiene ctx.requireAuth para pausar el
			// turno — un 401 acá es "grant vencido", mismo camino que "ningún
			// ejecutor sirve" arriba.
			const crm = createHubSpotAdapter(token);
			try {
				const result = await runCrmSync(tenant.id, {
					listContactsWithCrmId: (id) => store.listContactsWithCrmId(id),
					listExecutorsWithCrmOwner: (id) =>
						store.listExecutorsWithCrmOwner(id),
					updateContact: (tenantId, id, patch) =>
						store.updateContact(tenantId, id, patch),
					insertEvents: (rows) => store.insertEvents(rows),
					crm,
					now: () => new Date(),
				});
				console.log(`${SCHEDULE}: tenant ${tenant.slug}`, result);
			} catch (error) {
				console.error(`${SCHEDULE}: tenant ${tenant.slug}:`, error);
			}
		}
	},
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: sin errores.

- [ ] **Step 3: Verificar en caliente contra un tenant de prueba (no producción)**

Esto reemplaza el test automatizado — es el mismo criterio que usa `morning-sweep.ts`. Con Docker levantado y `npm run dev` corriendo:

```bash
npm run db:start
```

Revisar en el dashboard de `/contactos` de un tenant de prueba con HubSpot conectado que haya al menos un contacto con `crm_id`. Confirmar manualmente (esto es la Verificación V1-V4 del spec, no un paso automatizable de esta task):
1. Borrar ese contacto en HubSpot.
2. Disparar el schedule a mano (o esperar al cron) y confirmar que `crm_id` quedó en `null` y apareció un evento `crm_id_huerfano` en el historial de `/contactos`.

Si el proyecto no tiene un mecanismo de "correr un schedule a mano" documentado, dejarlo anotado como pendiente de V1-V4 del spec en vez de inventar uno acá.

- [ ] **Step 4: Suite completa**

```bash
npm test
```

Expected: sin regresiones.

- [ ] **Step 5: Commit**

```bash
git add agents/outreach/schedules/crm-sync.ts
git commit -m "feat: schedule del sync entrante de HubSpot, dos veces al día"
```

---

## Task 6: Cierre — `npm run lint:fix` y roadmap

**Files:**
- Modify: cualquier archivo que `lint:fix` reformatee (revisar antes de commitear — CLAUDE.md advierte que biome toca archivos ajenos)
- Modify: `docs/01-roadmap-etapas.md` (si corresponde dejarlo anotado como trabajo fuera de etapas)

- [ ] **Step 1: Lint**

```bash
npm run lint:fix
git status --short
```

Revisar el diff de cualquier archivo que no sea de esta plan antes de agregarlo — si `lint:fix` tocó algo ajeno, revertir ese archivo puntual (`git checkout -- <archivo>`) antes de commitear, según la memoria del proyecto sobre este comportamiento de biome.

- [ ] **Step 2: Suite completa una vez más**

```bash
npm test
npm run typecheck
```

Expected: todo en verde.

- [ ] **Step 3: Anotar el trabajo en el roadmap**

En `docs/01-roadmap-etapas.md`, agregar una entrada fuera de la numeración de etapas (después de la Etapa 16, o donde el archivo tenga una sección para higiene/deuda técnica — revisar el archivo antes de decidir dónde) que enlace `docs/superpowers/specs/2026-09-27-hubspot-crm-sync-design.md` y este plan, con una línea: "Sync entrante de HubSpot (crm_id huérfano, owner, notas) — implementado, corre dos veces al día."

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: anota el sync entrante de HubSpot en el roadmap"
```

---

## Self-Review

**1. Spec coverage:** D1 (nodo efecto 0 + schedule 2x/día) → Task 4/5. D2 (crm_id huérfano) → Task 4. D3 (owner sin claim) → Task 4. D4 (notas con prefijo) → Task 4. D5 (batch read, no loop) → Task 2. D6 (token vía `tokenForSubject`, probando ejecutores) → Task 5. D7 (columna `crm_synced_at`) → Task 1, consumida en Task 3/4. Fuera de alcance (stage, webhooks) → no tiene tasks, correcto.

**2. Placeholder scan:** sin TBD/TODO. El único punto dejado abierto a propósito es Step 3 de la Task 5 ("si el proyecto no tiene un mecanismo para correr un schedule a mano, dejarlo pendiente") — no es una ambigüedad de código, es una verificación manual contra HubSpot real que no se puede prescribir en abstracto sin acceso al portal.

**3. Type consistency:** `CrmSyncDeps`, `CrmContactCheck`, `CrmActivityNote`, `ContactRow.crmSyncedAt`, `ContactPatch.crmSyncedAt` se usan con el mismo nombre en Task 2, 3, 4 y 5. `runCrmSync(tenantId, deps)` — misma firma en Task 4 (definición) y Task 5 (wiring).

**4. Review Focus:** las cinco entradas de la sección tienen su test: batching >100 y error ambiguo → Task 2; tenant sin contactos, owner desconocido, contacto que tira error → Task 4.

---

Plan completo y guardado en `docs/superpowers/plans/2026-09-27-hubspot-crm-sync.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — Un subagente fresco implementa cada task y un revisor fresco la chequea antes de arrancar la siguiente, más una revisión de rama completa al final. Más riguroso; cuesta un contexto fresco por task y por revisión.
- **Native** — Implemento yo todas las tasks en esta misma sesión, y un revisor fresco en el modelo más capaz chequea la rama entera al final. Más barato y rápido; sin revisión independiente hasta el final.

Para este plan recomiendo **native**: las tasks son secuenciales y cada una depende directo de la interfaz que dejó la anterior (Task 2 → 3 → 4 → 5), son solo 6, y el costo de un error acá es bajo — el nodo es efecto 0, no manda mails ni escribe en HubSpot, así que un bug se corrige con la corrida siguiente sin haber roto nada hacia afuera. ¿El plan captura lo que buscás, y con qué enfoque seguimos?
