// Escalera de outreach_status y cadencia del canon (spec 03 §5.4). El trigger
// de contacts solo impide bajar de rango; esta es la regla completa.
export const OUTREACH_STAGES = [
	"a_contactar",
	"msg1_enviado",
	"sin_respuesta",
	"respuesta_neutra",
	"no_interesado",
	"en_conversacion",
	"reunion_agendada",
	"deal_creado",
	"cliente",
	"sin_atribucion",
] as const;

export type OutreachStage = (typeof OUTREACH_STAGES)[number];

// Los valores de la base son snake_case en inglés; la UI del dashboard va en
// castellano rioplatense. Un solo lugar para las dos pantallas que las usan.
export const STAGE_LABELS: Record<OutreachStage, string> = {
	a_contactar: "A contactar",
	msg1_enviado: "Primer mail enviado",
	sin_respuesta: "Sin respuesta",
	respuesta_neutra: "Respondió sin definirse",
	no_interesado: "No le interesa",
	en_conversacion: "En conversación",
	reunion_agendada: "Reunión agendada",
	deal_creado: "Oportunidad abierta",
	cliente: "Cliente",
	sin_atribucion: "Sin atribución",
};

const RANK: Record<OutreachStage, number> = {
	a_contactar: 0,
	msg1_enviado: 1,
	sin_respuesta: 2,
	respuesta_neutra: 2,
	no_interesado: 2,
	en_conversacion: 2,
	reunion_agendada: 3,
	deal_creado: 4,
	cliente: 5,
	sin_atribucion: -1,
};

const WITHIN_RANK_2: Partial<Record<OutreachStage, readonly OutreachStage[]>> =
	{
		sin_respuesta: ["respuesta_neutra", "no_interesado", "en_conversacion"],
		respuesta_neutra: ["no_interesado", "en_conversacion"],
		no_interesado: ["en_conversacion"],
		en_conversacion: [],
	};

export function stageRank(stage: OutreachStage): number {
	return RANK[stage];
}

export function canAdvance(from: OutreachStage, to: OutreachStage): boolean {
	if (from === to || to === "sin_atribucion") return false;
	if (from === "sin_atribucion") return RANK[to] >= 2;
	if (RANK[to] > RANK[from]) return true;
	if (RANK[to] === RANK[from])
		return WITHIN_RANK_2[from]?.includes(to) ?? false;
	return false;
}

const DAY_MS = 86_400_000;
export const MAX_TOUCHES = 3;
export const FOLLOWUP_OFFSETS_DAYS = [4, 10] as const;
export const NO_RESPONSE_AFTER_DAYS = 14;

/** Fecha del siguiente toque después de haber mandado `touches` toques. */
export function nextFollowup(input: {
	touches: number;
	firstTouchAt: Date;
}): Date | null {
	const offset = FOLLOWUP_OFFSETS_DAYS[input.touches - 1];
	return offset === undefined
		? null
		: new Date(input.firstTouchAt.getTime() + offset * DAY_MS);
}

export function isNoResponse(input: {
	touches: number;
	firstTouchAt: Date | null;
	repliedAt: Date | null;
	now: Date;
}): boolean {
	if (input.touches < MAX_TOUCHES || input.repliedAt || !input.firstTouchAt)
		return false;
	return (
		input.now.getTime() - input.firstTouchAt.getTime() >=
		NO_RESPONSE_AFTER_DAYS * DAY_MS
	);
}
