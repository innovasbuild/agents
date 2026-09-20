# Etapa 5 · Escucha y follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una respuesta real en Gmail mueva el contacto sin intervención, y que un follow-up vencido aparezca en `/cola` a la mañana.

**Architecture:** Dos schedules de eve en forma `run` (handler determinista) que barren Gmail por tenant y ejecutor, registran los hechos en la base, y solo abren una sesión del agente cuando hay algo que interpretar. El grueso de la lógica vive en funciones puras (`lib/outreach/listen.ts`, `reconcile.ts`, `lib/gmail/read.ts`) testeadas con TDD; los schedules son orquestación con dependencias inyectadas.

**Tech Stack:** eve 0.54.2 (`defineSchedule`, forma `run`), Next.js App Router con `withEve`, Supabase (RLS para leer, service role para escribir), Vercel Cron, Gmail API v1, vitest, zod.

**Spec:** `docs/superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md`

## Global Constraints

- Español rioplatense en UI, mensajes y comentarios. Código e identificadores en inglés.
- **Los schedules nunca envían mail.** Encolan piezas `pending`; el envío lo dispara una persona desde `/cola`.
- **Ningún `tokenForSubject` sin `issuer`.** La firma real es `tokenForSubject(connector, { tenantId, userId, issuer }, scopes?)` — el `issuer` va dentro del subject, no como cuarto argumento.
- Un ejecutor que falla no frena a los demás. Un tenant que falla no frena a los otros.
- Una respuesta duplicada (`23505` o insert descartado) cuenta como ya registrada. `OutreachStore.insertEvents` ya implementa ese contrato.
- Lock por `runs.schedule_key`, una vez por corrida, no por tenant.
- `events` es append-only. Nunca UPDATE ni DELETE.
- **Modelos de runtime**: se leen de `DEFAULT_OUTREACH_MODELS` en `lib/outreach/config.ts`, con override por tenant en `tenants/<slug>/outreach.json`. Nunca hardcodear un id de modelo en una tool o schedule. Para esta etapa: `classify` → `anthropic/claude-haiku-4.5`, `draft_followup` → `anthropic/claude-sonnet-5`. **El id de Haiku lleva punto, no guión** — ya hubo una migración (`20260912231059_fix_haiku_model_id.sql`) para arreglar exactamente ese error.
- La reconciliación solo **confirma** envíos que puede probar. Nunca reencola, nunca reintenta.
- Comandos: `npm run typecheck` · `npm test` · `npm run lint:fix`.
- `npm run lint:fix` corre biome sobre todo el repo y reformatea siempre los mismos 4 archivos ajenos (`lib/connectors/leads/coldiq.openapi.ts`, `lib/connectors/leads/google-places.openapi.ts`, `lib/supabase/database.types.ts`, `tests/connectors/coldiq-openapi.test.ts`). Revertirlos antes de commitear; verificar lo propio con `npx biome check <archivos>`.
- `vitest.config.ts` corre solo `tests/**/*.test.ts` en `environment: node`.
- Rama: `feat/etapa-5-escucha`, worktree `.claude/worktrees/etapa-5-escucha`.

## Qué modelo usar para implementar cada task

Esto es sobre qué modelo de Claude Code despachar por task, no sobre los modelos de runtime del agente (que están arriba, en Global Constraints).

| Task | Modelo | Por qué |
|---|---|---|
| 1 · Headers de hilo | Haiku 4.5 | El plan trae el código completo: es transcripción más correr tests. |
| 2 · `lib/gmail/read.ts` | Sonnet 5 | Parsing de payloads anidados de la API de Gmail, con varios casos borde. |
| 3 · `lib/outreach/listen.ts` | Sonnet 5 | El núcleo con más reglas: auto-reply, dedup, qué transición corresponde. |
| 4 · `reconcile.ts` | Sonnet 5 | Decisión con una regla de seguridad que no se puede aflojar. |
| 5 · Lecturas del store | Haiku 4.5 | Cuatro métodos siguiendo un patrón que ya existe en el archivo. |
| 6 · Adapter de HubSpot | Sonnet 5 | API externa, formato de deal fijado por el `CLAUDE.md`. |
| 7 · Follow-ups encolables | Sonnet 5 | Toca el gate y el threading; integración entre piezas. |
| 8 · `read_replies` + skill | Sonnet 5 | La skill es prosa que le dice al modelo cómo clasificar: se escribe con criterio, no se transcribe. |
| 9 · `morning-sweep` | **Opus 5** | Orquestación con lock, aislamiento de fallos en dos niveles y handoff al agente. Es donde un error se paga caro y en silencio. |
| 10 · `followups` | Sonnet 5 | Orquestación más simple, sobre las piezas de la 7. |
| 11 · Resumen y verificación en vivo | Sonnet 5 | Integración y navegador. |
| Reviews de cada task | Sonnet 5 | Piso recomendado para revisores; subir a Opus si el diff toca el envío. |
| Review final de la rama | **Opus 5** | Es la única pasada que ve las once tasks juntas. |

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `lib/gmail/mime.ts` | + `inReplyTo` y `references` en los headers. |
| `lib/gmail/send.ts` | + `threadId` en el payload de la API. |
| `lib/gmail/read.ts` | Traer un hilo, clasificar cada mensaje (nuestro/ajeno/rebote/auto-reply), buscar por `rfc822msgid:`. |
| `lib/outreach/listen.ts` | Núcleo puro: qué efectos corresponden ante los mensajes de un hilo. |
| `lib/outreach/services/reconcile.ts` | Confirmar envíos inciertos. Nunca reencolar. |
| `lib/outreach/store.ts` | + lecturas que los schedules necesitan. |
| `lib/connectors/crm/hubspot-adapter.ts` | + `listOpenDeals`, `createDeal`. |
| `lib/outreach/services/draft.ts` | Sacar el `refuse` de `followup_no_disponible`. |
| `lib/outreach/summary.ts` | + respuestas y oportunidades frenadas de las últimas 24 h. |
| `agents/outreach/tools/read_replies.ts` | Wrapper fino para el agente. |
| `agents/outreach/skills/outreach-escucha/SKILL.md` | Cómo clasificar una respuesta. |
| `agents/outreach/schedules/morning-sweep.ts` | Barrido diario. |
| `agents/outreach/schedules/followups.ts` | Encolado diario de follow-ups. |

---

### Task 1: Headers de hilo en el MIME

Sin esto, un `followup_2` abre una conversación nueva en la bandeja del otro en vez de caer bajo el primer mensaje.

**Files:**
- Modify: `lib/gmail/mime.ts`
- Modify: `lib/gmail/send.ts`
- Test: `tests/gmail/mime.test.ts` (crear si no existe), `tests/gmail/send.test.ts`

**Interfaces:**
- Consumes: `buildRawMessage(input)` y `sendMail(accessToken, input)` tal como están hoy.
- Produces: `MailInput` gana `inReplyTo?: string | null`, `references?: string | null`, `threadId?: string | null`. `sendMail` manda `threadId` en el body de la API cuando viene.

- [ ] **Step 1: Write the failing test**

