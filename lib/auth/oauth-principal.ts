// Verificación de tokens del emisor OAuth y lectura de membresías/tenants,
// compartido entre el endpoint del brain (Etapa 11) y el canal MCP del
// agente (Etapa 6). Sin nada específico de ninguno de los dos.
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { platformOwnerSlug } from "../tenants/platform-owner";

export function createOAuthClaimsVerifier(): (
	token: string,
) => Promise<Record<string, unknown> | null> {
	const client = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{ auth: { persistSession: false, autoRefreshToken: false } },
	);
	return async (token) => {
		const { data, error } = await client.auth.getClaims(token);
		if (error || !data) {
			if (error) console.warn(`oauth: getClaims falló (${error.name})`);
			return null;
		}
		return data.claims as Record<string, unknown>;
	};
}

export async function loadMemberships(
	userId: string,
): Promise<{ tenantId: string; role: string }[]> {
	const { data, error } = await createAdminClient()
		.from("memberships")
		.select("tenant_id, role")
		.eq("user_id", userId);
	if (error) throw new Error(`No pude leer las membresías: ${error.message}`);
	return (data ?? []).map((row) => ({
		tenantId: row.tenant_id as string,
		role: row.role as string,
	}));
}

export async function loadTenantBySlug(
	slug: string,
): Promise<{ id: string; active: boolean } | null> {
	const { data, error } = await createAdminClient()
		.from("tenants")
		.select("id, active")
		.eq("slug", slug)
		.maybeSingle();
	if (error) throw new Error(`No pude leer el tenant: ${error.message}`);
	return data
		? { id: data.id as string, active: data.active as boolean }
		: null;
}

/**
 * Id del tenant dueño de la plataforma, o null si no hay uno configurado.
 * Una fila platform_admin solo cuenta como plataforma si es de ese tenant,
 * igual que en la aplicación (lib/tenants/resolve.ts). Sin
 * PLATFORM_OWNER_TENANT_SLUG no hay dueño y nadie entra como plataforma.
 */
export async function loadPlatformOwnerTenantId(): Promise<string | null> {
	const slug = platformOwnerSlug();
	if (!slug) return null;
	return (await loadTenantBySlug(slug))?.id ?? null;
}
