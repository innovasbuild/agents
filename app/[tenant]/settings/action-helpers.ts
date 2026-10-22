import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { actionAllowsLogin } from "@/lib/tenants/login-check-server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// Sin "use server": un archivo de acciones solo puede exportar funciones
// async, y esto exporta constantes y tipos. Lo importan las acciones de
// settings (config-actions.ts y outreach/actions.ts).
export type ConfigResult =
	| { ok: true; message?: string }
	| { ok: false; message: string };

export const SIN_PERMISO: ConfigResult = {
	ok: false,
	message: "No tenés permiso.",
};
export const INVALIDO: ConfigResult = {
	ok: false,
	message: "No se pudo procesar el pedido.",
};
export const GENERICO: ConfigResult = {
	ok: false,
	message: "No se pudo guardar. Probá de nuevo.",
};

export const slugSchema = z.string().regex(/^[a-z0-9-]{1,63}$/);

export type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * La empresa sale del slug resuelto con la sesión; el id nunca viene del
 * navegador. La base vuelve a verificar el rol: esto evita la llamada y da el
 * mensaje. También mira el método de login (spec etapa 20, L10 a L12).
 */
export async function adminOf(
	slug: string,
): Promise<
	| {
			supabase: Supabase;
			tenantId: string;
			allowedModels: string[];
			role: string;
	  }
	| ConfigResult
> {
	if (!slugSchema.safeParse(slug).success) return INVALIDO;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant || tenant.role === "tenant_member") return SIN_PERMISO;

	const supabase = await createServerSupabase();
	if (!(await actionAllowsLogin(supabase, tenant.userId, tenant.id))) {
		return SIN_PERMISO;
	}
	return {
		supabase,
		tenantId: tenant.id,
		allowedModels: tenant.allowedModels ?? [],
		role: tenant.role,
	};
}

/** Solo un mensaje con hint 'settings' fue escrito para la persona. */
export function fromDbError(error: {
	code?: string;
	message: string;
	hint?: string | null;
}): ConfigResult {
	if (error.hint === "settings") return { ok: false, message: error.message };
	if (error.code === "42501") return SIN_PERMISO;
	console.error("settings:", error.code, error.message);
	return GENERICO;
}
