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

export type ConsentLoginCheck = "allowed" | "denied" | "no-tenants";

/**
 * ¿Esta sesión puede autorizar una app por MCP en /oauth/consent? El grant
 * vale para todas las empresas de la persona y el token que emite no dice con
 * qué método entró, así que el método tiene que estar permitido en cada
 * empresa activa donde es miembro. Un administrador de plataforma se chequea
 * solo contra el tenant dueño (L12). Sin empresas no hay nada que autorizar:
 * "no-tenants", para que la pantalla lo diga con sus palabras. Falla cerrado
 * ("denied") y nunca tira.
 */
export async function consentLoginCheck(
	supabase: ServerSupabase,
	userId: string,
): Promise<ConsentLoginCheck> {
	try {
		const ownerTenantId = await platformOwnerAdminTenantId(supabase, userId);
		if (ownerTenantId) {
			return (await allowsLogin(supabase, ownerTenantId))
				? "allowed"
				: "denied";
		}

		const { data, error } = await supabase
			.from("memberships")
			.select("tenant_id, tenants!inner(active)")
			.eq("user_id", userId)
			.eq("tenants.active", true);
		if (error) {
			console.error("No se pudieron leer las empresas de la persona:", error);
			return "denied";
		}
		const tenantIds = [
			...new Set((data ?? []).map((row) => row.tenant_id as string)),
		];
		if (tenantIds.length === 0) return "no-tenants";
		const allowed = await Promise.all(
			tenantIds.map((tenantId) => allowsLogin(supabase, tenantId)),
		);
		return allowed.every(Boolean) ? "allowed" : "denied";
	} catch (error) {
		console.error("No se pudo chequear el método para autorizar:", error);
		return "denied";
	}
}

/** Lo mismo como sí o no: solo "allowed" deja autorizar. */
export async function consentAllowsLogin(
	supabase: ServerSupabase,
	userId: string,
): Promise<boolean> {
	return (await consentLoginCheck(supabase, userId)) === "allowed";
}
