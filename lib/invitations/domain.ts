/**
 * `allowed_domains` valida al invitar; no es puerta de entrada. Quien deja el
 * cliente pierde acceso cuando se le saca la membership, no cuando le cierran
 * el mail. Lista vacía significa sin restricción.
 */
export function isAllowedDomain(
	email: string,
	allowedDomains: string[],
): boolean {
	const parts = email.trim().toLowerCase().split("@");
	if (parts.length !== 2 || parts[1].length === 0) return false;
	if (allowedDomains.length === 0) return true;

	return allowedDomains.some(
		(domain) => domain.trim().toLowerCase() === parts[1],
	);
}

/** Dominio en minúsculas de `algo@dominio`; null si no tiene esa forma. */
export function emailDomain(email: string): string | null {
	const parts = email.trim().toLowerCase().split("@");
	if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
		return null;
	}
	return parts[1];
}
