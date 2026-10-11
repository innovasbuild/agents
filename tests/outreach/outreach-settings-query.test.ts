import { describe, expect, it } from "vitest";
import { toListValues } from "@/lib/outreach/outreach-settings-query";

describe("toListValues", () => {
	it("normaliza, ordena por clase y rótulo, y lee el hook por defecto del vector", () => {
		expect(
			toListValues([
				{
					kind: "vector",
					value: "v_uno",
					label: "Vector",
					active: true,
					meta: { default_hook: "h_uno" },
				},
				{
					kind: "segmento",
					value: "b",
					label: "Zeta",
					active: false,
					meta: {},
				},
				{
					kind: "segmento",
					value: "a",
					label: "Alfa",
					active: true,
					meta: null,
				},
				{ kind: "otra", value: "x", label: "X", active: true },
				{ kind: "hook", value: "h_uno", label: "Hook" },
			]),
		).toEqual([
			{
				kind: "segmento",
				value: "a",
				label: "Alfa",
				active: true,
				defaultHook: null,
			},
			{
				kind: "segmento",
				value: "b",
				label: "Zeta",
				active: false,
				defaultHook: null,
			},
			{
				kind: "hook",
				value: "h_uno",
				label: "Hook",
				active: false,
				defaultHook: null,
			},
			{
				kind: "vector",
				value: "v_uno",
				label: "Vector",
				active: true,
				defaultHook: "h_uno",
			},
		]);
	});
});
