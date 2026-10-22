import { notFound, redirect } from "next/navigation";
import { onboardingGate, stepRedirectPath } from "@/lib/onboarding/step-gate";
import { createPlanStore } from "@/lib/plans/store";
import { createServerSupabase } from "@/lib/supabase/server";
import { StepIndicator } from "../../step-indicator";
import { EquipoForm } from "./equipo-form";

export default async function EquipoPage({
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
	if (g.step !== "equipo") redirect(stepRedirectPath(slug, g.step));

	let users = 1;
	try {
		users = Math.max(
			1,
			(await createPlanStore(g.admin).counts(g.access.id)).users,
		);
	} catch (error) {
		console.error("equipo: no pude contar los usuarios", error);
	}

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-[480px] space-y-6">
				<p className="text-center font-medium text-primary text-xl">
					Central IA
				</p>
				<div className="space-y-6 rounded-xl border bg-card p-6">
					<StepIndicator step={6} />
					<EquipoForm domain={g.domain} slug={slug} users={users} />
				</div>
			</div>
		</main>
	);
}
