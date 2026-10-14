import { describe, expect, it } from "vitest";
import {
	availableChatAgents,
	defaultChatAgent,
} from "@/lib/agents/chat-agents";

describe("availableChatAgents", () => {
	it("con la lista leída, los de chat habilitados en orden de catálogo", () => {
		expect(availableChatAgents(["outreach", "asistente"])).toEqual([
			"asistente",
			"outreach",
		]);
		expect(availableChatAgents(["asistente"])).toEqual(["asistente"]);
	});

	it("si no se pudo leer, todos los de chat del catálogo", () => {
		expect(availableChatAgents(null)).toEqual(["asistente", "outreach"]);
	});
});

describe("defaultChatAgent", () => {
	it("el agente del hilo más reciente", () => {
		expect(
			defaultChatAgent(
				["asistente", "outreach"],
				[{ agent: "outreach" }, { agent: "asistente" }],
			),
		).toBe("outreach");
	});

	it("sin hilos, el primero de la lista", () => {
		expect(defaultChatAgent(["asistente", "outreach"], [])).toBe("asistente");
	});

	it("si el hilo más reciente es de un agente que ya no está, el primero", () => {
		expect(defaultChatAgent(["asistente"], [{ agent: "outreach" }])).toBe(
			"asistente",
		);
	});

	it("sin agentes, null", () => {
		expect(defaultChatAgent([], [{ agent: "outreach" }])).toBeNull();
	});
});
