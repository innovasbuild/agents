import { describe, expect, it } from "vitest";
import type { QueueItemRow } from "@/lib/outreach/store";
import { sessionSummary } from "@/lib/outreach/summary";
import { contactRow, createFakeStore, TENANT, USER } from "./fake-store";

const now = () => new Date("2026-09-15T15:00:00Z");
const base = {
	tenantId: TENANT,
	userId: USER,
	tenantName: "Acme",
	tenantSlug: "acme",
};

const gate = { status: "ok" as const, violations: [], warnings: [], notes: [] };
const brainConnected = async () => true;

let queueCounter = 0;
function pieceRow(
	contactId: string,
	contactKey: string,
	overrides: Partial<QueueItemRow> = {},
): QueueItemRow {
	return {
		id: `queue-${++queueCounter}`,
		tenantId: TENANT,
		contactId,
		contactKey,
		executorUserId: USER,
		kind: "msg1",
		toEmail: "laura@acme.test",
		subject: "A",
		body: "B",
		hook: "h1",
		vector: "v1",
		idioma: "es_ar",
		ancla: null,
		draftOriginal: { subject: "A", body: "B" },
		gateResult: gate,
		status: "pending",
		expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
		replyToMessageId: null,
		gmailThreadId: null,
		gmailMessageId: null,
		approvedAt: null,
		sentAt: null,
		error: null,
		eveSessionId: null,
		approvalCallId: null,
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

describe("sessionSummary", () => {
	it("para un ejecutor: slug, cupo restante hoy, piezas pendientes y estado de Gmail", async () => {
		const store = createFakeStore();
		store.executors[0].dailyQuota = 10;
		store.executors[0].gmailAuthorizedAt = "2026-09-14T10:00:00Z";
		const contact = contactRow();
		store.contacts.push(contact);
		store.queue.push(pieceRow(contact.id, contact.contactKey));
		store.queue.push({
			...store.queue[0],
			id: "sent-1",
			contactId: "otro",
			status: "sent",
			sentAt: "2026-09-15T13:00:00Z",
		});
		const text = await sessionSummary(base, { store, now, brainConnected });
		expect(text).toContain("Trabajás para Acme (tenant `acme`)");
		expect(text).toContain("ejecutor `ana`");
		expect(text).toContain("cupo de hoy: 9 de 10");
		expect(text).toContain("1 pieza pendiente");
		expect(text).toContain("Gmail autorizado");
	});

	it("para alguien que no es ejecutor lo dice", async () => {
		const store = createFakeStore();
		store.executors = [];
		expect(
			await sessionSummary(base, { store, now, brainConnected }),
		).toContain("no es ejecutor de outreach");
	});

	it("con pendientes y trabadas cuenta cada una y avisa revisar Gmail", async () => {
		const store = createFakeStore();
		const c1 = contactRow();
		const c2 = contactRow({ id: "contact-2", contactKey: "em:b@acme.test" });
		const c3 = contactRow({ id: "contact-3", contactKey: "em:c@acme.test" });
		store.contacts.push(c1, c2, c3);
		store.queue.push(
			pieceRow(c1.id, c1.contactKey, { status: "pending" }),
			pieceRow(c2.id, c2.contactKey, { status: "pending" }),
			pieceRow(c3.id, c3.contactKey, {
				status: "approved",
				approvedAt: "2026-09-15T12:00:00Z",
			}),
		);
		const text = await sessionSummary(base, { store, now, brainConnected });
		expect(text).toContain("2 piezas pendientes y 1 trabada en la cola");
		expect(text).toContain("revisá en Gmail");
		expect(text).toContain(
			"Al arrancar, mostrá la cola por letras con list_queue.",
		);
	});

	it("con 0 pendientes y 1 trabada, la muestra igual y empuja a revisar la cola", async () => {
		const store = createFakeStore();
		const contact = contactRow();
		store.contacts.push(contact);
		store.queue.push(
			pieceRow(contact.id, contact.contactKey, {
				status: "approved",
				approvedAt: "2026-09-15T12:00:00Z",
			}),
		);
		const text = await sessionSummary(base, { store, now, brainConnected });
		expect(text).toContain("0 piezas pendientes y 1 trabada en la cola");
		expect(text).toContain("revisá en Gmail");
		expect(text).toContain(
			"Al arrancar, mostrá la cola por letras con list_queue.",
		);
	});

	it("sin brain conectado avisa que sin canon no se puede trabajar", async () => {
		const store = createFakeStore();
		const text = await sessionSummary(base, {
			store,
			now,
			brainConnected: async () => false,
		});
		expect(text).toContain("no tiene el brain conectado");
		expect(text).toContain("no vas a poder redactar");
	});

	it("si la consulta del brain falla, el resumen sale igual sin el aviso", async () => {
		const store = createFakeStore();
		store.executors[0].dailyQuota = 10;
		const text = await sessionSummary(base, {
			store,
			now,
			brainConnected: async () => {
				throw new Error("Supabase no responde");
			},
		});
		expect(text).toContain("cupo de hoy: 10 de 10");
		expect(text).not.toContain("no tiene el brain conectado");
	});

	it("con la cola vacía no empuja a mostrarla", async () => {
		const store = createFakeStore();
		const text = await sessionSummary(base, { store, now, brainConnected });
		expect(text).toContain("0 piezas pendientes en la cola");
		expect(text).not.toContain("trabada");
		expect(text).not.toContain("revisá en Gmail");
		expect(text).not.toContain(
			"Al arrancar, mostrá la cola por letras con list_queue.",
		);
	});
});
