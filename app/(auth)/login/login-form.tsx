"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { OAUTH_PROVIDERS, type OAuthMethod } from "@/lib/auth/oauth-providers";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AuthMethod } from "@/lib/tenants/auth-methods";
import { canSignUpByDomain, verifyEmailCode } from "./actions";

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
	const [code, setCode] = useState("");
	const [codeError, setCodeError] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);

	// Microsoft primero: es el método de quien llega con cuenta corporativa.
	const oauthMethods = (["microsoft", "google"] as const).filter((method) =>
		methods.includes(method),
	);
	const showEmail = methods.includes("email");

	async function entrarCon(method: OAuthMethod) {
		const { provider, scopes } = OAUTH_PROVIDERS[method];
		await supabase.auth.signInWithOAuth({
			provider,
			options: { scopes, redirectTo: callbackUrl(next) },
		});
	}

	async function pedirCodigo(event: React.SyntheticEvent) {
		event.preventDefault();
		await requestMagicLink({
			email,
			redirectTo: callbackUrl(next),
			canSignUpByDomain,
			signInWithOtp: (args) => supabase.auth.signInWithOtp(args),
		});
		// El mensaje es el mismo con o sin acceso: no confirmamos quién tiene cuenta.
		setSent(true);
		setCode("");
		setCodeError(null);
	}

	async function entrarConCodigo(event: React.FormEvent) {
		event.preventDefault();
		setChecking(true);
		setCodeError(null);
		try {
			// Con éxito la acción redirige y esta promesa no vuelve.
			const result = await verifyEmailCode(email, code, next);
			if (result && !result.ok) setCodeError(result.message);
		} finally {
			setChecking(false);
		}
	}

	return (
		<div className="space-y-6 rounded-lg border bg-card p-6">
			{oauthMethods.map((method, index) => (
				<Button
					className="w-full"
					key={method}
					onClick={() => entrarCon(method)}
					size="lg"
					type="button"
					variant={index === 0 ? "default" : "outline"}
				>
					{OAUTH_PROVIDERS[method].label}
				</Button>
			))}

			{oauthMethods.length > 0 && showEmail ? (
				<div className="flex items-center gap-3 text-muted-foreground text-xs">
					<span className="h-px flex-1 bg-border" />o
					<span className="h-px flex-1 bg-border" />
				</div>
			) : null}

			{showEmail && !sent ? (
				<form className="space-y-3" onSubmit={pedirCodigo}>
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
						variant={oauthMethods.length > 0 ? "outline" : "default"}
					>
						Mandarme un código
					</Button>
				</form>
			) : null}

			{showEmail && sent ? (
				<form className="space-y-3" onSubmit={entrarConCodigo}>
					<p className="text-muted-foreground text-sm" role="status">
						Si {email} tiene acceso, le llega un correo con un código de 6
						dígitos y un link. Usá cualquiera de los dos.
					</p>
					<label className="block text-sm" htmlFor="code">
						Código
					</label>
					<Input
						autoComplete="one-time-code"
						id="code"
						inputMode="numeric"
						maxLength={7}
						onChange={(event) => setCode(event.target.value)}
						placeholder="123456"
						required
						value={code}
					/>
					{codeError ? (
						<p className="text-destructive text-sm" role="alert">
							{codeError}
						</p>
					) : null}
					<Button className="w-full" disabled={checking} type="submit">
						Entrar
					</Button>
					<div className="flex justify-between text-sm">
						<button
							className="underline underline-offset-4"
							onClick={pedirCodigo}
							type="button"
						>
							Mandar otro
						</button>
						<button
							className="underline underline-offset-4"
							onClick={() => setSent(false)}
							type="button"
						>
							Usar otro correo
						</button>
					</div>
				</form>
			) : null}
		</div>
	);
}
