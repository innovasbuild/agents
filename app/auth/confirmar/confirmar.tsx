"use client";

import { useEffect, useState } from "react";
import { parseSessionFragment, resolveConfirmation } from "@/lib/auth/confirm";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Cierra el ingreso de un link de invitación. La sesión viene en el fragmento
 * de la URL (#access_token=...): se abre con setSession, que la deja en
 * cookies, se aceptan las invitaciones y se sigue al portal de la empresa.
 */
export function Confirmar({ next }: { next: string | null }) {
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const supabase = createBrowserSupabase();

		resolveConfirmation({
			hasSession: async () => {
				const tokens = parseSessionFragment(window.location.hash);
				if (tokens) {
					const { error } = await supabase.auth.setSession({
						access_token: tokens.accessToken,
						refresh_token: tokens.refreshToken,
					});
					// Fuera de la barra de direcciones y del historial.
					window.history.replaceState(
						null,
						"",
						window.location.pathname + window.location.search,
					);
					if (error) return false;
				}
				return (await supabase.auth.getSession()).data.session !== null;
			},
			acceptInvitations: async () => {
				const { error } = await supabase.rpc("accept_pending_invitations");
				if (error) throw error;
			},
			next,
			origin: window.location.origin,
		})
			.then((destination) => {
				// replace: volver atrás no tiene que reabrir esta pantalla.
				window.location.replace(destination);
			})
			.catch(() => setFailed(true));
	}, [next]);

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<p className="text-muted-foreground" role="status">
				{failed
					? "No pudimos completar el ingreso. Volvé a entrar desde la página de tu empresa."
					: "Entrando…"}
			</p>
		</main>
	);
}