```ts
// tests/gmail/mime.test.ts
import { describe, expect, it } from "vitest";
import { buildRawMessage } from "@/lib/gmail/mime";

const decode = (raw: string) =>
	Buffer.from(raw, "base64url").toString("utf8");

describe("buildRawMessage con hilo", () => {
	it("agrega In-Reply-To cuando se le pasa el Message-ID original", () => {
		const raw = buildRawMessage({
			to: "a@b.test",
			subject: "Re: Hola",
			body: "Cuerpo",
			inReplyTo: "<abc@mail.gmail.com>",
		});

		expect(decode(raw)).toContain("In-Reply-To: <abc@mail.gmail.com>");
	});

	it("agrega References cuando se le pasa", () => {
		const raw = buildRawMessage({
			to: "a@b.test",
			subject: "Re: Hola",
			body: "Cuerpo",
			references: "<abc@mail.gmail.com>",
		});

		expect(decode(raw)).toContain("References: <abc@mail.gmail.com>");
	});

	it("sin hilo no agrega ninguno de los dos headers", () => {
		const raw = decode(
			buildRawMessage({ to: "a@b.test", subject: "Hola", body: "Cuerpo" }),
		);

		expect(raw).not.toContain("In-Reply-To");
		expect(raw).not.toContain("References");
	});

	it("un salto de línea en In-Reply-To no puede inyectar otro header", () => {
		expect(() =>
			buildRawMessage({
				to: "a@b.test",
				subject: "Hola",
				body: "Cuerpo",
				inReplyTo: "<a>\r\nBcc: fuga@mal.test",
			}),
		).toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gmail/mime.test.ts`
Expected: FAIL — `inReplyTo` no existe en `MailInput`, los headers no aparecen.

- [ ] **Step 3: Write minimal implementation**

En `lib/gmail/mime.ts`, extender el tipo y el armado. `header()` ya valida saltos de línea, así que la protección contra inyección sale sola:

```ts
type MailInput = {
	to: string;
	subject: string;
	body: string;
	bcc?: string | null;
	messageId?: string | null;
	/** Message-ID RFC822 del mensaje al que se responde. Gmail reescribe el
	 * propio, así que este valor se lee de Gmail, no se inventa. */
	inReplyTo?: string | null;
	references?: string | null;
};

export function buildRawMessage({
	to,
	subject,
	body,
	bcc,
	messageId,
	inReplyTo,
	references,
}: MailInput): string {
	if (/[\r\n]/.test(subject)) throw new Error("header inválido: Subject");
	const mime = [
		header("To", to),
		...(bcc ? [header("Bcc", bcc)] : []),
		header("Subject", encodeSubject(subject)),
		...(messageId ? [header("Message-ID", messageId)] : []),
		...(inReplyTo ? [header("In-Reply-To", inReplyTo)] : []),
		...(references ? [header("References", references)] : []),
		"MIME-Version: 1.0",
		'Content-Type: text/plain; charset="UTF-8"',
		"Content-Transfer-Encoding: base64",
		"",
		Buffer.from(body, "utf8").toString("base64"),
	].join("\r\n");

	return Buffer.from(mime, "utf8").toString("base64url");
}
```

En `lib/gmail/send.ts`, sumar `threadId` al tipo y al payload:

```ts
	const payload = JSON.stringify({
		raw: buildRawMessage(input),
		...(input.threadId ? { threadId: input.threadId } : {}),
	});
```

- [ ] **Step 4: Add a test for threadId in send**

```ts
// en tests/gmail/send.test.ts
it("manda threadId en el body cuando la pieza responde un hilo", async () => {
	const fetchMock = vi.fn(async () => Response.json({ id: "m1", threadId: "t1" }));
	vi.stubGlobal("fetch", fetchMock);

	await sendMail("tok", {
		to: "a@b.test",
		subject: "Re: Hola",
		body: "Cuerpo",
		threadId: "t1",
	});

	const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
	expect(body.threadId).toBe("t1");
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/gmail/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/gmail/mime.ts lib/gmail/send.ts tests/gmail/
git commit -m "feat: headers de hilo para los follow-ups"
```

---

### Task 2: `lib/gmail/read.ts`

**Files:**
- Create: `lib/gmail/read.ts`
- Test: `tests/gmail/read.test.ts`

**Interfaces:**
- Consumes: `GmailUnauthorizedError` de `@/lib/gmail/send`.
- Produces:
  - `interface GmailMessage { id: string; threadId: string; rfc822MessageId: string | null; from: string; date: string; snippet: string; body: string; isFromUs: boolean; isBounce: boolean; isAutoReply: boolean }`
  - `fetchThread(accessToken: string, threadId: string, ourEmail: string): Promise<GmailMessage[]>`
  - `findByRfc822Id(accessToken: string, rfc822MessageId: string): Promise<{ id: string; threadId: string } | null>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/gmail/read.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailUnauthorizedError } from "@/lib/gmail/send";
import { fetchThread, findByRfc822Id } from "@/lib/gmail/read";

afterEach(() => vi.unstubAllGlobals());

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

const message = (over: Record<string, unknown> = {}) => ({
	id: "m1",
	threadId: "t1",
	snippet: "hola",
	payload: {
		headers: [
			{ name: "From", value: "ana@acme.test" },
			{ name: "Date", value: "Mon, 14 Sep 2026 10:00:00 -0300" },
			{ name: "Message-ID", value: "<ana-1@acme.test>" },
		],
		body: { data: b64("Cuerpo de la respuesta") },
	},
	...over,
});

const threadResponse = (messages: unknown[]) =>
	Response.json({ id: "t1", messages });

describe("fetchThread", () => {
	it("marca como nuestro el mensaje que sale de la casilla del ejecutor", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [
							{ name: "From", value: "Mati <mati@innov.as>" },
							{ name: "Message-ID", value: "<mio-1@innov.as>" },
						],
						body: { data: b64("Mi mensaje") },
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isFromUs).toBe(true);
	});

	it("marca como ajeno el mensaje de otra casilla", async () => {
		vi.stubGlobal("fetch", async () => threadResponse([message()]));

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isFromUs).toBe(false);
	});

	it("extrae el Message-ID RFC822, que es lo que necesita el follow-up", async () => {
		vi.stubGlobal("fetch", async () => threadResponse([message()]));

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.rfc822MessageId).toBe("<ana-1@acme.test>");
	});

	it("detecta un rebote por el remitente mailer-daemon", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [
							{ name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
						],
						body: { data: b64("Address not found") },
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isBounce).toBe(true);
	});

	it("detecta un rebote por la parte message/delivery-status", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [{ name: "From", value: "postmaster@acme.test" }],
						mimeType: "multipart/report",
						parts: [{ mimeType: "message/delivery-status", body: {} }],
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isBounce).toBe(true);
	});

	it("detecta una respuesta automática por Auto-Submitted", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [
							{ name: "From", value: "ana@acme.test" },
							{ name: "Auto-Submitted", value: "auto-replied" },
						],
						body: { data: b64("Estoy de vacaciones hasta el 3") },
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isAutoReply).toBe(true);
	});

	it("lee el cuerpo de un mensaje multipart, no solo del body directo", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [{ name: "From", value: "ana@acme.test" }],
						mimeType: "multipart/alternative",
						parts: [
							{ mimeType: "text/plain", body: { data: b64("Texto plano") } },
							{ mimeType: "text/html", body: { data: b64("<p>HTML</p>") } },
						],
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.body).toBe("Texto plano");
	});

	it("un 401 tira GmailUnauthorizedError, igual que el envío", async () => {
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));

		await expect(fetchThread("tok", "t1", "mati@innov.as")).rejects.toBeInstanceOf(
			GmailUnauthorizedError,
		);
	});

	it("un hilo sin mensajes devuelve lista vacía, no explota", async () => {
		vi.stubGlobal("fetch", async () => Response.json({ id: "t1" }));

		expect(await fetchThread("tok", "t1", "mati@innov.as")).toEqual([]);
	});
});

describe("findByRfc822Id", () => {
	it("devuelve el mensaje cuando la búsqueda lo encuentra", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({ messages: [{ id: "m9", threadId: "t9" }] }),
		);

		expect(await findByRfc822Id("tok", "<x@y.test>")).toEqual({
			id: "m9",
			threadId: "t9",
		});
	});

	it("devuelve null cuando no hay resultados", async () => {
		vi.stubGlobal("fetch", async () => Response.json({}));

		expect(await findByRfc822Id("tok", "<x@y.test>")).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gmail/read.test.ts`
