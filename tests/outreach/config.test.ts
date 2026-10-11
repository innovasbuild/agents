import { describe, expect, it } from "vitest";
import {
	DEFAULT_OUTREACH_MODELS,
	parseOutreachConfig,
	SUPPORTED_IDIOMAS,
} from "@/lib/outreach/config";
import { GATE_IDIOMAS } from "@/lib/outreach/gate";

describe("parseOutreachConfig", () => {
	it("completa defaults y deja override de modelos por tenant", () => {
		const config = parseOutreachConfig({
			models: { classify: "anthropic/claude-sonnet-5" },
		});
		expect(config).toEqual({
			timezone: "America/Argentina/Buenos_Aires",
			bcc: null,
			deal: null,
			company: null,
			models: {
				...DEFAULT_OUTREACH_MODELS,
				classify: "anthropic/claude-sonnet-5",
			},
		});
		expect(parseOutreachConfig(undefined).models).toEqual(
			DEFAULT_OUTREACH_MODELS,
		);
	});
	it("rechaza una zona horaria que no existe", () => {
		expect(() => parseOutreachConfig({ timezone: "Marte/Olympus" })).toThrow();
	});
	it("los idiomas soportados coinciden con los del gate", () => {
		expect([...SUPPORTED_IDIOMAS]).toEqual([...GATE_IDIOMAS]);
	});
	it("ignora una clave icp vieja: los niveles viven en el brain", () => {
		const config = parseOutreachConfig({
			icp: { revision: "2026-09-22", excluir: "x".repeat(20) },
		});
		expect("icp" in config).toBe(false);
	});
});
