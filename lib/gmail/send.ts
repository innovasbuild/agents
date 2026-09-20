// El access token lo pide send_email a Vercel Connect (spec 02 §7.1). Este
// módulo ya no toca la base.
import { buildRawMessage } from "./mime";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Connect matchea el grant por el CONJUNTO EXACTO de scopes autorizados: si el
// usuario ya autorizó [send, readonly] y una tool pide solo [send], no matchea
// ese grant y pide reautorizar, dejando sin token el otro camino que sí pide
// readonly (spike S2, prod). Por eso todo pedido real de token de Gmail usa
// esta misma lista, definida una sola vez.
export const GMAIL_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE] as const;

type MailInput = {
	to: string;
	subject: string;
	body: string;
	bcc?: string | null;
	messageId?: string | null;
	/** Message-ID RFC822 del mensaje al que se responde. Gmail reescribe el
	 * propio, así que este valor se lee de Gmail, no se inventa. */
	inReplyTo?: string | null;
	references?: string | null;
	threadId?: string | null;
};

export class GmailUnauthorizedError extends Error {
	constructor() {
		super("Gmail rechazó el token del usuario");
		this.name = "GmailUnauthorizedError";
	}
}

/** No se sabe si el mail salió: o no hubo respuesta (red, abort, timeout), o
 * Gmail ya aceptó la llamada con un 2xx pero no se pudo leer su confirmación.
 * Quien llama no puede tratarlo como un no-envío. */
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
	// Fuera del try de red: un header inválido no llegó a salir a la red y no
	// puede reportarse como "no se sabe si el mail salió".
	const payload = JSON.stringify({
		raw: buildRawMessage(input),
		...(input.threadId ? { threadId: input.threadId } : {}),
	});

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
				body: payload,
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
			`Gmail no pudo enviar el mail (${res.status}): ${await res
				.text()
				.catch(() => "sin cuerpo")}`,
		);
	}

	// Desde el 2xx, Gmail ya aceptó la llamada: si el cuerpo se corta a la mitad
	// (undici tira "terminated") o no trae el id, el mail pudo haber salido.
	let sent: { id?: string; threadId?: string };
	try {
		sent = (await res.json()) as { id?: string; threadId?: string };
	} catch (error) {
		throw new GmailUnknownOutcomeError(error);
	}
	if (!sent?.id || !sent?.threadId) {
		throw new GmailUnknownOutcomeError(
			new Error(`Gmail aceptó la llamada (${res.status}) sin confirmar el id`),
		);
	}
	return { id: sent.id, threadId: sent.threadId };
}
