import { describe, expect, it } from "vitest";
import { planListen } from "@/lib/outreach/listen";
import { contactRow } from "./fake-store";

const NOW = new Date("2026-09-19T12:00:00Z");

const inbound = (over: Record<string, unknown> = {}) => ({
	id: "m1",
	threadId: "t1",
	rfc822MessageId: "<ana-1@acme.test>",
	from: "ana@acme.test",
	date: "Mon, 14 Sep 2026 10:00:00 -0300",
	snippet: "me interesa",
	body: "Me interesa, contame más",
	isFromUs: false,
	isBounce: false,
	isAutoReply: false,
	...over,
});

describe("planListen", () => {
	it("una respuesta nueva registra el evento, setea replied_at y mueve a respuesta_neutra", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound()],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.event.type).toBe("respuesta");
		expect(effect.repliedAt).toBe(NOW.toISOString());
		expect(effect.stage).toBe("respuesta_neutra");
	});

	it("un mensaje nuestro no genera ningún efecto", () => {
		const effects = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ isFromUs: true })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effects).toEqual([]);
	});

	it("un mensaje ya registrado, con el contacto ya marcado, no se procesa de nuevo", () => {
		const effects = planListen({
			contact: contactRow({
				stage: "respuesta_neutra",
				repliedAt: "2026-09-18T10:00:00Z",
			}),
			messages: [inbound({ id: "m1" })],
			knownMessageIds: new Set(["m1"]),
			now: NOW,
		});

		expect(effects).toEqual([]);
	});

	// B2: el sweep escribe el evento primero y el patch del contacto después. Si
	// el patch falla, el mensaje queda "conocido" y el contacto sin replied_at,
	// y hasta ahora ninguna corrida futura lo podía reparar: el dedup lo
	// salteaba para siempre y le seguían saliendo follow-ups.
	it("una respuesta ya registrada cuyo patch nunca se aplicó se vuelve a emitir", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado", repliedAt: null }),
			messages: [inbound({ id: "m1" })],
			knownMessageIds: new Set(["m1"]),
			now: NOW,
		});

		expect(effect.event.gmailMessageId).toBe("m1");
		expect(effect.repliedAt).toBe(NOW.toISOString());
		expect(effect.stage).toBe("respuesta_neutra");
	});

	it("un auto-reply ya registrado no se re-emite: su replied_at null es el estado correcto", () => {
		const effects = planListen({
			contact: contactRow({ stage: "msg1_enviado", repliedAt: null }),
			messages: [inbound({ id: "m1", isAutoReply: true })],
			knownMessageIds: new Set(["m1"]),
			now: NOW,
		});

		expect(effects).toEqual([]);
	});

	it("un rebote ya registrado no se re-emite: no deja replied_at que comparar", () => {
		const effects = planListen({
			contact: contactRow({ stage: "msg1_enviado", repliedAt: null }),
			messages: [inbound({ id: "m1", isBounce: true })],
			knownMessageIds: new Set(["m1"]),
			now: NOW,
		});

		expect(effects).toEqual([]);
	});

	it("un rebote registra el evento pero no mueve la etapa ni setea replied_at", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ isBounce: true })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.event.type).toBe("rebote");
		expect(effect.repliedAt).toBeNull();
		expect(effect.stage).toBeNull();
	});

	it("un auto-reply se registra pero NO apaga la cadencia de follow-ups", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ isAutoReply: true })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.event.type).toBe("respuesta");
		// Lo que importa: sin replied_at el contacto sigue elegible para follow-up.
		expect(effect.repliedAt).toBeNull();
		expect(effect.stage).toBeNull();
	});

	it("no retrocede la etapa de un contacto que ya está más arriba en la escalera", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "reunion_agendada" }),
			messages: [inbound()],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.stage).toBeNull();
	});

	it("procesa varios mensajes nuevos del mismo hilo en orden", () => {
		const effects = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [inbound({ id: "m1" }), inbound({ id: "m2" })],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effects.map((e) => e.event.gmailMessageId)).toEqual(["m1", "m2"]);
	});

	it("el summary del evento lleva el texto de la respuesta, no el snippet recortado", () => {
		const [effect] = planListen({
			contact: contactRow({ stage: "msg1_enviado" }),
			messages: [
				inbound({ body: "Me interesa, contame más", snippet: "Me inter" }),
			],
			knownMessageIds: new Set(),
			now: NOW,
		});

		expect(effect.event.summary).toContain("Me interesa, contame más");
	});
});
