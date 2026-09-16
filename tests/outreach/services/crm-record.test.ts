import { describe, expect, it } from "vitest";
import {
	logModelEvent,
	recordCrmUpdate,
} from "@/lib/outreach/services/crm-record";
import {
	contactRow,
	createFakeStore,
	fakeCrm,
	OTHER_USER,
	TENANT,
	USER,
} from "../fake-store";

const caller = {
	tenantId: TENANT,
	userId: USER,
	role: "tenant_member",
	email: "ana@innov.test",
};
const now = () => new Date("2026-09-15T12:00:00Z");

function crmSpy() {
	const calls: unknown[][] = [];
	const adapter = fakeCrm({
		upsertContact: async (input) => {
			calls.push(["upsert", input.crmId, input.properties]);
			return "crm-7";
		},
		addNote: async (id, note) => {
			calls.push(["note", id, note.body]);
		},
	});
	return { adapter, calls };
}

describe("recordCrmUpdate", () => {
	it("mueve la etapa solo hacia adelante y escribe estado, owner y nota en el CRM", async () => {
		const store = createFakeStore();
		store.executors[0].crmOwnerId = "owner-ana";
		store.contacts.push(
			contactRow({ stage: "msg1_enviado", touches: 1, ownerUserId: USER }),
		);
		const { adapter, calls } = crmSpy();
		const result = await recordCrmUpdate(
			{
				caller,
				contactKey: "em:laura@acme.test",
				stage: "reunion_agendada",
				note: "Me contestó por teléfono: reunión el jueves.",
			},
			{ store, crm: adapter, now },
		);
		expect(result).toEqual({
			ok: true,
			crmId: "crm-7",
			stage: "reunion_agendada",
		});
		expect(calls[0]).toEqual([
			"upsert",
			null,
			{
				contact_key: "em:laura@acme.test",
				outreach_status: "reunion_agendada",
				outreach_owner: "ana",
			},
		]);
		expect(calls[1]).toEqual([
			"note",
			"crm-7",
			"[nota · 2026-09-15]\n\nMe contestó por teléfono: reunión el jueves.",
		]);
		expect(store.contacts[0]).toMatchObject({
			stage: "reunion_agendada",
			crmId: "crm-7",
		});
		expect(store.events.map((e) => e.type)).toEqual(["cambio_etapa", "nota"]);
	});

	it("un contacto con claim ajeno no se toca: ni el CRM ni la base ni los eventos", async () => {
		const store = createFakeStore();
		store.executors[0].crmOwnerId = "owner-ana";
		store.contacts.push(
			contactRow({
				stage: "msg1_enviado",
				touches: 1,
				ownerUserId: OTHER_USER,
			}),
		);
		const { adapter, calls } = crmSpy();
		expect(
			await recordCrmUpdate(
				{
					caller,
					contactKey: "em:laura@acme.test",
					stage: "reunion_agendada",
					note: "Me contestó por teléfono.",
				},
				{ store, crm: adapter, now },
			),
		).toMatchObject({ ok: false, reason: "claim_ajeno" });
		expect(calls).toEqual([]);
		expect(store.events).toEqual([]);
		expect(store.contacts[0].stage).toBe("msg1_enviado");
	});

	it("negativas: sin CRM, etapa que retrocede, contacto inexistente", async () => {
		const store = createFakeStore();
		store.executors[0].crmOwnerId = "owner-ana";
		store.contacts.push(contactRow({ stage: "en_conversacion" }));
		expect(
			await recordCrmUpdate(
				{ caller, contactKey: "em:laura@acme.test", stage: null, note: "x" },
				{ store, crm: null, now },
			),
		).toMatchObject({ reason: "sin_crm" });
		expect(
			await recordCrmUpdate(
				{
					caller,
					contactKey: "em:laura@acme.test",
					stage: "msg1_enviado",
					note: null,
				},
				{ store, crm: crmSpy().adapter, now },
			),
		).toMatchObject({ reason: "etapa_no_avanza" });
		expect(
			await recordCrmUpdate(
				{ caller, contactKey: "em:nadie@acme.test", stage: null, note: "x" },
				{ store, crm: crmSpy().adapter, now },
			),
		).toMatchObject({ reason: "contacto_inexistente" });
	});
});

describe("logModelEvent", () => {
	it("registra freno o nota con el actor de la sesión", async () => {
		const store = createFakeStore();
		expect(
			await logModelEvent(
				{
					caller,
					type: "freno",
					contactKey: null,
					summary: "El owner escribió FRENA",
				},
				{ store },
			),
		).toEqual({ ok: true });
		expect(store.events[0]).toMatchObject({
			type: "freno",
			actor_user_id: USER,
			summary: "El owner escribió FRENA",
			channel: null,
		});
	});
});
