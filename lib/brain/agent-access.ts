// Qué acceso al brain declara cada agente en tenant_agents.config (spec etapa
// 11 §8.3). Sin declaración no hay tools brain_*.
import { createAdminClient } from "../supabase/admin";

export type BrainAccess = "none" | "read" | "read_write";

const VALID: readonly BrainAccess[] = ["none", "read", "read_write"];

export function parseBrainAccess(config: unknown): BrainAccess {
	if (typeof config !== "object" || config === null) return "none";
	const value = (config as Record<string, unknown>).brain;
	if (value === undefined) return "none";
	if (
		typeof value === "string" &&
		(VALID as readonly string[]).includes(value)
	) {
		return value as BrainAccess;
	}
	console.warn(
		`brain omitido: declaración inválida en tenant_agents.config.brain: ${JSON.stringify(value)}`,
	);
	return "none";
}

export async function loadAgentBrainAccess(
	tenantId: string,
	agent: string,
): Promise<BrainAccess> {
	const { data, error } = await createAdminClient()
		.from("tenant_agents")
		.select("config")
		.eq("tenant_id", tenantId)
		.eq("agent", agent)
		.maybeSingle();
	if (error) {
		throw new Error(
			`No pude leer la configuración del agente ${agent}: ${error.message}`,
		);
	}
	return parseBrainAccess(data?.config ?? null);
}
