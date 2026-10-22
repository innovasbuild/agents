"use client";

import { CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { closeLocalSession } from "@/lib/auth/close-session";
import { enterWithEmailCode } from "@/lib/auth/email-code";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { OAUTH_PROVIDERS, type OAuthMethod } from "@/lib/auth/oauth-providers";
import { emailDomain } from "@/lib/invitations/domain";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AuthMethod } from "@/lib/tenants/auth-methods";
import { isPublicEmailDomain } from "@/lib/tenants/public-email-domains";
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

/** Error inline del paso 1 (copy-deck): vacío, formato o dominio público. */
export function signupEmailProblem(email: string): string | null {
	const value = email.trim();
	if (!value) return "Escribí tu correo de trabajo.";
	const domain = emailDomain(value);
	if (!domain || !domain.includes(".")) return "Ese correo no parece válido.";
	if (isPublicEmailDomain(domain))
		return `Necesitás un correo de tu empresa para crear una cuenta. Con ${domain} no podemos armar tu espacio. Si te invitaron, entrá por el link de la invitación.`;
	return null;
}

/**
 * Un solo formulario para /login y para la landing de cada empresa. La
 * landing pasa solo los métodos permitidos; un método que no viene no se
 * renderiza (spec alta A2: la restricción es de pantalla).
 */
export function LoginForm({
	methods,
	next,
	mode = "login",
}: {
	methods: AuthMethod[];
	next: string | null;
	/** "signup": pantalla /empezar (spec 27 paso 1); cambia copys y la regla del correo. */
	mode?: "login" | "signup";
}) {
	const signup = mode === "signup";
	const supabase = createBrowserSupabase();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [code, setCode] = useState("");
	const [codeError, setCodeError] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);
	const [sending, setSending] = useState(false);
	const [secondsLeft, setSecondsLeft] = useState(0);
	const [emailError, setEmailError] = useState<string | null>(null);

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
		if (signup) {
			const problem = signupEmailProblem(email);
			setEmailError(problem);
			if (problem) return;
		}
		setSending(true);
		try {
			await requestMagicLink({
				email,
				redirectTo: callbackUrl(next),
				canSignUpByDomain: signup
					? (value) => canSignUpByDomain(value, "signup")
					: canSignUpByDomain,
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
			setCodeError(
				await enterWithEmailCode({
					email,
					code,
					verifyOtp: (args) => supabase.auth.verifyOtp(args),
					completeLogin: () => completeLogin(next),
					closeSession: () => closeLocalSession(supabase),
					// Navegación completa: el pedido siguiente lleva las cookies
					// que dejó verifyOtp y el servidor arma la página de cero.
					navigate: (target) => window.location.assign(target),
				}),
			);
		} finally {
			setChecking(false);
		}
	}

	return (
		<div className="space-y-6 rounded-lg border bg-card p-6">
			{signup ? (
				<div className="space-y-2">
					<h1 className="text-2xl leading-tight">Creá tu cuenta</h1>
					<p className="text-muted-foreground text-sm">
						Gratis para equipos de hasta 3 personas, con un crédito mensual de
						IA incluido. Sin tarjeta.
					</p>
				</div>
			) : null}
			{oauthMethods.map((method, index) => (
				<Button
					className="w-full"
					key={method}
					onClick={() => entrarCon(method)}
					size="lg"
					type="button"
					variant={index === 0 ? "default" : "outline"}
				>
					{signup
						? `Continuar con ${OAUTH_PROVIDERS[method].label.replace(/^Entrar con /, "")}`
						: OAUTH_PROVIDERS[method].label}
				</Button>
			))}

			{oauthMethods.length > 0 && showEmail ? (
				<div className="flex items-center gap-3 text-muted-foreground text-xs">
					<span className="h-px flex-1 bg-border" />o
					<span className="h-px flex-1 bg-border" />
				</div>
			) : null}

			{showEmail && !sent ? (
				<form className="space-y-3" noValidate={signup} onSubmit={pedirCodigo}>
					<label className="block text-sm" htmlFor="email">
						{signup ? "Correo de trabajo" : "Mail"}
					</label>
					<Input
						aria-invalid={emailError ? true : undefined}
						autoComplete="email"
						id="email"
						onChange={(event) => setEmail(event.target.value)}
						placeholder={signup ? "vos@tuempresa.com" : "tu@empresa.com"}
						required
						type="email"
						value={email}
					/>
					{emailError ? (
						<p
							className="flex items-start gap-2 text-destructive text-sm"
							role="alert"
						>
							<CircleAlert className="mt-0.5 size-4 shrink-0" />
							{emailError}
						</p>
					) : null}
					{signup ? (
						<p className="text-muted-foreground text-xs">
							Te mandamos un código para entrar. Usá el correo de tu empresa:
							con él armamos tu espacio.
						</p>
					) : null}
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
			{signup ? (
				<p className="text-muted-foreground text-xs">
					Al crear la cuenta aceptás los términos y la política de privacidad.
				</p>
			) : null}
		</div>
	);
}
