/**
 * Iniciales para el avatar del menú de usuario, sacadas de la parte local del
 * mail ("matias.okeefe" → "MO"). Sin mail usable devuelve null y el menú
 * muestra un ícono genérico.
 */
export function userInitials(email: string | undefined): string | null {
	const local = email?.split("@")[0] ?? "";
	const parts = local.split(/[._+-]+/).filter(Boolean);
	if (parts.length === 0) return null;
	return parts
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("");
}
