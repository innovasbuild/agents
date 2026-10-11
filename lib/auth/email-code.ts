// El código del mail se verifica desde el navegador (spec 21.4
// §5.1): así el límite por IP de Supabase cuenta la IP de la persona y no la
// del servidor de la app, que sería un balde compartido por todos. La sesión
// queda en cookies y el tramo posterior lo corre la server action
// completeLogin.
/** Un solo mensaje para cualquier falla: no confirma quién tiene cuenta. */
export const EMAIL_CODE_ERROR =
	"El código no es correcto o ya venció. Pedí otro.";

/**
 * El código ya se verificó pero el tramo posterior (membresías y compuerta)
 * no terminó. No revela nada del mail: a este punto solo llega quien tipeó un
 * código válido.
 */
export const LOGIN_INCOMPLETE_ERROR =
	"No pudimos terminar de entrar. Probá de nuevo.";

// Chequeo plano y no zod: este módulo viaja en el bundle del navegador.
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;
// El largo del código es un ajuste del proyecto en Supabase (6 por defecto,
// hasta 10): acá se acepta cualquiera de esos y decide Supabase.
const CODE_SHAPE = /^\d{6,10}$/;

/** true solo si Supabase abrió sesión. Nunca tira. */
export async function verifyEmailCode(params: {
	email: string;
	code: string;
	verifyOtp: (args: {
		email: string;
		token: string;
		type: "email";
	}) => PromiseLike<{ data: { session: unknown }; error: unknown }>;
}): Promise<boolean> {
	const email = params.email.trim().toLowerCase();
	const token = params.code.replace(/\s+/g, "");
	if (email.length > 254 || !EMAIL_SHAPE.test(email)) return false;
	if (!CODE_SHAPE.test(token)) return false;
	try {
		const { data, error } = await params.verifyOtp({
			email,
			token,
			type: "email",
		});
		return !error && Boolean(data.session);
	} catch {
		return false;
	}
}

/**
 * Entrar con el código: verifica en el navegador y corre completeLogin. Con
 * éxito la acción redirige y no devuelve nada: responde null. Si el código
 * pasó pero completar falla (devuelve error o tira), la sesión que dejó
 * verifyOtp en cookies nunca pasó por las membresías ni la compuerta: se
 * cierra antes de avisar. Nunca tira.
 */
export async function enterWithEmailCode(params: {
	email: string;
	code: string;
	verifyOtp: Parameters<typeof verifyEmailCode>[0]["verifyOtp"];
	completeLogin: () => Promise<{ ok: false; message: string } | undefined>;
	closeSession: () => Promise<void>;
}): Promise<string | null> {
	const verified = await verifyEmailCode(params);
	if (!verified) return EMAIL_CODE_ERROR;

	try {
		// redirect() de la acción no llega acá: Next lo resuelve antes.
		const result = await params.completeLogin();
		if (result?.ok !== false) return null;
	} catch (error) {
		console.error("completar el ingreso con código falló:", error);
	}
	try {
		await params.closeSession();
	} catch (error) {
		console.error("no se pudo cerrar la sesión del código:", error);
	}
	return LOGIN_INCOMPLETE_ERROR;
}
