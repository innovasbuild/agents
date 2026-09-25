import { apiKeyBearer } from "../connectors/auth";
import { createAdminClient } from "../supabase/admin";
import { createMcpBrainProvider, streamableTransport } from "./mcp.ts";
import type { BrainBinding } from "./resolve.ts";
import type { BrainProvider } from "./types.ts";
import { createWikiProvider } from "./wiki.ts";
import { createSupabaseWikiStore } from "./wiki-store.ts";

export function getBrainProvider(binding: BrainBinding): BrainProvider {
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
