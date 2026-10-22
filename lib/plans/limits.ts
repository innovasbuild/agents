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
			title: "Se terminaron los 3 meses del plan gratis",
			body: "Tu equipo puede leer todo, pero no escribir ni usar IA hasta que carguen una tarjeta. Escribinos y lo activamos a mano.",
		},
		pago_fallido: {
			title: "No pudimos cobrar el último pago",
			body: "Tu equipo puede leer todo, pero no escribir ni usar IA hasta que se regularice el pago. Escribinos y lo resolvemos.",
		},
		cancelado: {
			title: "La suscripción está cancelada",
			body: "Tu equipo puede leer todo, pero no escribir ni usar IA. Escribinos si querés volver a activar el plan.",
		},
	};

export function limitMessage(reason: LimitReason): {
	title: string;
	body: string;
} {
	switch (reason) {
		case "limit:users":
			return {
				title: "Tu equipo creció",
				body: "El plan gratis incluye 3 personas. Estamos terminando el pago con tarjeta; mientras tanto, escribinos y lo activamos a mano.",
			};
		case "limit:skills":
			return {
				title: "Llegaste a las 5 skills del plan gratis",
				body: "Para publicar la sexta hace falta pasar al plan pago, donde las skills no tienen tope. Estamos terminando el pago con tarjeta; mientras tanto, escribinos y lo activamos a mano.",
			};
		case "limit:ai_credit":
			return {
				title: "Se terminó el crédito de IA de este mes",
				body: "El plan gratis incluye USD 5 de IA por mes y ya los usaron. El brain y las páginas siguen disponibles; solo el chat espera hasta el mes que viene o hasta que pasen al plan pago (escribinos y lo activamos a mano).",
			};
		default:
			return SUSPENDED_COPY[
				reason.slice("suspended:".length) as SuspendedReason
			];
	}
}
