// A dónde entra una persona cuando abre su empresa (spec 21.4 §3.2). Puro: quien
// llama le pasa lo que leyó. Ningún lugar más decide un aterrizaje.
import { AGENT_CATALOG, isCatalogAgent } from "../agents/catalog";

export type TenantHome = "/chat" | "/brain" | "/conectar";

export function tenantHome(input: {
	enabledAgents: readonly string[];
	brain: boolean;
}): TenantHome {
	const hasChat = input.enabledAgents.some(
		(agent) => isCatalogAgent(agent) && AGENT_CATALOG[agent].chat,
	);
	if (hasChat) return "/chat";
	return input.brain ? "/brain" : "/conectar";
}
