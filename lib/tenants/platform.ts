import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { allowsLogin, methodLanding } from "./login-check";

export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

import { platformOwnerSlug } from "./platform-owner";

export { platformOwnerSlug };

/**
 * Id del tenant dueño si la persona es su platform_admin; null si no. La RLS
 * (`is_platform_admin()`) no conoce la variable de entorno y acepta el rol en
 * cualquier tenant: este chequeo es el de la aplicación.
 */
export async function platformOwnerAdminTenantId(
	supabase: ServerSupabase,
	userId: string,
): Promise<string | null> {
	const slug = platformOwnerSlug();
	if (!slug) return null;

	const { data } = await supabase
		.from("memberships")
		.select("tenant_id, tenants!inner(slug)")
		.eq("user_id", userId)
		.eq("role", "platform_admin")
		.eq("tenants.slug", slug)
		.maybeSingle();

	return (data?.tenant_id as string | undefined) ?? null;
}

export async function isPlatformOwnerAdmin(
	supabase: ServerSupabase,
	userId: string,
): Promise<boolean> {
	return (await platformOwnerAdminTenantId(supabase, userId)) !== null;
}

/**
 * Gate de la consola. `null` si no hay sesión o el usuario no es
 * platform_admin del tenant dueño: quien llama responde 404. Si lo es pero
 * entró por un método que el tenant dueño no permite, redirige a su landing.
 */
export async function requirePlatformAdmin(): Promise<{
	supabase: ServerSupabase;
	userId: string;
} | null> {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	const ownerTenantId = await platformOwnerAdminTenantId(
		supabase,
		auth.user.id,
	);
	if (ownerTenantId === null) return null;

	if (!(await allowsLogin(supabase, ownerTenantId))) {
		redirect(methodLanding(platformOwnerSlug() ?? ""));
	}

	return { supabase, userId: auth.user.id };
}
