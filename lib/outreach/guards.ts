// Invariantes del canon que se revalidan en el borde de cada tool
// (spec 03 §5.3). Puro: quien llama trae los datos de la base, el CRM y Gmail.
const DAY_MS = 86_400_000;
export const CLAIM_WINDOW_DAYS = 90;
export const MAILBOX_GUARD_DAYS = 10;

export type ClaimStatus = "libre" | "propio" | "ajeno";

export interface CrmAuthorship {
	ownerId: string;
	at: Date;
}

export interface ClaimInput {
	ownerUserId: string | null;
	executorUserId: string;
	executorCrmOwnerId: string | null;
	crmAuthorship: CrmAuthorship | null;
	now: Date;
}

/** El dueño es quien conversa: la autoría reciente del CRM gana sobre la base. */
export function claimStatus(input: ClaimInput): ClaimStatus {
	const authorship = input.crmAuthorship;
	if (
		authorship &&
		input.now.getTime() - authorship.at.getTime() < CLAIM_WINDOW_DAYS * DAY_MS
	) {
		return input.executorCrmOwnerId !== null &&
			authorship.ownerId === input.executorCrmOwnerId
			? "propio"
			: "ajeno";
	}
	if (input.ownerUserId === null) return "libre";
	return input.ownerUserId === input.executorUserId ? "propio" : "ajeno";
}

export interface CrmCandidate {
	id: string;
	contactKey: string | null;
	email: string | null;
	linkedinSlugs: string[];
}

/** G1: OR por contact_key, email y LinkedIn, en ese orden de prioridad. */
export function crmMatch(
	candidates: CrmCandidate[],
	query: {
		contactKey: string;
		email: string | null;
		linkedinSlug: string | null;
	},
): CrmCandidate | null {
	const byKey = candidates.find((c) => c.contactKey === query.contactKey);
	if (byKey) return byKey;
	const email = query.email;
	const byEmail = email
		? candidates.find((c) => c.email?.toLowerCase() === email)
		: undefined;
	if (byEmail) return byEmail;
	const slug = query.linkedinSlug;
	return (
		(slug
			? candidates.find((c) => c.linkedinSlugs.includes(slug))
			: undefined) ?? null
	);
}

export type TouchReason =
	| "vencida"
	| "un_toque_por_dia"
	| "cupo_diario"
	| "max_toques"
	| "buzon";

export const TOUCH_REASON_TEXT: Record<TouchReason, string> = {
	vencida: "la pieza venció: pasaron más de 7 días desde que se encoló",
	un_toque_por_dia: "ya hubo un toque a esta persona hoy",
	cupo_diario: "llegaste al cupo diario de envíos",
	max_toques: "esta persona ya recibió los 3 toques",
	buzon:
		"tu casilla ya le escribió a esta dirección en los últimos 10 días, fuera de este hilo",
};

export interface TouchInput {
	now: Date;
	expiresAt: Date;
	/** Toques ya enviados a la persona antes de esta pieza. */
	touches: number;
	sentTodayToRecipient: boolean;
	sentTodayByExecutor: number;
	dailyQuota: number;
	lastSentToRecipientOutsideThreadAt: Date | null;
}

export type TouchVerdict =
	| { ok: true }
	| { ok: false; reason: TouchReason; transient: boolean };

export function canTouch(input: TouchInput): TouchVerdict {
	if (input.expiresAt.getTime() <= input.now.getTime()) {
		return { ok: false, reason: "vencida", transient: false };
	}
	if (input.sentTodayToRecipient)
		return { ok: false, reason: "un_toque_por_dia", transient: true };
	if (input.sentTodayByExecutor >= input.dailyQuota)
		return { ok: false, reason: "cupo_diario", transient: true };
	if (input.touches >= 3)
		return { ok: false, reason: "max_toques", transient: false };
	const last = input.lastSentToRecipientOutsideThreadAt;
	if (
		last &&
		input.now.getTime() - last.getTime() < MAILBOX_GUARD_DAYS * DAY_MS
	) {
		return { ok: false, reason: "buzon", transient: false };
	}
	return { ok: true };
}
