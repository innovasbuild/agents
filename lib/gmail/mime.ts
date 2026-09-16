type MailInput = {
	to: string;
	subject: string;
	body: string;
	bcc?: string | null;
	messageId?: string | null;
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

export function buildRawMessage({
	to,
	subject,
	body,
	bcc,
	messageId,
}: MailInput): string {
	// El subject se valida crudo: codificado en base64 ya no mostraría el salto.
	if (/[\r\n]/.test(subject)) throw new Error("header inválido: Subject");
	const mime = [
		header("To", to),
		...(bcc ? [header("Bcc", bcc)] : []),
		header("Subject", encodeSubject(subject)),
		...(messageId ? [header("Message-ID", messageId)] : []),
		"MIME-Version: 1.0",
		'Content-Type: text/plain; charset="UTF-8"',
		"Content-Transfer-Encoding: base64",
		"",
		Buffer.from(body, "utf8").toString("base64"),
	].join("\r\n");

	return Buffer.from(mime, "utf8").toString("base64url");
}
