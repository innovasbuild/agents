// El barrido de la madrugada: lee los hilos de Gmail que ya conocemos, registra
// lo que encuentra y concilia las piezas aprobadas sin confirmación. Corre sin
// nadie mirando, así que todo acá está ordenado alrededor de una idea: un error
// aislado nunca puede frenar el resto de la corrida, y nada de lo que se
// registra se pierde si el paso siguiente falla.
//
// **No recibe ninguna dependencia de envío.** No es una omisión: es la garantía
// estructural de que un schedule no manda mail. Si alguna vez parece que hace
// falta mandar algo desde acá, la respuesta es encolar una pieza `pending` para
// que una persona la apruebe en /cola, no sumar una dep.
// Imports relativos y no "@/": este módulo lo arrastra un schedule de eve, que
// no resuelve los paths de tsconfig (mismo motivo que lib/agents/channel-context.ts).
import type { GmailMessage } from "../../gmail/read";
import { type OutreachEventInsert, outreachEvent } from "../events";
import { planListen } from "../listen";
import type {
	ContactPatch,
	ContactRow,
	QueueItemPatch,
	QueueItemRow,
	QueueItemStatus,
} from "../store";
import { planReconcile } from "./reconcile";

/** Violación de unique de Postgres. El lock del día se apoya en esto. */
export const UNIQUE_VIOLATION = "23505";

/** Una pieza aprobada recién puede estar en vuelo: confirmarla ahí sería
 * ganarle la carrera al envío real y dejarlo sin registrar los toques. Quince
 * minutos es el mismo colchón que fija la spec 03 §8.3. */
const APPROVED_GRACE_MINUTES = 15;

export interface SweepTenant {
	id: string;
	slug: string;
}

/** El ejecutor tal como lo necesita el barrido. El `email` no sale de
 * `executors` (esa tabla no lo guarda): lo resuelve el cableado del schedule
 * contra `auth.users`, porque `fetchThread` lo necesita para saber cuáles
 * mensajes del hilo son nuestros. */
export interface SweepExecutor {
	tenantId: string;
	userId: string;
	slug: string | null;
	email: string;
}

export type SweepContact = Pick<
	ContactRow,
	"id" | "tenantId" | "contactKey" | "gmailThreadId" | "stage" | "touches"
>;

export type SweepQueueItem = Pick<
	QueueItemRow,
	"id" | "contactKey" | "toEmail" | "approvedAt"
>;

export interface SweepStore {
	listActiveTenants(): Promise<SweepTenant[]>;
	listExecutorsWithGmailRead(tenantId: string): Promise<SweepExecutor[]>;
	listContactsWithThread(
		tenantId: string,
		ownerUserId: string,
	): Promise<SweepContact[]>;
	listKnownInboundIds(tenantId: string, contactKey: string): Promise<string[]>;
	listQueue(
		tenantId: string,
		executorUserId: string,
		statuses: readonly QueueItemStatus[],
	): Promise<SweepQueueItem[]>;
	insertEvents(rows: readonly OutreachEventInsert[]): Promise<void>;
	updateContact(
		tenantId: string,
		id: string,
		patch: ContactPatch,
	): Promise<unknown>;
	transitionQueueItem(
		tenantId: string,
		id: string,
		from: QueueItemStatus,
		patch: QueueItemPatch,
	): Promise<unknown>;
}

export interface SweepDeps {
	store: SweepStore;
	/** Token de Gmail del ejecutor. Falla si el grant murió. */
	getToken(executor: SweepExecutor): Promise<string>;
	fetchThread(
		accessToken: string,
		threadId: string,
		ourEmail: string,
	): Promise<GmailMessage[]>;
	findByRfc822Id(
		accessToken: string,
		rfc822MessageId: string,
	): Promise<{ id: string; threadId: string } | null>;
	now(): Date;
}

export interface SweepTenantResult {
	tenantId: string;
	slug: string;
	respuestas: number;
	rebotes: number;
	reconciliadas: number;
	trabadas: number;
	ejecutoresFallidos: string[];
}

export interface SweepResult {
	tenants: SweepTenantResult[];
}

