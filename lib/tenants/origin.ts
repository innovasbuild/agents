/**
 * Origen público de la app para armar links (invitaciones, landing). El header
 * `origin` viene en los POST del navegador; sin él se arma con el host, y en
 * último caso con PUBLIC_APP_URL. Un origen vacío haría que Supabase ignore
 * el redirect y caiga en su Site URL, perdiendo el `next`.
 */
export function originFrom(headers: Headers): string {
	const origin = headers.get("origin");
	if (origin) return origin;

	const host = headers.get("x-forwarded-host") ?? headers.get("host");
	if (host) {
		const proto =
			headers.get("x-forwarded-proto") ??
			(host.startsWith("localhost") || host.startsWith("127.0.0.1")
				? "http"
				: "https");
		return `${proto}://${host}`;
	}

	return process.env.PUBLIC_APP_URL ?? "";
}
