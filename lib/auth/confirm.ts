import type { GateResult } from "@/lib/auth/login-gate";
import { safeNextPath } from "@/lib/auth/next-path";

/**
 * Tokens de sesión del fragmento de un link de invitación. Supabase los
 * devuelve ahí (#access_token=...) y no con ?code=, así que solo el navegador
 * puede leerlos. El cliente de navegador de @supabase/ssr usa PKCE y rechaza
 * este flujo implícito: se abre la sesión a mano con setSession. Un
 * fragmento de error (link vencido) o incompleto da null.
 */
export function parseSessionFragment(
	hash: string,
): { accessToken: string; refreshToken: string } | null {
	const params = new URLSearchParams(hash.replace(/^#/, ""));
	const accessToken = params.get("access_token");
	const refreshToken = params.get("refresh_token");
	if (!accessToken || !refreshToken) return null;

	return { accessToken, refreshToken };
}

/**
 * Correo del payload de un access token, SIN verificar la firma: sirve solo
 * para mostrarle a la persona con qué cuenta está por entrar. Lo que vale es
 * la sesión que después valida Supabase, nunca este dato.
 */
export function emailFromAccessToken(token: string): string | null {
	const payload = token.split(".")[1];
	if (!payload) return null;
	try {
		// atob y no Buffer: esto corre en el navegador.
		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const decoded = JSON.parse(
			atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")),
		);
		return typeof decoded?.email === "string" ? decoded.email : null;
	} catch {
		return null;
	}
}

/**
 * Landing de la empresa a la que apunta un `next` del estilo /<slug>/chat, para
 * ofrecerla cuando el link venció. Cualquier otra cosa va al login general.
 */
export function landingPathFor(next: string | null): string {
	const slug = next?.match(/^\/([a-z][a-z0-9-]{1,38})\//)?.[1];
	return slug ? `/login/${slug}` : "/login";
}

/**
 * Cierra el ingreso por link de invitación, cuando la persona confirmó con
 * qué cuenta entra. No abre sesión sin tokens válidos en el fragmento: un
 * fragmento de error no se salva por haber una sesión previa en el navegador.
 */
export async function resolveConfirmation(params: {
	fragment: string;
	/** Saca el fragmento de la barra y del historial; corre antes de toda espera. */
	clearFragment: () => void;
	openSession: (tokens: {
		accessToken: string;
		refreshToken: string;
	}) => Promise<boolean>;
	acceptInvitations: () => Promise<void>;
	/** El corte por método, después de aceptar invitaciones. */
	gate: () => Promise<GateResult>;
	closeSession: () => Promise<void>;
	next: string | null;
	origin: string;
}): Promise<string> {
	const tokens = parseSessionFragment(params.fragment);
	params.clearFragment();
	if (!tokens) return "/login?error=auth_failed";

	if (!(await params.openSession(tokens))) return "/login?error=auth_failed";

	// Igual que /auth/callback: las invitaciones pendientes para este mail
	// verificado se convierten en memberships acá y en ningún otro lado. Si
	// falla, la sesión ya está abierta y se sigue: la próxima entrada reintenta.
	try {
		await params.acceptInvitations();
	} catch (error) {
		console.error("No se pudieron aceptar las invitaciones:", error);
	}

	let gate: GateResult;
	try {
		gate = await params.gate();
	} catch (error) {
		console.error("No se pudo chequear el método de ingreso:", error);
		gate = { ok: false, landing: "/login?error=auth_failed" };
	}
	if (!gate.ok) {
		try {
			await params.closeSession();
		} catch (error) {
			console.error("No se pudo cerrar la sesión tras el corte:", error);
		}
		return gate.landing;
	}

	return safeNextPath(params.next, params.origin);
}
