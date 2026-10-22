import { redirect } from "next/navigation";
import { emailDomain } from "@/lib/invitations/domain";
import { createServerSupabase } from "@/lib/supabase/server";
import { signupRoute } from "@/lib/tenants/signup-route";
import { StepIndicator } from "../step-indicator";
import { EmpresaForm } from "./empresa-form";

export default async function EmpresaPage() {
	const supabase = await createServerSupabase();
	const { data } = await supabase.auth.getUser();
	if (!data.user) redirect("/empezar");

	// Quien ya tiene empresa o su dominio ya está tomado no pasa por acá.
	if ((await signupRoute(supabase)) !== "empezar") redirect("/empezar");

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-[480px] space-y-6">
				<p className="text-center font-medium text-primary text-xl">
					Central IA
				</p>
				<div className="space-y-6 rounded-xl border bg-card p-6">
					<StepIndicator step={2} />
					<div className="space-y-2">
						<h1 className="text-2xl leading-tight">Contanos de tu empresa</h1>
						<p className="text-muted-foreground text-sm">
							Con esto armamos tu espacio. Lo demás se cambia después desde
							Configuración.
						</p>
					</div>
					<EmpresaForm
						defaultDomain={emailDomain(data.user.email ?? "") ?? ""}
					/>
				</div>
			</div>
		</main>
	);
}
