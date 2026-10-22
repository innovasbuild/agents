import { notFound, redirect } from "next/navigation";
import { onboardingGate, stepRedirectPath } from "@/lib/onboarding/step-gate";
import { createServerSupabase } from "@/lib/supabase/server";
import { StepIndicator } from "../../step-indicator";
import { LogoForm } from "./logo-form";

export default async function LogoPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const supabase = await createServerSupabase();
	const { data } = await supabase.auth.getUser();
	if (!data.user) redirect("/empezar");

	const g = await onboardingGate(slug);
	if (!g) notFound();
	if (g.step !== "logo") redirect(stepRedirectPath(slug, g.step));

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-[480px] space-y-6">
				<p className="text-center font-medium text-primary text-xl">
					Central IA
				</p>
				<div className="space-y-6 rounded-xl border bg-card p-6">
					<StepIndicator step={4} />
					<LogoForm displayName={g.access.displayName} slug={slug} />
				</div>
			</div>
		</main>
	);
}
