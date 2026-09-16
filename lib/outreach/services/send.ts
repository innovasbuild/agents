// send_email sobre la cola (spec 03 §7). Lo aprobado es lo enviado; la
// transición pending → approved es la idempotencia; después de enviar nada
// pausa ni reenvía.
import type { CrmAdapter } from "../../connectors/crm/adapter";
import {
	type Canon,
	canonMissingText,
	isCanonMissing,
	loadCanonOrMissing,
} from "../canon";
import { outreachEvent } from "../events";
import { gateSummary, runGate } from "../gate";
import { canTouch, MAILBOX_GUARD_DAYS, TOUCH_REASON_TEXT } from "../guards";
import { isRefusal, type Refusal, refuse } from "../result";
import type { Caller } from "../session";
import { canAdvance, nextFollowup, type OutreachStage } from "../stage";
import type { ContactRow, OutreachStore, QueueItemRow } from "../store";
import { dayStart, localDate } from "../time";
import { resolveExecutor } from "./executor";
import { claimForContact } from "./queue";

export interface SendDeps {
	store: OutreachStore;
	crm: CrmAdapter | null;
	crmAfterSend: CrmAdapter | null;
	loadCanon: (executorSlug: string) => Promise<Canon>;
	sendMail: (mail: {
		to: string;
		subject: string;
		body: string;
		bcc: string | null;
		messageId: string;
	}) => Promise<{ id: string; threadId: string }>;
	isMailUnauthorized: (error: unknown) => boolean;
	/** ¿El error es "no hubo respuesta de Gmail"? Ver el catch del envío. */
	isMailUnknownOutcome: (error: unknown) => boolean;
	now: () => Date;
}

export interface SendInput {
	caller: Caller;
	sessionId: string;
	callId: string;
	queueItemId: string;
	to: string;
	subject: string;
	body: string;
}

export type SendResult =
	| Refusal
	| {
			ok: true;
			queueItemId: string;
			gmailMessageId: string;
			threadId: string;
			crm: "ok" | "pendiente" | "sin_crm";
	  };

const DAY_MS = 86_400_000;

