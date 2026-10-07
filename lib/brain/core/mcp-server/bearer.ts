// Token de un header Authorization: Bearer. Misma semántica que
// extractBearerToken de eve, copiada para que core no dependa de eve.
export function extractBearer(header: string | null): string | null {
	if (header === null) return null;
	const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
	return token === undefined || token.length === 0 ? null : token;
}
