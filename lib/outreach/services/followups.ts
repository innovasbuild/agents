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
import { canAdvance } from "../stage";
import type { ContactPatch, ContactRow, QueueItemKind } from "../store";

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
 * first_touch_at viejo, sin freno ya registrado) ya lo hizo
 * `listExhaustedContacts`. `stage` es opcional en el tipo: sin ella, el freno
 * igual corre, solo que no puede decidir si conviene subir la etapa a
 * `sin_respuesta` y no la toca. */
export type FollowupsExhaustedContact = Pick<
	ContactRow,
	"id" | "contactKey" | "crmId"
> & { stage?: ContactRow["stage"] };

/** Lo único que el freno toca del contacto: nunca la asociación con el CRM,
 * nunca un efecto externo. */
export type FollowupsContactPatch = Pick<ContactPatch, "nextStepAt" | "stage">;

/** Los ocho métodos son obligatorios, igual que en `SweepStore`: un cableado
 * incompleto tiene que ser un error de tipo, no una degradación silenciosa.
 * Cuando `listExhaustedContacts`, `insertEvents` y `updateContact` eran
 * opcionales, olvidarse de `updateContact` compilaba y corría, y el freno
 * pasaba a ser lo que su propio comentario advertía: un contador, no un freno
 * — el evento quedaba, `next_step_at` seguía vivo y la etapa no subía. Sin
 * error, sin warning, sin test rojo. Los fakes implementan los tres. */
export interface FollowupsStore {
	listActiveTenants(): Promise<FollowupsTenant[]>;
	listDueFollowups(tenantId: string, now: Date): Promise<FollowupsDueContact[]>;
	/** Idempotencia: la implementación real excluye a quien ya tiene un evento
	 * `oportunidad_frenada` — acá no hay forma de saberlo sin volver a leer la
	 * base, así que es responsabilidad de la store, no de esta función. */
	listExhaustedContacts(
		tenantId: string,
		now: Date,
	): Promise<FollowupsExhaustedContact[]>;
	insertEvents(rows: readonly OutreachEventInsert[]): Promise<void>;
	/** Es lo que hace que el freno frene: corta `next_step_at` y, si la
	 * escalera lo permite, sube la etapa. */
	updateContact(
		tenantId: string,
		id: string,
		patch: FollowupsContactPatch,
	): Promise<unknown>;
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
	 * agotado nunca se marca `oportunidad_frenada`. Si no puede determinar los
	 * deals (CRM caído, token muerto), tiene que TIRAR, no devolver `[]`: un
	 * `[]` silencioso se lee igual que "no había deal", y no es lo mismo. */
	listOpenDeals?(
		input: ListOpenDealsInput,
	): Promise<{ id: string; stage: string }[]>;
	now(): Date;
}

/** Un salteo estructural (un Refusal de queueTouch, "no tiene hilo", "touches
 * inesperado") no es lo mismo que una excepción de verdad (la base tosió, el
 * CRM está caído). Se leen distinto en el resumen: el primero es un estado
 * esperado del negocio, el segundo es algo para mirar. */
export interface FollowupsSalteo {
	contactKey: string;
	motivo: string;
	tipo: "refusal" | "excepcion";
}

export interface FollowupsFallo {
	contactKey: string;
	motivo: string;
}

export interface FollowupsResult {
	encoladas: number;
	salteadas: FollowupsSalteo[];
	frenadas: number;
	/** Contactos agotados donde no se pudo determinar si hay un deal abierto
	 * (CRM caído, token muerto, dato inconsistente). Nunca se cuentan como
	 * "sin deal": eso disfrazaría un fallo de infraestructura de un estado de
	 * negocio normal. */
	frenoFallido: FollowupsFallo[];
}

function followupKind(touches: number): QueueItemKind | null {
	if (touches === 1) return "followup_2";
	if (touches === 2) return "followup_3";
	// listDueFollowups solo filtra touches < 3: un contacto con 0 toques (o
	// cualquier valor fuera de {1,2}) puede llegar hasta acá. queueTouch lo
	// frena con etapa_incompatible, pero esa es protección accidental de otra
	// capa — acá no se inventa un followup_3 para un caso que no es un
	// follow-up.
	return null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "error desconocido";
}

