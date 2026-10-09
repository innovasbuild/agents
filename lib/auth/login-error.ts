// Avisos de las pantallas de login según ?error=. Solo códigos conocidos:
// el parámetro lo puede escribir cualquiera en la URL.
const MESSAGES: Record<string, string> = {
	metodo:
		"Tu empresa no permite entrar con ese método. Usá una de estas opciones.",
	auth_failed: "No pudimos abrir tu sesión. Probá de nuevo.",
};

export function loginErrorMessage(code: string | undefined): string | null {
	return code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : null;
}
