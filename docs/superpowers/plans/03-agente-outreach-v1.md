# Etapa 3 · Agente de outreach v1 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el agente `outreach` corra el loop completo de outreach por email para cualquier tenant, con los invariantes del canon cumplidos en código.

**Architecture:** Núcleo puro en `lib/outreach` (contact_key, gate, guards, escalera) testeado con TDD; tablas `config_values`, `accounts`, `contacts`, `queue_items` con RLS de solo lectura; tools granulares con guards en el borde, subagente `researcher`, y schedules en código para escucha y follow-ups.

**Tech Stack:** eve 0.54.2, AI SDK 7 (`ai`) vía AI Gateway, `@vercel/connect` 1.0.0, Supabase Postgres + pgTAP, Next.js 16, vitest 5, zod 4, Node 24 (type stripping para scripts).

**Spec:** `docs/superpowers/specs/03-agente-outreach-v1.md`

## Cómo está armado este plan

El plan se escribe en dos tandas, igual que la Etapa 2 corrió su spike antes de planear:

- **Entrega 1 (spikes) y Entrega 2 (datos y núcleo)** están detalladas acá. No dependen entre sí: pueden correr en paralelo, en worktrees distintos.
- **Entregas 3, 4 y 5** dependen del resultado de los spikes (S1 decide si la escucha es por cron, S3 qué modelos hay, S4 cómo se arma el research, S6 cómo se escribe en HubSpot, S7 cómo corren las evals). La Task 6 escribe §13.1 de la spec y agrega a este archivo las tasks detalladas de las Entregas 3 a 5. Hasta entonces, la sección "Entregas 3 a 5" de abajo fija alcance e interfaces, no pasos.

## Global Constraints

- Toda tabla lleva `tenant_id` y RLS. `events` es append-only: nunca UPDATE ni DELETE.
- Nada específico de un tenant en código: va a `tenants/<slug>/`, al brain o a la base.
- Toda tool con efecto externo lleva `approval` explícito.
- El modelo nunca ve credenciales. Ningún agente lee ni imprime tokens: los spikes que necesitan un token los corre el usuario en su terminal y los scripts imprimen solo estados y metadatos.
- **Ningún archivo en `agents/`, `app/`, `components/`, `lib/` o `scripts/` fuera de `lib/connectors/auth.ts` importa `@vercel/connect`** (`tests/connectors/import-rule.test.ts`).
- Todo grant OAuth usa `subject.id = "<tenantId>:<userId>"`.
- Imports relativos dentro de `agents/` y `lib/`; alias `@/` solo en `app/` y `tests/`. Un archivo de `lib/` que importa un script de Node usa imports con extensión `.ts` y ningún import relativo sin extensión.
- Antes de escribir código de eve, leer `node_modules/eve/docs/README.md` y la guía del slot. Si la API real no coincide con este plan, la fuente de verdad es `node_modules/eve` (docs y `dist/src/**/*.d.ts`); anotar la diferencia en la spec antes de seguir.
- Antes de tocar SQL, cargar la skill `supabase-postgres-best-practices`. Helpers de RLS envueltos en `(select ...)`.
- Toda tabla nueva: `revoke insert, update, delete ... from authenticated, anon` y `revoke select ... from anon`. Toda función nueva de `public`: `revoke execute ... from public, anon, authenticated` (lo exige `supabase/tests/06_anon_grants.test.sql`).
- La base local de Supabase es **compartida entre worktrees** (mismo `project_id`). Antes de `npm run db:test` o `db:reset`, confirmar con el usuario que ninguna otra sesión está usando la base.
- `npx supabase db push` lo corre el usuario. Nunca un agente.
- Español rioplatense en UI, descripciones para el modelo, mensajes de error y comentarios. Código e identificadores en inglés.
- Ningún texto real de un prospecto (nombre, empresa, email, mensaje) entra al repo: fixtures sintéticos o anonimizados.
- Comandos: `npm run typecheck` · `npm test` · `npm run lint:fix` · `npm run db:test` (Docker abierto).
- Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:`, `test:` y la línea `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (o el modelo que corra la sesión).

## File Structure (Entregas 1 y 2)

| Archivo | Responsabilidad | Task |
|---|---|---|
| `lib/connectors/auth.ts` | Suma `tokenForSubject`: token OAuth de `tenant:usuario` sin sesión | 1 |
| `spikes/etapa-3/*.mts` | Scripts descartables de los spikes. Fuera de `scripts/` a propósito; se borran en la Task 6 | 1-5 |
| `supabase/migrations/<ts>_outreach_core.sql` | Enums, `executors` alter, `config_values`, `accounts`, `contacts`, `queue_items`, dedup de `events`, `runs.schedule_key` | 7 |
| `supabase/tests/11_outreach_core.test.sql` | RLS, escalera, pieza viva única, dedup | 7 |
| `lib/outreach/text.ts` | Normalización compartida (minúsculas, sin acentos) | 8 |
| `lib/outreach/contact-key.ts` | `contactKey`, `normalizeEmail`, `linkedinSlug` | 8 |
| `lib/outreach/gate-blocks.ts` | Parser de bloques ` ```gate ` y compilación segura de vetos | 9 |
| `lib/outreach/gate.ts` | `runGate`: base genérica portada de `gate.py` | 10 |
| `lib/outreach/stage.ts` | Escalera, cadencia, `isNoResponse` | 11 |
| `lib/outreach/guards.ts` | `claimStatus`, `crmMatch`, `canTouch` | 11 |
| `lib/outreach/domain.ts` | `normalizeDomain`, `domainFromEmail` | 12 |
| `lib/outreach/csv.ts` | Parser de CSV de contactos | 12 |
| `lib/outreach/ficha.ts` | Esquema de ficha, `sanitizeFicha`, vencimiento | 12 |
| `lib/outreach/classify.ts` | Esquema de clasificación de respuestas | 12 |
| `lib/outreach/events.ts` | Tipos de evento de outreach y constructor | 12 |
| `lib/outreach/queue-letters.ts` | Letras de la cola | 12 |
| `lib/outreach/config.ts` | `parseOutreachConfig`, esquema de `outreach.json`, `planConfigValues` | 13 |
| `scripts/outreach-config-args.ts`, `scripts/outreach-config.mts` | `npm run outreach:config` | 13 |
| `tenants/innovas/outreach.json` | Listas y configuración de outreach de `innovas` | 13 |
| `scripts/executors-set-args.ts`, `scripts/executors-set.mts` | `npm run executors:set` | 14 |
| `lib/connectors/crm/hubspot.ts` | `OUTREACH_PROPERTIES` pasa a 10 | 14 |

---

## Entrega 1 · Spikes

Rama de trabajo: la de la etapa. Los cambios de código que un spike necesita para probarse (scopes, subagente, schedule de prueba) van en una rama aparte `spike/etapa-3` que **nunca se mergea**; lo único que llega a la rama de la etapa es `tokenForSubject` (Task 1) y el resultado escrito en la spec (Task 6).

### Task 1: `tokenForSubject` y spike de Connect sin sesión (S1, S6)

**Files:**
- Modify: `lib/connectors/auth.ts`
- Test: `tests/connectors/auth.test.ts`
- Create (descartable): `spikes/etapa-3/connect-subject.mts`

**Interfaces:**
- Produces: `tokenForSubject(connector: string, who: { tenantId: string; userId: string; issuer?: string }, scopes?: string[]): Promise<{ token: string; expiresAt: number }>` en `lib/connectors/auth.ts`. La usan los schedules de la Entrega 4.

- [ ] **Step 1: Test que falla**

Agregar al final de `tests/connectors/auth.test.ts` (el mock de `@vercel/connect` ya existe arriba y registra las llamadas en `calls.getToken`), y sumar `tokenForSubject` al `await import("@/lib/connectors/auth")`:

```ts
describe("tokenForSubject", () => {
	it("pide el token del subject tenant:usuario con los scopes, sin sesión", async () => {
		const response = await tokenForSubject(
			"google/google",
			{ tenantId: "tenant-1", userId: "user-1" },
			["https://www.googleapis.com/auth/gmail.readonly"],
		);
		expect(response).toEqual({
			token: "llave-simulada",
			expiresAt: 1_789_325_386_769,
		});
		expect(calls.getToken[0]).toEqual([
			"google/google",
			{
				subject: { type: "user", id: "tenant-1:user-1" },
				scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
			},
		]);
	});

	it("incluye el issuer cuando el grant se guardó con uno", async () => {
		await tokenForSubject("mcp.hubspot.com/hubspot", {
			tenantId: "tenant-1",
			userId: "user-1",
			issuer: "https://issuer.test",
		});
		expect(calls.getToken[0]).toEqual([
			"mcp.hubspot.com/hubspot",
			{
				subject: {
					type: "user",
					id: "tenant-1:user-1",
					issuer: "https://issuer.test",
				},
			},
		]);
	});

	it("rechaza sin tenant o sin usuario: nunca pide un grant sin aislar", async () => {
		await expect(
			tokenForSubject("google/google", { tenantId: "", userId: "user-1" }),
		).rejects.toThrow("tokenForSubject requiere tenant y usuario");
		await expect(
			tokenForSubject("google/google", { tenantId: "tenant-1", userId: "" }),
		).rejects.toThrow("tokenForSubject requiere tenant y usuario");
		expect(calls.getToken).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npm test -- tests/connectors/auth.test.ts`
Expected: FAIL, `tokenForSubject is not a function`.

- [ ] **Step 3: Implementación mínima**

Al final de `lib/connectors/auth.ts`:

```ts
/**
 * Token OAuth de un usuario pedido por el proyecto, sin sesión de eve (los
 * schedules de la spec 03 §8.1). Mismo subject que tenantScopedConnect: el
 * grant de un tenant nunca se usa en otro.
 */
export async function tokenForSubject(
	connector: string,
	who: { tenantId: string; userId: string; issuer?: string },
	scopes?: string[],
): Promise<{ token: string; expiresAt: number }> {
	if (!who.tenantId || !who.userId) {
		throw new Error("tokenForSubject requiere tenant y usuario");
	}
	const { token, expiresAt } = await getTokenResponse(connector, {
		subject: {
			type: "user",
			id: tenantSubjectId(who.tenantId, who.userId),
			...(who.issuer ? { issuer: who.issuer } : {}),
		},
		...(scopes ? { scopes } : {}),
	});
	return { token, expiresAt };
}
```

Si `ConnectTokenSubject` (`node_modules/@vercel/connect/dist/token.d.ts`) no acepta `issuer`, sacar la propiedad, borrar el segundo test y anotarlo en la spec §13.1.

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm test -- tests/connectors/auth.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/auth.ts tests/connectors/auth.test.ts
git commit -m "feat: token de Connect por tenant y usuario sin sesión"
```

- [ ] **Step 6: Script descartable del spike**

`spikes/etapa-3/connect-subject.mts` queda fuera de `scripts/` para no entrar en la regla de import ni en el repo final. Importa `@vercel/connect` directo a propósito (es descartable; se borra en la Task 6):

```ts
// Spike S1 y S6 de la spec 03 §13. Descartable. Imprime estados, nunca tokens.
// Uso (lo corre el usuario, con el OIDC del proyecto en .env.local):
//   node --env-file=.env.local spikes/etapa-3/connect-subject.mts \
//     --tenant <tenant uuid> --user <user uuid> [--issuer <iss>] [--hubspot-write]
import { getTokenResponse } from "@vercel/connect";

function flag(name: string): string | null {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? null : (process.argv[i + 1] ?? null);
}

const tenant = flag("tenant");
const user = flag("user");
const issuer = flag("issuer");
if (!tenant || !user) throw new Error("faltan --tenant y --user");

const subject = {
	type: "user" as const,
	id: `${tenant}:${user}`,
	...(issuer ? { issuer } : {}),
};

async function probe(connector: string, scopes?: string[]) {
	try {
		const r = await getTokenResponse(connector, {
			subject,
			...(scopes ? { scopes } : {}),
		});
		console.log(`${connector}: token OK, largo ${r.token.length}, vence ${new Date(r.expiresAt).toISOString()}`);
		return r.token;
	} catch (error) {
		const e = error as { name?: string; message?: string };
		console.log(`${connector}: ${e.name ?? "Error"} ${e.message ?? ""}`);
		return null;
	}
}

// S1: Gmail y HubSpot sin sesión.
const gmail = await probe("google/google", [
	"https://www.googleapis.com/auth/gmail.send",
]);
if (gmail) {
	const info = await fetch(
		`https://oauth2.googleapis.com/tokeninfo?access_token=${gmail}`,
	);
	const body = (await info.json()) as { scope?: string };
	console.log(`tokeninfo ${info.status}, scopes: ${body.scope ?? "(sin dato)"}`);
}

const hubspot = await probe("mcp.hubspot.com/hubspot");

// S6: escrituras en HubSpot con el token del conector del MCP.
if (hubspot && process.argv.includes("--hubspot-write")) {
	const h = { Authorization: `Bearer ${hubspot}`, "Content-Type": "application/json" };
	const api = "https://api.hubapi.com";
	const stamp = Date.now();
	const contact = await fetch(`${api}/crm/v3/objects/contacts`, {
		method: "POST",
		headers: h,
		body: JSON.stringify({ properties: { email: `spike-etapa3-${stamp}@example.invalid`, firstname: "Spike", lastname: "Etapa3" } }),
	});
	const contactBody = (await contact.json()) as { id?: string };
	console.log(`crear contacto: ${contact.status}`);
	if (contactBody.id) {
		const assoc = [{ to: { id: contactBody.id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }];
		const note = await fetch(`${api}/crm/v3/objects/notes`, {
			method: "POST",
			headers: h,
			body: JSON.stringify({ properties: { hs_timestamp: new Date().toISOString(), hs_note_body: "[out · spike]" }, associations: assoc }),
		});
		console.log(`crear nota asociada: ${note.status}`);
		const task = await fetch(`${api}/crm/v3/objects/tasks`, {
			method: "POST",
			headers: h,
			body: JSON.stringify({ properties: { hs_timestamp: new Date(Date.now() + 86_400_000).toISOString(), hs_task_subject: "spike etapa 3", hs_task_status: "NOT_STARTED" }, associations: [{ to: { id: contactBody.id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }] }] }),
		});
		console.log(`crear task asociada: ${task.status}`);
		const deal = await fetch(`${api}/crm/v3/objects/deals`, {
			method: "POST",
			headers: h,
			body: JSON.stringify({ properties: { dealname: `Spike etapa 3 ${stamp}`, pipeline: "default" }, associations: [{ to: { id: contactBody.id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }] }),
		});
		console.log(`crear deal asociado: ${deal.status}`);
		const archived = await fetch(`${api}/crm/v3/objects/contacts/${contactBody.id}`, { method: "DELETE", headers: h });
		console.log(`archivar contacto de prueba: ${archived.status} (nota, task y deal: borrarlos a mano en HubSpot)`);
	}
}
```

- [ ] **Step 7: Correr el spike con el usuario**

Pedirle al usuario, en su terminal (el agente no ve la salida de tokens, el script no los imprime):

1. `vercel env pull .env.local` si el OIDC tiene más de 12 horas.
2. Su `tenant id` de `innovas` y su `user id` (Supabase → `memberships`).
3. `node --env-file=.env.local spikes/etapa-3/connect-subject.mts --tenant <id> --user <id>` y pegar la salida.
4. Si Gmail o HubSpot devuelven `UserAuthorizationRequiredError` pese a estar autorizado en el chat: buscar cómo estampa eve `principal.issuer` (`agents/outreach/channels/eve.ts`, `node_modules/eve/dist/src/runtime/auth`), repetir con `--issuer`.
5. Con S1 en verde para HubSpot: repetir con `--hubspot-write` y pegar la salida; borrar a mano en HubSpot la nota, la task y el deal de prueba.

Anotar la salida (sin tokens) para la Task 6. **Criterio S1:** status OK para ambos conectores. **Criterio S6:** `201` en contacto, nota, task y deal.

### Task 2: Scope `gmail.readonly` y `Message-ID` propio (S2)

**Files (en `spike/etapa-3`, no se mergea):**
- Modify: `agents/outreach/tools/send_email.ts` (scopes)
- Create: `spikes/etapa-3/gmail-readonly.mts`

- [ ] **Step 1: Pedir los dos scopes en la rama de spike**

En `agents/outreach/tools/send_email.ts`, donde se arma `tenantScopedConnect(GOOGLE_CONNECTOR_UID, tenantId, [GMAIL_SEND_SCOPE])`, pasar `[GMAIL_SEND_SCOPE, "https://www.googleapis.com/auth/gmail.readonly"]`. Commit en `spike/etapa-3`.

- [ ] **Step 2: Consentimiento con el usuario, en local**

Pedirle al usuario: sumar `gmail.readonly` a la pantalla de consentimiento de la app de Google Cloud (Data Access → scopes), `npm run dev` en `spike/etapa-3`, y en el chat local de `innovas` pedir un mail de prueba a su alias. Anotar: ¿Connect pidió consentimiento de nuevo? ¿La pantalla de Google mostró el scope de lectura? ¿El mail salió?

- [ ] **Step 3: Script de lectura y `Message-ID`**

`spikes/etapa-3/gmail-readonly.mts`:

```ts
// Spike S2 de la spec 03 §13. Descartable. Imprime estados, nunca tokens.
// Uso: node --env-file=.env.local spikes/etapa-3/gmail-readonly.mts \
//   --tenant <uuid> --user <uuid> --to <alias propio>
import { getTokenResponse } from "@vercel/connect";

function flag(name: string): string {
	const i = process.argv.indexOf(`--${name}`);
	const value = i === -1 ? null : process.argv[i + 1];
	if (!value) throw new Error(`falta --${name}`);
	return value;
}

const subject = { type: "user" as const, id: `${flag("tenant")}:${flag("user")}` };
const to = flag("to");
const scopes = [
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.readonly",
];
const { token } = await getTokenResponse("google/google", { subject, scopes });
const h = { Authorization: `Bearer ${token}` };
const api = "https://gmail.googleapis.com/gmail/v1/users/me";

const info = (await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`)).json()) as { scope?: string };
console.log(`scopes concedidos: ${info.scope ?? "(sin dato)"}`);

const list = await fetch(`${api}/messages?q=${encodeURIComponent("in:sent newer_than:10d")}&maxResults=1`, { headers: h });
console.log(`búsqueda en enviados: ${list.status}`);

const messageId = `<qi-spike-${Date.now()}@innov.as>`;
const raw = [
	`To: ${to}`,
	"Subject: spike etapa 3",
	`Message-ID: ${messageId}`,
	"Content-Type: text/plain; charset=UTF-8",
	"",
	"Prueba de Message-ID propio.",
].join("\r\n");
const sent = await fetch(`${api}/messages/send`, {
	method: "POST",
	headers: { ...h, "Content-Type": "application/json" },
	body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
});
const sentBody = (await sent.json()) as { id?: string; threadId?: string };
console.log(`envío: ${sent.status}, id ${sentBody.id ?? "-"}, thread ${sentBody.threadId ?? "-"}`);

await new Promise((r) => setTimeout(r, 5000));
const found = await fetch(`${api}/messages?q=${encodeURIComponent(`rfc822msgid:${messageId}`)}`, { headers: h });
const foundBody = (await found.json()) as { messages?: { id: string }[] };
console.log(`rfc822msgid: ${found.status}, encontrados ${foundBody.messages?.length ?? 0}`);

if (sentBody.id) {
	const meta = (await (await fetch(`${api}/messages/${sentBody.id}?format=metadata&metadataHeaders=Message-ID`, { headers: h })).json()) as { payload?: { headers?: { name: string; value: string }[] } };
	const header = meta.payload?.headers?.find((x) => x.name.toLowerCase() === "message-id")?.value;
	console.log(`Message-ID guardado: ${header === messageId ? "el nuestro" : `otro (${header ?? "sin header"})`}`);
}
```

- [ ] **Step 4: Correrlo con el usuario**

Pedirle al usuario que lo corra con su tenant, usuario y alias, y que pegue la salida. **Criterio S2:** scopes incluyen `gmail.readonly`; búsqueda `200`; `rfc822msgid` encuentra 1; `Message-ID` guardado es el nuestro. Anotar además cómo supo eve los scopes concedidos: revisar el payload del evento `authorization.completed` en `node_modules/eve/dist/src/runtime` (buscar `authorization.completed`) y si trae scopes.

### Task 3: Modelos por AI Gateway (S3)

**Files:**
- Create (descartable): `spikes/etapa-3/models.mts`

- [ ] **Step 1: Leer la API de salida estructurada de AI SDK 7**

Run: `ls node_modules/ai/docs 2>/dev/null; grep -n "export declare function generateObject\|Output.object\|export declare const Output" node_modules/ai/dist/index.d.ts | head`
Anotar si `generateObject` existe o si la forma es `generateText({ output: Output.object({ schema }) })`. El script usa la que exista.

- [ ] **Step 2: Script**

```ts
// Spike S3 de la spec 03 §13. Descartable.
// Uso: node --env-file=.env.local spikes/etapa-3/models.mts
import { generateText, Output } from "ai";
import { z } from "zod";

const schema = z.object({ categoria: z.enum(["no_interesado", "en_conversacion"]), resumen: z.string() });

for (const model of ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5", "anthropic/claude-haiku-4.5"]) {
	try {
		const started = Date.now();
		const result = await generateText({
			model,
			maxOutputTokens: 200,
			output: Output.object({ schema }),
			prompt: 'Clasificá esta respuesta a un mail comercial: "Gracias, por ahora no nos interesa."',
		});
		console.log(`${model}: OK en ${Date.now() - started} ms, salida ${JSON.stringify(result.output)}, uso ${JSON.stringify(result.usage)}`);
	} catch (error) {
		console.log(`${model}: ${(error as Error).name} ${(error as Error).message}`);
	}
}
```

Si el Step 1 mostró que la forma es otra, adaptar las dos líneas de `output` antes de correr.

- [ ] **Step 3: Correrlo**

Run: `node --env-file=.env.local spikes/etapa-3/models.mts`
Este script no maneja tokens de usuario: lo puede correr el agente. **Criterio S3:** los tres modelos responden con salida que valida contra el esquema y `usage` con tokens de entrada y salida. Si Haiku falla por el tier del Gateway, anotar el mensaje exacto.

### Task 4: Subagente, workflow tool y evals (S4, S7)

**Files (en `spike/etapa-3`, no se mergea):**
- Create: `agents/outreach/subagents/researcher/agent.ts`, `agents/outreach/subagents/researcher/instructions.md`
- Create: `agents/outreach/tools/spike_research.ts`
- Create: `agents/outreach/evals/evals.config.ts`, `agents/outreach/evals/spike.eval.ts`

- [ ] **Step 1: Leer la documentación del slot**

Leer `node_modules/eve/docs/subagents/index.mdx`, `node_modules/eve/docs/tools/workflows.mdx`, `node_modules/eve/docs/evals/` (todos) y buscar en `node_modules/eve/docs` cómo leer la web desde un agente (`grep -rn "web_search\|webSearch\|fetch" node_modules/eve/docs | head -30`).

- [ ] **Step 2: Subagente mínimo dinámico**

`agents/outreach/subagents/researcher/agent.ts`:

```ts
import { defineAgent, defineDynamic } from "eve";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			if (typeof auth?.attributes?.tenantId !== "string") return null;
			return defineAgent({
				description: "Investiga una empresa y devuelve hechos con fuente.",
				model: "anthropic/claude-haiku-4.5",
			});
		},
	},
});
```

`instructions.md`: "Investigá la empresa del dominio que te pasan. Devolvé solo hechos con URL."

Conexiones del subagente: `agents/outreach/subagents/researcher/connections/tenant.ts` reexportando el resolver de `agents/outreach/connections/tenant.ts` (probar si eve acepta el mismo `defineDynamic` importado).

- [ ] **Step 3: Workflow tool que espera el resultado tipado**

`agents/outreach/tools/spike_research.ts`, con la forma exacta de `defineWorkflowTool` y `ctx.agent` que muestre `tools/workflows.mdx`:

```ts
import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";

const ficha = z.object({
	name: z.string(),
	hechos: z.array(z.object({ hecho: z.string(), url: z.string() })),
});

export default defineWorkflowTool({
	description: "Spike: investiga un dominio con el subagente researcher.",
	inputSchema: z.object({ domain: z.string() }),
	async execute(input, ctx) {
		"use workflow";
		const result = await ctx.agent("researcher", {
			message: `Investigá ${input.domain}. Devolvé nombre y hasta 5 hechos con URL.`,
			outputSchema: ficha,
		});
		return result;
	},
});
```

- [ ] **Step 4: Probar en local con el usuario**

`npm run dev`, chat local de `innovas`: "usá spike_research con acme.com" (o un dominio real de prueba que elija el usuario). Anotar: ¿compila la workflow tool estática? ¿`ctx.agent` devuelve la ficha tipada? ¿el subagente vio las conexiones de ColdIQ? ¿con qué leyó la web?

- [ ] **Step 5: Eval mínima**

`agents/outreach/evals/evals.config.ts` y `agents/outreach/evals/spike.eval.ts` según `evals/`: un caso que manda "hola" y verifica `t.succeeded()`. Correr `npx eve eval --help` y después el caso contra `npm run dev`. Anotar: ¿cómo autentica contra `supabaseAuth` de `agents/outreach/channels/eve.ts`? ¿`--url` con cookie, principal de prueba, canal de eval? ¿Se puede sembrar un tenant de eval en la base local?

**Criterio S4:** ficha tipada devuelta por la workflow tool. **Criterio S7:** un caso de eval en verde con un mecanismo de auth que no abre el canal en producción.

### Task 5: Schedule (S5)

**Files (en `spike/etapa-3`, no se mergea):**
- Create: `agents/outreach/schedules/spike-heartbeat.ts`

- [ ] **Step 1: Schedule con `run`**

Leer `node_modules/eve/docs/schedules.mdx` y crear, con la forma exacta del doc:

```ts
import { defineSchedule } from "eve/schedules";
import { createAdminClient } from "../../../lib/supabase/admin";

export default defineSchedule({
	cron: "*/10 * * * *",
	async run() {
		const admin = createAdminClient();
		const { data } = await admin.from("tenant_agents").select("tenant_id").eq("agent", "outreach").eq("enabled", true);
		console.log(`spike-heartbeat: ${data?.length ?? 0} tenants con outreach`);
	},
});
```

- [ ] **Step 2: Disparo manual en dev**

`npm run dev` y buscar la ruta de disparo de schedules montada por `withEve` (el doc la muestra como `POST /eve/v1/dev/schedules/<nombre>` para `eve dev`; con Next el prefijo es `/eve/agents/outreach`). Anotar la ruta que funcionó y la salida del log.

- [ ] **Step 3: Cron en el build**

Run: `vercel build` (CLI ≥ 56.4.0) y `cat .vercel/output/config.json | grep -A5 crons`.
Anotar si aparece el cron. Vercel solo dispara crons en producción: la verificación real queda para la Entrega 4. **Criterio S5:** disparo manual lee tenants con el cliente admin y el cron figura en el output del build.

### Task 6: Resultado de los spikes y segunda tanda del plan

**Files:**
- Modify: `docs/superpowers/specs/03-agente-outreach-v1.md` (§13.1 y lo que cambie por un plan B)
- Modify: `docs/superpowers/plans/03-agente-outreach-v1.md` (tasks de las Entregas 3 a 5)
- Delete: `spikes/etapa-3/`

- [ ] **Step 1: Escribir §13.1** con una fila por spike: respuesta, evidencia sin secretos, qué cambia. Mismo formato que la spec 02 §10.1.
- [ ] **Step 2: Aplicar planes B** a las secciones afectadas de la spec (§8.1 si S1 falla, §6.3 si S4 falla, §9 si S6 falla, §11.2 si S7 cambia el mecanismo, §4.8 si S3 cambia defaults).
- [ ] **Step 3: Borrar** `spikes/etapa-3/` y la rama `spike/etapa-3` (local; nunca se pusheó con código que se mergee).
- [ ] **Step 4: Escribir las tasks de las Entregas 3 a 5** en este archivo, reemplazando la sección "Entregas 3 a 5", con la skill `superpowers:writing-plans` y el mismo nivel de detalle que la Entrega 2. Sesión con Opus.
- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/03-agente-outreach-v1.md docs/superpowers/plans/03-agente-outreach-v1.md
git commit -m "docs: resultado de los spikes de la etapa 3 y plan de las entregas 3 a 5"
```

---

## Entrega 2 · Datos y núcleo

### Task 7: Migración del núcleo de outreach

**Files:**
- Create: `supabase/migrations/<timestamp>_outreach_core.sql` (con `npx supabase migration new outreach_core`)
- Create: `supabase/tests/11_outreach_core.test.sql`
- Modify: `lib/supabase/database.types.ts` (regenerado)

**Interfaces:**
- Produces (tablas y enums que usan las Entregas 3 y 4): `outreach_stage`, `queue_item_status`, `queue_item_kind`, `config_value_kind`; `executors.slug`, `executors.crm_owner_id`, `executors.gmail_read_authorized_at`; tablas `config_values`, `accounts`, `contacts`, `queue_items`; `runs.schedule_key`; trigger `events_dedup`; índice único `events_inbound_message_idx`. Columnas exactas: spec §4.

- [ ] **Step 1: Cargar la skill `supabase-postgres-best-practices`** y confirmar con el usuario que la base local no la está usando otra sesión.

- [ ] **Step 2: Test pgTAP que falla**

`supabase/tests/11_outreach_core.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@outreach-a.test', now()),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'beto@outreach-b.test', now()),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'caro@outreach-a.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'outreach-a', 'Outreach A'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'outreach-b', 'Outreach B');

insert into public.memberships (tenant_id, user_id, role)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', 'tenant_member'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'a1a1a1a1-0000-0000-0000-000000000002', 'tenant_member'),
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000003', 'tenant_member');

insert into public.executors (tenant_id, user_id, slug)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', 'ana'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'a1a1a1a1-0000-0000-0000-000000000002', 'beto');

insert into public.config_values (tenant_id, kind, value, label)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'hook', 'h_uno', 'Uno'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'hook', 'h_dos', 'Dos');

insert into public.accounts (tenant_id, domain, name, ficha, expires_at)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'acme-a.test', 'Acme A', '{}', now() + interval '90 days'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'acme-b.test', 'Acme B', '{}', now() + interval '90 days');

insert into public.contacts (id, tenant_id, contact_key, email, owner_user_id, stage, source)
values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'uno@acme-a.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'msg1_enviado', 'csv'),
  ('c1c1c1c1-0000-0000-0000-000000000002', 'b1b1b1b1-0000-0000-0000-00000000000b', 'em:dos@acme-b.test', 'dos@acme-b.test', 'a1a1a1a1-0000-0000-0000-000000000002', 'a_contactar', 'csv'),
  ('c1c1c1c1-0000-0000-0000-000000000003', 'b1b1b1b1-0000-0000-0000-00000000000a', 'em:tres@acme-a.test', 'tres@acme-a.test', null, 'msg1_enviado', 'csv');

insert into public.queue_items (tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, ancla, draft_original, gate_result)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000001', 'em:uno@acme-a.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'followup_2', 'uno@acme-a.test', 'Asunto', 'Cuerpo', 'h_uno', 'v_uno', 'es_ar', null, '{}', '{}'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'c1c1c1c1-0000-0000-0000-000000000002', 'em:dos@acme-b.test', 'a1a1a1a1-0000-0000-0000-000000000002', 'msg1', 'dos@acme-b.test', 'Asunto', 'Cuerpo', 'h_dos', 'v_dos', 'es_ar', '{"hecho":"x","fuente":"https://acme-b.test"}', '{}', '{}');

