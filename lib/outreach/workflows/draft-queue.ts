// Workflow draft-queue (spec etapa 13 §4.1 y D17 de esta entrega): redacta,
// verifica el ancla, encola. El cupo diario del ejecutor (executors.daily_quota)
// se chequea ANTES de redactar. Sin cupo, el ítem de HOY se refusa
// (terminal para esa fecha) y el propio seed() vuelve a sembrar mañana.

import type { PassContext, WorkflowImpl } from "../../workflows/runner";
import type { ItemOutcome, WorkItem } from "../../workflows/types";
import { isRefusal, refuse } from "../result";

function todayIso(now: Date): string {
	return now.toISOString().slice(0, 10);
}

function parseHash(inputHash: string): { contactId: string; date: string } {
	const [contactId, , date] = inputHash.split(":");
	return { contactId, date: date ?? todayIso(new Date()) };
}

export interface DraftQueueDeps {
	/** `contacts.owner_user_id` de este contacto. */
	ownerOf: (contactId: string) => Promise<string | null>;
	/** `executors.daily_quota` de ese ejecutor. */
	quotaFor: (executorUserId: string) => Promise<number>;
	/** Piezas ya encoladas hoy por ese ejecutor (desde la medianoche del tenant). */
	queuedToday: (executorUserId: string) => Promise<number>;
	/** Contactos `contacto_listo` sin pieza viva, para el sembrador diario. */
	listReady?: () => Promise<{ contactId: string; contactKey: string }[]>;
	draft: (contactId: string) => Promise<
		| {
				ok: true;
				subject: string;
				body: string;
				ancla: { hecho: string; fuente: string };
		  }
		| { ok: false; reason: string; message: string }
	>;
	verify: (ancla: {
		hecho: string;
		fuente: string;
	}) => Promise<{ verified: boolean; confidence: number }>;
	queue: (
		contactId: string,
		draft: {
			subject: string;
			body: string;
			ancla: { hecho: string; fuente: string };
		},
	) => Promise<
		| { ok: true; queueItemId: string }
		| { ok: false; reason: string; message: string }
	>;
}

export function createDraftQueueWorkflow(deps: DraftQueueDeps): WorkflowImpl {
	return {
		...(deps.listReady
			? {
					async seed(_tenantId: string, now: Date) {
						const ready = (await deps.listReady?.()) ?? [];
						const date = todayIso(now);
						return ready.map((c) => ({
							subjectId: c.contactId,
							inputHash: `${c.contactId}:msg1:${date}`,
						}));
					},
				}
			: {}),

		async runItem(item: WorkItem, _ctx: PassContext): Promise<ItemOutcome> {
			const { contactId } = parseHash(item.inputHash);

			const ownerUserId = await deps.ownerOf(contactId);
			if (!ownerUserId) {
				return refuse("sin_dueno", "este contacto no tiene ejecutor asignado");
			}
			const [quota, queuedToday] = await Promise.all([
				deps.quotaFor(ownerUserId),
				deps.queuedToday(ownerUserId),
			]);
			if (queuedToday >= quota) {
				return refuse(
					"cupo_agotado",
					`el ejecutor ya encoló ${queuedToday} piezas hoy (cupo ${quota}): se reintenta mañana`,
				);
			}

			const drafted = await deps.draft(contactId);
			if (isRefusal(drafted)) return drafted;

			const verified = await deps.verify(drafted.ancla);
			if (!verified.verified) {
				return refuse(
					"ancla_no_verificada",
					`la fuente no respalda el hecho citado (confianza ${verified.confidence.toFixed(2)})`,
				);
			}

			const queued = await deps.queue(contactId, drafted);
			if (isRefusal(queued)) return queued;

			return { ok: true };
		},
	};
}
