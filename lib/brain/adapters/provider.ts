import { apiKeyBearer } from "../../connectors/auth";
import { createAdminClient } from "../../supabase/admin";
import { createMcpBrainProvider, streamableTransport } from "../core/mcp.ts";
import type { BrainBinding } from "../core/resolve.ts";
import type { BrainProvider } from "../core/types.ts";
import { createWikiProvider } from "../core/wiki.ts";
import { createSupabaseWikiStore } from "../core/wiki-store.ts";
import { withCanonReflection } from "./canon-reflection";

function rawBrainProvider(binding: BrainBinding): BrainProvider {
	if (binding.provider === "mcp") {
		const bearer = apiKeyBearer(binding.connectorUid);
		return createMcpBrainProvider({
			config: binding.config,
			transport: streamableTransport(
				binding.config.url,
				async () => (await bearer.getToken()).token,
			),
		});
	}
	return createWikiProvider({
		tenantId: binding.tenantId,
		bindingId: binding.id,
		config: binding.config,
		store: createSupabaseWikiStore(createAdminClient()),
	});
}

export function getBrainProvider(binding: BrainBinding): BrainProvider {
	// Import dinámico: lib/outreach/canon importa este archivo.
	return withCanonReflection(rawBrainProvider(binding), async () => {
		const { reflectMarcoForTenant } = await import(
			"../../outreach/marco-reflect"
		);
		await reflectMarcoForTenant(binding.tenantId);
	});
}