Expected: FAIL — no existe `lib/gmail/read.ts`.

- [ ] **Step 3: Write minimal implementation**

Requisitos que el implementador tiene que cumplir:

1. `GET https://gmail.googleapis.com/gmail/v1/users/me/threads/{threadId}?format=full`, con `Authorization: Bearer <token>`.
2. Un 401 tira `GmailUnauthorizedError` (importado de `send.ts`, no redefinido).
3. Por cada mensaje: leer headers `From`, `Date`, `Message-ID`, `Auto-Submitted`, `X-Autoreply`.
4. `isFromUs`: el `From` contiene el mail del ejecutor, comparando en minúsculas y tolerando el formato `Nombre <mail>`.
5. `isBounce`: el `From` matchea `mailer-daemon@` o `postmaster@`, **o** el payload tiene una parte con `mimeType === "message/delivery-status"` (recursivo: las partes anidan).
6. `isAutoReply`: hay header `Auto-Submitted` con valor distinto de `no`, o hay `X-Autoreply`.
7. `body`: si el payload tiene `body.data`, decodificar base64url. Si es multipart, buscar recursivamente la primera parte `text/plain` y decodificarla. Si no hay ninguna, string vacío.
8. `findByRfc822Id`: `GET /users/me/messages?q=rfc822msgid:<id>`, devolver el primer resultado o `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/gmail/read.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/gmail/read.ts tests/gmail/read.test.ts
git commit -m "feat: lectura de hilos de Gmail con rebotes y auto-replies"
```

---

### Task 3: `lib/outreach/listen.ts`

El núcleo con más reglas de la etapa. Recibe los mensajes de un hilo y el contacto, y devuelve **qué efectos corresponden**, sin ejecutarlos.

**Files:**
- Create: `lib/outreach/listen.ts`
- Test: `tests/outreach/listen.test.ts`

**Interfaces:**
- Consumes: `GmailMessage` de `@/lib/gmail/read`; `ContactRow` de `@/lib/outreach/store`; `OutreachStage` de `@/lib/outreach/stage`.
- Produces:
  - `interface ListenEffect { event: { type: "respuesta" | "rebote"; gmailMessageId: string; summary: string }; repliedAt: string | null; stage: OutreachStage | null }`
  - `planListen(input: { contact: ContactRow; messages: readonly GmailMessage[]; knownMessageIds: ReadonlySet<string>; now: Date }): ListenEffect[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/outreach/listen.test.ts
import { describe, expect, it } from "vitest";
import { planListen } from "@/lib/outreach/listen";
import { contactRow } from "./fake-store";

const NOW = new Date("2026-09-19T12:00:00Z");

const inbound = (over: Record<string, unknown> = {}) => ({
	id: "m1",
	threadId: "t1",
	rfc822MessageId: "<ana-1@acme.test>",
	from: "ana@acme.test",
	date: "Mon, 14 Sep 2026 10:00:00 -0300",
	snippet: "me interesa",
	body: "Me interesa, contame más",
	isFromUs: false,
	isBounce: false,
	isAutoReply: false,
	...over,
});

describe("planListen", () => {
	it("una respuesta nueva registra el evento, setea replied_at y mueve a respuesta_neutra", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound()],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.event.type).toBe("respuesta");
		expect(effect.repliedAt).toBe(NOW.toISOString());
		expect(effect.stage).toBe("respuesta_neutra");
	});

	it("un mensaje nuestro no genera ningún efecto", () => {
		const effects = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ isFromUs: true })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effects).toEqual([]);
	});

	it("un mensaje ya registrado no se procesa de nuevo", () => {
		const effects = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ id: "m1" })],
			knownMessageIds: new Set(["m1"]),
			now: NOW,
		});

		expect(effects).toEqual([]);
	});

	it("un rebote registra el evento pero no mueve la etapa ni setea replied_at", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ isBounce: true })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.event.type).toBe("rebote");
		expect(effect.repliedAt).toBeNull();
		expect(effect.stage).toBeNull();
	});

	it("un auto-reply se registra pero NO apaga la cadencia de follow-ups", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ isAutoReply: true })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.event.type).toBe("respuesta");
		// Lo que importa: sin replied_at el contacto sigue elegible para follow-up.
		expect(effect.repliedAt).toBeNull();
		expect(effect.stage).toBeNull();
	});

	it("no retrocede la etapa de un contacto que ya está más arriba en la escalera", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "reunion_agendada" }),
			messages: [inbound()],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.stage).toBeNull();
	});

	it("procesa varios mensajes nuevos del mismo hilo en orden", () => {
		const effects = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ id: "m1" }), inbound({ id: "m2" })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effects.map((e) => e.event.gmailMessageId)).toEqual(["m1", "m2"]);
	});

	it("el summary del evento lleva el texto de la respuesta, no el snippet recortado", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ body: "Me interesa, contame más", snippet: "Me inter" })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.event.summary).toContain("Me interesa, contame más");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/outreach/listen.test.ts`
Expected: FAIL — no existe `lib/outreach/listen.ts`.

- [ ] **Step 3: Write minimal implementation**

Reglas, en este orden por mensaje:

1. `isFromUs` → ningún efecto.
2. `id` en `knownMessageIds` → ningún efecto (el dedup de la base es el segundo cinturón; este es el primero).
3. `isBounce` → evento `rebote`, `repliedAt: null`, `stage: null`.
4. `isAutoReply` → evento `respuesta`, `repliedAt: null`, `stage: null`. **Sin `replied_at` el contacto sigue elegible para follow-up**, que es el punto.
5. Resto → evento `respuesta`, `repliedAt: now.toISOString()`, y `stage: "respuesta_neutra"` **solo si** `canAdvance(contact.stage, "respuesta_neutra")` da `true`; si no, `null`.

