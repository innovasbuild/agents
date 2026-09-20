// Cola de piezas (spec 03 §6.4). Cada operación revalida en el borde: el gate
// vuelve a correr sobre el texto que llega, el claim se chequea contra la
// base y la autoría del CRM, y el ancla se chequea contra la ficha vigente
// (queue_touch puede llegar sin pasar por draft_message).
import type { CrmAdapter } from "../../connectors/crm/adapter";
import {
	type Canon,
	type CanonMissing,
	canonMissingText,
	isCanonMissing,
	loadCanonOrMissing,
} from "../canon";
import { outreachEvent } from "../events";
import { type GateResult, gateSummary, runGate } from "../gate";
import { type ClaimStatus, claimStatus, crmMatch } from "../guards";
import { assignLetters } from "../queue-letters";
import { isRefusal, type Refusal, refuse } from "../result";
import type { Caller } from "../session";
import type { ContactRow, OutreachStore, QueueItemKind } from "../store";
import { findFichaVigente } from "./draft";
import { attributionError, resolveExecutor } from "./executor";

export interface QueueDeps {
	store: OutreachStore;
	crm: CrmAdapter | null;
	loadCanon: (executorSlug: string) => Promise<Canon>;
	now: () => Date;
}

export interface QueueTouchInput {
	caller: Caller;
	contactKey: string;
	kind: QueueItemKind;
	subject: string;
	body: string;
	hook: string;
	vector: string;
	idioma: string;
	// La base solo exige ancla para kind = 'msg1': un follow-up responde dentro
	// del hilo, no abre con un hecho citado de la ficha.
	ancla?: { hecho: string; fuente: string } | null;
	replyToMessageId?: string | null;
	gmailThreadId?: string | null;
}

export async function claimForContact(
	deps: { crm: CrmAdapter | null; now: () => Date },
	caller: Caller,
	executorCrmOwnerId: string | null,
	contact: ContactRow,
): Promise<{ status: ClaimStatus; crmId: string | null }> {
	let crmId = contact.crmId;
	let authorship = null;
	if (deps.crm) {
		const query = {
			contactKey: contact.contactKey,
			email: contact.email,
			linkedinSlug: contact.linkedinSlug,
		};
		crmId =
			crmId ?? crmMatch(await deps.crm.findContacts(query), query)?.id ?? null;
		if (crmId) authorship = await deps.crm.lastAuthorship(crmId);
	}
	const status = claimStatus({
		ownerUserId: contact.ownerUserId,
		executorUserId: caller.userId,
		executorCrmOwnerId,
		crmAuthorship: authorship,
		now: deps.now(),
	});
	return { status, crmId };
}

async function gateFor(
	deps: QueueDeps,
	executorSlug: string,
	subject: string,
	body: string,
	idioma: string,
): Promise<GateResult | CanonMissing> {
	const canon = await loadCanonOrMissing(deps.loadCanon, executorSlug);
	return isCanonMissing(canon)
		? canon
		: runGate({ subject, body, channel: "email", idioma, rules: canon.rules });
}

/** Mensaje citable si no hay ficha vigente o la fuente del ancla no sale de
 * ella; null si el ancla es válida. El modelo puede llamar queue_touch sin
 * pasar por draft_message, así que el ancla se revalida acá con la misma
 * lógica que usa draftMessage para encontrar la ficha. */
async function anchorError(
	deps: Pick<QueueDeps, "store" | "now">,
	tenantId: string,
	email: string,
	fuente: string,
): Promise<string | null> {
	const { domain, account } = await findFichaVigente(
		deps.store,
		tenantId,
		email,
		deps.now(),
	);
	if (!account) {
		return `no hay ficha vigente de ${domain ?? "la empresa de este contacto"}: corré research_account antes de encolar`;
	}
	const anchorUrls = new Set(
		account.ficha.hechos
			.map((h) => h.url)
			.filter((url) => url.trim().length > 0),
	);
	if (!anchorUrls.has(fuente)) {
		return "el ancla no sale de la ficha vigente: la fuente tiene que ser una de las URLs de sus hechos";
	}
	return null;
}

const canonDown = (canon: CanonMissing) =>
	refuse(
		"canon_no_disponible",
		`${canonMissingText(canon)}: sin sus vetos no encolo`,
	);

