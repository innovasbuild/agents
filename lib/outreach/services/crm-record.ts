// Registros manuales desde el chat (spec 03 §6.4): una respuesta por otro
// canal, una reunión. El estado solo avanza; lo escribe el adapter del CRM.
import type { CrmAdapter } from "../../connectors/crm/adapter";
import { type OutreachEventInsert, outreachEvent } from "../events";
import { isRefusal, type Refusal, refuse } from "../result";
import type { Caller } from "../session";
import { canAdvance, type OutreachStage } from "../stage";
import type { OutreachStore } from "../store";
import { localDate } from "../time";
import { resolveExecutor } from "./executor";
import { claimForContact } from "./queue";

export async function recordCrmUpdate(
	input: {
		caller: Caller;
		contactKey: string;
		stage: OutreachStage | null;
		note: string | null;
	},
	deps: { store: OutreachStore; crm: CrmAdapter | null; now: () => Date },
): Promise<Refusal | { ok: true; crmId: string; stage: OutreachStage }> {
	const { caller } = input;
	if (!deps.crm) return refuse("sin_crm", "este tenant no tiene CRM conectado");
	const resolved = await resolveExecutor(deps.store, caller, deps.crm);
	if (isRefusal(resolved)) return resolved;
	const { executor, tenant } = resolved;

	const [contact] = await deps.store.findContactsByKeys(caller.tenantId, [
		input.contactKey,
	]);
	if (!contact)
		return refuse(
			"contacto_inexistente",
			`no hay un contacto cargado con la clave ${input.contactKey}`,
		);
	// Mismo claim que queue_touch y send_email (spec §5.3): esta tool avanza la
	// etapa y deja nota en el CRM, así que tampoco puede tocar a alguien que
	// trabaja otro ejecutor. Pesa más acá porque su approval es once().
	const claim = await claimForContact(
		deps,
		caller,
		executor.crmOwnerId,
		contact,
	);
	if (claim.status === "ajeno") {
		return refuse(
			"claim_ajeno",
			"esta persona ya la trabaja otro ejecutor (base o última conversación en el CRM de menos de 90 días)",
		);
	}
	if (input.stage && !canAdvance(contact.stage, input.stage)) {
		return refuse(
			"etapa_no_avanza",
			`la escalera no retrocede: ${contact.stage} no puede pasar a ${input.stage}`,
		);
	}
	const fromStage = contact.stage;
	const stage = input.stage ?? fromStage;
	const now = deps.now();
	const crmId = await deps.crm.upsertContact({
		crmId: contact.crmId,
		email: contact.email,
		name: contact.name,
		company: contact.company,
		properties: {
			contact_key: contact.contactKey,
			outreach_status: stage,
			outreach_owner: executor.slug as string,
		},
	});
	if (input.note) {
		await deps.crm.addNote(crmId, {
			body: `[nota · ${localDate(tenant.config.timezone, now)}]\n\n${input.note}`,
			at: now,
			ownerId: executor.crmOwnerId,
		});
	}
	await deps.store.updateContact(caller.tenantId, contact.id, { crmId, stage });
	const events: OutreachEventInsert[] = [];
	if (input.stage && input.stage !== fromStage) {
		events.push(
			outreachEvent({
				tenant_id: caller.tenantId,
				actor_user_id: caller.userId,
				contact_key: contact.contactKey,
				channel: null,
				type: "cambio_etapa",
				summary: `${fromStage} → ${input.stage}`,
				payload: { from: fromStage, to: input.stage, origen: "chat" },
			}),
		);
	}
	if (input.note) {
		events.push(
			outreachEvent({
				tenant_id: caller.tenantId,
				actor_user_id: caller.userId,
				contact_key: contact.contactKey,
				channel: null,
				type: "nota",
				summary: input.note,
				payload: { crm_id: crmId },
			}),
		);
	}
	await deps.store.insertEvents(events);
	return { ok: true, crmId, stage };
}

export async function logModelEvent(
	input: {
		caller: Caller;
		type: "freno" | "nota";
		contactKey: string | null;
		summary: string;
	},
	deps: { store: OutreachStore },
): Promise<{ ok: true }> {
	await deps.store.insertEvents([
		outreachEvent({
			tenant_id: input.caller.tenantId,
			actor_user_id: input.caller.userId,
			contact_key: input.contactKey,
			channel: null,
			type: input.type,
			summary: input.summary,
			payload: { origen: "modelo" },
		}),
	]);
	return { ok: true };
}
