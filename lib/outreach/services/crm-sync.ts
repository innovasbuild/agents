// Sync entrante de HubSpot (spec docs/superpowers/specs/2026-09-27-hubspot-crm-sync-design.md):
// el contacto local es la fuente de verdad, pero HubSpot puede cambiar por
// fuera (se borra un duplicado, se reasigna el owner, se deja una nota a
// mano) y hoy nada se entera. Efecto 0: solo lee de HubSpot y escribe acá.
import type { CrmAdapter } from "../../connectors/crm/adapter";
import { type OutreachEventInsert, outreachEvent } from "../events";
import { NOTA_NOTE_PREFIX, OUT_NOTE_PREFIX } from "../note-prefixes";
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
	if (!check) {
		console.warn(
			`crm-sync: HubSpot no confirmó ni found ni not-found para ${contact.contactKey} (tenant ${tenantId}), se salta`,
		);
		return;
	}

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
			// Solo la primera corrida para este contacto (crm_synced_at null) deja
			// el evento informativo: sin esto, cada corrida (cada 9-15h, para
			// siempre) lo volvería a insertar y ensuciaría "necesita atención"
			// (PROBLEM_TYPES en historial-query.ts) con algo ya avisado.
			if (contact.crmSyncedAt === null) {
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
	}

	const allNotes = await deps.crm.listNotesSince(
		contact.crmId as string,
		contact.crmSyncedAt,
	);
	// Filtra las notas que la propia app ya escribió en HubSpot (al mandar un
	// mail, o desde crm_record en el chat): events es append-only, así que sin
	// este filtro cada mail enviado se reimportaría para siempre como si fuera
	// una nota agregada a mano en HubSpot.
	const notes = allNotes.filter(
		(note) =>
			!note.body.startsWith(OUT_NOTE_PREFIX) &&
			!note.body.startsWith(NOTA_NOTE_PREFIX),
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