/** Clave del lock: un schedule, un día. `morning-sweep:2026-09-19`. La fecha va
 * en UTC porque Vercel evalúa el cron en UTC y el disparo de las 10:00 UTC cae
 * siempre dentro del mismo día calendario en Argentina. */
export function scheduleKeyFor(name: string, now: Date): string {
	return `${name}:${now.toISOString().slice(0, 10)}`;
}

export interface RunLockRow {
	tenant_id: string;
	agent: string;
	trigger: "schedule";
	eve_session_id: string;
	schedule_key: string;
	status: "running";
}

export interface RunLockDeps {
	insertRun(
		row: RunLockRow,
	): Promise<{ error: { code?: string; message?: string } | null }>;
}

/**
 * Toma el lock del día insertando en `runs`. `runs_schedule_key_idx` es único,
 * así que un segundo disparo del mismo día choca con 23505 y devuelve `false`:
 * ya corrió, no hay nada que hacer. Cualquier otro error se relanza — no poder
 * tomar el lock por un problema de red no es lo mismo que ya haber corrido, y
 * tragarlo dejaría dos barridos pisándose.
 *
 * `runs.tenant_id` es NOT NULL y el lock es global de la corrida, no por
 * tenant: quien llama pasa un tenant activo cualquiera solo para satisfacer la
 * FK. La identidad del lock es `schedule_key`, no ese tenant.
 */
export async function takeScheduleLock(
	deps: RunLockDeps,
	input: { scheduleKey: string; tenantId: string; agent: string },
): Promise<boolean> {
	const { error } = await deps.insertRun({
		tenant_id: input.tenantId,
		agent: input.agent,
		trigger: "schedule",
		eve_session_id: input.scheduleKey,
		schedule_key: input.scheduleKey,
		status: "running",
	});
	if (!error) return true;
	if (error.code === UNIQUE_VIOLATION) return false;
	throw new Error(
		`no pude tomar el lock de ${input.scheduleKey}: ${error.message ?? "sin detalle"}`,
	);
}

/** ¿Este tenant tiene algo para que el agente interprete? Solo las respuestas
 * reales abren el hilo de la mañana: un rebote o una pieza trabada son para el
 * resumen, no para clasificar. */
export function needsHandoff(tenant: SweepTenantResult): boolean {
	return tenant.respuestas > 0;
}

/**
 * El lock primero, todo lo demás después. Si ya corrió hoy devuelve `null` sin
 * tocar la base: no parcialmente, no "sigo igual por las dudas".
 */
export async function runMorningSweep(
	deps: SweepDeps & { takeLock(): Promise<boolean> },
): Promise<SweepResult | null> {
	if (!(await deps.takeLock())) return null;
	return await runSweep(deps);
}

export async function runSweep(deps: SweepDeps): Promise<SweepResult> {
	const tenants = await deps.store.listActiveTenants();
	const results: SweepTenantResult[] = [];

	for (const tenant of tenants) {
		const acc: SweepTenantResult = {
			tenantId: tenant.id,
			slug: tenant.slug,
			respuestas: 0,
			rebotes: 0,
			reconciliadas: 0,
			trabadas: 0,
			ejecutoresFallidos: [],
		};
		results.push(acc);

		// Nivel 1: un tenant que explota no frena a los otros.
		try {
			const executors = await deps.store.listExecutorsWithGmailRead(tenant.id);
			for (const executor of executors) {
				// Nivel 2: un ejecutor cuyo token murió no frena a los demás del
				// mismo tenant.
				try {
					const token = await deps.getToken(executor);
					await sweepThreads(deps, tenant, executor, token, acc);
					await reconcileApproved(deps, tenant, executor, token, acc);
				} catch (error) {
					acc.ejecutoresFallidos.push(executor.slug ?? executor.userId);
					console.error(
						`sweep: ejecutor ${executor.slug ?? executor.userId} de ${tenant.slug}:`,
						error,
					);
				}
			}
		} catch (error) {
			console.error(`sweep: tenant ${tenant.slug}:`, error);
		}
	}

	return { tenants: results };
}

