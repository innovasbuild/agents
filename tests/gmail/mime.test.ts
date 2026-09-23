import { describe, expect, it } from "vitest";
import { buildRawMessage } from "../../lib/gmail/mime";

const decodeMime = (raw: string) =>
	Buffer.from(raw, "base64url").toString("utf8");
const decodeBody = (raw: string) => {
	const [, body] = decodeMime(raw).split("\r\n\r\n");
	return Buffer.from(body, "base64").toString("utf8");
};

describe("buildRawMessage", () => {
	it("incluye los headers mínimos", () => {
		const mime = decodeMime(
			buildRawMessage({
				to: "ana@example.com",
				subject: "Hola",
				body: "Cuerpo",
			}),
		);
		expect(mime).toContain("To: ana@example.com");
		expect(mime).toContain("MIME-Version: 1.0");
		expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
		expect(mime).toContain("Content-Transfer-Encoding: base64");
	});

	it("deja el subject en texto plano si es ASCII puro", () => {
		const mime = decodeMime(
			buildRawMessage({
				to: "ana@example.com",
				subject: "Quick question",
				body: "x",
			}),
		);
		expect(mime).toContain("Subject: Quick question");
	});

	it("codifica el subject con acentos como encoded-word RFC 2047", () => {
		const mime = decodeMime(
			buildRawMessage({
				to: "ana@example.com",
				subject: "Diseño para Ñandú",
				body: "x",
			}),
		);
		expect(mime).not.toContain("Subject: Diseño");
		const match = mime.match(/Subject: =\?UTF-8\?B\?(.+)\?=/);
		expect(match).not.toBeNull();
		expect(Buffer.from(match![1], "base64").toString("utf8")).toBe(
			"Diseño para Ñandú",
		);
	});

	it("preserva el body en UTF-8", () => {
		const body = "Mañana te escribo. ¿Dale? — Mati";
		expect(
			decodeBody(
				buildRawMessage({ to: "ana@example.com", subject: "x", body }),
			),
		).toBe(body);
	});

	it("devuelve base64url, sin padding ni caracteres de base64 estándar", () => {
		const raw = buildRawMessage({
			to: "ana@example.com",
			subject: "Una prueba más larga para forzar padding",
			body: "Contenido suficientemente largo como para que el base64 necesite relleno.",
		});
		expect(raw).not.toMatch(/[+/=]/);
	});

	it("agrega Bcc y Message-ID cuando vienen", () => {
		const mime = decodeMime(
			buildRawMessage({
				to: "a@b.test",
				subject: "Hola",
				body: "x",
				bcc: "123@bcc.hubspot.com",
				messageId: "<qi-1@innov.as>",
			}),
		);
		expect(mime).toContain("Bcc: 123@bcc.hubspot.com\r\n");
		expect(mime).toContain("Message-ID: <qi-1@innov.as>\r\n");
	});

	it("rechaza saltos de línea en los headers", () => {
		expect(() =>
			buildRawMessage({
				to: "a@b.test\r\nBcc: x@y.test",
				subject: "Hola",
				body: "x",
			}),
		).toThrow("header inválido");
		expect(() =>
			buildRawMessage({ to: "a@b.test", subject: "Hola\nX", body: "x" }),
		).toThrow("header inválido");
	});

	it("agrega In-Reply-To cuando se le pasa el Message-ID original", () => {
		const raw = buildRawMessage({
			to: "a@b.test",
			subject: "Re: Hola",
			body: "Cuerpo",
			inReplyTo: "<abc@mail.gmail.com>",
		});

		expect(decodeMime(raw)).toContain("In-Reply-To: <abc@mail.gmail.com>");
	});

	it("agrega References cuando se le pasa", () => {
		const raw = buildRawMessage({
			to: "a@b.test",
			subject: "Re: Hola",
			body: "Cuerpo",
			references: "<abc@mail.gmail.com>",
		});

		expect(decodeMime(raw)).toContain("References: <abc@mail.gmail.com>");
	});

	it("sin hilo no agrega ninguno de los dos headers", () => {
		const raw = decodeMime(
			buildRawMessage({ to: "a@b.test", subject: "Hola", body: "Cuerpo" }),
		);

		expect(raw).not.toContain("In-Reply-To");
		expect(raw).not.toContain("References");
	});

	it("un salto de línea en In-Reply-To no puede inyectar otro header", () => {
		expect(() =>
			buildRawMessage({
				to: "a@b.test",
				subject: "Hola",
				body: "Cuerpo",
				inReplyTo: "<a>\r\nBcc: fuga@mal.test",
			}),
		).toThrow();
	});

	describe("con html", () => {
		function decodeParts(raw: string) {
			const mime = decodeMime(raw);
			const boundaryMatch = mime.match(/boundary="([^"]+)"/);
			expect(boundaryMatch).not.toBeNull();
			const boundary = boundaryMatch![1];
			const [, plainPart, htmlPart] = mime.split(`--${boundary}`);
			const decode = (part: string) =>
				Buffer.from(part.trim().split("\r\n\r\n")[1], "base64").toString(
					"utf8",
				);
			return { mime, plain: decode(plainPart), html: decode(htmlPart) };
		}

		it("sin html sigue siendo un único text/plain (compatibilidad)", () => {
			const mime = decodeMime(
				buildRawMessage({ to: "a@b.test", subject: "Hola", body: "Cuerpo" }),
			);
			expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
			expect(mime).not.toContain("multipart/alternative");
		});

		it("con html manda multipart/alternative con las dos partes", () => {
			const raw = buildRawMessage({
				to: "a@b.test",
				subject: "Hola",
				body: "Cuerpo plano",
				html: "<p>Cuerpo rico</p>",
			});
			const mime = decodeMime(raw);
			expect(mime).toContain("Content-Type: multipart/alternative;");
			const { plain, html } = decodeParts(raw);
			expect(plain).toBe("Cuerpo plano");
			expect(html).toBe("<p>Cuerpo rico</p>");
		});

		it("preserva UTF-8 en la parte html", () => {
			const { html } = decodeParts(
				buildRawMessage({
					to: "a@b.test",
					subject: "x",
					body: "x",
					html: "<p>Diseño para Ñandú — Matías</p>",
				}),
			);
			expect(html).toBe("<p>Diseño para Ñandú — Matías</p>");
		});
	});
});
