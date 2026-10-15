import { describe, expect, it } from "vitest";
import {
	formatBrainSession,
	RULES_CHANNEL_LINE,
} from "@/lib/brain/core/session";

describe("formatBrainSession", () => {
	it("trae las instrucciones de la raíz, la tabla de carpetas y la línea de reglas", () => {
		const text = formatBrainSession({
			root: {
				path: "",
				slug: "00-reglas",
				revision: 1,
				body: "  Escribí en tercera persona.\n",
			},
			folders: [
				{ path: "talento", description: "Personas | equipos\ny roles" },
				{ path: "comercial", description: "" },
			],
		});
		expect(text).toContain("# Instrucciones del brain");
		expect(text).toContain("Escribí en tercera persona.");
		expect(text).toContain("| talento | Personas \\| equipos y roles |");
		expect(text).toContain("| comercial | — |");
		expect(text.endsWith(RULES_CHANNEL_LINE)).toBe(true);
	});

	it("sin instrucciones ni carpetas queda solo la línea de reglas", () => {
		expect(formatBrainSession({ root: null, folders: [] })).toBe(
			RULES_CHANNEL_LINE,
		);
	});
});
