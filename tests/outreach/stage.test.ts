import { describe, expect, it } from "vitest";
import {
	canAdvance,
	isNoResponse,
	nextFollowup,
	OUTREACH_STAGES,
	STAGE_LABELS,
} from "@/lib/outreach/stage";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));

describe("canAdvance", () => {
	it("avanza de rango y se puede saltear", () => {
		expect(canAdvance("a_contactar", "msg1_enviado")).toBe(true);
		expect(canAdvance("msg1_enviado", "reunion_agendada")).toBe(true);
	});
	it("nunca retrocede ni se queda igual", () => {
		expect(canAdvance("en_conversacion", "msg1_enviado")).toBe(false);
		expect(canAdvance("msg1_enviado", "msg1_enviado")).toBe(false);
	});
	it("dentro del rango 2 sigue la regla del canon", () => {
		expect(canAdvance("sin_respuesta", "en_conversacion")).toBe(true);
		expect(canAdvance("respuesta_neutra", "no_interesado")).toBe(true);
		expect(canAdvance("no_interesado", "en_conversacion")).toBe(true);
		expect(canAdvance("en_conversacion", "respuesta_neutra")).toBe(false);
		expect(canAdvance("no_interesado", "sin_respuesta")).toBe(false);
	});
	it("sin_atribucion solo al crear y desde ahí a rango 2 o más", () => {
		expect(canAdvance("a_contactar", "sin_atribucion")).toBe(false);
		expect(canAdvance("sin_atribucion", "en_conversacion")).toBe(true);
		expect(canAdvance("sin_atribucion", "msg1_enviado")).toBe(false);
	});
	it("conoce los 10 estados del enum", () => {
		expect(OUTREACH_STAGES).toHaveLength(10);
	});
});

describe("cadencia", () => {
	it("segundo toque a +4 y tercero a +10 del primero; después nada", () => {
		expect(nextFollowup({ touches: 1, firstTouchAt: day(0) })).toEqual(day(4));
		expect(nextFollowup({ touches: 2, firstTouchAt: day(0) })).toEqual(day(10));
		expect(nextFollowup({ touches: 3, firstTouchAt: day(0) })).toBeNull();
		expect(nextFollowup({ touches: 0, firstTouchAt: day(0) })).toBeNull();
	});
	it("sin respuesta: 3 toques, sin respuesta y 14 días desde el primero", () => {
		expect(
			isNoResponse({
				touches: 3,
				firstTouchAt: day(0),
				repliedAt: null,
				now: day(14),
			}),
		).toBe(true);
		expect(
			isNoResponse({
				touches: 3,
				firstTouchAt: day(0),
				repliedAt: null,
				now: day(13),
			}),
		).toBe(false);
		expect(
			isNoResponse({
				touches: 2,
				firstTouchAt: day(0),
				repliedAt: null,
				now: day(20),
			}),
		).toBe(false);
		expect(
			isNoResponse({
				touches: 3,
				firstTouchAt: day(0),
				repliedAt: day(5),
				now: day(20),
			}),
		).toBe(false);
		expect(
			isNoResponse({
				touches: 3,
				firstTouchAt: null,
				repliedAt: null,
				now: day(20),
			}),
		).toBe(false);
	});
});

describe("STAGE_LABELS", () => {
	it("tiene una etiqueta en castellano para cada etapa", () => {
		for (const stage of OUTREACH_STAGES) {
			expect(STAGE_LABELS[stage]).toBeTruthy();
		}
	});

	it("no repite una etiqueta entre dos etapas", () => {
		const labels = OUTREACH_STAGES.map((stage) => STAGE_LABELS[stage]);
		expect(new Set(labels).size).toBe(OUTREACH_STAGES.length);
	});

	it("no deja ningún valor crudo de la base como etiqueta", () => {
		for (const stage of OUTREACH_STAGES) {
			expect(STAGE_LABELS[stage]).not.toBe(stage);
		}
	});
});
