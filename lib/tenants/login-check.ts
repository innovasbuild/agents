// El chequeo del método en cada request (spec etapa 20, L10 a L13). Sin
// imports de Next ni alias: también lo usa el canal del chat, que corre
// fuera del scope de Next.

export interface LoginCheckClient {
	rpc(
		fn: string,
		args: { p_tenant: string },
	): PromiseLike<{ data: unknown; error: unknown }>;
}

/** ¿La empresa permite el método con el que se abrió esta sesión? Falla cerrado. */
export async function allowsLogin(
	supabase: LoginCheckClient,
	tenantId: string,
): Promise<boolean> {
	try {
		const { data, error } = await supabase.rpc("tenant_allows_login", {
			p_tenant: tenantId,
		});
		if (error) {
			// Sin esto, un RPC roto se ve igual que "tu empresa no permite ese
			// método" en todas las pantallas y no queda rastro.
			console.error("tenant_allows_login falló:", error);
			return false;
		}
		return data === true;
	} catch (error) {
		console.error("tenant_allows_login falló:", error);
		return false;
	}
}

export function methodLanding(slug: string): string {
	return `/login/${slug}?error=metodo`;
}
