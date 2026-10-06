"use client";

import { useEffect, useState } from "react";
import { resolveConfirmation } from "@/lib/auth/confirm";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Cierra el ingreso de un link de invitación. El cliente de Supabase lee el
 * #access_token de la URL al iniciar y deja la sesión en cookies; después se
 * aceptan las invitaciones y se sigue al portal de la empresa.
 */
export function Confirmar({ next }: { next: string | null }) {
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const supabase = createBrowserSupabase();

		resolveConfirmation({
			// getSession espera a que termine la lectura del fragmento.
			hasSession: async () =>
				(await supabase.auth.getSession()).data.session !== null,
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
