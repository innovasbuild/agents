// Quién es esta persona en HubSpot: el id de dueño cuyo correo es el suyo
// (spec 21.2 S9). Nunca tira: sin dueño, sin permiso o con HubSpot caído
// devuelve null y la pantalla lo dice. El token no se registra nunca.
const API = "https://api.hubapi.com";

export async function resolveCrmOwnerId(
	token: string,
	email: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	const wanted = email.trim().toLowerCase();
	if (!wanted) return null;

	try {
		const response = await fetchImpl(
			`${API}/crm/v3/owners?email=${encodeURIComponent(wanted)}&limit=2`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		if (!response.ok) {
			console.error("hubspot owners:", response.status);
			return null;
		}
		const body = (await response.json()) as { results?: unknown };
		const results = Array.isArray(body.results) ? body.results : [];
		const matches = results.filter(
			(row): row is { id: string; email: string } =>
				typeof row === "object" &&
				row !== null &&
				typeof (row as { id?: unknown }).id === "string" &&
				typeof (row as { email?: unknown }).email === "string" &&
				(row as { email: string }).email.toLowerCase() === wanted,
		);
		// Dos dueños con el mismo correo: no se adivina cuál.
		return matches.length === 1 ? matches[0].id : null;
	} catch (error) {
		console.error(
			"hubspot owners:",
			error instanceof Error ? error.message : "error",
		);
		return null;
	}
}
