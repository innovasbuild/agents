import { createAdminClient } from "../supabase/admin";
import type { BrainBinding } from "./resolve.ts";
import type { BrainProvider } from "./types.ts";
import { createWikiProvider } from "./wiki.ts";
import { createSupabaseWikiStore } from "./wiki-store.ts";

export function getBrainProvider(binding: BrainBinding): BrainProvider {
	return createWikiProvider({
		tenantId: binding.tenantId,
		bindingId: binding.id,
		config: binding.config,
		store: createSupabaseWikiStore(createAdminClient()),
	});
}
