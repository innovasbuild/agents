// Qué brain tiene el tenant de la sesión (spec brain §4.1, etapa 11 §7.2). Sin
// efectos. La base garantiza un solo brain habilitado por tenant (D9).
import type { Binding } from "../connectors/providers.ts";
import { parseWikiConfig, type WikiConfig } from "./config.ts";
import { type McpBrainConfig, parseMcpBrainConfig } from "./mcp-config.ts";

export interface WikiBrainBinding {
	id: string;
	tenantId: string;
	provider: "wiki";
	config: WikiConfig;
}

export interface McpBrainBinding {
	id: string;
	tenantId: string;
	provider: "mcp";
	connectorUid: string;
	config: McpBrainConfig;
}

export type BrainBinding = WikiBrainBinding | McpBrainBinding;

function omit(tenantId: string, reason: string): null {
	console.warn(`brain omitido: ${reason} (tenant ${tenantId})`);
	return null;
}

export async function resolveBrainBinding(
	tenantId: string,
	load: (tenantId: string) => Promise<Binding[]>,
): Promise<BrainBinding | null> {
	if (!tenantId) return null;

	const brain = (await load(tenantId)).find(
		(binding) => binding.capability === "brain",
	);
	if (!brain) return null;

	try {
		if (brain.provider === "wiki") {
			return {
				id: brain.id,
				tenantId,
				provider: "wiki",
				config: parseWikiConfig(brain.config),
			};
		}
		if (brain.provider === "mcp") {
			if (!brain.connectorUid)
				return omit(tenantId, "el brain mcp no tiene conector");
			return {
				id: brain.id,
				tenantId,
				provider: "mcp",
				connectorUid: brain.connectorUid,
				config: parseMcpBrainConfig(brain.config),
			};
		}
		return omit(tenantId, `proveedor ${brain.provider} no construido`);
	} catch (error) {
		return omit(
			tenantId,
			`configuración inválida: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
