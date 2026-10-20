import { describe, expect, it } from "vitest";
import {
	checkRequestGuards,
	fileHeaders,
	isSameOrigin,
	isTenantSlug,
	skillFileHref,
	skillPackageHref,
	statusFor,
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

describe("skillPackageHref", () => {
	it("codifica el slug en la query", () => {
		expect(skillPackageHref("acme", "skills/ventas/reporte")).toBe(
			"/acme/brain/skills/package?slug=skills%2Fventas%2Freporte",
		);
	});
});

describe("statusFor", () => {
	it("cada código de SkillFailure tiene su estado", () => {
		expect(statusFor("not_found")).toBe(404);
		expect(statusFor("forbidden")).toBe(403);
		expect(statusFor("conflict")).toBe(409);
		expect(statusFor("validation")).toBe(422);
		expect(statusFor("unsupported")).toBe(422);
		expect(statusFor("name_taken")).toBe(409);
	});
});

describe("isTenantSlug", () => {
	it("acepta minúsculas, dígitos y guiones, hasta 63", () => {
		expect(isTenantSlug("acme-2")).toBe(true);
		expect(isTenantSlug("a".repeat(63))).toBe(true);
		expect(isTenantSlug("a".repeat(64))).toBe(false);
		expect(isTenantSlug("Acme")).toBe(false);
		expect(isTenantSlug("a/b")).toBe(false);
		expect(isTenantSlug("")).toBe(false);
	});
});

describe("checkRequestGuards", () => {
	const SAME = { origin: "https://agentes.innov.as", host: "agentes.innov.as" };
	const MAX = 1000;
	const call = (headers: Record<string, string>, tenant = "acme") =>
		checkRequestGuards(
			new Request("https://agentes.innov.as/acme/x", {
				method: "POST",
				headers,
			}),
			tenant,
			MAX,
			"Pesa de más.",
		);

	it("un tenant inválido responde 404", async () => {
		const response = call({ ...SAME, "content-length": "10" }, "Acme!");
		expect(response?.status).toBe(404);
		expect(await response?.json()).toEqual({
			ok: false,
			message: "No encontrado.",
		});
	});

	it("otro origen o ninguno responde 403", async () => {
		const other = call({
			origin: "https://malo.example",
			host: "agentes.innov.as",
			"content-length": "10",
		});
		expect(other?.status).toBe(403);
		expect(await other?.json()).toEqual({
			ok: false,
			message: "Origen no permitido.",
		});
		expect(
			call({ host: "agentes.innov.as", "content-length": "10" })?.status,
		).toBe(403);
	});

	it("sin Content-Length, o que no es un número, responde 411", async () => {
		const missing = call(SAME);
		expect(missing?.status).toBe(411);
		expect(await missing?.json()).toEqual({
			ok: false,
			message: "Falta el tamaño del pedido.",
		});
		expect(call({ ...SAME, "content-length": "12abc" })?.status).toBe(411);
		expect(call({ ...SAME, "content-length": "-5" })?.status).toBe(411);
	});

	it("más del tope más el margen del formulario responde 413 con el texto dado", async () => {
		const response = call({ ...SAME, "content-length": String(MAX + 65_537) });
		expect(response?.status).toBe(413);
		expect(await response?.json()).toEqual({
			ok: false,
			message: "Pesa de más.",
		});
	});

	it("dentro del tope, margen incluido, pasa", () => {
		expect(
			call({ ...SAME, "content-length": String(MAX + 65_536) }),
		).toBeNull();
		expect(call({ ...SAME, "content-length": "0" })).toBeNull();
	});

	it("el orden es tenant, origen, tamaño", () => {
		expect(call({ origin: "https://malo.example" }, "Acme!")?.status).toBe(404);
		expect(call({ origin: "https://malo.example" })?.status).toBe(403);
	});
});
