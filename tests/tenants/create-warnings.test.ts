import { describe, expect, it } from "vitest";
import {
	INVITE_WARNING,
	knownWarnings,
	LOGO_WARNING,
} from "@/lib/tenants/create-warnings";

describe("knownWarnings", () => {
	it("deja pasar solo los avisos que la action puede generar", () => {
		expect(
			knownWarnings([LOGO_WARNING, "Llamá al 0800-estafa", INVITE_WARNING]),
		).toEqual([LOGO_WARNING, INVITE_WARNING]);
	});

	it("saca los repetidos", () => {
		expect(knownWarnings([LOGO_WARNING, LOGO_WARNING])).toEqual([LOGO_WARNING]);
	});

	it("devuelve lista vacía sin avisos", () => {
		expect(knownWarnings([])).toEqual([]);
	});
});