-- RLS: lectura dentro del tenant, escritura solo del servidor.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a1a1a1a1-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.contacts),
  2,
  'un miembro ve los contactos de su tenant y ninguno ajeno'
);

select is(
  (select count(*)::int from public.queue_items where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'),
  0,
  'un miembro no ve la cola de otro tenant'
);

select is(
  (select count(*)::int from public.config_values) + (select count(*)::int from public.accounts),
  2,
  'config_values y accounts se leen solo dentro del tenant'
);

select throws_ok(
  $$insert into public.contacts (tenant_id, contact_key, source)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:nuevo@acme-a.test', 'chat')$$,
  '42501', null,
  'authenticated no puede crear contactos'
);

select throws_ok(
  $$update public.queue_items set body = 'otro' where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000a'$$,
  '42501', null,
  'authenticated no puede editar piezas de la cola'
);

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select throws_ok(
  $$select count(*) from public.contacts$$,
  '42501', null,
  'anon no puede leer contactos'
);

reset role;

-- Escalera de estados.
select throws_ok(
  $$update public.contacts set stage = 'a_contactar' where id = 'c1c1c1c1-0000-0000-0000-000000000001'$$,
  '23514', null,
  'la escalera no retrocede'
);

select lives_ok(
  $$update public.contacts set stage = 'sin_respuesta' where id = 'c1c1c1c1-0000-0000-0000-000000000003';
    update public.contacts set stage = 'en_conversacion' where id = 'c1c1c1c1-0000-0000-0000-000000000003'$$,
  'dentro del mismo rango se puede saltar (sin_respuesta a en_conversacion)'
);

select throws_ok(
  $$update public.contacts set stage = 'sin_atribucion' where id = 'c1c1c1c1-0000-0000-0000-000000000003'$$,
  '23514', null,
  'sin_atribucion solo se asigna al crear'
);

-- Cola.
select throws_ok(
  $$insert into public.queue_items (tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, draft_original, gate_result)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000001', 'em:uno@acme-a.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'followup_3', 'uno@acme-a.test', 'A', 'B', 'h', 'v', 'es_ar', '{}', '{}')$$,
  '23505', null,
  'una sola pieza viva por persona'
);

select throws_ok(
  $$insert into public.queue_items (tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, draft_original, gate_result)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000003', 'em:tres@acme-a.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'msg1', 'tres@acme-a.test', 'A', 'B', 'h', 'v', 'es_ar', '{}', '{}')$$,
  '23514', null,
  'un msg1 sin ancla no entra a la cola'
);

select throws_ok(
  $$update public.contacts set owner_user_id = 'a1a1a1a1-0000-0000-0000-000000000003' where id = 'c1c1c1c1-0000-0000-0000-000000000003'$$,
  '23503', null,
  'el claim solo lo tiene un ejecutor del mismo tenant'
);

select throws_ok(
  $$insert into public.queue_items (tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, draft_original, gate_result)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000002', 'em:dos@acme-b.test', 'a1a1a1a1-0000-0000-0000-000000000001', 'followup_2', 'dos@acme-b.test', 'A', 'B', 'h', 'v', 'es_ar', '{}', '{}')$$,
  '23503', null,
  'una pieza no puede apuntar a un contacto de otro tenant'
);

-- Eventos.
insert into public.events (tenant_id, contact_key, type, payload)
values
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'encolado', '{"queue_item_id":"q1"}'),
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'encolado', '{"queue_item_id":"q1"}'),
  ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'encolado', '{"queue_item_id":"q2"}');

select is(
  (select count(*)::int from public.events where contact_key = 'em:uno@acme-a.test' and type = 'encolado'),
  2,
  'el dedup descarta el mismo evento dentro de 2 horas y conserva los distintos'
);

insert into public.events (tenant_id, contact_key, type, payload, created_at)
values ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'respuesta', '{"gmail_message_id":"m1"}', now() - interval '3 hours');

select throws_ok(
  $$insert into public.events (tenant_id, contact_key, type, payload)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'em:uno@acme-a.test', 'respuesta', '{"gmail_message_id":"m1"}')$$,
  '23505', null,
  'una respuesta se registra una sola vez aunque pasen más de 2 horas'
);

-- Locks y ejecutores.
insert into public.runs (tenant_id, agent, trigger, eve_session_id, schedule_key)
values ('b1b1b1b1-0000-0000-0000-00000000000a', 'outreach', 'schedule', 'sweep', 'sweep:b1b1b1b1-0000-0000-0000-00000000000a:2026-09-15');

select throws_ok(
  $$insert into public.runs (tenant_id, agent, trigger, eve_session_id, schedule_key)
     values ('b1b1b1b1-0000-0000-0000-00000000000a', 'outreach', 'schedule', 'sweep-2', 'sweep:b1b1b1b1-0000-0000-0000-00000000000a:2026-09-15')$$,
  '23505', null,
  'el cron no corre dos veces el mismo barrido del día'
);

