import { notFound, redirect } from "next/navigation";
import { effectiveResearch } from "@/lib/onboarding/research-status";
import { createResearchStore } from "@/lib/onboarding/research-store";
import { type OnboardingStep, stepPath } from "@/lib/onboarding/steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { StepIndicator } from "../../step-indicator";
import { CarpetasForm } from "./carpetas-form";

export default async function CarpetasPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const supabase = await createServerSupabase();
	const { data } = await supabase.auth.getUser();
	if (!data.user) redirect("/empezar");

	const access = await resolveTenantAccess(slug);
	if (!access || access.role === "tenant_member") notFound();

	const admin = createAdminClient();
	const { data: tenant } = await admin
		.from("tenants")
		.select("onboarding_step, allowed_domains")
		.eq("id", access.id)
		.single();
	if (!tenant) notFound();
	if (tenant.onboarding_step !== "carpetas") {
		redirect(
			tenant.onboarding_step
				? stepPath(slug, tenant.onboarding_step as OnboardingStep)
				: `/${slug}/chat`,
		);
	}

	let research = null;
	try {
		const row = await createResearchStore(admin).read(access.id);
		research = row ? effectiveResearch(row) : null;
	} catch (error) {
		console.error("carpetas: no pude leer el research", error);
	}

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-[720px] space-y-6">
				<p className="text-center font-medium text-primary text-xl">
					Central IA
				</p>
				<div className="space-y-6 rounded-xl border bg-card p-6">
					<StepIndicator step={3} />
					<CarpetasForm
						displayName={access.displayName}
						domain={tenant.allowed_domains?.[0] ?? ""}
						initial={research}
						slug={slug}
					/>
				</div>
			</div>
		</main>
	);
}
