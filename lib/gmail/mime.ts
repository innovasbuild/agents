type MailInput = { to: string; subject: string; body: string };

const isAscii = (value: string) => /^[\x20-\x7E]*$/.test(value);

const encodeSubject = (subject: string) =>
  isAscii(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;

export function buildRawMessage({ to, subject, body }: MailInput): string {
  const mime = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
  ].join("\r\n");

  return Buffer.from(mime, "utf8").toString("base64url");
}
