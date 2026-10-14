import { describe, expect, it } from "vitest";
import {
	fileHeaders,
	isSameOrigin,
	skillFileHref,
} from "@/lib/brain/core/skills/http";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("isSameOrigin", () => {
	it("acepta solo un origin cuyo host es el del pedido", () => {
		expect(isSameOrigin("https://agentes.innov.as", "agentes.innov.as")).toBe(
			true,
		);
		expect(isSameOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
	});
	it("rechaza otro sitio, la falta de origin y un origin que no es URL", () => {
		expect(isSameOrigin("https://malo.example", "agentes.innov.as")).toBe(
			false,
		);
		expect(isSameOrigin(null, "agentes.innov.as")).toBe(false);
		expect(isSameOrigin("null", "agentes.innov.as")).toBe(false);
		expect(isSameOrigin("https://agentes.innov.as", null)).toBe(false);
	});
});

describe("fileHeaders", () => {
	it("un texto se sirve como texto plano, nunca como html ni svg", () => {
		for (const path of ["x.html", "logo.svg", "scripts/calc.py"]) {
			const headers = fileHeaders(path, bytes("<script>alert(1)</script>"));
			expect(headers["content-type"]).toBe("text/plain; charset=utf-8");
			expect(headers["x-content-type-options"]).toBe("nosniff");
			expect(headers["content-security-policy"]).toContain("sandbox");
		}
	});
	it("un binario se descarga con su nombre", () => {
		const headers = fileHeaders(
			"assets/logo.png",
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
		);
		expect(headers["content-type"]).toBe("application/octet-stream");
		expect(headers["content-disposition"]).toBe(
			'attachment; filename="logo.png"',
		);
		expect(headers["x-content-type-options"]).toBe("nosniff");
	});
});

describe("skillFileHref", () => {
	it("arma el link con la ruta codificada y la versión opcional", () => {
		expect(skillFileHref("acme", "skills/a", "scripts/calc.py")).toBe(
			"/acme/brain/skills/files?slug=skills%2Fa&path=scripts%2Fcalc.py",
		);
		expect(skillFileHref("acme", "skills/a", "a.txt", 3)).toBe(
			"/acme/brain/skills/files?slug=skills%2Fa&path=a.txt&version=3",
		);
	});
});
