import { defineAgent, defineDynamic } from "eve";
import { resolveModelForTenant } from "../../lib/agents/model";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export default defineAgent({
	// Se resuelve en session.started y no por turno: el prompt cache es por
	// modelo, y cambiarlo a mitad de sesión reingiere la conversación a precio
	// sin cachear (guides/dynamic-capabilities.md).
	model: defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return "anthropic/claude-sonnet-5";

				return await resolveModelForTenant(
					tenantId,
					"outreach",
					attribute(auth?.attributes?.conversationId) || null,
				);
			},
		},
	}),
});
