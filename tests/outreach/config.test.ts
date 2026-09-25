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
			icp: null,
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
	it("acepta los niveles del ICP y exige entre 2 y 10 por dimensión", () => {
		const config = parseOutreachConfig({
			icp: {
				revision: "2026-09-22",
				encaje_empresa: ["no entra todavía", "podría encajar", "encaja bien"],
				rol_decisor: ["sin relación", "influye algo", "decide todo"],
				excluir: "Es competidora, ya cliente, o proveedora",
			},
		});
		expect(config.icp?.revision).toBe("2026-09-22");
		expect(config.icp?.encaje_empresa).toHaveLength(3);
	});
	it("un solo nivel no es una escala: se rechaza", () => {
		// Solo encaje_empresa viola la cardinalidad (1 nivel); el resto queda
		// válido para que el throw aísle esa invariante y no el min(10) de string.
		expect(() =>
			parseOutreachConfig({
				icp: {
					revision: "r1",
					encaje_empresa: ["nivel único"],
					rol_decisor: ["sin relación", "influye algo", "decide todo"],
					excluir: "motivo de exclusión de prueba",
				},
			}),
		).toThrow();
	});
	it("sin bloque icp, la config sigue siendo válida y el scoring no corre", () => {
		expect(parseOutreachConfig({}).icp).toBeNull();
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
		const result = outreachFileSchema.safeParse(bad);
		expect(result.success).toBe(false);
		expect(result.error?.issues.map((issue) => issue.message)).toContain(
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
		const result = outreachFileSchema.safeParse(repeated);
		expect(result.success).toBe(false);
		expect(result.error?.issues.map((issue) => issue.message)).toContain(
			'valor repetido en values.hook: "h_uno"',
		);
		const english = {
			...file,
			values: { ...file.values, idioma: [{ value: "en", label: "Inglés" }] },
		};
		expect(outreachFileSchema.safeParse(english).success).toBe(false);
	});
	it("acumula todos los issues en un solo safeParse sin tirar excepción", () => {
		const bad = {
			...file,
			values: {
				...file.values,
				hook: [
					{ value: "h_uno", label: "A" },
					{ value: "h_uno", label: "B" },
				],
				vector: [{ value: "v1", label: "V", default_hook: "h_nada" }],
			},
		};
		const result = outreachFileSchema.safeParse(bad);
		expect(result.success).toBe(false);
		const messages = result.error?.issues.map((issue) => issue.message);
		expect(messages).toContain('valor repetido en values.hook: "h_uno"');
		expect(messages).toContain('el hook "h_nada" no está en values.hook');
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
