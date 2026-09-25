import { describe, expect, it } from "vitest";
import { DEFAULT_MCP_LIMITS, parseMcpLimits } from "@/lib/brain/limits";

describe("parseMcpLimits", () => {
	it("sin valor usa los defaults", () => {
		expect(parseMcpLimits(undefined)).toEqual(DEFAULT_MCP_LIMITS);
		expect(DEFAULT_MCP_LIMITS).toEqual({
			readsPerMinute: 60,
			writesPerMinute: 10,
		});
	});

	it("completa lo que falta", () => {
		expect(parseMcpLimits({ readsPerMinute: 120 })).toEqual({
			readsPerMinute: 120,
			writesPerMinute: 10,
		});
	});

	it("rechaza valores fuera de rango, no enteros y claves desconocidas", () => {
		expect(() => parseMcpLimits({ readsPerMinute: 0 })).toThrow(
			"readsPerMinute",
		);
		expect(() => parseMcpLimits({ writesPerMinute: 1001 })).toThrow(
			"writesPerMinute",
		);
		expect(() => parseMcpLimits({ readsPerMinute: 1.5 })).toThrow(
			"readsPerMinute",
		);
		expect(() => parseMcpLimits({ otro: 1 })).toThrow("otro");
		expect(() => parseMcpLimits([])).toThrow("objeto");
	});
});
