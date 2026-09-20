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
		// Deal solo nace al pasar a conversación o reunión agendada (CLAUDE.md
		// § Reglas de escritura 6). La etapa ya quedó persistida arriba, así que
		// un fallo acá no puede tumbarla: se registra y se sigue (mismo criterio
		// que recordInCrm en send.ts para los fallos del CRM después del efecto
		// que no se puede perder).
		if (
			input.stage === "en_conversacion" ||
			input.stage === "reunion_agendada"
		) {
			try {
				const open = await deps.crm.listOpenDeals(crmId);
				// Un deal duplicado en HubSpot hay que borrarlo a mano: el MCP no
				// fusiona ni borra registros.
				if (open.length === 0) {
					const deal = await deps.crm.createDeal({
						contactCrmId: crmId,
						companyCrmId: null,
						name: `En Paralelo · ${contact.company ?? contact.name ?? contact.contactKey}`,
						description: `vector: ${contact.vector ?? "-"} · hook: ${contact.hook ?? "-"} · canal: email`,
						ownerId: executor.crmOwnerId as string,
					});
					events.push(
						outreachEvent({
							tenant_id: caller.tenantId,
							actor_user_id: caller.userId,
							contact_key: contact.contactKey,
							channel: null,
							type: "deal_creado",
							summary: `deal ${deal.id} creado al pasar a ${input.stage}`,
							payload: { deal_id: deal.id, crm_id: crmId, stage: input.stage },
						}),
					);
				}
			} catch (error) {
				events.push(
					outreachEvent({
						tenant_id: caller.tenantId,
						actor_user_id: caller.userId,
						contact_key: contact.contactKey,
						channel: null,
						type: "crm_sync_pendiente",
						summary: "no se pudo crear el deal en HubSpot",
						payload: {
							crm_id: crmId,
							error: (error instanceof Error
								? error.message
								: String(error)
							).slice(0, 500),
						},
					}),
				);
			}
		}
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
