import { describe, expect, it } from "vitest";
import {
	mergeWorkflowConfig,
	parseWorkflowsSetArgs,
} from "@/scripts/workflows-set-args";

const base = ["--tenant", "innovas", "--workflow", "refresh-fichas"];

describe("parseWorkflowsSetArgs", () => {
	it("lee todo", () => {
		expect(
			parseWorkflowsSetArgs([
				...base,
				"--enable",
				"--cadence",
				"60",
				"--items",
				"5",
				"--budget",
				"model_usd=1.5",
				"--apply",
			]),
		).toEqual({
			tenant: "innovas",
			workflow: "refresh-fichas",
			enabled: true,
			cadenceMinutes: 60,
			itemsPerTick: 5,
			budget: { resource: "model_usd", dailyLimit: 1.5 },
			apply: true,
		});
	});

	it("sin flags de estado no toca nada y no escribe", () => {
		expect(parseWorkflowsSetArgs(base)).toEqual({
			tenant: "innovas",
			workflow: "refresh-fichas",
			enabled: null,
			cadenceMinutes: null,
			itemsPerTick: null,
			budget: null,
			apply: false,
		});
	});

	it("--disable apaga", () => {
		expect(parseWorkflowsSetArgs([...base, "--disable"]).enabled).toBe(false);
	});

	it.each([
		[["--workflow", "refresh-fichas"], "falta --tenant"],
		[
			["--tenant", "Innovas", "--workflow", "refresh-fichas"],
			"slug de tenant inválido",
		],
		[["--tenant", "innovas"], "falta --workflow"],
		[
			["--tenant", "innovas", "--workflow", "no-existe"],
			"no está en lib/workflows/registry.ts",
		],
		[[...base, "--enable", "--disable"], "--enable y --disable a la vez"],
		[[...base, "--cadence", "3"], "--cadence"],
		[[...base, "--items", "0"], "--items"],
		[[...base, "--budget", "model_usd"], "--budget va como recurso=monto"],
		[[...base, "--budget", "Model=1"], "--budget va como recurso=monto"],
	])("rechaza %j", (argv, message) => {
		expect(() => parseWorkflowsSetArgs(argv)).toThrow(message);
	});
});

describe("mergeWorkflowConfig", () => {
	it("pisa solo lo que se pasó y conserva el resto", () => {
		expect(
			mergeWorkflowConfig(
				{ cadence_minutes: 30, dias_de_gracia: 7 },
				{ cadenceMinutes: null, itemsPerTick: 2 },
			),
		).toEqual({ cadence_minutes: 30, dias_de_gracia: 7, items_per_tick: 2 });
	});
});