async function sweepThreads(
	deps: SweepDeps,
	tenant: SweepTenant,
	executor: SweepExecutor,
	token: string,
	acc: SweepTenantResult,
): Promise<void> {
	// El tenant se filtra siempre y a mano: el barrido corre con el cliente
	// admin, sin sesión de usuario, así que acá no hay RLS que separe nada.
	const contacts = await deps.store.listContactsWithThread(
		tenant.id,
		executor.userId,
	);

	for (const contact of contacts) {
		if (!contact.gmailThreadId) continue;

		const messages = await deps.fetchThread(
			token,
			contact.gmailThreadId,
			executor.email,
		);
		const knownMessageIds = new Set(
			await deps.store.listKnownInboundIds(tenant.id, contact.contactKey),
		);
		const effects = planListen({
			contact,
			messages,
			knownMessageIds,
			now: deps.now(),
		});
		if (effects.length === 0) continue;

		// Los eventos primero: son el hecho, y son append-only con dedup por
		// gmail_message_id. Si el patch de abajo falla, el hecho quedó.
		await deps.store.insertEvents(
			effects.map((effect) =>
				outreachEvent({
					tenant_id: tenant.id,
					actor_user_id: executor.userId,
					contact_key: contact.contactKey,
					type: effect.event.type,
					summary: effect.event.summary,
					payload: { gmail_message_id: effect.event.gmailMessageId },
				}),
			),
		);

		const patch: ContactPatch = {};
		// Una auto-respuesta viene con repliedAt en null a propósito (listen.ts):
		// no es una respuesta real y no apaga la cadencia de follow-ups.
		const lastReplied = lastWith(effects, (e) => e.repliedAt !== null);
		const lastStage = lastWith(effects, (e) => e.stage !== null);
		const bounced = effects.some((e) => e.event.type === "rebote");

		for (const effect of effects) {
			if (effect.event.type === "rebote") acc.rebotes++;
			else if (effect.repliedAt !== null) acc.respuestas++;
		}

		if (lastReplied) patch.repliedAt = lastReplied.repliedAt;
		if (lastStage?.stage) patch.stage = lastStage.stage;
		// Respondió o rebotó: en los dos casos el próximo toque programado deja de
		// tener sentido (spec 03 §8.2). Seguir escribiéndole a una casilla que
		// rebota es el peor de los dos.
		if (lastReplied || bounced) patch.nextStepAt = null;

		if (Object.keys(patch).length > 0) {
			await deps.store.updateContact(tenant.id, contact.id, patch);
		}
	}
}

async function reconcileApproved(
	deps: SweepDeps,
	tenant: SweepTenant,
	executor: SweepExecutor,
	token: string,
	acc: SweepTenantResult,
): Promise<void> {
	const items = await deps.store.listQueue(tenant.id, executor.userId, [
		"approved",
	]);
	const now = deps.now();
	// Mismo Message-ID que arma services/send.ts al enviar la pieza.
	const senderDomain = executor.email.split("@")[1] || "outreach.local";

	for (const item of items) {
		if (withinGrace(item.approvedAt, now)) continue;

		const found = await deps.findByRfc822Id(
			token,
			`<qi-${item.id}@${senderDomain}>`,
		);
		const verdict = planReconcile({ item, found, now });

		if (verdict.action === "dejar_trabada") {
			acc.trabadas++;
			continue;
		}

		// Condicional sobre `approved`: si el envío real ganó la carrera, esto
		// devuelve null y no se cuenta. Nunca se reencola nada desde acá.
		const moved = await deps.store.transitionQueueItem(
			tenant.id,
			item.id,
			"approved",
			{
				status: "sent",
				gmailMessageId: verdict.gmailMessageId,
				gmailThreadId: verdict.gmailThreadId,
				sentAt: now.toISOString(),
			},
		);
		if (moved) acc.reconciliadas++;
	}
}

function withinGrace(approvedAt: string | null, now: Date): boolean {
	if (!approvedAt) return false;
	const elapsedMs = now.getTime() - new Date(approvedAt).getTime();
	return elapsedMs < APPROVED_GRACE_MINUTES * 60_000;
}

function lastWith<T>(items: readonly T[], predicate: (item: T) => boolean) {
	for (let i = items.length - 1; i >= 0; i--) {
		if (predicate(items[i])) return items[i];
	}
	return undefined;
}
