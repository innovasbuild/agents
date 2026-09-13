// Import relativo: lo importan tools y hooks de eve.
import { createAdminClient } from "../supabase/admin";
import type { Binding, Capability } from "./providers";

interface TenantConnectionRow {
	id: string;
	tenant_id: string;
	capability: Capability;
	provider: string;
	connector_uid: string | null;
	config: Record<string, unknown> | null;
}

/**
 * Bindings habilitados de un tenant. Usa la service role: el tenant tiene que
 * venir de la sesión de eve (fijado por resolveChannelContext), nunca de un
 * input del modelo ni del browser.
 */
export async function loadTenantBindings(tenantId: string): Promise<Binding[]> {
	const { data, error } = await createAdminClient()
		.from("tenant_connections")
		.select("id, tenant_id, capability, provider, connector_uid, config")
		.eq("tenant_id", tenantId)
		.eq("enabled", true);

	if (error) {
		throw new Error(
			`No pude leer las conexiones del tenant ${tenantId}: ${error.message}`,
		);
	}

	return ((data ?? []) as TenantConnectionRow[]).map((row) => ({
		id: row.id,
		tenantId: row.tenant_id,
		capability: row.capability,
		provider: row.provider,
		connectorUid: row.connector_uid,
		config: row.config ?? {},
	}));
}

export async function hasEnabledBinding(
	tenantId: string,
	capability: Capability,
	provider: string,
): Promise<boolean> {
	const bindings = await loadTenantBindings(tenantId);
	return bindings.some(
		(binding) =>
			binding.capability === capability && binding.provider === provider,
	);
}
