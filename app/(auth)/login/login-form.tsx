"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMAIL_CODE_ERROR, verifyEmailCode } from "@/lib/auth/email-code";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { OAUTH_PROVIDERS, type OAuthMethod } from "@/lib/auth/oauth-providers";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AuthMethod } from "@/lib/tenants/auth-methods";
import { canSignUpByDomain, completeLogin } from "./actions";

function callbackUrl(next: string | null): string {
	const base = `${window.location.origin}/auth/callback`;
	return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/** Cuánto espera "Mandar otro" después de un envío. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * "Mandar otro": deshabilitado mientras sale el pedido y durante la espera
 * posterior, para no gastar el límite de envíos de Supabase con dos clics.
 */
export function ResendCodeButton({
	sending,
	secondsLeft,
	onClick,
}: {
	sending: boolean;
	secondsLeft: number;
	onClick: (event: React.SyntheticEvent) => void;
}) {
	return (
		<button
			className="underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline"
			disabled={sending || secondsLeft > 0}
			onClick={onClick}
			type="button"
		>
			{sending
				? "Mandando..."
				: secondsLeft > 0
					? `Mandar otro en ${secondsLeft} s`
					: "Mandar otro"}
		</button>
	);
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
	const [sending, setSending] = useState(false);
	const [secondsLeft, setSecondsLeft] = useState(0);

	useEffect(() => {
		if (secondsLeft <= 0) return;
		const timer = setTimeout(() => setSecondsLeft((left) => left - 1), 1000);
		return () => clearTimeout(timer);
	}, [secondsLeft]);

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
		if (sending) return;
		setSending(true);
		try {
			await requestMagicLink({
				email,
				redirectTo: callbackUrl(next),
				canSignUpByDomain,
				signInWithOtp: (args) => supabase.auth.signInWithOtp(args),
			});
		} finally {
			setSending(false);
		}
		// El código tipeado se borra recién cuando salió el pedido nuevo. El
		// mensaje es el mismo con o sin acceso: no confirmamos quién tiene cuenta.
		setSent(true);
		setCode("");
		setCodeError(null);
		setSecondsLeft(RESEND_COOLDOWN_SECONDS);
	}

	async function entrarConCodigo(event: React.FormEvent) {
		event.preventDefault();
		setChecking(true);
		setCodeError(null);
		try {
			// Se verifica desde el navegador para que el límite por IP de
			// Supabase cuente la IP de la persona. La sesión queda en cookies.
			const verified = await verifyEmailCode({
				email,
				code,
				verifyOtp: (args) => supabase.auth.verifyOtp(args),
			});
			if (!verified) {
				setCodeError(EMAIL_CODE_ERROR);
				return;
			}
			// Con éxito la acción redirige y esta promesa no vuelve.
			const result = await completeLogin(next);
			if (result && !result.ok) setCodeError(result.message);
		} catch (error) {
			// redirect() de la acción no llega acá: Next lo resuelve antes.
			console.error("entrar con código falló:", error);
			setCodeError(EMAIL_CODE_ERROR);
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
						disabled={sending}
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
						Si {email} tiene acceso, le llega un correo con un código y un link.
						Usá cualquiera de los dos.
					</p>
					<label className="block text-sm" htmlFor="code">
						Código
					</label>
					<Input
						autoComplete="one-time-code"
						id="code"
						inputMode="numeric"
						maxLength={11}
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
						<ResendCodeButton
							onClick={pedirCodigo}
							secondsLeft={secondsLeft}
							sending={sending}
						/>
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
