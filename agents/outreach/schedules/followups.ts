// Cableado del schedule de follow-ups. Toda la lógica vive en
// lib/outreach/services/followups.ts, con dependencias inyectadas y testeada;
// acá solo se arman las deps reales, se toma el lock y se resuelve, por
// contacto, el ejecutor + Gmail + CRM que necesitan draftMessage, queueTouch y
// el freno de oportunidades.
//
// Mismo patrón que morning-sweep.ts (lock por corrida, tenants listados antes
// del lock, aislamiento de fallos por niveles): scheduleKeyFor y
// takeScheduleLock se reusan de sweep.ts, no se reescriben.
//
// **Este schedule no manda mail.** draftAndQueue llama draftMessage +
// queueTouch, que solo dejan la pieza `pending` en /cola: la garantía es
// estructural, no una promesa — no hay ninguna dep de envío acá abajo.
// Imports relativos y no "@/": eve no resuelve los paths de tsconfig en los
// módulos que compila (mismo motivo que lib/agents/channel-context.ts).
import { generateText } from "ai";
import { defineSchedule } from "eve/schedules";
import { tokenForSubject } from "../../../lib/connectors/auth";
import { hasEnabledBinding } from "../../../lib/connectors/bindings";
import type { CrmAdapter } from "../../../lib/connectors/crm/adapter";
import { createHubSpotAdapter } from "../../../lib/connectors/crm/hubspot-adapter";
import {
	GOOGLE_CONNECTOR_UID,
	HUBSPOT_CONNECTOR_UID,
} from "../../../lib/connectors/platform";
import { fetchThread } from "../../../lib/gmail/read";
import { GMAIL_SCOPES } from "../../../lib/gmail/send";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { isRefusal, refuse } from "../../../lib/outreach/result";
import { draftMessage } from "../../../lib/outreach/services/draft";
import type {
	DraftAndQueueInput,
	DraftAndQueueResult,
	FollowupsStore,
	ListOpenDealsInput,
} from "../../../lib/outreach/services/followups";
import { runScheduledFollowups } from "../../../lib/outreach/services/followups";
import { queueTouch } from "../../../lib/outreach/services/queue";
import {
	scheduleKeyFor,
	takeScheduleLock,
} from "../../../lib/outreach/services/sweep";
import type { Caller } from "../../../lib/outreach/session";
import {
	createSupabaseOutreachStore,
	type OutreachStore,
} from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";
import { generateDraft } from "../../../lib/outreach/services/generate-draft";
import { createUsageRecorder, metered } from "../../../lib/workflows/usage";

const SCHEDULE = "followups";
const AGENT = "outreach";

const issuer = () => process.env.NEXT_PUBLIC_SUPABASE_URL;

/** CRM del tenant con el token del ejecutor dueño del contacto, para
 * `draftAndQueue` — SOLO para eso. A diferencia de `listOpenDeals` de abajo,
 * acá un CRM ausente es aceptable de verdad: `queueTouch` funciona sin CRM
 * (el claim se resuelve con `ownerUserId` local), así que perder el token no
 * puede costar el follow-up. `null` cubre tenant sin HubSpot conectado y
 * grant vencido por igual, a propósito. */
async function crmForExecutor(
	tenantId: string,
	userId: string,
): Promise<CrmAdapter | null> {
	if (!(await hasEnabledBinding(tenantId, "crm", "hubspot"))) return null;
	try {
		const { token } = await tokenForSubject(HUBSPOT_CONNECTOR_UID, {
			tenantId,
			userId,
			issuer: issuer(),
		});
		return createHubSpotAdapter(token);
	} catch (error) {
		console.error(`${SCHEDULE}: CRM de ${userId} en ${tenantId}:`, error);
		return null;
	}
}

/** Envuelve draftMessage + queueTouch (Task 7) para un follow-up: arma el
 * caller del ejecutor dueño del contacto, resuelve el Message-ID del último
 * mensaje del hilo contra Gmail (Task 2) para que la respuesta caiga adentro
 * de la conversación, y encola. */
