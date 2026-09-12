import { describe, expect, it } from "vitest";
import { buildRawMessage } from "../../lib/gmail/mime";

const decodeMime = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
const decodeBody = (raw: string) => {
  const [, body] = decodeMime(raw).split("\r\n\r\n");
  return Buffer.from(body, "base64").toString("utf8");
};

describe("buildRawMessage", () => {
  it("incluye los headers mínimos", () => {
    const mime = decodeMime(
      buildRawMessage({ to: "ana@example.com", subject: "Hola", body: "Cuerpo" }),
    );
    expect(mime).toContain("To: ana@example.com");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain("Content-Transfer-Encoding: base64");
  });

  it("deja el subject en texto plano si es ASCII puro", () => {
    const mime = decodeMime(
      buildRawMessage({ to: "ana@example.com", subject: "Quick question", body: "x" }),
    );
    expect(mime).toContain("Subject: Quick question");
  });

  it("codifica el subject con acentos como encoded-word RFC 2047", () => {
    const mime = decodeMime(
      buildRawMessage({ to: "ana@example.com", subject: "Diseño para Ñandú", body: "x" }),
    );
    expect(mime).not.toContain("Subject: Diseño");
    const match = mime.match(/Subject: =\?UTF-8\?B\?(.+)\?=/);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], "base64").toString("utf8")).toBe("Diseño para Ñandú");
  });

  it("preserva el body en UTF-8", () => {
    const body = "Mañana te escribo. ¿Dale? — Mati";
    expect(decodeBody(buildRawMessage({ to: "ana@example.com", subject: "x", body }))).toBe(body);
  });

  it("devuelve base64url, sin padding ni caracteres de base64 estándar", () => {
    const raw = buildRawMessage({
      to: "ana@example.com",
      subject: "Una prueba más larga para forzar padding",
      body: "Contenido suficientemente largo como para que el base64 necesite relleno.",
    });
    expect(raw).not.toMatch(/[+/=]/);
  });
});
