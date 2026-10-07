// Tools del brain según lo que declara este agente y el binding del tenant
// (spec etapa 11 §8.3). Sin declaración o sin binding, no hay tools brain_*.
import { defineDynamic } from "eve/tools";
import { brainActorFrom } from "../../../lib/brain/adapters/acting-provider";
import { loadAgentBrainAccess } from "../../../lib/brain/adapters/agent-access";
import { createBrainTools } from "../../../lib/brain/adapters/tools";
import { resolveBrainBinding } from "../../../lib/brain/core/resolve";
import { loadTenantBindings } from "../../../lib/connectors/bindings";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			const tenantId = attribute(auth?.attributes?.tenantId);
			if (!tenantId) return null;

			const access = await loadAgentBrainAccess(tenantId, "outreach");
			if (access === "none") return null;

			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			if (!binding) return null;

			// En el chat actúa en nombre de la persona; en corridas desatendidas no
			// hay persona y el agente conserva su declaración.
			return createBrainTools(binding, access, { actor: brainActorFrom(auth) });
		},
	},
});
