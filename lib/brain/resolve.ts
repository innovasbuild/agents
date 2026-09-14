// Qué brain tiene el tenant de la sesión (spec brain §4.1). Sin efectos.
import type { Binding } from "../connectors/providers.ts";
import { parseWikiConfig, type WikiConfig } from "./config.ts";

export interface BrainBinding {
	id: string;
	tenantId: string;
	provider: "wiki";
	config: WikiConfig;
}

export async function resolveBrainBinding(
	tenantId: string,
	load: (tenantId: string) => Promise<Binding[]>,
): Promise<BrainBinding | null> {
	if (!tenantId) return null;

	const bindings = (await load(tenantId)).filter(
		(binding) => binding.capability === "brain",
	);
	if (bindings.length === 0) return null;

	const wiki = bindings.find((binding) => binding.provider === "wiki");
	if (!wiki) {
		console.warn(
			`brain omitido: proveedor ${bindings.map((binding) => binding.provider).join(", ")} no construido (tenant ${tenantId})`,
		);
		return null;
	}

	try {
		return {
			id: wiki.id,
			tenantId,
			provider: "wiki",
			config: parseWikiConfig(wiki.config),
		};
	} catch (error) {
		console.warn(
			`brain omitido: configuración inválida (tenant ${tenantId}): ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}
