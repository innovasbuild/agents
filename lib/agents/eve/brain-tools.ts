// Tools del brain según lo que declara un agente y el binding del tenant
// (spec etapa 11 §8.3). Sin declaración o sin binding, no hay tools brain_*.
// Lo comparten todos los agentes (spec 22.1 §5): cada uno lo monta desde su
// tools/brain.ts con su nombre.
import { defineDynamic } from "eve/tools";
import { brainActorFrom } from "../../brain/adapters/acting-provider";
import { loadAgentBrainAccess } from "../../brain/adapters/agent-access";
import { createBrainTools } from "../../brain/adapters/tools";
import { resolveBrainBinding } from "../../brain/core/resolve";
import { loadTenantBindings } from "../../connectors/bindings";
import { attribute } from "./attribute";

export function brainTools(agent: string) {
	return defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return null;

				const access = await loadAgentBrainAccess(tenantId, agent);
				if (access === "none") return null;

				const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
				if (!binding) return null;

				// En el chat actúa en nombre de la persona; en corridas desatendidas
				// no hay persona y el agente conserva su declaración.
				return createBrainTools(binding, access, {
					actor: brainActorFrom(auth),
				});
			},
		},
	});
}
