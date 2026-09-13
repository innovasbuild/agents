import type { DynamicConnectionDefinition } from "eve/connections";
import { buildTenantConnections } from "./catalog";
import type { Binding } from "./providers";

/**
 * Lógica del resolver de conexiones, separada del defineDynamic para poder
 * probarla. Sin efectos: eve la vuelve a correr al reanudar o reintentar.
 */
export async function resolveTenantConnections(
	tenantId: string,
	load: (tenantId: string) => Promise<Binding[]>,
): Promise<Record<string, DynamicConnectionDefinition> | null> {
	if (!tenantId) return null;
	const connections = buildTenantConnections(await load(tenantId));
	return Object.keys(connections).length > 0 ? connections : null;
}
