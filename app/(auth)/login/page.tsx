// app/(auth)/login/page.tsx  → la ruta es /login: (auth) es route group y no aparece en la URL
"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const SCOPES = [
	"openid",
	"email",
	"profile",
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export default function LoginPage() {
	const supabase = createBrowserSupabase();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);

	async function entrar() {
		await supabase.auth.signInWithOAuth({
			provider: "google",
			options: {
				scopes: SCOPES,
				queryParams: { access_type: "offline", prompt: "consent" },
				redirectTo: `${window.location.origin}/auth/callback`,
			},
		});
	}

	async function entrarConMagicLink(event: React.FormEvent) {
		event.preventDefault();
		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
		});
		// El mensaje no distingue mail existente de inexistente: no le confirmamos
		// a nadie quién tiene cuenta en la plataforma.
		setSent(!error);
	}

	return (
		<main>
			<h1>INNOV.AS Agents</h1>
			<button type="button" onClick={entrar}>
				Entrar con Google
			</button>
			<form onSubmit={entrarConMagicLink}>
				<input
					onChange={(event) => setEmail(event.target.value)}
					placeholder="tu@empresa.com"
					type="email"
					value={email}
				/>
				<button type="submit">Mandarme un link</button>
			</form>
			{sent ? (
				<p>Si ese mail tiene acceso, te llega un link para entrar.</p>
			) : null}
		</main>
	);
}
