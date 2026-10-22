import { redirect } from "next/navigation";
import { type OnboardingStep, stepPath } from "@/lib/onboarding/steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// Por defecto de la columna tenants.default_model, si no se pudo leer.
const FALLBACK_MODEL = "anthropic/claude-sonnet-5";
const SLUG = /^[a-z0-9-]{1,63}$/;

/**
 * Puerta de las acciones del alta. Una server action es un endpoint público:
 * la empresa sale del slug resuelto con la sesión (nunca un id del navegador) y
 * quien llama tiene que ser administrador de ESA empresa.
 */
export async function onboardingGate(slug: string) {
	if (!SLUG.test(slug)) return null;
	const access = await resolveTenantAccess(slug);
	if (!access || access.role === "tenant_member") return null;
	const admin = createAdminClient();
	const { data, error } = await admin
		.from("tenants")
		.select("onboarding_step, allowed_domains, default_model")
		.eq("id", access.id)
		.single();
	if (error || !data) return null;
	return {
		access,
		admin,
		step: data.onboarding_step as OnboardingStep | null,
		domain: data.allowed_domains?.[0] ?? "",
		model: data.default_model || access.defaultModel || FALLBACK_MODEL,
	};
}

export type OnboardingGate = NonNullable<
	Awaited<ReturnType<typeof onboardingGate>>
>;

/** A dónde va quien llega a un paso que no le toca. */
export function stepRedirectPath(
	slug: string,
	step: OnboardingStep | null,
): string {
	return step ? stepPath(slug, step) : `/${slug}/chat`;
}

/**
 * Puerta de una acción de paso: administrador del slug y `onboarding_step`
 * igual al de la ruta. Si es otro, redirige al paso real (o al chat si el alta
 * terminó). Devuelve null si no tiene permiso. Llamarla FUERA de un try/catch:
 * redirect() tira.
 */
export async function gateForStep(
	slug: string,
	step: OnboardingStep,
): Promise<OnboardingGate | null> {
	const g = await onboardingGate(slug);
	if (!g) return null;
	if (g.step !== step) redirect(stepRedirectPath(slug, g.step));
	return g;
}
