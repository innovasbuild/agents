import { describe, expect, it } from "vitest";
import { chatAgents, tenantHome } from "@/lib/tenants/home";

describe("tenantHome", () => {
	it("con un agente con chat habilitado, va al chat", () => {
		expect(tenantHome({ enabledAgents: ["outreach"], brain: true })).toBe(
			"/chat",
		);
	});

	it("sin agentes y con brain, va al brain", () => {
		expect(tenantHome({ enabledAgents: [], brain: true })).toBe("/brain");
	});

	it("sin agentes y sin brain, va a Conectar", () => {
		expect(tenantHome({ enabledAgents: [], brain: false })).toBe("/conectar");
	});

	it("un agente que no está en el catálogo no cuenta como chat", () => {
		expect(tenantHome({ enabledAgents: ["soporte"], brain: true })).toBe(
			"/brain",
		);
	});

	it("solo con el asistente y brain, va al chat", () => {
		expect(tenantHome({ enabledAgents: ["asistente"], brain: true })).toBe(
			"/chat",
		);
	});
});

describe("chatAgents", () => {
	it("devuelve los agentes de chat en el orden del catálogo", () => {
		expect(chatAgents(["outreach", "asistente"])).toEqual([
			"asistente",
			"outreach",
		]);
	});

	it("ignora lo que no está en el catálogo", () => {
		expect(chatAgents(["soporte", "outreach", "toString"])).toEqual([
			"outreach",
		]);
	});

	it("sin agentes, lista vacía", () => {
		expect(chatAgents([])).toEqual([]);
	});
});
