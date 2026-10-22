import { notFound, redirect } from "next/navigation";
import { onboardingGate, stepRedirectPath } from "@/lib/onboarding/step-gate";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAuthMethod } from "@/lib/tenants/auth-methods";
import { StepIndicator } from "../../step-indicator";
import { AccesoForm } from "./acceso-form";

export default async function AccesoPage({
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
	if (g.step !== "acceso") redirect(stepRedirectPath(slug, g.step));

	const { data: tenant } = await g.admin
		.from("tenants")
		.select("auth_methods")
		.eq("id", g.access.id)
		.single();
	const methods = (tenant?.auth_methods ?? []).filter(isAuthMethod);

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-[480px] space-y-6">
				<p className="text-center font-medium text-primary text-xl">
					Central IA
				</p>
				<div className="space-y-6 rounded-xl border bg-card p-6">
					<StepIndicator step={5} />
					<AccesoForm
						domain={g.domain}
						initialMethods={methods.length > 0 ? methods : ["email", "google"]}
						slug={slug}
					/>
				</div>
			</div>
		</main>
	);
}
