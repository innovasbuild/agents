import { describe, expect, it } from "vitest";
import {
	replyClassificationSchema,
	stageForReply,
	wantsDeal,
} from "@/lib/outreach/classify";
import { OUTREACH_EVENT_TYPES, outreachEvent } from "@/lib/outreach/events";
import { assignLetters } from "@/lib/outreach/queue-letters";

describe("classify", () => {
	it("valida la salida del clasificador y mapea a la escalera", () => {
		const parsed = replyClassificationSchema.parse({
			categoria: "reunion_agendada",
			resumen: "Acepta el jueves",
			cita: "Dale, el jueves a las 10",
		});
		expect(stageForReply(parsed.categoria)).toBe("reunion_agendada");
		expect(wantsDeal("en_conversacion")).toBe(true);
		expect(wantsDeal("respuesta_neutra")).toBe(false);
		expect(() =>
			replyClassificationSchema.parse({
				categoria: "spam",
				resumen: "x",
				cita: "x",
			}),
		).toThrow();
	});
});

describe("events", () => {
	it("arma el insert con canal email por default y rechaza tipos desconocidos", () => {
		expect(
			outreachEvent({
				tenant_id: "t",
				actor_user_id: "u",
				contact_key: "em:a@b.test",
				type: "encolado",
				summary: "  pieza A  ",
				payload: { queue_item_id: "q" },
			}),
		).toEqual({
			tenant_id: "t",
			actor_user_id: "u",
			contact_key: "em:a@b.test",
			channel: "email",
			type: "encolado",
			summary: "pieza A",
			payload: { queue_item_id: "q" },
			run_id: null,
		});
		expect(() =>
			outreachEvent({
				tenant_id: "t",
				actor_user_id: null,
				contact_key: null,
				type: "otro" as never,
				summary: "x",
				payload: {},
			}),
		).toThrow('tipo de evento de outreach desconocido: "otro"');
		expect(OUTREACH_EVENT_TYPES).toContain("oportunidad_frenada");
	});
	it("recorta el resumen a 500 caracteres", () => {
		const event = outreachEvent({
			tenant_id: "t",
			actor_user_id: null,
			contact_key: null,
			type: "nota",
			summary: "x".repeat(600),
			payload: {},
		});
		expect(event.summary).toHaveLength(500);
	});
});

describe("assignLetters", () => {
	it("ordena por creación y asigna A, B, …, Z, AA", () => {
		const items = Array.from({ length: 27 }, (_, i) => ({
			id: `q${i}`,
			created_at: new Date(Date.UTC(2026, 8, 1, 0, 26 - i)).toISOString(),
		}));
		const lettered = assignLetters(items);
		expect(lettered[0]).toMatchObject({ id: "q26", letter: "A" });
		expect(lettered[25].letter).toBe("Z");
		expect(lettered[26]).toMatchObject({ id: "q0", letter: "AA" });
	});
});
