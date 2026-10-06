import { safeNextPath } from "@/lib/auth/next-path";

/**
 * Tokens de sesión del fragmento de un link de invitación. El cliente de
 * navegador de @supabase/ssr usa PKCE y rechaza este flujo implícito, así que
 * la pantalla los lee acá y abre la sesión con setSession. Un fragmento de
 * error (link vencido) o incompleto da null.
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
 * Decide adónde va quien llega a /auth/confirmar. Ese es el destino de los
 * links de invitación: Supabase devuelve la sesión en el fragmento de la URL
 * (#access_token=...) y no con ?code=, así que solo el navegador puede leerla.
 * El cliente de navegador la procesa al iniciar; acá se decide qué sigue.
 */
export async function resolveConfirmation(params: {
	hasSession: () => Promise<boolean>;
	acceptInvitations: () => Promise<void>;
	next: string | null;
	origin: string;
}): Promise<string> {
	if (!(await params.hasSession())) return "/login?error=auth_failed";

	// Igual que /auth/callback: las invitaciones pendientes para este mail
	// verificado se convierten en memberships acá y en ningún otro lado. Si
	// falla, la sesión ya está abierta y se sigue: la próxima entrada reintenta.
	try {
		await params.acceptInvitations();
	} catch (error) {
		console.error("No se pudieron aceptar las invitaciones:", error);
	}

	return safeNextPath(params.next, params.origin);
}
