import { describe, expect, it } from "vitest";
import { runGate } from "@/lib/outreach/gate";
import { emptyGateRules } from "@/lib/outreach/gate-blocks";
import {
	contactRow,
	createFakeStore,
	PASSING_BODY,
	TENANT,
	USER,
} from "./fake-store";

describe("fake store", () => {
	it("PASSING_BODY pasa el gate sin reglas del tenant", () => {
		const gate = runGate({
			subject: "Crecer sin sumar gente al back office",
			body: PASSING_BODY,
			channel: "email",
			idioma: "es_ar",
			rules: emptyGateRules(),
		});
		expect(gate).toMatchObject({ status: "ok", violations: [] });
	});

	it("una sola pieza viva por persona y transiciones condicionales", async () => {
		const store = createFakeStore();
		const contact = contactRow();
		store.contacts.push(contact);
		const base = {
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
			ancla: { hecho: "x", fuente: "https://acme.test" },
			draftOriginal: { subject: "A", body: "B" },
			gateResult: {
				status: "ok" as const,
				violations: [],
				warnings: [],
				notes: [],
			},
			replyToMessageId: null,
			gmailThreadId: null,
		};
		const item = await store.insertQueueItem(base);
		expect(item).not.toBe("pieza_viva");
		expect(await store.insertQueueItem(base)).toBe("pieza_viva");
		const id = (item as { id: string }).id;
		expect(
			await store.transitionQueueItem(TENANT, id, "pending", {
				status: "approved",
			}),
		).not.toBeNull();
		expect(
			await store.transitionQueueItem(TENANT, id, "pending", {
				status: "approved",
			}),
		).toBeNull();
	});
});
