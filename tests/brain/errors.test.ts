import { describe, expect, it } from "vitest";
import {
	agentReservedSlug,
	BrainConflict,
	BrainNotFound,
	BrainProviderError,
	BrainRateLimited,
	BrainReservedSlug,
	BrainRulesRequired,
	BrainValidation,
	toToolError,
} from "@/lib/brain/core/errors";

describe("toToolError", () => {
	it("traduce un conflicto con la revisión vigente", () => {
		expect(toToolError(new BrainConflict("comercial/icp", 4))).toEqual({
			ok: false,
			error: "conflict",
			message: expect.stringContaining("comercial/icp"),
			currentRevision: 4,
		});
	});

	it("traduce una página inexistente con sugerencias", () => {
		expect(
			toToolError(new BrainNotFound("comercial/icpp", ["comercial/icp"])),
		).toMatchObject({
			error: "not_found",
			suggestions: ["comercial/icp"],
		});
	});

	it("traduce una validación con los campos", () => {
		expect(
			toToolError(new BrainValidation(["category", "reason"])),
		).toMatchObject({
			error: "validation",
			fields: ["category", "reason"],
		});
	});

	it("relanza errores que no son del brain", () => {
		const boom = new Error("se cayó la base");
		expect(() => toToolError(boom)).toThrow(boom);
	});

	it("un error del proveedor sale como provider_unavailable", () => {
		expect(
			toToolError(new BrainProviderError("el brain remoto no respondió")),
		).toEqual({
			ok: false,
			error: "provider_unavailable",
			message: "el brain remoto no respondió",
		});
	});

	it("un límite alcanzado es reintentable y dice cuánto esperar", () => {
		expect(toToolError(new BrainRateLimited(12))).toEqual({
			ok: false,
			error: "rate_limited",
			message:
				"Pasaste el límite de llamadas por minuto. Probá de nuevo en 12 segundos.",
			retryable: true,
			retryAfterSeconds: 12,
		});
	});

	it("traduce rules_required con la cascada completa para reintentar", () => {
		const rules = {
			revision: "0123456789abcdef",
			chain: [{ path: "", slug: "00-reglas", revision: 2, body: "raíz" }],
			fields: [],
			template: null,
		};
		const fresh = toToolError(
			new BrainRulesRequired("talento/leo", rules, false),
		);
		expect(fresh).toEqual({
			ok: false,
			error: "rules_required",
			message: expect.stringContaining('rulesRevision "0123456789abcdef"'),
			rules,
		});
		expect(fresh.message).toContain("talento/leo tiene reglas");
		expect(
			toToolError(new BrainRulesRequired("talento/leo", rules, true)).message,
		).toContain("cambiaron desde que las leíste");
	});

	it("traduce reserved_slug con su mensaje", () => {
		expect(
			toToolError(new BrainReservedSlug("pedíselo a quien administra")),
		).toEqual({
			ok: false,
			error: "reserved_slug",
			message: "pedíselo a quien administra",
		});
		expect(agentReservedSlug("comercial/00-plantilla").message).toMatch(
			/comercial\/00-plantilla.*proponé el cambio en la conversación/,
		);
	});
});
