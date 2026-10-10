// Slug sugerido para un ejecutor a partir de su correo. Es una sugerencia: la
// persona lo puede cambiar y la base valida el formato (^[a-z][a-z0-9-]{0,30}$).
export function suggestExecutorSlug(email: string | undefined): string {
	const local = (email ?? "").split("@")[0] ?? "";
	const cleaned = local
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!cleaned) return "";
	const lettered = /^[a-z]/.test(cleaned) ? cleaned : `e-${cleaned}`;
	return lettered.slice(0, 31).replace(/-+$/, "");
}
