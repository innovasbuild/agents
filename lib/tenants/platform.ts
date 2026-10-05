import { createServerSupabase } from "@/lib/supabase/server";

export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Slug del tenant dueño de la plataforma. Sale solo de la variable de
 * entorno: nada específico de un tenant vive en código. Sin la variable no
 * hay dueño y la consola queda cerrada para todos.
 */
export function platformOwnerSlug(): string | null {
	const slug = process.env.PLATFORM_OWNER_TENANT_SLUG?.trim();
	return slug ? slug : null;
}

/**
 * Un platform_admin cuenta como tal solo si su membership es del tenant
 * dueño. La RLS (`is_platform_admin()`) no conoce la variable de entorno y
 * acepta el rol en cualquier tenant: este chequeo es el de la aplicación.
 */
export async function isPlatformOwnerAdmin(
	supabase: ServerSupabase,
	userId: string,
): Promise<boolean> {
	const slug = platformOwnerSlug();
	if (!slug) return false;

	const { data } = await supabase
		.from("memberships")
		.select("id, tenants!inner(slug)")
		.eq("user_id", userId)
		.eq("role", "platform_admin")
		.eq("tenants.slug", slug)
		.maybeSingle();

	return data !== null;
}

/**
 * Gate de la consola. `null` si no hay sesión o el usuario no es
 * platform_admin del tenant dueño: quien llama responde 404.
 */
export async function requirePlatformAdmin(): Promise<{
	supabase: ServerSupabase;
	userId: string;
} | null> {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;
	if (!(await isPlatformOwnerAdmin(supabase, auth.user.id))) return null;

	return { supabase, userId: auth.user.id };
}
