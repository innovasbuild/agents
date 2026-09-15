import { describe, expect, it } from "vitest";
import { sessionSummary } from "@/lib/outreach/summary";
import { contactRow, createFakeStore, TENANT, USER } from "./fake-store";

const now = () => new Date("2026-09-15T15:00:00Z");
const base = {
	tenantId: TENANT,
	userId: USER,
	tenantName: "Acme",
	tenantSlug: "acme",
};

describe("sessionSummary", () => {
	it("para un ejecutor: slug, cupo restante hoy, piezas pendientes y estado de Gmail", async () => {
		const store = createFakeStore();
		store.executors[0].dailyQuota = 10;
		store.executors[0].gmailAuthorizedAt = "2026-09-14T10:00:00Z";
		const contact = contactRow();
		store.contacts.push(contact);
		const gate = {
			status: "ok" as const,
			violations: [],
			warnings: [],
			notes: [],
		};
		const piece = {
			tenantId: TENANT,
			contactId: contact.id,
			contactKey: contact.contactKey,
			executorUserId: USER,
			kind: "msg1" as const,
			toEmail: "laura@acme.test",
			subject: "A",
			body: "B",
			hook: "h1",
			vector: "v1",
			idioma: "es_ar",
			ancla: null,
			draftOriginal: { subject: "A", body: "B" },
			gateResult: gate,
			replyToMessageId: null,
			gmailThreadId: null,
		};
		await store.insertQueueItem(piece);
		store.queue.push({
			...store.queue[0],
			id: "sent-1",
			contactId: "otro",
			status: "sent",
			sentAt: "2026-09-15T13:00:00Z",
		});
		const text = await sessionSummary(base, { store, now });
		expect(text).toContain("Trabajás para Acme (tenant `acme`)");
		expect(text).toContain("ejecutor `ana`");
		expect(text).toContain("cupo de hoy: 9 de 10");
		expect(text).toContain("1 pieza pendiente");
		expect(text).toContain("Gmail autorizado");
	});

	it("para alguien que no es ejecutor lo dice", async () => {
		const store = createFakeStore();
		store.executors = [];
		expect(await sessionSummary(base, { store, now })).toContain(
			"no es ejecutor de outreach",
		);
	});
});
