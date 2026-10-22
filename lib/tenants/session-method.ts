import type { ServerSupabase } from "@/lib/tenants/platform";

export const SIN_EL_METODO_ACTUAL =
	"No podés sacar la forma de entrar con la que estás usando ahora.";

/**
 * Método con el que se abrió la sesión de quien edita, según la base (nunca
 * llega por parámetro). `null` ante cualquier duda: error, excepción o un
 * valor que no es un texto. Los tipos generados dicen `string`, pero la
 * función devuelve null cuando no reconoce el método.
 */
export async function sessionLoginMethod(
	supabase: ServerSupabase,
): Promise<string | null> {
	try {
		const { data, error } = await supabase.rpc("current_login_method");
		if (error) {
			console.error("current_login_method falló:", error);
			return null;
		}
		const method: unknown = data;
		return typeof method === "string" && method !== "" ? method : null;
	} catch (error) {
		console.error("current_login_method falló:", error);
		return null;
	}
}