export async function sendQueuedEmail(
	input: SendInput,
	deps: SendDeps,
): Promise<SendResult> {
	const { caller } = input;
	const resolved = await resolveExecutor(deps.store, caller, deps.crm);
	if (isRefusal(resolved)) return resolved;
	const { executor, tenant } = resolved;

	const item = await deps.store.getQueueItem(
		caller.tenantId,
		input.queueItemId,
	);
	if (!item)
		return refuse("pieza_inexistente", "no encuentro esa pieza en la cola");
	if (item.executorUserId !== caller.userId) {
		return refuse(
			"no_es_tu_pieza",
			"solo quien encoló la pieza puede enviarla",
		);
	}
	if (item.status !== "pending") {
		return refuse(
			"ya_tomada",
			`la pieza ya no está pendiente (${item.status})`,
		);
	}
	if (
		item.toEmail !== input.to.toLowerCase() ||
		item.subject !== input.subject ||
		item.body !== input.body
	) {
		return refuse(
			"pieza_cambiada",
			"la pieza cambió desde que se pidió la aprobación: volvé a leerla con list_queue y pedí aprobación con el texto actual",
		);
	}

	const now = deps.now();
	const claimed = await deps.store.transitionQueueItem(
		caller.tenantId,
		item.id,
		"pending",
		{
			status: "approved",
			approvedAt: now.toISOString(),
			eveSessionId: input.sessionId,
			approvalCallId: input.callId,
		},
	);
	if (!claimed) return refuse("ya_tomada", "otra llamada ya tomó esta pieza");

	const backToPending = () =>
		deps.store.transitionQueueItem(caller.tenantId, item.id, "approved", {
			status: "pending",
		});
	const finish = async (
		status: "failed" | "expired" | "pending",
		reason: string,
		message: string,
	) => {
		await deps.store.transitionQueueItem(
			caller.tenantId,
			item.id,
			"approved",
			status === "pending" ? { status } : { status, error: reason },
		);
		if (status === "failed") {
			await deps.store.insertEvents([
				outreachEvent({
					tenant_id: caller.tenantId,
					actor_user_id: caller.userId,
					contact_key: item.contactKey,
					type: "envio_fallido",
					summary: message.slice(0, 400),
					payload: { queue_item_id: item.id, reason },
				}),
			]);
		}
		return refuse(reason, message);
	};

	let contact: ContactRow;
	let crmId: string | null;
	try {
		const [found] = await deps.store.findContactsByKeys(caller.tenantId, [
			item.contactKey,
		]);
		if (!found) {
			return await finish(
				"failed",
				"contacto_inexistente",
				"el contacto de la pieza ya no existe",
			);
		}
		contact = found;

		const claim = await claimForContact(
			deps,
			caller,
			executor.crmOwnerId,
			contact,
		);
		if (claim.status === "ajeno") {
			return await finish(
				"failed",
				"claim_ajeno",
				"esta persona pasó a trabajarla otro ejecutor",
			);
		}
		crmId = claim.crmId;

		const canon = await loadCanonOrMissing(
			deps.loadCanon,
			executor.slug as string,
		);
		if (isCanonMissing(canon)) {
			return await finish(
				"pending",
				"canon_no_disponible",
				`${canonMissingText(canon)}: la pieza sigue pendiente, ${
					canon.missing === "brain_caido"
						? "probá de nuevo en un rato"
						: "avisale a quien administra el tenant"
				}`,
			);
		}
		const gate = runGate({
			subject: item.subject,
			body: item.body,
			channel: "email",
			idioma: item.idioma,
			rules: canon.rules,
		});
		if (gate.status !== "ok") {
			return await finish(
				"failed",
				"gate",
				`la pieza ya no pasa el gate: ${gateSummary(gate)}`,
			);
		}

		const today = dayStart(tenant.config.timezone, now);
		const [byExecutor, toRecipientToday, mailbox] = await Promise.all([
			deps.store.countSent(caller.tenantId, {
				since: today,
				executorUserId: caller.userId,
			}),
			deps.store.countSent(caller.tenantId, {
				since: today,
				toEmail: item.toEmail,
			}),
			deps.store.countSent(caller.tenantId, {
				since: new Date(now.getTime() - MAILBOX_GUARD_DAYS * DAY_MS),
				toEmail: item.toEmail,
				excludeThreadId: item.gmailThreadId,
			}),
		]);
		const verdict = canTouch({
			now,
			expiresAt: new Date(item.expiresAt),
			touches: contact.touches,
			sentTodayToRecipient: toRecipientToday.count > 0,
			sentTodayByExecutor: byExecutor.count,
			dailyQuota: executor.dailyQuota,
			lastSentToRecipientOutsideThreadAt: mailbox.lastSentAt,
		});
		if (!verdict.ok) {
			const status =
				verdict.reason === "vencida"
					? "expired"
					: verdict.transient
						? "pending"
						: "failed";
			return await finish(
				status,
				verdict.reason,
				TOUCH_REASON_TEXT[verdict.reason],
			);
		}
	} catch (error) {
		await backToPending();
		throw error;
	}

	let sent: { id: string; threadId: string };
	try {
		const senderDomain = caller.email.split("@")[1] || "outreach.local";
		sent = await deps.sendMail({
			to: item.toEmail,
			subject: item.subject,
			body: item.body,
			bcc: tenant.config.bcc,
			messageId: `<qi-${item.id}@${senderDomain}>`,
		});
	} catch (error) {
		if (deps.isMailUnauthorized(error)) {
			await backToPending();
			throw error;
		}
		if (deps.isMailUnknownOutcome(error)) {
			// Sin respuesta de Gmail el mail pudo haber salido: si la pieza volviera
			// a pending o quedara failed se libera el contacto y se puede reenviar.
			// Queda approved (trabada), que ya tiene su carril en list_queue y en el
			// resumen de sesión, para que lo resuelva una persona mirando Gmail.
			return refuse(
				"envio_incierto",
				"no hubo respuesta de Gmail y no se sabe si el mail salió: la pieza queda trabada. Revisá en Gmail si el mail salió antes de reintentar.",
			);
		}
		return finish(
			"failed",
			"envio_fallido",
			`Gmail no aceptó el envío: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!sent?.id || !sent?.threadId) {
		return finish(
			"failed",
			"sin_confirmacion",
			"Gmail no confirmó el envío: no se registra como enviado",
		);
	}

	// Desde acá el mail ya salió: registrar sin pausar ni relanzar.
	await deps.store.transitionQueueItem(caller.tenantId, item.id, "approved", {
		status: "sent",
		sentAt: now.toISOString(),
		gmailMessageId: sent.id,
		gmailThreadId: sent.threadId,
	});
	const touches = contact.touches + 1;
	const firstTouchAt =
		item.kind === "msg1"
			? now
			: contact.firstTouchAt
				? new Date(contact.firstTouchAt)
				: now;
	const stage: OutreachStage =
		item.kind === "msg1" && canAdvance(contact.stage, "msg1_enviado")
			? "msg1_enviado"
			: contact.stage;
	const nextStep = nextFollowup({ touches, firstTouchAt });
	await deps.store.updateContact(caller.tenantId, contact.id, {
		touches,
		lastTouchAt: now.toISOString(),
		stage,
		nextStepAt: nextStep ? nextStep.toISOString() : null,
		...(item.kind === "msg1"
			? { firstTouchAt: now.toISOString(), gmailThreadId: sent.threadId }
			: {}),
	});
	await deps.store.insertEvents([
		outreachEvent({
			tenant_id: caller.tenantId,
			actor_user_id: caller.userId,
			contact_key: item.contactKey,
			type: "envio",
			summary: item.subject,
			payload: {
				queue_item_id: item.id,
				gmail_message_id: sent.id,
				kind: item.kind,
				hook: item.hook,
				vector: item.vector,
			},
		}),
	]);

	const crm = await recordInCrm({
		deps,
		caller,
		executor: {
			slug: executor.slug as string,
			crmOwnerId: executor.crmOwnerId,
		},
		item,
		contact,
		crmId,
		stage,
		nextStep,
		now,
		timezone: tenant.config.timezone,
	});
	return {
		ok: true,
		queueItemId: item.id,
		gmailMessageId: sent.id,
		threadId: sent.threadId,
		crm,
	};
}

async function recordInCrm(args: {
	deps: SendDeps;
	caller: Caller;
	executor: { slug: string; crmOwnerId: string | null };
	item: QueueItemRow;
	contact: ContactRow;
	crmId: string | null;
	stage: OutreachStage;
	nextStep: Date | null;
	now: Date;
	timezone: string;
}): Promise<"ok" | "pendiente" | "sin_crm"> {
	const { deps, caller, executor, item, contact, now } = args;
	const crm = deps.crmAfterSend;
	if (!crm) return "sin_crm";
	const properties: Record<string, string> = {
		contact_key: contact.contactKey,
		...(contact.segment ? { outreach_segmento: contact.segment } : {}),
		outreach_canal: "email",
		outreach_hook: item.hook,
		outreach_vector: item.vector,
		outreach_idioma: item.idioma,
		outreach_status: args.stage,
		outreach_owner: executor.slug,
		...(item.kind === "msg1"
			? { outreach_fecha_msg1: localDate(args.timezone, now) }
			: {}),
	};
	try {
		const crmId = await crm.upsertContact({
			crmId: args.crmId,
			email: contact.email,
			name: contact.name,
			company: contact.company,
			properties,
		});
		await crm.addNote(crmId, {
			body: `[out · ${item.kind} · email · ${item.vector} · ${item.hook}]\n\nAsunto: ${item.subject}\n\n${item.body}`,
			at: now,
			ownerId: executor.crmOwnerId,
		});
		await crm.completeOpenTasks(crmId);
		if (args.nextStep) {
			await crm.createTask(crmId, {
				title: `Outreach: siguiente toque a ${contact.name ?? contact.email}`,
				dueAt: args.nextStep,
				ownerId: executor.crmOwnerId,
			});
		}
		if (crmId !== contact.crmId) {
			await deps.store.updateContact(caller.tenantId, contact.id, { crmId });
		}
		return "ok";
	} catch (error) {
		await deps.store.insertEvents([
			outreachEvent({
				tenant_id: caller.tenantId,
				actor_user_id: caller.userId,
				contact_key: contact.contactKey,
				type: "crm_sync_pendiente",
				summary: "registro en el CRM después del envío",
				payload: {
					queue_item_id: item.id,
					error: (error instanceof Error ? error.message : String(error)).slice(
						0,
						500,
					),
				},
			}),
		]);
		return "pendiente";
	}
}
