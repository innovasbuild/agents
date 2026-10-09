// El chequeo del método para lo que no pasa por una página: server actions y
// rutas de API que reciben el id de una empresa (o de una fila) y usan el
// cliente de la sesión directo. Misma regla que resolveTenantAccess (spec
// etapa 20, L10 a L12). Vive aparte de login-check.ts porque importa
// ./platform, que depende de Next, y aquel lo compila eve.
import { allowsLogin } from "./login-check";
import { platformOwnerAdminTenantId, type ServerSupabase } from "./platform";

/**
 * ¿La empresa que toca la acción permite el método con el que se abrió esta
 * sesión? Un administrador de plataforma se chequea contra el tenant dueño,
 * no contra la empresa que opera (L12). Falla cerrado y nunca tira.
 */
export async function actionAllowsLogin(
	supabase: ServerSupabase,
	userId: string,
	tenantId: string,
): Promise<boolean> {
	let ownerTenantId: string | null;
	try {
		ownerTenantId = await platformOwnerAdminTenantId(supabase, userId);
	} catch (error) {
		console.error("No se pudo resolver el rol de plataforma:", error);
		return false;
	}
	return allowsLogin(supabase, ownerTenantId ?? tenantId);
}
