// Catálogo de agentes de la plataforma (spec etapa 21.1 §5). Es la única
// lista: el alta de empresas, la consola y la página Conectar leen de acá, y
// un test lo compara contra las carpetas de agents/ y next.config.ts. Solo
// tipos de afuera: lo importan componentes cliente.
import type { Capability } from "../connectors/providers";

export interface AgentCatalogEntry {
	/** Nombre para la persona. */
	name: string;
	/** Qué hace, en una frase. */
	description: string;
	/** Capacidades de conector que usa; la consola avisa si falta alguna. */
	capabilities: readonly Capability[];
	/** Si el agente puede recibir acceso al brain de la empresa. */
	brain: boolean;
	/** Si el agente no puede trabajar sin el brain de la empresa: la consola no
	 * lo deja habilitar hasta que haya uno (spec 21.3 §3.7). */
	requiresBrain: boolean;
	/** Si el agente necesita las páginas de canon de outreach en el brain. La
	 * consola las siembra al habilitarlo (spec 22.1 C10). */
	canon: boolean;
	/** Si el agente se usa desde la pantalla de chat de la empresa. */
	chat: boolean;
	/** Si el agente se puede conectar por MCP desde Conectar. */
	mcp: boolean;
}

// El orden es el que muestran el alta, la consola y el selector del chat.
export const AGENT_CATALOG = {
	asistente: {
		name: "Asistente",
		description:
			"Conversa con el conocimiento de tu empresa: busca, lee y propone páginas del brain.",
		capabilities: [],
		brain: true,
		requiresBrain: true,
		canon: false,
		chat: true,
		mcp: false,
	},
	outreach: {
		name: "Agente de outreach",
		description:
			"Investiga cuentas, redacta mensajes y arma la cola de envíos de tu empresa.",
		capabilities: ["crm", "leads", "mail"],
		brain: true,
		requiresBrain: true,
		canon: true,
		chat: true,
		mcp: true,
	},
} as const satisfies Record<string, AgentCatalogEntry>;

export type CatalogAgent = keyof typeof AGENT_CATALOG;

export function isCatalogAgent(value: string): value is CatalogAgent {
	return Object.hasOwn(AGENT_CATALOG, value);
}

export function catalogAgents(): CatalogAgent[] {
	return Object.keys(AGENT_CATALOG) as CatalogAgent[];
}
