// Dependencias reales del endpoint: verificador del emisor (D6), lecturas de
// acceso y el contador. Todo con service role salvo la verificación del token.
import { createClient } from "@supabase/supabase-js";
import { loadTenantBindings } from "../../connectors/bindings";
import { createAdminClient } from "../../supabase/admin";
import { resolveBrainBinding } from "../resolve.ts";
import type { AccessStore, ClaimsVerifier } from "./access.ts";
import type { HitFn } from "./rate-limit.ts";

export function supabaseClaimsVerifier(): ClaimsVerifier {
	const client = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{ auth: { persistSession: false, autoRefreshToken: false } },
	);
	return async (token) => {
		const { data, error } = await client.auth.getClaims(token);
		if (error || !data) {
			if (error) console.warn(`brain mcp: getClaims falló (${error.name})`);
			return null;
		}
		return data.claims as Record<string, unknown>;
	};
}

export function supabaseAccessStore(): AccessStore {
	const admin = createAdminClient();
	return {
		async tenantBySlug(slug) {
			const { data, error } = await admin
				.from("tenants")
				.select("id, active")
				.eq("slug", slug)
				.maybeSingle();
			if (error) throw new Error(`No pude leer el tenant: ${error.message}`);
			return data
				? { id: data.id as string, active: data.active as boolean }
				: null;
		},
		async rolesOf(userId) {
			const { data, error } = await admin
				.from("memberships")
				.select("tenant_id, role")
				.eq("user_id", userId);
			if (error)
				throw new Error(`No pude leer las membresías: ${error.message}`);
			return (data ?? []).map((row) => ({
				tenantId: row.tenant_id as string,
				role: row.role as string,
			}));
		},
		brainBinding: (tenantId) =>
			resolveBrainBinding(tenantId, loadTenantBindings),
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
