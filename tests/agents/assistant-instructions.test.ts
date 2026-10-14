import { describe, expect, it } from "vitest";
import { assistantSessionInstructions } from "@/lib/agents/assistant-instructions";

const base = {
	tenantName: "Acme",
	tenantSlug: "acme",
	brainConnected: true,
	otherAgents: [] as { name: string; description: string }[],
};

describe("assistantSessionInstructions", () => {
	it("nombra la empresa y su slug", () => {
		expect(assistantSessionInstructions(base)).toContain(
			"Trabajás para Acme (tenant `acme`).",
		);
	});

	it("con otros agentes, los nombra y manda a abrir un hilo con ellos", () => {
		const text = assistantSessionInstructions({
			...base,
			otherAgents: [
				{
					name: "Agente de outreach",
					description: "Investiga cuentas y arma la cola.",
				},
			],
		});

		expect(text).toContain(
			"- Agente de outreach: Investiga cuentas y arma la cola.",
		);
		expect(text).toContain("abran un hilo nuevo eligiéndolo");
		expect(text).not.toContain("No hay otros agentes habilitados");
	});

	it("sin otros agentes, dice que lo que está fuera del brain no está disponible", () => {
		const text = assistantSessionInstructions(base);

		expect(text).toContain("No hay otros agentes habilitados en esta empresa.");
		expect(text).not.toContain("abran un hilo nuevo");
	});

	it("sin brain conectado, lo dice y no manda a buscar", () => {
		const text = assistantSessionInstructions({
			...base,
			brainConnected: false,
		});

		expect(text).toContain("Esta empresa no tiene un brain conectado");
	});

	it("con brain conectado no habla de brain faltante", () => {
		expect(assistantSessionInstructions(base)).not.toContain(
			"no tiene un brain conectado",
		);
	});
});
