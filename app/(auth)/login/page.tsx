// app/(auth)/login/page.tsx  → la ruta es /login: (auth) es route group y no aparece en la URL
import { AUTH_METHODS } from "@/lib/tenants/auth-methods";
import { LoginForm } from "./login-form";

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string }>;
}) {
	const { next } = await searchParams;

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-sm space-y-8">
				<div className="space-y-2 text-center">
					<h1 className="text-3xl leading-tight">INNOV.AS Agents</h1>
					<p className="text-muted-foreground">
						Entrá con la cuenta con la que te invitaron.
					</p>
				</div>
				<LoginForm methods={[...AUTH_METHODS]} next={next ?? null} />
			</div>
		</main>
	);
}
