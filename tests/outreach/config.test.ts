import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type ConfigValueRow,
	DEFAULT_OUTREACH_MODELS,
	outreachFileSchema,
	parseOutreachConfig,
	planConfigValues,
	SUPPORTED_IDIOMAS,
} from "@/lib/outreach/config";
import { GATE_IDIOMAS } from "@/lib/outreach/gate";

const file = {
	config: { bcc: null, deal: null },
	values: {
		segmento: [{ value: "mid_market_ar", label: "Mid market AR" }],
		hook: [{ value: "h_uno", label: "Uno" }],
		vector: [{ value: "v1", label: "Vector 1", default_hook: "h_uno" }],
		idioma: [{ value: "es_ar", label: "Español rioplatense" }],
	},
};

describe("parseOutreachConfig", () => {
	it("completa defaults y deja override de modelos por tenant", () => {
		const config = parseOutreachConfig({
			models: { classify: "anthropic/claude-sonnet-5" },
		});
		expect(config).toEqual({
			timezone: "America/Argentina/Buenos_Aires",
			bcc: null,
			deal: null,
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
});

describe("outreachFileSchema", () => {
	it("acepta el archivo de innovas", () => {
		const raw = JSON.parse(
			readFileSync("tenants/innovas/outreach.json", "utf8"),
		);
		expect(() => outreachFileSchema.parse(raw)).not.toThrow();
	});
	it("rechaza un vector con hook default que no está en la lista", () => {
		const bad = {
			...file,
			values: {
				...file.values,
				vector: [{ value: "v1", label: "V", default_hook: "h_nada" }],
			},
		};
		expect(() => outreachFileSchema.parse(bad)).toThrow(
			'el hook "h_nada" no está en values.hook',
		);
	});
	it("rechaza valores repetidos y idiomas que el gate no soporta", () => {
		const repeated = {
			...file,
			values: {
				...file.values,
				hook: [
					{ value: "h_uno", label: "A" },
					{ value: "h_uno", label: "B" },
				],
			},
		};
		expect(() => outreachFileSchema.parse(repeated)).toThrow(
			'valor repetido en values.hook: "h_uno"',
		);
		const english = {
			...file,
			values: { ...file.values, idioma: [{ value: "en", label: "Inglés" }] },
		};
		expect(() => outreachFileSchema.parse(english)).toThrow();
	});
});

describe("planConfigValues", () => {
	const row = (
		kind: ConfigValueRow["kind"],
		value: string,
		label: string,
		meta: Record<string, unknown> = {},
		active = true,
	): ConfigValueRow => ({
		id: `${kind}-${value}`,
		kind,
		value,
		label,
		active,
		meta,
	});

	it("inserta lo nuevo, actualiza lo cambiado o inactivo, desactiva lo que salió del archivo", () => {
		const parsed = outreachFileSchema.parse(file);
		const plan = planConfigValues(
			[
				row("segmento", "mid_market_ar", "Mid market AR"),
				row("hook", "h_uno", "Uno viejo"),
				row("vector", "v1", "Vector 1", { default_hook: "h_uno" }, false),
				row("hook", "h_viejo", "Viejo"),
				row("hook", "h_ya_inactivo", "Inactivo", {}, false),
			],
			parsed,
		);
		expect(plan.upserts).toEqual([
			{ kind: "hook", value: "h_uno", label: "Uno", meta: {} },
			{
				kind: "vector",
				value: "v1",
				label: "Vector 1",
				meta: { default_hook: "h_uno" },
			},
			{
				kind: "idioma",
				value: "es_ar",
				label: "Español rioplatense",
				meta: {},
			},
		]);
		expect(plan.deactivate.map((r) => r.value)).toEqual(["h_viejo"]);
		expect(plan.unchanged).toBe(1);
	});
});
