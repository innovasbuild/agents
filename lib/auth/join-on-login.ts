interface RpcClient {
	rpc(fn: string): PromiseLike<{ error: { message: string } | null }>;
}

/**
 * Convierte en membresías lo que corresponde al mail verificado de quien
 * acaba de entrar: primero las invitaciones pendientes (una invitación como
 * admin gana) y después el ingreso por dominio. Cada paso es independiente:
 * si uno falla se registra y el otro corre igual; la sesión ya está abierta y
 * la próxima entrada reintenta.
 */
export async function joinOnLogin(supabase: RpcClient): Promise<void> {
	for (const fn of ["accept_pending_invitations", "join_tenants_by_domain"]) {
		try {
			const { error } = await supabase.rpc(fn);
			if (error) console.error(`${fn} falló:`, error.message);
		} catch (error) {
			console.error(`${fn} falló:`, error);
		}
	}
}
