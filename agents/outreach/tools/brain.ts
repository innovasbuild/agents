// Tools del brain según lo que declara este agente y el binding del tenant
// (spec etapa 11 §8.3). Sin declaración o sin binding, no hay tools brain_*.
import { defineDynamic } from "eve/tools";
import { loadAgentBrainAccess } from "../../../lib/brain/agent-access";
import { resolveBrainBinding } from "../../../lib/brain/resolve";
import { createBrainTools } from "../../../lib/brain/tools";
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

			return createBrainTools(binding, access);
		},
	},
});
