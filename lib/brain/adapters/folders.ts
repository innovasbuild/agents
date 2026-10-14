// Cablea las carpetas con la plataforma. El permiso lo decide core/editor/folders.ts.
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import type { FolderDeps } from "../core/editor/folders";
import { createSupabaseFolderWriter } from "../core/folders-store";
import { resolveBrainBinding } from "../core/resolve";
import { accessRulesStore } from "./access-rules";

export function folderDeps(): FolderDeps {
	return {
		async actor(tenantSlug) {
			const tenant = await resolveTenantAccess(tenantSlug);
			return tenant
				? { tenantId: tenant.id, userId: tenant.userId, role: tenant.role }
				: null;
		},
		rules: accessRulesStore(),
		async binding(tenantId) {
			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			return binding ? { id: binding.id, provider: binding.provider } : null;
		},
		writer: createSupabaseFolderWriter(createAdminClient()),
	};
}
