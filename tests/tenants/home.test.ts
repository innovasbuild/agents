import { describe, expect, it } from "vitest";
import { tenantHome } from "@/lib/tenants/home";

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
});
