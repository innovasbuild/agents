// Qué le falta a una empresa para que sus agentes puedan trabajar (spec 21.1
// §6.2). Puro: la consola le pasa lo que leyó.
import { AGENT_CATALOG, isCatalogAgent } from "../agents/catalog";
import { isProviderKey, PROVIDERS } from "../connectors/providers";

export type ReadinessIssue =
	| "agentes"
	| "brain"
	| "conectores"
	| "verificacion"
	| "icp"
	| "marco";

/** Si algún agente habilitado necesita el canon del brain (ICP, hooks). */
export function agentsNeedCanon(
	enabledAgents: ReadonlyArray<{ agent: string }>,
): boolean {
	return enabledAgents.some(
		({ agent }) => isCatalogAgent(agent) && AGENT_CATALOG[agent].canon,
	);
}

export const READINESS_LABELS: Record<ReadinessIssue, string> = {
	agentes: "sin agentes habilitados",
	brain: "sin brain",
	conectores: "faltan conectores",
	verificacion: "conectores sin verificar",
	icp: "falta el ICP en el brain",
	marco: "faltan hooks y vectores en el brain",
};

/** Qué se pudo leer de un bloque del canon. "sin_leer" (brain caído o sin
 * brain) no es un motivo: lo avisa la consola aparte. */
export type CanonState = "ok" | "falta" | "invalido" | "sin_leer";

export function canonState(load: { ok: boolean; reason?: string }): CanonState {
	if (load.ok) return "ok";
	return load.reason === "falta" || load.reason === "invalido"
		? load.reason
		: "sin_leer";
}

interface ConnectionState {
	capability: string;
	provider: string;
	enabled: boolean;
	verifiedAt: string | null;
}

// El brain no tiene botón Verificar en la consola: no cuenta.
function needsVerification(c: ConnectionState): boolean {
	return (
		c.capability !== "brain" &&
		isProviderKey(c.provider) &&
		PROVIDERS[c.provider].authKind === "connect_api_key"
	);
}

export function tenantReadiness(input: {
	agents: { agent: string; enabled: boolean }[];
	connections: ConnectionState[];
	canon?: { icp: CanonState; marco: CanonState };
}): { ready: boolean; missing: ReadinessIssue[] } {
	const missing: ReadinessIssue[] = [];
	const enabledAgents = input.agents.filter((a) => a.enabled);
	const enabled = input.connections.filter((c) => c.enabled);

	// Una empresa puede usar solo el brain (spec 21.4 §3.5): sin agentes falta
	// algo solo si tampoco tiene brain.
	const hasBrain = enabled.some((c) => c.capability === "brain");
	if (enabledAgents.length === 0 && !hasBrain) missing.push("agentes");
	if (!hasBrain) missing.push("brain");

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

	if (enabled.some((c) => needsVerification(c) && c.verifiedAt === null)) {
		missing.push("verificacion");
	}

	// Solo si algún agente habilitado necesita el brain y el brain está: sin
	// brain ya figura "brain", y pedir además el ICP sería ruido.
	const needsCanon = agentsNeedCanon(enabledAgents);
	if (needsCanon && input.canon && !missing.includes("brain")) {
		if (input.canon.icp === "falta" || input.canon.icp === "invalido")
			missing.push("icp");
		if (input.canon.marco === "falta" || input.canon.marco === "invalido")
			missing.push("marco");
	}

	return { ready: missing.length === 0, missing };
}
