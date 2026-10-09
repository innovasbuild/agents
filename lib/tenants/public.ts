import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AuthMethod, isAuthMethod } from "@/lib/tenants/auth-methods";
import { brandFromRow, type TenantBrand } from "@/lib/tenants/resolve";

export interface PublicTenant {
	slug: string;
	displayName: string;
	brand: TenantBrand;
	authMethods: AuthMethod[];
	logoUrl: string | null;
	openDomains: string[];
}

/**
 * Datos de la landing pública de una empresa. Sin sesión no hay RLS que
 * sirva: se lee con el cliente admin y se expone SOLO lo que la landing
 * muestra. Es la única ruta que confirma que un slug existe (spec alta A4).
 */
export async function loadPublicTenant(
	slug: string,
	client: SupabaseClient = createAdminClient(),
): Promise<PublicTenant | null> {
	const { data } = await client
		.from("tenants")
		.select(
			"slug, display_name, brand, auth_methods, self_signup_by_domain, allowed_domains",
		)
		.eq("slug", slug)
		.eq("active", true)
		.maybeSingle();
	if (!data) return null;

	const brand = brandFromRow({ brand: data.brand });
	const methods = (data.auth_methods as string[]).filter(isAuthMethod);

	return {
		slug: data.slug,
		displayName: data.display_name,
		brand,
		// El check de la base impide una lista vacía; esto cubre un valor que la
		// base acepte y este código todavía no conozca.
		authMethods: methods.length > 0 ? methods : ["email"],
		logoUrl: brand.logoUrl
			? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand/${brand.logoUrl}`
			: null,
		openDomains: data.self_signup_by_domain
			? (data.allowed_domains as string[])
			: [],
	};
}
