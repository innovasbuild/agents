// El cierre de sesión del corte al entrar (spec etapa 20, L6 a L8). Se cierra
// SOLO la sesión recién abierta: sin scope, signOut es global y revoca también
// la que la persona tenga en otro dispositivo, abierta por un método permitido.

interface SignOutClient {
	auth: {
		signOut(options: { scope: "local" }): PromiseLike<{ error: unknown }>;
	};
}

/**
 * Nunca tira: quien llama redirige a la landing igual. signOut avisa la falla
 * devolviendo `{ error }`, no tirando, así que se lee y se deja en el log.
 */
export async function closeLocalSession(
	supabase: SignOutClient,
): Promise<void> {
	try {
		const { error } = await supabase.auth.signOut({ scope: "local" });
		if (error) console.error("signOut tras el corte falló:", error);
	} catch (error) {
		console.error("signOut tras el corte falló:", error);
	}
}
