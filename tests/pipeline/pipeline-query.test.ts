import { describe, expect, it } from "vitest";
import { toFunnel } from "@/lib/outreach/pipeline-query";

// `now` fijo: "movimiento en 7 días" se mide contra este instante.
const NOW = new Date("2026-09-16T12:00:00Z");
const hace = (dias: number) =>
	new Date(NOW.getTime() - dias * 86_400_000).toISOString();

const contacto = (stage: string, lastTouchAt: string | null = null) => ({
	stage,
	last_touch_at: lastTouchAt,
});

describe("toFunnel", () => {
	it("cuenta los contactos de cada etapa", () => {
		const funnel = toFunnel(
			[contacto("a_contactar"), contacto("a_contactar"), contacto("cliente")],
			NOW,
		);

		expect(funnel.steps.find((s) => s.stage === "a_contactar")?.count).toBe(2);
		expect(funnel.steps.find((s) => s.stage === "cliente")?.count).toBe(1);
	});

	it("devuelve las etapas en el orden de la escalera, incluso las vacías", () => {
		const funnel = toFunnel([contacto("cliente")], NOW);

		expect(funnel.steps.map((s) => s.stage)).toEqual([
			"a_contactar",
			"msg1_enviado",
			"sin_respuesta",
			"respuesta_neutra",
			"no_interesado",
			"en_conversacion",
			"reunion_agendada",
			"deal_creado",
			"cliente",
		]);
	});

	it("deja sin_atribucion fuera de la escalera, aparte", () => {
		const funnel = toFunnel(
			[contacto("a_contactar"), contacto("sin_atribucion")],
			NOW,
		);

		expect(funnel.steps.some((s) => s.stage === "sin_atribucion")).toBe(false);
		expect(funnel.sinAtribucion).toBe(1);
	});

	it("calcula el porcentaje sobre el total de la escalera, sin contar sin_atribucion", () => {
		const funnel = toFunnel(
			[
				contacto("a_contactar"),
				contacto("a_contactar"),
				contacto("cliente"),
				contacto("cliente"),
				contacto("sin_atribucion"),
			],
			NOW,
		);

		expect(funnel.total).toBe(4);
		expect(funnel.steps.find((s) => s.stage === "cliente")?.percent).toBe(50);
	});

	it("con la escalera vacía devuelve 0% y no divide por cero", () => {
		const funnel = toFunnel([contacto("sin_atribucion")], NOW);

		expect(funnel.total).toBe(0);
		for (const step of funnel.steps) {
			expect(step.percent).toBe(0);
		}
	});

	it("cuenta como movimiento reciente el toque de hace menos de 7 días", () => {
		const funnel = toFunnel([contacto("msg1_enviado", hace(3))], NOW);

		expect(funnel.steps.find((s) => s.stage === "msg1_enviado")?.recent).toBe(
			1,
		);
	});

	it("no cuenta como movimiento reciente el toque de hace más de 7 días", () => {
		const funnel = toFunnel([contacto("msg1_enviado", hace(8))], NOW);

		expect(funnel.steps.find((s) => s.stage === "msg1_enviado")?.recent).toBe(
			0,
		);
	});

	it("un contacto sin toques nunca cuenta como movimiento reciente", () => {
		const funnel = toFunnel([contacto("a_contactar", null)], NOW);

		expect(funnel.steps.find((s) => s.stage === "a_contactar")?.recent).toBe(0);
	});

	it("ignora una etapa que no está en la escalera conocida", () => {
		const funnel = toFunnel(
			[contacto("etapa_inventada"), contacto("cliente")],
			NOW,
		);

		expect(funnel.total).toBe(1);
	});
});
