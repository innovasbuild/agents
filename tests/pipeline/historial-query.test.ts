import { describe, expect, it } from "vitest";
import { OUTREACH_EVENT_TYPES } from "@/lib/outreach/events";
import { EVENT_LABELS, toHistoryEntries } from "@/lib/outreach/historial-query";

const evento = (over: Record<string, unknown> = {}) => ({
	id: 1,
	type: "envio",
	summary: "Crecer sin sumar gente",
	payload: {},
	created_at: "2026-09-14T12:00:00Z",
	...over,
});

describe("EVENT_LABELS", () => {
	it("tiene una etiqueta en castellano para cada tipo de evento", () => {
		for (const type of OUTREACH_EVENT_TYPES) {
			expect(EVENT_LABELS[type]).toBeTruthy();
			expect(EVENT_LABELS[type]).not.toBe(type);
		}
	});
});

describe("toHistoryEntries", () => {
	it("traduce el tipo del evento a su etiqueta", () => {
		const [entry] = toHistoryEntries([evento({ type: "envio" })]);

		expect(entry.label).toBe(EVENT_LABELS.envio);
	});

	it("muestra el tipo crudo si aparece uno que no conocemos", () => {
		const [entry] = toHistoryEntries([evento({ type: "tipo_futuro" })]);

		expect(entry.label).toBe("tipo_futuro");
	});

	it("usa el summary como detalle cuando está", () => {
		const [entry] = toHistoryEntries([evento({ summary: "Asunto del mail" })]);

		expect(entry.detail).toBe("Asunto del mail");
	});

	it("cae al motivo del payload cuando no hay summary", () => {
		const [entry] = toHistoryEntries([
			evento({ summary: null, payload: { motivo: "no pasó el gate" } }),
		]);

		expect(entry.detail).toBe("no pasó el gate");
	});

	it("deja el detalle vacío cuando no hay ni summary ni motivo", () => {
		const [entry] = toHistoryEntries([evento({ summary: null, payload: {} })]);

		expect(entry.detail).toBeNull();
	});

	it("ordena del más reciente al más viejo", () => {
		const entries = toHistoryEntries([
			evento({ id: 1, created_at: "2026-09-10T12:00:00Z" }),
			evento({ id: 2, created_at: "2026-09-15T12:00:00Z" }),
		]);

		expect(entries.map((e) => e.id)).toEqual([2, 1]);
	});

	it("marca los eventos que son una mala noticia, para poder destacarlos", () => {
		expect(
			toHistoryEntries([evento({ type: "envio_fallido" })])[0].problema,
		).toBe(true);
		expect(toHistoryEntries([evento({ type: "rebote" })])[0].problema).toBe(
			true,
		);
		expect(toHistoryEntries([evento({ type: "envio" })])[0].problema).toBe(
			false,
		);
	});

	it("no revienta con un payload que no es un objeto", () => {
		const [entry] = toHistoryEntries([
			evento({ summary: null, payload: "texto" }),
		]);

		expect(entry.detail).toBeNull();
	});
});
