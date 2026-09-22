// Cobertura de /focos sobre el fake store: insertFocus, listFocuses y
// funnelForFocus (Task 22), sumada en la ronda de arreglo tras la review.
// Sigue la separación de tests/outreach/store-lecturas.test.ts (por dominio,
// no un archivo único de store).
import { describe, expect, it } from "vitest";
import type { ContactIcp } from "@/lib/outreach/store";
import { createFakeStore, TENANT, USER } from "./fake-store";

function icp(lane: ContactIcp["lane"]): ContactIcp {
	return {
		encaje_empresa: null,
		rol_decisor: null,
		excluir: null,
		lane,
		reason: "test",
		model: "test",
		revision: "2026-09-01",
		judged_at: "2026-09-01T00:00:00Z",
	};
}

const FOCUS_INPUT = {
	tenantId: TENANT,
	createdBy: USER,
	name: "Envases GBA",
	criteria: { employeeRanges: ["50,200"] },
	vector: "v1",
	segment: "s1",
	hook: "h1",
	idioma: "es_ar",
	maxAccounts: 20,
	maxContacts: 60,
};

describe("insertFocus", () => {
	it("crea un foco activo con los contadores en cero", async () => {
		const store = createFakeStore();

		const focus = await store.insertFocus(FOCUS_INPUT);

		expect(focus).toMatchObject({
			tenantId: TENANT,
			createdBy: USER,
			name: "Envases GBA",
			status: "activo",
			accountsFound: 0,
			contactsFound: 0,
		});
	});
});

describe("listFocuses", () => {
	it("devuelve todos los focos del tenant, no solo los activos", async () => {
		const store = createFakeStore();
		const activo = await store.insertFocus(FOCUS_INPUT);
		const agotado = await store.insertFocus({
			...FOCUS_INPUT,
			name: "Foco agotado",
		});
		await store.updateFocus(TENANT, agotado.id, { status: "agotado" });

		const rows = await store.listFocuses(TENANT);

		expect(rows.map((f) => f.id).sort()).toEqual(
			[activo.id, agotado.id].sort(),
		);
		expect(rows.find((f) => f.id === agotado.id)?.status).toBe("agotado");

		// listActiveFocuses, en cambio, sí filtra por status (Task 6): confirma
		// que las dos lecturas no son la misma cosa con otro nombre.
		const activos = await store.listActiveFocuses(TENANT);
		expect(activos.map((f) => f.id)).toEqual([activo.id]);
	});
});

describe("funnelForFocus", () => {
	it("cuenta bien los contactos por carril y las piezas encoladas", async () => {
		const store = createFakeStore();
		const focus = await store.insertFocus(FOCUS_INPUT);

		const calificado = await store.insertDiscoveredContact({
			tenantId: TENANT,
			contactKey: "li:calificado",
			accountId: null,
			ownerUserId: USER,
			searchFocusId: focus.id,
			name: "Calificado",
			company: "Acme",
			title: null,
			linkedinSlug: "calificado",
			segment: "s1",
			vector: "v1",
			hook: "h1",
			idioma: "es_ar",
			externalIds: {},
		});
		const descartado = await store.insertDiscoveredContact({
			tenantId: TENANT,
			contactKey: "li:descartado",
			accountId: null,
			ownerUserId: USER,
			searchFocusId: focus.id,
			name: "Descartado",
			company: "Acme",
			title: null,
			linkedinSlug: "descartado",
			segment: "s1",
			vector: "v1",
			hook: "h1",
			idioma: "es_ar",
			externalIds: {},
		});
		const paraRevisar = await store.insertDiscoveredContact({
			tenantId: TENANT,
			contactKey: "li:para-revisar",
			accountId: null,
			ownerUserId: USER,
			searchFocusId: focus.id,
			name: "Para revisar",
			company: "Acme",
			title: null,
			linkedinSlug: "para-revisar",
			segment: "s1",
			vector: "v1",
			hook: "h1",
			idioma: "es_ar",
			externalIds: {},
		});
		if (
			calificado === "duplicado" ||
			descartado === "duplicado" ||
			paraRevisar === "duplicado"
		) {
			throw new Error("setup del test: contact_key duplicada");
		}

		const setLane = (id: string, lane: ContactIcp["lane"]) => {
			const contact = store.contacts.find((c) => c.id === id);
			if (!contact) throw new Error(`contacto ${id} inexistente`);
			contact.icp = icp(lane);
		};
		setLane(calificado.id, "calificado");
		setLane(descartado.id, "descartado");
		setLane(paraRevisar.id, "para_revisar");

		const calificadoContact = store.contacts.find(
			(c) => c.id === calificado.id,
		);
		if (!calificadoContact) throw new Error("setup del test");
		await store.insertQueueItem({
			tenantId: TENANT,
			contactId: calificadoContact.id,
			contactKey: calificadoContact.contactKey,
			executorUserId: USER,
			kind: "msg1",
			toEmail: "calificado@acme.test",
			subject: "Asunto",
			body: "Cuerpo",
			hook: "h1",
			vector: "v1",
			idioma: "es_ar",
			ancla: { hecho: "Abrió planta", fuente: "https://acme.test/n" },
			draftOriginal: { subject: "Asunto", body: "Cuerpo" },
			gateResult: { status: "ok", violations: [], warnings: [], notes: [] },
			replyToMessageId: null,
			gmailThreadId: null,
		});

		const funnel = await store.funnelForFocus(TENANT, focus.id);

		expect(funnel).toEqual({
			descubiertos: 3,
			calificados: 1,
			descartados: 1,
			paraRevisar: 1,
			// insertDiscoveredContact siembra sin email (spec §9.2: llega recién
			// con reveal-email), así que ninguno de los tres cuenta como
			// enriquecido todavía.
			enriquecidos: 0,
			encolados: 1,
			enviados: 0,
		});
	});

	it("un contacto insertado por insertContact nunca aparece en el embudo de ningún foco", async () => {
		const store = createFakeStore();
		const focus = await store.insertFocus(FOCUS_INPUT);

		// insertContact (a diferencia de insertDiscoveredContact) es el camino
		// de CSV/chat: no pasa por ningún foco, así que el WeakMap interno de
		// search_focus_id nunca lo debería asociar a uno.
		await store.insertContact({
			tenantId: TENANT,
			contactKey: "em:normal@test.com",
			accountId: null,
			name: "Normal",
			company: "Acme",
			email: "normal@test.com",
			linkedinSlug: null,
			crmId: null,
			segment: "s1",
			vector: "v1",
			source: "csv",
		});

		const funnel = await store.funnelForFocus(TENANT, focus.id);

		expect(funnel.descubiertos).toBe(0);
	});
});
