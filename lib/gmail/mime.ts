import { randomUUID } from "node:crypto";

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
	/** Versión HTML del cuerpo (cuerpo + firma). Si viene, el mail sale
	 * multipart/alternative con `body` como la parte de texto plano; sin esto
	 * sigue siendo un único text/plain, como siempre. */
	html?: string | null;
};

const isAscii = (value: string) => /^[\x20-\x7E]*$/.test(value);

const encodeSubject = (subject: string) =>
	isAscii(subject)
		? subject
		: `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;

// Un salto de línea en un header permite inyectar otros (Bcc, To): nunca pasa.
function header(name: string, value: string): string {
	if (/[\r\n]/.test(value)) throw new Error(`header inválido: ${name}`);
	return `${name}: ${value}`;
}

function part(contentType: string, content: string): string[] {
	return [
		`Content-Type: ${contentType}`,
		"Content-Transfer-Encoding: base64",
		"",
		Buffer.from(content, "utf8").toString("base64"),
	];
}

export function buildRawMessage({
	to,
	subject,
	body,
	bcc,
	messageId,
	inReplyTo,
	references,
	html,
}: MailInput): string {
	// El subject se valida crudo: codificado en base64 ya no mostraría el salto.
	if (/[\r\n]/.test(subject)) throw new Error("header inválido: Subject");
	const headers = [
		header("To", to),
		...(bcc ? [header("Bcc", bcc)] : []),
		header("Subject", encodeSubject(subject)),
		...(messageId ? [header("Message-ID", messageId)] : []),
		...(inReplyTo ? [header("In-Reply-To", inReplyTo)] : []),
		...(references ? [header("References", references)] : []),
		"MIME-Version: 1.0",
	];

	const content = html
		? (() => {
				const boundary = `mime_${randomUUID()}`;
				return [
					`Content-Type: multipart/alternative; boundary="${boundary}"`,
					"",
					`--${boundary}`,
					...part('text/plain; charset="UTF-8"', body),
					`--${boundary}`,
					...part('text/html; charset="UTF-8"', html),
					`--${boundary}--`,
				];
			})()
		: part('text/plain; charset="UTF-8"', body);

	return Buffer.from([...headers, ...content].join("\r\n"), "utf8").toString(
		"base64url",
	);
}
