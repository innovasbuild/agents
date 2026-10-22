import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { emailDomain } from "@/lib/invitations/domain";
import { createServerSupabase } from "@/lib/supabase/server";
import { signOutToEmpezar } from "./actions";

export default async function DominioTomadoPage() {
	const { data } = await (await createServerSupabase()).auth.getUser();
	if (!data.user) redirect("/empezar");
	const domain = emailDomain(data.user.email ?? "");

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-[480px] space-y-6">
				<p className="text-center font-medium text-primary text-xl">
					Central IA
				</p>
				<div className="space-y-4 rounded-xl border bg-card p-6 text-center">
					<Building2 className="mx-auto size-8 text-primary" />
					<h1 className="text-2xl leading-tight">
						Tu empresa ya está en Central IA
					</h1>
					<p className="text-muted-foreground text-sm">
						Alguien de {domain ?? "tu empresa"} ya creó el espacio. Pedile a
						quien lo administra que te invite: te va a llegar un correo con el
						link para entrar.
					</p>
					<form action={signOutToEmpezar}>
						<Button className="w-full" type="submit" variant="outline">
							Entrar con otro correo
						</Button>
					</form>
				</div>
			</div>
		</main>
	);
}