El `summary` del evento lleva el cuerpo del mensaje (acotado a 500 caracteres, como el resto de los summaries del repo).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/outreach/listen.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/listen.ts tests/outreach/listen.test.ts
git commit -m "feat: núcleo puro de la escucha"
```

---

### Task 4: `lib/outreach/services/reconcile.ts`

**Files:**
- Create: `lib/outreach/services/reconcile.ts`
- Test: `tests/outreach/services/reconcile.test.ts`

**Interfaces:**
- Consumes: `QueueItemRow` de `@/lib/outreach/store`.
- Produces:
  - `type ReconcileVerdict = { action: "confirmar"; gmailMessageId: string; gmailThreadId: string } | { action: "dejar_trabada"; motivo: string }`
  - `planReconcile(input: { item: QueueItemRow; found: { id: string; threadId: string } | null; now: Date }): ReconcileVerdict`

- [ ] **Step 1: Write the failing test**

```ts
// tests/outreach/services/reconcile.test.ts
import { describe, expect, it } from "vitest";
import { planReconcile } from "@/lib/outreach/services/reconcile";

const NOW = new Date("2026-09-19T12:00:00Z");

const item = (over: Record<string, unknown> = {}) =>
	({
		id: "q1",
		status: "approved",
		approvedAt: "2026-09-19T11:00:00Z",
		gmailMessageId: null,
		gmailThreadId: null,
		...over,
	}) as never;

describe("planReconcile", () => {
	it("confirma la pieza cuando el mensaje aparece en enviados", () => {
		const verdict = planReconcile({
			item: item(),
			found: { id: "m1", threadId: "t1" },
			now: NOW,
		});

		expect(verdict).toEqual({
			action: "confirmar",
			gmailMessageId: "m1",
			gmailThreadId: "t1",
		});
	});

	it("si no aparece, la deja trabada: nunca reencola", () => {
		const verdict = planReconcile({ item: item(), found: null, now: NOW });

		expect(verdict.action).toBe("dejar_trabada");
	});

	it("una pieza vieja que no aparece sigue trabada, no se reintenta", () => {
		const verdict = planReconcile({
			item: item({ approvedAt: "2026-09-01T00:00:00Z" }),
			found: null,
			now: NOW,
		});

		expect(verdict.action).toBe("dejar_trabada");
	});

	it("el motivo de una trabada vieja dice que hay que revisarla a mano", () => {
		const verdict = planReconcile({
			item: item({ approvedAt: "2026-09-01T00:00:00Z" }),
			found: null,
			now: NOW,
		});

		if (verdict.action !== "dejar_trabada") throw new Error("verdict inesperado");
		expect(verdict.motivo).toMatch(/mano|revisar/i);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/outreach/services/reconcile.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/outreach/services/reconcile.ts
// Confirmar envíos inciertos. La regla que no se negocia: solo se confirma lo
// que se puede probar. Si el mensaje no aparece en enviados, la pieza queda
// trabada y la mira una persona — reencolar arriesga un segundo mail al mismo
// contacto, que es el peor error posible de esta herramienta.
import type { QueueItemRow } from "../store";

export type ReconcileVerdict =
	| { action: "confirmar"; gmailMessageId: string; gmailThreadId: string }
	| { action: "dejar_trabada"; motivo: string };

export function planReconcile(input: {
	item: QueueItemRow;
	found: { id: string; threadId: string } | null;
	now: Date;
}): ReconcileVerdict {
	if (input.found) {
		return {
			action: "confirmar",
			gmailMessageId: input.found.id,
			gmailThreadId: input.found.threadId,
		};
	}
	return {
		action: "dejar_trabada",
		motivo:
			"no aparece en enviados: hay que revisarla a mano antes de volver a tocarla",
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/outreach/services/reconcile.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/services/reconcile.ts tests/outreach/services/reconcile.test.ts
git commit -m "feat: reconciliación de piezas trabadas, solo confirma lo probado"
```

---

### Task 5: Lecturas que los schedules necesitan

**Files:**
- Modify: `lib/outreach/store.ts`
- Modify: `tests/outreach/fake-store.ts`
- Test: `tests/outreach/store-lecturas.test.ts`

**Interfaces:**
- Produces, en `OutreachStore`:
  - `listActiveTenants(): Promise<{ id: string; slug: string }[]>`
  - `listExecutorsWithGmailRead(tenantId: string): Promise<ExecutorRow[]>`
  - `listContactsWithThread(tenantId: string, ownerUserId: string): Promise<ContactRow[]>`
  - `listDueFollowups(tenantId: string, now: Date): Promise<ContactRow[]>`
  - `listKnownInboundIds(tenantId: string, contactKey: string): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/outreach/store-lecturas.test.ts
import { describe, expect, it } from "vitest";
import { createFakeStore, TENANT, USER } from "./fake-store";

describe("lecturas de los schedules en el fake store", () => {
	it("listContactsWithThread solo trae contactos con gmail_thread_id", async () => {
		const store = createFakeStore();
		store.contacts.push(
			{ ...store.contactSeed(), contactKey: "em:con@hilo.test", gmailThreadId: "t1", ownerUserId: USER },
			{ ...store.contactSeed(), contactKey: "em:sin@hilo.test", gmailThreadId: null, ownerUserId: USER },
		);

		const rows = await store.listContactsWithThread(TENANT, USER);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:con@hilo.test"]);
	});

	it("listDueFollowups excluye a quien ya respondió", async () => {
		const store = createFakeStore();
		const vencido = "2026-09-01T00:00:00Z";
		store.contacts.push(
			{ ...store.contactSeed(), contactKey: "em:debe@test.com", nextStepAt: vencido, touches: 1, repliedAt: null },
			{ ...store.contactSeed(), contactKey: "em:respondio@test.com", nextStepAt: vencido, touches: 1, repliedAt: vencido },
		);

		const rows = await store.listDueFollowups(TENANT, new Date("2026-09-19T12:00:00Z"));

		expect(rows.map((r) => r.contactKey)).toEqual(["em:debe@test.com"]);
	});

	it("listDueFollowups excluye a quien ya agotó los tres toques", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:agotado@test.com",
			nextStepAt: "2026-09-01T00:00:00Z",
			touches: 3,
			repliedAt: null,
		});

		const rows = await store.listDueFollowups(TENANT, new Date("2026-09-19T12:00:00Z"));

		expect(rows).toEqual([]);
	});

	it("listDueFollowups excluye a quien todavía no vence", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:futuro@test.com",
			nextStepAt: "2026-10-01T00:00:00Z",
			touches: 1,
			repliedAt: null,
		});

		const rows = await store.listDueFollowups(TENANT, new Date("2026-09-19T12:00:00Z"));

		expect(rows).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/outreach/store-lecturas.test.ts`
Expected: FAIL — los métodos no existen ni en el fake ni en la interfaz.

- [ ] **Step 3: Write minimal implementation**

En `lib/outreach/store.ts`, sumar los cinco métodos a `OutreachStore` y a `createSupabaseOutreachStore`, siguiendo el patrón de los que ya están (columnas por constante, mapeo con la función de fila existente):

- `listActiveTenants`: `from("tenants").select("id, slug").eq("active", true)`.
- `listExecutorsWithGmailRead`: `from("executors").select(...).eq("tenant_id", ...).not("gmail_read_authorized_at", "is", null)`.
- `listContactsWithThread`: contactos del tenant con `owner_user_id` = el ejecutor y `gmail_thread_id` no nulo.
- `listDueFollowups`: `next_step_at <= now`, `touches < 3`, `replied_at is null`.
- `listKnownInboundIds`: `from("events").select("payload").eq("tenant_id",...).eq("contact_key",...).in("type", ["respuesta","rebote"])`, devolver los `payload.gmail_message_id` que sean string.

En `tests/outreach/fake-store.ts`, implementar los mismos cinco sobre los arrays en memoria, y exportar un helper `contactSeed()` que devuelva un `ContactRow` válido por defecto.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/outreach/`
Expected: PASS, sin romper los tests que ya existían del fake store.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/store.ts tests/outreach/fake-store.ts tests/outreach/store-lecturas.test.ts
git commit -m "feat: lecturas de contactos y ejecutores para los schedules"
```

---

### Task 6: Deals en el adapter de HubSpot

**Files:**
- Modify: `lib/connectors/crm/adapter.ts`
- Modify: `lib/connectors/crm/hubspot-adapter.ts`
- Test: `tests/connectors/hubspot-deals.test.ts`

**Interfaces:**
- Produces, en `CrmAdapter`:
  - `listOpenDeals(contactCrmId: string): Promise<{ id: string; stage: string }[]>`
  - `createDeal(input: { contactCrmId: string; companyCrmId: string | null; name: string; description: string; ownerId: string }): Promise<{ id: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/connectors/hubspot-deals.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHubSpotAdapter } from "@/lib/connectors/crm/hubspot-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("createDeal", () => {
	it("crea el deal en el pipeline y stage que fija el CLAUDE.md", async () => {
		const fetchMock = vi.fn(async () => Response.json({ id: "d1" }));
		vi.stubGlobal("fetch", fetchMock);

		await createHubSpotAdapter("tok").createDeal({
			contactCrmId: "c1",
			companyCrmId: "e1",
			name: "En Paralelo · Acme",
			description: "vector: linkedin · hook: cuello_operativo · canal: email",
			ownerId: "92296278",
		});

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.properties.pipeline).toBe("default");
		expect(body.properties.dealstage).toBe("1404975950");
	});

	it("repite el origen en description, que es lo que pide la regla del repo", async () => {
		const fetchMock = vi.fn(async () => Response.json({ id: "d1" }));
		vi.stubGlobal("fetch", fetchMock);

		await createHubSpotAdapter("tok").createDeal({
			contactCrmId: "c1",
			companyCrmId: null,
			name: "En Paralelo · Acme",
			description: "vector: linkedin · hook: cuello_operativo · canal: email",
			ownerId: "92296278",
		});

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.properties.description).toContain("linkedin");
	});
});

