// El access token lo pide send_email a Vercel Connect (spec 02 §7.1). Este
// módulo ya no toca la base.
import { buildRawMessage } from "./mime";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

type MailInput = {
	to: string;
	subject: string;
	body: string;
	bcc?: string | null;
	messageId?: string | null;
};

export class GmailUnauthorizedError extends Error {
	constructor() {
		super("Gmail rechazó el token del usuario");
		this.name = "GmailUnauthorizedError";
	}
}

/** No hubo respuesta de Gmail (red, abort, timeout): el mail pudo haber salido
 * igual. Quien llama no puede tratarlo como un no-envío. */
export class GmailUnknownOutcomeError extends Error {
	constructor(cause: unknown) {
		super("no hubo respuesta de Gmail: no se sabe si el mail salió", { cause });
		this.name = "GmailUnknownOutcomeError";
	}
}

const SEND_TIMEOUT_MS = 30_000;

export async function sendMail(
	accessToken: string,
	input: MailInput,
): Promise<{ id: string; threadId: string }> {
	let res: Response;
	try {
		res = await fetch(
			"https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ raw: buildRawMessage(input) }),
				// El timeout entra por el mismo carril que un corte de red: sin
				// respuesta no se sabe si Gmail llegó a mandar el mail.
				signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
			},
		);
	} catch (error) {
		throw new GmailUnknownOutcomeError(error);
	}

	if (res.status === 401) throw new GmailUnauthorizedError();
	if (!res.ok) {
		throw new Error(
			`Gmail no pudo enviar el mail (${res.status}): ${await res.text()}`,
		);
	}

	return (await res.json()) as { id: string; threadId: string };
}
