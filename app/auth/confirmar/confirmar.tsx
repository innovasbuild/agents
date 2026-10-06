"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	emailFromAccessToken,
	landingPathFor,
	parseSessionFragment,
	resolveConfirmation,
} from "@/lib/auth/confirm";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Phase =
	| { kind: "reading" }
	| { kind: "ready"; email: string | null }
	| { kind: "failed" }
	| { kind: "working" };

/**
 * Cierra el ingreso de un link de invitación. La sesión viene en el fragmento
 * de la URL (#access_token=...). NO se abre sola: un link armado con tokens
 * ajenos dejaría a quien lo abre logueado como otra persona, así que primero
 * se le muestra con qué cuenta va a entrar y se espera su confirmación.
 */
export function Confirmar({ next }: { next: string | null }) {
	const [phase, setPhase] = useState<Phase>({ kind: "reading" });
	// El fragmento se saca de la URL apenas se lee; en desarrollo React corre
	// el efecto dos veces y la segunda ya no lo encontraría.
	const fragment = useRef<string | null>(null);

	useEffect(() => {
		if (fragment.current === null) {
			fragment.current = window.location.hash;
			window.history.replaceState(
				null,
				"",
				window.location.pathname + window.location.search,
			);
		}
		const tokens = parseSessionFragment(fragment.current);
		setPhase(
			tokens
				? { kind: "ready", email: emailFromAccessToken(tokens.accessToken) }
				: { kind: "failed" },
		);
	}, []);

	function continuar() {
		setPhase({ kind: "working" });
		const supabase = createBrowserSupabase();

		resolveConfirmation({
			fragment: fragment.current ?? "",
			clearFragment: () => {},
			openSession: async (tokens) => {
				const { error } = await supabase.auth.setSession({
					access_token: tokens.accessToken,
					refresh_token: tokens.refreshToken,
				});
				return !error;
			},
			acceptInvitations: async () => {
				const { error } = await supabase.rpc("accept_pending_invitations");
				if (error) throw error;
			},
			next,
			origin: window.location.origin,
		})
			// replace: volver atrás no tiene que reabrir esta pantalla.
			.then((destination) => window.location.replace(destination))
			.catch(() => setPhase({ kind: "failed" }));
	}

	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-sm space-y-4 text-center">
				{phase.kind === "ready" ? (
					<>
						<p>
							{phase.email ? (
								<>
									Vas a entrar como <strong>{phase.email}</strong>.
								</>
							) : (
								"Vas a entrar con el link de tu invitación."
							)}
						</p>
						<Button className="w-full" size="lg" onClick={continuar}>
							Continuar
						</Button>
					</>
				) : null}

				{phase.kind === "failed" ? (
					<>
						<p role="alert">
							El link venció o ya se usó. Pedí uno nuevo desde la página de tu
							empresa.
						</p>
						<Button asChild className="w-full" size="lg" variant="outline">
							<a href={landingPathFor(next)}>Ir a la página de ingreso</a>
						</Button>
					</>
				) : null}

				{phase.kind === "reading" || phase.kind === "working" ? (
					<p className="text-muted-foreground" role="status">
						Entrando…
					</p>
				) : null}
			</div>
		</main>
	);
}
