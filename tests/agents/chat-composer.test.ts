import { describe, expect, it } from "vitest";
import { canSendMessage } from "@/lib/agents/chat-composer";

describe("canSendMessage", () => {
	it("con texto y sin bloqueo, se puede enviar", () => {
		expect(
			canSendMessage({ text: "hola", hasFile: false, blocked: false }),
		).toBe(true);
	});

	it("un adjunto solo alcanza, sin texto", () => {
		expect(canSendMessage({ text: "", hasFile: true, blocked: false })).toBe(
			true,
		);
	});

	it("texto en blanco y sin adjunto no se envía", () => {
		expect(
			canSendMessage({ text: "  \n ", hasFile: false, blocked: false }),
		).toBe(false);
	});

	it("bloqueado (tarjeta pendiente, abriendo el hilo) no se envía", () => {
		expect(
			canSendMessage({ text: "hola", hasFile: false, blocked: true }),
		).toBe(false);
	});
});
