// Qué le falta a una empresa para que sus agentes puedan trabajar (spec 21.1
// §6.2). Puro: la consola le pasa lo que leyó.
import { AGENT_CATALOG, isCatalogAgent } from "../agents/catalog";
import { isProviderKey, PROVIDERS } from "../connectors/providers";

export type ReadinessIssue =
	| "agentes"
	| "brain"
	| "conectores"
	| "verificacion";

export const READINESS_LABELS: Record<ReadinessIssue, string> = {
	agentes: "sin agentes habilitados",
	brain: "sin brain",
	conectores: "faltan conectores",
	verificacion: "conectores sin verificar",
};

interface ConnectionState {
	capability: string;
	provider: string;
	enabled: boolean;
	verifiedAt: string | null;
}

function needsVerification(provider: string): boolean {
	return (
		isProviderKey(provider) &&
		PROVIDERS[provider].authKind === "connect_api_key"
	);
}

export function tenantReadiness(input: {
	agents: { agent: string; enabled: boolean }[];
	connections: ConnectionState[];
}): { ready: boolean; missing: ReadinessIssue[] } {
	const missing: ReadinessIssue[] = [];
	const enabledAgents = input.agents.filter((a) => a.enabled);
	const enabled = input.connections.filter((c) => c.enabled);

	if (enabledAgents.length === 0) missing.push("agentes");
	if (!enabled.some((c) => c.capability === "brain")) missing.push("brain");

	const needed = new Set<string>();
	for (const { agent } of enabledAgents) {
		if (isCatalogAgent(agent)) {
			for (const capability of AGENT_CATALOG[agent].capabilities)
				needed.add(capability);
		}
	}
	const covered = new Set(enabled.map((c) => c.capability));
	if ([...needed].some((capability) => !covered.has(capability)))
		missing.push("conectores");

	if (
		enabled.some((c) => needsVerification(c.provider) && c.verifiedAt === null)
	) {
		missing.push("verificacion");
	}

	return { ready: missing.length === 0, missing };
}
