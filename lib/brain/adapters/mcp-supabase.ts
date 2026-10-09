// Dependencias reales del endpoint: el verificador del emisor y las lecturas
// de acceso viven en lib/auth/oauth-principal.ts (compartido con el canal
// MCP del agente, Etapa 6); acá solo queda lo específico del brain.

import {
	createOAuthClaimsVerifier,
	loadMemberships,
	loadPlatformOwnerTenantId,
	loadTenantBySlug,
} from "../../auth/oauth-principal";
import { loadTenantBindings } from "../../connectors/bindings";
import { createAdminClient } from "../../supabase/admin";
import type { AccessStore, ClaimsVerifier } from "../core/mcp-server/access.ts";
import type { HitFn } from "../core/mcp-server/rate-limit.ts";
import { resolveBrainBinding } from "../core/resolve.ts";

export function supabaseClaimsVerifier(): ClaimsVerifier {
	return createOAuthClaimsVerifier();
}

export function supabaseAccessStore(): AccessStore {
	return {
		tenantBySlug: loadTenantBySlug,
		rolesOf: loadMemberships,
		brainBinding: (tenantId) =>
			resolveBrainBinding(tenantId, loadTenantBindings),
		platformOwnerTenantId: loadPlatformOwnerTenantId,
	};
}

export function supabaseHit(): HitFn {
	const admin = createAdminClient();
	return async ({ tenantId, userId, kind, limit }) => {
		const { data, error } = await admin
			.rpc("brain_mcp_hit", {
				p_tenant_id: tenantId,
				p_user_id: userId,
				p_kind: kind,
				p_limit: limit,
			})
			.single();
		if (error || !data)
			throw new Error(
				`No pude contar la llamada: ${error?.message ?? "sin fila"}`,
			);
		const row = data as { allowed: boolean; retry_after_seconds: number };
		return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
	};
}
