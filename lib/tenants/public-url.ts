// Origen público por request (spec etapa 21.6 §4.4). Reemplaza el único
// PUBLIC_APP_URL del proceso: un host de empresa se anuncia con su dominio y
// todo lo demás con el origen fijo. Un Host que no resuelve a nada nunca se
// refleja (H8): no puede terminar en la metadata OAuth ni en un link.
import type { HostBinding } from "./host";
import { requestHost } from "./host";

export interface PublicOrigin {
	origin: string;
	/** El request llegó por el dominio de una empresa (URLs sin slug). */
	tenantHost: boolean;
}

export interface PublicOriginDeps {
	resolve: (host: string | null) => Promise<HostBinding>;
	fallback: string;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.localhost)$/;

/**
 * El origen fijo de la plataforma: PUBLIC_APP_URL y, si falta (Preview),
 * https://$VERCEL_URL. Undefined si no hay ninguno.
 */
export function fallbackPublicUrl(
	env: Record<string, string | undefined>,
): string | undefined {
	const explicit = env.PUBLIC_APP_URL?.replace(/\/$/, "");
	return explicit || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined);
}

/** Origen que corresponde a un host ya resuelto. Síncrono y puro. */
export function originForBinding(
	headers: Headers,
	binding: HostBinding,
	fallback: string,
): PublicOrigin {
	const host = requestHost(headers);
	if (binding.kind !== "tenant" || !host) {
		return { origin: fallback, tenantHost: false };
	}

	const proto =
		headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
		(LOOPBACK.test(host) ? "http" : "https");
	// El puerto se perdió al normalizar; solo importa en desarrollo.
	const raw = headers.get("x-forwarded-host") ?? headers.get("host") ?? "";
	const port = LOOPBACK.test(host)
		? /:(\d+)$/.exec(raw.split(",")[0]?.trim() ?? "")?.[1]
		: undefined;
	return {
		origin: `${proto}://${host}${port ? `:${port}` : ""}`,
		tenantHost: true,
	};
}

export async function publicOriginForRequest(
	headers: Headers,
	deps: PublicOriginDeps,
): Promise<PublicOrigin> {
	const binding = await deps.resolve(requestHost(headers));
	return originForBinding(headers, binding, deps.fallback);
}
