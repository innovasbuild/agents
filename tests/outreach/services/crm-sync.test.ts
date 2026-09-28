import { describe, expect, it } from "vitest";
import type { CrmContactCheck } from "@/lib/connectors/crm/adapter";
import type { OutreachEventInsert } from "@/lib/outreach/events";
import { runCrmSync } from "@/lib/outreach/services/crm-sync";
import type {
	ContactPatch,
	ContactRow,
	ExecutorRow,
} from "@/lib/outreach/store";
import { fakeCrm } from "../fake-store";

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
	notesByContact?: Record<
		string,
		{ id: string; body: string; at: Date; ownerId: string | null }[]
	>;
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
		updateContact: async (
			tenantId: string,
			id: string,
			patch: ContactPatch,
		) => {
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
				payload: expect.objectContaining({
					hubspot_owner_id: "owner-desconocido",
				}),
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

	it("owner de HubSpot que ya coincide con el local: no genera patch ni evento", async () => {
		const { deps, patches, events } = buildDeps({
			contacts: [contact({ ownerUserId: "user-mati" })],
			executors: [executor({ userId: "user-mati", crmOwnerId: "92296278" })],
			checks: [{ id: "101", found: true, ownerId: "92296278" }],
		});
		const result = await runCrmSync(TENANT, deps);
		expect(result.ownersActualizados).toBe(0);
		expect(patches.find((p) => "ownerUserId" in p.patch)).toBeUndefined();
		expect(events).not.toContainEqual(
			expect.objectContaining({ type: "crm_owner_actualizado" }),
		);
	});

	it("owner sin ejecutor local: el evento crm_sync_pendiente solo se inserta en la primera corrida", async () => {
		const { deps: deps1, events: events1 } = buildDeps({
			contacts: [contact({ ownerUserId: "user-viejo", crmSyncedAt: null })],
			executors: [executor({ crmOwnerId: "otro-owner" })],
			checks: [{ id: "101", found: true, ownerId: "owner-desconocido" }],
		});
		await runCrmSync(TENANT, deps1);
		expect(events1).toContainEqual(
			expect.objectContaining({ type: "crm_sync_pendiente" }),
		);

		const { deps: deps2, events: events2 } = buildDeps({
			contacts: [
				contact({
					ownerUserId: "user-viejo",
					crmSyncedAt: "2026-09-20T00:00:00Z",
				}),
			],
			executors: [executor({ crmOwnerId: "otro-owner" })],
			checks: [{ id: "101", found: true, ownerId: "owner-desconocido" }],
		});
		await runCrmSync(TENANT, deps2);
		expect(events2).not.toContainEqual(
			expect.objectContaining({ type: "crm_sync_pendiente" }),
		);
	});

	it("notas de la propia app (prefijo [out · o [nota ·) no se reimportan como nota entrante", async () => {
		const { deps, events } = buildDeps({
			contacts: [contact({ crmSyncedAt: "2026-09-20T00:00:00Z" })],
			executors: [executor()],
			checks: [{ id: "101", found: true, ownerId: "92296278" }],
			notesByContact: {
				"101": [
					{
						id: "n1",
						body: "[out · msg1 · email · v1 · h1]\n\nAsunto: Hola\n\ncuerpo",
						at: new Date("2026-09-26T09:00:00Z"),
						ownerId: "92296278",
					},
					{
						id: "n2",
						body: "Llamó y quedó en pensarlo",
						at: new Date("2026-09-26T10:00:00Z"),
						ownerId: "92296278",
					},
				],
			},
		});
		const result = await runCrmSync(TENANT, deps);
		expect(result.notasAgregadas).toBe(1);
		const notaEvents = events.filter((e) => e.type === "nota");
		expect(notaEvents).toHaveLength(1);
		expect(notaEvents[0]).toEqual(
			expect.objectContaining({
				summary: expect.stringContaining("Llamó y quedó en pensarlo"),
				payload: expect.objectContaining({ hubspot_note_id: "n2" }),
			}),
		);
	});

	it("un contacto que tira error en listNotesSince no frena a los demás del tenant", async () => {
		const otro = contact({
			id: "c2",
			crmId: "202",
			contactKey: "em:otro@acme.test",
		});
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
