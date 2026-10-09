// app/(auth)/login/page.tsx  → la ruta es /login: (auth) es route group y no aparece en la URL
import { loginErrorMessage } from "@/lib/auth/login-error";
import { loadOfferedMethods } from "@/lib/tenants/public";
import { LoginForm } from "./login-form";

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string; error?: string }>;
}) {
	const { next, error } = await searchParams;
	const methods = await loadOfferedMethods();
	const notice = loginErrorMessage(error);

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-sm space-y-8">
				<div className="space-y-2 text-center">
					<h1 className="text-3xl leading-tight">INNOV.AS Agents</h1>
					<p className="text-muted-foreground">
						Entrá con la cuenta con la que te invitaron.
					</p>
				</div>
				{notice ? (
					<p className="rounded-md border px-3 py-2 text-sm" role="alert">
						{notice}
					</p>
				) : null}
				<LoginForm methods={methods} next={next ?? null} />
			</div>
		</main>
	);
}