export async function queueTouch(
	input: QueueTouchInput,
	deps: QueueDeps,
): Promise<Refusal | { ok: true; queueItemId: string }> {
	const { caller } = input;
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
	if (!contact.email) return refuse("sin_email", "el contacto no tiene email");
	if (contact.stage !== "a_contactar" || contact.touches > 0) {
		return refuse(
			"etapa_incompatible",
			`el contacto está en ${contact.stage}: el primer mensaje es solo para a_contactar`,
		);
	}
	const attribution = attributionError(tenant, input);
	if (attribution) return refuse("atribucion_invalida", attribution);

	// El ancla solo la exige el primer mensaje: un follow-up no abre con un
	// hecho nuevo de la ficha, responde dentro del hilo ya abierto.
	if (input.kind === "msg1") {
		const anchor = await anchorError(
			deps,
			caller.tenantId,
			contact.email,
			input.ancla?.fuente ?? "",
		);
		if (anchor) return refuse("sin_ancla", anchor);
	}

	const claim = await claimForContact(
		deps,
		caller,
		executor.crmOwnerId,
		contact,
	);
	if (claim.status === "ajeno") {
		await deps.store.insertEvents([
			outreachEvent({
				tenant_id: caller.tenantId,
				actor_user_id: caller.userId,
				contact_key: contact.contactKey,
				type: "claim_ajeno",
				summary: "al encolar",
				payload: { crm_id: claim.crmId },
			}),
		]);
		return refuse(
			"claim_ajeno",
			"esta persona ya la trabaja otro ejecutor (base o última conversación en el CRM de menos de 90 días)",
		);
	}

	const gate = await gateFor(
		deps,
		executor.slug as string,
		input.subject,
		input.body,
		input.idioma,
	);
	if (isCanonMissing(gate)) return canonDown(gate);
	if (gate.status !== "ok") {
		// gate_fallido tiene dedup de 2 h por contacto y ejecutor, y su payload no
		// trae queue_item_id: un segundo fallo del mismo contacto en ese lapso no
		// queda en events. Aceptado en la Entrega 3; sacarlo del dedup pide migración.
		await deps.store.insertEvents([
			outreachEvent({
				tenant_id: caller.tenantId,
				actor_user_id: caller.userId,
				contact_key: contact.contactKey,
				type: "gate_fallido",
				summary: gateSummary(gate).slice(0, 400),
				payload: { gate },
			}),
		]);
		return {
			...refuse("gate", `la pieza no pasa el gate: ${gateSummary(gate)}`),
			violations: gate.violations,
		} as Refusal;
	}

	const item = await deps.store.insertQueueItem({
		tenantId: caller.tenantId,
		contactId: contact.id,
		contactKey: contact.contactKey,
		executorUserId: caller.userId,
		kind: input.kind,
		toEmail: contact.email,
		subject: input.subject,
		body: input.body,
		hook: input.hook,
		vector: input.vector,
		idioma: input.idioma,
		ancla: input.ancla ?? null,
		draftOriginal: { subject: input.subject, body: input.body },
		gateResult: gate,
		replyToMessageId: input.replyToMessageId ?? null,
		gmailThreadId: input.gmailThreadId ?? null,
	});
	if (item === "pieza_viva")
		return refuse("pieza_viva", "esta persona ya tiene una pieza en la cola");

	await deps.store.updateContact(caller.tenantId, contact.id, {
		ownerUserId: contact.ownerUserId ?? caller.userId,
		crmId: claim.crmId,
		hook: input.hook,
		vector: input.vector,
		idioma: input.idioma,
	});
	await deps.store.insertEvents([
		outreachEvent({
			tenant_id: caller.tenantId,
			actor_user_id: caller.userId,
			contact_key: contact.contactKey,
			type: "encolado",
			summary: input.subject,
			payload: {
				queue_item_id: item.id,
				kind: input.kind,
				hook: input.hook,
				vector: input.vector,
			},
		}),
	]);
	return { ok: true, queueItemId: item.id };
}