async function draftAndQueue(
	store: OutreachStore,
	input: DraftAndQueueInput,
): Promise<DraftAndQueueResult> {
	const [contact] = await store.findContactsByKeys(input.tenantId, [
		input.contactKey,
	]);
	if (!contact) {
		return refuse(
			"contacto_inexistente",
			`no hay un contacto cargado con la clave ${input.contactKey}`,
		);
	}
	if (!contact.ownerUserId) {
		return refuse(
			"sin_ejecutor",
			"el contacto no tiene ejecutor asignado: no se puede encolar el follow-up",
		);
	}

	const caller: Caller = {
		tenantId: input.tenantId,
		userId: contact.ownerUserId,
		role: "ejecutor",
		email: "",
	};

	let gmailToken: string;
	try {
		const { token } = await tokenForSubject(
			GOOGLE_CONNECTOR_UID,
			{
				tenantId: input.tenantId,
				userId: contact.ownerUserId,
				issuer: issuer(),
			},
			[...GMAIL_SCOPES],
		);
		gmailToken = token;
	} catch (error) {
		return refuse(
			"sin_gmail",
			`no pude renovar el acceso a Gmail del ejecutor: ${
				error instanceof Error ? error.message : "sin detalle"
			}`,
		);
	}

	const admin = createAdminClient();
	const { data: userData, error: userError } =
		await admin.auth.admin.getUserById(contact.ownerUserId);
	const executorEmail = userData?.user?.email ?? null;
	if (userError || !executorEmail) {
		return refuse(
			"sin_email_ejecutor",
			"el ejecutor no tiene email en auth.users: sin eso no se puede leer el hilo",
		);
	}

	// El Message-ID del último mensaje del hilo es lo que hace que la
	// respuesta caiga adentro de la conversación (in-reply-to/references). Sin
	// él NO se encola: `send_email` exige los dos campos de hilo, así que una
	// pieza con solo `gmailThreadId` le saldría al prospecto como conversación
	// nueva y quien aprueba vería un borrador normal, sin marca de nada. Se
	// corta acá, antes de gastar el draft, y el salteo queda a la vista en el
	// resumen de la corrida; mañana se reintenta.
	let replyToMessageId: string | null = null;
	try {
		const messages = await fetchThread(
			gmailToken,
			input.gmailThreadId,
			executorEmail,
		);
		replyToMessageId = messages.at(-1)?.rfc822MessageId ?? null;
	} catch (error) {
		console.error(
			`${SCHEDULE}: no pude leer el hilo ${input.gmailThreadId} de ${input.contactKey}:`,
			error,
		);
	}
	if (!replyToMessageId) {
		return refuse(
			"sin_hilo",
			`no pude resolver el mensaje al que responder del hilo ${input.gmailThreadId}: un follow-up sin eso saldría fuera del hilo`,
		);
	}

	const brain = await brainForTenant(input.tenantId);
	const draft = await draftMessage(
		{ caller, contactKey: input.contactKey, kind: input.kind },
		{
			store,
			loadCanon: (slug) => loadCanon(brain, slug),
			generate: metered(
				(model: string, system: string, prompt: string) =>
					generateDraft(model, system, prompt, { generateText }),
				{
					model: (model) => model,
					record: createUsageRecorder(admin),
					base: {
						tenantId: input.tenantId,
						// El schedule no corre dentro de un turno: su fila de runs es la
						// del lock del día y no se enlaza acá. El asiento igual cuenta
						// para el presupuesto diario, que suma por tenant y por fecha.
						runId: null,
						workflow: null,
						node: "outreach/draft",
					},
				},
			),
			now: () => new Date(),
		},
	);
	if (isRefusal(draft)) return draft;

	const crm = await crmForExecutor(input.tenantId, contact.ownerUserId);

	return queueTouch(
		{
			caller,
			contactKey: input.contactKey,
			kind: input.kind,
			subject: draft.subject,
			body: draft.body,
			hook: draft.hook,
			vector: draft.vector,
			idioma: draft.idioma,
			replyToMessageId,
			gmailThreadId: input.gmailThreadId,
		},
		{
			store,
			crm,
			loadCanon: (slug) => loadCanon(brain, slug),
			now: () => new Date(),
		},
	);
}

