import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guarda de la etapa 21.5: si un agente nuevo (o una reescritura de agent.ts)
// no cablea la etiqueta del gateway ni el asiento de sus pasos, el gasto del
// chat desaparece del reporte sin que nada falle. Estático: lee el disco.
const AGENTS = "agents";
const agentDirs = readdirSync(AGENTS, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => join(AGENTS, entry.name));

describe("el gasto del chat queda etiquetado y asentado", () => {
	it("hay agentes para revisar", () => {
		expect(agentDirs.length).toBeGreaterThan(0);
	});

	it("tenantModel devuelve el modelo con modelSelection(", () => {
		const source = readFileSync("lib/agents/eve/model.ts", "utf8");
		expect(
			source.includes("modelSelection("),
			"lib/agents/eve/model.ts no llama a modelSelection(: las llamadas del chat saldrían sin la etiqueta tenant:<slug> y el reporte de gasto no las atribuye.",
		).toBe(true);
	});

	it("todo agent.ts elige el modelo con tenantModel( o modelSelection(", () => {
		const sinEtiqueta = agentDirs
			.map((dir) => join(dir, "agent.ts"))
			.filter((file) => existsSync(file))
			.filter((file) => {
				const source = readFileSync(file, "utf8");
				return (
					!source.includes("tenantModel(") &&
					!source.includes("modelSelection(")
				);
			})
			.map(
				(file) =>
					`${file}: no usa tenantModel( ni modelSelection(. Sin eso las llamadas del chat salen sin la etiqueta tenant:<slug> y el reporte de gasto no las atribuye. Usá tenantModel("<agente>") de lib/agents/eve/model.ts.`,
			);
		expect(sinEtiqueta, sinEtiqueta.join("\n")).toEqual([]);
	});

	it("todo agente con hooks/runs.ts tiene hooks/usage.ts", () => {
		const sinAsiento = agentDirs
			.filter((dir) => existsSync(join(dir, "hooks", "runs.ts")))
			.filter((dir) => !existsSync(join(dir, "hooks", "usage.ts")))
			.map(
				(dir) =>
					`${join(dir, "hooks")}: tiene runs.ts pero no usage.ts. Sin ese hook los pasos del agente no se asientan en usage_entries y el gasto del chat no aparece. Creá hooks/usage.ts con: export default usageHook(); (de lib/agents/eve/hooks.ts).`,
			);
		expect(sinAsiento, sinAsiento.join("\n")).toEqual([]);
	});
});