describe("listOpenDeals", () => {
	it("no cuenta como abierto un deal en closedwon ni en closedlost", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({
				results: [
					{ id: "d1", properties: { dealstage: "closedwon" } },
					{ id: "d2", properties: { dealstage: "decisionmakerboughtin" } },
					{ id: "d3", properties: { dealstage: "closedlost" } },
				],
			}),
		);

		const open = await createHubSpotAdapter("tok").listOpenDeals("c1");

		expect(open.map((d) => d.id)).toEqual(["d2"]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/connectors/hubspot-deals.test.ts`
Expected: FAIL — los métodos no existen en el adapter.

- [ ] **Step 3: Write minimal implementation**

Requisitos:

1. `createDeal`: `POST /crm/v3/objects/deals` con `properties: { dealname, pipeline: "default", dealstage: "1404975950", description, hubspot_owner_id }`, y asociaciones a contacto (typeId 3) y, si viene `companyCrmId`, a empresa (typeId 341).
2. `listOpenDeals`: traer los deals asociados al contacto y filtrar los que **no** estén en `closedwon` ni `closedlost`.
3. Un 401 tira `HubSpotUnauthorizedError`, como el resto del adapter.
4. Los ids de pipeline, stage y asociaciones salen del `CLAUDE.md` del repo. No inventar otros.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/connectors/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/crm/adapter.ts lib/connectors/crm/hubspot-adapter.ts tests/connectors/hubspot-deals.test.ts
git commit -m "feat: crear y listar deals en el adapter de HubSpot"
```

---

### Task 7: Follow-ups encolables

Saca el `refuse` que bloquea los follow-ups y completa los campos de hilo al encolar.

**Files:**
- Modify: `lib/outreach/services/draft.ts`
- Modify: `lib/outreach/services/queue.ts`
- Test: `tests/outreach/services/draft.test.ts`, `tests/outreach/services/queue.test.ts`

**Interfaces:**
- Consumes: `fetchThread` de Task 2, `DEFAULT_OUTREACH_MODELS.draft_followup` de `lib/outreach/config.ts`.
- Produces: `draftMessage` acepta `kind: "followup_2" | "followup_3"`; `queueTouch` acepta esos kinds y completa `reply_to_message_id` y `gmail_thread_id`.

- [ ] **Step 1: Write the failing test**

```ts
// en tests/outreach/services/draft.test.ts
it("ya no rechaza un followup_2: los follow-ups llegaron con la escucha", async () => {
	const result = await draftMessage(
		{ caller, contactKey: "em:ana@acme.test", kind: "followup_2" },
		deps,
	);

	expect(isRefusal(result) && result.reason === "followup_no_disponible").toBe(false);
});

it("un followup necesita que el contacto ya tenga un hilo abierto", async () => {
	// Un contacto sin gmail_thread_id no puede recibir un follow-up en hilo.
	const result = await draftMessage(
		{ caller, contactKey: "em:sin-hilo@acme.test", kind: "followup_2" },
		deps,
	);

	expect(isRefusal(result)).toBe(true);
});
```

```ts
// en tests/outreach/services/queue.test.ts
it("una pieza de followup guarda el hilo y el mensaje al que responde", async () => {
	const result = await queueTouch(
		{
			caller,
			contactKey: "em:ana@acme.test",
			kind: "followup_2",
			subject: "Re: Crecer sin sumar gente",
			body: PASSING_BODY,
			hook: "cuello_operativo",
			vector: "linkedin",
			idioma: "es_ar",
			replyToMessageId: "<ana-1@acme.test>",
			gmailThreadId: "t1",
		},
		deps,
	);

	expect(result.ok).toBe(true);
	const [item] = store.queueItems;
	expect(item.replyToMessageId).toBe("<ana-1@acme.test>");
	expect(item.gmailThreadId).toBe("t1");
});

it("un followup no exige ancla, a diferencia del msg1", async () => {
	// El check de la base solo exige ancla para kind = 'msg1'.
	const result = await queueTouch(
		{ caller, contactKey: "em:ana@acme.test", kind: "followup_2", subject: "Re: x", body: PASSING_BODY, hook: "cuello_operativo", vector: "linkedin", idioma: "es_ar", replyToMessageId: "<a@b.test>", gmailThreadId: "t1" },
		deps,
	);

	expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/outreach/services/draft.test.ts tests/outreach/services/queue.test.ts`
Expected: FAIL — `draftMessage` sigue rechazando todo lo que no sea `msg1`; `queueTouch` no acepta los campos de hilo.

- [ ] **Step 3: Write minimal implementation**

1. En `draft.ts`, borrar el bloque `if (input.kind !== "msg1") return refuse("followup_no_disponible", ...)`.
2. Un follow-up exige que el contacto tenga `gmail_thread_id`; si no, `refuse("sin_hilo", "este contacto no tiene un hilo abierto: el follow-up tiene que caer bajo el primer mensaje")`.
3. El follow-up usa el modelo `draft_followup` de la config del tenant, no el de `draft_msg1`.
4. En `queue.ts`, `QueueTouchInput` acepta `kind: "msg1" | "followup_2" | "followup_3"`, más `replyToMessageId?: string | null` y `gmailThreadId?: string | null`, y los guarda en la fila. El `ancla` sigue siendo obligatoria solo para `msg1`, igual que el check de la base.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/outreach/`
Expected: PASS, sin romper los tests de msg1 que ya existían.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/services/draft.ts lib/outreach/services/queue.ts tests/outreach/services/
git commit -m "feat: habilitar follow-ups encolables con hilo"
```

---

### Task 8: `read_replies` y la skill de clasificación

**Files:**
- Create: `agents/outreach/tools/read_replies.ts`
- Create: `agents/outreach/skills/outreach-escucha/SKILL.md`
- Modify: `lib/agents/running-tool.ts` (etiqueta en castellano, lo exige el `CLAUDE.md` y hay test que lo verifica)
- Test: `tests/agents/outreach/tools/read-replies.test.ts`

**Interfaces:**
- Consumes: `listKnownInboundIds` de Task 5, `callerFromSession`, `createSupabaseOutreachStore`.
- Produces: tool `read_replies` que devuelve `{ ok: true, respuestas: { contactKey: string; nombre: string | null; empresa: string | null; texto: string; fecha: string }[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/agents/outreach/tools/read-replies.test.ts
import { describe, expect, it } from "vitest";
import { TOOL_LABELS } from "@/lib/agents/running-tool";

describe("read_replies", () => {
	it("tiene etiqueta en castellano, como exige el CLAUDE.md", () => {
		expect(TOOL_LABELS.read_replies).toBeTruthy();
		expect(TOOL_LABELS.read_replies).not.toBe("read_replies");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/outreach/tools/read-replies.test.ts tests/agents/running-tool.test.ts`
Expected: FAIL — la tool no existe y `running-tool.test.ts` falla porque encuentra una tool en disco sin etiqueta.

- [ ] **Step 3: Write minimal implementation**

1. `read_replies`: tool sin `approval` (solo lee), que devuelve las respuestas sin interpretar del tenant — contactos en `respuesta_neutra` con eventos `respuesta` recientes, con el texto del evento.
2. Etiqueta en `TOOL_LABELS`: `read_replies: "Leyendo respuestas"`.
3. `SKILL.md` de `outreach-escucha`: le explica al modelo cómo clasificar. Categorías y a qué etapa mueven:
   - interés o pedido de más info → `en_conversacion`, y crear deal;
   - reunión concreta → `reunion_agendada`, y crear deal;
   - baja explícita → `no_interesado`;
   - ambiguo, fuera de oficina, "escribime más adelante" → se queda en `respuesta_neutra`.
   La skill tiene que decir explícitamente que ante la duda **no** se avanza: quedarse en `respuesta_neutra` es la opción segura, porque la escalera no retrocede.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agents/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/outreach/tools/read_replies.ts agents/outreach/skills/outreach-escucha/ lib/agents/running-tool.ts tests/agents/
git commit -m "feat: read_replies y la skill de clasificación"
```

---

### Task 9: `morning-sweep`

La task más delicada: un error acá falla en silencio a la madrugada.

**Files:**
- Create: `agents/outreach/schedules/morning-sweep.ts`
- Create: `lib/outreach/services/sweep.ts`
- Test: `tests/outreach/services/sweep.test.ts`

**Interfaces:**
- Consumes: `planListen` (Task 3), `planReconcile` (Task 4), las lecturas del store (Task 5), `fetchThread`/`findByRfc822Id` (Task 2), `tokenForSubject`.
- Produces: `runSweep(deps): Promise<SweepResult>` donde `SweepResult = { tenants: { tenantId: string; slug: string; respuestas: number; rebotes: number; reconciliadas: number; trabadas: number; ejecutoresFallidos: string[] }[] }`.

La lógica va en `lib/outreach/services/sweep.ts` con dependencias inyectadas; el archivo del schedule es el cableado mínimo que arma las deps reales y hace el handoff al canal.

- [ ] **Step 1: Write the failing test**

```ts
// tests/outreach/services/sweep.test.ts
import { describe, expect, it, vi } from "vitest";
import { runSweep } from "@/lib/outreach/services/sweep";

const deps = (over: Record<string, unknown> = {}) => ({
	store: {
		listActiveTenants: async () => [{ id: "t1", slug: "innovas" }],
		listExecutorsWithGmailRead: async () => [
			{ tenantId: "t1", userId: "u1", slug: "mati", email: "mati@innov.as" },
		],
		listContactsWithThread: async () => [],
		listKnownInboundIds: async () => [],
		listQueue: async () => [],
		insertEvents: vi.fn(async () => {}),
		updateContact: vi.fn(async () => ({}) as never),
		transitionQueueItem: vi.fn(async () => null),
	},
	getToken: async () => "tok",
	fetchThread: async () => [],
	findByRfc822Id: async () => null,
	now: () => new Date("2026-09-19T10:00:00Z"),
	...over,
});

describe("runSweep", () => {
	it("un ejecutor cuyo token murió no frena a los demás", async () => {
		const getToken = vi
			.fn()
			.mockRejectedValueOnce(new Error("grant vencido"))
			.mockResolvedValueOnce("tok");

		const result = await runSweep(
			deps({
				getToken,
				store: {
					...deps().store,
					listExecutorsWithGmailRead: async () => [
						{ tenantId: "t1", userId: "u1", slug: "mati", email: "mati@innov.as" },
						{ tenantId: "t1", userId: "u2", slug: "marcos", email: "marcos@innov.as" },
					],
				},
			}),
		);

		expect(result.tenants[0].ejecutoresFallidos).toEqual(["mati"]);
		expect(getToken).toHaveBeenCalledTimes(2);
	});

	it("un tenant que explota no frena a los otros", async () => {
		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					listActiveTenants: async () => [
						{ id: "t1", slug: "uno" },
						{ id: "t2", slug: "dos" },
					],
					listExecutorsWithGmailRead: async (tenantId: string) => {
						if (tenantId === "t1") throw new Error("base caída");
						return [{ tenantId: "t2", userId: "u1", slug: "mati", email: "m@innov.as" }];
					},
				},
			}),
		);

		expect(result.tenants.map((t) => t.slug)).toContain("dos");
	});

	it("el sweep nunca manda un mail", async () => {
		// No hay ninguna dep de envío: si alguien la agrega, este test la caza.
		expect(Object.keys(deps())).not.toContain("sendMail");
	});

	it("registra la respuesta nueva que encuentra en un hilo", async () => {
		const insertEvents = vi.fn(async () => {});
		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					insertEvents,
					listContactsWithThread: async () => [
						{
							id: "c1",
							tenantId: "t1",
							contactKey: "em:ana@acme.test",
							gmailThreadId: "t1",
							stage: "msg1_enviado",
							touches: 1,
						},
					],
				},
				fetchThread: async () => [
					{
						id: "m1",
						threadId: "t1",
						rfc822MessageId: "<a@b.test>",
						from: "ana@acme.test",
						date: "Mon, 14 Sep 2026 10:00:00 -0300",
						snippet: "dale",
						body: "Dale, contame",
						isFromUs: false,
						isBounce: false,
						isAutoReply: false,
					},
				],
			}),
		);

		expect(result.tenants[0].respuestas).toBe(1);
		expect(insertEvents).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/outreach/services/sweep.test.ts`
Expected: FAIL — no existe `lib/outreach/services/sweep.ts`.

- [ ] **Step 3: Write minimal implementation**

`runSweep`:

1. Por cada tenant de `listActiveTenants()`, envuelto en `try/catch`: si explota, se anota y sigue con el siguiente.
2. Por cada ejecutor de `listExecutorsWithGmailRead(tenantId)`, envuelto en `try/catch`: si `getToken` o Gmail fallan, el slug va a `ejecutoresFallidos` y sigue con el siguiente.
3. Por cada contacto con hilo: `fetchThread`, `planListen` con los ids ya conocidos, y aplicar los efectos (`insertEvents`, `updateContact` con `repliedAt`/`stage` cuando corresponda).
4. Por cada pieza `approved` del ejecutor: `findByRfc822Id` y `planReconcile`; si el veredicto es `confirmar`, `transitionQueueItem` de `approved` a `sent` con los ids; si es `dejar_trabada`, sumar al contador.
5. Devolver el `SweepResult`.

**`runSweep` no recibe ninguna dependencia de envío.** Es la garantía estructural de que un schedule no manda mail.

El archivo `agents/outreach/schedules/morning-sweep.ts`:

```ts
import { defineSchedule } from "eve/schedules";

