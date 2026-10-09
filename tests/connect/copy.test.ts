import { describe, expect, it, vi } from "vitest";
import { copyText } from "@/lib/connect/copy";

describe("copyText", () => {
	it("copia y devuelve true", async () => {
		const writeText = vi.fn(async () => {});
		expect(await copyText("hola", { writeText })).toBe(true);
		expect(writeText).toHaveBeenCalledWith("hola");
	});

	it("si el navegador lo niega devuelve false, sin tirar", async () => {
		const writeText = async () => {
			throw new Error("NotAllowedError");
		};
		expect(await copyText("hola", { writeText })).toBe(false);
	});

	it("sin portapapeles disponible devuelve false", async () => {
		expect(await copyText("hola", undefined)).toBe(false);
	});
});
