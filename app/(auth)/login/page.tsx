// app/(auth)/login/page.tsx  → la ruta es /login: (auth) es route group y no aparece en la URL
"use client";

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

	return (
		<main>
			<h1>INNOV.AS Agents</h1>
			<button type="button" onClick={entrar}>
				Entrar con Google
			</button>
		</main>
	);
}