select lives_ok(
  $$update public.executors set slug = 'ana'
     where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'$$,
  'el mismo slug puede existir en otro tenant'
);

-- Caro pasa a ser ejecutora recién acá: el test del claim de arriba
-- necesita que no lo sea.
insert into public.executors (tenant_id, user_id)
values ('b1b1b1b1-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000003');

select throws_ok(
  $$update public.executors set slug = 'ana'
     where user_id = 'a1a1a1a1-0000-0000-0000-000000000003'$$,
  '23505', null,
  'dos ejecutores del mismo tenant no comparten slug'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npm run db:test`
Expected: FAIL en `11_outreach_core.test.sql` (`relation "public.config_values" does not exist` o similar). El resto de los archivos, en verde.

- [ ] **Step 4: Migración**

Run: `npx supabase migration new outreach_core` y escribir en el archivo creado:

```sql
-- Núcleo de datos del agente de outreach (spec 03 §4). Lecturas por RLS para
-- miembros del tenant; escriben solo tools y schedules con la service role.

create type public.outreach_stage as enum (
  'a_contactar', 'msg1_enviado', 'sin_respuesta', 'respuesta_neutra',
  'no_interesado', 'en_conversacion', 'reunion_agendada', 'deal_creado',
  'cliente', 'sin_atribucion'
);
create type public.queue_item_status as enum ('pending', 'approved', 'rejected', 'sent', 'failed', 'expired');
create type public.queue_item_kind as enum ('msg1', 'followup_2', 'followup_3');
create type public.config_value_kind as enum ('segmento', 'vector', 'hook', 'idioma');

-- Ejecutores: identidad en el canon (slug = outreach_owner) y en el CRM.
alter table public.executors
  add column slug text check (slug is null or slug ~ '^[a-z][a-z0-9-]{0,30}$'),
  add column crm_owner_id text check (crm_owner_id is null or length(crm_owner_id) between 1 and 64),
  add column gmail_read_authorized_at timestamptz;

create unique index executors_tenant_slug_idx on public.executors (tenant_id, slug)
  where slug is not null;

create table public.config_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind public.config_value_kind not null,
  value text not null check (value ~ '^[a-z0-9][a-z0-9_]{0,60}$'),
  label text not null check (length(label) between 1 and 200),
  active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, value)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  domain text not null check (domain = lower(domain) and domain !~ '^www\.' and length(domain) between 3 and 253),
  name text not null check (length(name) between 1 and 300),
  ficha jsonb not null,
  researched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (tenant_id, domain),
  unique (id, tenant_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_key text not null check (contact_key ~ '^(em|li|h):.+'),
  account_id uuid,
  name text,
  company text,
  email text check (email is null or email = lower(email)),
  linkedin_slug text,
  crm_id text,
  owner_user_id uuid,
  segment text,
  vector text,
  hook text,
  idioma text,
  stage public.outreach_stage not null default 'a_contactar',
  touches smallint not null default 0 check (touches between 0 and 3),
  first_touch_at timestamptz,
  last_touch_at timestamptz,
  next_step_at timestamptz,
  replied_at timestamptz,
  gmail_thread_id text,
  source text not null check (source in ('csv', 'chat')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, contact_key),
  unique (id, tenant_id),
  foreign key (account_id, tenant_id) references public.accounts (id, tenant_id)
    on delete set null (account_id),
  -- MATCH SIMPLE: con owner_user_id nulo (claim libre) no se chequea.
  foreign key (tenant_id, owner_user_id) references public.executors (tenant_id, user_id)
);

create index contacts_owner_next_step_idx on public.contacts (tenant_id, owner_user_id, next_step_at);
create index contacts_email_idx on public.contacts (tenant_id, email);
create index contacts_account_id_idx on public.contacts (account_id);

-- La escalera solo avanza (spec 03 §4.5). Red de seguridad: la regla fina
-- dentro del rango 2 vive en lib/outreach/stage.ts.
create or replace function public.contacts_stage_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  old_rank smallint;
  new_rank smallint;
begin
  if new.stage = old.stage then
    return new;
  end if;
  if new.stage = 'sin_atribucion' then
    raise exception 'sin_atribucion solo se asigna al crear el contacto'
      using errcode = 'check_violation';
  end if;
  new_rank := case new.stage
    when 'a_contactar' then 0 when 'msg1_enviado' then 1
    when 'reunion_agendada' then 3 when 'deal_creado' then 4 when 'cliente' then 5
    else 2 end;
  if old.stage = 'sin_atribucion' then
    if new_rank < 2 then
      raise exception 'un contacto sin atribución no vuelve al primer toque'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  old_rank := case old.stage
    when 'a_contactar' then 0 when 'msg1_enviado' then 1
    when 'reunion_agendada' then 3 when 'deal_creado' then 4 when 'cliente' then 5
    else 2 end;
  if new_rank < old_rank then
    raise exception 'la escalera de outreach no retrocede: % a %', old.stage, new.stage
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger contacts_stage_guard
  before update of stage on public.contacts
  for each row execute function public.contacts_stage_guard();

create table public.queue_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  contact_key text not null,
  executor_user_id uuid not null,
  kind public.queue_item_kind not null,
  channel text not null default 'email' check (channel = 'email'),
  to_email text not null check (to_email = lower(to_email)),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  hook text not null,
  vector text not null,
  idioma text not null,
  ancla jsonb,
  draft_original jsonb not null,
  gate_result jsonb not null,
  status public.queue_item_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  reply_to_message_id text,
  gmail_thread_id text,
  gmail_message_id text,
  approved_at timestamptz,
  sent_at timestamptz,
  error text,
  eve_session_id text,
  approval_call_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'msg1' or ancla is not null),
  foreign key (contact_id, tenant_id) references public.contacts (id, tenant_id) on delete cascade,
  foreign key (tenant_id, executor_user_id) references public.executors (tenant_id, user_id)
);

create unique index queue_items_live_per_contact_idx on public.queue_items (tenant_id, contact_id)
  where status in ('pending', 'approved');
create index queue_items_executor_status_idx on public.queue_items (tenant_id, executor_user_id, status);
create index queue_items_contact_id_idx on public.queue_items (contact_id);

-- events: dedup de 2 horas (kickoff §5) y respuestas únicas por mensaje.
create index events_dedup_idx on public.events (tenant_id, contact_key, type, created_at desc)
  where contact_key is not null;
create unique index events_inbound_message_idx on public.events (tenant_id, (payload ->> 'gmail_message_id'))
  where type in ('respuesta', 'rebote');

create or replace function public.events_dedup()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contact_key is null then
    return new;
  end if;
  if exists (
    select 1 from public.events e
    where e.tenant_id = new.tenant_id
      and e.contact_key = new.contact_key
      and e.type = new.type
      and coalesce(e.payload ->> 'queue_item_id', e.payload ->> 'gmail_message_id', '')
        = coalesce(new.payload ->> 'queue_item_id', new.payload ->> 'gmail_message_id', '')
      and e.created_at > now() - interval '2 hours'
  ) then
    return null;
  end if;
  return new;
end;
$$;

create trigger events_dedup
  before insert on public.events
  for each row execute function public.events_dedup();

-- runs: lock de los schedules por tenant y día.
alter table public.runs
  add column schedule_key text check (schedule_key is null or length(schedule_key) between 1 and 200);
create unique index runs_schedule_key_idx on public.runs (schedule_key)
  where schedule_key is not null;

-- RLS y grants.
alter table public.config_values enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.queue_items enable row level security;

create policy config_values_select on public.config_values
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));
create policy accounts_select on public.accounts
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));
create policy contacts_select on public.contacts
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));
create policy queue_items_select on public.queue_items
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

revoke insert, update, delete on public.config_values, public.accounts, public.contacts, public.queue_items
  from authenticated, anon;
revoke select on public.config_values, public.accounts, public.contacts, public.queue_items from anon;

revoke execute on function public.contacts_stage_guard() from public, anon, authenticated;
revoke execute on function public.events_dedup() from public, anon, authenticated;
```

- [ ] **Step 5: Correr los tests de base**

Run: `npm run db:test`
Expected: PASS en todos los archivos, incluidos `06_anon_grants` y `07_authenticated_grants`.

- [ ] **Step 6: Regenerar tipos contra la base local**

Run: `npx supabase gen types typescript --local > lib/supabase/database.types.ts && git diff --stat lib/supabase/database.types.ts`
Expected: solo cambios por las tablas, columnas y enums de esta migración. Si aparecen tablas que no son de esta etapa (la base local es compartida), **frenar y avisar al usuario** en vez de commitear.

- [ ] **Step 7: Typecheck y commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add supabase/migrations/*_outreach_core.sql supabase/tests/11_outreach_core.test.sql lib/supabase/database.types.ts
git commit -m "feat: tablas del núcleo de outreach con RLS, escalera y dedup"
```

### Task 8: `contact_key`

**Files:**
- Create: `lib/outreach/text.ts`, `lib/outreach/contact-key.ts`
- Test: `tests/outreach/contact-key.test.ts`

**Interfaces:**
- Produces: `normalizeText(text: string): string`, `stripAccents(text: string): string` (`text.ts`); `contactKey(input: ContactKeyInput): string`, `normalizeEmail(raw: string | null | undefined): string | null`, `linkedinSlug(raw: string | null | undefined): string | null`, `class ContactKeyError`, `interface ContactKeyInput { email?: string | null; linkedinUrl?: string | null; name?: string | null; company?: string | null }` (`contact-key.ts`).

- [ ] **Step 1: Test que falla**

`tests/outreach/contact-key.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	ContactKeyError,
	contactKey,
	linkedinSlug,
	normalizeEmail,
} from "@/lib/outreach/contact-key";
import { normalizeText } from "@/lib/outreach/text";

describe("normalizeText", () => {
	it("pasa a minúsculas y saca acentos, como normalizar() de gate.py", () => {
		expect(normalizeText("Estés BIEN, Ñandú")).toBe("estes bien, nandu");
	});
});

describe("normalizeEmail", () => {
	it("recorta y pasa a minúsculas", () => {
		expect(normalizeEmail("  Laura@Metalurgica.COM ")).toBe("laura@metalurgica.com");
	});
	it("devuelve null si no es un email", () => {
		expect(normalizeEmail("laura arroba x")).toBeNull();
		expect(normalizeEmail("")).toBeNull();
		expect(normalizeEmail(null)).toBeNull();
	});
});

describe("linkedinSlug", () => {
	it("saca el slug de una URL completa, sin query ni barra final", () => {
		expect(linkedinSlug("https://www.linkedin.com/in/Laura-Gomez-12ab/?utm=x")).toBe("laura-gomez-12ab");
		expect(linkedinSlug("ar.linkedin.com/in/laura-gomez/")).toBe("laura-gomez");
	});
	it("acepta un slug suelto", () => {
		expect(linkedinSlug("laura-gomez")).toBe("laura-gomez");
	});
	it("rechaza URLs que no son de perfil y textos con espacios", () => {
		expect(linkedinSlug("https://www.linkedin.com/company/acme")).toBeNull();
		expect(linkedinSlug("laura gomez")).toBeNull();
		expect(linkedinSlug(undefined)).toBeNull();
	});
});

describe("contactKey", () => {
	it("usa el email primero", () => {
		expect(
			contactKey({ email: "Laura@Acme.com", linkedinUrl: "laura-gomez", name: "Laura", company: "Acme" }),
		).toBe("em:laura@acme.com");
	});
	it("sin email usa LinkedIn", () => {
		expect(contactKey({ email: "no-es-mail", linkedinUrl: "https://linkedin.com/in/laura-gomez" })).toBe("li:laura-gomez");
	});
	it("sin email ni LinkedIn usa el hash de nombre y empresa normalizados", () => {
		const expected = createHash("sha1").update("laura gomez|metalurgica sur sa").digest("hex");
		expect(contactKey({ name: "  Laura   Gómez ", company: "Metalúrgica Sur SA" })).toBe(`h:${expected}`);
	});
	it("sin datos suficientes tira ContactKeyError", () => {
		expect(() => contactKey({ name: "Laura" })).toThrow(ContactKeyError);
	});
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- tests/outreach/contact-key.test.ts`
Expected: FAIL, no resuelve `@/lib/outreach/contact-key`.

- [ ] **Step 3: Implementación**

`lib/outreach/text.ts`:

```ts
// Normalización compartida del gate y de contact_key: minúsculas y sin
// diacríticos, igual que normalizar() de gate.py.
export function stripAccents(text: string): string {
	return text.normalize("NFD").replace(/\p{Mn}/gu, "");
}

export function normalizeText(text: string): string {
	return stripAccents(text.toLowerCase());
}
```

`lib/outreach/contact-key.ts`:

```ts
// Clave de identidad determinística del canon (spec 03 D4, §5.1):
// em:<email> → li:<slug> → h:<sha1(nombre|empresa)>.
import { createHash } from "node:crypto";
import { normalizeText } from "./text";

export class ContactKeyError extends Error {
	constructor() {
		super(
			"no alcanza para armar el contact_key: hace falta email, LinkedIn, o nombre y empresa",
		);
		this.name = "ContactKeyError";
	}
}

export interface ContactKeyInput {
	email?: string | null;
	linkedinUrl?: string | null;
	name?: string | null;
	company?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
	const email = (raw ?? "").trim().toLowerCase();
	return EMAIL.test(email) ? email : null;
}

/** Porta normalizar_id de pertenencia.py: URL de perfil o slug suelto. */
export function linkedinSlug(raw: string | null | undefined): string | null {
	const value = (raw ?? "").trim().toLowerCase();
	if (!value) return null;
	const fromUrl = value.match(/linkedin\.com\/in\/([^/?#\s]+)/);
	if (fromUrl) return fromUrl[1];
	if (/[/@\s]/.test(value)) return null;
	return value;
}

function normalizePart(text: string | null | undefined): string {
	return normalizeText(text ?? "").replace(/\s+/g, " ").trim();
}

export function contactKey(input: ContactKeyInput): string {
	const email = normalizeEmail(input.email);
	if (email) return `em:${email}`;
	const slug = linkedinSlug(input.linkedinUrl);
	if (slug) return `li:${slug}`;
	const name = normalizePart(input.name);
	const company = normalizePart(input.company);
	if (name && company) {
		return `h:${createHash("sha1").update(`${name}|${company}`).digest("hex")}`;
	}
	throw new ContactKeyError();
}
```

- [ ] **Step 4: Correr tests**

Run: `npm test -- tests/outreach/contact-key.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/text.ts lib/outreach/contact-key.ts tests/outreach/contact-key.test.ts
git commit -m "feat: contact_key del canon de outreach"
```

### Task 9: Reglas del gate desde el brain

**Files:**
- Create: `lib/outreach/gate-blocks.ts`
- Test: `tests/outreach/gate-blocks.test.ts`

**Interfaces:**
- Consumes: `normalizeText` (Task 8).
- Produces: `interface GateVeto { phrase: string; literal: boolean; source: string }`, `interface GateRules { vetos: GateVeto[]; maxChars: { all: number | null; byChannel: Record<string, number> }; formal: boolean; errors: string[] }`, `emptyGateRules(): GateRules`, `parseGateBlocks(markdown: string, source: string): GateRules`, `mergeGateRules(...all: GateRules[]): GateRules`, `compileVeto(veto: GateVeto): RegExp | null`.

- [ ] **Step 1: Test que falla**

`tests/outreach/gate-blocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	compileVeto,
	emptyGateRules,
	mergeGateRules,
	parseGateBlocks,
} from "@/lib/outreach/gate-blocks";

const TEMPLATE = [
	"# Voz",
	"",
	"```gate",
	"# veto_literal: <frase que no dice nunca>        # alta YYYY-MM-DD",
	"# veto: <expresion regular>                      # alta YYYY-MM-DD",
	"# max_chars: <maximo propio, si difiere del canal>",
	"```",
].join("\n");

describe("parseGateBlocks", () => {
	it("la plantilla comentada de las bibliotecas de voz no aporta reglas ni errores", () => {
		expect(parseGateBlocks(TEMPLATE, "voz/ana")).toEqual(emptyGateRules());
	});

	it("lee vetos, max_chars, formal y comentarios de alta al final de la línea", () => {
		const md = [
			"```gate",
			"veto: clientes ... (banco mundial|bid|fao)   # alta 2026-09-15",
			"veto_literal: llave en mano",
			"max_chars: 900",
			"max_chars: email=700",
			"formal: true",
			"```",
			"texto fuera del bloque: veto: nada",
		].join("\n");
		expect(parseGateBlocks(md, "canon-gate")).toEqual({
			vetos: [
				{ phrase: "clientes ... (banco mundial|bid|fao)", literal: false, source: "canon-gate" },
				{ phrase: "llave en mano", literal: true, source: "canon-gate" },
			],
			maxChars: { all: 900, byChannel: { email: 700 } },
			formal: true,
			errors: [],
		});
	});

	it("una directiva desconocida o mal escrita queda como error", () => {
		const rules = parseGateBlocks("```gate\nprohibir: algo\nmax_chars: mucho\n```", "voz/ana");
		expect(rules.errors).toEqual([
			'voz/ana: directiva del gate no reconocida: "prohibir: algo"',
			'voz/ana: directiva del gate no reconocida: "max_chars: mucho"',
		]);
	});
});

describe("mergeGateRules", () => {
	it("suma vetos y errores, se queda con el límite menor y con formal si alguno lo pide", () => {
		const tenant = parseGateBlocks("```gate\nveto: bid\nmax_chars: email=900\n```", "canon-gate");
		const executor = parseGateBlocks("```gate\nveto_literal: sinergia\nmax_chars: email=600\nformal: true\n```", "voz/ana");
		const merged = mergeGateRules(tenant, executor);
		expect(merged.vetos.map((v) => v.phrase)).toEqual(["bid", "sinergia"]);
		expect(merged.maxChars).toEqual({ all: null, byChannel: { email: 600 } });
		expect(merged.formal).toBe(true);
	});
});