export default defineSchedule({
	// 7:00 de Argentina. Vercel evalúa cron en UTC.
	cron: "0 10 * * 1-5",
	async run({ to, waitUntil, appAuth }) {
		// 1. Lock, una vez por corrida y antes de iterar nada: insertar en `runs`
		//    con schedule_key = `morning-sweep:<YYYY-MM-DD>` usando el admin
		//    client. Si el insert devuelve 23505, ya corrió hoy: return sin
		//    hacer nada. El índice único runs_schedule_key_idx ya existe.
		// 2. runSweep con las deps reales (store admin, tokenForSubject CON
		//    issuer, fetchThread, findByRfc822Id).
		// 3. Por cada tenant con respuestas sin interpretar, un handoff:
		//    waitUntil(to(canal, target).send(prompt, { auth: appAuth }))
		//    Si no hay nada que interpretar, no manda nada.
	},
});
```

El `prompt` del handoff le dice al agente que use `read_replies` y la skill `outreach-escucha` para clasificar lo que encontró el barrido, y que resuma en ese mismo hilo. No le pasa las respuestas en el texto: las lee con la tool, que es lo que mantiene el prompt corto y la fuente de verdad en la base.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/outreach/services/sweep.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/services/sweep.ts agents/outreach/schedules/morning-sweep.ts tests/outreach/services/sweep.test.ts
git commit -m "feat: morning-sweep con lock y aislamiento de fallos"
```

