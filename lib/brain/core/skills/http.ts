// Ayudantes puros del endpoint de archivos (spec etapa 24.1 §6). Un route
// handler no tiene el chequeo de origen de las server actions, y un archivo
// subido por una persona nunca se sirve con un tipo que el navegador ejecute.

import type { SkillFailure } from "./publish.ts";

const TENANT = /^[a-z0-9-]{1,63}$/;
// El formulario multipart agrega unos bytes alrededor del archivo.
const MULTIPART_OVERHEAD = 65_536;

const STATUS: Record<SkillFailure["code"], number> = {
	not_found: 404,
	forbidden: 403,
	conflict: 409,
	validation: 422,
	unsupported: 422,
	name_taken: 409,
};

export function statusFor(code: SkillFailure["code"]): number {
	return STATUS[code];
}

export function isTenantSlug(tenant: string): boolean {
	return TENANT.test(tenant);
}

function refusal(status: number, message: string): Response {
	return Response.json({ ok: false, message }, { status });
}

// Las guardas de un POST con archivo, de lo más barato a lo más caro y sin
// leer el cuerpo: tenant, origen (un route handler no trae el chequeo de las
// server actions) y tamaño declarado. Devuelve el rechazo, o null si pasa.
export function checkRequestGuards(
	request: Request,
	tenant: string,
	maxBytes: number,
	tooBigMessage: string,
): Response | null {
	if (!isTenantSlug(tenant)) return refusal(404, "No encontrado.");
	if (
		!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))
	) {
		return refusal(403, "Origen no permitido.");
	}
	// Sin Content-Length no hay cómo acotar lo que se va a leer.
	const length = request.headers.get("content-length");
	if (length === null || !/^\d+$/.test(length)) {
		return refusal(411, "Falta el tamaño del pedido.");
	}
	if (Number(length) > maxBytes + MULTIPART_OVERHEAD) {
		return refusal(413, tooBigMessage);
	}
	return null;
}

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

export function looksLikeText(bytes: Uint8Array): boolean {
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

export function skillPackageHref(tenantSlug: string, slug: string): string {
	return `/${tenantSlug}/brain/skills/package?${new URLSearchParams({ slug })}`;
}
