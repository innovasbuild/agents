import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
	AUTH_METHODS,
	type AuthMethod,
	isAuthMethod,
} from "@/lib/tenants/auth-methods";
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

/**
 * Métodos que ofrece /login, la pantalla sin empresa: los que tiene
 * habilitados al menos una empresa activa. Así un método nuevo no aparece
 * hasta que plataforma lo marque en alguna. Ante cualquier falla, solo correo.
 */
export async function loadOfferedMethods(): Promise<AuthMethod[]> {
	try {
		const { data, error } = await createAdminClient()
			.from("tenants")
			.select("auth_methods")
			.eq("active", true);
		if (error) return ["email"];

		const offered = new Set(
			(data ?? []).flatMap((row) => (row.auth_methods as string[]) ?? []),
		);
		const methods = AUTH_METHODS.filter((method) => offered.has(method));
		return methods.length > 0 ? methods : ["email"];
	} catch {
		return ["email"];
	}
}
