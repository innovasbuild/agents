// Chequeo de la metadata del emisor OAuth (spec etapa 11 V1, V2). Sin imports.
export function checkAuthServerMetadata(
	metadata: unknown,
	expectedIssuer: string,
): { ok: boolean; problems: string[] } {
	if (
		typeof metadata !== "object" ||
		metadata === null ||
		Array.isArray(metadata)
	) {
		return { ok: false, problems: ["la metadata no es un objeto JSON (V1)"] };
	}
	const raw = metadata as Record<string, unknown>;
	const problems: string[] = [];
	if (raw.issuer !== expectedIssuer) {
		problems.push(
			`issuer es ${String(raw.issuer)}, se esperaba ${expectedIssuer}`,
		);
	}
	for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
		if (typeof raw[key] !== "string") problems.push(`falta ${key} (V1)`);
	}
	if (typeof raw.registration_endpoint !== "string") {
		problems.push(
			"falta registration_endpoint (V2): los clientes no se pueden registrar solos",
		);
	}
	const methods = raw.code_challenge_methods_supported;
	if (!Array.isArray(methods) || !methods.includes("S256"))
		problems.push("no anuncia PKCE S256");
	return { ok: problems.length === 0, problems };
}