describe("compileVeto", () => {
	const veto = (phrase: string, literal = false) => ({ phrase, literal, source: "t" });

	it("compila alternativas y busca con límites de palabra sobre texto normalizado", () => {
		const re = compileVeto(veto("ejecutamos para (el Banco Mundial|BID|FAO)"));
		expect(re).not.toBeNull();
		expect("ejecutamos para el banco mundial".match(re as RegExp)).not.toBeNull();
		expect("ejecutamos para bidones".match(re as RegExp)).toBeNull();
	});

	it("el hueco ... admite hasta 40 caracteres sin punto", () => {
		const re = compileVeto(veto("clientes ... (bid|fao)")) as RegExp;
		expect("clientes como el bid".match(re)).not.toBeNull();
		expect(`clientes ${"x".repeat(45)} bid`.match(re)).toBeNull();
		expect("clientes. el bid".match(re)).toBeNull();
	});

	it("un veto literal es un substring sin sintaxis", () => {
		const re = compileVeto(veto("(no) tan rápido", true)) as RegExp;
		expect("dijo (no) tan rapido".match(re)).not.toBeNull();
	});

	it("una frase mal formada devuelve null", () => {
		expect(compileVeto(veto("(bid"))).toBeNull();
		expect(compileVeto(veto("bid|fao"))).toBeNull();
		expect(compileVeto(veto("()"))).toBeNull();
		expect(compileVeto(veto("   "))).toBeNull();
	});
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- tests/outreach/gate-blocks.test.ts`
Expected: FAIL, no resuelve el módulo.

- [ ] **Step 3: Implementación**

`lib/outreach/gate-blocks.ts`:

```ts
// Reglas del gate que vienen del brain (spec 03 §5.2): bloques ```gate en la
// página canon:gate del tenant y en la voz del ejecutor. Los vetos NO son
// regex: vienen de datos editables y se compilan a una expresión acotada.
import { normalizeText } from "./text";

export interface GateVeto {
	phrase: string;
	literal: boolean;
	source: string;
}

export interface GateRules {
	vetos: GateVeto[];
	maxChars: { all: number | null; byChannel: Record<string, number> };
	formal: boolean;
	errors: string[];
}

export function emptyGateRules(): GateRules {
	return {
		vetos: [],
		maxChars: { all: null, byChannel: {} },
		formal: false,
		errors: [],
	};
}

const BLOCK = /```gate[ \t]*\r?\n([\s\S]*?)```/g;

function minOrNull(current: number | null | undefined, next: number): number {
	return current === null || current === undefined ? next : Math.min(current, next);
}

function applyMaxChars(rules: GateRules, value: string): boolean {
	const match = value.match(/^(?:([a-z_]+)=)?(\d{1,5})$/);
	if (!match) return false;
	const limit = Number(match[2]);
	if (match[1]) {
		rules.maxChars.byChannel[match[1]] = minOrNull(rules.maxChars.byChannel[match[1]], limit);
	} else {
		rules.maxChars.all = minOrNull(rules.maxChars.all, limit);
	}
	return true;
}

export function parseGateBlocks(markdown: string, source: string): GateRules {
	const rules = emptyGateRules();
	for (const block of markdown.matchAll(BLOCK)) {
		for (const rawLine of block[1].split(/\r?\n/)) {
			const line = rawLine.replace(/\s+#.*$/, "").trim();
			if (!line || line.startsWith("#")) continue;
			const separator = line.indexOf(":");
			const key = separator === -1 ? "" : line.slice(0, separator).trim();
			const value = separator === -1 ? "" : line.slice(separator + 1).trim();

			if ((key === "veto" || key === "veto_literal") && value) {
				rules.vetos.push({ phrase: value, literal: key === "veto_literal", source });
				continue;
			}
			if (key === "max_chars" && applyMaxChars(rules, value)) continue;
			if (key === "formal" && (value === "true" || value === "false")) {
				rules.formal = rules.formal || value === "true";
				continue;
			}
			rules.errors.push(`${source}: directiva del gate no reconocida: "${line}"`);
		}
	}
	return rules;
}

export function mergeGateRules(...all: GateRules[]): GateRules {
	const merged = emptyGateRules();
	for (const rules of all) {
		merged.vetos.push(...rules.vetos);
		merged.errors.push(...rules.errors);
		merged.formal = merged.formal || rules.formal;
		if (rules.maxChars.all !== null) {
			merged.maxChars.all = minOrNull(merged.maxChars.all, rules.maxChars.all);
		}
		for (const [channel, limit] of Object.entries(rules.maxChars.byChannel)) {
			merged.maxChars.byChannel[channel] = minOrNull(merged.maxChars.byChannel[channel], limit);
		}
	}
	return merged;
}

const GAP = "[^.]{0,40}";

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileSegment(segment: string): string | null {
	const text = segment.trim();
	if (!text) return null;
	let pattern = "";
	let cursor = 0;
	for (const group of text.matchAll(/\(([^()]*)\)/g)) {
		const index = group.index ?? 0;
		const before = text.slice(cursor, index);
		if (/[()|]/.test(before)) return null;
		const options = group[1].split("|").map((option) => option.trim());
		if (options.some((option) => !option)) return null;
		pattern += `${escapeRegExp(before)}(?:${options.map(escapeRegExp).join("|")})`;
		cursor = index + group[0].length;
	}
	const tail = text.slice(cursor);
	if (/[()|]/.test(tail)) return null;
	return pattern + escapeRegExp(tail);
}

/** Expresión acotada (sin cuantificadores anidados) o null si la frase está mal formada. */
export function compileVeto(veto: GateVeto): RegExp | null {
	const phrase = normalizeText(veto.phrase).replace(/\s+/g, " ").trim();
	if (!phrase || phrase.length > 200) return null;
	if (veto.literal) return new RegExp(escapeRegExp(phrase), "g");
	const segments = phrase.split(" ... ").map(compileSegment);
	if (segments.some((segment) => segment === null)) return null;
	return new RegExp(`\\b${segments.join(GAP)}\\b`, "g");
}
```

- [ ] **Step 4: Correr tests**

Run: `npm test -- tests/outreach/gate-blocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/gate-blocks.ts tests/outreach/gate-blocks.test.ts
git commit -m "feat: reglas del gate de estilo leídas del brain"
```

### Task 10: Gate de estilo

**Files:**
- Create: `lib/outreach/gate.ts`
- Test: `tests/outreach/gate.test.ts`

**Interfaces:**
- Consumes: `normalizeText` (Task 8); `GateRules`, `compileVeto`, `emptyGateRules`, `parseGateBlocks` (Task 9).
- Produces: `GATE_IDIOMAS = ["es_ar", "es_es"] as const`, `type GateStatus = "ok" | "fail" | "indeterminate"`, `type GatePiece = "asunto" | "cuerpo"`, `interface GateViolation { kind: "simbolo" | "formula" | "idioma" | "largo" | "formato" | "veto"; piece: GatePiece; what: string; fix: string }`, `interface GateWarning { piece: GatePiece; what: string; fix: string }`, `interface GateResult { status: GateStatus; violations: GateViolation[]; warnings: GateWarning[]; notes: string[] }`, `interface GateInput { subject: string; body: string; channel: string; idioma: string; rules: GateRules }`, `runGate(input: GateInput): GateResult`. `GateResult` es JSON serializable: va tal cual a `queue_items.gate_result`.

- [ ] **Step 1: Test que falla**

`tests/outreach/gate.test.ts` (textos sintéticos; ningún prospecto real):

```ts
import { describe, expect, it } from "vitest";
import { emptyGateRules, parseGateBlocks } from "@/lib/outreach/gate-blocks";
import { type GateInput, runGate } from "@/lib/outreach/gate";

const SUBJECT = "Crecer sin sumar gente al back office";
const BODY = [
	"Hola Laura,",
	"",
	"Vi que Metalúrgica Sur sumó una segunda planta en Rafaela este año. Cuando la operación crece así, el costo de coordinar crece más rápido que la facturación.",
	"",
	"Armamos con equipos como el tuyo un tablero que ordena pedidos y compras sin sumar gente al back office.",
	"",
	"Si te sirve, te cuento en 30 minutos cómo lo aplicamos en una empresa del rubro. Tenés un rato el jueves?",
].join("\n");

function gate(overrides: Partial<GateInput> = {}) {
	return runGate({
		subject: SUBJECT,
		body: BODY,
		channel: "email",
		idioma: "es_ar",
		rules: emptyGateRules(),
		...overrides,
	});
}

const kinds = (overrides: Partial<GateInput>) => gate(overrides).violations.map((v) => v.kind);

describe("runGate", () => {
	it("una pieza limpia en es_ar pasa", () => {
		expect(gate()).toEqual({ status: "ok", violations: [], warnings: [], notes: [] });
	});

	it("veta símbolos en cuerpo y asunto", () => {
		expect(kinds({ body: `${BODY}\nUn dato — otro.` })).toEqual(["simbolo"]);
		expect(kinds({ subject: "Crecer 🙂" })).toEqual(["simbolo"]);
		expect(kinds({ body: BODY.replace("Tenés un rato el jueves?", "¿Tenés un rato el jueves?") })).toEqual(["simbolo"]);
	});

	it("formal habilita los signos de apertura", () => {
		const rules = parseGateBlocks("```gate\nformal: true\n```", "canon-gate");
		expect(gate({ rules, body: BODY.replace("Tenés un rato", "¿Tenés un rato") }).status).toBe("ok");
	});

	it("veta fórmulas sobre el texto sin acentos, incluidas las muletillas de validación", () => {
		const fail = gate({ body: `Espero que estés bien.\n${BODY}` });
		expect(fail.status).toBe("fail");
		expect(fail.violations[0]).toMatchObject({ kind: "formula", piece: "cuerpo", what: 'fórmula vetada: "espero que estes bien"' });
		expect(kinds({ body: `${BODY}\nNo es casualidad que te escriba.` })).toEqual(["formula"]);
	});

	it("las construcciones por negación avisan pero no bloquean", () => {
		const result = gate({ body: `${BODY}\nNo se trata de sumar gente.` });
		expect(result.status).toBe("ok");
		expect(result.warnings).toHaveLength(1);
	});

	it("idioma: inglés para un destinatario es_ar falla", () => {
		const body = "Hi Laura, I saw that your company is growing and we would like to help with the operations of your team.";
		expect(kinds({ body })).toEqual(["idioma"]);
	});

	it("idioma: formas peninsulares en es_ar y voseo en es_es fallan", () => {
		expect(kinds({ body: BODY.replace("Tenés", "Tienes") })).toEqual(["idioma"]);
		expect(kinds({ idioma: "es_es" })).toEqual(["idioma"]);
	});

	it("idioma: vale como verbo no es peninsular; vale como interjección sí", () => {
		expect(gate({ body: `${BODY}\nLo que más vale es el tiempo del equipo.` }).status).toBe("ok");
		// La interjección se reconoce después de puntuación (igual que gate.py).
		expect(kinds({ body: `${BODY}\nListo. Vale, entonces arrancamos.` })).toEqual(["idioma"]);
	});

	it("señal de idioma débil o idioma no soportado da indeterminado", () => {
		expect(gate({ body: "Hola Laura." }).status).toBe("indeterminate");
		const en = gate({ idioma: "en" });
		expect(en.status).toBe("indeterminate");
		expect(en.notes[0]).toContain('idioma "en" no soportado');
	});

	it("una violación con idioma indeterminado es falla, con la nota", () => {
		const result = gate({ body: "Hola — Laura." });
		expect(result.status).toBe("fail");
		expect(result.notes).toHaveLength(1);
	});

	it("largo: asunto de más de 50 y max_chars de las reglas", () => {
		expect(kinds({ subject: "x".repeat(51) })).toEqual(["largo"]);
		const rules = parseGateBlocks("```gate\nmax_chars: email=100\n```", "voz/ana");
		expect(kinds({ rules })).toEqual(["largo"]);
	});

	it("formato: HTML, links con tracking y asunto vacío", () => {
		expect(kinds({ body: `${BODY}\n<b>hola</b>` })).toEqual(["formato"]);
		expect(kinds({ body: `${BODY}\nhttps://acme.test/?utm_source=mail` })).toEqual(["formato"]);
		expect(kinds({ subject: "  " })).toEqual(["formato"]);
	});

	it("vetos del tenant y del ejecutor", () => {
		const rules = parseGateBlocks("```gate\nveto: clientes ... (banco mundial|bid|fao)\n```", "canon-gate");
		const result = gate({ rules, body: `${BODY}\nTrabajamos con clientes como el BID.` });
		expect(result.violations).toEqual([
			{ kind: "veto", piece: "cuerpo", what: 'veto de canon-gate: "clientes como el bid"', fix: "ver la regla en canon-gate" },
		]);
	});

	it("una regla mal formada bloquea en vez de ignorarse", () => {
		const malformed = parseGateBlocks("```gate\nveto: (bid\n```", "voz/ana");
		expect(kinds({ rules: malformed })).toEqual(["veto"]);
		const unknown = parseGateBlocks("```gate\nprohibir: x\n```", "voz/ana");
		expect(kinds({ rules: unknown })).toEqual(["veto"]);
	});
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- tests/outreach/gate.test.ts`
Expected: FAIL, no resuelve `@/lib/outreach/gate`.

- [ ] **Step 3: Implementación**

`lib/outreach/gate.ts`:

```ts
// Gate de estilo determinístico (spec 03 D3, §5.2). Porta la base genérica de
// scripts/gate.py v1.2.0 del canon; lo propio del tenant o del ejecutor entra
// como GateRules. fail e indeterminate bloquean, igual que los códigos 1 y 2.
import { compileVeto, type GateRules } from "./gate-blocks";
import { normalizeText } from "./text";

export const GATE_IDIOMAS = ["es_ar", "es_es"] as const;

export type GateStatus = "ok" | "fail" | "indeterminate";
export type GatePiece = "asunto" | "cuerpo";

export interface GateViolation {
	kind: "simbolo" | "formula" | "idioma" | "largo" | "formato" | "veto";
	piece: GatePiece;
	what: string;
	fix: string;
}

export interface GateWarning {
	piece: GatePiece;
	what: string;
	fix: string;
}

export interface GateResult {
	status: GateStatus;
	violations: GateViolation[];
	warnings: GateWarning[];
	notes: string[];
}

export interface GateInput {
	subject: string;
	body: string;
	channel: string;
	idioma: string;
	rules: GateRules;
}

interface SymbolRule {
	what: string;
	pattern: RegExp;
	fix: string;
	opening?: true;
}

const SYMBOLS: SymbolRule[] = [
	{ what: "guion largo (em dash)", pattern: /—/g, fix: 'coma, punto, o "y" / "de"' },
	{ what: "guion medio (en dash)", pattern: /–/g, fix: '"a" en rangos: 50 a 500 empleados' },
	{ what: "signo de aproximación", pattern: /≈/g, fix: '"cerca de", "alrededor de"' },
	{ what: "tilde de aproximación", pattern: /~\s*\d/g, fix: '"cerca de 50"' },
	{ what: "bullet en texto corrido", pattern: /•/g, fix: "punto y aparte" },
	{ what: "comilla tipográfica doble", pattern: /[“”]/g, fix: "comillas rectas, o ninguna" },
	{ what: "comilla tipográfica simple", pattern: /[‘’]/g, fix: "apóstrofo recto, o ninguno" },
	{ what: "puntos suspensivos de un solo carácter", pattern: /…/g, fix: "tres puntos, o terminar la frase" },
	{ what: "espacio duro", pattern: / /g, fix: "espacio normal" },
	{ what: "signo de apertura de pregunta", pattern: /¿/g, fix: "solo el de cierre: por dónde arranco?", opening: true },
	{ what: "signo de apertura de exclamación", pattern: /¡/g, fix: "solo el de cierre: qué barbaridad!", opening: true },
	{
		what: "emoji o pictograma",
		pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{FE0F}]/gu,
		fix: "borrarlo",
	},
];

// Sobre texto normalizado. Las fórmulas de BM, BID y FAO de gate.py no están:
// son del tenant innovas y van a su página canon:gate.
const FORMULAS: Array<{ pattern: RegExp; fix: string }> = [
	{ pattern: /espero que (te encuentres|estes|andes) (muy )?bien/g, fix: "arrancar por el dolor del que lee" },
	{ pattern: /queria contarte/g, fix: "arrancar por el que lee, no por el que escribe" },
	{ pattern: /me permito/g, fix: "decir la cosa directamente" },
	{ pattern: /revolucionar|transformacion total|reinventar/g, fix: "una promesa sostenible y concreta" },
	{ pattern: /soluciones de inteligencia artificial/g, fix: "el problema concreto de su operación" },
	{ pattern: /sinergia|ecosistema|holistic|disruptiv/g, fix: "la palabra común" },
	{ pattern: /no dudes en (escribirme|contactarme|consultarme)/g, fix: "un ask con fecha" },
	{ pattern: /quedo (a disposicion|atento|atenta|a tu disposicion)/g, fix: "un ask con fecha" },
	{ pattern: /alguna novedad/g, fix: "un dato nuevo: un caso, un benchmark" },
	{ pattern: /te reitero|reiterando mi (mensaje|correo)|siguiendo mi mensaje anterior/g, fix: "un ángulo distinto sobre el mismo dolor" },
	{ pattern: /somos una empresa lider|lideres en el (mercado|sector)/g, fix: "un hecho verificable, o nada" },
	{ pattern: /en (el|un) mundo (actual|cada vez mas)/g, fix: "borrar la línea entera" },
	{ pattern: /en la era de/g, fix: "borrar la línea entera" },
	{ pattern: /no solo[^.]{0,60}sino (que )?tambien/g, fix: "una sola afirmación" },
	{ pattern: /vale la pena destacar|cabe destacar|es importante destacar/g, fix: "destacarlo, sin anunciar que se destaca" },
	{ pattern: /en resumen,|en conclusion,/g, fix: "borrar: el mensaje es corto, no necesita resumen" },
	{ pattern: /potenciar|empoderar|apalancar/g, fix: "el verbo concreto" },
	{ pattern: /soluciones a medida|llave en mano/g, fix: "qué hace, en una frase" },
	{ pattern: /una breve (llamada|charla)|charla para conocernos|conocernos mejor/g, fix: "el ask real del canon del tenant" },
	{ pattern: /te mando (info|informacion)|te comparto material/g, fix: "un ask con fecha" },
	{ pattern: /espero tu respuesta|aguardo tu respuesta/g, fix: "un ask con fecha" },
	// Muletillas de validación del skill innovas-outreach-message que gate.py no tenía.
	{ pattern: /justo lo que|es exactamente lo que|no es casualidad que|en un mundo donde|lo que realmente importa/g, fix: "decir el hecho sin validarlo" },
];

const AFFIRMATIVE: Array<{ pattern: RegExp; fix: string }> = [
	{ pattern: /no es (un|una|el|la)\b/g, fix: "describir lo que la cosa es" },
	{ pattern: /no se trata de/g, fix: "describir lo que la cosa es" },
	{ pattern: /\ben vez de\b/g, fix: "afirmar sin el contraste" },
	{ pattern: /\ben meses, no en\b/g, fix: "afirmar el plazo solo" },
];

const MARKERS_ES = /\b(que|de|la|el|los|las|para|con|una|por|como|pero|cuando|donde|entre|sobre|sin|mas|ya|hay|su|del)\b/g;
const MARKERS_EN = /\b(the|and|of|to|for|with|that|this|your|we|our|is|are|from|about|would|have)\b/g;
const MARKERS_AR = /\b(vos|sos|tenes|podes|queres|sabes|haces|conta(me|rme)|deci(me|rme)|escribi(me|rme)|mira|fijate|aca|alla|charlamos|dale|laburo)\b/g;
const MARKERS_ES_ES = /\b(vosotros|teneis|podeis|quereis|tu tienes|tu puedes|puedes|tienes|quieres|aqui|os |contadme|coger|ordenador|movil)\b|(?:^|[,.;:]\s*)vale(?=[,.!]|\s+(?:entonces|pues|si|no)\b)/g;
const MARKER_THRESHOLD = 4;
const SUBJECT_MAX = 50;
const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/gi;
const TRACKING = /[?&](utm_[a-z]+|mc_eid|mc_cid|fbclid|gclid)=/gi;

function count(text: string, pattern: RegExp): number {
	return (text.match(pattern) ?? []).length;
}

function checkPiece(
	text: string,
	piece: GatePiece,
	rules: GateRules,
	vetos: Array<{ source: string; pattern: RegExp }>,
): GateViolation[] {
	const out: GateViolation[] = [];
	for (const rule of SYMBOLS) {
		if (rule.opening && rules.formal) continue;
		for (const _ of text.matchAll(rule.pattern)) {
			out.push({ kind: "simbolo", piece, what: rule.what, fix: rule.fix });
		}
	}
	const plain = normalizeText(text);
	for (const rule of FORMULAS) {
		for (const match of plain.matchAll(rule.pattern)) {
			out.push({ kind: "formula", piece, what: `fórmula vetada: "${match[0]}"`, fix: rule.fix });
		}
	}
	if (text.match(HTML_TAG)) {
		out.push({ kind: "formato", piece, what: "etiquetas HTML en un mensaje de texto plano", fix: "texto plano, sin formato" });
	}
	if (text.match(TRACKING)) {
		out.push({ kind: "formato", piece, what: "link con parámetros de tracking", fix: "sacar los parámetros o el link" });
	}
	for (const veto of vetos) {
		for (const match of plain.matchAll(veto.pattern)) {
			out.push({ kind: "veto", piece, what: `veto de ${veto.source}: "${match[0]}"`, fix: `ver la regla en ${veto.source}` });
		}
	}
	return out;
}

function checkLanguage(body: string, idioma: string): { violations: GateViolation[]; indeterminate: string | null } {
	if (!(GATE_IDIOMAS as readonly string[]).includes(idioma)) {
		return { violations: [], indeterminate: `idioma "${idioma}" no soportado por el gate (solo es_ar y es_es)` };
	}
	const plain = normalizeText(body);
	const es = count(plain, MARKERS_ES);
	const en = count(plain, MARKERS_EN);
	if (es + en < MARKER_THRESHOLD) {
		return {
			violations: [],
			indeterminate: `señal de idioma demasiado débil (${es + en} marcadores, umbral ${MARKER_THRESHOLD}): el gate no adivina`,
		};
	}
	if (en >= es) {
		return {
			violations: [{ kind: "idioma", piece: "cuerpo", what: `el destinatario es ${idioma} y el texto parece inglés (es=${es}, en=${en})`, fix: "reescribir en el idioma del destinatario" }],
			indeterminate: null,
		};
	}
	const isAr = idioma === "es_ar";
	const pattern = isAr ? MARKERS_ES_ES : MARKERS_AR;
	const label = isAr ? "forma peninsular en un mensaje es_ar" : "voseo en un mensaje es_es";
	const fix = isAr ? "usar la forma rioplatense" : "usar la forma peninsular";
	return {
		violations: [...plain.matchAll(pattern)].map((match) => ({
			kind: "idioma" as const,
			piece: "cuerpo" as const,
			what: `${label}: "${match[0].replace(/^[,.;:\s]+/, "").trim()}"`,
			fix,
		})),
		indeterminate: null,
	};
}

function checkLength(subject: string, body: string, channel: string, rules: GateRules): GateViolation[] {
	const out: GateViolation[] = [];
	const subjectLength = [...subject].length;
	if (subjectLength > SUBJECT_MAX) {
		out.push({ kind: "largo", piece: "asunto", what: `${subjectLength} caracteres, el máximo es ${SUBJECT_MAX}`, fix: "el asunto nombra el dolor, no el producto" });
	}
	const limits = [rules.maxChars.all, rules.maxChars.byChannel[channel]].filter(
		(limit): limit is number => typeof limit === "number",
	);
	const bodyLength = [...body].length;
	if (limits.length > 0 && bodyLength > Math.min(...limits)) {
		out.push({ kind: "largo", piece: "cuerpo", what: `${bodyLength} caracteres, el máximo propio es ${Math.min(...limits)}`, fix: "recortar" });
	}
	return out;
}

export function runGate(input: GateInput): GateResult {
	const subject = input.subject.trim();
	const body = input.body.trim();
	const violations: GateViolation[] = [];
	const notes: string[] = [];

	if (!subject) violations.push({ kind: "formato", piece: "asunto", what: "asunto vacío", fix: "un asunto que nombre el dolor" });
	if (!body) violations.push({ kind: "formato", piece: "cuerpo", what: "cuerpo vacío", fix: "redactar la pieza" });

	const vetos: Array<{ source: string; pattern: RegExp }> = [];
	for (const veto of input.rules.vetos) {
		const pattern = compileVeto(veto);
		if (pattern) {
			vetos.push({ source: veto.source, pattern });
		} else {
			violations.push({ kind: "veto", piece: "cuerpo", what: `veto mal formado en ${veto.source}: "${veto.phrase}"`, fix: "corregir la directiva en la página del brain" });
		}
	}
	for (const error of input.rules.errors) {
		violations.push({ kind: "veto", piece: "cuerpo", what: `regla del gate mal formada: ${error}`, fix: "corregir la directiva en la página del brain" });
	}

	violations.push(...checkPiece(subject, "asunto", input.rules, vetos));
	violations.push(...checkPiece(body, "cuerpo", input.rules, vetos));
	violations.push(...checkLength(subject, body, input.channel, input.rules));

	const warnings: GateWarning[] = [];
	const plainBody = normalizeText(body);
	for (const rule of AFFIRMATIVE) {
		for (const match of plainBody.matchAll(rule.pattern)) {
			warnings.push({ piece: "cuerpo", what: `construcción por negación: "${match[0]}"`, fix: rule.fix });
		}
	}

	const language = checkLanguage(body, input.idioma);
	violations.push(...language.violations);
	if (language.indeterminate) notes.push(language.indeterminate);

	const status: GateStatus = violations.length > 0 ? "fail" : language.indeterminate ? "indeterminate" : "ok";
	return { status, violations, warnings, notes };
}
```

- [ ] **Step 4: Correr tests**

Run: `npm test -- tests/outreach/gate.test.ts`
Expected: PASS. Si un caso de idioma falla por conteo de marcadores, revisar el texto de prueba contra las listas (no relajar las listas: son append-only en el canon).

- [ ] **Step 5: Lint, typecheck y commit**

Run: `npm run lint:fix && npm run typecheck`

```bash
git add lib/outreach/gate.ts tests/outreach/gate.test.ts
git commit -m "feat: gate de estilo determinístico portado de gate.py"
```

### Task 11: Escalera y guards

**Files:**
- Create: `lib/outreach/stage.ts`, `lib/outreach/guards.ts`
- Test: `tests/outreach/stage.test.ts`, `tests/outreach/guards.test.ts`

**Interfaces:**
- Produces (`stage.ts`): `OUTREACH_STAGES` (los 10 valores del enum `outreach_stage`, en el orden de la migración), `type OutreachStage`, `stageRank(stage: OutreachStage): number`, `canAdvance(from: OutreachStage, to: OutreachStage): boolean`, `MAX_TOUCHES = 3`, `FOLLOWUP_OFFSETS_DAYS = [4, 10]`, `NO_RESPONSE_AFTER_DAYS = 14`, `nextFollowup(input: { touches: number; firstTouchAt: Date }): Date | null`, `isNoResponse(input: { touches: number; firstTouchAt: Date | null; repliedAt: Date | null; now: Date }): boolean`.
- Produces (`guards.ts`): `CLAIM_WINDOW_DAYS = 90`, `MAILBOX_GUARD_DAYS = 10`, `type ClaimStatus = "libre" | "propio" | "ajeno"`, `interface CrmAuthorship { ownerId: string; at: Date }`, `claimStatus(input: ClaimInput): ClaimStatus`, `interface CrmCandidate { id: string; contactKey: string | null; email: string | null; linkedinSlugs: string[] }`, `crmMatch(candidates: CrmCandidate[], query: { contactKey: string; email: string | null; linkedinSlug: string | null }): CrmCandidate | null`, `type TouchReason = "vencida" | "un_toque_por_dia" | "cupo_diario" | "max_toques" | "buzon"`, `TOUCH_REASON_TEXT: Record<TouchReason, string>`, `canTouch(input: TouchInput): TouchVerdict`, `type TouchVerdict = { ok: true } | { ok: false; reason: TouchReason; transient: boolean }`.

- [ ] **Step 1: Tests que fallan**

`tests/outreach/stage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canAdvance, isNoResponse, nextFollowup, OUTREACH_STAGES } from "@/lib/outreach/stage";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));

describe("canAdvance", () => {
	it("avanza de rango y se puede saltear", () => {
		expect(canAdvance("a_contactar", "msg1_enviado")).toBe(true);
		expect(canAdvance("msg1_enviado", "reunion_agendada")).toBe(true);
	});
	it("nunca retrocede ni se queda igual", () => {
		expect(canAdvance("en_conversacion", "msg1_enviado")).toBe(false);
		expect(canAdvance("msg1_enviado", "msg1_enviado")).toBe(false);
	});
	it("dentro del rango 2 sigue la regla del canon", () => {
		expect(canAdvance("sin_respuesta", "en_conversacion")).toBe(true);
		expect(canAdvance("respuesta_neutra", "no_interesado")).toBe(true);
		expect(canAdvance("no_interesado", "en_conversacion")).toBe(true);
		expect(canAdvance("en_conversacion", "respuesta_neutra")).toBe(false);
		expect(canAdvance("no_interesado", "sin_respuesta")).toBe(false);
	});
	it("sin_atribucion solo al crear y desde ahí a rango 2 o más", () => {
		expect(canAdvance("a_contactar", "sin_atribucion")).toBe(false);
		expect(canAdvance("sin_atribucion", "en_conversacion")).toBe(true);
		expect(canAdvance("sin_atribucion", "msg1_enviado")).toBe(false);
	});
	it("conoce los 10 estados del enum", () => {
		expect(OUTREACH_STAGES).toHaveLength(10);
	});
});

describe("cadencia", () => {
	it("segundo toque a +4 y tercero a +10 del primero; después nada", () => {
		expect(nextFollowup({ touches: 1, firstTouchAt: day(0) })).toEqual(day(4));
		expect(nextFollowup({ touches: 2, firstTouchAt: day(0) })).toEqual(day(10));
		expect(nextFollowup({ touches: 3, firstTouchAt: day(0) })).toBeNull();
		expect(nextFollowup({ touches: 0, firstTouchAt: day(0) })).toBeNull();
	});
	it("sin respuesta: 3 toques, sin respuesta y 14 días desde el primero", () => {
		expect(isNoResponse({ touches: 3, firstTouchAt: day(0), repliedAt: null, now: day(14) })).toBe(true);
		expect(isNoResponse({ touches: 3, firstTouchAt: day(0), repliedAt: null, now: day(13) })).toBe(false);
		expect(isNoResponse({ touches: 2, firstTouchAt: day(0), repliedAt: null, now: day(20) })).toBe(false);
		expect(isNoResponse({ touches: 3, firstTouchAt: day(0), repliedAt: day(5), now: day(20) })).toBe(false);
		expect(isNoResponse({ touches: 3, firstTouchAt: null, repliedAt: null, now: day(20) })).toBe(false);
	});
});
```

`tests/outreach/guards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canTouch, claimStatus, crmMatch } from "@/lib/outreach/guards";

