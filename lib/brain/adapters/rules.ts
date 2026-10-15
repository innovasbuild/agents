// Reglas del brain de la plataforma (spec etapa 26 §4.2). Lo carga el canal MCP
// de eve: sin imports de next/*. El cliente se crea recién al leer.
import { createAdminClient } from "../../supabase/admin";
import type { BrainBinding } from "../core/resolve.ts";
import {
	createWikiRules,
	EMPTY_RULES,
	type RulesSource,
} from "../core/rules-source.ts";
import { createSupabaseWikiStore } from "../core/wiki-store.ts";

export function getBrainRules(binding: BrainBinding): RulesSource {
	// Un brain externo por MCP no tiene reglas propias (spec etapa 26 D15).
	if (binding.provider !== "wiki") return EMPTY_RULES;
	const store = () => createSupabaseWikiStore(createAdminClient());
	return createWikiRules({
		tenantId: binding.tenantId,
		store: {
			listRulePages: (tenantId) => store().listRulePages(tenantId),
			listFolders: (tenantId) => store().listFolders(tenantId),
		},
	});
}
