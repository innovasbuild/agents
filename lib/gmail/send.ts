import { createAdminClient } from "../supabase/admin";
import { buildRawMessage } from "./mime";

type MailInput = { to: string; subject: string; body: string };

type GoogleTokenErrorBody = { error?: string; error_description?: string };

export async function getAccessToken(userId: string): Promise<string> {
	const supabase = createAdminClient();
	const { data, error } = await supabase
		.from("google_tokens")
		.select("refresh_token")
		.eq("user_id", userId)
		.maybeSingle();

	if (error) {
		throw new Error(
			`no pude leer la conexión de Google para este usuario: ${error.message}`,
		);
	}
	if (!data) {
		throw new Error(
			"no encontré una conexión de Google para este usuario; hay que volver a entrar con Google",
		);
	}

	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
			client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
			refresh_token: data.refresh_token,
			grant_type: "refresh_token",
		}),
	});

	if (!res.ok) {
		const bodyText = await res.text();
		let parsed: GoogleTokenErrorBody | null = null;
		try {
			parsed = JSON.parse(bodyText) as GoogleTokenErrorBody;
		} catch {
			parsed = null;
		}

		if (parsed?.error === "invalid_grant") {
			throw new Error(
				"la conexión con Google venció; hay que volver a entrar con Google para reconectar",
			);
		}

		throw new Error(
			`no pude renovar el token de Google (${res.status}): ${bodyText}`,
		);
	}

	const json = (await res.json()) as { access_token?: string };
	if (!json.access_token) {
		throw new Error(
			"Google no devolvió un access_token al renovar la conexión",
		);
	}

	return json.access_token;
}

export async function sendMail(
	userId: string,
	input: MailInput,
): Promise<{ id: string; threadId: string }> {
	const accessToken = await getAccessToken(userId);

	const res = await fetch(
		"https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ raw: buildRawMessage(input) }),
		},
	);

	if (!res.ok) {
		const bodyText = await res.text();
		throw new Error(
			`Gmail no pudo enviar el mail (${res.status}): ${bodyText}`,
		);
	}

	return (await res.json()) as { id: string; threadId: string };
}
