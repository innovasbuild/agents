// El código de 6 dígitos del mail se verifica desde el navegador (spec 21.4
// §5.1): así el límite por IP de Supabase cuenta la IP de la persona y no la
// del servidor de la app, que sería un balde compartido por todos. La sesión
// queda en cookies y el tramo posterior lo corre la server action
// completeLogin.
import { z } from "zod";

/** Un solo mensaje para cualquier falla: no confirma quién tiene cuenta. */
export const EMAIL_CODE_ERROR =
	"El código no es correcto o ya venció. Pedí otro.";

const emailSchema = z.email().max(254);

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
	const parsed = emailSchema.safeParse(params.email.trim().toLowerCase());
	const token = params.code.replace(/\s+/g, "");
	if (!parsed.success || !/^\d{6}$/.test(token)) return false;
	try {
		const { data, error } = await params.verifyOtp({
			email: parsed.data,
			token,
			type: "email",
		});
		return !error && Boolean(data.session);
	} catch {
		return false;
	}
}
