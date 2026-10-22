// Topes por plan (spec etapa 27 §3). Funciones puras: la lectura de la base
// vive en store.ts y el corte del crédito de IA en ai-allowance.ts.

export type Plan = "free" | "pago" | "enterprise";
export type SuspendedReason = "trial_vencido" | "pago_fallido" | "cancelado";
export type LimitReason =
	| "limit:users"
	| "limit:skills"
	| "limit:ai_credit"
	| `suspended:${SuspendedReason}`;

export const PLAN_LIMITS: Record<
	Plan,
	{
		users: number;
		skills: number;
		aiUsdPerMonth: number | null;
		trialMonths: number | null;
	}
> = {
	free: { users: 3, skills: 5, aiUsdPerMonth: 5, trialMonths: 3 },
	pago: {
		users: Number.POSITIVE_INFINITY,
		skills: Number.POSITIVE_INFINITY,
		aiUsdPerMonth: null,
		trialMonths: null,
	},
	enterprise: {
		users: Number.POSITIVE_INFINITY,
		skills: Number.POSITIVE_INFINITY,
		aiUsdPerMonth: null,
		trialMonths: null,
	},
};

export interface TenantPlan {
	plan: Plan;
	suspendedReason: SuspendedReason | null;
	trialEndsAt: string | null;
	aiMonthlyLimitUsd: number | null;
}

export interface TenantCounts {
	users: number;
	pendingInvitations: number;
	publishedSkills: number;
}

const DAY_MS = 86_400_000;
const TRIAL_WARNING_DAYS = 14;

export function suspendedReasonOf(t: TenantPlan): LimitReason | null {
	return t.suspendedReason ? `suspended:${t.suspendedReason}` : null;
}

export function canInvite(t: TenantPlan, c: TenantCounts): LimitReason | null {
	const suspended = suspendedReasonOf(t);
	if (suspended) return suspended;
	// Las invitaciones pendientes no ocupan lugar: cuenta quien ya es miembro.
	if (c.users >= PLAN_LIMITS[t.plan].users) return "limit:users";
	return null;
}

export function canPublishSkill(
	t: TenantPlan,
	c: TenantCounts,
): LimitReason | null {
	const suspended = suspendedReasonOf(t);
	if (suspended) return suspended;
	if (c.publishedSkills >= PLAN_LIMITS[t.plan].skills) return "limit:skills";
	return null;
}

export function trialWarning(
	t: TenantPlan,
	now: Date,
): { daysLeft: number } | null {
	if (t.plan !== "free" || !t.trialEndsAt) return null;
	const msLeft = new Date(t.trialEndsAt).getTime() - now.getTime();
	if (msLeft <= 0 || msLeft > TRIAL_WARNING_DAYS * DAY_MS) return null;
	return { daysLeft: Math.ceil(msLeft / DAY_MS) };
}

export function monthStartUtc(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const SUSPENDED_COPY: Record<SuspendedReason, { title: string; body: string }> =
	{
		trial_vencido: {
			title: "Terminó tu prueba gratuita",
			body: "Tu empresa quedó en pausa. Pasá al plan pago para volver a usar Central IA; tus datos siguen guardados.",
		},
		pago_fallido: {
			title: "No pudimos cobrar tu suscripción",
			body: "Tu empresa quedó en pausa. Actualizá el medio de pago para reactivarla; tus datos siguen guardados.",
		},
		cancelado: {
			title: "Tu suscripción está cancelada",
			body: "Tu empresa quedó en pausa. Podés reactivarla cuando quieras desde el plan pago.",
		},
	};

export function limitMessage(reason: LimitReason): {
	title: string;
	body: string;
} {
	switch (reason) {
		case "limit:users":
			return {
				title: "Llegaste al límite de personas",
				body: "El plan gratuito incluye hasta 3 personas. Pasá al plan pago para invitar a más.",
			};
		case "limit:skills":
			return {
				title: "Llegaste al límite de skills",
				body: "El plan gratuito incluye hasta 5 skills publicadas. Pasá al plan pago para publicar más.",
			};
		case "limit:ai_credit":
			return {
				title: "Se agotó el crédito de IA del mes",
				body: "El crédito se renueva el primer día del mes. Pasá al plan pago para seguir usando la IA sin cortes.",
			};
		default:
			return SUSPENDED_COPY[
				reason.slice("suspended:".length) as SuspendedReason
			];
	}
}
