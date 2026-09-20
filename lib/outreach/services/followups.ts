// Encola los follow-ups vencidos (Etapa 5, segunda mitad del cierre: el
// morning-sweep detecta respuestas de la mañana; este schedule deja el
// follow-up del día en /cola). Pura salvo las deps inyectadas, mismo patrón
// que lib/outreach/services/sweep.ts: aislamiento de fallos por niveles, sin
// ninguna dep de envío.
//
// **No recibe ninguna dependencia de envío.** No es una omisión: es la
// garantía estructural de que este schedule no manda mail. `draftAndQueue`
// deja la pieza `pending`; aprobarla y mandarla es otra tool, con otro humano
// en el medio.
// Imports relativos y no "@/": este módulo lo arrastra un schedule de eve, que
// no resuelve los paths de tsconfig (mismo motivo que lib/agents/channel-context.ts).
import { type OutreachEventInsert, outreachEvent } from "../events";
import { isRefusal, type Refusal } from "../result";
import type { ContactRow, QueueItemKind } from "../store";

export interface FollowupsTenant {
	id: string;
	slug: string;
}

/** Lo mínimo que necesita el follow-up de un contacto vencido: el resto del
 * filtro (touches < 3, sin respuesta, next_step_at vencido) ya lo hizo
 * `listDueFollowups` del lado de la base. */
export type FollowupsDueContact = Pick<
	ContactRow,
	"contactKey" | "gmailThreadId" | "touches"
>;

/** Lo mínimo de un contacto agotado: el filtro (touches >= 3, sin respuesta,
 * first_touch_at viejo) ya lo hizo `listExhaustedContacts`. */
export type FollowupsExhaustedContact = Pick<
	ContactRow,
	"contactKey" | "crmId"
>;

export interface FollowupsStore {
	listActiveTenants(): Promise<FollowupsTenant[]>;
	listDueFollowups(tenantId: string, now: Date): Promise<FollowupsDueContact[]>;
	/** Opcional en el tipo porque no todo caller (ni todo test) necesita el
	 * freno de oportunidades: sin ella, esa mitad simplemente no corre. */
	listExhaustedContacts?(
		tenantId: string,
		now: Date,
	): Promise<FollowupsExhaustedContact[]>;
	insertEvents?(rows: readonly OutreachEventInsert[]): Promise<void>;
}

export interface DraftAndQueueInput {
	tenantId: string;
	contactKey: string;
	kind: QueueItemKind;
	gmailThreadId: string;
}

export type DraftAndQueueResult = Refusal | { ok: true; queueItemId?: string };

export interface ListOpenDealsInput {
	tenantId: string;
	contactKey: string;
	crmId: string;
}

export interface FollowupsDeps {
	store: FollowupsStore;
	/** Envuelve draftMessage + queueTouch (Task 7): arma el caller del
	 * ejecutor dueño del contacto, resuelve el replyToMessageId contra Gmail
	 * (Task 2) y encola. Vive en el cableado del schedule, no acá. */
	draftAndQueue(input: DraftAndQueueInput): Promise<DraftAndQueueResult>;
	/** Sin ella, el freno de oportunidades (Task 6) no corre: un contacto
	 * agotado nunca se marca `oportunidad_frenada`. */
	listOpenDeals?(
		input: ListOpenDealsInput,
	): Promise<{ id: string; stage: string }[]>;
	now(): Date;
}

export interface FollowupsResult {
	encoladas: number;
	salteadas: { contactKey: string; motivo: string }[];
	frenadas: number;
}

function followupKind(touches: number): QueueItemKind {
	return touches === 1 ? "followup_2" : "followup_3";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "error desconocido";
}

export async function runFollowups(
	deps: FollowupsDeps,
): Promise<FollowupsResult> {
	const tenants = await deps.store.listActiveTenants();
	const now = deps.now();
	const result: FollowupsResult = { encoladas: 0, salteadas: [], frenadas: 0 };

	for (const tenant of tenants) {
		// Nivel 1: un tenant que explota no frena a los otros.
		try {
			await queueDueFollowups(deps, tenant, now, result);
			await flagExhaustedContacts(deps, tenant, now, result);
		} catch (error) {
			console.error(`followups: tenant ${tenant.slug}:`, error);
		}
	}

	return result;
}

async function queueDueFollowups(
	deps: FollowupsDeps,
	tenant: FollowupsTenant,
	now: Date,
	result: FollowupsResult,
): Promise<void> {
	const contacts = await deps.store.listDueFollowups(tenant.id, now);

	for (const contact of contacts) {
		// Nivel 2: un contacto que falla no frena a los que le siguen.
		try {
			if (!contact.gmailThreadId) {
				// Un follow-up responde dentro del hilo que ya existe; sin hilo, la
				// alternativa sería abrir una conversación nueva, y eso no es un
				// follow-up. Se saltea, no se inventa un hilo.
				result.salteadas.push({
					contactKey: contact.contactKey,
					motivo: "no tiene hilo abierto",
				});
				continue;
			}

			const outcome = await deps.draftAndQueue({
				tenantId: tenant.id,
				contactKey: contact.contactKey,
				kind: followupKind(contact.touches),
				gmailThreadId: contact.gmailThreadId,
			});

			if (isRefusal(outcome)) {
				result.salteadas.push({
					contactKey: contact.contactKey,
					motivo: outcome.message,
				});
			} else {
				result.encoladas++;
			}
		} catch (error) {
			result.salteadas.push({
				contactKey: contact.contactKey,
				motivo: errorMessage(error),
			});
			console.error(
				`followups: contacto ${contact.contactKey} (${tenant.slug}):`,
				error,
			);
		}
	}
}

/** El "Retrasado (stand by)" del pipeline del CLAUDE.md: tres toques sin
 * respuesta, con deal abierto. Sin deal abierto no se emite nada — alguien
 * que nunca llegó a deal no es una oportunidad frenada, es solo alguien que
 * no contestó. */
async function flagExhaustedContacts(
	deps: FollowupsDeps,
	tenant: FollowupsTenant,
	now: Date,
	result: FollowupsResult,
): Promise<void> {
	const contacts =
		(await deps.store.listExhaustedContacts?.(tenant.id, now)) ?? [];

	for (const contact of contacts) {
		if (!contact.crmId) continue;

		// Nivel 2: un contacto que falla no frena a los que le siguen.
		try {
			const deals =
				(await deps.listOpenDeals?.({
					tenantId: tenant.id,
					contactKey: contact.contactKey,
					crmId: contact.crmId,
				})) ?? [];
			if (deals.length === 0) continue;

			await deps.store.insertEvents?.([
				outreachEvent({
					tenant_id: tenant.id,
					actor_user_id: null,
					contact_key: contact.contactKey,
					type: "oportunidad_frenada",
					summary: "tres toques sin respuesta, con deal abierto",
					payload: { deal_ids: deals.map((d) => d.id) },
				}),
			]);
			result.frenadas++;
		} catch (error) {
			console.error(
				`followups: contacto agotado ${contact.contactKey} (${tenant.slug}):`,
				error,
			);
		}
	}
}
