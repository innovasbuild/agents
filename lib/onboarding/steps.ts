// Pasos del onboarding después de crear la empresa (spec 27 §4). El paso 1
// (cuenta) y el 2 (empresa) viven antes de que exista el slug.
export type OnboardingStep = "carpetas" | "logo" | "acceso" | "equipo";

export const STEP_ORDER: OnboardingStep[] = [
	"carpetas",
	"logo",
	"acceso",
	"equipo",
];

export function stepPath(slug: string, step: OnboardingStep): string {
	return `/empezar/${slug}/${step}`;
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
	return STEP_ORDER[STEP_ORDER.indexOf(step) + 1] ?? null;
}
