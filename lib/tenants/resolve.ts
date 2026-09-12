import { createServerSupabase } from "@/lib/supabase/server";

export type TenantRole = "platform_admin" | "tenant_admin" | "tenant_member";

export interface TenantBrand {
	primary?: string;
	secondary?: string;
	logoUrl?: string;
}

export interface TenantRow {
	id: string;
	slug: string;
	display_name: string;
	default_model: string;
	allowed_models: string[];
	brand: Record<string, unknown>;
}

export interface TenantAccess {
	id: string;
	slug: string;
	displayName: string;
	role: TenantRole;
	defaultModel: string;
	allowedModels: string[];
	brand: TenantBrand;
}

function readString(
	source: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function brandFromRow(row: Pick<TenantRow, "brand">): TenantBrand {
	const brand = row.brand ?? {};
	const primary = readString(brand, "primary");
	const secondary = readString(brand, "secondary");
	const logoUrl = readString(brand, "logo_url");

	return {
		...(primary ? { primary } : {}),
		...(secondary ? { secondary } : {}),
		...(logoUrl ? { logoUrl } : {}),
	};
}

/**
 * Traduce un slug de la URL a tenant y rol del usuario logueado. Devuelve
 * `null` si no hay sesión, si el slug no existe o si el usuario no es
 * miembro: quien llama responde 404, nunca 403, porque un 403 confirma que
 * el cliente existe.
 */
export async function resolveTenantAccess(
	slug: string,
): Promise<TenantAccess | null> {
	const supabase = await createServerSupabase();

	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	const { data: tenant } = await supabase
		.from("tenants")
		.select("id, slug, display_name, default_model, allowed_models, brand")
		.eq("slug", slug)
		.eq("active", true)
		.maybeSingle();

	if (!tenant) return null;

	const { data: membership } = await supabase
		.from("memberships")
		.select("role")
		.eq("tenant_id", tenant.id)
		.eq("user_id", auth.user.id)
		.maybeSingle();

	// El platform_admin entra a cualquier tenant aunque no tenga membership ahí.
	const { data: platformAdmin } = await supabase
		.from("memberships")
		.select("role")
		.eq("user_id", auth.user.id)
		.eq("role", "platform_admin")
		.maybeSingle();

	const role = (membership?.role ?? platformAdmin?.role) as
		| TenantRole
		| undefined;
	if (!role) return null;

	return {
		id: tenant.id,
		slug: tenant.slug,
		displayName: tenant.display_name,
		role,
		defaultModel: tenant.default_model,
		allowedModels: tenant.allowed_models,
		brand: brandFromRow(tenant as TenantRow),
	};
}
