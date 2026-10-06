import { safeNextPath } from "@/lib/auth/next-path";

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
