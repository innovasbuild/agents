// Instrucciones del brain al arrancar la sesión (spec etapa 26 §4.3), para todo
// agente con brain declarado. Cada agente lo monta desde su instructions/brain.ts.
import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { brainActorFrom } from "../../brain/adapters/acting-provider";
import { loadAgentBrainAccess } from "../../brain/adapters/agent-access";
import { brainSessionInstructions } from "../../brain/adapters/session-instructions";
import { attribute } from "./attribute";

export function brainInstructions(agent: string) {
	return defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return null;
				try {
					if ((await loadAgentBrainAccess(tenantId, agent)) === "none")
						return null;
					const content = await brainSessionInstructions(
						tenantId,
						brainActorFrom(auth),
					);
					return content ? defineInstructions({ content }) : null;
				} catch (error) {
					// Es contexto: la sesión arranca igual, y las reglas llegan en
					// brain_read, brain_rules y el rechazo de brain_upsert.
					console.error(`${agent} instructions/brain:`, error);
					return null;
				}
			},
		},
	});
}
