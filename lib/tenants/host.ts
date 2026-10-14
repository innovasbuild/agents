// Resolución de host a empresa (spec etapa 21.6 §4.2). Puro: sin imports de
// Next ni de Supabase, porque lo usan el proxy, los route handlers y el canal
// MCP de eve, que no puede arrastrar next/*.

export type HostBinding =
	| { kind: "root" }
	| { kind: "tenant"; slug: string }
	| { kind: "unknown" };

const HOSTNAME =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Hostname en minúsculas, sin puerto ni punto final y con los nombres
 * internacionales en punycode. Null ante cualquier cosa que no sea un host.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (trimmed === "" || /[\s/?#@\\*]/.test(trimmed)) return null;

	let hostname: string;
	try {
		const url = new URL(`http://${trimmed}`);
		if (url.username || url.password || url.pathname !== "/") return null;
		hostname = url.hostname;
	} catch {
		return null;
	}

	hostname = hostname.replace(/\.$/, "");
	if (hostname === "[::1]") return hostname;
	if (hostname.length === 0 || hostname.length > 253) return null;
	return HOSTNAME.test(hostname) ? hostname : null;
}

/**
 * Host que pidió quien llama. El primer valor de x-forwarded-host (Vercel
 * puede encadenar varios) y, si no hay, host. Un valor inválido no cae al
 * otro header: un header manipulado no puede esconderse detrás del bueno.
 */
export function requestHost(headers: Headers): string | null {
	const forwarded = headers.get("x-forwarded-host");
	if (forwarded) return normalizeHost(forwarded.split(",")[0]);
	return normalizeHost(headers.get("host"));
}

export interface RootHosts {
	hosts: ReadonlySet<string>;
	suffixes: readonly string[];
}

/**
 * Hosts que sirven la plataforma entera. Además del de PUBLIC_APP_URL (o
 * VERCEL_URL, que la usa de reemplazo en Preview) entra cualquier *.vercel.app,
 * que son los deploys de preview, y localhost fuera de producción. Un
 * *.localhost NO es raíz: ahí se prueba una empresa.
 */
export function rootHostsFromEnv(
	env: Record<string, string | undefined>,
): RootHosts {
	const hosts = new Set<string>();
	const fromUrl = (value: string | undefined, withScheme: boolean) => {
		if (!value) return;
		try {
			const host = normalizeHost(
				withScheme ? new URL(value).host : value.replace(/^https?:\/\//, ""),
			);
			if (host) hosts.add(host);
		} catch {
			// Una URL mal escrita no suma ningún host raíz.
		}
	};
	fromUrl(env.PUBLIC_APP_URL, true);
	if (!env.PUBLIC_APP_URL) fromUrl(env.VERCEL_URL, false);
	if (env.NODE_ENV !== "production") {
		hosts.add("localhost");
		hosts.add("127.0.0.1");
		hosts.add("[::1]");
	}
	return { hosts, suffixes: [".vercel.app"] };
}

export function isRootHost(host: string, roots: RootHosts): boolean {
	return (
		roots.hosts.has(host) ||
		roots.suffixes.some((suffix) => host.endsWith(suffix))
	);
}

export interface HostResolverDeps {
	isRoot: (host: string) => boolean;
	/** Slug de la empresa dueña del host, o null si ninguna lo tiene activo. */
	lookup: (host: string) => Promise<string | null>;
	now?: () => number;
	ttlMs?: number;
	max?: number;
}

/**
 * Resolutor con caché en memoria. Guarda host → slug (también los "no
 * existe", para que un host basura no pegue contra la base en cada request) y
 * nunca guarda un error: una caída de un segundo no deja un dominio real en
 * 404 durante un minuto. El host raíz no pasa por la caché ni por la base.
 */
export function createHostResolver(deps: HostResolverDeps) {
	const now = deps.now ?? Date.now;
	const ttlMs = deps.ttlMs ?? 60_000;
	const max = deps.max ?? 500;
	const cache = new Map<string, { slug: string | null; expiresAt: number }>();

	return async function resolveHost(host: string | null): Promise<HostBinding> {
		if (!host) return { kind: "unknown" };
		if (deps.isRoot(host)) return { kind: "root" };

		const hit = cache.get(host);
		if (hit && hit.expiresAt > now()) {
			return hit.slug
				? { kind: "tenant", slug: hit.slug }
				: { kind: "unknown" };
		}

		const slug = await deps.lookup(host);
		cache.delete(host);
		cache.set(host, { slug, expiresAt: now() + ttlMs });
		while (cache.size > max) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
		return slug ? { kind: "tenant", slug } : { kind: "unknown" };
	};
}

/**
 * ¿Este host puede servir a esta empresa? Un host de empresa solo sirve la
 * suya; el raíz no valida (como hoy); uno desconocido no sirve a nadie.
 */
export function assertHostServesTenant(
	binding: HostBinding,
	slug: string,
): boolean {
	if (binding.kind === "root") return true;
	if (binding.kind === "tenant") return binding.slug === slug;
	return false;
}
