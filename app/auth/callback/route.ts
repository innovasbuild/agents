import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

// Mismos scopes PEDIDOS en app/(auth)/login/page.tsx (no necesariamente los
// OTORGADOS: si el usuario deniega alguno en la pantalla de consentimiento de
// Google, esta constante no lo reflejaría). Investigado como parte del
// review de esta task: ni `data.session` (provider_token/provider_refresh_token)
// ni `data.user.identities[].identity_data` que devuelve exchangeCodeForSession
// traen el scope realmente concedido — ese dato vive en la respuesta del token
// endpoint de Google, que Supabase (GoTrue) consume server-side y no reexpone
// al cliente. La única forma de obtener el scope real sería una llamada aparte
// a `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=<provider_token>`,
// que se dejó fuera de esta task por ser trabajo adicional (llamada a un
// endpoint externo, con su propia latencia/fallas, en el camino crítico del
// login). Ver abajo, en el upsert.
const SCOPES = [
	"openid",
	"email",
	"profile",
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

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
		// No se toca google_tokens: la sesión no se pudo establecer.
		return NextResponse.redirect(
			new URL("/login?error=auth_failed", requestUrl.origin),
		);
	}

	const refreshToken = data.session.provider_refresh_token;

	// Google solo manda refresh token la primera vez que el usuario consiente
	// (o cuando se fuerza `prompt=consent`). Si esta vez no vino, no se debe
	// sobreescribir el que ya está guardado con null.
	if (refreshToken) {
		try {
			const admin = createAdminClient();
			const { error: upsertError } = await admin.from("google_tokens").upsert(
				{
					user_id: data.user.id,
					refresh_token: refreshToken,
					// IMPORTANTE: SCOPES es lo solicitado, no lo otorgado. Esta
					// columna no es fuente de verdad de permisos reales del usuario.
					scope: SCOPES,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "user_id" },
			);

			if (upsertError) {
				console.error(
					"No se pudo guardar el refresh token de Google:",
					upsertError.message,
				);
			}
		} catch (err) {
			console.error("Error inesperado al guardar el refresh token:", err);
		}
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

	return NextResponse.redirect(new URL("/", requestUrl.origin));
}
