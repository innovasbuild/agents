import { describe, expect, it } from "vitest";
import {
	BrainConflict,
	BrainNotFound,
	BrainValidation,
	toToolError,
} from "@/lib/brain/errors";

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
});