/**
 * La corrida con lock, hermana de `runMorningSweep`. El lock vivía suelto en
 * el cableado del schedule, donde ningún test lo podía ejercer; acá adentro es
 * una dep más y el invariante queda fijado por los tests, no por un comentario.
 *
 * Los tenants se listan ANTES del lock, a propósito: es el único `await` que
 * puede tirar afuera de los try/catch de la corrida, y si tirara con el lock ya
 * tomado, el 23505 bloquearía cualquier reintento de esa jornada. Un hipo de
 * red no puede costar un día entero de follow-ups.
 *
 * Con el lock tomado, si ya corrió hoy devuelve `null` sin tocar nada: no
 * parcialmente, no "sigo igual por las dudas".
 */
export async function runScheduledFollowups(
	deps: FollowupsDeps & {
		takeLock(tenants: readonly FollowupsTenant[]): Promise<boolean>;
	},
): Promise<FollowupsResult | null> {
	const tenants = await deps.store.listActiveTenants();
	if (!(await deps.takeLock(tenants))) return null;
	return await runFollowups(deps, tenants);
}

export async function runFollowups(
	deps: FollowupsDeps,
	knownTenants?: readonly FollowupsTenant[],
): Promise<FollowupsResult> {
	const tenants = knownTenants ?? (await deps.store.listActiveTenants());
	const now = deps.now();
	const result: FollowupsResult = {
		encoladas: 0,
		salteadas: [],
		frenadas: 0,
		frenoFallido: [],
	};

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
					tipo: "refusal",
				});
				continue;
			}

			const kind = followupKind(contact.touches);
			if (!kind) {
				result.salteadas.push({
					contactKey: contact.contactKey,
					motivo: `touches inesperado (${contact.touches}): no hay follow-up definido para ese número de toques`,
					tipo: "refusal",
				});
				continue;
			}

			const outcome = await deps.draftAndQueue({
				tenantId: tenant.id,
				contactKey: contact.contactKey,
				kind,
				gmailThreadId: contact.gmailThreadId,
			});

			if (isRefusal(outcome)) {
				result.salteadas.push({
					contactKey: contact.contactKey,
					motivo: outcome.message,
					tipo: "refusal",
				});
			} else {
				result.encoladas++;
			}
		} catch (error) {
			result.salteadas.push({
				contactKey: contact.contactKey,
				motivo: errorMessage(error),
				tipo: "excepcion",
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
 * no contestó.
 *
 * El freno tiene que ser dos cosas, no una: idempotente (la exclusión de
 * quien ya está frenado vive en `listExhaustedContacts`, del lado de la
 * store) y efectivo (acá se corta `next_step_at` y, si la escalera lo
 * permite, sube la etapa a `sin_respuesta` — nunca se toca el deal en
 * HubSpot desde un schedule sin aprobación). */
async function flagExhaustedContacts(
	deps: FollowupsDeps,
	tenant: FollowupsTenant,
	now: Date,
	result: FollowupsResult,
): Promise<void> {
	const contacts = await deps.store.listExhaustedContacts(tenant.id, now);

	for (const contact of contacts) {
		if (!contact.crmId) continue; // estado normal: nunca tuvo CRM asociado.

		// Nivel 2: un contacto que falla no frena a los que le siguen.
		try {
			const deals =
				(await deps.listOpenDeals?.({
					tenantId: tenant.id,
					contactKey: contact.contactKey,
					crmId: contact.crmId,
				})) ?? [];
			if (deals.length === 0) continue;

			// El evento primero: es el hecho, y es lo que hace idempotente la
			// próxima corrida (listExhaustedContacts lo excluye). Si el patch de
			// abajo falla, el hecho quedó igual.
			await deps.store.insertEvents([
				outreachEvent({
					tenant_id: tenant.id,
					actor_user_id: null,
					contact_key: contact.contactKey,
					type: "oportunidad_frenada",
					summary: "tres toques sin respuesta, con deal abierto",
					payload: { deal_ids: deals.map((d) => d.id) },
				}),
			]);

			const patch: FollowupsContactPatch = { nextStepAt: null };
			if (contact.stage && canAdvance(contact.stage, "sin_respuesta")) {
				patch.stage = "sin_respuesta";
			}
			await deps.store.updateContact(tenant.id, contact.id, patch);

			result.frenadas++;
		} catch (error) {
			const motivo = errorMessage(error);
			result.frenoFallido.push({ contactKey: contact.contactKey, motivo });
			console.error(
				`followups: no pude resolver el freno de ${contact.contactKey} (${tenant.slug}):`,
				error,
			);
		}
	}
}
