// read_replies es de solo lectura (sin approval): le muestra al humano las
// respuestas crudas de contactos que siguen en respuesta_neutra, sin
// clasificar. La clasificación la hace el modelo con la skill
// outreach-escucha, no esta tool.
import { describe, expect, it } from "vitest";
import readReplies from "@/agents/outreach/tools/read_replies";
import { TOOL_LABELS } from "@/lib/agents/running-tool";
import { outreachEvent } from "@/lib/outreach/events";
import { listReplies } from "@/lib/outreach/services/replies";
import {
	contactRow,
	createFakeStore,
	TENANT,
	USER,
} from "../../../outreach/fake-store";

const caller = {
	tenantId: TENANT,
	userId: USER,
	role: "tenant_member",
	email: "ana@innov.test",
};

describe("read_replies", () => {
	it("tiene etiqueta en castellano, como exige el CLAUDE.md", () => {
		expect(TOOL_LABELS.read_replies).toBeTruthy();
		expect(TOOL_LABELS.read_replies).not.toBe("read_replies");
	});

	it("no lleva approval: solo lee", () => {
		expect(readReplies.approval).toBeUndefined();
	});
});

describe("listReplies", () => {
	it("devuelve, sin interpretar, el texto de las respuestas de contactos en respuesta_neutra", async () => {
		const store = createFakeStore();
		const contact = contactRow({
			contactKey: "em:laura@acme.test",
			name: "Laura Gómez",
			company: "Acme",
			stage: "respuesta_neutra",
		});
		store.contacts.push(contact);
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: contact.contactKey,
				type: "respuesta",
				summary: "Gracias, lo vemos la semana que viene y te contamos.",
				payload: { gmail_message_id: "m1" },
			}),
		]);

		const result = await listReplies({ caller }, { store });

		expect(result).toEqual({
			ok: true,
			respuestas: [
				{
					contactKey: "em:laura@acme.test",
					nombre: "Laura Gómez",
					empresa: "Acme",
					texto: "Gracias, lo vemos la semana que viene y te contamos.",
					fecha: expect.any(String),
				},
			],
		});
	});

	it("no incluye contactos que ya avanzaron de etapa, aunque tengan eventos de respuesta", async () => {
		const store = createFakeStore();
		const contact = contactRow({
			contactKey: "em:diego@acme.test",
			stage: "en_conversacion",
		});
		store.contacts.push(contact);
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: contact.contactKey,
				type: "respuesta",
				summary: "Sí, me interesa, hablemos.",
				payload: {},
			}),
		]);

		const result = await listReplies({ caller }, { store });

		expect(result.respuestas).toEqual([]);
	});

	it("no incluye contactos en respuesta_neutra sin ningún evento de respuesta", async () => {
		const store = createFakeStore();
		store.contacts.push(
			contactRow({
				contactKey: "em:sin-evento@acme.test",
				stage: "respuesta_neutra",
			}),
		);

		const result = await listReplies({ caller }, { store });

		expect(result.respuestas).toEqual([]);
	});

	it("no mezcla respuestas de otro tenant", async () => {
		const store = createFakeStore();
		const contact = contactRow({
			tenantId: "otro-tenant",
			contactKey: "em:otro@acme.test",
			stage: "respuesta_neutra",
		});
		store.contacts.push(contact);
		await store.insertEvents([
			outreachEvent({
				tenant_id: "otro-tenant",
				actor_user_id: null,
				contact_key: contact.contactKey,
				type: "respuesta",
				summary: "No debería aparecer.",
				payload: {},
			}),
		]);

		const result = await listReplies({ caller }, { store });

		expect(result.respuestas).toEqual([]);
	});

	it("incluye cada evento de respuesta por separado cuando un contacto respondió más de una vez sin clasificarse", async () => {
		const store = createFakeStore();
		const contact = contactRow({
			contactKey: "em:laura@acme.test",
			stage: "respuesta_neutra",
		});
		store.contacts.push(contact);
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: contact.contactKey,
				type: "respuesta",
				summary: "Ahora no, más adelante.",
				payload: {},
			}),
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: contact.contactKey,
				type: "respuesta",
				summary: "Che, dale, mandame más info.",
				payload: {},
			}),
		]);

		const result = await listReplies({ caller }, { store });

		expect(result.respuestas.map((r) => r.texto)).toEqual([
			"Ahora no, más adelante.",
			"Che, dale, mandame más info.",
		]);
	});
});
