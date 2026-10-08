// Cablea el borrado de páginas con la plataforma: sesión, binding, reglas y
// cliente admin. El permiso lo decide core/editor/delete.ts.
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { createSupabasePageDeleter } from "../core/delete-store";
import type { DeleteDeps } from "../core/editor/delete";
import { resolveBrainBinding } from "../core/resolve";
import { accessRulesStore } from "./access-rules";
import { getBrainProvider } from "./provider";

export function deleteDeps(): DeleteDeps {
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
		// list() del proveedor sin envolver: la limpieza ve también lo que quien
		// borra no puede ver.
		async pages(tenantId) {
			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			if (!binding || binding.provider !== "wiki") return [];
			return getBrainProvider(binding).list();
		},
		deleter: createSupabasePageDeleter(createAdminClient()),
	};
}
