import { defineDynamic } from "eve";
import { resolveModelForTenant } from "../model";
import { attribute } from "./attribute";

/**
 * Modelo de un agente para el tenant de la sesión. Se resuelve en
 * session.started y no por turno: el prompt cache es por modelo, y cambiarlo
 * a mitad de sesión reingiere la conversación a precio sin cachear
 * (guides/dynamic-capabilities.md).
 */
export function tenantModel(agent: string) {
	return defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return "anthropic/claude-sonnet-5";

				return await resolveModelForTenant(
					tenantId,
					agent,
					attribute(auth?.attributes?.conversationId) || null,
				);
			},
		},
	});
}