export async function listQueue(
	input: { caller: Caller },
	deps: Pick<QueueDeps, "store">,
) {
	// "approved" son piezas trabadas entre el claim de send_email y el envío
	// (turno cancelado, timeout, deploy): no hay tool para destrabarlas —
	// reencolar arriesgaría un segundo mail si el de Gmail sí salió — así que
	// se muestran junto a las pending para que el ejecutor las revise a mano.
	const items = await deps.store.listQueue(
		input.caller.tenantId,
		input.caller.userId,
		["pending", "approved"],
	);
	const lettered = assignLetters(
		items.map((item) => ({ ...item, created_at: item.createdAt })),
	);
	return {
		ok: true as const,
		items: lettered.map((item) => ({
			letter: item.letter,
			queueItemId: item.id,
			contactKey: item.contactKey,
			kind: item.kind,
			to: item.toEmail,
			subject: item.subject,
			body: item.body,
			hook: item.hook,
			vector: item.vector,
			expiresAt: item.expiresAt,
			gate: item.gateResult.status,
			trabada: item.status === "approved",
			approvedAt: item.approvedAt,
			// Por qué quedó trabada, si se sabe: `envio_incierto: …` lo escribe
			// sendQueuedEmail. null es una traba sin rastro (turno cancelado, deploy).
			error: item.error,
		})),
	};
}

export async function updateQueueItem(
	input: { caller: Caller; queueItemId: string; subject: string; body: string },
	deps: QueueDeps,
): Promise<Refusal | { ok: true; queueItemId: string }> {
	const { caller } = input;
	const item = await deps.store.getQueueItem(
		caller.tenantId,
		input.queueItemId,
	);
	if (!item)
		return refuse("pieza_inexistente", "no encuentro esa pieza en la cola");
	if (item.executorUserId !== caller.userId)
		return refuse(
			"no_es_tu_pieza",
			"solo quien encoló la pieza puede editarla",
		);
	if (item.status !== "pending")
		return refuse("ya_no_pendiente", `la pieza está en ${item.status}`);
	const executor = await deps.store.loadExecutor(
		caller.tenantId,
		caller.userId,
	);
	if (!executor?.slug)
		return refuse("no_ejecutor", "no sos ejecutor de outreach en este tenant");

	const gate = await gateFor(
		deps,
		executor.slug,
		input.subject,
		input.body,
		item.idioma,
	);
	if (isCanonMissing(gate)) return canonDown(gate);
	if (gate.status !== "ok") {
		return {
			...refuse("gate", `la edición no pasa el gate: ${gateSummary(gate)}`),
			violations: gate.violations,
		} as Refusal;
	}
	const updated = await deps.store.transitionQueueItem(
		caller.tenantId,
		item.id,
		"pending",
		{
			subject: input.subject,
			body: input.body,
			gateResult: gate,
		},
	);
	if (!updated)
		return refuse(
			"ya_no_pendiente",
			"la pieza cambió de estado mientras la editabas",
		);
	await deps.store.insertEvents([
		outreachEvent({
			tenant_id: caller.tenantId,
			actor_user_id: caller.userId,
			contact_key: item.contactKey,
			type: "pieza_editada",
			summary: input.subject,
			payload: { queue_item_id: item.id },
		}),
	]);
	return { ok: true, queueItemId: item.id };
}

export async function rejectQueueItem(
	input: { caller: Caller; queueItemId: string; reason: string },
	deps: Pick<QueueDeps, "store" | "now">,
): Promise<Refusal | { ok: true; queueItemId: string }> {
	const { caller } = input;
	const item = await deps.store.getQueueItem(
		caller.tenantId,
		input.queueItemId,
	);
	if (!item)
		return refuse("pieza_inexistente", "no encuentro esa pieza en la cola");
	if (item.executorUserId !== caller.userId)
		return refuse(
			"no_es_tu_pieza",
			"solo quien encoló la pieza puede descartarla",
		);
	const rejected = await deps.store.transitionQueueItem(
		caller.tenantId,
		item.id,
		"pending",
		{
			status: "rejected",
			error: input.reason.slice(0, 500),
		},
	);
	if (!rejected)
		return refuse("ya_no_pendiente", `la pieza está en ${item.status}`);
	const [contact] = await deps.store.findContactsByKeys(caller.tenantId, [
		item.contactKey,
	]);
	if (
		contact &&
		contact.touches === 0 &&
		contact.ownerUserId === caller.userId
	) {
		await deps.store.updateContact(caller.tenantId, contact.id, {
			ownerUserId: null,
		});
	}
	await deps.store.insertEvents([
		outreachEvent({
			tenant_id: caller.tenantId,
			actor_user_id: caller.userId,
			contact_key: item.contactKey,
			type: "rechazado",
			summary: input.reason,
			payload: { queue_item_id: item.id },
		}),
	]);
	return { ok: true, queueItemId: item.id };
}
