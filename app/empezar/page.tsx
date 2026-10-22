import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { signupRoute, signupRoutePath } from "@/lib/tenants/signup-route";
import { LoginForm } from "../(auth)/login/login-form";

export default async function EmpezarPage() {
	const supabase = await createServerSupabase();
	const { data } = await supabase.auth.getUser();

	if (data.user) {
		const route = await signupRoute(supabase);
		let slug: string | null = null;
		if (route === "chat") {
			const { data: rows } = await supabase
				.from("memberships")
				.select("tenants (slug)")
				.eq("user_id", data.user.id)
				.order("created_at")
				.limit(1)
				.returns<{ tenants: { slug: string } | null }[]>();
			slug = rows?.[0]?.tenants?.slug ?? null;
		}
		redirect(signupRoutePath(route, slug));
	}

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-[480px] space-y-6">
				<p className="text-center font-medium text-primary text-xl">
					Central IA
				</p>
				<LoginForm
					methods={["microsoft", "google", "email"]}
					mode="signup"
					next="/empezar"
				/>
			</div>
		</main>
	);
}
