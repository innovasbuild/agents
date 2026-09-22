// Workflow contact-enrichment (spec etapa 13 §4.1 y §5.2): revela el email y
// asegura que la cuenta tenga ficha de research antes de dejarla lista para
// redactar. Sin sembrador: llegan por enqueue() desde icp-scoring.
import type { ItemOutcome, WorkItem } from "../../workflows/types";
import type { PassContext, WorkflowImpl } from "../../workflows/runner";
import { isRefusal } from "../result";
import type { RevealEmailResult } from "../services/reveal-email";

/** Fecha del tenant en YYYY-MM-DD: entra en la huella de draft-queue (D17,
 * cupo diario) para que un reintento de mañana sea un ítem nuevo. */
function todayHash(contactId: string): string {
	const iso = new Date().toISOString().slice(0, 10);
	return `${contactId}:msg1:${iso}`;
}

export interface ContactEnrichmentDeps {
	reveal: (contactId: string) => Promise<RevealEmailResult>;
	/** Asegura la ficha vigente de la cuenta (research si hace falta). Reusa
	 * el nodo outreach/research existente por dentro, en el cableado real. */
	ensureFicha: (
		contactId: string,
	) => Promise<{ ok: true } | { ok: false; reason: string; message: string }>;
	recordCredits: (credits: number, runId: string) => Promise<void>;
}

export function createContactEnrichmentWorkflow(
	deps: ContactEnrichmentDeps,
): WorkflowImpl {
	return {
		async runItem(item: WorkItem, ctx: PassContext): Promise<ItemOutcome> {
			const revealed = await deps.reveal(item.subjectId);
			if (!isRefusal(revealed) && revealed.creditsUsed > 0) {
				await deps.recordCredits(revealed.creditsUsed, ctx.runId);
			}
			if (isRefusal(revealed)) return revealed;

			const ficha = await deps.ensureFicha(item.subjectId);
			if (!ficha.ok) {
				// El email ya se reveló y se guardó (revealContactEmail ya
				// promovió la clave): no se pierde. Sin ficha no hay ancla, así
				// que no avanza a draft-queue todavía. Un research posterior
				// (chat o el sembrador que corresponda) lo destraba.
				return { ok: true };
			}

			return {
				ok: true,
				downstream: [
					{ subjectId: item.subjectId, inputHash: todayHash(item.subjectId) },
				],
			};
		},
	};
}