const now = new Date("2026-09-15T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base = { executorUserId: "ana", executorCrmOwnerId: "crm-ana", now };

describe("claimStatus", () => {
	it("libre, propio o ajeno según el owner de la base cuando el CRM no dice nada reciente", () => {
		expect(claimStatus({ ...base, ownerUserId: null, crmAuthorship: null })).toBe("libre");
		expect(claimStatus({ ...base, ownerUserId: "ana", crmAuthorship: null })).toBe("propio");
		expect(claimStatus({ ...base, ownerUserId: "beto", crmAuthorship: null })).toBe("ajeno");
		expect(claimStatus({ ...base, ownerUserId: "beto", crmAuthorship: { ownerId: "crm-ana", at: daysAgo(120) } })).toBe("ajeno");
	});
	it("la autoría reciente del CRM gana sobre la base", () => {
		expect(claimStatus({ ...base, ownerUserId: "ana", crmAuthorship: { ownerId: "crm-beto", at: daysAgo(30) } })).toBe("ajeno");
		expect(claimStatus({ ...base, ownerUserId: "beto", crmAuthorship: { ownerId: "crm-ana", at: daysAgo(30) } })).toBe("propio");
		expect(claimStatus({ ...base, ownerUserId: null, crmAuthorship: { ownerId: "crm-beto", at: daysAgo(89) } })).toBe("ajeno");
	});
	it("un ejecutor sin owner en el CRM no puede probar una autoría reciente", () => {
		expect(claimStatus({ ...base, executorCrmOwnerId: null, ownerUserId: null, crmAuthorship: { ownerId: "crm-ana", at: daysAgo(1) } })).toBe("ajeno");
	});
});

describe("crmMatch", () => {
	const candidates = [
		{ id: "1", contactKey: null, email: "laura@acme.test", linkedinSlugs: [] },
		{ id: "2", contactKey: "em:laura@acme.test", email: null, linkedinSlugs: [] },
		{ id: "3", contactKey: null, email: null, linkedinSlugs: ["laura-gomez"] },
	];
	it("prioriza contact_key, después email, después LinkedIn", () => {
		expect(crmMatch(candidates, { contactKey: "em:laura@acme.test", email: "laura@acme.test", linkedinSlug: null })?.id).toBe("2");
		expect(crmMatch(candidates, { contactKey: "em:otra@acme.test", email: "laura@acme.test", linkedinSlug: null })?.id).toBe("1");
		expect(crmMatch(candidates, { contactKey: "li:laura-gomez", email: null, linkedinSlug: "laura-gomez" })?.id).toBe("3");
		expect(crmMatch(candidates, { contactKey: "em:nadie@acme.test", email: "nadie@acme.test", linkedinSlug: null })).toBeNull();
	});
});

describe("canTouch", () => {
	const ok = {
		now,
		expiresAt: new Date(now.getTime() + 86_400_000),
		touches: 0,
		sentTodayToRecipient: false,
		sentTodayByExecutor: 2,
		dailyQuota: 30,
		lastSentToRecipientOutsideThreadAt: null,
	};
	it("deja pasar una pieza en regla", () => {
		expect(canTouch(ok)).toEqual({ ok: true });
	});
	it("chequea en el orden del canon", () => {
		expect(canTouch({ ...ok, expiresAt: daysAgo(1), sentTodayToRecipient: true })).toEqual({ ok: false, reason: "vencida", transient: false });
		expect(canTouch({ ...ok, sentTodayToRecipient: true, sentTodayByExecutor: 30 })).toEqual({ ok: false, reason: "un_toque_por_dia", transient: true });
		expect(canTouch({ ...ok, sentTodayByExecutor: 30, touches: 3 })).toEqual({ ok: false, reason: "cupo_diario", transient: true });
		expect(canTouch({ ...ok, touches: 3, lastSentToRecipientOutsideThreadAt: daysAgo(2) })).toEqual({ ok: false, reason: "max_toques", transient: false });
		expect(canTouch({ ...ok, lastSentToRecipientOutsideThreadAt: daysAgo(9) })).toEqual({ ok: false, reason: "buzon", transient: false });
	});
	it("el guard de buzón mira solo los últimos 10 días", () => {
		expect(canTouch({ ...ok, lastSentToRecipientOutsideThreadAt: daysAgo(11) })).toEqual({ ok: true });
	});
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/outreach/stage.test.ts tests/outreach/guards.test.ts`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Implementación**

`lib/outreach/stage.ts`:

```ts
// Escalera de outreach_status y cadencia del canon (spec 03 §5.4). El trigger
// de contacts solo impide bajar de rango; esta es la regla completa.
export const OUTREACH_STAGES = [
	"a_contactar",
	"msg1_enviado",
	"sin_respuesta",
	"respuesta_neutra",
	"no_interesado",
	"en_conversacion",
	"reunion_agendada",
	"deal_creado",
	"cliente",
	"sin_atribucion",
] as const;

export type OutreachStage = (typeof OUTREACH_STAGES)[number];

const RANK: Record<OutreachStage, number> = {
	a_contactar: 0,
	msg1_enviado: 1,
	sin_respuesta: 2,
	respuesta_neutra: 2,
	no_interesado: 2,
	en_conversacion: 2,
	reunion_agendada: 3,
	deal_creado: 4,
	cliente: 5,
	sin_atribucion: -1,
};

const WITHIN_RANK_2: Partial<Record<OutreachStage, readonly OutreachStage[]>> = {
	sin_respuesta: ["respuesta_neutra", "no_interesado", "en_conversacion"],
	respuesta_neutra: ["no_interesado", "en_conversacion"],
	no_interesado: ["en_conversacion"],
	en_conversacion: [],
};

export function stageRank(stage: OutreachStage): number {
	return RANK[stage];
}

export function canAdvance(from: OutreachStage, to: OutreachStage): boolean {
	if (from === to || to === "sin_atribucion") return false;
	if (from === "sin_atribucion") return RANK[to] >= 2;
	if (RANK[to] > RANK[from]) return true;
	if (RANK[to] === RANK[from]) return WITHIN_RANK_2[from]?.includes(to) ?? false;
	return false;
}

const DAY_MS = 86_400_000;
export const MAX_TOUCHES = 3;
export const FOLLOWUP_OFFSETS_DAYS = [4, 10] as const;
export const NO_RESPONSE_AFTER_DAYS = 14;

/** Fecha del siguiente toque después de haber mandado `touches` toques. */
export function nextFollowup(input: { touches: number; firstTouchAt: Date }): Date | null {
	const offset = FOLLOWUP_OFFSETS_DAYS[input.touches - 1];
	return offset === undefined ? null : new Date(input.firstTouchAt.getTime() + offset * DAY_MS);
}

export function isNoResponse(input: {
	touches: number;
	firstTouchAt: Date | null;
	repliedAt: Date | null;
	now: Date;
}): boolean {
	if (input.touches < MAX_TOUCHES || input.repliedAt || !input.firstTouchAt) return false;
	return input.now.getTime() - input.firstTouchAt.getTime() >= NO_RESPONSE_AFTER_DAYS * DAY_MS;
}
```

`lib/outreach/guards.ts`:

```ts
// Invariantes del canon que se revalidan en el borde de cada tool
// (spec 03 §5.3). Puro: quien llama trae los datos de la base, el CRM y Gmail.
const DAY_MS = 86_400_000;
export const CLAIM_WINDOW_DAYS = 90;
export const MAILBOX_GUARD_DAYS = 10;

export type ClaimStatus = "libre" | "propio" | "ajeno";

export interface CrmAuthorship {
	ownerId: string;
	at: Date;
}

export interface ClaimInput {
	ownerUserId: string | null;
	executorUserId: string;
	executorCrmOwnerId: string | null;
	crmAuthorship: CrmAuthorship | null;
	now: Date;
}

/** El dueño es quien conversa: la autoría reciente del CRM gana sobre la base. */
export function claimStatus(input: ClaimInput): ClaimStatus {
	const authorship = input.crmAuthorship;
	if (authorship && input.now.getTime() - authorship.at.getTime() < CLAIM_WINDOW_DAYS * DAY_MS) {
		return input.executorCrmOwnerId !== null && authorship.ownerId === input.executorCrmOwnerId
			? "propio"
			: "ajeno";
	}
	if (input.ownerUserId === null) return "libre";
	return input.ownerUserId === input.executorUserId ? "propio" : "ajeno";
}

export interface CrmCandidate {
	id: string;
	contactKey: string | null;
	email: string | null;
	linkedinSlugs: string[];
}

/** G1: OR por contact_key, email y LinkedIn, en ese orden de prioridad. */
export function crmMatch(
	candidates: CrmCandidate[],
	query: { contactKey: string; email: string | null; linkedinSlug: string | null },
): CrmCandidate | null {
	const byKey = candidates.find((c) => c.contactKey === query.contactKey);
	if (byKey) return byKey;
	const email = query.email;
	const byEmail = email ? candidates.find((c) => c.email?.toLowerCase() === email) : undefined;
	if (byEmail) return byEmail;
	const slug = query.linkedinSlug;
	return (slug ? candidates.find((c) => c.linkedinSlugs.includes(slug)) : undefined) ?? null;
}

export type TouchReason = "vencida" | "un_toque_por_dia" | "cupo_diario" | "max_toques" | "buzon";

export const TOUCH_REASON_TEXT: Record<TouchReason, string> = {
	vencida: "la pieza venció: pasaron más de 7 días desde que se encoló",
	un_toque_por_dia: "ya hubo un toque a esta persona hoy",
	cupo_diario: "llegaste al cupo diario de envíos",
	max_toques: "esta persona ya recibió los 3 toques",
	buzon: "tu casilla ya le escribió a esta dirección en los últimos 10 días, fuera de este hilo",
};

export interface TouchInput {
	now: Date;
	expiresAt: Date;
	/** Toques ya enviados a la persona antes de esta pieza. */
	touches: number;
	sentTodayToRecipient: boolean;
	sentTodayByExecutor: number;
	dailyQuota: number;
	lastSentToRecipientOutsideThreadAt: Date | null;
}

export type TouchVerdict = { ok: true } | { ok: false; reason: TouchReason; transient: boolean };

export function canTouch(input: TouchInput): TouchVerdict {
	if (input.expiresAt.getTime() <= input.now.getTime()) {
		return { ok: false, reason: "vencida", transient: false };
	}
	if (input.sentTodayToRecipient) return { ok: false, reason: "un_toque_por_dia", transient: true };
	if (input.sentTodayByExecutor >= input.dailyQuota) return { ok: false, reason: "cupo_diario", transient: true };
	if (input.touches >= 3) return { ok: false, reason: "max_toques", transient: false };
	const last = input.lastSentToRecipientOutsideThreadAt;
	if (last && input.now.getTime() - last.getTime() < MAILBOX_GUARD_DAYS * DAY_MS) {
		return { ok: false, reason: "buzon", transient: false };
	}
	return { ok: true };
}
```

- [ ] **Step 4: Correr tests**

Run: `npm test -- tests/outreach/stage.test.ts tests/outreach/guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/stage.ts lib/outreach/guards.ts tests/outreach/stage.test.ts tests/outreach/guards.test.ts
git commit -m "feat: escalera de outreach, cadencia y guards del canon"
```

### Task 12: Módulos de datos de outreach

**Files:**
- Create: `lib/outreach/domain.ts`, `lib/outreach/csv.ts`, `lib/outreach/ficha.ts`, `lib/outreach/classify.ts`, `lib/outreach/events.ts`, `lib/outreach/queue-letters.ts`
- Test: `tests/outreach/csv.test.ts`, `tests/outreach/ficha.test.ts`, `tests/outreach/records.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail`, `linkedinSlug` (Task 8); `OutreachStage` (Task 11).
- Produces:
  - `domain.ts`: `normalizeDomain(raw: string | null | undefined): string | null`, `domainFromEmail(email: string): string | null` (null para casillas gratuitas).
  - `csv.ts`: `MAX_CSV_ROWS = 50`, `interface CsvContactRow { line: number; name: string | null; email: string | null; linkedinUrl: string | null; company: string | null; domain: string | null; segment: string | null; vector: string | null }`, `parseContactsCsv(text: string): { rows: CsvContactRow[]; errors: Array<{ line: number; reason: string }> }`.
  - `ficha.ts`: `FICHA_TTL_DAYS = 90`, `fichaSchema` (zod), `type Ficha`, `sanitizeFicha(ficha: Ficha): Ficha`, `fichaExpiresAt(researchedAt: Date): Date`, `isFichaVigente(expiresAt: Date, now: Date): boolean`.
  - `classify.ts`: `REPLY_CATEGORIES`, `type ReplyCategory`, `replyClassificationSchema` (zod), `stageForReply(category: ReplyCategory): OutreachStage`, `wantsDeal(category: ReplyCategory): boolean`.
  - `events.ts`: `OUTREACH_EVENT_TYPES`, `type OutreachEventType`, `MODEL_LOGGABLE_EVENT_TYPES = ["freno", "nota"]`, `interface OutreachEventInsert { tenant_id: string; actor_user_id: string | null; contact_key: string | null; channel: "email" | null; type: OutreachEventType; summary: string; payload: Record<string, unknown>; run_id: string | null }`, `outreachEvent(input: Omit<OutreachEventInsert, "channel" | "run_id"> & { channel?: "email" | null; run_id?: string | null }): OutreachEventInsert`.
  - `queue-letters.ts`: `assignLetters<T extends { created_at: string }>(items: T[]): Array<T & { letter: string }>`.

- [ ] **Step 1: Tests que fallan**

`tests/outreach/csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseContactsCsv } from "@/lib/outreach/csv";
import { domainFromEmail, normalizeDomain } from "@/lib/outreach/domain";

describe("domain", () => {
	it("normaliza dominios y URLs", () => {
		expect(normalizeDomain("https://www.Acme.com.ar/contacto")).toBe("acme.com.ar");
		expect(normalizeDomain("acme")).toBeNull();
		expect(normalizeDomain("")).toBeNull();
	});
	it("saca el dominio de un email corporativo, no de una casilla gratuita", () => {
		expect(domainFromEmail("laura@acme.com.ar")).toBe("acme.com.ar");
		expect(domainFromEmail("laura@gmail.com")).toBeNull();
	});
});

describe("parseContactsCsv", () => {
	it("lee columnas conocidas, comillas y deriva el dominio del email", () => {
		const csv = [
			"name,email,company,linkedin_url,segment,vector,columna_extra",
			'"Gómez, Laura",Laura@Acme.com.ar,"Acme, SA",,mid_market_ar,v7_seller_meli_ar,x',
			"Beto,,Fabrica,https://linkedin.com/in/beto-r,,,",
		].join("\n");
		expect(parseContactsCsv(csv)).toEqual({
			rows: [
				{ line: 2, name: "Gómez, Laura", email: "laura@acme.com.ar", company: "Acme, SA", linkedinUrl: null, domain: "acme.com.ar", segment: "mid_market_ar", vector: "v7_seller_meli_ar" },
				{ line: 3, name: "Beto", email: null, company: "Fabrica", linkedinUrl: "https://linkedin.com/in/beto-r", domain: null, segment: null, vector: null },
			],
			errors: [],
		});
	});

	it("reporta filas con email inválido y comillas sin cerrar sin frenar las demás", () => {
		const csv = ["name,email", "Laura,no-es-mail", 'Beto,"beto@acme.test', "Caro,caro@acme.test"].join("\n");
		const result = parseContactsCsv(csv);
		expect(result.rows.map((r) => r.name)).toEqual(["Laura", "Caro"]);
		expect(result.rows[0].email).toBeNull();
		expect(result.errors).toEqual([
			{ line: 2, reason: 'email inválido: "no-es-mail"' },
			{ line: 3, reason: "comillas sin cerrar" },
		]);
	});

	it("exige encabezado con al menos una columna conocida y como mucho 50 filas", () => {
		expect(parseContactsCsv("a,b\n1,2").errors).toEqual([{ line: 1, reason: "el encabezado no tiene ninguna columna conocida (name, email, linkedin_url, company, domain, segment, vector)" }]);
		const many = ["email", ...Array.from({ length: 51 }, (_, i) => `p${i}@acme.test`)].join("\n");
		expect(parseContactsCsv(many).errors).toEqual([{ line: 1, reason: "el CSV tiene 51 filas; el máximo por carga es 50" }]);
	});
});
```

`tests/outreach/ficha.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type Ficha, fichaExpiresAt, fichaSchema, isFichaVigente, sanitizeFicha } from "@/lib/outreach/ficha";

const ficha: Ficha = {
	name: "Acme",
	domain: "https://www.acme.test/",
	produce: "Envases",
	gana: null,
	compra: null,
	rompe_si_crece: null,
	gap_declarado: null,
	gap_demostrable: null,
	hechos: [
		{ hecho: "Abrió planta en Rafaela", url: "https://acme.test/noticias", fecha: "2026-03-01" },
		{ hecho: "Sin fuente", url: "", fecha: null },
		{ hecho: "Fuente no web", url: "javascript:alert(1)", fecha: null },
	],
	creditos_usados: 2,
};

describe("ficha", () => {
	it("el esquema acepta la ficha del researcher", () => {
		expect(fichaSchema.parse(ficha)).toEqual(ficha);
	});
	it("sanitizeFicha descarta hechos sin URL http(s) y normaliza el dominio", () => {
		const clean = sanitizeFicha(ficha);
		expect(clean.domain).toBe("acme.test");
		expect(clean.hechos.map((h) => h.hecho)).toEqual(["Abrió planta en Rafaela"]);
	});
	it("vence a los 90 días", () => {
		const researched = new Date("2026-09-01T00:00:00Z");
		const expires = fichaExpiresAt(researched);
		expect(expires.toISOString()).toBe("2026-11-30T00:00:00.000Z");
		expect(isFichaVigente(expires, new Date("2026-11-29T23:59:59Z"))).toBe(true);
		expect(isFichaVigente(expires, expires)).toBe(false);
	});
});
```

`tests/outreach/records.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { replyClassificationSchema, stageForReply, wantsDeal } from "@/lib/outreach/classify";
import { OUTREACH_EVENT_TYPES, outreachEvent } from "@/lib/outreach/events";
import { assignLetters } from "@/lib/outreach/queue-letters";

describe("classify", () => {
	it("valida la salida del clasificador y mapea a la escalera", () => {
		const parsed = replyClassificationSchema.parse({ categoria: "reunion_agendada", resumen: "Acepta el jueves", cita: "Dale, el jueves a las 10" });
		expect(stageForReply(parsed.categoria)).toBe("reunion_agendada");
		expect(wantsDeal("en_conversacion")).toBe(true);
		expect(wantsDeal("respuesta_neutra")).toBe(false);
		expect(() => replyClassificationSchema.parse({ categoria: "spam", resumen: "x", cita: "x" })).toThrow();
	});
});

describe("events", () => {
	it("arma el insert con canal email por default y rechaza tipos desconocidos", () => {
		expect(
			outreachEvent({ tenant_id: "t", actor_user_id: "u", contact_key: "em:a@b.test", type: "encolado", summary: "  pieza A  ", payload: { queue_item_id: "q" } }),
		).toEqual({ tenant_id: "t", actor_user_id: "u", contact_key: "em:a@b.test", channel: "email", type: "encolado", summary: "pieza A", payload: { queue_item_id: "q" }, run_id: null });
		expect(() => outreachEvent({ tenant_id: "t", actor_user_id: null, contact_key: null, type: "otro" as never, summary: "x", payload: {} })).toThrow('tipo de evento de outreach desconocido: "otro"');
		expect(OUTREACH_EVENT_TYPES).toContain("oportunidad_frenada");
	});
	it("recorta el resumen a 500 caracteres", () => {
		const event = outreachEvent({ tenant_id: "t", actor_user_id: null, contact_key: null, type: "nota", summary: "x".repeat(600), payload: {} });
		expect(event.summary).toHaveLength(500);
	});
});

describe("assignLetters", () => {
	it("ordena por creación y asigna A, B, …, Z, AA", () => {
		const items = Array.from({ length: 27 }, (_, i) => ({ id: `q${i}`, created_at: new Date(Date.UTC(2026, 8, 1, 0, 26 - i)).toISOString() }));
		const lettered = assignLetters(items);
		expect(lettered[0]).toMatchObject({ id: "q26", letter: "A" });
		expect(lettered[25].letter).toBe("Z");
		expect(lettered[26]).toMatchObject({ id: "q0", letter: "AA" });
	});
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/outreach/csv.test.ts tests/outreach/ficha.test.ts tests/outreach/records.test.ts`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Implementación**

`lib/outreach/domain.ts`:

```ts
const FREE_MAIL = new Set([
	"gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.ar", "outlook.com",
	"live.com", "live.com.ar", "yahoo.com", "yahoo.com.ar", "icloud.com", "me.com", "proton.me",
]);

export function normalizeDomain(raw: string | null | undefined): string | null {
	const value = (raw ?? "")
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, "")
		.replace(/^www\./, "")
		.split(/[/?#]/)[0];
	return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : null;
}

export function domainFromEmail(email: string): string | null {
	const domain = normalizeDomain(email.split("@")[1]);
	return domain && !FREE_MAIL.has(domain) ? domain : null;
}
```

`lib/outreach/csv.ts`:

```ts
// CSV de carga de contactos (spec 03 §6.4 import_contacts). Encabezado
// obligatorio; columnas desconocidas se ignoran.
import { normalizeEmail } from "./contact-key";
import { domainFromEmail, normalizeDomain } from "./domain";

export const MAX_CSV_ROWS = 50;
const COLUMNS = ["name", "email", "linkedin_url", "company", "domain", "segment", "vector"] as const;

export interface CsvContactRow {
	line: number;
	name: string | null;
	email: string | null;
	linkedinUrl: string | null;
	company: string | null;
	domain: string | null;
	segment: string | null;
	vector: string | null;
}

function splitLine(line: string): string[] | null {
	const cells: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (quoted) {
			if (char === '"' && line[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				cell += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			cells.push(cell);
			cell = "";
		} else {
			cell += char;
		}
	}
	if (quoted) return null;
	cells.push(cell);
	return cells;
}

const clean = (value: string | undefined): string | null => {
	const trimmed = (value ?? "").trim();
	return trimmed ? trimmed : null;
};

export function parseContactsCsv(text: string): {
	rows: CsvContactRow[];
	errors: Array<{ line: number; reason: string }>;
} {
	const lines = text.split(/\r?\n/);
	const header = (splitLine(lines[0] ?? "") ?? []).map((h) => h.trim().toLowerCase());
	const index = Object.fromEntries(COLUMNS.map((column) => [column, header.indexOf(column)])) as Record<(typeof COLUMNS)[number], number>;
	if (COLUMNS.every((column) => index[column] === -1)) {
		return { rows: [], errors: [{ line: 1, reason: `el encabezado no tiene ninguna columna conocida (${COLUMNS.join(", ")})` }] };
	}
	const body = lines.slice(1).map((line, i) => ({ line: i + 2, text: line })).filter((l) => l.text.trim());
	if (body.length > MAX_CSV_ROWS) {
		return { rows: [], errors: [{ line: 1, reason: `el CSV tiene ${body.length} filas; el máximo por carga es ${MAX_CSV_ROWS}` }] };
	}

	const rows: CsvContactRow[] = [];
	const errors: Array<{ line: number; reason: string }> = [];
	for (const { line, text: raw } of body) {
		const cells = splitLine(raw);
		if (!cells) {
			errors.push({ line, reason: "comillas sin cerrar" });
			continue;
		}
		const get = (column: (typeof COLUMNS)[number]) => (index[column] === -1 ? null : clean(cells[index[column]]));
		const rawEmail = get("email");
		const email = normalizeEmail(rawEmail);
		if (rawEmail && !email) errors.push({ line, reason: `email inválido: "${rawEmail}"` });
		rows.push({
			line,
			name: get("name"),
			email,
			linkedinUrl: get("linkedin_url"),
			company: get("company"),
			domain: normalizeDomain(get("domain")) ?? (email ? domainFromEmail(email) : null),
			segment: get("segment"),
			vector: get("vector"),
		});
	}
	return { rows, errors };
}
```

`lib/outreach/ficha.ts`:

```ts
// Ficha de research por cuenta (spec 03 §6.3). Todo hecho con URL.
import { z } from "zod";
import { normalizeDomain } from "./domain";

export const FICHA_TTL_DAYS = 90;

export const fichaSchema = z.object({
	name: z.string().trim().min(1).max(300),
	domain: z.string().trim().min(3).max(300),
	produce: z.string().nullable(),
	gana: z.string().nullable(),
	compra: z.string().nullable(),
	rompe_si_crece: z.string().nullable(),
	gap_declarado: z.string().nullable(),
	gap_demostrable: z.string().nullable(),
	hechos: z
		.array(z.object({ hecho: z.string().trim().min(1).max(500), url: z.string().trim(), fecha: z.string().nullable() }))
		.max(30),
	creditos_usados: z.number().int().min(0),
});

export type Ficha = z.infer<typeof fichaSchema>;

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function sanitizeFicha(ficha: Ficha): Ficha {
	return {
		...ficha,
		domain: normalizeDomain(ficha.domain) ?? ficha.domain,
		hechos: ficha.hechos.filter((hecho) => isHttpUrl(hecho.url)),
	};
}

export function fichaExpiresAt(researchedAt: Date): Date {
	return new Date(researchedAt.getTime() + FICHA_TTL_DAYS * 86_400_000);
}

export function isFichaVigente(expiresAt: Date, now: Date): boolean {
	return expiresAt.getTime() > now.getTime();
}
```

`lib/outreach/classify.ts`:

```ts
// Clasificación de respuestas del sweep (spec 03 §8.2).
import { z } from "zod";
import type { OutreachStage } from "./stage";

export const REPLY_CATEGORIES = ["no_interesado", "respuesta_neutra", "en_conversacion", "reunion_agendada"] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

export const replyClassificationSchema = z.object({
	categoria: z.enum(REPLY_CATEGORIES),
	resumen: z.string().trim().min(1).max(500),
	cita: z.string().trim().min(1).max(4000),
});

export function stageForReply(category: ReplyCategory): OutreachStage {
	return category;
}

export function wantsDeal(category: ReplyCategory): boolean {
	return category === "en_conversacion" || category === "reunion_agendada";
}
```

`lib/outreach/events.ts`:

```ts
// Tipos de evento de outreach (spec 03 §4.7). Genéricos para cualquier tenant.
export const OUTREACH_EVENT_TYPES = [
	"contacto_importado", "investigado", "encolado", "gate_fallido", "pieza_editada",
	"rechazado", "aprobado", "envio", "envio_fallido", "rebote", "respuesta",
	"cambio_etapa", "claim_ajeno", "deal_creado", "oportunidad_frenada",
	"crm_sync_pendiente", "crm_sync_ok", "freno", "nota",
] as const;

export type OutreachEventType = (typeof OUTREACH_EVENT_TYPES)[number];

/** Los únicos que el modelo puede registrar con log_event. */
export const MODEL_LOGGABLE_EVENT_TYPES = ["freno", "nota"] as const satisfies readonly OutreachEventType[];

export interface OutreachEventInsert {
	tenant_id: string;
	actor_user_id: string | null;
	contact_key: string | null;
	channel: "email" | null;
	type: OutreachEventType;
	summary: string;
	payload: Record<string, unknown>;
	run_id: string | null;
}

export function outreachEvent(
	input: Omit<OutreachEventInsert, "channel" | "run_id"> & { channel?: "email" | null; run_id?: string | null },
): OutreachEventInsert {
	if (!(OUTREACH_EVENT_TYPES as readonly string[]).includes(input.type)) {
		throw new Error(`tipo de evento de outreach desconocido: "${input.type}"`);
	}
	return {
		tenant_id: input.tenant_id,
		actor_user_id: input.actor_user_id,
		contact_key: input.contact_key,
		channel: input.channel === undefined ? "email" : input.channel,
		type: input.type,
		summary: input.summary.trim().slice(0, 500),
		payload: input.payload,
		run_id: input.run_id ?? null,
	};
}
```

`lib/outreach/queue-letters.ts`:

```ts
// Letras de la cola por letras del canon: A, B, …, Z, AA, AB…
function letter(index: number): string {
	let n = index + 1;
	let out = "";
	while (n > 0) {
		const rest = (n - 1) % 26;
		out = String.fromCharCode(65 + rest) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

export function assignLetters<T extends { created_at: string }>(items: T[]): Array<T & { letter: string }> {
	return [...items]
		.sort((a, b) => a.created_at.localeCompare(b.created_at))
		.map((item, index) => ({ ...item, letter: letter(index) }));
}
```

- [ ] **Step 4: Correr tests, lint y typecheck**

Run: `npm test -- tests/outreach && npm run lint:fix && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/domain.ts lib/outreach/csv.ts lib/outreach/ficha.ts lib/outreach/classify.ts lib/outreach/events.ts lib/outreach/queue-letters.ts tests/outreach/csv.test.ts tests/outreach/ficha.test.ts tests/outreach/records.test.ts
git commit -m "feat: módulos de datos de outreach (CSV, ficha, clasificación, eventos, cola)"
```

### Task 13: Configuración de outreach por tenant

**Files:**
- Create: `lib/outreach/config.ts`, `scripts/outreach-config-args.ts`, `scripts/outreach-config.mts`, `tenants/innovas/outreach.json`
- Modify: `package.json` (script `outreach:config`)
- Test: `tests/outreach/config.test.ts`, `tests/scripts/outreach-config-args.test.ts`

**Interfaces:**
- Consumes: `GATE_IDIOMAS` (Task 10), solo en el test.
- Produces: `DEFAULT_OUTREACH_MODELS`, `type OutreachModelRole`, `type OutreachConfig`, `parseOutreachConfig(raw: unknown): OutreachConfig`, `SUPPORTED_IDIOMAS = ["es_ar", "es_es"] as const`, `outreachFileSchema`, `type OutreachFile`, `type ConfigValueKind`, `interface ConfigValueRow { id: string; kind: ConfigValueKind; value: string; label: string; active: boolean; meta: Record<string, unknown> }`, `interface ConfigValuesPlan { upserts: Array<{ kind: ConfigValueKind; value: string; label: string; meta: Record<string, unknown> }>; deactivate: ConfigValueRow[]; unchanged: number }`, `planConfigValues(current: ConfigValueRow[], file: OutreachFile): ConfigValuesPlan`. `config.ts` solo importa `zod`: lo importa un script de Node.

- [ ] **Step 1: Tests que fallan**

`tests/outreach/config.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type ConfigValueRow,
	DEFAULT_OUTREACH_MODELS,
	outreachFileSchema,
	parseOutreachConfig,
	planConfigValues,
	SUPPORTED_IDIOMAS,
} from "@/lib/outreach/config";
import { GATE_IDIOMAS } from "@/lib/outreach/gate";

const file = {
	config: { bcc: null, deal: null },
	values: {
		segmento: [{ value: "mid_market_ar", label: "Mid market AR" }],
		hook: [{ value: "h_uno", label: "Uno" }],
		vector: [{ value: "v1", label: "Vector 1", default_hook: "h_uno" }],
		idioma: [{ value: "es_ar", label: "Español rioplatense" }],
	},
};

describe("parseOutreachConfig", () => {
	it("completa defaults y deja override de modelos por tenant", () => {
		const config = parseOutreachConfig({ models: { classify: "anthropic/claude-sonnet-5" } });
		expect(config).toEqual({
			timezone: "America/Argentina/Buenos_Aires",
			bcc: null,
			deal: null,
			models: { ...DEFAULT_OUTREACH_MODELS, classify: "anthropic/claude-sonnet-5" },
		});
		expect(parseOutreachConfig(undefined).models).toEqual(DEFAULT_OUTREACH_MODELS);
	});
	it("rechaza una zona horaria que no existe", () => {
		expect(() => parseOutreachConfig({ timezone: "Marte/Olympus" })).toThrow();
	});
	it("los idiomas soportados coinciden con los del gate", () => {
		expect([...SUPPORTED_IDIOMAS]).toEqual([...GATE_IDIOMAS]);
	});
});

describe("outreachFileSchema", () => {
	it("acepta el archivo de innovas", () => {
		const raw = JSON.parse(readFileSync("tenants/innovas/outreach.json", "utf8"));
		expect(() => outreachFileSchema.parse(raw)).not.toThrow();
	});
	it("rechaza un vector con hook default que no está en la lista", () => {
		const bad = { ...file, values: { ...file.values, vector: [{ value: "v1", label: "V", default_hook: "h_nada" }] } };
		expect(() => outreachFileSchema.parse(bad)).toThrow('el hook "h_nada" no está en values.hook');
	});
	it("rechaza valores repetidos y idiomas que el gate no soporta", () => {
		const repeated = { ...file, values: { ...file.values, hook: [{ value: "h_uno", label: "A" }, { value: "h_uno", label: "B" }] } };
		expect(() => outreachFileSchema.parse(repeated)).toThrow('valor repetido en values.hook: "h_uno"');
		const english = { ...file, values: { ...file.values, idioma: [{ value: "en", label: "Inglés" }] } };
		expect(() => outreachFileSchema.parse(english)).toThrow();
	});
});

describe("planConfigValues", () => {
	const row = (kind: ConfigValueRow["kind"], value: string, label: string, meta: Record<string, unknown> = {}, active = true): ConfigValueRow => ({
		id: `${kind}-${value}`, kind, value, label, active, meta,
	});

	it("inserta lo nuevo, actualiza lo cambiado o inactivo, desactiva lo que salió del archivo", () => {
		const parsed = outreachFileSchema.parse(file);
		const plan = planConfigValues(
			[
				row("segmento", "mid_market_ar", "Mid market AR"),
				row("hook", "h_uno", "Uno viejo"),
				row("vector", "v1", "Vector 1", { default_hook: "h_uno" }, false),
				row("hook", "h_viejo", "Viejo"),
				row("hook", "h_ya_inactivo", "Inactivo", {}, false),
			],
			parsed,
		);
		expect(plan.upserts).toEqual([
			{ kind: "hook", value: "h_uno", label: "Uno", meta: {} },
			{ kind: "vector", value: "v1", label: "Vector 1", meta: { default_hook: "h_uno" } },
			{ kind: "idioma", value: "es_ar", label: "Español rioplatense", meta: {} },
		]);
		expect(plan.deactivate.map((r) => r.value)).toEqual(["h_viejo"]);
		expect(plan.unchanged).toBe(1);
	});
});
```

`tests/scripts/outreach-config-args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseOutreachConfigArgs } from "@/scripts/outreach-config-args";

describe("parseOutreachConfigArgs", () => {
	it("por default solo muestra el plan", () => {
		expect(parseOutreachConfigArgs(["--tenant", "innovas"])).toEqual({ tenant: "innovas", apply: false });
	});
	it("--apply escribe", () => {
		expect(parseOutreachConfigArgs(["--tenant", "innovas", "--apply"])).toEqual({ tenant: "innovas", apply: true });
	});
	it("exige un slug válido", () => {
		expect(() => parseOutreachConfigArgs([])).toThrow("falta --tenant <slug>");
		expect(() => parseOutreachConfigArgs(["--tenant", "../etc"])).toThrow('slug de tenant inválido: "../etc"');
	});
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/outreach/config.test.ts tests/scripts/outreach-config-args.test.ts`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: `lib/outreach/config.ts`**

```ts
// Configuración de outreach por tenant (spec 03 §4.3 y §4.8). Solo importa
// zod: lo usa scripts/outreach-config.mts con type stripping de Node.
import { z } from "zod";

export const DEFAULT_OUTREACH_MODELS = {
	draft_msg1: "anthropic/claude-opus-5",
	draft_followup: "anthropic/claude-sonnet-5",
	classify: "anthropic/claude-haiku-4.5",
	researcher: "anthropic/claude-haiku-4.5",
} as const;

export type OutreachModelRole = keyof typeof DEFAULT_OUTREACH_MODELS;

// Debe coincidir con GATE_IDIOMAS de gate.ts (hay test). No se importa porque
// gate.ts usa imports sin extensión que Node no resuelve desde un script.
export const SUPPORTED_IDIOMAS = ["es_ar", "es_es"] as const;

const modelId = z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+$/);

function isTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("es-AR", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

export const outreachConfigSchema = z.object({
	timezone: z.string().refine(isTimeZone, "zona horaria inválida").default("America/Argentina/Buenos_Aires"),
	bcc: z.email().nullable().default(null),
	deal: z.object({ pipeline: z.string().min(1), stage: z.string().min(1) }).nullable().default(null),
	models: z
		.object({ draft_msg1: modelId, draft_followup: modelId, classify: modelId, researcher: modelId })
		.partial()
		.default({}),
});

export type OutreachConfig = Omit<z.infer<typeof outreachConfigSchema>, "models"> & {
	models: Record<OutreachModelRole, string>;
};

export function parseOutreachConfig(raw: unknown): OutreachConfig {
	const parsed = outreachConfigSchema.parse(raw ?? {});
	return { ...parsed, models: { ...DEFAULT_OUTREACH_MODELS, ...parsed.models } };
}

const VALUE = /^[a-z0-9][a-z0-9_]{0,60}$/;
const valueSchema = z.object({ value: z.string().regex(VALUE), label: z.string().trim().min(1).max(200) });

export const outreachFileSchema = z
	.object({
		config: outreachConfigSchema,
		values: z.object({
			segmento: z.array(valueSchema).min(1),
			hook: z.array(valueSchema).min(1),
			vector: z.array(valueSchema.extend({ default_hook: z.string().regex(VALUE).nullable() })).min(1),
			idioma: z.array(valueSchema.extend({ value: z.enum(SUPPORTED_IDIOMAS) })).min(1),
		}),
	})
	.superRefine((file, ctx) => {
		for (const [kind, list] of Object.entries(file.values)) {
			const seen = new Set<string>();
			for (const item of list) {
				if (seen.has(item.value)) {
					ctx.addIssue({ code: "custom", path: ["values", kind], message: `valor repetido en values.${kind}: "${item.value}"` });
				}
				seen.add(item.value);
			}
		}
		const hooks = new Set(file.values.hook.map((hook) => hook.value));
		for (const vector of file.values.vector) {
			if (vector.default_hook && !hooks.has(vector.default_hook)) {
				ctx.addIssue({ code: "custom", path: ["values", "vector"], message: `el hook "${vector.default_hook}" no está en values.hook` });
			}
		}
	});

export type OutreachFile = z.infer<typeof outreachFileSchema>;
export type ConfigValueKind = "segmento" | "vector" | "hook" | "idioma";

export interface ConfigValueRow {
	id: string;
	kind: ConfigValueKind;
	value: string;
	label: string;
	active: boolean;
	meta: Record<string, unknown>;
}

export interface ConfigValuesPlan {
	upserts: Array<{ kind: ConfigValueKind; value: string; label: string; meta: Record<string, unknown> }>;
	deactivate: ConfigValueRow[];
	unchanged: number;
}

const KINDS: ConfigValueKind[] = ["segmento", "hook", "vector", "idioma"];

export function planConfigValues(current: ConfigValueRow[], file: OutreachFile): ConfigValuesPlan {
	const byKey = new Map(current.map((row) => [`${row.kind}:${row.value}`, row]));
	const wanted = new Set<string>();
	const plan: ConfigValuesPlan = { upserts: [], deactivate: [], unchanged: 0 };

	for (const kind of KINDS) {
		for (const item of file.values[kind]) {
			const meta: Record<string, unknown> =
				kind === "vector" && "default_hook" in item ? { default_hook: item.default_hook } : {};
			const key = `${kind}:${item.value}`;
			wanted.add(key);
			const existing = byKey.get(key);
			if (existing?.active && existing.label === item.label && JSON.stringify(existing.meta) === JSON.stringify(meta)) {
				plan.unchanged++;
			} else {
				plan.upserts.push({ kind, value: item.value, label: item.label, meta });
			}
		}
	}
	for (const row of current) {
		if (row.active && !wanted.has(`${row.kind}:${row.value}`)) plan.deactivate.push(row);
	}
	return plan;
}
```

- [ ] **Step 4: Args del script**

`scripts/outreach-config-args.ts`:

```ts
export interface OutreachConfigArgs {
	tenant: string;
	apply: boolean;
}

export function parseOutreachConfigArgs(argv: string[]): OutreachConfigArgs {
	const index = argv.indexOf("--tenant");
	const tenant = index === -1 ? null : argv[index + 1];
	if (!tenant || tenant.startsWith("--")) throw new Error("falta --tenant <slug>");
	if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) throw new Error(`slug de tenant inválido: "${tenant}"`);
	return { tenant, apply: argv.includes("--apply") };
}
```

- [ ] **Step 5: Correr tests del plan y de args** (el test de `tenants/innovas/outreach.json` sigue fallando hasta el Step 6)

Run: `npm test -- tests/outreach/config.test.ts tests/scripts/outreach-config-args.test.ts`
Expected: PASS salvo "acepta el archivo de innovas" (ENOENT).

- [ ] **Step 6: `tenants/innovas/outreach.json`**

Valores del canon (`brain/comercial/outreach/23-vectores.md`, `22-redaccion.md`, `24-atribucion.md`, `21-crm.md`). Son las opciones de las propiedades de enumeración que ya existen en el HubSpot de Innovas: no cambiar un `value` sin cambiarlo allá.

```json
{
	"config": {
		"timezone": "America/Argentina/Buenos_Aires",
		"bcc": "51464889@bcc.hubspot.com",
		"deal": { "pipeline": "default", "stage": "1404975950" }
	},
	"values": {
		"segmento": [
			{ "value": "mid_market_ar", "label": "Mid market Argentina" },
			{ "value": "mid_market_es", "label": "Mid market España" },
			{ "value": "organismos", "label": "Organismos" },
			{ "value": "sin_atribucion", "label": "Sin atribución" }
		],
		"hook": [
			{ "value": "h_crecer_sin_duplicar", "label": "Crecer sin duplicar" },
			{ "value": "h_metodo_en_la_cabeza", "label": "El método en la cabeza" },
			{ "value": "h_competidor_digitalizado", "label": "Competidor digitalizado" },
			{ "value": "h_ola_no_powerpoint", "label": "Ola, no PowerPoint" },
			{ "value": "h_sin_anticipos", "label": "Sin anticipos" },
			{ "value": "h_radar_1500", "label": "Radar 1500" },
			{ "value": "h_ejecucion_organismos", "label": "Ejecución en organismos" }
		],
		"vector": [
			{ "value": "v0_red_tibia", "label": "Red tibia: conexiones aceptadas con pertenencia", "default_hook": "h_crecer_sin_duplicar" },
			{ "value": "v1_familiar_2gen_ar", "label": "Empresa familiar de segunda o tercera generación, Argentina", "default_hook": "h_metodo_en_la_cabeza" },
			{ "value": "v2_dolor_reciente_ar", "label": "Dolor reciente: perdió una licitación o un cliente grande", "default_hook": "h_competidor_digitalizado" },
			{ "value": "v3_evento_capital_ar", "label": "Evento de capital: ronda, expansión o cambio de gerencia", "default_hook": "h_crecer_sin_duplicar" },
			{ "value": "v4_pyme_es", "label": "Pyme española del mismo perfil", "default_hook": "h_metodo_en_la_cabeza" },
			{ "value": "v5_organismos", "label": "TTL y task managers de BM, BID y FAO", "default_hook": "h_ejecucion_organismos" },
			{ "value": "v6_relacion_directa", "label": "Relación previa directa del ejecutor con el decisor", "default_hook": null },
			{ "value": "v7_seller_meli_ar", "label": "Tienda oficial en Mercado Libre Argentina con operación propia", "default_hook": "h_crecer_sin_duplicar" }
		],
		"idioma": [
			{ "value": "es_ar", "label": "Español rioplatense" },
			{ "value": "es_es", "label": "Español peninsular" }
		]
	}
}
```

Antes de commitear, confirmar con el usuario los rótulos (los `value` salen del canon; los `label` son redacción nuestra) y el valor de `h_radar_1500` contra `22-redaccion.md`.

- [ ] **Step 7: Script**

`scripts/outreach-config.mts`:

```ts
// Carga de listas y configuración de outreach de un tenant (spec 03 §4.3).
// Sin --apply solo muestra el plan. Uso:
//   npm run outreach:config -- --tenant innovas [--apply]
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { type ConfigValueRow, outreachFileSchema, planConfigValues } from "../lib/outreach/config.ts";
import { parseOutreachConfigArgs } from "./outreach-config-args.ts";

async function main(): Promise<void> {
	const args = parseOutreachConfigArgs(process.argv.slice(2));
	const file = outreachFileSchema.parse(
		JSON.parse(await readFile(`tenants/${args.tenant}/outreach.json`, "utf8")),
	);

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
	const admin = createClient(url, key, { auth: { persistSession: false } });

	const { data: tenant, error: tenantError } = await admin.from("tenants").select("id").eq("slug", args.tenant).maybeSingle();
	if (tenantError) throw new Error(`no pude leer el tenant: ${tenantError.message}`);
	if (!tenant) throw new Error(`no existe el tenant "${args.tenant}"`);

	const { data: agentRow, error: agentError } = await admin
		.from("tenant_agents")
		.select("config")
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach")
		.maybeSingle();
	if (agentError) throw new Error(`no pude leer tenant_agents: ${agentError.message}`);
	if (!agentRow) throw new Error(`el tenant "${args.tenant}" no tiene el agente outreach en tenant_agents`);

	const { data: rows, error: rowsError } = await admin
		.from("config_values")
		.select("id, kind, value, label, active, meta")
		.eq("tenant_id", tenant.id);
	if (rowsError) throw new Error(`no pude leer config_values: ${rowsError.message}`);

	const plan = planConfigValues((rows ?? []) as ConfigValueRow[], file);
	for (const item of plan.upserts) console.log(`+ ${item.kind} ${item.value} (${item.label})`);
	for (const row of plan.deactivate) console.log(`- ${row.kind} ${row.value} (se desactiva)`);
	console.log(`= ${plan.unchanged} sin cambios`);
	const currentConfig = (agentRow.config ?? {}) as Record<string, unknown>;
	console.log(`config.outreach: ${JSON.stringify(currentConfig.outreach ?? null)} → ${JSON.stringify(file.config)}`);

	if (!args.apply) {
		console.log("plan solamente: corré de nuevo con --apply para escribir");
		return;
	}

	const now = new Date().toISOString();
	if (plan.upserts.length > 0) {
		const { error } = await admin.from("config_values").upsert(
			plan.upserts.map((item) => ({ tenant_id: tenant.id, ...item, active: true, updated_at: now })),
			{ onConflict: "tenant_id,kind,value" },
		);
		if (error) throw new Error(`no pude guardar config_values: ${error.message}`);
	}
	if (plan.deactivate.length > 0) {
		const { error } = await admin
			.from("config_values")
			.update({ active: false, updated_at: now })
			.in("id", plan.deactivate.map((row) => row.id));
		if (error) throw new Error(`no pude desactivar config_values: ${error.message}`);
	}
	const { error: configError } = await admin
		.from("tenant_agents")
		.update({ config: { ...currentConfig, outreach: file.config } })
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach");
	if (configError) throw new Error(`no pude guardar tenant_agents.config: ${configError.message}`);

	const { error: eventError } = await admin.from("events").insert({
		tenant_id: tenant.id,
		type: "outreach.config_applied",
		summary: `${plan.upserts.length} altas o cambios, ${plan.deactivate.length} bajas`,
		payload: { upserts: plan.upserts.length, deactivated: plan.deactivate.length, actor: `script:${userInfo().username}` },
	});
	if (eventError) throw new Error(`la configuración quedó guardada pero no el evento: ${eventError.message}`);
	console.log("listo");
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
```

En `package.json`, junto a `connections:bind`:

```json
"outreach:config": "node --env-file=.env.local scripts/outreach-config.mts",
```

- [ ] **Step 8: Correr tests, typecheck y el plan contra la base local**

Run: `npm test -- tests/outreach/config.test.ts tests/scripts/outreach-config-args.test.ts && npm run typecheck`
Expected: PASS.

Si la base local tiene el tenant `innovas` con `tenant_agents` de outreach, y `.env.local` apunta a la base local (no a producción: revisar `NEXT_PUBLIC_SUPABASE_URL` antes), correr `npm run outreach:config -- --tenant innovas` y verificar que imprime el plan sin escribir. **Nunca `--apply` contra producción desde un agente**: eso lo corre el usuario en la Entrega 5.

- [ ] **Step 9: Commit**

```bash
git add lib/outreach/config.ts scripts/outreach-config-args.ts scripts/outreach-config.mts tenants/innovas/outreach.json package.json tests/outreach/config.test.ts tests/scripts/outreach-config-args.test.ts
git commit -m "feat: configuración de outreach por tenant y script de carga"
```

### Task 14: Ejecutores y propiedades de atribución

**Files:**
- Create: `scripts/executors-set-args.ts`, `scripts/executors-set.mts`
- Modify: `package.json` (script `executors:set`), `lib/connectors/crm/hubspot.ts`
- Test: `tests/scripts/executors-set-args.test.ts`, `tests/connectors/hubspot.test.ts`

**Interfaces:**
- Produces: `parseExecutorsSetArgs(argv: string[]): { tenant: string; email: string; slug: string; crmOwnerId: string | null }`; `OUTREACH_PROPERTIES` con 10 entradas (suma `outreach_vector` y `outreach_idioma`).

- [ ] **Step 1: Tests que fallan**

`tests/scripts/executors-set-args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseExecutorsSetArgs } from "@/scripts/executors-set-args";

describe("parseExecutorsSetArgs", () => {
	it("lee tenant, email, slug y owner del CRM", () => {
		expect(
			parseExecutorsSetArgs(["--tenant", "innovas", "--email", "Ana@Acme.test", "--slug", "ana", "--crm-owner-id", "123"]),
		).toEqual({ tenant: "innovas", email: "ana@acme.test", slug: "ana", crmOwnerId: "123" });
	});
	it("el owner del CRM es opcional", () => {
		expect(parseExecutorsSetArgs(["--tenant", "innovas", "--email", "ana@acme.test", "--slug", "ana"]).crmOwnerId).toBeNull();
	});
	it("valida cada campo", () => {
		expect(() => parseExecutorsSetArgs(["--email", "ana@acme.test", "--slug", "ana"])).toThrow("falta --tenant <slug>");
		expect(() => parseExecutorsSetArgs(["--tenant", "innovas", "--email", "ana", "--slug", "ana"])).toThrow('email inválido: "ana"');
		expect(() => parseExecutorsSetArgs(["--tenant", "innovas", "--email", "ana@acme.test", "--slug", "Ana López"])).toThrow('slug de ejecutor inválido: "Ana López"');
	});
});
```

En `tests/connectors/hubspot.test.ts`: cambiar `toHaveLength(8)` por `toHaveLength(10)` (y el título "las 8 propiedades" por "las 10 propiedades") y `toHaveLength(7)` por `toHaveLength(9)`, y sumar dentro de `describe("ensureOutreachProperties", ...)`:

```ts
	it("incluye vector e idioma, las dos propiedades que suma la Etapa 3", () => {
		const names = OUTREACH_PROPERTIES.map((p) => p.name);
		expect(names).toContain("outreach_vector");
		expect(names).toContain("outreach_idioma");
	});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- tests/scripts/executors-set-args.test.ts tests/connectors/hubspot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementación**

En `lib/connectors/crm/hubspot.ts`, dentro de `OUTREACH_PROPERTIES`, después de `outreach_hook`:

```ts
	{
		name: "outreach_vector",
		label: "Outreach · vector",
		type: "string",
		fieldType: "text",
	},
	{
		name: "outreach_idioma",
		label: "Outreach · idioma",
		type: "string",
		fieldType: "text",
	},
```

(En el HubSpot de Innovas ya existen como enumeración, así que `ensureOutreachProperties` las encuentra y no las crea; para un tenant nuevo nacen como texto.)

`scripts/executors-set-args.ts`:

```ts
export interface ExecutorsSetArgs {
	tenant: string;
	email: string;
	slug: string;
	crmOwnerId: string | null;
}

function flag(argv: string[], name: string): string | null {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return null;
	const value = argv[index + 1];
	return value && !value.startsWith("--") ? value : null;
}

export function parseExecutorsSetArgs(argv: string[]): ExecutorsSetArgs {
	const tenant = flag(argv, "tenant");
	if (!tenant) throw new Error("falta --tenant <slug>");
	const rawEmail = flag(argv, "email");
	if (!rawEmail) throw new Error("falta --email <email del usuario>");
	const email = rawEmail.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`email inválido: "${rawEmail}"`);
	const slug = flag(argv, "slug");
	if (!slug) throw new Error("falta --slug <slug del ejecutor>");
	if (!/^[a-z][a-z0-9-]{0,30}$/.test(slug)) throw new Error(`slug de ejecutor inválido: "${slug}"`);
	return { tenant, email, slug, crmOwnerId: flag(argv, "crm-owner-id") };
}
```

`scripts/executors-set.mts`:

```ts
// Alta o actualización de un ejecutor de outreach (spec 03 §12.1). Uso:
//   npm run executors:set -- --tenant innovas --email ana@acme.test --slug ana [--crm-owner-id 123]
import { userInfo } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { parseExecutorsSetArgs } from "./executors-set-args.ts";

async function main(): Promise<void> {
	const args = parseExecutorsSetArgs(process.argv.slice(2));
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
	const admin = createClient(url, key, { auth: { persistSession: false } });

	const { data: tenant, error: tenantError } = await admin.from("tenants").select("id").eq("slug", args.tenant).maybeSingle();
	if (tenantError) throw new Error(`no pude leer el tenant: ${tenantError.message}`);
	if (!tenant) throw new Error(`no existe el tenant "${args.tenant}"`);

	let userId: string | null = null;
	for (let page = 1; !userId; page++) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
		if (error) throw new Error(`no pude listar usuarios: ${error.message}`);
		userId = data.users.find((user) => user.email?.toLowerCase() === args.email)?.id ?? null;
		if (data.users.length < 200) break;
	}
	if (!userId) throw new Error(`no existe un usuario con el email ${args.email}: invitarlo primero`);

	const { data: membership, error: membershipError } = await admin
		.from("memberships")
		.select("role")
		.eq("tenant_id", tenant.id)
		.eq("user_id", userId)
		.maybeSingle();
	if (membershipError) throw new Error(`no pude leer la membership: ${membershipError.message}`);
	if (!membership) throw new Error(`${args.email} no es miembro de ${args.tenant}`);

	const { error: upsertError } = await admin.from("executors").upsert(
		{
			tenant_id: tenant.id,
			user_id: userId,
			slug: args.slug,
			...(args.crmOwnerId ? { crm_owner_id: args.crmOwnerId } : {}),
		},
		{ onConflict: "tenant_id,user_id" },
	);
	if (upsertError) {
		throw new Error(
			upsertError.code === "23505"
				? `el slug "${args.slug}" ya lo usa otro ejecutor de ${args.tenant}`
				: `no pude guardar el ejecutor: ${upsertError.message}`,
		);
	}

	const { error: eventError } = await admin.from("events").insert({
		tenant_id: tenant.id,
		type: "executor.updated",
		summary: `${args.slug} (${args.email})`,
		payload: { user_id: userId, slug: args.slug, crm_owner_id: args.crmOwnerId, actor: `script:${userInfo().username}` },
	});
	if (eventError) throw new Error(`el ejecutor quedó guardado pero no el evento: ${eventError.message}`);
	console.log(`listo: ${args.slug} es ejecutor de ${args.tenant}`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
```

En `package.json`:

```json
"executors:set": "node --env-file=.env.local scripts/executors-set.mts",
```

- [ ] **Step 4: Correr la suite completa**

Run: `npm test && npm run typecheck && npm run lint:fix`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/executors-set-args.ts scripts/executors-set.mts package.json lib/connectors/crm/hubspot.ts tests/scripts/executors-set-args.test.ts tests/connectors/hubspot.test.ts
git commit -m "feat: alta de ejecutores de outreach y propiedades de vector e idioma"
```

### Cierre de la Entrega 2

- [ ] `npm test`, `npm run typecheck`, `npm run db:test` en verde (confirmando antes que la base local está libre).
- [ ] PR de la Entrega 2 con `/ship`. La migración a producción (`npx supabase db push`) la corre el usuario cuando se mergee.

---

## Entregas 3 a 5 · Alcance e interfaces

Se detallan en la Task 6, con los spikes resueltos. Lo que sigue es el contrato que esas tasks tienen que respetar; no son pasos.

### Entrega 3 · Agente de primer toque (spec §6, §7, §9, §11.2)

| Pieza | Archivo | Depende de |
|---|---|---|
| `CrmAdapter` + implementación HubSpot | `lib/connectors/crm/adapter.ts`, `lib/connectors/crm/hubspot.ts` | S6 |
| Lectura de canon, vetos y voz desde el brain | `lib/outreach/canon.ts` (usa `lib/brain/resolve.ts` y `parseGateBlocks`) | Entrega 2 |
| Prompt de redacción | `lib/outreach/prompt.ts` | S3 |
| Hoy del ejecutor en su zona horaria | `lib/outreach/time.ts` | Entrega 2 |
| Instrucciones | `agents/outreach/instructions.md`, `agents/outreach/instructions/tenant.ts` | — |
| Skills | `agents/outreach/skills/outreach-{corrida,redaccion,crm,escucha}/SKILL.md` | — |
| Subagente | `agents/outreach/subagents/researcher/` | S4 |
| Tools | `agents/outreach/tools/{import_contacts,research_account,draft_message,queue_touch,list_queue,update_queue_item,reject_queue_item,crm_upsert_contact,log_event}.ts` | S3, S4, S6 |
| `send_email` sobre la cola | `agents/outreach/tools/send_email.ts`, `lib/gmail/mime.ts` (Message-ID, In-Reply-To, References), `lib/gmail/send.ts` | S2 |
| Evals | `agents/outreach/evals/` | S7 |

Contratos fijos: toda tool devuelve `{ ok: false, reason: string, ... }` ante un guard (spec D13); `send_email` recibe `{ queueItemId, to, subject, body }` y devuelve `pieza_cambiada` si difieren de la fila; `queue_touch` vuelve a correr `runGate`; `draft_message` no escribe en la base.

### Entrega 4 · Escucha y follow-ups (spec §8)

| Pieza | Archivo | Depende de |
|---|---|---|
| Scopes de Gmail y hook | `agents/outreach/tools/send_email.ts`, `agents/outreach/hooks/executors.ts`, `lib/connectors/executors.ts` | S2 |
| Lectura de Gmail | `lib/gmail/read.ts` (threads, búsqueda, rebotes) | S2 |
| Lógica de escucha | `lib/outreach/listen.ts` (I/O inyectado) | S1, S3 |
| Tool de chat | `agents/outreach/tools/read_replies.ts` | — |
| Schedules | `agents/outreach/schedules/morning-sweep.ts`, `agents/outreach/schedules/followups.ts` | S1, S5 |
| Resumen de sesión | `agents/outreach/instructions/tenant.ts` | — |

Contratos fijos: lock por `runs.schedule_key`; un ejecutor que falla no frena a los demás; una respuesta duplicada (`23505` en `events_inbound_message_idx`) se trata como ya registrada, no como error; los schedules nunca envían.

### Entrega 5 · Piloto contra producción (spec §12.1, §1)

Guiada con el usuario, como la Task 14 de la Etapa 2: `db push`, pantalla de consentimiento de Google, `executors:set` para cada ejecutor, voz y `canon:gate` en el brain, `outreach:config --apply`, `crm_setup_outreach_properties`, autorizaciones, piloto de 5 contactos y los cinco criterios de cierre. Al final, roadmap y spec actualizados con el resultado.

