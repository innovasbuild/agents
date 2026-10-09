import { NextResponse } from "next/server";
import { joinOnLogin } from "@/lib/auth/join-on-login";
import { gateLogin } from "@/lib/auth/login-gate";
import { safeNextPath } from "@/lib/auth/next-path";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
	const requestUrl = new URL(request.url);
	const code = requestUrl.searchParams.get("code");

	if (!code) {
		// Los links de invitación traen la sesión en el fragmento (#access_token),
		// que el servidor no ve. Se sigue a una pantalla de navegador que la lee;
		// el Location no lleva fragmento propio, así que el navegador conserva el
		// de la URL original.
		const next = safeNextPath(
			requestUrl.searchParams.get("next"),
			requestUrl.origin,
		);
		const target =
			next === "/"
				? "/auth/confirmar"
				: `/auth/confirmar?next=${encodeURIComponent(next)}`;
		return NextResponse.redirect(new URL(target, requestUrl.origin));
	}

	const supabase = await createServerSupabase();
	const { data, error } = await supabase.auth.exchangeCodeForSession(code);

	if (error || !data.session || !data.user) {
		return NextResponse.redirect(
			new URL("/login?error=auth_failed", requestUrl.origin),
		);
	}

	// Las invitaciones pendientes y el ingreso por dominio de este mail
	// verificado se convierten en memberships acá y en ningún otro lado.
	await joinOnLogin(supabase);

	// Recién después de unir: una membresía nueva puede ser la que permite
	// este método. Si ninguna lo permite, la sesión no queda abierta.
	const gate = await gateLogin(supabase);
	if (!gate.ok) {
		try {
			await supabase.auth.signOut();
		} catch (error) {
			console.error("signOut tras el corte falló:", error);
		}
		return NextResponse.redirect(new URL(gate.landing, requestUrl.origin));
	}

	const next = safeNextPath(
		requestUrl.searchParams.get("next"),
		requestUrl.origin,
	);
	return NextResponse.redirect(new URL(next, requestUrl.origin));
}
