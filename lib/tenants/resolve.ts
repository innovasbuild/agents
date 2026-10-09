import { redirect } from "next/navigation";
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { allowsLogin, methodLanding } from "@/lib/tenants/login-check";
import {
	platformOwnerAdminTenantId,
	platformOwnerSlug,
} from "@/lib/tenants/platform";

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
	userId: string;
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
 * el cliente existe. Si la persona tiene acceso pero entró por un método que
 * la empresa no permite, redirige a la landing de esa empresa. El layout y la
 * página la llaman por separado: `cache` la resuelve una vez por request.
 */
export const resolveTenantAccess = cache(
	async (slug: string): Promise<TenantAccess | null> => {
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

		// El platform_admin del tenant dueño entra a cualquier tenant aunque no
		// tenga membership ahí, y siempre gana sobre el rol local, igual que en la
		// RLS. Si se resolviera al revés, uno que además tuviera una membership
		// local (tenant_member, por ejemplo) se vería degradado en la UI aunque la
		// base le siga dando acceso completo.
		const ownerTenantId = await platformOwnerAdminTenantId(
			supabase,
			auth.user.id,
		);
		const platformAdmin = ownerTenantId !== null;

		// Una fila platform_admin fuera del tenant dueño no es rol de plataforma
		// para la aplicación (spec consola §3): acá vale como admin de ese tenant.
		const localRole =
			membership?.role === "platform_admin" ? "tenant_admin" : membership?.role;

		const role = (platformAdmin ? "platform_admin" : localRole) as
			| TenantRole
			| undefined;
		if (!role) return null;

		// El método con el que se abrió la sesión tiene que estar permitido (spec
		// etapa 20, L10). Un administrador de plataforma se chequea contra su
		// propia empresa, el tenant dueño, no contra la que visita (L12). La
		// sesión no se cierra: puede valer para otra empresa de la misma persona.
		if (!(await allowsLogin(supabase, ownerTenantId ?? tenant.id))) {
			redirect(
				methodLanding(
					platformAdmin ? (platformOwnerSlug() ?? tenant.slug) : tenant.slug,
				),
			);
		}

		return {
			id: tenant.id,
			slug: tenant.slug,
			displayName: tenant.display_name,
			role,
			userId: auth.user.id,
			defaultModel: tenant.default_model,
			allowedModels: tenant.allowed_models,
			brand: brandFromRow(tenant as TenantRow),
		};
	},
);
