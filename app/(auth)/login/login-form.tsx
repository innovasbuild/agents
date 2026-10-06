"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AuthMethod } from "@/lib/tenants/auth-methods";

const SCOPES = "openid email profile";

function callbackUrl(next: string | null): string {
	const base = `${window.location.origin}/auth/callback`;
	return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/**
 * Un solo formulario para /login y para la landing de cada empresa. La
 * landing pasa solo los métodos permitidos; un método que no viene no se
 * renderiza (spec alta A2: la restricción es de pantalla).
 */
export function LoginForm({
	methods,
	next,
}: {
	methods: AuthMethod[];
	next: string | null;
}) {
	const supabase = createBrowserSupabase();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);

	const showGoogle = methods.includes("google");
	const showEmail = methods.includes("email");

	async function entrarConGoogle() {
		await supabase.auth.signInWithOAuth({
			provider: "google",
			options: { scopes: SCOPES, redirectTo: callbackUrl(next) },
		});
	}

	async function entrarConMagicLink(event: React.FormEvent) {
		event.preventDefault();
		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: {
				emailRedirectTo: callbackUrl(next),
				// Sin esto, un mail nunca invitado crea igual una fila en auth.users
				// y recibe un link. Un invitado real ya tiene su fila.
				shouldCreateUser: false,
			},
		});
		// No distingue mail existente de inexistente: no confirmamos quién tiene cuenta.
		setSent(!error);
	}

	return (
		<div className="space-y-6 rounded-lg border bg-card p-6">
			{showGoogle ? (
				<Button
					className="w-full"
					onClick={entrarConGoogle}
					size="lg"
					type="button"
				>
					Entrar con Google
				</Button>
			) : null}

			{showGoogle && showEmail ? (
				<div className="flex items-center gap-3 text-muted-foreground text-xs">
					<span className="h-px flex-1 bg-border" />o
					<span className="h-px flex-1 bg-border" />
				</div>
			) : null}

			{showEmail ? (
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
					<Button
						className="w-full"
						type="submit"
						variant={showGoogle ? "outline" : "default"}
					>
						Mandarme un link
					</Button>
				</form>
			) : null}

			{sent ? (
				<p className="text-muted-foreground text-sm" role="status">
					Si ese mail tiene acceso, te llega un link para entrar.
				</p>
			) : null}
		</div>
	);
}