/** Deals abiertos del contacto agotado (Task 6), con el CRM del ejecutor que
 * lo tiene asignado.
 *
 * Ojo con lo que devuelve `[]` acá: solo "el tenant no tiene HubSpot
 * conectado" es un estado normal (nunca va a haber freno para ese tenant, y
 * eso no es una alarma). "El contacto agotado no tiene ejecutor asignado" y
 * "el token de HubSpot murió" NO son lo mismo que "no hay deals" — son
 * fallos, y tienen que tirar para que `flagExhaustedContacts` los cuente en
 * `frenoFallido` en vez de disfrazarlos de "sin deal". Antes esta función
 * tragaba los tres casos igual (`crmForExecutor` con try/catch propio) y una
 * corrida con HubSpot caído se reportaba idéntica a una sana. */
async function listOpenDeals(
	store: OutreachStore,
	input: ListOpenDealsInput,
): Promise<{ id: string; stage: string }[]> {
	const [contact] = await store.findContactsByKeys(input.tenantId, [
		input.contactKey,
	]);
	if (!contact?.ownerUserId) {
		// Un contacto que llegó a agotado pasó por 3 toques enviados, y enviar
		// exige ejecutor: si no lo tiene, algo está inconsistente. No es un
		// "sin deal", es un dato roto.
		throw new Error(
			`el contacto agotado ${input.contactKey} no tiene ejecutor asignado: no se puede resolver el CRM`,
		);
	}
	if (!(await hasEnabledBinding(input.tenantId, "crm", "hubspot"))) return [];

	const { token } = await tokenForSubject(HUBSPOT_CONNECTOR_UID, {
		tenantId: input.tenantId,
		userId: contact.ownerUserId,
		issuer: issuer(),
	});
	return createHubSpotAdapter(token).listOpenDeals(input.crmId);
}

function buildFollowupsStore(store: OutreachStore): FollowupsStore {
	return {
		listActiveTenants: () => store.listActiveTenants(),
		listDueFollowups: (tenantId, now) => store.listDueFollowups(tenantId, now),
		listExhaustedContacts: (tenantId, now) =>
			store.listExhaustedContacts(tenantId, now),
		insertEvents: (rows) => store.insertEvents(rows),
		updateContact: (tenantId, id, patch) =>
			store.updateContact(tenantId, id, patch),
	};
}

export default defineSchedule({
	// 8:00 de Argentina. Vercel evalúa cron en UTC.
	cron: "0 11 * * 1-5",
	async run() {
		const admin = createAdminClient();
		const store = createSupabaseOutreachStore(admin);
		const now = new Date();
		const scheduleKey = scheduleKeyFor(SCHEDULE, now);

		// El lock es una dep de runScheduledFollowups, igual que en el sweep: la
		// disciplina de "tenants antes del lock" y "si ya corrió hoy no se hace
		// nada, ni parcialmente" vive en el servicio, testeada, y no en este
		// cableado. `runs.tenant_id` es NOT NULL y el lock es de la corrida, no
		// del tenant: se pasa cualquier tenant activo solo para la FK.
		const result = await runScheduledFollowups({
			store: buildFollowupsStore(store),
			draftAndQueue: (input) => draftAndQueue(store, input),
			listOpenDeals: (input) => listOpenDeals(store, input),
			now: () => new Date(),
			takeLock: async (tenants) => {
				const anyTenant = tenants[0];
				if (!anyTenant) return false;
				return await takeScheduleLock(
					{
						insertRun: async (row) => {
							const { error } = await admin.from("runs").insert(row);
							return { error };
						},
					},
					{ scheduleKey, tenantId: anyTenant.id, agent: AGENT },
				);
			},
		});
		if (!result) return;

		console.log(
			`${SCHEDULE}: ${result.encoladas} encolada(s), ${result.salteadas.length} salteada(s), ${result.frenadas} frenada(s), ${result.frenoFallido.length} freno(s) fallido(s)`,
		);
		if (result.frenoFallido.length > 0) {
			// Visibilidad explícita: sin esto, un CRM caído se ve idéntico a una
			// noche sin deals abiertos en ningún lado salvo este log.
			console.error(
				`${SCHEDULE}: no se pudo resolver el freno de ${result.frenoFallido.length} contacto(s):`,
				result.frenoFallido,
			);
		}
	},
});
