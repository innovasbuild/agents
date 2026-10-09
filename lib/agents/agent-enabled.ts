// ¿Este agente está habilitado para este cliente? Mismo criterio que el canal
// del dashboard (channel-context.ts): sin fila en tenant_agents, o con
// enabled en false, no. Import relativo: lo importa un canal de eve.
import { createAdminClient } from "../supabase/admin";

export async function loadAgentEnabled(
	tenantId: string,
	agent: string,
): Promise<boolean> {
	const { data, error } = await createAdminClient()
		.from("tenant_agents")
		.select("enabled")
		.eq("tenant_id", tenantId)
		.eq("agent", agent)
		.maybeSingle();
	if (error) throw new Error(`No pude leer el agente: ${error.message}`);
	return data?.enabled === true;
}