---

### Task 10: `followups`

**Files:**
- Create: `agents/outreach/schedules/followups.ts`
- Create: `lib/outreach/services/followups.ts`
- Test: `tests/outreach/services/followups.test.ts`

**Interfaces:**
- Consumes: `listDueFollowups` (Task 5), `draftMessage`/`queueTouch` con follow-ups habilitados (Task 7), `fetchThread` (Task 2), `listOpenDeals` (Task 6), `isNoResponse` de `lib/outreach/stage.ts`.
- Produces:
  - `runFollowups(deps): Promise<{ encoladas: number; salteadas: { contactKey: string; motivo: string }[]; frenadas: number }>`
  - En `OutreachStore`: `listExhaustedContacts(tenantId: string, now: Date): Promise<ContactRow[]>` — contactos con `touches >= 3`, `replied_at is null` y `first_touch_at` más viejo que `NO_RESPONSE_AFTER_DAYS`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/outreach/services/followups.test.ts
import { describe, expect, it, vi } from "vitest";
import { runFollowups } from "@/lib/outreach/services/followups";

const contacto = (over: Record<string, unknown> = {}) => ({
	id: "c1",
	tenantId: "t1",
	contactKey: "em:ana@acme.test",
	gmailThreadId: "t1",
	touches: 1,
	repliedAt: null,
	nextStepAt: "2026-09-01T00:00:00Z",
	...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
	store: {
		listActiveTenants: async () => [{ id: "t1", slug: "innovas" }],
		listDueFollowups: async () => [contacto()],
	},
	draftAndQueue: vi.fn(async () => ({ ok: true as const })),
	now: () => new Date("2026-09-19T11:00:00Z"),
	...over,
});

