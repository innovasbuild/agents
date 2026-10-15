// Bloque de arranque del brain para el chat (spec etapa 26 §4.3): instrucciones
// de la raíz y carpetas de primer nivel que ve la persona. Lo suman a sus
// instrucciones dinámicas todos los agentes con brain declarado.
import { loadTenantBindings } from "../../connectors/bindings";
import type { AccessRule } from "../core/access/types.ts";
import {
	type BrainBinding,
	type BrainConnection,
	resolveBrainBinding,
} from "../core/resolve.ts";
import type { RulesSource } from "../core/rules-source.ts";
import { formatBrainSession } from "../core/session.ts";
import { type BrainActor, resolveActingSession } from "./acting-provider.ts";

export interface SessionInstructionsDeps {
	bindings?: (tenantId: string) => Promise<BrainConnection[]>;
	rulesSource?: (binding: BrainBinding) => RulesSource;
	rules?: (tenantId: string) => Promise<AccessRule[]>;
}

export async function brainSessionInstructions(
	tenantId: string,
	actor: BrainActor | undefined,
	deps: SessionInstructionsDeps = {},
): Promise<string | null> {
	const binding = await resolveBrainBinding(
		tenantId,
		deps.bindings ?? loadTenantBindings,
	);
	// Un brain externo por MCP no tiene instrucciones ni carpetas propias (D15).
	if (binding?.provider !== "wiki") return null;
	const context = await resolveActingSession(binding, actor, deps);
	// Quien no ve nada del brain no recibe sus instrucciones ni sus carpetas.
	return context ? formatBrainSession(context) : null;
}
