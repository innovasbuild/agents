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
		const path = `${url.pathname}${url.search}${url.hash}`;
		// Rechaza paths que se normalizan a // (e.g., /..//evil.com → //evil.com)
		if (path.startsWith("//") || path.startsWith("/\\")) {
			return "/";
		}
		// Defensa final: verifica que el path reconstruido sigue en el mismo origen
		if (new URL(path, origin).origin !== origin) {
			return "/";
		}
		return path;
	} catch {
		return "/";
	}
}
