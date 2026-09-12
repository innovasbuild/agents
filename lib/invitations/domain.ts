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
