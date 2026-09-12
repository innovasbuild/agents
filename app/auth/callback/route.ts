import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

// Mismos scopes pedidos en app/(auth)/login/page.tsx. Se guardan como el
// `scope` de la fila porque la sesión de Supabase no expone el scope
// efectivamente otorgado por Google.
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

	return NextResponse.redirect(new URL("/chat", requestUrl.origin));
}
