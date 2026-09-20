// Lectura de hilos de Gmail: quién escribió cada mensaje, y si es un rebote o
// una respuesta automática. Es la base de la escucha (follow-ups en hilo,
// reconciliación de envíos inciertos leen de acá).
import { GmailUnauthorizedError } from "./send";

// Mismo valor que send.ts (SEND_TIMEOUT_MS): sin este timeout, una respuesta
// colgada de Gmail bloquea para siempre al cron que llama a estas funciones.
const READ_TIMEOUT_MS = 30_000;

export interface GmailMessage {
	id: string;
	threadId: string;
	rfc822MessageId: string | null;
	from: string;
	date: string;
	snippet: string;
	body: string;
	isFromUs: boolean;
	isBounce: boolean;
	isAutoReply: boolean;
}

type GmailPart = {
	mimeType?: string;
	body?: { data?: string };
	parts?: GmailPart[];
};

type GmailApiMessage = {
	id: string;
	threadId: string;
	snippet?: string;
	payload?: GmailPart & { headers?: { name: string; value: string }[] };
};

function header(
	headers: { name: string; value: string }[] | undefined,
	name: string,
): string | null {
	const found = headers?.find(
		(h) => h.name.toLowerCase() === name.toLowerCase(),
	);
	return found ? found.value : null;
}

// Los payloads de Gmail anidan: multipart/report trae parts, y cada parte
// puede tener las suyas. Hay que bajar recursivo, no mirar solo el primer nivel.
function findPart(
	part: GmailPart | undefined,
	predicate: (p: GmailPart) => boolean,
): GmailPart | null {
	if (!part) return null;
	if (predicate(part)) return part;
	for (const child of part.parts ?? []) {
		const found = findPart(child, predicate);
		if (found) return found;
	}
	return null;
}

function decodeBody(payload: GmailPart | undefined): string {
	if (!payload) return "";
	if (payload.body?.data) {
		return Buffer.from(payload.body.data, "base64url").toString("utf8");
	}
	const textPart = findPart(
		payload,
		(p) => p.mimeType === "text/plain" && !!p.body?.data,
	);
	if (textPart?.body?.data) {
		return Buffer.from(textPart.body.data, "base64url").toString("utf8");
	}
	return "";
}

function isBounceMessage(
	from: string,
	payload: GmailPart | undefined,
): boolean {
	const fromLower = from.toLowerCase();
	if (
		fromLower.includes("mailer-daemon@") ||
		fromLower.includes("postmaster@")
	) {
		return true;
	}
	return (
		findPart(payload, (p) => p.mimeType === "message/delivery-status") !== null
	);
}

function isAutoReplyMessage(
	autoSubmitted: string | null,
	xAutoreply: string | null,
): boolean {
	if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;
	return xAutoreply !== null;
}

// El From llega como "Nombre <mail>" o como "mail" a secas: hay que extraer
// la dirección exacta, no buscarla como substring — "diana@acme.test" contiene
// "ana@acme.test" y un includes() la matchearía como si fuera nuestra.
function extractEmailAddress(from: string): string {
	const match = from.match(/<([^>]+)>/);
	const raw = match ? match[1] : from;
	return raw.trim().toLowerCase();
}

function isFromExecutor(from: string, ourEmail: string): boolean {
	return extractEmailAddress(from) === ourEmail.trim().toLowerCase();
}

function toGmailMessage(raw: GmailApiMessage, ourEmail: string): GmailMessage {
	const headers = raw.payload?.headers;
	const from = header(headers, "From") ?? "";
	const date = header(headers, "Date") ?? "";
	const rfc822MessageId = header(headers, "Message-ID");
	const autoSubmitted = header(headers, "Auto-Submitted");
	const xAutoreply = header(headers, "X-Autoreply");

	return {
		id: raw.id,
		threadId: raw.threadId,
		rfc822MessageId,
		from,
		date,
		snippet: raw.snippet ?? "",
		body: decodeBody(raw.payload),
		isFromUs: isFromExecutor(from, ourEmail),
		isBounce: isBounceMessage(from, raw.payload),
		isAutoReply: isAutoReplyMessage(autoSubmitted, xAutoreply),
	};
}

export async function fetchThread(
	accessToken: string,
	threadId: string,
	ourEmail: string,
): Promise<GmailMessage[]> {
	const res = await fetch(
		`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
		{
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(READ_TIMEOUT_MS),
		},
	);

	if (res.status === 401) throw new GmailUnauthorizedError();
	if (!res.ok) {
		throw new Error(
			`Gmail no pudo traer el hilo (${res.status}): ${await res
				.text()
				.catch(() => "sin cuerpo")}`,
		);
	}

	const data = (await res.json()) as { messages?: GmailApiMessage[] };
	return (data.messages ?? []).map((m) => toGmailMessage(m, ourEmail));
}

export async function findByRfc822Id(
	accessToken: string,
	rfc822MessageId: string,
): Promise<{ id: string; threadId: string } | null> {
	const res = await fetch(
		`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
			`rfc822msgid:${rfc822MessageId}`,
		)}`,
		{
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(READ_TIMEOUT_MS),
		},
	);

	if (res.status === 401) throw new GmailUnauthorizedError();
	if (!res.ok) {
		throw new Error(
			`Gmail no pudo buscar el mensaje (${res.status}): ${await res
				.text()
				.catch(() => "sin cuerpo")}`,
		);
	}

	const data = (await res.json()) as {
		messages?: { id: string; threadId: string }[];
	};
	const [first] = data.messages ?? [];
	return first ? { id: first.id, threadId: first.threadId } : null;
}
