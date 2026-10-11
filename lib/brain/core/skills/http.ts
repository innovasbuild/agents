// Ayudantes puros del endpoint de archivos (spec etapa 24.1 §6). Un route
// handler no tiene el chequeo de origen de las server actions, y un archivo
// subido por una persona nunca se sirve con un tipo que el navegador ejecute.

export function isSameOrigin(
	origin: string | null,
	host: string | null,
): boolean {
	if (!origin || !host) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

function looksLikeText(bytes: Uint8Array): boolean {
	if (bytes.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

export function fileHeaders(
	path: string,
	bytes: Uint8Array,
): Record<string, string> {
	const base = {
		"x-content-type-options": "nosniff",
		"cache-control": "no-store",
		"content-security-policy": "default-src 'none'; sandbox",
	};
	if (looksLikeText(bytes)) {
		return { ...base, "content-type": "text/plain; charset=utf-8" };
	}
	// El nombre sale de una ruta ya validada: sin comillas ni saltos de línea.
	const name = path.slice(path.lastIndexOf("/") + 1);
	return {
		...base,
		"content-type": "application/octet-stream",
		"content-disposition": `attachment; filename="${name}"`,
	};
}

export function skillFileHref(
	tenantSlug: string,
	slug: string,
	path: string,
	version?: number,
): string {
	const query = new URLSearchParams({ slug, path });
	if (version !== undefined) query.set("version", String(version));
	return `/${tenantSlug}/brain/skills/files?${query}`;
}
