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
		return !error && data === true;
	} catch {
		return false;
	}
}

export function methodLanding(slug: string): string {
	return `/login/${slug}?error=metodo`;
}
