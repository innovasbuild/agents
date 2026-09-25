// app/(auth)/login/page.tsx  → la ruta es /login: (auth) es route group y no aparece en la URL
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const SCOPES = "openid email profile";

function callbackUrl(): string {
	const next = new URLSearchParams(window.location.search).get("next");
	const base = `${window.location.origin}/auth/callback`;
	return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

export default function LoginPage() {
	const supabase = createBrowserSupabase();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);

	async function entrar() {
		await supabase.auth.signInWithOAuth({
			provider: "google",
			options: {
				scopes: SCOPES,
				redirectTo: callbackUrl(),
			},
		});
	}

	async function entrarConMagicLink(event: React.FormEvent) {
		event.preventDefault();
		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: {
				emailRedirectTo: callbackUrl(),
				// Sin esto, un mail nunca invitado crea igual una fila en auth.users
				// y recibe un link — contradice "alta solo por invitación". Un
				// invitado real ya tiene su fila (la crea admin.inviteUserByEmail al
				// invitarlo), así que este flag no le rompe el login a nadie invitado.
				shouldCreateUser: false,
			},
		});
		// El mensaje no distingue mail existente de inexistente: no le confirmamos
		// a nadie quién tiene cuenta en la plataforma.
		setSent(!error);
	}

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-sm space-y-8">
				<div className="space-y-2 text-center">
					<h1 className="text-3xl leading-tight">INNOV.AS Agents</h1>
					<p className="text-muted-foreground">
						Entrá con la cuenta con la que te invitaron.
					</p>
				</div>

				<div className="space-y-6 rounded-lg border bg-card p-6">
					<Button className="w-full" onClick={entrar} size="lg" type="button">
						Entrar con Google
					</Button>

					<div className="flex items-center gap-3 text-muted-foreground text-xs">
						<span className="h-px flex-1 bg-border" />o
						<span className="h-px flex-1 bg-border" />
					</div>

					<form className="space-y-3" onSubmit={entrarConMagicLink}>
						<label className="block text-sm" htmlFor="email">
							Mail
						</label>
						<Input
							autoComplete="email"
							id="email"
							onChange={(event) => setEmail(event.target.value)}
							placeholder="tu@empresa.com"
							required
							type="email"
							value={email}
						/>
						<Button className="w-full" type="submit" variant="outline">
							Mandarme un link
						</Button>
					</form>

					{sent ? (
						<p className="text-muted-foreground text-sm" role="status">
							Si ese mail tiene acceso, te llega un link para entrar.
						</p>
					) : null}
				</div>
			</div>
		</main>
	);
}
