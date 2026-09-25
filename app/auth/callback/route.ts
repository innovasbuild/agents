import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/next-path";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
	const requestUrl = new URL(request.url);
	const code = requestUrl.searchParams.get("code");

	if (!code) {
		return NextResponse.redirect(
			new URL("/login?error=missing_code", requestUrl.origin),
		);
	}

	const supabase = await createServerSupabase();
	const { data, error } = await supabase.auth.exchangeCodeForSession(code);

	if (error || !data.session || !data.user) {
		return NextResponse.redirect(
			new URL("/login?error=auth_failed", requestUrl.origin),
		);
	}

	// Alta solo por invitación: si hay invitaciones pendientes para este mail
	// verificado, se convierten en memberships acá y en ningún otro lado.
	const { error: acceptError } = await supabase.rpc(
		"accept_pending_invitations",
	);
	if (acceptError) {
		console.error(
			"No se pudieron aceptar las invitaciones:",
			acceptError.message,
		);
	}

	const next = safeNextPath(
		requestUrl.searchParams.get("next"),
		requestUrl.origin,
	);
	return NextResponse.redirect(new URL(next, requestUrl.origin));
}
