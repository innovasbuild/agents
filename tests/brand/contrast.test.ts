import { describe, expect, it } from "vitest";
import { brandStyle, foregroundFor } from "@/lib/brand/contrast";

describe("foregroundFor", () => {
	it("elige texto claro sobre un azul oscuro", () => {
		expect(foregroundFor("#1D4ED8")).toBe("#FFFFFF");
	});

	it("elige texto oscuro sobre un amarillo", () => {
		expect(foregroundFor("#FDE047")).toBe("#0A0A0A");
	});

	it("tolera el numeral ausente y las mayúsculas", () => {
		expect(foregroundFor("fde047")).toBe("#0A0A0A");
	});
});

describe("brandStyle", () => {
	it("no define variables cuando la marca está vacía", () => {
		expect(brandStyle({})).toEqual({});
	});

	it("define primary y su foreground derivado", () => {
		expect(brandStyle({ primary: "#1D4ED8" })).toEqual({
			"--primary": "#1D4ED8",
			"--primary-foreground": "#FFFFFF",
		});
	});
});
