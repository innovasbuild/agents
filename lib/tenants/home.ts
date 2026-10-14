// A dónde entra una persona cuando abre su empresa (spec 21.4 §3.2). Puro: quien
// llama le pasa lo que leyó. Ningún lugar más decide un aterrizaje.
import {
	AGENT_CATALOG,
	type CatalogAgent,
	catalogAgents,
} from "../agents/catalog";

export type TenantHome = "/chat" | "/brain" | "/conectar";

/** Agentes de chat habilitados, en el orden del catálogo. */
export function chatAgents(enabledAgents: readonly string[]): CatalogAgent[] {
	return catalogAgents().filter(
		(agent) => AGENT_CATALOG[agent].chat && enabledAgents.includes(agent),
	);
}

/** Si alguno de los agentes habilitados se usa desde la pantalla de chat. */
export function hasChatAgent(enabledAgents: readonly string[]): boolean {
	return chatAgents(enabledAgents).length > 0;
}

export function tenantHome(input: {
	enabledAgents: readonly string[];
	brain: boolean;
}): TenantHome {
	if (hasChatAgent(input.enabledAgents)) return "/chat";
	return input.brain ? "/brain" : "/conectar";
}