describe("runFollowups", () => {
	it("encola una pieza por cada contacto vencido", async () => {
		const draftAndQueue = vi.fn(async () => ({ ok: true as const }));

		const result = await runFollowups(deps({ draftAndQueue }));

		expect(result.encoladas).toBe(1);
		expect(draftAndQueue).toHaveBeenCalledTimes(1);
	});

	it("el segundo toque es followup_2 y el tercero followup_3", async () => {
		const draftAndQueue = vi.fn(async () => ({ ok: true as const }));

		await runFollowups(
			deps({
				draftAndQueue,
				store: {
					...deps().store,
					listDueFollowups: async () => [
						contacto({ contactKey: "em:uno@test.com", touches: 1 }),
						contacto({ contactKey: "em:dos@test.com", touches: 2 }),
					],
				},
			}),
		);

		expect(draftAndQueue.mock.calls[0][0].kind).toBe("followup_2");
		expect(draftAndQueue.mock.calls[1][0].kind).toBe("followup_3");
	});

	it("saltea al contacto sin hilo en vez de abrir una conversación nueva", async () => {
		const draftAndQueue = vi.fn(async () => ({ ok: true as const }));

		const result = await runFollowups(
			deps({
				draftAndQueue,
				store: {
					...deps().store,
					listDueFollowups: async () => [contacto({ gmailThreadId: null })],
				},
			}),
		);

		expect(result.encoladas).toBe(0);
		expect(result.salteadas[0].motivo).toMatch(/hilo/i);
		expect(draftAndQueue).not.toHaveBeenCalled();
	});

	it("un contacto que falla no frena a los demás", async () => {
		const draftAndQueue = vi
			.fn()
			.mockRejectedValueOnce(new Error("gate caído"))
			.mockResolvedValueOnce({ ok: true as const });

		const result = await runFollowups(
			deps({
				draftAndQueue,
				store: {
					...deps().store,
					listDueFollowups: async () => [
						contacto({ contactKey: "em:uno@test.com" }),
						contacto({ contactKey: "em:dos@test.com" }),
					],
				},
			}),
		);

		expect(result.encoladas).toBe(1);
		expect(result.salteadas).toHaveLength(1);
	});

	it("marca oportunidad frenada al contacto agotado que tiene un deal abierto", async () => {
		const insertEvents = vi.fn(async () => {});

		const result = await runFollowups(
			deps({
				store: {
					...deps().store,
					listDueFollowups: async () => [],
					listExhaustedContacts: async () => [
						contacto({ touches: 3, crmId: "c1", firstTouchAt: "2026-08-01T00:00:00Z" }),
					],
					insertEvents,
				},
				listOpenDeals: async () => [{ id: "d1", stage: "decisionmakerboughtin" }],
			}),
		);

		expect(result.frenadas).toBe(1);
		expect(insertEvents).toHaveBeenCalled();
	});

	it("un contacto agotado sin deal abierto no se marca como frenado", async () => {
		const result = await runFollowups(
			deps({
				store: {
					...deps().store,
					listDueFollowups: async () => [],
					listExhaustedContacts: async () => [
						contacto({ touches: 3, crmId: "c1", firstTouchAt: "2026-08-01T00:00:00Z" }),
					],
					insertEvents: vi.fn(async () => {}),
				},
				listOpenDeals: async () => [],
			}),
		);

		expect(result.frenadas).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/outreach/services/followups.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Write minimal implementation**

`runFollowups`, por cada tenant activo. Primero los vencidos: por cada contacto de `listDueFollowups`, en `try/catch` individual:

1. Sin `gmailThreadId` → saltear con motivo `"no tiene hilo abierto"`.
2. `kind` = `followup_2` si `touches === 1`, `followup_3` si `touches === 2`.
3. Llamar `draftAndQueue` (la dep que envuelve `draftMessage` + `queueTouch`, con `replyToMessageId` y `gmailThreadId`).
4. Contar encoladas y salteadas.

Después los agotados, que es lo que habilita `listOpenDeals`: por cada contacto de `listExhaustedContacts` con `crmId`, pedir `listOpenDeals(crmId)`. Si tiene alguno abierto, emitir el evento `oportunidad_frenada` y contarlo en `frenadas`. Es el "Retrasado (stand by)" de la tabla de pipeline del `CLAUDE.md`: tres toques sin respuesta **con deal abierto**. Sin deal abierto no se emite nada — un contacto que nunca llegó a deal no es una oportunidad frenada, es solo alguien que no contestó.

El schedule `agents/outreach/schedules/followups.ts` usa `cron: "0 11 * * 1-5"` y arma las deps reales. **No manda mail**: las piezas quedan `pending` en `/cola`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/outreach/services/followups.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/services/followups.ts agents/outreach/schedules/followups.ts tests/outreach/services/followups.test.ts
git commit -m "feat: schedule de follow-ups que encola sin enviar"
```

---

### Task 11: Resumen de sesión y verificación en vivo

**Files:**
- Modify: `lib/outreach/summary.ts`
- Test: `tests/outreach/summary.test.ts`

**Interfaces:**
- Consumes: las lecturas del store (Task 5).
- Produces:
  - En `OutreachStore`: `countRecentReplies(tenantId: string, since: Date): Promise<number>` (contactos en `respuesta_neutra` con evento `respuesta` desde `since`) y `countStalled(tenantId: string, since: Date): Promise<number>` (eventos `oportunidad_frenada` desde `since`). Van también al fake store.
  - `sessionSummary` suma respuestas sin interpretar y oportunidades frenadas de las últimas 24 h.

- [ ] **Step 1: Write the failing test**

```ts
// en tests/outreach/summary.test.ts
it("el resumen nombra las respuestas sin interpretar de las últimas 24 h", async () => {
	const texto = await sessionSummary(input, {
		...deps,
		store: { ...deps.store, countRecentReplies: async () => 2 },
	});

	expect(texto).toMatch(/2 respuestas/);
});

it("sin respuestas nuevas no inventa una línea vacía", async () => {
	const texto = await sessionSummary(input, {
		...deps,
		store: { ...deps.store, countRecentReplies: async () => 0 },
	});

	expect(texto).not.toMatch(/0 respuestas/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/outreach/summary.test.ts`
Expected: FAIL — `sessionSummary` todavía no cuenta respuestas.

- [ ] **Step 3: Write minimal implementation**

Sumar al resumen una línea con las respuestas sin interpretar y otra con las oportunidades frenadas, **solo cuando el número es mayor a cero**. Borrar el comentario del encabezado que dice que eso "llega con la escucha (Entrega 4)": llegó.

- [ ] **Step 4: Run the full suite**

Run: `npm run typecheck && npm test && npx biome check <archivos propios>`
Expected: todo en verde.

- [ ] **Step 5: Verificar en vivo, sin asumir**

1. **Ruta de dispatch en dev.** Levantar `npm run dev` y encontrar la ruta real del dispatch de schedules. Con `withEve` embebido el prefijo cambia: probar `POST /eve/agents/outreach/v1/dev/schedules/morning-sweep`. Si da 404, la respuesta incluye `availableScheduleIds`: usar ese dato para dar con la ruta correcta en vez de adivinar.
2. **Disparar el sweep a mano** contra la base local con datos de prueba, y confirmar que registra la respuesta, mueve la etapa a `respuesta_neutra` y abre el hilo en el chat.
3. **Confirmar el cron en producción después del deploy**, en Settings → Cron Jobs de Vercel. Este proyecto ya tuvo una tool que se mergeó y deployó y nunca apareció en el agente de producción: no darlo por hecho.

- [ ] **Step 6: Commit**

```bash
git add lib/outreach/summary.ts tests/outreach/summary.test.ts
git commit -m "feat: respuestas y oportunidades frenadas en el resumen de sesión"
```

---

## Verificación final contra el spec §8

- [ ] Una respuesta real en Gmail mueve el contacto a `respuesta_neutra` y registra el evento, sin intervención.
- [ ] El agente clasifica esa respuesta y, si hay interés, crea el deal con el formato del `CLAUDE.md`.
- [ ] Un follow-up vencido aparece en `/cola`, y al aprobarlo cae en el mismo hilo de Gmail.
- [ ] Un auto-reply de vacaciones no apaga la cadencia de follow-ups.
- [ ] Una pieza trabada que sí se había enviado queda reconciliada; una que no, queda trabada y reportada.
- [ ] Un ejecutor sin grant no frena al resto del sweep.
- [ ] `npm run typecheck`, `npm test` y `npm run lint:fix` en verde.
