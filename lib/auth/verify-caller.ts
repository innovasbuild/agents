import { createServerClient } from "@supabase/ssr";

/**
 * Parsea el header `cookie` crudo de un `Request` en pares { name, value }.
 * No usa `next/headers` porque esta función corre fuera del scope de request
 * de Next (canal de eve, `Request` crudo).
 */
function parseCookieHeader(
	header: string | null,
): { name: string; value: string }[] {
	if (!header) return [];

	return header
		.split(";")
		.map((pair) => pair.trim())
		.filter(Boolean)
		.map((pair) => {
			const separatorIndex = pair.indexOf("=");
			if (separatorIndex === -1) return { name: pair, value: "" };

			const name = pair.slice(0, separatorIndex).trim();
			const rawValue = pair.slice(separatorIndex + 1).trim();

			try {
				return { name, value: decodeURIComponent(rawValue) };
			} catch {
				return { name, value: rawValue };
			}
		});
}

/**
 * Verifica al caller de un request crudo (fuera del scope de Next) contra una
 * sesión de Supabase armada a mano desde el header `cookie`. Un token emitido
 * por el servidor OAuth (claim `client_id`) no cuenta como sesión. Devuelve `null`
 * en cualquier caso de falla (sin cookies, cookie inválida, error de red,
 * etc.) para que el auth walk de eve avance al siguiente autenticador —
 * nunca tira.
 */
export async function verifyCaller(
	request: Request,
): Promise<{ userId: string; email: string } | null> {
	try {
		const cookies = parseCookieHeader(request.headers.get("cookie"));

		const supabase = createServerClient(
			process.env.NEXT_PUBLIC_SUPABASE_URL!,
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
			{
				cookies: {
					getAll() {
						return cookies;
					},
					setAll() {
						// No hay response al que escribirle cookies en este contexto
						// (canal de eve, no un route handler de Next); no-op intencional.
						// El refresco de sesión no está implementado en este spike: sin
						// middleware, el access token expira (default 1h de Supabase) y el
						// usuario tiene que volver a loguearse. Deuda para Etapa 1.
					},
				},
			},
		);

		const { data, error } = await supabase.auth.getUser();
		if (error || !data.user?.email) return null;

		// Los tokens que emite el servidor OAuth a un cliente MCP traen
		// `client_id`: sirven para el brain por MCP, no para abrir el chat.
		const { data: claimsData, error: claimsError } =
			await supabase.auth.getClaims();
		if (claimsError || !claimsData?.claims) return null;
		if (claimsData.claims.client_id) return null;

		return { userId: data.user.id, email: data.user.email };
	} catch {
		return null;
	}
}
