// Destino después del login (spec etapa 11 §4.3). Solo paths del mismo
// origen: cualquier otra cosa es un open redirect.
export function safeNextPath(
	raw: string | null | undefined,
	origin: string,
): string {
	if (
		!raw ||
		!raw.startsWith("/") ||
		raw.startsWith("//") ||
		raw.startsWith("/\\")
	) {
		return "/";
	}
	try {
		const url = new URL(raw, origin);
		if (url.origin !== origin) return "/";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/";
	}
}
