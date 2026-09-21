import { describe, expect, it } from "vitest";
import { isDue, parseTenantWorkflowConfig } from "@/lib/workflows/config";

describe("parseTenantWorkflowConfig", () => {
	it("con config vacía usa los defaults y el tope del registry", () => {
		const result = parseTenantWorkflowConfig("refresh-fichas", {});
		expect(result).toEqual({
			ok: true,
			config: {
				cadenceMinutes: 60,
				itemsPerTick: 5,
				optionalNodes: new Set(),
				params: {},
			},
		});
	});

	it("el tenant puede bajar los ítems por tick pero nunca pasar el tope del registry", () => {
		const menos = parseTenantWorkflowConfig("refresh-fichas", {
			items_per_tick: 2,
		});
		expect(menos.ok && menos.config.itemsPerTick).toBe(2);

		const mas = parseTenantWorkflowConfig("refresh-fichas", {
			items_per_tick: 500,
		});
		expect(mas.ok && mas.config.itemsPerTick).toBe(5);
	});

	it("un nodo opcional que el workflow no declara falla con ruido", () => {
		// Un typo no puede apagar un paso en silencio (spec §10.1).
		const result = parseTenantWorkflowConfig("refresh-fichas", {
			optional_nodes: ["outreach/no-existe"],
		});
		expect(result).toMatchObject({
			ok: false,
			reason: "nodo_opcional_desconocido",
		});
	});

	it("un workflow que no está en el registry se rechaza", () => {
		expect(parseTenantWorkflowConfig("constructor", {})).toMatchObject({
			ok: false,
			reason: "workflow_desconocido",
		});
	});

	it.each([
		{ cadence_minutes: 0 },
		{ cadence_minutes: "5" },
		{ items_per_tick: -1 },
		{ optional_nodes: "outreach/x" },
		"no-es-objeto",
	])("rechaza una config con forma inválida: %j", (raw) => {
		expect(parseTenantWorkflowConfig("refresh-fichas", raw)).toMatchObject({
			ok: false,
			reason: "config_invalida",
		});
	});

	it("lo que no es de la plataforma pasa como params del workflow", () => {
		const result = parseTenantWorkflowConfig("refresh-fichas", {
			cadence_minutes: 30,
			dias_de_gracia: 7,
		});
		expect(result.ok && result.config.params).toEqual({ dias_de_gracia: 7 });
		expect(result.ok && result.config.cadenceMinutes).toBe(30);
	});
});

describe("isDue", () => {
	const now = new Date("2026-09-21T12:00:00Z");

	it("nunca corrió: le toca", () => {
		expect(isDue(null, 60, now)).toBe(true);
	});

	it("corrió hace menos que la cadencia: no le toca", () => {
		expect(isDue("2026-09-21T11:30:00Z", 60, now)).toBe(false);
	});

	it("corrió hace justo la cadencia: le toca", () => {
		expect(isDue("2026-09-21T11:00:00Z", 60, now)).toBe(true);
	});

	it("una fecha rota no lo deja trabado para siempre", () => {
		expect(isDue("no-es-fecha", 60, now)).toBe(true);
	});
});
