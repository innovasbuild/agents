/**
 * Pide el link de ingreso por mail. Resuelve siempre igual, haya o no cuenta
 * para ese correo, esté o no abierto su dominio y falle o no la red: la
 * pantalla dice lo mismo en todos los casos y no confirma quién tiene acceso.
 * Supabase responde 422 a un correo sin cuenta cuando no se puede crear; ese
 * error nunca llega a la pantalla.
 */
export async function requestMagicLink(params: {
	email: string;
	redirectTo: string;
	/** Solo un correo de un dominio abierto en alguna empresa puede crear cuenta. */
	canSignUpByDomain: (email: string) => Promise<boolean>;
	signInWithOtp: (args: {
		email: string;
		options: { emailRedirectTo: string; shouldCreateUser: boolean };
	}) => PromiseLike<{ error: unknown }>;
}): Promise<void> {
	const shouldCreateUser = await params
		.canSignUpByDomain(params.email)
		.catch(() => false);

	try {
		await params.signInWithOtp({
			email: params.email.trim().toLowerCase(),
			options: { emailRedirectTo: params.redirectTo, shouldCreateUser },
		});
	} catch {
		// Una caída de red se ve igual que un correo sin acceso.
	}
}
