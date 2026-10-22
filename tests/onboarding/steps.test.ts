import { describe, expect, it } from "vitest";
import { nextStep, STEP_ORDER, stepPath } from "@/lib/onboarding/steps";

describe("steps", () => {
	it("orden", () => {
		expect(STEP_ORDER).toEqual(["carpetas", "logo", "acceso", "equipo"]);
	});
	it("stepPath", () => {
		expect(stepPath("acme", "logo")).toBe("/empezar/acme/logo");
	});
	it("nextStep", () => {
		expect(nextStep("carpetas")).toBe("logo");
		expect(nextStep("acceso")).toBe("equipo");
		expect(nextStep("equipo")).toBeNull();
	});
});
