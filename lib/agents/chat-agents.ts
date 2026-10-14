// Qué agentes ofrece la pantalla de chat y cuál queda elegido al abrir un hilo
// nuevo (spec 22.1 §6.2 y C5). Puro: la página le pasa lo que leyó.
import { chatAgents } from "../tenants/home";
import { AGENT_CATALOG, type CatalogAgent, catalogAgents } from "./catalog";

/**
 * `null` es "no se pudo leer": se ofrecen todos los agentes de chat del
 * catálogo y el canal rechaza al que no esté habilitado.
 */
export function availableChatAgents(
	enabledAgents: readonly string[] | null,
): CatalogAgent[] {
	if (enabledAgents === null) {
		return catalogAgents().filter((agent) => AGENT_CATALOG[agent].chat);
	}
	return chatAgents(enabledAgents);
}

/** `threads` viene ordenado del más reciente al más viejo. */
export function defaultChatAgent(
	agents: readonly CatalogAgent[],
	threads: ReadonlyArray<{ agent: string }>,
): CatalogAgent | null {
	const latest = threads[0]?.agent;
	return agents.find((agent) => agent === latest) ?? agents[0] ?? null;
}
